package httpapi

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// 填寫模式的「值套用」：只改得到被設計者標記 fillable 的欄位。
//
// 設計要點：這裡**不做 diff**（不是「驗證他沒改別的」），而是拿 DB 原件、
// 只覆寫指定欄位的那一個字串 —— 其餘結構原地不動，改不到就是改不到。
// 這樣不需要在 Go 端重現前端的 normalizeTemplate()，也不會多一條前後端同步負擔。

// 值定址（PATCH body 的 key）：
//   - 一般元素：      "<elementId>"
//   - 表格單一儲存格："<elementId>#<row>,<col>"
const cellAddrSep = "#"

var (
	errValueTargetNotFound = errors.New("找不到指定的欄位")
	errValueNotFillable    = errors.New("此欄位未開放在填寫模式修改")
	errValueHasBinding     = errors.New("填寫內容不可含資料綁定語法（{{…}}）")
)

// bindingRe 與引擎的插值語法一致（engine.interpolateRe）：只有真的會被插值的寫法才擋，
// 「單價 {{ 每公斤」這種沒有結尾的字面文字要放行。
var bindingRe = regexp.MustCompile(`\{\{\s*([^}|]+?)\s*(?:\|\s*([A-Za-z]+)\s*)?\}\}`)

// 填寫模式的值是**字面文字**，不是樣板語法。引擎會對 text 的 content 做 {{key}} 插值，
// 若放行，填寫者可寫 {{customer.secret}} 把宿主 render payload 裡「樣板沒綁的欄位」印進 PDF
// （收款單的 payload 常含個資／金流欄位），或用不存在的 key 讓 ?strict=1 的出單流程永久 422。
func hasBindingSyntax(s string) bool { return bindingRe.MatchString(s) }

// applyValues 在樣板 doc（raw JSON 解出的 map）上套用 values。
// 任一項失敗即整批中止（fail-closed，不做部分套用）。
func applyValues(doc map[string]any, values map[string]string) error {
	for addr, v := range values {
		if err := applyOneValue(doc, addr, v); err != nil {
			return fmt.Errorf("%s：%w", addr, err)
		}
	}
	return nil
}

func applyOneValue(doc map[string]any, addr, value string) error {
	elemID, row, col, isCell, err := parseValueAddr(addr)
	if err != nil {
		return err
	}
	el := findElementByID(doc, elemID)
	if el == nil {
		return errValueTargetNotFound
	}
	if isCell {
		return setCellValue(el, row, col, value)
	}
	return setElementValue(el, value)
}

// parseValueAddr 解析定址；"tbl#2,3" → (tbl, 2, 3, true)。
func parseValueAddr(addr string) (elemID string, row, col int, isCell bool, err error) {
	elemID, rest, found := strings.Cut(addr, cellAddrSep)
	if elemID == "" {
		return "", 0, 0, false, errValueTargetNotFound
	}
	if !found {
		return elemID, 0, 0, false, nil
	}
	rs, cs, ok := strings.Cut(rest, ",")
	if !ok {
		return "", 0, 0, false, errValueTargetNotFound
	}
	if row, err = strconv.Atoi(rs); err != nil {
		return "", 0, 0, false, errValueTargetNotFound
	}
	if col, err = strconv.Atoi(cs); err != nil {
		return "", 0, 0, false, errValueTargetNotFound
	}
	if row < 0 || col < 0 {
		return "", 0, 0, false, errValueTargetNotFound
	}
	return elemID, row, col, true, nil
}

// setElementValue 一般元素：目前只開放 text 的 content（fillable 必須為 true）。
// 白名單思維 —— 未列入的型別一律拒絕，日後新增型別不會意外變成可改。
func setElementValue(el map[string]any, value string) error {
	if !isFillable(el) {
		return errValueNotFillable
	}
	if t, _ := el["type"].(string); t != "text" {
		return errValueNotFillable
	}
	if hasBindingSyntax(value) {
		return errValueHasBinding
	}
	el["content"] = value
	return nil
}

// setCellValue 表格儲存格：該格 kind 必須是 text 且 fillable 為 true，只寫 value。
func setCellValue(el map[string]any, row, col int, value string) error {
	if t, _ := el["type"].(string); t != "table" {
		return errValueNotFillable
	}
	rows, ok := el["cells"].([]any)
	if !ok || row >= len(rows) {
		return errValueTargetNotFound
	}
	cols, ok := rows[row].([]any)
	if !ok || col >= len(cols) {
		return errValueTargetNotFound
	}
	cell, ok := cols[col].(map[string]any)
	if !ok {
		return errValueTargetNotFound
	}
	if !isFillable(cell) {
		return errValueNotFillable
	}
	if k, _ := cell["kind"].(string); k != "text" {
		return errValueNotFillable
	}
	if hasBindingSyntax(value) {
		return errValueHasBinding
	}
	cell["value"] = value
	return nil
}

// isFillable 是否被設計者標記為可填。只認布林 true（字串 "true" 等一律不算）。
// 注意：fillable 本身永遠不可經由此路徑修改 —— setElementValue/setCellValue 只寫
// content/value，故填寫者無法把其他欄位標成可填來提權。
func isFillable(m map[string]any) bool {
	b, _ := m["fillable"].(bool)
	return b
}

// findElementByID 在整份 doc 裡找元素（走訪所有節，遞迴 container/list 的 children；
// 也含舊格式頂層 elements）。找不到回 nil。
func findElementByID(doc map[string]any, id string) map[string]any {
	var found map[string]any
	walkElements(doc, func(el map[string]any) bool {
		if v, _ := el["id"].(string); v == id {
			found = el
			return false // 停止走訪
		}
		return true
	})
	return found
}

// walkElements 逐一走訪所有元素；fn 回 false 即提前停止。
func walkElements(doc map[string]any, fn func(el map[string]any) bool) {
	var walkList func(list []any) bool
	walkList = func(list []any) bool {
		for _, item := range list {
			el, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if !fn(el) {
				return false
			}
			if children, ok := el["children"].([]any); ok {
				if !walkList(children) {
					return false
				}
			}
		}
		return true
	}

	if sections, ok := doc["sections"].([]any); ok {
		for _, s := range sections {
			sec, ok := s.(map[string]any)
			if !ok {
				continue
			}
			if els, ok := sec["elements"].([]any); ok {
				if !walkList(els) {
					return
				}
			}
		}
	}
	// 舊格式（尚未被前端 normalize 過的樣板）：頂層 elements
	if els, ok := doc["elements"].([]any); ok {
		walkList(els)
	}
}
