package engine

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// WebP 圖片 URL：引擎解碼轉 PNG 進渲染管線（實務圖床常見 webp、gopdf 不吃）。
// 抓得到且轉檔成功 → 無警告；非圖片內容照樣被擋。
func TestImageURLWebP(t *testing.T) {
	webpBytes, err := os.ReadFile("testdata/sample.webp")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/img.webp" {
			w.Header().Set("Content-Type", "image/webp")
			_, _ = w.Write(webpBytes)
			return
		}
		_, _ = w.Write([]byte("not an image"))
	}))
	defer srv.Close()

	docFor := func(path string) *TemplateDoc {
		doc := `{"name":"t","page":{"size":"A4","width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
		 "sections":[{"id":"s","name":"n","kind":"flow","page":null,"headerHeight":0,"footerHeight":0,"watermarkMode":"inherit","watermark":null,
		 "elements":[{"type":"image","id":"i","x":40,"y":40,"width":100,"height":60,"url":"` + srv.URL + path + `","fit":"contain"}]}]}`
		var tpl TemplateDoc
		if err := json.Unmarshal([]byte(doc), &tpl); err != nil {
			t.Fatal(err)
		}
		return &tpl
	}

	e := NewEngine("../../fonts", nil)
	e.SetAllowPrivateImageHosts(true)
	pdf, warns, err := e.Render(docFor("/img.webp"), map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(warns) != 0 {
		t.Errorf("webp 應轉檔成功、無警告：%v", warns)
	}
	if len(pdf) == 0 {
		t.Error("應產出 PDF")
	}

	// 非圖片內容仍被擋（警告內容含 WebP 字樣的新訊息）
	e2 := NewEngine("../../fonts", nil)
	e2.SetAllowPrivateImageHosts(true)
	_, warns2, err := e2.Render(docFor("/junk.txt"), map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(warns2) == 0 {
		t.Error("非圖片內容應發警告")
	}
}
