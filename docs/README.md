# 專案功能文件

PDF 樣板編輯器＋報表引擎的**功能現況**文件。給接手開發的人（或 AI agent）快速了解「現在有什麼、行為是什麼」。

## 文件清單

| 文件 | 內容 |
|---|---|
| [editor.md](editor.md) | 前端編輯器：版面、元件、畫布操作、表格、右鍵選單、資料分頁、節管理 |
| [engine.md](engine.md) | Go 渲染引擎：節/分頁、資料語法、表格重複列、儲存格能力、浮水印、字型 |
| [api.md](api.md) | HTTP API 參考：endpoints、請求/回應契約、錯誤與警告格式 |
| [embed.md](embed.md) | 宿主系統整合指南：iframe 嵌入編輯器、後端呼叫 render API（附 [embed-example.html](embed-example.html) 可跑範例） |

## 維護規則（重要）

1. **只記結果，不記歷史**。文件描述程式碼的目前狀態（「表格移動靠左上角手柄」），不描述行為變更（「以前拖表格內容會移動，後來改成…」）。改了行為就直接改寫描述。
2. **每個功能開發完成後，主動更新對應文件**——這是開發流程的一部分，不是選配。新功能沒寫進文件 = 沒完成。
3. 文件與程式碼不一致時，以程式碼為準，並修文件。
4. 架構、開發指令、程式碼規範在 [CLAUDE.md](../CLAUDE.md)；這裡只寫「產品功能長什麼樣」。
5. 樣板 JSON schema 的**權威是程式碼**：`frontend/src/app/core/models/template.model.ts` ↔ `backend/internal/engine/models.go`（兩邊同步改，見 CLAUDE.md）。不另維護 schema 文件。
6. [embed.md](embed.md) 與編輯器內建「🔗 連接」對話框（`integration-dialog.component.ts`）內容互為鏡像——改整合說明時兩邊都要改。

## Schema 怎麼讀（改 schema 前必看）

- 入口型別：`template.model.ts` 的 `TemplateDoc`（→ `DocSection` → `TemplateElement` union → `TableElement`/`TableCell`…），每個欄位都有註解。Go 端對應 `engine/models.go`。
- **舊格式**：早期樣板是 `elements` 平面清單＋`cover`/`backPage`（無 sections）。讀入時由 `template.model.ts` 的 `normalizeTemplate()` 遷移成節模型；**引擎端也保留舊路徑**（`engine.go` 的 Render 依 `Sections` 是否存在分流）。
- **改 schema 的檢查清單**：① TS model ② Go model ③ `normalizeTemplate()`（舊樣板補預設值）④ 新欄位是**指標/slice** 時，`engine.go` 的 `cloneElements` 要補手動深拷貝（scalar 不用）⑤ UI 跟上：畫布視覺（`canvas-element.component.ts` / `editor-canvas.component.ts`）＋屬性面板（`properties-panel.component.ts`）。
- 儲存端是 raw JSON passthrough：後端不解析樣板內容存 JSONB，schema 落後不會丟資料，只是引擎忽略新欄位。
