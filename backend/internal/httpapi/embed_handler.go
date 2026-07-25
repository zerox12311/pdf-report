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

// context 回目前憑證的嵌入模式與能力，供前端畫 UI。
// 前端與後端讀**同一份**解析結果（capabilitiesOf），UI 與強制不會漂移。
// 非 embed 身分（控制台 session／宿主後端 API key）→ 視同 design（完整能力）。
func (h *embedHandler) context(c *gin.Context) {
	p := principalOf(c)
	mode := modeDesign
	if p.kind == principalEmbed {
		mode = normalizeMode(p.mode)
	}
	c.JSON(http.StatusOK, gin.H{
		"kind":         p.kind,
		"mode":         mode,
		"templateId":   p.templateID, // embed 才有值
		"capabilities": capabilitiesOf(mode),
	})
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
		// Mode 權限模式（design|fill|view）；未帶或不認得 → design。
		// 這是宿主「後端」的政策決定，故只在此端點（需 API key）接受。
		Mode string `json:"mode"`
	}
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &req); err != nil {
			httpError(c, 400, errors.New("請求格式錯誤（需為 JSON）"))
			return
		}
	}

	// mode 明確傳了就必須是合法值（大小寫敏感）。不做寬容解析——否則宿主把
	// "Fill"／"readonly" 這種拼錯的值送進來，卻默默拿到 design（最高權限）。
	if req.Mode != "" && !validMode(req.Mode) {
		httpError(c, 400, errors.New(`mode 不合法（可用：design｜fill｜view）`))
		return
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

	mode := normalizeMode(req.Mode)
	token, exp, err := signEmbedToken(h.secret, p.tenantID, p.projectID, templateID, mode)
	if err != nil {
		httpInternalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"templateId": templateID,
		"mode":       mode,
		"expiresAt":  exp.UTC().Format(time.RFC3339),
	})
}
