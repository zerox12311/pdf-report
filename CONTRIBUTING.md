# 貢獻指南

感謝你有興趣參與！這份文件說明如何回報問題、提出功能建議、以及送出程式碼。

## 回報問題（Issue）

- **Bug**：請附上重現步驟、預期行為與實際行為。如果跟渲染結果有關，請盡量附上樣板 JSON（編輯器的「JSON」分頁可直接複製）與送進去的資料，這能讓問題幾乎一定可以被重現。
- **功能建議**：先描述你想解決的「情境」（例如：我需要在收據上印○○），再說你想像的做法。情境比做法重要。

## 開發環境

開發需要 Docker、Node 22 與 [mise](https://mise.jdx.dev)（管理 Go 版本）。完整的啟動指令、架構說明、以及「新增一種元件要改哪些檔案」這類路線圖，都在 [CLAUDE.md](CLAUDE.md)——動手前請先讀它，它同時也是給 AI 協作工具看的說明書。

最短路徑：

```bash
docker compose up -d db          # 起 Postgres（後端開發與測試都需要）
cd backend && mise x go@1.25 -- go test ./...
cd frontend && npm install && npm start   # :4300，proxy 到後端 :5043
```

## 送 Pull Request 之前

專案有幾條「不可破壞的規範」，PR 會以此檢視（細節都在 [CLAUDE.md](CLAUDE.md)）：

1. **前後端 schema 同步**：改了樣板結構，`frontend/.../template.model.ts` 與 `backend/internal/engine/models.go` 必須一起改，舊樣板要能照常打開。
2. **渲染是決定性的**：同樣的輸入必須產出 byte 完全相同的 PDF。引擎相關改動要通過 golden 測試（`backend/internal/engine/golden_test.go`）。
3. **雙實作要成對改**：值格式化與行內樣式標記在前後端各有一份實作，改一邊就要改另一邊，並補上兩邊的測試。
4. **測試與建置要過**：
   - 後端：`mise x go@1.25 -- go test ./...`
   - 前端：`npm run test:ci` 與 `npx ng build --configuration production`（單元測試全過不代表建置會過，兩個都要跑）
5. **文件跟著功能走**：功能改了行為，`docs/` 對應文件（editor / engine / api / embed）要一起更新。沒更新文件的功能不算完成。

## PR 流程

1. Fork 後開分支，一個 PR 聚焦一件事。
2. Commit 訊息用一句話講清楚「做了什麼」（本專案歷史以中文為主，中英文皆可）。
3. PR 描述請寫：動機、做法、以及你怎麼驗證的（測試、截圖、或 PDF 輸出比對）。
4. 有介面變動的話附上前後截圖，會大幅加快 review。

## 授權

送出貢獻即表示你同意你的程式碼以本專案的 [MIT 授權](LICENSE)釋出。
