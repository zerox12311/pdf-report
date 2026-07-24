package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"

	"pdftemplate/internal/db"
)

// 綁 who 欄位、開啟驗證（who 必填字串）的樣板
const validatedTemplate = `{"name":"v","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[{"type":"placeholder","id":"p","x":10,"y":10,"width":100,"height":20,
	"key":"who","sample":"某人","fontSize":12,"color":"#000000","align":"left","lineHeight":1.2,"bold":false}],
	"validation":{"enabled":true,"fields":[{"path":"who","required":true,"type":"string"}]}}`

func TestRenderByIDValidationGuard(t *testing.T) {
	h, templates, _, _ := newTestServer(t)
	id, _, err := templates.Save(db.DefaultTenantID, "", []byte(validatedTemplate), "")
	if err != nil {
		t.Fatal(err)
	}

	// enabled + 不過 → 422，不渲染
	rec := doJSON(h, "POST", "/api/templates/"+id+"/render", `{"data":{}}`)
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), "validationErrors") || !strings.Contains(rec.Body.String(), "who") {
		t.Fatalf("驗證不過應 422+errors：%d %s", rec.Code, rec.Body.String())
	}

	// enabled + 過 → 200 PDF
	rec = doJSON(h, "POST", "/api/templates/"+id+"/render", `{"data":{"who":"客戶"}}`)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/pdf" {
		t.Fatalf("驗證過應 200 PDF：%d %s", rec.Code, rec.Body.String())
	}

	// disabled → 跳過驗證，空 data 也 200（只是渲染警告）
	disabled := strings.Replace(validatedTemplate, `"enabled":true`, `"enabled":false`, 1)
	id2, _, err := templates.Save(db.DefaultTenantID, "", []byte(disabled), "")
	if err != nil {
		t.Fatal(err)
	}
	rec = doJSON(h, "POST", "/api/templates/"+id2+"/render", `{"data":{}}`)
	if rec.Code != 200 {
		t.Fatalf("未啟用驗證應跳過、回 200：%d %s", rec.Code, rec.Body.String())
	}
}

func TestValidateEndpoint(t *testing.T) {
	h, _, _, _ := newTestServer(t)

	// 不過 → ok:false + errors
	rec := doJSON(h, "POST", "/api/validate",
		`{"validation":{"enabled":true,"fields":[{"path":"who","required":true,"type":"string"}]},"data":{}}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"ok":false`) || !strings.Contains(rec.Body.String(), "who") {
		t.Fatalf("驗證不過應 ok:false：%d %s", rec.Code, rec.Body.String())
	}

	// 過 → ok:true + errors:[]
	rec = doJSON(h, "POST", "/api/validate",
		`{"validation":{"enabled":true,"fields":[{"path":"who","required":true,"type":"string"}]},"data":{"who":"客戶"}}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"ok":true`) || !strings.Contains(rec.Body.String(), `"errors":[]`) {
		t.Fatalf("驗證過應 ok:true errors:[]：%d %s", rec.Code, rec.Body.String())
	}

	// 測試區忽略 enabled=false，仍評估規則（數字給成字串 → 不過）
	rec = doJSON(h, "POST", "/api/validate",
		`{"validation":{"enabled":false,"fields":[{"path":"n","required":false,"type":"number"}]},"data":{"n":"48000"}}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"ok":false`) {
		t.Fatalf("測試區應忽略 enabled=false 仍驗：%d %s", rec.Code, rec.Body.String())
	}

	// validation 為 null（沒規則）→ ok:true
	rec = doJSON(h, "POST", "/api/validate", `{"data":{}}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("無規則應 ok:true：%d %s", rec.Code, rec.Body.String())
	}

	// 壞 JSON → 400
	if rec := doJSON(h, "POST", "/api/validate", "{nope"); rec.Code != 400 {
		t.Errorf("壞 JSON 應 400：%d", rec.Code)
	}

	// data 非物件 → 400
	if rec := doJSON(h, "POST", "/api/validate", `{"data":123}`); rec.Code != 400 {
		t.Errorf("data 非物件應 400：%d", rec.Code)
	}

	// body 讀取錯誤 → 400
	req := httptest.NewRequest("POST", "/api/validate", errReader{})
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req)
	if rec2.Code != 400 {
		t.Errorf("body 讀取錯誤應 400：%d", rec2.Code)
	}
}
