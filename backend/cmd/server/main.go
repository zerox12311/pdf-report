package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"pdftemplate/internal/db"
	"pdftemplate/internal/engine"
	"pdftemplate/internal/httpapi"
	"pdftemplate/internal/store"
)

func main() {
	root := os.Getenv("STORAGE_ROOT")
	if root == "" {
		root = "storage"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "5043"
	}
	fontsDir := os.Getenv("FONTS_DIR")
	if fontsDir == "" {
		fontsDir = "fonts"
	}

	g, err := db.Open(os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	// 舊檔案儲存時代的資料一次性匯入（表空才執行，可重跑）
	if err := store.ImportLegacy(g, root); err != nil {
		log.Fatal(err)
	}

	templates := store.NewTemplateStore(g)
	assets, err := store.NewAssetStore(g, root)
	if err != nil {
		log.Fatal(err)
	}
	fonts, err := store.NewFontStore(g, root)
	if err != nil {
		log.Fatal(err)
	}
	users := store.NewUserStore(g)
	projects := store.NewProjectStore(g)
	// 種初始管理員（僅 user 表為空時；已存在不覆寫，改密碼才不會被重啟打回）
	if err := store.SeedAdmin(g, os.Getenv("ADMIN_USER"), os.Getenv("ADMIN_PASSWORD")); err != nil {
		log.Fatal(err)
	}

	eng := engine.NewEngine(fontsDir, assets.EngineSource())
	eng.SetUserFontsDir(fonts.Dir())

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           httpapi.New(templates, assets, fonts, users, projects, eng, os.Getenv("SESSION_SECRET"), os.Getenv("WEB_ROOT")),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second, // 大樣板渲染留餘裕
		IdleTimeout:       90 * time.Second,
	}

	// graceful shutdown：SIGTERM/SIGINT 時停止收新連線，最多等 30 秒讓渲染中的請求完成
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Printf("PDF template engine listening on :%s (storage=%s)", port, root)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
