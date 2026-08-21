package engine

import "sync"

// ── 動態圖片 URL 平行預抓 ─────────────────────────────────────────────
//
// draw 階段的 fetchImage 原本逐張同步下載：圖多時渲染時間 ≈ Σ各圖延遲。
// 這裡在 draw 前先「盡力」收集本次渲染會用到的圖片 URL，平行下載進預抓表；
// draw 時 fetchImage 直接取結果，**警告仍在 draw 的原位置、原順序發出**，
// 因此輸出 PDF byte 與 X-Render-Warnings 順序皆與逐張同步下載完全一致
// （渲染決定性不變）。
//
// 收集是「近似」的，兩個方向都安全：
//   - 多收（例如條件顯示為隱藏的元素）：只是多抓一張，不進 PDF、不發警告。
//   - 少收（未涵蓋的解析路徑）：draw 時 fetchImage 照舊同步下載，行為同舊版。

// prefetchedImage 一張圖的預抓結果；warnMsg 非空 = 失敗（draw 時於原位置發出）。
type prefetchedImage struct {
	data    []byte
	warnMsg string
}

// prefetchConcurrency 同時下載的圖片數上限（避免打爆對方圖床或自己的連線數）。
const prefetchConcurrency = 8

// prefetchImages 平行下載 urls（已去重），回傳 URL → 結果。
func prefetchImages(urls []string, allowPrivate bool) map[string]prefetchedImage {
	if len(urls) == 0 {
		return nil
	}
	sem := make(chan struct{}, prefetchConcurrency)
	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		out = make(map[string]prefetchedImage, len(urls))
	)
	for _, u := range urls {
		wg.Add(1)
		go func(u string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			data, warnMsg := downloadImage(u, allowPrivate)
			mu.Lock()
			out[u] = prefetchedImage{data: data, warnMsg: warnMsg}
			mu.Unlock()
		}(u)
	}
	wg.Wait()
	return out
}

// collectImageURLs 走訪各節元素，解析出動態圖片 URL（去重、保序，順序不影響結果）。
func collectImageURLs(layouts []*layout) []string {
	seen := map[string]bool{}
	var out []string
	add := func(u string) {
		if u != "" && !seen[u] {
			seen[u] = true
			out = append(out, u)
		}
	}
	for _, l := range layouts {
		for _, els := range [][]*Element{l.headerEls, l.bodyEls, l.footerEls} {
			for _, el := range els {
				collectFromElement(el, l.data, l.data, l.data, add)
			}
		}
	}
	return out
}

// collectFromElement 解析單一元素（含容器/重複區塊/表格的遞迴）會用到的圖片 URL。
// data/parent/root 對應 listResolveKey 的上下文；頂層三者皆為整份資料。
func collectFromElement(el *Element, data, parent, root any, add func(string)) {
	switch el.Type {
	case "image":
		if el.Key != "" {
			if v, ok := listResolveKey(el.Key, data, parent, root); ok && v != "" {
				add(v)
			} else {
				add(el.Sample) // draw 的 resolveKey 找不到時退回 Sample，同步之
			}
			return
		}
		add(el.URL)
	case "container":
		for i := range el.Children {
			collectFromElement(&el.Children[i], data, parent, root, add)
		}
	case "list":
		// ExpandList 已處理巢狀與無資料範例筆數；warn 傳 nil（draw 時才發）
		for _, blk := range ExpandList(el, data, parent, root, 1, nil) {
			for _, child := range blk.Children {
				collectFromElement(child.El, child.Data, child.Parent, root, add)
			}
		}
	case "table":
		// 展開列的 image 儲存格：Key 綁定已在展開時解析進 Texts；URL 為靜態連結
		for _, row := range ExpandTableWarn(el, data, nil) {
			for i := range row.Cells {
				cell := &row.Cells[i]
				if cell.Kind != "image" {
					continue
				}
				if cell.Key != "" {
					if i < len(row.Texts) {
						add(row.Texts[i])
					}
					continue
				}
				add(cell.URL)
			}
		}
	}
}
