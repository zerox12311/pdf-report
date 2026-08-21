package engine

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// prefetchTestDoc 組一份含 n 張動態圖片（list 展開）＋一張壞 URL 的樣板。
func prefetchTestDoc(t *testing.T, srvURL string, n int) (*TemplateDoc, map[string]any) {
	t.Helper()
	doc := `{"name":"t","page":{"size":"A4","width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	 "sections":[{"id":"s","name":"n","kind":"flow","page":null,"headerHeight":0,"footerHeight":0,"watermarkMode":"inherit","watermark":null,
	 "elements":[
	   {"type":"list","id":"L","x":20,"y":20,"width":200,"height":30,"key":"items","gap":0,
	    "children":[{"type":"image","id":"c","x":0,"y":0,"width":40,"height":20,"key":"pic","fit":"contain"}]},
	   {"type":"image","id":"bad","x":300,"y":20,"width":40,"height":20,"url":"` + srvURL + `/missing.png","fit":"contain"}
	 ]}]}`
	var tpl TemplateDoc
	if err := json.Unmarshal([]byte(doc), &tpl); err != nil {
		t.Fatal(err)
	}
	items := make([]any, n)
	for i := range items {
		items[i] = map[string]any{"pic": fmt.Sprintf("%s/img-%d.png", srvURL, i)}
	}
	return &tpl, map[string]any{"items": items}
}

// TestImagePrefetchParallel：多張慢圖平行下載——總時間應接近「最慢一張」而非「Σ各圖」。
// 同時驗證失敗警告仍照 draw 順序發出（好圖在前、壞 URL 警告在後、只發一次）。
func TestImagePrefetchParallel(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	const delay = 150 * time.Millisecond
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "missing") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		time.Sleep(delay) // 模擬慢圖床
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(buf.Bytes())
	}))
	defer srv.Close()

	const n = 6 // ≤ prefetchConcurrency：理想總時長 ≈ 1×delay；逐張同步則 ≈ n×delay
	tpl, data := prefetchTestDoc(t, srv.URL, n)
	e := NewEngine("../../fonts", nil)
	e.SetAllowPrivateImageHosts(true)

	start := time.Now()
	pdf, warns, err := e.Render(tpl, data)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatal(err)
	}
	if len(pdf) == 0 {
		t.Fatal("空 PDF")
	}
	// 門檻取 n×delay 的一半：平行時 ≈1×delay 遠低於此；退化回逐張同步就會超過
	if limit := time.Duration(n) * delay / 2; elapsed >= limit {
		t.Errorf("渲染耗時 %v ≥ %v，圖片下載疑似未平行化", elapsed, limit)
	}
	// 壞 URL 的警告仍要有、且只有這一則（好圖不發警告）
	if len(warns) != 1 || !strings.Contains(warns[0], "missing.png") {
		t.Errorf("警告應恰為 missing.png 的 404 一則，got %v", warns)
	}
}

// TestImagePrefetchDeterminism：同輸入兩次渲染 byte 相同（平行預抓不得破壞決定性）。
func TestImagePrefetchDeterminism(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "missing") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(buf.Bytes())
	}))
	defer srv.Close()

	tpl, data := prefetchTestDoc(t, srv.URL, 5)
	e := NewEngine("../../fonts", nil)
	e.SetAllowPrivateImageHosts(true)
	a, warnsA, err := e.Render(tpl, data)
	if err != nil {
		t.Fatal(err)
	}
	b, warnsB, err := e.Render(tpl, data)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Error("同輸入兩次渲染 byte 不同")
	}
	if fmt.Sprint(warnsA) != fmt.Sprint(warnsB) {
		t.Errorf("警告順序不穩定：%v vs %v", warnsA, warnsB)
	}
}

// TestCollectImageURLs：收集涵蓋頂層/靜態 URL/list 展開/表格儲存格。
func TestCollectImageURLs(t *testing.T) {
	doc := `{"name":"t","page":{"size":"A4","width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	 "elements":[
	   {"type":"image","id":"a","x":0,"y":0,"width":10,"height":10,"key":"logo","fit":"contain"},
	   {"type":"image","id":"b","x":0,"y":20,"width":10,"height":10,"url":"http://x.test/static.png","fit":"contain"},
	   {"type":"list","id":"L","x":0,"y":40,"width":100,"height":20,"key":"items","gap":0,
	    "children":[{"type":"image","id":"c","x":0,"y":0,"width":10,"height":10,"key":"pic","fit":"contain"}]},
	   {"type":"table","id":"T","x":0,"y":80,"width":100,"height":20,"rows":1,"cols":1,
	    "columnWidths":[100],"rowHeights":[20],
	    "cells":[[{"kind":"image","url":"http://x.test/cell.png","value":"","key":"","sample":"","align":"left","bold":false}]]}
	 ]}`
	var tpl TemplateDoc
	if err := json.Unmarshal([]byte(doc), &tpl); err != nil {
		t.Fatal(err)
	}
	data := map[string]any{
		"logo":  "http://x.test/logo.png",
		"items": []any{map[string]any{"pic": "http://x.test/p1.png"}, map[string]any{"pic": "http://x.test/p2.png"}},
	}
	l, err := newLayout(&tpl, data)
	if err != nil {
		t.Fatal(err)
	}
	got := collectImageURLs([]*layout{l})
	want := []string{"http://x.test/logo.png", "http://x.test/static.png", "http://x.test/p1.png", "http://x.test/p2.png", "http://x.test/cell.png"}
	gotSet := map[string]bool{}
	for _, u := range got {
		gotSet[u] = true
	}
	for _, w := range want {
		if !gotSet[w] {
			t.Errorf("缺 %s（got %v）", w, got)
		}
	}
}

// TestPlaceholderImages：佔位圖模式完全不發任何 HTTP 請求、無下載類警告、輸出確定。
func TestPlaceholderImages(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	tpl, data := prefetchTestDoc(t, srv.URL, 3)
	e := NewEngine("../../fonts", nil)
	e.SetAllowPrivateImageHosts(true)
	opts := RenderOptions{PlaceholderImages: true}
	a, warns, err := e.RenderWithOptions(tpl, data, opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(a) == 0 {
		t.Fatal("空 PDF")
	}
	if got := atomic.LoadInt32(&hits); got != 0 {
		t.Errorf("佔位圖模式不應發出任何圖片請求，got %d", got)
	}
	if len(warns) != 0 {
		t.Errorf("佔位圖模式不應有下載類警告：%v", warns)
	}
	b, _, err := e.RenderWithOptions(tpl, data, opts)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Error("佔位圖模式兩次渲染 byte 不同")
	}
}
