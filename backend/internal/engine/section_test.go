package engine

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
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

func TestRoundedAndEllipse(t *testing.T) {
	base := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[{"type":"rect","id":"r","x":40,"y":40,"width":200,"height":100,"strokeColor":"#000","strokeWidth":1,"fillColor":null%s}]}`
	e := NewEngine("../../fonts", nil)
	render := func(extra string) []byte {
		var doc TemplateDoc
		if err := json.Unmarshal([]byte(fmt.Sprintf(base, extra)), &doc); err != nil {
			t.Fatal(err)
		}
		out, _, err := e.Render(&doc, map[string]any{})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	plain := render("")
	rounded := render(`,"cornerRadius":16`)
	ellipse := render(`,"shape":"ellipse"`)
	if bytes.Equal(plain, rounded) {
		t.Error("圓角矩形應改變輸出")
	}
	if bytes.Equal(plain, ellipse) {
		t.Error("橢圓應改變輸出")
	}
	if bytes.Equal(rounded, ellipse) {
		t.Error("圓角與橢圓輸出應不同")
	}
	// 決定性
	if !bytes.Equal(ellipse, render(`,"shape":"ellipse"`)) {
		t.Error("橢圓渲染應具決定性")
	}
	// 四角獨立半徑：與統一半徑不同；四角相同的 cornerRadii 等同 cornerRadius
	mixed := render(`,"cornerRadii":{"tl":20,"tr":20,"br":0,"bl":0}`)
	if bytes.Equal(mixed, rounded) {
		t.Error("四角獨立半徑應與統一半徑輸出不同")
	}
	if bytes.Equal(mixed, plain) {
		t.Error("四角獨立半徑應改變輸出")
	}
	sameAsUniform := render(`,"cornerRadii":{"tl":16,"tr":16,"br":16,"bl":16}`)
	if !bytes.Equal(sameAsUniform, rounded) {
		t.Error("四角皆 16 的 cornerRadii 應與 cornerRadius:16 輸出相同")
	}
}

func TestHiddenElement(t *testing.T) {
	base := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[
	 {"type":"text","id":"a","x":40,"y":40,"width":200,"height":20,"content":"顯示","fontSize":12,"color":"#000","align":"left","lineHeight":1.2},
	 {"type":"text","id":"b","x":40,"y":80,"width":200,"height":20,"content":"可能隱藏","fontSize":12,"color":"#000","align":"left","lineHeight":1.2%s}]}`
	e := NewEngine("../../fonts", nil)
	var shown TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, "")), &shown); err != nil {
		t.Fatal(err)
	}
	var hidden TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, `,"hidden":true`)), &hidden); err != nil {
		t.Fatal(err)
	}
	outShown, _, err := e.Render(&shown, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	outHidden, _, err := e.Render(&hidden, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(outShown, outHidden) {
		t.Error("hidden 元素應不輸出（改變 PDF）")
	}
	// Locked 引擎忽略：locked 不影響輸出
	var locked TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, `,"locked":true`)), &locked); err != nil {
		t.Fatal(err)
	}
	outLocked, _, err := e.Render(&locked, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(outShown, outLocked) {
		t.Error("locked 是純編輯器概念，引擎應忽略（輸出不變）")
	}
}

func TestLineDashStyle(t *testing.T) {
	base := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[
	 {"type":"line","id":"ln","x":40,"y":40,"width":400,"height":0,"strokeColor":"#000","strokeWidth":1%s},
	 {"type":"rect","id":"rc","x":40,"y":80,"width":200,"height":60,"strokeColor":"#000","strokeWidth":1,"fillColor":null%s}]}`
	e := NewEngine("../../fonts", nil)
	var solid TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, "", "")), &solid); err != nil {
		t.Fatal(err)
	}
	var dashed TemplateDoc
	if err := json.Unmarshal([]byte(fmt.Sprintf(base, `,"lineStyle":"dashed"`, `,"lineStyle":"dotted"`)), &dashed); err != nil {
		t.Fatal(err)
	}
	outSolid, _, err := e.Render(&solid, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	outDashed, _, err := e.Render(&dashed, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(outSolid, outDashed) {
		t.Error("虛線/點線應改變輸出")
	}
	// 決定性
	outDashed2, _, err := e.Render(&dashed, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(outDashed, outDashed2) {
		t.Error("虛線渲染應具決定性")
	}
}

func TestBarcodeCell(t *testing.T) {
	// 條碼儲存格：靜態值（value）＋重複列 key 綁定（相對 key，每列不同碼）
	doc := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[{"type":"table","id":"tb","x":40,"y":40,"width":300,"height":100,
	  "columnWidths":[100,200],"rowHeights":[50,50],
	  "borderColor":"#000","borderWidth":1,"fontSize":10,"cellPadding":4,
	  "repeat":{"enabled":true,"key":"items","rowIndex":1},
	  "cells":[
	   [{"kind":"text","value":"標頭"},{"kind":"barcode","value":"STATIC01","symbology":"code128","showText":true}],
	   [{"kind":"placeholder","key":"name","sample":"n"},{"kind":"barcode","key":"bc","sample":"S1","symbology":"code39","showText":true}]]}]}`
	var tpl TemplateDoc
	if err := json.Unmarshal([]byte(doc), &tpl); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	data := map[string]any{"items": []any{
		map[string]any{"name": "A", "bc": "09902231104"},
		map[string]any{"name": "B", "bc": "3453011508028"},
	}}
	out, warns, err := e.Render(&tpl, data)
	if err != nil {
		t.Fatal(err)
	}
	if len(warns) != 0 {
		t.Errorf("正常綁定不應有警告：%v", warns)
	}
	// 每列不同碼 → 換一筆資料輸出應不同（證明相對 key 逐列解析）
	data2 := map[string]any{"items": []any{
		map[string]any{"name": "A", "bc": "11111111111"},
		map[string]any{"name": "B", "bc": "3453011508028"},
	}}
	out2, _, err := e.Render(&tpl, data2)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(out, out2) {
		t.Error("重複列條碼應隨資料改變輸出")
	}
	// 缺 key → 警告並退回範例值（不擋渲染）
	_, warns3, err := e.Render(&tpl, map[string]any{"items": []any{map[string]any{"name": "A"}}})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, w := range warns3 {
		if strings.Contains(w, "bc") {
			found = true
		}
	}
	if !found {
		t.Errorf("缺條碼 key 應有警告：%v", warns3)
	}
	// 決定性
	out3, _, err := e.Render(&tpl, data)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, out3) {
		t.Error("條碼儲存格渲染應具決定性")
	}
}

func TestImageURLBinding(t *testing.T) {
	// 假圖床：/img.png 回 2x2 PNG；/nope 回 404；/text 回非圖片內容
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	pngBytes := buf.Bytes()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/img.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(pngBytes)
		case "/text":
			_, _ = w.Write([]byte("not an image at all, plain text"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	doc := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[
	 {"type":"image","id":"logo","x":40,"y":40,"width":120,"height":60,"key":"logoUrl","fit":"contain"},
	 {"type":"table","id":"tb","x":40,"y":120,"width":200,"height":48,
	  "columnWidths":[100,100],"rowHeights":[24,24],
	  "borderColor":"#000","borderWidth":1,"fontSize":10,"cellPadding":4,
	  "repeat":{"enabled":true,"key":"items","rowIndex":1},
	  "cells":[
	   [{"kind":"text","value":"名","bold":true},{"kind":"text","value":"圖","bold":true}],
	   [{"kind":"placeholder","key":"name","sample":"n"},{"kind":"image","key":"photo","value":"","sample":""}]]}]}`
	var tpl TemplateDoc
	if err := json.Unmarshal([]byte(doc), &tpl); err != nil {
		t.Fatal(err)
	}
	e := NewEngine("../../fonts", nil)
	data := map[string]any{
		"logoUrl": srv.URL + "/img.png",
		"items": []any{
			map[string]any{"name": "A", "photo": srv.URL + "/img.png"},
			map[string]any{"name": "B", "photo": srv.URL + "/img.png"},
		},
	}
	out, warns, err := e.Render(&tpl, data)
	if err != nil {
		t.Fatal(err)
	}
	if len(warns) != 0 {
		t.Errorf("正常抓取不應有警告：%v", warns)
	}
	// 沒有圖片資料 → 輸出不同（圖真的被畫進去了）
	outNo, _, err := e.Render(&tpl, map[string]any{
		"items": []any{map[string]any{"name": "A"}, map[string]any{"name": "B"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(out, outNo) {
		t.Error("URL 圖片應改變輸出")
	}
	// 決定性：同輸入兩次 byte 相同
	out2, _, err := e.Render(&tpl, data)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, out2) {
		t.Error("URL 圖片渲染應具決定性")
	}
	// 失敗情境：404 / 非圖片內容 / 非 http scheme → 警告不擋渲染
	for _, bad := range []string{srv.URL + "/nope", srv.URL + "/text", "ftp://x/y.png"} {
		_, warns, err := e.Render(&tpl, map[string]any{
			"logoUrl": bad,
			"items":   []any{map[string]any{"name": "A", "photo": bad}},
		})
		if err != nil {
			t.Fatalf("%s：不應硬錯誤：%v", bad, err)
		}
		if len(warns) == 0 {
			t.Errorf("%s：應發出警告", bad)
		}
	}
	// 固定圖片連結（url 欄位，元素與儲存格）：無 key 也能渲染
	staticDoc := `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
	"elements":[
	 {"type":"image","id":"logo","x":40,"y":40,"width":120,"height":60,"url":"` + srv.URL + `/img.png","fit":"contain"},
	 {"type":"table","id":"tb","x":40,"y":120,"width":200,"height":24,
	  "columnWidths":[100,100],"rowHeights":[24],
	  "borderColor":"#000","borderWidth":1,"fontSize":10,"cellPadding":4,
	  "cells":[[{"kind":"image","value":"","url":"` + srv.URL + `/img.png"},{"kind":"text","value":"x"}]]}]}`
	var staticTpl TemplateDoc
	if err := json.Unmarshal([]byte(staticDoc), &staticTpl); err != nil {
		t.Fatal(err)
	}
	outStatic, warnsStatic, err := e.Render(&staticTpl, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(warnsStatic) != 0 {
		t.Errorf("固定連結不應有警告：%v", warnsStatic)
	}
	staticTpl2 := staticTpl
	staticTpl2.Elements = cloneElements(staticTpl.Elements)
	staticTpl2.Elements[0].URL = ""
	staticTpl2.Elements[1].Cells[0][0].URL = ""
	outNoURL, _, err := e.Render(&staticTpl2, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(outStatic, outNoURL) {
		t.Error("固定圖片連結應改變輸出")
	}

	// 缺 key → 找不到資料警告
	_, warns2, err := e.Render(&tpl, map[string]any{"items": []any{map[string]any{"name": "A"}}})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, w := range warns2 {
		if strings.Contains(w, "logoUrl") || strings.Contains(w, "photo") {
			found = true
		}
	}
	if !found {
		t.Errorf("缺圖片 key 應有警告：%v", warns2)
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
