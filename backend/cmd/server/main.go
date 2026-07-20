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

	templates, err := store.NewTemplateStore(root)
	if err != nil {
		log.Fatal(err)
	}
	assets, err := store.NewAssetStore(root)
	if err != nil {
		log.Fatal(err)
	}
	fonts, err := store.NewFontStore(root)
	if err != nil {
		log.Fatal(err)
	}
	eng := engine.NewEngine(fontsDir, assets)
	eng.SetUserFontsDir(fonts.Dir())

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           httpapi.New(templates, assets, fonts, eng),
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
