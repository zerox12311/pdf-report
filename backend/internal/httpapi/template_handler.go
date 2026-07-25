package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/db"
	"pdftemplate/internal/store"
)

// templateHandler 樣板 CRUD（raw JSON passthrough，不走 gin binding）。
// 授權：所有會碰樣板的方法都先解析出有效 projectID／templateID，再過 authorizeTemplate/authorizeCreateInProject。
type templateHandler struct {
	store    *store.TemplateStore
	projects *store.ProjectStore
}

func (h *templateHandler) list(c *gin.Context) {
	var (
		list []store.TemplateSummary
		err  error
	)
	switch principalKind(c) {
	case principalUser:
		if isAdmin(c) {
			list, err = h.store.List(tenantOf(c))
		} else {
			pids, e := h.projects.MemberProjectIDs(userOf(c))
			if e != nil {
				httpInternalError(c, e)
				return
			}
			list, err = h.store.ListInProjects(tenantOf(c), pids)
		}
	case principalAPIKey:
		list, err = h.store.ListInProject(tenantOf(c), principalOf(c).projectID)
	default: // embed token 鎖單張、不能列
		httpError(c, http.StatusForbidden, errors.New("沒有列出樣板的權限"))
		return
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
	// 有效落點：帶 ?projectId → 該專案；沒帶 → apikey 落自己綁的專案、user 落預設專案。
	projectID := c.Query("projectId")
	if projectID == "" {
		if principalKind(c) == principalAPIKey {
			projectID = principalOf(c).projectID
		} else {
			projectID = db.DefaultProjectID
		}
	}
	ok, err := h.projects.Exists(tenantOf(c), projectID)
	if err != nil {
		httpInternalError(c, err)
		return
	}
	if !ok {
		httpError(c, 400, errors.New("專案不存在"))
		return
	}
	if !authorizeCreateInProject(c, h.projects, projectID) {
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
	if !authorizeTemplate(c, h.projects, pid, id) {
		return
	}
	raw, err := h.store.Get(tenantOf(c), id)
	if err != nil {
		templateGetError(c, err)
		return
	}
	// 樣板所屬專案（DB metadata，不放進 raw body）；編輯器「返回」用它回到該專案。
	c.Header("X-Project-Id", pid)
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
	// 既有樣板 → 其專案；不存在（PUT 會建到預設專案）→ 預設專案。
	pid, err := h.store.ProjectOf(tenantOf(c), id)
	if errors.Is(err, os.ErrNotExist) {
		pid = db.DefaultProjectID
	} else if err != nil {
		httpInternalError(c, err)
		return
	}
	if !authorizeTemplate(c, h.projects, pid, id) {
		return
	}
	// 更新既有樣板不改專案歸屬（Save 只在建立時寫 projectID）。
	_, out, err := h.store.Save(tenantOf(c), "", raw, id)
	switch {
	case err == nil:
		writeRawJSON(c, out)
	case errors.Is(err, store.ErrLocked):
		httpError(c, http.StatusConflict, err) // 有人正在填值，等鎖逾時
	default:
		httpError(c, 400, err)
	}
}

// patchValues 填寫模式的窄介面：body `{"values":{"<elementId>":"新值","<tableId>#2,3":"新值"}}`。
// 讀出 DB 原件、只覆寫被標記 fillable 的 text 元素 content／text 儲存格 value，其餘結構原地不動。
// 需 capEditValues（router 掛 requireCapability）。
func (h *templateHandler) patchValues(c *gin.Context) {
	raw, err := readBody(c, maxUpload)
	if err != nil {
		httpError(c, 400, err)
		return
	}
	var req struct {
		Values map[string]string `json:"values"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		httpError(c, 400, errors.New("請求格式錯誤（需為 JSON）"))
		return
	}
	if len(req.Values) == 0 {
		httpError(c, 400, errors.New("values 不可為空"))
		return
	}

	id := c.Param("id")
	pid, err := h.store.ProjectOf(tenantOf(c), id)
	if err != nil {
		templateGetError(c, err) // 不存在 → 404
		return
	}
	if !authorizeTemplate(c, h.projects, pid, id) {
		return
	}

	// 讀取→套用→寫回全在同一交易＋列鎖內（PatchDoc）：否則設計者的 PUT 落在讀與寫之間
	// 會被整份覆寫回捲，連「剛撤銷的 fillable」都會被還原。
	saved, err := h.store.PatchDoc(tenantOf(c), id, func(doc map[string]any) error {
		return applyValues(doc, req.Values)
	})
	switch {
	case err == nil:
		writeRawJSON(c, saved)
	case errors.Is(err, errValueNotFillable):
		httpError(c, http.StatusForbidden, err) // 未開放修改
	case errors.Is(err, errValueTargetNotFound), errors.Is(err, errValueHasBinding):
		httpError(c, 400, err) // 找不到欄位／定址錯／含綁定語法
	case errors.Is(err, store.ErrLocked):
		httpError(c, http.StatusConflict, err) // 同一張樣板另有寫入中，等鎖逾時
	case errors.Is(err, os.ErrNotExist):
		templateGetError(c, err) // 樣板在交易內消失
	default:
		httpInternalError(c, err)
	}
}

func (h *templateHandler) remove(c *gin.Context) {
	id := c.Param("id")
	pid, err := h.store.ProjectOf(tenantOf(c), id)
	if err != nil {
		httpError(c, 404, errors.New("樣板不存在"))
		return
	}
	if !authorizeTemplate(c, h.projects, pid, id) {
		return
	}
	if err := h.store.Delete(tenantOf(c), id); err != nil {
		httpError(c, 404, errors.New("樣板不存在"))
		return
	}
	c.Status(http.StatusNoContent)
}
