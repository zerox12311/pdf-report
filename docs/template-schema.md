# 樣板 JSON Schema（v1）

前後端共同契約，落地位置：

- TS：`frontend/src/app/core/models/template.model.ts`
- C#：`backend/PdfTemplate.Api/Models/TemplateModels.cs`（System.Text.Json 多型，`type` 為 discriminator）

修改 schema 時三處（TS / C# / 本文件）需同步。

## 座標系統

- 單位一律 **pt**（1/72 inch），A4 = 595.28 × 841.89。
- 原點在**左上角**，y 向下。後端 PDFsharp 原生即 top-left；前端 pdf-lib 繪製時轉換 `yPdf = pageHeight - y - height`。
- 顏色一律 `#rrggbb`。

## 頂層

```jsonc
{
  "id": "uuid",              // 後端指派
  "name": "報價單",
  "version": 1,
  "updatedAt": "…",          // 後端指派
  "page": {
    "size": "A4", "orientation": "portrait", "width": 595.28, "height": 841.89,
    "headerHeight": 0,       // 頁首 band 高度（pt）：設計 y < headerHeight 的元素每頁重複
    "footerHeight": 0        // 頁尾 band 高度（pt）：設計 y >= height - footerHeight 的元素每頁重複
  },
  "elements": [ /* 見下 */ ]
}
```

## 分頁（報表引擎）

- 內文（band 之外）超過內容區（頁首下緣 ~ 頁尾上緣）時自動換頁；放不下的元素整個搬到下一頁（keep-together）。
- 啟用 repeat 的表格明細列跨頁分片，每片重畫表頭列（`repeat.rowIndex` 之前的列）。
- placeholder 的 `key` 可用引擎保留字 **`$page`**（目前頁碼）與 **`$pages`**（總頁數），一般放在頁尾。

## 元素共同欄位

`id`, `type`, `x`, `y`, `width`, `height`

## 元素類型

### text（文字）
```jsonc
{ "type": "text", "content": "客戶報價單",
  "fontSize": 16, "color": "#000000", "align": "left|center|right",
  "lineHeight": 1.2, "bold": false }
```
支援換行（`\n` 與自動換行，規則見 README「渲染一致性設計」）。

### placeholder（資料佔位欄位，「挖洞」）
```jsonc
{ "type": "placeholder", "key": "customer.name", "sample": "王小明",
  /* 其餘樣式欄位同 text */ }
```
渲染內容 = `data[key] ?? sample`。`key` 支援點與索引路徑：`customer.name`、`items[0].qty`。

### image（圖片）
```jsonc
{ "type": "image", "assetId": "後端 /api/assets 回傳的 id", "fit": "contain|stretch" }
```
`contain`：等比縮放置中；`stretch`：填滿框。僅支援 PNG/JPEG。

### rect（矩形）
```jsonc
{ "type": "rect", "strokeColor": "#000000", "strokeWidth": 1, "fillColor": null }
```
`fillColor` 為 null 表示不填色；`strokeWidth` 0 表示無框線。

### line（線條）
```jsonc
{ "type": "line", "strokeColor": "#000000", "strokeWidth": 1 }
```
從 `(x, y)` 畫到 `(x + width, y + height)`；水平線 `height: 0`、垂直線 `width: 0`。

### table（表格）
```jsonc
{ "type": "table",
  "columnWidths": [120, 200, 100],   // pt；width 應等於加總
  "rowHeights": [24, 24, 24],        // pt；height 應等於加總
  "borderColor": "#000000", "borderWidth": 1,
  "fontSize": 10, "cellPadding": 4,
  "cells": [
    [ { "kind": "text", "value": "品名", "align": "center", "bold": true, "key": "", "sample": "" },
      { "kind": "placeholder", "key": "items[0].name", "sample": "商品A", "align": "left", "bold": false, "value": "" } ]
    // cells[r][c] 對應 rowHeights[r] × columnWidths[c]
  ],
  "repeat": { "enabled": true, "key": "items", "rowIndex": 1 }   // 選填：陣列迴圈
}
```
儲存格為單行文字、垂直置中，超出不換行。

#### repeat（陣列迴圈，報表重複列）

- `key`：資料中的**陣列**路徑（例：`items`）。
- `rowIndex`：哪一列是重複列（0-based）。渲染時該列依陣列筆數展開，每一筆畫一列（高度取 `rowHeights[rowIndex]`）。
- 重複列的儲存格 `key` 用**相對路徑**（相對於陣列元素，例：`name`、`qty`）；其他列仍用絕對路徑。
- 資料中陣列不存在 → 以範例值畫一列；**空陣列** → 該列整列省略。
- 表格因展開變高（或變矮）時，**設計位置在表格下緣以下的元素會自動往下（上）推**相同距離（例：合計列下面的簽名欄、圖片）。
- 展開邏輯與位移規則兩端共用：`render-spec.ts` 的 `expandTable`/`computeRepeatOffsets` ↔ `RenderSpec.cs` 的 `ExpandTable`/`ComputeRepeatOffsets`。
- 限制：不支援跨頁（內容超過頁底會被裁掉），一個表格只能有一個重複列。

## 渲染資料

`POST /api/templates/{id}/render` 的 body：

```jsonc
{ "data": { "customer": { "name": "庫優科技" }, "items": [ { "name": "PDF 模組", "qty": "2" } ], "total": "10000" } }
```

取值規則：字串直接用；數字/布林轉字串；取不到（路徑不存在）時前後端一律 fallback 到欄位的 `sample`。
