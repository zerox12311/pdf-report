# HTTP API 參考（backend/internal/httpapi）

Gin。所有回應錯誤統一 `{"error": "訊息"}`（中文、不洩內部細節）。樣板 payload 為 **raw JSON passthrough**：後端不重排/不改寫樣板 JSON，未知欄位原樣保存（引擎只是忽略）。CORS 全開（iframe 嵌入需要跨域；認證上線後配 API key/token 收斂）；`/healthz` 回 `ok`。

**多租戶**：schema 已就緒（tenants/api_keys），目前為單租戶部署、API 層固定 default 租戶；宿主整合的認證（API key＋短效嵌入 token）為下一階段。

**控制台登入（session）＋角色**：設計者控制台走帳密登入 + httpOnly cookie session（見 [console.md](console.md)），有 **admin／user** 兩種角色。`withAuth` middleware：帶有效 session → 解析租戶＋使用者＋角色；沒帶則不設使用者。`requireAdmin` 守 admin 專屬端點（非 admin → 403）。

**三來源身分（`withAuth` 擇一解析）**：
- **session cookie** → 控制台使用者（依角色/專案成員）
- **`Authorization: Bearer pdftpl_…`** → 宿主後端 API key（綁一個專案）
- **`Authorization: Bearer <JWT>`** → iframe embed token（綁單一 template）

帶了 Authorization 但驗不過 → 401；匿名（都沒帶）→ 401。

**所有資料端點需憑證（`requireAny`）**：樣板 CRUD、render-by-id、adhoc render、assets、fonts、validate。授權 chokepoint 依 principal：
- 碰某張樣板（get/put/delete/render-by-id）：user=admin或該專案成員／apikey=同專案／**embed=同一張 template**，否則 **403**
- 建樣板：user／apikey 可（落各自專案），**embed 不可（403）**
- 列樣板：user 依成員過濾、apikey 該專案、**embed 不可（403）**
- adhoc render 預覽／assets／fonts／validate：三來源任一皆可

## 認證（控制台）

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/auth/login` | body `{username, password}` → 設 session cookie、回 `{username}`；失敗 → 401「帳號或密碼錯誤」（帳號不存在與密碼錯同訊息，防枚舉） |
| POST | `/api/auth/logout` | 清 session（204） |
| GET | `/api/auth/me` | 目前登入者 `{username}`；未登入 → 401 |
| POST | `/api/auth/change-password` | 需登入；body `{oldPassword, newPassword}`；新密碼 < 4 字元 → 400；舊密碼錯 → 400；成功 204 |

初始管理員由 env 種（`ADMIN_USER`/`ADMIN_PASSWORD`，僅 user 表空時）；session 簽章金鑰 `SESSION_SECRET`。

## 專案（控制台，皆需登入）

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/projects` | 專案清單 `[{id, name, createdAt}]`；admin 全部、user 只列被指派專案 |
| POST | `/api/projects` | **admin**；body `{name}`（空 → 400）→ 回專案摘要 |
| DELETE | `/api/projects/:id` | **admin**；預設專案不可刪（400）、非空專案需先清空（400）、不存在 404 |
| GET | `/api/projects/:id/templates` | 該專案樣板清單；非成員（非 admin）→ 403、專案不存在 → 404 |

- 控制台在專案內新建樣板：`POST /api/templates?projectId=<id>`（`?projectId` 指到的專案須屬本租戶，否則 400；登入 user 須為該專案成員，否則 403）；未帶 → 落預設專案。
- 上述端點的 DB 錯誤一律 500（不假報 404/400、不洩內部字串）。

## 使用者管理（控制台，admin 專屬）

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/users` | 使用者清單 `[{id, username, role, projectIds}]` |
| POST | `/api/users` | body `{username, password, role, projectIds}` → 建立；帳號空/重複 → 400 |
| PATCH | `/api/users/:id` | 帶哪個欄位改哪個：`{role?, password?, projectIds?}`；密碼 < 4 字元 → 400；不存在 → 404 |
| DELETE | `/api/users/:id` | 刪除；**不能刪自己**（400）、**不能刪最後一個 admin**（400）、不存在 404 |

- 降級最後一個 admin（PATCH role → user）同樣擋 400。
- 非 admin 打以上任一端點 → 403。

## 宿主整合 API 金鑰（admin 專屬；綁專案）

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/projects/:id/keys` | 金鑰清單 `[{id, name, createdAt}]`（不含明文/雜湊） |
| POST | `/api/projects/:id/keys` | body `{name}` → `{id, name, createdAt, key}`；**明文 `key` 只在此回一次** |
| DELETE | `/api/keys/:kid` | 撤銷 |

金鑰為 `pdftpl_` 前綴的高熵隨機值，只存 SHA-256 雜湊。

## 換 embed token（宿主後端，帶 API key）

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/embed-token` | `Authorization: Bearer <API key>`；body `{templateId}` 換既有／`{}` 便利捷徑（在 key 的專案建空樣板＋回 token）→ `{token, templateId, expiresAt}` |

- `templateId` 須屬 key 綁的專案，否則 403；不存在 404。
- token 為短效 JWT（HS256，預設 30 分鐘），claims 綁 tenant/project/template。
- 需 API key 身分（session/embed token 打 → 401）。

宿主整合完整流程見 [embed.md](embed.md)。

## 樣板

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/templates` | 清單 `[{id, name, updatedAt}]` |
| POST | `/api/templates` | 新建（body = 樣板 JSON；伺服器配 id）→ 回完整樣板。選填 `?projectId=<id>` 歸入該專案（見「專案」節），未帶落預設專案 |
| GET | `/api/templates/:id` | 取得樣板 JSON（原樣）；回應帶 `X-Project-Id` header＝所屬專案（編輯器「返回」用，不放進 body 以保 raw passthrough） |
| PUT | `/api/templates/:id` | 覆寫 → 回完整樣板 |
| DELETE | `/api/templates/:id` | 刪除（204） |

body 上限 10MB；非 JSON 物件 → 400「樣板 JSON 解析失敗（body 需為樣板 JSON 物件）」；找不到 → 404。

## 渲染

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/templates/:id/render` | **正式渲染**（宿主整合契約）：body `{"data": {...}}`（可空 body = 無資料）→ `application/pdf` |
| POST | `/api/templates/render` | adhoc 渲染（編輯器預覽）：body `{"template": {...}, "data": {...}}` |

- 數字以 `json.Number` 解析，保留原始字面（金額不失真）。
- `data` 必須是 JSON 物件或省略；其他型別 → 400。
- **警告機制**：資料缺 key 等問題不擋渲染，回 header `X-Render-Warnings-Count` ＋ `X-Render-Warnings`（percent-encoded JSON 陣列，同訊息去重）。
- **strict 模式**：`?strict=1` 時有任何警告 → 422 `{"error", "warnings"}`（財務單據建議串接時開啟）。
- **輸入驗證守門**：樣板若開啟驗證（`validation.enabled`），正式渲染在渲染前先驗 `data`，不過 → 422 `{"error", "validationErrors":[{path, rule, message}]}`、**不產生 PDF**。`rule` 為 `required`｜`type`；陣列逐元素錯誤帶索引（`items[2].amount`）。關閉或無規則則跳過。adhoc 渲染不套此守門。
- `Content-Disposition: inline; filename*=UTF-8''<樣板名>.pdf`。

## 輸入驗證

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/validate` | 測試 schema：body `{"validation": {...}, "data": {...}}` → `{"ok": bool, "errors":[{path, rule, message}]}` |

- 與正式渲染守門共用同一個驗證器（`internal/validate`，唯一權威）——「測試說過」= 「render 會過」。
- **忽略** `validation.enabled`（測試就是要跑這組規則）；`validation` 為 null（無規則）→ `ok:true`。
- `data` 必須是 JSON 物件或省略；其他型別 → 400。編輯器「驗證」分頁的測試區呼叫此端點。

## 圖片資產

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/assets` | multipart `file` 欄位；僅 PNG/JPEG（**內容嗅探**，不信 client Content-Type）→ `{"id"}` |
| GET | `/api/assets/:id` | 回圖檔 |

上限 10MB；超限 → 400「請求內容過大（上限 10MB）」。

## 字型

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/fonts` | multipart `file`（TTF/OTF，檔頭驗證）＋選填 `name`（預設檔名）→ `{"id", "name"}` |
| GET | `/api/fonts` | 清單 `[{"id", "name"}]`（編輯器字型下拉用） |
| GET | `/api/fonts/:id` | 回字型檔（`Cache-Control: public, max-age=86400`；前端 FontFace 預覽用） |

上限 40MB（中文字型較大）。檔案一律以 `{id}.ttf` 落地（含 OTF 上傳）。樣板中 `fontFamily` 直接放字型 id，引擎動態註冊。

## 儲存層

結構化資料在 PostgreSQL（GORM；樣板存 JSONB），圖片/字型二進位檔在檔案系統 `storage/`。

**ImportLegacy**（啟動時執行一次）：某資源的資料表為空時，把 `STORAGE_ROOT` 下對應的舊檔案版資料匯入 DB（樣板讀 `storage/templates/*.json`；圖片/字型匯入中繼資料，二進位檔本來就留在檔案系統）。表非空則跳過——全新資料庫＋空 storage 就是乾淨開始，不會有資料出現。

（測試覆蓋等開發規範見 [CLAUDE.md](../CLAUDE.md) 的「不可破壞的規範」。）
