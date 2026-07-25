package httpapi

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// 速率限制：令牌桶，記憶體內、單實例。
//
// 為什麼需要：所有寫入/運算端點都已上鎖（要憑證），但「有憑證」不等於「可以無限次打」——
//   - 登入：帳密爆破
//   - 渲染：一次請求可燒掉可觀的 CPU 與記憶體
//   - 填值 PATCH：同一張樣板的寫入會序列化等列鎖，高頻打會讓設計者的存檔一直撞 409
//   - 換 token 的 {} 便利捷徑：每打一次就建一張空樣板
//
// 桶建在 New 裡（不是套件全域），所以每個 router 實例—含每個測試—各自獨立。
//
// 單實例限定：多副本部署時每個副本各有一套桶，實際上限是 N 倍。要精確就得換成
// 共用計數器（Redis 等），目前部署形態是單容器，先用記憶體版。

// rateRule 令牌桶規則：桶容量 burst（可瞬間用掉的次數），之後每 refill 補 1 個。
type rateRule struct {
	burst  int
	refill time.Duration
}

// 各端點的上限。訂在「正常使用碰不到、濫用會碰到」的位置：
// 編輯器連續操作是人的手速，遠低於這些值。
var (
	loginRule  = rateRule{burst: 20, refill: 6 * time.Second}        // 每 IP：爆破先吃掉 20 次，之後 10 次/分
	renderRule = rateRule{burst: 30, refill: time.Second}            // 每身分：預覽會連打，給寬一點
	valuesRule = rateRule{burst: 20, refill: 200 * time.Millisecond} // 每張樣板：5 次/秒，壓住列鎖爭用
	mintRule   = rateRule{burst: 30, refill: 2 * time.Second}        // 每身分：{} 捷徑會建樣板
	uploadRule = rateRule{burst: 20, refill: 3 * time.Second}        // 每身分：圖片/字型上傳
)

type tokenBucket struct {
	tokens float64
	last   time.Time
}

type limiter struct {
	mu      sync.Mutex
	rule    rateRule
	buckets map[string]*tokenBucket
	now     func() time.Time // 測試可注入
	swept   time.Time
}

func newLimiter(rule rateRule) *limiter {
	return &limiter{rule: rule, buckets: map[string]*tokenBucket{}, now: time.Now}
}

// allow 取一個令牌。回傳 false 時附上「還要多久才有下一個令牌」供 Retry-After 用。
func (l *limiter) allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.sweep(now)

	b, ok := l.buckets[key]
	if !ok {
		b = &tokenBucket{tokens: float64(l.rule.burst), last: now}
		l.buckets[key] = b
	}
	// 依經過時間補令牌（上限為桶容量）
	if elapsed := now.Sub(b.last); elapsed > 0 {
		b.tokens = math.Min(float64(l.rule.burst), b.tokens+elapsed.Seconds()/l.rule.refill.Seconds())
		b.last = now
	}
	if b.tokens < 1 {
		return false, time.Duration((1 - b.tokens) * float64(l.rule.refill))
	}
	b.tokens--
	return true, 0
}

// sweep 清掉已補滿且久未使用的桶（否則 key 空間會隨 IP/樣板數無限成長）。
// 桶滿 = 該 key 的狀態等同於不存在，刪掉不影響判斷結果。
func (l *limiter) sweep(now time.Time) {
	const sweepEvery = time.Minute
	if now.Sub(l.swept) < sweepEvery {
		return
	}
	l.swept = now
	full := time.Duration(l.rule.burst) * l.rule.refill
	for k, b := range l.buckets {
		if now.Sub(b.last) >= full {
			delete(l.buckets, k)
		}
	}
}

// rateLimit 以 keyFn 取出計數維度（IP／身分／樣板）後套用桶；超限 → 429 + Retry-After。
func rateLimit(l *limiter, keyFn func(*gin.Context) string) gin.HandlerFunc {
	return func(c *gin.Context) {
		ok, retry := l.allow(keyFn(c))
		if !ok {
			c.Header("Retry-After", strconv.Itoa(int(math.Ceil(retry.Seconds()))))
			httpError(c, http.StatusTooManyRequests, errors.New("請求過於頻繁，請稍後再試"))
			c.Abort()
			return
		}
		c.Next()
	}
}

// keyByIP 未認證端點（登入）用來源 IP 當維度。
func keyByIP(c *gin.Context) string { return "ip:" + c.ClientIP() }

// keyByPrincipal 已認證端點用身分當維度：不同租戶/專案/樣板互不影響，
// 一個宿主打爆自己的額度不會拖累別人。解析不到身分（理論上到不了，端點都有 requireAny）→ 退回 IP。
func keyByPrincipal(c *gin.Context) string {
	p := principalOf(c)
	switch p.kind {
	case principalUser:
		return "u:" + p.userID
	case principalAPIKey:
		return "k:" + p.projectID
	case principalEmbed:
		return "e:" + p.templateID
	default:
		return keyByIP(c)
	}
}

// keyByTemplate 填值端點用「樣板」當維度：爭用的是那一列的鎖，
// 換 token 或換身分都繞不過去。
func keyByTemplate(c *gin.Context) string { return "t:" + c.Param("id") }
