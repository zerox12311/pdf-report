package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/store"
)

// emptyTemplateJSON 空白樣板（鏡像前端 emptyTemplate()）；「建空的＋換 token」便利捷徑用。
// A4 = 595.28×841.89pt，Word 標準邊界 72pt。前端載入時 normalizeTemplate 會補其餘預設。
const emptyTemplateJSON = `{"name":"未命名樣板","version":1,` +
	`"page":{"size":"A4","orientation":"portrait","width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0,"marginTop":72,"marginRight":72,"marginBottom":72,"marginLeft":72},` +
	`"sections":[{"id":"s1","name":"內頁","kind":"flow","page":null,"headerHeight":0,"footerHeight":0,"watermarkMode":"inherit","watermark":null,"elements":[]}],` +
	`"validation":{"enabled":false,"fields":[]}}`

// embedHandler 簽發短效 embed token（宿主後端用 project API key 打；requireAPIKey）。
type embedHandler struct {
	templates *store.TemplateStore
	secret    string
}

// mint：body `{templateId}` 換既有那張／`{}`(或空 body) 便利捷徑「在 key 的專案建空的＋回 token」。
func (h *embedHandler) mint(c *gin.Context) {
	p := principalOf(c) // 必為 apikey（requireAPIKey 已擋）

	raw, err := readBody(c, maxUpload)
	if err != nil {
		httpError(c, 400, err)
		return
	}
	var req struct {
		TemplateID string `json:"templateId"`
	}
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &req); err != nil {
			httpError(c, 400, errors.New("請求格式錯誤（需為 JSON）"))
			return
		}
	}

	templateID := req.TemplateID
	if templateID == "" {
		// 便利捷徑：在 key 綁的專案建一張空樣板
		id, _, err := h.templates.Save(p.tenantID, p.projectID, []byte(emptyTemplateJSON), "")
		if err != nil {
			httpInternalError(c, err)
			return
		}
		templateID = id
	} else {
		// 指定既有樣板：必須屬於 key 綁的專案
		proj, err := h.templates.ProjectOf(p.tenantID, templateID)
		if errors.Is(err, os.ErrNotExist) {
			httpError(c, 404, errors.New("樣板不存在"))
			return
		}
		if err != nil {
			httpInternalError(c, err)
			return
		}
		if proj != p.projectID {
			httpError(c, http.StatusForbidden, errors.New("樣板不屬於此金鑰的專案"))
			return
		}
	}

	token, exp, err := signEmbedToken(h.secret, p.tenantID, p.projectID, templateID)
	if err != nil {
		httpInternalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"templateId": templateID,
		"expiresAt":  exp.UTC().Format(time.RFC3339),
	})
}
