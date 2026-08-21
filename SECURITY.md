# 安全政策 Security Policy

本專案用於產生收款單等財務單據，我們嚴肅看待安全問題。

## 回報漏洞 Reporting a Vulnerability

如果你發現安全漏洞（例如：未授權存取樣板或資料、繞過權限、SSRF、注入攻擊等），**請不要開公開的 Issue**。

請使用 GitHub 的 [Private vulnerability reporting](../../security/advisories/new) 私下回報。

回報時請盡量附上：

- 重現步驟或概念驗證（PoC）
- 受影響的版本或 commit
- 你認為的影響範圍

我們會盡快回覆確認收到，並在修復後於 release notes 中致謝（除非你希望匿名）。

## 部署注意事項 Deployment Notes

- `docker-compose.yml` 內的 `ADMIN_PASSWORD`、`SESSION_SECRET`、資料庫密碼都是**本機示範值**，對外部署前必須全部改掉（`SESSION_SECRET` 未設定時伺服器會拒絕啟動）。
- 跨網域呼叫 API 需以 `CORS_ORIGINS` 環境變數明列允許的來源（預設僅同源）。

## 已知限制 Known Limitations

以下為目前設計上的已知限制（非可直接利用的漏洞），歡迎貢獻改進：

- 編輯器嵌入的 postMessage 尚未驗證宿主 origin（token 本身短效且僅綁單一樣板）。
- 速率限制為單實例記憶體實作，多副本部署時各副本獨立計數。
- 設計者儲存樣板（PUT）無樂觀鎖，會覆蓋儲存期間其他人的填寫內容（刻意的取捨）。
- 填寫模式的 embed token 尚無續期機制，逾期需由宿主重新換發。

## 支援範圍 Supported Versions

目前僅維護 `main` 分支的最新版本，請以最新版本驗證漏洞是否存在。
