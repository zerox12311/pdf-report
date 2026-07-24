package httpapi

import (
	"errors"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/db"
	"pdftemplate/internal/store"
)

// templateHandler 樣板 CRUD（raw JSON passthrough，不走 gin binding）。
// 授權：所有會碰樣板的方法都先解析出有效 projectID，再過 authorizeProject chokepoint。
type templateHandler struct {
	store    *store.TemplateStore
	projects *store.ProjectStore
}

func (h *templateHandler) list(c *gin.Context) {
	var (
		list []store.TemplateSummary
		err  error
	)
	// user 角色：只列可存取專案的樣板；admin / 無 session（iframe）：全部。
	if uid := userOf(c); uid != "" && !isAdmin(c) {
		pids, e := h.projects.MemberProjectIDs(uid)
		if e != nil {
			httpInternalError(c, e)
			return
		}
		list, err = h.store.ListInProjects(tenantOf(c), pids)
	} else {
		list, err = h.store.List(tenantOf(c))
	}
	if err != nil {
		httpInternalError(c, err)
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *templateHandler) create(c *gin.Context) {
	raw, err := readBody(c, maxUpload)
	if err != nil {
		httpError(c, 400, err)
		return
	}
	// 控制台在專案內建立樣板時帶 ?projectId；帶了就必須是本租戶的專案。
	// 未帶（iframe / 舊流程）→ 落預設專案。
	projectID := c.Query("projectId")
	if projectID != "" {
		ok, err := h.projects.Exists(tenantOf(c), projectID)
		if err != nil {
			httpInternalError(c, err)
			return
		}
		if !ok {
			httpError(c, 400, errors.New("專案不存在"))
			return
		}
	}
	// 有效落點：帶了 → 該專案；沒帶 → 預設專案。授權針對這個落點。
	effective := projectID
	if effective == "" {
		effective = db.DefaultProjectID
	}
	if !authorizeProject(c, h.projects, effective) {
		return
	}
	_, out, err := h.store.Save(tenantOf(c), projectID, raw, "")
	if err != nil {
		httpError(c, 400, err)
		return
	}
	writeRawJSON(c, out)
}

func (h *templateHandler) get(c *gin.Context) {
	id := c.Param("id")
	pid, err := h.store.ProjectOf(tenantOf(c), id)
	if err != nil {
		templateGetError(c, err) // 不存在 → 404
		return
	}
	if !authorizeProject(c, h.projects, pid) {
		return
	}
	raw, err := h.store.Get(tenantOf(c), id)
	if err != nil {
		templateGetError(c, err)
		return
	}
	writeRawJSON(c, raw)
}

func (h *templateHandler) update(c *gin.Context) {
	raw, err := readBody(c, maxUpload)
	if err != nil {
		httpError(c, 400, err)
		return
	}
	id := c.Param("id")
	if !store.SafeID(id) {
		httpError(c, 400, errors.New("id 不合法"))
		return
	}
	// 有效落點：既有樣板 → 其專案；不存在（PUT 會建到預設專案）→ 預設專案。
	pid, err := h.store.ProjectOf(tenantOf(c), id)
	if errors.Is(err, os.ErrNotExist) {
		pid = db.DefaultProjectID
	} else if err != nil {
		httpInternalError(c, err)
		return
	}
	if !authorizeProject(c, h.projects, pid) {
		return
	}
	// 更新既有樣板不改專案歸屬（Save 只在建立時寫 projectID）。
	_, out, err := h.store.Save(tenantOf(c), "", raw, id)
	if err != nil {
		httpError(c, 400, err)
		return
	}
	writeRawJSON(c, out)
}

func (h *templateHandler) remove(c *gin.Context) {
	id := c.Param("id")
	pid, err := h.store.ProjectOf(tenantOf(c), id)
	if err != nil {
		httpError(c, 404, errors.New("樣板不存在"))
		return
	}
	if !authorizeProject(c, h.projects, pid) {
		return
	}
	if err := h.store.Delete(tenantOf(c), id); err != nil {
		httpError(c, 404, errors.New("樣板不存在"))
		return
	}
	c.Status(http.StatusNoContent)
}
