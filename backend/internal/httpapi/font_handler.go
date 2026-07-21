package httpapi

import (
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/store"
)

// fontHandler 使用者匯入字型（TTF/OTF；引擎動態註冊、前端 FontFace 預覽）。
type fontHandler struct {
	store *store.FontStore
}

func (h *fontHandler) upload(c *gin.Context) {
	// 中文字型檔較大，上限放寬到 40MB
	const maxFont = 40 << 20
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxFont+1<<20)
	if err := c.Request.ParseMultipartForm(maxFont); err != nil {
		httpError(c, 400, readableBodyError(err, maxFont))
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		httpError(c, 400, errors.New("缺少 file 欄位"))
		return
	}
	defer file.Close()
	data, _ := io.ReadAll(file)
	name := c.Request.FormValue("name")
	if name == "" {
		name = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
	}
	info, err := h.store.Save(tenantOf(c), name, data)
	if err != nil {
		httpError(c, 400, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

func (h *fontHandler) list(c *gin.Context) {
	list, err := h.store.List(tenantOf(c))
	if err != nil {
		httpInternalError(c, err)
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *fontHandler) get(c *gin.Context) {
	data, err := h.store.Get(tenantOf(c), c.Param("id"))
	if err != nil {
		httpError(c, 404, errors.New("字型不存在"))
		return
	}
	c.Header("Cache-Control", "public, max-age=86400")
	c.Data(http.StatusOK, "font/ttf", data)
}
