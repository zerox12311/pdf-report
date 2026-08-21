package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// corsHandler 只掛 cors middleware 的最小 router，用來單測白名單邏輯。
func corsHandler(origins []string) http.Handler {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(cors(origins))
	r.GET("/x", func(c *gin.Context) { c.String(http.StatusOK, "ok") })
	return r
}

func corsGet(h http.Handler, method, origin string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/x", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestCORSDefaultSameOriginOnly(t *testing.T) {
	h := corsHandler(nil)
	rec := corsGet(h, http.MethodGet, "https://evil.test")
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("預設應不送 CORS header，got %q", got)
	}
	// preflight 也不能帶出 allow headers
	rec = corsGet(h, http.MethodOptions, "https://evil.test")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight code=%d", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Methods") != "" {
		t.Fatal("未設白名單的 preflight 不應帶 Allow-Methods")
	}
}

func TestCORSAllowAll(t *testing.T) {
	h := corsHandler([]string{"*"})
	rec := corsGet(h, http.MethodGet, "https://anywhere.test")
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("allow-all 應回 *，got %q", got)
	}
	if rec.Header().Get("Access-Control-Expose-Headers") == "" {
		t.Fatal("應帶 Expose-Headers")
	}
}

func TestCORSAllowlist(t *testing.T) {
	h := corsHandler([]string{" https://host.example/ ", "https://other.example"})

	// 命中（大小寫不敏感、尾斜線正規化）
	rec := corsGet(h, http.MethodGet, "https://HOST.example")
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://HOST.example" {
		t.Fatalf("命中白名單應回原 Origin，got %q", got)
	}
	if rec.Header().Get("Vary") != "Origin" {
		t.Fatal("白名單回應應帶 Vary: Origin")
	}

	// 未命中
	rec = corsGet(h, http.MethodGet, "https://evil.test")
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("未命中不應送 CORS header，got %q", got)
	}

	// 無 Origin 的一般請求（同源/curl）不受影響
	rec = corsGet(h, http.MethodGet, "")
	if rec.Code != http.StatusOK || rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("無 Origin 請求異常：code=%d", rec.Code)
	}

	// 命中白名單的 preflight
	rec = corsGet(h, http.MethodOptions, "https://other.example")
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Fatalf("白名單 preflight 應 204＋Allow-Methods，code=%d", rec.Code)
	}
}

// New 帶 corsOrigins 的整合驗證：白名單作用於實際路由。
func TestNewWithCORSOrigins(t *testing.T) {
	srv, _, _, _ := newTestServerCORS(t, []string{"https://host.example"})
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "https://host.example")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://host.example" {
		t.Fatalf("got %q", got)
	}
}
