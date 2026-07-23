package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"pdftemplate/internal/db"
	"pdftemplate/internal/engine"
	"pdftemplate/internal/store"
	"pdftemplate/internal/testdb"
)

// newTestServer 建一組乾淨的儲存與引擎（獨立測試 DB + temp 目錄），回傳 handler 與 stores。
func newTestServer(t *testing.T) (http.Handler, *store.TemplateStore, *store.AssetStore, *gorm.DB) {
	t.Helper()
	root := t.TempDir()
	g := testdb.Open(t)
	templates := store.NewTemplateStore(g)
	assets, err := store.NewAssetStore(g, root)
	if err != nil {
		t.Fatal(err)
	}
	fonts, err := store.NewFontStore(g, root)
	if err != nil {
		t.Fatal(err)
	}
	eng := engine.NewEngine("../../fonts", assets.EngineSource()) // 使用 repo 內的字型檔
	eng.SetUserFontsDir(fonts.Dir())
	return New(templates, assets, fonts, eng, ""), templates, assets, g
}

func doJSON(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// errReader 讀取即失敗，用來觸發 body 讀取錯誤分支。
type errReader struct{}

func (errReader) Read([]byte) (int, error) { return 0, errors.New("read boom") }

const minimalTemplate = `{"name":"測試 T","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},"elements":[{"type":"text","id":"t1","x":10,"y":10,"width":100,"height":20,"content":"hi","fontSize":12,"color":"#000000","align":"left","lineHeight":1.2,"bold":false}]}`

func TestTemplateCRUD(t *testing.T) {
	h, _, _, _ := newTestServer(t)

	// 空清單
	rec := doJSON(h, "GET", "/api/templates", "")
	if rec.Code != 200 || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}

	// 建立
	rec = doJSON(h, "POST", "/api/templates", minimalTemplate)
	if rec.Code != 200 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var created map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	id := created["id"].(string)
	if id == "" {
		t.Fatal("no id")
	}

	// 清單有一筆
	rec = doJSON(h, "GET", "/api/templates", "")
	if !strings.Contains(rec.Body.String(), id) {
		t.Fatalf("list should contain %s", id)
	}

	// 讀取
	rec = doJSON(h, "GET", "/api/templates/"+id, "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "測試 T") {
		t.Fatalf("get: %d", rec.Code)
	}

	// 更新
	rec = doJSON(h, "PUT", "/api/templates/"+id, strings.Replace(minimalTemplate, "測試 T", "改名", 1))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "改名") {
		t.Fatalf("put: %d %s", rec.Code, rec.Body.String())
	}

	// 刪除
	rec = doJSON(h, "DELETE", "/api/templates/"+id, "")
	if rec.Code != 204 {
		t.Fatalf("delete: %d", rec.Code)
	}
	rec = doJSON(h, "GET", "/api/templates/"+id, "")
	if rec.Code != 404 {
		t.Fatalf("get after delete: %d", rec.Code)
	}
}

func TestTemplateErrors(t *testing.T) {
	h, _, _, g := newTestServer(t)

	// POST 壞 JSON
	if rec := doJSON(h, "POST", "/api/templates", "{not json"); rec.Code != 400 {
		t.Errorf("bad json create: %d", rec.Code)
	}
	// POST body 讀取錯誤
	req := httptest.NewRequest("POST", "/api/templates", errReader{})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 400 {
		t.Errorf("read error create: %d", rec.Code)
	}
	// PUT 壞 id（safeID 拒絕含 . 的 id）
	if rec := doJSON(h, "PUT", "/api/templates/bad.id", minimalTemplate); rec.Code != 400 {
		t.Errorf("bad id put: %d", rec.Code)
	}
	// PUT 壞 JSON
	if rec := doJSON(h, "PUT", "/api/templates/abc", "{oops"); rec.Code != 400 {
		t.Errorf("bad json put: %d", rec.Code)
	}
	// PUT body 讀取錯誤
	req = httptest.NewRequest("PUT", "/api/templates/abc", errReader{})
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 400 {
		t.Errorf("read error put: %d", rec.Code)
	}
	// GET 不存在
	if rec := doJSON(h, "GET", "/api/templates/nope", ""); rec.Code != 404 {
		t.Errorf("get missing: %d", rec.Code)
	}
	// DELETE 不存在
	if rec := doJSON(h, "DELETE", "/api/templates/nope", ""); rec.Code != 404 {
		t.Errorf("delete missing: %d", rec.Code)
	}
	// List 失敗：關閉 DB 連線 → 500
	if sqlDB, err := g.DB(); err == nil {
		_ = sqlDB.Close()
	}
	if rec := doJSON(h, "GET", "/api/templates", ""); rec.Code != 500 {
		t.Errorf("list error: %d", rec.Code)
	}
}

func TestRenderByID(t *testing.T) {
	h, templates, _, _ := newTestServer(t)
	id, _, err := templates.Save(db.DefaultTenantID, []byte(minimalTemplate), "")
	if err != nil {
		t.Fatal(err)
	}

	// 成功（含 data；名稱含中文覆蓋 urlEncode 非 ASCII 分支）
	rec := doJSON(h, "POST", "/api/templates/"+id+"/render", `{"data":{"x":"1"}}`)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/pdf" {
		t.Fatalf("render: %d %s", rec.Code, rec.Body.String())
	}
	if !bytes.HasPrefix(rec.Body.Bytes(), []byte("%PDF")) {
		t.Fatal("not a pdf")
	}

	// 空 body（readRenderData 的空分支）
	if rec := doJSON(h, "POST", "/api/templates/"+id+"/render", ""); rec.Code != 200 {
		t.Errorf("render empty body: %d", rec.Code)
	}
	// 非 JSON body → 400（避免串接端 bug 靜默印出空值單據）
	if rec := doJSON(h, "POST", "/api/templates/"+id+"/render", "not json"); rec.Code != 400 {
		t.Errorf("render junk body should 400: %d", rec.Code)
	}
	// data 非物件 → 400
	if rec := doJSON(h, "POST", "/api/templates/"+id+"/render", `{"data":123}`); rec.Code != 400 {
		t.Errorf("render data:123 should 400: %d", rec.Code)
	}
	// 404
	if rec := doJSON(h, "POST", "/api/templates/nope/render", "{}"); rec.Code != 404 {
		t.Errorf("render missing: %d", rec.Code)
	}
	// body 讀取錯誤
	req := httptest.NewRequest("POST", "/api/templates/"+id+"/render", errReader{})
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req)
	if rec2.Code != 400 {
		t.Errorf("render read error: %d", rec2.Code)
	}

	// 樣板檔解析失敗（elements 型別錯誤）
	badID, _, err := templates.Save(db.DefaultTenantID, []byte(`{"name":"bad","elements":"not-an-array"}`), "")
	if err != nil {
		t.Fatal(err)
	}
	if rec := doJSON(h, "POST", "/api/templates/"+badID+"/render", "{}"); rec.Code != 500 {
		t.Errorf("render bad template: %d", rec.Code)
	}

	// 引擎渲染失敗（頁首+頁尾吃光內容區）
	failID, _, err := templates.Save(db.DefaultTenantID, []byte(`{"name":"f","page":{"width":595,"height":842,"headerHeight":500,"footerHeight":500},"elements":[]}`), "")
	if err != nil {
		t.Fatal(err)
	}
	if rec := doJSON(h, "POST", "/api/templates/"+failID+"/render", "{}"); rec.Code != 500 {
		t.Errorf("render engine error: %d", rec.Code)
	}
}

func TestRenderWarningsAndStrict(t *testing.T) {
	h, templates, _, _ := newTestServer(t)
	// 樣板有一個綁 who 的欄位；送空 data → 缺 key 警告
	tpl := `{"name":"w","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
		"elements":[{"type":"placeholder","id":"p","x":10,"y":10,"width":100,"height":20,
		"key":"who","sample":"某人","fontSize":12,"color":"#000000","align":"left","lineHeight":1.2,"bold":false}]}`
	id, _, err := templates.Save(db.DefaultTenantID, []byte(tpl), "")
	if err != nil {
		t.Fatal(err)
	}
	// 非 strict：200 + warnings header
	rec := doJSON(h, "POST", "/api/templates/"+id+"/render", `{"data":{}}`)
	if rec.Code != 200 {
		t.Fatalf("render: %d", rec.Code)
	}
	if rec.Header().Get("X-Render-Warnings-Count") != "1" {
		t.Errorf("expected 1 warning, header=%q", rec.Header().Get("X-Render-Warnings-Count"))
	}
	if !strings.Contains(rec.Header().Get("X-Render-Warnings"), "who") {
		t.Errorf("warnings header should mention key: %q", rec.Header().Get("X-Render-Warnings"))
	}
	// strict：422 + warnings JSON
	rec = doJSON(h, "POST", "/api/templates/"+id+"/render?strict=1", `{"data":{}}`)
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), "who") {
		t.Errorf("strict should 422 with warnings: %d %s", rec.Code, rec.Body.String())
	}
	// 資料齊全：無 warning、strict 也 200
	rec = doJSON(h, "POST", "/api/templates/"+id+"/render?strict=1", `{"data":{"who":"客戶"}}`)
	if rec.Code != 200 || rec.Header().Get("X-Render-Warnings-Count") != "" {
		t.Errorf("complete data should be clean: %d %q", rec.Code, rec.Header().Get("X-Render-Warnings-Count"))
	}
}

func TestRenderAdhoc(t *testing.T) {
	h, _, _, _ := newTestServer(t)

	body := `{"template":` + minimalTemplate + `,"data":{"a":"b"}}`
	rec := doJSON(h, "POST", "/api/templates/render", body)
	if rec.Code != 200 || !bytes.HasPrefix(rec.Body.Bytes(), []byte("%PDF")) {
		t.Fatalf("adhoc: %d %s", rec.Code, rec.Body.String())
	}
	// 壞 JSON
	if rec := doJSON(h, "POST", "/api/templates/render", "{nope"); rec.Code != 400 {
		t.Errorf("adhoc bad json: %d", rec.Code)
	}
	// body 讀取錯誤
	req := httptest.NewRequest("POST", "/api/templates/render", errReader{})
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req)
	if rec2.Code != 400 {
		t.Errorf("adhoc read error: %d", rec2.Code)
	}
	// data 非物件 → 400
	if rec := doJSON(h, "POST", "/api/templates/render", `{"template":`+minimalTemplate+`,"data":"oops"}`); rec.Code != 400 {
		t.Errorf("adhoc data string should 400: %d", rec.Code)
	}
	// 引擎失敗
	bad := `{"template":{"name":"f","page":{"width":595,"height":842,"headerHeight":500,"footerHeight":500},"elements":[]}}`
	if rec := doJSON(h, "POST", "/api/templates/render", bad); rec.Code != 500 {
		t.Errorf("adhoc engine error: %d", rec.Code)
	}
}

func pngBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	for i := 0; i < 4; i++ {
		img.Set(i, i, color.NRGBA{R: 255, A: 255})
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func multipartBody(t *testing.T, contentType string, data []byte) (io.Reader, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	hdr := make(map[string][]string)
	hdr["Content-Disposition"] = []string{`form-data; name="file"; filename="a.png"`}
	hdr["Content-Type"] = []string{contentType}
	part, err := mw.CreatePart(hdr)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(data)
	_ = mw.Close()
	return &buf, mw.FormDataContentType()
}

func TestAssets(t *testing.T) {
	h, _, _, _ := newTestServer(t)

	// 上傳成功
	body, ct := multipartBody(t, "image/png", pngBytes(t))
	req := httptest.NewRequest("POST", "/api/assets", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var out map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out["id"] == "" {
		t.Fatal("no asset id")
	}

	// 讀回
	rec = doJSON(h, "GET", "/api/assets/"+out["id"], "")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("get asset: %d", rec.Code)
	}
	// 404
	if rec := doJSON(h, "GET", "/api/assets/nope", ""); rec.Code != 404 {
		t.Errorf("asset missing: %d", rec.Code)
	}
	// 宣告 png 但內容非圖片 → 內容嗅探擋下
	body, ct = multipartBody(t, "image/png", []byte("not-an-image"))
	req = httptest.NewRequest("POST", "/api/assets", body)
	req.Header.Set("Content-Type", ct)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 400 {
		t.Errorf("sniff should reject junk: %d", rec.Code)
	}
	// 非法 content type（內容給真 PNG 讓嗅探通過，走到 Save 的宣告型別檢查）
	body, ct = multipartBody(t, "image/gif", pngBytes(t))
	req = httptest.NewRequest("POST", "/api/assets", body)
	req.Header.Set("Content-Type", ct)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 400 {
		t.Errorf("bad content type: %d", rec.Code)
	}
	// 非 multipart body
	if rec := doJSON(h, "POST", "/api/assets", "junk"); rec.Code != 400 {
		t.Errorf("non multipart: %d", rec.Code)
	}
	// 缺 file 欄位
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("other", "x")
	_ = mw.Close()
	req = httptest.NewRequest("POST", "/api/assets", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 400 {
		t.Errorf("missing file field: %d", rec.Code)
	}
}

func TestHealthzAndCORS(t *testing.T) {
	h, _, _, _ := newTestServer(t)

	rec := doJSON(h, "GET", "/healthz", "")
	if rec.Code != 200 || rec.Body.String() != "ok" {
		t.Fatalf("healthz: %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Error("missing CORS header")
	}

	// OPTIONS preflight
	req := httptest.NewRequest("OPTIONS", "/api/templates", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 204 {
		t.Fatalf("preflight: %d", rec.Code)
	}
}

func TestURLEncode(t *testing.T) {
	if got := urlEncode("報表 a-b_c.1"); got != "%E5%A0%B1%E8%A1%A8%20a-b_c.1" {
		t.Errorf("urlEncode = %q", got)
	}
}

// fontMultipart 建含字型檔的 multipart body（另附 name 欄位）。
func fontMultipart(t *testing.T, name string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", "myfont.ttf")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fw.Write(data)
	if name != "" {
		_ = mw.WriteField("name", name)
	}
	_ = mw.Close()
	return &buf, mw.FormDataContentType()
}

func TestFonts(t *testing.T) {
	h, _, _, g := newTestServer(t)

	// 真 TTF（repo 內字型檔）上傳成功
	ttf, err := os.ReadFile("../../fonts/NotoSansMono-Regular.ttf")
	if err != nil {
		t.Fatal(err)
	}
	body, ct := fontMultipart(t, "我的字型", ttf)
	req := httptest.NewRequest("POST", "/api/fonts", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("upload font: %d %s", rec.Code, rec.Body.String())
	}
	var info map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &info)
	if info["id"] == "" || info["name"] != "我的字型" {
		t.Fatalf("font info: %v", info)
	}

	// 名稱省略 → 用檔名
	body, ct = fontMultipart(t, "", ttf)
	req = httptest.NewRequest("POST", "/api/fonts", body)
	req.Header.Set("Content-Type", ct)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var info2 map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &info2)
	if info2["name"] != "myfont" {
		t.Errorf("default name: %v", info2)
	}

	// 清單
	rec = doJSON(h, "GET", "/api/fonts", "")
	var list []map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if rec.Code != 200 || len(list) != 2 {
		t.Fatalf("list fonts: %d %v", rec.Code, list)
	}

	// 讀回字型檔
	rec = doJSON(h, "GET", "/api/fonts/"+info["id"], "")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "font/ttf" || rec.Body.Len() != len(ttf) {
		t.Fatalf("get font: %d len=%d", rec.Code, rec.Body.Len())
	}
	// 404
	if rec := doJSON(h, "GET", "/api/fonts/nope", ""); rec.Code != 404 {
		t.Errorf("font missing: %d", rec.Code)
	}
	// 內容不是字型 → 400
	body, ct = fontMultipart(t, "x", []byte("not-a-font"))
	req = httptest.NewRequest("POST", "/api/fonts", body)
	req.Header.Set("Content-Type", ct)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 400 {
		t.Errorf("bad font magic: %d", rec.Code)
	}
	// 非 multipart
	if rec := doJSON(h, "POST", "/api/fonts", "junk"); rec.Code != 400 {
		t.Errorf("non multipart: %d", rec.Code)
	}
	// 缺 file 欄位
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("name", "x")
	_ = mw.Close()
	req = httptest.NewRequest("POST", "/api/fonts", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 400 {
		t.Errorf("missing file: %d", rec.Code)
	}

	// List 失敗：關閉 DB → 500（放在渲染測試前會壞其他步驟，這裡最後測）
	defer func() {
		if sqlDB, err := g.DB(); err == nil {
			_ = sqlDB.Close()
		}
		if rec := doJSON(h, "GET", "/api/fonts", ""); rec.Code != 500 {
			t.Errorf("fonts list db error: %d", rec.Code)
		}
	}()

	// 用匯入字型渲染（fontFamily = 字型 id）→ 成功且無警告
	tpl := `{"template":{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	 "elements":[{"type":"text","id":"a","x":40,"y":40,"width":200,"height":20,"content":"custom font","fontSize":14,
	 "fontFamily":"` + info["id"] + `","color":"#000000","align":"left","lineHeight":1.2}]},"data":{}}`
	rec = doJSON(h, "POST", "/api/templates/render", tpl)
	if rec.Code != 200 {
		t.Fatalf("render with custom font: %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Render-Warnings-Count") != "" {
		t.Errorf("unexpected warnings: %s", rec.Header().Get("X-Render-Warnings"))
	}
}

// ---- 補滿輔助函式覆蓋 ----

// templateGetError 的 500 分支：DB 掛掉時 Get 失敗但不是 not-found。
func TestTemplateGetInternalError(t *testing.T) {
	h, templates, _, g := newTestServer(t)
	id, _, err := templates.Save(db.DefaultTenantID, []byte(minimalTemplate), "")
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := g.DB(); err == nil {
		_ = sqlDB.Close()
	}
	if rec := doJSON(h, "GET", "/api/templates/"+id, ""); rec.Code != 500 {
		t.Errorf("db down get should 500: %d", rec.Code)
	}
}

// recoverJSON 的 panic 分支：直接掛一條會 panic 的路由。
func TestRecoverPanic(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(recoverJSON())
	r.GET("/boom", func(c *gin.Context) { panic("boom") })
	rec := doJSON(r, "GET", "/boom", "")
	if rec.Code != 500 || !strings.Contains(rec.Body.String(), "伺服器錯誤") {
		t.Errorf("panic should 500 json: %d %s", rec.Code, rec.Body.String())
	}
}

// extractData 的壞 JSON 防禦分支（正常流程到不了：外層 Unmarshal 會先擋）。
func TestExtractDataJunk(t *testing.T) {
	if extractData([]byte("junk")) != nil {
		t.Error("junk body should extract nil")
	}
}

// TestSPAStaticServing：webRoot 非空時 serve 前端靜態檔＋SPA fallback。
func TestSPAStaticServing(t *testing.T) {
	web := t.TempDir()
	if err := os.WriteFile(filepath.Join(web, "index.html"), []byte("<html>app</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(web, "main.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(web, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	// 只需要一個掛了 NoRoute 的 handler；store 用真 DB 但不觸及
	g := testdb.Open(t)
	root := t.TempDir()
	templates := store.NewTemplateStore(g)
	assets, _ := store.NewAssetStore(g, root)
	fonts, _ := store.NewFontStore(g, root)
	eng := engine.NewEngine("../../fonts", assets.EngineSource())
	srv := New(templates, assets, fonts, eng, web)

	do := func(path string) (int, string) {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		srv.ServeHTTP(w, req)
		return w.Code, w.Body.String()
	}

	// 靜態檔命中
	if code, body := do("/main.js"); code != 200 || !strings.Contains(body, "console.log") {
		t.Errorf("main.js：want 200+內容，got %d %q", code, body)
	}
	// 前端路由（無實體檔）→ SPA fallback index.html
	if code, body := do("/editor/abc"); code != 200 || !strings.Contains(body, "app") {
		t.Errorf("SPA fallback：want 200+index，got %d %q", code, body)
	}
	// 根路徑 → index
	if code, body := do("/"); code != 200 || !strings.Contains(body, "app") {
		t.Errorf("root：want index，got %d %q", code, body)
	}
	// 目錄（非檔案）→ fallback index（不列目錄）
	if code, body := do("/assets"); code != 200 || !strings.Contains(body, "app") {
		t.Errorf("dir：want fallback index，got %d %q", code, body)
	}
	// /api 未匹配 → 404 JSON（不 fallback 到 HTML）
	if code, body := do("/api/nope"); code != 404 || !strings.Contains(body, "error") {
		t.Errorf("api 404：want 404 JSON，got %d %q", code, body)
	}
}
