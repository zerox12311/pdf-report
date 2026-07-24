package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gorm.io/gorm"

	"pdftemplate/internal/db"
	"pdftemplate/internal/engine"
	"pdftemplate/internal/store"
	"pdftemplate/internal/testdb"
)

func mustUnmarshal(t *testing.T, data []byte, dst any) {
	t.Helper()
	if err := json.Unmarshal(data, dst); err != nil {
		t.Fatalf("unmarshal: %v (%s)", err, string(data))
	}
}

// seedUser 在測試 DB 種一個 admin 使用者（多數控制台測試需要管理權限）。
func seedUser(t *testing.T, g *gorm.DB, username, password string) {
	t.Helper()
	seedRole(t, g, username, password, db.RoleAdmin)
}

// seedRole 種指定角色的使用者，回傳 id（角色/授權測試用）。
func seedRole(t *testing.T, g *gorm.DB, username, password, role string) string {
	t.Helper()
	u, err := store.NewUserStore(g).Create(db.DefaultTenantID, username, password, role)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return u.ID
}

// loginAs 登入並回傳 session cookies。
func loginAs(t *testing.T, h http.Handler, username, password string) []*http.Cookie {
	t.Helper()
	rec := doJSON(h, "POST", "/api/auth/login", fmt.Sprintf(`{"username":%q,"password":%q}`, username, password))
	if rec.Code != 200 {
		t.Fatalf("login want 200, got %d %s", rec.Code, rec.Body.String())
	}
	ck := rec.Result().Cookies()
	if len(ck) == 0 {
		t.Fatal("login: 未收到 session cookie")
	}
	return ck
}

// doAuth 帶著 cookies 發請求。
func doAuth(h http.Handler, method, path, body string, cookies []*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for _, ck := range cookies {
		req.AddCookie(ck)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestAuthLogin(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")

	// 成功
	rec := doJSON(h, "POST", "/api/auth/login", `{"username":"admin","password":"secret"}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "admin") {
		t.Fatalf("login ok: %d %s", rec.Code, rec.Body.String())
	}
	if len(rec.Result().Cookies()) == 0 {
		t.Fatal("login 未設 cookie")
	}

	// 密碼錯 → 401
	if rec := doJSON(h, "POST", "/api/auth/login", `{"username":"admin","password":"wrong"}`); rec.Code != 401 {
		t.Errorf("wrong pw: %d", rec.Code)
	}
	// 帳號不存在 → 401（同訊息）
	if rec := doJSON(h, "POST", "/api/auth/login", `{"username":"ghost","password":"secret"}`); rec.Code != 401 {
		t.Errorf("no user: %d", rec.Code)
	}
	// 壞 JSON → 400
	if rec := doJSON(h, "POST", "/api/auth/login", "{oops"); rec.Code != 400 {
		t.Errorf("bad json: %d", rec.Code)
	}
	// body 讀取錯誤 → 400
	req := httptest.NewRequest("POST", "/api/auth/login", errReader{})
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req)
	if rec2.Code != 400 {
		t.Errorf("read err: %d", rec2.Code)
	}
}

func TestAuthMeAndLogout(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")

	// 未登入 → 401
	if rec := doJSON(h, "GET", "/api/auth/me", ""); rec.Code != 401 {
		t.Errorf("me no auth: %d", rec.Code)
	}

	ck := loginAs(t, h, "admin", "secret")
	// 登入後 me → 200
	if rec := doAuth(h, "GET", "/api/auth/me", "", ck); rec.Code != 200 || !strings.Contains(rec.Body.String(), "admin") {
		t.Fatalf("me authed: %d %s", rec.Code, rec.Body.String())
	}

	// 登出 → 204，之後 me → 401
	if rec := doAuth(h, "POST", "/api/auth/logout", "", ck); rec.Code != 204 {
		t.Errorf("logout: %d", rec.Code)
	}
	logoutCk := func() []*http.Cookie {
		rec := doAuth(h, "POST", "/api/auth/logout", "", ck)
		return rec.Result().Cookies()
	}()
	if rec := doAuth(h, "GET", "/api/auth/me", "", logoutCk); rec.Code != 401 {
		t.Errorf("me after logout: %d", rec.Code)
	}
}

// me：session 有效但使用者已被刪 → 401。
func TestAuthMeUserGone(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")
	if err := g.Where("username = ?", "admin").Delete(&db.User{}).Error; err != nil {
		t.Fatal(err)
	}
	if rec := doAuth(h, "GET", "/api/auth/me", "", ck); rec.Code != 401 {
		t.Errorf("me user gone: %d", rec.Code)
	}
}

func TestChangePassword(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")

	// 未登入 → 401（requireAuth）
	if rec := doJSON(h, "POST", "/api/auth/change-password", `{"oldPassword":"secret","newPassword":"newpass"}`); rec.Code != 401 {
		t.Errorf("change no auth: %d", rec.Code)
	}

	ck := loginAs(t, h, "admin", "secret")
	// 壞 JSON → 400
	if rec := doAuth(h, "POST", "/api/auth/change-password", "{oops", ck); rec.Code != 400 {
		t.Errorf("change bad json: %d", rec.Code)
	}
	// 新密碼太短 → 400
	if rec := doAuth(h, "POST", "/api/auth/change-password", `{"oldPassword":"secret","newPassword":"a"}`, ck); rec.Code != 400 {
		t.Errorf("change short: %d", rec.Code)
	}
	// 舊密碼錯 → 400
	if rec := doAuth(h, "POST", "/api/auth/change-password", `{"oldPassword":"bad","newPassword":"newpass"}`, ck); rec.Code != 400 {
		t.Errorf("change wrong old: %d", rec.Code)
	}
	// 成功 → 204
	if rec := doAuth(h, "POST", "/api/auth/change-password", `{"oldPassword":"secret","newPassword":"newpass"}`, ck); rec.Code != 204 {
		t.Fatalf("change ok: %d %s", rec.Code, rec.Body.String())
	}
	// 新密碼可登入、舊密碼不行
	if rec := doJSON(h, "POST", "/api/auth/login", `{"username":"admin","password":"newpass"}`); rec.Code != 200 {
		t.Errorf("login new pw: %d", rec.Code)
	}
	if rec := doJSON(h, "POST", "/api/auth/login", `{"username":"admin","password":"secret"}`); rec.Code != 401 {
		t.Errorf("old pw should fail: %d", rec.Code)
	}
}

// change-password：登入後使用者被刪 → GetByID 失敗 → 401。
func TestChangePasswordUserGone(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")
	if err := g.Where("username = ?", "admin").Delete(&db.User{}).Error; err != nil {
		t.Fatal(err)
	}
	if rec := doAuth(h, "POST", "/api/auth/change-password", `{"oldPassword":"secret","newPassword":"newpass"}`, ck); rec.Code != 401 {
		t.Errorf("change user gone: %d", rec.Code)
	}
}

func TestProjects(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")

	// 未登入 → 401
	if rec := doJSON(h, "GET", "/api/projects", ""); rec.Code != 401 {
		t.Errorf("projects no auth: %d", rec.Code)
	}

	ck := loginAs(t, h, "admin", "secret")
	// 一開始就有預設專案（db.Open 種的）
	rec := doAuth(h, "GET", "/api/projects", "", ck)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), db.DefaultProjectID) {
		t.Fatalf("projects list: %d %s", rec.Code, rec.Body.String())
	}

	// 建立：壞 JSON → 400
	if rec := doAuth(h, "POST", "/api/projects", "{oops", ck); rec.Code != 400 {
		t.Errorf("create bad json: %d", rec.Code)
	}
	// 建立：空名稱 → 400
	if rec := doAuth(h, "POST", "/api/projects", `{"name":"  "}`, ck); rec.Code != 400 {
		t.Errorf("create empty name: %d", rec.Code)
	}
	// 建立成功
	rec = doAuth(h, "POST", "/api/projects", `{"name":"報價單專案"}`, ck)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "報價單專案") {
		t.Fatalf("create ok: %d %s", rec.Code, rec.Body.String())
	}
	var created store.ProjectSummary
	mustUnmarshal(t, rec.Body.Bytes(), &created)

	// 專案內樣板清單：未登入 → 401
	if rec := doJSON(h, "GET", "/api/projects/"+created.ID+"/templates", ""); rec.Code != 401 {
		t.Errorf("proj templates no auth: %d", rec.Code)
	}
	// 專案不存在 → 404
	if rec := doAuth(h, "GET", "/api/projects/nope/templates", "", ck); rec.Code != 404 {
		t.Errorf("proj templates missing: %d", rec.Code)
	}
	// 空專案 → []
	rec = doAuth(h, "GET", "/api/projects/"+created.ID+"/templates", "", ck)
	if rec.Code != 200 || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("empty proj templates: %d %s", rec.Code, rec.Body.String())
	}

	// 在該專案下建樣板（?projectId），應出現在專案清單
	rec = doAuth(h, "POST", "/api/templates?projectId="+created.ID, minimalTemplate, ck)
	if rec.Code != 200 {
		t.Fatalf("create template in project: %d %s", rec.Code, rec.Body.String())
	}
	var tpl map[string]any
	mustUnmarshal(t, rec.Body.Bytes(), &tpl)
	tid := tpl["id"].(string)
	rec = doAuth(h, "GET", "/api/projects/"+created.ID+"/templates", "", ck)
	if !strings.Contains(rec.Body.String(), tid) {
		t.Fatalf("template should be in project: %s", rec.Body.String())
	}

	// ?projectId 指到不存在的專案 → 400
	if rec := doAuth(h, "POST", "/api/templates?projectId=nope", minimalTemplate, ck); rec.Code != 400 {
		t.Errorf("create with bad projectId: %d", rec.Code)
	}
}

// 空 SESSION_SECRET → sessionMiddleware 退回 dev 預設，session 仍可運作。
func TestSessionDefaultSecret(t *testing.T) {
	root := t.TempDir()
	g := testdb.Open(t)
	templates := store.NewTemplateStore(g)
	assets, _ := store.NewAssetStore(g, root)
	fonts, _ := store.NewFontStore(g, root)
	users := store.NewUserStore(g)
	projects := store.NewProjectStore(g)
	eng := engine.NewEngine("../../fonts", assets.EngineSource())
	h := New(templates, assets, fonts, users, projects, eng, "", "") // 空 secret
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")
	if rec := doAuth(h, "GET", "/api/auth/me", "", ck); rec.Code != 200 {
		t.Fatalf("me with default-secret session: %d", rec.Code)
	}
}

// 控制台各端點的 DB 錯誤都要回 500（不假報 404/400、不洩內部字串）。
func TestConsoleDBErrors(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")
	if sqlDB, err := g.DB(); err == nil {
		_ = sqlDB.Close()
	}
	// 專案清單
	if rec := doAuth(h, "GET", "/api/projects", "", ck); rec.Code != 500 {
		t.Errorf("projects list db error: %d", rec.Code)
	}
	// 建專案
	if rec := doAuth(h, "POST", "/api/projects", `{"name":"x"}`, ck); rec.Code != 500 {
		t.Errorf("create project db error: %d", rec.Code)
	}
	// 專案樣板清單：Exists 出錯 → 500（不再假報 404）
	if rec := doAuth(h, "GET", "/api/projects/x/templates", "", ck); rec.Code != 500 {
		t.Errorf("list templates db error: %d", rec.Code)
	}
	// 建樣板帶 projectId：Exists 出錯 → 500
	if rec := doAuth(h, "POST", "/api/templates?projectId=x", minimalTemplate, ck); rec.Code != 500 {
		t.Errorf("create template projectId db error: %d", rec.Code)
	}
}
