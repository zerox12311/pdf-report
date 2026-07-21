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
func New(templates *store.TemplateStore, assets *store.AssetStore, fonts *store.FontStore, eng *engine.Engine) http.Handler {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(slogLogger(), recoverJSON(), cors(), withTenant())

	th := &templateHandler{store: templates}
	rh := &renderHandler{store: templates, eng: eng}
	ah := &assetHandler{store: assets}
	fh := &fontHandler{store: fonts}

	// 路由總表（新增 endpoint 請按資源歸入對應 handler 檔）
	r.GET("/api/templates", th.list)
	r.POST("/api/templates", th.create)
	r.GET("/api/templates/:id", th.get)
	r.PUT("/api/templates/:id", th.update)
	r.DELETE("/api/templates/:id", th.remove)

	// Gin 允許靜態段與 :id 並存且靜態優先，/render 不會被當成樣板 id
	r.POST("/api/templates/:id/render", rh.renderByID)
	r.POST("/api/templates/render", rh.renderAdhoc)

	r.POST("/api/assets", ah.upload)
	r.GET("/api/assets/:id", ah.get)

	r.POST("/api/fonts", fh.upload)
	r.GET("/api/fonts", fh.list)
	r.GET("/api/fonts/:id", fh.get)

	r.GET("/healthz", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	return r
}
