package httpapi

import (
	"strings"
	"testing"

	"pdftemplate/internal/db"
	"pdftemplate/internal/store"
)

// TestRoleAuthorization：user 角色被關進被指派的專案，越權一律 403；admin 全開；無 session 維持開放。
func TestRoleAuthorization(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")             // admin
	uid := seedRole(t, g, "bob", "bobpw123", db.RoleUser) // user
	adminCk := loginAs(t, h, "admin", "secret")
	userCk := loginAs(t, h, "bob", "bobpw123")

	// admin 建兩個專案，只把 P1 指派給 bob
	var p1, p2 store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P1"}`, adminCk).Body.Bytes(), &p1)
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P2"}`, adminCk).Body.Bytes(), &p2)
	if rec := doAuth(h, "PATCH", "/api/users/"+uid, `{"projectIds":["`+p1.ID+`"]}`, adminCk); rec.Code != 204 {
		t.Fatalf("assign p1: %d %s", rec.Code, rec.Body.String())
	}

	// user 不能建/刪專案、不能碰使用者管理
	forbid := func(method, path, body string) {
		if rec := doAuth(h, method, path, body, userCk); rec.Code != 403 {
			t.Errorf("%s %s：user 應 403，got %d", method, path, rec.Code)
		}
	}
	forbid("POST", "/api/projects", `{"name":"X"}`)
	forbid("DELETE", "/api/projects/"+p2.ID, "")
	forbid("GET", "/api/users", "")
	forbid("POST", "/api/users", `{"username":"z","password":"zzzzzzzz"}`)
	forbid("PATCH", "/api/users/"+uid, `{"role":"admin"}`)
	forbid("DELETE", "/api/users/"+uid, "")

	// 專案清單範圍化：user 只看得到 P1（看不到 P2、default）
	ubody := doAuth(h, "GET", "/api/projects", "", userCk).Body.String()
	if !strings.Contains(ubody, p1.ID) || strings.Contains(ubody, p2.ID) || strings.Contains(ubody, `"default"`) {
		t.Errorf("user 專案清單應只有 P1：%s", ubody)
	}
	if !strings.Contains(doAuth(h, "GET", "/api/projects", "", adminCk).Body.String(), p2.ID) {
		t.Error("admin 應看得到 P2")
	}

	// 專案樣板清單：成員 200、非成員 403
	if rec := doAuth(h, "GET", "/api/projects/"+p1.ID+"/templates", "", userCk); rec.Code != 200 {
		t.Errorf("user 成員專案樣板：%d", rec.Code)
	}
	forbid("GET", "/api/projects/"+p2.ID+"/templates", "")

	// 建立樣板：成員專案 OK、非成員 403、不帶（落 default）403
	var own map[string]any
	rec := doAuth(h, "POST", "/api/templates?projectId="+p1.ID, minimalTemplate, userCk)
	if rec.Code != 200 {
		t.Fatalf("user 於成員專案建樣板：%d %s", rec.Code, rec.Body.String())
	}
	mustUnmarshal(t, rec.Body.Bytes(), &own)
	ownID := own["id"].(string)
	forbid("POST", "/api/templates?projectId="+p2.ID, minimalTemplate)
	forbid("POST", "/api/templates", minimalTemplate) // 落 default，bob 非成員

	// admin 在 P2 建一個樣板，bob 對它一律 403（get/put/delete/render）
	var other map[string]any
	mustUnmarshal(t, doAuth(h, "POST", "/api/templates?projectId="+p2.ID, minimalTemplate, adminCk).Body.Bytes(), &other)
	otherID := other["id"].(string)
	if rec := doAuth(h, "GET", "/api/templates/"+ownID, "", userCk); rec.Code != 200 {
		t.Errorf("user 讀自己樣板：%d", rec.Code)
	}
	forbid("GET", "/api/templates/"+otherID, "")
	forbid("PUT", "/api/templates/"+otherID, minimalTemplate)
	forbid("DELETE", "/api/templates/"+otherID, "")
	forbid("POST", "/api/templates/"+otherID+"/render", "{}")
	if rec := doAuth(h, "POST", "/api/templates/"+ownID+"/render", "{}", userCk); rec.Code != 200 {
		t.Errorf("user 渲染自己樣板：%d %s", rec.Code, rec.Body.String())
	}

	// 扁平樣板清單：user 只含自己專案的樣板
	flat := doAuth(h, "GET", "/api/templates", "", userCk).Body.String()
	if !strings.Contains(flat, ownID) || strings.Contains(flat, otherID) {
		t.Errorf("user 扁平清單應只含自己樣板：%s", flat)
	}

	// 匿名（無 session）一律 401——資料端點已上鎖，不再有 iframe 開放後門
	if rec := doJSON(h, "GET", "/api/templates/"+otherID, ""); rec.Code != 401 {
		t.Errorf("無 session 應 401：%d", rec.Code)
	}
}

// TestAnonymousLocked：資料端點一律需登入，匿名 → 401（上鎖後不再有開放後門）。
func TestAnonymousLocked(t *testing.T) {
	h, _, _, _ := newTestServer(t)
	cases := []struct{ method, path string }{
		{"GET", "/api/templates"},
		{"POST", "/api/templates"},
		{"GET", "/api/templates/x"},
		{"PUT", "/api/templates/x"},
		{"DELETE", "/api/templates/x"},
		{"POST", "/api/templates/x/render"},
		{"POST", "/api/templates/render"},
		{"GET", "/api/assets/x"},
		{"POST", "/api/assets"},
		{"GET", "/api/fonts"},
		{"GET", "/api/fonts/x"},
		{"POST", "/api/fonts"},
		{"POST", "/api/validate"},
	}
	for _, c := range cases {
		if rec := doJSON(h, c.method, c.path, "{}"); rec.Code != 401 {
			t.Errorf("%s %s 匿名應 401，got %d", c.method, c.path, rec.Code)
		}
	}
}

// TestUserManagement：使用者管理 CRUD 快樂路徑與錯誤。
func TestUserManagement(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")

	var p store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P"}`, ck).Body.Bytes(), &p)

	// 建立 user、指派 P
	rec := doAuth(h, "POST", "/api/users", `{"username":"bob","password":"bobpw123","role":"user","projectIds":["`+p.ID+`"]}`, ck)
	if rec.Code != 200 {
		t.Fatalf("建立 user：%d %s", rec.Code, rec.Body.String())
	}
	var bob userView
	mustUnmarshal(t, rec.Body.Bytes(), &bob)
	if bob.Role != db.RoleUser || len(bob.ProjectIDs) != 1 {
		t.Errorf("bob view：%+v", bob)
	}

	// 清單有 2 人
	var us []userView
	mustUnmarshal(t, doAuth(h, "GET", "/api/users", "", ck).Body.Bytes(), &us)
	if len(us) != 2 {
		t.Errorf("使用者數 = %d", len(us))
	}

	// bob 登入看得到 P
	bobCk := loginAs(t, h, "bob", "bobpw123")
	if !strings.Contains(doAuth(h, "GET", "/api/projects", "", bobCk).Body.String(), p.ID) {
		t.Error("bob 應看得到 P")
	}

	// 重設密碼（PATCH）→ 新密碼可登入
	if rec := doAuth(h, "PATCH", "/api/users/"+bob.ID, `{"password":"newbob12"}`, ck); rec.Code != 204 {
		t.Errorf("重設密碼：%d", rec.Code)
	}
	if rec := doJSON(h, "POST", "/api/auth/login", `{"username":"bob","password":"newbob12"}`); rec.Code != 200 {
		t.Errorf("bob 新密碼登入：%d", rec.Code)
	}
	// 密碼太短 → 400
	if rec := doAuth(h, "PATCH", "/api/users/"+bob.ID, `{"password":"a"}`, ck); rec.Code != 400 {
		t.Errorf("短密碼：%d", rec.Code)
	}

	// 升級 bob 為 admin → 之後可刪（2 admin）
	if rec := doAuth(h, "PATCH", "/api/users/"+bob.ID, `{"role":"admin"}`, ck); rec.Code != 204 {
		t.Errorf("升級：%d", rec.Code)
	}
	if rec := doAuth(h, "DELETE", "/api/users/"+bob.ID, "", ck); rec.Code != 204 {
		t.Errorf("刪 bob：%d", rec.Code)
	}

	// 錯誤：壞 JSON / 重複帳號 / 不存在
	if rec := doAuth(h, "POST", "/api/users", "{oops", ck); rec.Code != 400 {
		t.Errorf("建立壞 JSON：%d", rec.Code)
	}
	if rec := doAuth(h, "POST", "/api/users", `{"username":"admin","password":"x"}`, ck); rec.Code != 400 {
		t.Errorf("重複帳號：%d", rec.Code)
	}
	if rec := doAuth(h, "PATCH", "/api/users/nope", `{"role":"user"}`, ck); rec.Code != 404 {
		t.Errorf("PATCH 不存在：%d", rec.Code)
	}
	if rec := doAuth(h, "DELETE", "/api/users/nope", "", ck); rec.Code != 404 {
		t.Errorf("DELETE 不存在：%d", rec.Code)
	}
}

// TestLastAdminGuard：不能刪自己、不能降/刪最後一個 admin。
func TestLastAdminGuard(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")
	var us []userView
	mustUnmarshal(t, doAuth(h, "GET", "/api/users", "", ck).Body.Bytes(), &us)
	adminID := us[0].ID

	if rec := doAuth(h, "DELETE", "/api/users/"+adminID, "", ck); rec.Code != 400 {
		t.Errorf("刪自己應 400：%d", rec.Code)
	}
	if rec := doAuth(h, "PATCH", "/api/users/"+adminID, `{"role":"user"}`, ck); rec.Code != 400 {
		t.Errorf("降最後 admin 應 400：%d", rec.Code)
	}
	// 壞 JSON（用存在的 admin id，過了 GetByID 才到解析）→ 400
	if rec := doAuth(h, "PATCH", "/api/users/"+adminID, "{oops", ck); rec.Code != 400 {
		t.Errorf("PATCH 壞 JSON：%d", rec.Code)
	}
}

// TestProjectDelete：admin 刪專案；預設專案不可刪、非空需先清空。
func TestProjectDelete(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")

	if rec := doAuth(h, "DELETE", "/api/projects/"+db.DefaultProjectID, "", ck); rec.Code != 400 {
		t.Errorf("刪預設專案應 400：%d", rec.Code)
	}
	var p store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P"}`, ck).Body.Bytes(), &p)
	if rec := doAuth(h, "DELETE", "/api/projects/"+p.ID, "", ck); rec.Code != 204 {
		t.Errorf("刪空專案：%d %s", rec.Code, rec.Body.String())
	}
	var p2 store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P2"}`, ck).Body.Bytes(), &p2)
	doAuth(h, "POST", "/api/templates?projectId="+p2.ID, minimalTemplate, ck)
	if rec := doAuth(h, "DELETE", "/api/projects/"+p2.ID, "", ck); rec.Code != 400 {
		t.Errorf("刪非空專案應 400：%d", rec.Code)
	}
	if rec := doAuth(h, "DELETE", "/api/projects/nope", "", ck); rec.Code != 404 {
		t.Errorf("刪不存在專案：%d", rec.Code)
	}
}
