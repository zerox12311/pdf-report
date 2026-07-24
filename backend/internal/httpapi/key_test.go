package httpapi

import (
	"strings"
	"testing"

	"pdftemplate/internal/store"
)

func TestAPIKeys(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")

	// 建專案
	var p store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P"}`, ck).Body.Bytes(), &p)

	// 專案不存在 → 404（list / create）
	if rec := doAuth(h, "GET", "/api/projects/nope/keys", "", ck); rec.Code != 404 {
		t.Errorf("list missing project: %d", rec.Code)
	}
	if rec := doAuth(h, "POST", "/api/projects/nope/keys", `{"name":"k"}`, ck); rec.Code != 404 {
		t.Errorf("create missing project: %d", rec.Code)
	}

	// 一開始空
	if rec := doAuth(h, "GET", "/api/projects/"+p.ID+"/keys", "", ck); rec.Code != 200 || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("empty keys: %d %s", rec.Code, rec.Body.String())
	}

	// 建立 → 回明文（pdftpl_ 前綴），只此一次
	rec := doAuth(h, "POST", "/api/projects/"+p.ID+"/keys", `{"name":"宿主整合"}`, ck)
	if rec.Code != 200 {
		t.Fatalf("create key: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID, Name, Key string
	}
	mustUnmarshal(t, rec.Body.Bytes(), &created)
	if !strings.HasPrefix(created.Key, "pdftpl_") || created.Name != "宿主整合" || created.ID == "" {
		t.Fatalf("created key: %+v", created)
	}

	// 清單有一筆、不含明文
	rec = doAuth(h, "GET", "/api/projects/"+p.ID+"/keys", "", ck)
	if !strings.Contains(rec.Body.String(), created.ID) || strings.Contains(rec.Body.String(), created.Key) {
		t.Fatalf("list should have id not plaintext: %s", rec.Body.String())
	}

	// 壞 JSON → 400
	if rec := doAuth(h, "POST", "/api/projects/"+p.ID+"/keys", "{oops", ck); rec.Code != 400 {
		t.Errorf("create bad json: %d", rec.Code)
	}

	// 撤銷 → 204，之後清單空
	if rec := doAuth(h, "DELETE", "/api/keys/"+created.ID, "", ck); rec.Code != 204 {
		t.Errorf("delete key: %d", rec.Code)
	}
	if rec := doAuth(h, "GET", "/api/projects/"+p.ID+"/keys", "", ck); strings.Contains(rec.Body.String(), created.ID) {
		t.Errorf("key should be gone: %s", rec.Body.String())
	}
	// 撤銷不存在 → 404
	if rec := doAuth(h, "DELETE", "/api/keys/nope", "", ck); rec.Code != 404 {
		t.Errorf("delete missing: %d", rec.Code)
	}
}

// 非 admin 打金鑰端點一律 403。
func TestAPIKeysForbiddenForUser(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	seedRole(t, g, "bob", "bobpw", "user")
	adminCk := loginAs(t, h, "admin", "secret")
	userCk := loginAs(t, h, "bob", "bobpw")
	var p store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P"}`, adminCk).Body.Bytes(), &p)

	for _, c := range []struct{ method, path, body string }{
		{"GET", "/api/projects/" + p.ID + "/keys", ""},
		{"POST", "/api/projects/" + p.ID + "/keys", `{"name":"k"}`},
		{"DELETE", "/api/keys/whatever", ""},
	} {
		if rec := doAuth(h, c.method, c.path, c.body, userCk); rec.Code != 403 {
			t.Errorf("%s %s user should 403: %d", c.method, c.path, rec.Code)
		}
	}
}

// 金鑰端點 DB 錯誤 → 500。
func TestAPIKeysDBError(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")
	var p store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P"}`, ck).Body.Bytes(), &p)
	if sqlDB, err := g.DB(); err == nil {
		_ = sqlDB.Close()
	}
	// Exists 出錯 → 500（list/create）
	if rec := doAuth(h, "GET", "/api/projects/"+p.ID+"/keys", "", ck); rec.Code != 500 {
		t.Errorf("list db error: %d", rec.Code)
	}
	if rec := doAuth(h, "POST", "/api/projects/"+p.ID+"/keys", `{"name":"k"}`, ck); rec.Code != 500 {
		t.Errorf("create db error: %d", rec.Code)
	}
}
