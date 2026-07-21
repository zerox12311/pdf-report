# 渲染引擎（backend/internal/engine）

渲染的唯一權威：前端預覽也走後端。同輸入產出 **byte 相同**的 PDF（決定性）；golden 測試對 `testdata/golden/*.pdf` 做 byte 比對。

**程式碼分工**：`models.go` schema｜`engine.go` 版面計算與 gopdf 繪製（newLayout/applyGrowth/paginate/draw 都在此檔）｜`renderspec.go` 純函式繪製規格（換行/路徑解析/插值/表格展開，不依賴 gopdf）｜`format.go` 值格式化（權威，前端 format-value.ts 鏡像）。
**測試檔**：`golden_test.go` byte 基準｜`section_test.go` 功能輸出差異（多節/儲存格能力…，慣例：同樣板開關某功能比對輸出不同）｜`warn_probe_test.go` 警告與插值｜`determinism_check_test.go` 決定性｜`format_test.go` 格式化。新引擎功能照 section_test.go 的模式補測試。

## 渲染流程

`Render(doc, data)` → clone（呼叫者的 doc 不被修改）→ 逐節：

1. **newLayout**：依 y 位置把元素分進頁首/內文/頁尾 band（y < headerHeight = 頁首、y ≥ height−footerHeight = 頁尾，每頁重複）。
2. **applyGrowth**：autoGrow 文字、容器撐高、表格（重複列展開/儲存格換行）造成的高度變化，推移下方元素。
3. **paginate**：連續座標＋shift 累積分頁；重複表格逐列分片，跨頁重畫表頭列。
4. **draw**：逐頁繪製；浮水印分層（below→內容→（above 浮水印）→aboveWatermark 元素）。

多節：每節可不同紙張/方向（AddPageWithOption 逐頁指定）；`$page`/`$pages` 全文件連續。舊格式（elements+cover/backPage）仍支援。

## 資料語法

### 行內插值（文字元素與表格儲存格共用）

`{{key}}`、`{{key|format}}`——key 可為資料路徑（`customer.name`、`items[0].qty`）、引擎函式或（重複列內）相對 key。regex：`\{\{\s*([^}|]+?)\s*(?:\|\s*([A-Za-z]+)\s*)?\}\}`。

### 引擎保留 key

| key | 意義 |
|---|---|
| `$page` / `$pages` | 目前頁碼／總頁數（全文件連續） |
| `$sum(path)` / `$count(path)` / `$avg(path)` | 全域彙總（對整份資料的陣列路徑） |
| `$row` | 重複列內的列序號（1 起算） |
| `$gsum(欄位)` / `$gcount` / `$gavg(欄位)` | 群組彙總（群組首/尾列內） |

### 值格式化（format.go；前端鏡像 format-value.ts）

`comma` 千分位｜`twUpper` 金額國字大寫（壹拾…元整，銀行慣例）｜`rocDate` 民國年（114/07/20）｜`rocDateLong` 民國年長式（民國114年7月20日）。

## 表格

- 欄寬/列高逐一指定（pt）；框線色寬（寬 0 = 不畫格線）；表格層級字型/字級/內距。
- **重複列**：`repeat.key` 陣列展開 `repeat.rowIndex` 那一列，儲存格 key 用相對路徑；陣列不存在 → 警告＋以範例值畫一列；空陣列 → 該列省略。
- **群組**：`groupBy`（相鄰相同值分組，資料需先排序）＋群組首列/尾列（每組各插一次；相對 key 以該組第一筆解析）。
- **跨頁分片**：每片重畫表頭列（= 重複列之前、扣掉群組首尾列的列）。
- **儲存格能力**：
  - 類型：text（含插值）／placeholder（key＋sample＋format）／image（contain 縮進內距矩形）
  - 合併：colSpan/rowSpan（被蓋住的格不畫）
  - 樣式：逐格字級/文字色/**背景色 fillColor**（底色先畫、框線內容蓋上）/粗體
  - 對齊：align 左/中/右 × vAlign 上/中/下（未設 = 置中）
  - **逐格框線 borders**：top/right/bottom/left（nil = 四邊都畫；共用線任一側有開就畫）＋ diagDown ╲/diagUp ╱ 斜線
  - **自動換行 wrap**：greedy 換行（中文逐字/英文按詞），列高 = max(設計列高, 行數×1.2×字級＋2×內距)，只增不減；列高在版面計算階段以真實字型量測，位移/分頁/繪製一致。未開 wrap = 單行超寬裁切加「…」
- **快速路徑**：無合併/逐格樣式/框線/換行/圖片的表格走整條格線快速路徑（輸出與舊版 byte 相同）；任一進階能力觸發逐格繪製。

## 其他元素

- **文字/資料欄位**：greedy 換行、對齊、行高、外框/底色/內距；autoGrow 內容超高時撐高並推移下方元素（band 內只長高自身）。
- **條碼**：code128/code39/ean13/qr（boombuler/barcode）；key 綁定 fallback sample，或 content 靜態值；1D 可加人讀文字。
- **容器**：子元素相對座標、跨頁 keep-together（整組移到下一頁）、內部 repeat/autoGrow 推移後容器自動撐高。
- **條件顯示**：visibleKey＋Op（truthy/falsy/eq/ne）＋Val；隱藏保留版面空間。

## 浮水印

文字（或 key 綁定值）、字級、顏色、rotation、repeat 平鋪（gapX/gapY）、layer below/above。節可覆寫（inherit/none/custom）。layer=above 時 aboveWatermark 元素畫在浮水印之後（第三層）。

## 字型

內建 sans/serif/mono（Noto TC，Big5 常用字 subset，與前端同 TTF）；使用者匯入字型以 id 為字型名動態註冊，壞檔跳過並警告。註冊固定排序（決定性）。

## 錯誤與警告

渲染錯誤不靜默：資料缺 key → 警告（`X-Render-Warnings` header，同訊息去重）；`?strict=1` 時有警告直接 422。壞 JSON body → 400。
