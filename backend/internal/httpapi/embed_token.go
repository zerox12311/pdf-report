package httpapi

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// embedTokenTTL 短效嵌入 token 的存活時間。撤銷靠短 TTL（無狀態、免建 tokens 表）。
const embedTokenTTL = 30 * time.Minute

// devSecret sessionSecret / embed 簽章金鑰未設時的 dev 退回值（正式部署 main 會擋 WEB_ROOT 非空未設）。
const devSecret = "dev-insecure-session-secret"

func resolveSecret(s string) string {
	if s == "" {
		return devSecret
	}
	return s
}

// embedClaims embed token 的內容：綁租戶＋專案＋單一 template，並帶權限模式。
// Mode 是「宿主後端換 token 時決定的政策」，放在簽章保護的 claim 裡 —— 前端無法竄改。
type embedClaims struct {
	Tenant     string `json:"ten"`
	ProjectID  string `json:"pid"`
	TemplateID string `json:"tid"`
	Mode       string `json:"mod,omitempty"` // design|fill|view；空值 → design（向後相容舊 token）
	jwt.RegisteredClaims
}

// signEmbedToken 簽一張 HS256 embed token（用 sessionSecret 當金鑰），存活 embedTokenTTL。
func signEmbedToken(secret, tenant, projectID, templateID, mode string) (token string, expiresAt time.Time, err error) {
	expiresAt = time.Now().Add(embedTokenTTL)
	token, err = signEmbedTokenExp(secret, tenant, projectID, templateID, mode, expiresAt)
	return token, expiresAt, err
}

// signEmbedTokenExp 指定到期時間簽 token（測試可傳過去時間造過期 token）。
func signEmbedTokenExp(secret, tenant, projectID, templateID, mode string, exp time.Time) (string, error) {
	claims := embedClaims{
		Tenant:     tenant,
		ProjectID:  projectID,
		TemplateID: templateID,
		Mode:       normalizeMode(mode),
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString([]byte(resolveSecret(secret)))
}

// parseEmbedToken 驗證並解析 embed token（過期/簽章錯 → error）。
func parseEmbedToken(tokenStr, secret string) (embedClaims, error) {
	var claims embedClaims
	_, err := jwt.ParseWithClaims(tokenStr, &claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(resolveSecret(secret)), nil
		// exp 必填：撤銷機制完全依賴短 TTL，沒有 exp 的 token 等於永久有效
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	if err != nil {
		return embedClaims{}, err
	}
	if claims.TemplateID == "" || claims.Tenant == "" {
		return embedClaims{}, errors.New("token 缺必要欄位")
	}
	return claims, nil
}
