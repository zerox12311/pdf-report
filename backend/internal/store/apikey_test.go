package store

import (
	"errors"
	"os"
	"testing"

	"pdftemplate/internal/db"
	"pdftemplate/internal/testdb"
)

func TestAPIKeyStore(t *testing.T) {
	g := testdb.Open(t)
	s := NewAPIKeyStore(g)
	const tid = db.DefaultTenantID
	const pid = db.DefaultProjectID

	// 初始空
	if list, err := s.ListByProject(tid, pid); err != nil || len(list) != 0 {
		t.Fatalf("初始應空：%v %v", list, err)
	}

	// 建立 → 明文帶前綴
	plain, sum, err := s.Create(tid, pid, "宿主")
	if err != nil {
		t.Fatal(err)
	}
	if !HasAPIKeyPrefix(plain) || sum.Name != "宿主" || sum.ID == "" {
		t.Fatalf("create: %q %+v", plain, sum)
	}
	// 名稱省略 → 預設
	if _, s2, _ := s.Create(tid, pid, "  "); s2.Name != "API 金鑰" {
		t.Errorf("空名稱應給預設：%q", s2.Name)
	}

	// Verify：正確明文 → 查到、且帶對的 project
	rec, err := s.Verify(plain)
	if err != nil || rec.ProjectID != pid || rec.TenantID != tid {
		t.Fatalf("verify: %v %+v", err, rec)
	}
	// Verify：錯的明文 / 非前綴 → not found
	if _, err := s.Verify(plain + "x"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("錯金鑰應 not found：%v", err)
	}
	if _, err := s.Verify("garbage"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("非前綴應 not found：%v", err)
	}

	// 清單有 2 筆
	if list, _ := s.ListByProject(tid, pid); len(list) != 2 {
		t.Errorf("應有 2 把，got %d", len(list))
	}

	// 撤銷 → Verify 失效
	if err := s.Delete(tid, sum.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Verify(plain); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("撤銷後應失效：%v", err)
	}
	// 撤銷不存在 → not found
	if err := s.Delete(tid, "nope"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("撤銷不存在：%v", err)
	}
}
