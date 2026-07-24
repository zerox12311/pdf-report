package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/db"
	"pdftemplate/internal/store"
)

// projectHandler 控制台專案：清單 / 建立 / 刪除 / 專案內樣板清單。皆需登入。
// 建立/刪除為 admin 專屬（router 掛 requireAdmin）；清單依角色範圍化。
type projectHandler struct {
	projects  *store.ProjectStore
	templates *store.TemplateStore
}

// list 專案清單：admin 看全部；user 只看自己是成員的。
func (h *projectHandler) list(c *gin.Context) {
	var (
		list []store.ProjectSummary
		err  error
	)
	if isAdmin(c) {
		list, err = h.projects.List(tenantOf(c))
	} else {
		list, err = h.projects.ListForUser(tenantOf(c), userOf(c))
	}
	if err != nil {
		httpInternalError(c, err)
		return
	}
	c.JSON(http.StatusOK, list)
}

// remove 刪除專案（admin 專屬）：預設專案不可刪；非空專案需先清空。
func (h *projectHandler) remove(c *gin.Context) {
	pid := c.Param("id")
	if pid == db.DefaultProjectID {
		httpError(c, 400, errors.New("預設專案不可刪除"))
		return
	}
	ok, err := h.projects.Exists(tenantOf(c), pid)
	if err != nil {
		httpInternalError(c, err)
		return
	}
	if !ok {
		httpError(c, 404, errors.New("專案不存在"))
		return
	}
	tpls, err := h.templates.ListInProject(tenantOf(c), pid)
	if err != nil {
		httpInternalError(c, err)
		return
	}
	if len(tpls) > 0 {
		httpError(c, 400, errors.New("專案內尚有樣板，請先移除或刪除樣板"))
		return
	}
	if err := h.projects.Delete(tenantOf(c), pid); err != nil {
		httpError(c, 404, errors.New("專案不存在"))
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *projectHandler) create(c *gin.Context) {
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(c, &req); err != nil {
		httpError(c, 400, err)
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		httpError(c, 400, errors.New("專案名稱不可為空"))
		return
	}
	p, err := h.projects.Create(tenantOf(c), req.Name)
	if err != nil {
		httpInternalError(c, err) // DB 錯誤不洩內部字串
		return
	}
	c.JSON(http.StatusOK, p)
}

// listTemplates 專案內的樣板清單；非成員（非 admin）→ 403，專案不存在 → 404，DB 錯誤 → 500。
func (h *projectHandler) listTemplates(c *gin.Context) {
	pid := c.Param("id")
	if !authorizeProject(c, h.projects, pid) {
		return
	}
	ok, err := h.projects.Exists(tenantOf(c), pid)
	if err != nil {
		httpInternalError(c, err)
		return
	}
	if !ok {
		httpError(c, 404, errors.New("專案不存在"))
		return
	}
	list, err := h.templates.ListInProject(tenantOf(c), pid)
	if err != nil {
		httpInternalError(c, err)
		return
	}
	c.JSON(http.StatusOK, list)
}
