// Package store：業務資料存取層。
// 結構化資料（樣板 JSONB、圖片/字型中繼資料）走 PostgreSQL/GORM，
// 二進位檔（圖片/字型）留檔案系統（storage/），全部按租戶隔離。
package store

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"pdftemplate/internal/db"
)

// ErrLocked 等不到列鎖（同一張樣板正被另一個寫入交易持有）。呼叫端應回 409 讓客戶端重試，
// 而不是讓請求無限期卡著——「渲染錯誤不靜默」同樣適用於寫入路徑。
var ErrLocked = errors.New("樣板正在被其他請求修改，請稍後再試")

// LockWaitTimeout 交易內等列鎖的上限。填寫模式的 PATCH 會序列化同一張樣板的寫入，
// 設計者的存檔不該因此無界等待。var 而非 const：測試調短它才不必真的等 3 秒。
var LockWaitTimeout = "3s"

// beginLocked 開一段有等鎖上限的交易前置：SET LOCAL 只在本交易有效，不污染連線池裡的連線。
func beginLocked(tx *gorm.DB) error {
	return tx.Exec("SET LOCAL lock_timeout TO '" + LockWaitTimeout + "'").Error
}

// lockedAs 把 Postgres 的 lock_timeout（SQLSTATE 55P03）轉成 ErrLocked，其餘原樣傳回。
func lockedAs(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "55P03" {
		return ErrLocked
	}
	return err
}

// writeFileAtomic 先寫同目錄 temp 檔再 rename（同一 filesystem 的 rename 是原子的），
// 避免讀取端看到寫到一半的檔案。
func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return nil
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func SafeID(id string) bool {
	if id == "" || strings.ContainsAny(id, "/\\.") {
		return false
	}
	return true
}

// notFoundAs 把 GORM 的 record-not-found 統一轉成 os.ErrNotExist（httpapi 以此分類 404）。
func notFoundAs(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return os.ErrNotExist
	}
	return err
}

// TemplateSummary 樣板清單項目。
type TemplateSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	UpdatedAt string `json:"updatedAt"`
}

// ---------- 樣板儲存（raw JSON passthrough → JSONB） ----------

type TemplateStore struct {
	g *gorm.DB
}

func NewTemplateStore(g *gorm.DB) *TemplateStore {
	return &TemplateStore{g: g}
}

// Save 儲存原始 JSON（只改寫 id / updatedAt），schema 其餘欄位原樣保留。
// 數字用 json.Number 保留原始字面（passthrough 不損毀精度）。
// projectID 為所屬專案（空 → DefaultProjectID）；僅在建立時寫入，更新時不動既有專案歸屬。
func (s *TemplateStore) Save(tenantID, projectID string, raw []byte, forceID string) (string, []byte, error) {
	doc, err := DecodeDoc(raw)
	if err != nil {
		return "", nil, errors.New("樣板 JSON 解析失敗（body 需為樣板 JSON 物件）")
	}
	if projectID == "" {
		projectID = db.DefaultProjectID
	}
	id := forceID
	if id == "" {
		id = newID()
	}
	now := time.Now().UTC()
	doc["id"] = id
	doc["updatedAt"] = now.Format(time.RFC3339)
	out, err := json.Marshal(doc)
	if err != nil {
		return "", nil, err
	}
	name, _ := doc["name"].(string)

	// upsert by (id, tenant)：既有 → 只更新 name/doc/updated_at（保留原 project_id、created_at）；
	// 不存在 → 建立。改用明確 find → Updates/Create（FirstOrCreate+Assign 在 found 分支不會發 UPDATE，會漏存）。
	// 整段包在交易內並設等鎖上限：這個 UPDATE 會撞上 PatchDoc 持有的列鎖，等不到就回 ErrLocked（409），
	// 不讓設計者的存檔無界卡住。
	err = s.g.Transaction(func(tx *gorm.DB) error {
		if err := beginLocked(tx); err != nil {
			return err
		}
		var existing db.Template
		findErr := tx.Select("id").Where("id = ? AND tenant_id = ?", id, tenantID).First(&existing).Error
		switch {
		case findErr == nil:
			return lockedAs(tx.Model(&db.Template{}).Where("id = ? AND tenant_id = ?", id, tenantID).
				Updates(map[string]any{"name": name, "doc": datatypes.JSON(out), "updated_at": now}).Error)
		case errors.Is(findErr, gorm.ErrRecordNotFound):
			row := db.Template{ID: id, TenantID: tenantID, ProjectID: projectID, Name: name, Doc: datatypes.JSON(out), CreatedAt: now, UpdatedAt: now}
			return lockedAs(tx.Create(&row).Error)
		default:
			return lockedAs(findErr)
		}
	})
	if err != nil {
		return "", nil, err
	}
	return id, out, nil
}

// PatchDoc 在**單一交易內**讀取→套用→寫回，並以 SELECT … FOR UPDATE 鎖住該列。
//
// 為什麼需要：填寫模式的 PATCH /values 是伺服器端的 read-modify-write（讀出整份 doc、
// 改一個字串、整份寫回）。沒有鎖的話，設計者的 PUT 只要落在讀與寫之間就會被整份覆寫
// 回捲 —— 設計者收到 200 但改動消失，甚至「剛撤銷的 fillable」會被還原（等於收不回權限）。
//
// mutate 回傳的錯誤原樣往外傳（呼叫端據此分類 403/400），此時交易 rollback、不寫入。
func (s *TemplateStore) PatchDoc(tenantID, id string, mutate func(doc map[string]any) error) ([]byte, error) {
	if !SafeID(id) {
		return nil, os.ErrNotExist
	}
	var out []byte
	err := s.g.Transaction(func(tx *gorm.DB) error {
		if err := beginLocked(tx); err != nil {
			return err
		}
		var row db.Template
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND tenant_id = ?", id, tenantID).First(&row).Error; err != nil {
			return notFoundAs(lockedAs(err))
		}
		doc, err := DecodeDoc(row.Doc)
		if err != nil {
			return err
		}
		if err := mutate(doc); err != nil {
			return err
		}
		now := time.Now().UTC()
		doc["id"] = id
		doc["updatedAt"] = now.Format(time.RFC3339)
		raw, err := json.Marshal(doc)
		if err != nil {
			return err
		}
		// 只更新內容與時間：name/project_id 不由填值路徑改動
		if err := tx.Model(&db.Template{}).Where("id = ? AND tenant_id = ?", id, tenantID).
			Updates(map[string]any{"doc": datatypes.JSON(raw), "updated_at": now}).Error; err != nil {
			return err
		}
		out = raw
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// DecodeDoc 解析樣板 JSON 成 map；數字用 json.Number 保留原始字面（金額不因浮點失真）。
// 儲存與填值路徑共用這一份——之前有三份相同實作，任一份漏掉 UseNumber 都不會被測試抓到。
func DecodeDoc(raw []byte) (map[string]any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var doc map[string]any
	if err := dec.Decode(&doc); err != nil {
		return nil, err
	}
	return doc, nil
}

func (s *TemplateStore) Get(tenantID, id string) ([]byte, error) {
	if !SafeID(id) {
		return nil, os.ErrNotExist
	}
	var row db.Template
	if err := s.g.Where("id = ? AND tenant_id = ?", id, tenantID).First(&row).Error; err != nil {
		return nil, notFoundAs(err)
	}
	return row.Doc, nil
}

// ProjectOf 取樣板所屬專案 id（授權 chokepoint 用；查無 → os.ErrNotExist）。
func (s *TemplateStore) ProjectOf(tenantID, id string) (string, error) {
	if !SafeID(id) {
		return "", os.ErrNotExist
	}
	var row db.Template
	if err := s.g.Select("project_id").Where("id = ? AND tenant_id = ?", id, tenantID).First(&row).Error; err != nil {
		return "", notFoundAs(err)
	}
	return row.ProjectID, nil
}

func (s *TemplateStore) Delete(tenantID, id string) error {
	if !SafeID(id) {
		return os.ErrNotExist
	}
	res := s.g.Where("id = ? AND tenant_id = ?", id, tenantID).Delete(&db.Template{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return os.ErrNotExist
	}
	return nil
}

func (s *TemplateStore) List(tenantID string) ([]TemplateSummary, error) {
	var rows []db.Template
	if err := s.g.Select("id", "name", "updated_at").
		Where("tenant_id = ?", tenantID).
		Order("updated_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	list := make([]TemplateSummary, 0, len(rows))
	for _, r := range rows {
		list = append(list, TemplateSummary{
			ID: r.ID, Name: r.Name, UpdatedAt: r.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	return list, nil
}

// ListInProject 專案內的樣板清單（控制台專案頁用）。
func (s *TemplateStore) ListInProject(tenantID, projectID string) ([]TemplateSummary, error) {
	var rows []db.Template
	if err := s.g.Select("id", "name", "updated_at").
		Where("tenant_id = ? AND project_id = ?", tenantID, projectID).
		Order("updated_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	list := make([]TemplateSummary, 0, len(rows))
	for _, r := range rows {
		list = append(list, TemplateSummary{
			ID: r.ID, Name: r.Name, UpdatedAt: r.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	return list, nil
}

// ListInProjects 多個專案的樣板清單（扁平清單依 user 可存取專案過濾用）。空集合 → 空清單。
func (s *TemplateStore) ListInProjects(tenantID string, projectIDs []string) ([]TemplateSummary, error) {
	if len(projectIDs) == 0 {
		return []TemplateSummary{}, nil
	}
	var rows []db.Template
	if err := s.g.Select("id", "name", "updated_at").
		Where("tenant_id = ? AND project_id IN (?)", tenantID, projectIDs).
		Order("updated_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	list := make([]TemplateSummary, 0, len(rows))
	for _, r := range rows {
		list = append(list, TemplateSummary{
			ID: r.ID, Name: r.Name, UpdatedAt: r.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	return list, nil
}

// ---------- 圖片儲存（檔案 + DB 中繼資料） ----------

type AssetStore struct {
	g   *gorm.DB
	dir string
}

func NewAssetStore(g *gorm.DB, root string) (*AssetStore, error) {
	dir := filepath.Join(root, "assets")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &AssetStore{g: g, dir: dir}, nil
}

func extOf(contentType string) (string, error) {
	switch contentType {
	case "image/png":
		return ".png", nil
	case "image/jpeg":
		return ".jpg", nil
	}
	return "", errors.New("僅支援 PNG/JPEG")
}

func (s *AssetStore) Save(tenantID string, data []byte, contentType string) (string, error) {
	ext, err := extOf(contentType)
	if err != nil {
		return "", err
	}
	id := newID()
	if err := writeFileAtomic(filepath.Join(s.dir, id+ext), data); err != nil {
		return "", err
	}
	if err := s.g.Create(&db.Asset{ID: id, TenantID: tenantID, ContentType: contentType}).Error; err != nil {
		return "", err
	}
	return id, nil
}

func (s *AssetStore) Get(tenantID, id string) ([]byte, string, error) {
	if !SafeID(id) {
		return nil, "", os.ErrNotExist
	}
	var row db.Asset
	if err := s.g.Where("id = ? AND tenant_id = ?", id, tenantID).First(&row).Error; err != nil {
		return nil, "", notFoundAs(err)
	}
	ext, err := extOf(row.ContentType)
	if err != nil {
		return nil, "", os.ErrNotExist
	}
	b, err := os.ReadFile(filepath.Join(s.dir, id+ext))
	if err != nil {
		return nil, "", err
	}
	return b, row.ContentType, nil
}

// EngineSource 給渲染引擎的圖片來源：僅憑 id 取檔。
// id 是 128-bit 隨機值（不可枚舉），且樣板本身已按租戶隔離，
// 引擎層不再重複帶租戶（渲染的樣板引用哪張圖就取哪張）。
type engineSource struct{ s *AssetStore }

func (e engineSource) Get(id string) ([]byte, string, error) {
	if !SafeID(id) {
		return nil, "", os.ErrNotExist
	}
	var row db.Asset
	if err := e.s.g.Where("id = ?", id).First(&row).Error; err != nil {
		return nil, "", notFoundAs(err)
	}
	ext, err := extOf(row.ContentType)
	if err != nil {
		return nil, "", os.ErrNotExist
	}
	b, err := os.ReadFile(filepath.Join(e.s.dir, id+ext))
	if err != nil {
		return nil, "", err
	}
	return b, row.ContentType, nil
}

func (s *AssetStore) EngineSource() engineSource { return engineSource{s: s} }

// ---------- 自訂字型儲存（檔案 + DB 中繼資料） ----------

// FontInfo 已匯入字型的中繼資料。
type FontInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type FontStore struct {
	g   *gorm.DB
	dir string
}

func NewFontStore(g *gorm.DB, root string) (*FontStore, error) {
	dir := filepath.Join(root, "fonts")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &FontStore{g: g, dir: dir}, nil
}

// Dir 字型檔目錄（引擎掃描用；字型 id 全域唯一，租戶隔離在 API 層）。
func (s *FontStore) Dir() string { return s.dir }

// validFontMagic TTF/OTF 檔頭：sfnt 0x00010000、'OTTO'、'true'、'ttcf'。
func validFontMagic(data []byte) bool {
	if len(data) < 4 {
		return false
	}
	switch string(data[:4]) {
	case "\x00\x01\x00\x00", "OTTO", "true", "ttcf":
		return true
	}
	return false
}

// Save 驗檔頭後存檔並寫入中繼資料。
func (s *FontStore) Save(tenantID, name string, data []byte) (FontInfo, error) {
	if !validFontMagic(data) {
		return FontInfo{}, errors.New("僅支援 TTF/OTF 字型檔（檔案內容驗證失敗）")
	}
	if name == "" {
		name = "自訂字型"
	}
	id := newID()
	if err := writeFileAtomic(filepath.Join(s.dir, id+".ttf"), data); err != nil {
		return FontInfo{}, err
	}
	if err := s.g.Create(&db.Font{ID: id, TenantID: tenantID, Name: name}).Error; err != nil {
		return FontInfo{}, err
	}
	return FontInfo{ID: id, Name: name}, nil
}

// List 已匯入字型清單（依建立時間）。
func (s *FontStore) List(tenantID string) ([]FontInfo, error) {
	var rows []db.Font
	if err := s.g.Where("tenant_id = ?", tenantID).Order("created_at").Find(&rows).Error; err != nil {
		return nil, err
	}
	list := make([]FontInfo, 0, len(rows))
	for _, r := range rows {
		list = append(list, FontInfo{ID: r.ID, Name: r.Name})
	}
	return list, nil
}

// Get 字型檔內容（先過租戶檢查再讀檔）。
func (s *FontStore) Get(tenantID, id string) ([]byte, error) {
	if !SafeID(id) {
		return nil, os.ErrNotExist
	}
	var row db.Font
	if err := s.g.Where("id = ? AND tenant_id = ?", id, tenantID).First(&row).Error; err != nil {
		return nil, notFoundAs(err)
	}
	return os.ReadFile(filepath.Join(s.dir, id+".ttf"))
}

// ---------- 舊檔案儲存的一次性匯入 ----------

// ImportLegacy 把檔案系統時代的資料匯進 DB（歸 default 租戶）：
// templates/*.json、fonts/fonts.json 索引、assets/ 目錄下的圖檔。
// 只在對應資料表為空時執行，安全可重跑。
func ImportLegacy(g *gorm.DB, root string) error {
	// 樣板
	var n int64
	if err := g.Model(&db.Template{}).Count(&n).Error; err != nil {
		return err
	}
	if n == 0 {
		entries, _ := os.ReadDir(filepath.Join(root, "templates"))
		ts := NewTemplateStore(g)
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			raw, err := os.ReadFile(filepath.Join(root, "templates", e.Name()))
			if err != nil {
				continue
			}
			id := strings.TrimSuffix(e.Name(), ".json")
			if _, _, err := ts.Save(db.DefaultTenantID, db.DefaultProjectID, raw, id); err != nil {
				return fmt.Errorf("匯入舊樣板 %s: %w", id, err)
			}
		}
	}
	// 字型（舊 fonts.json 索引）
	if err := g.Model(&db.Font{}).Count(&n).Error; err != nil {
		return err
	}
	if n == 0 {
		if b, err := os.ReadFile(filepath.Join(root, "fonts", "fonts.json")); err == nil {
			var list []FontInfo
			if json.Unmarshal(b, &list) == nil {
				for _, f := range list {
					_ = g.Create(&db.Font{ID: f.ID, TenantID: db.DefaultTenantID, Name: f.Name}).Error
				}
			}
		}
	}
	// 圖片（掃目錄）
	if err := g.Model(&db.Asset{}).Count(&n).Error; err != nil {
		return err
	}
	if n == 0 {
		entries, _ := os.ReadDir(filepath.Join(root, "assets"))
		for _, e := range entries {
			name := e.Name()
			var ct string
			switch {
			case strings.HasSuffix(name, ".png"):
				ct = "image/png"
			case strings.HasSuffix(name, ".jpg"):
				ct = "image/jpeg"
			default:
				continue
			}
			id := name[:len(name)-4]
			_ = g.Create(&db.Asset{ID: id, TenantID: db.DefaultTenantID, ContentType: ct}).Error
		}
	}
	return nil
}
