package engine

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

// golden PDF 測試：渲染輸出與基準檔逐 byte 比對，保護引擎重構不改變輸出。
// 更新基準：go test -run TestGoldenPDF -update-golden
var updateGolden = flag.Bool("update-golden", false, "重新產生 golden 基準檔")

// 三份代表性樣板：跨頁+群組小計、autoGrow 容器+條碼+浮水印、band+頁碼+格式化
var goldenCases = []struct {
	name     string
	template string
	data     string
}{
	{
		name: "group-subtotal-multipage",
		template: `{"name":"g","page":{"width":595.28,"height":841.89,"headerHeight":50,"footerHeight":30},
			"elements":[
				{"type":"text","id":"h","x":40,"y":10,"width":300,"height":24,"content":"對帳單","fontSize":16,"fontFamily":"serif","color":"#000000","align":"left","lineHeight":1.2,"bold":true},
				{"type":"placeholder","id":"pg","x":455,"y":818,"width":90,"height":14,"key":"$page","sample":"1","fontSize":9,"color":"#666666","align":"right","lineHeight":1.2,"bold":false},
				{"type":"table","id":"t","x":40,"y":60,"width":420,"height":110,"columnWidths":[50,190,80,100],"rowHeights":[22,22,22,22,22],
					"borderColor":"#000000","borderWidth":0.8,"fontSize":10,"cellPadding":4,
					"repeat":{"enabled":true,"key":"items","rowIndex":2,"groupBy":"cat","groupHeaderRowIndex":1,"groupFooterRowIndex":3},
					"cells":[
						[{"kind":"text","value":"序","align":"center","bold":true},{"kind":"text","value":"品名","align":"center","bold":true},{"kind":"text","value":"數量","align":"center","bold":true},{"kind":"text","value":"金額","align":"center","bold":true}],
						[{"kind":"placeholder","key":"cat","sample":"分類","bold":true},{"kind":"text","value":""},{"kind":"text","value":""},{"kind":"text","value":""}],
						[{"kind":"placeholder","key":"$row","sample":"1","align":"center"},{"kind":"placeholder","key":"name","sample":"x"},{"kind":"placeholder","key":"qty","sample":"1","align":"right"},{"kind":"placeholder","key":"amt","sample":"0","align":"right","format":"comma"}],
						[{"kind":"text","value":""},{"kind":"text","value":"小計","align":"right","bold":true},{"kind":"placeholder","key":"$gcount","sample":"0","align":"right"},{"kind":"placeholder","key":"$gsum(amt)","sample":"0","align":"right","format":"comma","bold":true}],
						[{"kind":"text","value":""},{"kind":"text","value":"總計","align":"right","bold":true},{"kind":"placeholder","key":"$count(items)","sample":"0","align":"right"},{"kind":"placeholder","key":"$sum(items.amt)","sample":"0","align":"right","format":"comma","bold":true}]
					]}]}`,
		data: `{"data":{"items":[
			{"cat":"甲","name":"項目一","qty":"1","amt":"100"},{"cat":"甲","name":"項目二","qty":"2","amt":"200"},
			{"cat":"甲","name":"項目三","qty":"3","amt":"300"},{"cat":"甲","name":"項目四","qty":"4","amt":"400"},
			{"cat":"甲","name":"項目五","qty":"5","amt":"500"},{"cat":"甲","name":"項目六","qty":"6","amt":"600"},
			{"cat":"甲","name":"項目七","qty":"7","amt":"700"},{"cat":"甲","name":"項目八","qty":"8","amt":"800"},
			{"cat":"甲","name":"項目九","qty":"9","amt":"900"},{"cat":"甲","name":"項目十","qty":"10","amt":"1000"},
			{"cat":"甲","name":"項目十一","qty":"11","amt":"1100"},{"cat":"甲","name":"項目十二","qty":"12","amt":"1200"},
			{"cat":"甲","name":"項目十三","qty":"13","amt":"1300"},{"cat":"甲","name":"項目十四","qty":"14","amt":"1400"},
			{"cat":"甲","name":"項目十五","qty":"15","amt":"1500"},{"cat":"甲","name":"項目十六","qty":"16","amt":"1600"},
			{"cat":"甲","name":"項目十七","qty":"17","amt":"1700"},{"cat":"甲","name":"項目十八","qty":"18","amt":"1800"},
			{"cat":"甲","name":"項目十九","qty":"19","amt":"1900"},{"cat":"甲","name":"項目二十","qty":"20","amt":"2000"},
			{"cat":"甲","name":"項目廿一","qty":"21","amt":"2100"},{"cat":"甲","name":"項目廿二","qty":"22","amt":"2200"},
			{"cat":"甲","name":"項目廿三","qty":"23","amt":"2300"},{"cat":"甲","name":"項目廿四","qty":"24","amt":"2400"},
			{"cat":"甲","name":"項目廿五","qty":"25","amt":"2500"},{"cat":"甲","name":"項目廿六","qty":"26","amt":"2600"},
			{"cat":"甲","name":"項目廿七","qty":"27","amt":"2700"},{"cat":"甲","name":"項目廿八","qty":"28","amt":"2800"},
			{"cat":"乙","name":"其他一","qty":"1","amt":"50"},{"cat":"乙","name":"其他二","qty":"2","amt":"60"}
		]}}`,
	},
	{
		name: "container-autogrow-barcode-watermark",
		template: `{"name":"c","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0,
			"watermark":{"enabled":true,"text":"副本","key":"","fontSize":90,"color":"#fecaca","diagonal":true}},
			"elements":[
				{"type":"container","id":"c1","x":40,"y":40,"width":300,"height":100,"title":"繳費資訊","borderWidth":1,"borderColor":"#334155","fillColor":"#f8fafc",
					"children":[
						{"type":"placeholder","id":"n1","x":8,"y":18,"width":280,"height":18,"key":"note","sample":"","fontSize":11,"color":"#000000","align":"left","lineHeight":1.3,"bold":false,"autoGrow":true},
						{"type":"barcode","id":"b1","x":8,"y":44,"width":200,"height":44,"symbology":"code39","key":"bc","sample":"A1","content":"","showText":true}
					]},
				{"type":"text","id":"after","x":40,"y":160,"width":200,"height":16,"content":"容器後方（會被推移）","fontSize":10,"color":"#666666","align":"left","lineHeight":1.2,"bold":false},
				{"type":"barcode","id":"qr","x":400,"y":40,"width":110,"height":110,"symbology":"qr","key":"","sample":"","content":"https://example.com/x","showText":false}
			]}`,
		data: `{"data":{"note":"這是一段長備註，會自動換行並把容器撐高：一、二、三、四、五、六、七、八、九、十。","bc":"PAY2026"}}`,
	},
	{
		name: "formats-and-visibility",
		template: `{"name":"f","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
			"elements":[
				{"type":"placeholder","id":"d","x":40,"y":40,"width":200,"height":18,"key":"day","sample":"","format":"rocDateLong","fontSize":12,"color":"#000000","align":"left","lineHeight":1.2,"bold":false},
				{"type":"placeholder","id":"amt","x":40,"y":70,"width":400,"height":26,"key":"amount","sample":"0","format":"twUpper","fontSize":14,"fontFamily":"serif","color":"#000000","align":"left","lineHeight":1.2,"bold":true,"borderWidth":1,"borderColor":"#94a3b8","fillColor":"#f8fafc","padding":5},
				{"type":"text","id":"paid","x":420,"y":40,"width":100,"height":40,"content":"已收訖","fontSize":20,"color":"#dc2626","align":"center","lineHeight":1.2,"bold":true,"visibleKey":"paid","visibleOp":"truthy","borderWidth":2,"borderColor":"#dc2626","padding":4},
				{"type":"text","id":"unpaid","x":420,"y":40,"width":100,"height":40,"content":"未繳費","fontSize":20,"color":"#64748b","align":"center","lineHeight":1.2,"bold":true,"visibleKey":"paid","visibleOp":"falsy"},
				{"type":"line","id":"l","x":40,"y":120,"width":480,"height":0,"strokeColor":"#000000","strokeWidth":0.8},
				{"type":"rect","id":"r","x":40,"y":140,"width":120,"height":60,"strokeColor":"#0f766e","strokeWidth":1.5,"fillColor":"#ecfdf5"}
			]}`,
		data: `{"data":{"day":"2026-07-20","amount":"98765.5","paid":"true"}}`,
	},
	{
		// 重複區塊（list）兩層巢狀：orders → lines，含 gap、$parent.orderNo 插值、跨頁
		name: "list-nested-multipage",
		template: `{"name":"nl","page":{"width":595.28,"height":841.89,"headerHeight":40,"footerHeight":30},
			"elements":[
				{"type":"text","id":"h","x":40,"y":10,"width":300,"height":20,"content":"訂單明細","fontSize":15,"color":"#000000","align":"left","lineHeight":1.2,"bold":true},
				{"type":"placeholder","id":"pg","x":455,"y":820,"width":90,"height":14,"key":"$page","sample":"1","fontSize":9,"color":"#666666","align":"right","lineHeight":1.2,"bold":false},
				{"type":"list","id":"L","x":40,"y":50,"width":515,"height":28,"key":"orders","gap":6,
					"children":[
						{"type":"placeholder","id":"o1","x":0,"y":4,"width":120,"height":18,"key":"orderNo","sample":"?","fontSize":12,"color":"#000000","align":"left","lineHeight":1.2,"bold":true},
						{"type":"placeholder","id":"o2","x":140,"y":4,"width":200,"height":18,"key":"buyer","sample":"?","fontSize":12,"color":"#333333","align":"left","lineHeight":1.2,"bold":false},
						{"type":"list","id":"LL","x":20,"y":28,"width":495,"height":18,"key":"lines",
							"children":[
								{"type":"placeholder","id":"n","x":0,"y":0,"width":260,"height":16,"key":"name","sample":"?","fontSize":11,"color":"#000000","align":"left","lineHeight":1.2,"bold":false},
								{"type":"placeholder","id":"q","x":300,"y":0,"width":60,"height":16,"key":"qty","sample":"?","fontSize":11,"color":"#000000","align":"right","lineHeight":1.2,"bold":false},
								{"type":"text","id":"pp","x":380,"y":0,"width":130,"height":16,"content":"單號 {{$parent.orderNo}}","fontSize":9,"color":"#999999","align":"left","lineHeight":1.2,"bold":false}
							]}
					]}
			]}`,
		data: `{"data":{"orders":[
			{"orderNo":"A001","buyer":"王小明","lines":[{"name":"螺絲","qty":2},{"name":"螺帽","qty":5},{"name":"墊圈","qty":10},{"name":"扳手","qty":1}]},
			{"orderNo":"A002","buyer":"李大華","lines":[{"name":"油漆","qty":3},{"name":"刷子","qty":2},{"name":"滾筒","qty":1},{"name":"溶劑","qty":4}]},
			{"orderNo":"A003","buyer":"陳美玲","lines":[{"name":"電線","qty":20},{"name":"插座","qty":8},{"name":"開關","qty":6},{"name":"燈具","qty":3}]},
			{"orderNo":"A004","buyer":"林志豪","lines":[{"name":"水管","qty":15},{"name":"彎頭","qty":12},{"name":"閥門","qty":4},{"name":"膠帶","qty":9}]},
			{"orderNo":"A005","buyer":"黃淑芬","lines":[{"name":"磁磚","qty":50},{"name":"水泥","qty":8},{"name":"砂","qty":10},{"name":"填縫劑","qty":5}]},
			{"orderNo":"A006","buyer":"吳建國","lines":[{"name":"門把","qty":4},{"name":"鉸鏈","qty":8},{"name":"門鎖","qty":2},{"name":"螺絲","qty":30},{"name":"螺帽","qty":30},{"name":"墊圈","qty":40},{"name":"合頁","qty":6},{"name":"把手","qty":12},{"name":"滑軌","qty":8},{"name":"角碼","qty":16},{"name":"膨脹螺栓","qty":20},{"name":"矽利康","qty":5},{"name":"補土","qty":3},{"name":"砂紙","qty":25}]},
			{"orderNo":"A007","buyer":"劉雅婷","lines":[{"name":"窗簾","qty":6},{"name":"軌道","qty":3},{"name":"掛勾","qty":24},{"name":"布料","qty":2}]},
			{"orderNo":"A008","buyer":"蔡文昌","lines":[{"name":"燈泡","qty":40},{"name":"燈座","qty":40},{"name":"電池","qty":100},{"name":"延長線","qty":5}]}
		]}}`,
	},
	{
		// 行內標記（[b][i][c=#..]）：插值上色、粗斜混排＋autoGrow 換行、置中對齊
		name: "richtext-inline-styles",
		template: `{"name":"r","page":{"width":595.28,"height":841.89,"headerHeight":0,"footerHeight":0},
			"elements":[
				{"type":"text","id":"t1","x":40,"y":40,"width":320,"height":24,"content":"應繳金額 [c=#dc2626][b]{{amount|comma}}[/b][/c] 元整","fontSize":14,"color":"#000000","align":"left","lineHeight":1.2,"bold":false},
				{"type":"text","id":"t2","x":40,"y":80,"width":200,"height":20,"content":"[i]斜體備註[/i]與[b][i]粗斜疊加[/i]只粗[/b]混排自動換行測試一二三四五六七八九十","fontSize":12,"color":"#334155","align":"left","lineHeight":1.3,"bold":false,"autoGrow":true},
				{"type":"text","id":"t3","x":40,"y":180,"width":320,"height":20,"content":"置中含[c=#2563eb]藍色片段[/c]的一行","fontSize":12,"color":"#000000","align":"center","lineHeight":1.2,"bold":false},
				{"type":"text","id":"t4","x":40,"y":210,"width":320,"height":20,"content":"靠右含[b]粗體片段[/b]的一行","fontSize":12,"color":"#000000","align":"right","lineHeight":1.2,"bold":false,"underline":true},
				{"type":"table","id":"tb","x":40,"y":250,"width":320,"height":66,"columnWidths":[170,150],"rowHeights":[22,22,22],
					"borderColor":"#000000","borderWidth":0.8,"fontSize":11,"cellPadding":4,
					"repeat":{"enabled":true,"key":"rows","rowIndex":1},
					"cells":[
						[{"kind":"text","value":"[c=#2563eb]品名[/c]","align":"center","bold":true},{"kind":"text","value":"金額","align":"center","bold":true}],
						[{"kind":"text","value":"{{name}}（[i]含稅[/i]）"},{"kind":"text","value":"[c=#dc2626][b]{{amt|comma}}[/b][/c] 元","align":"right"}],
						[{"kind":"text","value":"合計 [b]{{$sum(rows.amt)|comma}}[/b] 元，[i]斜體換行測試一二三四五六七八[/i]","wrap":true},{"kind":"text","value":"單行[c=#16a34a]截斷[/c]測試一二三四五六七八九十"}]
					]}
			]}`,
		data: `{"data":{"amount":"12345","rows":[{"name":"檢驗費","amt":"1200"},{"name":"材料費","amt":"3450"}]}}`,
	},
}

func TestGoldenPDF(t *testing.T) {
	e := NewEngine("../../fonts", nil)
	for _, c := range goldenCases {
		t.Run(c.name, func(t *testing.T) {
			got := renderForGolden(t, e, c.name, c.template, c.data)
			path := filepath.Join("testdata", "golden", c.name+".pdf")
			if *updateGolden {
				if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, got, 0o644); err != nil {
					t.Fatal(err)
				}
				t.Logf("updated %s (%d bytes)", path, len(got))
				return
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("讀取基準檔失敗（用 -update-golden 產生）: %v", err)
			}
			if !bytes.Equal(got, want) {
				t.Errorf("%s: 輸出與基準不同（got %d bytes, want %d bytes）；若為刻意變更請跑 -update-golden 並人工檢視 PDF", c.name, len(got), len(want))
			}
		})
	}
}
