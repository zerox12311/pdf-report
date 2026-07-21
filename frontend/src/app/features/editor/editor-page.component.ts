import { ChangeDetectionStrategy, Component, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ELEMENT_META, TemplateElement, emptyTemplate } from '../../core/models/template.model';
import { FontService } from '../../core/services/font.service';
import { HostBridgeService } from '../../core/services/host-bridge.service';
import { TemplateApiService } from '../../core/services/template-api.service';
import { ContextMenuComponent } from './context-menu.component';
import { DataPanelComponent } from './data-panel.component';
import { EditorCanvasComponent } from './editor-canvas.component';
import { EditorStateService } from './editor-state.service';
import { IntegrationDialogComponent } from './integration-dialog.component';
import { PaletteAction, canDropIntoCell, createElements } from './element-factory';
import { PreviewPanelComponent } from './preview-panel.component';
import { PropertiesPanelComponent } from './properties-panel.component';

interface PaletteItem {
  icon: string;
  label: string;
  action: PaletteAction | 'image';
}

@Component({
  selector: 'app-editor-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, EditorCanvasComponent, PropertiesPanelComponent, PreviewPanelComponent, IntegrationDialogComponent, DataPanelComponent, ContextMenuComponent],
  providers: [EditorStateService],
  template: `
    <div class="editor">
      <header>
        <a routerLink="/" class="back">← 樣板列表</a>
        <input class="name" [ngModel]="state.template().name" (ngModelChange)="state.setName($event)" />
        <div class="right">
          <button class="link" (click)="showIntegration.set(true)" title="iframe 嵌入與渲染 API 說明">🔗 連接</button>
          <button class="save" (click)="save()" [disabled]="saving()">
            {{ saving() ? '儲存中…' : state.dirty() ? '儲存 *' : '儲存' }}
          </button>
        </div>
      </header>
      @if (showIntegration()) {
        <app-integration-dialog (close)="showIntegration.set(false)" />
      }
      <app-context-menu />

      <div class="body">
        <!-- 左側：元件 + 大綱（Jasper 的 Palette / Outline） -->
        <aside class="left">
          <div class="panel-title">元件</div>
          <div class="palette">
            @for (group of paletteGroups; track group.name) {
              <div class="group-name">{{ group.name }}</div>
              @for (item of group.items; track item.action) {
                <button draggable="true"
                  (dragstart)="onPaletteDragStart($event, item.action)"
                  (click)="addByPalette(item.action)"
                  [title]="item.label + '——點擊新增，或直接拖到畫布上要放的位置'">
                  <span class="icon">{{ item.icon }}</span>{{ item.label }}
                </button>
              }
            }
            <input #imageInput type="file" accept="image/png,image/jpeg" hidden (change)="onImagePicked($event)" />
          </div>
          <div class="panel-title">大綱</div>
          <div class="outline">
            @for (group of outlineGroups(); track group.name; let gi = $index) {
              <div class="band-name" [class.drop-target]="dropBand() === gi"
                (dragover)="onBandDragOver($event, gi)" (dragleave)="dropBand.set(null)"
                (drop)="onBandDrop($event, gi)">{{ group.name }}</div>
              @if (group.items.length === 0) {
                <div class="empty-band">（無元素）</div>
              }
              @for (item of group.items; track item.el.id) {
                <div class="node" [class.active]="item.el.id === state.selectedId()"
                  [class.drop-target]="dropTargetId() === item.el.id"
                  [style.paddingLeft.px]="6 + item.depth * 16"
                  draggable="true"
                  (dragstart)="onOutlineDragStart($event, item.el.id)"
                  (dragend)="clearOutlineDrag()"
                  (dragover)="onOutlineDragOver($event, item.el)"
                  (dragleave)="dropTargetId.set(null)"
                  (drop)="onOutlineDrop($event, item.el)"
                  (click)="revealEl(item.el.id)">
                  <span class="icon">{{ item.icon }}</span>
                  <span class="label">{{ item.label }}</span>
                  <button class="del" title="複製" (click)="dupEl($event, item.el.id)">⧉</button>
                  <button class="del" title="刪除" (click)="removeEl($event, item.el.id)">✕</button>
                </div>
              }
            }
          </div>
        </aside>

        <!-- 中間：分頁（設計 / JSON / 預覽） -->
        <main class="center">
          <div class="tabbar">
            <button [class.on]="tab() === 'design'" (click)="switchTab('design')">設計</button>
            <button [class.on]="tab() === 'json'" (click)="switchTab('json')">JSON</button>
            <button [class.on]="tab() === 'preview'" (click)="switchTab('preview')">預覽</button>
            <span class="spacer"></span>
            @if (tab() === 'design') {
              <div class="surface-switch">
                @for (s of state.template().sections; track s.id) {
                  <button [class.on]="state.activeSection().id === s.id" (click)="state.setActiveSection(s.id)"
                    [title]="s.kind === 'flow' ? '內容節（有頁首/頁尾、自動分頁）' : '獨立頁'">
                    {{ s.name }}{{ s.kind === 'single' ? ' ◽' : '' }}
                  </button>
                }
                <button class="add" (click)="state.addSection('flow')" title="新增內容節（有頁首/頁尾 band、內容自動分頁）">＋節</button>
                <button class="add" (click)="state.addSection('single')" title="新增獨立頁（如封面/封底，單獨一頁）">＋獨立頁</button>
              </div>
            }
            @if (tab() === 'design') {
              <div class="zoom undo-group">
                <button class="zbtn" [disabled]="!state.undoCount()" (click)="state.undo()" title="上一步（Ctrl/⌘+Z）">↺</button>
                <button class="zbtn" [disabled]="!state.redoCount()" (click)="state.redo()" title="重做（Ctrl/⌘+Shift+Z）">↻</button>
              </div>
              <div class="zoom" title="觸控板捏合可縮放（30%–300%）；點百分比重設 120%">縮放
                <button class="zbtn" (click)="zoomBy(-0.1)">−</button>
                <span class="zval" (click)="state.zoom.set(1.2)">{{ zoomPct() }}%</span>
                <button class="zbtn" (click)="zoomBy(0.1)">＋</button>
              </div>
            }
          </div>
          @switch (tab()) {
            @case ('design') { <app-editor-canvas /> }
            @case ('json') {
              <div class="json-tab">
                <textarea [ngModel]="jsonText()" (ngModelChange)="jsonText.set($event)" spellcheck="false"></textarea>
                <div class="json-actions">
                  <button class="apply" (click)="applyJson()">套用 JSON</button>
                  @if (jsonError(); as err) { <span class="error">{{ err }}</span> }
                </div>
              </div>
            }
            @case ('preview') { <app-preview-panel #preview /> }
          }
        </main>

        <!-- 右側：屬性 / 資料 -->
        @if (tab() === 'design') {
          <aside class="rpanel">
            <div class="rtabs">
              <button [class.on]="rightTab() === 'props'" (click)="rightTab.set('props')">屬性</button>
              <button [class.on]="rightTab() === 'data'" (click)="rightTab.set('data')">資料</button>
            </div>
            @if (rightTab() === 'props') { <app-properties-panel /> } @else { <app-data-panel /> }
          </aside>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; height: 100vh; }
    .editor { display: flex; flex-direction: column; height: 100%; }
    header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #1e293b; color: #fff; }
    .back { color: #cbd5e1; text-decoration: none; font-size: 13px; }
    .back:hover { color: #fff; }
    .name { font-size: 15px; font-weight: 600; padding: 5px 8px; border-radius: 6px; border: 1px solid #475569;
      background: #0f172a; color: #fff; width: 220px; }
    .right { margin-left: auto; display: flex; gap: 8px; }
    .save { background: #22c55e; color: #fff; border: none; border-radius: 6px; padding: 6px 16px; cursor: pointer; }
    .save:disabled { opacity: .6; }
    .link { background: #334155; color: #e2e8f0; border: 1px solid #475569; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
    .link:hover { background: #3e4f66; }
    .body { display: flex; flex: 1; min-height: 0; }

    /* 左側欄 */
    .left { width: 190px; flex-shrink: 0; border-right: 1px solid #cfd6df; background: #f4f6f9;
      display: flex; flex-direction: column; overflow-y: auto; }
    .panel-title { font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: .06em;
      padding: 8px 10px 4px; text-transform: uppercase; }
    .palette { display: flex; flex-direction: column; padding: 0 8px 8px; gap: 3px; }
    .palette button { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid transparent;
      background: none; border-radius: 6px; cursor: pointer; font-size: 13px; color: #1f2937; text-align: left; }
    .palette button:hover { background: #e3e9f1; border-color: #cbd5e1; }
    .palette button { cursor: grab; }
    .palette button:active { cursor: grabbing; }
    .palette .icon { width: 18px; text-align: center; }
    .palette .group-name { font-size: 11px; color: #94a3b8; font-weight: 700; padding: 6px 2px 1px; }
    .outline { flex: 1; padding: 0 4px 8px; }
    .band-name { font-size: 11px; color: #0369a1; font-weight: 700; padding: 6px 6px 2px; }
    .empty-band { font-size: 11px; color: #a3aebd; padding: 0 10px 4px; }
    .node { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 5px;
      font-size: 12px; cursor: pointer; color: #334155; }
    .node:hover { background: #e3e9f1; }
    .node.active { background: #2563eb; color: #fff; }
    .node .icon { width: 16px; text-align: center; flex-shrink: 0; }
    .node .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .node .del { visibility: hidden; border: none; background: none; cursor: pointer; color: inherit; font-size: 11px; padding: 0 2px; }
    .node:hover .del { visibility: visible; }
    .node.drop-target { outline: 1.5px dashed #2563eb; outline-offset: -1.5px; }
    .band-name.drop-target { outline: 1.5px dashed #2563eb; outline-offset: -1.5px; border-radius: 4px; }

    /* 中間 */
    .center { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .tabbar { display: flex; align-items: center; background: #e8ecf1; border-bottom: 1px solid #cfd6df; padding: 0 8px; }
    .tabbar button { border: none; background: none; padding: 8px 16px; font-size: 13px; cursor: pointer;
      color: #475569; border-bottom: 2px solid transparent; }
    .tabbar button.on { color: #1d4ed8; border-bottom-color: #1d4ed8; background: #f8fafc; font-weight: 600; }
    .tabbar .spacer { flex: 1; }
    .tabbar .zoom { font-size: 12px; color: #475569; display: flex; align-items: center; gap: 4px; padding-right: 4px; }
    .tabbar select { padding: 3px; border-radius: 5px; }
    .zbtn { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 5px; width: 22px; height: 22px;
      cursor: pointer; color: #475569; line-height: 1; padding: 0; }
    .zbtn:hover:not(:disabled) { background: #eff6ff; color: #1d4ed8; }
    .zbtn:disabled { opacity: .4; cursor: default; }
    .undo-group { margin-right: 8px; }
    .zval { min-width: 42px; text-align: center; cursor: pointer; font-variant-numeric: tabular-nums; }
    .zval:hover { color: #1d4ed8; }
    .surface-switch { display: flex; gap: 2px; margin-right: 12px; background: #dbe2ea; border-radius: 7px; padding: 2px; }
    .surface-switch button { border: none; background: none; padding: 3px 12px; font-size: 12px; cursor: pointer;
      color: #475569; border-radius: 5px; }
    .surface-switch button.on { background: #fff; color: #1d4ed8; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
    .surface-switch button.add { color: #64748b; font-weight: 600; }
    .surface-switch button.add:hover { color: #1d4ed8; }

    .json-tab { flex: 1; display: flex; flex-direction: column; padding: 10px; gap: 8px; min-height: 0; background: #eef1f5; }
    .json-tab textarea { flex: 1; font-family: monospace; font-size: 12px; border: 1px solid #ccc;
      border-radius: 6px; padding: 10px; resize: none; }
    .json-actions { display: flex; align-items: center; gap: 10px; }
    .rpanel { width: 280px; flex-shrink: 0; border-left: 1px solid #ddd; background: #fafafa;
      display: flex; flex-direction: column; min-height: 0; }
    .rtabs { display: flex; border-bottom: 1px solid #e2e8f0; background: #f1f5f9; flex-shrink: 0; }
    .rtabs button { flex: 1; border: none; background: none; padding: 7px 0; font-size: 13px; cursor: pointer;
      color: #64748b; border-bottom: 2px solid transparent; }
    .rtabs button.on { color: #1d4ed8; border-bottom-color: #1d4ed8; background: #fafafa; font-weight: 600; }
    .apply { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; }
    .error { color: #dc2626; font-size: 12px; }
  `,
})
export class EditorPageComponent {
  state = inject(EditorStateService);
  private api = inject(TemplateApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  @ViewChild('imageInput') imageInput?: { nativeElement: HTMLInputElement };

  saving = signal(false);
  showIntegration = signal(false);
  rightTab = signal<'props' | 'data'>('props');
  tab = signal<'design' | 'json' | 'preview'>('design');
  jsonText = signal('');
  jsonError = signal<string | null>(null);

  paletteGroups: { name: string; items: PaletteItem[] }[] = [
    {
      name: '基本',
      items: [
        { icon: 'T', label: '文字', action: 'text' },
        { icon: '{}', label: '資料欄位', action: 'placeholder' },
        { icon: '🖼', label: '圖片', action: 'image' },
      ],
    },
    {
      name: '報表',
      items: [
        { icon: '▦', label: '表格', action: 'table' },
        { icon: '▣', label: '容器', action: 'container' },
      ],
    },
    {
      name: '圖形',
      items: [
        { icon: '▭', label: '矩形', action: 'rect' },
        { icon: '─', label: '線條', action: 'line' },
      ],
    },
    {
      name: '條碼',
      items: [
        { icon: '𝄃𝄂', label: '條碼', action: 'barcode' },
        { icon: '☰', label: '超商三段條碼', action: 'cvs3' },
      ],
    },
  ];

  outlineGroups = computed(() => {
    const sec = this.state.activeSection();
    const page = this.state.activePage();
    const headerH = page.headerHeight;
    const footerStart = page.height - page.footerHeight;
    type Item = { el: TemplateElement; icon: string; label: string; depth: number };
    const groups = sec.kind === 'flow'
      ? [
          { name: '頁首 Page Header', items: [] as Item[] },
          { name: '內文 Detail', items: [] as Item[] },
          { name: '頁尾 Page Footer', items: [] as Item[] },
        ]
      : [{ name: `${sec.name}（獨立頁）`, items: [] as Item[] }];
    for (const el of this.state.visibleElements()) {
      const g = sec.kind !== 'flow' ? groups[0]
        : el.y < headerH ? groups[0] : el.y >= footerStart ? groups[2] : groups[1];
      g.items.push({ el, icon: this.iconOf(el), label: this.labelOf(el), depth: 0 });
    }
    for (const g of groups) {
      g.items.sort((a, b) => a.el.y - b.el.y);
      // 容器子元素巢狀插入
      const withChildren: Item[] = [];
      for (const item of g.items) {
        withChildren.push(item);
        if (item.el.type === 'container') {
          const kids = [...item.el.children].sort((a, b) => a.y - b.y)
            .map(c => ({ el: c, icon: this.iconOf(c), label: this.labelOf(c), depth: 1 }));
          withChildren.push(...kids);
        }
      }
      g.items = withChildren;
    }
    return groups;
  });

  private iconOf(el: TemplateElement): string {
    return ELEMENT_META[el.type].icon;
  }

  private labelOf(el: TemplateElement): string {
    switch (el.type) {
      case 'text': return el.content.split('\n')[0] || '文字';
      case 'placeholder': return el.key ? `{{${el.key}}}` : '資料欄位';
      case 'table': {
        const rep = el.repeat?.enabled ? ` ↻${el.repeat.key}` : '';
        return `表格 ${el.rowHeights.length}×${el.columnWidths.length}${rep}`;
      }
      case 'image': return '圖片';
      case 'rect': return '矩形';
      case 'line': return '線條';
      case 'barcode': return `條碼 ${el.symbology}${el.key ? ' {{' + el.key + '}}' : ''}`;
      case 'container': return `容器 ${el.title || ''}（${el.children.length}）`;
    }
  }

  private bridge = inject(HostBridgeService);

  private fonts = inject(FontService);

  constructor() {
    // 儲存格圖片：canvas 發出請求 → 開檔案選擇器（上傳後在 onImagePicked 設進該格）
    effect(() => {
      if (this.state.imagePickRequest()) this.imageInput?.nativeElement.click();
    });
    void this.fonts.refresh();
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') {
      this.api.get(id).then(doc => {
        this.state.load(doc);
        this.fonts.ensureForDoc(this.state.template());
        this.bridge.notify('template-loaded', doc.id);
      }).catch(() => this.state.load(emptyTemplate()));
    }
    this.bridge.notify('editor-ready', id === 'new' ? null : id);
  }

  switchTab(tab: 'design' | 'json' | 'preview') {
    this.tab.set(tab);
    if (tab === 'json') {
      this.jsonText.set(JSON.stringify(this.state.template(), null, 2));
      this.jsonError.set(null);
    }
    // 預覽分頁：PreviewPanelComponent 建立時會自行渲染（見其 ngOnInit）
  }

  applyJson() {
    try {
      const doc = JSON.parse(this.jsonText());
      doc.id = this.state.template().id; // id 以目前樣板為準
      this.state.load(doc);
      this.state.dirty.set(true);
      this.jsonError.set(null);
      this.tab.set('design');
    } catch (e) {
      this.jsonError.set('JSON 格式錯誤：' + (e instanceof Error ? e.message : e));
    }
  }

  addByPalette(action: PaletteItem['action']) {
    if (this.tab() !== 'design') this.tab.set('design');
    // 新元素放進內文區的頂端附近；元素預設值由工廠（強型別）提供
    // （圖片也走一般流程：先落地佔位元素，來源在屬性面板選上傳或 URL）
    const baseY = this.state.activePage().headerHeight + 20;
    for (const el of createElements(action, baseY)) {
      this.state.addElement(el);
    }
  }

  onPaletteDragStart(e: DragEvent, action: PaletteItem['action']) {
    e.dataTransfer?.setData('application/x-palette', action);
    // 額外型別標記：讓表格儲存格在 dragover 階段就能辨識「可進格子」的拖曳（dragover 讀不到 payload）
    if (canDropIntoCell(action)) e.dataTransfer?.setData('application/x-palette-cell', '1');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  zoomPct(): number {
    return Math.round(this.state.zoom() * 100);
  }

  zoomBy(d: number) {
    this.state.zoom.set(Math.min(3, Math.max(0.3, Math.round((this.state.zoom() + d) * 100) / 100)));
  }

  removeEl(e: Event, id: string) {
    e.stopPropagation();
    this.state.removeElement(id);
  }

  dupEl(e: Event, id: string) {
    e.stopPropagation();
    this.state.duplicateElement(id);
  }

  /** 大綱點選：選取並把畫布捲動到該元素 */
  revealEl(id: string) {
    this.state.select(id);
    if (this.tab() !== 'design') this.tab.set('design');
    setTimeout(() => {
      document.querySelector(`.el[data-el-id="${id}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  // ---- 大綱階層拖曳 ----
  private outlineDragId: string | null = null;
  dropTargetId = signal<string | null>(null);
  dropBand = signal<number | null>(null);

  onOutlineDragStart(e: DragEvent, id: string) {
    this.outlineDragId = id;
    e.dataTransfer?.setData('text/plain', id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  clearOutlineDrag() {
    this.outlineDragId = null;
    this.dropTargetId.set(null);
    this.dropBand.set(null);
  }

  onOutlineDragOver(e: DragEvent, target: TemplateElement) {
    if (!this.outlineDragId || this.outlineDragId === target.id) return;
    e.preventDefault();
    this.dropTargetId.set(target.id);
  }

  /** 丟到元素上：容器 → 移入容器；一般元素 → 排到它下方（同層） */
  onOutlineDrop(e: DragEvent, target: TemplateElement) {
    e.preventDefault();
    const id = this.outlineDragId;
    this.clearOutlineDrag();
    if (!id || id === target.id) return;
    const dragged = this.state.findElement(id);
    if (!dragged) return;
    if (target.type === 'container' && dragged.type !== 'container') {
      this.state.moveIntoContainer(id, target.id);
      return;
    }
    const targetParent = this.state.parentOf(target.id);
    if (targetParent) {
      // 目標在容器內 → 也移進同一容器，排在目標下方
      this.state.moveIntoContainer(id, targetParent.id);
      this.state.patchElement(id, { x: target.x, y: target.y + target.height + 6 });
    } else {
      if (this.state.parentOf(id)) this.state.moveOutOfContainer(id);
      this.state.patchElement(id, { y: target.y + target.height + 6 });
    }
  }

  onBandDragOver(e: DragEvent, band: number) {
    if (!this.outlineDragId) return;
    e.preventDefault();
    this.dropBand.set(band);
  }

  /** 丟到 band 標題上：移到該區段頂端（容器子元素會先移出容器） */
  onBandDrop(e: DragEvent, band: number) {
    e.preventDefault();
    const id = this.outlineDragId;
    this.clearOutlineDrag();
    if (!id) return;
    if (this.state.parentOf(id)) this.state.moveOutOfContainer(id);
    const page = this.state.activePage();
    const y = band === 0 ? 8 : band === 1 ? page.headerHeight + 10 : page.height - page.footerHeight + 6;
    this.state.patchElement(id, { y });
  }

  async onImagePicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const { id } = await this.api.uploadAsset(file);
      const req = this.state.imagePickRequest();
      this.state.imagePickRequest.set(null);
      if (!req) return;
      if ('tableId' in req) {
        // 目標是儲存格：把該格設成圖片格（key 清掉，讓上傳生效）
        const tbl = this.state.findElement(req.tableId);
        if (tbl?.type === 'table') {
          const cells = tbl.cells.map((row, ri) => row.map((cell, ci) =>
            ri === req.r && ci === req.c
              ? { ...cell, kind: 'image' as const, assetId: id, key: '', url: undefined }
              : cell));
          this.state.patchElement(tbl.id, { cells });
        }
        return;
      }
      // 目標是圖片元素：設 assetId 並清掉動態/固定連結（三種來源擇一，上傳為明確意圖）
      this.state.patchElement(req.elementId, { assetId: id, key: undefined, url: undefined });
    } catch (e) {
      alert('圖片上傳失敗：' + (e instanceof Error ? e.message : e));
    }
  }

  async save() {
    this.saving.set(true);
    try {
      const t = this.state.template();
      const saved = t.id ? await this.api.update(t) : await this.api.create(t);
      this.state.load(saved);
      if (!t.id) {
        this.router.navigate(['/editor', saved.id], { replaceUrl: true });
      }
      // 宿主系統由此事件取得樣板 id，之後其後端可 POST /api/templates/{id}/render 填資料出 PDF
      this.bridge.notify('template-saved', saved.id);
    } catch (e) {
      alert('儲存失敗：' + (e instanceof Error ? e.message : e));
    } finally {
      this.saving.set(false);
    }
  }
}
