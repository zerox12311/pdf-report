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
});
