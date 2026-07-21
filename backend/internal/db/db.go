// Package db：PostgreSQL + GORM 的資料層。
//
// 多租戶模型：所有業務資料掛在 tenant 底下（API 層依認證解析租戶；
// 認證上線前一律落在 DefaultTenantID）。二進位檔（圖片/字型）留在檔案系統，
// DB 只存中繼資料——之後多實例部署再改物件儲存。
package db

import (
	"errors"
	"time"

	"gorm.io/datatypes"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// DefaultTenantID 認證未上線前所有資料歸屬的租戶。
const DefaultTenantID = "default"

// Tenant 租戶（一個宿主系統一個租戶）。
type Tenant struct {
	ID        string `gorm:"primaryKey;size:64"`
	Name      string `gorm:"size:255;not null"`
	CreatedAt time.Time
}

// APIKey 宿主後端的 server-to-server 金鑰（只存雜湊）。
// 認證 middleware 下一階段掛上；schema 先鋪好。
type APIKey struct {
	ID        string `gorm:"primaryKey;size:64"`
	TenantID  string `gorm:"size:64;not null;index"`
	Name      string `gorm:"size:255;not null"`
	KeyHash   string `gorm:"size:128;not null;uniqueIndex"`
	CreatedAt time.Time
}

// Template 樣板：完整文件存 JSONB（raw passthrough），Name 冗餘存放供清單查詢。
type Template struct {
	ID        string `gorm:"primaryKey;size:64"`
	TenantID  string `gorm:"size:64;not null;index"`
	Name      string `gorm:"size:255;not null"`
	Doc       datatypes.JSON `gorm:"not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Asset 上傳圖片的中繼資料（檔案在 storage/assets/{id}.png|jpg）。
type Asset struct {
	ID          string `gorm:"primaryKey;size:64"`
	TenantID    string `gorm:"size:64;not null;index"`
	ContentType string `gorm:"size:64;not null"`
	CreatedAt   time.Time
}

// Font 使用者匯入字型的中繼資料（檔案在 storage/fonts/{id}.ttf）。
type Font struct {
	ID        string `gorm:"primaryKey;size:64"`
	TenantID  string `gorm:"size:64;not null;index"`
	Name      string `gorm:"size:255;not null"`
	CreatedAt time.Time
}

// Open 連線 PostgreSQL（DATABASE_URL），並完成 migrate 與預設租戶。
func Open(databaseURL string) (*gorm.DB, error) {
	if databaseURL == "" {
		return nil, errors.New("DATABASE_URL 未設定（本機開發可先 docker compose up -d db，連 postgres://pdftpl:pdftpl@localhost:5442/pdftpl?sslmode=disable）")
	}
	g, err := gorm.Open(postgres.Open(databaseURL), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, err
	}
	if err := g.AutoMigrate(&Tenant{}, &APIKey{}, &Template{}, &Asset{}, &Font{}); err != nil {
		return nil, err
	}
	if err := g.Where(Tenant{ID: DefaultTenantID}).
		FirstOrCreate(&Tenant{ID: DefaultTenantID, Name: "預設租戶"}).Error; err != nil {
		return nil, err
	}
	return g, nil
}
