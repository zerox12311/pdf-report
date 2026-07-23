package engine

import (
	"strconv"
	"strings"
)

// 重複區塊 / 列表（JasperReports List 式）的展開（純函式，不依賴 gopdf）。
//
// 一個 list 元素綁一個陣列 Key，Children 描述「一筆」的自由版面（座標相對 list 左上角）。
// 展開時每筆資料蓋一次，攤平成一串「葉原子（listBlock）」——分頁以 block 為單位、只在
// block 之間斷（block 不可分割）。外層那筆「絕對不是」一個整體 keep-together 單位：
// 巢狀 list 的每一筆子資料各自成一個 block，與外層的固定欄位 block 交錯進同一條扁平串流，
// 這樣某筆外層資料的子明細很長、超過一頁時仍能自動接續（不會排不下）。
//
// 巢狀上限兩層（list 內至多再放一個 list）；更深層警告並忽略。

const listMaxDepth = 2

// listChild 展開後的一個子元素：帶自己的資料上下文（key 相對此上下文解析）。
//   - El：已拷貝的元素；X = 頁面絕對 x，Y = 相對所屬 block 頂端。
//   - Data：此子元素的資料上下文（陣列當筆元素；nil = 無資料的範例筆）。
//   - Parent：外層當筆（$parent. 解析用）；頂層 list = root。
type listChild struct {
	El     *Element
	Data   any
	Parent any
}

// listBlock 展開後的一個葉原子：一組子元素 + 高度。分頁以 block 為單位（不可分割）。
type listBlock struct {
	Height   float64
	Children []listChild
}

// listResolveKey 依重複區塊上下文解析 key：
//   - "$parent.欄位" → 外層當筆（Parent）上的相對路徑
//   - "$sum(..)/$count(..)/$avg(..)" → 整份資料（root）的全域彙總
//   - 其餘 → 當筆元素（data）上的相對路徑
//
// 回傳 ok=false 表示找不到（呼叫端決定退回 sample 或空字串並警告）。
func listResolveKey(key string, data, parent, root any) (string, bool) {
	if rest, ok := strings.CutPrefix(key, "$parent."); ok {
		return ResolvePath(parent, rest)
	}
	if v, ok := ResolveAggregate(root, key); ok {
		return v, true
	}
	return ResolvePath(data, key)
}

// listSampleCount 無資料時仍畫幾筆（純錯誤路徑；0/負值 = 1）。
func listSampleCount(el *Element) int {
	if el.SampleCount > 0 {
		return el.SampleCount
	}
	return 1
}

// partitionListChildren 把 list 的 children 分成「巢狀 list 子元素（至多一個）」與「固定欄位」。
// 只認第一個 list 型別子元素為巢狀明細；其餘 list 子元素當固定欄位處理（極少見）。
func partitionListChildren(el *Element) (nested *Element, fixed []*Element) {
	for i := range el.Children {
		ch := &el.Children[i]
		if ch.Type == "list" && nested == nil {
			nested = ch
			continue
		}
		fixed = append(fixed, ch)
	}
	return nested, fixed
}

// ExpandList 把 list 元素展開成扁平的葉原子（block）序列。
//   - ctx：此 list 所在的資料上下文（頂層 = root）。
//   - parent：外層當筆（$parent；頂層 = root）。
//   - root：整份資料（全域彙總 $sum 等）。
//   - depth：目前巢狀深度（頂層 = 1）。
//
// 陣列 key 不存在（nil）→ 警告並以範例畫 listSampleCount 筆（子元素退回靜態/sample）；
// 陣列存在但為空 []　→ 不畫（0 個 block），與表格重複列語意一致。
func ExpandList(el *Element, ctx, parent, root any, depth int, warn WarnFunc) []listBlock {
	nested, fixed := partitionListChildren(el)
	// 固定欄位 block 的高度：無巢狀 = 整筆高度；有巢狀 = 巢狀 list 之前的空間（其 Y）。
	// 取 max(nested.Y, 固定欄位實際延伸)：固定欄位若被放到巢狀 list 下方（設計失誤），
	// 也把 block 撐到容納它們、巢狀明細接在其後，避免與明細重疊（設計畫布與渲染不致悄悄不一致）。
	fixedHeight := el.Height
	if nested != nil {
		fixedHeight = nested.Y
		for _, ch := range fixed {
			if b := ch.Y + ch.Height; b > fixedHeight {
				fixedHeight = b
			}
		}
	}

	raw := ResolveRaw(ctx, el.Key)
	arr, ok := raw.([]any)
	if !ok {
		if warn != nil && el.Key != "" {
			warn("找不到陣列 key：" + el.Key + "（重複區塊以範例畫 " +
				strconv.Itoa(listSampleCount(el)) + " 筆）")
		}
		arr = make([]any, listSampleCount(el)) // 元素皆 nil → 子元素退回 sample/空
	}

	blocks := make([]listBlock, 0, len(arr))
	for idx, item := range arr {
		// 固定欄位原子：children 綁當筆 item，$parent = 外層 parent。
		lc := make([]listChild, 0, len(fixed))
		for _, ch := range fixed {
			cp := *ch
			cp.X = el.X + ch.X // 頁面絕對 x
			cp.Y = ch.Y        // 相對 block 頂端
			lc = append(lc, listChild{El: &cp, Data: item, Parent: parent})
		}
		h := fixedHeight
		if idx > 0 && el.Gap > 0 {
			// 筆間距：以固定原子頂端留白呈現（第一筆不留）。
			for i := range lc {
				lc[i].El.Y += el.Gap
			}
			h += el.Gap
		}
		blocks = append(blocks, listBlock{Height: h, Children: lc})

		// 巢狀明細：每筆子資料各自成 block，接在固定原子之後（同一條扁平串流）。
		if nested == nil {
			continue
		}
		if depth >= listMaxDepth {
			if warn != nil {
				warn("重複區塊巢狀超過 " + strconv.Itoa(listMaxDepth) + " 層，較深層已忽略")
			}
			continue
		}
		sub := *nested
		sub.X = el.X + nested.X // 巢狀 list 的絕對 x 基準
		// 子 list 的陣列相對「當筆 item」；子元素 $parent = item。
		blocks = append(blocks, ExpandList(&sub, item, item, root, depth+1, warn)...)
	}
	return blocks
}

// sumBlockHeights 展開後所有 block 的總高（含筆間距）。
func sumBlockHeights(blocks []listBlock) float64 {
	total := 0.0
	for _, b := range blocks {
		total += b.Height
	}
	return total
}

// isListElement 是否為重複區塊元素。
func isListElement(e *Element) bool {
	return e.Type == "list"
}
