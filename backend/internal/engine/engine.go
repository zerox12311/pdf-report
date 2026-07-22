package engine

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"
	"image"
	"image/draw"
	_ "image/jpeg"
	"image/png"
	"math"
	"regexp"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/boombuler/barcode"
	"github.com/boombuler/barcode/code128"
	"github.com/boombuler/barcode/code39"
	"github.com/boombuler/barcode/ean"
	"github.com/boombuler/barcode/qr"
	"github.com/signintech/gopdf"
)

// 報表渲染引擎（gopdf）。
//
// Band 模型（依設計位置劃分）：
//   - 頁首：設計 y < Page.HeaderHeight 的元素，每頁重複。
//   - 頁尾：設計 y >= Page.Height - Page.FooterHeight 的元素，每頁重複。
//   - 內文：其餘元素，超出內容區時自動換頁。
//
// 分頁規則：
//   - 啟用 repeat 的表格：明細列跨頁分片，每片重畫表頭列（repeat.RowIndex 之前的列）。
//   - 其他元素：整個放不下就搬到下一頁（keep-together）；其後元素依位移順推。
//   - placeholder key "$page"（目前頁碼）/ "$pages"（總頁數）由引擎解析。

// fontFiles 字型家族 → TTF 檔名（fonts 目錄下）；家族名與前端 fontFamily 值對應
var fontFiles = map[string][2]string{
	"sans":  {"NotoSansTC-Regular.ttf", "NotoSansTC-Bold.ttf"},   // 黑體（預設）
	"serif": {"NotoSerifTC-Regular.ttf", "NotoSerifTC-Bold.ttf"}, // 明體
	"mono":  {"NotoSansMono-Regular.ttf", "NotoSansMono-Bold.ttf"}, // 等寬（英數）
}

// 版面常數（pt）
const (
	a4Width          = 595.28
	a4Height         = 841.89
	minContentHeight = 20.0  // 內容區最小高度，低於此視為頁首/頁尾設定錯誤
	epsilonPt        = 0.01  // 座標比較容差（分頁/推移判斷）
	epsilonGrow      = 0.001 // 高度變化容差（是否需要推移）
	containerPad     = 6.0   // 容器內容自動撐高時的底部保留
)

// AssetSource 提供圖片內容（由 store.AssetStore 實作）。
type AssetSource interface {
	Get(id string) (data []byte, contentType string, err error)
}

type Engine struct {
	fontsDir     string
	userFontsDir string // 使用者匯入字型目錄（空 = 停用）
	assets       AssetSource

	fontOnce sync.Once
	fontData map[string][]byte // 家族名（含 -bold）→ TTF bytes，首次渲染載入後常駐

	userMu    sync.Mutex
	userFonts map[string][]byte // 字型 id → TTF bytes（增量快取）
	fontErr   error
}

func NewEngine(fontsDir string, assets AssetSource) *Engine {
	return &Engine{fontsDir: fontsDir, assets: assets}
}

// SetUserFontsDir 啟用使用者匯入字型（掃描 dir 下的 {id}.ttf）。
func (e *Engine) SetUserFontsDir(dir string) { e.userFontsDir = dir }

// loadUserFonts 掃描自訂字型目錄，增量載入新檔；回傳快照（呼叫端不可變更）。
func (e *Engine) loadUserFonts() map[string][]byte {
	e.userMu.Lock()
	defer e.userMu.Unlock()
	if e.userFonts == nil {
		e.userFonts = map[string][]byte{}
	}
	if e.userFontsDir != "" {
		if entries, err := os.ReadDir(e.userFontsDir); err == nil {
			for _, ent := range entries {
				name := ent.Name()
				if ent.IsDir() || !strings.HasSuffix(name, ".ttf") {
					continue
				}
				id := strings.TrimSuffix(name, ".ttf")
				if _, ok := e.userFonts[id]; ok {
					continue
				}
				if data, err := os.ReadFile(filepath.Join(e.userFontsDir, name)); err == nil {
					e.userFonts[id] = data
				}
			}
		}
	}
	snap := make(map[string][]byte, len(e.userFonts))
	for k, v := range e.userFonts {
		snap[k] = v
	}
	return snap
}

// loadFonts 把全部 TTF 讀進記憶體（只做一次）；失敗保留錯誤，之後每次渲染回報同樣錯誤。
func (e *Engine) loadFonts() {
	e.fontOnce.Do(func() {
		e.fontData = make(map[string][]byte, len(fontFiles)*2)
		for family, files := range fontFiles {
			for i, name := range []string{family, family + "-bold"} {
				data, err := os.ReadFile(filepath.Join(e.fontsDir, files[i]))
				if err != nil {
					e.fontErr = fmt.Errorf("載入字型 %s 失敗: %w", name, err)
					return
				}
				e.fontData[name] = data
			}
		}
	})
}

type placement struct {
	el *Element
	pg int
	y  float64
}

type tableFragment struct {
	el   *Element
	pg   int
	y    float64
	rows []ExpandedRow
}

// cloneElements 深拷貝元素（含容器子元素與可變指標欄位）。
// Render 過程會就地調整高度/位移，拷貝確保呼叫者的 doc 不被修改（可安全重用/快取）。
// ⚠ schema 新增「指標/slice」欄位時必須在此補手動深拷貝（scalar 欄位由 copy 帶過，不用）。
func cloneElements(src []Element) []Element {
	out := make([]Element, len(src))
	copy(out, src)
	for i := range out {
		if src[i].FillColor != nil {
			v := *src[i].FillColor
			out[i].FillColor = &v
		}
		if src[i].CornerRadii != nil {
			v := *src[i].CornerRadii
			out[i].CornerRadii = &v
		}
		if src[i].Repeat != nil {
			r := *src[i].Repeat
			if r.GroupHeaderRow != nil {
				g := *r.GroupHeaderRow
				r.GroupHeaderRow = &g
			}
			if r.GroupFooterRow != nil {
				g := *r.GroupFooterRow
				r.GroupFooterRow = &g
			}
			out[i].Repeat = &r
		}
		if src[i].Children != nil {
			out[i].Children = cloneElements(src[i].Children)
		}
	}
	return out
}

// applyWrapHeights 依自動換行儲存格的實際行數調高列高（只增不減）。
// 需在字型註冊後呼叫；行高幾何與 drawTableCells 的多行繪製一致。
// rowSpan 合併格以單列需求近似（罕見組合，超出部分維持裁切）。
func (c *drawCtx) applyWrapHeights(t *Element, rows []ExpandedRow) {
	if !tableHasWrap(t) {
		return
	}
	for ri := range rows {
		row := &rows[ri]
		for ci := range row.Cells {
			cell := &row.Cells[ci]
			if !cell.Wrap || cell.Kind == "image" || cell.Kind == "barcode" || ci >= len(row.Texts) || row.Texts[ci] == "" {
				continue
			}
			fs := t.FontSize
			if cell.FontSize > 0 {
				fs = cell.FontSize
			}
			if err := c.setFont(t.FontFamily, fs, cell.Bold); err != nil {
				continue
			}
			cs := max(1, cell.ColSpan)
			w := 0.0
			for i := ci; i < min(ci+cs, len(t.ColumnWidths)); i++ {
				w += t.ColumnWidths[i]
			}
			lines := WrapText(row.Texts[ci], w-2*t.CellPadding, c.measure)
			needed := float64(len(lines))*cellLineHeight*fs + 2*t.CellPadding
			if needed > row.Height {
				row.Height = needed
			}
		}
	}
}

// layout 一次渲染的版面計算結果：band 分類 → 撐高（autoGrow/容器）→ 分頁。
// 中間狀態集中於此，Render 只剩流程骨架。
type layout struct {
	doc  *TemplateDoc
	data any

	// meas 量測用 drawCtx（applyGrowth 設定；換行列高計算需要字型 metrics）
	meas *drawCtx
	// expanded 展開列快取（含換行列高）：同一次渲染中位移/分頁/繪製吃同一份高度
	expanded map[string][]ExpandedRow

	pageW, pageH  float64
	contentTop    float64 // 內容區上緣（= 頁首高）
	contentBottom float64 // 內容區下緣（= 頁高 - 頁尾高）
	contentH      float64 // 每頁內容區高度

	headerEls, footerEls, bodyEls []*Element

	warn WarnFunc // 渲染警告回報

	// offsets：repeat 展開與 autoGrow 造成的位移（elementID → Δy，設計座標系）
	offsets    map[string]float64
	placements []placement
	fragments  []tableFragment
	pageCount  int
}

// newLayout 計算頁面幾何並依設計位置把元素分進三個 band。
func newLayout(doc *TemplateDoc, data any) (*layout, error) {
	l := &layout{doc: doc, data: data, pageCount: 1}
	l.pageW, l.pageH = doc.Page.Width, doc.Page.Height
	if l.pageW <= 0 || l.pageH <= 0 {
		l.pageW, l.pageH = a4Width, a4Height
	}
	headerH := max(0, doc.Page.HeaderHeight)
	footerH := max(0, doc.Page.FooterHeight)
	l.contentTop = headerH
	l.contentBottom = l.pageH - footerH
	l.contentH = l.contentBottom - l.contentTop
	if l.contentH < minContentHeight {
		return nil, fmt.Errorf("頁首/頁尾高度過大，內容區不足")
	}

	for i := range doc.Elements {
		el := &doc.Elements[i]
		switch {
		case el.Y < headerH:
			l.headerEls = append(l.headerEls, el)
		case el.Y >= l.contentBottom:
			l.footerEls = append(l.footerEls, el)
		default:
			l.bodyEls = append(l.bodyEls, el)
		}
	}
	sort.SliceStable(l.bodyEls, func(i, j int) bool { return l.bodyEls[i].Y < l.bodyEls[j].Y })

	l.offsets = ComputeRepeatOffsets(doc, data)
	return l, nil
}

// expandTable 展開表格並套用換行列高（快取；同一次渲染高度一致）。
// meas 未設（理論上不會）時退回無量測展開。
func (l *layout) expandTable(el *Element) []ExpandedRow {
	if rows, ok := l.expanded[el.ID]; ok {
		return rows
	}
	rows := ExpandTableWarn(el, l.data, l.warn)
	if l.meas != nil {
		l.meas.applyWrapHeights(el, rows)
	}
	if l.expanded == nil {
		l.expanded = map[string][]ExpandedRow{}
	}
	l.expanded[el.ID] = rows
	return rows
}

// textBlockHeight 文字塊所需高度（行數 × 行高 + 上下內距）；與 drawTextBlock 的行高幾何一致。
func textBlockHeight(lineCount int, el *Element) float64 {
	return 2*el.Padding + float64(lineCount)*el.LineHeight*el.FontSize
}

// applyGrowth 處理 autoGrow 文字與容器撐高：
// band 內元素只長高自身；內文元素長高後，設計位置在其下緣以下的元素加位移。
func (l *layout) applyGrowth(meas *drawCtx) {
	l.meas = meas
	// 換行儲存格會改變 repeat 展開總高：以量測後高度重算位移
	// （沒有換行儲存格時跳過，維持既有輸出不變）
	for _, el := range l.bodyEls {
		if isRepeatTable(el) && tableHasWrap(el) {
			l.offsets = l.measuredRepeatOffsets()
			break
		}
	}
	growText := func(el *Element) float64 {
		if !el.AutoGrow || (el.Type != "text" && el.Type != "placeholder") {
			return 0
		}
		text := meas.interpolate(el.Content)
		if el.Type == "placeholder" {
			text = formatValue(meas.resolveKey(el.Key, el.Sample), el.Format)
		}
		if err := meas.setFont(el.FontFamily, el.FontSize, el.Bold); err != nil {
			return 0
		}
		lines := WrapText(text, el.Width-2*el.Padding, meas.measure)
		needed := textBlockHeight(len(lines), el)
		if needed <= el.Height {
			return 0
		}
		grow := needed - el.Height
		el.Height = needed
		return grow
	}
	// 元素展開後的實際高度（repeat/換行表格 = 展開總高）
	effHeight := func(ch *Element) float64 {
		if isRepeatTable(ch) || tableHasWrap(ch) {
			return sumHeights(l.expandTable(ch))
		}
		return ch.Height
	}
	// 容器：先在容器內做子元素推移（repeat 展開 / autoGrow），內容超出時容器撐高
	growContainer := func(el *Element) float64 {
		if el.Type != "container" || len(el.Children) == 0 {
			return 0
		}
		localOff := make([]float64, len(el.Children))
		order := make([]int, len(el.Children))
		for i := range order {
			order[i] = i
		}
		sort.SliceStable(order, func(a, b int) bool { return el.Children[order[a]].Y < el.Children[order[b]].Y })
		for _, i := range order {
			ch := &el.Children[i]
			designH := ch.Height
			var d float64
			if isRepeatTable(ch) || tableHasWrap(ch) {
				d = sumHeights(l.expandTable(ch)) - designH
			} else {
				d = growText(ch)
			}
			if math.Abs(d) > epsilonGrow {
				bottom := ch.Y + designH
				for j := range el.Children {
					if j != i && el.Children[j].Y >= bottom-epsilonPt {
						localOff[j] += d
					}
				}
			}
		}
		contentBottom := 0.0
		for i := range el.Children {
			el.Children[i].Y += localOff[i]
			if b := el.Children[i].Y + effHeight(&el.Children[i]); b > contentBottom {
				contentBottom = b
			}
		}
		if contentBottom+containerPad > el.Height {
			delta := contentBottom + containerPad - el.Height
			el.Height += delta
			return delta
		}
		return 0
	}

	for _, el := range l.headerEls {
		growText(el)
		growContainer(el)
	}
	for _, el := range l.footerEls {
		growText(el)
		growContainer(el)
	}
	for _, el := range l.bodyEls {
		designBottom := el.Y + el.Height
		grow := growText(el)
		if el.Type == "container" {
			grow = growContainer(el)
		}
		// 非 repeat 的換行表格：列高增加後撐高自身並推移下方元素
		// （repeat 表格的位移已在 measuredRepeatOffsets 處理）
		if !isRepeatTable(el) && tableHasWrap(el) {
			if d := sumHeights(l.expandTable(el)) - el.Height; d > 0 {
				el.Height += d
				grow = d
			}
		}
		if grow > 0 {
			for _, other := range l.bodyEls {
				if other.ID != el.ID && other.Y >= designBottom-epsilonPt {
					l.offsets[other.ID] += grow
				}
			}
		}
	}
}

// measuredRepeatOffsets 與 ComputeRepeatOffsets 同邏輯，但用量測後（含換行列高）
// 的展開總高計算位移——只在有換行儲存格的 repeat 表格存在時使用。
func (l *layout) measuredRepeatOffsets() map[string]float64 {
	offsets := map[string]float64{}
	tables := []*Element{}
	for i := range l.doc.Elements {
		if isRepeatTable(&l.doc.Elements[i]) {
			tables = append(tables, &l.doc.Elements[i])
		}
	}
	sort.Slice(tables, func(i, j int) bool { return tables[i].Y < tables[j].Y })
	for _, t := range tables {
		designH := sumFloats(t.RowHeights)
		delta := sumHeights(l.expandTable(t)) - designH
		if math.Abs(delta) < epsilonGrow {
			continue
		}
		for i := range l.doc.Elements {
			el := &l.doc.Elements[i]
			if el.ID != t.ID && el.Y >= t.Y+designH-epsilonPt {
				offsets[el.ID] += delta
			}
		}
	}
	return offsets
}

// locate 把連續座標 c（第 0 頁內容區起算、每頁接續 contentH）換算成（頁碼, 頁內 y）。
func (l *layout) locate(c float64) (int, float64) {
	if c < l.contentTop {
		return 0, c
	}
	p := int((c - l.contentTop) / l.contentH)
	return p, l.contentTop + (c - l.contentTop - float64(p)*l.contentH)
}

// pageStartC 第 p 頁內容區起點的連續座標。
func (l *layout) pageStartC(p int) float64 { return l.contentTop + float64(p)*l.contentH }

// paginate 把內文元素放進各頁。
//
// shift 的語意：分頁造成的「額外」位移，依 y 順序累積——
// 一個元素被搬到下一頁（或表格分片後結束位置後移）時，其後所有元素的連續座標
// 都要加上同樣的差值，讓設計上的相對間距在分頁後保持不變。
func (l *layout) paginate() {
	shift := 0.0
	for _, el := range l.bodyEls {
		c := el.Y + l.offsets[el.ID] + shift

		if isRepeatTable(el) {
			rows := l.expandTable(el)
			headerRowCount := min(PageHeaderRowCount(el), len(rows))
			headerRows := rows[:headerRowCount]
			headerRowsH := sumHeights(headerRows)
			expandedH := sumHeights(rows)

			p, local := l.locate(c)
			// 連表頭+第一列都放不下 → 整個表格移到下一頁
			firstRowH := 0.0
			if headerRowCount < len(rows) {
				firstRowH = rows[headerRowCount].Height
			}
			if local+headerRowsH+firstRowH > l.contentBottom+epsilonPt {
				newC := l.pageStartC(p + 1)
				shift += newC - c
				c = newC
				p, local = l.locate(c)
			}

			// 逐列分片；跨頁時重新帶上表頭列
			curPage, curY := p, local
			curRows := append([]ExpandedRow{}, headerRows...)
			for _, row := range rows[headerRowCount:] {
				if curY+sumHeights(curRows)+row.Height > l.contentBottom+epsilonPt {
					l.fragments = append(l.fragments, tableFragment{el, curPage, curY, curRows})
					curPage++
					curY = l.contentTop
					curRows = append([]ExpandedRow{}, headerRows...)
				}
				curRows = append(curRows, row)
			}
			l.fragments = append(l.fragments, tableFragment{el, curPage, curY, curRows})
			l.pageCount = max(l.pageCount, curPage+1)

			// 分頁讓表格實際結束位置往後移，後續元素跟著位移
			endLocal := curY + sumHeights(curRows)
			actualEndC := l.pageStartC(curPage) + (endLocal - l.contentTop)
			shift += actualEndC - (c + expandedH)
		} else {
			p, local := l.locate(c)
			if local+el.Height > l.contentBottom+epsilonPt && el.Height <= l.contentH {
				newC := l.pageStartC(p + 1)
				shift += newC - c
				c = newC
				p, local = l.locate(c)
			}
			l.placements = append(l.placements, placement{el, p, local})
			l.pageCount = max(l.pageCount, p+1)
		}
	}
}

// draw 依 layout 結果逐頁繪製。
// pageOffset/totalPages：多節渲染時的全文件頁碼基準，$page/$pages 連續。
// base：文件開檔的頁面尺寸；本節尺寸不同時逐頁指定（混合紙張/方向）。
func (e *Engine) draw(pdf *gopdf.GoPdf, l *layout, warn WarnFunc, pageOffset, totalPages int, base gopdf.Rect, imgCache map[string][]byte) error {
	for p := 0; p < l.pageCount; p++ {
		if l.pageW == base.W && l.pageH == base.H {
			pdf.AddPage()
		} else {
			pdf.AddPageWithOption(gopdf.PageOption{PageSize: &gopdf.Rect{W: l.pageW, H: l.pageH}})
		}
		ctx := &drawCtx{pdf: pdf, data: l.data, pageNo: pageOffset + p + 1, pages: totalPages, assets: e.assets, warn: warn, imgCache: imgCache}
		wm := l.doc.Page.Watermark
		// 本頁內容（keep：依 AboveWatermark 過濾——上層浮水印時分兩批畫，
		// 讓勾了「置於浮水印之上」的元素不被浮水印蓋住）
		drawPass := func(keep func(*Element) bool) error {
			for _, el := range l.headerEls {
				if keep(el) {
					if err := ctx.drawElement(el, el.Y); err != nil {
						return err
					}
				}
			}
			for _, el := range l.footerEls {
				if keep(el) {
					if err := ctx.drawElement(el, el.Y); err != nil {
						return err
					}
				}
			}
			for _, pl := range l.placements {
				if pl.pg == p && keep(pl.el) {
					if err := ctx.drawElement(pl.el, pl.y); err != nil {
						return err
					}
				}
			}
			for _, fr := range l.fragments {
				if fr.pg == p && keep(fr.el) && ctx.isVisible(fr.el) {
					if err := ctx.drawTableFragment(fr.el, fr.y, fr.rows); err != nil {
						return err
					}
				}
			}
			return nil
		}

		if wm != nil && wm.Layer == "above" {
			// 一般內容 → 浮水印 → 置頂元素
			if err := drawPass(func(el *Element) bool { return !el.AboveWatermark }); err != nil {
				return err
			}
			if err := ctx.drawWatermark(wm, l.pageW, l.pageH); err != nil {
				return err
			}
			if err := drawPass(func(el *Element) bool { return el.AboveWatermark }); err != nil {
				return err
			}
		} else {
			// 下層浮水印（或無浮水印）：順序同舊版
			if err := ctx.drawWatermark(wm, l.pageW, l.pageH); err != nil {
				return err
			}
			if err := drawPass(func(*Element) bool { return true }); err != nil {
				return err
			}
		}
	}
	return nil
}

// Render 渲染流程骨架：拷貝輸入 → 版面計算 → 字型 → 撐高 → 分頁 → 繪製。
// 回傳的 warnings 為渲染過程的資料問題（找不到 key 等），已去重；PDF 仍會產出。
func (e *Engine) Render(doc *TemplateDoc, data any) ([]byte, []string, error) {
	// 對拷貝操作，輸入 doc 保持不變（呼叫者可安全重用/快取）
	cloned := *doc
	cloned.Elements = cloneElements(doc.Elements)
	if doc.Cover != nil {
		c := *doc.Cover
		c.Elements = cloneElements(doc.Cover.Elements)
		cloned.Cover = &c
	}
	if doc.BackPage != nil {
		b := *doc.BackPage
		b.Elements = cloneElements(doc.BackPage.Elements)
		cloned.BackPage = &b
	}
	if len(doc.Sections) > 0 {
		cloned.Sections = make([]DocSection, len(doc.Sections))
		for i, s := range doc.Sections {
			s.Elements = cloneElements(s.Elements)
			cloned.Sections[i] = s
		}
	}
	doc = &cloned

	seen := map[string]struct{}{}
	var warnings []string
	warn := func(msg string) {
		if _, dup := seen[msg]; dup {
			return
		}
		seen[msg] = struct{}{}
		warnings = append(warnings, msg)
	}

	// 分節：Sections 存在時逐節建 layout（每節可有自己的紙張/方向/band）；
	// 否則走舊格式（封面 → 內頁 → 封底）。$page/$pages 跨節連續。
	var layouts []*layout
	if len(doc.Sections) > 0 {
		for i := range doc.Sections {
			sl, err := newLayout(sectionDocFrom(doc, &doc.Sections[i]), data)
			if err != nil {
				return nil, nil, fmt.Errorf("節「%s」：%w", doc.Sections[i].Name, err)
			}
			layouts = append(layouts, sl)
		}
	} else {
		if doc.Cover != nil && doc.Cover.Enabled {
			cl, err := newLayout(sectionDoc(doc, doc.Cover.Elements), data)
			if err != nil {
				return nil, nil, err
			}
			layouts = append(layouts, cl)
		}
		l, err := newLayout(doc, data)
		if err != nil {
			return nil, nil, err
		}
		layouts = append(layouts, l)
		if doc.BackPage != nil && doc.BackPage.Enabled {
			bl, err := newLayout(sectionDoc(doc, doc.BackPage.Elements), data)
			if err != nil {
				return nil, nil, err
			}
			layouts = append(layouts, bl)
		}
	}
	for _, sl := range layouts {
		sl.warn = warn
	}

	e.loadFonts()
	if e.fontErr != nil {
		return nil, nil, e.fontErr
	}
	base := gopdf.Rect{W: layouts[0].pageW, H: layouts[0].pageH}
	pdf := &gopdf.GoPdf{}
	pdf.Start(gopdf.Config{PageSize: base, Unit: gopdf.UnitPT})
	pdf.SetMargins(0, 0, 0, 0)
	// 固定順序註冊：確保同輸入產出 byte 相同的 PDF（golden 測試與快取的前提）
	fontNames := make([]string, 0, len(e.fontData))
	for name := range e.fontData {
		fontNames = append(fontNames, name)
	}
	sort.Strings(fontNames)
	for _, name := range fontNames {
		if err := pdf.AddTTFFontData(name, e.fontData[name]); err != nil {
			return nil, nil, fmt.Errorf("註冊字型 %s 失敗: %w", name, err)
		}
	}
	// 使用者匯入字型（id 即字型名；壞檔跳過並警告，不擋渲染）
	userFonts := e.loadUserFonts()
	userNames := make([]string, 0, len(userFonts))
	for id := range userFonts {
		userNames = append(userNames, id)
	}
	sort.Strings(userNames)
	for _, id := range userNames {
		if err := pdf.AddTTFFontData(id, userFonts[id]); err != nil {
			warn("匯入字型 " + id + " 無法使用（已改用預設字型）")
		}
	}

	total := 0
	for _, sl := range layouts {
		sl.applyGrowth(&drawCtx{pdf: pdf, data: data, pageNo: 1, pages: 1, assets: e.assets})
		sl.paginate()
		total += sl.pageCount
	}
	offset := 0
	imgCache := map[string][]byte{} // 動態圖片 URL 下載快取（跨節/跨頁共用）
	for _, sl := range layouts {
		if err := e.draw(pdf, sl, warn, offset, total, base, imgCache); err != nil {
			return nil, nil, err
		}
		offset += sl.pageCount
	}

	var buf bytes.Buffer
	if _, err := pdf.WriteTo(&buf); err != nil {
		return nil, nil, err
	}
	return buf.Bytes(), warnings, nil
}

// sectionDoc 舊格式封面/封底的分節文件：同頁面設定但無 band（整頁都是內容區）。
func sectionDoc(doc *TemplateDoc, els []Element) *TemplateDoc {
	d := *doc
	d.Elements = els
	d.Page.HeaderHeight = 0
	d.Page.FooterHeight = 0
	d.Cover, d.BackPage = nil, nil
	return &d
}

// sectionDocFrom 節清單的分節文件：套節的紙張覆寫與 band 高度（single 節無 band）。
func sectionDocFrom(doc *TemplateDoc, s *DocSection) *TemplateDoc {
	d := *doc
	d.Elements = s.Elements
	if s.Page != nil {
		if s.Page.Width > 0 {
			d.Page.Width = s.Page.Width
		}
		if s.Page.Height > 0 {
			d.Page.Height = s.Page.Height
		}
	}
	if s.Kind == "single" {
		d.Page.HeaderHeight, d.Page.FooterHeight = 0, 0
	} else {
		d.Page.HeaderHeight, d.Page.FooterHeight = s.HeaderHeight, s.FooterHeight
	}
	// 節的有效浮水印：none 不蓋、custom 用節專屬、其餘跟隨文件
	switch s.WatermarkMode {
	case "none":
		d.Page.Watermark = nil
	case "custom":
		d.Page.Watermark = s.Watermark
	}
	d.Cover, d.BackPage, d.Sections = nil, nil, nil
	return &d
}

// ---------- 繪製 ----------

type drawCtx struct {
	pdf    *gopdf.GoPdf
	data   any
	pageNo int
	pages  int
	assets AssetSource
	warn   WarnFunc // 渲染警告回報；nil = 不收集
	// 動態圖片 URL 下載快取（同一次渲染共用；nil 值 = 抓過但失敗，不重試）
	imgCache map[string][]byte
}

func parseColor(hex string) (uint8, uint8, uint8) {
	h := hex
	if len(h) > 0 && h[0] == '#' {
		h = h[1:]
	}
	if len(h) != 6 {
		return 0, 0, 0
	}
	r, _ := strconv.ParseUint(h[0:2], 16, 8)
	g, _ := strconv.ParseUint(h[2:4], 16, 8)
	b, _ := strconv.ParseUint(h[4:6], 16, 8)
	return uint8(r), uint8(g), uint8(b)
}

func (c *drawCtx) setFont(family string, size float64, bold bool) error {
	if _, ok := fontFiles[family]; ok {
		if bold {
			family += "-bold"
		}
		return c.pdf.SetFont(family, "", size)
	}
	// 使用者匯入字型（以字型 id 為家族名；無粗體變體，粗體沿用同檔）
	if family != "" {
		if err := c.pdf.SetFont(family, "", size); err == nil {
			return nil
		}
	}
	f := "sans"
	if bold {
		f += "-bold"
	}
	return c.pdf.SetFont(f, "", size)
}

func (c *drawCtx) measure(s string) float64 {
	w, _ := c.pdf.MeasureTextWidth(s)
	return w
}

// resolveKey placeholder 取值：$page / $pages / $sum() / $count() / $avg() 由引擎提供，其餘走資料路徑。
func (c *drawCtx) resolveKey(key, sample string) string {
	switch key {
	case "$page":
		return strconv.Itoa(c.pageNo)
	case "$pages":
		return strconv.Itoa(c.pages)
	}
	if v, ok := ResolveAggregate(c.data, key); ok {
		return v
	}
	if v, ok := ResolvePath(c.data, key); ok {
		return v
	}
	if c.warn != nil && key != "" {
		c.warn("找不到資料 key：" + key + "（已用範例值代替）")
	}
	return sample
}

// interpolateRe 文字行內插值 token：{{key}} 或 {{key|格式}}（格式 = comma/twUpper/rocDate/rocDateLong）。
var interpolateRe = regexp.MustCompile(`\{\{\s*([^}|]+?)\s*(?:\|\s*([A-Za-z]+)\s*)?\}\}`)

// interpolate 把文字中的 {{key|format}} 換成資料值：key 走 resolveKey（資料路徑或 $page/$sum 等引擎 key），
// 缺 key 走警告機制並以空字串代入。無 token 時原樣回傳（零成本快速路徑）。
func (c *drawCtx) interpolate(content string) string {
	return interpolateText(content, func(key string) string { return c.resolveKey(key, "") })
}

// isVisible 條件顯示：VisibleKey 空 = 顯示；隱藏的元素仍占版面空間。
// key 與比較值都支援 $page / $pages（例：$page eq 1 → 只在第一頁；$page eq $pages → 只在末頁）。
func (c *drawCtx) isVisible(el *Element) bool {
	if el.Hidden {
		return false // 設計者手動隱藏：不畫（保留版面空間）
	}
	if el.VisibleKey == "" {
		return true
	}
	var v string
	var ok bool
	if strings.HasPrefix(el.VisibleKey, "$") {
		v, ok = c.resolveKey(el.VisibleKey, ""), true
	} else {
		v, ok = ResolvePath(c.data, el.VisibleKey)
	}
	cmp := el.VisibleVal
	if strings.HasPrefix(cmp, "$") {
		cmp = c.resolveKey(cmp, cmp)
	}
	truthy := ok && v != "" && v != "false" && v != "0"
	switch el.VisibleOp {
	case "falsy":
		return !truthy
	case "eq":
		return ok && v == cmp
	case "ne":
		return !ok || v != cmp
	default: // truthy
		return truthy
	}
}

func (c *drawCtx) drawElement(el *Element, y float64) error {
	if !c.isVisible(el) {
		return nil
	}
	switch el.Type {
	case "text":
		return c.drawTextBlock(el, c.interpolate(el.Content), y)
	case "placeholder":
		return c.drawTextBlock(el, formatValue(c.resolveKey(el.Key, el.Sample), el.Format), y)
	case "rect":
		return c.drawRect(el, y)
	case "line":
		r, g, b := parseColor(el.StrokeColor)
		c.pdf.SetStrokeColor(r, g, b)
		c.pdf.SetLineWidth(el.StrokeWidth)
		dashed := el.LineStyle == "dashed" || el.LineStyle == "dotted"
		if dashed {
			c.pdf.SetLineType(el.LineStyle)
		}
		c.pdf.Line(el.X, y, el.X+el.Width, y+el.Height)
		if dashed {
			c.pdf.SetLineType("solid") // 還原，避免影響後續元素
		}
		return nil
	case "image":
		return c.drawImage(el, y)
	case "barcode":
		return c.drawBarcode(el, y)
	case "table":
		// 未啟用 repeat 的表格（或位於頁首/頁尾）：整個畫在該位置
		rows := ExpandTableWarn(el, c.data, c.warn)
		c.applyWrapHeights(el, rows) // 與 applyGrowth 的列高計算一致（determinstic，同輸入同結果）
		return c.drawTableFragment(el, y, rows)
	case "container":
		return c.drawContainer(el, y)
	}
	return nil
}

// drawContainer 畫 Frame 容器：框/底/標題 + 子元素（相對座標）。
func (c *drawCtx) drawContainer(el *Element, y float64) error {
	if el.FillColor != nil || el.BorderWidth > 0 {
		style := ""
		if el.BorderWidth > 0 {
			r, g, b := parseColor(el.BorderColor)
			c.pdf.SetStrokeColor(r, g, b)
			c.pdf.SetLineWidth(el.BorderWidth)
			style += "D"
		}
		if el.FillColor != nil {
			r, g, b := parseColor(*el.FillColor)
			c.pdf.SetFillColor(r, g, b)
			style += "F"
		}
		c.pdf.RectFromUpperLeftWithStyle(el.X, y, el.Width, el.Height, style)
	}
	if el.Title != "" {
		if err := c.setFont("sans", 9, true); err != nil {
			return err
		}
		c.pdf.SetTextColor(51, 65, 85)
		c.pdf.SetXY(el.X+6, y+4+BaselineRatio*9)
		if err := c.pdf.Text(el.Title); err != nil {
			return err
		}
	}
	for i := range el.Children {
		child := el.Children[i] // 複本：平移到絕對座標
		child.X += el.X
		if err := c.drawElement(&child, y+el.Children[i].Y); err != nil {
			return err
		}
	}
	return nil
}

func (c *drawCtx) drawTextBlock(el *Element, text string, y float64) error {
	// 外框 / 底色（BorderColor/BorderWidth/FillColor 與其他元素型別共用欄位）
	if el.FillColor != nil || el.BorderWidth > 0 {
		style := ""
		if el.BorderWidth > 0 {
			r, g, b := parseColor(el.BorderColor)
			c.pdf.SetStrokeColor(r, g, b)
			c.pdf.SetLineWidth(el.BorderWidth)
			style += "D"
		}
		if el.FillColor != nil {
			r, g, b := parseColor(*el.FillColor)
			c.pdf.SetFillColor(r, g, b)
			style += "F"
		}
		c.pdf.RectFromUpperLeftWithStyle(el.X, y, el.Width, el.Height, style)
	}

	if err := c.setFont(el.FontFamily, el.FontSize, el.Bold); err != nil {
		return err
	}
	r, g, b := parseColor(el.Color)
	c.pdf.SetTextColor(r, g, b)
	pad := el.Padding
	innerX, innerW := el.X+pad, el.Width-2*pad
	lines := WrapText(text, innerW, c.measure)
	baseline := y + pad + BaselineRatio*el.FontSize
	for _, line := range lines {
		if line != "" {
			lineWidth := c.measure(line)
			lx := innerX
			switch el.Align {
			case "center":
				lx = innerX + (innerW-lineWidth)/2
			case "right":
				lx = innerX + innerW - lineWidth
			}
			c.pdf.SetXY(lx, baseline)
			if err := c.pdf.Text(line); err != nil {
				return err
			}
		}
		baseline += el.LineHeight * el.FontSize
	}
	return nil
}

func (c *drawCtx) drawRect(el *Element, y float64) error {
	hasStroke := el.StrokeWidth > 0
	hasFill := el.FillColor != nil
	if !hasStroke && !hasFill {
		return nil
	}
	// 圓角矩形/橢圓走多邊形近似路徑（gopdf 的矩形/橢圓 API 不支援圓角+填色）
	if el.Shape == "ellipse" || hasCornerRadius(el) {
		return c.drawRoundedOrEllipse(el, y, hasStroke, hasFill)
	}
	style := ""
	dashed := hasStroke && (el.LineStyle == "dashed" || el.LineStyle == "dotted")
	if hasStroke {
		r, g, b := parseColor(el.StrokeColor)
		c.pdf.SetStrokeColor(r, g, b)
		c.pdf.SetLineWidth(el.StrokeWidth)
		style += "D"
		if dashed {
			c.pdf.SetLineType(el.LineStyle)
		}
	}
	if hasFill {
		r, g, b := parseColor(*el.FillColor)
		c.pdf.SetFillColor(r, g, b)
		style += "F"
	}
	c.pdf.RectFromUpperLeftWithStyle(el.X, y, el.Width, el.Height, style)
	if dashed {
		c.pdf.SetLineType("solid") // 還原，避免影響後續元素
	}
	return nil
}

// cornerRadiiOf 元素的四角半徑（個別 CornerRadii 優先於統一 CornerRadius）：tl, tr, br, bl
func cornerRadiiOf(el *Element) (float64, float64, float64, float64) {
	if c := el.CornerRadii; c != nil {
		return c.TL, c.TR, c.BR, c.BL
	}
	r := el.CornerRadius
	return r, r, r, r
}

// hasCornerRadius 是否有任一角需要圓角（決定是否走多邊形路徑；無圓角維持原快速路徑）
func hasCornerRadius(el *Element) bool {
	tl, tr, br, bl := cornerRadiiOf(el)
	return tl > 0 || tr > 0 || br > 0 || bl > 0
}

// drawRoundedOrEllipse 用多邊形近似畫圓角矩形/橢圓（可填色+描邊+虛線）。
// 座標 top-left（y 已是頁內座標；Polygon 內部轉 PDF bottom-left）。
func (c *drawCtx) drawRoundedOrEllipse(el *Element, y float64, hasStroke, hasFill bool) error {
	var pts []gopdf.Point
	if el.Shape == "ellipse" {
		cx, cy := el.X+el.Width/2, y+el.Height/2
		rx, ry := el.Width/2, el.Height/2
		const seg = 72
		for i := 0; i < seg; i++ {
			th := 2 * math.Pi * float64(i) / float64(seg)
			pts = append(pts, gopdf.Point{X: cx + rx*math.Cos(th), Y: cy + ry*math.Sin(th)})
		}
	} else {
		x, w, h := el.X, el.Width, el.Height
		tl, tr, br, bl := cornerRadiiOf(el)
		// 夾在幾何上限內（相鄰兩角半徑和不可超過該邊長；單角不超過半邊）
		clamp := func(r float64) float64 {
			if m := math.Min(w, h) / 2; r > m {
				return m
			}
			if r < 0 {
				return 0
			}
			return r
		}
		tl, tr, br, bl = clamp(tl), clamp(tr), clamp(br), clamp(bl)
		const arc = 8
		// y 向下座標：θ=0 右、π/2 下、π 左、3π/2 上；順時針沿邊界四角圓弧
		// r=0 的角退化成單一角落點（直角）
		addArc := func(cx, cy, r, start, end float64) {
			if r <= 0 {
				pts = append(pts, gopdf.Point{X: cx, Y: cy})
				return
			}
			for i := 0; i <= arc; i++ {
				th := start + (end-start)*float64(i)/float64(arc)
				pts = append(pts, gopdf.Point{X: cx + r*math.Cos(th), Y: cy + r*math.Sin(th)})
			}
		}
		addArc(x+w-tr, y+tr, tr, 1.5*math.Pi, 2*math.Pi)  // 右上角（r=0 → 角落點 x+w, y）
		addArc(x+w-br, y+h-br, br, 0, 0.5*math.Pi)        // 右下角
		addArc(x+bl, y+h-bl, bl, 0.5*math.Pi, math.Pi)    // 左下角
		addArc(x+tl, y+tl, tl, math.Pi, 1.5*math.Pi)      // 左上角
	}
	style := ""
	if hasFill {
		r, g, b := parseColor(*el.FillColor)
		c.pdf.SetFillColor(r, g, b)
		style = "F"
	}
	dashed := hasStroke && (el.LineStyle == "dashed" || el.LineStyle == "dotted")
	if hasStroke {
		r, g, b := parseColor(el.StrokeColor)
		c.pdf.SetStrokeColor(r, g, b)
		c.pdf.SetLineWidth(el.StrokeWidth)
		if dashed {
			c.pdf.SetLineType(el.LineStyle)
		}
		if hasFill {
			style = "DF"
		} else {
			style = "D"
		}
	}
	c.pdf.Polygon(pts, style)
	if dashed {
		c.pdf.SetLineType("solid")
	}
	return nil
}

func (c *drawCtx) drawImage(el *Element, y float64) error {
	// 來源優先序：Key（動態綁定）> URL（固定連結）> AssetID（已上傳）
	if el.Key != "" {
		u := c.resolveKey(el.Key, el.Sample) // fallback Sample
		return c.drawImageURLRect(u, el.X, y, el.Width, el.Height, el.Fit)
	}
	if el.URL != "" {
		return c.drawImageURLRect(el.URL, el.X, y, el.Width, el.Height, el.Fit)
	}
	return c.drawImageRect(el.AssetID, el.X, y, el.Width, el.Height, el.Fit)
}

// fetchImage 下載圖片 URL（同一次渲染內以 imgCache 去重；nil = 抓過但失敗）。
// 防護：僅 http/https、逾時 5 秒、上限 10MB、內容必須是 PNG/JPEG。
// 失敗發警告（strict 模式會擋），不讓整份報表失敗。
func (c *drawCtx) fetchImage(rawURL string) []byte {
	if c.imgCache != nil {
		if data, ok := c.imgCache[rawURL]; ok {
			return data
		}
	}
	warn := func(msg string) {
		if c.warn != nil {
			c.warn(msg)
		}
	}
	remember := func(data []byte) []byte {
		if c.imgCache != nil {
			c.imgCache[rawURL] = data
		}
		return data
	}
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		warn("圖片 URL 不合法（僅支援 http/https）：" + rawURL)
		return remember(nil)
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(rawURL)
	if err != nil {
		warn("圖片 URL 下載失敗：" + rawURL)
		return remember(nil)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		warn(fmt.Sprintf("圖片 URL 回應 %d：%s", resp.StatusCode, rawURL))
		return remember(nil)
	}
	const maxImg = 10 << 20
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImg+1))
	if err != nil || len(data) > maxImg {
		warn("圖片 URL 下載失敗（讀取錯誤或超過 10MB）：" + rawURL)
		return remember(nil)
	}
	if ct := http.DetectContentType(data); ct != "image/png" && ct != "image/jpeg" {
		warn("圖片 URL 內容不是 PNG/JPEG：" + rawURL)
		return remember(nil)
	}
	return remember(data)
}

// drawImageURLRect 抓取圖片 URL 並畫在指定矩形內；URL 空或抓取失敗時略過（警告已發）。
func (c *drawCtx) drawImageURLRect(rawURL string, rx, ry, rw, rh float64, fit string) error {
	if rawURL == "" {
		return nil
	}
	data := c.fetchImage(rawURL)
	if data == nil {
		return nil
	}
	return c.drawImageBytesRect(data, rx, ry, rw, rh, fit)
}

// drawImageRect 畫已上傳圖片（assetID）；圖片不存在時略過，不讓整份報表失敗。
func (c *drawCtx) drawImageRect(assetID string, rx, ry, rw, rh float64, fit string) error {
	if assetID == "" || c.assets == nil {
		return nil
	}
	data, _, err := c.assets.Get(assetID)
	if err != nil {
		return nil
	}
	return c.drawImageBytesRect(data, rx, ry, rw, rh, fit)
}

// drawImageBytesRect 在指定矩形內畫圖（contain 等比縮放置中；stretch 填滿）。
func (c *drawCtx) drawImageBytesRect(data []byte, rx, ry, rw, rh float64, fit string) error {
	x, dy, w, h := rx, ry, rw, rh
	if fit != "stretch" {
		cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err == nil && cfg.Width > 0 && cfg.Height > 0 {
			scale := min(rw/float64(cfg.Width), rh/float64(cfg.Height))
			w = float64(cfg.Width) * scale
			h = float64(cfg.Height) * scale
			x = rx + (rw-w)/2
			dy = ry + (rh-h)/2
		}
	}
	holder, err := gopdf.ImageHolderByBytes(data)
	if err != nil {
		return err
	}
	return c.pdf.ImageByHolder(holder, x, dy, &gopdf.Rect{W: w, H: h})
}

// drawWatermark 每頁背景浮水印（畫在所有元素之下）。
func (c *drawCtx) drawWatermark(wm *Watermark, pageW, pageH float64) error {
	if wm == nil || !wm.Enabled {
		return nil
	}
	text := wm.Text
	if wm.Key != "" {
		if v, ok := ResolvePath(c.data, wm.Key); ok && v != "" {
			text = v
		}
	}
	if text == "" {
		return nil
	}
	size := wm.FontSize
	if size <= 0 {
		size = 72
	}
	color := wm.Color
	if color == "" {
		color = "#e5e7eb"
	}
	if err := c.setFont("sans", size, true); err != nil {
		return err
	}
	r, g, b := parseColor(color)
	c.pdf.SetTextColor(r, g, b)
	tw := c.measure(text)
	cx, cy := pageW/2, pageH/2
	rot := wm.rotationDeg()
	if rot != 0 {
		c.pdf.Rotate(rot, cx, cy)
	}
	defer func() {
		if rot != 0 {
			c.pdf.RotateReset()
		}
	}()

	if !wm.Repeat {
		// 單一置中
		c.pdf.SetXY(cx-tw/2, cy+size*0.3)
		return c.pdf.Text(text)
	}

	// 滿版平鋪：整層旋轉後以磚牆式格點鋪滿（覆蓋範圍取頁面對角線，旋轉後不留角）。
	// 間隔下限 clamp，避免極端輸入產生上萬個字。
	stepX := tw + max(10, wm.GapX)
	stepY := size*1.2 + max(10, wm.GapY)
	radius := math.Hypot(pageW, pageH) / 2
	row := 0
	for y := cy - radius; y <= cy+radius; y += stepY {
		offset := 0.0
		if row%2 == 1 {
			offset = stepX / 2 // 磚牆式錯位
		}
		for x := cx - radius - tw + offset; x <= cx+radius; x += stepX {
			c.pdf.SetXY(x, y+size*0.3)
			if err := c.pdf.Text(text); err != nil {
				return err
			}
		}
		row++
	}
	return nil
}

// drawTableCells 逐格繪製（支援 colSpan/rowSpan 與逐格字級/顏色）。
// rowSpan 以本分片為限（跨頁分片時夾住，不畫出分片外）。
func (c *drawCtx) drawTableCells(t *Element, y float64, rows []ExpandedRow) error {
	type rc struct{ r, c int }
	cols := len(t.ColumnWidths)
	span := func(cell *TableCell, ri, ci int) (cs, rs int) {
		cs, rs = 1, 1
		if cell != nil {
			if cell.ColSpan > 1 {
				cs = cell.ColSpan
			}
			if cell.RowSpan > 1 {
				rs = cell.RowSpan
			}
		}
		cs = min(cs, cols-ci)
		rs = min(rs, len(rows)-ri)
		return
	}
	covered := map[rc]bool{}
	for ri := range rows {
		for ci := range rows[ri].Cells {
			if ci >= cols {
				break
			}
			cs, rs := span(&rows[ri].Cells[ci], ri, ci)
			for dr := 0; dr < rs; dr++ {
				for dc := 0; dc < cs; dc++ {
					if dr != 0 || dc != 0 {
						covered[rc{ri + dr, ci + dc}] = true
					}
				}
			}
		}
	}

	rowTop := make([]float64, len(rows)+1)
	rowTop[0] = y
	for i, row := range rows {
		rowTop[i+1] = rowTop[i] + row.Height
	}
	colLeft := make([]float64, cols+1)
	colLeft[0] = t.X
	for i, w := range t.ColumnWidths {
		colLeft[i+1] = colLeft[i] + w
	}

	hasBorder := t.BorderWidth > 0
	if hasBorder {
		br, bg, bb := parseColor(t.BorderColor)
		c.pdf.SetStrokeColor(br, bg, bb)
		c.pdf.SetLineWidth(t.BorderWidth)
	}

	for ri, row := range rows {
		for ci := 0; ci < cols; ci++ {
			if covered[rc{ri, ci}] {
				continue
			}
			var cell *TableCell
			text := ""
			if ci < len(row.Cells) {
				cell = &row.Cells[ci]
			}
			if ci < len(row.Texts) {
				text = row.Texts[ci]
			}
			cs, rs := span(cell, ri, ci)
			x0, y0 := colLeft[ci], rowTop[ri]
			w := colLeft[ci+cs] - x0
			h := rowTop[ri+rs] - y0
			// 背景色先畫，框線與內容蓋在上面
			if cell != nil && cell.FillColor != "" {
				fr, fg, fb := parseColor(cell.FillColor)
				c.pdf.SetFillColor(fr, fg, fb)
				c.pdf.RectFromUpperLeftWithStyle(x0, y0, w, h, "F")
			}
			if hasBorder {
				// 逐格框線：nil = 四邊都畫。共用邊只要任一側有開就會畫（鄰格畫自己的那側）
				var bd *CellBorders
				if cell != nil {
					bd = cell.Borders
				}
				if bd == nil || bd.Top {
					c.pdf.Line(x0, y0, x0+w, y0)
				}
				if bd == nil || bd.Bottom {
					c.pdf.Line(x0, y0+h, x0+w, y0+h)
				}
				if bd == nil || bd.Left {
					c.pdf.Line(x0, y0, x0, y0+h)
				}
				if bd == nil || bd.Right {
					c.pdf.Line(x0+w, y0, x0+w, y0+h)
				}
				// 斜線（劃掉未使用欄位）：╲ 左上→右下、╱ 左下→右上
				if bd != nil && bd.DiagDown {
					c.pdf.Line(x0, y0, x0+w, y0+h)
				}
				if bd != nil && bd.DiagUp {
					c.pdf.Line(x0, y0+h, x0+w, y0)
				}
			}
			if cell != nil && cell.Kind == "image" {
				pad := t.CellPadding
				// 來源優先序：Key（動態；重複列相對 key 已在展開時解析進 Texts）> URL（固定連結）> AssetID
				if cell.Key != "" {
					if err := c.drawImageURLRect(text, x0+pad, y0+pad, w-2*pad, h-2*pad, "contain"); err != nil {
						return err
					}
					continue
				}
				if cell.URL != "" {
					if err := c.drawImageURLRect(cell.URL, x0+pad, y0+pad, w-2*pad, h-2*pad, "contain"); err != nil {
						return err
					}
					continue
				}
				if err := c.drawImageRect(cell.AssetID, x0+pad, y0+pad, w-2*pad, h-2*pad, "contain"); err != nil {
					return err
				}
				continue
			}
			if cell != nil && cell.Kind == "barcode" {
				// 內容已在展開時解析進 Texts（Key 綁定含重複列相對 key；否則 Value 靜態值）
				pad := t.CellPadding
				if err := c.drawBarcodeRect(cell.Symbology, text, cell.ShowText, x0+pad, y0+pad, w-2*pad, h-2*pad); err != nil {
					return err
				}
				continue
			}
			if cell != nil && text != "" {
				fs := t.FontSize
				if cell.FontSize > 0 {
					fs = cell.FontSize
				}
				if err := c.setFont(t.FontFamily, fs, cell.Bold); err != nil {
					return err
				}
				if cell.Color != "" {
					cr, cg, cb := parseColor(cell.Color)
					c.pdf.SetTextColor(cr, cg, cb)
				} else {
					c.pdf.SetTextColor(0, 0, 0)
				}
				innerW := w - 2*t.CellPadding
				if cell.Wrap || cell.VAlign == "top" || cell.VAlign == "bottom" {
					// 文字塊幾何：換行多行或垂直對齊上/下時使用。
					// 預設（middle、單行）維持下方原公式，輸出 byte 不變。
					lineH := cellLineHeight * fs
					var lines []string
					if cell.Wrap {
						lines = WrapText(text, innerW, c.measure)
					} else {
						lines = []string{truncateToWidth(text, innerW, c.measure)}
					}
					blockH := float64(len(lines)) * lineH
					var blockTop float64
					switch cell.VAlign {
					case "top":
						blockTop = y0 + t.CellPadding
					case "bottom":
						blockTop = y0 + h - t.CellPadding - blockH
					default:
						blockTop = y0 + (h-blockH)/2
					}
					for i, line := range lines {
						lineWidth := c.measure(line)
						lx := x0 + t.CellPadding
						switch cell.Align {
						case "center":
							lx = x0 + t.CellPadding + (innerW-lineWidth)/2
						case "right":
							lx = x0 + t.CellPadding + innerW - lineWidth
						}
						baseline := blockTop + (float64(i)+0.5)*lineH + CellBaselineRatio*fs
						c.pdf.SetXY(lx, baseline)
						if err := c.pdf.Text(line); err != nil {
							return err
						}
					}
					continue
				}
				text = truncateToWidth(text, innerW, c.measure) // 單行溢出裁切，不壓到鄰格
				lineWidth := c.measure(text)
				lx := x0 + t.CellPadding
				switch cell.Align {
				case "center":
					lx = x0 + t.CellPadding + (innerW-lineWidth)/2
				case "right":
					lx = x0 + t.CellPadding + innerW - lineWidth
				}
				baseline := y0 + h/2 + CellBaselineRatio*fs
				c.pdf.SetXY(lx, baseline)
				if err := c.pdf.Text(text); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// drawBarcode 畫條碼元素：內容 = key 綁定資料（fallback sample）或 content 靜態值。
func (c *drawCtx) drawBarcode(el *Element, y float64) error {
	val := el.Content
	if el.Key != "" {
		val = c.resolveKey(el.Key, el.Sample)
	}
	return c.drawBarcodeRect(el.Symbology, val, el.ShowText, el.X, y, el.Width, el.Height)
}

// drawBarcodeRect 在指定矩形內畫條碼（元素與表格儲存格共用）。
// 1D 條碼可加人讀文字（showText）；QR 以正方形置中。編碼失敗時畫錯誤框提示。
func (c *drawCtx) drawBarcodeRect(symbology, val string, wantText bool, x, y, w, h float64) error {
	if val == "" {
		return nil
	}

	const textH = 11.0 // 人讀文字區高度（pt）
	barH := h
	showText := wantText && symbology != "qr"
	if showText && barH > textH+6 {
		barH -= textH
	}

	var bc barcode.Barcode
	var err error
	switch symbology {
	case "code39":
		bc, err = code39.Encode(strings.ToUpper(val), false, true)
	case "ean13":
		bc, err = ean.Encode(val)
	case "qr":
		bc, err = qr.Encode(val, qr.M, qr.Auto)
	default: // code128
		bc, err = code128.Encode(val)
	}
	if err == nil {
		if symbology == "qr" {
			side := int(math.Max(64, math.Min(w, barH)*4))
			bc, err = barcode.Scale(bc, side, side)
		} else {
			bc, err = barcode.Scale(bc, int(math.Max(float64(bc.Bounds().Dx()), w*4)), int(math.Max(16, barH*4)))
		}
	}
	if err != nil {
		// 編碼失敗：畫錯誤提示框（例如 code39 不支援的字元）
		c.pdf.SetStrokeColor(220, 38, 38)
		c.pdf.SetLineWidth(1)
		c.pdf.RectFromUpperLeftWithStyle(x, y, w, h, "D")
		_ = c.setFont("sans", 8, false)
		c.pdf.SetTextColor(220, 38, 38)
		c.pdf.SetXY(x+3, y+12)
		return c.pdf.Text("條碼編碼失敗: " + err.Error())
	}

	// boombuler 產出的可能是 16-bit 灰階，gopdf 不支援 → 轉成 8-bit RGBA
	rgba := image.NewNRGBA(bc.Bounds())
	draw.Draw(rgba, bc.Bounds(), bc, bc.Bounds().Min, draw.Src)
	var buf bytes.Buffer
	if err := png.Encode(&buf, rgba); err != nil {
		return err
	}
	holder, err := gopdf.ImageHolderByBytes(buf.Bytes())
	if err != nil {
		return err
	}
	bx, bw := x, w
	if symbology == "qr" {
		side := math.Min(w, barH)
		bx = x + (w-side)/2
		bw = side
		barH = side
	}
	if err := c.pdf.ImageByHolder(holder, bx, y, &gopdf.Rect{W: bw, H: barH}); err != nil {
		return err
	}
	if showText {
		if err := c.setFont("mono", 9, false); err != nil {
			return err
		}
		c.pdf.SetTextColor(0, 0, 0)
		tw := c.measure(val)
		c.pdf.SetXY(x+(w-tw)/2, y+barH+textH-2)
		return c.pdf.Text(val)
	}
	return nil
}

// tableHasSpansOrCellStyle 是否需要逐格繪製（合併儲存格或逐格樣式）。
func tableHasSpansOrCellStyle(rows []ExpandedRow) bool {
	for _, row := range rows {
		for i := range row.Cells {
			cell := &row.Cells[i]
			if cell.ColSpan > 1 || cell.RowSpan > 1 || cell.FontSize > 0 || cell.Color != "" || cell.FillColor != "" || cell.Borders != nil || cell.Wrap || cell.VAlign != "" || cell.Kind == "image" || cell.Kind == "barcode" {
				return true
			}
		}
	}
	return false
}

// drawTableFragment 畫一個表格分片（rows 含每片重複的表頭列）。
// 無合併/逐格樣式時走整條格線的快速路徑（輸出與舊版 byte 相同）；否則逐格繪製。
func (c *drawCtx) drawTableFragment(t *Element, y float64, rows []ExpandedRow) error {
	if tableHasSpansOrCellStyle(rows) {
		return c.drawTableCells(t, y, rows)
	}
	totalW := sumFloats(t.ColumnWidths)
	totalH := sumHeights(rows)
	// 格線（BorderWidth <= 0 = 框線透明，不畫）
	if t.BorderWidth > 0 {
		br, bg, bb := parseColor(t.BorderColor)
		c.pdf.SetStrokeColor(br, bg, bb)
		c.pdf.SetLineWidth(t.BorderWidth)
		yCursor := y
		c.pdf.Line(t.X, yCursor, t.X+totalW, yCursor)
		for _, row := range rows {
			yCursor += row.Height
			c.pdf.Line(t.X, yCursor, t.X+totalW, yCursor)
		}
		xCursor := t.X
		c.pdf.Line(xCursor, y, xCursor, y+totalH)
		for _, colW := range t.ColumnWidths {
			xCursor += colW
			c.pdf.Line(xCursor, y, xCursor, y+totalH)
		}
	}

	// 儲存格文字（單行、垂直置中）
	cellY := y
	for _, row := range rows {
		cellX := t.X
		for ci, colW := range t.ColumnWidths {
			var cell *TableCell
			text := ""
			if ci < len(row.Cells) {
				cell = &row.Cells[ci]
			}
			if ci < len(row.Texts) {
				text = row.Texts[ci]
			}
			if cell != nil && text != "" {
				if err := c.setFont(t.FontFamily, t.FontSize, cell.Bold); err != nil {
					return err
				}
				c.pdf.SetTextColor(0, 0, 0)
				innerW := colW - 2*t.CellPadding
				text = truncateToWidth(text, innerW, c.measure) // 單行溢出裁切，不壓到鄰格
				lineWidth := c.measure(text)
				lx := cellX + t.CellPadding
				switch cell.Align {
				case "center":
					lx = cellX + t.CellPadding + (innerW-lineWidth)/2
				case "right":
					lx = cellX + t.CellPadding + innerW - lineWidth
				}
				baseline := cellY + row.Height/2 + CellBaselineRatio*t.FontSize
				c.pdf.SetXY(lx, baseline)
				if err := c.pdf.Text(text); err != nil {
					return err
				}
			}
			cellX += colW
		}
		cellY += row.Height
	}
	return nil
}
