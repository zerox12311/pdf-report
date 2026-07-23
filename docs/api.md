# HTTP API 參考（backend/internal/httpapi）

Gin。所有回應錯誤統一 `{"error": "訊息"}`（中文、不洩內部細節）。樣板 payload 為 **raw JSON passthrough**：後端不重排/不改寫樣板 JSON，未知欄位原樣保存（引擎只是忽略）。CORS 全開（iframe 嵌入需要跨域；認證上線後配 API key/token 收斂）；`/healthz` 回 `ok`。

**多租戶**：schema 已就緒（tenants/api_keys），目前 API 層固定 default 租戶；認證（API key＋短效嵌入 token）為下一階段。

## 樣板

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/templates` | 清單 `[{id, name, updatedAt}]` |
| POST | `/api/templates` | 新建（body = 樣板 JSON；伺服器配 id）→ 回完整樣板 |
| GET | `/api/templates/:id` | 取得樣板 JSON（原樣） |
| PUT | `/api/templates/:id` | 覆寫 → 回完整樣板 |
| DELETE | `/api/templates/:id` | 刪除（204） |

body 上限 10MB；非 JSON 物件 → 400「樣板 JSON 解析失敗（body 需為樣板 JSON 物件）」；找不到 → 404。

## 渲染

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/templates/:id/render` | **正式渲染**（宿主整合契約）：body `{"data": {...}}`（可空 body = 無資料）→ `application/pdf` |
| POST | `/api/templates/render` | adhoc 渲染（編輯器預覽）：body `{"template": {...}, "data": {...}}` |

- 數字以 `json.Number` 解析，保留原始字面（金額不失真）。
- `data` 必須是 JSON 物件或省略；其他型別 → 400。
- **警告機制**：資料缺 key 等問題不擋渲染，回 header `X-Render-Warnings-Count` ＋ `X-Render-Warnings`（percent-encoded JSON 陣列，同訊息去重）。
- **strict 模式**：`?strict=1` 時有任何警告 → 422 `{"error", "warnings"}`（財務單據建議串接時開啟）。
- **輸入驗證守門**：樣板若開啟驗證（`validation.enabled`），正式渲染在渲染前先驗 `data`，不過 → 422 `{"error", "validationErrors":[{path, rule, message}]}`、**不產生 PDF**。`rule` 為 `required`｜`type`；陣列逐元素錯誤帶索引（`items[2].amount`）。關閉或無規則則跳過。adhoc 渲染不套此守門。
- `Content-Disposition: inline; filename*=UTF-8''<樣板名>.pdf`。

## 輸入驗證

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/validate` | 測試 schema：body `{"validation": {...}, "data": {...}}` → `{"ok": bool, "errors":[{path, rule, message}]}` |

- 與正式渲染守門共用同一個驗證器（`internal/validate`，唯一權威）——「測試說過」= 「render 會過」。
- **忽略** `validation.enabled`（測試就是要跑這組規則）；`validation` 為 null（無規則）→ `ok:true`。
- `data` 必須是 JSON 物件或省略；其他型別 → 400。編輯器「驗證」分頁的測試區呼叫此端點。

## 圖片資產

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/assets` | multipart `file` 欄位；僅 PNG/JPEG（**內容嗅探**，不信 client Content-Type）→ `{"id"}` |
| GET | `/api/assets/:id` | 回圖檔 |

上限 10MB；超限 → 400「請求內容過大（上限 10MB）」。

## 字型

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/fonts` | multipart `file`（TTF/OTF，檔頭驗證）＋選填 `name`（預設檔名）→ `{"id", "name"}` |
| GET | `/api/fonts` | 清單 `[{"id", "name"}]`（編輯器字型下拉用） |
| GET | `/api/fonts/:id` | 回字型檔（`Cache-Control: public, max-age=86400`；前端 FontFace 預覽用） |

上限 40MB（中文字型較大）。檔案一律以 `{id}.ttf` 落地（含 OTF 上傳）。樣板中 `fontFamily` 直接放字型 id，引擎動態註冊。

## 儲存層

結構化資料在 PostgreSQL（GORM；樣板存 JSONB），圖片/字型二進位檔在檔案系統 `storage/`。

**ImportLegacy**（啟動時執行一次）：某資源的資料表為空時，把 `STORAGE_ROOT` 下對應的舊檔案版資料匯入 DB（樣板讀 `storage/templates/*.json`；圖片/字型匯入中繼資料，二進位檔本來就留在檔案系統）。表非空則跳過——全新資料庫＋空 storage 就是乾淨開始，不會有資料出現。

（測試覆蓋等開發規範見 [CLAUDE.md](../CLAUDE.md) 的「不可破壞的規範」。）
