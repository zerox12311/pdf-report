import { PageSettings } from '../../core/models/template.model';

/** band 標籤列高度（px，不隨 zoom 縮放）—— Jasper 風格的灰色分隔列 */
export const STRIP = 22;

/**
 * 設計座標（pt）→ 畫面位置（px）。
 * 畫布把頁面切成頁首/內文/頁尾三段，段之間插入固定高度的 band 標籤列，
 * 因此視覺 y 與設計 y 之間有分段位移。與 visualToModelY 互為反函數。
 */
export function modelToVisualY(yPt: number, page: PageSettings, zoom: number, strip = STRIP): number {
  const headerH = Math.max(0, page.headerHeight);
  const bodyEnd = page.height - Math.max(0, page.footerHeight);
  if (yPt < headerH) return yPt * zoom;
  if (yPt < bodyEnd) return headerH * zoom + strip + (yPt - headerH) * zoom;
  return headerH * zoom + strip + (bodyEnd - headerH) * zoom + strip + (yPt - bodyEnd) * zoom;
}

/** 畫面位置（px）→ 設計座標（pt）；落在標籤列上時貼齊下一段的起點。 */
export function visualToModelY(px: number, page: PageSettings, zoom: number, strip = STRIP): number {
  const headerH = Math.max(0, page.headerHeight);
  const bodyEnd = page.height - Math.max(0, page.footerHeight);
  const headerPx = headerH * zoom;
  const bodyPx = (bodyEnd - headerH) * zoom;
  if (px < headerPx) return Math.max(0, px / zoom);
  if (px < headerPx + strip) return headerH;
  if (px < headerPx + strip + bodyPx) return headerH + (px - headerPx - strip) / zoom;
  if (px < headerPx + strip + bodyPx + strip) return bodyEnd;
  return Math.min(page.height, bodyEnd + (px - headerPx - strip - bodyPx - strip) / zoom);
}
