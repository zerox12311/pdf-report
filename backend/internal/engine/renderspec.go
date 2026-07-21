package engine

import (
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// 繪製規則常數與純函式（換行/路徑解析/插值/表格展開）；不依賴 gopdf，可獨立測試。
// 資料 data 為 encoding/json 以 UseNumber 解碼的 any（map[string]any / []any / string / json.Number / bool）。

// BaselineRatio 第一行 baseline 相對元素框頂端的偏移比例（× fontSize）。
// 刻意用固定常數而非字型 metrics，讓輸出可預期。
const BaselineRatio = 0.88

// CellBaselineRatio 表格儲存格文字垂直置中時，baseline 相對儲存格中線的偏移比例（× fontSize）。
const CellBaselineRatio = 0.35

// cellLineHeight 儲存格自動換行的行高倍數（與文字元件預設 lineHeight 一致）
const cellLineHeight = 1.2

// Tokenize 斷詞：CJK 逐字、拉丁字母/數字成詞、空白單獨成 token。
func Tokenize(text string) []string {
	tokens := []string{}
	word := ""
	for _, ch := range text {
		switch {
		case ch == ' ':
			if word != "" {
				tokens = append(tokens, word)
				word = ""
			}
			tokens = append(tokens, " ")
		case ch >= 0x2E80: // CJK
			if word != "" {
				tokens = append(tokens, word)
				word = ""
			}
			tokens = append(tokens, string(ch))
		default:
			word += string(ch)
		}
	}
	if word != "" {
		tokens = append(tokens, word)
	}
	return tokens
}

// WrapText greedy 換行；measure 回傳字串寬度（pt）。
func WrapText(text string, maxWidth float64, measure func(string) float64) []string {
	lines := []string{}
	text = strings.ReplaceAll(text, "\r\n", "\n")
	for _, paragraph := range strings.Split(text, "\n") {
		current := ""
		for _, token := range Tokenize(paragraph) {
			candidate := current + token
			if current != "" && measure(candidate) > maxWidth {
				lines = append(lines, strings.TrimRight(current, " "))
				current = strings.TrimLeft(token, " ")
			} else {
				current = candidate
			}
			// 單一 token 超寬：逐字硬切
			for len([]rune(current)) > 1 && measure(current) > maxWidth {
				runes := []rune(current)
				fit := 1
				for fit < len(runes) && measure(string(runes[:fit+1])) <= maxWidth {
					fit++
				}
				lines = append(lines, string(runes[:fit]))
				current = string(runes[fit:])
			}
		}
		lines = append(lines, strings.TrimRight(current, " "))
	}
	return lines
}

// ResolveRaw 依 "customer.name" / "items[0].qty" 路徑取原始值；取不到回 nil。
func ResolveRaw(data any, path string) any {
	if data == nil || path == "" {
		return nil
	}
	current := data
	for _, segment := range strings.Split(path, ".") {
		name := segment
		indices := []int{}
		if bracket := strings.Index(name, "["); bracket >= 0 {
			idxPart := strings.TrimSuffix(strings.TrimPrefix(name[bracket:], "["), "]")
			for _, part := range strings.Split(idxPart, "][") {
				if i, err := strconv.Atoi(strings.TrimSpace(part)); err == nil {
					indices = append(indices, i)
				}
			}
			name = name[:bracket]
		}
		if name != "" {
			obj, ok := current.(map[string]any)
			if !ok {
				return nil
			}
			v, ok := obj[name]
			if !ok {
				return nil
			}
			current = v
		}
		for _, i := range indices {
			arr, ok := current.([]any)
			if !ok || i >= len(arr) {
				return nil
			}
			current = arr[i]
		}
	}
	return current
}

// ResolvePath 依路徑取字串；取不到回 ""（並回報 ok=false）。
func ResolvePath(data any, path string) (string, bool) {
	v := ResolveRaw(data, path)
	switch t := v.(type) {
	case string:
		return t, true
	case json.Number:
		return t.String(), true
	case bool:
		if t {
			return "true", true
		}
		return "false", true
	case float64: // 未用 UseNumber 時的保底
		return strconv.FormatFloat(t, 'f', -1, 64), true
	default:
		return "", false
	}
}

// ---------- 彙總函式 ----------

var aggRe = regexp.MustCompile(`^\$(sum|count|avg)\((.+)\)$`)

func toNumber(v any) (float64, bool) {
	switch t := v.(type) {
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case float64:
		return t, true
	case string:
		f, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(t), ",", ""), 64)
		return f, err == nil
	default:
		return 0, false
	}
}

// collectArray 解析彙總路徑：整段是陣列（$count(items)），
// 或「陣列.欄位」（$sum(items.amount)）→ 回傳每個元素的欄位值。
func collectArray(data any, path string) ([]any, bool) {
	if arr, ok := ResolveRaw(data, path).([]any); ok {
		return arr, true
	}
	dot := strings.LastIndex(path, ".")
	if dot < 0 {
		return nil, false
	}
	arr, ok := ResolveRaw(data, path[:dot]).([]any)
	if !ok {
		return nil, false
	}
	field := path[dot+1:]
	out := make([]any, 0, len(arr))
	for _, item := range arr {
		out = append(out, ResolveRaw(item, field))
	}
	return out, true
}

// ResolveAggregate 處理 $sum(path) / $count(path) / $avg(path)；非彙總 key 回 ok=false。
func ResolveAggregate(data any, key string) (string, bool) {
	m := aggRe.FindStringSubmatch(key)
	if m == nil {
		return "", false
	}
	values, ok := collectArray(data, m[2])
	if !ok {
		return "0", true
	}
	if m[1] == "count" {
		return strconv.Itoa(len(values)), true
	}
	sum, n := 0.0, 0
	for _, v := range values {
		if f, ok := toNumber(v); ok {
			sum += f
			n++
		}
	}
	if m[1] == "avg" {
		if n == 0 {
			return "0", true
		}
		sum /= float64(n)
	}
	return strconv.FormatFloat(sum, 'f', -1, 64), true
}

// ---------- 表格陣列迴圈（報表重複列） ----------

// ExpandedRow 展開後的一列：高度 + 樣式來源儲存格 + 已解析文字
type ExpandedRow struct {
	Height float64
	Cells  []TableCell
	Texts  []string
}

var gAggRe = regexp.MustCompile(`^\$g(sum|avg)\((.+)\)$`)

// resolveGroupAggregate 群組彙總：$gcount、$gsum(欄位)、$gavg(欄位)，欄位為群組元素上的相對路徑。
func resolveGroupAggregate(group []any, key string) (string, bool) {
	if group == nil {
		return "", false
	}
	if key == "$gcount" || key == "$gcount()" {
		return strconv.Itoa(len(group)), true
	}
	m := gAggRe.FindStringSubmatch(key)
	if m == nil {
		return "", false
	}
	sum, n := 0.0, 0
	for _, item := range group {
		if f, ok := toNumber(ResolveRaw(item, m[2])); ok {
			sum += f
			n++
		}
	}
	if m[1] == "avg" {
		if n == 0 {
			return "0", true
		}
		sum /= float64(n)
	}
	return strconv.FormatFloat(sum, 'f', -1, 64), true
}

// WarnFunc 渲染警告回報（例：資料裡找不到 key、退回範例值）；nil = 不收集。
type WarnFunc func(msg string)

// cellText 解析儲存格內容。rowNum > 0 表示在重複列內（$row = 列序號）；
// root 為整份資料（$sum 等全域彙總對整份資料計算）；group 非 nil 時可用 $gsum/$gcount/$gavg。
func cellText(cell TableCell, ctx, root any, rowNum int, group []any, warn WarnFunc) string {
	if cell.Kind != "placeholder" {
		// text 儲存格也支援 {{key|fmt}} 行內插值（與文字元件一致），並吃重複列上下文
		// （$row / $gsum(...) / 相對 key）。無 token 時原樣回傳（零成本）。
		return interpolateText(cell.Value, func(key string) string {
			return resolveCellKey(key, ctx, root, rowNum, group, warn)
		})
	}
	v := cell.Sample
	if r, ok := resolveCellKeyOK(cell.Key, ctx, root, rowNum, group); ok {
		v = r
	} else if warn != nil && cell.Key != "" {
		warn("找不到資料 key：" + cell.Key + "（已用範例值代替）")
	}
	return formatValue(v, cell.Format)
}

// resolveCellKeyOK 依重複列上下文解析儲存格 key（$row / 群組彙總 / 全域彙總 / 資料路徑）。
func resolveCellKeyOK(key string, ctx, root any, rowNum int, group []any) (string, bool) {
	if key == "$row" && rowNum > 0 {
		return strconv.Itoa(rowNum), true
	}
	if g, ok := resolveGroupAggregate(group, key); ok {
		return g, true
	}
	if agg, ok := ResolveAggregate(root, key); ok {
		return agg, true
	}
	if r, ok := ResolvePath(ctx, key); ok {
		return r, true
	}
	return "", false
}

// resolveCellKey 同上，但找不到時回空字串並警告（插值用；插值無 sample fallback）。
func resolveCellKey(key string, ctx, root any, rowNum int, group []any, warn WarnFunc) string {
	if v, ok := resolveCellKeyOK(key, ctx, root, rowNum, group); ok {
		return v
	}
	if warn != nil && key != "" {
		warn("找不到資料 key：" + key + "（已用範例值代替）")
	}
	return ""
}

// interpolateText 把 {{key|fmt}} 換成 resolve 求得的值。無 token 原樣回傳。
// 與 drawCtx.interpolate 共用同一 regex，文字元件與儲存格插值行為一致。
func interpolateText(content string, resolve func(key string) string) string {
	if !strings.Contains(content, "{{") {
		return content
	}
	return interpolateRe.ReplaceAllStringFunc(content, func(m string) string {
		parts := interpolateRe.FindStringSubmatch(m)
		return formatValue(resolve(parts[1]), parts[2])
	})
}

// truncateToWidth 單行裁切：超出 maxWidth 時逐字截斷並加 …（儲存格單行排版用）。
func truncateToWidth(text string, maxWidth float64, measure func(string) float64) string {
	if maxWidth <= 0 || measure(text) <= maxWidth {
		return text
	}
	runes := []rune(text)
	ell := "…"
	for n := len(runes) - 1; n >= 0; n-- {
		if measure(string(runes[:n])+ell) <= maxWidth {
			return string(runes[:n]) + ell
		}
	}
	return ell
}

// tableRowCells 取樣板第 r 列的儲存格（越界回空）。
func tableRowCells(t *Element, r int) []TableCell {
	if r >= 0 && r < len(t.Cells) {
		return t.Cells[r]
	}
	return nil
}

func makeRow(t *Element, r int, ctx, root any, rowNum int, group []any, warn WarnFunc) ExpandedRow {
	cells := tableRowCells(t, r)
	texts := make([]string, len(cells))
	for c, cell := range cells {
		texts[c] = cellText(cell, ctx, root, rowNum, group, warn)
	}
	return ExpandedRow{t.RowHeights[r], cells, texts}
}

// groupRowIdx 取群組首/尾列索引；未設定或不在範圍回 -1。
func groupRowIdx(t *Element, p *int) int {
	if t.Repeat == nil || t.Repeat.GroupBy == "" || p == nil || *p < 0 || *p >= len(t.RowHeights) {
		return -1
	}
	return *p
}

// PageHeaderRowCount 跨頁時每片重畫的表頭列數：重複列之前的列，扣掉群組首/尾列。
func PageHeaderRowCount(t *Element) int {
	rep := t.Repeat
	if rep == nil {
		return 0
	}
	n := 0
	gh, gf := groupRowIdx(t, rep.GroupHeaderRow), groupRowIdx(t, rep.GroupFooterRow)
	for r := 0; r < rep.RowIndex && r < len(t.RowHeights); r++ {
		if r != gh && r != gf {
			n++
		}
	}
	return n
}

// ExpandTable 把表格展開成實際要畫的列。
// 有啟用 repeat 時：repeat.RowIndex 那一列依 data[repeat.Key] 陣列展開（儲存格 key 相對於陣列元素）；
// 設定 groupBy 時，依相鄰相同值分組，每組插入群組首/尾列（儲存格可用 $gsum/$gcount/$gavg，
// 相對 key 以該組第一筆解析）。陣列不存在則以範例值畫一列；空陣列則整列省略。
// ExpandTable 等同 ExpandTableWarn(t, data, nil)。
func ExpandTable(t *Element, data any) []ExpandedRow {
	return ExpandTableWarn(t, data, nil)
}

func ExpandTableWarn(t *Element, data any, warn WarnFunc) []ExpandedRow {
	rows := []ExpandedRow{}
	rep := t.Repeat
	repeatOn := rep != nil && rep.Enabled && rep.Key != ""
	gh, gf := -1, -1
	if repeatOn {
		gh, gf = groupRowIdx(t, rep.GroupHeaderRow), groupRowIdx(t, rep.GroupFooterRow)
	}

	for r := 0; r < len(t.RowHeights); r++ {
		if !repeatOn {
			rows = append(rows, makeRow(t, r, data, data, 0, nil, warn))
			continue
		}
		if r == gh || r == gf {
			continue // 群組首/尾列在明細展開時逐組插入
		}
		if r != rep.RowIndex {
			rows = append(rows, makeRow(t, r, data, data, 0, nil, warn))
			continue
		}

		arr, ok := ResolveRaw(data, rep.Key).([]any)
		if !ok {
			if warn != nil {
				warn("找不到陣列 key：" + rep.Key + "（明細以範例值畫一列）")
			}
			// 無資料 → 以範例值畫一列
			cells := tableRowCells(t, r)
			texts := make([]string, len(cells))
			for c, cell := range cells {
				if cell.Kind == "placeholder" {
					texts[c] = formatValue(cell.Sample, cell.Format)
				} else {
					texts[c] = cell.Value
				}
			}
			rows = append(rows, ExpandedRow{t.RowHeights[r], cells, texts})
			continue
		}

		if rep.GroupBy == "" {
			for i, item := range arr {
				rows = append(rows, makeRow(t, r, item, data, i+1, nil, warn))
			}
			continue
		}

		// 依相鄰相同 groupBy 值分組展開
		rowNum := 0
		for start := 0; start < len(arr); {
			gv, _ := ResolvePath(arr[start], rep.GroupBy)
			end := start + 1
			for end < len(arr) {
				v, _ := ResolvePath(arr[end], rep.GroupBy)
				if v != gv {
					break
				}
				end++
			}
			group := arr[start:end]
			if gh >= 0 {
				rows = append(rows, makeRow(t, gh, group[0], data, 0, group, warn))
			}
			for _, item := range group {
				rowNum++
				rows = append(rows, makeRow(t, r, item, data, rowNum, group, warn))
			}
			if gf >= 0 {
				rows = append(rows, makeRow(t, gf, group[0], data, 0, group, warn))
			}
			start = end
		}
	}
	return rows
}

func sumHeights(rows []ExpandedRow) float64 {
	total := 0.0
	for _, r := range rows {
		total += r.Height
	}
	return total
}

func sumFloats(v []float64) float64 {
	total := 0.0
	for _, x := range v {
		total += x
	}
	return total
}

func isRepeatTable(e *Element) bool {
	return e.Type == "table" && e.Repeat != nil && e.Repeat.Enabled && e.Repeat.Key != ""
}

// tableHasWrap 表格是否有自動換行儲存格。
// 沒有時完全跳過換行列高計算——確保既有樣板輸出 byte 不變（golden）。
func tableHasWrap(e *Element) bool {
	if e.Type != "table" {
		return false
	}
	for _, row := range e.Cells {
		for _, cell := range row {
			if cell.Wrap {
				return true
			}
		}
	}
	return false
}

// ComputeRepeatOffsets 計算重複列造成的位移：展開後變高（矮）的表格，
// 把「設計位置在其下緣以下」的元素往下（上）推。回傳 elementID → y 位移。
func ComputeRepeatOffsets(doc *TemplateDoc, data any) map[string]float64 {
	offsets := map[string]float64{}
	tables := []*Element{}
	for i := range doc.Elements {
		if isRepeatTable(&doc.Elements[i]) {
			tables = append(tables, &doc.Elements[i])
		}
	}
	sort.Slice(tables, func(i, j int) bool { return tables[i].Y < tables[j].Y })
	for _, t := range tables {
		designH := sumFloats(t.RowHeights)
		expandedH := sumHeights(ExpandTable(t, data))
		delta := expandedH - designH
		if math.Abs(delta) < epsilonGrow {
			continue
		}
		for i := range doc.Elements {
			el := &doc.Elements[i]
			if el.ID == t.ID {
				continue
			}
			if el.Y >= t.Y+designH-epsilonPt {
				offsets[el.ID] += delta
			}
		}
	}
	return offsets
}
