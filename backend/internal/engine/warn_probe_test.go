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

func TestUnderlineRenders(t *testing.T) {
	// 底線應實際影響輸出（gopdf 原生渲染）：同樣板開/關底線 → byte 不同。
	mk := func(underline bool) TemplateDoc {
		tpl := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
		"elements":[{"type":"text","id":"t1","x":10,"y":10,"width":200,"height":20,
			"content":"收款單","fontSize":14,"color":"#000000","align":"left","lineHeight":1.2,"bold":false,
			"underline":` + map[bool]string{true: "true", false: "false"}[underline] + `}]}`
		var doc TemplateDoc
		if err := json.Unmarshal([]byte(tpl), &doc); err != nil {
			t.Fatal(err)
		}
		return doc
	}
	e := NewEngine("../../fonts", nil)
	on := mk(true)
	off := mk(false)
	outOn, _, err := e.Render(&on, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	outOff, _, err := e.Render(&off, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(outOn, outOff) {
		t.Error("底線應改變輸出（未渲染底線）")
	}
}

func TestRotationRenders(t *testing.T) {
	// 旋轉應實際影響輸出：同樣板旋轉 0 vs 30 → byte 不同。
	mk := func(rot float64) TemplateDoc {
		tpl := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
		"elements":[{"type":"text","id":"t1","x":100,"y":100,"width":200,"height":24,"rotation":` +
			map[bool]string{true: "30", false: "0"}[rot != 0] +
			`,"content":"收款單","fontSize":14,"color":"#000000","align":"left","lineHeight":1.2,"bold":false}]}`
		var doc TemplateDoc
		if err := json.Unmarshal([]byte(tpl), &doc); err != nil {
			t.Fatal(err)
		}
		return doc
	}
	e := NewEngine("../../fonts", nil)
	rot, _, err := e.Render(mkPtr(mk(30)), map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	noRot, _, err := e.Render(mkPtr(mk(0)), map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(rot, noRot) {
		t.Error("旋轉應改變輸出（未套用旋轉）")
	}
}

func mkPtr(d TemplateDoc) *TemplateDoc { return &d }

func TestRepeatTableRotationRenders(t *testing.T) {
	// 重複列表格走 fragment 路徑（非 drawElement）：旋轉也須套用 → 開/關旋轉 byte 不同。
	mk := func(rot string) *TemplateDoc {
		tpl := `{"name":"rt","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
		"elements":[{"type":"table","id":"tb","x":100,"y":100,"width":180,"height":72,"rotation":` + rot + `,
			"columnWidths":[90,90],"rowHeights":[24,24],"borderColor":"#000","borderWidth":1,"fontSize":10,"cellPadding":4,
			"repeat":{"enabled":true,"key":"items","rowIndex":1},
			"cells":[[{"kind":"text","value":"h1"},{"kind":"text","value":"h2"}],
			         [{"kind":"placeholder","key":"name","sample":"x"},{"kind":"placeholder","key":"qty","sample":"1"}]]}]}`
		var doc TemplateDoc
		if err := json.Unmarshal([]byte(tpl), &doc); err != nil {
			t.Fatal(err)
		}
		return &doc
	}
	e := NewEngine("../../fonts", nil)
	data := map[string]any{"items": []any{map[string]any{"name": "A", "qty": 1}}}
	rot, _, err := e.Render(mk("25"), data)
	if err != nil {
		t.Fatal(err)
	}
	noRot, _, err := e.Render(mk("0"), data)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(rot, noRot) {
		t.Error("重複列表格旋轉應改變輸出（fragment 路徑未套旋轉）")
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

func TestListOverTallBlockWarning(t *testing.T) {
	// 重複區塊單一 block 比整頁還高：不靜默——應警告（內容會被裁切）。
	tpl := `{"name":"t","page":{"width":400,"height":200,"headerHeight":0,"footerHeight":0},
	"elements":[{"type":"list","id":"L","x":20,"y":20,"width":300,"height":300,"key":"rows",
		"children":[{"type":"text","id":"c","x":0,"y":0,"width":200,"height":20,"content":"x","fontSize":12,"color":"#000000","align":"left","lineHeight":1.2,"bold":false}]}]}`
	var doc TemplateDoc
	if err := json.Unmarshal([]byte(tpl), &doc); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	_, warnings, err := e.Render(&doc, map[string]any{"rows": []any{map[string]any{}}})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, w := range warnings {
		if strings.Contains(w, "超過內容區") {
			found = true
		}
	}
	if !found {
		t.Errorf("超高 block 應警告（不可靜默裁切），got %v", warnings)
	}
}

func TestListMissingArrayWarning(t *testing.T) {
	// 重複區塊綁的陣列 key 不存在：不靜默——應警告。
	tpl := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[{"type":"list","id":"L","x":20,"y":20,"width":300,"height":24,"key":"orders",
		"children":[{"type":"placeholder","id":"c","x":0,"y":0,"width":200,"height":18,"key":"name","sample":"?","fontSize":12,"color":"#000000","align":"left","lineHeight":1.2,"bold":false}]}]}`
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
		if strings.Contains(w, "orders") {
			found = true
		}
	}
	if !found {
		t.Errorf("重複區塊缺陣列 key 應警告，got %v", warnings)
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
