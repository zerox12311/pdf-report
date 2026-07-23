package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/engine"
	"pdftemplate/internal/validate"
)

// validateHandler：編輯器「測試 schema」用——拿當前（可能未存）的 validation 規則 + 一段 data
// 直接驗證、不渲染。與 renderByID 的守門共用同一個 validate.Validate（唯一權威），
// 保證「測試說過」= 「實際 render 會過」。
type validateHandler struct{}

// check POST /api/validate  body {"validation": {...}, "data": {...}} → {"ok":bool,"errors":[...]}
// 不理會 validation.enabled（測試就是要跑這組規則），一律評估欄位。
func (h *validateHandler) check(c *gin.Context) {
	body, err := readBody(c, maxUpload)
	if err != nil {
		httpError(c, http.StatusBadRequest, err)
		return
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var req struct {
		Validation *engine.ValidationSpec `json:"validation"`
		Data       any                    `json:"data"`
	}
	if err := dec.Decode(&req); err != nil {
		httpError(c, http.StatusBadRequest, errors.New("request 解析失敗（body 需為 JSON，含 validation 與 data）"))
		return
	}
	data, err := validateData(req.Data)
	if err != nil {
		httpError(c, http.StatusBadRequest, err)
		return
	}
	// 強制當作已啟用：測試區要能在總開關關閉時也驗這組規則。
	spec := req.Validation
	if spec != nil {
		s := *spec
		s.Enabled = true
		spec = &s
	}
	errs := validate.Validate(data, spec)
	if errs == nil {
		errs = []validate.Error{}
	}
	c.JSON(http.StatusOK, gin.H{"ok": len(errs) == 0, "errors": errs})
}
