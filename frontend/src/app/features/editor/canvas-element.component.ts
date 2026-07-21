import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { CellBorders, FontFamily, TableCell, TableElement, TemplateElement, coveredCells, fontCss } from '../../core/models/template.model';
import { formatValue } from '../../core/utils/format-value';
import { ContextMenuItem, EditorStateService } from './editor-state.service';
import { DataKeyPayload, paletteToCellPatch } from './element-factory';

/** 單一元素的畫布視覺（不含定位與拖曳，那些由 editor-canvas 的包裝層處理）。container 不在此處理。 */
@Component({
  selector: 'app-canvas-element',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (el().type) {
      @case ('text') {
        @if (textEl(); as el) {
          @if (selfEditing()) {
            <textarea class="inline-edit" [value]="el.content"
              [style.fontSize.px]="el.fontSize * z()" [style.lineHeight]="el.lineHeight"
              [style.color]="el.color" [style.fontFamily]="fontCssOf(el.fontFamily)"
              [style.textAlign]="el.align" [style.fontWeight]="el.bold ? 700 : 400"
              (pointerdown)="$event.stopPropagation()" (dblclick)="$event.stopPropagation()"
              (keydown)="onSelfEditKey($event, true)"
              (blur)="commitSelfEdit($any($event.target).value)"></textarea>
          } @else {
            <div class="text-box" [style.fontSize.px]="el.fontSize * z()"
              [style.lineHeight]="el.lineHeight" [style.color]="el.color"
              [style.fontFamily]="fontCssOf(el.fontFamily)"
              [style.textAlign]="el.align" [style.fontWeight]="el.bold ? 700 : 400"
              [style.border]="boxBorder(el)" [style.background]="el.fillColor ?? 'transparent'"
              [style.padding.px]="(el.padding ?? 0) * z()"
              (dblclick)="startSelfEdit($event)"
            >{{ displayText(el.content) }}</div>
          }
        }
      }
      @case ('placeholder') {
        @if (placeholderEl(); as el) {
          @if (selfEditing()) {
            <input class="inline-edit" [value]="el.key" placeholder="資料 key（例：customer.name）"
              [style.fontSize.px]="el.fontSize * z()" [style.color]="el.color"
              [style.fontFamily]="fontCssOf(el.fontFamily)" [style.textAlign]="el.align"
              (pointerdown)="$event.stopPropagation()" (dblclick)="$event.stopPropagation()"
              (keydown)="onSelfEditKey($event, false)"
              (blur)="commitSelfEdit($any($event.target).value)" />
          } @else {
            <div class="text-box ph" [style.fontSize.px]="el.fontSize * z()"
              [style.lineHeight]="el.lineHeight" [style.color]="el.color"
              [style.fontFamily]="fontCssOf(el.fontFamily)"
              [style.textAlign]="el.align" [style.fontWeight]="el.bold ? 700 : 400"
              [style.border]="boxBorder(el)"
              [style.padding.px]="(el.padding ?? 0) * z()"
              [title]="phLabel(el.key) + '——雙擊編輯變數綁定'"
              (dblclick)="startSelfEdit($event)"
            >{{ el.sample ? formatted(el.sample, el.format) : phLabel(el.key) }}</div>
          }
        }
      }
      @case ('image') {
        @if (imageEl(); as el) {
          @if (imageSrc(el); as src) {
            <img class="img-box" [src]="src"
              [style.objectFit]="el.fit === 'stretch' ? 'fill' : 'contain'" draggable="false" />
          } @else {
            <div class="img-empty">{{ el.key ? '🔗 ' + el.key : '🖼 圖片（屬性設定來源）' }}</div>
          }
        }
      }
      @case ('rect') {
        @if (rectEl(); as el) {
          <div class="rect-box"
            [style.border]="el.strokeWidth > 0 ? (el.strokeWidth * z()) + 'px solid ' + el.strokeColor : 'none'"
            [style.background]="el.fillColor ?? 'transparent'"></div>
        }
      }
      @case ('line') {
        @if (lineEl(); as el) {
          <svg class="line-box" preserveAspectRatio="none">
            <line x1="0" y1="0" [attr.x2]="el.width * z()" [attr.y2]="el.height * z()"
              [attr.stroke]="el.strokeColor" [attr.stroke-width]="el.strokeWidth * z()" />
          </svg>
        }
      }
      @case ('barcode') {
        @if (barcodeEl(); as el) {
          <div class="barcode-box" [class.qr]="el.symbology === 'qr'"
            [title]="el.key ? '雙擊編輯範例值' : '雙擊編輯條碼內容'" (dblclick)="startSelfEdit($event)">
            @if (el.symbology === 'qr') {
              <div class="qr-mark">▦</div>
            } @else {
              <div class="bars"></div>
            }
            @if (selfEditing()) {
              <input class="inline-edit bc-edit" [value]="el.key ? el.sample : el.content"
                [placeholder]="el.key ? '範例值' : '條碼內容'"
                (pointerdown)="$event.stopPropagation()" (dblclick)="$event.stopPropagation()"
                (keydown)="onSelfEditKey($event, false)"
                (blur)="commitSelfEdit($any($event.target).value)" />
            } @else {
              <div class="bc-label">{{ el.symbology }}：{{ el.key ? phLabel(el.key) : el.content || '（空）' }}</div>
            }
          </div>
        }
      }
      @case ('table') {
        @if (tableEl(); as el) {
          <div class="tbl-wrap" (dblclick)="onTableDbl(el, $event)">
            <table class="tbl" [style.width.px]="el.width * z()"
              [style.borderColor]="el.borderColor" [style.fontSize.px]="el.fontSize * z()"
              [style.fontFamily]="fontCssOf(el.fontFamily)">
              @for (row of el.cells; track $index; let r = $index) {
                <tr [style.height.px]="el.rowHeights[r] * z()"
                  [class.repeat-row]="el.repeat?.enabled && r === el.repeat?.rowIndex"
                  [class.group-row]="el.repeat?.enabled && !!el.repeat?.groupBy && (r === el.repeat?.groupHeaderRowIndex || r === el.repeat?.groupFooterRowIndex)"
                  [title]="rowTitle(el, r)">
                  @for (cell of row; track $index; let c = $index) {
                    @if (!covered().has(r + ',' + c)) {
                      <td
                        [attr.data-rc]="r + ',' + c"
                        [attr.colspan]="cell.colSpan && cell.colSpan > 1 ? cell.colSpan : null"
                        [attr.rowspan]="cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : null"
                        [style.width.px]="spanWidth(el, c, cell.colSpan) * z()"
                        [style.borderTop]="cellBorderCss(el, cell, 'top')"
                        [style.borderRight]="cellBorderCss(el, cell, 'right')"
                        [style.borderBottom]="cellBorderCss(el, cell, 'bottom')"
                        [style.borderLeft]="cellBorderCss(el, cell, 'left')"
                        [style.padding.px]="el.cellPadding * z()"
                        [style.textAlign]="cell.align"
                        [style.fontWeight]="cell.bold ? 700 : 400"
                        [style.fontSize.px]="cell.fontSize ? cell.fontSize * z() : null"
                        [style.color]="cell.color || null"
                        [style.backgroundColor]="cell.fillColor || null"
                        [style.verticalAlign]="cell.vAlign || null"
                        [class.ph]="cell.kind === 'placeholder'"
                        [class.cell-selected]="el.id === state.selectedId() && isCellSelected(r, c)"
                        [class.drop-cell]="(dropCell()?.r === r && dropCell()?.c === c) || isElementDropCell(el, r, c)"
                        (pointerdown)="onCellDown(el, r, c, $event)"
                        (contextmenu)="onCellMenu($event, el, r, c)"
                        (dblclick)="onCellDbl(el, r, c, $event)"
                        (dragover)="onCellDragOver($event, r, c)"
                        (dragleave)="dropCell.set(null)"
                        (drop)="onCellDrop($event, el, r, c)"
                      >@if (cell.borders?.diagDown || cell.borders?.diagUp) {
                        <svg class="cell-diag" viewBox="0 0 100 100" preserveAspectRatio="none">
                          @if (cell.borders?.diagDown) {
                            <line x1="0" y1="0" x2="100" y2="100" vector-effect="non-scaling-stroke"
                              [attr.stroke]="el.borderColor" [attr.stroke-width]="diagStroke(el)" />
                          }
                          @if (cell.borders?.diagUp) {
                            <line x1="0" y1="100" x2="100" y2="0" vector-effect="non-scaling-stroke"
                              [attr.stroke]="el.borderColor" [attr.stroke-width]="diagStroke(el)" />
                          }
                        </svg>
                      }@if (cell.kind === 'image') {
                        @if (imageSrc(cell); as src) {
                          <img class="cell-img" [src]="src"
                            [style.left.px]="el.cellPadding * z()" [style.top.px]="el.cellPadding * z()"
                            [style.width.px]="cellInner(spanWidth(el, c, cell.colSpan), el.cellPadding) * z()"
                            [style.height.px]="cellInner(spanHeight(el, r, cell.rowSpan), el.cellPadding) * z()"
                            draggable="false" />
                        } @else {
                          <span class="cell-img-empty">{{ cell.key ? '🔗 ' + cell.key : '（未選圖片）' }}</span>
                        }
                      } @else if (editingCell()?.r === r && editingCell()?.c === c) {
                        <input class="cell-edit"
                          [value]="cell.kind === 'text' ? cell.value : cell.key"
                          [placeholder]="cell.kind === 'placeholder' ? '資料 key' : ''"
                          (pointerdown)="$event.stopPropagation()"
                          (dblclick)="$event.stopPropagation()"
                          (keydown)="onCellEditKey($event)"
                          (blur)="commitCellEdit(el, r, c, $any($event.target).value)" />
                      } @else if (cell.kind === 'barcode') {
                        <!-- 條碼示意：absolute 貼齊內距，不撐開畫布列高（同圖片格的解法） -->
                        <span class="cell-barcode" [style.inset.px]="el.cellPadding * z()">
                          @if (cell.symbology === 'qr') {
                            <span class="qr-mark">▦</span>
                          } @else {
                            <span class="bars"></span>
                          }
                          <span class="bc-label">{{ cell.key ? phLabel(cell.key) : cell.value || '（空）' }}</span>
                        </span>
                      } @else if (cell.wrap) {
                        <!-- 換行示意：absolute 貼齊內距，不撐開畫布列高（實際列高由引擎算） -->
                        <span class="cell-wrap-text" [style.inset.px]="el.cellPadding * z()"
                          [style.justifyContent]="cell.vAlign === 'top' ? 'flex-start' : cell.vAlign === 'bottom' ? 'flex-end' : 'center'"
                          >{{ cell.kind === 'placeholder' ? (cell.sample ? formatted(cell.sample, cell.format) : phLabel(cell.key)) : cell.value }}</span>
                      } @else {{{ cell.kind === 'placeholder' ? (cell.sample ? formatted(cell.sample, cell.format) : phLabel(cell.key)) : cell.value }}}</td>
                    }
                  }
                </tr>
              }
            </table>
            @if (isTableSelected(el)) {
              @for (d of colDividers(el); track d.i) {
                <div class="col-div" [style.left.px]="d.px" (pointerdown)="onDividerDown($event, el, 'col', d.i)"></div>
              }
              @for (d of rowDividers(el); track d.i) {
                <div class="row-div" [style.top.px]="d.px" (pointerdown)="onDividerDown($event, el, 'row', d.i)"></div>
              }
            }
          </div>
        }
      }
    }
  `,
  styles: `
    :host { display: block; width: 100%; height: 100%; position: relative; }
    .text-box { width: 100%; height: 100%; overflow: hidden; white-space: pre-wrap; word-break: break-all;
      font-family: 'Noto Sans TC', sans-serif; user-select: none; box-sizing: border-box; }
    .ph { background: rgba(255, 224, 130, .45); outline: 1px dashed #d19a00; }
    .img-box { width: 100%; height: 100%; pointer-events: none; }
    .img-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
      background: #f1f3f5; color: #999; font-size: 12px; border: 1px dashed #bbb; box-sizing: border-box; }
    .rect-box { width: 100%; height: 100%; box-sizing: border-box; }
    .line-box { width: 100%; height: 100%; display: block; overflow: visible; }
    /* 條碼示意（元素 .barcode-box 與儲存格 .cell-barcode 共用內部零件） */
    .barcode-box { width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden;
      background: #fff; border: 1px dashed #94a3b8; box-sizing: border-box; }
    .cell-barcode { position: absolute; display: flex; flex-direction: column; overflow: hidden;
      background: #fff; }
    .bars { flex: 1; background: repeating-linear-gradient(90deg,
      #111 0 2px, #fff 2px 4px, #111 4px 5px, #fff 5px 9px, #111 9px 12px, #fff 12px 14px); }
    .qr-mark { flex: 1; display: flex; align-items: center; justify-content: center;
      font-size: 28px; color: #111; }
    .bc-label { font-size: 9px; color: #475569; text-align: center; padding: 1px 2px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #f8fafc; }
    .tbl { border-collapse: collapse; table-layout: fixed; font-family: 'Noto Sans TC', sans-serif; user-select: none; }
    .tbl td { overflow: hidden; white-space: nowrap; vertical-align: middle; box-sizing: border-box; background: #fff; position: relative; }
    /* 選取用 inset 光暈（不用 background——有自訂背景色的格子 inline 樣式會蓋掉 class） */
    .tbl td.cell-selected { background: rgba(37, 99, 235, .15); box-shadow: inset 0 0 0 2px rgba(37, 99, 235, .55); }
    .cell-edit { width: 100%; box-sizing: border-box; font: inherit; color: inherit; text-align: inherit;
      border: 1.5px solid #2563eb; border-radius: 2px; padding: 0 2px; background: #fff; outline: none; }
    .tbl td.drop-cell { outline: 2px solid #f59e0b; outline-offset: -2px; background: rgba(245, 158, 11, .18); }
    /* 絕對定位貼齊儲存格內距＝引擎的 contain 矩形；不進 table 排版流，圖片再大也不會撐開列高 */
    .cell-img { position: absolute; object-fit: contain; }
    .cell-img-empty { color: #94a3b8; font-size: 10px; }
    /* 換行儲存格：畫布只示意換行效果，超出設計列高的部分裁掉（實際列高渲染時自動延伸） */
    .cell-wrap-text { position: absolute; overflow: hidden; white-space: pre-wrap; word-break: break-all;
      text-align: inherit; line-height: 1.2; display: flex; flex-direction: column; }
    /* 斜線框線（╲╱ 劃掉未使用欄位） */
    .cell-diag { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .inline-edit { position: absolute; inset: 0; width: 100%; height: 100%; box-sizing: border-box;
      border: 1.5px solid #2563eb; border-radius: 2px; padding: 1px 3px; background: #fff; outline: none;
      resize: none; font-family: inherit; }
    .bc-edit { position: static; height: auto; font-size: 11px; }
    .tbl-wrap { position: relative; width: 100%; height: 100%; }
    .col-div { position: absolute; top: 0; bottom: 0; width: 7px; margin-left: -3px; cursor: col-resize; z-index: 7; }
    .col-div:hover { background: rgba(37, 99, 235, .25); }
    .row-div { position: absolute; left: 0; right: 0; height: 7px; margin-top: -3px; cursor: row-resize; z-index: 7; }
    .row-div:hover { background: rgba(37, 99, 235, .25); }
    .tbl tr.repeat-row td { background: rgba(14, 165, 233, .14); }
    .tbl tr.repeat-row td.ph { background: rgba(14, 165, 233, .28); }
    .tbl tr.group-row td { background: rgba(34, 197, 94, .14); }
    .tbl tr.group-row td.ph { background: rgba(34, 197, 94, .28); }
  `,
})
export class CanvasElementComponent {
  state = inject(EditorStateService);
  z = this.state.zoom;
  el = input.required<TemplateElement>();

  // 依型別窄化的 computed：模板綁定回到 strictTemplates 檢查之下
  textEl = computed(() => { const e = this.el(); return e.type === 'text' ? e : null; });
  placeholderEl = computed(() => { const e = this.el(); return e.type === 'placeholder' ? e : null; });
  imageEl = computed(() => { const e = this.el(); return e.type === 'image' ? e : null; });
  rectEl = computed(() => { const e = this.el(); return e.type === 'rect' ? e : null; });
  lineEl = computed(() => { const e = this.el(); return e.type === 'line' ? e : null; });
  barcodeEl = computed(() => { const e = this.el(); return e.type === 'barcode' ? e : null; });
  tableEl = computed(() => { const e = this.el(); return e.type === 'table' ? e : null; });

  phLabel(key: string): string {
    return '{{' + key + '}}';
  }

  /** 拖曳既有圖片元素時，此格是否為放置目標（高亮） */
  isElementDropCell(el: TableElement, r: number, c: number): boolean {
    const d = this.state.elementDropCell();
    return !!d && d.tableId === el.id && d.r === r && d.c === c;
  }

  /** 斜線筆寬（跟表格框線同寬，最細 1px 保持可見） */
  diagStroke(el: TableElement): number {
    return Math.max(1, el.borderWidth * this.z());
  }

  /**
   * 儲存格單邊框線 CSS。border-collapse 下「none 輸給 solid」——
   * 共用線任一側有開就顯示，兩側都關才消失，與引擎畫線規則一致。
   */
  cellBorderCss(el: TableElement, cell: TableCell, edge: keyof CellBorders): string {
    if (el.borderWidth <= 0) return '1px dashed #d3dae3';
    const on = cell.borders ? cell.borders[edge] : true;
    return on ? (el.borderWidth * this.z()) + 'px solid ' + el.borderColor : 'none';
  }

  /** 畫布即時套用格式（千分位/國字大寫/民國年），讓所見即所得 */
  formatted(sample: string, format: Parameters<typeof formatValue>[1]): string {
    return formatValue(sample, format);
  }

  /** 範例資料（資料分頁的 JSON；空/壞則用畫布欄位自動生成），供文字插值畫布預覽 */
  private sampleData = computed<Record<string, unknown>>(() => {
    const txt = this.state.previewData().trim();
    if (txt) {
      try {
        const d: unknown = JSON.parse(txt);
        if (d && typeof d === 'object' && !Array.isArray(d)) return d as Record<string, unknown>;
      } catch { /* 壞 JSON → fallback */ }
    }
    return this.state.buildSampleData();
  });

  /** 依 "a.b" / "items[0].x" 路徑從範例資料取值 */
  private resolvePath(data: unknown, key: string): unknown {
    let cur: unknown = data;
    for (const part of key.replace(/\[(\d+)\]/g, '.$1').split('.')) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }

  /**
   * 圖片元素的畫布來源（優先序同引擎：key > url > assetId）：
   * key 綁定 → 範例資料值 → sample URL；url = 固定連結直接顯示；
   * 否則已上傳的 assetId。都沒有 → null（顯示占位框）。
   */
  imageSrc(el: { key?: string; sample?: string; assetId?: string; url?: string }): string | null {
    if (el.key) {
      const v = this.resolvePath(this.sampleData(), el.key);
      if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
      if (el.sample && /^https?:\/\//.test(el.sample)) return el.sample;
      return null;
    }
    if (el.url && /^https?:\/\//.test(el.url)) return el.url;
    return el.assetId ? '/api/assets/' + el.assetId : null;
  }

  /** 文字行內插值的畫布預覽：資料 key 以範例資料代入；$ 引擎函式與缺 key 保留 token 提示 */
  displayText(content: string): string {
    if (!content.includes('{{')) return content;
    const data = this.sampleData();
    return content.replace(/\{\{\s*([^}|]+?)\s*(?:\|\s*([A-Za-z]+)\s*)?\}\}/g, (m, key: string, fmt?: string) => {
      if (key.startsWith('$')) return m; // $page/$sum 等由引擎計算，畫布保留 token
      const cur = this.resolvePath(data, key);
      if (cur == null || typeof cur === 'object') return m; // 找不到 → 保留 token（看得出沒綁到）
      return formatValue(String(cur), (fmt ?? '') as Parameters<typeof formatValue>[1]);
    });
  }

  fontCssOf(family: FontFamily | undefined): string {
    return fontCss(family);
  }

  boxBorder(el: { borderWidth?: number; borderColor?: string }): string {
    return (el.borderWidth ?? 0) > 0
      ? `${el.borderWidth! * this.z()}px solid ${el.borderColor ?? '#000000'}`
      : 'none';
  }

  rowTitle(el: TableElement, r: number): string {
    const rep = el.repeat;
    if (!rep?.enabled) return '';
    if (r === rep.rowIndex) return '重複列：' + rep.key + '[]';
    if (rep.groupBy && r === rep.groupHeaderRowIndex) return '群組首列（每組開始）';
    if (rep.groupBy && r === rep.groupFooterRowIndex) return '群組尾列（每組小計）';
    return '';
  }

  isCellSelected(r: number, c: number) {
    const sc = this.state.selectedCell();
    if (sc?.row === r && sc?.col === c) return true;
    const rg = this.state.selectedCellRange();
    if (!rg) return false;
    return r >= Math.min(rg.r1, rg.r2) && r <= Math.max(rg.r1, rg.r2)
      && c >= Math.min(rg.c1, rg.c2) && c <= Math.max(rg.c1, rg.c2);
  }

  /** 被合併儲存格蓋住的格子（不渲染） */
  covered = computed(() => {
    const el = this.tableEl();
    return el ? coveredCells(el) : new Set<string>();
  });

  /** 合併格的顯示寬度（欄寬加總） */
  spanWidth(el: TableElement, c: number, colSpan: number | undefined): number {
    const cs = Math.min(colSpan ?? 1, el.columnWidths.length - c);
    let w = 0;
    for (let i = 0; i < cs; i++) w += el.columnWidths[c + i];
    return w;
  }

  /** 合併格的顯示高度（列高加總） */
  spanHeight(el: TableElement, r: number, rowSpan: number | undefined): number {
    const rs = Math.min(rowSpan ?? 1, el.rowHeights.length - r);
    let h = 0;
    for (let i = 0; i < rs; i++) h += el.rowHeights[r + i];
    return h;
  }

  /** 儲存格內距後的可用邊長（引擎 drawImageRect 的 contain 矩形） */
  cellInner(size: number, pad: number): number {
    return Math.max(0, size - 2 * pad);
  }

  // ---- 元素本體就地編輯（雙擊；文字=content、資料欄位=sample、條碼=sample/content） ----
  selfEditing = signal(false);

  startSelfEdit(ev: Event) {
    ev.stopPropagation();
    const el = this.el();
    if (el.id !== this.state.selectedId()) this.state.select(el.id);
    this.cancelEdit = false;
    this.selfEditing.set(true);
    this.focusEditor('.inline-edit');
  }

  onSelfEditKey(ev: KeyboardEvent, multiline: boolean) {
    ev.stopPropagation();
    // 多行文字用 Ctrl/⌘+Enter 提交（Enter = 換行）；單行 Enter 直接提交
    if (ev.key === 'Enter' && (!multiline || ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      (ev.target as HTMLElement).blur();
    }
    if (ev.key === 'Escape') {
      this.cancelEdit = true;
      (ev.target as HTMLElement).blur();
    }
  }

  commitSelfEdit(value: string) {
    this.selfEditing.set(false);
    if (this.cancelEdit) {
      this.cancelEdit = false;
      return;
    }
    const el = this.el();
    switch (el.type) {
      case 'text': this.state.patchElement(el.id, { content: value }); break;
      case 'placeholder': this.state.patchElement(el.id, { key: value }); break;
      case 'barcode':
        this.state.patchElement(el.id, el.key ? { sample: value } : { content: value });
        break;
    }
  }

  /** 聚焦剛出現的編輯框（OnPush 下等渲染，重試數次） */
  private focusEditor(selector: string) {
    const tryFocus = (attempts: number) => {
      const inp = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
      if (inp) {
        inp.focus();
        inp.select();
      } else if (attempts > 0) {
        setTimeout(() => tryFocus(attempts - 1), 30);
      }
    };
    setTimeout(() => tryFocus(5));
  }

  // ---- 資料 key 拖進儲存格：該格直接變成資料欄位 ----
  dropCell = signal<{ r: number; c: number } | null>(null);

  onCellDragOver(ev: DragEvent, r: number, c: number) {
    const types = ev.dataTransfer?.types;
    // 接受：資料 key、元件盤可進格子的元件（圖片/條碼；其餘元件照舊落在畫布上）
    if (!types || (!types.includes('application/x-datakey') && !types.includes('application/x-palette-cell'))) return;
    ev.preventDefault();
    ev.stopPropagation(); // 不讓畫布同時亮容器提示
    ev.dataTransfer!.dropEffect = 'copy';
    this.dropCell.set({ r, c });
  }

  onCellDrop(ev: DragEvent, el: TableElement, r: number, c: number) {
    this.dropCell.set(null);
    // 元件盤「圖片/條碼」拖進儲存格：設成對應格型（來源/內容之後在屬性面板調整）
    if (ev.dataTransfer?.types.includes('application/x-palette-cell')) {
      const patch = paletteToCellPatch(ev.dataTransfer.getData('application/x-palette'));
      if (!patch) return;
      ev.preventDefault();
      ev.stopPropagation();
      ({ r, c } = this.resolveCellOrigin(el, r, c));
      if (el.id !== this.state.selectedId()) this.state.select(el.id);
      this.state.selectedCell.set({ row: r, col: c });
      this.state.selectedCellRange.set(null);
      const cells = el.cells.map((row, ri) => row.map((cell, ci) =>
        ri === r && ci === c ? { ...cell, ...patch } : cell));
      this.state.patchElement(el.id, { cells });
      return;
    }
    const dk = ev.dataTransfer?.getData('application/x-datakey');
    if (!dk) return; // 其他元件盤拖放照舊冒泡給畫布
    const p = JSON.parse(dk) as DataKeyPayload;
    if (p.kind !== 'scalar') return; // 陣列冒泡給畫布生成重複表格
    ev.preventDefault();
    ev.stopPropagation();
    ({ r, c } = this.resolveCellOrigin(el, r, c));
    // 拖進重複列/群組列時，items[0].name 自動轉相對 key name（引擎在重複列用相對路徑）
    let key = p.key;
    const rep = el.repeat;
    const inRepeatRow = !!rep?.enabled && (r === rep.rowIndex ||
      (!!rep.groupBy && (r === rep.groupHeaderRowIndex || r === rep.groupFooterRowIndex)));
    const prefix = rep?.key ? `${rep.key}[0].` : '';
    if (inRepeatRow && prefix && key.startsWith(prefix)) key = key.slice(prefix.length);
    const cells = el.cells.map((row, ri) => row.map((cell, ci) =>
      ri === r && ci === c
        ? { ...cell, kind: 'placeholder' as const, key, sample: p.sample ?? '' }
        : cell));
    this.state.patchElement(el.id, { cells } as Partial<TableElement>);
    if (el.id !== this.state.selectedId()) this.state.select(el.id);
    this.state.selectedCell.set({ row: r, col: c });
    this.state.selectedCellRange.set(null);
  }

  /** 被合併蓋住的格導向其主格 */
  private resolveCellOrigin(el: TableElement, r: number, c: number): { r: number; c: number } {
    if (!this.covered().has(`${r},${c}`)) return { r, c };
    for (let ri = 0; ri < el.cells.length; ri++) {
      for (let ci = 0; ci < el.cells[ri].length; ci++) {
        const cell = el.cells[ri][ci];
        const cs = cell.colSpan ?? 1;
        const rs = cell.rowSpan ?? 1;
        if ((cs > 1 || rs > 1) && r >= ri && r < ri + rs && c >= ci && c < ci + cs) {
          return { r: ri, c: ci };
        }
      }
    }
    return { r, c };
  }

  // ---- 儲存格就地編輯（雙擊） ----
  editingCell = signal<{ r: number; c: number } | null>(null);
  private cancelEdit = false;

  /** 表格空白處/格線上雙擊也能編輯：依座標找格（被合併蓋住的格導向其主格） */
  onTableDbl(el: TableElement, ev: MouseEvent) {
    if ((ev.target as HTMLElement).closest('td')) return; // td 自己的 dblclick 已處理
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (ev.clientX - rect.left) / this.z();
    const y = (ev.clientY - rect.top) / this.z();
    let c = 0;
    for (let acc = 0; c < el.columnWidths.length - 1; c++) {
      acc += el.columnWidths[c];
      if (x < acc) break;
    }
    let r = 0;
    for (let acc = 0; r < el.rowHeights.length - 1; r++) {
      acc += el.rowHeights[r];
      if (y < acc) break;
    }
    this.onCellDbl(el, r, c, ev);
  }

  /** 雙擊儲存格 → 就地編輯（text 格改 value、placeholder 格改 sample） */
  onCellDbl(el: TableElement, r: number, c: number, ev: Event) {
    ev.stopPropagation();
    ({ r, c } = this.resolveCellOrigin(el, r, c)); // 點到被合併蓋住的格 → 導向其主格
    if (el.id !== this.state.selectedId()) this.state.select(el.id);
    this.state.selectedCell.set({ row: r, col: c });
    this.state.selectedCellRange.set(null);
    this.cancelEdit = false;
    this.editingCell.set({ r, c });
    this.focusEditor('.cell-edit');
  }

  onCellEditKey(ev: KeyboardEvent) {
    ev.stopPropagation();
    if (ev.key === 'Enter') (ev.target as HTMLElement).blur();
    if (ev.key === 'Escape') {
      this.cancelEdit = true;
      (ev.target as HTMLElement).blur();
    }
  }

  commitCellEdit(el: TableElement, r: number, c: number, value: string) {
    this.editingCell.set(null);
    if (this.cancelEdit) {
      this.cancelEdit = false;
      return;
    }
    const cells = el.cells.map((row, ri) => row.map((cell, ci) => {
      if (ri !== r || ci !== c) return cell;
      return cell.kind === 'text' ? { ...cell, value } : { ...cell, key: value };
    }));
    this.state.patchElement(el.id, { cells } as Partial<TableElement>);
  }

  /** 表格已選取時點儲存格 → 選中該格；Shift+點選 = 框出範圍（合併用） */
  /**
   * Word/Excel 式操作：表格內容區不拖動表格（移動用左上角手柄）。
   * 點選 = 選表格＋選格；按住拖曳 = 框選範圍；Shift+點選 = 從錨點框選。
   */
  onCellDown(el: TableElement, row: number, col: number, ev?: Event) {
    const pe = ev as PointerEvent | undefined;
    // 右鍵的選取由 onCellMenu 處理（這裡處理會把 Shift 框好的範圍清掉）
    if (pe?.button === 2) return;
    pe?.stopPropagation(); // 不讓表格進入移動拖曳
    this.state.select(el.id);
    const anchor = this.state.selectedCell();
    if (pe?.shiftKey && anchor) {
      this.state.selectedCellRange.set({ r1: anchor.row, c1: anchor.col, r2: row, c2: col });
      return;
    }
    this.state.selectedCell.set({ row, col });
    this.state.selectedCellRange.set(null);
    if (!pe) return;
    // Excel 式拖曳框選：跟著指標下的儲存格擴張範圍（限同一張表）
    const table = (pe.currentTarget as HTMLElement | null)?.closest('table');
    const onMove = (e: PointerEvent) => {
      const td = document.elementFromPoint(e.clientX, e.clientY)?.closest('td[data-rc]');
      if (!td || td.closest('table') !== table) return;
      const [r2, c2] = (td as HTMLElement).dataset['rc']!.split(',').map(Number);
      if (r2 === row && c2 === col) {
        this.state.selectedCellRange.set(null);
      } else {
        this.state.selectedCellRange.set({ r1: row, c1: col, r2, c2 });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.cellDragCleanup = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.cellDragCleanup = onUp;
  }

  /** 進行中框選拖曳的清理（元件銷毀時呼叫，防洩漏） */
  private cellDragCleanup: (() => void) | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cellDragCleanup?.());
  }

  /** 儲存格右鍵選單（結構操作；表格整體樣式留在屬性面板） */
  onCellMenu(e: MouseEvent, el: TableElement, r: number, c: number) {
    e.preventDefault();
    e.stopPropagation();
    this.state.select(el.id);
    // 右鍵在已框選的範圍內 → 保留範圍（合併用）；否則改選這一格
    const range = this.state.selectedCellRange();
    const inRange = !!range
      && r >= Math.min(range.r1, range.r2) && r <= Math.max(range.r1, range.r2)
      && c >= Math.min(range.c1, range.c2) && c <= Math.max(range.c1, range.c2);
    if (!inRange) {
      this.state.selectedCell.set({ row: r, col: c });
      this.state.selectedCellRange.set(null);
    }
    const cell = el.cells[r][c];
    const rows = el.cells.length;
    const cols = el.columnWidths.length;
    const rep = el.repeat;
    const merged = (cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1;
    const items: ContextMenuItem[] = [
      { label: '上方插入列', run: () => this.state.insertTableRow(el.id, r) },
      { label: '下方插入列', run: () => this.state.insertTableRow(el.id, r + (cell.rowSpan ?? 1)) },
      { label: '左方插入欄', run: () => this.state.insertTableCol(el.id, c) },
      { label: '右方插入欄', run: () => this.state.insertTableCol(el.id, c + (cell.colSpan ?? 1)) },
      { kind: 'sep' },
      { label: '刪除此列', disabled: rows <= 1, danger: true, run: () => this.state.removeTableRow(el.id, r) },
      { label: '刪除此欄', disabled: cols <= 1, danger: true, run: () => this.state.removeTableCol(el.id, c) },
      { kind: 'sep' },
      {
        label: '合併儲存格',
        disabled: !inRange,
        run: () => {
          const err = this.state.mergeSelectedCells(el.id);
          if (err) alert(err);
        },
      },
      ...(merged ? [{ label: '取消合併', run: () => this.state.unmergeCell(el.id, r, c) }] : []),
      { kind: 'sep' },
      {
        label: '設為重複列（資料列）',
        checked: !!rep?.enabled && rep.rowIndex === r,
        run: () => this.state.toggleRepeatRow(el.id, r),
      },
      {
        // 依右鍵格的目前狀態切換，套用到整個選取範圍（同屬性面板的批次樣式）
        label: '自動換行（列高自動延伸）',
        checked: !!cell.wrap,
        run: () => this.state.patchSelectedCells(el.id, { wrap: cell.wrap ? undefined : true }),
      },
      { label: '清除儲存格內容', run: () => this.state.clearCell(el.id, r, c) },
    ];
    this.state.openContextMenu(e.clientX, e.clientY, items);
  }

  // ---- 表格欄/列分隔線拖曳（單欄寬/單列高） ----
  isTableSelected(el: TableElement): boolean {
    return el.id === this.state.selectedId();
  }

  colDividers(el: TableElement): { i: number; px: number }[] {
    const out: { i: number; px: number }[] = [];
    let acc = 0;
    el.columnWidths.forEach((w, i) => {
      acc += w;
      out.push({ i, px: acc * this.z() });
    });
    return out;
  }

  rowDividers(el: TableElement): { i: number; px: number }[] {
    const out: { i: number; px: number }[] = [];
    let acc = 0;
    el.rowHeights.forEach((h, i) => {
      acc += h;
      out.push({ i, px: acc * this.z() });
    });
    return out;
  }

  onDividerDown(ev: PointerEvent, el: TableElement, axis: 'col' | 'row', i: number) {
    ev.stopPropagation();
    ev.preventDefault();
    const start = axis === 'col' ? ev.clientX : ev.clientY;
    const orig = axis === 'col' ? el.columnWidths[i] : el.rowHeights[i];
    const onMove = (e: PointerEvent) => {
      const d = ((axis === 'col' ? e.clientX : e.clientY) - start) / this.z();
      const v = Math.round(Math.max(6, orig + d) * 10) / 10;
      if (axis === 'col') {
        const cols = el.columnWidths.map((w, idx) => (idx === i ? v : w));
        this.state.patchElement(el.id, {
          columnWidths: cols,
          width: Math.round(cols.reduce((a, b) => a + b, 0) * 10) / 10,
        } as Partial<TableElement>);
      } else {
        const rows = el.rowHeights.map((h, idx) => (idx === i ? v : h));
        this.state.patchElement(el.id, {
          rowHeights: rows,
          height: Math.round(rows.reduce((a, b) => a + b, 0) * 10) / 10,
        } as Partial<TableElement>);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
}
