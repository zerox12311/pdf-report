package httpapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/store"
)

// templateHandler 樣板 CRUD（raw JSON passthrough，不走 gin binding）。
type templateHandler struct {
	store *store.TemplateStore
}

func (h *templateHandler) list(c *gin.Context) {
	list, err := h.store.List(tenantOf(c))
	if err != nil {
		httpInternalError(c, err)
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *templateHandler) create(c *gin.Context) {
	raw, err := readBody(c, maxUpload)
	if err != nil {
		httpError(c, 400, err)
		return
	}
	_, out, err := h.store.Save(tenantOf(c), raw, "")
	if err != nil {
		httpError(c, 400, err)
		return
	}
	writeRawJSON(c, out)
}

func (h *templateHandler) get(c *gin.Context) {
	raw, err := h.store.Get(tenantOf(c), c.Param("id"))
	if err != nil {
		templateGetError(c, err)
		return
	}
	writeRawJSON(c, raw)
}

func (h *templateHandler) update(c *gin.Context) {
	raw, err := readBody(c, maxUpload)
	if err != nil {
		httpError(c, 400, err)
		return
	}
	id := c.Param("id")
	if !store.SafeID(id) {
		httpError(c, 400, errors.New("id 不合法"))
		return
	}
	_, out, err := h.store.Save(tenantOf(c), raw, id)
	if err != nil {
		httpError(c, 400, err)
		return
	}
	writeRawJSON(c, out)
}

func (h *templateHandler) remove(c *gin.Context) {
	if err := h.store.Delete(tenantOf(c), c.Param("id")); err != nil {
		httpError(c, 404, errors.New("樣板不存在"))
		return
	}
	c.Status(http.StatusNoContent)
}
