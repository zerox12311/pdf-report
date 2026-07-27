package engine

import "strings"

// 行內富文字標記：[b]粗[/b]、[i]斜[/i]、[c=#rrggbb]色[/c]，可巢狀。
// 只認得上述小寫標記；其他中括號內容一律當一般文字（設計者要打字面 [x] 不需跳脫）。
// 與前端 core/utils/rich-text.ts 為雙實作，改一邊必改另一邊＋兩邊測試。

// Span 一段樣式一致的文字。Color 空字串 = 沿用元素層級顏色。
type Span struct {
	Text   string
	Bold   bool
	Italic bool
	Color  string
}

// HasRichMarkup 是否含任何有效標記（快速判斷；無標記走原本純文字路徑）。
func HasRichMarkup(s string) bool {
	i := 0
	for {
		j := strings.IndexByte(s[i:], '[')
		if j < 0 {
			return false
		}
		i += j
		if n := matchTag(s[i:]); n > 0 {
			return true
		}
		i++
	}
}

// StripRichMarkup 移除標記、保留文字（斷行量測與純文字場景用）。
func StripRichMarkup(s string) string {
	if !HasRichMarkup(s) {
		return s
	}
	var b strings.Builder
	for _, sp := range ParseRichText(s) {
		b.WriteString(sp.Text)
	}
	return b.String()
}

// ParseRichText 把含標記的字串解析成 spans（相鄰同樣式會合併成一段）。
// 未閉合的標記作用到字串結尾；多餘的閉合標記無作用（不輸出字面）。
func ParseRichText(s string) []Span {
	var spans []Span
	var buf strings.Builder
	boldDepth, italicDepth := 0, 0
	colorStack := []string{}
	cur := func() Span {
		c := ""
		if len(colorStack) > 0 {
			c = colorStack[len(colorStack)-1]
		}
		return Span{Bold: boldDepth > 0, Italic: italicDepth > 0, Color: c}
	}
	flush := func() {
		if buf.Len() == 0 {
			return
		}
		sp := cur()
		sp.Text = buf.String()
		buf.Reset()
		if n := len(spans); n > 0 && spans[n-1].Bold == sp.Bold && spans[n-1].Italic == sp.Italic && spans[n-1].Color == sp.Color {
			spans[n-1].Text += sp.Text
			return
		}
		spans = append(spans, sp)
	}
	i := 0
	for i < len(s) {
		if s[i] == '[' {
			if n := matchTag(s[i:]); n > 0 {
				tag := s[i : i+n]
				flush()
				switch {
				case tag == "[b]":
					boldDepth++
				case tag == "[/b]":
					if boldDepth > 0 {
						boldDepth--
					}
				case tag == "[i]":
					italicDepth++
				case tag == "[/i]":
					if italicDepth > 0 {
						italicDepth--
					}
				case tag == "[/c]":
					if len(colorStack) > 0 {
						colorStack = colorStack[:len(colorStack)-1]
					}
				default: // [c=#rrggbb]
					colorStack = append(colorStack, tag[3:len(tag)-1])
				}
				i += n
				continue
			}
		}
		buf.WriteByte(s[i])
		i++
	}
	flush()
	return spans
}

// StyledRun 斷行後一行內樣式一致的一段（Width 為量測寬度；Color 空 = 沿用元素色）。
type StyledRun struct {
	Text   string
	Width  float64
	Bold   bool
	Italic bool
	Color  string
}

// SpanMeasure 依樣式量測字串寬度（粗體變寬；斜體與正體同寬，但仍帶入以保一致）。
type SpanMeasure func(s string, bold, italic bool) float64

type styledToken struct {
	text   string
	bold   bool
	italic bool
	color  string
}

// WrapSpans 把 spans 依 maxWidth greedy 斷行，規則與 WrapText 一致：
// \n 切段、CJK 逐字、拉丁成詞、行尾修剪空白、單 token 超寬逐字硬切。
// 寬度以逐段量測累加（詞跨樣式邊界時允許在邊界斷行）。
func WrapSpans(spans []Span, maxWidth float64, measure SpanMeasure) [][]StyledRun {
	paragraphs := [][]styledToken{{}}
	for _, sp := range spans {
		text := strings.ReplaceAll(sp.Text, "\r\n", "\n")
		for pi, part := range strings.Split(text, "\n") {
			if pi > 0 {
				paragraphs = append(paragraphs, []styledToken{})
			}
			last := len(paragraphs) - 1
			for _, tok := range Tokenize(part) {
				paragraphs[last] = append(paragraphs[last], styledToken{tok, sp.Bold, sp.Italic, sp.Color})
			}
		}
	}

	lines := [][]StyledRun{}
	for _, toks := range paragraphs {
		var cur []StyledRun
		curW := 0.0
		runeCount := 0

		appendRun := func(t styledToken, w float64) {
			runeCount += len([]rune(t.text))
			curW += w
			if n := len(cur); n > 0 && cur[n-1].Bold == t.bold && cur[n-1].Italic == t.italic && cur[n-1].Color == t.color {
				cur[n-1].Text += t.text
				cur[n-1].Width += w
				return
			}
			cur = append(cur, StyledRun{Text: t.text, Width: w, Bold: t.bold, Italic: t.italic, Color: t.color})
		}
		flush := func() {
			for len(cur) > 0 { // 行尾空白修剪（同 WrapText 的 TrimRight）
				last := &cur[len(cur)-1]
				trimmed := strings.TrimRight(last.Text, " ")
				if trimmed == last.Text {
					break
				}
				if trimmed == "" {
					cur = cur[:len(cur)-1]
					continue
				}
				last.Width = measure(trimmed, last.Bold, last.Italic)
				last.Text = trimmed
				break
			}
			lines = append(lines, cur)
			cur, curW, runeCount = nil, 0, 0
		}

		for _, tok := range toks {
			w := measure(tok.text, tok.bold, tok.italic)
			if len(cur) > 0 && curW+w > maxWidth {
				flush()
				tok.text = strings.TrimLeft(tok.text, " ")
				if tok.text == "" {
					continue
				}
				w = measure(tok.text, tok.bold, tok.italic)
			}
			appendRun(tok, w)
			for runeCount > 1 && curW > maxWidth { // 單 token 超寬：逐字硬切
				fitLine, rest, restW := splitOverflow(cur, maxWidth, measure)
				if fitLine == nil {
					break
				}
				lines = append(lines, fitLine)
				cur, curW = rest, restW
				runeCount = 0
				for _, r := range cur {
					runeCount += len([]rune(r.Text))
				}
			}
		}
		flush()
	}
	return lines
}

// splitOverflow 從 runs 取出塞得進 maxWidth 的最長前綴（至少 1 個 rune）當一行，
// 回傳（該行, 剩餘 runs, 剩餘寬度）。全部放得下時回傳 (nil, nil, 0)。
func splitOverflow(runs []StyledRun, maxWidth float64, measure SpanMeasure) ([]StyledRun, []StyledRun, float64) {
	fit := []StyledRun{}
	fitW := 0.0
	taken := 0
	for ri := range runs {
		r := runs[ri]
		runes := []rune(r.Text)
		for ci := range runes {
			candW := fitW + measure(string(runes[:ci+1]), r.Bold, r.Italic)
			if taken >= 1 && candW > maxWidth {
				if ci > 0 {
					w := measure(string(runes[:ci]), r.Bold, r.Italic)
					fit = append(fit, StyledRun{Text: string(runes[:ci]), Width: w, Bold: r.Bold, Italic: r.Italic, Color: r.Color})
				}
				restRun := StyledRun{Text: string(runes[ci:]), Width: measure(string(runes[ci:]), r.Bold, r.Italic), Bold: r.Bold, Italic: r.Italic, Color: r.Color}
				rest := append([]StyledRun{restRun}, runs[ri+1:]...)
				restW := 0.0
				for _, rr := range rest {
					restW += rr.Width
				}
				return fit, rest, restW
			}
			taken++
		}
		fit = append(fit, r)
		fitW += r.Width
	}
	return nil, nil, 0
}

// RunsFromSpans spans → 帶量測寬度的 runs（不斷行；儲存格單行排版用）。
func RunsFromSpans(spans []Span, measure SpanMeasure) []StyledRun {
	runs := make([]StyledRun, 0, len(spans))
	for _, sp := range spans {
		if sp.Text == "" {
			continue
		}
		runs = append(runs, StyledRun{Text: sp.Text, Width: measure(sp.Text, sp.Bold, sp.Italic), Bold: sp.Bold, Italic: sp.Italic, Color: sp.Color})
	}
	return runs
}

// TruncateRuns 單行裁切：超出 maxWidth 時逐字截斷加 …（與 truncateToWidth 同語意，
// 省略號沿用截斷點所在段的樣式）。
func TruncateRuns(runs []StyledRun, maxWidth float64, measure SpanMeasure) []StyledRun {
	total := 0.0
	for _, r := range runs {
		total += r.Width
	}
	if maxWidth <= 0 || total <= maxWidth {
		return runs
	}
	const ell = "…"
	out := []StyledRun{}
	acc := 0.0
	for _, r := range runs {
		ellW := measure(ell, r.Bold, r.Italic)
		runes := []rune(r.Text)
		fit := 0
		for fit < len(runes) && acc+measure(string(runes[:fit+1]), r.Bold, r.Italic)+ellW <= maxWidth {
			fit++
		}
		if fit == len(runes) {
			out = append(out, r)
			acc += r.Width
			continue
		}
		if fit > 0 {
			w := measure(string(runes[:fit]), r.Bold, r.Italic)
			out = append(out, StyledRun{Text: string(runes[:fit]), Width: w, Bold: r.Bold, Italic: r.Italic, Color: r.Color})
		}
		out = append(out, StyledRun{Text: ell, Width: ellW, Bold: r.Bold, Italic: r.Italic, Color: r.Color})
		return out
	}
	return out
}

// docHasItalicMarkup 樣板是否用到斜體（[i] 標記或元素/儲存格的 italic 欄位）。
// 決定是否註冊斜體字型：沒用到的樣板不註冊，維持既有 PDF byte 輸出不變（golden）。
func docHasItalicMarkup(doc *TemplateDoc) bool {
	var walk func(els []Element) bool
	walk = func(els []Element) bool {
		for i := range els {
			if els[i].Italic {
				return true
			}
			if els[i].Type == "text" && strings.Contains(els[i].Content, "[i]") {
				return true
			}
			for _, row := range els[i].Cells {
				for _, cell := range row {
					if cell.Italic || (isTextCell(cell) && strings.Contains(cell.Value, "[i]")) {
						return true
					}
				}
			}
			if len(els[i].Children) > 0 && walk(els[i].Children) {
				return true
			}
		}
		return false
	}
	return walk(doc.Elements)
}

// matchTag 檢查 s 開頭是否為有效標記，回傳標記長度（0 = 不是標記）。
func matchTag(s string) int {
	for _, t := range []string{"[b]", "[/b]", "[i]", "[/i]", "[/c]"} {
		if strings.HasPrefix(s, t) {
			return len(t)
		}
	}
	// [c=#rrggbb]：# 後 6 個十六進位小寫/大寫/數字
	const cLen = len("[c=#rrggbb]")
	if len(s) >= cLen && strings.HasPrefix(s, "[c=#") && s[cLen-1] == ']' {
		for _, ch := range s[4 : cLen-1] {
			if !(ch >= '0' && ch <= '9' || ch >= 'a' && ch <= 'f' || ch >= 'A' && ch <= 'F') {
				return 0
			}
		}
		return cLen
	}
	return 0
}
