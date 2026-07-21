package httpapi

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

// readBody 讀 raw body（帶大小上限）。樣板 payload 不走 gin binding（見 package 註解）。
// 錯誤訊息對外用使用者語言，不洩漏 Go 內部字串。
func readBody(c *gin.Context, limit int64) ([]byte, error) {
	b, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, limit))
	if err != nil {
		return nil, readableBodyError(err, limit)
	}
	return b, nil
}

// readableBodyError 把 body 讀取錯誤轉成乾淨訊息（過大 / 讀取中斷）。
func readableBodyError(err error, limit int64) error {
	var mbe *http.MaxBytesError
	if errors.As(err, &mbe) {
		return fmt.Errorf("請求內容過大（上限 %dMB）", limit>>20)
	}
	return errors.New("請求內容讀取失敗")
}

// writeRawJSON 原樣輸出既有 JSON bytes（不重編碼，保留 passthrough 語意）。
func writeRawJSON(c *gin.Context, raw []byte) {
	c.Data(http.StatusOK, "application/json; charset=utf-8", raw)
}

func httpError(c *gin.Context, code int, err error) {
	c.JSON(code, gin.H{"error": err.Error()})
}

// httpInternalError 內部錯誤：細節（可能含檔案路徑）只進 log，client 收固定訊息。
// 渲染類 500 例外走 httpError（訊息是給編輯器使用者看的引擎提示，不含內部資訊）。
func httpInternalError(c *gin.Context, err error) {
	slog.Error("internal error", "err", err)
	httpError(c, 500, errors.New("伺服器錯誤"))
}

// templateGetError 讀取樣板失敗的統一分類：不存在 → 404，其餘（權限/DB）→ 500。
func templateGetError(c *gin.Context, err error) {
	if errors.Is(err, os.ErrNotExist) {
		httpError(c, 404, errors.New("樣板不存在"))
		return
	}
	httpInternalError(c, err)
}

// urlEncode RFC 5987 檔名/警告 header 用的 percent-encoding。
func urlEncode(s string) string {
	const hexDigits = "0123456789ABCDEF"
	out := make([]byte, 0, len(s)*3)
	for _, b := range []byte(s) {
		if (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '-' || b == '_' || b == '.' {
			out = append(out, b)
		} else {
			out = append(out, '%', hexDigits[b>>4], hexDigits[b&0xF])
		}
	}
	return string(out)
}
