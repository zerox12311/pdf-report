package engine

import (
	"strings"
	"testing"
)

// 兩層巢狀資料：orders → lines
const listTwoLevelData = `{"data":{"orders":[
  {"orderNo":"A001","buyer":"王小明","lines":[{"name":"商品X","qty":2},{"name":"商品Y","qty":1}]},
  {"orderNo":"A002","buyer":"李大華","lines":[{"name":"商品Z","qty":5}]}
]}}`

// twoLevelList 建一個兩層 list 元素：外層 orders（orderNo/buyer 固定欄位）＋內層 lines（name/qty/$parent.orderNo）。
func twoLevelList() *Element {
	ph := func(key string, x, y float64) Element {
		return Element{Type: "placeholder", Key: key, Sample: "?", X: x, Y: y, Width: 80, Height: 18}
	}
	nested := Element{
		Type: "list", Key: "lines", X: 10, Y: 30, Width: 280, Height: 20,
		Children: []Element{
			ph("name", 0, 0),
			ph("qty", 200, 0),
			ph("$parent.orderNo", 240, 0), // 內層回外層當筆
		},
	}
	return &Element{
		Type: "list", Key: "orders", X: 40, Y: 100, Width: 300, Height: 60,
		Children: []Element{
			ph("orderNo", 0, 0),
			ph("buyer", 100, 0),
			nested,
		},
	}
}

func TestExpandList_TwoLevelFlattensToLeafAtoms(t *testing.T) {
	data := decodeTestData([]byte(listTwoLevelData))
	blocks := ExpandList(twoLevelList(), data, data, data, 1, nil)

	// order1: 1 固定 + 2 lines = 3；order2: 1 固定 + 1 line = 2 → 共 5
	if len(blocks) != 5 {
		t.Fatalf("block 數 = %d，預期 5", len(blocks))
	}

	// 固定原子高 = 巢狀 list 的 Y（上方空間）= 30；line 原子高 = 巢狀 Height = 20
	wantH := []float64{30, 20, 20, 30, 20}
	for i, h := range wantH {
		if blocks[i].Height != h {
			t.Errorf("block[%d].Height = %v，預期 %v", i, blocks[i].Height, h)
		}
	}

	root := data
	resolve := func(c listChild) string {
		v, _ := listResolveKey(c.El.Key, c.Data, c.Parent, root)
		return v
	}

	// block0 = order1 固定：orderNo=A001、buyer=王小明；絕對 x = 40 / 140
	if got := resolve(blocks[0].Children[0]); got != "A001" {
		t.Errorf("order1 orderNo = %q，預期 A001", got)
	}
	if got := resolve(blocks[0].Children[1]); got != "王小明" {
		t.Errorf("order1 buyer = %q，預期 王小明", got)
	}
	if x := blocks[0].Children[0].El.X; x != 40 {
		t.Errorf("orderNo 絕對 x = %v，預期 40", x)
	}
	if x := blocks[0].Children[1].El.X; x != 140 {
		t.Errorf("buyer 絕對 x = %v，預期 140", x)
	}

	// block1 = order1 line1：name=商品X、qty=2、$parent.orderNo=A001；name 絕對 x = 50
	if got := resolve(blocks[1].Children[0]); got != "商品X" {
		t.Errorf("line1 name = %q，預期 商品X", got)
	}
	if got := resolve(blocks[1].Children[1]); got != "2" {
		t.Errorf("line1 qty = %q，預期 2", got)
	}
	if got := resolve(blocks[1].Children[2]); got != "A001" {
		t.Errorf("line1 $parent.orderNo = %q，預期 A001", got)
	}
	if x := blocks[1].Children[0].El.X; x != 50 {
		t.Errorf("line name 絕對 x = %v，預期 50 (40+10)", x)
	}

	// block3 = order2 固定；block4 = order2 line1
	if got := resolve(blocks[3].Children[0]); got != "A002" {
		t.Errorf("order2 orderNo = %q，預期 A002", got)
	}
	if got := resolve(blocks[4].Children[0]); got != "商品Z" {
		t.Errorf("order2 line1 name = %q，預期 商品Z", got)
	}
	if got := resolve(blocks[4].Children[2]); got != "A002" {
		t.Errorf("order2 line1 $parent.orderNo = %q，預期 A002", got)
	}
}

func TestExpandList_SingleLevel(t *testing.T) {
	el := &Element{
		Type: "list", Key: "items", X: 20, Y: 50, Width: 200, Height: 24,
		Children: []Element{{Type: "placeholder", Key: "name", X: 0, Y: 0, Width: 100, Height: 18}},
	}
	data := decodeTestData([]byte(`{"data":{"items":[{"name":"a"},{"name":"b"},{"name":"c"}]}}`))
	blocks := ExpandList(el, data, data, data, 1, nil)
	if len(blocks) != 3 {
		t.Fatalf("block 數 = %d，預期 3", len(blocks))
	}
	for i, b := range blocks {
		if b.Height != 24 {
			t.Errorf("block[%d] 高 = %v，預期 24（無巢狀 = 整筆高）", i, b.Height)
		}
	}
}

func TestExpandList_MissingKeyWarnsAndDrawsSample(t *testing.T) {
	el := &Element{
		Type: "list", Key: "nope", X: 0, Y: 0, Width: 100, Height: 30, SampleCount: 2,
		Children: []Element{{Type: "placeholder", Key: "name", Sample: "範例", X: 0, Y: 0}},
	}
	data := decodeTestData([]byte(`{"data":{"orders":[]}}`))
	var warns []string
	blocks := ExpandList(el, data, data, data, 1, func(m string) { warns = append(warns, m) })
	if len(blocks) != 2 {
		t.Fatalf("缺 key 應以 sampleCount 畫 2 筆，得 %d", len(blocks))
	}
	if len(warns) != 1 {
		t.Fatalf("缺 key 應發 1 個警告，得 %d：%v", len(warns), warns)
	}
}

func TestExpandList_EmptyArrayDrawsNothing(t *testing.T) {
	el := &Element{
		Type: "list", Key: "orders", X: 0, Y: 0, Width: 100, Height: 30,
		Children: []Element{{Type: "placeholder", Key: "name", X: 0, Y: 0}},
	}
	data := decodeTestData([]byte(`{"data":{"orders":[]}}`))
	var warns []string
	blocks := ExpandList(el, data, data, data, 1, func(m string) { warns = append(warns, m) })
	if len(blocks) != 0 {
		t.Fatalf("空陣列應不畫（0 block），得 %d", len(blocks))
	}
	if len(warns) != 0 {
		t.Fatalf("空陣列不應警告，得 %v", warns)
	}
}

func TestExpandList_DepthCapWarns(t *testing.T) {
	// 三層 list：orders → lines → parts，應在第三層被擋且警告
	deepest := Element{Type: "list", Key: "parts", X: 0, Y: 0, Width: 100, Height: 10,
		Children: []Element{{Type: "placeholder", Key: "p", X: 0, Y: 0}}}
	mid := Element{Type: "list", Key: "lines", X: 0, Y: 10, Width: 100, Height: 20,
		Children: []Element{{Type: "placeholder", Key: "name", X: 0, Y: 0}, deepest}}
	top := &Element{Type: "list", Key: "orders", X: 0, Y: 0, Width: 100, Height: 40,
		Children: []Element{{Type: "placeholder", Key: "orderNo", X: 0, Y: 0}, mid}}

	data := decodeTestData([]byte(`{"data":{"orders":[
      {"orderNo":"A","lines":[{"name":"L1","parts":[{"p":"P1"}]}]}
    ]}}`))
	var warns []string
	blocks := ExpandList(top, data, data, data, 1, func(m string) { warns = append(warns, m) })
	// order 固定 + line 固定（parts 被擋）= 2 block；parts 不展開
	if len(blocks) != 2 {
		t.Fatalf("兩層上限：應得 2 block（parts 被擋），得 %d", len(blocks))
	}
	found := false
	for _, w := range warns {
		if len(w) > 0 && strings.Contains(w, "巢狀超過") {
			found = true
		}
	}
	if !found {
		t.Fatalf("第三層應發巢狀超限警告，得 %v", warns)
	}
}

