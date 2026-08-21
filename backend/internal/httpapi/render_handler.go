package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/engine"
	"pdftemplate/internal/store"
	"pdftemplate/internal/validate"
)

// renderHandler 渲染：正式（樣板 id + 資料）與 adhoc（編輯器預覽）。
type renderHandler struct {
	store    *store.TemplateStore
	projects *store.ProjectStore
	eng      *engine.Engine
}

// renderByID 正式渲染：宿主系統後端拿樣板 id + 資料 → PDF（整合契約）。
// 授權：控制台 user 只能渲染自己專案的樣板；無 session（宿主呼叫）維持開放。
func (h *renderHandler) renderByID(c *gin.Context) {
	id := c.Param("id")
	pid, err := h.store.ProjectOf(tenantOf(c), id)
	if err != nil {
		templateGetError(c, err)
		return
	}
	// 匿名請求已由 requireAnyOrAnonymousRender 依樣板的 allowAnonymousRender 放行
	if principalKind(c) != "" && !authorizeTemplate(c, h.projects, pid, id) {
		return
	}
	raw, err := h.store.Get(tenantOf(c), c.Param("id"))
	if err != nil {
		templateGetError(c, err)
		return
	}
	var doc engine.TemplateDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		httpError(c, 500, fmt.Errorf("樣板解析失敗: %w", err))
		return
	}
	data, err := readRenderData(c)
	if err != nil {
		httpError(c, 400, err)
		return
	}
	// 輸入驗證守門：樣板開啟驗證時，資料不過直接 422、不進渲染（財務單據的硬要求）。
	// Validate 內部會判 Enabled；未開啟/無規則時回 nil，等同跳過。
	if errs := validate.Validate(data, doc.Validation); len(errs) > 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error":            "輸入資料驗證未通過",
			"validationErrors": errs,
		})
		return
	}
	h.renderPDF(c, &doc, data)
}

// renderAdhoc 未儲存樣板直接渲染（編輯器預覽用）。
func (h *renderHandler) renderAdhoc(c *gin.Context) {
	body, err := readBody(c, maxUpload)
	if err != nil {
		httpError(c, 400, err)
		return
	}
	var req struct {
		Template engine.TemplateDoc `json:"template"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		httpError(c, 400, errors.New("request 解析失敗（body 需為 JSON 物件，含 template 欄位）"))
		return
	}
	data, err := validateData(extractData(body))
	if err != nil {
		httpError(c, 400, err)
		return
	}
	h.renderPDF(c, &req.Template, data)
}

// renderPDF 渲染並回應。
// 資料問題（找不到 key 等）以 X-Render-Warnings-Count / X-Render-Warnings（percent-encoded JSON）回報；
// query 帶 strict=1 時，有任何 warning 直接回 422 JSON（正式文件建議串接時開啟）。
// query 帶 placeholderImages=1 時，URL 圖片不下載、改畫佔位圖（版面快速預覽用）。
func (h *renderHandler) renderPDF(c *gin.Context, doc *engine.TemplateDoc, data any) {
	opts := engine.RenderOptions{PlaceholderImages: c.Query("placeholderImages") == "1"}
	pdf, warnings, err := h.eng.RenderWithOptions(doc, data, opts)
	if err != nil {
		httpError(c, 500, fmt.Errorf("渲染失敗: %w", err))
		return
	}
	if len(warnings) > 0 {
		if c.Query("strict") == "1" {
			c.JSON(422, gin.H{
				"error":    "渲染資料不完整（strict 模式）",
				"warnings": warnings,
			})
			return
		}
		wj, _ := json.Marshal(warnings)
		c.Header("X-Render-Warnings-Count", fmt.Sprint(len(warnings)))
		c.Header("X-Render-Warnings", urlEncode(string(wj)))
	}
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename*=UTF-8''%s.pdf", urlEncode(doc.Name)))
	c.Data(http.StatusOK, "application/pdf", pdf)
}

// readRenderData 解析 {"data": ...}，數字用 json.Number 保留原始字面。
// 空 body = 無資料（合法）；壞 JSON 或 data 非物件 → 錯誤（避免靜默印出空值單據）。
func readRenderData(c *gin.Context) (any, error) {
	body, err := readBody(c, maxUpload)
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return nil, nil
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var wrapper map[string]any
	if err := dec.Decode(&wrapper); err != nil {
		return nil, errors.New("request JSON 解析失敗（body 需為 JSON 物件，如 {\"data\":{…}}）")
	}
	return validateData(wrapper["data"])
}

// validateData data 必須是物件或 null——其他型別（數字/字串/陣列）必然是串接端的 bug，直接拒絕。
func validateData(data any) (any, error) {
	if data == nil {
		return nil, nil
	}
	if _, ok := data.(map[string]any); !ok {
		return nil, errors.New("data 必須是 JSON 物件")
	}
	return data, nil
}

func extractData(body []byte) any {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var wrapper map[string]any
	if err := dec.Decode(&wrapper); err != nil {
		return nil
	}
	return wrapper["data"]
}
