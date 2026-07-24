package engine

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestImageURLSSRFGuard：圖片 URL 抓取預設擋私有/loopback（SSRF 防護），放行旗標可解除。
func TestImageURLSSRFGuard(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(buf.Bytes())
	}))
	defer srv.Close()

	doc := `{"name":"t","page":{"size":"A4","width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	 "sections":[{"id":"s","name":"n","kind":"flow","page":null,"headerHeight":0,"footerHeight":0,"watermarkMode":"inherit","watermark":null,
	 "elements":[{"type":"image","id":"i","x":40,"y":40,"width":100,"height":60,"url":"` + srv.URL + `/img.png","fit":"contain"}]}]}`
	var tpl TemplateDoc
	if err := json.Unmarshal([]byte(doc), &tpl); err != nil {
		t.Fatal(err)
	}

	// 預設（擋私有）：httptest 在 loopback → 被擋、發警告、不 fetch
	_, warns, err := NewEngine("../../fonts", nil).Render(&tpl, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(warns) == 0 {
		t.Error("SSRF guard 應擋掉 loopback 圖片 URL 並發警告")
	}

	// 放行旗標：抓得到 → 無警告
	eAllow := NewEngine("../../fonts", nil)
	eAllow.SetAllowPrivateImageHosts(true)
	_, warns2, err := eAllow.Render(&tpl, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(warns2) != 0 {
		t.Errorf("放行時不應有警告：%v", warns2)
	}
}

// isBlockedImageIP 覆蓋：常見內網/link-local/metadata 段皆擋，公網放行。
func TestIsBlockedImageIP(t *testing.T) {
	blocked := []string{"127.0.0.1", "::1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "0.0.0.0", "fe80::1", "fc00::1"}
	for _, s := range blocked {
		if !isBlockedImageIP(net.ParseIP(s)) {
			t.Errorf("%s 應被擋", s)
		}
	}
	allowed := []string{"8.8.8.8", "1.1.1.1", "203.0.113.10"}
	for _, s := range allowed {
		if isBlockedImageIP(net.ParseIP(s)) {
			t.Errorf("%s 不應被擋", s)
		}
	}
}
