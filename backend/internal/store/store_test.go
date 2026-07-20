package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSafeID(t *testing.T) {
	for id, want := range map[string]bool{
		"abc123": true, "": false, "a/b": false, "a\\b": false, "..": false, "a.b": false,
	} {
		if got := SafeID(id); got != want {
			t.Errorf("SafeID(%q) = %v, want %v", id, got, want)
		}
	}
}

func TestTemplateStore(t *testing.T) {
	root := t.TempDir()
	s, err := NewTemplateStore(root)
	if err != nil {
		t.Fatal(err)
	}

	// Save 壞 JSON
	if _, _, err := s.Save([]byte("{bad"), ""); err == nil {
		t.Error("expected error for bad json")
	}
	// Save / Get / List / Delete
	id, out, err := s.Save([]byte(`{"name":"n"}`), "")
	if err != nil || id == "" || !strings.Contains(string(out), `"updatedAt"`) {
		t.Fatalf("save: %v %s", err, out)
	}
	if _, err := s.Get(id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get("../etc"); err == nil {
		t.Error("expected error for unsafe id")
	}
	list, err := s.List()
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v %d", err, len(list))
	}
	// List 略過壞檔與缺 id 的檔
	_ = os.WriteFile(filepath.Join(root, "templates", "junk.json"), []byte("{bad"), 0o644)
	_ = os.WriteFile(filepath.Join(root, "templates", "noid.json"), []byte(`{"name":"x"}`), 0o644)
	_ = os.WriteFile(filepath.Join(root, "templates", "not-json.txt"), []byte("x"), 0o644)
	list, err = s.List()
	if err != nil || len(list) != 1 {
		t.Fatalf("list with junk: %v %d", err, len(list))
	}
	if err := s.Delete(id); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete("../x"); err == nil {
		t.Error("expected error deleting unsafe id")
	}
	// NewTemplateStore 失敗（root 是檔案不是目錄）
	f := filepath.Join(t.TempDir(), "f")
	_ = os.WriteFile(f, []byte("x"), 0o644)
	if _, err := NewTemplateStore(filepath.Join(f, "sub")); err == nil {
		t.Error("expected mkdir error")
	}
}

func TestAssetStore(t *testing.T) {
	root := t.TempDir()
	s, err := NewAssetStore(root)
	if err != nil {
		t.Fatal(err)
	}
	// PNG / JPEG / 不支援
	idPng, err := s.Save([]byte("png-bytes"), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	idJpg, err := s.Save([]byte("jpg-bytes"), "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Save([]byte("x"), "image/gif"); err == nil {
		t.Error("expected error for gif")
	}
	if b, ct, err := s.Get(idPng); err != nil || ct != "image/png" || string(b) != "png-bytes" {
		t.Errorf("get png: %v %s", err, ct)
	}
	if _, ct, err := s.Get(idJpg); err != nil || ct != "image/jpeg" {
		t.Errorf("get jpg: %v %s", err, ct)
	}
	if _, _, err := s.Get("missing"); err == nil {
		t.Error("expected error for missing asset")
	}
	if _, _, err := s.Get("../etc"); err == nil {
		t.Error("expected error for unsafe id")
	}
	// NewAssetStore 失敗
	f := filepath.Join(t.TempDir(), "f")
	_ = os.WriteFile(f, []byte("x"), 0o644)
	if _, err := NewAssetStore(filepath.Join(f, "sub")); err == nil {
		t.Error("expected mkdir error")
	}
}

func TestStoreWriteErrors(t *testing.T) {
	root := t.TempDir()
	ts, _ := NewTemplateStore(root)
	as, _ := NewAssetStore(root)
	// 目錄唯讀 → 寫入失敗
	_ = os.Chmod(filepath.Join(root, "templates"), 0o555)
	_ = os.Chmod(filepath.Join(root, "assets"), 0o555)
	t.Cleanup(func() {
		_ = os.Chmod(filepath.Join(root, "templates"), 0o755)
		_ = os.Chmod(filepath.Join(root, "assets"), 0o755)
	})
	if _, _, err := ts.Save([]byte(`{"name":"x"}`), ""); err == nil {
		t.Error("expected template write error")
	}
	if _, err := as.Save([]byte("x"), "image/png"); err == nil {
		t.Error("expected asset write error")
	}
}

func TestListSkipsUnreadable(t *testing.T) {
	root := t.TempDir()
	ts, _ := NewTemplateStore(root)
	id, _, _ := ts.Save([]byte(`{"name":"a"}`), "")
	_ = os.Chmod(filepath.Join(root, "templates", id+".json"), 0o000)
	t.Cleanup(func() { _ = os.Chmod(filepath.Join(root, "templates", id+".json"), 0o644) })
	list, err := ts.List()
	if err != nil || len(list) != 0 {
		t.Errorf("list: %v %d", err, len(list))
	}
}
