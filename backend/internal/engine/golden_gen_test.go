package engine

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func mustParseTemplate(t *testing.T, s string) *TemplateDoc {
	t.Helper()
	doc := new(TemplateDoc)
	if err := json.Unmarshal([]byte(s), doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

const engineTestTemplate = `{"name":"t","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},"elements":[{"type":"text","id":"t1","x":10,"y":10,"width":100,"height":20,"content":"hi","fontSize":12,"color":"#000000","align":"left","lineHeight":1.2,"bold":false}]}`

// decodeTestData 與 httpapi.extractData 等價（UseNumber 保留數字字面）。
func decodeTestData(body []byte) any {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var wrapper map[string]any
	if err := dec.Decode(&wrapper); err != nil {
		return nil
	}
	return wrapper["data"]
}

func renderForGolden(t *testing.T, e *Engine, name, templateJSON, dataJSON string) []byte {
	t.Helper()
	doc := mustParseTemplate(t, templateJSON)
	data := decodeTestData([]byte(dataJSON))
	pdf, _, err := e.Render(doc, data)
	if err != nil {
		t.Fatalf("render %s: %v", name, err)
	}
	if strings.Contains(string(pdf), "CreationDate") {
		t.Fatalf("%s: PDF 含時間戳，golden 比對將不穩定", name)
	}
	return pdf
}
