import { formatValue } from './format-value';

// 案例與 Go 後端 internal/engine/format_test.go 對齊
describe('formatValue（前端鏡像）', () => {
  it('千分位', () => {
    expect(formatValue('12345', 'comma')).toBe('12,345');
    expect(formatValue('1234567.5', 'comma')).toBe('1,234,567.5');
    expect(formatValue('abc', 'comma')).toBe('abc');
  });

  it('國字大寫', () => {
    expect(formatValue('0', 'twUpper')).toBe('零元整');
    expect(formatValue('12345', 'twUpper')).toBe('壹萬貳仟參佰肆拾伍元整');
    expect(formatValue('100005', 'twUpper')).toBe('壹拾萬零伍元整');
    expect(formatValue('100000005', 'twUpper')).toBe('壹億零伍元整');
    expect(formatValue('1234.56', 'twUpper')).toBe('壹仟貳佰參拾肆元伍角陸分');
    expect(formatValue('1000', 'twUpper')).toBe('壹仟元整');
    expect(formatValue('20010', 'twUpper')).toBe('貳萬零壹拾元整');
    expect(formatValue('abc', 'twUpper')).toBe('abc');
  });

  it('民國年', () => {
    expect(formatValue('2025-07-20', 'rocDate')).toBe('114/07/20');
    expect(formatValue('2026/01/05', 'rocDate')).toBe('115/01/05');
    expect(formatValue('2025-07-20T10:00:00', 'rocDate')).toBe('114/07/20');
    expect(formatValue('2025-07-20', 'rocDateLong')).toBe('民國114年7月20日');
    expect(formatValue('not-a-date', 'rocDate')).toBe('not-a-date');
  });

  it('無格式原樣', () => {
    expect(formatValue('x', undefined)).toBe('x');
    expect(formatValue('x', '')).toBe('x');
  });

  it('帶參數格式（與 format_test.go 同組案例）', () => {
    expect(formatValue('329.96999999999997', 'round(2)')).toBe('329.97');
    expect(formatValue('99.94999999999999', 'round(2)')).toBe('99.95');
    expect(formatValue('7.5', 'round')).toBe('8');
    expect(formatValue('-7.5', 'round')).toBe('-8'); // half away from zero
    expect(formatValue('105.4', 'round(2)')).toBe('105.40');
    expect(formatValue('1234567.891', 'comma(2)')).toBe('1,234,567.89');
    expect(formatValue('1234567.895', 'comma(2)')).toBe('1,234,567.90');
    expect(formatValue('13037.88', 'comma(0)')).toBe('13,038');
    expect(formatValue('-0.004', 'round(2)')).toBe('0.00'); // 消 -0
    expect(formatValue('abc', 'round(2)')).toBe('abc');
    expect(formatValue('5', 'round(abc)')).toBe('5');
    expect(formatValue('5', 'round(-1)')).toBe('5');
    expect(formatValue('5', 'nope(2)')).toBe('5');
  });
});
