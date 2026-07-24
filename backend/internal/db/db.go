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

// DefaultTenantID 目前為單租戶部署，所有資料歸屬此租戶（多租戶 schema 保留給未來）。
const DefaultTenantID = "default"

// DefaultProjectID 控制台預設專案：既有樣板與未指定專案的建立都掛在這。
const DefaultProjectID = "default"

// Tenant 租戶（一個宿主系統一個租戶）。
type Tenant struct {
	ID        string `gorm:"primaryKey;size:64"`
	Name      string `gorm:"size:255;not null"`
	CreatedAt time.Time
}

// 角色：admin 全功能（使用者管理、建/刪專案、全部專案）；user 只在被指派專案內工作。
const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

// User 控制台登入使用者（帳密登入；初始管理員由 env 種）。
// username 在租戶內唯一。密碼只存 bcrypt 雜湊。
type User struct {
	ID           string `gorm:"primaryKey;size:64"`
	TenantID     string `gorm:"size:64;not null;uniqueIndex:idx_user_tenant_username"`
	Username     string `gorm:"size:255;not null;uniqueIndex:idx_user_tenant_username"`
	PasswordHash string `gorm:"size:255;not null"`
	Role         string `gorm:"size:16;not null;default:'user'"`
	CreatedAt    time.Time
}

// Project 專案：租戶底下的 template 分組（JasperReports 式控制台的中間層）。
type Project struct {
	ID        string `gorm:"primaryKey;size:64"`
	TenantID  string `gorm:"size:64;not null;index"`
	Name      string `gorm:"size:255;not null"`
	CreatedAt time.Time
}

// ProjectMember 專案成員：user 角色只看得到自己是成員的專案（admin 不受此限）。
type ProjectMember struct {
	UserID    string `gorm:"size:64;not null;primaryKey"`
	ProjectID string `gorm:"size:64;not null;primaryKey"`
	CreatedAt time.Time
}

// APIKey 宿主後端的 server-to-server 金鑰（只存雜湊）。綁一個專案（v1 只有 project 級）：
// 這把 key 只能在 ProjectID 這個專案內建 template、換 embed token、正式渲染。
type APIKey struct {
	ID        string `gorm:"primaryKey;size:64"`
	TenantID  string `gorm:"size:64;not null;index"`
	ProjectID string `gorm:"size:64;not null;index"`
	Name      string `gorm:"size:255;not null"`
	KeyHash   string `gorm:"size:128;not null;uniqueIndex"`
	CreatedAt time.Time
}

// Template 樣板：完整文件存 JSONB（raw passthrough），Name 冗餘存放供清單查詢。
// ProjectID 為所屬專案（控制台分組用）；既有資料由 migrate 補為 DefaultProjectID。
type Template struct {
	ID        string `gorm:"primaryKey;size:64"`
	TenantID  string `gorm:"size:64;not null;index"`
	ProjectID string `gorm:"size:64;not null;default:'';index"`
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
	if err := g.AutoMigrate(&Tenant{}, &APIKey{}, &User{}, &Project{}, &ProjectMember{}, &Template{}, &Asset{}, &Font{}); err != nil {
		return nil, err
	}
	if err := g.Where(Tenant{ID: DefaultTenantID}).
		FirstOrCreate(&Tenant{ID: DefaultTenantID, Name: "預設租戶"}).Error; err != nil {
		return nil, err
	}
	// 預設專案：既有樣板與未指定專案的建立都掛這；控制台至少有一個專案可用。
	if err := g.Where(Project{ID: DefaultProjectID}).
		FirstOrCreate(&Project{ID: DefaultProjectID, TenantID: DefaultTenantID, Name: "預設專案"}).Error; err != nil {
		return nil, err
	}
	// 既有樣板（升級前無 project_id）補進預設專案。
	if err := g.Model(&Template{}).
		Where("project_id = '' OR project_id IS NULL").
		Update("project_id", DefaultProjectID).Error; err != nil {
		return nil, err
	}
	return g, nil
}
