package httpapi

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"pdftemplate/internal/store"
)

// assetHandler 上傳圖片（樣板中的 image 元素/儲存格引用）。
type assetHandler struct {
	store *store.AssetStore
}

func (h *assetHandler) upload(c *gin.Context) {
	// ParseMultipartForm 的參數只限制記憶體緩衝，不限制請求總量；總量上限在此把關
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUpload+1<<20)
	if err := c.Request.ParseMultipartForm(maxUpload); err != nil {
		httpError(c, 400, readableBodyError(err, maxUpload))
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		httpError(c, 400, errors.New("缺少 file 欄位"))
		return
	}
	defer file.Close()
	// ParseMultipartForm 已把內容緩衝在記憶體/暫存檔並限制大小，這裡的讀取不會失敗
	data, _ := io.ReadAll(file)
	// 內容嗅探：不信任 client 宣告的 Content-Type，實際 bytes 必須是 PNG/JPEG
	if sniffed := http.DetectContentType(data); sniffed != "image/png" && sniffed != "image/jpeg" {
		httpError(c, 400, errors.New("僅支援 PNG/JPEG（檔案內容驗證失敗）"))
		return
	}
	id, err := h.store.Save(tenantOf(c), data, header.Header.Get("Content-Type"))
	if err != nil {
		httpError(c, 400, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id})
}

func (h *assetHandler) get(c *gin.Context) {
	data, contentType, err := h.store.Get(tenantOf(c), c.Param("id"))
	if err != nil {
		httpError(c, 404, errors.New("圖片不存在"))
		return
	}
	c.Data(http.StatusOK, contentType, data)
}
