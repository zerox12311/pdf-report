package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
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

// TemplateSummary 樣板清單項目。
type TemplateSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	UpdatedAt string `json:"updatedAt"`
}

// ---------- 樣板儲存（raw JSON passthrough） ----------

type TemplateStore struct {
	dir string
	mu  sync.Mutex // 序列化寫入；讀取靠原子 rename 保護，不需鎖
}

func NewTemplateStore(root string) (*TemplateStore, error) {
	dir := filepath.Join(root, "templates")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &TemplateStore{dir: dir}, nil
}

func (s *TemplateStore) path(id string) string { return filepath.Join(s.dir, id+".json") }

// Save 儲存原始 JSON（只改寫 id / updatedAt），schema 其餘欄位原樣保留。
// 數字用 json.Number 保留原始字面（passthrough 不損毀精度）。
func (s *TemplateStore) Save(raw []byte, forceID string) (string, []byte, error) {
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	var doc map[string]any
	if err := dec.Decode(&doc); err != nil {
		return "", nil, fmt.Errorf("樣板 JSON 解析失敗: %w", err)
	}
	id := forceID
	if id == "" {
		id = newID()
	}
	doc["id"] = id
	doc["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
	out, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return "", nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := writeFileAtomic(s.path(id), out); err != nil {
		return "", nil, err
	}
	return id, out, nil
}

func (s *TemplateStore) Get(id string) ([]byte, error) {
	if !SafeID(id) {
		return nil, os.ErrNotExist
	}
	return os.ReadFile(s.path(id))
}

func (s *TemplateStore) Delete(id string) error {
	if !SafeID(id) {
		return os.ErrNotExist
	}
	return os.Remove(s.path(id))
}

func (s *TemplateStore) List() ([]TemplateSummary, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	list := []TemplateSummary{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			continue
		}
		var sum TemplateSummary
		if json.Unmarshal(raw, &sum) == nil && sum.ID != "" {
			list = append(list, sum)
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].UpdatedAt > list[j].UpdatedAt })
	return list, nil
}

// ---------- 圖片儲存 ----------

type AssetStore struct{ dir string }

func NewAssetStore(root string) (*AssetStore, error) {
	dir := filepath.Join(root, "assets")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &AssetStore{dir: dir}, nil
}

func (s *AssetStore) Save(data []byte, contentType string) (string, error) {
	var ext string
	switch contentType {
	case "image/png":
		ext = ".png"
	case "image/jpeg":
		ext = ".jpg"
	default:
		return "", errors.New("僅支援 PNG/JPEG")
	}
	id := newID()
	if err := writeFileAtomic(filepath.Join(s.dir, id+ext), data); err != nil {
		return "", err
	}
	return id, nil
}

func (s *AssetStore) Get(id string) ([]byte, string, error) {
	if !SafeID(id) {
		return nil, "", os.ErrNotExist
	}
	if b, err := os.ReadFile(filepath.Join(s.dir, id+".png")); err == nil {
		return b, "image/png", nil
	}
	if b, err := os.ReadFile(filepath.Join(s.dir, id+".jpg")); err == nil {
		return b, "image/jpeg", nil
	}
	return nil, "", os.ErrNotExist
}

// ---------- 自訂字型儲存 ----------

// FontInfo 已匯入字型的中繼資料。
type FontInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// FontStore 使用者匯入的字型：{id}.ttf 檔 + fonts.json 索引（名稱）。
type FontStore struct {
	dir string
	mu  sync.Mutex
}

func NewFontStore(root string) (*FontStore, error) {
	dir := filepath.Join(root, "fonts")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &FontStore{dir: dir}, nil
}

// Dir 字型檔目錄（引擎掃描用）。
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

// Save 驗檔頭後存檔並更新索引；回傳字型資訊。
func (s *FontStore) Save(name string, data []byte) (FontInfo, error) {
	if !validFontMagic(data) {
		return FontInfo{}, errors.New("僅支援 TTF/OTF 字型檔（檔案內容驗證失敗）")
	}
	if name == "" {
		name = "自訂字型"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := newID()
	if err := writeFileAtomic(filepath.Join(s.dir, id+".ttf"), data); err != nil {
		return FontInfo{}, err
	}
	list, _ := s.readIndex()
	list = append(list, FontInfo{ID: id, Name: name})
	if err := s.writeIndex(list); err != nil {
		return FontInfo{}, err
	}
	return FontInfo{ID: id, Name: name}, nil
}

// List 已匯入字型清單（依索引順序）；索引缺失/損壞視為空清單。
func (s *FontStore) List() []FontInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, _ := s.readIndex()
	return list
}

// Get 字型檔內容。
func (s *FontStore) Get(id string) ([]byte, error) {
	if !SafeID(id) {
		return nil, os.ErrNotExist
	}
	return os.ReadFile(filepath.Join(s.dir, id+".ttf"))
}

func (s *FontStore) readIndex() ([]FontInfo, error) {
	b, err := os.ReadFile(filepath.Join(s.dir, "fonts.json"))
	if err != nil {
		return []FontInfo{}, nil // 無索引 = 空清單
	}
	var list []FontInfo
	if err := json.Unmarshal(b, &list); err != nil {
		return []FontInfo{}, nil
	}
	return list, nil
}

func (s *FontStore) writeIndex(list []FontInfo) error {
	b, err := json.Marshal(list)
	if err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(s.dir, "fonts.json"), b)
}
