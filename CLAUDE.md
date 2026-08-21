# PDF 樣板編輯器 + 報表引擎

收款單（payment receipt）導向的 PDF 樣板產品：宿主系統用 **iframe 嵌入**前端編輯器設計樣板（postMessage 拿到樣板 id），宿主後端 **POST 資料到 render API** 產出正式 PDF。前端只做設計與預覽（預覽也走後端渲染），**渲染的唯一權威是 Go 引擎**。

> **功能現況文件在 [docs/](docs/README.md)**（[editor.md](docs/editor.md)／[engine.md](docs/engine.md)／[api.md](docs/api.md)／[embed.md](docs/embed.md)）——開發新功能前先讀對應文件了解現有行為；**功能完成後必須主動更新它**（只記結果不記歷史，規則見 docs/README.md）。

## 架構

- `frontend/` — Angular 20 standalone + signals，全面 OnPush。編輯器仿 JasperReports 版面（左元件/大綱、中畫布＋節列＋設計/JSON/預覽分頁、右屬性面板）。關鍵檔案（都在 `src/app/`）：
  - `core/models/template.model.ts` — 樣板 schema（TS 權威）＋normalizeTemplate（舊格式遷移）
  - `features/editor/editor-state.service.ts` — 編輯狀態中樞（signals、選取、undo 歷史、全部結構操作）；**改前端的第一站**
  - `features/editor/element-factory.ts` — 元件盤 → 新元素的工廠（超商三段條碼等套件也在此）
  - `features/editor/canvas-element.component.ts` — 元素的畫布視覺；`editor-canvas.component.ts` — 定位/拖曳/縮放/右鍵
  - `features/editor/properties-panel.component.ts` — 屬性面板
  - **「新增一種元件」的檔案鏈**：template.model.ts → engine/models.go →（引擎 drawElement case）→ element-factory.ts → canvas-element.component.ts → properties-panel.component.ts，最後更新 docs/editor.md＋engine.md
- `backend/` — Go（**Gin**）＋ gopdf ＋ boombuler/barcode ＋ **PostgreSQL/GORM**。
  - `cmd/server/` 進入點（env：`PORT`、`STORAGE_ROOT`、`FONTS_DIR`、`DATABASE_URL`（必填，Postgres-only）、`WEB_ROOT`（前端靜態檔目錄，空 = 純 API 模式；Docker 單容器部署時設，見 `httpapi/spa.go`）、`ADMIN_USER`/`ADMIN_PASSWORD`（控制台初始管理員，僅 user 表空時種）、`SESSION_SECRET`（登入 session 簽章））
  - `internal/db/` GORM models（多租戶：tenants/api_keys/templates JSONB/assets/fonts）＋ Open/migrate
  - `internal/store/` 資料存取：結構化資料走 DB、圖片/字型二進位留檔案系統；方法都帶 tenantID；ImportLegacy 一次性匯入舊檔案資料
  - `internal/engine/` 報表引擎（本專案核心）
  - `internal/httpapi/` Gin：`router.go`（New + 路由總表）、`middleware.go`、按資源拆的 `template/render/asset/font_handler.go`（handler struct + 方法）、`respond.go`（共用回應 helpers）、`spa.go`（`WEB_ROOT` 非空時 serve 前端靜態檔＋SPA fallback，單容器部署用）。新 endpoint 按資源歸檔。
    **Gin 契約**：樣板 payload 一律 raw bytes（readBody/c.Data），**禁用 ShouldBindJSON**——會破壞 raw JSON passthrough 與 json.Number 數字字面；middleware 用自寫的 slogLogger/recoverJSON/cors（不用 gin.Default）；New 回傳 http.Handler，httptest 直接打。
  - `internal/testdb/` 測試用 per-test database 工具
- `Dockerfile`（根目錄，單一 image：前端 Angular build → Go build → runtime，**後端直接 serve 前端靜態檔、無 nginx**）＋ `docker-compose.yml` — project `pdf-template-demo`：**app :8090**（前端與 /api 同源）、postgres db :5442（本機開發/測試共用）、volumes `pdf-storage`（二進位檔）+ `pg-data`。
- `docs/` — **功能現況文件**（README 索引＋editor/engine/api/embed）。embed.md 是宿主整合指南；**對外交付的 API 說明是編輯器內的「🔗 連接」對話框**（`integration-dialog.component.ts`，分前端/後端兩分頁、各可複製整份，會代入實際樣板 id 與服務位址）。改了 API 契約要同時更新它與 embed.md。**刻意不做 OpenAPI/Swagger**（使用者決定：那類端點正式環境要關掉，自製對話框可以留著當交付文件）。

## 常用指令

**工具前置**：Docker、[mise](https://mise.jdx.dev)（`brew install mise`；Go 由它管理，指令都寫成 `mise x go@1.25 --`，不需全域裝 Go）、Node 22（Angular CLI 鎖 @20，node 太新跑不動更新版 CLI）、poppler（`brew install poppler`，PDF 目視驗證的 `pdftoppm`）。

```bash
# 本機開發（Go 用 mise 管理；直接跑 go 會版本不對）
docker compose up -d db                                       # 後端開發/測試都需要 Postgres（:5442）
cd backend && mise x go@1.25 -- go test ./...                 # 測試打真 Postgres，每個測試獨立 database
mise x go@1.25 -- go build -o /tmp/pdfsrv ./cmd/server
STORAGE_ROOT=$PWD/storage FONTS_DIR=$PWD/fonts SESSION_SECRET=dev-secret \
  DATABASE_URL="postgres://pdftpl:pdftpl@localhost:5442/pdftpl?sslmode=disable" /tmp/pdfsrv  # :5043
# SESSION_SECRET 未設會拒啟動（它同時簽 session cookie 與 embed token，退回 dev 常數等於可被偽造）

cd frontend && npm start                                      # ng serve :4300，proxy /api → :5043
npx ng build --configuration production
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:ci

docker compose up -d --build                                  # 完整 demo（單一 app 容器）→ http://localhost:8090
```

## 不可破壞的規範

- **DB 是 Postgres-only**（使用者明確要求：不用 sqlite，多人會 lock）。多租戶：所有 store 查詢帶 tenantID；認證上線前 API 層固定 default 租戶。
- **Schema 前後端同步**：`frontend/src/app/core/models/template.model.ts` ↔ `backend/internal/engine/models.go` 必須一起改；舊樣板要能讀 → 檢查 `normalizeTemplate()` 是否需補預設值（三處檢查清單見 docs/README.md「Schema 怎麼讀」）。儲存端是 raw JSON passthrough，後端 schema 落後不會丟資料，但引擎會忽略新欄位。
- **Golden 測試**：`internal/engine/golden_test.go` 對 `testdata/golden/*.pdf` 做 **byte 比對**。引擎重構後 golden 必須全過；視覺相同但 byte 改變的變更要走「舊路徑保留」策略（例：表格無合併時走整條格線快速路徑）。重新產生：`go test ./internal/engine/ -run TestGoldenPDF -update-golden`（先目視確認輸出）。
- **渲染決定性**：同輸入必須產出 byte 相同的 PDF（字型註冊固定排序等）。不要在引擎內引入 map 迭代順序或時間依賴。
- **httpapi `New` 維持 100% 覆蓋**（`go tool cover -func`），新 endpoint 要補齊所有分支的測試。
- **格式化雙實作**：`internal/engine/format.go`（權威）↔ `frontend/src/app/core/utils/format-value.ts`（畫布預覽鏡像），改一邊必改另一邊＋兩邊測試（format_test.go / format-value.spec.ts）。**行內樣式標記同理**：`internal/engine/richtext.go` ↔ `core/utils/rich-text.ts`（`[b][i][c=#rrggbb]`，richtext_test.go / rich-text.spec.ts）。
- **EditorStateService 必須可 `new` 建構**（specs 直接 `new EditorStateService()`，內部不得用 `inject()`）。
- **前端 UI 字串要走 i18n**：程式碼寫中文原文包 `t('...')`（`core/i18n/i18n.ts`，非 DI 模組函式），英譯補 `core/i18n/en.ts`（缺譯退回中文不會壞）。切語言走 reload，所以模組層常數也能用 t()。例外：`format-value.ts`／`rich-text.ts` 的領域字串（引擎鏡像）不翻。
- **改過 Angular 樣板就要跑 `npx ng build --configuration production`**：`tsc --noEmit` **不檢查樣板**，karma 的 spec 也沒有實例化 editor-canvas／editor-page，所以「型別乾淨＋單元測試全過」可能還是**建置失敗**（實際踩過：`@if (el.autoGrow)` 對 `ImageElement` 不存在，tsc 與 82 個測試全過但 ng build 直接 ERROR）。樣板裡要用只存在於部分元素型別的欄位，走 component 方法收斂型別（例：`growsOnOverflow(el)`）。
- 渲染錯誤不靜默：資料缺 key → 警告（`X-Render-Warnings` header）；`?strict=1` → 422。壞 JSON body → 400。這是財務單據產品的硬要求。
- **對外的 API 說明只寫端點、請求、回應**：「🔗 連接」對話框（＝交付給客戶工程師的 API 文件）**不寫實作機制、設計理由、內部防護怎麼做的**。呼叫方要知道的是「打哪支、送什麼、回什麼、什麼錯誤碼」。被退過的實例：解釋速率限制的計數維度、解釋 X-Render-Warnings 為何重要、解釋 token 為何放 fragment、「不該做的事」安全告誡、「寫回的是樣板本體」的機制說明。程式碼註解不受此限——那裡要解釋「為什麼」。
- **功能完成 = 文件已更新**：每個功能開發完成後**主動**更新 `docs/` 對應文件（editor/engine/api）。文件只描述目前狀態（結果），不記錄行為變更的歷史；改了行為就直接改寫描述。新功能沒進文件不算完成。

## 領域模型速記

- **節（sections）**：文件 = 有序節清單；`flow` 節有頁首/頁尾 band（依 y 位置分類：y < headerHeight = 頁首、y ≥ height−footerHeight = 頁尾，每頁重複）＋內容自動分頁；`single` 節 = 獨立一頁無 band。每節可覆寫紙張/方向與浮水印（inherit/none/custom）。`$page`/`$pages` 全文件連續。舊格式（elements+cover/backPage）由 normalize 遷移、引擎保留舊路徑。
- **引擎流程**：`Render` → clone → 逐節 `newLayout`（band 分類）→ `applyGrowth`（autoGrow/容器撐高）→ `paginate`（以跨頁連續座標定位＋位移逐元素累積；重複表格分片並重畫表頭）→ `draw`（逐頁；浮水印 below/above 分層，`aboveWatermark` 元素畫在上層浮水印之後）。
- **座標**：pt、top-left 原點。前端畫布 model↔visual 轉換在 `band-geometry.ts`（band 標籤列各佔 22px）。
- **引擎保留 key**：`$page` `$pages`｜全域彙總 `$sum(path)` `$count(path)` `$avg(path)`（都要帶括號路徑）｜重複列內 `$row`、群組 `$gsum(欄位)` `$gcount` `$gavg(欄位)`；值格式化 `comma`/`twUpper`（金額國字大寫「壹拾…元整」）/`rocDate`/`rocDateLong`。完整語法見 docs/engine.md。
- **字型**：內建 sans/serif/mono（Noto，Big5 常用字 subset，前後端同 TTF）；使用者匯入字型存 `storage/fonts/{id}.ttf`，`fontFamily` 直接放字型 id，引擎動態註冊、前端 FontFace 預覽。

## 開發陷阱（都踩過）

- **殺 dev 後端**用 `lsof -nP -iTCP:5043 -sTCP:LISTEN -t | xargs kill`——`pkill -f "go run"` 殺不到 child binary，會拿舊行為 debug 半天。**引擎改動後記得重編 `/tmp/pdfsrv` 再驗證**。
- 前端測試需要 `CHROME_BIN` 指到本機 Chrome；Angular CLI 鎖 @20（node 22.21 跑不動更新版）。
- 瀏覽器自動化驗證時：座標點擊不可靠，用 JS dispatch PointerEvent／read_page refs；OnPush 下改 signal 後要等一個 tick 再查 DOM。
- PDF 目視驗證：`pdftoppm -png -r <dpi>`（可 `-x -y -W -H` 裁區域）轉 PNG 檢視。
- 屬性面板等大模板檔不要用腳本做結構性取代（曾把模板砍掉一半），用精準的 Edit。

## 產品化 roadmap（已確認的方向）

- 認證，兩條線：
  - **設計者控制台（帳密登入＋角色）＝已完成**：JasperReports 式登入→專案→樣板，httpOnly cookie session（`withAuth`/`requireAuth`/`requireAdmin`）＋ env 種初始管理員（自癒）。admin/user 兩角色、專案成員授權（`ProjectMember`）、使用者管理畫面。授權走單一 `authorizeProject` chokepoint（碰樣板端點都過）。詳見 docs/console.md。
  - **所有資料端點已上鎖**：樣板/render/adhoc/asset/font/validate 一律 `requireAny`，匿名→401（補掉 render-by-id 資料外洩、adhoc render SSRF）。唯一例外：樣板本體 `allowAnonymousRender: true`（設計者逐樣板 opt-in，預設關）時 render-by-id 可匿名，未開/不存在同回 401 防探測、匿名限流按 IP。`SESSION_SECRET` 正式必設（未設＋WEB_ROOT 非空→拒啟動）。圖片 URL 抓取已擋私有/metadata（SSRF）。
  - **宿主整合（machine-to-machine）＝已完成（Stripe 式）**：**project 級 API key**（admin 在專案頁簽發、只存雜湊、明文回一次；`pdftpl_` 前綴）給宿主後端，可建 template／換 embed token／render-by-id。**embed token**（短效 JWT、綁單一 template）宿主後端用 key 換、postMessage 交給 iframe、`Authorization: Bearer`。`withAuth` 三來源 principal（session／apikey／embed）＋ `authorizeTemplate`/`authorizeCreateInProject`。詳見 docs/embed.md。
  - **嵌入權限模式＝已完成**：embed token 帶 `mode` claim（`design`｜`fill`｜`view`，宿主**後端**指定的政策），解析成 capability（`capEditLayout`/`capEditValues`/`capUpload`）後**逐端點掛 `requireCapability`**（不在 handler 內散落 mode 判斷）。填寫模式走**窄 API** `PATCH /api/templates/:id/values`：讀 DB 原件、只覆寫被設計者標記 `fillable` 的 text 元素 content／text 儲存格 value——**不做 diff**（避免在 Go 端重現 normalizeTemplate），沒標記的欄位結構上就改不到。`GET /api/embed/context` 讓前端與後端讀同一份能力解析。embed token 一律不可 DELETE 樣板。
  - **速率限制＋寫入並行控制＝已完成**：令牌桶（`httpapi/ratelimit.go`，桶隨 router 實例建立故測試天然隔離）掛在登入／渲染／填值／換 token／上傳，超限 429＋`Retry-After`；填值以**樣板**為維度（爭用的是列鎖，換 token 繞不過去）。寫入走交易＋`SELECT … FOR UPDATE`（`store.PatchDoc`／`Save`），等鎖逾時 → 409（`store.LockWaitTimeout`）。DB 連線池已設上限，一波併發不會吃光整台的 PG 連線。
  - **尚待強化**：template 級 key、embed 範圍收斂、CORS origin 白名單、postMessage origin 驗證、fill 模式的 token TTL／續期、樣板變更稽核、限流的跨副本共用計數器（目前單實例記憶體版）。設計者 PUT 仍無樂觀鎖（會覆蓋期間的填寫內容，方向上如此設計）。
- ORM 選 GORM、多租戶模型已確認；HTTP 框架選 **Gin**（使用者為了學習指定，從 chi 換過來）。

## 產品方向備忘

使用者明確說過「先不用管文件，把功能跟畫面做好」。功能對標 JasperReports（節=Report Book、band、群組小計、浮水印），領域重點是台灣收款單：中一刀/熱感紙張、超商三段條碼（Code39）、金額國字大寫、民國年、作廢章（浮水印資料綁定）。
