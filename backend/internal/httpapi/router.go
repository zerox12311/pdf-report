// Package httpapi：Gin 路由 + handlers（按資源拆檔：template/render/asset/font）。
//
// Gin 使用注意（本專案契約）：
//   - 樣板 payload 一律 raw bytes 進出（readBody / c.Data），不用 ShouldBindJSON——
//     binding 會經過結構反序列化，破壞 raw JSON passthrough 與 json.Number 數字字面保留。
//   - 錯誤回應統一 {"error": "..."}；渲染警告走 X-Render-Warnings header / strict=1 → 422。
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/engine"
	"pdftemplate/internal/store"
)

const maxUpload = 10 << 20 // 10MB

// New 組出完整的 HTTP handler（middleware + 路由總表）；main 與測試共用。
// webRoot 非空時額外 serve 前端靜態檔（單容器部署）；空 = 純 API 模式。
// sessionSecret 為登入 session 的簽章金鑰（空 → dev 預設，正式必設）。
func New(templates *store.TemplateStore, assets *store.AssetStore, fonts *store.FontStore, users *store.UserStore, projects *store.ProjectStore, keys *store.APIKeyStore, eng *engine.Engine, sessionSecret, webRoot string) http.Handler {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(slogLogger(), recoverJSON(), cors(), sessionMiddleware(sessionSecret), withAuth(users, keys, sessionSecret))

	th := &templateHandler{store: templates, projects: projects}
	rh := &renderHandler{store: templates, projects: projects, eng: eng}
	ah := &assetHandler{store: assets}
	fh := &fontHandler{store: fonts}
	vh := &validateHandler{}
	auth := &authHandler{users: users}
	ph := &projectHandler{projects: projects, templates: templates}
	uh := &userHandler{users: users, projects: projects}
	kh := &keyHandler{keys: keys, projects: projects}
	eh := &embedHandler{templates: templates, secret: sessionSecret}

	// 速率限制（ratelimit.go）：桶隨 router 實例建立，各實例獨立。
	// 掛在「爆破／燒 CPU／製造列鎖爭用／會建資料」這四類端點上，逐端點掛而非全域，
	// 才不會讓讀取類端點（清單、取樣板）被無謂地限住。
	loginLimit := newLimiter(loginRule)
	renderLimit := newLimiter(renderRule)
	valuesLimit := newLimiter(valuesRule)
	mintLimit := newLimiter(mintRule)
	uploadLimit := newLimiter(uploadRule)

	// 控制台登入（開放：login/logout；me/改密碼需登入）
	r.POST("/api/auth/login", rateLimit(loginLimit, keyByIP), auth.login)
	r.POST("/api/auth/logout", auth.logout)
	r.GET("/api/auth/me", auth.me)
	r.POST("/api/auth/change-password", requireAuth(), auth.changePassword)

	// 控制台專案（皆需登入；建立/刪除為 admin 專屬）
	r.GET("/api/projects", requireAuth(), ph.list)
	r.POST("/api/projects", requireAuth(), requireAdmin(), ph.create)
	r.PATCH("/api/projects/:id", requireAuth(), requireAdmin(), ph.rename)
	r.DELETE("/api/projects/:id", requireAuth(), requireAdmin(), ph.remove)
	r.GET("/api/projects/:id/templates", requireAuth(), ph.listTemplates)

	// 使用者管理（admin 專屬）
	r.GET("/api/users", requireAuth(), requireAdmin(), uh.list)
	r.POST("/api/users", requireAuth(), requireAdmin(), uh.create)
	r.PATCH("/api/users/:id", requireAuth(), requireAdmin(), uh.update)
	r.DELETE("/api/users/:id", requireAuth(), requireAdmin(), uh.remove)

	// 宿主整合 API 金鑰（admin 專屬；綁專案）
	r.GET("/api/projects/:id/keys", requireAuth(), requireAdmin(), kh.list)
	r.POST("/api/projects/:id/keys", requireAuth(), requireAdmin(), kh.create)
	r.DELETE("/api/keys/:kid", requireAuth(), requireAdmin(), kh.remove)

	// 換短效 embed token（宿主後端用 project API key 打）
	r.POST("/api/embed-token", requireAPIKey(), rateLimit(mintLimit, keyByPrincipal), eh.mint)

	// 資料端點：三來源身分任一皆可（requireAny），匿名 → 401。授權細度在各 handler
	// 依 principal 過 authorizeTemplate/authorizeCreateInProject（user 依成員／apikey 依專案／embed 鎖單張）。
	// embed principal 另受 mode 能力限制（capability.go）：改版面要 capEditLayout、
	// 刪除一律不可（denyEmbed）—— 逐端點掛，新增端點時才不會漏。
	r.GET("/api/templates", requireAny(), th.list)
	r.POST("/api/templates", requireAny(), th.create)
	r.GET("/api/templates/:id", requireAny(), th.get)
	r.PUT("/api/templates/:id", requireAny(), requireCapability(capEditLayout), th.update)
	r.DELETE("/api/templates/:id", requireAny(), denyEmbed(), th.remove)
	// 填寫模式的窄介面：只改得到被標記 fillable 的欄位（結構上改不到其他）
	r.PATCH("/api/templates/:id/values", requireAny(), requireCapability(capEditValues), rateLimit(valuesLimit, keyByTemplate), th.patchValues)

	// 目前憑證的嵌入模式與能力（前端據此畫 UI；與後端強制同源）
	r.GET("/api/embed/context", requireAny(), eh.context)

	// Gin 允許靜態段與 :id 並存且靜態優先，/render 不會被當成樣板 id
	// render-by-id：匿名可否取決於樣板本體的 allowAnonymousRender（逐樣板 opt-in，預設關）
	r.POST("/api/templates/:id/render", requireAnyOrAnonymousRender(templates), rateLimit(renderLimit, keyByPrincipal), rh.renderByID)
	r.POST("/api/templates/render", requireAny(), rateLimit(renderLimit, keyByPrincipal), rh.renderAdhoc)

	r.POST("/api/assets", requireAny(), requireCapability(capUpload), rateLimit(uploadLimit, keyByPrincipal), ah.upload)
	r.GET("/api/assets/:id", requireAny(), ah.get)

	r.POST("/api/fonts", requireAny(), requireCapability(capUpload), rateLimit(uploadLimit, keyByPrincipal), fh.upload)
	r.GET("/api/fonts", requireAny(), fh.list)
	r.GET("/api/fonts/:id", requireAny(), fh.get)

	// 編輯器「測試 schema」：拿當前規則 + data 直接驗證（不渲染），與 render 守門同一權威
	r.POST("/api/validate", requireAny(), vh.check)

	r.GET("/healthz", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	// 單容器部署：Go 自己 serve 前端靜態檔＋SPA fallback（webRoot 空 = 純 API）
	if webRoot != "" {
		r.NoRoute(spaHandler(webRoot))
	}

	return r
}
