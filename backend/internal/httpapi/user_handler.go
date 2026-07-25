package httpapi

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/db"
	"pdftemplate/internal/store"
)

// userHandler 使用者管理（admin 專屬；router 掛 requireAdmin）。
type userHandler struct {
	users    *store.UserStore
	projects *store.ProjectStore
}

// userView 清單/回應用（含指派的專案 id，供管理畫面顯示）。
type userView struct {
	store.UserSummary
	ProjectIDs []string `json:"projectIds"`
}

func (h *userHandler) list(c *gin.Context) {
	users, err := h.users.List(tenantOf(c))
	if err != nil {
		httpInternalError(c, err)
		return
	}
	out := make([]userView, 0, len(users))
	for _, u := range users {
		pids, err := h.projects.MemberProjectIDs(u.ID)
		if err != nil {
			httpInternalError(c, err)
			return
		}
		out = append(out, userView{UserSummary: u, ProjectIDs: pids})
	}
	c.JSON(http.StatusOK, out)
}

func (h *userHandler) create(c *gin.Context) {
	var req struct {
		Username   string   `json:"username"`
		Password   string   `json:"password"`
		Role       string   `json:"role"`
		ProjectIDs []string `json:"projectIds"`
	}
	if err := decodeJSON(c, &req); err != nil {
		httpError(c, 400, err)
		return
	}
	u, err := h.users.Create(tenantOf(c), req.Username, req.Password, req.Role)
	if err != nil {
		httpError(c, 400, err) // 帳號/密碼空、帳號重複等
		return
	}
	if err := h.projects.SetMembers(tenantOf(c), u.ID, req.ProjectIDs); err != nil {
		httpInternalError(c, err)
		return
	}
	c.JSON(http.StatusOK, userView{
		UserSummary: store.UserSummary{ID: u.ID, Username: u.Username, Role: u.Role},
		ProjectIDs:  req.ProjectIDs,
	})
}

// update 改角色 / 重設密碼 / 指派專案（帶哪個欄位就改哪個）。
func (h *userHandler) update(c *gin.Context) {
	id := c.Param("id")
	target, err := h.users.GetByID(id)
	if err != nil {
		httpError(c, 404, errors.New("使用者不存在"))
		return
	}
	var req struct {
		Role       *string   `json:"role"`
		Password   *string   `json:"password"`
		ProjectIDs *[]string `json:"projectIds"`
	}
	if err := decodeJSON(c, &req); err != nil {
		httpError(c, 400, err)
		return
	}

	// 降級最後一個 admin → 擋（避免無人可管）。
	if req.Role != nil && target.Role == db.RoleAdmin && *req.Role != db.RoleAdmin {
		if blocked, err := h.lastAdminBlocked(c); err != nil {
			return
		} else if blocked {
			return
		}
	}

	if req.Role != nil {
		if err := h.users.SetRole(id, *req.Role); err != nil {
			httpInternalError(c, err)
			return
		}
	}
	if req.Password != nil {
		if len(*req.Password) < minPasswordLen {
			httpError(c, 400, fmt.Errorf("密碼至少 %d 字元", minPasswordLen))
			return
		}
		if err := h.users.SetPassword(id, *req.Password); err != nil {
			httpInternalError(c, err)
			return
		}
	}
	if req.ProjectIDs != nil {
		if err := h.projects.SetMembers(tenantOf(c), id, *req.ProjectIDs); err != nil {
			httpInternalError(c, err)
			return
		}
	}
	c.Status(http.StatusNoContent)
}

func (h *userHandler) remove(c *gin.Context) {
	id := c.Param("id")
	if id == userOf(c) {
		httpError(c, 400, errors.New("不能刪除自己"))
		return
	}
	target, err := h.users.GetByID(id)
	if err != nil {
		httpError(c, 404, errors.New("使用者不存在"))
		return
	}
	if target.Role == db.RoleAdmin {
		if blocked, err := h.lastAdminBlocked(c); err != nil {
			return
		} else if blocked {
			return
		}
	}
	if err := h.users.Delete(id); err != nil {
		httpInternalError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// lastAdminBlocked 若目前只剩一個 admin 則回應 400 並回傳 true（呼叫端 return）。
// 回傳 err 代表已回應 500。
func (h *userHandler) lastAdminBlocked(c *gin.Context) (bool, error) {
	n, err := h.users.CountAdmins(tenantOf(c))
	if err != nil {
		httpInternalError(c, err)
		return false, err
	}
	if n <= 1 {
		httpError(c, 400, errors.New("至少需保留一位管理員"))
		return true, nil
	}
	return false, nil
}
