# 單一 image：前端（Angular）＋後端（Go）。後端直接 serve 前端靜態檔（無 nginx）。
# build context 為 repo 根目錄：docker build -t pdf-report .
# 入口 http://localhost:8080（前端與 /api 同源）。

# 前端 build 階段
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npx ng build

# 後端 build 階段
FROM golang:1.25-alpine AS backend
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 go build -o /app/server ./cmd/server

# runtime：單一 Go binary serve API＋前端靜態檔
FROM alpine:3.21
WORKDIR /app
COPY --from=backend /app/server .
COPY backend/fonts ./fonts
COPY --from=web /web/dist/frontend/browser ./web
ENV PORT=8080 STORAGE_ROOT=/app/storage FONTS_DIR=/app/fonts WEB_ROOT=/app/web
EXPOSE 8080
ENTRYPOINT ["./server"]
