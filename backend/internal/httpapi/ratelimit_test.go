package httpapi

import (
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"pdftemplate/internal/db"
	"pdftemplate/internal/store"
)

// TestLimiterBucket 令牌桶本身：burst 用完 → 擋；時間過去 → 依 refill 補回。
// 時鐘注入，不靠 sleep，結果是決定性的。
func TestLimiterBucket(t *testing.T) {
	now := time.Unix(1700000000, 0)
	l := newLimiter(rateRule{burst: 3, refill: time.Second})
	l.now = func() time.Time { return now }

	for i := range 3 {
		if ok, _ := l.allow("k"); !ok {
			t.Fatalf("第 %d 次應在 burst 內", i+1)
		}
	}
	ok, retry := l.allow("k")
	if ok {
		t.Fatal("超過 burst 應被擋")
	}
	if retry <= 0 || retry > time.Second {
		t.Errorf("Retry-After 應落在一個 refill 內，得到 %v", retry)
	}

	// 不同 key 各有各的桶
	if ok, _ := l.allow("other"); !ok {
		t.Error("另一個 key 不該被牽連")
	}

	// 過 1 個 refill → 補 1 個令牌（只補 1 個）
	now = now.Add(time.Second)
	if ok, _ := l.allow("k"); !ok {
		t.Error("過一個 refill 後應放行")
	}
	if ok, _ := l.allow("k"); ok {
		t.Error("只該補 1 個令牌")
	}

	// 長時間閒置後補回上限，不會累積超過 burst
	now = now.Add(time.Hour)
	for i := range 3 {
		if ok, _ := l.allow("k"); !ok {
			t.Fatalf("閒置後第 %d 次應放行", i+1)
		}
	}
	if ok, _ := l.allow("k"); ok {
		t.Error("補回上限就是 burst，不該無限累積")
	}
}

// TestLimiterSweep 補滿且久未使用的桶會被清掉（key 空間不隨 IP/樣板數無限成長）。
func TestLimiterSweep(t *testing.T) {
	now := time.Unix(1700000000, 0)
	l := newLimiter(rateRule{burst: 2, refill: time.Second})
	l.now = func() time.Time { return now }

	l.allow("stale")
	if len(l.buckets) != 1 {
		t.Fatalf("桶數 = %d", len(l.buckets))
	}
	// 掃描間隔（1 分鐘）與補滿時間（burst×refill）都過了
	now = now.Add(2 * time.Minute)
	l.allow("fresh")
	if _, still := l.buckets["stale"]; still {
		t.Error("補滿且閒置的桶應被清掉")
	}
	if _, ok := l.buckets["fresh"]; !ok {
		t.Error("剛用過的桶不該被清掉")
	}
}

// TestRateLimitLogin 登入端點依來源 IP 限流：擋帳密爆破。
func TestRateLimitLogin(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")

	// 密碼錯照樣消耗令牌，否則爆破可以無限試
	var got429 bool
	for i := range loginRule.burst + 1 {
		rec := doJSON(h, "POST", "/api/auth/login", `{"username":"admin","password":"wrong"}`)
		switch {
		case i < loginRule.burst && rec.Code != 401:
			t.Fatalf("第 %d 次應為 401，得到 %d", i+1, rec.Code)
		case i >= loginRule.burst:
			if rec.Code != 429 {
				t.Fatalf("超過 burst 應為 429，得到 %d", rec.Code)
			}
			if rec.Header().Get("Retry-After") == "" {
				t.Error("429 應帶 Retry-After")
			}
			got429 = true
		}
	}
	if !got429 {
		t.Fatal("未觸發限流")
	}
	// 限流後即使密碼正確也擋著（桶是空的，不是驗證失敗）
	if rec := doJSON(h, "POST", "/api/auth/login", `{"username":"admin","password":"secret"}`); rec.Code != 429 {
		t.Errorf("限流中應持續 429，得到 %d", rec.Code)
	}
}

// TestRateLimitValues 填值端點依「樣板」限流：換 token 或換身分都繞不過去，
// 因為爭用的是那一列的鎖。
func TestRateLimitValues(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")

	newTpl := func(name string) string {
		t.Helper()
		body := fmt.Sprintf(`{"name":%q,"sections":[{"id":"s1","type":"flow","elements":[
			{"id":"e1","type":"text","content":"a","fillable":true,"x":0,"y":0,"width":10,"height":10}]}]}`, name)
		rec := doAuth(h, "POST", "/api/templates", body, ck)
		if rec.Code != 200 {
			t.Fatalf("建樣板 %d %s", rec.Code, rec.Body.String())
		}
		var created struct {
			ID string `json:"id"`
		}
		mustUnmarshal(t, rec.Body.Bytes(), &created)
		return created.ID
	}
	id := newTpl("t")

	for i := range valuesRule.burst + 1 {
		body := fmt.Sprintf(`{"values":{"e1":"v%d"}}`, i)
		rec := doAuth(h, "PATCH", "/api/templates/"+id+"/values", body, ck)
		if i < valuesRule.burst {
			if rec.Code != 200 {
				t.Fatalf("第 %d 次應為 200，得到 %d %s", i+1, rec.Code, rec.Body.String())
			}
			continue
		}
		if rec.Code != 429 {
			t.Fatalf("超過 burst 應為 429，得到 %d", rec.Code)
		}
	}

	// 另一張樣板不受牽連（維度是樣板不是全域）
	other := newTpl("t2")
	if rec := doAuth(h, "PATCH", "/api/templates/"+other+"/values", `{"values":{"e1":"x"}}`, ck); rec.Code != 200 {
		t.Errorf("另一張樣板不該被牽連，得到 %d %s", rec.Code, rec.Body.String())
	}
}

// TestLockedReturns409 樣板被另一個寫入交易鎖住時，PATCH /values 與 PUT 都回 409，
// 而不是無限期卡住等鎖。（對應 store.ErrLocked → http.StatusConflict）
func TestLockedReturns409(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")

	body := `{"name":"t","sections":[{"id":"s1","type":"flow","elements":[
		{"id":"e1","type":"text","content":"a","fillable":true,"x":0,"y":0,"width":10,"height":10}]}]}`
	rec := doAuth(h, "POST", "/api/templates", body, ck)
	var created struct {
		ID string `json:"id"`
	}
	mustUnmarshal(t, rec.Body.Bytes(), &created)

	old := store.LockWaitTimeout
	store.LockWaitTimeout = "150ms"
	defer func() { store.LockWaitTimeout = old }()

	// 外部交易抓住該列的鎖並持有
	held, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		_ = g.Transaction(func(tx *gorm.DB) error {
			var row db.Template
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ?", created.ID).First(&row).Error; err != nil {
				return err
			}
			close(held)
			<-release
			return nil
		})
	}()
	<-held

	if rec := doAuth(h, "PATCH", "/api/templates/"+created.ID+"/values", `{"values":{"e1":"x"}}`, ck); rec.Code != 409 {
		t.Errorf("PATCH 撞鎖應為 409，得到 %d %s", rec.Code, rec.Body.String())
	}
	if rec := doAuth(h, "PUT", "/api/templates/"+created.ID, body, ck); rec.Code != 409 {
		t.Errorf("PUT 撞鎖應為 409，得到 %d %s", rec.Code, rec.Body.String())
	}

	close(release)
	<-done

	// 鎖釋放後恢復正常
	if rec := doAuth(h, "PATCH", "/api/templates/"+created.ID+"/values", `{"values":{"e1":"y"}}`, ck); rec.Code != 200 {
		t.Errorf("鎖釋放後應為 200，得到 %d %s", rec.Code, rec.Body.String())
	}
}

// TestRateLimitKeys 計數維度的取法：三種身分各自獨立，取不到身分退回 IP。
func TestRateLimitKeys(t *testing.T) {
	newCtx := func(p principal) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/", nil)
		if p.kind != "" {
			setPrincipal(c, p)
		}
		return c
	}
	cases := []struct {
		name string
		p    principal
		want string
	}{
		{"user", principal{kind: principalUser, userID: "u1"}, "u:u1"},
		{"apikey", principal{kind: principalAPIKey, projectID: "p1"}, "k:p1"},
		{"embed", principal{kind: principalEmbed, templateID: "t1"}, "e:t1"},
		{"匿名退回 IP", principal{}, "ip:192.0.2.1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := keyByPrincipal(newCtx(tc.p)); got != tc.want {
				t.Errorf("keyByPrincipal = %q, want %q", got, tc.want)
			}
		})
	}
}
