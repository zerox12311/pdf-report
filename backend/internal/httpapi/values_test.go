package httpapi

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"pdftemplate/internal/store"
)

// fillableTemplate 一張含「可填/不可填」文字元素與表格儲存格的樣板。
const fillableTemplate = `{
  "name":"收款單","version":1,
  "page":{"size":"A4","orientation":"portrait","width":595.28,"height":841.89,
    "headerHeight":0,"footerHeight":0,"marginTop":72,"marginRight":72,"marginBottom":72,"marginLeft":72},
  "sections":[{"id":"s1","name":"內頁","kind":"flow","page":null,"headerHeight":0,"footerHeight":0,
    "watermarkMode":"inherit","watermark":null,"elements":[
      {"id":"t_open","type":"text","x":10,"y":10,"width":200,"height":30,"content":"原抬頭","fontSize":16,
       "color":"#000000","align":"left","lineHeight":1.2,"bold":false,"fillable":true},
      {"id":"t_locked","type":"text","x":10,"y":50,"width":200,"height":30,"content":"不可改","fontSize":12,
       "color":"#000000","align":"left","lineHeight":1.2,"bold":false},
      {"id":"box","type":"container","x":0,"y":100,"width":300,"height":100,"children":[
        {"id":"t_nested","type":"text","x":5,"y":5,"width":100,"height":20,"content":"巢狀原值","fontSize":12,
         "color":"#000000","align":"left","lineHeight":1.2,"bold":false,"fillable":true}
      ]},
      {"id":"img","type":"image","x":10,"y":220,"width":80,"height":80,"assetId":"a1","fit":"contain","fillable":true},
      {"id":"tbl","type":"table","x":10,"y":320,"width":300,"height":60,
       "columnWidths":[150,150],"rowHeights":[30,30],"borderColor":"#000000","borderWidth":1,
       "fontSize":10,"cellPadding":4,"cells":[
         [{"kind":"text","value":"表頭","key":"","sample":"","align":"left","bold":true},
          {"kind":"text","value":"可填格","key":"","sample":"","align":"left","bold":false,"fillable":true}],
         [{"kind":"placeholder","value":"","key":"amount","sample":"100","align":"right","bold":false,"fillable":true},
          {"kind":"text","value":"鎖住格","key":"","sample":"","align":"left","bold":false}]
       ]}
    ]}],
  "validation":{"enabled":false,"fields":[]}
}`

func decodeDoc(t *testing.T, s string) map[string]any {
	t.Helper()
	doc, err := store.DecodeDoc([]byte(s))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	return doc
}

func TestApplyValues(t *testing.T) {
	t.Run("可填文字元素：寫入 content", func(t *testing.T) {
		doc := decodeDoc(t, fillableTemplate)
		if err := applyValues(doc, map[string]string{"t_open": "新抬頭"}); err != nil {
			t.Fatalf("apply: %v", err)
		}
		if got := findElementByID(doc, "t_open")["content"]; got != "新抬頭" {
			t.Errorf("content = %v", got)
		}
	})

	t.Run("巢狀 container 內的可填元素也找得到", func(t *testing.T) {
		doc := decodeDoc(t, fillableTemplate)
		if err := applyValues(doc, map[string]string{"t_nested": "巢狀新值"}); err != nil {
			t.Fatalf("apply: %v", err)
		}
		if got := findElementByID(doc, "t_nested")["content"]; got != "巢狀新值" {
			t.Errorf("nested content = %v", got)
		}
	})

	t.Run("可填表格儲存格：寫入 value", func(t *testing.T) {
		doc := decodeDoc(t, fillableTemplate)
		if err := applyValues(doc, map[string]string{"tbl#0,1": "填好了"}); err != nil {
			t.Fatalf("apply: %v", err)
		}
		cells := findElementByID(doc, "tbl")["cells"].([]any)
		cell := cells[0].([]any)[1].(map[string]any)
		if cell["value"] != "填好了" {
			t.Errorf("cell value = %v", cell["value"])
		}
	})

	// ---- 以下皆為「必須擋下」的攻擊面 ----
	blocked := []struct {
		name   string
		values map[string]string
		errIs  error
	}{
		{"未標記 fillable 的文字元素", map[string]string{"t_locked": "駭"}, errValueNotFillable},
		{"未標記 fillable 的儲存格", map[string]string{"tbl#1,1": "駭"}, errValueNotFillable},
		{"標了 fillable 但型別非 text（image）", map[string]string{"img": "駭"}, errValueNotFillable},
		{"標了 fillable 但 cell kind 非 text（placeholder）", map[string]string{"tbl#1,0": "駭"}, errValueNotFillable},
		{"容器本身（無 fillable）", map[string]string{"box": "駭"}, errValueNotFillable},
		{"不存在的元素 id", map[string]string{"nope": "駭"}, errValueTargetNotFound},
		{"儲存格列超界", map[string]string{"tbl#9,0": "駭"}, errValueTargetNotFound},
		{"儲存格欄超界", map[string]string{"tbl#0,9": "駭"}, errValueTargetNotFound},
		{"負數列", map[string]string{"tbl#-1,0": "駭"}, errValueTargetNotFound},
		{"定址格式錯（缺逗號）", map[string]string{"tbl#12": "駭"}, errValueTargetNotFound},
		{"定址格式錯（非數字）", map[string]string{"tbl#a,b": "駭"}, errValueTargetNotFound},
		{"空 elementId", map[string]string{"#0,1": "駭"}, errValueTargetNotFound},
		{"對非表格元素用儲存格定址", map[string]string{"t_open#0,1": "駭"}, errValueNotFillable},
		// 填寫的是字面文字，不是樣板語法：放行會讓填寫者用 {{customer.secret}} 把宿主 render
		// payload 裡「樣板沒綁的欄位」印進 PDF，或用不存在的 key 讓 ?strict=1 的出單永久 422
		{"注入資料綁定語法", map[string]string{"t_open": "{{customer.secret}}"}, errValueHasBinding},
		{"注入彙總函式", map[string]string{"t_open": "總計 {{$sum(items.amt)}}"}, errValueHasBinding},
		{"儲存格注入綁定語法", map[string]string{"tbl#0,1": "{{customer.name}}"}, errValueHasBinding},
		// 不可填欄位 + 綁定語法：應先回「未開放修改」（403 語意），不是綁定錯誤
		{"不可填欄位優先回未開放", map[string]string{"t_locked": "{{a}}"}, errValueNotFillable},
	}
	for _, tc := range blocked {
		t.Run("擋下："+tc.name, func(t *testing.T) {
			doc := decodeDoc(t, fillableTemplate)
			before, _ := json.Marshal(doc)
			err := applyValues(doc, tc.values)
			if err == nil {
				t.Fatal("should be rejected")
			}
			if tc.errIs != nil && !strings.Contains(err.Error(), tc.errIs.Error()) {
				t.Errorf("err = %v, want contains %v", err, tc.errIs)
			}
			after, _ := json.Marshal(doc)
			if string(before) != string(after) {
				t.Error("被拒的請求不可改動 doc")
			}
		})
	}

	t.Run("含 {{ 但不成插值語法的字面文字要放行", func(t *testing.T) {
		for _, literal := range []string{"單價 {{ 每公斤", "備註：{ {x} }", "會計科目 }}"} {
			doc := decodeDoc(t, fillableTemplate)
			if err := applyValues(doc, map[string]string{"t_open": literal}); err != nil {
				t.Errorf("字面文字 %q 不該被擋：%v", literal, err)
			}
		}
	})

	t.Run("提權：無法把 fillable 自己設成 true", func(t *testing.T) {
		doc := decodeDoc(t, fillableTemplate)
		// 即使指定合法的可填元素，也只會寫到 content，不會碰其他欄位
		if err := applyValues(doc, map[string]string{"t_open": "x"}); err != nil {
			t.Fatal(err)
		}
		locked := findElementByID(doc, "t_locked")
		if _, exists := locked["fillable"]; exists {
			t.Error("不該替其他元素加上 fillable")
		}
		// 版面欄位原封不動
		open := findElementByID(doc, "t_open")
		if open["x"].(json.Number).String() != "10" || open["fontSize"].(json.Number).String() != "16" {
			t.Errorf("版面/樣式欄位被改動：x=%v fontSize=%v", open["x"], open["fontSize"])
		}
	})

	t.Run("整批 fail-closed：一項失敗則全部不套用", func(t *testing.T) {
		doc := decodeDoc(t, fillableTemplate)
		err := applyValues(doc, map[string]string{"t_locked": "駭"})
		if err == nil {
			t.Fatal("should fail")
		}
		if findElementByID(doc, "t_open")["content"] != "原抬頭" {
			t.Error("失敗時不應有任何寫入")
		}
	})
}

// TestPatchValuesEndpoint 端點層：fill 模式可改可填欄位、擋下其他；view 模式連 PATCH 都不行。
func TestPatchValuesEndpoint(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")

	var proj store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P"}`, ck).Body.Bytes(), &proj)
	var key struct{ Key string }
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects/"+proj.ID+"/keys", `{"name":"host"}`, ck).Body.Bytes(), &key)

	// 建一張含可填欄位的樣板（用 API key 落在該專案）
	var created struct{ ID string }
	mustUnmarshal(t, doBearer(h, "POST", "/api/templates", fillableTemplate, key.Key).Body.Bytes(), &created)
	if created.ID == "" {
		t.Fatal("no template id")
	}

	mint := func(mode string) string {
		rec := doBearer(h, "POST", "/api/embed-token", `{"templateId":"`+created.ID+`","mode":"`+mode+`"}`, key.Key)
		if rec.Code != 200 {
			t.Fatalf("mint: %d %s", rec.Code, rec.Body.String())
		}
		var tok struct{ Token string }
		mustUnmarshal(t, rec.Body.Bytes(), &tok)
		return tok.Token
	}
	fillTok := mint(modeFill)

	// 可填欄位 → 200，且真的落 DB
	rec := doBearer(h, "PATCH", "/api/templates/"+created.ID+"/values", `{"values":{"t_open":"新抬頭"}}`, fillTok)
	if rec.Code != 200 {
		t.Fatalf("patch fillable: %d %s", rec.Code, rec.Body.String())
	}
	back := doBearer(h, "GET", "/api/templates/"+created.ID, "", fillTok)
	if !strings.Contains(back.Body.String(), "新抬頭") || strings.Contains(back.Body.String(), "原抬頭") {
		t.Errorf("值未落 DB：%s", back.Body.String())
	}

	// 未標記的欄位 → 403
	if rec := doBearer(h, "PATCH", "/api/templates/"+created.ID+"/values", `{"values":{"t_locked":"駭"}}`, fillTok); rec.Code != 403 {
		t.Errorf("patch non-fillable should 403: %d %s", rec.Code, rec.Body.String())
	}
	// 不存在的欄位 → 400
	if rec := doBearer(h, "PATCH", "/api/templates/"+created.ID+"/values", `{"values":{"nope":"x"}}`, fillTok); rec.Code != 400 {
		t.Errorf("patch unknown target should 400: %d", rec.Code)
	}
	// 空 values → 400
	if rec := doBearer(h, "PATCH", "/api/templates/"+created.ID+"/values", `{"values":{}}`, fillTok); rec.Code != 400 {
		t.Errorf("empty values should 400: %d", rec.Code)
	}
	// 壞 JSON → 400
	if rec := doBearer(h, "PATCH", "/api/templates/"+created.ID+"/values", `{oops`, fillTok); rec.Code != 400 {
		t.Errorf("bad json should 400: %d", rec.Code)
	}
	// 樣板不存在 → 404
	if rec := doBearer(h, "PATCH", "/api/templates/ghost/values", `{"values":{"a":"b"}}`, fillTok); rec.Code != 404 {
		t.Errorf("unknown template should 404: %d", rec.Code)
	}

	// view 模式：連 PATCH 都不行（capEditValues 未授予）
	if rec := doBearer(h, "PATCH", "/api/templates/"+created.ID+"/values", `{"values":{"t_open":"x"}}`, mint(modeView)); rec.Code != 403 {
		t.Errorf("view PATCH should 403: %d", rec.Code)
	}

	// 另一張樣板的 token 不能改這張（scope 仍由 authorizeTemplate 守）
	var other struct{ ID string }
	mustUnmarshal(t, doBearer(h, "POST", "/api/templates", fillableTemplate, key.Key).Body.Bytes(), &other)
	otherTok := func() string {
		rec := doBearer(h, "POST", "/api/embed-token", `{"templateId":"`+other.ID+`","mode":"fill"}`, key.Key)
		var tok struct{ Token string }
		mustUnmarshal(t, rec.Body.Bytes(), &tok)
		return tok.Token
	}()
	if rec := doBearer(h, "PATCH", "/api/templates/"+created.ID+"/values", `{"values":{"t_open":"x"}}`, otherTok); rec.Code != 403 {
		t.Errorf("cross-template PATCH should 403: %d", rec.Code)
	}
}

// TestEmbedContext 前端據此畫 UI 的能力查詢。
func TestEmbedContext(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")

	var proj store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P"}`, ck).Body.Bytes(), &proj)
	var key struct{ Key string }
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects/"+proj.ID+"/keys", `{"name":"host"}`, ck).Body.Bytes(), &key)

	rec := doBearer(h, "POST", "/api/embed-token", `{"mode":"fill"}`, key.Key)
	var tok struct{ Token, TemplateId string }
	mustUnmarshal(t, rec.Body.Bytes(), &tok)

	// embed（fill）
	ctx := doBearer(h, "GET", "/api/embed/context", "", tok.Token)
	if ctx.Code != 200 {
		t.Fatalf("context: %d", ctx.Code)
	}
	var got struct {
		Kind, Mode, TemplateID string
		Capabilities           map[string]bool
	}
	mustUnmarshal(t, ctx.Body.Bytes(), &got)
	if got.Kind != "embed" || got.Mode != modeFill {
		t.Errorf("context = %+v", got)
	}
	if got.Capabilities[capEditLayout] || !got.Capabilities[capEditValues] || got.Capabilities[capUpload] {
		t.Errorf("fill caps = %+v", got.Capabilities)
	}

	// 控制台使用者 → 視同 design（完整能力）
	ctx2 := doAuth(h, "GET", "/api/embed/context", "", ck)
	mustUnmarshal(t, ctx2.Body.Bytes(), &got)
	if got.Mode != modeDesign || !got.Capabilities[capEditLayout] {
		t.Errorf("session context = %+v", got)
	}

	// 匿名 → 401
	if rec := doJSON(h, "GET", "/api/embed/context", ""); rec.Code != 401 {
		t.Errorf("anonymous context should 401: %d", rec.Code)
	}
}

// TestPatchValuesConcurrentWithPut 併發回歸：填寫模式的 PATCH 是伺服器端 read-modify-write，
// 若沒有交易＋列鎖，設計者的 PUT 落在讀與寫之間就會被整份覆寫回捲
// （最嚴重的後果是「設計者剛撤銷的 fillable 被還原」＝ 收不回寫入權）。
func TestPatchValuesConcurrentWithPut(t *testing.T) {
	h, _, _, g := newTestServer(t)
	seedUser(t, g, "admin", "secret")
	ck := loginAs(t, h, "admin", "secret")

	var proj store.ProjectSummary
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects", `{"name":"P"}`, ck).Body.Bytes(), &proj)
	var key struct{ Key string }
	mustUnmarshal(t, doAuth(h, "POST", "/api/projects/"+proj.ID+"/keys", `{"name":"host"}`, ck).Body.Bytes(), &key)
	var created struct{ ID string }
	mustUnmarshal(t, doBearer(h, "POST", "/api/templates", fillableTemplate, key.Key).Body.Bytes(), &created)

	rec := doBearer(h, "POST", "/api/embed-token", `{"templateId":"`+created.ID+`","mode":"fill"}`, key.Key)
	var tok struct{ Token string }
	mustUnmarshal(t, rec.Body.Bytes(), &tok)

	// 設計者把 t_locked 的位置改掉（版面變更），同時填寫者狂打 PATCH /values
	moved := strings.Replace(fillableTemplate, `"id":"t_locked","type":"text","x":10,"y":50`,
		`"id":"t_locked","type":"text","x":777,"y":50`, 1)
	if moved == fillableTemplate {
		t.Fatal("fixture 未如預期替換，測試無效")
	}

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			doBearer(h, "PATCH", "/api/templates/"+created.ID+"/values",
				`{"values":{"t_open":"fill-`+strconv.Itoa(n)+`"}}`, tok.Token)
		}(i)
	}
	// 讓幾個 PATCH 先開始，再送設計者的 PUT
	time.Sleep(5 * time.Millisecond)
	if rec := doAuth(h, "PUT", "/api/templates/"+created.ID, moved, ck); rec.Code != 200 {
		t.Fatalf("designer PUT: %d %s", rec.Code, rec.Body.String())
	}
	wg.Wait()

	// 設計者的版面變更必須留存（不可被填寫者的 PATCH 回捲）
	final := doAuth(h, "GET", "/api/templates/"+created.ID, "", ck)
	doc, err := store.DecodeDoc(final.Body.Bytes())
	if err != nil {
		t.Fatalf("decode final: %v", err)
	}
	locked := findElementByID(doc, "t_locked")
	if locked == nil {
		t.Fatal("t_locked 不見了")
	}
	if x, _ := locked["x"].(json.Number); x.String() != "777" {
		t.Errorf("設計者的版面變更被 PATCH /values 回捲（lost update）：x=%v", locked["x"])
	}
}

// TestBindingReMatchesEngine 守衛用的插值 pattern 必須與引擎一致。
// 兩份字面重複（httpapi 不 import engine 的私有 regexp），日後放寬引擎正則時，
// 這個測試會擋下「守衛靜默落後 → 走私出插值語法」。
func TestBindingReMatchesEngine(t *testing.T) {
	// 與 engine.interpolateRe 相同的樣本集：會被引擎插值的都必須被擋，其餘都要放行
	interpolated := []string{
		"{{a}}", "{{ a }}", "{{a.b}}", "{{ total | comma }}", "{{$page}}",
		"{{$sum(items.amt)}}", "前綴 {{x}} 後綴", "{{a}}{{b}}",
	}
	literal := []string{
		"", "沒有語法", "單價 {{ 每公斤", "}} 開頭", "{ {a} }", "{{}", "${a}", "{{a|b|c}}",
	}
	for _, s := range interpolated {
		if !addsBinding("", s) {
			t.Errorf("addsBinding(\"\", %q) = false，引擎會插值 → 必須擋", s)
		}
	}
	for _, s := range literal {
		if addsBinding("", s) {
			t.Errorf("addsBinding(\"\", %q) = true，但引擎不會插值 → 不該擋", s)
		}
	}
}

// TestAddsBindingKeepsExisting 擋的是「新增」綁定，不是「含有」。
// 設計者可以把含 {{customer.name}} 的欄位標成可填；填寫者改前後文時原綁定要能送回來，
// 否則那個欄位永遠存不了，還會因 fail-closed 連累整批（填寫者被完全鎖死）。
func TestAddsBindingKeepsExisting(t *testing.T) {
	cases := []struct {
		name     string
		old, new string
		want     bool
	}{
		{"原樣送回", "收款單 {{customer.name}}", "收款單 {{customer.name}}", false},
		{"只改前後文、保留原綁定", "收款單 {{customer.name}}", "本期收款單 {{customer.name}} 敬啟", false},
		{"空白差異視為同一個綁定", "{{ customer.name }}", "{{customer.name}}", false},
		{"刪掉原有綁定（允許：沒有提權）", "收款單 {{customer.name}}", "收款單", false},
		{"重複既有綁定（沒有讀到新欄位）", "{{a}}", "{{a}} 與 {{a}}", false},
		{"新增另一個綁定", "收款單 {{customer.name}}", "收款單 {{customer.name}} {{customer.secret}}", true},
		{"換成別的綁定", "{{customer.name}}", "{{customer.taxId}}", true},
		{"原本沒有綁定卻加上", "備註：無", "備註：{{items[0].price}}", true},
		{"同 key 但換格式化（會改變輸出）", "{{total}}", "{{total|twUpper}}", true},
		{"從無到有的彙總語法", "小計", "{{$sum(items.amt)}}", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := addsBinding(tc.old, tc.new); got != tc.want {
				t.Errorf("addsBinding(%q, %q) = %v, want %v", tc.old, tc.new, got, tc.want)
			}
		})
	}
}

// TestApplyValuesUnchangedBindingField 重現實測回報的阻斷：
// 樣板裡有一個「含資料綁定且被標成可填」的欄位，填寫者只改另一個欄位。
// 前端會把所有可填欄位的現值一起送出，原本會因為那個沒被碰過的欄位含 {{…}} 而
// 整批 fail-closed —— 填寫者不管改什麼都存不了，且錯誤指向他沒動過的欄位。
func TestApplyValuesUnchangedBindingField(t *testing.T) {
	const tpl = `{"sections":[{"id":"s1","kind":"flow","elements":[
		{"id":"title","type":"text","content":"QA 收款單 {{customer.name}}","fillable":true},
		{"id":"memo","type":"text","content":"備註：無","fillable":true}
	]}]}`

	t.Run("原樣送回含綁定的欄位不擋", func(t *testing.T) {
		doc := decodeDoc(t, tpl)
		err := applyValues(doc, map[string]string{
			"title": "QA 收款單 {{customer.name}}", // 沒動過，原樣送回
			"memo":  "備註：請於三日內繳款",              // 真正改的
		})
		if err != nil {
			t.Fatalf("不該擋: %v", err)
		}
		if got := findElementByID(doc, "memo")["content"]; got != "備註：請於三日內繳款" {
			t.Errorf("memo = %v", got)
		}
		if got := findElementByID(doc, "title")["content"]; got != "QA 收款單 {{customer.name}}" {
			t.Errorf("title 綁定應原樣保留，得到 %v", got)
		}
	})

	t.Run("改前後文但保留原綁定也放行", func(t *testing.T) {
		doc := decodeDoc(t, tpl)
		if err := applyValues(doc, map[string]string{"title": "本期收款單 {{customer.name}} 敬啟"}); err != nil {
			t.Fatalf("不該擋: %v", err)
		}
	})

	t.Run("新增別的綁定仍然擋（提權才是要防的）", func(t *testing.T) {
		doc := decodeDoc(t, tpl)
		err := applyValues(doc, map[string]string{"memo": "備註：{{customer.secret}}"})
		if !errors.Is(err, errValueHasBinding) {
			t.Fatalf("應擋新增綁定，得到 %v", err)
		}
		if got := findElementByID(doc, "memo")["content"]; got != "備註：無" {
			t.Errorf("擋下時不該部分套用，得到 %v", got)
		}
	})
}
