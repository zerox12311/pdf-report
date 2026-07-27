import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, ViewChild, computed, effect, inject, signal, ElementRef} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ELEMENT_META, TemplateElement, collectFillableValues, emptyTemplate, isChildHost } from '../../core/models/template.model';
import { FontService } from '../../core/services/font.service';
import { EmbedContextService } from '../../core/services/embed-context.service';
import { EmbedTokenService } from '../../core/services/embed-token.service';
import { HostBridgeService } from '../../core/services/host-bridge.service';
import { stripRichMarkup } from '../../core/utils/rich-text';
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
import { JsonEditorComponent } from '../../shared/json-editor.component';

interface PaletteItem {
  icon: string;
  label: string;
  action: PaletteAction | 'image';
}

@Component({
  selector: 'app-editor-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, EditorCanvasComponent, PropertiesPanelComponent, PreviewPanelComponent, ValidationPanelComponent, IntegrationDialogComponent, DataPanelComponent, ContextMenuComponent, JsonEditorComponent],
  providers: [EditorStateService],
  template: `
    <div class="editor">
      <header>
        @if (!embedded && !state.restricted()) {
          <a [routerLink]="backLink" class="back">← {{ (newProjectId ?? templateProjectId()) ? '專案' : '控制台' }}</a>
        }
        <!-- 受限模式唯讀：PATCH /values 不送 name，可改的話等於靜默丟失使用者的修改 -->
        <input class="name" [ngModel]="state.template().name" (ngModelChange)="state.setName($event)"
          [readOnly]="state.restricted()" />
        <div class="right">
          @if (!embedded && !state.restricted()) {
            <button class="link" (click)="showIntegration.set(true)" title="iframe 嵌入與渲染 API 說明">🔗 連接</button>
          }
          @if (state.viewMode()) {
            <span class="viewonly" title="此連結為唯讀模式">👁 唯讀</span>
          } @else {
            <button class="save" (click)="save()" [disabled]="saving()">
              {{ saving() ? '儲存中…' : state.dirty() ? '儲存 *' : '儲存' }}
            </button>
          }
        </div>
      </header>
      @if (showIntegration()) {
        <app-integration-dialog (close)="showIntegration.set(false)" />
      }
      <app-context-menu />

      <div class="body">
        <!-- 左側：元件 + 大綱（Jasper 的 Palette / Outline） -->
        <aside class="left">
          <!-- 受限模式（嵌入 fill/view）：不能新增元件，元件盤整個不出現 -->
          @if (!state.restricted()) {
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
          }
          @if (state.fillMode()) {
            <div class="fill-tip">✏️ 填寫模式：只能修改<b>綠色虛線</b>標示的欄位，版面已鎖定。</div>
          }
          <div class="panel-title">{{ state.fillMode() ? '待填欄位' : '大綱' }}</div>
          <div class="outline">
            @if (state.fillMode() && outlineGroups().length === 0) {
              <div class="empty-band">此表單沒有開放填寫的欄位，請聯絡樣板設計者。</div>
            }
            @for (group of outlineGroups(); track group.name; let gi = $index) {
              <div class="band-name" [class.drop-target]="dropBand() === gi"
                (dragover)="onBandDragOver($event, gi)" (dragleave)="dropBand.set(null)"
                (drop)="onBandDrop($event, gi)">{{ group.name }}</div>
              @if (group.items.length === 0) {
                <div class="empty-band">（無元素）</div>
              }
              @for (item of group.items; track item.key) {
                <div class="node" [class.active]="isOutlineActive(item)"
                  [class.drop-target]="dropTargetId() === item.el.id"
                  [class.node-hidden]="item.el.hidden"
                  [style.paddingLeft.px]="6 + item.depth * 16"
                  [draggable]="!item.el.locked && !state.restricted()"
                  (dragstart)="onOutlineDragStart($event, item.el.id)"
                  (dragend)="clearOutlineDrag()"
                  (dragover)="onOutlineDragOver($event, item.el)"
                  (dragleave)="dropTargetId.set(null)"
                  (drop)="onOutlineDrop($event, item.el)"
                  (click)="revealItem(item)">
                  <span class="icon">{{ item.icon }}</span>
                  <span class="label">{{ item.label }}</span>
                  @if (!state.restricted()) {
                    <button class="del icon-hide" [class.on]="item.el.hidden" [title]="item.el.hidden ? '顯示' : '隱藏'"
                      (click)="toggleHidden($event, item.el.id)">{{ item.el.hidden ? '🚫' : '👁' }}</button>
                    <button class="del icon-lock" [class.on]="item.el.locked" [title]="item.el.locked ? '解鎖' : '鎖定'"
                      (click)="toggleLocked($event, item.el.id)">🔒</button>
                    <button class="del" title="複製" (click)="dupEl($event, item.el.id)">⧉</button>
                    <button class="del" title="刪除" (click)="removeEl($event, item.el.id)">✕</button>
                  }
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
                  @if (state.template().sections.length > 1 && !state.restricted()) {
                    <button class="navdel" title="刪除此節" (click)="removeSectionFromNav($event, s.id, s.name)">✕</button>
                  }
                </div>
              }
            </div>
            @if (!state.restricted()) {
              <div class="navadd">
                <button (click)="state.addSection('flow')" title="新增內容節（有頁首/頁尾 band、自動分頁）">＋節</button>
                <button (click)="state.addSection('single')" title="新增獨立頁（如封面/封底）">＋獨立頁</button>
              </div>
            }
          </div>
        </div>

        <!-- 中間：分頁（設計 / JSON / 預覽） -->
        <main class="center">
          <div class="tabbar">
            <button [class.on]="tab() === 'design'" (click)="switchTab('design')">設計
              @if (!state.restricted()) {
                <!-- 即時渲染開關：開（藍）= 代入範例資料；關（灰）= 顯示變數原文，一眼看出哪裡是變數 -->
                <span class="live-switch" role="switch" [class.off]="state.rawTokenView()"
                  [attr.aria-checked]="!state.rawTokenView()"
                  [title]="state.rawTokenView() ? '目前顯示變數原文——點擊改為代入範例資料' : '目前代入範例資料——點擊改為顯示變數原文'"
                  (click)="$event.stopPropagation(); state.rawTokenView.set(!state.rawTokenView())"
                  ><span class="knob"></span></span>
              }
            </button>
            @if (!embedded && !state.restricted()) {
              <button [class.on]="tab() === 'json'" (click)="switchTab('json')">樣板JSON</button>
            }
            <button [class.on]="tab() === 'preview'" (click)="switchTab('preview')">預覽</button>
            <span class="spacer"></span>
            @if (tab() === 'design' && state.selectedIds().length > 1) {
              <div class="zoom align-group" title="對齊/分佈選取的元素">
                <button class="zbtn" (click)="state.alignSelected('left')" title="左對齊">
                  <svg viewBox="0 0 14 14"><path d="M2.5 1.5v11"/><rect x="4.5" y="3.2" width="7" height="2.4" rx=".6"/><rect x="4.5" y="8.4" width="4.5" height="2.4" rx=".6"/></svg>
                </button>
                <button class="zbtn" (click)="state.alignSelected('hcenter')" title="水平置中">
                  <svg viewBox="0 0 14 14"><path d="M7 1.5v11"/><rect x="3" y="3.2" width="8" height="2.4" rx=".6"/><rect x="4.7" y="8.4" width="4.6" height="2.4" rx=".6"/></svg>
                </button>
                <button class="zbtn" (click)="state.alignSelected('right')" title="右對齊">
                  <svg viewBox="0 0 14 14"><path d="M11.5 1.5v11"/><rect x="2.5" y="3.2" width="7" height="2.4" rx=".6"/><rect x="5" y="8.4" width="4.5" height="2.4" rx=".6"/></svg>
                </button>
                <span class="sep"></span>
                <button class="zbtn" (click)="state.alignSelected('top')" title="頂端對齊">
                  <svg viewBox="0 0 14 14"><path d="M1.5 2.5h11"/><rect x="3.2" y="4.5" width="2.4" height="7" rx=".6"/><rect x="8.4" y="4.5" width="2.4" height="4.5" rx=".6"/></svg>
                </button>
                <button class="zbtn" (click)="state.alignSelected('vcenter')" title="垂直置中">
                  <svg viewBox="0 0 14 14"><path d="M1.5 7h11"/><rect x="3.2" y="3" width="2.4" height="8" rx=".6"/><rect x="8.4" y="4.7" width="2.4" height="4.6" rx=".6"/></svg>
                </button>
                <button class="zbtn" (click)="state.alignSelected('bottom')" title="底端對齊">
                  <svg viewBox="0 0 14 14"><path d="M1.5 11.5h11"/><rect x="3.2" y="2.5" width="2.4" height="7" rx=".6"/><rect x="8.4" y="5" width="2.4" height="4.5" rx=".6"/></svg>
                </button>
                @if (state.selectedIds().length > 2) {
                  <span class="sep"></span>
                  <button class="zbtn" (click)="state.distributeSelected('h')" title="水平等距分佈">
                    <svg viewBox="0 0 14 14"><path d="M2 2v10M12 2v10"/><rect x="5.8" y="4" width="2.4" height="6" rx=".6"/></svg>
                  </button>
                  <button class="zbtn" (click)="state.distributeSelected('v')" title="垂直等距分佈">
                    <svg viewBox="0 0 14 14"><path d="M2 2h10M2 12h10"/><rect x="4" y="5.8" width="6" height="2.4" rx=".6"/></svg>
                  </button>
                }
              </div>
            }
            @if (tab() === 'design') {
              <div class="zoom undo-group">
                <button class="zbtn" [disabled]="!state.undoCount()" (click)="state.undo()" title="上一步（Ctrl/⌘+Z）">
                  <svg viewBox="0 0 14 14"><path d="M2.5 5.5H9a3.25 3.25 0 1 1 0 6.5H5.5"/><path d="M5.5 2.5 2.5 5.5l3 3"/></svg>
                </button>
                <button class="zbtn" [disabled]="!state.redoCount()" (click)="state.redo()" title="重做（Ctrl/⌘+Shift+Z）">
                  <svg viewBox="0 0 14 14"><path d="M11.5 5.5H5a3.25 3.25 0 1 0 0 6.5h3.5"/><path d="M8.5 2.5l3 3-3 3"/></svg>
                </button>
              </div>
              <div class="zoom" title="觸控板捏合可縮放（30%–300%）；點百分比重設 120%">縮放
                <button class="zbtn" (click)="zoomBy(-0.1)" title="縮小">
                  <svg viewBox="0 0 14 14"><path d="M3 7h8"/></svg>
                </button>
                <span class="zval" (click)="state.zoom.set(1.2)">{{ zoomPct() }}%</span>
                <button class="zbtn" (click)="zoomBy(0.1)" title="放大">
                  <svg viewBox="0 0 14 14"><path d="M7 3v8M3 7h8"/></svg>
                </button>
                <button class="zbtn zfit" (click)="fitZoom()" title="符合寬度：整張紙剛好放進畫布">
                  <svg viewBox="0 0 14 14"><path d="M2 2.5v9M12 2.5v9"/><path d="M4.2 7h5.6M5.7 5.5 4.2 7l1.5 1.5M8.3 5.5 9.8 7 8.3 8.5"/></svg>
                </button>
              </div>
            }
            @if (!embedded && !state.restricted()) {
              <button class="tab-right" [class.on]="tab() === 'validation'" (click)="switchTab('validation')"
                title="輸入資料驗證（schema）">✓ 驗證</button>
            }
          </div>
          @switch (tab()) {
            @case ('design') { <app-editor-canvas (elementPicked)="rightTab.set('props')" /> }
            @case ('json') {
              <div class="json-tab">
                <app-json-editor [value]="jsonText()" (valueChange)="jsonText.set($event)" />
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
            <!-- 受限模式不給「資料」分頁：拖 key 生成元件會被守衛擋掉（死 UI），
                 而且它會把樣板所有資料綁定 key 攤給填單者看 -->
            @if (!state.restricted()) {
              <div class="rtabs">
                <button [class.on]="rightTab() === 'props'" (click)="rightTab.set('props')">屬性</button>
                <button [class.on]="rightTab() === 'data'" (click)="rightTab.set('data')">資料</button>
              </div>
            }
            @if (rightTab() === 'props' || state.restricted()) { <app-properties-panel /> } @else { <app-data-panel /> }
          </aside>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; height: 100vh;
      /* 分頁列高度：頁面導覽浮層要從它下方開始，兩處共用同一個值才不會各自漂移 */
      --tabbar-h: 37px; }
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
    .viewonly { color: #94a3b8; font-size: 13px; padding: 6px 10px; border: 1px solid #475569;
      border-radius: 6px; }
    .fill-tip { margin: 10px 8px; padding: 8px 10px; background: #f0fdf4; border: 1px solid #bbf7d0;
      border-radius: 8px; color: #15803d; font-size: 12px; line-height: 1.5; }
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
    /* 浮層從分頁列下方開始：蓋住「設計／樣板JSON」時使用者會整個點不動上方分頁列 */
    .navwrap.peek .navpanel { display: flex; position: absolute; left: 26px; top: var(--tabbar-h); bottom: 0; width: 190px;
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
    .tabbar { display: flex; align-items: center; height: var(--tabbar-h); box-sizing: border-box;
      background: #e8ecf1; border-bottom: 1px solid #cfd6df; padding: 0 8px;
      flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin; }
    .tabbar > * { flex-shrink: 0; }
    .tabbar button, .tabbar .zoom { white-space: nowrap; }
    .tabbar button { border: none; background: none; padding: 8px 16px; font-size: 13px; cursor: pointer;
      color: #475569; border-bottom: 2px solid transparent; }
    .tabbar button.on { color: #1d4ed8; border-bottom-color: #1d4ed8; background: #f8fafc; font-weight: 600; }
    .tabbar .spacer { flex: 1; }
    /* 驗證分頁放右側（與檢視分頁區隔）；有一條左分隔線 */
    .tabbar .tab-right { margin-left: 10px; border-left: 1px solid #cfd6df; }
    .tabbar .zoom { font-size: 12px; color: #475569; display: flex; align-items: center; gap: 4px; padding-right: 4px; }
    .tabbar select { padding: 3px; border-radius: 5px; }
    /* 設計分頁內的即時渲染開關：開（藍）= 代入資料；關（灰）= 變數原文 */
    .live-switch { display: inline-block; width: 26px; height: 14px; border-radius: 7px; margin-left: 6px;
      background: #2563eb; vertical-align: -2px; cursor: pointer; position: relative;
      transition: background .15s; }
    .live-switch .knob { position: absolute; top: 2px; left: 14px; width: 10px; height: 10px;
      border-radius: 50%; background: #fff; transition: left .15s; }
    .live-switch.off { background: #cbd5e1; }
    .live-switch.off .knob { left: 2px; }
    /* .tabbar button 的分頁樣式（padding 8px 16px＋2px 底線）優先權較高會蓋掉 .zbtn，
       這裡用 .tabbar .zoom .zbtn 拿回控制權並以 flex 置中字符 */
    /* 工具列小按鈕：扁平、flex 置中；圖示一律用內嵌 SVG（Unicode 箭頭字符的墨水
       在字身框內偏上 1–2.5px、修不完，SVG 幾何可控保證置中） */
    .tabbar .zoom .zbtn, .zbtn { border: none; background: none; border-radius: 5px;
      width: 22px; height: 22px; box-sizing: border-box; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; color: #475569; line-height: 1; }
    .zbtn svg { display: block; width: 14px; height: 14px; overflow: visible; }
    .zbtn svg path { fill: none; stroke: currentColor; stroke-width: 1.4;
      stroke-linecap: round; stroke-linejoin: round; }
    .zbtn svg rect { fill: currentColor; stroke: none; }
    .tabbar .zoom .zbtn:hover:not(:disabled), .zbtn:hover:not(:disabled) { background: #d8dfe8; color: #1d4ed8; }
    .zbtn:disabled { opacity: .4; cursor: default; }
    .undo-group { margin-right: 8px; }
    .align-group { margin-right: 8px; }
    .align-group .sep { width: 1px; height: 16px; background: #c3cad4; margin: 0 3px; display: inline-block; }
    .zval { min-width: 42px; text-align: center; cursor: pointer; font-variant-numeric: tabular-nums; }
    .zval:hover { color: #1d4ed8; }

    .json-tab { flex: 1; display: flex; flex-direction: column; padding: 10px; gap: 8px; min-height: 0; background: #eef1f5; }
    .json-tab app-json-editor { flex: 1; min-height: 0; }
    .json-tab textarea { flex: 1; font-family: monospace; font-size: 12px; border: 1px solid #ccc;
      border-radius: 6px; padding: 10px; resize: none; }
    .json-actions { display: flex; align-items: center; gap: 10px; }
    .rpanel { width: 280px; flex-shrink: 0; border-left: 1px solid #ddd; background: #fafafa;
      display: flex; flex-direction: column; min-height: 0; }

    /* 嵌入 iframe 的常見寬度：分頁標籤原本會被擠成直排、畫布只剩三分之一，
       設計模式幾乎不能用。收窄兩側與分頁內距，把空間讓給畫布。 */
    @media (max-width: 1100px) {
      .rpanel { width: 232px; }
      .tabbar button { padding: 8px 10px; font-size: 12.5px; }
      header { gap: 8px; padding: 6px 8px; }
    }
    @media (max-width: 880px) {
      .rpanel { width: 200px; }
      .tabbar button { padding: 7px 7px; font-size: 12px; }
      .tabbar .zoom { font-size: 11px; }
    }
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
  private host = inject(ElementRef<HTMLElement>);
  private api = inject(TemplateApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private modal = inject(ModalService);

  /** 站內導航（返回鍵/上一頁/改網址）離開前的未儲存確認；路由 canDeactivate 呼叫。 */
  async confirmLeave(): Promise<boolean> {
    if (!this.state.dirty()) return true;
    return this.modal.confirm({
      title: '有未儲存的變更',
      message: '離開後這些變更會遺失。要放棄變更離開，還是留下來儲存？',
      confirmLabel: '放棄變更並離開',
      cancelLabel: '留在編輯器',
      danger: true,
    });
  }

  /** 關閉/重新整理瀏覽器前的未儲存提醒（瀏覽器原生對話框，內容不可自訂）。 */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(e: BeforeUnloadEvent) {
    if (this.state.dirty()) e.preventDefault();
  }

  /** 控制台在專案內新建時的目標專案（?project=）；首次 create 時帶入。 */
  newProjectId?: string;

  /** 既有樣板所屬專案（載入時由 X-Project-Id header 得知）；重載/書籤/存檔後回家用。 */
  templateProjectId = signal<string | null>(null);

  /** iframe 嵌入時隱藏「返回控制台」（嵌入端只操作編輯器，不該跳到控制台）。 */
  readonly embedded = window.parent !== window;

  /** 返回連結：優先回新建時帶入的專案，其次回樣板所屬專案，都沒有才回控制台首頁。 */
  get backLink(): unknown[] {
    const pid = this.newProjectId ?? this.templateProjectId();
    return pid ? ['/projects', pid] : ['/'];
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
        { icon: 'T', label: '文字（變數）', action: 'text' },
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
    type Item = { key: string; el: TemplateElement; icon: string; label: string; depth: number; cell?: { row: number; col: number } };
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
      g.items.push({ key: el.id, el, icon: this.iconOf(el), label: this.labelOf(el), depth: 0 });
    }
    for (const g of groups) {
      g.items.sort((a, b) => a.el.y - b.el.y);
      // 容器/重複區塊的子元素巢狀插入（list 可再巢狀一層）
      const withChildren: Item[] = [];
      const pushWithKids = (item: Item) => {
        withChildren.push(item);
        if (isChildHost(item.el)) {
          [...item.el.children].sort((a, b) => a.y - b.y)
            .forEach(c => pushWithKids({ key: c.id, el: c, icon: this.iconOf(c), label: this.labelOf(c), depth: item.depth + 1 }));
        }
      };
      for (const item of g.items) pushWithKids(item);
      // 填寫模式：大綱＝「待填欄位清單」，只留改得到的（含有可填儲存格的表格也留，
      // 否則表單型樣板的可填格全在表格裡、大綱會整個空掉）。空的 band 分組不顯示。
      // 填寫模式：大綱＝「待填欄位清單」。表格展開成**逐格**項目——只列表格的話，
      // 清單指給使用者的東西點下去會說「此欄位不開放修改」（可填的是格子不是表格），
      // 使用者當場卡住，還得自己去畫布上找綠框。
      g.items = this.state.fillMode()
        ? withChildren.flatMap(i => this.fillableItems(i))
        : withChildren;
    }
    return this.state.fillMode() ? groups.filter(g => g.items.length > 0) : groups;
  });

  /**
   * 填寫模式的大綱項目：可填的 text 元素照原樣；表格展開成逐格項目（只列真的能填的格）；
   * 其餘一律不列。回傳陣列讓呼叫端 flatMap。
   */
  private fillableItems(item: { key: string; el: TemplateElement; icon: string; label: string; depth: number }) {
    const el = item.el;
    if (el.type === 'table') {
      const out: typeof item[] = [];
      for (let r = 0; r < el.cells.length; r++) {
        for (let c = 0; c < el.cells[r].length; c++) {
          const cell = el.cells[r][c];
          if (cell.kind !== 'text' || !cell.fillable) continue;
          const text = (cell.value ?? '').trim();
          out.push({
            key: `${el.id}#${r},${c}`,
            el,
            icon: '✎',
            label: text || `（空白）第 ${r + 1} 列第 ${c + 1} 欄`,
            depth: item.depth,
            cell: { row: r, col: c },
          } as typeof item);
        }
      }
      return out;
    }
    return this.hasFillable(el) ? [item] : [];
  }

  /**
   * 把填值 API 的錯誤訊息裡的內部定址換成使用者看得懂的欄位。
   * 後端格式：`<elementId>：原因` 或 `<tableId>#<row>,<col>：原因`。
   */
  private humanizeValueError(msg: string): string {
    const sep = msg.indexOf('：');
    if (sep < 0) return msg;
    const addr = msg.slice(0, sep);
    const reason = msg.slice(sep + 1);
    const label = this.labelForValueAddress(addr);
    return label ? `「${label}」${reason}` : msg;
  }

  /** 由定址找出欄位在畫面上的名稱（找不到就回 null，讓呼叫端保留原訊息）。 */
  private labelForValueAddress(addr: string): string | null {
    const [id, rc] = addr.split('#');
    const el = this.state.findElement(id);
    if (!el) return null;
    if (!rc) return el.type === 'text' ? (stripRichMarkup(el.content) || '（空白欄位）').slice(0, 20) : this.labelOf(el);
    const [r, c] = rc.split(',').map(Number);
    const cell = el.type === 'table' ? el.cells[r]?.[c] : null;
    if (!cell) return null;
    const text = (cell.kind === 'text' ? cell.value : '') || '';
    return text.trim() ? text.slice(0, 20) : `表格第 ${r + 1} 列第 ${c + 1} 欄`;
  }

  /** 大綱項目是否為目前選取（儲存格項目要連座標一起比） */
  isOutlineActive(item: { el: TemplateElement; cell?: { row: number; col: number } }): boolean {
    if (item.el.id !== this.state.selectedId()) return false;
    const sel = this.state.selectedCell();
    if (!item.cell) return !sel;
    return !!sel && sel.row === item.cell.row && sel.col === item.cell.col;
  }

  /** 點大綱：一般元素選元素；儲存格項目連同該格一起選起來（填寫模式直接可編輯） */
  revealItem(item: { el: TemplateElement; cell?: { row: number; col: number } }) {
    this.revealEl(item.el.id);
    this.state.selectedCell.set(item.cell ? { ...item.cell } : null);
  }

  /** 該元素本身可填，或（表格）內含可填的 text 儲存格。 */
  private hasFillable(el: TemplateElement): boolean {
    // 只有 text 元素的 fillable 有效（與後端白名單一致）——否則改過型別的殘留
    // fillable（例如 placeholder）會被列進待填清單，標籤還會把綁定 key 印出來
    if (el.type === 'text' && el.fillable) return true;
    if (el.type === 'table') {
      return el.cells.some(row => row.some(c => c.kind === 'text' && c.fillable));
    }
    return false;
  }

  private iconOf(el: TemplateElement): string {
    return ELEMENT_META[el.type].icon;
  }

  private labelOf(el: TemplateElement): string {
    switch (el.type) {
      case 'text': return stripRichMarkup(el.content).split('\n')[0] || '文字';
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
  private embedToken = inject(EmbedTokenService);
  private embedCtx = inject(EmbedContextService);

  private fonts = inject(FontService);

  constructor() {
    // 儲存格圖片：canvas 發出請求 → 開檔案選擇器（上傳後在 onImagePicked 設進該格）
    effect(() => {
      if (this.state.imagePickRequest()) this.imageInput?.nativeElement.click();
    });
    const id = this.route.snapshot.paramMap.get('id');
    // 控制台在專案內新建樣板會帶 ?project=<id>；儲存時一路帶到 create 的 ?projectId。
    this.newProjectId = this.route.snapshot.queryParamMap.get('project') ?? undefined;

    // Embed token 兩種交付方式：
    //  1) URL fragment（推薦、零事件）：宿主 `<iframe src=".../editor/:id#token=xxx">`，前端不用寫任何 JS。
    //  2) postMessage（fallback）：宿主收到 editor-ready 後 post `pdf-template-set-token`（不想讓 token 進 URL 時用）。
    // 非嵌入（控制台）：走 session cookie，直接載入。
    const urlToken = this.readUrlToken();
    if (urlToken) {
      this.embedToken.token.set(urlToken);
      this.tokenReceived = true;
    }
    if (this.embedded) {
      window.addEventListener('message', this.onHostMessage);
      inject(DestroyRef).onDestroy(() => window.removeEventListener('message', this.onHostMessage));
    }
    // 有 token（URL）或非嵌入（session）→ 直接載入；嵌入但無 URL token → 等 postMessage 交付。
    if (this.tokenReceived || !this.embedded) {
      this.loadInitial(id);
    }
    this.bridge.notify('editor-ready', id === 'new' ? null : id);
  }

  private tokenReceived = false;

  /**
   * 從 URL fragment 讀 embed token（宿主零事件交付）：`.../editor/:id#token=xxx`。
   * 用 fragment 不用 query：fragment 不會送到後端（不進 access log）、不進 Referer header。
   */
  private readUrlToken(): string | null {
    const hash = window.location.hash;
    if (!hash) return null;
    const t = new URLSearchParams(hash.replace(/^#/, '')).get('token');
    return t && t.length > 0 ? t : null;
  }

  /**
   * 宿主 → iframe 的訊息（postMessage fallback；on destroy 才移除）：
   * - `pdf-template-set-token`：存下 token（interceptor 之後掛 Bearer）並載入初始資料（只處理一次；URL 已帶 token 時略過）。
   */
  private onHostMessage = (e: MessageEvent) => {
    const d = e.data;
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'pdf-template-set-token' && typeof d.token === 'string') {
      if (this.tokenReceived) return;
      this.tokenReceived = true;
      this.embedToken.token.set(d.token);
      this.loadInitial(this.route.snapshot.paramMap.get('id'));
    }
  };

  /** 載入字型與（既有樣板時）樣板內容。 */
  private loadInitial(id: string | null) {
    // 先問後端本憑證的嵌入模式與能力（與後端強制同源），據此鎖 UI
    void this.embedCtx.refresh().then(ctx => {
      this.state.fillMode.set(ctx.mode === 'fill');
      this.state.viewMode.set(ctx.mode === 'view');
    });
    void this.fonts.refresh();
    if (id && id !== 'new') {
      this.api.getWithProject(id).then(({ doc, projectId }) => {
        this.templateProjectId.set(projectId); // 返回時回到樣板所屬專案
        this.state.load(doc);
        this.autoFitIfClipped();
        this.fonts.ensureForDoc(this.state.template());
        this.bridge.notify('template-loaded', doc.id);
      }).catch(() => this.state.load(emptyTemplate())); // 失敗時 projectId 維持 null → 乾淨退回首頁
    }
  }

  /** Esc 收回頁面導覽浮層（沒有這個就只能再按一次 ▤，使用者會覺得關不掉） */
  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.navOpen() && !this.navPinned()) this.navOpen.set(false);
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

  /**
   * 符合寬度：把整張紙縮到剛好放進畫布可視區。
   * 嵌入 iframe 時預設 120% 會讓 A4 比可視區寬，使用者只看得到紙的一部分，
   * 又不見得知道要去調縮放。
   */
  fitZoom() {
    const z = this.fitZoomValue();
    if (z) this.state.zoom.set(z);
  }

  /** 載入後若整張紙塞不進畫布（典型：嵌在窄 iframe 裡），自動縮到符合寬度。
   *  放得下就完全不動使用者的縮放設定。 */
  private autoFitIfClipped() {
    setTimeout(() => {
      const fit = this.fitZoomValue();
      if (fit && fit < this.state.zoom()) this.state.zoom.set(fit);
    });
  }

  /** 算出「符合寬度」的縮放值；量不到元素或已經放得下就回 null。 */
  private fitZoomValue(): number | null {
    const wrap = this.host.nativeElement.querySelector('.canvas-wrap') as HTMLElement | null;
    if (!wrap) return null;
    const avail = wrap.clientWidth - 48; // 扣掉尺規與左右留白
    const pageW = this.state.activePage().width;
    if (avail <= 0 || pageW <= 0) return null;
    return Math.min(3, Math.max(0.3, Math.round((avail / pageW) * 100) / 100));
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
    if (this.state.viewMode()) return; // 唯讀模式沒有儲存
    this.saving.set(true);
    try {
      const t = this.state.template();
      // 填寫模式：只送被標記可填的欄位值（走窄 API，後端只認這些）
      if (this.state.fillMode() && t.id) {
        const values = collectFillableValues(t);
        if (Object.keys(values).length === 0) {
          // 設計者沒開放任何欄位：講人話，不要把後端的「values 不可為空」丟給填單者
          void this.modal.alert({ title: '沒有可填欄位', message: '這份表單目前沒有開放填寫的欄位，請聯絡樣板設計者。' });
          return;
        }
        try {
          await this.api.patchValues(t.id, values);
        } catch (e) {
          // 後端的訊息以「<欄位定址>：原因」開頭，定址是內部 id（例如 llhtl58w），
          // 填單者看不懂那是哪一欄。換成他在畫面上看得到的欄位標題。
          throw new Error(this.humanizeValueError(e instanceof Error ? e.message : String(e)));
        }
        // 不用 state.load()：那會清空 undo、取消選取、跳回第一節。
        // 送出的就是畫面上的值，DB 已與畫面一致，只要把「未存」標記清掉。
        this.state.dirty.set(false);
        this.bridge.notify('template-saved', t.id);
        return;
      }
      const doc = this.state.docForSave();
      const saved = t.id ? await this.api.update(doc) : await this.api.create(doc, this.newProjectId);
      // 只同步 id/updatedAt，不重載整份文件——load() 會清空復原歷史（存完發現改錯就救不回來）
      this.state.markSaved(saved);
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
