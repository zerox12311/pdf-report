package store

import (
	"testing"

	"pdftemplate/internal/db"
	"pdftemplate/internal/testdb"
)

func TestUserStore(t *testing.T) {
	g := testdb.Open(t)
	s := NewUserStore(g)
	const tid = db.DefaultTenantID

	// 空帳號 / 空密碼 → 錯誤
	if _, err := s.Create(tid, "  ", "pw", ""); err == nil {
		t.Error("空帳號應錯")
	}
	if _, err := s.Create(tid, "u", "", ""); err == nil {
		t.Error("空密碼應錯")
	}

	u, err := s.Create(tid, "admin", "secret", db.RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if u.Role != db.RoleAdmin {
		t.Errorf("role = %q, want admin", u.Role)
	}
	// 未知 role → 正規化為 user
	if u2, _ := s.Create(tid, "u2", "pw", "superuser"); u2.Role != db.RoleUser {
		t.Errorf("未知 role 應正規化為 user，got %q", u2.Role)
	}
	if n, _ := s.Count(); n != 2 {
		t.Errorf("Count = %d, want 2", n)
	}
	if list, err := s.List(tid); err != nil || len(list) != 2 {
		t.Errorf("List = %v (err %v), want 2 筆", list, err)
	}

	// GetByUsername：找到 / 找不到
	got, err := s.GetByUsername(tid, "admin")
	if err != nil || got.ID != u.ID {
		t.Fatalf("GetByUsername: %v %+v", err, got)
	}
	if _, err := s.GetByUsername(tid, "ghost"); err == nil {
		t.Error("不存在帳號應錯")
	}

	// GetByID：找到 / 找不到
	if _, err := s.GetByID(u.ID); err != nil {
		t.Errorf("GetByID: %v", err)
	}
	if _, err := s.GetByID("nope"); err == nil {
		t.Error("不存在 id 應錯")
	}

	// 密碼驗證
	if !VerifyPassword(got.PasswordHash, "secret") {
		t.Error("正確密碼應通過")
	}
	if VerifyPassword(got.PasswordHash, "wrong") {
		t.Error("錯誤密碼應失敗")
	}

	// 改密碼
	if err := s.SetPassword(u.ID, ""); err == nil {
		t.Error("空新密碼應錯")
	}
	if err := s.SetPassword(u.ID, "newpass"); err != nil {
		t.Fatal(err)
	}
	after, _ := s.GetByID(u.ID)
	if !VerifyPassword(after.PasswordHash, "newpass") || VerifyPassword(after.PasswordHash, "secret") {
		t.Error("改密碼後應以新密碼驗證")
	}
}

func TestProjectStore(t *testing.T) {
	g := testdb.Open(t)
	s := NewProjectStore(g)
	const tid = db.DefaultTenantID

	// db.Open 已種預設專案
	list, err := s.List(tid)
	if err != nil || len(list) != 1 || list[0].ID != db.DefaultProjectID {
		t.Fatalf("初始應只有預設專案：%v %+v", err, list)
	}

	// 空名稱 → 錯誤
	if _, err := s.Create(tid, "   "); err == nil {
		t.Error("空名稱應錯")
	}
	p, err := s.Create(tid, "報價單")
	if err != nil {
		t.Fatal(err)
	}
	if list, _ := s.List(tid); len(list) != 2 {
		t.Errorf("建立後應有 2 個專案，got %d", len(list))
	}

	// Exists：存在 / 不存在 / 不合法 id
	if ok, err := s.Exists(tid, p.ID); err != nil || !ok {
		t.Errorf("既有專案 Exists 應 true：%v %v", ok, err)
	}
	if ok, err := s.Exists(tid, "nope"); err != nil || ok {
		t.Errorf("不存在專案 Exists 應 false：%v %v", ok, err)
	}
	if ok, _ := s.Exists(tid, "bad.id"); ok {
		t.Error("不合法 id 應 false")
	}
}

func TestSeedAdmin(t *testing.T) {
	g := testdb.Open(t)
	s := NewUserStore(g)

	// env 空 → 退回 admin/admin
	if err := SeedAdmin(g, "", ""); err != nil {
		t.Fatal(err)
	}
	u, err := s.GetByUsername(db.DefaultTenantID, "admin")
	if err != nil || !VerifyPassword(u.PasswordHash, "admin") {
		t.Fatalf("預設管理員應為 admin/admin：%v", err)
	}

	// 再次種：user 表非空 → 跳過（不新增、不覆寫）
	if err := SeedAdmin(g, "other", "otherpw"); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.Count(); n != 1 {
		t.Errorf("重複種不應新增，Count = %d", n)
	}
	if _, err := s.GetByUsername(db.DefaultTenantID, "other"); err == nil {
		t.Error("非空表不應種入新帳號")
	}
}

func TestSeedAdminWithEnv(t *testing.T) {
	g := testdb.Open(t)
	if err := SeedAdmin(g, "boss", "bosspw"); err != nil {
		t.Fatal(err)
	}
	u, err := NewUserStore(g).GetByUsername(db.DefaultTenantID, "boss")
	if err != nil || !VerifyPassword(u.PasswordHash, "bosspw") || u.Role != db.RoleAdmin {
		t.Fatalf("env 指定帳密應生效且為 admin：%v %+v", err, u)
	}
}

// SeedAdmin 自癒：已有 user 但無 admin（升級情境）→ 提升成 admin。
func TestSeedAdminSelfHeal(t *testing.T) {
	g := testdb.Open(t)
	s := NewUserStore(g)
	// 模擬升級前：只有一個 user 角色的帳號、無 admin
	if _, err := s.Create(db.DefaultTenantID, "legacy", "pw", db.RoleUser); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.CountAdmins(db.DefaultTenantID); n != 0 {
		t.Fatal("前置：不應有 admin")
	}
	// env 未指名 → 提升最早建立者
	if err := SeedAdmin(g, "", ""); err != nil {
		t.Fatal(err)
	}
	u, _ := s.GetByUsername(db.DefaultTenantID, "legacy")
	if u.Role != db.RoleAdmin {
		t.Errorf("自癒後 legacy 應為 admin，got %q", u.Role)
	}
}

func TestProjectMembers(t *testing.T) {
	g := testdb.Open(t)
	us := NewUserStore(g)
	ps := NewProjectStore(g)
	const tid = db.DefaultTenantID

	u, _ := us.Create(tid, "bob", "pw", db.RoleUser)
	p1, _ := ps.Create(tid, "P1")
	p2, _ := ps.Create(tid, "P2")

	// 一開始無成員資格
	if ok, _ := ps.IsMember(u.ID, p1.ID); ok {
		t.Error("初始不應是成員")
	}
	if list, _ := ps.ListForUser(tid, u.ID); len(list) != 0 {
		t.Errorf("初始可見專案應為 0，got %d", len(list))
	}

	// 指派 P1（含一個不存在的 id，應被忽略）
	if err := ps.SetMembers(tid, u.ID, []string{p1.ID, "ghost"}); err != nil {
		t.Fatal(err)
	}
	if ok, _ := ps.IsMember(u.ID, p1.ID); !ok {
		t.Error("指派後應為 P1 成員")
	}
	if ok, _ := ps.IsMember(u.ID, p2.ID); ok {
		t.Error("不應為 P2 成員")
	}
	if ids, _ := ps.MemberProjectIDs(u.ID); len(ids) != 1 || ids[0] != p1.ID {
		t.Errorf("MemberProjectIDs = %v", ids)
	}
	if list, _ := ps.ListForUser(tid, u.ID); len(list) != 1 || list[0].ID != p1.ID {
		t.Errorf("ListForUser 應只有 P1：%+v", list)
	}

	// 覆寫為 P2
	if err := ps.SetMembers(tid, u.ID, []string{p2.ID}); err != nil {
		t.Fatal(err)
	}
	if ok, _ := ps.IsMember(u.ID, p1.ID); ok {
		t.Error("覆寫後不應仍是 P1 成員")
	}
	if ok, _ := ps.IsMember(u.ID, p2.ID); !ok {
		t.Error("覆寫後應為 P2 成員")
	}

	// 刪專案 → 成員資格一併清除
	if err := ps.Delete(tid, p2.ID); err != nil {
		t.Fatal(err)
	}
	if ok, _ := ps.IsMember(u.ID, p2.ID); ok {
		t.Error("刪專案後成員資格應清除")
	}
	// 刪不存在專案 → os.ErrNotExist
	if err := ps.Delete(tid, "nope"); err == nil {
		t.Error("刪不存在專案應錯")
	}
}

// 刪使用者連同其成員資格。
func TestUserDeleteCascade(t *testing.T) {
	g := testdb.Open(t)
	us := NewUserStore(g)
	ps := NewProjectStore(g)
	const tid = db.DefaultTenantID
	u, _ := us.Create(tid, "bob", "pw", db.RoleUser)
	p, _ := ps.Create(tid, "P")
	_ = ps.SetMembers(tid, u.ID, []string{p.ID})
	if err := us.Delete(u.ID); err != nil {
		t.Fatal(err)
	}
	if ids, _ := ps.MemberProjectIDs(u.ID); len(ids) != 0 {
		t.Errorf("刪使用者後成員資格應清除，got %v", ids)
	}
}
