package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

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

func TestPatchDocDB(t *testing.T) {
	g := testdb.Open(t)
	s := NewTemplateStore(g)
	const tid = db.DefaultTenantID

	id, _, err := s.Save(tid, "", []byte(`{"name":"n","v":1,"keep":{"deep":"x"}}`), "")
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	// 套用成功：只動指定欄位，其餘（含巢狀）原樣保留
	out, err := s.PatchDoc(tid, id, func(doc map[string]any) error {
		doc["name"] = "patched"
		return nil
	})
	if err != nil {
		t.Fatalf("patch: %v", err)
	}
	if !strings.Contains(string(out), `"patched"`) || !strings.Contains(string(out), `"deep":"x"`) {
		t.Errorf("patch result: %s", out)
	}
	back, _ := s.Get(tid, id)
	if !strings.Contains(string(back), `"patched"`) {
		t.Errorf("未落 DB: %s", back)
	}

	// mutate 回錯 → 交易 rollback，DB 不變（錯誤原樣傳回供 handler 分類）
	sentinel := errors.New("nope")
	if _, err := s.PatchDoc(tid, id, func(doc map[string]any) error {
		doc["name"] = "should-not-persist"
		return sentinel
	}); !errors.Is(err, sentinel) {
		t.Errorf("err = %v, want sentinel", err)
	}
	back, _ = s.Get(tid, id)
	if strings.Contains(string(back), "should-not-persist") {
		t.Error("mutate 失敗時不該寫入")
	}

	// 不存在 / 不合法 id → os.ErrNotExist
	for _, bad := range []string{"ghost", "a/b"} {
		if _, err := s.PatchDoc(tid, bad, func(map[string]any) error { return nil }); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("PatchDoc(%q) = %v, want ErrNotExist", bad, err)
		}
	}

	// 並行 PatchDoc：列鎖序列化，每筆都不可遺失（無鎖時後者會覆蓋前者）
	id2, _, _ := s.Save(tid, "", []byte(`{"name":"c","n":0}`), "")
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(k int) {
			defer wg.Done()
			_, _ = s.PatchDoc(tid, id2, func(doc map[string]any) error {
				doc["f"+strconv.Itoa(k)] = "v"
				return nil
			})
		}(i)
	}
	wg.Wait()
	final, _ := s.Get(tid, id2)
	doc, err := DecodeDoc(final)
	if err != nil {
		t.Fatalf("decode final: %v", err)
	}
	for i := 0; i < 8; i++ {
		if doc["f"+strconv.Itoa(i)] != "v" {
			t.Errorf("並行寫入遺失 f%d：%s", i, final)
		}
	}
}

// TestPatchDocLockTimeout 等不到列鎖 → ErrLocked（而不是無限期卡住）。
// 沒有這個上限的話，填寫者持續 PATCH 會讓設計者的存檔一直排隊。
func TestPatchDocLockTimeout(t *testing.T) {
	g := testdb.Open(t)
	s := NewTemplateStore(g)
	const tid = db.DefaultTenantID

	id, _, err := s.Save(tid, "", []byte(`{"name":"n"}`), "")
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	old := LockWaitTimeout
	LockWaitTimeout = "150ms"
	defer func() { LockWaitTimeout = old }()

	// 另一個交易先抓住該列的鎖並持有，直到本測試放行
	held := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = g.Transaction(func(tx *gorm.DB) error {
			var row db.Template
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ? AND tenant_id = ?", id, tid).First(&row).Error; err != nil {
				return err
			}
			close(held)
			<-release
			return nil
		})
	}()
	<-held

	start := time.Now()
	_, err = s.PatchDoc(tid, id, func(doc map[string]any) error {
		doc["name"] = "blocked"
		return nil
	})
	elapsed := time.Since(start)
	close(release)
	<-done

	if !errors.Is(err, ErrLocked) {
		t.Fatalf("等鎖逾時應回 ErrLocked，得到 %v", err)
	}
	if elapsed > 2*time.Second {
		t.Errorf("等太久（%v）：lock_timeout 未生效", elapsed)
	}
	// 逾時的那次不得留下任何寫入
	back, _ := s.Get(tid, id)
	if strings.Contains(string(back), "blocked") {
		t.Errorf("逾時仍寫入: %s", back)
	}

	// 鎖放掉後同樣的呼叫要成功（桶/連線沒被逾時弄壞）
	if _, err := s.PatchDoc(tid, id, func(doc map[string]any) error {
		doc["name"] = "after"
		return nil
	}); err != nil {
		t.Fatalf("鎖釋放後仍失敗: %v", err)
	}
}

// TestSaveLockTimeout 設計者的存檔撞上填值持有的列鎖時，也是回 ErrLocked（→ 409），不無界等待。
func TestSaveLockTimeout(t *testing.T) {
	g := testdb.Open(t)
	s := NewTemplateStore(g)
	const tid = db.DefaultTenantID

	id, _, err := s.Save(tid, "", []byte(`{"name":"n"}`), "")
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	old := LockWaitTimeout
	LockWaitTimeout = "150ms"
	defer func() { LockWaitTimeout = old }()

	held := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = g.Transaction(func(tx *gorm.DB) error {
			var row db.Template
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ? AND tenant_id = ?", id, tid).First(&row).Error; err != nil {
				return err
			}
			close(held)
			<-release
			return nil
		})
	}()
	<-held

	_, _, err = s.Save(tid, "", []byte(`{"name":"designer"}`), id)
	close(release)
	<-done

	if !errors.Is(err, ErrLocked) {
		t.Fatalf("Save 等鎖逾時應回 ErrLocked，得到 %v", err)
	}
}

// TestDecodeDocKeepsNumberLiterals 金額字面不得被浮點改寫（Save 與 PatchDoc 共用這一份解析）。
func TestDecodeDocKeepsNumberLiterals(t *testing.T) {
	doc, err := DecodeDoc([]byte(`{"w":595.28,"h":841.89,"big":12345678901234567890,"amt":1.10}`))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	out, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, want := range []string{"595.28", "841.89", "12345678901234567890", "1.10"} {
		if !strings.Contains(string(out), want) {
			t.Errorf("數字字面 %s 被改寫: %s", want, out)
		}
	}
}
