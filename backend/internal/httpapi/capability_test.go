package httpapi

import (
	"testing"

	"pdftemplate/internal/store"
)

func TestNormalizeModeAndCapabilities(t *testing.T) {
	// 空值 → design（向後相容：加 mode 之前簽出的舊 token）；未知值 → view（降權，見 TestNormalizeModeUnknownDegradesToView）
	if got := normalizeMode(""); got != modeDesign {
		t.Errorf("normalizeMode(\"\") = %q, want design", got)
	}
	for _, m := range []string{modeDesign, modeFill, modeView} {
		if got := normalizeMode(m); got != m {
			t.Errorf("normalizeMode(%q) = %q", m, got)
		}
	}

	// 能力表
	cases := []struct {
		mode string
		cap  string
		want bool
	}{
		{modeDesign, capEditLayout, true}, {modeDesign, capEditValues, true}, {modeDesign, capUpload, true},
		{modeFill, capEditLayout, false}, {modeFill, capEditValues, true}, {modeFill, capUpload, false},
		{modeView, capEditLayout, false}, {modeView, capEditValues, false}, {modeView, capUpload, false},
	}
	for _, tc := range cases {
		if got := embedCan(tc.mode, tc.cap); got != tc.want {
			t.Errorf("embedCan(%s, %s) = %v, want %v", tc.mode, tc.cap, got, tc.want)
		}
	}

	// capabilitiesOf 三個 key 都在（前端靠它畫 UI，缺 key 會讓前端誤判成 undefined）
	caps := capabilitiesOf(modeFill)
	if len(caps) != 3 || !caps[capEditValues] || caps[capEditLayout] || caps[capUpload] {
		t.Errorf("capabilitiesOf(fill) = %+v", caps)
	}
}

// TestEmbedModeEnforcement fill/view 模式的端點強制：改版面、上傳、刪除一律擋。
func TestEmbedModeEnforcement(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")

	var proj store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P"}`, ck).Body.Bytes(), &proj)
	var key struct{ Key string }
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects/"+proj.ID+"/keys", `{"name":"host"}`, ck).Body.Bytes(), &key)

	mint := func(mode string) (token, tid string) {
		body := `{}`
		if mode != "" {
			body = `{"mode":"` + mode + `"}`
		}
		rec := doBearer(h, "POST", "/api/embed-token", body, key.Key)
		if rec.Code != 200 {
			t.Fatalf("mint(%s): %d %s", mode, rec.Code, rec.Body.String())
		}
		var tok struct{ Token, TemplateId, Mode string }
		mustUnmarshal(t, rec.Body.Bytes(), &tok)
		if mode != "" && tok.Mode != mode {
			t.Fatalf("mint(%s) returned mode %q", mode, tok.Mode)
		}
		return tok.Token, tok.TemplateId
	}

	// ---- design（預設）：可 PUT、可上傳；仍不可刪 ----
	designTok, designTid := mint("")
	if rec := doBearer(h, "PUT", "/api/templates/"+designTid, minimalTemplate, designTok); rec.Code != 200 {
		t.Errorf("design PUT should pass: %d %s", rec.Code, rec.Body.String())
	}
	if rec := doBearer(h, "POST", "/api/assets", "not-an-image", designTok); rec.Code == 403 {
		t.Error("design upload should not be blocked by capability (400 for bad body is fine)")
	}
	// embed 一律不可刪（不分模式）——避免宿主端變成指向不存在樣板的孤兒連結
	if rec := doBearer(h, "DELETE", "/api/templates/"+designTid, "", designTok); rec.Code != 403 {
		t.Errorf("design DELETE should 403: %d", rec.Code)
	}

	// ---- fill：不可 PUT 整份、不可上傳、不可刪；讀取仍可 ----
	fillTok, fillTid := mint(modeFill)
	if rec := doBearer(h, "GET", "/api/templates/"+fillTid, "", fillTok); rec.Code != 200 {
		t.Errorf("fill GET should pass: %d", rec.Code)
	}
	if rec := doBearer(h, "PUT", "/api/templates/"+fillTid, minimalTemplate, fillTok); rec.Code != 403 {
		t.Errorf("fill PUT should 403: %d %s", rec.Code, rec.Body.String())
	}
	if rec := doBearer(h, "POST", "/api/assets", "x", fillTok); rec.Code != 403 {
		t.Errorf("fill asset upload should 403: %d", rec.Code)
	}
	if rec := doBearer(h, "POST", "/api/fonts", "x", fillTok); rec.Code != 403 {
		t.Errorf("fill font upload should 403: %d", rec.Code)
	}
	if rec := doBearer(h, "DELETE", "/api/templates/"+fillTid, "", fillTok); rec.Code != 403 {
		t.Errorf("fill DELETE should 403: %d", rec.Code)
	}

	// ---- view：連改值都不行（批2 的 PATCH 會用到 capEditValues）；PUT/上傳/刪除同樣擋 ----
	viewTok, viewTid := mint(modeView)
	if rec := doBearer(h, "PUT", "/api/templates/"+viewTid, minimalTemplate, viewTok); rec.Code != 403 {
		t.Errorf("view PUT should 403: %d", rec.Code)
	}
	if rec := doBearer(h, "POST", "/api/assets", "x", viewTok); rec.Code != 403 {
		t.Errorf("view upload should 403: %d", rec.Code)
	}

	// ---- 非 embed 身分不受 capability 影響 ----
	if rec := doAuth(h, "PUT", "/api/templates/"+designTid, minimalTemplate, ck); rec.Code != 200 {
		t.Errorf("session user PUT should pass: %d", rec.Code)
	}
	if rec := doBearer(h, "PUT", "/api/templates/"+designTid, minimalTemplate, key.Key); rec.Code != 200 {
		t.Errorf("api key PUT should pass: %d", rec.Code)
	}
	if rec := doAuth(h, "DELETE", "/api/templates/"+designTid, "", ck); rec.Code != 204 {
		t.Errorf("session user DELETE should pass: %d", rec.Code)
	}
}

// TestMintRejectsUnknownMode 宿主拼錯 mode（"Fill"／"readonly"）必須 400，
// 不可默默退回 design（最高權限）——這是最容易發生的整合失誤。
func TestMintRejectsUnknownMode(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")

	var proj store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P"}`, ck).Body.Bytes(), &proj)
	var key struct{ Key string }
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects/"+proj.ID+"/keys", `{"name":"host"}`, ck).Body.Bytes(), &key)

	for _, bad := range []string{"Fill", "VIEW", "readonly", "fill ", "nonsense"} {
		rec := doBearer(h, "POST", "/api/embed-token", `{"mode":"`+bad+`"}`, key.Key)
		if rec.Code != 400 {
			t.Errorf("mint(mode=%q) = %d, want 400（不可退回 design）", bad, rec.Code)
		}
	}
	// 沒帶 mode 仍可（相容既有整合）→ design
	rec := doBearer(h, "POST", "/api/embed-token", `{}`, key.Key)
	if rec.Code != 200 {
		t.Fatalf("mint without mode: %d", rec.Code)
	}
	var tok struct{ Mode string }
	mustUnmarshal(t, rec.Body.Bytes(), &tok)
	if tok.Mode != modeDesign {
		t.Errorf("mode = %q, want design", tok.Mode)
	}
}

// TestNormalizeModeUnknownDegradesToView 既有 token 出現未知 mode（版本回退等）→ 降權，不是升權。
func TestNormalizeModeUnknownDegradesToView(t *testing.T) {
	if got := normalizeMode(""); got != modeDesign {
		t.Errorf("空值（加 mode 前的舊 token）應相容為 design，got %q", got)
	}
	for _, in := range []string{"nonsense", "Design", "FILL"} {
		if got := normalizeMode(in); got != modeView {
			t.Errorf("normalizeMode(%q) = %q, want view（未知值降權）", in, got)
		}
	}
}
