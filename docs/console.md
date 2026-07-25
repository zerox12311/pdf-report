# 控制台認證與專案（console）

給設計者用的管理後台，仿 JasperReports Server：**帳密登入 → 看到專案 → 專案底下才是樣板**。有 **admin／user 兩種角色**，admin 可管理使用者並把 user 限制在指定專案內。與宿主 iframe 嵌入編輯器**並存**（見 [embed.md](embed.md)）。

## 階層

```
Tenant（租戶／組織，目前單租戶 default）
 ├── User（登入帳號，bcrypt 密碼，role = admin | user）
 ├── Project（專案）
 │    └── Template（樣板，帶 projectID）
 └── ProjectMember（user 對專案的授權；admin 不受此限）
```

目前為單租戶部署：所有資料歸 `default` 租戶，多租戶 schema 保留給未來。

## 角色

- **admin**：全部功能——使用者管理、建立／刪除專案、所有專案與樣板全開。
- **user**：只看得到 admin 指派給他的專案；**在被指派的專案內可完整編輯樣板**（新增／編輯／刪除／渲染）；不能管理使用者、不能建立／刪除專案。

## 登入與帳號

- **初始管理員由 env 種**（比照一般 docker 服務）：`ADMIN_USER` / `ADMIN_PASSWORD`，角色為 admin。
- **設定密碼最少 8 字元**（建立使用者、改密碼、admin 重設皆同）。只在設定時檢查，不影響既有帳號登入；env 種帳號不走這道檢查，請自行給夠長的值。
- 種帳號規則：**user 表為空時**用 env 種一個 admin；**已有使用者但無任何 admin**（例如升級前種的帳號 role 被 default 成 user）→ 自癒：優先把 `ADMIN_USER` 提升為 admin，否則提升最早建立者。**不覆寫既有密碼**（改完密碼重啟不會被打回）。
- env 未設時初始帳密退回 `admin` / `admin`（log 警告請立即改密碼）。
- **使用者管理**（admin，`/users`）：建立使用者（帳密／角色／指派專案）、改角色、重設密碼、勾選可存取專案（即時生效）、刪除。防呆：**不能刪除自己、不能降級／刪除最後一個 admin**。
- 「修改密碼」畫面（`/account/password`）：所有登入者都可改自己的密碼。
- session 走 **httpOnly cookie**（`gin-contrib/sessions` cookie store，`SESSION_SECRET` 簽章）；同源自動帶。前端只保存 username／role 供顯示與導向。

## 頁面流程（前端）

| 路由 | 說明 | 存取 |
|---|---|---|
| `/login` | 帳密登入（已登入自動轉進控制台） | 公開 |
| `/`（專案清單） | admin：列出／建立／刪除全部專案；user：只列被指派專案 | 需登入 |
| `/projects/:id` | 該專案的樣板清單（新增／開啟／刪除） | 需登入 |
| `/projects/:id/settings` | 專案設定：**專案改名** ＋ API 金鑰簽發／撤銷（未來成員授權也在此） | **僅 admin** |
| `/users` | 使用者管理 | **僅 admin** |
| `/account/password` | 修改密碼 | 需登入 |
| `/editor/:id`、`/editor/new` | 既有編輯器 | `editorGuard`：直接開分頁需 session；iframe 嵌入或 URL 帶 `#token=` 放行（走 embed token） |

- **版面**：內容置中 760px 欄；除首頁外每頁上方一列麵包屑（`p-breadcrumb`，高度與間距由 `styles.scss` 的 `--crumb-h`／`--crumb-gap`／`--crumb-row` 單一來源定義）。首頁是階層的根、不放麵包屑，改以 `--crumb-row` 預留等高空間，換頁時內容不會上下跳。修改密碼是窄卡片、水平置中，但麵包屑仍維持主欄寬度（各頁位置一致）。
- **控制台路由掛 `authGuard`**（需 session）；`/editor/*` 掛 `editorGuard`：直接開分頁需 session、**iframe 嵌入（`window.parent !== window`）或 URL 帶 `#token=` 放行**（沒 session 也給進，改由 embed token 授權；後端仍鎖，沒 token → 401 → 空樣板，不外洩）。`/users` 掛 `adminGuard`（非 admin 轉回首頁）。
- 控制台在專案內「新增樣板」→ `/editor/new?project=<id>`；編輯器首次儲存時把 `project` 帶到 `POST /api/templates?projectId=<id>`，樣板即歸入該專案。
- 編輯器左上「返回」：回**樣板所屬專案**（既有樣板由 `GET /api/templates/:id` 的 `X-Project-Id` header 得知，重載／書籤／深連結都正確；專案內新建則用帶入的 `?project=`），都無法判定才回控制台首頁；**iframe 嵌入時隱藏**。

## 授權強制（三來源身分）

**所有資料端點需憑證（`requireAny`）**，匿名一律 **401**（無憑證後門一律關掉，擋 render-by-id 資料外洩、adhoc render SSRF）。身分三來源擇一（`withAuth`）：

- **session cookie** → 控制台使用者
- **API key**（`Authorization: Bearer pdftpl_…`）→ 宿主後端，綁一個專案
- **embed token**（`Authorization: Bearer <JWT>`）→ iframe，綁單一 template

碰樣板的端點過單一授權 chokepoint，依 principal：

| 動作 | user | apikey | embed |
|---|---|---|---|
| get/put/delete/render-by-id 某張 | admin 或該專案成員 | 同專案 | **同一張 template** |
| 建樣板 | admin/成員 | 綁的專案 | ✗ 403 |
| 列樣板 | 依成員過濾 | 該專案 | ✗ 403 |
| adhoc render 預覽／assets／fonts／validate | ✓ | ✓ | ✓ |

`requireAdmin` 另守使用者管理、建/刪專案、金鑰管理。

## 宿主整合（API key ＋ embed token）

Stripe 式兩段憑證（完整流程見 [embed.md](embed.md)）：

- **API key**：admin 在**專案設定頁**（`/projects/:id/settings`，從專案頁右上「⚙ 專案設定」進入）簽發（明文只顯示一次、只存雜湊、可撤銷），綁該專案，**只放宿主後端**。可在該專案內建 template、換 embed token、正式 render-by-id。
- **embed token**：宿主後端用 API key 打 `POST /api/embed-token` 換得，短效 JWT、綁單一 template，經 postMessage 交給 iframe，iframe 之後 `Authorization: Bearer`。
- iframe 編輯器在嵌入情境會**等收到 token 才載入**，並隱藏返回控制台/連接/樣板JSON/資料驗證等元素。

## 其他邊界

- **assets／字型是租戶層**：任何 principal 都能憑 id 抓同租戶的圖/字型（id 隨機、字型全租戶共用）。這輪不綁 scope。
- **圖片 URL 抓取有 SSRF 防護**：render 會抓樣板裡的圖片 URL，已擋 loopback/private/link-local/metadata IP（含 DNS rebinding）。
- **尚待強化**：adhoc render 速率限制、`/api/embed-token {}` 便利捷徑節流、template 級 API key、CORS origin 白名單、postMessage origin 驗證。

## 部署安全須知

- **`SESSION_SECRET` 未設一律拒啟動**（不分部署型態）：它同時簽 session cookie 與 embed token，退回原始碼裡的 dev 常數等於兩者都可被偽造（偽造的 embed token 可讀寫任意樣板）。開發用 `SESSION_SECRET=dev-secret` 即可。
- session cookie 已 `HttpOnly`＋`SameSite=Lax`（Lax 讓跨站 POST/fetch 不帶 cookie → 一定程度 CSRF 防護）。正式部署走 https，cookie 的 `Secure` 旗標建議由反向代理設定。
- **登入尚無速率限制**（bcrypt 本身拖慢暴力破解，但非完整防護）——建議後續補上 per-帳號/IP 節流。

## 後端落點

- `internal/db`：`User`（含 role）、`Project`、`ProjectMember` model；`Template.ProjectID`；migrate 種預設專案並把既有樣板補進去。
- `internal/store/console.go`：`UserStore`（含 `SeedAdmin` 自癒、bcrypt、角色）、`ProjectStore`（含成員 `IsMember`/`SetMembers`/`ListForUser`）；`internal/store/apikey.go`：`APIKeyStore`（Create/Verify/List/Delete，SHA-256 雜湊）。
- `internal/httpapi`：`auth_handler.go`、`project_handler.go`、`user_handler.go`、`key_handler.go`、`embed_handler.go`、`embed_token.go`（JWT 簽/驗）；`middleware.go` 的 `sessionMiddleware`／`withAuth`（三來源 principal）／`requireAuth`（session）／`requireAdmin`／`requireAPIKey`／`requireAny`／`authorizeTemplate`／`authorizeCreateInProject`。
- env：`ADMIN_USER`、`ADMIN_PASSWORD`、`SESSION_SECRET`（也當 embed token 簽章金鑰）。

端點契約見 [api.md](api.md)。
