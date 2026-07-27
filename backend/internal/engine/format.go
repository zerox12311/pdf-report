package engine

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)


// 欄位值格式化（插值 |格式 / 表格儲存格的 format 屬性）：
//   comma      → 千分位（12,345.67，小數原樣）
//   comma(n)   → 四捨五入固定 n 位小數＋千分位（金額慣用 comma(2)）
//   round(n)   → 四捨五入固定 n 位小數；round 不帶參數 = 取整數
//   twUpper    → 新臺幣國字大寫（壹萬貳仟參佰肆拾伍元整）
// 值無法解析為數字、未知格式或壞參數 → 一律原樣返回（渲染不炸）。
// 與前端 format-value.ts 為雙實作，改一邊必改另一邊＋兩邊測試。

func formatValue(s, format string) string {
	name, arg := format, ""
	if i := strings.IndexByte(format, '('); i >= 0 && strings.HasSuffix(format, ")") {
		name, arg = format[:i], strings.TrimSpace(format[i+1:len(format)-1])
	}
	switch name {
	case "comma":
		if arg != "" {
			r, ok := roundFixed(s, arg)
			if !ok {
				return s
			}
			return commaFormat(r)
		}
		return commaFormat(s)
	case "round":
		if arg == "" {
			arg = "0"
		}
		if r, ok := roundFixed(s, arg); ok {
			return r
		}
		return s
	case "twUpper":
		return twUpperAmount(s)
	case "rocDate":
		return rocDate(s, false)
	case "rocDateLong":
		return rocDate(s, true)
	default:
		return s
	}
}

// roundFixed 四捨五入（half away from zero，即口語的「四捨五入」；與 JS 端 sign×round(abs) 一致）
// 到 n 位小數並固定位數輸出。參數不合法（非 0–10 整數）或值非數字 → ok=false。
func roundFixed(s, nArg string) (string, bool) {
	n, err := strconv.Atoi(nArg)
	if err != nil || n < 0 || n > 10 {
		return "", false
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return "", false
	}
	p := math.Pow(10, float64(n))
	r := math.Round(v*p) / p
	if r == 0 {
		r = 0 // 消 -0（兩端輸出一致）
	}
	return strconv.FormatFloat(r, 'f', n, 64), true
}

// parseDate 接受 YYYY-MM-DD / YYYY/MM/DD（可帶時間，忽略）。
func parseDate(s string) (y, m, d int, ok bool) {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, " T"); i > 0 {
		s = s[:i]
	}
	sep := "-"
	if strings.Contains(s, "/") {
		sep = "/"
	}
	parts := strings.Split(s, sep)
	if len(parts) != 3 {
		return 0, 0, 0, false
	}
	nums := make([]int, 3)
	for i, p := range parts {
		n := 0
		for _, ch := range p {
			if ch < '0' || ch > '9' {
				return 0, 0, 0, false
			}
			n = n*10 + int(ch-'0')
		}
		nums[i] = n
	}
	if nums[0] < 1912 || nums[1] < 1 || nums[1] > 12 || nums[2] < 1 || nums[2] > 31 {
		return 0, 0, 0, false
	}
	return nums[0], nums[1], nums[2], true
}

// rocDate 西元日期 → 民國年（114/07/20 或 民國114年7月20日）。
func rocDate(s string, long bool) string {
	y, m, d, ok := parseDate(s)
	if !ok {
		return s
	}
	roc := y - 1911
	if long {
		return fmt.Sprintf("民國%d年%d月%d日", roc, m, d)
	}
	return fmt.Sprintf("%d/%02d/%02d", roc, m, d)
}

// splitNumber 拆出正負號、整數、小數部分；非數字回 ok=false。
func splitNumber(s string) (neg bool, intPart, decPart string, ok bool) {
	s = strings.TrimSpace(strings.ReplaceAll(s, ",", ""))
	if s == "" {
		return false, "", "", false
	}
	if s[0] == '-' {
		neg = true
		s = s[1:]
	} else if s[0] == '+' {
		s = s[1:]
	}
	intPart, decPart, _ = strings.Cut(s, ".")
	if intPart == "" {
		intPart = "0"
	}
	for _, ch := range intPart + decPart {
		if ch < '0' || ch > '9' {
			return false, "", "", false
		}
	}
	return neg, intPart, decPart, true
}

func commaFormat(s string) string {
	neg, intPart, decPart, ok := splitNumber(s)
	if !ok {
		return s
	}
	var b strings.Builder
	if neg {
		b.WriteByte('-')
	}
	n := len(intPart)
	for i, ch := range intPart {
		if i > 0 && (n-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(ch)
	}
	if decPart != "" {
		b.WriteByte('.')
		b.WriteString(decPart)
	}
	return b.String()
}

var twDigits = []string{"零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖"}
var twSmallUnits = []string{"", "拾", "佰", "仟"}
var twBigUnits = []string{"", "萬", "億", "兆"}

// convert4 轉一組（≤4 位）數字；全零回空字串。
func twConvert4(g string) string {
	out := ""
	zeroPending := false
	n := len(g)
	for i, ch := range g {
		d := int(ch - '0')
		if d == 0 {
			if out != "" {
				zeroPending = true
			}
			continue
		}
		if zeroPending {
			out += "零"
			zeroPending = false
		}
		out += twDigits[d] + twSmallUnits[n-i-1]
	}
	return out
}

// twUpperAmount 數字 → 國字大寫金額（…元整 / …元…角…分）。
func twUpperAmount(s string) string {
	neg, intPart, decPart, ok := splitNumber(s)
	if !ok {
		return s
	}
	intPart = strings.TrimLeft(intPart, "0")

	// 由右往左切成 4 位一組
	var sections []string
	for len(intPart) > 4 {
		sections = append([]string{intPart[len(intPart)-4:]}, sections...)
		intPart = intPart[:len(intPart)-4]
	}
	if intPart != "" {
		sections = append([]string{intPart}, sections...)
	}

	out := ""
	for i, sec := range sections {
		secStr := twConvert4(sec)
		if secStr == "" {
			continue
		}
		if out != "" && sec[0] == '0' {
			out += "零" // 例：100005 → 拾萬零伍
		}
		out += secStr + twBigUnits[len(sections)-1-i]
	}
	if out == "" {
		out = "零"
	}
	out += "元"

	// 小數：角 / 分
	jiao, fen := byte('0'), byte('0')
	if len(decPart) > 0 {
		jiao = decPart[0]
	}
	if len(decPart) > 1 {
		fen = decPart[1]
	}
	if jiao == '0' && fen == '0' {
		out += "整"
	} else {
		if jiao != '0' {
			out += twDigits[jiao-'0'] + "角"
		}
		if fen != '0' {
			out += twDigits[fen-'0'] + "分"
		}
	}
	if neg {
		out = "負" + out
	}
	return out
}
