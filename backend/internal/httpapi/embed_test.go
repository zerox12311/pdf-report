package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"pdftemplate/internal/store"
)

// doBearer 帶 Authorization: Bearer <token> 發請求（API key 或 embed token 皆用此）。
func doBearer(h http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestEmbedTokenFlow(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")

	// admin 建兩個專案
	var p1, p2 store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P1"}`, ck).Body.Bytes(), &p1)
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P2"}`, ck).Body.Bytes(), &p2)

	// P1 的 API key
	var key struct{ Key string }
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects/"+p1.ID+"/keys", `{"name":"host"}`, ck).Body.Bytes(), &key)
	if key.Key == "" {
		t.Fatal("no api key")
	}

	// ---- API key 身分：換 token（不帶 templateId → 建空的＋回 token）----
	rec := doBearer(h, "POST", "/api/embed-token", `{}`, key.Key)
	if rec.Code != 200 {
		t.Fatalf("mint (create new): %d %s", rec.Code, rec.Body.String())
	}
	var tok struct{ Token, TemplateId string }
	mustUnmarshal(t, rec.Body.Bytes(), &tok)
	if tok.Token == "" || tok.TemplateId == "" {
		t.Fatalf("mint resp: %+v", tok)
	}
	newTid := tok.TemplateId

	// 換 token 需 API key：用 session cookie 打 → 401
	if rec := doAuth(h, "POST", "/api/embed-token", `{}`, ck); rec.Code != 401 {
		t.Errorf("mint with session should 401: %d", rec.Code)
	}
	// 用 embed token 打 mint → 401（不是 API key）
	if rec := doBearer(h, "POST", "/api/embed-token", `{}`, tok.Token); rec.Code != 401 {
		t.Errorf("mint with embed token should 401: %d", rec.Code)
	}
	// mint 壞 JSON → 400
	if rec := doBearer(h, "POST", "/api/embed-token", "{oops", key.Key); rec.Code != 400 {
		t.Errorf("mint bad json should 400: %d", rec.Code)
	}

	// ---- API key 在自己專案內：建/讀/列 ----
	// 建一張（在 P1）
	rec = doBearer(h, "POST", "/api/templates", minimalTemplate, key.Key)
	if rec.Code != 200 {
		t.Fatalf("apikey create in own project: %d %s", rec.Code, rec.Body.String())
	}
	var made map[string]any
	mustUnmarshal(t, rec.Body.Bytes(), &made)
	ownTid := made["id"].(string)
	// 讀自己專案的樣板 → 200
	if rec := doBearer(h, "GET", "/api/templates/"+ownTid, "", key.Key); rec.Code != 200 {
		t.Errorf("apikey get own project template: %d", rec.Code)
	}
	// 列出 → 只有 P1 的
	if rec := doBearer(h, "GET", "/api/templates", "", key.Key); !strings.Contains(rec.Body.String(), ownTid) {
		t.Errorf("apikey list should include own: %s", rec.Body.String())
	}

	// admin 在 P2 建一張，API key(P1) 碰不到 → 403
	var other map[string]any
	mustUnmarshal(t, doAuth(h, "POST", "/api/templates?projectId="+p2.ID, minimalTemplate, ck).Body.Bytes(), &other)
	otherTid := other["id"].(string)
	if rec := doBearer(h, "GET", "/api/templates/"+otherTid, "", key.Key); rec.Code != 403 {
		t.Errorf("apikey get other project template should 403: %d", rec.Code)
	}
	// 換 token 指定別專案的樣板 → 403
	if rec := doBearer(h, "POST", "/api/embed-token", `{"templateId":"`+otherTid+`"}`, key.Key); rec.Code != 403 {
		t.Errorf("mint other project template should 403: %d", rec.Code)
	}
	// 換 token 指定不存在樣板 → 404
	if rec := doBearer(h, "POST", "/api/embed-token", `{"templateId":"nope"}`, key.Key); rec.Code != 404 {
		t.Errorf("mint missing template should 404: %d", rec.Code)
	}

	// ---- embed token 身分：鎖單張 ----
	// 換一張綁 ownTid 的 token
	mustUnmarshal(t, doBearer(h, "POST", "/api/embed-token", `{"templateId":"`+ownTid+`"}`, key.Key).Body.Bytes(), &tok)
	embed := tok.Token

	// 讀/寫綁定那張 → 200
	if rec := doBearer(h, "GET", "/api/templates/"+ownTid, "", embed); rec.Code != 200 {
		t.Errorf("embed get bound template: %d", rec.Code)
	}
	if rec := doBearer(h, "PUT", "/api/templates/"+ownTid, minimalTemplate, embed); rec.Code != 200 {
		t.Errorf("embed put bound template: %d", rec.Code)
	}
	// 讀別張（otherTid、newTid）→ 403
	if rec := doBearer(h, "GET", "/api/templates/"+otherTid, "", embed); rec.Code != 403 {
		t.Errorf("embed get other template should 403: %d", rec.Code)
	}
	if rec := doBearer(h, "GET", "/api/templates/"+newTid, "", embed); rec.Code != 403 {
		t.Errorf("embed get another same-project template should 403: %d", rec.Code)
	}
	// 不能列 / 不能建 → 403
	if rec := doBearer(h, "GET", "/api/templates", "", embed); rec.Code != 403 {
		t.Errorf("embed list should 403: %d", rec.Code)
	}
	if rec := doBearer(h, "POST", "/api/templates", minimalTemplate, embed); rec.Code != 403 {
		t.Errorf("embed create should 403: %d", rec.Code)
	}
	// adhoc render（預覽）→ 200；assets/fonts/validate → 允許
	adhoc := `{"template":` + minimalTemplate + `,"data":{}}`
	if rec := doBearer(h, "POST", "/api/templates/render", adhoc, embed); rec.Code != 200 {
		t.Errorf("embed adhoc render should 200: %d %s", rec.Code, rec.Body.String())
	}
	if rec := doBearer(h, "GET", "/api/fonts", "", embed); rec.Code != 200 {
		t.Errorf("embed list fonts should 200: %d", rec.Code)
	}

	// ---- 無效/亂 token → 401 ----
	if rec := doBearer(h, "GET", "/api/templates/"+ownTid, "", "eyJ.garbage.sig"); rec.Code != 401 {
		t.Errorf("garbage jwt should 401: %d", rec.Code)
	}
	if rec := doBearer(h, "GET", "/api/templates/"+ownTid, "", "pdftpl_wrongkey"); rec.Code != 401 {
		t.Errorf("wrong api key should 401: %d", rec.Code)
	}
}

// embed token 過期 → 401。
func TestEmbedTokenExpired(t *testing.T) {
	// 直接簽一張已過期的 token（繞過端點，用 newTestServer 的 "test-secret"）
	expired, err := signEmbedTokenExp("test-secret", "default", "default", "sometemplate", modeDesign, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	h, _, _, _ := newTestServer(t)
	if rec := doBearer(h, "GET", "/api/templates/sometemplate", "", expired); rec.Code != 401 {
		t.Errorf("expired token should 401: %d", rec.Code)
	}
}
