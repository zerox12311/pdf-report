package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
)

// 匿名渲染 opt-in：render-by-id 對匿名者的放行完全取決於樣板本體的
// allowAnonymousRender（逐樣板、預設關）。未開與不存在一律 401（同語意，
// 匿名者無從探測樣板存在與否）；且只開 render——樣板本體讀取仍要憑證。
func TestAnonymousRenderOptIn(t *testing.T) {
	h, _, _, g := newTestServer(t)
	admin := asAdmin(t, h, g)

	create := func(body string) string {
		t.Helper()
		rec := doJSON(admin, "POST", "/api/templates", body)
		if rec.Code != 200 {
			t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
		}
		var created map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &created)
		return created["id"].(string)
	}
	opened := create(strings.Replace(minimalTemplate, `{"name":"測試 T"`, `{"name":"開放匿名","allowAnonymousRender":true`, 1))
	locked := create(minimalTemplate)

	// 開啟的樣板：匿名可渲染
	rec := doJSON(h, "POST", "/api/templates/"+opened+"/render", `{"data":{}}`)
	if rec.Code != 200 {
		t.Fatalf("匿名渲染已開放樣板應 200: %d %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/pdf") {
		t.Errorf("content-type 應為 pdf: %s", ct)
	}

	// 未開放：401（不是 403——與不存在同語意）
	if rec := doJSON(h, "POST", "/api/templates/"+locked+"/render", `{"data":{}}`); rec.Code != 401 {
		t.Errorf("匿名渲染未開放樣板應 401: %d", rec.Code)
	}
	// 不存在：同樣 401，不可與未開放區分
	if rec := doJSON(h, "POST", "/api/templates/no-such-id/render", `{"data":{}}`); rec.Code != 401 {
		t.Errorf("匿名渲染不存在樣板應 401: %d", rec.Code)
	}

	// 範圍只在 render：開放匿名渲染的樣板，本體讀取仍要憑證
	if rec := doJSON(h, "GET", "/api/templates/"+opened, ""); rec.Code != 401 {
		t.Errorf("匿名讀樣板本體應 401: %d", rec.Code)
	}
	// adhoc render 不受影響：一律要憑證
	if rec := doJSON(h, "POST", "/api/templates/render", `{"template":`+minimalTemplate+`,"data":{}}`); rec.Code != 401 {
		t.Errorf("匿名 adhoc render 應 401: %d", rec.Code)
	}

	// 帶憑證的一方完全不受開關影響
	if rec := doJSON(admin, "POST", "/api/templates/"+locked+"/render", `{"data":{}}`); rec.Code != 200 {
		t.Errorf("登入者渲染未開放樣板應 200: %d", rec.Code)
	}
}
