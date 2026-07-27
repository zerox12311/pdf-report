# 渲染引擎（backend/internal/engine）

渲染的唯一權威：前端預覽也走後端。同輸入產出 **byte 相同**的 PDF（決定性）；golden 測試對 `testdata/golden/*.pdf` 做 byte 比對。

**程式碼分工**：`models.go` schema｜`engine.go` 版面計算與 gopdf 繪製（newLayout/applyGrowth/paginate/draw 都在此檔）｜`renderspec.go` 純函式繪製規格（換行/路徑解析/插值/表格展開，不依賴 gopdf）｜`format.go` 值格式化（權威，前端 format-value.ts 鏡像）。
**測試檔**：`golden_test.go` byte 基準｜`section_test.go` 功能輸出差異（多節/儲存格能力…，慣例：同樣板開關某功能比對輸出不同）｜`warn_probe_test.go` 警告與插值｜`determinism_check_test.go` 決定性｜`format_test.go` 格式化。新引擎功能照 section_test.go 的模式補測試。

## 渲染流程

`Render(doc, data)` → clone（呼叫者的 doc 不被修改）→ 逐節：

1. **newLayout**：依 y 位置把元素分進頁首/內文/頁尾 band（y < headerHeight = 頁首、y ≥ height−footerHeight = 頁尾，每頁重複）。
2. **applyGrowth**：autoGrow 文字、容器撐高、表格（重複列展開/儲存格換行）造成的高度變化，推移下方元素。重複區塊（list）展開總高與設計 footprint 的差同樣推移下方元素（`computeListOffsets`）。
3. **paginate**：連續座標＋shift 累積分頁；重複表格逐列分片，跨頁重畫表頭列；重複區塊（list）以 block 為原子逐塊分頁（只在 block 間斷）。
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
| `$parent.欄位` | 重複區塊（list）巢狀子明細內：取外層當筆元素的欄位 |

### 值格式化（format.go；前端鏡像 format-value.ts）

`comma` 千分位｜`twUpper` 金額國字大寫（壹拾…元整，銀行慣例）｜`rocDate` 民國年（114/07/20）｜`rocDateLong` 民國年長式（民國114年7月20日）。

### 行內樣式標記（richtext.go；前端鏡像 rich-text.ts）——text 元素與 text 儲存格

`[b]粗體[/b]`、`[i]斜體[/i]`、`[c=#rrggbb]顏色[/c]`，可巢狀（內層優先）；只認得這三種小寫標記，其他中括號內容一律當一般文字（不需跳脫）。標記**先解析、後插值**：`{{key}}` 可放在樣式段內，但資料值裡的中括號只會是字面文字（資料無法注入樣式）。

- 語意：粗體/斜體 = 元素/儲存格層級欄位（`bold`／`italic`）**或** span `[b]`／`[i]`（疊加）；顏色 = span 色**覆蓋**元素 `color`／儲存格逐格色。底線仍是元素層級。placeholder（**舊格式**，見下）值來自資料、不解析標記。
- 斷行/autoGrow 量測走 span-aware 路徑（`WrapSpans`，逐段以各自字型量寬——粗體較寬）；行高、baseline、對齊幾何與純文字一致，對齊以整行各段寬度總和計算。
- **text 儲存格**：展開期（`ExpandedRow.Rich`）就解析＋逐段插值（吃重複列相對 key／$ 函式），繪製走 `drawRichCell`——wrap 格 span-aware 換行＋列高量測、單行格 span-aware 截斷加 …（省略號沿用截斷點樣式）。含標記即觸發逐格繪製路徑。
- 無標記的元素/表格走原本純文字路徑（golden byte 不變）。
- placeholder（元素與儲存格）**不**解析標記（值來自資料）。
- **placeholder 是舊格式**：編輯器已收斂成 text＋`{{key|format}}`（載入舊樣板自動遷移）；引擎的 placeholder 路徑**保留**——宿主可能直接 POST 舊格式樣板到 render API。

## 表格

- 欄寬/列高逐一指定（pt）；框線色寬（寬 0 = 不畫格線）；表格層級字型/字級/內距。
- **重複列**：`repeat.key` 陣列展開 `repeat.rowIndex` 那一列，儲存格 key 用相對路徑；陣列不存在 → 警告＋以範例值畫一列；空陣列 → 該列省略。`rowIndex` 越界（例：列數被縮減到小於 rowIndex）→ **警告＋退化成普通表格**（不可靜默吞掉明細）。
- **群組**：`groupBy`（相鄰相同值分組，資料需先排序）＋群組首列/尾列（每組各插一次；相對 key 以該組第一筆解析）。
- **跨頁分片**：每片重畫表頭列（= 重複列之前、扣掉群組首尾列的列）。
- **儲存格能力**：
  - 類型：text（含插值；編輯器唯一的文字綁定介面）／placeholder（**舊格式**：key＋sample＋format，引擎保留渲染路徑；注意其缺 key 時退回 sample，與插值「留空＋警告」不同——新樣板不再產生此類型）／image（contain 縮進內距矩形）／barcode（symbology＋showText；內容 = key 綁定或 value 靜態值，與條碼元素同一套繪製）
  - 儲存格支援 underline（gopdf 原生底線，套在 regular/bold 字型上，style 字串 "U"）；粗體走 -bold 字型檔。text 儲存格支援行內樣式標記（含 `[i]` 斜體，見「資料語法」節）；儲存格無獨立的底線/斜體欄位。
  - **旋轉**：`rotation`（度，順時針）繞元素中心旋轉，以 gopdf `Rotate`/`RotateReset`（q/Q，可巢狀）包住繪製（共用 `withRotation`）；引擎傳 `-rotation`（gopdf 正角為逆時針，取負以對齊前端畫布 CSS 的順時針）。一般元素走 drawElement、**重複列表格走 fragment 路徑，兩條都套旋轉**（繞各分片框中心）。版面仍以未旋轉框計算。
  - 合併：colSpan/rowSpan（被蓋住的格不畫）
  - 樣式：逐格字級/文字色/**背景色 fillColor**（底色先畫、框線內容蓋上）/粗體/斜體（`italic` 整格，走假斜體字型變體；僅斜體不觸發逐格路徑，快速路徑亦支援）
  - 對齊：align 左/中/右 × vAlign 上/中/下（未設 = 置中）
  - **逐格框線 borders**：top/right/bottom/left（nil = 四邊都畫；共用線任一側有開就畫）＋ diagDown ╲/diagUp ╱ 斜線
  - **自動換行 wrap**：greedy 換行（中文逐字/英文按詞），列高 = max(設計列高, 行數×1.2×字級＋2×內距)，只增不減；列高在版面計算階段以真實字型量測，位移/分頁/繪製一致。未開 wrap = 單行超寬裁切加「…」
- **快速路徑**：無合併/逐格樣式/框線/換行/圖片/行內標記的表格走整條格線快速路徑（輸出與舊版 byte 相同）；任一進階能力觸發逐格繪製。

## 其他元素

- **矩形/線條**：線型（實線/虛線/點線）；矩形支援 shape=ellipse（橢圓/圓）與圓角——`cornerRadius`（四角相同）或 `cornerRadii{tl,tr,br,bl}`（四角獨立，優先於前者；半徑 0 的角為直角）。圓角/橢圓用多邊形近似繪製（可填色+描邊+虛線），無圓角的直角矩形走原快速路徑（golden 不變）。
- **文字**：greedy 換行、對齊、行高、外框/底色/內距；autoGrow 內容超高時撐高並推移下方元素（band 內只長高自身）；行內樣式標記（見「資料語法」節）。placeholder 元素為舊格式（引擎保留渲染路徑，行為同 text＋單一 key；編輯器載入即遷移）。
- **圖片**：三種來源，優先序 **key（動態綁定）> url（固定連結）> assetId（已上傳）**。key 綁定時渲染資料中的值 = 圖片 URL（fallback sample）；url 為靜態連結，兩者都由引擎渲染時抓取嵌入。防護：僅 http/https、逾時 5 秒、上限 10MB、內容嗅探必須 PNG/JPEG；同一次渲染同 URL 只抓一次（快取含失敗）。抓取失敗發警告不擋渲染（strict 模式回 422）。表格圖片儲存格同樣支援三種來源（重複列相對 key 在展開時解析，每列可不同圖）。注意：URL 由渲染資料指定，引擎會向其發出請求——部署時信任邊界在呼叫方（宿主後端）。
- **條碼**：code128/code39/ean13/qr（boombuler/barcode）；key 綁定 fallback sample，或 content 靜態值；1D 可加人讀文字。
- **容器**：子元素相對座標、跨頁 keep-together（整組移到下一頁）、內部 repeat/autoGrow 推移後容器自動撐高。
- **重複區塊（list，`list.go`）**：綁 `key` 陣列，`children` 為「一筆」的自由版面（座標相對區塊左上角、`height` = 一筆高）。`ExpandList` 每筆蓋一次、攤平成一串「葉原子（listBlock）」，分頁以 block 為單位、只在 block 間斷（外層那筆**不**整塊 keep-together，子明細可跨頁接續）。子元素 key 相對「當筆元素」解析，`$parent.欄位` 取外層當筆（`drawCtx.root`/`parentData` + `resolveKey` 支援），全域彙總 `$sum` 對整份資料。巢狀上限兩層（list 內至多再一個 list，更深層警告忽略）。固定欄位 block 高 = `max(nested.Y, 固定欄位延伸)`（欄位放到子明細下方時不與明細重疊）。缺陣列 key → 警告＋以 `sampleCount` 畫範例筆；空陣列 → 不畫；單一原子比整頁高 → 警告（不靜默裁切）。沒有 list 元素時完全不進此路徑（golden byte 不變）。
- **條件顯示**：visibleKey＋Op（truthy/falsy/eq/ne）＋Val；隱藏保留版面空間。

## 浮水印

文字（或 key 綁定值）、字級、顏色、rotation、repeat 平鋪（gapX/gapY）、layer below/above。節可覆寫（inherit/none/custom）。layer=above 時 aboveWatermark 元素畫在浮水印之後（第三層）。

**layer=above 一律以 35% 不透明度繪製**（`watermarkAboveAlpha`，固定常數以維持渲染決定性；前端畫布同值）。PDF 的文字沒有 alpha 就是**不透明**的，即使很淺的灰也會把下方內文塗掉——收款單的抬頭、金額國字大寫、繳費期限全都會讀不出來。實作上走 `CellWithOption` 而非 `Text`：gopdf 的 `Text()` 不會把 transparency 解析成 extGState，單純呼叫 `SetTransparency` 產出的 PDF 逐 byte 相同。layer=below 維持原本的 `Text()` 路徑（下方沒有內容可蓋，也讓既有 golden 的 byte 不變）。

## 字型

內建 sans/serif/mono（Noto TC，Big5 常用字 subset，與前端同 TTF），每家族四變體：regular／bold／**italic／bolditalic**。CJK 沒有真斜體檔，斜體變體由 `backend/fonts/gen_oblique.py`（fonttools）對正體/粗體做 12° 斜切預先產生（假斜體，同 Word 做法；斜切不改變字寬，量測與正體共用）。**斜體變體只在樣板用到斜體（`[i]` 標記或元素/儲存格 `italic` 欄位）時才註冊**——註冊即寫入 PDF 字型物件，無條件註冊會改變所有既有樣板的輸出 byte。使用者匯入字型以 id 為字型名動態註冊（無粗/斜變體，沿用同檔），壞檔跳過並警告。註冊固定排序（決定性）。

## 錯誤與警告

渲染錯誤不靜默：資料缺 key → 警告（`X-Render-Warnings` header，同訊息去重）；`?strict=1` 時有警告直接 422。壞 JSON body → 400。

**表格缺 `columnWidths`**（手改樣板 JSON 才會發生）→ 該表格不繪製＋警告「表格「id」缺 columnWidths，未繪製」。引擎沒有欄寬即無可繪製的欄；「PDF 少一張表」不應僅依賴使用者自行察覺，故發警告。前端 `normalizeTemplate()` 會在畫布上補預設欄寬（元素寬高均分）讓表格可見可修，**在編輯器存檔一次即補進 DB**，之後渲染就正常。
