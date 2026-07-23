import { EditorStateService } from './editor-state.service';
import {
  ContainerElement, TableElement, TextElement,
} from '../../core/models/template.model';

function textEl(over: Partial<TextElement> = {}): Omit<TextElement, 'id'> {
  return {
    type: 'text', x: 10, y: 10, width: 100, height: 20,
    content: 'hi', fontSize: 12, color: '#000000', align: 'left', lineHeight: 1.2, bold: false,
    ...over,
  };
}

function containerEl(): Omit<ContainerElement, 'id'> {
  return {
    type: 'container', x: 40, y: 40, width: 200, height: 120,
    title: '區塊', borderWidth: 1, borderColor: '#000', fillColor: null, children: [],
  };
}

describe('EditorStateService', () => {
  let state: EditorStateService;

  beforeEach(() => {
    state = new EditorStateService();
  });

  it('addElement 加到目前節頂層並選取', () => {
    state.addElement(textEl() as any);
    expect(state.visibleElements().length).toBe(1);
    expect(state.selectedId()).toBe(state.visibleElements()[0].id);
    expect(state.dirty()).toBeTrue();
  });

  it('選著容器時 addElement 進容器且座標為相對、不重疊', () => {
    state.addElement(containerEl() as any);
    const cid = state.selectedId()!;
    state.addElement(textEl() as any);
    state.addElement(textEl() as any);
    const container = state.findElement(cid) as ContainerElement;
    expect(container.children.length).toBe(2);
    expect(container.children[0].x).toBe(8);
    // 第二個排在第一個下方
    expect(container.children[1].y).toBeGreaterThan(container.children[0].y);
    // 頂層只有容器
    expect(state.visibleElements().length).toBe(1);
  });

  it('patchElement / removeElement 支援容器子元素', () => {
    state.addElement(containerEl() as any);
    const cid = state.selectedId()!;
    state.addElement(textEl() as any);
    const childId = state.selectedId()!;
    state.patchElement(childId, { content: '改了' } as Partial<TextElement>);
    expect((state.findElement(childId) as TextElement).content).toBe('改了');
    state.removeElement(childId);
    expect(state.findElement(childId)).toBeNull();
    expect((state.findElement(cid) as ContainerElement).children.length).toBe(0);
  });

  it('parentOf / moveOutOfContainer 座標轉絕對', () => {
    state.addElement(containerEl() as any);
    const cid = state.selectedId()!;
    state.addElement(textEl() as any);
    const childId = state.selectedId()!;
    state.patchElement(childId, { x: 10, y: 20 });
    expect(state.parentOf(childId)?.id).toBe(cid);
    state.moveOutOfContainer(childId);
    const moved = state.findElement(childId)!;
    expect(state.parentOf(childId)).toBeNull();
    expect(moved.x).toBe(50); // 40 + 10
    expect(moved.y).toBe(60); // 40 + 20
  });

  it('duplicateElement 複製容器含子元素並重配 id', () => {
    state.addElement(containerEl() as any);
    const cid = state.selectedId()!;
    state.addElement(textEl() as any);
    state.select(cid);
    state.duplicateElement(cid);
    const els = state.visibleElements() as ContainerElement[];
    expect(els.length).toBe(2);
    expect(els[1].id).not.toBe(els[0].id);
    expect(els[1].children.length).toBe(1);
    expect(els[1].children[0].id).not.toBe(els[0].children[0].id);
    expect(els[1].x).toBe(els[0].x + 12);
    expect(state.selectedId()).toBe(els[1].id);
  });

  it('resizeTable 同步 cells 結構與寬高', () => {
    state.addElement({
      type: 'table', x: 0, y: 0, width: 180, height: 48,
      columnWidths: [90, 90], rowHeights: [24, 24],
      borderColor: '#000', borderWidth: 1, fontSize: 10, cellPadding: 4,
      cells: [
        [{ kind: 'text', value: 'a', key: '', sample: '', align: 'left', bold: false },
         { kind: 'text', value: 'b', key: '', sample: '', align: 'left', bold: false }],
        [{ kind: 'text', value: 'c', key: '', sample: '', align: 'left', bold: false },
         { kind: 'text', value: 'd', key: '', sample: '', align: 'left', bold: false }],
      ],
    } as any);
    const id = state.selectedId()!;
    state.resizeTable(id, 3, 3);
    const t = state.findElement(id) as TableElement;
    expect(t.rowHeights.length).toBe(3);
    expect(t.columnWidths.length).toBe(3);
    expect(t.cells.length).toBe(3);
    expect(t.cells[0].length).toBe(3);
    expect(t.cells[0][0].value).toBe('a'); // 原內容保留
    expect(t.width).toBe(90 + 90 + 90);
  });

  it('buildSampleData：placeholder、條碼、重複列與群組', () => {
    state.addElement({
      ...textEl(), type: 'placeholder', key: 'customer.name', sample: '王小明',
    } as any);
    state.select(null);
    state.addElement({
      type: 'barcode', x: 0, y: 300, width: 100, height: 40,
      symbology: 'code39', content: '', key: 'bc', sample: 'A1', showText: true,
    } as any);
    state.select(null);
    state.addElement({
      type: 'text', x: 0, y: 340, width: 10, height: 10, content: '',
      fontSize: 10, color: '#000', align: 'left', lineHeight: 1.2, bold: false,
    } as any);
    // $ 開頭引擎保留 key 不進範例資料
    state.select(null);
    state.addElement({ ...textEl(), type: 'placeholder', key: '$page', sample: '1' } as any);
    // 分組表格 → 兩組各兩筆
    state.select(null);
    state.addElement({
      type: 'table', x: 0, y: 400, width: 180, height: 72,
      columnWidths: [90, 90], rowHeights: [24, 24, 24],
      borderColor: '#000', borderWidth: 1, fontSize: 10, cellPadding: 4,
      repeat: { enabled: true, key: 'items', rowIndex: 1, groupBy: 'cat', groupHeaderRowIndex: 0, groupFooterRowIndex: 2 },
      cells: [
        [{ kind: 'placeholder', value: '', key: 'cat', sample: '', align: 'left', bold: false },
         { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false }],
        [{ kind: 'placeholder', value: '', key: 'name', sample: '品', align: 'left', bold: false },
         { kind: 'placeholder', value: '', key: '$row', sample: '', align: 'left', bold: false }],
        [{ kind: 'placeholder', value: '', key: '$gsum(amt)', sample: '', align: 'left', bold: false },
         { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false }],
      ],
    } as any);

    const data: any = state.buildSampleData();
    expect(data.customer.name).toBe('王小明');
    expect(data.bc).toBe('A1');
    expect(data['$page']).toBeUndefined();
    expect(data.items.length).toBe(4);
    expect(data.items[0].cat).toBe('分類1');
    expect(data.items[3].cat).toBe('分類2');
    expect(data.items[0].name).toBe('品1');
    // $ 開頭儲存格 key 不產生資料
    expect(data.items[0]['$row']).toBeUndefined();
  });

  it('buildSampleData：動態圖片 key 產範例 URL（元素與重複列儲存格）', () => {
    state.addElement({
      type: 'image', x: 0, y: 0, width: 100, height: 50,
      assetId: '', fit: 'contain', key: 'logoUrl', sample: 'https://x.test/logo.png',
    } as any);
    state.select(null);
    state.addElement({
      type: 'table', x: 0, y: 100, width: 180, height: 48,
      columnWidths: [90, 90], rowHeights: [24, 24],
      borderColor: '#000', borderWidth: 1, fontSize: 10, cellPadding: 4,
      repeat: { enabled: true, key: 'items', rowIndex: 1 },
      cells: [
        [{ kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false },
         { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false }],
        [{ kind: 'placeholder', value: '', key: 'name', sample: '品', align: 'left', bold: false },
         { kind: 'image', value: '', key: 'photo', sample: 'https://x.test/p.png', align: 'left', bold: false }],
      ],
    } as any);
    const data: any = state.buildSampleData();
    expect(data.logoUrl).toBe('https://x.test/logo.png');
    expect(data.items[0].photo).toBe('https://x.test/p.png'); // URL 不加序號
    expect(data.items[1].photo).toBe('https://x.test/p.png');
    expect(data.items[0].name).toBe('品1'); // 一般欄位維持加序號
  });

  it('buildSampleData：條碼儲存格 key 產範例值（原樣、不加序號）', () => {
    state.addElement({
      type: 'table', x: 0, y: 0, width: 180, height: 48,
      columnWidths: [90, 90], rowHeights: [24, 24],
      borderColor: '#000', borderWidth: 1, fontSize: 10, cellPadding: 4,
      repeat: { enabled: true, key: 'items', rowIndex: 1 },
      cells: [
        [{ kind: 'barcode', value: '', key: 'topBc', sample: 'A001', align: 'left', bold: false },
         { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false }],
        [{ kind: 'barcode', value: '', key: 'bc', sample: 'B002', align: 'left', bold: false },
         { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false }],
      ],
    } as any);
    const data: any = state.buildSampleData();
    expect(data.topBc).toBe('A001'); // 非重複列 → 頂層 key
    expect(data.items[0].bc).toBe('B002'); // 重複列 → 相對 key、每列同值不加序號
    expect(data.items[1].bc).toBe('B002');
  });

  it('copyElement / paste：重配 id、偏移 12pt、連續貼上階梯排開', () => {
    state.addElement(textEl() as any);
    const srcId = state.selectedId()!;
    state.copyElement(srcId);
    state.select(null);
    state.paste();
    state.paste();
    const els = state.visibleElements();
    expect(els.length).toBe(3);
    expect(els[1].id).not.toBe(srcId);
    expect(els[1].x).toBe(22); // 10 + 12
    expect(els[2].x).toBe(34); // 再 +12
    expect(state.selectedId()).toBe(els[2].id);
  });

  it('copyElement 容器子元素存絕對座標，貼到頂層', () => {
    state.addElement(containerEl() as any);
    state.addElement(textEl() as any);
    const childId = state.selectedId()!;
    state.patchElement(childId, { x: 10, y: 20 });
    state.copyElement(childId);
    state.select(null);
    state.paste();
    const pasted = state.visibleElements().at(-1)!;
    expect(pasted.type).toBe('text');
    expect(pasted.x).toBe(40 + 10 + 12);
    expect(pasted.y).toBe(40 + 20 + 12);
  });

  it('選著容器時 paste 貼進容器（相對座標且夾在範圍內）', () => {
    state.addElement(textEl({ x: 42, y: 45 }) as any);
    const srcId = state.selectedId()!;
    state.copyElement(srcId);
    state.addElement(containerEl() as any);
    const cid = state.selectedId()!;
    state.paste();
    const container = state.findElement(cid) as ContainerElement;
    expect(container.children.length).toBe(1);
    expect(container.children[0].x).toBe(14); // 42 - 40 + 12
    expect(container.children[0].y).toBeGreaterThanOrEqual(0);
  });

  it('moveIntoContainer 座標轉相對並夾範圍；容器不能移進容器', () => {
    state.addElement(containerEl() as any);
    const cid = state.selectedId()!;
    state.select(null);
    state.addElement(textEl() as any);
    const tid = state.selectedId()!;
    state.patchElement(tid, { x: 60, y: 70 }); // 固定座標（避開 addElement 自動排位）
    state.moveIntoContainer(tid, cid);
    const container = state.findElement(cid) as ContainerElement;
    expect(container.children.length).toBe(1);
    expect(container.children[0].x).toBe(20); // 60 - 40
    expect(container.children[0].y).toBe(30); // 70 - 40
    expect(state.visibleElements().length).toBe(1);
    // 容器 → 容器：拒絕
    state.select(null);
    state.addElement(containerEl() as any);
    const cid2 = state.selectedId()!;
    state.moveIntoContainer(cid2, cid);
    expect((state.findElement(cid) as ContainerElement).children.length).toBe(1);
  });

  it('load 補齊舊樣板缺欄位，並把舊格式遷移成節', () => {
    state.load({
      id: 'x', name: 'n', version: 1,
      page: { size: 'A4', orientation: 'portrait', width: 595, height: 842, headerHeight: 50, footerHeight: 30 },
      elements: [{ ...textEl(), id: 'e1' }],
      cover: { enabled: true, elements: [{ ...textEl(), id: 'c1' }] },
      backPage: { enabled: false, elements: [] },
    } as any);
    const secs = state.template().sections;
    expect(secs.length).toBe(2); // 封面 + 內頁（封底未啟用不遷移）
    expect(secs[0].kind).toBe('single');
    expect(secs[0].name).toBe('封面');
    expect(secs[0].elements[0].id).toBe('c1');
    expect(secs[1].kind).toBe('flow');
    expect(secs[1].headerHeight).toBe(50); // band 高度搬進節
    expect(secs[1].elements[0].id).toBe('e1');
    // 載入後停在第一節
    expect(state.activeSection().id).toBe(secs[0].id);
  });

  it('合併儲存格：範圍合併/取消/重複列邊界防呆', () => {
    state.addElement({
      type: 'table', x: 0, y: 0, width: 270, height: 72,
      columnWidths: [90, 90, 90], rowHeights: [24, 24, 24],
      borderColor: '#000', borderWidth: 1, fontSize: 10, cellPadding: 4,
      repeat: { enabled: true, key: 'items', rowIndex: 2 },
      cells: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () =>
        ({ kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false }))),
    } as any);
    const id = state.selectedId()!;
    // 沒範圍 → 錯誤訊息
    expect(state.mergeSelectedCells(id)).toContain('Shift');
    // 合併第 0 列的 3 欄
    state.selectedCell.set({ row: 0, col: 0 });
    state.selectedCellRange.set({ r1: 0, c1: 0, r2: 0, c2: 2 });
    expect(state.mergeSelectedCells(id)).toBeNull();
    let t = state.findElement(id) as TableElement;
    expect(t.cells[0][0].colSpan).toBe(3);
    expect(t.cells[0][0].rowSpan).toBe(1);
    // 跨到重複列（rowIndex 2）→ 拒絕
    state.selectedCell.set({ row: 1, col: 0 });
    state.selectedCellRange.set({ r1: 1, c1: 0, r2: 2, c2: 0 });
    expect(state.mergeSelectedCells(id)).toContain('重複列');
    // 取消合併
    state.unmergeCell(id, 0, 0);
    t = state.findElement(id) as TableElement;
    expect(t.cells[0][0].colSpan).toBe(1);
  });

  it('undo/redo：復原重做、連續操作合併、新變更清空 redo', () => {
    const forceStep = () => ((state as unknown as { lastRecord: number }).lastRecord = 0);
    state.addElement(textEl() as any);
    const id = state.selectedId()!;
    forceStep();
    // 同一視窗內連續 patch = 一步
    state.patchElement(id, { x: 50 });
    state.patchElement(id, { x: 60 });
    state.patchElement(id, { x: 70 });
    expect(state.findElement(id)!.x).toBe(70);
    forceStep();
    state.patchElement(id, { y: 99 }); // 第三步
    expect(state.undoCount()).toBe(3);
    // undo：y 回原、x 仍 70（合併的三個 patch 是一步）
    state.undo();
    expect(state.findElement(id)!.y).toBe(10);
    expect(state.findElement(id)!.x).toBe(70);
    state.undo();
    expect(state.findElement(id)!.x).toBe(10); // 整段拖曳一次復原
    state.undo();
    expect(state.visibleElements().length).toBe(0); // 回到加入前
    expect(state.selectedId()).toBeNull(); // 選取清掉
    // redo
    state.redo();
    expect(state.visibleElements().length).toBe(1);
    state.redo();
    expect(state.findElement(id)!.x).toBe(70);
    // 新變更清空 redo
    forceStep();
    state.patchElement(id, { x: 5 });
    expect(state.redoCount()).toBe(0);
    // load 清歷史
    state.load(state.template());
    expect(state.undoCount()).toBe(0);
  });

  it('多選對齊/分佈：alignSelected 與 distributeSelected', () => {
    // 三個元素不同位置
    state.addElement(textEl({ x: 10, y: 10, width: 100, height: 20 }) as any);
    const a = state.selectedId()!;
    state.select(null);
    state.addElement(textEl({ x: 50, y: 60, width: 40, height: 20 }) as any);
    const b = state.selectedId()!;
    state.select(null);
    state.addElement(textEl({ x: 200, y: 100, width: 60, height: 20 }) as any);
    const c = state.selectedId()!;
    // 多選三個
    state.selectMany([a, b, c]);
    expect(state.selectedIds()).toEqual([a, b, c]);
    // 左對齊 → 全部 x = min x = 10
    state.alignSelected('left');
    expect(state.findElement(a)!.x).toBe(10);
    expect(state.findElement(b)!.x).toBe(10);
    expect(state.findElement(c)!.x).toBe(10);
    // 頂端對齊 → 全部 y = min y = 10
    state.alignSelected('top');
    expect(state.findElement(a)!.y).toBe(10);
    expect(state.findElement(c)!.y).toBe(10);
    // 重設 y 做垂直分佈
    state.patchElement(a, { y: 0 });
    state.patchElement(b, { y: 50 });
    state.patchElement(c, { y: 200 });
    state.distributeSelected('v');
    // 中心等距：a 中心 10、c 中心 210，b 中心應為 110 → b.y = 110 - 10 = 100
    expect(state.findElement(b)!.y).toBe(100);
  });

  it('多選：toggleSelect 加選移除、removeSelected 一步刪除', () => {
    state.addElement(textEl() as any);
    const a = state.selectedId()!;
    state.select(null);
    state.addElement(textEl() as any);
    const b = state.selectedId()!;
    state.select(a);
    state.toggleSelect(b); // 加選 b
    expect(state.selectedIds().sort()).toEqual([a, b].sort());
    state.toggleSelect(b); // 移除 b
    expect(state.selectedIds()).toEqual([a]);
    // 多選刪除
    state.toggleSelect(b);
    state.removeSelected();
    expect(state.findElement(a)).toBeNull();
    expect(state.findElement(b)).toBeNull();
    expect(state.selectedId()).toBeNull();
  });

  it('moveLayer：同層清單內上移/下移/最上/最下；layerPositionOf 回報位置', () => {
    state.addElement(textEl({ content: 'a' }) as any);
    state.select(null);
    state.addElement(textEl({ content: 'b' }) as any);
    state.select(null);
    state.addElement(textEl({ content: 'c' }) as any);
    const ids = state.visibleElements().map(e => e.id);
    const order = () => state.visibleElements().map(e => (e as TextElement).content);
    expect(state.layerPositionOf(ids[0])).toEqual({ index: 0, count: 3 });
    state.moveLayer(ids[0], 'up');
    expect(order()).toEqual(['b', 'a', 'c']);
    state.moveLayer(ids[0], 'front');
    expect(order()).toEqual(['b', 'c', 'a']);
    state.moveLayer(ids[0], 'down');
    expect(order()).toEqual(['b', 'a', 'c']);
    state.moveLayer(ids[0], 'back');
    expect(order()).toEqual(['a', 'b', 'c']);
    // 容器子元素在容器內排序
    state.select(null);
    state.addElement(containerEl() as any);
    const cid = state.selectedId()!;
    state.addElement(textEl({ content: 'x' }) as any);
    const xid = state.selectedId()!;
    state.select(cid);
    state.addElement(textEl({ content: 'y' }) as any);
    state.moveLayer(xid, 'front');
    const kids = (state.findElement(cid) as ContainerElement).children;
    expect((kids.at(-1) as TextElement).content).toBe('x');
  });

  it('pasteAt 貼在指定座標', () => {
    state.addElement(textEl() as any);
    state.copyElement(state.selectedId()!);
    state.select(null);
    state.pasteAt(123, 456);
    const pasted = state.visibleElements().at(-1)!;
    expect(pasted.x).toBe(123);
    expect(pasted.y).toBe(456);
    expect(state.hasClipboard()).toBeTrue();
  });

  /** 3×3 表格＋重複列在第 1 列＋(0,0) 直向合併兩列 */
  function addTable(): string {
    state.select(null);
    state.addElement({
      type: 'table', x: 0, y: 0, width: 270, height: 72,
      columnWidths: [90, 90, 90], rowHeights: [24, 24, 24],
      borderColor: '#000', borderWidth: 1, fontSize: 10, cellPadding: 4,
      repeat: { enabled: true, key: 'items', rowIndex: 1, groupFooterRowIndex: 2 },
      cells: Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) =>
        ({ kind: 'text', value: `${r}${c}`, key: '', sample: '', align: 'left', bold: false }))),
    } as any);
    return state.selectedId()!;
  }

  it('insertTableRow：插入列、推移重複列索引、跨越的合併格加高', () => {
    const id = addTable();
    state.patchElement(id, {
      cells: (state.findElement(id) as TableElement).cells.map((row, r) =>
        row.map((cell, c) => (r === 1 && c === 2 ? { ...cell, rowSpan: 2 } : cell))),
    } as any);
    state.insertTableRow(id, 2); // 在合併範圍（1–2 列）中間插入
    const t = state.findElement(id) as TableElement;
    expect(t.cells.length).toBe(4);
    expect(t.rowHeights.length).toBe(4);
    expect(t.height).toBe(96);
    expect(t.cells[2].every(cell => cell.value === '')).toBeTrue(); // 新列是空格
    expect(t.cells[1][2].rowSpan).toBe(3); // 跨越插入點的合併格加高
    expect(t.repeat!.rowIndex).toBe(1); // 在插入點前不動
    expect(t.repeat!.groupFooterRowIndex).toBe(3); // 在插入點後往下推
  });

  it('removeTableRow：重複列本體被刪則取消重複；錨點被刪內容下移', () => {
    const id = addTable();
    state.patchElement(id, {
      cells: (state.findElement(id) as TableElement).cells.map((row, r) =>
        row.map((cell, c) => (r === 0 && c === 0 ? { ...cell, rowSpan: 2 } : cell))),
    } as any);
    state.removeTableRow(id, 0); // 刪合併錨點列
    let t = state.findElement(id) as TableElement;
    expect(t.cells.length).toBe(2);
    expect(t.cells[0][0].value).toBe('00'); // 錨點內容搬到下一列
    expect(t.cells[0][0].rowSpan).toBe(1);
    expect(t.repeat!.rowIndex).toBe(0); // 1 → 0
    state.removeTableRow(id, 0); // 刪掉重複列本體
    t = state.findElement(id) as TableElement;
    expect(t.repeat!.enabled).toBeFalse();
    state.removeTableRow(id, 0); // 只剩一列 → 拒刪
    expect((state.findElement(id) as TableElement).cells.length).toBe(1);
  });

  it('insertTableCol / removeTableCol：欄寬同步、合併格跨度調整', () => {
    const id = addTable();
    state.patchElement(id, {
      cells: (state.findElement(id) as TableElement).cells.map((row, r) =>
        row.map((cell, c) => (r === 0 && c === 0 ? { ...cell, colSpan: 2 } : cell))),
    } as any);
    state.insertTableCol(id, 1); // 在合併範圍（0–1 欄）中間插入
    let t = state.findElement(id) as TableElement;
    expect(t.columnWidths.length).toBe(4);
    expect(t.width).toBe(360);
    expect(t.cells[0][0].colSpan).toBe(3);
    expect(t.cells[1][1].value).toBe(''); // 新欄空格
    state.removeTableCol(id, 1); // 刪合併中段 → 跨度縮回
    t = state.findElement(id) as TableElement;
    expect(t.columnWidths.length).toBe(3);
    expect(t.cells[0][0].colSpan).toBe(2);
    state.removeTableCol(id, 0); // 刪錨點欄 → 內容右移
    t = state.findElement(id) as TableElement;
    expect(t.cells[0][0].value).toBe('00');
    expect(t.cells[0][0].colSpan).toBe(1);
  });

  it('toggleRepeatRow：設定/取消/搬移重複列（保留 key）', () => {
    const id = addTable();
    state.toggleRepeatRow(id, 2); // 搬到第 2 列
    let t = state.findElement(id) as TableElement;
    expect(t.repeat!.rowIndex).toBe(2);
    expect(t.repeat!.key).toBe('items'); // key 保留
    state.toggleRepeatRow(id, 2); // 同列再點 = 取消
    t = state.findElement(id) as TableElement;
    expect(t.repeat!.enabled).toBeFalse();
    state.toggleRepeatRow(id, 0); // 再開
    t = state.findElement(id) as TableElement;
    expect(t.repeat!.enabled).toBeTrue();
    expect(t.repeat!.rowIndex).toBe(0);
  });

  it('patchSelectedCells：Shift 框選範圍批次改樣式；無範圍改單格', () => {
    const id = addTable();
    state.selectedCell.set({ row: 0, col: 0 });
    state.selectedCellRange.set({ r1: 0, c1: 0, r2: 0, c2: 2 });
    state.patchSelectedCells(id, { fillColor: '#e0f2fe', bold: true });
    let t = state.findElement(id) as TableElement;
    expect(t.cells[0].every(c => c.fillColor === '#e0f2fe' && c.bold)).toBeTrue();
    expect(t.cells[1][0].fillColor).toBeUndefined(); // 範圍外不動
    // 無範圍 → 只改選取格
    state.selectedCellRange.set(null);
    state.selectedCell.set({ row: 1, col: 1 });
    state.patchSelectedCells(id, { align: 'center' });
    t = state.findElement(id) as TableElement;
    expect(t.cells[1][1].align).toBe('center');
    expect(t.cells[1][0].align).toBe('left');
  });

  it('applyCellBorders：無框線鏡射鄰格、toggle 邊線、全開還原 undefined', () => {
    const id = addTable();
    // (1,1) 無框線 → 自己四邊關 + 四個鄰格面向的邊也關（共用線兩側一致）
    state.selectedCell.set({ row: 1, col: 1 });
    state.selectedCellRange.set(null);
    state.applyCellBorders(id, 'none');
    let t = state.findElement(id) as TableElement;
    expect(t.cells[1][1].borders).toEqual({ top: false, right: false, bottom: false, left: false });
    expect(t.cells[0][1].borders!.bottom).toBeFalse(); // 上鄰的下邊
    expect(t.cells[2][1].borders!.top).toBeFalse();    // 下鄰的上邊
    expect(t.cells[1][0].borders!.right).toBeFalse();  // 左鄰的右邊
    expect(t.cells[1][2].borders!.left).toBeFalse();   // 右鄰的左邊
    expect(t.cells[0][0].borders).toBeUndefined();     // 沒動到的格子維持未設
    expect(state.selectionEdgeOn(id, 'top')).toBeFalse();
    // toggle：再開上邊線
    state.applyCellBorders(id, 'top');
    t = state.findElement(id) as TableElement;
    expect(t.cells[1][1].borders!.top).toBeTrue();
    expect(state.selectionEdgeOn(id, 'top')).toBeTrue();
    // 所有框線 → 全開的格子清回 undefined
    state.selectedCell.set({ row: 0, col: 0 });
    state.selectedCellRange.set({ r1: 0, c1: 0, r2: 2, c2: 2 });
    state.applyCellBorders(id, 'all');
    t = state.findElement(id) as TableElement;
    expect(t.cells.flat().every(c => c.borders === undefined)).toBeTrue();
  });

  it('applyCellBorders：範圍 outer/inner 只動對應的線', () => {
    const id = addTable();
    state.selectedCell.set({ row: 0, col: 0 });
    state.selectedCellRange.set({ r1: 0, c1: 0, r2: 1, c2: 1 });
    state.applyCellBorders(id, 'none'); // 先清空 2×2 範圍
    state.applyCellBorders(id, 'outer'); // 開外框
    const t = state.findElement(id) as TableElement;
    expect(t.cells[0][0].borders!.top).toBeTrue();   // 外框上
    expect(t.cells[0][0].borders!.left).toBeTrue();  // 外框左
    expect(t.cells[0][0].borders!.right).toBeFalse();  // 內部線維持關
    expect(t.cells[0][0].borders!.bottom).toBeFalse();
    expect(t.cells[1][1].borders!.right).toBeTrue(); // 外框右
    expect(t.cells[1][1].borders!.bottom).toBeTrue();
    state.applyCellBorders(id, 'inner'); // 開內部格線
    const t2 = state.findElement(id) as TableElement;
    expect(t2.cells[0][0].borders).toBeUndefined(); // 四邊全開 → 還原未設
  });

  it('applyCellBorders：斜線 toggle 逐格、有斜線時不還原 undefined', () => {
    const id = addTable();
    state.selectedCell.set({ row: 0, col: 0 });
    state.selectedCellRange.set({ r1: 0, c1: 0, r2: 0, c2: 1 });
    state.applyCellBorders(id, 'diagDown');
    let t = state.findElement(id) as TableElement;
    expect(t.cells[0][0].borders!.diagDown).toBeTrue();
    expect(t.cells[0][1].borders!.diagDown).toBeTrue();
    expect(t.cells[0][2].borders).toBeUndefined(); // 範圍外
    expect(t.cells[0][0].borders!.top).toBeTrue(); // 四邊不受影響
    expect(state.selectionDiagOn(id, 'diagDown')).toBeTrue();
    // 再按一次 = 取消，四邊全開 → 還原 undefined
    state.applyCellBorders(id, 'diagDown');
    t = state.findElement(id) as TableElement;
    expect(t.cells[0][0].borders).toBeUndefined();
    expect(state.selectionDiagOn(id, 'diagDown')).toBeFalse();
  });

  it('clearCell 清內容保留合併跨度', () => {
    const id = addTable();
    state.patchElement(id, {
      cells: (state.findElement(id) as TableElement).cells.map((row, r) =>
        row.map((cell, c) => (r === 0 && c === 0 ? { ...cell, colSpan: 2, kind: 'placeholder', key: 'k' } : cell))),
    } as any);
    state.clearCell(id, 0, 0);
    const cell = (state.findElement(id) as TableElement).cells[0][0];
    expect(cell.kind).toBe('text');
    expect(cell.value).toBe('');
    expect(cell.key).toBe('');
    expect(cell.colSpan).toBe(2); // 跨度保留
  });

  it('節管理：新增/切換/紙張覆寫/排序/刪除', () => {
    // 預設一個 flow 節
    expect(state.template().sections.length).toBe(1);
    const mainId = state.activeSection().id;
    state.addElement(textEl() as any);
    // 新增獨立頁 → 自動切過去、元素清單分開
    state.addSection('single');
    const singleId = state.activeSection().id;
    expect(singleId).not.toBe(mainId);
    expect(state.activeSection().kind).toBe('single');
    expect(state.visibleElements().length).toBe(0);
    state.addElement(textEl() as any);
    expect(state.visibleElements().length).toBe(1);
    // activePage：獨立頁無 band；套紙張覆寫後寬高生效
    expect(state.activePage().headerHeight).toBe(0);
    state.patchSection(singleId, { page: { size: 'custom', orientation: 'landscape', width: 700, height: 500 } });
    expect(state.activePage().width).toBe(700);
    // 切回主節：selection 清空、activePage 回文件預設
    state.setActiveSection(mainId);
    expect(state.selectedId()).toBeNull();
    expect(state.activePage().width).toBe(595.28);
    // 跨節貼上
    const srcId = state.visibleElements()[0].id;
    state.copyElement(srcId);
    state.setActiveSection(singleId);
    state.paste();
    expect(state.visibleElements().length).toBe(2);
    // 排序：single 往前 → 變第一節
    state.moveSection(singleId, -1);
    expect(state.template().sections[0].id).toBe(singleId);
    // 刪除：剩一節時拒刪
    state.removeSection(singleId);
    expect(state.template().sections.length).toBe(1);
    expect(state.activeSection().id).toBe(mainId);
    state.removeSection(mainId);
    expect(state.template().sections.length).toBe(1);
  });

  it('detectValidationFields：掃樣板導出欄位（含 items[].欄位、型別推斷、$ 排除、去重）', () => {
    // 文字插值：total 有 comma → 推 number；$page 保留字排除
    state.addElement(textEl({ content: '共 {{total|comma}} 元／第 {{$page}} 頁' }) as any);
    state.select(null);
    // 資料欄位
    state.addElement({
      type: 'placeholder', x: 0, y: 0, width: 100, height: 20,
      content: '', key: 'school.name', sample: '', fontSize: 12, color: '#000',
      align: 'left', lineHeight: 1.2, bold: false,
    } as any);
    state.select(null);
    // 重複列表格：items 陣列 + items[].amount（cell format=comma → number）
    state.addElement({
      type: 'table', x: 0, y: 100, width: 180, height: 48,
      columnWidths: [90, 90], rowHeights: [24, 24],
      borderColor: '#000', borderWidth: 1, fontSize: 10, cellPadding: 4,
      repeat: { enabled: true, key: 'items', rowIndex: 1 },
      cells: [
        [{ kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false },
         { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false }],
        [{ kind: 'placeholder', value: '', key: 'name', sample: '', align: 'left', bold: false },
         { kind: 'placeholder', value: '', key: 'amount', sample: '', align: 'left', bold: false, format: 'comma' }],
      ],
    } as any);

    const added = state.detectValidationFields();
    expect(added).toBeGreaterThan(0);
    const byPath = new Map(state.validation().fields.map(f => [f.path, f]));
    expect(byPath.get('total')?.type).toBe('number');
    expect(byPath.get('school.name')?.type).toBe('any');
    expect(byPath.get('items')?.type).toBe('array');
    expect(byPath.get('items[].amount')?.type).toBe('number');
    expect(byPath.has('items[].name')).toBeTrue();
    expect([...byPath.keys()].some(k => k.startsWith('$'))).toBeFalse();
    expect(byPath.get('total')?.required).toBeTrue();
    expect(byPath.get('total')?.source).toBe('detected');

    // 再偵測一次：合併補新、不重複、保留手動微調
    state.updateValidationField(0, { required: false });
    const before = state.validation().fields.length;
    const addedAgain = state.detectValidationFields();
    expect(addedAgain).toBe(0);
    expect(state.validation().fields.length).toBe(before);
    expect(state.validation().fields[0].required).toBeFalse();
  });

  it('detectValidationFields：$sum/$count 導出被彙總的陣列與欄位、並把被加總欄位升級為數字', () => {
    // 文字元素只用 $sum/$count 引用 orders（畫面沒有直接欄位）
    state.addElement(textEl({ content: '共 {{$count(orders)}} 筆、合計 {{$sum(orders.total)|comma}}' }) as any);
    state.select(null);
    // 重複表格：amount 欄位無 format（本身推不出數字），但被下方 $sum 加總
    state.addElement({
      type: 'table', x: 0, y: 100, width: 180, height: 72,
      columnWidths: [90, 90], rowHeights: [24, 24, 24],
      borderColor: '#000', borderWidth: 1, fontSize: 10, cellPadding: 4,
      repeat: { enabled: true, key: 'items', rowIndex: 1 },
      cells: [
        [{ kind: 'text', value: '品名', key: '', sample: '', align: 'left', bold: false },
         { kind: 'text', value: '金額', key: '', sample: '', align: 'left', bold: false }],
        [{ kind: 'placeholder', value: '', key: 'name', sample: '', align: 'left', bold: false },
         { kind: 'placeholder', value: '', key: 'amount', sample: '', align: 'left', bold: false }],
        [{ kind: 'text', value: '合計', key: '', sample: '', align: 'left', bold: false },
         { kind: 'text', value: '{{$sum(items.amount)|comma}}', key: '', sample: '', align: 'left', bold: false }],
      ],
    } as any);

    state.detectValidationFields();
    const byPath = new Map(state.validation().fields.map(f => [f.path, f]));
    // 只在 $sum/$count 內出現的 orders 也被偵測
    expect(byPath.get('orders')?.type).toBe('array');
    expect(byPath.get('orders[].total')?.type).toBe('number');
    // items.amount 本身無 format，但被 $sum 加總 → 升級為數字（順序無關）
    expect(byPath.get('items')?.type).toBe('array');
    expect(byPath.get('items[].amount')?.type).toBe('number');
    // $ 保留字本身不會變成欄位
    expect([...byPath.keys()].some(k => k.startsWith('$'))).toBeFalse();
  });

  it('resizeTable：縮列到重複列以下 → 關閉 repeat、夾住越界 colSpan（防靜默掉單）', () => {
    state.addElement({
      type: 'table', x: 0, y: 0, width: 180, height: 96,
      columnWidths: [90, 90], rowHeights: [24, 24, 24, 24],
      borderColor: '#000', borderWidth: 1, fontSize: 10, cellPadding: 4,
      repeat: { enabled: true, key: 'items', rowIndex: 1, groupHeaderRowIndex: 0, groupFooterRowIndex: 3 },
      cells: [
        [{ kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false, colSpan: 2 },
         { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false }],
        [{ kind: 'placeholder', value: '', key: 'name', sample: '', align: 'left', bold: false },
         { kind: 'placeholder', value: '', key: 'amt', sample: '', align: 'left', bold: false }],
        [{ kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false },
         { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false }],
        [{ kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false },
         { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false }],
      ],
    } as any);
    const id = state.selectedId()!;
    // 縮到只剩 1 列（rowIndex=1、groupFooterRowIndex=3 全越界）
    state.resizeTable(id, 1, 1);
    const t = state.findElement(id) as TableElement;
    expect(t.rowHeights.length).toBe(1);
    expect(t.columnWidths.length).toBe(1);
    expect(t.repeat!.enabled).toBeFalse();          // 重複列消失 → 關閉，不留越界殘值
    expect(t.repeat!.rowIndex).toBe(0);
    expect(t.repeat!.groupFooterRowIndex).toBeNull();
    expect(t.cells[0][0].colSpan).toBe(1);          // colSpan 2 夾回 1 欄
  });

  it('mergeSelectionError：跨重複列邊界擋下、同列內可合併', () => {
    state.addElement({
      type: 'table', x: 0, y: 0, width: 180, height: 72,
      columnWidths: [90, 90], rowHeights: [24, 24, 24],
      borderColor: '#000', borderWidth: 1, fontSize: 10, cellPadding: 4,
      repeat: { enabled: true, key: 'items', rowIndex: 1 },
      cells: [0, 1, 2].map(() => [
        { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false },
        { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false },
      ]),
    } as any);
    const id = state.selectedId()!;
    // 範圍跨列 0（表頭）~ 列 1（重複列）→ 越過重複列邊界 → 擋下
    state.selectedCellRange.set({ r1: 0, c1: 0, r2: 1, c2: 0 });
    expect(state.mergeSelectionError(id)).toContain('重複列');
    // 重複列內左右合併（同一列 c0~c1）→ 可合併
    state.selectedCellRange.set({ r1: 1, c1: 0, r2: 1, c2: 1 });
    expect(state.mergeSelectionError(id)).toBeNull();
    // 單格 → 擋下（無可合併）
    state.selectedCellRange.set({ r1: 0, c1: 0, r2: 0, c2: 0 });
    expect(state.mergeSelectionError(id)).toContain('一格');
  });

  it('手動新增/刪除驗證欄位、開關', () => {
    state.setValidationEnabled(true);
    expect(state.validation().enabled).toBeTrue();
    state.addValidationField();
    expect(state.validation().fields.length).toBe(1);
    expect(state.validation().fields[0].source).toBe('manual');
    state.updateValidationField(0, { path: 'foo', type: 'number' });
    expect(state.validation().fields[0].path).toBe('foo');
    state.removeValidationField(0);
    expect(state.validation().fields.length).toBe(0);
  });
});
