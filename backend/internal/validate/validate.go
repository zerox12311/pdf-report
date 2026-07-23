// Package validate：輸入資料的 schema 驗證（渲染前守門）。
//
// 這是驗證的唯一權威：正式渲染（renderByID）在渲染前呼叫、編輯器「測試 schema」
// 也透過 POST /api/validate 打到同一個 Validate()，兩邊不得分歧（否則「測試說過、
// 實際 render 卻 422」會變成騙人的按鈕）。前端不重寫驗證邏輯。
//
// 路徑語法（與前端自動推導產生的字串一致）：
//   - school.name        巢狀物件
//   - items              陣列本身（type=array 時檢查是不是陣列、required 時檢查非空）
//   - items[].amount     陣列逐元素：對 items 每個元素檢查 amount（items 缺/空時此規則視為通過，
//     由 items 自己那條規則負責報缺）
package validate

import (
	"encoding/json"
	"fmt"
	"strings"

	"pdftemplate/internal/engine"
)

// Error 一筆驗證失敗。Path 為實際出錯位置（陣列會帶索引，如 items[2].amount）。
type Error struct {
	Path    string `json:"path"`
	Rule    string `json:"rule"` // required | type
	Message string `json:"message"`
}

// Validate 依 spec 驗證 data（宿主 POST 的 data 物件；nil = 空 body，所有必填欄位報缺）。
// spec 為 nil 或未啟用時回傳 nil（通過）。回傳所有違規，空 = 通過。
func Validate(data any, spec *engine.ValidationSpec) []Error {
	if spec == nil || !spec.Enabled {
		return nil
	}
	var errs []Error
	for _, f := range spec.Fields {
		if strings.TrimSpace(f.Path) == "" {
			continue // 空 path 規則忽略（UI 允許暫時空白列）
		}
		errs = append(errs, walk(data, true, splitPath(f.Path), "", f)...)
	}
	return errs
}

// seg 路徑一段：name 欄位名，iterate 代表帶 [] 需逐元素展開。
type seg struct {
	name    string
	iterate bool
}

func splitPath(path string) []seg {
	parts := strings.Split(path, ".")
	segs := make([]seg, 0, len(parts))
	for _, p := range parts {
		it := strings.HasSuffix(p, "[]")
		segs = append(segs, seg{name: strings.TrimSuffix(p, "[]"), iterate: it})
	}
	return segs
}

// walk 逐段下降；遇到 iterate 段就把該陣列每個元素攤開遞迴剩餘路徑。
// present 表示 cur 這個位置的值是否存在（用於 required 判缺，區分「值是 nil」與「key 不存在」）。
func walk(cur any, present bool, segs []seg, disp string, f engine.ValidationField) []Error {
	if len(segs) == 0 {
		return checkLeaf(cur, present, disp, f)
	}
	s, rest := segs[0], segs[1:]

	child, childPresent := any(nil), false
	if present {
		if m, ok := cur.(map[string]any); ok {
			if v, exists := m[s.name]; exists {
				child, childPresent = v, true
			}
		}
	}
	dp := joinPath(disp, s.name)

	if s.iterate {
		arr, ok := child.([]any)
		if !childPresent || !ok {
			return nil // 陣列缺/非陣列 → 此規則通過，交給該陣列自己那條規則報
		}
		var errs []Error
		for i, e := range arr {
			errs = append(errs, walk(e, true, rest, fmt.Sprintf("%s[%d]", dp, i), f)...)
		}
		return errs
	}
	return walk(child, childPresent, rest, dp, f)
}

func checkLeaf(v any, present bool, path string, f engine.ValidationField) []Error {
	if f.Required && isEmpty(v, present) {
		return []Error{{Path: path, Rule: "required", Message: "缺少必填欄位"}}
	}
	if !present || v == nil {
		return nil // 選填且未給 → 不驗型別
	}
	if f.Type != "" && f.Type != "any" && !matchType(v, f.Type) {
		return []Error{{Path: path, Rule: "type", Message: "型別應為" + typeLabel(f.Type)}}
	}
	return nil
}

// isEmpty required 的「非空」語意：字串去空白非空、陣列長度 > 0、物件存在即可、
// 數字/布林存在即可（0 與 false 不算空）。
func isEmpty(v any, present bool) bool {
	if !present || v == nil {
		return true
	}
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t) == ""
	case []any:
		return len(t) == 0
	default:
		return false
	}
}

// matchType data 走 json.Decode + UseNumber，數字為 json.Number。
func matchType(v any, typ string) bool {
	switch typ {
	case "string":
		_, ok := v.(string)
		return ok
	case "number":
		switch v.(type) {
		case json.Number, float64:
			return true
		}
		return false
	case "boolean":
		_, ok := v.(bool)
		return ok
	case "array":
		_, ok := v.([]any)
		return ok
	case "object":
		_, ok := v.(map[string]any)
		return ok
	}
	return true // 未知型別當 any
}

func typeLabel(t string) string {
	switch t {
	case "string":
		return "字串"
	case "number":
		return "數字"
	case "boolean":
		return "布林"
	case "array":
		return "陣列"
	case "object":
		return "物件"
	}
	return t
}

func joinPath(prefix, name string) string {
	if prefix == "" {
		return name
	}
	return prefix + "." + name
}
