package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"

	"pdftemplate/internal/db"
	"pdftemplate/internal/store"
)

// authHandler 控制台登入 / 登出 / 目前使用者 / 改密碼。
// 目前為單租戶：登入固定對 DefaultTenantID 查帳號（多租戶登入為未來）。
type authHandler struct {
	users *store.UserStore
}

// decodeJSON 讀 body 並解析成目標結構（auth 的請求體非樣板 passthrough，可正常反序列化）。
func decodeJSON(c *gin.Context, dst any) error {
	raw, err := readBody(c, maxUpload)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		return errors.New("請求格式錯誤（需為 JSON）")
	}
	return nil
}

func (h *authHandler) login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(c, &req); err != nil {
		httpError(c, 400, err)
		return
	}
	req.Username = strings.TrimSpace(req.Username)

	// 帳號不存在與密碼錯誤回同一訊息，避免帳號枚舉。
	u, err := h.users.GetByUsername(db.DefaultTenantID, req.Username)
	if err != nil || !store.VerifyPassword(u.PasswordHash, req.Password) {
		httpError(c, http.StatusUnauthorized, errors.New("帳號或密碼錯誤"))
		return
	}

	s := sessions.Default(c)
	s.Set(sessUserID, u.ID)
	s.Set(sessTenantID, u.TenantID)
	if err := s.Save(); err != nil {
		httpInternalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"username": u.Username})
}

func (h *authHandler) logout(c *gin.Context) {
	s := sessions.Default(c)
	s.Clear()
	if err := s.Save(); err != nil {
		httpInternalError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// me 回目前登入者（前端 route guard 用）；未登入 → 401。
func (h *authHandler) me(c *gin.Context) {
	uid := userOf(c)
	if uid == "" {
		httpError(c, http.StatusUnauthorized, errors.New("尚未登入"))
		return
	}
	u, err := h.users.GetByID(uid)
	if err != nil {
		// session 有效但使用者已不存在（被刪）→ 視為未登入
		httpError(c, http.StatusUnauthorized, errors.New("尚未登入"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"username": u.Username, "role": u.Role})
}

func (h *authHandler) changePassword(c *gin.Context) {
	var req struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if err := decodeJSON(c, &req); err != nil {
		httpError(c, 400, err)
		return
	}
	if len(req.NewPassword) < 4 {
		httpError(c, 400, errors.New("新密碼至少 4 字元"))
		return
	}
	u, err := h.users.GetByID(userOf(c))
	if err != nil {
		httpError(c, http.StatusUnauthorized, errors.New("尚未登入"))
		return
	}
	if !store.VerifyPassword(u.PasswordHash, req.OldPassword) {
		httpError(c, 400, errors.New("舊密碼錯誤"))
		return
	}
	if err := h.users.SetPassword(u.ID, req.NewPassword); err != nil {
		httpInternalError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
