// Package store：業務資料存取層。
// 結構化資料（樣板 JSONB、圖片/字型中繼資料）走 PostgreSQL/GORM，
// 二進位檔（圖片/字型）留檔案系統（storage/），全部按租戶隔離。
package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"

	"pdftemplate/internal/db"
)

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
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	var doc map[string]any
	if err := dec.Decode(&doc); err != nil {
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
	// ProjectID 只放在建立用的 struct，不進 Assign map → 更新既有樣板時保留原專案。
	row := db.Template{ID: id, TenantID: tenantID, ProjectID: projectID, Name: name, Doc: out, UpdatedAt: now}
	err = s.g.Where("id = ? AND tenant_id = ?", id, tenantID).
		Assign(map[string]any{"name": name, "doc": out, "updated_at": now}).
		FirstOrCreate(&row).Error
	if err != nil {
		return "", nil, err
	}
	return id, out, nil
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
