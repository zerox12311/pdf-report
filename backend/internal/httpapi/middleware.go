package httpapi

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/db"
)

const tenantKey = "tenantID"

// tenantOf 取本請求的租戶 id（由 withTenant middleware 塞入）。
func tenantOf(c *gin.Context) string {
	return c.GetString(tenantKey)
}

// withTenant 解析請求的租戶。認證（API key / 嵌入 token）上線前一律為預設租戶；
// 屆時改為從 Authorization 解析並拒絕未帶憑證的請求。
func withTenant() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(tenantKey, db.DefaultTenantID)
		c.Next()
	}
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
