import { ContainerElement, TextElement } from '../../core/models/template.model';
import { alignTargets, sizeTargets, snapAxis } from './snapping';

function el(id: string, x: number, y: number, w = 100, h = 20): TextElement {
  return {
    type: 'text', id, x, y, width: w, height: h,
    content: '', fontSize: 12, color: '#000', align: 'left', lineHeight: 1.2, bold: false,
  };
}

describe('snapping', () => {
  it('snapAxis 在閾值內回傳最近目標的修正量', () => {
    const r = snapAxis([103], [100, 200], 5);
    expect(r).toEqual({ delta: -3, guide: 100 });
    expect(snapAxis([110], [100, 200], 5)).toBeNull(); // 超出閾值
  });

  it('snapAxis 多候選取絕對距離最小者', () => {
    const r = snapAxis([98, 148], [100, 150], 5);
    expect(r!.guide).toBe(100); // |100-98|=2 < |150-148|=2 → 相同取先到者
    expect(Math.abs(r!.delta)).toBe(2);
  });

  it('alignTargets 產生元素左中右與頁面邊界', () => {
    const page = { size: 'A4', orientation: 'portrait' as const, width: 500, height: 800, headerHeight: 0, footerHeight: 0 };
    const t = alignTargets([el('a', 100, 50)], page, 1, y => y, 'exclude-me');
    expect(t.xs).toContain(0);
    expect(t.xs).toContain(250); // 頁面中線
    expect(t.xs).toContain(100); // 左
    expect(t.xs).toContain(150); // 中
    expect(t.xs).toContain(200); // 右
    expect(t.ys).toContain(50);
    expect(t.ys).toContain(60);
    expect(t.ys).toContain(70);
  });

  it('alignTargets 排除拖曳中的元素本身', () => {
    const page = { size: 'A4', orientation: 'portrait' as const, width: 500, height: 800, headerHeight: 0, footerHeight: 0 };
    const t = alignTargets([el('me', 100, 50)], page, 1, y => y, 'me');
    expect(t.xs).not.toContain(100);
    expect(t.ys.length).toBe(0);
  });

  it('sizeTargets 收集其他元素（含容器子元素）的寬高並排除自己', () => {
    const container: ContainerElement = {
      type: 'container', id: 'c', x: 0, y: 0, width: 300, height: 150,
      title: '', borderWidth: 1, borderColor: '#000', fillColor: null,
      children: [el('kid', 5, 5, 80, 30)],
    };
    const t = sizeTargets([el('a', 0, 0, 120, 40), container, el('me', 0, 0, 999, 999)], 2, 'me');
    expect(t.ws).toContain(240); // 120 * zoom 2
    expect(t.ws).toContain(600); // 容器本身
    expect(t.ws).toContain(160); // 容器子元素 80 * 2
    expect(t.ws).not.toContain(1998); // 排除自己
    expect(t.hs).toContain(80); // 40 * 2
    expect(t.hs).toContain(60); // 子元素 30 * 2
  });
});
