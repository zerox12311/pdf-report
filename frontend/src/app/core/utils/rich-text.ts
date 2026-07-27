/**
 * 行內富文字標記：[b]粗[/b]、[i]斜[/i]、[c=#rrggbb]色[/c]，可巢狀。
 * 只認得上述小寫標記；其他中括號內容一律當一般文字（打字面 [x] 不需跳脫）。
 * 與後端 internal/engine/richtext.go 為雙實作，改一邊必改另一邊＋兩邊測試。
 */

/** 一段樣式一致的文字。color 空字串 = 沿用元素層級顏色。 */
export interface RichSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  color: string;
}

const SIMPLE_TAGS = ['[b]', '[/b]', '[i]', '[/i]', '[/c]'];
const C_TAG_LEN = '[c=#rrggbb]'.length;
const HEX6 = /^[0-9a-fA-F]{6}$/;

/** s 從 i 起是否為有效標記，回傳標記長度（0 = 不是標記）。 */
function matchTag(s: string, i: number): number {
  for (const t of SIMPLE_TAGS) {
    if (s.startsWith(t, i)) return t.length;
  }
  if (s.startsWith('[c=#', i) && s[i + C_TAG_LEN - 1] === ']' && HEX6.test(s.slice(i + 4, i + C_TAG_LEN - 1))) {
    return C_TAG_LEN;
  }
  return 0;
}

/** 是否含任何有效標記（無標記走純文字路徑）。 */
export function hasRichMarkup(s: string): boolean {
  for (let i = s.indexOf('['); i >= 0; i = s.indexOf('[', i + 1)) {
    if (matchTag(s, i) > 0) return true;
  }
  return false;
}

/**
 * 解析成 spans（相鄰同樣式合併）。未閉合標記作用到結尾；多餘閉合無作用。
 * 無標記時回傳單一 span（空字串回傳 []）。
 */
export function parseRichText(s: string): RichSpan[] {
  const spans: RichSpan[] = [];
  let buf = '';
  let boldDepth = 0;
  let italicDepth = 0;
  const colorStack: string[] = [];
  const flush = () => {
    if (!buf) return;
    const sp: RichSpan = {
      text: buf,
      bold: boldDepth > 0,
      italic: italicDepth > 0,
      color: colorStack.length ? colorStack[colorStack.length - 1] : '',
    };
    buf = '';
    const last = spans[spans.length - 1];
    if (last && last.bold === sp.bold && last.italic === sp.italic && last.color === sp.color) {
      last.text += sp.text;
      return;
    }
    spans.push(sp);
  };
  let i = 0;
  while (i < s.length) {
    if (s[i] === '[') {
      const n = matchTag(s, i);
      if (n > 0) {
        const tag = s.slice(i, i + n);
        flush();
        if (tag === '[b]') boldDepth++;
        else if (tag === '[/b]') boldDepth = Math.max(0, boldDepth - 1);
        else if (tag === '[i]') italicDepth++;
        else if (tag === '[/i]') italicDepth = Math.max(0, italicDepth - 1);
        else if (tag === '[/c]') colorStack.pop();
        else colorStack.push(tag.slice(3, -1)); // [c=#rrggbb]
        i += n;
        continue;
      }
    }
    buf += s[i];
    i++;
  }
  flush();
  return spans;
}

/** 移除標記、保留文字。 */
export function stripRichMarkup(s: string): string {
  if (!hasRichMarkup(s)) return s;
  return parseRichText(s).map(sp => sp.text).join('');
}

/** spans → 標記字串（就地編輯的 DOM 序列化用）；每段獨立包最小巢狀。 */
export function serializeRichText(spans: readonly RichSpan[]): string {
  let out = '';
  for (const sp of spans) {
    let t = sp.text;
    if (!t) continue;
    if (sp.italic) t = `[i]${t}[/i]`;
    if (sp.bold) t = `[b]${t}[/b]`;
    if (sp.color) t = `[c=${sp.color}]${t}[/c]`;
    out += t;
  }
  return out;
}
