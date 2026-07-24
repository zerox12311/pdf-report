package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"pdftemplate/internal/db"
	"pdftemplate/internal/testdb"
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

func TestValidFontMagic(t *testing.T) {
	if !validFontMagic([]byte("\x00\x01\x00\x00rest")) || !validFontMagic([]byte("OTTOxxxx")) {
		t.Error("真字型檔頭應通過")
	}
	if validFontMagic([]byte("not")) || validFontMagic([]byte("GIF89a")) {
		t.Error("非字型檔頭應拒絕")
	}
}

func TestTemplateStoreDB(t *testing.T) {
	g := testdb.Open(t)
	s := NewTemplateStore(g)
	const tid = db.DefaultTenantID

	// Save 壞 JSON
	if _, _, err := s.Save(tid, "", []byte("{bad"), ""); err == nil {
		t.Error("expected error for bad json")
	}
	// Save / Get / List / Delete（passthrough：未知欄位保留）
	id, out, err := s.Save(tid, "", []byte(`{"name":"n","futureField":{"x":1.50}}`), "")
	if err != nil || id == "" || !strings.Contains(string(out), `"updatedAt"`) {
		t.Fatalf("save: %v %s", err, out)
	}
	raw, err := s.Get(tid, id)
	if err != nil || !strings.Contains(string(raw), `"futureField"`) || !strings.Contains(string(raw), "1.50") {
		t.Fatalf("passthrough 保留未知欄位與數字字面: %v %s", err, raw)
	}
	if _, err := s.Get(tid, "../etc"); err == nil {
		t.Error("expected error for unsafe id")
	}
	list, err := s.List(tid)
	if err != nil || len(list) != 1 || list[0].Name != "n" {
		t.Fatalf("list: %v %+v", err, list)
	}
	// 更新（同 id 覆寫）
	if _, _, err := s.Save(tid, "", []byte(`{"name":"n2"}`), id); err != nil {
		t.Fatal(err)
	}
	list, _ = s.List(tid)
	if len(list) != 1 || list[0].Name != "n2" {
		t.Fatalf("update should overwrite: %+v", list)
	}
	// 租戶隔離：另一租戶看不到
	_ = g.Create(&db.Tenant{ID: "other", Name: "other"}).Error
	if _, err := s.Get("other", id); err == nil {
		t.Error("跨租戶不應讀得到")
	}
	if l, _ := s.List("other"); len(l) != 0 {
		t.Error("跨租戶清單應為空")
	}
	// Delete
	if err := s.Delete(tid, id); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(tid, id); err == nil {
		t.Error("刪除不存在應回錯誤")
	}
}

func TestFontAndAssetStoresDB(t *testing.T) {
	g := testdb.Open(t)
	root := t.TempDir()
	const tid = db.DefaultTenantID

	fonts, err := NewFontStore(g, root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fonts.Save(tid, "x", []byte("junk")); err == nil {
		t.Error("壞字型檔應拒絕")
	}
	info, err := fonts.Save(tid, "測試字型", []byte("\x00\x01\x00\x00data"))
	if err != nil {
		t.Fatal(err)
	}
	list, err := fonts.List(tid)
	if err != nil || len(list) != 1 || list[0].Name != "測試字型" {
		t.Fatalf("font list: %v %+v", err, list)
	}
	if b, err := fonts.Get(tid, info.ID); err != nil || len(b) == 0 {
		t.Fatalf("font get: %v", err)
	}
	if _, err := fonts.Get("other-tenant", info.ID); err == nil {
		t.Error("跨租戶字型不應讀得到")
	}

	assets, err := NewAssetStore(g, root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := assets.Save(tid, []byte("x"), "image/gif"); err == nil {
		t.Error("不支援的型別應拒絕")
	}
	id, err := assets.Save(tid, []byte("png-bytes"), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if b, ct, err := assets.Get(tid, id); err != nil || ct != "image/png" || len(b) == 0 {
		t.Fatalf("asset get: %v %s", err, ct)
	}
	// 引擎來源：僅憑 id 取檔
	if b, _, err := assets.EngineSource().Get(id); err != nil || len(b) == 0 {
		t.Fatalf("engine source: %v", err)
	}
	if _, _, err := assets.EngineSource().Get("nope"); err == nil {
		t.Error("不存在的 id 應回錯誤")
	}
}

func TestImportLegacy(t *testing.T) {
	g := testdb.Open(t)
	root := t.TempDir()
	// 準備舊檔案儲存：templates/*.json、fonts/fonts.json、assets/*.png
	_ = os.MkdirAll(filepath.Join(root, "templates"), 0o755)
	_ = os.MkdirAll(filepath.Join(root, "fonts"), 0o755)
	_ = os.MkdirAll(filepath.Join(root, "assets"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "templates", "t1.json"), []byte(`{"id":"t1","name":"舊樣板"}`), 0o644)
	_ = os.WriteFile(filepath.Join(root, "fonts", "fonts.json"), []byte(`[{"id":"f1","name":"舊字型"}]`), 0o644)
	_ = os.WriteFile(filepath.Join(root, "assets", "a1.png"), []byte("png"), 0o644)

	if err := ImportLegacy(g, root); err != nil {
		t.Fatal(err)
	}
	ts := NewTemplateStore(g)
	if raw, err := ts.Get(db.DefaultTenantID, "t1"); err != nil || !strings.Contains(string(raw), "舊樣板") {
		t.Fatalf("樣板應匯入: %v", err)
	}
	fonts, _ := NewFontStore(g, root)
	if l, _ := fonts.List(db.DefaultTenantID); len(l) != 1 || l[0].ID != "f1" {
		t.Fatalf("字型索引應匯入: %+v", l)
	}
	// 可重跑（表非空 → 跳過，不報錯不重複）
	if err := ImportLegacy(g, root); err != nil {
		t.Fatal(err)
	}
	if l, _ := fonts.List(db.DefaultTenantID); len(l) != 1 {
		t.Error("重跑不應重複匯入")
	}
}
