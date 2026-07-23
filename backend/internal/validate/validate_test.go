package validate

import (
	"bytes"
	"encoding/json"
	"testing"

	"pdftemplate/internal/engine"
)

// decode 用 json.Number 解出 data（與 handler 一致），確保數字型別判定測到 json.Number 分支。
func decode(t *testing.T, s string) any {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader([]byte(s)))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return v
}

func spec(enabled bool, fields ...engine.ValidationField) *engine.ValidationSpec {
	return &engine.ValidationSpec{Enabled: enabled, Fields: fields}
}
func f(path string, req bool, typ string) engine.ValidationField {
	return engine.ValidationField{Path: path, Required: req, Type: typ}
}

func TestDisabledOrNilPasses(t *testing.T) {
	data := decode(t, `{}`)
	if errs := Validate(data, nil); errs != nil {
		t.Errorf("nil spec 應通過，得 %v", errs)
	}
	if errs := Validate(data, spec(false, f("x", true, "string"))); errs != nil {
		t.Errorf("未啟用應通過，得 %v", errs)
	}
}

func TestRequiredEmptySemantics(t *testing.T) {
	cases := []struct {
		name string
		data string
		typ  string
		fail bool // required 是否該報缺
	}{
		{"字串非空通過", `{"v":"a"}`, "string", false},
		{"字串空白算缺", `{"v":"  "}`, "string", true},
		{"字串空字串算缺", `{"v":""}`, "string", true},
		{"數字0通過", `{"v":0}`, "number", false},
		{"布林false通過", `{"v":false}`, "boolean", false},
		{"陣列空算缺", `{"v":[]}`, "array", true},
		{"陣列非空通過", `{"v":[1]}`, "array", false},
		{"物件存在通過", `{"v":{}}`, "object", false},
		{"key不存在算缺", `{}`, "string", true},
		{"值為null算缺", `{"v":null}`, "string", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs := Validate(decode(t, tc.data), spec(true, f("v", true, tc.typ)))
			got := false
			for _, e := range errs {
				if e.Rule == "required" {
					got = true
				}
			}
			if got != tc.fail {
				t.Errorf("required 報缺=%v，預期=%v（errs=%v）", got, tc.fail, errs)
			}
		})
	}
}

func TestTypeMismatch(t *testing.T) {
	cases := []struct {
		name string
		data string
		typ  string
		fail bool
	}{
		{"數字給成字串判不過", `{"v":"48000"}`, "number", true},
		{"純數字通過", `{"v":48000}`, "number", false},
		{"字串是字串通過", `{"v":"hi"}`, "string", false},
		{"數字非字串判不過", `{"v":5}`, "string", true},
		{"陣列型別通過", `{"v":[1,2]}`, "array", false},
		{"物件型別通過", `{"v":{"a":1}}`, "object", false},
		{"布林型別通過", `{"v":true}`, "boolean", false},
		{"any不驗型別", `{"v":"whatever"}`, "any", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// required=false，只驗型別；值存在才會驗
			errs := Validate(decode(t, tc.data), spec(true, f("v", false, tc.typ)))
			got := false
			for _, e := range errs {
				if e.Rule == "type" {
					got = true
				}
			}
			if got != tc.fail {
				t.Errorf("type 報錯=%v，預期=%v（errs=%v）", got, tc.fail, errs)
			}
		})
	}
}

func TestOptionalMissingSkipsType(t *testing.T) {
	// 選填欄位未給 → 不報缺也不驗型別
	errs := Validate(decode(t, `{}`), spec(true, f("v", false, "number")))
	if len(errs) != 0 {
		t.Errorf("選填未給應零錯誤，得 %v", errs)
	}
}

func TestNestedPath(t *testing.T) {
	data := decode(t, `{"school":{"name":"快樂學習"}}`)
	if errs := Validate(data, spec(true, f("school.name", true, "string"))); len(errs) != 0 {
		t.Errorf("巢狀存在應通過，得 %v", errs)
	}
	// 中途物件缺 → 報缺
	errs := Validate(decode(t, `{}`), spec(true, f("school.name", true, "string")))
	if len(errs) != 1 || errs[0].Rule != "required" || errs[0].Path != "school.name" {
		t.Errorf("巢狀缺應報 school.name required，得 %v", errs)
	}
	// 中途不是物件（school 是字串）→ 報缺
	errs = Validate(decode(t, `{"school":"x"}`), spec(true, f("school.name", true, "string")))
	if len(errs) != 1 || errs[0].Rule != "required" {
		t.Errorf("中途非物件應報缺，得 %v", errs)
	}
}

func TestArrayIterate(t *testing.T) {
	data := decode(t, `{"items":[{"amount":100},{"amount":"x"},{}]}`)
	// items[].amount 必填+數字：第0筆過、第1筆型別錯、第2筆缺
	errs := Validate(data, spec(true, f("items[].amount", true, "number")))
	if len(errs) != 2 {
		t.Fatalf("預期 2 筆錯誤，得 %d：%v", len(errs), errs)
	}
	// 帶索引路徑
	byPath := map[string]string{}
	for _, e := range errs {
		byPath[e.Path] = e.Rule
	}
	if byPath["items[1].amount"] != "type" {
		t.Errorf("items[1].amount 應為 type，得 %v", byPath)
	}
	if byPath["items[2].amount"] != "required" {
		t.Errorf("items[2].amount 應為 required，得 %v", byPath)
	}
}

func TestEmptyArrayVacuousButArrayFieldFails(t *testing.T) {
	// items 空陣列：items[].amount 視為通過（無元素），items 自己那條報缺
	data := decode(t, `{"items":[]}`)
	errs := Validate(data, spec(true,
		f("items", true, "array"),
		f("items[].amount", true, "number"),
	))
	if len(errs) != 1 || errs[0].Path != "items" || errs[0].Rule != "required" {
		t.Errorf("空陣列應只有 items required，得 %v", errs)
	}
}

func TestMissingArrayVacuous(t *testing.T) {
	// items 完全缺：items[].amount 通過（交給 items 那條）
	data := decode(t, `{}`)
	errs := Validate(data, spec(true, f("items[].amount", true, "number")))
	if len(errs) != 0 {
		t.Errorf("items 缺時 items[].amount 應通過，得 %v", errs)
	}
}

func TestNilDataAllRequiredMissing(t *testing.T) {
	// 空 body（data=nil）→ 所有必填報缺，不 panic
	errs := Validate(nil, spec(true,
		f("a", true, "string"),
		f("b.c", true, "number"),
	))
	if len(errs) != 2 {
		t.Errorf("空 data 應 2 筆缺，得 %v", errs)
	}
}

func TestBlankPathIgnored(t *testing.T) {
	errs := Validate(decode(t, `{}`), spec(true, f("  ", true, "string")))
	if len(errs) != 0 {
		t.Errorf("空 path 規則應略過，得 %v", errs)
	}
}

func TestTypeMessages(t *testing.T) {
	// 每種型別不符時的訊息（涵蓋 typeLabel 各分支）
	cases := map[string]string{
		"string":  "字串",
		"number":  "數字",
		"boolean": "布林",
		"array":   "陣列",
		"object":  "物件",
	}
	// 給一個一定不符各型別的值：物件型別用字串觸發，其餘用物件觸發
	for typ, label := range cases {
		bad := `{"v":{"a":1}}` // 物件
		if typ == "object" {
			bad = `{"v":"x"}` // 字串（讓 object 型別判不過）
		}
		errs := Validate(decode(t, bad), spec(true, f("v", false, typ)))
		if len(errs) != 1 || errs[0].Rule != "type" || errs[0].Message != "型別應為"+label {
			t.Errorf("%s 訊息應含「%s」，得 %v", typ, label, errs)
		}
	}
	// 未知型別 label 原樣回傳
	if got := typeLabel("weird"); got != "weird" {
		t.Errorf("未知型別 label 應原樣，得 %q", got)
	}
}

func TestRequiredFailSkipsTypeCheck(t *testing.T) {
	// 缺值時只報 required 一筆，不再疊一筆 type
	errs := Validate(decode(t, `{}`), spec(true, f("v", true, "number")))
	if len(errs) != 1 || errs[0].Rule != "required" {
		t.Errorf("缺值應只報 required 一筆，得 %v", errs)
	}
}
