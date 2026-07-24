package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"runtime/debug"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"

	"pdftemplate/internal/db"
	"pdftemplate/internal/store"
)

const (
	tenantKey = "tenantID"
	userKey   = "userID"
	roleKey   = "role"

	// session 內的鍵
	sessUserID   = "uid"
	sessTenantID = "tid"

	sessionCookieName = "pdfsess"
)

// tenantOf 取本請求的租戶 id（由 withAuth middleware 塞入）。
func tenantOf(c *gin.Context) string {
	return c.GetString(tenantKey)
}

// userOf 取本請求已登入的使用者 id（未登入 = 空字串）。
func userOf(c *gin.Context) string {
	return c.GetString(userKey)
}

// roleOf 取本請求登入者的角色（未登入 = 空字串）。
func roleOf(c *gin.Context) string {
	return c.GetString(roleKey)
}

// isAdmin 本請求是否為 admin。
func isAdmin(c *gin.Context) bool {
	return roleOf(c) == db.RoleAdmin
}

// sessionMiddleware 設定 gin-contrib/sessions 的 cookie store（httpOnly、簽章）。
// secret 空時退回一組固定 dev 值（本機/測試方便；正式部署必設 SESSION_SECRET）。
func sessionMiddleware(secret string) gin.HandlerFunc {
	if secret == "" {
		secret = "dev-insecure-session-secret"
	}
	store := cookie.NewStore([]byte(secret))
	store.Options(sessions.Options{
		Path:     "/",
		MaxAge:   7 * 24 * 3600, // 7 天
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	return sessions.Sessions(sessionCookieName, store)
}

// withAuth 解析登入 session：有效 session → 載入使用者、設租戶＋使用者＋角色；
// 沒帶（iframe 嵌入、宿主呼叫）→ 退回預設租戶，維持既有開放路徑不變。
// 有 session 時才多查一次 user（順帶清掉已被刪的使用者）；iframe 無此成本。
// iframe 那條的正式上鎖（嵌入 token）為之後階段。
func withAuth(users *store.UserStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		s := sessions.Default(c)
		uid, _ := s.Get(sessUserID).(string)
		tid, _ := s.Get(sessTenantID).(string)
		if uid != "" && tid != "" {
			u, err := users.GetByID(uid)
			if err == nil {
				c.Set(userKey, u.ID)
				c.Set(tenantKey, u.TenantID)
				c.Set(roleKey, u.Role)
				c.Next()
				return
			}
			if !errors.Is(err, os.ErrNotExist) {
				// DB 錯誤（非「使用者不存在」）→ 500，不要誤判成未登入
				httpInternalError(c, err)
				c.Abort()
				return
			}
			// 使用者已被刪 → 當未登入，落預設租戶
		}
		c.Set(tenantKey, db.DefaultTenantID)
		c.Next()
	}
}

// requireAuth 守住控制台專用端點：未登入 → 401。
func requireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if userOf(c) == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "請先登入"})
			return
		}
		c.Next()
	}
}

// requireAdmin 守住 admin 專屬端點（使用者管理、建/刪專案）：非 admin → 403。
func requireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !isAdmin(c) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "需要管理員權限"})
			return
		}
		c.Next()
	}
}

// authorizeProject 樣板相關端點的授權 chokepoint：
//   - 無 session（iframe 嵌入 / 宿主呼叫）→ 放行（維持既有開放路徑）
//   - admin → 放行
//   - 該專案成員 → 放行
//   - 否則 → 403、回傳 false
//
// 每條會碰樣板的端點都先解析出「有效 projectID」再過這個函式，集中一處避免漏洞。
func authorizeProject(c *gin.Context, projects *store.ProjectStore, projectID string) bool {
	uid := userOf(c)
	if uid == "" {
		return true // 無登入 → iframe/宿主路徑，維持開放
	}
	if isAdmin(c) {
		return true
	}
	ok, err := projects.IsMember(uid, projectID)
	if err != nil {
		httpInternalError(c, err)
		return false
	}
	if !ok {
		httpError(c, http.StatusForbidden, errors.New("沒有此專案的存取權"))
		return false
	}
	return true
}

func slogLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		slog.Info("http",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"duration", time.Since(start).Round(time.Millisecond).String())
	}
}

// recoverJSON panic → 500 JSON（取代 gin.Recovery，維持統一錯誤格式與 slog）。
func recoverJSON() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic", "path", c.Request.URL.Path, "panic", rec, "stack", string(debug.Stack()))
				c.AbortWithStatusJSON(500, gin.H{"error": "伺服器錯誤"})
			}
		}()
		c.Next()
	}
}

// cors 全開（demo 用；產品化時應改白名單 + 對渲染 API 加驗證）
func cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
