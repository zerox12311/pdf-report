# build 階段
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app/server ./cmd/server

# runtime 階段
FROM alpine:3.21
WORKDIR /app
COPY --from=build /app/server .
COPY fonts ./fonts
ENV PORT=8080 STORAGE_ROOT=/app/storage FONTS_DIR=/app/fonts
EXPOSE 8080
ENTRYPOINT ["./server"]
