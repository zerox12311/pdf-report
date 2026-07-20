# 嵌入整合指南（iframe）

讓任何系統把 PDF 樣板編輯器嵌進自己的頁面，設計完成後由該系統的後端拿樣板 id 填資料產出 PDF。

## 流程總覽

```
宿主系統前端                          樣板服務                     宿主系統後端
────────────                        ────────                    ────────────
<iframe src=".../editor/new">
        │  使用者設計樣板、按「儲存」
        │◄── postMessage: template-saved {id} ──
        │  把 id 存回自己的系統
        │                                                        POST /api/templates/{id}/render
        │                                        ◄──────────────  body: { "data": {...} }
        │                                        ──────────────►  回應: application/pdf
```

## 1. 嵌入編輯器

```html
<!-- 新樣板 -->
<iframe src="https://<樣板服務>/editor/new" style="width:100%;height:800px;border:0"></iframe>

<!-- 編輯既有樣板 -->
<iframe src="https://<樣板服務>/editor/{templateId}" ...></iframe>
```

## 2. 接收編輯器事件（postMessage）

編輯器會對宿主頁面（`window.parent`）送出事件，格式：

```jsonc
{ "source": "pdf-template-editor", "type": "...", "id": "樣板id或null" }
```

| type | 時機 |
|---|---|
| `editor-ready` | 編輯器載入完成 |
| `template-loaded` | 既有樣板載入完成 |
| `template-saved` | 使用者按「儲存」成功（**由此取得樣板 id**） |

```js
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg?.source !== 'pdf-template-editor') return;
  if (msg.type === 'template-saved') {
    // 把 msg.id 存進自己系統，之後用它渲染 PDF
    console.log('樣板已儲存，id =', msg.id);
  }
});
```

> 產品環境請驗證 `e.origin` 是否為樣板服務的網域。

## 3. 宿主後端渲染 PDF

拿到樣板 id 後，宿主系統的**後端**直接呼叫：

```
POST https://<樣板服務>/api/templates/{id}/render
Content-Type: application/json

{ "data": { "customer": { "name": "王小明" }, "items": [ { "name": "商品A", "qty": "2" } ], "total": "500" } }
```

回應為 `application/pdf`。`data` 的結構由樣板中各「資料欄位」的 key 決定
（支援 `a.b` 與 `items[0].c` 路徑；重複列表格的儲存格 key 相對於陣列元素）。

範例（curl）：

```bash
curl -X POST https://<樣板服務>/api/templates/{id}/render \
  -H "Content-Type: application/json" \
  -d '{"data":{"customer":{"name":"王小明"},"items":[{"name":"商品A","qty":"2","price":"250"}],"total":"500"}}' \
  -o output.pdf
```

## 本機示範

`docker compose up` 後，開啟 [docs/embed-example.html](embed-example.html)（直接用瀏覽器開檔案即可），
會看到一個模擬宿主系統的頁面：左邊 iframe 嵌著編輯器，儲存後右側會顯示收到的 id 與可直接複製的 curl 指令。

## 產品化待辦（目前 demo 未含）

- 渲染/管理 API 的驗證（API key 或 mTLS）、樣板歸屬（multi-tenant）
- postMessage origin 白名單、iframe `Content-Security-Policy: frame-ancestors` 限制
- 樣板版本管理與發佈流程
