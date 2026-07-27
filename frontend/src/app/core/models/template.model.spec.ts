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

  describe('資料欄位（placeholder）遷移成 text＋{{}}', () => {
    it('placeholder 元素 → text，key＋格式進 content，樣式保留', () => {
      const doc = normalizeTemplate({
        name: 'm',
        sections: [{ id: 's', name: '內頁', kind: 'flow', elements: [
          { id: 'p1', type: 'placeholder', x: 1, y: 2, width: 100, height: 20,
            key: 'customer.name', sample: '王小明', format: 'comma',
            fontSize: 12, color: '#dc2626', align: 'right', lineHeight: 1.2, bold: true },
        ] }],
      } as any);
      const el = doc.sections[0].elements[0] as TextElement;
      expect(el.type).toBe('text');
      expect(el.content).toBe('{{customer.name|comma}}');
      expect(el.color).toBe('#dc2626');
      expect(el.bold).toBeTrue();
      expect((el as any).key).toBeUndefined();
      expect((el as any).sample).toBeUndefined();
    });

    it('無格式 → {{key}}；空 key → 空內容；容器內也遷移', () => {
      const doc = normalizeTemplate({
        name: 'm',
        sections: [{ id: 's', name: '內頁', kind: 'flow', elements: [
          { id: 'c', type: 'container', x: 0, y: 0, width: 200, height: 100, children: [
            { id: 'p2', type: 'placeholder', x: 0, y: 0, width: 80, height: 16,
              key: 'qty', sample: '1', fontSize: 10, color: '#000000', align: 'left', lineHeight: 1.2, bold: false },
            { id: 'p3', type: 'placeholder', x: 0, y: 20, width: 80, height: 16,
              key: '', sample: '', fontSize: 10, color: '#000000', align: 'left', lineHeight: 1.2, bold: false },
          ] },
        ] }],
      } as any);
      const kids = (doc.sections[0].elements[0] as ContainerElement).children as TextElement[];
      expect(kids[0].content).toBe('{{qty}}');
      expect(kids[1].content).toBe('');
    });

    it('表格 placeholder 格 → text 格（value={{key|format}}，粗體等樣式保留）', () => {
      const doc = normalizeTemplate({
        name: 'm',
        sections: [{ id: 's', name: '內頁', kind: 'flow', elements: [
          { id: 't', type: 'table', x: 0, y: 0, width: 200, height: 40,
            columnWidths: [100, 100], rowHeights: [20, 20],
            borderColor: '#000', borderWidth: 1, fontSize: 10, cellPadding: 4,
            cells: [
              [{ kind: 'text', value: 'name', bold: true, align: 'center' }, { kind: 'text', value: 'amt', bold: true, align: 'center' }],
              [{ kind: 'placeholder', key: 'name', sample: 'x', align: 'left', bold: false },
               { kind: 'placeholder', key: 'amt', sample: '0', format: 'comma', align: 'right', bold: true }],
            ] },
        ] }],
      } as any);
      const t = doc.sections[0].elements[0] as TableElement;
      expect(t.cells[1][0].kind).toBe('text');
      expect(t.cells[1][0].value).toBe('{{name}}');
      expect(t.cells[1][1].value).toBe('{{amt|comma}}');
      expect(t.cells[1][1].bold).toBeTrue();
      expect(t.cells[1][1].align).toBe('right');
      // 非 placeholder 格原樣
      expect(t.cells[0][0].value).toBe('name');
    });
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

  describe('normalizeTemplate 表格防呆', () => {
    const tableDoc = (table: Record<string, unknown>) =>
      ({ sections: [{ id: 's1', kind: 'flow', elements: [{ id: 'tbl', type: 'table', x: 0, y: 0, width: 300, height: 60, ...table }] }] });
    const firstTable = (doc: unknown) =>
      normalizeTemplate(doc as never).sections[0].elements[0] as TableElement;

    it('缺 columnWidths/rowHeights 時由元素寬高均分補上（原本會讓整張畫布空白）', () => {
      const t = firstTable(tableDoc({ cells: [[{ kind: 'text', value: 'a' }, { kind: 'text', value: 'b' }]] }));
      expect(t.columnWidths).toEqual([150, 150]);
      expect(t.rowHeights).toEqual([60]);
      expect(t.cells[0][0].value).toBe('a');
    });

    it('cells 缺格時補空格，既有內容保留', () => {
      const t = firstTable(tableDoc({ columnWidths: [100, 100, 100], rowHeights: [20, 20], cells: [[{ kind: 'text', value: 'a' }]] }));
      expect(t.cells.length).toBe(2);
      expect(t.cells[0].length).toBe(3);
      expect(t.cells[0][0].value).toBe('a');
      expect(t.cells[1][2].kind).toBe('text');
    });

    it('完全沒有 cells / 尺寸也不崩，補成 1x1', () => {
      const t = firstTable(tableDoc({}));
      expect(t.columnWidths.length).toBe(1);
      expect(t.rowHeights.length).toBe(1);
      expect(t.cells).toEqual([[jasmine.objectContaining({ kind: 'text' })]]);
    });

    it('結構完整的表格原樣回傳（不動既有樣板）', () => {
      const cells = [[{ kind: 'text', value: 'a' }, { kind: 'text', value: 'b' }]];
      const doc = tableDoc({ columnWidths: [150, 150], rowHeights: [60], cells });
      const t = firstTable(doc);
      expect(t.columnWidths).toBe((doc.sections[0].elements[0] as never as TableElement).columnWidths);
      expect(t.cells).toBe(cells as never);
    });

    it('壞值（NaN／非陣列）視同缺漏而不是照單全收', () => {
      const t = firstTable(tableDoc({ columnWidths: [NaN, 10], rowHeights: 'nope', cells: [[{ kind: 'text', value: 'a' }]] }));
      expect(t.columnWidths.every(n => Number.isFinite(n))).toBeTrue();
      expect(t.rowHeights.every(n => Number.isFinite(n))).toBeTrue();
    });
  });
});
