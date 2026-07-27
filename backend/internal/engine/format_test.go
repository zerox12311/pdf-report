package engine

import "testing"

func TestFormats(t *testing.T) {
	cases := map[[2]string]string{
		{"12345", "comma"}:      "12,345",
		{"1234567.5", "comma"}:  "1,234,567.5",
		{"0", "twUpper"}:        "零元整",
		{"12345", "twUpper"}:    "壹萬貳仟參佰肆拾伍元整",
		{"100005", "twUpper"}:   "壹拾萬零伍元整",
		{"100000005", "twUpper"}: "壹億零伍元整",
		{"1234.56", "twUpper"}:  "壹仟貳佰參拾肆元伍角陸分",
		{"1000", "twUpper"}:     "壹仟元整",
		{"20010", "twUpper"}:    "貳萬零壹拾元整",
		{"abc", "twUpper"}:      "abc",
	}
	for in, want := range cases {
		if got := formatValue(in[0], in[1]); got != want {
			t.Errorf("formatValue(%q,%q) = %q, want %q", in[0], in[1], got, want)
		}
	}
}

// 帶參數格式：round(n) 四捨五入固定位數；comma(n) 四捨五入＋千分位。
// 半數進位為「四捨五入」（half away from zero），壞參數/非數字原樣。
func TestParamFormats(t *testing.T) {
	cases := map[[2]string]string{
		{"329.96999999999997", "round(2)"}: "329.97",
		{"99.94999999999999", "round(2)"}:  "99.95",
		{"7.5", "round"}:                   "8",
		{"7.5", "round(0)"}:                "8",
		{"-7.5", "round"}:                  "-8", // half away from zero
		{"105.4", "round(2)"}:              "105.40",
		{"1234567.891", "comma(2)"}:        "1,234,567.89",
		{"1234567.895", "comma(2)"}:        "1,234,567.90",
		{"13037.88", "comma(0)"}:           "13,038",
		{"-0.004", "round(2)"}:             "0.00", // 消 -0
		{"abc", "round(2)"}:                "abc",
		{"5", "round(abc)"}:                "5",
		{"5", "round(-1)"}:                 "5",
		{"5", "round(99)"}:                 "5",
		{"5", "nope(2)"}:                   "5",
	}
	for in, want := range cases {
		if got := formatValue(in[0], in[1]); got != want {
			t.Errorf("formatValue(%q,%q) = %q, want %q", in[0], in[1], got, want)
		}
	}
}

func TestRocDate(t *testing.T) {
	cases := map[string]string{
		"2025-07-20":          "114/07/20",
		"2026/01/05":          "115/01/05",
		"2025-07-20T10:00:00": "114/07/20",
		"not-a-date":          "not-a-date",
	}
	for in, want := range cases {
		if got := formatValue(in, "rocDate"); got != want {
			t.Errorf("rocDate(%q) = %q, want %q", in, got, want)
		}
	}
	if got := formatValue("2025-07-20", "rocDateLong"); got != "民國114年7月20日" {
		t.Errorf("rocDateLong = %q", got)
	}
}

func TestAggregate(t *testing.T) {
	data := map[string]any{
		"items": []any{
			map[string]any{"amount": "100"},
			map[string]any{"amount": "250.5"},
			map[string]any{"amount": "49.5"},
		},
	}
	for key, want := range map[string]string{
		"$sum(items.amount)":   "400",
		"$count(items)":        "3",
		"$avg(items.amount)":   "133.33333333333334",
	} {
		got, ok := ResolveAggregate(data, key)
		if !ok || got != want {
			t.Errorf("ResolveAggregate(%q) = %q (%v), want %q", key, got, ok, want)
		}
	}
}

func TestGroupExpand(t *testing.T) {
	gh, gf := 1, 3
	tbl := &Element{
		Type: "table",
		RowHeights: []float64{20, 20, 20, 20, 20},
		ColumnWidths: []float64{100, 100},
		Repeat: &TableRepeat{Enabled: true, Key: "items", RowIndex: 2,
			GroupBy: "cat", GroupHeaderRow: &gh, GroupFooterRow: &gf},
		Cells: [][]TableCell{
			{{Kind: "text", Value: "表頭"}, {Kind: "text", Value: ""}},
			{{Kind: "placeholder", Key: "cat"}, {Kind: "text", Value: "（群組開始）"}},
			{{Kind: "placeholder", Key: "$row"}, {Kind: "placeholder", Key: "amt"}},
			{{Kind: "text", Value: "小計"}, {Kind: "placeholder", Key: "$gsum(amt)"}},
			{{Kind: "text", Value: "總計"}, {Kind: "placeholder", Key: "$sum(items.amt)"}},
		},
	}
	data := map[string]any{"items": []any{
		map[string]any{"cat": "A", "amt": "10"},
		map[string]any{"cat": "A", "amt": "20"},
		map[string]any{"cat": "B", "amt": "5"},
	}}
	rows := ExpandTable(tbl, data)
	// 期望：表頭, [A群首, 1/10, 2/20, 小計30], [B群首, 3/5, 小計5], 總計35 → 共 9 列
	if len(rows) != 9 {
		t.Fatalf("expected 9 rows, got %d", len(rows))
	}
	checks := map[int][2]string{
		1: {"A", "（群組開始）"},
		2: {"1", "10"},
		4: {"小計", "30"},
		5: {"B", "（群組開始）"},
		6: {"3", "5"},
		7: {"小計", "5"},
		8: {"總計", "35"},
	}
	for idx, want := range checks {
		if rows[idx].Texts[0] != want[0] || rows[idx].Texts[1] != want[1] {
			t.Errorf("row %d = %v, want %v", idx, rows[idx].Texts, want)
		}
	}
	if n := PageHeaderRowCount(tbl); n != 1 {
		t.Errorf("PageHeaderRowCount = %d, want 1", n)
	}
}
