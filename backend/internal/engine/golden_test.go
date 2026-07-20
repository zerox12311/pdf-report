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
