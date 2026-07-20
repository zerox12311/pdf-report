import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FontFamily, TableElement, TemplateElement, coveredCells, fontCss } from '../../core/models/template.model';
import { formatValue } from '../../core/utils/format-value';
import { EditorStateService } from './editor-state.service';
import { DataKeyPayload } from './element-factory';

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
            >{{ el.content }}</div>
          }
        }
      }
      @case ('placeholder') {
        @if (placeholderEl(); as el) {
          @if (selfEditing()) {
            <input class="inline-edit" [value]="el.sample" placeholder="範例值"
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
              [title]="phLabel(el.key) + '——雙擊編輯範例值'"
              (dblclick)="startSelfEdit($event)"
            >{{ el.sample ? formatted(el.sample, el.format) : phLabel(el.key) }}</div>
          }
        }
      }
      @case ('image') {
        @if (imageEl(); as el) {
          @if (el.assetId) {
            <img class="img-box" [src]="'/api/assets/' + el.assetId"
              [style.objectFit]="el.fit === 'stretch' ? 'fill' : 'contain'" draggable="false" />
          } @else {
            <div class="img-empty">未選擇圖片</div>
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
            <table class="tbl" [style.borderColor]="el.borderColor" [style.fontSize.px]="el.fontSize * z()"
              [style.fontFamily]="fontCssOf(el.fontFamily)">
              @for (row of el.cells; track $index; let r = $index) {
                <tr [style.height.px]="el.rowHeights[r] * z()"
                  [class.repeat-row]="el.repeat?.enabled && r === el.repeat?.rowIndex"
                  [class.group-row]="el.repeat?.enabled && !!el.repeat?.groupBy && (r === el.repeat?.groupHeaderRowIndex || r === el.repeat?.groupFooterRowIndex)"
                  [title]="rowTitle(el, r)">
                  @for (cell of row; track $index; let c = $index) {
                    @if (!covered().has(r + ',' + c)) {
                      <td
                        [attr.colspan]="cell.colSpan && cell.colSpan > 1 ? cell.colSpan : null"
                        [attr.rowspan]="cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : null"
                        [style.width.px]="spanWidth(el, c, cell.colSpan) * z()"
                        [style.border]="el.borderWidth > 0 ? (el.borderWidth * z()) + 'px solid ' + el.borderColor : '1px dashed #d3dae3'"
                        [style.padding.px]="el.cellPadding * z()"
                        [style.textAlign]="cell.align"
                        [style.fontWeight]="cell.bold ? 700 : 400"
                        [style.fontSize.px]="cell.fontSize ? cell.fontSize * z() : null"
                        [style.color]="cell.color || null"
                        [class.ph]="cell.kind === 'placeholder'"
                        [class.cell-selected]="el.id === state.selectedId() && isCellSelected(r, c)"
                        [class.drop-cell]="dropCell()?.r === r && dropCell()?.c === c"
                        (pointerdown)="onCellDown(el, r, c, $event)"
                        (dblclick)="onCellDbl(el, r, c, $event)"
                        (dragover)="onCellDragOver($event, r, c)"
                        (dragleave)="dropCell.set(null)"
                        (drop)="onCellDrop($event, el, r, c)"
                      >@if (cell.kind === 'image') {
                        @if (cell.assetId) {
                          <img class="cell-img" [src]="'/api/assets/' + cell.assetId" draggable="false" />
                        } @else {
                          <span class="cell-img-empty">（未選圖片）</span>
                        }
                      } @else if (editingCell()?.r === r && editingCell()?.c === c) {
                        <input class="cell-edit"
                          [value]="cell.kind === 'text' ? cell.value : cell.sample"
                          [placeholder]="cell.kind === 'placeholder' ? '範例值' : ''"
                          (pointerdown)="$event.stopPropagation()"
                          (dblclick)="$event.stopPropagation()"
                          (keydown)="onCellEditKey($event)"
                          (blur)="commitCellEdit(el, r, c, $any($event.target).value)" />
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
    .barcode-box { width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden;
      background: #fff; border: 1px dashed #94a3b8; box-sizing: border-box; }
    .barcode-box .bars { flex: 1; background: repeating-linear-gradient(90deg,
      #111 0 2px, #fff 2px 4px, #111 4px 5px, #fff 5px 9px, #111 9px 12px, #fff 12px 14px); }
    .barcode-box .qr-mark { flex: 1; display: flex; align-items: center; justify-content: center;
      font-size: 28px; color: #111; }
    .barcode-box .bc-label { font-size: 9px; color: #475569; text-align: center; padding: 1px 2px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #f8fafc; }
    .tbl { border-collapse: collapse; table-layout: fixed; font-family: 'Noto Sans TC', sans-serif; user-select: none; }
    .tbl td { overflow: hidden; white-space: nowrap; vertical-align: middle; box-sizing: border-box; background: #fff; }
    .tbl td.cell-selected { background: rgba(37, 99, 235, .15); }
    .cell-edit { width: 100%; box-sizing: border-box; font: inherit; color: inherit; text-align: inherit;
      border: 1.5px solid #2563eb; border-radius: 2px; padding: 0 2px; background: #fff; outline: none; }
    .tbl td.drop-cell { outline: 2px solid #f59e0b; outline-offset: -2px; background: rgba(245, 158, 11, .18); }
    .cell-img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; margin: 0 auto; }
    .cell-img-empty { color: #94a3b8; font-size: 10px; }
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

  /** 畫布即時套用格式（千分位/國字大寫/民國年），讓所見即所得 */
  formatted(sample: string, format: Parameters<typeof formatValue>[1]): string {
    return formatValue(sample, format);
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
      case 'placeholder': this.state.patchElement(el.id, { sample: value }); break;
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
    // 接受：資料 key、元件盤的「圖片」（其餘元件照舊落在畫布上）
    if (!types || (!types.includes('application/x-datakey') && !types.includes('application/x-palette-image'))) return;
    ev.preventDefault();
    ev.stopPropagation(); // 不讓畫布同時亮容器提示
    ev.dataTransfer!.dropEffect = 'copy';
    this.dropCell.set({ r, c });
  }

  onCellDrop(ev: DragEvent, el: TableElement, r: number, c: number) {
    this.dropCell.set(null);
    // 元件盤「圖片」拖進儲存格：開檔案選擇器，上傳後設進該格
    if (ev.dataTransfer?.types.includes('application/x-palette-image')) {
      ev.preventDefault();
      ev.stopPropagation();
      ({ r, c } = this.resolveCellOrigin(el, r, c));
      if (el.id !== this.state.selectedId()) this.state.select(el.id);
      this.state.selectedCell.set({ row: r, col: c });
      this.state.imagePickRequest.set({ tableId: el.id, r, c });
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
      return cell.kind === 'text' ? { ...cell, value } : { ...cell, sample: value };
    }));
    this.state.patchElement(el.id, { cells } as Partial<TableElement>);
  }

  /** 表格已選取時點儲存格 → 選中該格；Shift+點選 = 框出範圍（合併用） */
  onCellDown(el: TableElement, row: number, col: number, ev?: Event) {
    if (el.id !== this.state.selectedId()) return;
    const anchor = this.state.selectedCell();
    if ((ev as PointerEvent | undefined)?.shiftKey && anchor) {
      this.state.selectedCellRange.set({ r1: anchor.row, c1: anchor.col, r2: row, c2: col });
      return;
    }
    this.state.selectedCell.set({ row, col });
    this.state.selectedCellRange.set(null);
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
