package httpapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/store"
)

// keyHandler 宿主後端 API key 管理（admin 專屬；v1 綁專案）。
type keyHandler struct {
	keys     *store.APIKeyStore
	projects *store.ProjectStore
}

// list 專案的金鑰清單（不含明文/雜湊）。
func (h *keyHandler) list(c *gin.Context) {
	pid := c.Param("id")
	ok, err := h.projects.Exists(tenantOf(c), pid)
	if err != nil {
		httpInternalError(c, err)
		return
	}
	if !ok {
		httpError(c, 404, errors.New("專案不存在"))
		return
	}
	l, err := h.keys.ListByProject(tenantOf(c), pid)
	if err != nil {
		httpInternalError(c, err)
		return
	}
	c.JSON(http.StatusOK, l)
}

// create 建立金鑰；明文只在此回一次。
func (h *keyHandler) create(c *gin.Context) {
	pid := c.Param("id")
	ok, err := h.projects.Exists(tenantOf(c), pid)
	if err != nil {
		httpInternalError(c, err)
		return
	}
	if !ok {
		httpError(c, 404, errors.New("專案不存在"))
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(c, &req); err != nil {
		httpError(c, 400, err)
		return
	}
	plain, sum, err := h.keys.Create(tenantOf(c), pid, req.Name)
	if err != nil {
		httpInternalError(c, err)
		return
	}
	// key 明文只有這一刻回得到；之後只存雜湊。
	c.JSON(http.StatusOK, gin.H{
		"id":        sum.ID,
		"name":      sum.Name,
		"createdAt": sum.CreatedAt,
		"key":       plain,
	})
}

// remove 撤銷金鑰。
func (h *keyHandler) remove(c *gin.Context) {
	if err := h.keys.Delete(tenantOf(c), c.Param("kid")); err != nil {
		httpError(c, 404, errors.New("API 金鑰不存在"))
		return
	}
	c.Status(http.StatusNoContent)
}
