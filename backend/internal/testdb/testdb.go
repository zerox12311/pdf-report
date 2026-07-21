// Package testdb：測試用 Postgres 工具（僅供 _test 檔引用）。
// 每個測試建一個獨立資料庫（隔離、可平行），結束時丟棄。
// 跑後端測試前先 `docker compose up -d db`；或以 TEST_DATABASE_URL 指定。
package testdb

import (
	"os"
	"regexp"
	"strings"
	"testing"

	gormpg "gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"pdftemplate/internal/db"
)

func baseURL() string {
	if u := os.Getenv("TEST_DATABASE_URL"); u != "" {
		return u
	}
	return "postgres://pdftpl:pdftpl@localhost:5442/pdftpl?sslmode=disable"
}

var unsafeChars = regexp.MustCompile(`[^a-z0-9_]`)

// Open 建立本測試專屬的資料庫並回傳已 migrate 的連線。
func Open(t *testing.T) *gorm.DB {
	t.Helper()
	admin, err := gorm.Open(gormpg.Open(baseURL()), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatalf("連不上測試用 Postgres（先 docker compose up -d db）：%v", err)
	}
	name := "test_" + unsafeChars.ReplaceAllString(strings.ToLower(t.Name()), "_")
	if len(name) > 50 {
		name = name[:50]
	}
	_ = admin.Exec("DROP DATABASE IF EXISTS " + name).Error
	if err := admin.Exec("CREATE DATABASE " + name).Error; err != nil {
		t.Fatal(err)
	}
	u := strings.Replace(baseURL(), "/pdftpl?", "/"+name+"?", 1)
	g, err := db.Open(u)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if sqlDB, err := g.DB(); err == nil {
			_ = sqlDB.Close()
		}
		_ = admin.Exec("DROP DATABASE IF EXISTS " + name).Error
		if sqlDB, err := admin.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	return g
}
