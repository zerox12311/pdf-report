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
| `/users` | 使用者管理 | **僅 admin** |
| `/account/password` | 修改密碼 | 需登入 |
| `/editor/:id`、`/editor/new` | 既有編輯器 | **不掛 guard** |

- **route guard 只掛控制台路由**；`/editor/*` **不掛 guard**——iframe 嵌入開編輯器沒有 session，掛了會被轉登入、嵌入即壞。`/users` 掛 `adminGuard`（非 admin 轉回首頁）。
- 控制台在專案內「新增樣板」→ `/editor/new?project=<id>`；編輯器首次儲存時把 `project` 帶到 `POST /api/templates?projectId=<id>`，樣板即歸入該專案。
- 編輯器左上「返回」：從專案進來 → 回該專案；否則回控制台首頁；**iframe 嵌入時隱藏**。

## 授權強制（單一 chokepoint）

所有會碰樣板的端點都先解析出「有效 projectID」，再過同一個 `authorizeProject`：

- **無 session（iframe／宿主呼叫）→ 放行**（維持既有開放路徑）
- **admin → 放行**
- **該專案成員 → 放行**
- 否則 → **403**

套用範圍：樣板 `list`（扁平清單依可存取專案過濾）／`create`（含未帶 projectId 落預設專案的情形）／`get`／`update`（含 PUT 不存在 id 會建到預設專案）／`delete`／`render-by-id`，以及專案樣板清單。`requireAdmin` 另外守使用者管理與建立／刪除專案。

## 與 iframe 嵌入的關係（安全邊界）

- **控制台使用者（帶 session）**：樣板存取已依角色與專案成員**真正上鎖**（user 碰非成員專案一律 403）。
- **無 session（iframe 嵌入、宿主呼叫）**：`/api/templates*`、render、`/editor/:id` 仍**開放**（落 `default` 租戶）——因為 iframe 嵌入要用、嵌入端的認證（短效 embed token）是**下一階段**。所以不帶 cookie 直接打樣板 API 目前仍繞得過。
- **assets／字型是租戶層、非專案層**：登入的 user 仍能憑 id 抓同租戶任何圖／字型（id 為 128-bit 隨機值、字型本就全租戶共用）。這輪**不納入**專案授權。

## 後端落點

- `internal/db`：`User`（含 role）、`Project`、`ProjectMember` model；`Template.ProjectID`；migrate 種預設專案並把既有樣板補進去。
- `internal/store/console.go`：`UserStore`（含 `SeedAdmin` 自癒、bcrypt、角色）、`ProjectStore`（含成員 `IsMember`/`SetMembers`/`ListForUser`）。
- `internal/httpapi`：`auth_handler.go`、`project_handler.go`、`user_handler.go`；`middleware.go` 的 `sessionMiddleware`／`withAuth`（有 session→載入 role）／`requireAuth`／`requireAdmin`／`authorizeProject`。
- env：`ADMIN_USER`、`ADMIN_PASSWORD`、`SESSION_SECRET`。

端點契約見 [api.md](api.md)。
