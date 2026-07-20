# PDF 樣板編輯器 + 報表引擎（Angular + Go）

在瀏覽器裡設計 PDF 樣板（文字、資料佔位欄位、圖片、表格、矩形、線條），樣板存成 JSON，
由 Go 報表引擎（[gopdf](https://github.com/signintech/gopdf)，MIT）渲染成 PDF。
可被其他系統以 **iframe 嵌入**，儲存後以 postMessage 取得樣板 id，宿主後端拿 id POST 資料即可產出 PDF——見 [docs/embed.md](docs/embed.md)。

報表功能：
- **陣列迴圈（重複列）**：表格某一列綁定資料陣列，依筆數展開；下方元素自動推移
- **跨頁分頁**：明細超過頁面自動換頁，**每頁重畫表頭列**
- **頁首/頁尾 band**：band 區內的元素每頁重複（標題、LOGO、頁碼）
- **頁碼**：placeholder key 用 `$page`（目前頁碼）、`$pages`（總頁數）

預覽與正式產出走同一個後端引擎（未儲存的樣板由 `POST /api/templates/render` 直接渲染），所見即所得。

## 快速開始

```bash
docker compose up --build
```

- 前端編輯器：http://localhost:8090
- 後端 API：http://localhost:8091（`/healthz` 健康檢查）
- 嵌入示範頁：直接用瀏覽器開 [docs/embed-example.html](docs/embed-example.html)
- compose project name 為 `pdf-template-demo`，與其他專案隔離；樣板與圖片存在 `pdf-storage` volume。

### 本機開發（不走 Docker）

```bash
# 後端（需 Go 1.22+），開在 http://localhost:5043
cd backend && go run .

# 前端（需 Node 22+），開在 http://localhost:4200，/api 由 proxy.conf.json 轉發到 5043
cd frontend && npm install && npx ng serve
```

## 操作流程

1. 首頁「新增樣板」進入編輯器，工具列加入元素，拖曳移動、右下角圓點縮放，右側面板編輯屬性。
2. 「資料欄位」（挖洞）：設定 `key`（支援 `customer.name`、`items[0].qty` 路徑）與範例值；渲染時由資料 JSON 填入，取不到則用範例值。
3. 表格：點選表格後再點儲存格，可在右側把該格設為靜態文字或資料欄位；列欄數、欄寬列高都可調。
   - **陣列迴圈（報表重複列）**：在表格屬性啟用後指定陣列 key（如 `items`）與重複列，該列會依資料陣列筆數展開（儲存格 key 用相對路徑如 `name`、`qty`），下方元素（合計列之後的簽名欄、圖片等）自動往下推。空陣列則該列省略。
4. **頁首/頁尾**：畫布空白處點一下，右側「頁面設定」調頁首/頁尾高度（pt）；畫在 band 區內（虛線之外）的元素每頁重複。頁碼放在頁尾：資料欄位 key 填 `$page` 或 `$pages`。
5. 「預覽 PDF」：左側可編輯資料 JSON（「用範例值重建」會從欄位範例值產生，重複列自動產 3 筆陣列），右側顯示後端引擎渲染結果（含分頁）。
6. 「儲存」把樣板 JSON 存到後端檔案系統。

## 架構

```
docker-compose.yml          # name: pdf-template-demo；frontend :8090 / backend :8091
├── frontend/               # Angular 20（standalone + signals）
│   ├── nginx.conf          # 靜態檔 + /api 反向代理到 backend:8080
│   └── src/app/
│       ├── core/models/template.model.ts     # 樣板 schema（TS 端契約）
│       ├── pdf/render-spec.ts                # 資料路徑工具（範例資料產生）
│       └── features/
│           ├── template-list/                # 樣板清單
│           └── editor/                       # 編輯器（畫布/工具列/屬性面板/預覽）
├── backend/                # Go（net/http + gopdf）
│   ├── models.go           # 樣板 schema（Go 端契約）
│   ├── renderspec.go       # 繪製規則（換行/路徑解析/表格展開/推移）
│   ├── engine.go           # 報表引擎（band 分類、分頁、gopdf 繪製）
│   ├── storage.go          # 檔案系統儲存（templates 為 raw JSON passthrough）
│   ├── main.go             # HTTP API（stdlib mux）
│   └── fonts/              # Noto Sans TC（與前端畫布顯示用同一份）
└── docs/embed.md           # iframe 嵌入整合指南 + embed-example.html 示範宿主頁
```

### API

- `GET/POST /api/templates`、`GET/PUT/DELETE /api/templates/{id}` — 樣板 CRUD
- `POST /api/templates/{id}/render`，body `{ "data": {...} }` → `application/pdf`（正式渲染）
- `POST /api/templates/render`，body `{ "template": {...}, "data": {...} }` → 未儲存樣板直接渲染（編輯器預覽用）
- `POST /api/assets`（multipart，PNG/JPEG）→ `{ "id": "..." }`；`GET /api/assets/{id}`

樣板 JSON 格式見 [docs/template-schema.md](docs/template-schema.md)。

## 報表引擎設計（backend/engine.go）

- **座標**：pt、top-left 原點；A4 = 595.28 × 841.89。
- **Band 模型（依設計位置劃分）**：設計 y < `page.headerHeight` 的元素＝頁首、y ≥ `page.height - footerHeight`＝頁尾，兩者每頁重複；其餘為內文。
- **分頁**：內文元素依 y 排序逐一定位；放不下就換頁（keep-together）。啟用 repeat 的表格逐列分片，每片重畫表頭列（repeat.rowIndex 之前的列）；分頁造成的位移會依序推給後續元素。
- **頁碼**：placeholder key `$page` / `$pages` 由引擎在繪製時解析。
- 文字 baseline 用固定常數 `0.88 × fontSize`；換行為 greedy 演算法（CJK 逐字、拉丁成詞）；表格為純畫線＋逐格文字。

### 字型注意事項

- Noto Sans TC TTF 放兩處：`backend/fonts`（PDF 嵌入，gopdf 會自動 subset）與 `frontend/public/fonts`（編輯畫布顯示，讓所見接近輸出）。
- 字型已離線裁剪為 **Big5 常用漢字區（約 5,400 字）+ ASCII + 全形標點**（原檔 7MB → 1.9MB）。極罕用字會缺字；要擴充覆蓋範圍時用 fonttools 的 `pyftsubset` 重新裁剪並同步替換兩處。

### 已知限制

- 表格儲存格為單行文字；一個表格一個重複列；尚無群組/小計、欄位運算（sum/count）——屬第二階段。
- 高度超過一整頁內容區的單一元素會被裁切。
- 渲染/管理 API 目前無驗證（demo）；產品化需加 API key 與樣板歸屬，見 docs/embed.md 的待辦清單。
