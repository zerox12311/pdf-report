# 嵌入整合指南（iframe）

讓任何系統把 PDF 樣板編輯器嵌進自己的頁面，設計完成後由該系統的後端拿樣板 id 填資料產出 PDF。

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

{ "templateId": "abc" }        // 編輯既有那張
或 { }                          // 便利捷徑：在該專案建一張空樣板，回它的 token
```

回應：

```json
{ "token": "eyJ...", "templateId": "abc", "expiresAt": "2026-07-24T09:11:59Z" }
```

`templateId` 必須屬於這把 key 綁的專案，否則 403。token 綁定該 template、短效。

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
- **尚未做**（記錄在案）：adhoc render 的速率限制、`POST /api/embed-token {}` 便利捷徑的建立節流、template 級 API key（目前只有 project 級）。圖片 URL 抓取已擋私有/內網/metadata（SSRF 防護）。

## 本機示範

**完整宿主示範**：開 `/host-demo.html`（前端 serve，dev＝http://localhost:4300/host-demo.html、Docker＝http://localhost:8090/host-demo.html）。這是一個模擬第三方入口網站（header ＋ 側選單），把編輯器嵌在「報表中心」選單裡，走完整流程：貼專案 API key → 列/建報表 → iframe 內設計 → 填資料下載 PDF。**不需登入控制台**（宿主的使用者本來就沒有 session；靠 API key ＋ embed token 授權）。API key 在 **⚙ 專案設定** 頁建立。純前端把 key 放瀏覽器只為 demo 可跑，正式環境一定由宿主後端持有。

較精簡的片段範例見 [docs/embed-example.html](embed-example.html)。

> **編輯器路由授權**：`/editor/:id` 直接開分頁需控制台 session；**iframe 嵌入或 URL 帶 `#token=` 時放行**（`editorGuard`），改由 embed token 授權。後端每個資料端點仍鎖著（沒有效 token → 401 → 編輯器顯示空樣板），故放行不外洩。
