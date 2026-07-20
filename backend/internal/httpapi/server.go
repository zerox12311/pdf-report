package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"

	"pdftemplate/internal/engine"
	"pdftemplate/internal/store"
)

const maxUpload = 10 << 20 // 10MB

// New 組出完整的 HTTP handler（路由 + middleware）；main 與測試共用。
func New(templates *store.TemplateStore, assets *store.AssetStore, fonts *store.FontStore, eng *engine.Engine) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/templates", func(w http.ResponseWriter, r *http.Request) {
		list, err := templates.List()
		if err != nil {
			httpInternalError(w, err)
			return
		}
		writeJSON(w, list)
	})

	mux.HandleFunc("POST /api/templates", func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxUpload))
		if err != nil {
			httpError(w, 400, err)
			return
		}
		_, out, err := templates.Save(raw, "")
		if err != nil {
			httpError(w, 400, err)
			return
		}
		writeRawJSON(w, out)
	})

	mux.HandleFunc("GET /api/templates/{id}", func(w http.ResponseWriter, r *http.Request) {
		raw, err := templates.Get(r.PathValue("id"))
		if err != nil {
			templateGetError(w, err)
			return
		}
		writeRawJSON(w, raw)
	})

	mux.HandleFunc("PUT /api/templates/{id}", func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxUpload))
		if err != nil {
			httpError(w, 400, err)
			return
		}
		id := r.PathValue("id")
		if !store.SafeID(id) {
			httpError(w, 400, errors.New("id 不合法"))
			return
		}
		_, out, err := templates.Save(raw, id)
		if err != nil {
			httpError(w, 400, err)
			return
		}
		writeRawJSON(w, out)
	})

	mux.HandleFunc("DELETE /api/templates/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := templates.Delete(r.PathValue("id")); err != nil {
			httpError(w, 404, errors.New("樣板不存在"))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// 正式渲染：宿主系統後端拿樣板 id + 資料 → PDF（整合契約）
	mux.HandleFunc("POST /api/templates/{id}/render", func(w http.ResponseWriter, r *http.Request) {
		raw, err := templates.Get(r.PathValue("id"))
		if err != nil {
			templateGetError(w, err)
			return
		}
		var doc engine.TemplateDoc
		if err := json.Unmarshal(raw, &doc); err != nil {
			httpError(w, 500, fmt.Errorf("樣板解析失敗: %w", err))
			return
		}
		data, err := readRenderData(r)
		if err != nil {
			httpError(w, 400, err)
			return
		}
		renderPDF(w, r, eng, &doc, data)
	})

	// 未儲存樣板直接渲染（編輯器預覽用）
	mux.HandleFunc("POST /api/templates/render", func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxUpload))
		if err != nil {
			httpError(w, 400, err)
			return
		}
		var req struct {
			Template engine.TemplateDoc `json:"template"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			httpError(w, 400, fmt.Errorf("request 解析失敗: %w", err))
			return
		}
		data, err := validateData(extractData(body))
		if err != nil {
			httpError(w, 400, err)
			return
		}
		renderPDF(w, r, eng, &req.Template, data)
	})

	mux.HandleFunc("POST /api/assets", func(w http.ResponseWriter, r *http.Request) {
		// ParseMultipartForm 的參數只限制記憶體緩衝，不限制請求總量；總量上限在此把關
		r.Body = http.MaxBytesReader(w, r.Body, maxUpload+1<<20)
		if err := r.ParseMultipartForm(maxUpload); err != nil {
			httpError(w, 400, err)
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			httpError(w, 400, errors.New("缺少 file 欄位"))
			return
		}
		defer file.Close()
		// ParseMultipartForm 已把內容緩衝在記憶體/暫存檔並限制大小，這裡的讀取不會失敗
		data, _ := io.ReadAll(file)
		// 內容嗅探：不信任 client 宣告的 Content-Type，實際 bytes 必須是 PNG/JPEG
		if sniffed := http.DetectContentType(data); sniffed != "image/png" && sniffed != "image/jpeg" {
			httpError(w, 400, errors.New("僅支援 PNG/JPEG（檔案內容驗證失敗）"))
			return
		}
		id, err := assets.Save(data, header.Header.Get("Content-Type"))
		if err != nil {
			httpError(w, 400, err)
			return
		}
		writeJSON(w, map[string]string{"id": id})
	})

	mux.HandleFunc("GET /api/assets/{id}", func(w http.ResponseWriter, r *http.Request) {
		data, contentType, err := assets.Get(r.PathValue("id"))
		if err != nil {
			httpError(w, 404, errors.New("圖片不存在"))
			return
		}
		w.Header().Set("Content-Type", contentType)
		_, _ = w.Write(data)
	})

	// ---- 使用者匯入字型 ----
	mux.HandleFunc("POST /api/fonts", func(w http.ResponseWriter, r *http.Request) {
		// 中文字型檔較大，上限放寬到 40MB
		const maxFont = 40 << 20
		r.Body = http.MaxBytesReader(w, r.Body, maxFont+1<<20)
		if err := r.ParseMultipartForm(maxFont); err != nil {
			httpError(w, 400, err)
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			httpError(w, 400, errors.New("缺少 file 欄位"))
			return
		}
		defer file.Close()
		data, _ := io.ReadAll(file)
		name := r.FormValue("name")
		if name == "" {
			name = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
		}
		info, err := fonts.Save(name, data)
		if err != nil {
			httpError(w, 400, err)
			return
		}
		writeJSON(w, info)
	})

	mux.HandleFunc("GET /api/fonts", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, fonts.List())
	})

	mux.HandleFunc("GET /api/fonts/{id}", func(w http.ResponseWriter, r *http.Request) {
		data, err := fonts.Get(r.PathValue("id"))
		if err != nil {
			httpError(w, 404, errors.New("字型不存在"))
			return
		}
		w.Header().Set("Content-Type", "font/ttf")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		_, _ = w.Write(data)
	})

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})

	return logRequests(recoverPanic(cors(mux)))
}

// templateGetError 讀取樣板失敗的統一分類：不存在 → 404，其餘（權限/磁碟）→ 500。
func templateGetError(w http.ResponseWriter, err error) {
	if errors.Is(err, os.ErrNotExist) {
		httpError(w, 404, errors.New("樣板不存在"))
		return
	}
	httpInternalError(w, err)
}

// ---- middleware ----

// statusRecorder 攔截狀態碼供 request log 使用。
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		slog.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start).Round(time.Millisecond).String())
	})
}

func recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic", "path", r.URL.Path, "panic", rec, "stack", string(debug.Stack()))
				httpError(w, 500, errors.New("伺服器錯誤"))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// readRenderData 解析 {"data": ...}，數字用 json.Number 保留原始字面。
// 空 body = 無資料（合法）；壞 JSON 或 data 非物件 → 錯誤（避免靜默印出空值單據）。
func readRenderData(r *http.Request) (any, error) {
	body, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, maxUpload))
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return nil, nil
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var wrapper map[string]any
	if err := dec.Decode(&wrapper); err != nil {
		return nil, fmt.Errorf("request JSON 解析失敗: %w", err)
	}
	return validateData(wrapper["data"])
}

// validateData data 必須是物件或 null——其他型別（數字/字串/陣列）必然是串接端的 bug，直接拒絕。
func validateData(data any) (any, error) {
	if data == nil {
		return nil, nil
	}
	if _, ok := data.(map[string]any); !ok {
		return nil, errors.New("data 必須是 JSON 物件")
	}
	return data, nil
}

func extractData(body []byte) any {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var wrapper map[string]any
	if err := dec.Decode(&wrapper); err != nil {
		return nil
	}
	return wrapper["data"]
}

// renderPDF 渲染並回應。
// 資料問題（找不到 key 等）以 X-Render-Warnings-Count / X-Render-Warnings（percent-encoded JSON）回報；
// query 帶 strict=1 時，有任何 warning 直接回 422 JSON（財務單據建議串接時開啟）。
func renderPDF(w http.ResponseWriter, r *http.Request, eng *engine.Engine, doc *engine.TemplateDoc, data any) {
	pdf, warnings, err := eng.Render(doc, data)
	if err != nil {
		httpError(w, 500, fmt.Errorf("渲染失敗: %w", err))
		return
	}
	if len(warnings) > 0 {
		if r.URL.Query().Get("strict") == "1" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(422)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error":    "渲染資料不完整（strict 模式）",
				"warnings": warnings,
			})
			return
		}
		wj, _ := json.Marshal(warnings)
		w.Header().Set("X-Render-Warnings-Count", fmt.Sprint(len(warnings)))
		w.Header().Set("X-Render-Warnings", urlEncode(string(wj)))
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename*=UTF-8''%s.pdf", urlEncode(doc.Name)))
	_, _ = w.Write(pdf)
}

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

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func writeRawJSON(w http.ResponseWriter, raw []byte) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(raw)
}

func httpError(w http.ResponseWriter, code int, err error) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

// httpInternalError 內部錯誤：細節（可能含檔案路徑）只進 log，client 收固定訊息。
// 渲染類 500 例外走 httpError（訊息是給編輯器使用者看的引擎提示，不含內部資訊）。
func httpInternalError(w http.ResponseWriter, err error) {
	slog.Error("internal error", "err", err)
	httpError(w, 500, errors.New("伺服器錯誤"))
}

// cors 全開（demo 用；產品化時應改白名單 + 對渲染 API 加驗證）
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
