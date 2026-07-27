import { RichSpan, hasRichMarkup, parseRichText, serializeRichText, stripRichMarkup } from './rich-text';

const span = (text: string, o: Partial<Omit<RichSpan, 'text'>> = {}): RichSpan => ({
  text, bold: false, italic: false, color: '', ...o,
});

describe('rich-text（與 backend/internal/engine/richtext.go 同規則）', () => {
  it('hasRichMarkup 判斷有效標記', () => {
    expect(hasRichMarkup('')).toBeFalse();
    expect(hasRichMarkup('純文字')).toBeFalse();
    expect(hasRichMarkup('金額 [b]100[/b]')).toBeTrue();
    expect(hasRichMarkup('[i]斜[/i]')).toBeTrue();
    expect(hasRichMarkup('[c=#ff0000]紅[/c]')).toBeTrue();
    expect(hasRichMarkup('[c=#FF00aa]大小寫[/c]')).toBeTrue();
    expect(hasRichMarkup('備註 [x] 不是標記')).toBeFalse();
    expect(hasRichMarkup('[c=red] 非 hex')).toBeFalse();
    expect(hasRichMarkup('[c=#ff00] 長度不對')).toBeFalse();
    expect(hasRichMarkup('陣列索引 items[0].qty')).toBeFalse();
  });

  it('stripRichMarkup 移除標記保留文字', () => {
    expect(stripRichMarkup('純文字')).toBe('純文字');
    expect(stripRichMarkup('金額 [b]100[/b] 元')).toBe('金額 100 元');
    expect(stripRichMarkup('[c=#ff0000][b]紅粗[/b][/c]')).toBe('紅粗');
    expect(stripRichMarkup('備註 [x] 保留')).toBe('備註 [x] 保留');
  });

  it('parseRichText 基本樣式與巢狀', () => {
    expect(parseRichText('hello')).toEqual([span('hello')]);
    expect(parseRichText('a[b]b[/b]c')).toEqual([span('a'), span('b', { bold: true }), span('c')]);
    expect(parseRichText('[c=#ff0000]紅[/c]黑')).toEqual([span('紅', { color: '#ff0000' }), span('黑')]);
    expect(parseRichText('[c=#ff0000]紅[c=#00ff00]綠[/c]又紅[/c]')).toEqual([
      span('紅', { color: '#ff0000' }), span('綠', { color: '#00ff00' }), span('又紅', { color: '#ff0000' }),
    ]);
    expect(parseRichText('[b][i]粗斜[/i]只粗[/b]')).toEqual([
      span('粗斜', { bold: true, italic: true }), span('只粗', { bold: true }),
    ]);
  });

  it('parseRichText 邊界：未閉合／多餘閉合／未知標記／合併', () => {
    expect(parseRichText('a[b]bc')).toEqual([span('a'), span('bc', { bold: true })]);
    expect(parseRichText('a[/b]b')).toEqual([span('ab')]);
    expect(parseRichText('a[x]b[/x]')).toEqual([span('a[x]b[/x]')]);
    expect(parseRichText('[b]a[/b][b]b[/b]')).toEqual([span('ab', { bold: true })]);
    expect(parseRichText('[c=#ff0000]{{amount|comma}}[/c]')).toEqual([span('{{amount|comma}}', { color: '#ff0000' })]);
    expect(parseRichText('')).toEqual([]);
  });

  it('serializeRichText 與 parse 互為往返', () => {
    const cases = [
      '純文字',
      'a[b]b[/b]c',
      '[c=#ff0000]紅[/c]黑',
      '[b][i]粗斜[/i][/b]',
      '應繳 [c=#dc2626][b]{{amount|comma}}[/b][/c] 元',
    ];
    for (const c of cases) {
      expect(serializeRichText(parseRichText(c))).toBe(c);
    }
  });

  it('serializeRichText 略過空段', () => {
    expect(serializeRichText([span(''), span('a', { bold: true })])).toBe('[b]a[/b]');
  });
});
