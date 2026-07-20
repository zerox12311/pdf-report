import {
  ContainerElement, TextElement, cloneWithNewIds, emptyTemplate, fontCss,
} from './template.model';

describe('template.model', () => {
  it('emptyTemplate 帶預設頁面與一個空的內頁節', () => {
    const t = emptyTemplate();
    expect(t.page.width).toBeCloseTo(595.28);
    expect(t.page.headerHeight).toBe(0);
    expect(t.page.footerHeight).toBe(0);
    expect(t.sections.length).toBe(1);
    expect(t.sections[0].kind).toBe('flow');
    expect(t.sections[0].elements).toEqual([]);
  });

  it('fontCss 對未知/未設家族回黑體', () => {
    expect(fontCss(undefined)).toContain('Noto Sans TC');
    expect(fontCss('serif')).toContain('Noto Serif TC');
    expect(fontCss('mono')).toContain('Noto Sans Mono');
  });

  it('cloneWithNewIds 深拷貝並重配 id（含容器子元素）', () => {
    const container: ContainerElement = {
      type: 'container', id: 'c1', x: 0, y: 0, width: 100, height: 100,
      title: 'box', borderWidth: 1, borderColor: '#000', fillColor: null,
      children: [
        { type: 'text', id: 't1', x: 5, y: 5, width: 50, height: 20, content: 'hi', fontSize: 12, color: '#000', align: 'left', lineHeight: 1.2, bold: false } as TextElement,
      ],
    };
    const copy = cloneWithNewIds(container) as ContainerElement;
    expect(copy.id).not.toBe('c1');
    expect(copy.children[0].id).not.toBe('t1');
    expect(copy.children[0]).not.toBe(container.children[0]); // 深拷貝
    expect((copy.children[0] as TextElement).content).toBe('hi');
    // 原件不受影響
    expect(container.id).toBe('c1');
    expect(container.children[0].id).toBe('t1');
  });
});
