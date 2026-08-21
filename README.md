# PDF 樣板編輯器 + 報表引擎（Angular + Go）

通用的 PDF 產生器與樣板編輯器：在瀏覽器裡設計樣板（文字、資料欄位、表格、條碼、圖片…），樣板存成 JSON，由 Go 報表引擎渲染成 PDF。可被其他系統以 **iframe 嵌入**編輯器，宿主後端拿樣板 id POST 資料產出正式 PDF。

## 文件入口

- **開發者（人或 AI agent）從 [CLAUDE.md](CLAUDE.md) 開始**：架構、開發指令、不可破壞的規範、開發陷阱。
- **功能現況**在 [docs/](docs/README.md)：[編輯器](docs/editor.md)｜[渲染引擎](docs/engine.md)｜[HTTP API](docs/api.md)｜[宿主整合（iframe 嵌入）](docs/embed.md)。
- 樣板 JSON schema 的權威是程式碼：`frontend/src/app/core/models/template.model.ts` ↔ `backend/internal/engine/models.go`（兩邊同步改）。

## 快速開始

```bash
docker compose up -d --build
```

- 編輯器與 API：http://localhost:8090（單一 app 容器，前端與 `/api` 同源；`/healthz` 健康檢查）。預設管理員 **`admin` / `admin1234`**（`docker-compose.yml` 定義）——**對外部署前務必改掉 `ADMIN_PASSWORD` 與 `SESSION_SECRET`**。
- 嵌入示範頁：瀏覽器直接開 [docs/embed-example.html](docs/embed-example.html)
- compose project `pdf-template-demo`（app + db 兩個服務）；Postgres :5442（`pg-data` volume）、圖片/字型二進位檔在 `pdf-storage` volume。

本機開發（前端 :4300 proxy → 後端 :5043、測試、建置指令）見 [CLAUDE.md](CLAUDE.md) 的「常用指令」。

## 技術棧

- `frontend/` — Angular 20（standalone + signals、OnPush），編輯器仿 JasperReports 版面
- `backend/` — Go + Gin + PostgreSQL/GORM + [gopdf](https://github.com/signintech/gopdf) + boombuler/barcode；渲染的唯一權威是 `internal/engine`（前端預覽也走後端）

## 字型注意事項

- Noto TC TTF 放兩處：`backend/fonts`（PDF 嵌入，gopdf 自動 subset）與 `frontend/public/fonts`（畫布顯示，讓所見接近輸出）。內建字型為 Noto 系列的修改版（子集化＋假斜體），依 **SIL OFL 1.1** 散布，見 [backend/fonts/OFL.txt](backend/fonts/OFL.txt) 與 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 內建字型已離線裁剪為 **Big5 常用漢字區（約 5,400 字）+ ASCII + 全形標點**。極罕用字會缺字；要擴充覆蓋時用 fonttools 的 `pyftsubset` 重新裁剪並同步替換兩處。使用者也可自行匯入完整字型（`POST /api/fonts`）。
