import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, output, signal } from '@angular/core';
import { ChildHostElement, CornerRadii, TemplateElement, cornerRadiiOf, isChildHost } from '../../core/models/template.model';
import { STRIP, modelToVisualY, visualToModelY } from './band-geometry';
import { CanvasElementComponent } from './canvas-element.component';
import { ContextMenuItem, EditorStateService } from './editor-state.service';
import { DataKeyPayload, PaletteAction, canDropIntoCell, createElements, elementToCellPatch, placeholderFromData, tableFromArray } from './element-factory';
import { mmToPt, ptToMm, sectionWatermark } from '../../core/models/template.model';
import { alignTargets, containerTargets, sizeTargets, snapAxis } from './snapping';

@Component({
  selector: 'app-editor-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, CanvasElementComponent],
  template: `
    <div class="canvas-wrap" (pointerdown)="onCanvasPointerDown($event)"
      (contextmenu)="onCanvasMenu($event)"
      (dragover)="onPaletteDragOver($event)" (drop)="onPaletteDrop($event)"
      (dragleave)="dropContainerId.set(null)">
      <div class="page" [style.width.px]="pageW() * z()" [style.height.px]="totalVisualH()">
        <!-- 框選矩形（畫布空白拖曳）-->
        @if (marquee(); as m) {
          <div class="marquee" [style.left.px]="m.x" [style.top.px]="m.y"
            [style.width.px]="m.w" [style.height.px]="m.h"></div>
        }
        <!-- 浮水印（示意；目前節的有效浮水印，輸出以後端為準） -->
        @if (wm(); as w) {
          @if (w.enabled) {
            <div class="wm" [style.zIndex]="w.layer === 'above' ? 8 : 1"
              [style.fontSize.px]="(w.fontSize || 72) * z()" [style.color]="w.color || '#e5e7eb'">
              <div class="wm-rot" [style.transform]="'rotate(' + -(w.rotation || 0) + 'deg)'">
                @if (w.repeat) {
                  <div class="wm-grid" [style.columnGap.px]="(w.gapX || 0) * z()" [style.rowGap.px]="(w.gapY || 0) * z()">
                    @for (t of wmTiles(); track $index) { <span>{{ w.text }}</span> }
                  </div>
                } @else {
                  <span>{{ w.text }}</span>
                }
              </div>
            </div>
          }
        }
        <!-- 尺規（左上角切換 pt/mm/in，跟縮放連動） -->
        <button class="ruler-corner" (pointerdown)="$event.stopPropagation()" (click)="state.cycleRulerUnit()"
          title="切換尺規單位（pt → mm → in）">{{ state.rulerUnit().toUpperCase() }}</button>
        <div class="ruler ruler-h">
          @for (t of rulerH(); track $index) {
            <div class="tick" [class.major]="t.major" [style.left.px]="t.px">
              @if (t.major) { <span>{{ t.v }}</span> }
            </div>
          }
        </div>
        <div class="ruler ruler-v">
          @for (t of rulerV(); track $index) {
            <div class="tick" [class.major]="t.major" [style.top.px]="t.px">
              @if (t.major) { <span>{{ t.v }}</span> }
            </div>
          }
        </div>

        <!-- 頁面邊界輔助線 -->
        @if (margins(); as m) {
          @if (m.left > 0) { <div class="mguide mg-v" [style.left.px]="m.left * z()"></div> }
          @if (m.right > 0) { <div class="mguide mg-v" [style.left.px]="(pageW() - m.right) * z()"></div> }
          @if (m.top > 0) { <div class="mguide mg-h" [style.top.px]="modelToVisualY(m.top)"></div> }
          @if (m.bottom > 0) { <div class="mguide mg-h" [style.top.px]="modelToVisualY(pageH() - m.bottom)"></div> }
          <!-- 尺規上的邊界標記（Word 式，可拖曳；一律顯示以利發現） -->
          <div class="mmark mmark-h" [style.left.px]="m.left * z()" title="拖曳調整左邊界" (pointerdown)="onMarginDown($event, 'left')"></div>
          <div class="mmark mmark-h" [style.left.px]="(pageW() - m.right) * z()" title="拖曳調整右邊界" (pointerdown)="onMarginDown($event, 'right')"></div>
          <div class="mmark mmark-v" [style.top.px]="modelToVisualY(m.top)" title="拖曳調整上邊界" (pointerdown)="onMarginDown($event, 'top')"></div>
          <div class="mmark mmark-v" [style.top.px]="modelToVisualY(pageH() - m.bottom)" title="拖曳調整下邊界" (pointerdown)="onMarginDown($event, 'bottom')"></div>
        }

        <!-- 對齊輔助線 -->
        @if (guideV(); as gv) { <div class="guide guide-v" [style.left.px]="gv"></div> }
        @if (guideH(); as gh) { <div class="guide guide-h" [style.top.px]="gh"></div> }

        <!-- band 背景區段（封面/封底 = 獨立整頁，無 band） -->
        @if (isMain()) {
          <div class="band-bg" [style.height.px]="headerH() * z()"></div>
          <div class="strip" (pointerdown)="onStripDown($event, 'header')">
            <span>頁首 Page Header</span><span class="h">{{ headerH() }} pt ⇕</span>
          </div>
          <div class="band-bg" [style.height.px]="bodyH() * z()"></div>
          <div class="strip" (pointerdown)="onStripDown($event, 'body')">
            <span>內文 Detail</span><span class="h">{{ bodyH() | number: '1.0-0' }} pt ⇕</span>
          </div>
          <div class="band-bg" [style.height.px]="footerH() * z()"></div>
          <div class="strip last"><span>頁尾 Page Footer</span><span class="h">{{ footerH() }} pt</span></div>
        } @else {
          <div class="surface-tag">{{ state.activeSection().name }}（獨立頁，不套頁首/頁尾）</div>
        }

        <!-- 元素層 -->
        @for (el of state.visibleElements(); track el.id) {
          <div
            class="el"
            [attr.data-el-id]="el.id"
            [class.cellsel]="el.type === 'table'"
            [class.selected]="state.selectedIds().includes(el.id)"
            [class.multi]="state.selectedIds().length > 1 && state.selectedIds().includes(el.id)"
            [class.el-hidden]="el.hidden"
            [class.el-locked]="el.locked"
            [class.drop-hint]="(el.type === 'container' || el.type === 'list') && el.id === dropContainerId()"
            [style.zIndex]="el.aboveWatermark && wm()?.layer === 'above' ? 9 : null"
            [style.left.px]="el.x * z()"
            [style.top.px]="modelToVisualY(el.y)"
            [style.width.px]="el.width * z()"
            [style.height.px]="elHeight(el) * z()"
            [style.transform]="el.rotation ? 'rotate(' + el.rotation + 'deg)' : null"
            (pointerdown)="onPointerDown($event, el, 'move')"
            (contextmenu)="onElementMenu($event, el, null)"
          >
            @if (el.type === 'container' || el.type === 'list') {
              @if (el.type === 'container') {
                <div class="container-box"
                  [style.border]="el.borderWidth > 0 ? (el.borderWidth * z()) + 'px solid ' + el.borderColor : '1px dashed #94a3b8'"
                  [style.background]="el.fillColor ?? 'transparent'">
                  @if (el.title) { <div class="container-title">{{ el.title }}</div> }
                </div>
              } @else {
                <div class="list-box">
                  <div class="list-tag" title="重複區塊：每筆資料蓋一次此版面（往下堆）">⧉ {{ el.key || '未綁定 key' }} · 每筆一列</div>
                </div>
              }
              @for (child of el.children ?? []; track child.id) {
                <div class="el child"
                  [attr.data-el-id]="child.id"
                  [class.cellsel]="child.type === 'table'"
                  [class.selected]="child.id === state.selectedId()"
                  [class.drop-hint]="child.type === 'list' && child.id === dropContainerId()"
                  [class.el-hidden]="child.hidden"
                  [class.el-locked]="child.locked"
                  [style.left.px]="child.x * z()"
                  [style.top.px]="child.y * z()"
                  [style.width.px]="child.width * z()"
                  [style.height.px]="elHeight(child) * z()"
                  (pointerdown)="onPointerDown($event, child, 'move', el)"
                  (contextmenu)="onElementMenu($event, child, el)"
                >
                  @if (child.type === 'list') {
                    <!-- 巢狀明細（第二層）：子畫布內容自由擺放，孫元素相對此區塊 -->
                    <div class="list-box nested">
                      <div class="list-tag" title="巢狀明細：外層每筆底下，依此陣列每筆蓋一次">⧉ {{ child.key || '未綁定 key' }} · 子明細</div>
                    </div>
                    @for (gc of child.children ?? []; track gc.id) {
                      <div class="el child"
                        [attr.data-el-id]="gc.id"
                        [class.selected]="gc.id === state.selectedId()"
                        [class.el-hidden]="gc.hidden"
                        [class.el-locked]="gc.locked"
                        [style.left.px]="gc.x * z()"
                        [style.top.px]="gc.y * z()"
                        [style.width.px]="gc.width * z()"
                        [style.height.px]="elHeight(gc) * z()"
                        (pointerdown)="onPointerDown($event, gc, 'move', child)"
                        (contextmenu)="onElementMenu($event, gc, child)"
                      >
                        <app-canvas-element [el]="gc" />
                        @if (gc.locked) { <div class="lock-badge" title="已鎖定">🔒</div> }
                        @if (gc.id === state.selectedId()) {
                          <div class="resize-handle" (pointerdown)="onPointerDown($event, gc, 'resize', child, 'se')"></div>
                          <div class="resize-e" (pointerdown)="onPointerDown($event, gc, 'resize', child, 'e')"></div>
                          <div class="resize-s" (pointerdown)="onPointerDown($event, gc, 'resize', child, 's')"></div>
                        }
                      </div>
                    }
                  } @else {
                    <app-canvas-element [el]="child" />
                  }
                  @if (child.locked) { <div class="lock-badge" title="已鎖定（從大綱或右鍵解鎖）">🔒</div> }
                  @if (child.id === state.selectedId()) {
                    <div class="resize-handle" (pointerdown)="onPointerDown($event, child, 'resize', el, 'se')"></div>
                    <div class="resize-e" (pointerdown)="onPointerDown($event, child, 'resize', el, 'e')"></div>
                    <div class="resize-s" (pointerdown)="onPointerDown($event, child, 'resize', el, 's')"></div>
                    @if (child.type === 'table') {
                      <div class="move-handle" title="拖曳移動表格"
                        (pointerdown)="onPointerDown($event, child, 'move', el)">✥</div>
                    }
                  }
                </div>
              }
            } @else {
              <app-canvas-element [el]="el" />
            }
            @if (el.locked) { <div class="lock-badge" title="已鎖定（從大綱或右鍵解鎖）">🔒</div> }
            <!-- 圓角把手（Figma 式）：矩形選取時四角各一，拖曳調整（四角一起變） -->
            @if (el.type === 'rect' && (el.shape ?? 'rect') === 'rect' && el.id === state.selectedId()
                 && state.selectedIds().length <= 1 && !el.locked) {
              @for (corner of cornerHandles(el); track corner.key) {
                <div class="radius-handle" [style.left.px]="corner.x" [style.top.px]="corner.y"
                  [title]="'拖曳調整圓角（目前 ' + corner.r + ' pt）'"
                  (pointerdown)="onRadiusDown($event, el, corner.key)"></div>
              }
            }
            @if (el.id === state.selectedId() && state.selectedIds().length <= 1) {
              <!-- 旋轉感應區（Figma 式）：四角外側的透明區，hover 顯示旋轉游標、拖曳繞中心旋轉（Shift 吸附 15°）；不顯示常駐按鈕 -->
              <div class="rot-zone rz-tl" title="拖曳旋轉（Shift 吸附 15°）" (pointerdown)="onRotateDown($event, el)"></div>
              <div class="rot-zone rz-tr" title="拖曳旋轉（Shift 吸附 15°）" (pointerdown)="onRotateDown($event, el)"></div>
              <div class="rot-zone rz-bl" title="拖曳旋轉（Shift 吸附 15°）" (pointerdown)="onRotateDown($event, el)"></div>
              <div class="rot-zone rz-br" title="拖曳旋轉（Shift 吸附 15°）" (pointerdown)="onRotateDown($event, el)"></div>
              <div class="resize-handle" (pointerdown)="onPointerDown($event, el, 'resize', null, 'se')"></div>
              <div class="resize-e" (pointerdown)="onPointerDown($event, el, 'resize', null, 'e')"></div>
              <div class="resize-s" (pointerdown)="onPointerDown($event, el, 'resize', null, 's')"></div>
              @if (el.type === 'table') {
                <div class="move-handle" title="拖曳移動表格"
                  (pointerdown)="onPointerDown($event, el, 'move')">✥</div>
              }
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; flex: 1; overflow: auto; background: #d8dce3; }
    /* 置中用 margin:auto 而非 justify-content:center——後者在內容寬於視窗時左緣會捲不到 */
    .canvas-wrap { min-height: 100%; padding: 20px; display: flex; align-items: flex-start; }
    .page { position: relative; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.3); flex-shrink: 0; margin: 0 auto; }
    .band-bg { background: #fff; }
    .strip { height: 22px; background: linear-gradient(#eceff3, #dde2e9); border-top: 1px solid #c3cad4;
      border-bottom: 1px solid #b6bec9; display: flex; align-items: center; justify-content: space-between;
      padding: 0 8px; font-size: 11px; color: #5b6472; cursor: ns-resize; user-select: none; }
    .strip.last { cursor: default; }
    .strip .h { font-size: 10px; color: #8792a1; }
    .surface-tag { position: absolute; top: 4px; left: 50%; transform: translateX(-50%);
      font-size: 11px; color: #0369a1; background: rgba(224, 242, 254, .9); padding: 2px 12px;
      border-radius: 10px; pointer-events: none; z-index: 10; white-space: nowrap; }
    .wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font-weight: 700; pointer-events: none; z-index: 1; overflow: hidden; white-space: nowrap;
      font-family: 'Noto Sans TC', sans-serif; }
    .wm-rot { flex-shrink: 0; width: 160%; height: 160%; display: flex; align-items: center; justify-content: center; }
    .wm-grid { width: 100%; height: 100%; display: flex; flex-wrap: wrap; align-content: center;
      justify-content: center; overflow: hidden; }
    .ruler-corner { position: absolute; top: -18px; left: -18px; width: 17px; height: 17px; z-index: 16;
      background: #f1f4f8; border: 1px solid #c3cad4; border-left: 2px solid #4f46e5; border-bottom: 2px solid #4f46e5;
      color: #1d4ed8; font-size: 7px; font-weight: 700; cursor: pointer; padding: 0; line-height: 1; }
    .ruler-corner:hover { background: #e0e7ff; }
    .ruler { position: absolute; background: #f1f4f8; z-index: 15; pointer-events: none; overflow: hidden; }
    .ruler-h { top: -18px; left: 0; right: 0; height: 17px; border-bottom: 1px solid #c3cad4; }
    .ruler-v { left: -18px; top: 0; bottom: 0; width: 17px; border-right: 1px solid #c3cad4; }
    .tick { position: absolute; background: #9aa5b3; }
    .ruler-h .tick { bottom: 0; width: 1px; height: 4px; }
    .ruler-h .tick.major { height: 8px; }
    .ruler-v .tick { right: 0; height: 1px; width: 4px; }
    .ruler-v .tick.major { width: 8px; }
    .tick span { position: absolute; font-size: 8px; color: #7c8797; }
    .ruler-h .tick span { left: 2px; bottom: 6px; }
    .ruler-v .tick span { right: 6px; top: -4px; writing-mode: vertical-rl; text-orientation: mixed; }
    .mguide { position: absolute; z-index: 1; pointer-events: none; }
    .mg-v { top: 0; bottom: 0; width: 0; border-left: 1px dashed #7dd3fc; }
    .mg-h { left: 0; right: 0; height: 0; border-top: 1px dashed #7dd3fc; }
    /* 尺規上的邊界拖曳標記（Word 式）：藍色小三角，指向邊界線 */
    .mmark { position: absolute; z-index: 17; width: 0; height: 0; }
    .mmark-h { top: -18px; margin-left: -5px; border-left: 5px solid transparent; border-right: 5px solid transparent;
      border-top: 7px solid #2563eb; cursor: ew-resize; }
    .mmark-v { left: -18px; margin-top: -5px; border-top: 5px solid transparent; border-bottom: 5px solid transparent;
      border-left: 7px solid #2563eb; cursor: ns-resize; }
    .mmark:hover { filter: brightness(1.2); }
    .guide { position: absolute; z-index: 20; pointer-events: none; }
    .guide-v { top: 0; bottom: 0; width: 0; border-left: 1px dashed #f43f5e; }
    .guide-h { left: 0; right: 0; height: 0; border-top: 1px dashed #f43f5e; }
    .el { position: absolute; cursor: move; box-sizing: border-box; z-index: 2; }
    .el.el-hidden { display: none; }
    /* 鎖定：游標禁止＋常駐鎖角標＋hover 橘虛線外框，讓「動不了」一眼可見 */
    .el.el-locked { cursor: not-allowed; }
    .el.el-locked:hover { outline: 1.5px dashed #ea580c; outline-offset: 1px; }
    /* 圓角把手（Figma 式）：角落內側小圓點，拖曳調整圓角 */
    .radius-handle { position: absolute; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px;
      background: #fff; border: 1.5px solid #2563eb; border-radius: 50%; cursor: nwse-resize; z-index: 7; }
    .radius-handle:hover { background: #2563eb; }
    .lock-badge { position: absolute; top: -8px; right: -8px; z-index: 6; font-size: 11px;
      line-height: 1; padding: 1px 2px; background: #fff7ed; border: 1px solid #ea580c;
      border-radius: 4px; opacity: .85; pointer-events: none; }
    .el.el-locked:hover .lock-badge { opacity: 1; }
    .el.multi { outline: 1.5px solid #7c3aed; }
    .marquee { position: absolute; z-index: 30; pointer-events: none;
      border: 1px solid #7c3aed; background: rgba(124, 58, 237, .1); }
    .el.selected { outline: 1.5px solid #2563eb; z-index: 5; }
    .el:hover:not(.selected) { outline: 1px dashed #93b4f8; }
    .el.child { z-index: 3; }
    .container-box { position: absolute; inset: 0; box-sizing: border-box; }
    .container-title { position: absolute; top: 0; left: 0; font-size: 10px; font-weight: 700;
      color: #334155; background: rgba(241, 245, 249, .9); padding: 1px 8px; border-radius: 0 0 6px 0;
      pointer-events: none; }
    /* 重複區塊：藍色虛線框 + 左上角 key 標籤（一筆的版面；渲染時每筆蓋一次往下堆） */
    .list-box { position: absolute; inset: 0; box-sizing: border-box;
      border: 1px dashed #6366f1; background: rgba(99, 102, 241, .05); }
    .list-tag { position: absolute; top: 0; left: 0; font-size: 10px; font-weight: 700;
      color: #4338ca; background: rgba(224, 231, 255, .95); padding: 1px 8px; border-radius: 0 0 6px 0;
      white-space: nowrap; pointer-events: none; }
    /* 巢狀明細（第二層）：換色以與外層區分 */
    .list-box.nested { border-color: #0d9488; background: rgba(13, 148, 136, .06); }
    .list-box.nested .list-tag { color: #0f766e; background: rgba(204, 251, 241, .95); }
    .resize-handle { position: absolute; right: -6px; bottom: -6px; width: 12px; height: 12px;
      background: #2563eb; border: 2px solid #fff; border-radius: 50%; cursor: nwse-resize; z-index: 6; }
    /* 旋轉感應區：四角外側透明區，hover 才把游標換成旋轉箭頭（不顯示常駐按鈕；同 Figma）。
       雙箭頭弧線環繞各自角落、弧口朝外——四角各一個旋轉角度：bl 0°、tl 90°、tr 180°、br 270°。 */
    .rot-zone { position: absolute; width: 18px; height: 18px; z-index: 5; }
    .rz-bl { left: -17px; bottom: -17px; cursor: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 32 32'><g transform='rotate(0 16 16)' fill='none' stroke-linecap='round' stroke-linejoin='round'><path d='M9 9 A 11.5 11.5 0 0 0 23 23' stroke='white' stroke-width='4.4'/><path d='M9 9 A 11.5 11.5 0 0 0 23 23' stroke='black' stroke-width='2.4'/></g></svg>") 13 13, grab; }
    .rz-tl { left: -17px; top: -17px; cursor: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 32 32'><g transform='rotate(90 16 16)' fill='none' stroke-linecap='round' stroke-linejoin='round'><path d='M9 9 A 11.5 11.5 0 0 0 23 23' stroke='white' stroke-width='4.4'/><path d='M9 9 A 11.5 11.5 0 0 0 23 23' stroke='black' stroke-width='2.4'/></g></svg>") 13 13, grab; }
    .rz-tr { right: -17px; top: -17px; cursor: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 32 32'><g transform='rotate(180 16 16)' fill='none' stroke-linecap='round' stroke-linejoin='round'><path d='M9 9 A 11.5 11.5 0 0 0 23 23' stroke='white' stroke-width='4.4'/><path d='M9 9 A 11.5 11.5 0 0 0 23 23' stroke='black' stroke-width='2.4'/></g></svg>") 13 13, grab; }
    .rz-br { right: -17px; bottom: -17px; cursor: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 32 32'><g transform='rotate(270 16 16)' fill='none' stroke-linecap='round' stroke-linejoin='round'><path d='M9 9 A 11.5 11.5 0 0 0 23 23' stroke='white' stroke-width='4.4'/><path d='M9 9 A 11.5 11.5 0 0 0 23 23' stroke='black' stroke-width='2.4'/></g></svg>") 13 13, grab; }
    .resize-e { position: absolute; right: -5px; top: 50%; margin-top: -8px; width: 7px; height: 16px;
      background: #2563eb; border: 2px solid #fff; border-radius: 4px; cursor: ew-resize; z-index: 6; }
    .resize-s { position: absolute; bottom: -5px; left: 50%; margin-left: -8px; width: 16px; height: 7px;
      background: #2563eb; border: 2px solid #fff; border-radius: 4px; cursor: ns-resize; z-index: 6; }
    /* 表格：內容區是儲存格框選（cursor: cell），移動靠左上角手柄（Word 慣例） */
    .el.cellsel { cursor: cell; }
    .move-handle { position: absolute; left: -16px; top: -16px; width: 16px; height: 16px;
      display: flex; align-items: center; justify-content: center; font-size: 11px; line-height: 1;
      color: #1d4ed8; background: #fff; border: 1.5px solid #2563eb; border-radius: 4px;
      cursor: move; z-index: 6; user-select: none; }
    .move-handle:hover { background: #eff6ff; }
    .el.drop-hint { outline: 2px solid #f59e0b; outline-offset: 2px; background: rgba(245, 158, 11, .1);
      box-shadow: 0 0 0 6px rgba(245, 158, 11, .15); }
  `,
})
export class EditorCanvasComponent {
  state = inject(EditorStateService);
  z = this.state.zoom;

  /** 使用者在畫布上點選元素時發出（供父層切回「屬性」分頁；拖 key 建元件走 addElement 不觸發） */
  elementPicked = output<void>();

  /** 目前節的有效頁面（節可覆寫紙張；single 節無 band） */
  page = computed(() => this.state.activePage());
  pageW = computed(() => this.page().width);
  pageH = computed(() => this.page().height);
  headerH = computed(() => Math.max(0, this.page().headerHeight));
  footerH = computed(() => Math.max(0, this.page().footerHeight));
  bodyH = computed(() => this.pageH() - this.headerH() - this.footerH());
  /** flow 節有 3 條 band 標籤列；single 獨立頁是素面整頁 */
  isMain = computed(() => this.state.activeSection().kind === 'flow');

  /** 目前節的有效浮水印（inherit 跟文件、none 不顯示、custom 節專屬） */
  wm = computed(() => sectionWatermark(this.state.template(), this.state.activeSection()));

  /** 頁面邊界（設計輔助線） */
  margins = computed(() => {
    const p = this.state.template().page;
    return {
      top: p.marginTop ?? 0, right: p.marginRight ?? 0,
      bottom: p.marginBottom ?? 0, left: p.marginLeft ?? 0,
    };
  });

  /** 依目前單位產尺規刻度：pt（10/50）、mm（5/10）、in（1/8 吋 / 1 吋） */
  private rulerTicks(lengthPt: number, toPx: (v: number) => number) {
    const unit = this.state.rulerUnit();
    const cfg = unit === 'pt'
      ? { minor: 10, perMajor: 5, toUnit: (v: number) => Math.round(v) }
      : unit === 'mm'
        ? { minor: mmToPt(5), perMajor: 2, toUnit: (v: number) => Math.round(ptToMm(v)) }
        : { minor: 9, perMajor: 8, toUnit: (v: number) => Math.round((v / 72) * 100) / 100 };
    const ticks: { v: number; px: number; major: boolean }[] = [];
    for (let i = 0; i * cfg.minor <= lengthPt + 0.01; i++) {
      const pt = i * cfg.minor;
      ticks.push({ v: cfg.toUnit(pt), px: toPx(pt), major: i % cfg.perMajor === 0 });
    }
    return ticks;
  }

  /** 水平尺規刻度 */
  rulerH = computed(() => this.rulerTicks(this.pageW(), v => v * this.z()));

  /** 垂直尺規刻度（依 band 幾何映射，跨 strip 仍準確） */
  rulerV = computed(() => this.rulerTicks(this.pageH(), v => this.modelToVisualY(v)));

  /** 平鋪浮水印的示意格數（近似後端的鋪排密度，上限防爆量） */
  wmTiles = computed(() => {
    const wm = this.wm();
    if (!wm?.enabled || !wm.repeat) return [];
    const fs = wm.fontSize || 72;
    const textW = Math.max(20, (wm.text || '').length * fs);
    const stepX = textW + Math.max(10, wm.gapX || 0);
    const stepY = fs * 1.2 + Math.max(10, wm.gapY || 0);
    const count = Math.ceil((this.pageW() * 1.7) / stepX) * Math.ceil((this.pageH() * 1.7) / stepY);
    return Array.from({ length: Math.min(400, Math.max(1, count)) });
  });
  totalVisualH = computed(() => this.pageH() * this.z() + (this.isMain() ? 3 * STRIP : 0));

  /** 設計座標（pt）→ 畫面位置（px）；內頁含 band 標籤列位移，封面/封底直接縮放 */
  modelToVisualY(yPt: number): number {
    if (!this.isMain()) return yPt * this.z();
    return modelToVisualY(yPt, this.page(), this.z());
  }

  /** 畫面位置（px）→ 設計座標（pt） */
  visualToModelY(px: number): number {
    if (!this.isMain()) return px / this.z();
    return visualToModelY(px, this.page(), this.z());
  }

  elHeight(el: TemplateElement): number {
    return el.type === 'line' && Math.abs(el.height) < 4 ? 4 : el.height;
  }

  constructor() {
    // 鍵盤：Ctrl/⌘+C/V/X/D 複製貼上、方向鍵微調（Shift = 10pt）、Delete 刪除選取元素
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey) {
        const sel = this.state.selected();
        switch (e.key.toLowerCase()) {
          case 'c': if (sel) { this.state.copyElement(sel.id); e.preventDefault(); } break;
          case 'x': if (sel) { this.state.copyElement(sel.id); this.state.removeElement(sel.id); e.preventDefault(); } break;
          case 'v': this.state.paste(); e.preventDefault(); break;
          case 'd': if (sel) { this.state.duplicateElement(sel.id); e.preventDefault(); } break;
          case 'z':
            if (e.shiftKey) this.state.redo(); else this.state.undo();
            e.preventDefault();
            break;
          case 'y': this.state.redo(); e.preventDefault(); break;
        }
        return;
      }
      const el = this.state.selected();
      if (!el) return;
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case 'ArrowUp': this.state.patchElement(el.id, { y: Math.max(0, el.y - step) }); break;
        case 'ArrowDown': this.state.patchElement(el.id, { y: el.y + step }); break;
        case 'ArrowLeft': this.state.patchElement(el.id, { x: Math.max(0, el.x - step) }); break;
        case 'ArrowRight': this.state.patchElement(el.id, { x: el.x + step }); break;
        case 'Delete': case 'Backspace':
          if (this.state.selectedIds().length > 1) this.state.removeSelected();
          else this.state.removeElement(el.id);
          break;
        case 'Escape': this.state.select(null); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);

    // Mac 觸控板捏合縮放：pinch 在瀏覽器是 ctrlKey 的 wheel 事件（Safari 走 gesture 事件）。
    // 以游標位置為錨點縮放，一般雙指捲動不受影響。
    const host = inject(ElementRef).nativeElement as HTMLElement;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, this.z() * Math.exp(-e.deltaY * 0.01), host);
    };
    let gestureStartZoom = 1;
    const onGestureStart = (e: Event) => { e.preventDefault(); gestureStartZoom = this.z(); };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      this.zoomAt(ge.clientX, ge.clientY, gestureStartZoom * ge.scale, host);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('gesturestart', onGestureStart);
    host.addEventListener('gesturechange', onGestureChange);

    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('keydown', onKey);
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('gesturestart', onGestureStart);
      host.removeEventListener('gesturechange', onGestureChange);
      this.activeDragCleanup?.();
    });
  }

  /** 縮放到 targetZ（夾在 30%–300%），並讓 (cx, cy) 游標下的內容點維持不動 */
  private zoomAt(cx: number, cy: number, targetZ: number, host: HTMLElement) {
    const old = this.z();
    const z = Math.min(3, Math.max(0.3, Math.round(targetZ * 100) / 100));
    if (z === old) return;
    const rect = host.getBoundingClientRect();
    const px = cx - rect.left + host.scrollLeft;
    const py = cy - rect.top + host.scrollTop;
    this.state.zoom.set(z);
    const r = z / old;
    requestAnimationFrame(() => {
      host.scrollLeft = px * r - (cx - rect.left);
      host.scrollTop = py * r - (cy - rect.top);
    });
  }

  /** 進行中拖曳的 listener 清理（元件銷毀時呼叫，防洩漏） */
  private activeDragCleanup: (() => void) | null = null;

  // ---- band 標籤列拖曳 ----
  private stripDrag: { kind: 'header' | 'body'; startY: number; orig: number } | null = null;

  onStripDown(e: PointerEvent, kind: 'header' | 'body') {
    e.stopPropagation();
    e.preventDefault();
    const page = this.page();
    this.stripDrag = {
      kind, startY: e.clientY,
      orig: kind === 'header' ? page.headerHeight : this.bodyH(),
    };
    const onMove = (ev: PointerEvent) => {
      if (!this.stripDrag) return;
      const dPt = (ev.clientY - this.stripDrag.startY) / this.z();
      const page = this.page();
      const secId = this.state.activeSection().id;
      if (this.stripDrag.kind === 'header') {
        const v = Math.round(Math.max(0, Math.min(page.height - page.footerHeight - 40, this.stripDrag.orig + dPt)));
        this.state.patchSection(secId, { headerHeight: v });
      } else {
        const newBody = Math.max(40, this.stripDrag.orig + dPt);
        const v = Math.round(Math.max(0, Math.min(page.height - page.headerHeight - 40, page.height - page.headerHeight - newBody)));
        this.state.patchSection(secId, { footerHeight: v });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.stripDrag = null;
      this.activeDragCleanup = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.activeDragCleanup = onUp;
  }

  // ---- 對齊輔助線 ----
  guideV = signal<number | null>(null);
  guideH = signal<number | null>(null);

  // ---- 拖放進容器的提示（元件盤拖入與畫布內拖曳共用） ----
  dropContainerId = signal<string | null>(null);

  /**
   * 拖曳可進格子的既有元素（圖片/條碼）時：算出指標下的表格儲存格
   * （幾何命中測試——pointer 拖曳不走 HTML5 DnD，且被拖的元素蓋在最上層，
   * elementFromPoint 打不到底下的格子）。
   */
  private updateElementDropCell(e: PointerEvent) {
    if (!this.drag || !canDropIntoCell(this.drag.elType)) return;
    const page = document.querySelector('.page');
    if (!page) {
      this.state.elementDropCell.set(null);
      return;
    }
    const rect = page.getBoundingClientRect();
    const px = (e.clientX - rect.left) / this.z();
    const py = this.visualToModelY(e.clientY - rect.top);
    for (const el of this.state.visibleElements()) {
      if (el.type !== 'table') continue;
      if (px < el.x || px > el.x + el.width || py < el.y || py > el.y + el.height) continue;
      let cx = el.x;
      let col = -1;
      for (let i = 0; i < el.columnWidths.length; i++) {
        if (px < cx + el.columnWidths[i]) { col = i; break; }
        cx += el.columnWidths[i];
      }
      let cy = el.y;
      let row = -1;
      for (let i = 0; i < el.rowHeights.length; i++) {
        if (py < cy + el.rowHeights[i]) { row = i; break; }
        cy += el.rowHeights[i];
      }
      if (col >= 0 && row >= 0) {
        this.state.elementDropCell.set({ tableId: el.id, r: row, c: col });
        return;
      }
    }
    this.state.elementDropCell.set(null);
  }

  /** 找座標（model pt）下的容器型元素（container / 重複區塊 list）；遞迴進巢狀，回傳最深層命中
   *  （用絕對座標判斷——巢狀 list 的座標相對外層）。 */
  private containerAt(x: number, y: number, excludeId: string | null): ChildHostElement | null {
    let best: ChildHostElement | null = null;
    const walk = (els: TemplateElement[], ox: number, oy: number) => {
      for (const el of els) {
        if (!isChildHost(el)) continue;
        const ax = ox + el.x, ay = oy + el.y;
        if (el.id !== excludeId && x >= ax && x <= ax + el.width && y >= ay && y <= ay + el.height) {
          best = el; // 更深層覆蓋外層（子明細優先於外層）
        }
        walk(el.children ?? [], ax, ay);
      }
    };
    walk(this.state.visibleElements(), 0, 0);
    return best;
  }

  /** DragEvent/MouseEvent → 頁面 model 座標（pt） */
  private dropPoint(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const page = document.querySelector('.page');
    if (!page) return null;
    const r = page.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.z(), y: this.visualToModelY(e.clientY - r.top) };
  }

  onPaletteDragOver(e: DragEvent) {
    const types = e.dataTransfer?.types;
    if (!types || (!types.includes('application/x-palette') && !types.includes('application/x-datakey'))) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    const pt = this.dropPoint(e);
    this.dropContainerId.set(pt ? (this.containerAt(pt.x, pt.y, null)?.id ?? null) : null);
  }

  onPaletteDrop(e: DragEvent) {
    // 資料分頁拖來的 key → 生成資料欄位（scalar）或重複表格（陣列）
    const dk = e.dataTransfer?.getData('application/x-datakey');
    if (dk) {
      this.dropContainerId.set(null);
      e.preventDefault();
      const pt = this.dropPoint(e);
      if (!pt) return;
      const p = JSON.parse(dk) as DataKeyPayload;
      const el = p.kind === 'array'
        ? tableFromArray(p.key, p.fields ?? [])
        : placeholderFromData(p.key, p.sample ?? '');
      const target = this.containerAt(pt.x, pt.y, null);
      if (target) {
        this.state.addElementAt(el, pt.x - target.x, pt.y - target.y, target.id);
      } else {
        this.state.addElementAt(el, pt.x, pt.y);
      }
      return;
    }
    const action = e.dataTransfer?.getData('application/x-palette');
    this.dropContainerId.set(null);
    if (!action) return;
    e.preventDefault();
    const pt = this.dropPoint(e);
    if (!pt) return;
    const els = createElements(action as PaletteAction, 0);
    // 以 drop 點為整組元素的左上角（cvs3 套件保留內部相對位移）
    const minX = Math.min(...els.map(el => el.x));
    const minY = Math.min(...els.map(el => el.y));
    // container 一律落頂層；list 若落在「頂層的 list」上則巢狀成兩層，否則落頂層；其餘元素落在指標下的容器
    let target: ChildHostElement | null = null;
    if (action === 'container') {
      target = null;
    } else if (action === 'list') {
      const host = this.containerAt(pt.x, pt.y, null);
      target = host && host.type === 'list' && !this.state.parentOf(host.id) ? host : null;
    } else {
      target = this.containerAt(pt.x, pt.y, null);
    }
    for (const el of els) {
      const x = pt.x + el.x - minX;
      const y = pt.y + el.y - minY;
      if (target) {
        this.state.addElementAt(el, x - target.x, y - target.y, target.id);
      } else {
        this.state.addElementAt(el, x, y);
      }
    }
  }



  // ---- 圓角把手（Figma 式）----
  /** 四角把手的畫面位置（元素內部座標 px）與目前半徑；把手隨半徑往內移 */
  cornerHandles(el: TemplateElement & { cornerRadius?: number; cornerRadii?: CornerRadii }) {
    const z = this.z();
    const [tl, tr, br, bl] = cornerRadiiOf(el);
    const w = el.width * z;
    const h = el.height * z;
    // 把手離角落的距離＝半徑（最小 10px 讓沒圓角時也抓得到）
    const off = (r: number) => Math.max(10, r * z);
    return [
      { key: 'tl' as const, r: Math.round(tl), x: off(tl), y: off(tl) },
      { key: 'tr' as const, r: Math.round(tr), x: w - off(tr), y: off(tr) },
      { key: 'br' as const, r: Math.round(br), x: w - off(br), y: h - off(br) },
      { key: 'bl' as const, r: Math.round(bl), x: off(bl), y: h - off(bl) },
    ];
  }

  /**
   * 拖曳圓角把手：沿對角線往內拖 = 半徑變大（四角一起變，同 Figma）；
   * 個別角的調整在屬性面板。
   */
  onRadiusDown(e: PointerEvent, el: TemplateElement & { width: number; height: number }, corner: 'tl' | 'tr' | 'br' | 'bl') {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    this.state.select(el.id);
    const z = this.z();
    const startX = e.clientX;
    const startY = e.clientY;
    const [tl] = cornerRadiiOf(el as never);
    const startR = tl;
    const maxR = Math.min(el.width, el.height) / 2;
    const onMove = (ev: PointerEvent) => {
      // 往元素內側的位移量（各角方向不同）→ 取兩軸平均當半徑增量
      const dx = (ev.clientX - startX) / z * (corner === 'tl' || corner === 'bl' ? 1 : -1);
      const dy = (ev.clientY - startY) / z * (corner === 'tl' || corner === 'tr' ? 1 : -1);
      const r = Math.max(0, Math.min(maxR, Math.round(startR + (dx + dy) / 2)));
      // 四角一起變：清掉個別半徑
      this.state.patchElement(el.id, { cornerRadius: r || undefined, cornerRadii: undefined });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.activeDragCleanup = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.activeDragCleanup = onUp;
  }

  /** 旋轉把手拖曳：以元素螢幕中心為軸，角度隨指標。Shift 吸附 15°；順時針。 */
  onRotateDown(e: PointerEvent, el: TemplateElement) {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    this.state.select(el.id);
    const page = document.querySelector('.page');
    if (!page) return;
    const rect = page.getBoundingClientRect();
    const z = this.z();
    // 元素中心（CSS 繞中心旋轉，故中心在螢幕上不隨旋轉移動）
    const cx = rect.left + el.x * z + (el.width * z) / 2;
    const cy = rect.top + this.modelToVisualY(el.y) + (this.elHeight(el) * z) / 2;
    const ang = (ev: { clientX: number; clientY: number }) =>
      (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI;
    const startAng = ang(e);
    const startRot = el.rotation ?? 0;
    const onMove = (ev: PointerEvent) => {
      let rot = startRot + (ang(ev) - startAng);
      if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
      else rot = Math.round(rot);
      rot = ((rot % 360) + 360) % 360; // 正規化 0..359
      this.state.patchElement(el.id, { rotation: rot || undefined });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.activeDragCleanup = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.activeDragCleanup = onUp;
  }

  // ---- 右鍵情境選單 ----
  private readonly isMac = /Mac|iP/.test(navigator.platform);
  private key(k: string): string {
    return (this.isMac ? '⌘' : 'Ctrl+') + k;
  }

  /** 元素右鍵：動作類操作（樣式類留在屬性面板） */
  onElementMenu(e: MouseEvent, el: TemplateElement, parent: ChildHostElement | null) {
    e.preventDefault();
    e.stopPropagation();
    this.state.select(el.id);
    const pos = this.state.layerPositionOf(el.id);
    const top = !pos || pos.index >= pos.count - 1;
    const bottom = !pos || pos.index <= 0;
    const items: ContextMenuItem[] = [
      { label: '複製', shortcut: this.key('C'), run: () => this.state.copyElement(el.id) },
      { label: '貼上', shortcut: this.key('V'), disabled: !this.state.hasClipboard(), run: () => this.state.paste() },
      { label: '建立副本', shortcut: this.key('D'), run: () => this.state.duplicateElement(el.id) },
      { kind: 'sep' },
      { label: '上移一層', disabled: top, run: () => this.state.moveLayer(el.id, 'up') },
      { label: '下移一層', disabled: bottom, run: () => this.state.moveLayer(el.id, 'down') },
      { label: '移到最上層', disabled: top, run: () => this.state.moveLayer(el.id, 'front') },
      { label: '移到最下層', disabled: bottom, run: () => this.state.moveLayer(el.id, 'back') },
      { kind: 'sep' },
      // 容器子元素的浮水印階層跟隨容器（引擎規則），不提供獨立開關
      ...(parent ? [] : [{
        label: '置於浮水印之上',
        checked: !!el.aboveWatermark,
        run: () => this.state.patchElement(el.id, { aboveWatermark: !el.aboveWatermark }),
      } satisfies ContextMenuItem]),
      ...(parent ? [{ label: '移出容器', run: () => this.state.moveOutOfContainer(el.id) } satisfies ContextMenuItem] : []),
      { kind: 'sep' },
      { label: '鎖定（畫布不可選/拖）', checked: !!el.locked, run: () => this.state.toggleLocked(el.id) },
      { label: '隱藏（設計＋渲染都不顯示）', checked: !!el.hidden, run: () => this.state.toggleHidden(el.id) },
      { kind: 'sep' },
      { label: '刪除', shortcut: 'Del', danger: true, run: () => this.state.removeElement(el.id) },
    ];
    this.state.openContextMenu(e.clientX, e.clientY, items);
  }

  /** 尺規上的邊界標記拖曳（Word 式）：拖水平尺規調左/右、垂直尺規調上/下邊界 */
  onMarginDown(e: PointerEvent, side: 'left' | 'right' | 'top' | 'bottom') {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    const page = document.querySelector('.page');
    if (!page) return;
    const rect = page.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      const p = this.state.template().page;
      const clamp = (v: number, max: number) => Math.round(Math.max(0, Math.min(v, max)));
      if (side === 'left') {
        const v = (ev.clientX - rect.left) / this.z();
        this.state.patchPage({ marginLeft: clamp(v, p.width - (p.marginRight ?? 0) - 10) });
      } else if (side === 'right') {
        const v = p.width - (ev.clientX - rect.left) / this.z();
        this.state.patchPage({ marginRight: clamp(v, p.width - (p.marginLeft ?? 0) - 10) });
      } else if (side === 'top') {
        const v = this.visualToModelY(ev.clientY - rect.top);
        this.state.patchPage({ marginTop: clamp(v, p.height - (p.marginBottom ?? 0) - 10) });
      } else {
        const v = p.height - this.visualToModelY(ev.clientY - rect.top);
        this.state.patchPage({ marginBottom: clamp(v, p.height - (p.marginTop ?? 0) - 10) });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.activeDragCleanup = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.activeDragCleanup = onUp;
  }

  // ---- 框選（marquee）：畫布空白處拖曳選取多個頂層元素 ----
  marquee = signal<{ x: number; y: number; w: number; h: number } | null>(null);

  onCanvasPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const page = document.querySelector('.page');
    if (!page) { this.state.select(null); return; }
    const rect = page.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const addToSel = e.shiftKey;
    const base = addToSel ? [...this.state.selectedIds()] : [];
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      moved = true;
      // 框（畫面 px，相對 page 左上）
      const x = Math.min(startX, ev.clientX) - rect.left;
      const y = Math.min(startY, ev.clientY) - rect.top;
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      this.marquee.set({ x, y, w, h });
      // 框選命中：把框轉 model 座標，與頂層元素 bbox 相交者選取
      const mx1 = x / this.z();
      const my1 = this.visualToModelY(y);
      const mx2 = (x + w) / this.z();
      const my2 = this.visualToModelY(y + h);
      const hit = this.state.visibleElements()
        .filter(el => !el.locked && !el.hidden
          && el.x < mx2 && el.x + el.width > mx1 && el.y < my2 && el.y + el.height > my1)
        .map(el => el.id);
      const set = new Set([...base, ...hit]);
      this.state.selectMany([...set]);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.marquee.set(null);
      if (!moved && !addToSel) this.state.select(null); // 純點擊空白 = 取消選取
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /** 空白畫布右鍵：貼在滑鼠位置 */
  onCanvasMenu(e: MouseEvent) {
    e.preventDefault();
    const pt = this.dropPoint(e);
    const items: ContextMenuItem[] = [{
      label: '貼上',
      shortcut: this.key('V'),
      disabled: !this.state.hasClipboard() || !pt,
      run: () => { if (pt) this.state.pasteAt(pt.x, pt.y); },
    }];
    this.state.openContextMenu(e.clientX, e.clientY, items);
  }

  // ---- 元素拖曳 / 縮放 ----
  private drag: {
    mode: 'move' | 'resize';
    id: string;
    startX: number;
    startY: number;
    orig: { x: number; y: number; width: number; height: number };
    /** 表格拖曳縮放：起始欄寬/列高（等比縮放用） */
    origTable: { cols: number[]; rows: number[] } | null;
    elType: TemplateElement['type'];
    /** 縮放方向：se 右下角（雙向）、e 右緣（只調寬）、s 下緣（只調高） */
    resizeDir: 'se' | 'e' | 's';
    parent: ChildHostElement | null;
    moved: boolean;
    /** 多選一起移動時，各選取頂層元素的起始座標（null = 單選/縮放） */
    multiOrigins: Map<string, { x: number; y: number }> | null;
  } | null = null;

  onPointerDown(e: PointerEvent, el: TemplateElement, mode: 'move' | 'resize', parent: ChildHostElement | null = null, dir: 'se' | 'e' | 's' = 'se') {
    // 鎖定元素：畫布上完全穿透（不選/不拖），只能從大綱管理；事件冒泡到畫布空白 → 取消選取
    if (el.locked) return;
    e.stopPropagation();
    e.preventDefault();
    this.elementPicked.emit(); // 使用者實際點選畫布元素 → 父層切回「屬性」分頁
    // Shift+點選（頂層元素、非縮放）：加入/移除多選，不進入拖曳
    if (e.shiftKey && !parent && mode === 'move') {
      this.state.toggleSelect(el.id);
      return;
    }
    // 點到已在多選集合中的元素 → 保持多選（一起拖）；否則單選
    const inMulti = !parent && mode === 'move' && this.state.selectedIds().includes(el.id) && this.state.selectedIds().length > 1;
    if (!inMulti) this.state.select(el.id);
    // 右鍵只選取（選單由 contextmenu 開），不進入拖曳
    if (e.button !== 0) return;
    // 多選拖曳：記錄所有選取頂層元素的起始座標
    let multiOrigins: Map<string, { x: number; y: number }> | null = null;
    if (inMulti) {
      multiOrigins = new Map();
      const top = this.state.visibleElements();
      for (const id of this.state.selectedIds()) {
        const se = top.find(x => x.id === id);
        if (se && !se.locked) multiOrigins.set(id, { x: se.x, y: se.y });
      }
    }
    this.drag = {
      mode, id: el.id, startX: e.clientX, startY: e.clientY,
      orig: { x: el.x, y: el.y, width: el.width, height: el.height },
      origTable: el.type === 'table' ? { cols: [...el.columnWidths], rows: [...el.rowHeights] } : null,
      elType: el.type,
      resizeDir: dir,
      parent, moved: false, multiOrigins,
    };
    const onMove = (ev: PointerEvent) => this.onPointerMove(ev);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = this.drag;
      const dropTarget = this.dropContainerId();
      const cellTarget = this.state.elementDropCell();
      this.drag = null;
      this.guideV.set(null);
      this.guideH.set(null);
      this.dropContainerId.set(null);
      this.state.elementDropCell.set(null);
      this.activeDragCleanup = null;
      if (!d || d.mode !== 'move' || !d.moved) return;
      if (d.multiOrigins) return; // 多選一起移動：不做容器/儲存格插入
      // 既有元素（圖片/條碼）放到表格儲存格上 → 該格繼承其來源設定，元素移除
      if (cellTarget) {
        const src = this.state.findElement(d.id);
        const tbl = this.state.findElement(cellTarget.tableId);
        const patch = src ? elementToCellPatch(src) : null;
        if (patch && tbl?.type === 'table') {
          const cells = tbl.cells.map((row, ri) => row.map((cell, ci) =>
            ri === cellTarget.r && ci === cellTarget.c ? { ...cell, ...patch } : cell));
          this.state.patchElement(tbl.id, { cells });
          this.state.removeElement(d.id);
          this.state.select(tbl.id);
          this.state.selectedCell.set({ row: cellTarget.r, col: cellTarget.c });
          this.state.selectedCellRange.set(null);
          return;
        }
      }
      if (d.parent) {
        const cur = this.state.findElement(d.id);
        const p = this.state.parentOf(d.id);
        if (!cur || !p) return;
        // 落在「別的」容器上（含同一外層內更深層的子明細）→ 直接移進去，不必先繞到最外層
        if (dropTarget && dropTarget !== p.id) {
          this.state.moveIntoContainer(d.id, dropTarget);
        } else if (cur.x + cur.width / 2 < 0 || cur.x + cur.width / 2 > p.width
                   || cur.y + cur.height / 2 < 0 || cur.y + cur.height / 2 > p.height) {
          // 中心離開容器、又沒落在別的容器上 → 提升為頂層
          this.state.moveOutOfContainer(d.id);
          const abs = this.state.findElement(d.id);
          if (abs && (abs.x < 0 || abs.y < 0)) {
            this.state.patchElement(d.id, { x: Math.max(0, abs.x), y: Math.max(0, abs.y) });
          }
        } else {
          // 留在容器內 → 夾回範圍
          this.state.patchElement(d.id, {
            x: Math.max(0, Math.min(Math.max(0, p.width - cur.width), cur.x)),
            y: Math.max(0, Math.min(Math.max(0, p.height - cur.height), cur.y)),
          });
        }
      } else if (dropTarget) {
        // 頂層元素落在容器上 → 移進容器
        this.state.moveIntoContainer(d.id, dropTarget);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.activeDragCleanup = onUp;
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.drag) return;
    const dxPx = e.clientX - this.drag.startX;
    const dyPx = e.clientY - this.drag.startY;
    // 閾值 5px：雙擊時的微小晃動不觸發拖曳（否則就地編輯很難點出來）
    if (!this.drag.moved && Math.abs(dxPx) < 5 && Math.abs(dyPx) < 5) return;
    this.drag.moved = true;
    // 多選一起移動（頂層、無磁吸，用 primary 的 band 映射算共同 delta）
    if (this.drag.mode === 'move' && this.drag.multiOrigins) {
      const zoom = this.z();
      const po = this.drag.multiOrigins.get(this.drag.id)!;
      const dx = dxPx / zoom;
      const dy = this.visualToModelY(this.modelToVisualY(po.y) + dyPx) - po.y;
      this.state.moveSelectedBy(this.drag.multiOrigins, dx, dy);
      return;
    }
    // 圖片/條碼元素拖曳：追蹤指標下的儲存格（放開時插入）
    if (this.drag.mode === 'move') this.updateElementDropCell(e);
    const { orig, parent } = this.drag;
    const z = this.z();
    const round = (v: number) => Math.round(v * 10) / 10;
    // 按住 Ctrl/⌘/Shift = 暫停磁吸微調（如 Photoshop）
    const noSnap = e.ctrlKey || e.metaKey || e.shiftKey;

    if (this.drag.mode === 'resize') {
      // 單軸把手（e/s）只動自己的軸
      const dir = this.drag.resizeDir;
      let wPx = orig.width * z + (dir !== 's' ? dxPx : 0);
      let hPx = orig.height * z + (dir !== 'e' ? dyPx : 0);
      if (!noSnap) {
        if (parent) {
          // 容器內：右/下緣對兄弟與容器邊界吸附
          const t = containerTargets(parent, z, this.drag.id);
          const originX = parent.x * z;
          const originY = this.modelToVisualY(parent.y);
          const sx = dir !== 's' ? snapAxis([orig.x * z + wPx], t.xs) : null;
          const sy = dir !== 'e' ? snapAxis([orig.y * z + hPx], t.ys) : null;
          if (sx) { wPx += sx.delta; this.guideV.set(originX + sx.guide); } else { this.guideV.set(null); }
          if (sy) { hPx += sy.delta; this.guideH.set(originY + sy.guide); } else { this.guideH.set(null); }
        } else {
          // 頂層：右/下緣對齊其他元素，沒有邊可對齊時吸附成一樣寬/高
          const els = this.state.visibleElements();
          const targets = alignTargets(els, this.page(), z, y => this.modelToVisualY(y), this.drag.id);
          const dims = sizeTargets(els, z, this.drag.id);
          this.guideV.set(null);
          this.guideH.set(null);
          if (dir !== 's') {
            const edgeX = snapAxis([orig.x * z + wPx], targets.xs);
            const dimX = edgeX ? null : snapAxis([wPx], dims.ws);
            if (edgeX) { wPx += edgeX.delta; this.guideV.set(edgeX.guide); }
            else if (dimX) { wPx += dimX.delta; this.guideV.set(orig.x * z + wPx); }
          }
          if (dir !== 'e') {
            const edgeY = snapAxis([this.modelToVisualY(orig.y) + hPx], targets.ys);
            const dimY = edgeY ? null : snapAxis([hPx], dims.hs);
            if (edgeY) { hPx += edgeY.delta; this.guideH.set(edgeY.guide); }
            else if (dimY) { hPx += dimY.delta; this.guideH.set(this.modelToVisualY(orig.y) + hPx); }
          }
        }
      } else {
        this.guideV.set(null);
        this.guideH.set(null);
      }
      let maxW = Infinity;
      let maxH = Infinity;
      if (parent) {
        maxW = parent.width - orig.x;
        maxH = parent.height - orig.y;
      }
      const wPt = round(Math.min(maxW, Math.max(10, wPx / z)));
      const hPt = round(Math.min(maxH, Math.max(0, hPx / z)));
      const t = this.drag.origTable;
      if (t) {
        // 表格：等比縮放全部欄寬/列高
        const sumC = t.cols.reduce((a, b) => a + b, 0);
        const sumR = t.rows.reduce((a, b) => a + b, 0);
        const cols = t.cols.map(c => round(Math.max(6, (c * wPt) / sumC)));
        const rows = t.rows.map(r => round(Math.max(8, (r * Math.max(8, hPt)) / sumR)));
        this.state.patchElement(this.drag.id, {
          columnWidths: cols,
          rowHeights: rows,
          width: round(cols.reduce((a, b) => a + b, 0)),
          height: round(rows.reduce((a, b) => a + b, 0)),
        });
      } else {
        this.state.patchElement(this.drag.id, { width: wPt, height: hPt });
      }
      return;
    }

    if (parent) {
      // 容器內：相對座標，對兄弟與容器邊界吸附；不夾範圍——拖出邊界放開時會移出容器
      let nx = orig.x * z + dxPx;
      let ny = orig.y * z + dyPx;
      const w = orig.width * z;
      const h = orig.height * z;
      // 巢狀容器（如 list 子明細）座標相對外層 → 用絕對原點畫輔助線/判定落點
      const pAbs = this.state.absPosOf(parent.id) ?? { x: parent.x, y: parent.y };
      if (!noSnap) {
        const t = containerTargets(parent, z, this.drag.id);
        const sx = snapAxis([nx, nx + w / 2, nx + w], t.xs);
        const sy = snapAxis([ny, ny + h / 2, ny + h], t.ys);
        const originX = pAbs.x * z;
        const originY = this.modelToVisualY(pAbs.y);
        if (sx) { nx += sx.delta; this.guideV.set(originX + sx.guide); } else { this.guideV.set(null); }
        if (sy) { ny += sy.delta; this.guideH.set(originY + sy.guide); } else { this.guideH.set(null); }
      } else {
        this.guideV.set(null);
        this.guideH.set(null);
      }
      // 中心落在別的容器上（可能是更深層的子明細，或拖出後的別處）→ 亮該容器提示
      const relCx = nx / z + orig.width / 2;
      const relCy = ny / z + orig.height / 2;
      const over = this.containerAt(pAbs.x + relCx, pAbs.y + relCy, this.drag.id);
      const dragged = this.state.findElement(this.drag.id);
      this.dropContainerId.set(over && over.id !== parent.id && dragged && this.state.canNestInto(dragged, over) ? over.id : null);
      this.state.patchElement(this.drag.id, { x: round(nx / z), y: round(ny / z) });
      return;
    }

    // 頂層：跨 band 映射 + 對齊吸附
    let newXpx = orig.x * z + dxPx;
    let newVisualY = this.modelToVisualY(orig.y) + dyPx;
    const w = orig.width * z;
    const h = orig.height * z;
    if (!noSnap) {
      const targets = alignTargets(this.state.visibleElements(), this.page(), z, y => this.modelToVisualY(y), this.drag.id);
      const snapX = snapAxis([newXpx, newXpx + w / 2, newXpx + w], targets.xs);
      const snapY = snapAxis([newVisualY, newVisualY + h / 2, newVisualY + h], targets.ys);
      if (snapX) { newXpx += snapX.delta; this.guideV.set(snapX.guide); } else { this.guideV.set(null); }
      if (snapY) { newVisualY += snapY.delta; this.guideH.set(snapY.guide); } else { this.guideH.set(null); }
    } else {
      this.guideV.set(null);
      this.guideH.set(null);
    }
    // 拖到容器型元素上 → 亮提示（放開時移入）；能不能進由 canNestInto 決定
    // （container 不巢狀；list 只能進頂層 list）
    {
      const cx = newXpx / z + orig.width / 2;
      const cy = this.visualToModelY(newVisualY) + orig.height / 2;
      const host = this.containerAt(cx, cy, this.drag.id);
      const dragged = this.state.findElement(this.drag.id);
      this.dropContainerId.set(host && dragged && this.state.canNestInto(dragged, host) ? host.id : null);
    }
    this.state.patchElement(this.drag.id, {
      x: round(Math.max(0, newXpx / z)),
      y: round(this.visualToModelY(newVisualY)),
    });
  }
}
