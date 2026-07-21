package engine

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// pdfPageCount 從 PDF bytes 數頁數（/Type /Page 物件數，扣掉 /Type /Pages 目錄）。
func pdfPageCount(pdf []byte) int {
	return bytes.Count(pdf, []byte("/Type /Page")) - bytes.Count(pdf, []byte("/Type /Pages"))
}

func TestSectionsMixedPageSizes(t *testing.T) {
	tpl := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":30},
	"sections":[
	 {"id":"s1","name":"內頁","kind":"flow","page":null,"headerHeight":0,"footerHeight":30,"elements":[
	   {"type":"text","id":"b1","x":40,"y":60,"width":200,"height":20,"content":"A4 內容","fontSize":12,"color":"#000000","align":"left","lineHeight":1.2},
	   {"type":"placeholder","id":"pg","x":40,"y":820,"width":100,"height":14,"key":"$pages","sample":"","fontSize":10,"color":"#000000","align":"left","lineHeight":1.2}]},
	 {"id":"s2","name":"附表","kind":"single","page":{"size":"custom","orientation":"landscape","width":700,"height":500},
	   "headerHeight":0,"footerHeight":0,"elements":[
	   {"type":"text","id":"k1","x":40,"y":60,"width":300,"height":20,"content":"橫式附表 700×500","fontSize":14,"color":"#000000","align":"left","lineHeight":1.2}]}
	]}`
	var doc TemplateDoc
	if err := json.Unmarshal([]byte(tpl), &doc); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	out, warnings, err := e.Render(&doc, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Errorf("unexpected warnings: %v", warnings)
	}
	if got := pdfPageCount(out); got != 2 {
		t.Errorf("兩節應為 2 頁，got %d", got)
	}
	if !bytes.Contains(out, []byte("/MediaBox")) {
		t.Error("PDF 應含 MediaBox")
	}
}

func TestSectionWatermarkOverride(t *testing.T) {
	tpl := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0,
	"watermark":{"enabled":true,"text":"副本","fontSize":60,"color":"#e5e7eb","rotation":45,"repeat":false,"gapX":80,"gapY":80}},
	"sections":[
	 {"id":"s1","name":"跟隨","kind":"single","page":null,"headerHeight":0,"footerHeight":0,
	  "watermarkMode":"inherit","watermark":null,"elements":[]},
	 {"id":"s2","name":"不蓋","kind":"single","page":null,"headerHeight":0,"footerHeight":0,
	  "watermarkMode":"none","watermark":null,"elements":[]},
	 {"id":"s3","name":"自訂","kind":"single","page":null,"headerHeight":0,"footerHeight":0,
	  "watermarkMode":"custom","watermark":{"enabled":true,"text":"機密","fontSize":40,"color":"#fecaca","rotation":0,"repeat":true,"gapX":60,"gapY":60},"elements":[]}
	]}`
	var doc TemplateDoc
	if err := json.Unmarshal([]byte(tpl), &doc); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	out, _, err := e.Render(&doc, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if got := pdfPageCount(out); got != 3 {
		t.Fatalf("應為 3 頁，got %d", got)
	}
	// 對照組：三節都 inherit → 輸出應與覆寫版不同（第 2、3 頁浮水印不一樣）
	doc.Sections[1].WatermarkMode = "inherit"
	doc.Sections[2].WatermarkMode = "inherit"
	out2, _, err := e.Render(&doc, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(out, out2) {
		t.Error("浮水印覆寫（none/custom）應改變輸出")
	}
}

func TestCoverAndBackPageSections(t *testing.T) {
	tpl := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":30},
	"elements":[
		{"type":"text","id":"b1","x":40,"y":60,"width":200,"height":20,"content":"內頁內容","fontSize":12,"color":"#000000","align":"left","lineHeight":1.2},
		{"type":"placeholder","id":"pg","x":40,"y":820,"width":100,"height":14,"key":"$pages","sample":"","fontSize":10,"color":"#000000","align":"left","lineHeight":1.2}],
	"cover":{"enabled":true,"elements":[
		{"type":"text","id":"c1","x":100,"y":300,"width":300,"height":40,"content":"封面標題","fontSize":24,"color":"#000000","align":"center","lineHeight":1.2}]},
	"backPage":{"enabled":true,"elements":[
		{"type":"text","id":"k1","x":100,"y":400,"width":300,"height":20,"content":"封底備註","fontSize":12,"color":"#000000","align":"center","lineHeight":1.2}]}}`
	var doc TemplateDoc
	if err := json.Unmarshal([]byte(tpl), &doc); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)

	out, warnings, err := e.Render(&doc, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Errorf("unexpected warnings: %v", warnings)
	}
	if got := pdfPageCount(out); got != 3 {
		t.Errorf("封面+內頁+封底應為 3 頁，got %d", got)
	}

	// 停用封面/封底 → 1 頁；輸出應與完全沒有 section 欄位的樣板相同
	doc.Cover.Enabled = false
	doc.BackPage.Enabled = false
	out1, _, err := e.Render(&doc, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if got := pdfPageCount(out1); got != 1 {
		t.Errorf("停用後應為 1 頁，got %d", got)
	}
	plain := doc
	plain.Cover, plain.BackPage = nil, nil
	out2, _, err := e.Render(&plain, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out1, out2) {
		t.Error("停用 section 的輸出應與無 section 欄位完全相同")
	}
}

func TestTableSpansAndCellStyle(t *testing.T) {
	base := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[{"type":"table","id":"tb","x":40,"y":40,"width":300,"height":72,
	"columnWidths":[100,100,100],"rowHeights":[24,24,24],
	"borderColor":"#000","borderWidth":1,"fontSize":10,"cellPadding":4,
	"cells":[
	 [{"kind":"text","value":"標題橫跨","align":"center","bold":true,"colSpan":3%s},{"kind":"text","value":""},{"kind":"text","value":""}],
	 [{"kind":"text","value":"直跨","rowSpan":2},{"kind":"text","value":"B"},{"kind":"text","value":"C"}],
	 [{"kind":"text","value":"應被蓋掉"},{"kind":"text","value":"E"},{"kind":"text","value":"F"}]]}]}`
	var withStyle TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, `,"fontSize":16,"color":"#cc0000"`)), &withStyle); err != nil {
		t.Fatal(err)
	}
	var plain TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, ``)), &plain); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	out1, warns, err := e.Render(&withStyle, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(warns) != 0 {
		t.Errorf("warnings: %v", warns)
	}
	out2, _, err := e.Render(&plain, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(out1, out2) {
		t.Error("逐格樣式應改變輸出")
	}
}

func TestTableCellWrap(t *testing.T) {
	// 重複列 bio 欄很長：wrap 開 → 列高延伸、表格變高、下方元素被推移
	longBio := strings.Repeat("很長的說明文字", 12)
	base := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[
	 {"type":"table","id":"tb","x":40,"y":40,"width":300,"height":48,
	  "columnWidths":[100,200],"rowHeights":[24,24],
	  "borderColor":"#000","borderWidth":1,"fontSize":10,"cellPadding":4,
	  "repeat":{"enabled":true,"key":"items","rowIndex":1},
	  "cells":[
	   [{"kind":"text","value":"name","bold":true},{"kind":"text","value":"bio","bold":true}],
	   [{"kind":"placeholder","key":"name","sample":"n"},{"kind":"placeholder","key":"bio","sample":"b"%s}]]},
	 {"type":"text","id":"below","x":40,"y":100,"width":200,"height":20,
	  "content":"表尾","fontSize":12,"color":"#000000","align":"left","lineHeight":1.2}]}`
	data := map[string]any{"items": []any{
		map[string]any{"name": "A", "bio": longBio},
		map[string]any{"name": "B", "bio": "短"},
	}}
	var wrapped, plain TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, `,"wrap":true`)), &wrapped); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, ``)), &plain); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	out1, warns, err := e.Render(&wrapped, data)
	if err != nil {
		t.Fatal(err)
	}
	if len(warns) != 0 {
		t.Errorf("warnings: %v", warns)
	}
	out2, _, err := e.Render(&plain, data)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(out1, out2) {
		t.Error("自動換行應改變輸出（列高延伸）")
	}
	// 同輸入兩次渲染 byte 相同（決定性）
	out1b, _, err := e.Render(&wrapped, data)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out1, out1b) {
		t.Error("換行渲染應具決定性")
	}
	// 大量長資料 → 列高延伸推動分頁（頁數多於不換行版本）
	many := []any{}
	for i := 0; i < 40; i++ {
		many = append(many, map[string]any{"name": fmt.Sprintf("N%d", i), "bio": longBio})
	}
	bigData := map[string]any{"items": many}
	outWrap, _, err := e.Render(&wrapped, bigData)
	if err != nil {
		t.Fatal(err)
	}
	outPlain, _, err := e.Render(&plain, bigData)
	if err != nil {
		t.Fatal(err)
	}
	if pdfPageCount(outWrap) <= pdfPageCount(outPlain) {
		t.Errorf("換行版頁數應多於裁切版：wrap=%d plain=%d", pdfPageCount(outWrap), pdfPageCount(outPlain))
	}
}

func TestTableCellBorders(t *testing.T) {
	base := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[{"type":"table","id":"tb","x":40,"y":40,"width":200,"height":48,
	"columnWidths":[100,100],"rowHeights":[24,24],
	"borderColor":"#000","borderWidth":1,"fontSize":10,"cellPadding":4,
	"cells":[
	 [{"kind":"text","value":"A"%s},{"kind":"text","value":"B"}],
	 [{"kind":"text","value":"C"},{"kind":"text","value":"D"}]]}]}`
	var partial TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, `,"borders":{"top":true,"right":false,"bottom":false,"left":true}`)), &partial); err != nil {
		t.Fatal(err)
	}
	var plain TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, ``)), &plain); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	out1, warns, err := e.Render(&partial, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(warns) != 0 {
		t.Errorf("warnings: %v", warns)
	}
	out2, _, err := e.Render(&plain, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(out1, out2) {
		t.Error("逐格框線應改變輸出")
	}
	// 斜線與垂直對齊也應改變輸出
	var diag, valigned TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, `,"borders":{"top":true,"right":true,"bottom":true,"left":true,"diagDown":true,"diagUp":true}`)), &diag); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, `,"vAlign":"top"`)), &valigned); err != nil {
		t.Fatal(err)
	}
	out3, _, err := e.Render(&diag, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(out3, out2) {
		t.Error("斜線框線應改變輸出")
	}
	out4, _, err := e.Render(&valigned, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(out4, out2) {
		t.Error("垂直對齊應改變輸出")
	}
}

func TestTableCellFillColor(t *testing.T) {
	base := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[{"type":"table","id":"tb","x":40,"y":40,"width":300,"height":48,
	"columnWidths":[100,100,100],"rowHeights":[24,24],
	"borderColor":"#000","borderWidth":1,"fontSize":10,"cellPadding":4,
	"cells":[
	 [{"kind":"text","value":"品名","align":"center","bold":true%s},{"kind":"text","value":"數量","align":"center","bold":true%s},{"kind":"text","value":"金額","align":"center","bold":true%s}],
	 [{"kind":"text","value":"A"},{"kind":"text","value":"1"},{"kind":"text","value":"100"}]]}]}`
	fill := `,"fillColor":"#e0f2fe"`
	var withFill TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, fill, fill, fill)), &withFill); err != nil {
		t.Fatal(err)
	}
	var plain TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, ``, ``, ``)), &plain); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	out1, warns, err := e.Render(&withFill, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(warns) != 0 {
		t.Errorf("warnings: %v", warns)
	}
	out2, _, err := e.Render(&plain, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(out1, out2) {
		t.Error("儲存格背景色應改變輸出")
	}
}

func TestAboveWatermarkElements(t *testing.T) {
	base := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0,
	"watermark":{"enabled":true,"text":"作廢","fontSize":120,"color":"#f87171","rotation":30,"repeat":false,"gapX":80,"gapY":80,"layer":"above"}},
	"elements":[
	 {"type":"text","id":"a","x":60,"y":400,"width":460,"height":24,"content":"會被蓋住的內容","fontSize":16,"color":"#000000","align":"left","lineHeight":1.2},
	 {"type":"text","id":"b","x":60,"y":440,"width":460,"height":24,"content":"置頂內容","fontSize":16,"color":"#000000","align":"left","lineHeight":1.2%s}]}`
	var flagged, plain TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, `,"aboveWatermark":true`)), &flagged); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, ``)), &plain); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	out1, warns, err := e.Render(&flagged, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(warns) != 0 {
		t.Errorf("warnings: %v", warns)
	}
	out2, _, err := e.Render(&plain, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(out1, out2) {
		t.Error("aboveWatermark 應改變繪製順序（輸出不同）")
	}
}

func TestTextInterpolation(t *testing.T) {
	tpl := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":30},
	"elements":[
	 {"type":"text","id":"a","x":40,"y":60,"width":400,"height":20,
	  "content":"客戶：{{customer.name}}，合計 {{total|comma}} 元（{{total|twUpper}}）",
	  "fontSize":12,"color":"#000000","align":"left","lineHeight":1.2},
	 {"type":"text","id":"pg","x":40,"y":820,"width":200,"height":14,
	  "content":"第 {{$page}} / {{$pages}} 頁",
	  "fontSize":10,"color":"#000000","align":"left","lineHeight":1.2}]}`
	var doc TemplateDoc
	if err := json.Unmarshal([]byte(tpl), &doc); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	out, warns, err := e.Render(&doc, map[string]any{"customer": map[string]any{"name": "王小明"}, "total": "12345"})
	if err != nil {
		t.Fatal(err)
	}
	if len(warns) != 0 {
		t.Errorf("warnings: %v", warns)
	}
	if len(out) == 0 {
		t.Fatal("empty pdf")
	}
	// 缺 key → 警告
	_, warns2, err := e.Render(&doc, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, w := range warns2 {
		if strings.Contains(w, "customer.name") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected missing-key warning, got %v", warns2)
	}
}
