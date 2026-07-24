package store

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"

	"pdftemplate/internal/db"
)

// apiKeyPrefix 明文金鑰前綴：讓 middleware 一眼區分「這是 API key」還是「embed token(JWT)」。
const apiKeyPrefix = "pdftpl_"

// APIKeyStore 宿主後端 API key（只存 SHA-256 雜湊；金鑰為高熵隨機值，雜湊可直接索引比對）。
type APIKeyStore struct {
	g *gorm.DB
}

func NewAPIKeyStore(g *gorm.DB) *APIKeyStore { return &APIKeyStore{g: g} }

// APIKeySummary 清單/回應用（不含雜湊、不含明文）。
type APIKeySummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

func hashKey(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// Create 產生一把綁定專案的金鑰，回傳「明文」（只在此刻回一次，之後只存雜湊）與摘要。
func (s *APIKeyStore) Create(tenantID, projectID, name string) (plain string, sum APIKeySummary, err error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "API 金鑰"
	}
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", APIKeySummary{}, err
	}
	plain = apiKeyPrefix + hex.EncodeToString(b)
	row := db.APIKey{ID: newID(), TenantID: tenantID, ProjectID: projectID, Name: name, KeyHash: hashKey(plain)}
	if err = s.g.Create(&row).Error; err != nil {
		return "", APIKeySummary{}, err
	}
	return plain, APIKeySummary{ID: row.ID, Name: row.Name, CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339)}, nil
}

// ListByProject 專案的金鑰清單（依建立時間）。
func (s *APIKeyStore) ListByProject(tenantID, projectID string) ([]APIKeySummary, error) {
	var rows []db.APIKey
	if err := s.g.Where("tenant_id = ? AND project_id = ?", tenantID, projectID).
		Order("created_at").Find(&rows).Error; err != nil {
		return nil, err
	}
	list := make([]APIKeySummary, 0, len(rows))
	for _, r := range rows {
		list = append(list, APIKeySummary{ID: r.ID, Name: r.Name, CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339)})
	}
	return list, nil
}

// Delete 撤銷（依 id，限本租戶）。查無 → os.ErrNotExist。
func (s *APIKeyStore) Delete(tenantID, id string) error {
	if !SafeID(id) {
		return os.ErrNotExist
	}
	res := s.g.Where("id = ? AND tenant_id = ?", id, tenantID).Delete(&db.APIKey{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return os.ErrNotExist
	}
	return nil
}

// Verify 憑明文金鑰查出對應記錄（換 token / 宿主後端請求驗證用）。查無 → nil, os.ErrNotExist。
func (s *APIKeyStore) Verify(plain string) (db.APIKey, error) {
	if !strings.HasPrefix(plain, apiKeyPrefix) {
		return db.APIKey{}, os.ErrNotExist
	}
	var row db.APIKey
	if err := s.g.Where("key_hash = ?", hashKey(plain)).First(&row).Error; err != nil {
		return db.APIKey{}, notFoundAs(err)
	}
	return row, nil
}

// HasAPIKeyPrefix 明文是否為 API key（middleware 用來跟 JWT 區分）。
func HasAPIKeyPrefix(s string) bool { return strings.HasPrefix(s, apiKeyPrefix) }

