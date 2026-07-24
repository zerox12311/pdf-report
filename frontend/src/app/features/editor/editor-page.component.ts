import { ChangeDetectionStrategy, Component, HostListener, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ELEMENT_META, TemplateElement, emptyTemplate, isChildHost } from '../../core/models/template.model';
import { FontService } from '../../core/services/font.service';
import { HostBridgeService } from '../../core/services/host-bridge.service';
import { ModalService } from '../../core/services/modal.service';
import { TemplateApiService } from '../../core/services/template-api.service';
import { ContextMenuComponent } from './context-menu.component';
import { DataPanelComponent } from './data-panel.component';
import { EditorCanvasComponent } from './editor-canvas.component';
import { EditorStateService } from './editor-state.service';
import { IntegrationDialogComponent } from './integration-dialog.component';
import { PaletteAction, canDropIntoCell, createElements } from './element-factory';
import { PreviewPanelComponent } from './preview-panel.component';
import { ValidationPanelComponent } from './validation-panel.component';
import { PropertiesPanelComponent } from './properties-panel.component';

interface PaletteItem {
  icon: string;
  label: string;
  action: PaletteAction | 'image';
}

@Component({
  selector: 'app-editor-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, EditorCanvasComponent, PropertiesPanelComponent, PreviewPanelComponent, ValidationPanelComponent, IntegrationDialogComponent, DataPanelComponent, ContextMenuComponent],
  providers: [EditorStateService],
  template: `
    <div class="editor">
      <header>
        @if (!embedded) {
          <a [routerLink]="backLink" class="back">← {{ newProjectId ? '專案' : '控制台' }}</a>
        }
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
                  [class.node-hidden]="item.el.hidden"
                  [style.paddingLeft.px]="6 + item.depth * 16"
                  [draggable]="!item.el.locked"
                  (dragstart)="onOutlineDragStart($event, item.el.id)"
                  (dragend)="clearOutlineDrag()"
                  (dragover)="onOutlineDragOver($event, item.el)"
                  (dragleave)="dropTargetId.set(null)"
                  (drop)="onOutlineDrop($event, item.el)"
                  (click)="revealEl(item.el.id)">
                  <span class="icon">{{ item.icon }}</span>
                  <span class="label">{{ item.label }}</span>
                  <button class="del icon-hide" [class.on]="item.el.hidden" [title]="item.el.hidden ? '顯示' : '隱藏'"
                    (click)="toggleHidden($event, item.el.id)">{{ item.el.hidden ? '🚫' : '👁' }}</button>
                  <button class="del icon-lock" [class.on]="item.el.locked" [title]="item.el.locked ? '解鎖' : '鎖定'"
                    (click)="toggleLocked($event, item.el.id)">🔒</button>
                  <button class="del" title="複製" (click)="dupEl($event, item.el.id)">⧉</button>
                  <button class="del" title="刪除" (click)="removeEl($event, item.el.id)">✕</button>
                </div>
              }
            }
          </div>
        </aside>

        <!-- 頁面導覽（HackMD 式）：平常縮成細 bar；未釘選展開為浮層（點外面收回）、釘選則常駐佔版面 -->
        <div class="navwrap" [class.pinned]="navPinned()" [class.peek]="navOpen() && !navPinned()">
          <button class="navstrip" (click)="navOpen.set(true)" title="頁面導覽（節／獨立頁）">
            <span class="navstrip-glyph">▤</span>
            <span class="navstrip-count">{{ state.template().sections.length }}</span>
          </button>
          <div class="navpanel">
            <div class="navpanel-head">
              <span class="navpanel-title">頁面</span>
              <button class="navbtn" [class.on]="navPinned()" (click)="toggleNavPin()"
                [title]="navPinned() ? '取消釘選' : '釘選（常駐展開）'">📌</button>
              <button class="navbtn" (click)="collapseNav()" title="收合">‹</button>
            </div>
            <div class="navlist">
              @for (s of state.template().sections; track s.id; let i = $index) {
                <div class="navitem" [class.active]="state.activeSection().id === s.id"
                  [class.drop-before]="sectionDropIndex() === i"
                  draggable="true"
                  (dragstart)="onSectionDragStart($event, s.id)"
                  (dragover)="onSectionDragOver($event, i)"
                  (dragleave)="sectionDropIndex.set(null)"
                  (drop)="onSectionDrop($event, i)"
                  (dragend)="clearSectionDrag()"
                  (click)="switchSection(s.id)"
                  [title]="s.kind === 'flow' ? '內容節（有頁首/頁尾、自動分頁）' : '獨立頁（單獨一頁）'">
                  <span class="navnum">{{ i + 1 }}</span>
                  <span class="navkind">{{ s.kind === 'flow' ? '▤' : '◽' }}</span>
                  <span class="navname">{{ s.name }}</span>
                  @if (state.template().sections.length > 1) {
                    <button class="navdel" title="刪除此節" (click)="removeSectionFromNav($event, s.id, s.name)">✕</button>
                  }
                </div>
              }
            </div>
            <div class="navadd">
              <button (click)="state.addSection('flow')" title="新增內容節（有頁首/頁尾 band、自動分頁）">＋節</button>
              <button (click)="state.addSection('single')" title="新增獨立頁（如封面/封底）">＋獨立頁</button>
            </div>
          </div>
        </div>

        <!-- 中間：分頁（設計 / JSON / 預覽） -->
        <main class="center">
          <div class="tabbar">
            <button [class.on]="tab() === 'design'" (click)="switchTab('design')">設計</button>
            <button [class.on]="tab() === 'json'" (click)="switchTab('json')">樣板JSON</button>
            <button [class.on]="tab() === 'preview'" (click)="switchTab('preview')">預覽</button>
            <span class="spacer"></span>
            @if (tab() === 'design' && state.selectedIds().length > 1) {
              <div class="zoom align-group" title="對齊/分佈選取的元素">
                <button class="zbtn" (click)="state.alignSelected('left')" title="左對齊">⇤</button>
                <button class="zbtn" (click)="state.alignSelected('hcenter')" title="水平置中">⇔</button>
                <button class="zbtn" (click)="state.alignSelected('right')" title="右對齊">⇥</button>
                <span class="sep"></span>
                <button class="zbtn" (click)="state.alignSelected('top')" title="頂端對齊">⤒</button>
                <button class="zbtn" (click)="state.alignSelected('vcenter')" title="垂直置中">⇕</button>
                <button class="zbtn" (click)="state.alignSelected('bottom')" title="底端對齊">⤓</button>
                @if (state.selectedIds().length > 2) {
                  <span class="sep"></span>
                  <button class="zbtn" (click)="state.distributeSelected('h')" title="水平等距分佈">↔</button>
                  <button class="zbtn" (click)="state.distributeSelected('v')" title="垂直等距分佈">↕</button>
                }
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
            <button class="tab-right" [class.on]="tab() === 'validation'" (click)="switchTab('validation')"
              title="輸入資料驗證（schema）">✓ 驗證</button>
          </div>
          @switch (tab()) {
            @case ('design') { <app-editor-canvas (elementPicked)="rightTab.set('props')" /> }
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
            @case ('validation') { <app-validation-panel /> }
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
    /* 眼睛/鎖：啟用時常駐＋背景色塊（彩色 emoji 吃不到 color，改用背景表達狀態） */
    .node .del.on { visibility: visible; border-radius: 4px; padding: 1px 4px; font-size: 12px; }
    .node .del.icon-hide.on { background: #fecaca; box-shadow: inset 0 0 0 1.5px #dc2626; }
    .node .del.icon-lock.on { background: #fed7aa; box-shadow: inset 0 0 0 1.5px #ea580c; }
    .node.node-hidden .label { opacity: .45; text-decoration: line-through; }
    .node.drop-target { outline: 1.5px dashed #2563eb; outline-offset: -1.5px; }
    .band-name.drop-target { outline: 1.5px dashed #2563eb; outline-offset: -1.5px; border-radius: 4px; }

    /* 頁面導覽（HackMD 式：細 bar 收合／展開／釘選） */
    .navwrap { position: relative; flex-shrink: 0; display: flex; width: 26px;
      background: #eef1f5; border-right: 1px solid #cfd6df; }
    .navwrap.pinned { width: 190px; }
    .navstrip { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 26px;
      padding: 8px 0; border: none; background: none; cursor: pointer; color: #64748b; }
    .navwrap.pinned .navstrip { display: none; }
    .navstrip:hover { background: #e0e7f1; }
    .navstrip-glyph { font-size: 14px; }
    .navstrip-count { font-size: 11px; font-weight: 700; }
    .navpanel { display: none; flex-direction: column; min-width: 0; }
    .navwrap.pinned .navpanel { display: flex; width: 100%; }
    /* 未釘選展開＝浮層蓋在畫布上，不推版面；點外面收回 */
    .navwrap.peek .navpanel { display: flex; position: absolute; left: 26px; top: 0; bottom: 0; width: 190px;
      background: #eef1f5; border-right: 1px solid #cfd6df; z-index: 40; box-shadow: 3px 0 10px rgba(0,0,0,.18); }
    .navpanel-head { display: flex; align-items: center; gap: 2px; padding: 6px 8px; border-bottom: 1px solid #d7dde6; }
    .navpanel-title { flex: 1; font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: .06em; text-transform: uppercase; }
    .navbtn { border: none; background: none; cursor: pointer; font-size: 12px; padding: 2px 5px; border-radius: 4px; opacity: .55; }
    .navbtn:hover { background: #dce3ec; opacity: 1; }
    .navbtn.on { opacity: 1; background: #dbeafe; }
    .navlist { flex: 1; overflow-y: auto; padding: 4px; }
    .navitem { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; cursor: pointer;
      font-size: 12px; color: #334155; border-top: 2px solid transparent; }
    .navitem:hover { background: #e3e9f1; }
    .navitem.active { background: #2563eb; color: #fff; }
    .navitem.drop-before { border-top-color: #2563eb; }
    .navnum { width: 15px; text-align: center; font-weight: 700; opacity: .7; flex-shrink: 0; }
    .navkind { flex-shrink: 0; }
    .navname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .navdel { visibility: hidden; border: none; background: none; cursor: pointer; color: inherit;
      font-size: 11px; padding: 0 2px; flex-shrink: 0; border-radius: 4px; }
    .navitem:hover .navdel { visibility: visible; }
    .navdel:hover { background: rgba(220,38,38,.15); color: #dc2626; }
    .navitem.active .navdel:hover { background: rgba(255,255,255,.25); color: #fff; }
    .navadd { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border-top: 1px solid #d7dde6; }
    .navadd button { font-size: 12px; padding: 5px; border: 1px solid #c7d2e8; background: #fff; border-radius: 6px;
      cursor: pointer; color: #2563eb; }
    .navadd button:hover { background: #eef2fb; }

    /* 中間 */
    .center { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .tabbar { display: flex; align-items: center; background: #e8ecf1; border-bottom: 1px solid #cfd6df; padding: 0 8px; }
    .tabbar button { border: none; background: none; padding: 8px 16px; font-size: 13px; cursor: pointer;
      color: #475569; border-bottom: 2px solid transparent; }
    .tabbar button.on { color: #1d4ed8; border-bottom-color: #1d4ed8; background: #f8fafc; font-weight: 600; }
    .tabbar .spacer { flex: 1; }
    /* 驗證分頁放右側（與檢視分頁區隔）；有一條左分隔線 */
    .tabbar .tab-right { margin-left: 10px; border-left: 1px solid #cfd6df; }
    .tabbar .zoom { font-size: 12px; color: #475569; display: flex; align-items: center; gap: 4px; padding-right: 4px; }
    .tabbar select { padding: 3px; border-radius: 5px; }
    .zbtn { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 5px; width: 22px; height: 22px;
      cursor: pointer; color: #475569; line-height: 1; padding: 0; }
    .zbtn:hover:not(:disabled) { background: #eff6ff; color: #1d4ed8; }
    .zbtn:disabled { opacity: .4; cursor: default; }
    .undo-group { margin-right: 8px; }
    .align-group { margin-right: 8px; }
    .align-group .sep { width: 1px; height: 16px; background: #c3cad4; margin: 0 3px; display: inline-block; }
    .zval { min-width: 42px; text-align: center; cursor: pointer; font-variant-numeric: tabular-nums; }
    .zval:hover { color: #1d4ed8; }

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
  private modal = inject(ModalService);

  /** 控制台在專案內新建時的目標專案（?project=）；首次 create 時帶入。 */
  newProjectId?: string;

  /** iframe 嵌入時隱藏「返回控制台」（嵌入端只操作編輯器，不該跳到控制台）。 */
  readonly embedded = window.parent !== window;

  /** 返回連結：從專案新建 → 回該專案；否則回控制台首頁。 */
  get backLink(): unknown[] {
    return this.newProjectId ? ['/projects', this.newProjectId] : ['/'];
  }

  @ViewChild('imageInput') imageInput?: { nativeElement: HTMLInputElement };

  saving = signal(false);
  showIntegration = signal(false);
  rightTab = signal<'props' | 'data'>('props');
  tab = signal<'design' | 'json' | 'preview' | 'validation'>('design');

  // ---- 頁面導覽（節/獨立頁）：HackMD 式收合/釘選 ----
  navPinned = signal(false);
  navOpen = signal(false);
  sectionDropIndex = signal<number | null>(null);
  private dragSectionId: string | null = null;

  toggleNavPin() { this.navPinned.set(!this.navPinned()); }
  collapseNav() { this.navOpen.set(false); this.navPinned.set(false); }
  /** 切換編輯的節；未釘選時切完自動收回（peek 模式） */
  switchSection(id: string) {
    this.state.setActiveSection(id);
    if (!this.navPinned()) this.navOpen.set(false);
  }
  onSectionDragStart(e: DragEvent, id: string) {
    this.dragSectionId = id;
    e.dataTransfer?.setData('text/plain', id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  onSectionDragOver(e: DragEvent, index: number) {
    if (!this.dragSectionId) return;
    e.preventDefault();
    this.sectionDropIndex.set(index);
  }
  onSectionDrop(e: DragEvent, index: number) {
    e.preventDefault();
    if (this.dragSectionId) this.state.reorderSection(this.dragSectionId, index);
    this.clearSectionDrag();
  }
  clearSectionDrag() {
    this.dragSectionId = null;
    this.sectionDropIndex.set(null);
  }
  /** 從導覽面板刪除節（確認後；元素一併刪除）；不觸發切換 */
  async removeSectionFromNav(e: Event, id: string, name: string) {
    e.stopPropagation();
    const ok = await this.modal.confirm({
      title: '刪除節',
      message: `刪除節「${name}」？此節上的元素會一併刪除。`,
      confirmLabel: '刪除',
      danger: true,
    });
    if (ok) this.state.removeSection(id);
  }
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
        { icon: '⧉', label: '重複區塊', action: 'list' },
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
      // 容器/重複區塊的子元素巢狀插入（list 可再巢狀一層）
      const withChildren: Item[] = [];
      const pushWithKids = (item: Item) => {
        withChildren.push(item);
        if (isChildHost(item.el)) {
          [...item.el.children].sort((a, b) => a.y - b.y)
            .forEach(c => pushWithKids({ el: c, icon: this.iconOf(c), label: this.labelOf(c), depth: item.depth + 1 }));
        }
      };
      for (const item of g.items) pushWithKids(item);
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
      case 'list': return `重複區塊 ↻${el.key || '?'}（${el.children.length}）`;
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
    // 控制台在專案內新建樣板會帶 ?project=<id>；儲存時一路帶到 create 的 ?projectId。
    this.newProjectId = this.route.snapshot.queryParamMap.get('project') ?? undefined;
    if (id && id !== 'new') {
      this.api.get(id).then(doc => {
        this.state.load(doc);
        this.fonts.ensureForDoc(this.state.template());
        this.bridge.notify('template-loaded', doc.id);
      }).catch(() => this.state.load(emptyTemplate()));
    }
    this.bridge.notify('editor-ready', id === 'new' ? null : id);
  }

  /** 頁面導覽未釘選展開（peek）時，點面板外面就收回（HostListener 跑在 zone 內，會觸發變更偵測） */
  @HostListener('document:pointerdown', ['$event'])
  onDocPointerDown(e: Event) {
    if (this.navOpen() && !this.navPinned()
      && !(e.target as Element)?.closest?.('.navwrap')) {
      this.navOpen.set(false);
    }
  }

  switchTab(tab: 'design' | 'json' | 'preview' | 'validation') {
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

  toggleHidden(e: Event, id: string) {
    e.stopPropagation();
    this.state.toggleHidden(id);
  }

  toggleLocked(e: Event, id: string) {
    e.stopPropagation();
    this.state.toggleLocked(id);
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
      void this.modal.alert({ title: '圖片上傳失敗', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async save() {
    this.saving.set(true);
    try {
      const t = this.state.template();
      const saved = t.id ? await this.api.update(t) : await this.api.create(t, this.newProjectId);
      this.state.load(saved);
      if (!t.id) {
        this.router.navigate(['/editor', saved.id], { replaceUrl: true });
      }
      // 宿主系統由此事件取得樣板 id，之後其後端可 POST /api/templates/{id}/render 填資料出 PDF
      this.bridge.notify('template-saved', saved.id);
    } catch (e) {
      void this.modal.alert({ title: '儲存失敗', message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.saving.set(false);
    }
  }
}
