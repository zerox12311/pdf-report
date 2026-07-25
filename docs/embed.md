# 嵌入整合指南（iframe）

讓任何系統把 PDF 樣板編輯器嵌進自己的頁面，設計完成後由該系統的後端拿樣板 id 填資料產出 PDF。

> **對外的 API 說明在產品內**：編輯器右上「🔗 連接」→「API 說明」對話框，分「後端 API」／「前端嵌入」兩個分頁，各有「複製整份」可直接貼給對應的工程師（內容會自動代入實際的樣板 id 與服務位址）。這份文件是同一份內容的 repo 版，另含實作機制與設計理由（對話框只寫端點、請求、回應）。
> **刻意不做 OpenAPI／Swagger UI**：那類端點在正式環境通常要關掉，而自製的說明對話框可以留在正式環境當作交付文件。

所有 `/api/*` 資料端點都需憑證（見 [console.md](console.md) 的三來源身分）。宿主整合走 **Stripe 式**兩段憑證：

- **API key**（長效 secret）：admin 在控制台的專案頁簽發，**只放宿主後端**。綁一個專案，可在該專案內建 template、換 embed token、正式渲染。
- **embed token**（短效 JWT，預設 30 分鐘）：宿主後端用 API key 換取，**綁定單一 template**，經 postMessage 交給前端 iframe，iframe 之後每個 API 呼叫帶 `Authorization: Bearer <token>`。

## 流程總覽

```
宿主前端(瀏覽器)              宿主後端(伺服器)                 樣板服務
────────────                ─────────────                  ────────
                       ① 帶 API key 換 token
                          POST /api/embed-token  ─────────►  驗 key、簽短效 token
                       ②  ◄──── { token, templateId } ─────
   ◄─ ③ token 交給前端 ─
 ④ <iframe src=".../editor/{templateId}#token={token}">   ← 前端只放這一行、零事件
                                       iframe 從 URL fragment 讀 token，
                                       之後 /api 呼叫帶 Authorization: Bearer <token>
    使用者設計、按編輯器內「儲存」（PUT，token 授權）
                       ⑤ 正式渲染：POST /api/templates/{id}/render（帶 API key）→ PDF
```

## 1. 簽發 API key（控制台，admin）

控制台 → 進專案 → 右上「⚙ 專案設定」→ 「API 金鑰」→ 建立。**明文只在建立當下顯示一次**（可一鍵複製），請存進宿主後端的密鑰保管處。這把 key 綁該專案。

## 2. 宿主後端換 embed token

```
POST https://<樣板服務>/api/embed-token
Authorization: Bearer <API key>
Content-Type: application/json

{ "templateId": "abc", "mode": "fill" }   // 編輯既有那張，用填寫模式
或 { "mode": "design" }                    // 便利捷徑：在該專案建一張空樣板，回它的 token
```

回應：

```json
{ "token": "eyJ...", "templateId": "abc", "mode": "fill", "expiresAt": "2026-07-24T09:11:59Z" }
```

`templateId` 必須屬於這把 key 綁的專案，否則 403。token 綁定該 template、短效。

### 權限模式（mode）

| mode | 可改版面 | 可改內容 | 上傳圖片/字型 | 用途 |
|---|:--:|---|:--:|---|
| `design`（預設） | ✓ | 全部 | ✓ | 完整編輯器 |
| `fill` | ✗ | **只有被標記可填的欄位** | ✗ | 讓使用者填抬頭/備註，版面鎖死 |
| `view` | ✗ | ✗ | ✗ | 唯讀檢視 |

- **mode 是宿主「後端」換 token 時決定的政策**，簽在 token 裡。**不可作為宿主前端傳入的參數**：否則等同開放使用者自行選擇權限。建議依使用者角色指派，例如管理者 `design`、一般人員 `fill`。
- 三種模式都不能刪除樣板（要刪請走控制台或用 API key）。
- **未帶 mode** → `design`（向後相容加 mode 之前簽出的 token）。
- **不認得的值 → `POST /api/embed-token` 直接回 400**（大小寫敏感、不 trim）：`"Fill"`、`"readonly"` 這種拼錯不會默默拿到 design。若既有 token 的 claim 出現未知值（版本回退等），解析時**降權為 `view`**，不是升權。

**哪些欄位可填**由設計者決定：在 `design` 模式選中文字元素或表格儲存格，屬性面板勾「允許在填寫模式修改」（多選可批次勾），畫布上會顯示綠色虛線標示。

`fill` 模式的儲存走窄介面（編輯器自動使用，宿主不需經手）：

```
PATCH /api/templates/{id}/values
Authorization: Bearer <embed token>

{ "values": { "<elementId>": "新文字", "<tableId>#2,3": "新文字" } }
```

只覆寫被標記可填的 text 元素 `content` 與 text 儲存格 `value`，其餘結構不變。未標記的欄位 → 403；值中出現該欄位原本沒有的 `{{key}}` → 400。

寫入對象是樣板本體而非單一填寫實例：同一張樣板供多人填寫會互相覆蓋。若需各自獨立，請為每位使用者建立獨立樣板（`POST /api/embed-token` 不帶 `templateId` 即新建一張）。

樣板正被其他請求寫入 → **409**（可重試）；超過速率限制 → **429** ＋ `Retry-After`。

## 3. 嵌入編輯器（推薦：URL fragment，零事件）

**宿主前端只要放一個 iframe、不用寫任何 JavaScript**：把第 2 步拿到的 token 直接接在網址的 `#token=` 後面。

```html
<iframe src="https://<樣板服務>/editor/{templateId}#token={token}"
        style="width:100%;height:800px;border:0"></iframe>
```

- 編輯器啟動時從 `location.hash` 讀 token，之後所有 `/api` 呼叫自動帶 `Authorization: Bearer <token>`。
- 為什麼用 **fragment（`#`）不用 query（`?`）**：fragment 不會送到後端（不進 access log）、也不進 `Referer` header，比 query 安全。
- iframe 內編輯器會**隱藏會帶使用者離開/曝露整合細節的元素**（返回控制台、連接說明、樣板JSON、資料驗證），只留設計/預覽/資料綁定。
- 使用者設計完成後按編輯器內的「**儲存**」；下載的 PDF ＝ 最後存檔的版本。

### （選配）改用 postMessage 交付 token

若不想讓 token 出現在 URL，可改用 postMessage：iframe 不帶 `#token`，宿主收到 `editor-ready` 後 post `pdf-template-set-token`。此時編輯器會**等收到 token 才載入**。

```html
<iframe id="tpl" src="https://<樣板服務>/editor/{templateId}" style="width:100%;height:800px;border:0"></iframe>
<script>
  const iframe = document.getElementById('tpl');
  window.addEventListener('message', (e) => {
    if (e.origin !== 'https://<樣板服務>') return;         // 產品環境務必驗 origin
    if (e.data?.source === 'pdf-template-editor' && e.data.type === 'editor-ready') {
      iframe.contentWindow.postMessage(
        { type: 'pdf-template-set-token', token: '<第2步拿到的 token>' },
        'https://<樣板服務>');
    }
  });
</script>
```

## 4. 編輯器 → 宿主 事件（postMessage，選用）

零事件嵌入不需要監聽這些；宿主若想同步狀態可選用。編輯器對 `window.parent` 送出，格式 `{ source: "pdf-template-editor", type, id }`：

| type | 時機 |
|---|---|
| `editor-ready` | 編輯器載入完成（postMessage 交付 token 時用） |
| `template-loaded` | 既有樣板載入完成 |
| `template-saved` | 使用者按「儲存」成功 |

宿主 → 編輯器：`{ type: "pdf-template-set-token", token }`（交付 embed token）。

## 5. 宿主後端渲染 PDF

```
POST https://<樣板服務>/api/templates/{id}/render
Authorization: Bearer <API key>
Content-Type: application/json

{ "data": { "customer": { "name": "王小明" }, "items": [ { "name": "商品A", "qty": "2" } ], "total": "500" } }
```

回應 `application/pdf`。`data` 結構由樣板各資料欄位 key 決定（支援 `a.b`、`items[0].c` 路徑）。`?strict=1` 時缺 key 直接 422（財務單據建議開）。

```bash
curl -X POST https://<樣板服務>/api/templates/{id}/render \
  -H "Authorization: Bearer <API key>" -H "Content-Type: application/json" \
  -d '{"data":{"customer":{"name":"王小明"},"items":[{"name":"商品A","qty":"2","price":"250"}],"total":"500"}}' \
  -o output.pdf
```

## 安全須知與尚待強化

- **API key 只放後端**、embed token 短效、明文金鑰只顯示一次。
- **token 放 URL fragment（`#`）不放 query（`?`）**：fragment 不進後端 log、不進 Referer；且 token 短效＋只綁單一 template，外洩風險有限。不想進 URL 就用 postMessage（見 3. 選配）。
- postMessage 交付時兩端都應驗 `e.origin` / 指定 `targetOrigin`（範例已標註）。
- 目前 CORS 為 `*`＋允許 `Authorization`：bearer 流程可用；正式對外前建議**收斂成宿主 origin 白名單**，並視需要加 iframe `Content-Security-Policy: frame-ancestors` 限制誰能嵌入。
- **已知限制：樣板內容對持有 token 的人是可讀的**。`GET /api/templates/:id` 回完整樣板 JSON，含所有資料綁定 key（`customer.name` 這類）。fill/view 模式在 UI 上隱藏了「資料」分頁與綁定 key 的顯示，但那是**體驗層**——開 devtools 或直接打 API 仍讀得到。若樣板的 key 名稱本身屬機密，目前的模式機制擋不住，需要伺服器端的欄位遮蔽（尚未實作）。
- **速率限制已就位**（登入／渲染／填值／換 token／上傳，見 [api.md](api.md#速率限制)）；資料庫連線池已設上限，一波併發不會耗盡整台的連線預算。
- **尚未做**（記錄在案）：template 級 API key（目前只有 project 級）、填寫模式 token 的 TTL/refresh 策略、限流的跨副本共用計數器（目前單實例）。圖片 URL 抓取已擋私有/內網/metadata（SSRF 防護）。

## 本機示範

**完整宿主示範**：開 `/host-demo.html`（前端 serve，dev＝http://localhost:4300/host-demo.html、Docker＝http://localhost:8090/host-demo.html）。這是一個模擬第三方入口網站（header ＋ 側選單），把編輯器嵌在「報表中心」選單裡，走完整流程：貼專案 API key → 列/建報表 → iframe 內設計 → 填資料下載 PDF。**不需登入控制台**（宿主的使用者本來就沒有 session；靠 API key ＋ embed token 授權）。API key 在 **⚙ 專案設定** 頁建立。純前端把 key 放瀏覽器只為 demo 可跑，正式環境一定由宿主後端持有。

較精簡的片段範例見 [docs/embed-example.html](embed-example.html)。

> **編輯器路由授權**：`/editor/:id` 直接開分頁需控制台 session；**iframe 嵌入或 URL 帶 `#token=` 時放行**（`editorGuard`），改由 embed token 授權。後端每個資料端點仍鎖著（沒有效 token → 401 → 編輯器顯示空樣板），故放行不外洩。
