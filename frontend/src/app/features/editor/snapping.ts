import { ContainerElement, PageSettings, TemplateElement } from '../../core/models/template.model';

/** 對齊吸附距離（px） */
export const SNAP_THRESHOLD = 5;

export interface SnapResult {
  /** 需要套用的位移修正（px） */
  delta: number;
  /** 輔助線位置（px） */
  guide: number;
}

/**
 * 對 candidates（拖曳元素的邊/中線位置）找最近的吸附目標。
 * 超出 threshold 回 null。
 */
export function snapAxis(candidates: number[], targets: number[], threshold = SNAP_THRESHOLD): SnapResult | null {
  let best: SnapResult | null = null;
  for (const c of candidates) {
    for (const t of targets) {
      const d = t - c;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, guide: t };
      }
    }
  }
  return best;
}

/**
 * 頂層元素與頁面的對齊目標（visual px）：
 * 每個元素的左/中/右與上/中/下，加上頁面左右邊界與水平中線。
 */
export function alignTargets(
  elements: readonly TemplateElement[],
  page: PageSettings,
  zoom: number,
  toVisualY: (yPt: number) => number,
  excludeId: string,
): { xs: number[]; ys: number[] } {
  const xs: number[] = [0, (page.width * zoom) / 2, page.width * zoom];
  const ys: number[] = [];
  // 頁面邊界輔助線也是吸附目標
  if ((page.marginLeft ?? 0) > 0) xs.push(page.marginLeft! * zoom);
  if ((page.marginRight ?? 0) > 0) xs.push((page.width - page.marginRight!) * zoom);
  if ((page.marginTop ?? 0) > 0) ys.push(toVisualY(page.marginTop!));
  if ((page.marginBottom ?? 0) > 0) ys.push(toVisualY(page.height - page.marginBottom!));
  for (const el of elements) {
    if (el.id === excludeId) continue;
    xs.push(el.x * zoom, (el.x + el.width / 2) * zoom, (el.x + el.width) * zoom);
    const top = toVisualY(el.y);
    ys.push(top, top + (el.height * zoom) / 2, top + el.height * zoom);
  }
  return { xs, ys };
}

/** 其他元素（含容器子元素）的寬/高（px）——縮放時吸附成相同尺寸用。 */
export function sizeTargets(
  elements: readonly TemplateElement[],
  zoom: number,
  excludeId: string,
): { ws: number[]; hs: number[] } {
  const ws: number[] = [];
  const hs: number[] = [];
  const walk = (els: readonly TemplateElement[]) => {
    for (const el of els) {
      if (el.id !== excludeId) {
        ws.push(el.width * zoom);
        hs.push(el.height * zoom);
      }
      if (el.type === 'container') walk(el.children);
    }
  };
  walk(elements);
  return { ws, hs };
}

/** 容器內的對齊目標（容器內 px 座標）：兄弟元素與容器邊界/中線。 */
export function containerTargets(
  parent: ContainerElement,
  zoom: number,
  excludeId: string,
): { xs: number[]; ys: number[] } {
  const xs: number[] = [0, (parent.width * zoom) / 2, parent.width * zoom];
  const ys: number[] = [0, (parent.height * zoom) / 2, parent.height * zoom];
  for (const el of parent.children) {
    if (el.id === excludeId) continue;
    xs.push(el.x * zoom, (el.x + el.width / 2) * zoom, (el.x + el.width) * zoom);
    ys.push(el.y * zoom, (el.y + el.height / 2) * zoom, (el.y + el.height) * zoom);
  }
  return { xs, ys };
}
