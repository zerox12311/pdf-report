import { Injectable, computed, signal } from '@angular/core';
import {
  CellBorders, ChildHostElement, ContainerElement, DocSection, ElementPatch, NewTemplateElement, PageSettings,
  TableCell, TableElement, TableRepeat, TemplateDoc, TemplateElement, ValidationField,
  ValidationFieldType, ValidationSpec, cloneWithNewIds, emptyCell,
  emptyTemplate, isChildHost, newId, normalizeTemplate, sectionPage,
} from '../../core/models/template.model';
import { setPath } from '../../core/utils/set-path';

/** 右鍵選單項目：sep = 分隔線 */
export type ContextMenuItem =
  | { kind: 'sep' }
  | {
      kind?: 'item';
      label: string;
      /** 顯示在右側的快捷鍵提示 */
      shortcut?: string;
      /** 開關類項目的勾選狀態 */
      checked?: boolean;
      disabled?: boolean;
      /** 破壞性動作（刪除）標紅 */
      danger?: boolean;
      run: () => void;
    };

@Injectable()
export class EditorStateService {
  readonly template = signal<TemplateDoc>(emptyTemplate());
  readonly selectedId = signal<string | null>(null);
  /** 多選集合（頂層元素）：含 primary（selectedId）；單選時 = [selectedId] */
  readonly selectedIds = signal<string[]>([]);
  readonly selectedCell = signal<{ row: number; col: number } | null>(null);
  /** 儲存格範圍選取（Shift+點選；合併儲存格用），錨點為 selectedCell */
  readonly selectedCellRange = signal<{ r1: number; c1: number; r2: number; c2: number } | null>(null);
  readonly zoom = signal(1.2);
  readonly dirty = signal(false);
  /** 嵌入填寫模式：只能改被標記 fillable 的欄位，不能動版面（值由 editor-page 從
   *  EmbedContextService 注入——本服務必須可直接 new，不得在內部 inject）。 */
  readonly fillMode = signal(false);
  /** 嵌入唯讀模式：什麼都不能改。 */
  readonly viewMode = signal(false);
  /** 受限模式（fill 或 view）：畫布不可拖曳/縮放/新增/刪除。 */
  readonly restricted = computed(() => this.fillMode() || this.viewMode());
  /** 該元素在目前模式下可否編輯內容：設計模式全可；填寫模式只有 fillable；唯讀一律否。 */
  canEditElement(el: { fillable?: boolean } | null | undefined): boolean {
    if (this.viewMode()) return false;
    if (!this.fillMode()) return true;
    return !!el?.fillable;
  }

  /**
   * 儲存格的內容可否編輯。**所有儲存格編輯入口都用這個**（畫布雙擊／屬性面板／setCellContent），
   * 否則各處各寫各的就會漏 —— 例如只檢查 fillable 卻沒檢查 kind：設計者「先勾可填、
   * 後把格子改成資料欄位」時 fillable 會殘留，雙擊就會把資料綁定 key 洩給填寫者。
   */
  canEditCell(cell: TableCell | null | undefined): boolean {
    if (!cell) return false;
    if (!this.restricted()) return true; // 設計模式：任何格都能編輯（text 改 value、placeholder 改 key）
    return cell.kind === 'text' && this.canEditElement(cell);
  }

  /** 元素的內容可否編輯（受限模式只放行已標記的 text 元素，與後端白名單一致）。 */
  canEditElementContent(el: TemplateElement | null | undefined): boolean {
    if (!el) return false;
    if (!this.restricted()) return true;
    return el.type === 'text' && this.canEditElement(el);
  }

  /**
   * 受限模式下 patchElement 是否放行：只有「已標記可填的 text 元素」且 patch **只含 content**。
   * 任何多帶一個欄位（例如順手改 x 或 fillable）都會落回一般規則被擋掉。
   */
  private isFillableContentPatch(id: string, patch: ElementPatch): boolean {
    const keys = Object.keys(patch);
    if (keys.length !== 1 || keys[0] !== 'content') return false;
    const el = this.findElement(id);
    return !!el && el.type === 'text' && this.canEditElement(el);
  }

  /**
   * 設定單一儲存格的內容值（畫布就地編輯用）。受限模式下只放行「可填的 text 格」，
   * 且只寫該格的 value/key —— 走這條而不是自組 cells 打 patchElement，才不會被守衛誤擋。
   */
  setCellContent(tableId: string, row: number, col: number, value: string) {
    const t = this.tableOf(tableId);
    const cell = t?.cells[row]?.[col];
    if (!t || !cell) return;
    const allowed = this.canEditCell(cell);
    const cells = t.cells.map((r, ri) => r.map((c, ci) => {
      if (ri !== row || ci !== col) return c;
      return c.kind === 'text' ? { ...c, value } : { ...c, key: value };
    }));
    this.applyElementPatch(tableId, { cells } as Partial<TableElement>, allowed);
  }

  /**
   * text 儲存格的富文字提交（value＋粗體一起寫）——設計模式限定。
   * 受限（fill）模式不走這裡：後端白名單只允許改 value，粗體是樣式。
   */
  setCellRich(tableId: string, row: number, col: number, value: string, bold: boolean, italic: boolean) {
    if (this.restricted()) return;
    const t = this.tableOf(tableId);
    const cell = t?.cells[row]?.[col];
    if (!t || !cell || cell.kind !== 'text') return;
    const cells = t.cells.map((r, ri) => r.map((c, ci) => {
      if (ri !== row || ci !== col) return c;
      return { ...c, value, bold, italic };
    }));
    this.applyElementPatch(tableId, { cells } as Partial<TableElement>, true);
  }

  /** 受限模式下 patchSelectedCells 是否放行：只改 value，且選取範圍內每一格都是可填的 text 格。 */
  private isFillableCellPatch(tableId: string, patch: Partial<TableCell>): boolean {
    const keys = Object.keys(patch);
    if (keys.length !== 1 || keys[0] !== 'value') return false;
    const el = this.findElement(tableId);
    if (!el || el.type !== 'table') return false;
    const b = this.selectedCellBounds();
    if (!b) return false;
    for (let r = b.r1; r <= b.r2; r++) {
      for (let c = b.c1; c <= b.c2; c++) {
        const cell = el.cells[r]?.[c];
        if (!this.canEditCell(cell)) return false;
      }
    }
    return true;
  }
  /** 預覽分頁的資料 JSON（跨分頁切換保留；存檔時併回文件的 sampleData） */
  readonly previewData = signal('');

  /** 畫布顯示變數原文：true = 不代入範例資料、直接顯示 {{key}}（一眼看出哪裡是變數）。工具列切換。 */
  readonly rawTokenView = signal(false);

  /** 筆間距預覽：調整重複區塊的 gap 時（scrub 拖曳或輸入框聚焦），
   *  畫布為該 list 畫出半透明的第 2、3 筆示意，看得出每筆會落在哪。存 list 元素 id。 */
  readonly gapPreview = signal<string | null>(null);

  /** 改設計期測試資料：同時標記未存檔，否則使用者貼完 JSON 直接離開會默默丟掉。 */
  setPreviewData(v: string) {
    if (this.previewData() === v) return;
    this.previewData.set(v);
    this.dirty.set(true);
  }

  /** 存檔用的完整樣板：把只存在畫面狀態的設計期測試資料併回文件。
   *  空字串不寫欄位（JSON.stringify 會略過 undefined），避免每張樣板都多一個空鍵。 */
  docForSave(): TemplateDoc {
    const t = this.template();
    const sample = this.previewData();
    return { ...t, sampleData: sample.trim() ? sample : undefined };
  }
  /** 尺規單位（左上角切換） */
  readonly rulerUnit = signal<'pt' | 'mm' | 'in'>('pt');
  /** 圖片上傳請求（editor-page 監聽並開檔案選擇器）：目標為某儲存格或某圖片元素 */
  readonly imagePickRequest = signal<{ tableId: string; r: number; c: number } | { elementId: string } | null>(null);

  /** 拖曳可進格子的既有元素（圖片/條碼）時，指標下的目標儲存格（畫布高亮＋放開時插入） */
  readonly elementDropCell = signal<{ tableId: string; r: number; c: number } | null>(null);

  /** 右鍵選單（viewport 座標；null = 關閉）。項目由觸發端組好丟進來 */
  readonly contextMenu = signal<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  openContextMenu(x: number, y: number, items: ContextMenuItem[]) {
    // 受限模式（嵌入 fill/view）：右鍵選單全是結構操作（刪除/複製/圖層/表格增刪列欄），
    // 點了本來就會被 record() 擋掉，直接不開才不會讓人以為能用。
    if (this.restricted()) return;
    this.contextMenu.set({ x, y, items });
  }

  closeContextMenu() {
    this.contextMenu.set(null);
  }

  // ---- 復原/重做：immutable 快照歷史 ----
  private history: TemplateDoc[] = [];
  private future: TemplateDoc[] = [];
  private lastRecord = 0;
  readonly undoCount = signal(0);
  readonly redoCount = signal(0);

  /**
   * 變更守衛 ＋ 快照。**所有會改到樣板的操作都必須先過這裡**（`if (!this.record()) return;`），
   * 這是前端唯一的變更 chokepoint —— 受限模式（嵌入 fill/view）在此一次擋掉所有結構性變更，
   * 不必在右鍵選單／快捷鍵／大綱／屬性面板逐點補判斷（漏一個就破功）。
   * fill 模式的「可填欄位內容值」是唯一例外，由呼叫端傳 allowInRestricted=true 放行。
   *
   * 快照本身：400ms 滑動視窗內的連續變更合併為同一步（拖曳一整段、連續打字都算一步）；
   * 有新變更時清空重做堆疊。
   *
   * @returns 是否放行本次變更
   */
  private record(allowInRestricted = false): boolean {
    if (this.restricted() && !allowInRestricted) return false;
    const now = Date.now();
    if (now - this.lastRecord < 400) {
      this.lastRecord = now;
      return true; // 併入前一步快照，變更仍放行
    }
    this.lastRecord = now;
    this.history.push(this.template());
    if (this.history.length > 100) this.history.shift();
    this.future = [];
    this.undoCount.set(this.history.length);
    this.redoCount.set(0);
    return true;
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.future.push(this.template());
    this.template.set(this.keepIdentity(prev));
    this.afterTimeTravel();
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(this.template());
    this.template.set(this.keepIdentity(next));
    this.afterTimeTravel();
  }

  /**
   * 復原/重做時保住 id 與 updatedAt：那是伺服器指派的身分，不是使用者編輯的內容。
   *
   * 快照存的是整份文件。新建樣板第一次存檔前的快照裡 id 是空的，退回那個快照就會
   * 把 id 弄丟 —— 下次按儲存變成「新建」，畫面毫無提示地生出**第二份樣板**，
   * 設計者以為還在編輯同一份，宿主拿到的 id 卻指向被遺棄的那一份。
   * （以前存檔會清空歷史，所以碰不到；改成保留歷史後才暴露出來。）
   */
  private keepIdentity(snap: TemplateDoc): TemplateDoc {
    const cur = this.template();
    if (snap.id === cur.id && snap.updatedAt === cur.updatedAt) return snap;
    return { ...snap, id: cur.id, updatedAt: cur.updatedAt };
  }

  private afterTimeTravel() {
    this.dirty.set(true);
    this.lastRecord = 0; // 下一個變更重新開一步
    this.undoCount.set(this.history.length);
    this.redoCount.set(this.future.length);
    // 選取/儲存格可能指向已不存在的東西
    if (this.selectedId() && !this.findElement(this.selectedId()!)) this.select(null);
    this.selectedCell.set(null);
    this.selectedCellRange.set(null);
  }

  cycleRulerUnit() {
    const order: ('pt' | 'mm' | 'in')[] = ['pt', 'mm', 'in'];
    this.rulerUnit.set(order[(order.indexOf(this.rulerUnit()) + 1) % order.length]);
  }

  // ---- 單位換算（模型永遠是 pt；輸入欄位依尺規單位顯示/輸入）----
  // 1 in = 72 pt = 25.4 mm。顯示捨入：mm 1 位、in 2 位、pt 原值；反算 pt 捨到 2 位避免長浮點。
  ptToDisp(pt: number): number {
    const u = this.rulerUnit();
    if (u === 'mm') return Math.round((pt / 72) * 25.4 * 10) / 10;
    if (u === 'in') return Math.round((pt / 72) * 100) / 100;
    return pt;
  }
  dispToPt(v: number): number {
    const u = this.rulerUnit();
    if (u === 'mm') return Math.round((v / 25.4) * 72 * 100) / 100;
    if (u === 'in') return Math.round(v * 72 * 100) / 100;
    return v;
  }
  /** 目前編輯的節 id（load 後預設第一節） */
  readonly activeSectionId = signal<string>('');

  /** 目前編輯的節 */
  readonly activeSection = computed<DocSection>(() => {
    const secs = this.template().sections;
    return secs.find(s => s.id === this.activeSectionId()) ?? secs[0];
  });

  /** 目前節的有效頁面設定（含節的紙張覆寫；single 節無 band） */
  readonly activePage = computed<PageSettings>(() =>
    sectionPage(this.template(), this.activeSection()));

  /** 目前節的頂層元素清單 */
  readonly visibleElements = computed<TemplateElement[]>(() => this.activeSection().elements);

  readonly selected = computed<TemplateElement | null>(() =>
    this.findElement(this.selectedId() ?? ''));

  /** 切換編輯的節（清掉選取，避免選著另一節的元素） */
  setActiveSection(id: string) {
    if (this.activeSectionId() !== id) this.select(null);
    this.activeSectionId.set(id);
  }

  /** 新增節（紙張複製文件預設）並切過去 */
  addSection(kind: 'flow' | 'single') {
    if (!this.record()) return;
    const base = this.template().page;
    const sec: DocSection = {
      id: newId(),
      name: kind === 'single' ? '獨立頁' : '內容節',
      kind,
      page: { size: base.size, orientation: base.orientation, width: base.width, height: base.height },
      // flow 節預設給可用的頁首/頁尾 band 高度（否則 band 顯示卻無空間，是新手陷阱）；single 節無 band
      headerHeight: kind === 'flow' ? 60 : 0,
      footerHeight: kind === 'flow' ? 40 : 0,
      watermarkMode: 'inherit', watermark: null, elements: [],
    };
    this.template.update(t => ({ ...t, sections: [...t.sections, sec] }));
    this.setActiveSection(sec.id);
    this.dirty.set(true);
  }

  /** 刪除節（至少保留一節） */
  removeSection(id: string) {
    const secs = this.template().sections;
    if (secs.length <= 1) return;
    if (!this.record()) return;
    this.template.update(t => ({ ...t, sections: t.sections.filter(s => s.id !== id) }));
    if (this.activeSectionId() === id) this.setActiveSection(this.template().sections[0].id);
    this.dirty.set(true);
  }

  patchSection(id: string, patch: Partial<DocSection>) {
    if (!this.record()) return;
    this.template.update(t => ({
      ...t,
      sections: t.sections.map(s => (s.id === id ? { ...s, ...patch } : s)),
    }));
    this.dirty.set(true);
  }

  /** 節排序：dir = -1 往前 / 1 往後 */
  moveSection(id: string, dir: -1 | 1) {
    const secs = [...this.template().sections];
    const i = secs.findIndex(s => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= secs.length) return;
    if (!this.record()) return;
    [secs[i], secs[j]] = [secs[j], secs[i]];
    this.template.update(t => ({ ...t, sections: secs }));
    this.dirty.set(true);
  }

  /** 節排序：把 id 移到 toIndex 位置（拖曳重排用） */
  reorderSection(id: string, toIndex: number) {
    const secs = [...this.template().sections];
    const from = secs.findIndex(s => s.id === id);
    const to = Math.max(0, Math.min(toIndex, secs.length - 1));
    if (from < 0 || from === to) return;
    if (!this.record()) return;
    const [moved] = secs.splice(from, 1);
    secs.splice(to, 0, moved);
    this.template.update(t => ({ ...t, sections: secs }));
    this.dirty.set(true);
  }

  /** 所有節的頂層清單 */
  private allLists(t: TemplateDoc): TemplateElement[][] {
    return t.sections.map(s => s.elements);
  }

  /** 對每一節的元素清單套同一個轉換（immutable） */
  private mapLists(t: TemplateDoc, fn: (els: TemplateElement[]) => TemplateElement[]): TemplateDoc {
    return { ...t, sections: t.sections.map(s => ({ ...s, elements: fn(s.elements) })) };
  }

  /** 元素（含任意深度子樹）所在的節 id；找不到時回目前節 */
  private listKeyOf(id: string): string {
    const hit = (els: TemplateElement[]): boolean => els.some(e =>
      e.id === id || (isChildHost(e) && hit(e.children)));
    for (const s of this.template().sections) {
      if (hit(s.elements)) return s.id;
    }
    return this.activeSection().id;
  }

  /** 元素的絕對座標（累加父容器鏈；頂層元素 = 自身座標）；找不到回 null */
  absPosOf(id: string): { x: number; y: number } | null {
    const el = this.findElement(id);
    if (!el) return null;
    let x = el.x, y = el.y;
    for (let p = this.parentOf(id); p; p = this.parentOf(p.id)) {
      x += p.x;
      y += p.y;
    }
    return { x, y };
  }

  /** 目前節的 id */
  private activeKey(): string {
    return this.activeSection().id;
  }

  /** 把元素加到指定節的頂層（immutable） */
  private pushTo(t: TemplateDoc, sectionId: string, el: TemplateElement): TemplateDoc {
    return {
      ...t,
      sections: t.sections.map(s => (s.id === sectionId ? { ...s, elements: [...s.elements, el] } : s)),
    };
  }

  /** 尋找元素（含容器子元素；涵蓋內頁/封面/封底） */
  findElement(id: string): TemplateElement | null {
    for (const list of this.allLists(this.template())) {
      for (const el of list) {
        if (el.id === id) return el;
        if (isChildHost(el)) {
          const child = this.findInChildren(el, id);
          if (child) return child;
        }
      }
    }
    return null;
  }

  /** 在容器/重複區塊的子樹遞迴尋找（支援 list 兩層巢狀） */
  private findInChildren(host: ChildHostElement, id: string): TemplateElement | null {
    for (const c of host.children) {
      if (c.id === id) return c;
      if (isChildHost(c)) {
        const deep = this.findInChildren(c, id);
        if (deep) return deep;
      }
    }
    return null;
  }

  /** 元素所屬容器/重複區塊；頂層元素回 null（支援 list 兩層巢狀） */
  parentOf(id: string): ChildHostElement | null {
    const scan = (els: TemplateElement[]): ChildHostElement | null => {
      for (const el of els) {
        if (isChildHost(el)) {
          if (el.children.some(c => c.id === id)) return el;
          const deep = scan(el.children);
          if (deep) return deep;
        }
      }
      return null;
    };
    for (const list of this.allLists(this.template())) {
      const hit = scan(list);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * 元素能否放進某容器型元素：
   *   - 非容器型元素 → 可進任何 container/list。
   *   - 重複區塊（list）→ 只能進「頂層的 list」形成兩層巢狀（上限）；不進 container、不進已巢狀 list。
   *   - container → 不進任何容器（維持單層）。
   */
  canNestInto(child: TemplateElement, host: ChildHostElement): boolean {
    if (!isChildHost(child)) return true;
    if (child.type === 'list' && host.type === 'list') return !this.parentOf(host.id);
    return false;
  }

  load(doc: TemplateDoc) {
    // 正規化（immutable）：補齊舊樣板缺欄位，不修改呼叫者的物件
    const norm = normalizeTemplate(doc);
    this.template.set(norm);
    // 設計期測試資料跟著樣板回來。之前它只活在記憶體，重整就默默變回內建預設，
    // 使用者貼的 JSON 全丟；而且「欄位（拖到畫布）」清單是從這份資料推的，
    // 空字串 → 清單整個不出現，看起來像功能不存在。
    this.previewData.set(norm.sampleData ?? '');
    this.selectedId.set(null);
    this.selectedCell.set(null);
    this.activeSectionId.set(this.template().sections[0].id);
    this.dirty.set(false);
    this.history = [];
    this.future = [];
    this.lastRecord = 0;
    this.undoCount.set(0);
    this.redoCount.set(0);
  }

  /**
   * 存檔成功後同步伺服器指派的 id／updatedAt，**不重載整份文件**。
   *
   * 之前走 load()，於是每按一次儲存就清空復原歷史、取消選取、跳回第一節——
   * 存完才發現改錯就再也退不回去。儲存是 raw JSON passthrough，回應與送出的內容
   * 只差 id 與 updatedAt，沒有理由重建整個編輯狀態。
   */
  markSaved(saved: TemplateDoc) {
    this.template.update(t => ({ ...t, id: saved.id, updatedAt: saved.updatedAt }));
    this.dirty.set(false);
  }

  select(id: string | null) {
    if (this.selectedId() !== id) {
      this.selectedCell.set(null);
      this.selectedCellRange.set(null);
    }
    this.selectedId.set(id);
    this.selectedIds.set(id ? [id] : []);
  }

  /** Shift+點選：加入/移除多選集合（primary 設為該元素）；只限頂層元素 */
  toggleSelect(id: string) {
    const cur = this.selectedIds();
    if (cur.includes(id)) {
      const next = cur.filter(x => x !== id);
      this.selectedIds.set(next);
      this.selectedId.set(next.length ? next[next.length - 1] : null);
    } else {
      this.selectedIds.set([...cur, id]);
      this.selectedId.set(id);
    }
    this.selectedCell.set(null);
    this.selectedCellRange.set(null);
  }

  /** 框選：設定多選集合（primary = 最後一個）；空陣列 = 取消選取 */
  selectMany(ids: string[]) {
    this.selectedIds.set(ids);
    this.selectedId.set(ids.length ? ids[ids.length - 1] : null);
    this.selectedCell.set(null);
    this.selectedCellRange.set(null);
  }

  /** 目前多選的頂層元素（過濾掉找不到/非頂層的） */
  private selectedTopElements(): TemplateElement[] {
    const top = this.visibleElements();
    return this.selectedIds()
      .map(id => top.find(e => e.id === id))
      .filter((e): e is TemplateElement => !!e);
  }

  /**
   * 對齊選取的頂層元素（相對選取整體的 bounding box）。
   * 2 個以上才有意義；鎖定元素跳過。
   */
  alignSelected(edge: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
    const els = this.selectedTopElements().filter(e => !e.locked);
    if (els.length < 2) return;
    const minX = Math.min(...els.map(e => e.x));
    const maxX = Math.max(...els.map(e => e.x + e.width));
    const minY = Math.min(...els.map(e => e.y));
    const maxY = Math.max(...els.map(e => e.y + e.height));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    if (!this.record()) return;
    this.template.update(t => this.mapLists(t, list => list.map(e => {
      if (!this.selectedIds().includes(e.id) || e.locked) return e;
      switch (edge) {
        case 'left': return { ...e, x: Math.round(minX) };
        case 'right': return { ...e, x: Math.round(maxX - e.width) };
        case 'hcenter': return { ...e, x: Math.round(cx - e.width / 2) };
        case 'top': return { ...e, y: Math.round(minY) };
        case 'bottom': return { ...e, y: Math.round(maxY - e.height) };
        case 'vcenter': return { ...e, y: Math.round(cy - e.height / 2) };
      }
    })));
    this.dirty.set(true);
  }

  /**
   * 分佈：依中心等距排列（3 個以上）；首尾中心固定，中間等分。鎖定元素跳過。
   */
  distributeSelected(axis: 'h' | 'v') {
    const els = this.selectedTopElements().filter(e => !e.locked);
    if (els.length < 3) return;
    const center = (e: TemplateElement) => axis === 'h' ? e.x + e.width / 2 : e.y + e.height / 2;
    const sorted = [...els].sort((a, b) => center(a) - center(b));
    const first = center(sorted[0]);
    const last = center(sorted[sorted.length - 1]);
    const step = (last - first) / (sorted.length - 1);
    const target = new Map<string, number>();
    sorted.forEach((e, i) => target.set(e.id, first + step * i));
    if (!this.record()) return;
    this.template.update(t => this.mapLists(t, list => list.map(e => {
      const c = target.get(e.id);
      if (c === undefined || e.locked) return e;
      return axis === 'h'
        ? { ...e, x: Math.round(c - e.width / 2) }
        : { ...e, y: Math.round(c - e.height / 2) };
    })));
    this.dirty.set(true);
  }

  /** 一起移動多選元素（拖曳用）：對每個選取的頂層元素套用 dx/dy。
   *  record 的 400ms 節流會把連續拖曳合併成一步 undo。 */
  moveSelectedBy(origins: Map<string, { x: number; y: number }>, dx: number, dy: number) {
    if (!this.record()) return;
    this.template.update(t => this.mapLists(t, list => list.map(e => {
      const o = origins.get(e.id);
      if (!o) return e;
      return { ...e, x: Math.max(0, Math.round(o.x + dx)), y: Math.max(0, Math.round(o.y + dy)) };
    })));
    this.dirty.set(true);
  }

  /** 刪除多選的所有頂層元素（一步 undo） */
  removeSelected() {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    if (!this.record()) return;
    this.template.update(t => this.mapLists(t, list => list.filter(e => !ids.includes(e.id))));
    this.select(null);
    this.dirty.set(true);
  }

  /**
   * 目前選取範圍能不能合併：回傳阻擋原因（null = 可合併）。純判斷、不變更狀態，
   * 供合併按鈕 [disabled]/[title] 與 mergeSelectedCells 共用。
   */
  mergeSelectionError(tableId: string): string | null {
    const el = this.findElement(tableId);
    const range = this.selectedCellRange();
    if (!el || el.type !== 'table' || !range) return '先框出範圍（點一格再 Shift+點另一格）';
    const r1 = Math.min(range.r1, range.r2);
    const r2 = Math.max(range.r1, range.r2);
    const c1 = Math.min(range.c1, range.c2);
    const c2 = Math.max(range.c1, range.c2);
    if (r1 === r2 && c1 === c2) return '範圍只有一格，無可合併';
    const rep = el.repeat;
    if (rep?.enabled && r1 !== r2) {
      const special = [rep.rowIndex, rep.groupHeaderRowIndex, rep.groupFooterRowIndex]
        .filter((v): v is number => v != null);
      if (special.some(sr => sr >= r1 && sr <= r2)) {
        return '不可跨重複列/群組列（重複列內只能左右合併）';
      }
    }
    return null;
  }

  /** 合併選取範圍的儲存格；回傳錯誤訊息（null = 成功）。範圍不可跨到重複/群組列邊界 */
  mergeSelectedCells(tableId: string): string | null {
    const err = this.mergeSelectionError(tableId);
    if (err) return err;
    const el = this.findElement(tableId) as TableElement;
    const range = this.selectedCellRange()!;
    const r1 = Math.min(range.r1, range.r2);
    const r2 = Math.max(range.r1, range.r2);
    const c1 = Math.min(range.c1, range.c2);
    const c2 = Math.max(range.c1, range.c2);
    const cells = el.cells.map((row, r) => row.map((cell, c) => {
      if (r < r1 || r > r2 || c < c1 || c > c2) return cell;
      if (r === r1 && c === c1) return { ...cell, colSpan: c2 - c1 + 1, rowSpan: r2 - r1 + 1 };
      return { ...cell, colSpan: 1, rowSpan: 1 };
    }));
    this.patchElement(tableId, { cells } as Partial<TableElement>);
    this.selectedCell.set({ row: r1, col: c1 });
    this.selectedCellRange.set(null);
    this.dirty.set(true);
    return null;
  }

  /** 取消合併（把該格的 span 還原成 1×1） */
  unmergeCell(tableId: string, row: number, col: number) {
    const el = this.findElement(tableId);
    if (!el || el.type !== 'table') return;
    const cells = el.cells.map((r, ri) => r.map((cell, ci) =>
      ri === row && ci === col ? { ...cell, colSpan: 1, rowSpan: 1 } : cell));
    this.patchElement(tableId, { cells } as Partial<TableElement>);
    this.dirty.set(true);
  }

  setName(name: string) {
    if (!this.record()) return;
    this.template.update(t => ({ ...t, name }));
    this.dirty.set(true);
  }

  patchPage(patch: Partial<TemplateDoc['page']>) {
    if (!this.record()) return;
    this.template.update(t => ({ ...t, page: { ...t.page, ...patch } }));
    this.dirty.set(true);
  }

  /** 允許匿名渲染開關（文件層級；false 時不落欄位、樣板 JSON 保持乾淨） */
  setAllowAnonymousRender(on: boolean) {
    if (!this.record()) return;
    this.template.update(t => ({ ...t, allowAnonymousRender: on ? true : undefined }));
    this.dirty.set(true);
  }

  /** 新增元素；目前選著容器（或其子元素）時，加入該容器（座標轉為容器相對） */
  addElement(el: NewTemplateElement) {
    if (!this.record()) return;
    const withId = { ...el, id: newId() } as TemplateElement;
    const sel = this.selected();
    const target = sel
      ? (isChildHost(sel) ? sel : this.parentOf(sel.id))
      : null;
    if (target && this.canNestInto(withId, target)) {
      withId.x = 8;
      // 排在既有子元素下方，避免疊在一起
      withId.y = target.children.length
        ? Math.max(...target.children.map(c => c.y + c.height)) + 6
        : 8;
      this.patchElement(target.id, {
        children: [...target.children, withId],
      } as Partial<ContainerElement>);
    } else {
      // 自動排位：放在內容區既有元素的下方，避免疊在一起（獨立頁 = 整頁可用）
      const page = this.activePage();
      const contentTop = page.headerHeight;
      const contentBottom = page.height - page.footerHeight;
      const bodyBottoms = this.visibleElements()
        .filter(e => e.y >= contentTop && e.y < contentBottom)
        .map(e => e.y + e.height);
      if (bodyBottoms.length) {
        const nextY = Math.max(...bodyBottoms) + 10;
        if (nextY + withId.height <= contentBottom) {
          withId.y = nextY;
        } else {
          // 內容區排滿了：以階梯狀錯開，**不要**沿用工廠預設座標。
          // 原本會落回同一點，於是連點第 7、8、9 次時畫面完全沒變化，
          // 使用者以為沒加到而重複點，最後留下一堆看不見的重疊欄位
          // ——在財務單據上就是隱形的重複欄位。
          const step = 12;
          const taken = new Set(this.visibleElements().map(e => `${Math.round(e.x)},${Math.round(e.y)}`));
          let x = 40, y = contentTop + 20;
          for (let i = 0; i < 40 && taken.has(`${x},${y}`); i++) { x += step; y += step; }
          withId.x = x;
          withId.y = Math.min(y, Math.max(contentTop, contentBottom - withId.height));
        }
      }
      this.template.update(t => this.pushTo(t, this.activeKey(), withId));
    }
    this.select(withId.id);
    this.dirty.set(true);
  }

  /** 在指定座標新增元素（拖放用，不做自動排位）；給 containerId 時放進容器（x/y 視為容器相對座標） */
  addElementAt(el: NewTemplateElement, x: number, y: number, containerId?: string) {
    if (!this.record()) return;
    const withId = { ...el, id: newId() } as TemplateElement;
    const container = containerId ? this.findElement(containerId) : null;
    if (container && isChildHost(container) && this.canNestInto(withId, container)) {
      withId.x = Math.round(Math.max(0, Math.min(Math.max(0, container.width - withId.width), x)));
      withId.y = Math.round(Math.max(0, Math.min(Math.max(0, container.height - withId.height), y)));
      this.patchElement(container.id, {
        children: [...container.children, withId],
      } as Partial<ContainerElement>);
    } else {
      withId.x = Math.round(Math.max(0, x));
      withId.y = Math.round(Math.max(0, y));
      this.template.update(t => this.pushTo(t, this.activeKey(), withId));
    }
    this.select(withId.id);
    this.dirty.set(true);
  }

  patchElement(id: string, patch: ElementPatch) {
    // 受限模式唯一的放行通道：改「已標記可填元素」的 content（且只有 content 這一個欄位）
    this.applyElementPatch(id, patch, this.isFillableContentPatch(id, patch));
  }

  /** patchElement 的內部實作；allowInRestricted 由呼叫端依「是否為可填欄位的內容值」判定。 */
  private applyElementPatch(id: string, patch: ElementPatch, allowInRestricted: boolean) {
    if (!this.record(allowInRestricted)) return;
    const mapEl = (e: TemplateElement): TemplateElement => {
      if (e.id === id) return { ...e, ...patch } as TemplateElement;
      // 遞迴進 container/list 子樹（支援 list 兩層巢狀）；無匹配時 map 原樣回傳
      if (isChildHost(e)) {
        return { ...e, children: e.children.map(mapEl) };
      }
      return e;
    };
    this.template.update(t => this.mapLists(t, els => els.map(mapEl)));
    this.dirty.set(true);
  }

  removeElement(id: string) {
    if (!this.record()) return;
    // 遞迴移除（支援 container / list 巢狀子樹）
    const strip = (els: TemplateElement[]): TemplateElement[] => els
      .filter(e => e.id !== id)
      .map(e => (isChildHost(e) ? { ...e, children: strip(e.children) } as TemplateElement : e));
    this.template.update(t => this.mapLists(t, strip));
    if (this.selectedId() === id) this.select(null);
    this.dirty.set(true);
  }

  /** 把容器/list 子元素移到頂層（座標轉絕對；留在其所在的那一節）。支援任意深度巢狀。 */
  moveOutOfContainer(id: string) {
    const parent = this.parentOf(id);
    const el = this.findElement(id);
    const abs = this.absPosOf(id);
    if (!parent || !el || !abs) return;
    if (!this.record()) return;
    const listKey = this.listKeyOf(id);
    const moved = { ...el, x: abs.x, y: abs.y } as TemplateElement;
    // 從任意深度子樹遞迴移除，再放到節頂層
    const strip = (els: TemplateElement[]): TemplateElement[] => els
      .filter(e => e.id !== id)
      .map(e => (isChildHost(e) ? { ...e, children: strip(e.children) } as TemplateElement : e));
    this.template.update(t => this.pushTo(this.mapLists(t, strip), listKey, moved));
    this.select(id);
    this.dirty.set(true);
  }

  /** 內部剪貼簿（Ctrl+C/V/X）；存絕對座標，貼上時再換算 */
  private clipboard: TemplateElement | null = null;

  /** 複製到剪貼簿（容器子元素轉為絕對座標） */
  copyElement(id: string) {
    const el = this.findElement(id);
    if (!el) return;
    const parent = this.parentOf(id);
    this.clipboard = structuredClone({
      ...el,
      x: parent ? parent.x + el.x : el.x,
      y: parent ? parent.y + el.y : el.y,
    }) as TemplateElement;
  }

  /** 貼上：偏移 12pt；目前選著容器（或其子元素）時貼進該容器 */
  paste() {
    if (!this.clipboard) return;
    if (!this.record()) return;
    const copy = cloneWithNewIds(this.clipboard);
    const sel = this.selected();
    const target = sel
      ? (isChildHost(sel) ? sel : this.parentOf(sel.id))
      : null;
    if (target && !isChildHost(copy)) {
      copy.x = Math.round(Math.max(0, Math.min(Math.max(0, target.width - copy.width), copy.x - target.x + 12)));
      copy.y = Math.round(Math.max(0, Math.min(Math.max(0, target.height - copy.height), copy.y - target.y + 12)));
      this.patchElement(target.id, {
        children: [...target.children, copy],
      } as Partial<ContainerElement>);
    } else {
      copy.x += 12;
      copy.y += 12;
      // 頂層貼到目前編輯中的頁面（可跨封面/內頁/封底複製貼上）
      this.template.update(t => this.pushTo(t, this.activeKey(), copy));
    }
    // 連續貼上階梯狀排開
    this.clipboard = { ...this.clipboard, x: this.clipboard.x + 12, y: this.clipboard.y + 12 } as TemplateElement;
    this.select(copy.id);
    this.dirty.set(true);
  }

  /** 剪貼簿是否有東西（右鍵選單「貼上」的啟用狀態） */
  hasClipboard(): boolean {
    return this.clipboard !== null;
  }

  /** 貼在指定座標（右鍵空白畫布用；頂層、目前節） */
  pasteAt(x: number, y: number) {
    if (!this.clipboard) return;
    if (!this.record()) return;
    const copy = cloneWithNewIds(this.clipboard);
    copy.x = Math.round(Math.max(0, x));
    copy.y = Math.round(Math.max(0, y));
    this.template.update(t => this.pushTo(t, this.activeKey(), copy));
    this.select(copy.id);
    this.dirty.set(true);
  }

  /**
   * 圖層順序（同一層清單內移動；晚畫的在上層）：
   * up/down 移一層、front/back 移到最上/最下層。容器子元素在容器內移動。
   */
  /** 鎖定切換（純編輯器：畫布不可選/拖）；鎖定時清掉選取避免殘留 handle */
  toggleLocked(id: string) {
    const el = this.findElement(id);
    if (!el) return;
    const locked = !el.locked;
    this.patchElement(id, { locked: locked || undefined });
    if (locked && this.selectedId() === id) this.select(null);
  }

  /** 隱藏切換（設計＋渲染都不顯示）；隱藏時清掉選取 */
  toggleHidden(id: string) {
    const el = this.findElement(id);
    if (!el) return;
    const hidden = !el.hidden;
    this.patchElement(id, { hidden: hidden || undefined });
    if (hidden && this.selectedId() === id) this.select(null);
  }

  moveLayer(id: string, action: 'up' | 'down' | 'front' | 'back') {
    const reorder = (list: TemplateElement[]): TemplateElement[] | null => {
      const i = list.findIndex(e => e.id === id);
      if (i < 0) return null;
      const out = [...list];
      const [el] = out.splice(i, 1);
      const at = action === 'front' ? out.length
        : action === 'back' ? 0
        : action === 'up' ? Math.min(out.length, i + 1)
        : Math.max(0, i - 1);
      if (at === i && action !== 'front' && action !== 'back') return null;
      out.splice(at, 0, el);
      return out;
    };
    const parent = this.parentOf(id);
    if (parent) {
      const children = reorder(parent.children);
      if (children) this.patchElement(parent.id, { children } as Partial<ContainerElement>);
      return;
    }
    if (!this.record()) return;
    this.template.update(t => this.mapLists(t, els => reorder(els) ?? els));
    this.dirty.set(true);
  }

  /** 元素在其所屬清單（節頂層或容器內）的圖層位置：0 = 最下層 */
  layerPositionOf(id: string): { index: number; count: number } | null {
    const parent = this.parentOf(id);
    const list = parent ? parent.children : this.template().sections.find(s =>
      s.elements.some(e => e.id === id))?.elements;
    if (!list) return null;
    const index = list.findIndex(e => e.id === id);
    return index < 0 ? null : { index, count: list.length };
  }

  /** 把元素移進容器型元素（container / 重複區塊 list；座標轉為相對並夾在範圍內）。
   *  是否允許由 canNestInto 決定（container 不巢狀；list 只進頂層 list 成兩層）。 */
  moveIntoContainer(id: string, containerId: string) {
    const el = this.findElement(id);
    const container = this.findElement(containerId);
    if (!el || !container || !isChildHost(container) || !this.canNestInto(el, container) || id === containerId) return;
    if (this.parentOf(id)?.id === containerId) return;
    const elAbs = this.absPosOf(id);
    const hostAbs = this.absPosOf(containerId);
    if (!elAbs || !hostAbs) return;
    if (!this.record()) return;
    // 目標容器可能是巢狀 list（座標相對外層）→ 用絕對座標鏈換算相對位置
    const moved = {
      ...el,
      x: Math.round(Math.max(0, Math.min(Math.max(0, container.width - el.width), elAbs.x - hostAbs.x))),
      y: Math.round(Math.max(0, Math.min(Math.max(0, container.height - el.height), elAbs.y - hostAbs.y))),
    } as TemplateElement;
    // 從任意位置（頂層或某容器/list 的子樹）移除 id，並插入到 containerId 的 children
    const relocate = (list: TemplateElement[]): TemplateElement[] => list
      .filter(e => e.id !== id)
      .map(e => {
        if (!isChildHost(e)) return e;
        let children = relocate(e.children);
        if (e.id === containerId) children = [...children, moved];
        return { ...e, children } as TemplateElement;
      });
    this.template.update(t => this.mapLists(t, relocate));
    this.select(id);
    this.dirty.set(true);
  }

  /** 複製元素（容器含整組子元素）；副本偏移 12pt 並選取 */
  duplicateElement(id: string) {
    const el = this.findElement(id);
    if (!el) return;
    if (!this.record()) return;
    const copy = cloneWithNewIds(el);
    copy.x += 12;
    copy.y += 12;
    const parent = this.parentOf(id);
    if (parent) {
      this.patchElement(parent.id, {
        children: [...parent.children, copy],
      } as Partial<ContainerElement>);
    } else {
      // 副本留在原元素所在的頁面
      this.template.update(t => this.pushTo(t, this.listKeyOf(id), copy));
    }
    this.select(copy.id);
    this.dirty.set(true);
  }

  /** 調整表格列/欄數，同步 cells 結構。 */
  resizeTable(id: string, rows: number, cols: number) {
    const el = this.findElement(id);
    if (!el || el.type !== 'table') return;
    const t = el as TableElement;
    const rowHeights = Array.from({ length: rows }, (_, i) => t.rowHeights[i] ?? 24);
    const columnWidths = Array.from({ length: cols }, (_, i) => t.columnWidths[i] ?? 90);
    // 縮減時把跨到新邊界外的合併跨度夾回，避免殘留越界 colSpan/rowSpan
    const cells = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => {
        const cell = t.cells[r]?.[c] ?? emptyCell();
        const colSpan = cell.colSpan && cell.colSpan > 1 ? Math.min(cell.colSpan, cols - c) : cell.colSpan;
        const rowSpan = cell.rowSpan && cell.rowSpan > 1 ? Math.min(cell.rowSpan, rows - r) : cell.rowSpan;
        return colSpan !== cell.colSpan || rowSpan !== cell.rowSpan ? { ...cell, colSpan, rowSpan } : cell;
      }));
    // 重複列/群組列索引若被縮到範圍外 → 關閉/清掉，避免產生「明細靜默消失」的樣板
    let repeat = t.repeat;
    if (repeat) {
      const inRange = (v: number | null | undefined): v is number => v != null && v >= 0 && v < rows;
      repeat = {
        ...repeat,
        enabled: repeat.enabled && inRange(repeat.rowIndex),
        rowIndex: inRange(repeat.rowIndex) ? repeat.rowIndex : 0,
        groupHeaderRowIndex: inRange(repeat.groupHeaderRowIndex) ? repeat.groupHeaderRowIndex : null,
        groupFooterRowIndex: inRange(repeat.groupFooterRowIndex) ? repeat.groupFooterRowIndex : null,
      };
    }
    this.patchElement(id, {
      rowHeights, columnWidths, cells, repeat,
      width: columnWidths.reduce((a, b) => a + b, 0),
      height: rowHeights.reduce((a, b) => a + b, 0),
    } as Partial<TableElement>);
  }

  /** 找表格元素（表格結構操作的共用前置） */
  private tableOf(id: string): TableElement | null {
    const el = this.findElement(id);
    return el?.type === 'table' ? el : null;
  }

  /** 在 at 位置前插入一列（列高複製相鄰列；跨越插入點的合併格自動加高一格） */
  insertTableRow(tableId: string, at: number) {
    const t = this.tableOf(tableId);
    if (!t || at < 0 || at > t.cells.length) return;
    const cols = t.columnWidths.length;
    const rowHeights = [...t.rowHeights];
    rowHeights.splice(at, 0, t.rowHeights[Math.min(Math.max(at - 1, 0), t.rowHeights.length - 1)] ?? 24);
    const cells = t.cells.map((row, r) => row.map(cell => {
      const rs = cell.rowSpan ?? 1;
      return rs > 1 && r < at && r + rs > at ? { ...cell, rowSpan: rs + 1 } : cell;
    }));
    cells.splice(at, 0, Array.from({ length: cols }, () => emptyCell()));
    // 重複列/群組列索引在插入點之後的往下推
    const shift = (v: number | null | undefined) => (v != null && v >= at ? v + 1 : v);
    const repeat = t.repeat ? {
      ...t.repeat,
      rowIndex: shift(t.repeat.rowIndex) as number,
      groupHeaderRowIndex: shift(t.repeat.groupHeaderRowIndex),
      groupFooterRowIndex: shift(t.repeat.groupFooterRowIndex),
    } : t.repeat;
    this.patchElement(tableId, {
      cells, rowHeights, repeat,
      height: rowHeights.reduce((a, b) => a + b, 0),
    } as Partial<TableElement>);
  }

  /** 刪除一列（至少留一列）。跨此列的合併格縮一格；合併錨點被刪時內容下移到次列 */
  removeTableRow(tableId: string, at: number) {
    const t = this.tableOf(tableId);
    if (!t || t.cells.length <= 1 || at < 0 || at >= t.cells.length) return;
    const rowHeights = t.rowHeights.filter((_, r) => r !== at);
    const cells = t.cells.map(row => row.map(cell => ({ ...cell })));
    for (let r = 0; r < cells.length; r++) {
      for (let c = 0; c < cells[r].length; c++) {
        const rs = cells[r][c].rowSpan ?? 1;
        if (rs <= 1) continue;
        if (r < at && r + rs > at) {
          cells[r][c].rowSpan = rs - 1;
        } else if (r === at && r + 1 < cells.length) {
          // 錨點列被刪：內容搬到合併範圍的下一列，跨度縮一
          cells[r + 1][c] = { ...cells[r][c], rowSpan: rs - 1 };
        }
      }
    }
    cells.splice(at, 1);
    const shift = (v: number | null | undefined) => (v != null && v > at ? v - 1 : v);
    let repeat = t.repeat;
    if (repeat) {
      repeat = {
        ...repeat,
        // 重複列本體被刪 = 取消重複；群組列被刪 = 清掉該群組列
        enabled: repeat.rowIndex === at ? false : repeat.enabled,
        rowIndex: repeat.rowIndex === at ? 0 : (shift(repeat.rowIndex) as number),
        groupHeaderRowIndex: repeat.groupHeaderRowIndex === at ? null : shift(repeat.groupHeaderRowIndex),
        groupFooterRowIndex: repeat.groupFooterRowIndex === at ? null : shift(repeat.groupFooterRowIndex),
      };
    }
    this.selectedCell.set(null);
    this.selectedCellRange.set(null);
    this.patchElement(tableId, {
      cells, rowHeights, repeat,
      height: rowHeights.reduce((a, b) => a + b, 0),
    } as Partial<TableElement>);
  }

  /** 在 at 位置前插入一欄（欄寬複製相鄰欄；跨越插入點的合併格自動加寬一格） */
  insertTableCol(tableId: string, at: number) {
    const t = this.tableOf(tableId);
    if (!t || at < 0 || at > t.columnWidths.length) return;
    const columnWidths = [...t.columnWidths];
    columnWidths.splice(at, 0, t.columnWidths[Math.min(Math.max(at - 1, 0), t.columnWidths.length - 1)] ?? 90);
    const cells = t.cells.map(row => {
      const out = row.map((cell, c) => {
        const cs = cell.colSpan ?? 1;
        return cs > 1 && c < at && c + cs > at ? { ...cell, colSpan: cs + 1 } : cell;
      });
      out.splice(at, 0, emptyCell());
      return out;
    });
    this.patchElement(tableId, {
      cells, columnWidths,
      width: columnWidths.reduce((a, b) => a + b, 0),
    } as Partial<TableElement>);
  }

  /** 刪除一欄（至少留一欄）。跨此欄的合併格縮一格；合併錨點被刪時內容右移到次欄 */
  removeTableCol(tableId: string, at: number) {
    const t = this.tableOf(tableId);
    if (!t || t.columnWidths.length <= 1 || at < 0 || at >= t.columnWidths.length) return;
    const columnWidths = t.columnWidths.filter((_, c) => c !== at);
    const cells = t.cells.map(row => {
      const out = row.map(cell => ({ ...cell }));
      for (let c = 0; c < out.length; c++) {
        const cs = out[c].colSpan ?? 1;
        if (cs <= 1) continue;
        if (c < at && c + cs > at) {
          out[c].colSpan = cs - 1;
        } else if (c === at && c + 1 < out.length) {
          out[c + 1] = { ...out[c], colSpan: cs - 1 };
        }
      }
      out.splice(at, 1);
      return out;
    });
    this.selectedCell.set(null);
    this.selectedCellRange.set(null);
    this.patchElement(tableId, {
      cells, columnWidths,
      width: columnWidths.reduce((a, b) => a + b, 0),
    } as Partial<TableElement>);
  }

  /** 重複列開關：該列已是重複列 → 取消；否則把重複列設到該列（保留 key/群組設定） */
  toggleRepeatRow(tableId: string, row: number) {
    const t = this.tableOf(tableId);
    if (!t) return;
    const rep = t.repeat;
    const repeat: TableRepeat = rep?.enabled && rep.rowIndex === row
      ? { ...rep, enabled: false }
      : {
          enabled: true,
          key: rep?.key ?? '',
          rowIndex: row,
          groupBy: rep?.groupBy,
          groupHeaderRowIndex: rep?.groupHeaderRowIndex ?? null,
          groupFooterRowIndex: rep?.groupFooterRowIndex ?? null,
        };
    this.patchElement(tableId, { repeat } as Partial<TableElement>);
  }

  /** 目前選取的儲存格範圍（無 Shift 框選時 = 單格）；未選格回 null */
  selectedCellBounds(): { r1: number; r2: number; c1: number; c2: number } | null {
    const sc = this.selectedCell();
    if (!sc) return null;
    const range = this.selectedCellRange();
    if (!range) return { r1: sc.row, r2: sc.row, c1: sc.col, c2: sc.col };
    return {
      r1: Math.min(range.r1, range.r2), r2: Math.max(range.r1, range.r2),
      c1: Math.min(range.c1, range.c2), c2: Math.max(range.c1, range.c2),
    };
  }

  /** 批次修改選取範圍內的所有儲存格（多格選取一次改樣式）；無範圍時只改選取格 */
  patchSelectedCells(tableId: string, patch: Partial<TableCell>) {
    const t = this.tableOf(tableId);
    const b = this.selectedCellBounds();
    if (!t || !b) return;
    const cells = t.cells.map((row, r) => row.map((cell, c) =>
      r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2 ? { ...cell, ...patch } : cell));
    // 受限模式：只有「改可填 text 格的 value」放行（判定用原始 patch，不是展開後的 cells）
    this.applyElementPatch(tableId, { cells } as Partial<TableElement>, this.isFillableCellPatch(tableId, patch));
  }

  /**
   * 選取範圍某一側的框線目前是否顯示（Word 式：共用線任一側有開就會畫）。
   * 供框線按鈕顯示狀態與 toggle 判斷。
   */
  selectionEdgeOn(tableId: string, edge: keyof CellBorders): boolean {
    const t = this.tableOf(tableId);
    const b = this.selectedCellBounds();
    if (!t || !b) return true;
    const own = (r: number, c: number, e: keyof CellBorders) =>
      t.cells[r]?.[c]?.borders ? t.cells[r][c].borders![e] : true;
    const cellsOnEdge: [number, number][] = [];
    if (edge === 'top') for (let c = b.c1; c <= b.c2; c++) cellsOnEdge.push([b.r1, c]);
    if (edge === 'bottom') for (let c = b.c1; c <= b.c2; c++) cellsOnEdge.push([b.r2, c]);
    if (edge === 'left') for (let r = b.r1; r <= b.r2; r++) cellsOnEdge.push([r, b.c1]);
    if (edge === 'right') for (let r = b.r1; r <= b.r2; r++) cellsOnEdge.push([r, b.c2]);
    return cellsOnEdge.every(([r, c]) => {
      if (own(r, c, edge)) return true;
      // 鄰格面向這條線的那側
      switch (edge) {
        case 'top': return r > 0 && own(r - 1, c, 'bottom');
        case 'bottom': return r < t.cells.length - 1 && own(r + 1, c, 'top');
        case 'left': return c > 0 && own(r, c - 1, 'right');
        default: return c < t.columnWidths.length - 1 && own(r, c + 1, 'left');
      }
    });
  }

  /** 選取範圍內的儲存格是否全都有指定斜線（斜線按鈕的顯示/toggle 狀態） */
  selectionDiagOn(tableId: string, which: 'diagDown' | 'diagUp'): boolean {
    const t = this.tableOf(tableId);
    const b = this.selectedCellBounds();
    if (!t || !b) return false;
    for (let r = b.r1; r <= b.r2; r++) {
      for (let c = b.c1; c <= b.c2; c++) {
        if (!t.cells[r]?.[c]?.borders?.[which]) return false;
      }
    }
    return true;
  }

  /**
   * 對選取範圍套框線動作（Word 式）：
   * top/bottom/left/right = 切換範圍該側邊線；none/all = 全關/全開；
   * outer = 開範圍外框；inner = 開範圍內部格線；
   * diagDown/diagUp = 切換斜線 ╲╱（逐格，無共用線問題）。
   * 邊線一律同步鏡射相鄰格的同一條線——兩側一致，線才會真的消失。
   */
  applyCellBorders(tableId: string, action: 'top' | 'bottom' | 'left' | 'right' | 'none' | 'all' | 'outer' | 'inner' | 'diagDown' | 'diagUp') {
    const t = this.tableOf(tableId);
    const b = this.selectedCellBounds();
    if (!t || !b) return;
    const full = (): CellBorders => ({ top: true, right: true, bottom: true, left: true });
    const cells = t.cells.map(row => row.map(cell =>
      ({ ...cell, borders: cell.borders ? { ...cell.borders } : full() })));
    const set = (r: number, c: number, edge: keyof CellBorders, val: boolean) => {
      const cell = cells[r]?.[c];
      if (cell) cell.borders[edge] = val;
      const [nr, nc, ne]: [number, number, keyof CellBorders] =
        edge === 'top' ? [r - 1, c, 'bottom']
        : edge === 'bottom' ? [r + 1, c, 'top']
        : edge === 'left' ? [r, c - 1, 'right']
        : [r, c + 1, 'left'];
      const n = cells[nr]?.[nc];
      if (n) n.borders[ne] = val;
    };
    const eachEdge = (edge: keyof CellBorders, val: boolean) => {
      if (edge === 'top') for (let c = b.c1; c <= b.c2; c++) set(b.r1, c, 'top', val);
      if (edge === 'bottom') for (let c = b.c1; c <= b.c2; c++) set(b.r2, c, 'bottom', val);
      if (edge === 'left') for (let r = b.r1; r <= b.r2; r++) set(r, b.c1, 'left', val);
      if (edge === 'right') for (let r = b.r1; r <= b.r2; r++) set(r, b.c2, 'right', val);
    };
    switch (action) {
      case 'diagDown': case 'diagUp': {
        const val = !this.selectionDiagOn(tableId, action);
        for (let r = b.r1; r <= b.r2; r++) {
          for (let c = b.c1; c <= b.c2; c++) {
            const cell = cells[r]?.[c];
            if (cell) cell.borders[action] = val || undefined;
          }
        }
        break;
      }
      case 'top': case 'bottom': case 'left': case 'right':
        eachEdge(action, !this.selectionEdgeOn(tableId, action));
        break;
      case 'none':
      case 'all': {
        const val = action === 'all';
        for (let r = b.r1; r <= b.r2; r++) {
          for (let c = b.c1; c <= b.c2; c++) {
            set(r, c, 'top', val);
            set(r, c, 'bottom', val);
            set(r, c, 'left', val);
            set(r, c, 'right', val);
          }
        }
        break;
      }
      case 'outer':
        eachEdge('top', true);
        eachEdge('bottom', true);
        eachEdge('left', true);
        eachEdge('right', true);
        break;
      case 'inner':
        for (let r = b.r1; r <= b.r2; r++) {
          for (let c = b.c1; c <= b.c2; c++) {
            if (r < b.r2) set(r, c, 'bottom', true);
            if (c < b.c2) set(r, c, 'right', true);
          }
        }
        break;
    }
    // 全開且無斜線的格子還原成未設（schema 精簡；無逐格框線的表格保持引擎快速路徑）
    const cleaned = cells.map(row => row.map(cell => {
      const bd = cell.borders;
      return bd.top && bd.right && bd.bottom && bd.left && !bd.diagDown && !bd.diagUp
        ? { ...cell, borders: undefined }
        : cell;
    }));
    this.patchElement(tableId, { cells: cleaned } as Partial<TableElement>);
  }

  /** 清空儲存格內容（回到空白文字格；保留合併跨度） */
  clearCell(tableId: string, row: number, col: number) {
    const t = this.tableOf(tableId);
    if (!t) return;
    const cells = t.cells.map((r, ri) => r.map((cell, ci) =>
      ri === row && ci === col
        ? { ...emptyCell(), colSpan: cell.colSpan, rowSpan: cell.rowSpan, borders: cell.borders }
        : cell));
    this.patchElement(tableId, { cells } as Partial<TableElement>);
  }

  /** 從所有 placeholder（含表格儲存格）產生範例資料物件。 */
  buildSampleData(): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    // 全數字的範例值以數字型別輸出（宿主看到的範例才是正確示範；引擎兩者都吃）
    const coerce = (s: string): unknown => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s);
    // 重複區塊（list）：產 2 筆範例，子元素相對 key 寫進 prefixkey[i]；巢狀 list 遞迴。
    // $parent. 子元素跳過（指向外層當筆，已由外層產生）。
    const listSample = (list: TemplateElement & { type: 'list' }, prefix: string) => {
      for (let i = 0; i < 2; i++) {
        const base = `${prefix}${list.key}[${i}]`;
        for (const c of list.children ?? []) {
          if (c.type === 'placeholder' && c.key && !c.key.startsWith('$')) {
            setPath(data, `${base}.${c.key}`, coerce((c.sample || '範例') + (i + 1)));
          } else if (c.type === 'text' && c.content.includes('{{')) {
            for (const m of c.content.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|\s*([A-Za-z]+(?:\([^()|}]*\))?)\s*)?\}\}/g)) {
              if (m[1].startsWith('$')) continue;
              const fmt = m[2] ?? '';
              const s = fmt === 'comma' || fmt === 'twUpper' ? '12345' : fmt.startsWith('rocDate') ? '2026-07-20' : '範例';
              setPath(data, `${base}.${m[1]}`, coerce(s));
            }
          } else if (c.type === 'barcode' && c.key && !c.key.startsWith('$')) {
            setPath(data, `${base}.${c.key}`, c.sample || '123456');
          } else if (c.type === 'image' && c.key && !c.key.startsWith('$') && c.sample) {
            setPath(data, `${base}.${c.key}`, c.sample);
          } else if (c.type === 'list') {
            listSample(c, `${base}.`);
          }
        }
      }
    };
    const all = this.allLists(this.template()).flat().flatMap(e =>
      e.type === 'container' ? [e as TemplateElement, ...e.children] : [e]);
    for (const el of all) {
      if (el.type === 'list') { listSample(el, ''); continue; }
      // $ 開頭是引擎保留 key（$page/$pages），不放進範例資料
      if (el.type === 'placeholder' && el.key && !el.key.startsWith('$')) {
        setPath(data, el.key, coerce(el.sample || '範例'));
      }
      // 文字元素的行內插值 token {{key|format}} 也要有範例資料
      if (el.type === 'text' && el.content.includes('{{')) {
        for (const m of el.content.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|\s*([A-Za-z]+(?:\([^()|}]*\))?)\s*)?\}\}/g)) {
          const key = m[1];
          if (key.startsWith('$')) continue;
          const fmt = m[2] ?? '';
          const sample = fmt === 'comma' || fmt === 'twUpper' ? '12345'
            : fmt.startsWith('rocDate') ? '2026-07-20' : '範例';
          setPath(data, key, coerce(sample));
        }
      }
      if (el.type === 'barcode' && el.key && !el.key.startsWith('$')) {
        setPath(data, el.key, el.sample || '123456');
      }
      // 動態圖片：範例值 = 範例 URL（沒填就不產，避免預覽對假網址發警告）
      if (el.type === 'image' && el.key && !el.key.startsWith('$') && el.sample) {
        setPath(data, el.key, el.sample);
      }
      if (el.type === 'table') {
        const rep = el.repeat;
        const grouped = !!(rep?.enabled && rep.groupBy);
        const rowCount = grouped ? 4 : 3; // 分組時產兩組各兩筆，展示群組效果
        for (let r = 0; r < el.cells.length; r++) {
          const isRepeatRow = rep?.enabled && rep.key && r === rep.rowIndex;
          const isGroupRow = grouped && (r === rep!.groupHeaderRowIndex || r === rep!.groupFooterRowIndex);
          for (const cell of el.cells[r]) {
            // 圖片/條碼儲存格的 key 綁定：範例值原樣（不加序號、不轉數字——URL 與條碼內容都是字面）
            if ((cell.kind === 'image' || cell.kind === 'barcode') && cell.key && !cell.key.startsWith('$')) {
              const raw = cell.kind === 'barcode' ? (cell.sample || '123456') : cell.sample;
              if (!raw) continue; // 圖片沒範例 URL 就不產（避免預覽對假網址發警告）
              if (isRepeatRow || isGroupRow) {
                for (let i = 0; i < rowCount; i++) {
                  setPath(data, `${rep!.key}[${i}].${cell.key}`, raw);
                }
              } else {
                setPath(data, cell.key, raw);
              }
              continue;
            }
            if (cell.kind !== 'placeholder' || !cell.key || cell.key.startsWith('$')) continue;
            if (isRepeatRow) {
              for (let i = 0; i < rowCount; i++) {
                setPath(data, `${rep!.key}[${i}].${cell.key}`, coerce((cell.sample || '範例') + (i + 1)));
              }
            } else if (isGroupRow) {
              // 群組首/尾列的相對 key 也屬於陣列元素
              for (let i = 0; i < rowCount; i++) {
                setPath(data, `${rep!.key}[${i}].${cell.key}`, coerce(cell.sample || '範例'));
              }
            } else {
              setPath(data, cell.key, coerce(cell.sample || '範例'));
            }
          }
        }
        if (grouped) {
          for (let i = 0; i < rowCount; i++) {
            setPath(data, `${rep!.key}[${i}].${rep!.groupBy}`, '分類' + (i < 2 ? 1 : 2));
          }
        }
      }
    }
    this.alignSampleTypes(data);
    return data;
  }

  /**
   * 把範例資料調成與「偵測欄位」推出來的型別一致。
   *
   * 沒有這一步的話，兩邊是各自推型別的：偵測從格式化與 $sum() 判斷 `total`／`items[].amount`
   * 是數字，範例產生器卻給 "範例值"／"範例1" 這種字串 —— 於是「用範例資料填入」產出的資料
   * 過不了它自己偵測出來的規則，工具自己打自己。這裡以偵測結果為準做最後對齊，
   * 讓兩者結構上不可能不一致。
   */
  private alignSampleTypes(data: Record<string, unknown>) {
    const visit = (root: unknown, path: string, fn: (holder: Record<string, unknown>, key: string) => void) => {
      const parts = path.split('.');
      const walk = (cur: unknown, i: number) => {
        if (cur == null || typeof cur !== 'object') return;
        const raw = parts[i];
        const isArr = raw.endsWith('[]');
        const seg = isArr ? raw.slice(0, -2) : raw;
        const obj = cur as Record<string, unknown>;
        if (i === parts.length - 1 && !isArr) {
          if (seg in obj) fn(obj, seg);
          return;
        }
        const next = obj[seg];
        if (isArr) {
          if (Array.isArray(next)) for (const item of next) walk(item, i + 1);
        } else {
          walk(next, i + 1);
        }
      };
      walk(root, 0);
    };
    for (const f of this.deriveFieldCandidates()) {
      if (f.type !== 'number') continue;
      visit(data, f.path, (holder, key) => {
        const v = holder[key];
        if (typeof v === 'number') return;
        // 字面是數字就照用（保留設計者填的範例），否則給一個像金額的值
        holder[key] = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : 12345;
      });
    }
  }

  // ---------- 輸入驗證 ----------

  /** 目前樣板的驗證設定（normalize 保證存在） */
  readonly validation = computed<ValidationSpec>(() =>
    this.template().validation ?? { enabled: false, fields: [] });

  private patchValidation(patch: Partial<ValidationSpec>) {
    if (!this.record()) return;
    this.template.update(t => ({
      ...t,
      validation: { ...(t.validation ?? { enabled: false, fields: [] }), ...patch },
    }));
    this.dirty.set(true);
  }

  setValidationEnabled(enabled: boolean) {
    this.patchValidation({ enabled });
  }

  addValidationField() {
    const fields: ValidationField[] = [
      ...this.validation().fields,
      { path: '', required: true, type: 'any', source: 'manual' },
    ];
    this.patchValidation({ fields });
  }

  updateValidationField(index: number, patch: Partial<ValidationField>) {
    const fields = this.validation().fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
    this.patchValidation({ fields });
  }

  removeValidationField(index: number) {
    const fields = this.validation().fields.filter((_, i) => i !== index);
    this.patchValidation({ fields });
  }

  /**
   * 從樣板自動偵測欄位並「合併補新」：只把樣板用到、表中還沒有的 path 補進去
   * （required 預設開、型別依綁定推斷、source=detected）；已存在的欄位（含手動微調）原樣保留。
   * 回傳新增的欄位數，供 UI 提示。
   */
  detectValidationFields(): number {
    const existing = new Set(this.validation().fields.map(f => f.path));
    const added: ValidationField[] = [];
    for (const cand of this.deriveFieldCandidates()) {
      if (existing.has(cand.path)) continue;
      existing.add(cand.path);
      added.push({ path: cand.path, required: true, type: cand.type, source: 'detected' });
    }
    if (added.length) {
      this.patchValidation({ fields: [...this.validation().fields, ...added] });
    }
    return added.length;
  }

  /**
   * 掃描樣板所有資料綁定，導出候選欄位 {path, type}（依首次出現排序、去重）。
   * 與 buildSampleData 走同一組結構：placeholder / 文字插值 / 條碼 / 動態圖片 / 表格（含重複列 key[].欄位）。
   * 排除 $ 開頭的引擎保留 key（$page/$sum(...) 等）。
   */
  private deriveFieldCandidates(): { path: string; type: ValidationFieldType }[] {
    const out: { path: string; type: ValidationFieldType }[] = [];
    // add：去重；已存在但型別為 any 時可被更具體的型別升級（順序無關）
    const add = (path: string, type: ValidationFieldType) => {
      const p = path.trim();
      if (!p || p.startsWith('$')) return;
      const hit = out.find(o => o.path === p);
      if (hit) {
        if (hit.type === 'any' && type !== 'any') hit.type = type;
        return;
      }
      out.push({ path: p, type });
    };
    const typeForFormat = (fmt?: string): ValidationFieldType => {
      const name = fmt?.replace(/\(.*$/, ''); // 去掉參數：comma(2)/round(3) → comma/round
      return name === 'comma' || name === 'twUpper' || name === 'round' ? 'number'
        : name?.startsWith('rocDate') ? 'string' : 'any';
    };
    // addKey：一般 key 直接 add；全域彙總 $sum/$avg/$count(路徑) → 導出被引用的陣列與欄位
    // （sum/avg 代表該欄位是數字，補上型別；只在彙總內出現、畫面沒直接顯示的 key 也能被偵測）
    const aggRe = /^\$(sum|avg|count)\((.+)\)$/;
    const addKey = (key: string, type: ValidationFieldType) => {
      const m = key.match(aggRe);
      if (!m) { add(key, type); return; }
      const numeric = m[1] !== 'count';
      const path = m[2].trim();
      const dot = path.lastIndexOf('.');
      if (dot < 0) {
        add(path, 'array'); // $count(items) / $sum(scalar 陣列)
      } else {
        add(path.slice(0, dot), 'array');
        add(`${path.slice(0, dot)}[].${path.slice(dot + 1)}`, numeric ? 'number' : 'any');
      }
    };
    const scanText = (s: string) => {
      if (!s || !s.includes('{{')) return;
      for (const m of s.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|\s*([A-Za-z]+(?:\([^()|}]*\))?)\s*)?\}\}/g)) {
        addKey(m[1], typeForFormat(m[2]));
      }
    };

    // 重複區塊（list）：綁的陣列 → array；子元素相對 key → key[].欄位；巢狀 list 遞迴。
    const listFields = (list: TemplateElement & { type: 'list' }, prefix: string) => {
      const base = `${prefix}${list.key}`;
      add(base, 'array');
      for (const c of list.children ?? []) {
        if (c.type === 'placeholder' && c.key && !c.key.startsWith('$')) add(`${base}[].${c.key}`, typeForFormat(c.format));
        else if (c.type === 'barcode' && c.key && !c.key.startsWith('$')) add(`${base}[].${c.key}`, 'string');
        else if (c.type === 'image' && c.key && !c.key.startsWith('$')) add(`${base}[].${c.key}`, 'string');
        else if (c.type === 'text') {
          for (const m of c.content.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|\s*([A-Za-z]+(?:\([^()|}]*\))?)\s*)?\}\}/g)) {
            if (!m[1].startsWith('$')) add(`${base}[].${m[1]}`, typeForFormat(m[2]));
          }
        } else if (c.type === 'list') listFields(c, `${base}[].`);
      }
    };
    const all = this.allLists(this.template()).flat().flatMap(e =>
      e.type === 'container' ? [e as TemplateElement, ...e.children] : [e]);
    for (const el of all) {
      if (el.type === 'list') { listFields(el, ''); continue; }
      if (el.type === 'placeholder' && el.key) addKey(el.key, typeForFormat(el.format));
      if (el.type === 'text') scanText(el.content);
      if (el.type === 'barcode' && el.key) addKey(el.key, 'string');
      if (el.type === 'image' && el.key) addKey(el.key, 'string');
      if (el.type === 'table') {
        const rep = el.repeat;
        for (let r = 0; r < el.cells.length; r++) {
          const isRepeatRow = !!(rep?.enabled && rep.key && r === rep.rowIndex);
          const isGroupRow = !!(rep?.enabled && rep.key &&
            (r === rep.groupHeaderRowIndex || r === rep.groupFooterRowIndex));
          for (const cell of el.cells[r]) {
            if (cell.kind === 'text') { scanText(cell.value); continue; } // 文字格：掃插值（含 $sum）
            if (cell.kind !== 'placeholder' && cell.kind !== 'barcode' && cell.kind !== 'image') continue;
            if (!cell.key) continue;
            const t: ValidationFieldType = cell.kind === 'placeholder' ? typeForFormat(cell.format) : 'string';
            if (isRepeatRow || isGroupRow) {
              add(rep!.key, 'array');
              add(`${rep!.key}[].${cell.key}`, t);
            } else {
              addKey(cell.key, t);
            }
          }
        }
        if (rep?.enabled && rep.key && rep.groupBy) {
          add(rep.key, 'array');
          add(`${rep.key}[].${rep.groupBy}`, 'any');
        }
      }
    }
    return out;
  }
}
