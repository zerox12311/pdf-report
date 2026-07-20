# PDF 樣板編輯器 + 報表引擎

收款單（payment receipt）導向的 PDF 樣板產品：宿主系統用 **iframe 嵌入**前端編輯器設計樣板（postMessage 拿到樣板 id），宿主後端 **POST 資料到 render API** 產出正式 PDF。前端只做設計與預覽（預覽也走後端渲染），**渲染的唯一權威是 Go 引擎**。

## 架構

- `frontend/` — Angular 20 standalone + signals，全面 OnPush。編輯器仿 JasperReports 版面（左元件/大綱、中畫布＋節列＋設計/JSON/預覽分頁、右屬性面板）。
- `backend/` — Go（stdlib `net/http`，Go 1.22 method+wildcard mux）＋ gopdf ＋ boombuler/barcode。
  - `cmd/server/` 進入點（env：`PORT`、`STORAGE_ROOT`、`FONTS_DIR`）
  - `internal/store/` 檔案系統儲存（templates raw JSON passthrough、assets、fonts；原子寫入 temp+rename）
  - `internal/engine/` 報表引擎（本專案核心）
  - `internal/httpapi/` HTTP handlers
- `docker-compose.yml` — project `pdf-template-demo`：frontend :8090（nginx 反代 /api）、backend :8091、volume `pdf-storage`。
- `docs/embed.md` — 宿主整合指南（編輯器內建「🔗 連接」對話框有同樣內容可複製）。

## 常用指令

```bash
# 本機開發（Go 用 mise 管理；直接跑 go 會版本不對）
cd backend && mise x go@1.25 -- go test ./...
mise x go@1.25 -- go build -o /tmp/pdfsrv ./cmd/server
STORAGE_ROOT=$PWD/storage FONTS_DIR=$PWD/fonts /tmp/pdfsrv   # :5043

cd frontend && npm start                                      # ng serve :4300，proxy /api → :5043
npx ng build --configuration production
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:ci

docker compose up -d --build                                  # 完整 demo :8090/:8091
```

## 不可破壞的規範

- **Schema 前後端同步**：`frontend/src/app/core/models/template.model.ts` ↔ `backend/internal/engine/models.go` 必須一起改。儲存端是 raw JSON passthrough，後端 schema 落後不會丟資料，但引擎會忽略新欄位。
- **Golden 測試**：`internal/engine/golden_test.go` 對 `testdata/golden/*.pdf` 做 **byte 比對**。引擎重構後 golden 必須全過；視覺相同但 byte 改變的變更要走「舊路徑保留」策略（例：表格無合併時走整條格線快速路徑）。重新產生：`go test ./internal/engine/ -run TestGolden -update-golden`（先目視確認輸出）。
- **渲染決定性**：同輸入必須產出 byte 相同的 PDF（字型註冊固定排序等）。不要在引擎內引入 map 迭代順序或時間依賴。
- **httpapi `New` 維持 100% 覆蓋**（`go tool cover -func`），新 endpoint 要補齊所有分支的測試。
- **格式化雙實作**：`internal/engine/format.go`（權威）↔ `frontend/src/app/core/utils/format-value.ts`（畫布預覽鏡像），改一邊必改另一邊＋兩邊測試（format_test.go / format-value.spec.ts）。
- **EditorStateService 必須可 `new` 建構**（specs 直接 `new EditorStateService()`，內部不得用 `inject()`）。
- 渲染錯誤不靜默：資料缺 key → 警告（`X-Render-Warnings` header）；`?strict=1` → 422。壞 JSON body → 400。這是財務單據產品的硬要求。

## 領域模型速記

- **節（sections）**：文件 = 有序節清單；`flow` 節有頁首/頁尾 band（依 y 位置分類：y < headerHeight = 頁首、y ≥ height−footerHeight = 頁尾，每頁重複）＋內容自動分頁；`single` 節 = 獨立一頁無 band。每節可覆寫紙張/方向與浮水印（inherit/none/custom）。`$page`/`$pages` 全文件連續。舊格式（elements+cover/backPage）由 normalize 遷移、引擎保留舊路徑。
- **引擎流程**：`Render` → clone → 逐節 `newLayout`（band 分類）→ `applyGrowth`（autoGrow/容器撐高）→ `paginate`（連續座標 c ＋ shift 累積；重複表格分片並重畫表頭）→ `draw`（逐頁；浮水印 below/above 分層，`aboveWatermark` 元素畫在上層浮水印之後）。
- **座標**：pt、top-left 原點。前端畫布 model↔visual 轉換在 `band-geometry.ts`（band 標籤列各佔 22px）。
- **引擎保留 key**：`$page` `$pages` `$sum(path)` `$count` `$avg` `$row` `$gsum` `$gcount` `$gavg`；值格式化 `comma`/`twUpper`（壹拾銀行慣例）/`rocDate`/`rocDateLong`。
- **字型**：內建 sans/serif/mono（Noto，Big5 常用字 subset，前後端同 TTF）；使用者匯入字型存 `storage/fonts/{id}.ttf`，`fontFamily` 直接放字型 id，引擎動態註冊、前端 FontFace 預覽。

## 開發陷阱（都踩過）

- **殺 dev 後端**用 `lsof -nP -iTCP:5043 -sTCP:LISTEN -t | xargs kill`——`pkill -f "go run"` 殺不到 child binary，會拿舊行為 debug 半天。**引擎改動後記得重編 `/tmp/pdfsrv` 再驗證**。
- 前端測試需要 `CHROME_BIN` 指到本機 Chrome；Angular CLI 鎖 @20（node 22.21 跑不動更新版）。
- 瀏覽器自動化驗證時：座標點擊不可靠，用 JS dispatch PointerEvent／read_page refs；OnPush 下改 signal 後要等一個 tick 再查 DOM。
- PDF 目視驗證：`pdftoppm -png -r <dpi>`（可 `-x -y -W -H` 裁區域）轉 PNG 檢視。
- 屬性面板等大模板檔不要用腳本做結構性取代（曾把模板砍掉一半），用精準的 Edit。

## 產品方向備忘

使用者明確說過「先不用管文件，把功能跟畫面做好」。功能對標 JasperReports（節=Report Book、band、群組小計、浮水印），領域重點是台灣收款單：中一刀/熱感紙張、超商三段條碼（Code39）、金額國字大寫、民國年、作廢章（浮水印資料綁定）。
