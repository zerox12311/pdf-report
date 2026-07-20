package engine

import (
	"bytes"
	"encoding/json"
	"testing"
)

// 渲染兩次應 byte 相同（golden 測試的前提）
func TestRenderDeterminism(t *testing.T) {
	e := NewEngine("../../fonts", nil)
	var doc TemplateDoc
	_ = json.Unmarshal([]byte(engineTestTemplate), &doc)
	a, _, err := e.Render(&doc, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := e.Render(&doc, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Errorf("render not deterministic: %d vs %d bytes", len(a), len(b))
	}
}
