# 第三方授權聲明 Third-Party Notices

本專案程式碼以 [MIT](LICENSE) 授權釋出；隨附的第三方元件依其原授權散布如下。

## 字型（SIL Open Font License 1.1）

`backend/fonts/` 與 `frontend/public/fonts/` 內建的字型為以下字型的**修改版**
（Big5 導向的字集裁剪＋程式產生的假斜體變體），依 SIL OFL 1.1 散布，
**不適用**根目錄的 MIT 授權：

- **Noto Sans TC** — Copyright (c) 2014-2021 Adobe, with Reserved Font Name 'Source'
- **Noto Serif TC** — Copyright (c) 2017-2024 Adobe
- **Noto Sans Mono** — Copyright 2022 The Noto Project Authors

完整授權文字見 [backend/fonts/OFL.txt](backend/fonts/OFL.txt)。
OFL 明文允許將字型嵌入產出的文件（本專案渲染的 PDF 不受授權傳染）。

## Go 依賴

主要為 MIT／BSD／Apache-2.0 授權（gopdf、boombuler/barcode、Gin、GORM、pgx、
golang-jwt 等，完整清單見 `backend/go.mod`）。其中 `go-sql-driver/mysql`
（經 gorm.io/datatypes 間接引入）為 **MPL-2.0**（檔案級弱 copyleft，
與本專案的散布方式相容）。

## npm 依賴

主要為 MIT／Apache-2.0／0BSD 授權（Angular、PrimeNG、CodeMirror、RxJS 等，
完整清單見 `frontend/package.json`）。production build 會在
`dist/frontend/3rdpartylicenses.txt` 產出逐套件的授權彙整。
