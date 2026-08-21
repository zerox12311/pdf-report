package httpapi

import (
	"strings"
	"testing"
)

// placeholderImages=1：URL 圖片不下載改畫佔位圖——原本會產生下載警告的樣板變成無警告。
func TestRenderPlaceholderImagesParam(t *testing.T) {
	h, _, _, g := newTestServer(t)
	h = asAdmin(t, h, g)

	// 圖片 URL 指向連不上的位址：一般模式會嘗試下載 → 發警告
	body := `{"template":{"name":"p","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},` +
		`"elements":[{"type":"image","id":"i","x":10,"y":10,"width":100,"height":60,"url":"http://127.0.0.1:9/x.png","fit":"contain"}]},"data":{}}`

	rec := doJSON(h, "POST", "/api/templates/render", body)
	if rec.Code != 200 {
		t.Fatalf("一般模式: %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Render-Warnings-Count") == "" {
		t.Error("一般模式應有下載失敗警告")
	}

	rec = doJSON(h, "POST", "/api/templates/render?placeholderImages=1", body)
	if rec.Code != 200 {
		t.Fatalf("佔位圖模式: %d %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("X-Render-Warnings-Count"); got != "" {
		t.Errorf("佔位圖模式不應嘗試下載、不應有警告，got count=%s", got)
	}
	if !strings.HasPrefix(rec.Body.String(), "%PDF") {
		t.Error("回應不是 PDF")
	}
}
