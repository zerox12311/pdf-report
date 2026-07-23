package engine

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestRepeatArrayMissingWarning(t *testing.T) {
	tpl := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[{"type":"table","id":"tb","x":40,"y":40,"width":180,"height":48,
		"columnWidths":[90,90],"rowHeights":[24,24],
		"borderColor":"#000","borderWidth":1,"fontSize":10,"cellPadding":4,
		"repeat":{"enabled":true,"key":"items","rowIndex":1},
		"cells":[[{"kind":"text","value":"h1"},{"kind":"text","value":"h2"}],
		         [{"kind":"placeholder","key":"name","sample":"x"},{"kind":"placeholder","key":"qty","sample":"1"}]]}]}`
	var doc TemplateDoc
	if err := json.Unmarshal([]byte(tpl), &doc); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	_, warnings, err := e.Render(&doc, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, w := range warnings {
		if strings.Contains(w, "items") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected items warning, got %v", warnings)
	}
}

func TestPlaceholderMissingKeyBlankNotSample(t *testing.T) {
	// placeholder 缺 key：不可用設計期 sample 冒充真資料，應留空並警告。
	// 等價性證明：sample 不同的兩份樣板，缺 key 時輸出應 byte 相同（代表 sample 未被使用）。
	mk := func(sample string) TemplateDoc {
		tpl := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
		"elements":[{"type":"placeholder","id":"p","x":10,"y":10,"width":200,"height":20,
			"key":"school.name","sample":"` + sample + `","fontSize":12,"color":"#000000","align":"left","lineHeight":1.2,"bold":false}]}`
		var doc TemplateDoc
		if err := json.Unmarshal([]byte(tpl), &doc); err != nil {
			t.Fatal(err)
		}
		return doc
	}
	e := NewEngine("../../fonts", nil)
	a := mk("快樂學習補習班")
	b := mk("")
	outA, warns, err := e.Render(&a, map[string]any{}) // 缺 school.name
	if err != nil {
		t.Fatal(err)
	}
	outB, _, err := e.Render(&b, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(outA, outB) {
		t.Error("placeholder 缺 key 時仍畫出設計期 sample（應留空）")
	}
	found := false
	for _, w := range warns {
		if strings.Contains(w, "school.name") {
			found = true
		}
	}
	if !found {
		t.Errorf("缺 key 應警告：%v", warns)
	}
	// 反向對照：key 有資料時，sample 不同不影響（都用真值），輸出相同
	full := map[string]any{"school": map[string]any{"name": "真校名"}}
	fA, _, _ := e.Render(&a, full)
	fB, _, _ := e.Render(&b, full)
	if !bytes.Equal(fA, fB) {
		t.Error("key 有資料時輸出應只取決於真值、與 sample 無關")
	}
}

func TestRepeatRowOutOfRangeWarning(t *testing.T) {
	// 重複列 rowIndex=1 但表格只有 1 列（列數被縮減後的越界狀態）：
	// 不可靜默吞掉明細，必須警告並退化成普通表格。
	tpl := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[{"type":"table","id":"tb","x":40,"y":40,"width":180,"height":24,
		"columnWidths":[90,90],"rowHeights":[24],
		"borderColor":"#000","borderWidth":1,"fontSize":10,"cellPadding":4,
		"repeat":{"enabled":true,"key":"items","rowIndex":1},
		"cells":[[{"kind":"text","value":"h1"},{"kind":"text","value":"h2"}]]}]}`
	var doc TemplateDoc
	if err := json.Unmarshal([]byte(tpl), &doc); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	_, warnings, err := e.Render(&doc, map[string]any{"items": []any{
		map[string]any{"name": "A"}, map[string]any{"name": "B"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, w := range warnings {
		if strings.Contains(w, "越界") {
			found = true
		}
	}
	if !found {
		t.Errorf("重複列越界應警告（不可靜默吞明細），got %v", warnings)
	}
}

func TestCellInterpolationAndTruncate(t *testing.T) {
	// 表格 text 儲存格含 {{}} 插值 + 缺 key 警告
	tpl := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[{"type":"table","id":"tb","x":40,"y":40,"width":180,"height":48,
		"columnWidths":[90,90],"rowHeights":[24,24],
		"borderColor":"#000","borderWidth":1,"fontSize":10,"cellPadding":4,
		"cells":[[{"kind":"text","value":"合計 {{total|comma}}"},{"kind":"text","value":"{{missingKey}}"}],
		         [{"kind":"text","value":"x"},{"kind":"text","value":"y"}]]}]}`
	var doc TemplateDoc
	if err := json.Unmarshal([]byte(tpl), &doc); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	_, warnings, err := e.Render(&doc, map[string]any{"total": "12345"})
	if err != nil {
		t.Fatal(err)
	}
	// 缺 key 的插值 token 應觸發警告（strict 才擋得住）
	found := false
	for _, w := range warnings {
		if strings.Contains(w, "missingKey") {
			found = true
		}
	}
	if !found {
		t.Errorf("儲存格插值缺 key 應警告，got %v", warnings)
	}
}

func TestTruncateToWidth(t *testing.T) {
	// 每字元寬 1，maxWidth 3 → 保留能容納 …（也算 1）的前綴
	m := func(s string) float64 { return float64(len([]rune(s))) }
	if got := truncateToWidth("hello", 3, m); got != "he…" {
		t.Errorf("truncate = %q, want he…", got)
	}
	if got := truncateToWidth("hi", 10, m); got != "hi" {
		t.Errorf("未超寬不應裁切: %q", got)
	}
}
