package engine

import (
	"reflect"
	"testing"
)

func TestHasRichMarkup(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"", false},
		{"純文字", false},
		{"金額 [b]100[/b]", true},
		{"[i]斜[/i]", true},
		{"[c=#ff0000]紅[/c]", true},
		{"[c=#FF00aa]大小寫混合[/c]", true},
		{"備註 [x] 不是標記", false},
		{"[c=red] 非 hex 不是標記", false},
		{"[c=#ff00] 長度不對", false},
		{"陣列索引 items[0].qty", false},
		{"只有閉合 [/b]", true},
	}
	for _, c := range cases {
		if got := HasRichMarkup(c.in); got != c.want {
			t.Errorf("HasRichMarkup(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestStripRichMarkup(t *testing.T) {
	cases := []struct{ in, want string }{
		{"純文字", "純文字"},
		{"金額 [b]100[/b] 元", "金額 100 元"},
		{"[c=#ff0000][b]紅粗[/b][/c]", "紅粗"},
		{"備註 [x] 保留", "備註 [x] 保留"},
	}
	for _, c := range cases {
		if got := StripRichMarkup(c.in); got != c.want {
			t.Errorf("StripRichMarkup(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestParseRichText(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []Span
	}{
		{"純文字單段", "hello", []Span{{Text: "hello"}}},
		{"粗體", "a[b]b[/b]c", []Span{{Text: "a"}, {Text: "b", Bold: true}, {Text: "c"}}},
		{"顏色", "[c=#ff0000]紅[/c]黑", []Span{{Text: "紅", Color: "#ff0000"}, {Text: "黑"}}},
		{"巢狀色（內層優先）", "[c=#ff0000]紅[c=#00ff00]綠[/c]又紅[/c]",
			[]Span{{Text: "紅", Color: "#ff0000"}, {Text: "綠", Color: "#00ff00"}, {Text: "又紅", Color: "#ff0000"}}},
		{"粗斜疊加", "[b][i]粗斜[/i]只粗[/b]",
			[]Span{{Text: "粗斜", Bold: true, Italic: true}, {Text: "只粗", Bold: true}}},
		{"未閉合作用到結尾", "a[b]bc", []Span{{Text: "a"}, {Text: "bc", Bold: true}}},
		{"多餘閉合無作用", "a[/b]b", []Span{{Text: "ab"}}},
		{"未知標記當字面", "a[x]b[/x]", []Span{{Text: "a[x]b[/x]"}}},
		{"相鄰同樣式合併", "[b]a[/b][b]b[/b]", []Span{{Text: "ab", Bold: true}}},
		{"插值 token 不受影響", "[c=#ff0000]{{amount|comma}}[/c]",
			[]Span{{Text: "{{amount|comma}}", Color: "#ff0000"}}},
		{"空字串", "", nil},
	}
	for _, c := range cases {
		if got := ParseRichText(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: ParseRichText(%q) = %#v, want %#v", c.name, c.in, got, c.want)
		}
	}
}

// 測試量測：每 rune 10pt、粗體 12pt（模擬粗體較寬；斜體同寬）。
func stubMeasure(s string, bold, _ bool) float64 {
	per := 10.0
	if bold {
		per = 12.0
	}
	return float64(len([]rune(s))) * per
}

func lineTexts(lines [][]StyledRun) []string {
	out := make([]string, len(lines))
	for i, line := range lines {
		for _, r := range line {
			out[i] += r.Text
		}
	}
	return out
}

func TestWrapSpans(t *testing.T) {
	cases := []struct {
		name     string
		spans    []Span
		maxWidth float64
		want     []string
	}{
		{"單段塞得下", []Span{{Text: "一二三"}}, 100, []string{"一二三"}},
		{"CJK 逐字換行", []Span{{Text: "一二三四五"}}, 30, []string{"一二三", "四五"}},
		{"樣式不影響斷行位置（同寬）", []Span{{Text: "一二"}, {Text: "三四五", Italic: true}}, 30, []string{"一二三", "四五"}},
		{"粗體較寬影響斷行", []Span{{Text: "一二", Bold: true}, {Text: "三四五", Bold: true}}, 30, []string{"一二", "三四", "五"}},
		{"換行符切段", []Span{{Text: "一二\n三"}}, 100, []string{"一二", "三"}},
		{"跨 span 換行符", []Span{{Text: "一", Bold: true}, {Text: "二\n三"}}, 100, []string{"一二", "三"}},
		{"行尾空白修剪", []Span{{Text: "ab "}, {Text: "cd", Bold: true}}, 45, []string{"ab", "cd"}},
		{"空字串一行", nil, 100, []string{""}},
		{"單 token 超寬硬切", []Span{{Text: "abcdefgh"}}, 35, []string{"abc", "def", "gh"}},
	}
	for _, c := range cases {
		got := lineTexts(WrapSpans(c.spans, c.maxWidth, stubMeasure))
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: lines = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestTruncateRuns(t *testing.T) {
	runs := RunsFromSpans([]Span{{Text: "abcd"}, {Text: "efgh", Bold: true, Color: "#ff0000"}}, stubMeasure)
	// 全部塞得下：原樣
	if got := TruncateRuns(runs, 999, stubMeasure); len(got) != 2 || got[0].Text != "abcd" || got[1].Text != "efgh" {
		t.Errorf("不截斷時應原樣: %#v", got)
	}
	// 截在第二段（粗體 12pt/字、…也照粗體算）：40 + n*12 + 12 <= 80 → n=2
	got := TruncateRuns(runs, 80, stubMeasure)
	if len(got) != 3 || got[1].Text != "ef" || got[2].Text != "…" || !got[2].Bold || got[2].Color != "#ff0000" {
		t.Errorf("截斷結果不符: %#v", got)
	}
	// 截在第一段：10*n + 10 <= 25 → n=1
	got = TruncateRuns(runs, 25, stubMeasure)
	if len(got) != 2 || got[0].Text != "a" || got[1].Text != "…" || got[1].Bold {
		t.Errorf("第一段截斷不符: %#v", got)
	}
}

func TestExpandTableRichCells(t *testing.T) {
	el := &Element{
		Type: "table", ID: "t", ColumnWidths: []float64{100, 100}, RowHeights: []float64{20, 20},
		Repeat: &TableRepeat{Enabled: true, Key: "rows", RowIndex: 1},
		Cells: [][]TableCell{
			{{Kind: "text", Value: "[c=#2563eb]品名[/c]"}, {Kind: "text", Value: "金額"}},
			{{Kind: "text", Value: "{{name}}"}, {Kind: "text", Value: "[b]{{amt|comma}}[/b] 元"}},
		},
	}
	data := map[string]any{"rows": []any{
		map[string]any{"name": "甲", "amt": "1200"},
	}}
	rows := ExpandTable(el, data)
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	// 表頭列：標記格解析、Texts 為純文字
	if rows[0].Rich == nil || rows[0].Rich[0] == nil || rows[0].Rich[0][0].Color != "#2563eb" {
		t.Errorf("表頭 rich 不符: %#v", rows[0].Rich)
	}
	if rows[0].Texts[0] != "品名" || rows[0].Rich[1] != nil || rows[0].Texts[1] != "金額" {
		t.Errorf("表頭 texts 不符: %#v", rows[0].Texts)
	}
	// 明細列：標記內插值吃相對 key＋格式化
	if rows[1].Rich == nil || rows[1].Rich[1] == nil {
		t.Fatalf("明細 rich 缺: %#v", rows[1].Rich)
	}
	if rows[1].Rich[1][0].Text != "1,200" || !rows[1].Rich[1][0].Bold || rows[1].Rich[1][1].Text != " 元" {
		t.Errorf("明細 spans 不符: %#v", rows[1].Rich[1])
	}
	if rows[1].Texts[1] != "1,200 元" || rows[1].Texts[0] != "甲" {
		t.Errorf("明細 texts 不符: %#v", rows[1].Texts)
	}
}

// 斷行後 run 的樣式歸屬要保留（顏色/粗斜跟著字走）。
func TestWrapSpansStyleCarry(t *testing.T) {
	lines := WrapSpans([]Span{
		{Text: "黑一"},
		{Text: "紅二三四", Color: "#ff0000"},
	}, 30, stubMeasure)
	if len(lines) != 2 {
		t.Fatalf("lines = %d, want 2", len(lines))
	}
	if len(lines[0]) != 2 || lines[0][1].Color != "#ff0000" || lines[0][1].Text != "紅" {
		t.Errorf("第一行 runs 不符: %#v", lines[0])
	}
	if len(lines[1]) != 1 || lines[1][0].Color != "#ff0000" || lines[1][0].Text != "二三四" {
		t.Errorf("第二行 runs 不符: %#v", lines[1])
	}
}
