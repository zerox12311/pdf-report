import {
  ContainerElement, TableElement, TextElement, cloneWithNewIds, collectFillableValues, emptyTemplate, fontCss, normalizeTemplate,
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

  it('normalizeTemplate：舊樣板無 validation → 關閉、空規則；髒欄位被清理', () => {
    // 舊樣板完全沒 validation
    const old = normalizeTemplate({ name: 'x', sections: [] } as any);
    expect(old.validation).toEqual({ enabled: false, fields: [] });
    // 有 validation：非法 type 退回 any、非字串 path 被濾掉、source 正規化
    const v = normalizeTemplate({
      name: 'y', sections: [],
      validation: {
        enabled: true,
        fields: [
          { path: 'a', required: true, type: 'weird' },
          { path: 'b', required: false, type: 'number', source: 'manual' },
          { path: 123, required: true, type: 'string' },
        ],
      },
    } as any);
    expect(v.validation!.enabled).toBeTrue();
    expect(v.validation!.fields.length).toBe(2); // 非字串 path 濾掉
    expect(v.validation!.fields[0]).toEqual({ path: 'a', required: true, type: 'any', source: 'detected' });
    expect(v.validation!.fields[1].source).toBe('manual');
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
  it('collectFillableValues 只收可填的文字元素與 text 儲存格（含容器巢狀）', () => {
    const t = emptyTemplate();
    const text: TextElement = { type: 'text', id: 'open', x: 0, y: 0, width: 10, height: 10,
      content: '可改', fontSize: 12, color: '#000', align: 'left', lineHeight: 1.2, bold: false, fillable: true };
    const locked: TextElement = { ...text, id: 'locked', content: '不可改', fillable: undefined };
    const nested: ContainerElement = {
      type: 'container', id: 'box', x: 0, y: 0, width: 50, height: 50,
      title: '', borderWidth: 0, borderColor: '#000', fillColor: null,
      children: [{ ...text, id: 'inner', content: '巢狀可改' }],
    };
    const table = {
      type: 'table', id: 'tbl', x: 0, y: 0, width: 100, height: 40,
      columnWidths: [50, 50], rowHeights: [20, 20], borderColor: '#000', borderWidth: 1,
      fontSize: 10, cellPadding: 2,
      cells: [
        [{ kind: 'text', value: '表頭', key: '', sample: '', align: 'left', bold: true },
         { kind: 'text', value: '格可改', key: '', sample: '', align: 'left', bold: false, fillable: true }],
        [{ kind: 'placeholder', value: '', key: 'amount', sample: '1', align: 'left', bold: false, fillable: true },
         { kind: 'text', value: '格鎖住', key: '', sample: '', align: 'left', bold: false }],
      ],
    } as unknown as TableElement;
    t.sections[0].elements = [text, locked, nested, table];

    const values = collectFillableValues(t);
    expect(values).toEqual({
      open: '可改',
      inner: '巢狀可改',
      'tbl#0,1': '格可改',
    });
    // 未標記的、非 text 型別的都不在其中（placeholder 格即使標了也不收）
    expect(values['locked']).toBeUndefined();
    expect(values['tbl#1,0']).toBeUndefined();
    expect(values['tbl#1,1']).toBeUndefined();
  });
});
