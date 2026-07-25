package store

import (
	"errors"
	"log"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"pdftemplate/internal/db"
)

// ---------- 使用者（控制台登入） ----------

type UserStore struct {
	g *gorm.DB
}

func NewUserStore(g *gorm.DB) *UserStore { return &UserStore{g: g} }

// Count 使用者總數（種初始管理員前判斷用）。
func (s *UserStore) Count() (int64, error) {
	var n int64
	err := s.g.Model(&db.User{}).Count(&n).Error
	return n, err
}

// GetByUsername 依租戶 + 帳號取使用者（登入用）。查無 → os.ErrNotExist。
func (s *UserStore) GetByUsername(tenantID, username string) (db.User, error) {
	var u db.User
	if err := s.g.Where("tenant_id = ? AND username = ?", tenantID, username).First(&u).Error; err != nil {
		return db.User{}, notFoundAs(err)
	}
	return u, nil
}

// GetByID 依 id 取使用者（/me、改密碼用）。查無 → os.ErrNotExist。
func (s *UserStore) GetByID(id string) (db.User, error) {
	var u db.User
	if err := s.g.Where("id = ?", id).First(&u).Error; err != nil {
		return db.User{}, notFoundAs(err)
	}
	return u, nil
}

// Create 建立使用者（密碼以 bcrypt 雜湊）。role 空 → user。
func (s *UserStore) Create(tenantID, username, password, role string) (db.User, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return db.User{}, errors.New("帳號不可為空")
	}
	if password == "" {
		return db.User{}, errors.New("密碼不可為空")
	}
	role = normalizeRole(role)
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return db.User{}, err
	}
	u := db.User{ID: newID(), TenantID: tenantID, Username: username, PasswordHash: string(hash), Role: role}
	if err := s.g.Create(&u).Error; err != nil {
		return db.User{}, err
	}
	return u, nil
}

// normalizeRole 只認 admin/user，其餘一律 user。
func normalizeRole(role string) string {
	if role == db.RoleAdmin {
		return db.RoleAdmin
	}
	return db.RoleUser
}

// UserSummary 使用者清單項目（不含密碼）。
type UserSummary struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

// List 使用者清單（依建立時間）。
func (s *UserStore) List(tenantID string) ([]UserSummary, error) {
	var rows []db.User
	if err := s.g.Where("tenant_id = ?", tenantID).Order("created_at").Find(&rows).Error; err != nil {
		return nil, err
	}
	list := make([]UserSummary, 0, len(rows))
	for _, r := range rows {
		list = append(list, UserSummary{ID: r.ID, Username: r.Username, Role: r.Role})
	}
	return list, nil
}

// SetRole 改角色。
func (s *UserStore) SetRole(id, role string) error {
	return s.g.Model(&db.User{}).Where("id = ?", id).Update("role", normalizeRole(role)).Error
}

// Delete 刪除使用者（連同其專案成員資格）。
func (s *UserStore) Delete(id string) error {
	return s.g.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", id).Delete(&db.ProjectMember{}).Error; err != nil {
			return err
		}
		res := tx.Where("id = ?", id).Delete(&db.User{})
		if res.Error != nil {
			return res.Error
		}
		return nil
	})
}

// CountAdmins admin 人數（防刪/降最後一個 admin）。
func (s *UserStore) CountAdmins(tenantID string) (int64, error) {
	var n int64
	err := s.g.Model(&db.User{}).Where("tenant_id = ? AND role = ?", tenantID, db.RoleAdmin).Count(&n).Error
	return n, err
}

// VerifyPassword 比對明文密碼與雜湊。
func VerifyPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// SetPassword 更新使用者密碼（改密碼用）。
func (s *UserStore) SetPassword(id, password string) error {
	if password == "" {
		return errors.New("密碼不可為空")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.g.Model(&db.User{}).Where("id = ?", id).Update("password_hash", string(hash)).Error
}

// SeedAdmin 開機時確保有一個管理員：
//   - user 表為空 → 用 env 帳密種一個 admin（env 未設退回 admin/admin 並警告）。
//   - 已有使用者但無任何 admin（例如升級前種的帳號 role 被 default 成 user）→ 自癒：
//     優先把 env ADMIN_USER 提升為 admin，否則提升最早建立的使用者。
//     不覆寫既有密碼（改完密碼重啟不會被打回）。
func SeedAdmin(g *gorm.DB, username, password string) error {
	s := NewUserStore(g)
	n, err := s.Count()
	if err != nil {
		return err
	}
	if n == 0 {
		if username == "" {
			username = "admin"
		}
		if password == "" {
			password = "admin"
			log.Printf("警告：未設定 ADMIN_PASSWORD，初始管理員密碼為預設 admin，請登入後立即修改")
		}
		if _, err := s.Create(db.DefaultTenantID, username, password, db.RoleAdmin); err != nil {
			return err
		}
		log.Printf("已種初始管理員帳號：%s", username)
		return nil
	}
	// 已有使用者：確保至少一個 admin。
	adminN, err := s.CountAdmins(db.DefaultTenantID)
	if err != nil {
		return err
	}
	if adminN > 0 {
		return nil
	}
	var u db.User
	q := g.Where("tenant_id = ?", db.DefaultTenantID)
	if username != "" {
		q = q.Where("username = ?", username)
	} else {
		q = q.Order("created_at")
	}
	if err := q.First(&u).Error; err != nil {
		// env 指名的帳號不存在 → 退回提升最早建立者
		if err := g.Where("tenant_id = ?", db.DefaultTenantID).Order("created_at").First(&u).Error; err != nil {
			return err
		}
	}
	if err := s.SetRole(u.ID, db.RoleAdmin); err != nil {
		return err
	}
	log.Printf("無管理員，已提升帳號為 admin：%s", u.Username)
	return nil
}

// ---------- 專案 ----------

type ProjectStore struct {
	g *gorm.DB
}

func NewProjectStore(g *gorm.DB) *ProjectStore { return &ProjectStore{g: g} }

// ProjectSummary 專案清單項目。
type ProjectSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

func (s *ProjectStore) List(tenantID string) ([]ProjectSummary, error) {
	var rows []db.Project
	if err := s.g.Where("tenant_id = ?", tenantID).Order("created_at").Find(&rows).Error; err != nil {
		return nil, err
	}
	list := make([]ProjectSummary, 0, len(rows))
	for _, r := range rows {
		list = append(list, ProjectSummary{
			ID: r.ID, Name: r.Name, CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return list, nil
}

func (s *ProjectStore) Create(tenantID, name string) (ProjectSummary, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return ProjectSummary{}, errors.New("專案名稱不可為空")
	}
	p := db.Project{ID: newID(), TenantID: tenantID, Name: name}
	if err := s.g.Create(&p).Error; err != nil {
		return ProjectSummary{}, err
	}
	return ProjectSummary{ID: p.ID, Name: p.Name, CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339)}, nil
}

// Rename 改專案名稱。查無（或跨租戶）→ os.ErrNotExist。
func (s *ProjectStore) Rename(tenantID, id, name string) (ProjectSummary, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return ProjectSummary{}, errors.New("專案名稱不可為空")
	}
	// 先確認存在再更新：改成同名時 UPDATE 的 RowsAffected 是 0，不能用它判斷「不存在」
	var p db.Project
	if err := s.g.Where("id = ? AND tenant_id = ?", id, tenantID).First(&p).Error; err != nil {
		return ProjectSummary{}, notFoundAs(err)
	}
	if err := s.g.Model(&db.Project{}).Where("id = ? AND tenant_id = ?", id, tenantID).
		Update("name", name).Error; err != nil {
		return ProjectSummary{}, err
	}
	return ProjectSummary{ID: p.ID, Name: name, CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339)}, nil
}

// Exists 專案是否屬於該租戶（建立樣板 / 列專案樣板時驗 projectId 用）。
// DB 錯誤照實回傳（不吞成 false）——否則故障時會被誤判成「專案不存在」。
func (s *ProjectStore) Exists(tenantID, id string) (bool, error) {
	if !SafeID(id) {
		return false, nil
	}
	var n int64
	if err := s.g.Model(&db.Project{}).Where("id = ? AND tenant_id = ?", id, tenantID).Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

// Delete 刪除專案（連同成員資格）。呼叫端負責擋預設專案 / 非空專案。
func (s *ProjectStore) Delete(tenantID, id string) error {
	if !SafeID(id) {
		return os.ErrNotExist
	}
	return s.g.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("project_id = ?", id).Delete(&db.ProjectMember{}).Error; err != nil {
			return err
		}
		res := tx.Where("id = ? AND tenant_id = ?", id, tenantID).Delete(&db.Project{})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return os.ErrNotExist
		}
		return nil
	})
}

// ListForUser user 角色可見的專案（自己是成員的）；依建立時間。
func (s *ProjectStore) ListForUser(tenantID, userID string) ([]ProjectSummary, error) {
	var rows []db.Project
	if err := s.g.Where("tenant_id = ? AND id IN (?)", tenantID,
		s.g.Model(&db.ProjectMember{}).Select("project_id").Where("user_id = ?", userID)).
		Order("created_at").Find(&rows).Error; err != nil {
		return nil, err
	}
	list := make([]ProjectSummary, 0, len(rows))
	for _, r := range rows {
		list = append(list, ProjectSummary{ID: r.ID, Name: r.Name, CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339)})
	}
	return list, nil
}

// IsMember user 是否為該專案成員（授權 chokepoint 用）。
func (s *ProjectStore) IsMember(userID, projectID string) (bool, error) {
	var n int64
	if err := s.g.Model(&db.ProjectMember{}).
		Where("user_id = ? AND project_id = ?", userID, projectID).Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

// MemberProjectIDs user 為成員的所有專案 id（扁平樣板清單過濾用）。
func (s *ProjectStore) MemberProjectIDs(userID string) ([]string, error) {
	var ids []string
	if err := s.g.Model(&db.ProjectMember{}).Where("user_id = ?", userID).
		Pluck("project_id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

// SetMembers 覆寫某 user 的專案成員資格（先清後建；projectIDs 需屬同租戶）。
func (s *ProjectStore) SetMembers(tenantID, userID string, projectIDs []string) error {
	return s.g.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&db.ProjectMember{}).Error; err != nil {
			return err
		}
		for _, pid := range projectIDs {
			// 只收屬於本租戶的專案，避免塞入別租戶或不存在的 id
			var n int64
			if err := tx.Model(&db.Project{}).Where("id = ? AND tenant_id = ?", pid, tenantID).Count(&n).Error; err != nil {
				return err
			}
			if n == 0 {
				continue
			}
			if err := tx.Create(&db.ProjectMember{UserID: userID, ProjectID: pid}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
