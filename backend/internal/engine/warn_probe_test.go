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
