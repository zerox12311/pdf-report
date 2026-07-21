package engine

import (
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
