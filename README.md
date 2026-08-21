# PDF 樣板編輯器 + 報表引擎（Angular + Go）

通用的 PDF 產生器與樣板編輯器：在瀏覽器裡設計樣板（文字、資料欄位、表格、條碼、圖片…），樣板存成 JSON，由 Go 報表引擎渲染成 PDF。可被其他系統以 **iframe 嵌入**編輯器，宿主後端拿樣板 id POST 資料產出正式 PDF。

## Quick Start

只需要 [Docker](https://www.docker.com/)：

```bash
git clone https://github.com/zerox12311/pdf-report.git
cd pdf-report
docker compose up -d --build
```

**1. 登入** — 打開 http://localhost:8090，預設管理員 **`admin` / `admin1234`**。

**2. 設計樣板** — 建立專案 → 新增樣板，進入編輯器：從左側元件盤拖入文字、表格、條碼等元件；要放「渲染時才代入的資料」就用**資料欄位**元件，key 填 `customer.name` 這種路徑。

**3. 預覽** — 編輯器上方切到「預覽」分頁，左側貼一份資料 JSON（或按「用範例值重建」自動生成），右側立即看到後端渲染的真實 PDF。

**4. 從你的系統產出 PDF** — 在專案設定頁簽發 API key，然後 POST 資料到 render API：

```bash
curl -X POST "http://localhost:8090/api/templates/<樣板id>/render" \
  -H "Authorization: Bearer pdftpl_你的金鑰" \
  -H "Content-Type: application/json" \
  -d '{"data": {"customer": {"name": "王小明"}}}' \
  -o out.pdf
```

編輯器右上角的「🔗 連接」按鈕會產生**帶著你實際樣板 id 的完整串接說明**（含 iframe 嵌入編輯器的作法），可直接複製給工程師。

> ⚠️ 預設帳密與 `SESSION_SECRET` 僅供本機試用，**對外部署前務必修改**——見下方「環境變數設定」。

## 文件入口

- **開發者（人或 AI agent）從 [CLAUDE.md](CLAUDE.md) 開始**：架構、開發指令、不可破壞的規範、開發陷阱。
- **功能現況**在 [docs/](docs/README.md)：[編輯器](docs/editor.md)｜[渲染引擎](docs/engine.md)｜[HTTP API](docs/api.md)｜[宿主整合（iframe 嵌入）](docs/embed.md)。
- 樣板 JSON schema 的權威是程式碼：`frontend/src/app/core/models/template.model.ts` ↔ `backend/internal/engine/models.go`（兩邊同步改）。

## 環境變數設定

把 [.env.example](.env.example) 複製成 `.env` 再修改，`docker compose` 會自動讀取（不建 `.env` 也能跑，全部有本機試用預設值）：

```bash
cp .env.example .env
```

| 變數 | 預設 | 說明 |
|---|---|---|
| `APP_PORT` | `8090` | 服務對外 port |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / `admin1234` | 控制台初始管理員（僅首次啟動、使用者表為空時建立；之後在控制台改密碼即可） |
| `SESSION_SECRET` | `change-me-in-production` | 登入 session 與 embed token 的簽章金鑰。**對外部署必改**（`openssl rand -hex 32`） |
| `POSTGRES_PASSWORD` | `pdftpl` | 資料庫密碼（app 連線字串自動帶入同值） |
| `CORS_ORIGINS` | 空（僅同源） | 跨網域白名單，逗號分隔；`*` = 全開（僅建議 demo）。宿主前端要跨網域直呼 API 時填宿主網域 |

不透過 Docker 部署時，後端另有 `PORT`、`DATABASE_URL`、`STORAGE_ROOT`、`FONTS_DIR`、`WEB_ROOT` 等變數，見 [CLAUDE.md](CLAUDE.md) 的架構說明。

## 部署細節

- 單一 app 容器，前端與 `/api` 同源；`/healthz` 健康檢查。嵌入示範頁：瀏覽器直接開 [docs/embed-example.html](docs/embed-example.html)。
- compose project `pdf-template-demo`（app + db 兩個服務）；Postgres :5442（`pg-data` volume）、圖片/字型二進位檔在 `pdf-storage` volume。
- 本機開發（前端 :4300 proxy → 後端 :5043、測試、建置指令）見 [CLAUDE.md](CLAUDE.md) 的「常用指令」。

## 技術棧

- `frontend/` — Angular 20（standalone + signals、OnPush），編輯器仿 JasperReports 版面
- `backend/` — Go + Gin + PostgreSQL/GORM + [gopdf](https://github.com/signintech/gopdf) + boombuler/barcode；渲染的唯一權威是 `internal/engine`（前端預覽也走後端）

## 字型注意事項

- Noto TC TTF 放兩處：`backend/fonts`（PDF 嵌入，gopdf 自動 subset）與 `frontend/public/fonts`（畫布顯示，讓所見接近輸出）。內建字型為 Noto 系列的修改版（子集化＋假斜體），依 **SIL OFL 1.1** 散布，見 [backend/fonts/OFL.txt](backend/fonts/OFL.txt) 與 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 內建字型已離線裁剪為 **Big5 常用漢字區（約 5,400 字）+ ASCII + 全形標點**。極罕用字會缺字；要擴充覆蓋時用 fonttools 的 `pyftsubset` 重新裁剪並同步替換兩處。使用者也可自行匯入完整字型（`POST /api/fonts`）。
