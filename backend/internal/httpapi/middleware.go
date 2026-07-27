package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"

	"pdftemplate/internal/db"
	"pdftemplate/internal/store"
)

const (
	tenantKey    = "tenantID"
	userKey      = "userID"
	roleKey      = "role"
	principalKey = "principal"

	// session 內的鍵
	sessUserID   = "uid"
	sessTenantID = "tid"

	sessionCookieName = "pdfsess"

	// 身分種類
	principalUser   = "user"   // 控制台 session
	principalAPIKey = "apikey" // 宿主後端 API key
	principalEmbed  = "embed"  // iframe embed token
)

// principal 本請求的身分（三來源擇一）。
type principal struct {
	kind       string
	tenantID   string
	userID     string // user
	role       string // user
	projectID  string // apikey（key 綁的專案）／embed（template 所屬專案）
	templateID string // embed（鎖定的那張）
	mode       string // embed（權限模式 design|fill|view，見 capability.go）
}

// setPrincipal 設身分，並塞相容用的 tenant/user/role 鍵。
func setPrincipal(c *gin.Context, p principal) {
	c.Set(principalKey, p)
	c.Set(tenantKey, p.tenantID)
	if p.kind == principalUser {
		c.Set(userKey, p.userID)
		c.Set(roleKey, p.role)
	}
}

func principalOf(c *gin.Context) principal {
	if v, ok := c.Get(principalKey); ok {
		if p, ok := v.(principal); ok {
			return p
		}
	}
	return principal{}
}

func principalKind(c *gin.Context) string { return principalOf(c).kind }

// tenantOf 取本請求的租戶 id。
func tenantOf(c *gin.Context) string { return c.GetString(tenantKey) }

// userOf 取本請求登入使用者 id（非 session 身分 = 空字串）。
func userOf(c *gin.Context) string { return c.GetString(userKey) }

// roleOf 取本請求登入者角色。
func roleOf(c *gin.Context) string { return c.GetString(roleKey) }

// isAdmin 本請求是否為 admin（session 使用者）。
func isAdmin(c *gin.Context) bool { return roleOf(c) == db.RoleAdmin }

// sessionMiddleware 設定 gin-contrib/sessions 的 cookie store（httpOnly、簽章）。
func sessionMiddleware(secret string) gin.HandlerFunc {
	store := cookie.NewStore([]byte(resolveSecret(secret)))
	store.Options(sessions.Options{
		Path:     "/",
		MaxAge:   7 * 24 * 3600, // 7 天
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	return sessions.Sessions(sessionCookieName, store)
}

// withAuth 解析身分，三來源擇一：
//  1. Authorization: Bearer <api-key>（pdftpl_ 前綴）→ 宿主後端
//  2. Authorization: Bearer <jwt>                    → iframe embed token
//  3. session cookie                                 → 控制台使用者
//
// 帶了 Authorization 但驗不過 → 401（不誤放）。都沒帶 → 匿名（落預設租戶，之後被 guard 擋）。
func withAuth(users *store.UserStore, keys *store.APIKeyStore, secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if bearer, ok := bearerToken(c); ok {
			if store.HasAPIKeyPrefix(bearer) {
				rec, err := keys.Verify(bearer)
				if err != nil {
					abortUnauthorized(c, "無效的 API 金鑰")
					return
				}
				setPrincipal(c, principal{kind: principalAPIKey, tenantID: rec.TenantID, projectID: rec.ProjectID})
				c.Next()
				return
			}
			claims, err := parseEmbedToken(bearer, secret)
			if err != nil {
				abortUnauthorized(c, "無效或過期的 token")
				return
			}
			setPrincipal(c, principal{
				kind: principalEmbed, tenantID: claims.Tenant, projectID: claims.ProjectID,
				templateID: claims.TemplateID, mode: normalizeMode(claims.Mode),
			})
			c.Next()
			return
		}

		s := sessions.Default(c)
		uid, _ := s.Get(sessUserID).(string)
		tid, _ := s.Get(sessTenantID).(string)
		if uid != "" && tid != "" {
			u, err := users.GetByID(uid)
			if err == nil {
				setPrincipal(c, principal{kind: principalUser, tenantID: u.TenantID, userID: u.ID, role: u.Role})
				c.Next()
				return
			}
			if !errors.Is(err, os.ErrNotExist) {
				httpInternalError(c, err) // DB 錯誤 → 500，不誤判成未登入
				c.Abort()
				return
			}
			// 使用者已被刪 → 當匿名
		}
		c.Set(tenantKey, db.DefaultTenantID)
		c.Next()
	}
}

// bearerToken 取 Authorization: Bearer 的值。
func bearerToken(c *gin.Context) (string, bool) {
	v := c.GetHeader("Authorization")
	if t, ok := strings.CutPrefix(v, "Bearer "); ok && t != "" {
		return t, true
	}
	return "", false
}

func abortUnauthorized(c *gin.Context, msg string) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": msg})
}

// requireAuth 控制台端點：需 session 使用者身分。
func requireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if principalKind(c) != principalUser {
			abortUnauthorized(c, "請先登入")
			return
		}
		c.Next()
	}
}

// requireAdmin admin 專屬（使用者管理、建/刪專案、金鑰管理）：非 admin → 403。
func requireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !isAdmin(c) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "需要管理員權限"})
			return
		}
		c.Next()
	}
}

// requireAPIKey embed token 簽發端點：需宿主後端 API key 身分。
func requireAPIKey() gin.HandlerFunc {
	return func(c *gin.Context) {
		if principalKind(c) != principalAPIKey {
			abortUnauthorized(c, "需要 API 金鑰")
			return
		}
		c.Next()
	}
}

// requireAny 資料端點：三來源任一皆可，匿名 → 401。
func requireAny() gin.HandlerFunc {
	return func(c *gin.Context) {
		if principalKind(c) == "" {
			abortUnauthorized(c, "需要憑證")
			return
		}
		c.Next()
	}
}

// requireAnyOrAnonymousRender render-by-id 專用閘門：有憑證照常（後續仍走 authorizeTemplate）；
// 匿名時讀樣板本體的 allowAnonymousRender 欄位——設計者逐樣板決定是否開放免憑證渲染
// （例：宿主前端直接下載 PDF），預設不開。找不到樣板與未開放一律回 401，
// 匿名者無從探測樣板存在與否。
func requireAnyOrAnonymousRender(templates *store.TemplateStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		if principalKind(c) != "" {
			c.Next()
			return
		}
		raw, err := templates.Get(tenantOf(c), c.Param("id"))
		if err != nil {
			abortUnauthorized(c, "需要憑證")
			return
		}
		var flag struct {
			Allow bool `json:"allowAnonymousRender"`
		}
		if json.Unmarshal(raw, &flag) != nil || !flag.Allow {
			abortUnauthorized(c, "需要憑證")
			return
		}
		c.Next()
	}
}

// authorizeTemplate 存取「某一張樣板」(get/put/delete/render-by-id) 的授權 chokepoint：
//   - user  → admin 或 該樣板所屬專案的成員
//   - apikey → key 綁的專案 == 該樣板所屬專案
//   - embed → token 鎖的 templateID == 該樣板 id
//
// tmplProjectID 是樣板所屬專案、templateID 是樣板 id；不過 → 403、回傳 false。
func authorizeTemplate(c *gin.Context, projects *store.ProjectStore, tmplProjectID, templateID string) bool {
	switch principalKind(c) {
	case principalUser:
		return authorizeUserProject(c, projects, tmplProjectID)
	case principalAPIKey:
		return principalOf(c).projectID == tmplProjectID || forbidTemplate(c)
	case principalEmbed:
		// 同時比對 template 與其所屬專案：對合法 token 恆真（mint 時已驗），
		// 但能擋住偽造 token（須同時猜中兩個 id）與「樣板被搬到別的專案」後的殘留授權。
		p := principalOf(c)
		return (p.templateID == templateID && p.projectID == tmplProjectID) || forbidTemplate(c)
	}
	return forbidTemplate(c)
}

// authorizeCreateInProject 在某專案建立樣板的授權：
//   - user  → admin 或成員；apikey → 綁的專案；embed → 不可建（403）。
func authorizeCreateInProject(c *gin.Context, projects *store.ProjectStore, projectID string) bool {
	switch principalKind(c) {
	case principalUser:
		return authorizeUserProject(c, projects, projectID)
	case principalAPIKey:
		return principalOf(c).projectID == projectID || forbidTemplate(c)
	}
	return forbidTemplate(c) // embed 不能建新樣板
}

// authorizeUserProject 使用者對專案 (admin/member)。
func authorizeUserProject(c *gin.Context, projects *store.ProjectStore, projectID string) bool {
	if isAdmin(c) {
		return true
	}
	ok, err := projects.IsMember(userOf(c), projectID)
	if err != nil {
		httpInternalError(c, err)
		return false
	}
	if !ok {
		return forbidTemplate(c)
	}
	return true
}

func forbidTemplate(c *gin.Context) bool {
	httpError(c, http.StatusForbidden, errors.New("沒有此資源的存取權"))
	return false
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
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Header("Access-Control-Expose-Headers", "X-Project-Id, X-Render-Warnings, X-Render-Warnings-Count")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
