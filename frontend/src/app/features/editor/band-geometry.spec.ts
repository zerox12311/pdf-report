import { PageSettings } from '../../core/models/template.model';
import { STRIP, modelToVisualY, visualToModelY } from './band-geometry';

const page: PageSettings = {
  size: 'A4', orientation: 'portrait', width: 595.28, height: 841.89,
  headerHeight: 100, footerHeight: 50,
};
const z = 1.2;

describe('band-geometry', () => {
  it('三個 band 區段的映射（含標籤列位移）', () => {
    expect(modelToVisualY(0, page, z)).toBe(0);
    expect(modelToVisualY(50, page, z)).toBe(50 * z);                       // 頁首內
    expect(modelToVisualY(100, page, z)).toBe(100 * z + STRIP);             // 內文起點
    expect(modelToVisualY(841.89 - 50, page, z)).toBeCloseTo((841.89 - 50) * z + 2 * STRIP); // 頁尾起點
  });

  it('modelToVisualY 與 visualToModelY 互為反函數（round-trip）', () => {
    for (const y of [0, 30, 99.9, 100, 400, 791.89, 800, 841.89]) {
      const back = visualToModelY(modelToVisualY(y, page, z), page, z);
      expect(back).toBeCloseTo(y, 6);
    }
  });

  it('落在標籤列上時貼齊段落邊界', () => {
    const headerPx = 100 * z;
    expect(visualToModelY(headerPx + STRIP / 2, page, z)).toBe(100);
    expect(visualToModelY(1e9, page, z)).toBe(page.height); // 超出頁面夾住
  });

  it('無 band 時退化為線性縮放', () => {
    const flat: PageSettings = { ...page, headerHeight: 0, footerHeight: 0 };
    expect(modelToVisualY(123, flat, 2)).toBe(246 + STRIP); // 頁首高 0 → 標籤列仍存在於 0 位置
  });
});
