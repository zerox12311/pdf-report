package httpapi

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// spaHandler serve 前端單頁應用（SPA）的靜態檔＋fallback。
// 掛在 Gin NoRoute（所有沒被 /api 等路由匹配的請求）：
//   - /api/ 開頭找不到 → 404 JSON（不 fallback，避免把 API 錯誤變成 HTML）
//   - 靜態檔存在（JS/CSS/圖等）→ 直接回傳
//   - 其餘（前端路由如 /editor/xxx）→ 回 index.html 交給前端 router
//
// webRoot 為前端 build 產物目錄；空字串時不掛此 handler（維持純 API 模式）。
func spaHandler(webRoot string) gin.HandlerFunc {
	index := filepath.Join(webRoot, "index.html")
	return func(c *gin.Context) {
		p := c.Request.URL.Path
		if strings.HasPrefix(p, "/api/") {
			httpError(c, http.StatusNotFound, errors.New("端點不存在"))
			return
		}
		// filepath.Clean("/"+p) 消掉 .. 並鎖在根下，Join(webRoot, …) 保證不穿越出 webRoot；
		// 命中實體檔案才回傳，否則走 SPA fallback
		clean := filepath.Clean("/" + strings.TrimPrefix(p, "/"))
		if clean != "/" {
			file := filepath.Join(webRoot, clean)
			if info, err := os.Stat(file); err == nil && !info.IsDir() {
				c.File(file)
				return
			}
		}
		c.File(index) // SPA fallback
	}
}
