import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PAPER_PRESETS, TemplateDoc, Watermark, mmToPt, ptToMm } from '../../../core/models/template.model';
import { EditorStateService } from '../editor-state.service';
import { WatermarkFormComponent } from './watermark-form.component';

/** 未選取元素時的設定面板：目前節（名稱/紙張/方向/band/排序/刪除）＋文件層浮水印 */
@Component({
  selector: 'app-page-properties',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, WatermarkFormComponent],
  template: `
    <h3>節設定<span class="sec-kind">{{ sec().kind === 'flow' ? '內容節' : '獨立頁' }}</span></h3>
    <label class="full">節名稱
      <input [ngModel]="sec().name" (ngModelChange)="state.patchSection(sec().id, { name: $event })" />
    </label>
    <label class="full">紙張大小
      <select [ngModel]="paperValue()" (ngModelChange)="setPaper($event)">
        @for (p of papers; track p.value) { <option [value]="p.value">{{ p.label }}</option> }
        <option value="custom">自訂尺寸…</option>
      </select>
    </label>
    @if (paperValue() === 'custom') {
      <div class="grid2">
        <label>寬（mm）<input type="number" min="20" step="1" [ngModel]="mm(state.activePage().width)"
          (ngModelChange)="setCustom('width', $event)" /></label>
        <label>高（mm）<input type="number" min="20" step="1" [ngModel]="mm(state.activePage().height)"
          (ngModelChange)="setCustom('height', $event)" /></label>
      </div>
    }
    <label class="full">方向
      <select [ngModel]="state.activePage().orientation" (ngModelChange)="setOrientation($event)">
        <option value="portrait">直向</option>
        <option value="landscape">橫向</option>
      </select>
    </label>
    @if (sec().kind === 'flow') {
      <div class="grid2">
        <label>頁首高度（{{ state.rulerUnit() }}）
          <input type="number" min="0" [ngModel]="state.ptToDisp(sec().headerHeight)"
            (ngModelChange)="state.patchSection(sec().id, { headerHeight: ptMin($event, 0) })" />
        </label>
        <label>頁尾高度（{{ state.rulerUnit() }}）
          <input type="number" min="0" [ngModel]="state.ptToDisp(sec().footerHeight)"
            (ngModelChange)="state.patchSection(sec().id, { footerHeight: ptMin($event, 0) })" />
        </label>
      </div>
      @if (sec().headerHeight === 0 && sec().footerHeight === 0) {
        <div class="band-hint">頁首/頁尾高度為 0，此節沒有可放頁碼/表頭的重複區——把高度調大才會出現 band 空間。</div>
      }
    }
    <label class="full">此節的浮水印
      <select [ngModel]="sec().watermarkMode" (ngModelChange)="setSectionWmMode($event)">
        <option value="inherit">跟隨文件浮水印</option>
        <option value="none">此節不顯示</option>
        <option value="custom">此節自訂</option>
      </select>
    </label>
    @if (sec().watermarkMode === 'custom' && sec().watermark) {
      <app-watermark-form [wm]="sec().watermark!" (patchWm)="patchSectionWatermark($event)" />
    }
    <div class="sec-actions">
      <button (click)="state.moveSection(sec().id, -1)" title="此節往前移">←</button>
      <button (click)="state.moveSection(sec().id, 1)" title="此節往後移">→</button>
      @if (state.template().sections.length > 1) {
        <button class="danger" (click)="removeSection()">刪除此節</button>
      }
    </div>
    <div class="hint">文件由多個「節」依序輸出：每節有自己的紙張與方向（可混 A4/B4、直式/橫式）；內容節有頁首/頁尾 band 並自動分頁，獨立頁固定單獨一頁。節之間必換頁；$page/$pages 全文件連續。用畫布上方的節列切換、＋新增。</div>

    <div class="doc-divider">📄 文件層級（套用到所有節）</div>
    <div class="sub">頁面邊界（設計輔助線）</div>
    <label class="full">預設（同 Word）
      <select [ngModel]="currentMarginPreset()" (ngModelChange)="applyMarginPreset($event)">
        @for (p of marginPresets; track p.key) { <option [value]="p.key">{{ p.label }}{{ p.key === 'custom' ? '' : '（' + presetDesc(p) + '）' }}</option> }
      </select>
    </label>
    <div class="grid2">
      <label>上（{{ state.rulerUnit() }}）<input type="number" min="0" [ngModel]="state.ptToDisp(state.template().page.marginTop ?? 0)"
        (ngModelChange)="state.patchPage({ marginTop: ptMin($event, 0) })" /></label>
      <label>下（{{ state.rulerUnit() }}）<input type="number" min="0" [ngModel]="state.ptToDisp(state.template().page.marginBottom ?? 0)"
        (ngModelChange)="state.patchPage({ marginBottom: ptMin($event, 0) })" /></label>
      <label>左（{{ state.rulerUnit() }}）<input type="number" min="0" [ngModel]="state.ptToDisp(state.template().page.marginLeft ?? 0)"
        (ngModelChange)="state.patchPage({ marginLeft: ptMin($event, 0) })" /></label>
      <label>右（{{ state.rulerUnit() }}）<input type="number" min="0" [ngModel]="state.ptToDisp(state.template().page.marginRight ?? 0)"
        (ngModelChange)="state.patchPage({ marginRight: ptMin($event, 0) })" /></label>
    </div>
    <div class="hint">邊界以藍色虛線顯示在畫布上、可吸附對齊，也可**直接拖曳尺規上的藍色三角**調整；不影響輸出（元素仍可放在邊界外）。</div>

    <div class="sub">文件浮水印（各節預設）</div>
    <label class="row">
      <input type="checkbox" [ngModel]="state.template().page.watermark?.enabled ?? false"
        (ngModelChange)="toggleWatermark($event)" /> 啟用
    </label>
    @if (state.template().page.watermark?.enabled) {
      <app-watermark-form [wm]="state.template().page.watermark!" (patchWm)="patchWatermark($event)" />
    }
    <div class="hint">
      頁首/頁尾區內的元素會在每一頁重複；中間內文超過頁面時自動換頁（重複列表格會跨頁並重畫表頭）。<br /><br />
      頁碼：在頁尾放一個資料欄位，key 填 <b>$page</b>（目前頁碼）或 <b>$pages</b>（總頁數）。<br /><br />
      快捷鍵：<b>Ctrl/⌘+C</b> 複製、<b>Ctrl/⌘+V</b> 貼上、<b>Ctrl/⌘+X</b> 剪下、<b>Ctrl/⌘+D</b> 原地複製、<b>Del</b> 刪除、方向鍵微調（Shift = 10pt）。<br /><br />
      拖曳/縮放時按住 <b>Ctrl/⌘ 或 Shift</b> 可暫停磁吸微調；容器內的元素拖出容器邊界放開即移出容器；大綱可拖曳調整階層（拖到容器上=移入、拖到區段標題=換區段）。<br /><br />
      點選畫布上的元素可編輯元素屬性。
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
    h3 { margin: 0 0 4px; font-size: 14px; }
    label { display: flex; flex-direction: column; gap: 2px; color: #444; }
    label.row { flex-direction: row; align-items: center; gap: 6px; }
    input, select { font: inherit; padding: 4px 6px; border: 1px solid #ccc; border-radius: 4px; width: 100%; box-sizing: border-box; }
    input[type='color'] { padding: 0; height: 28px; }
    input[type='checkbox'] { width: auto; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .full { width: 100%; }
    .sub { font-weight: 600; color: #555; margin-top: 4px; }
    .hint { color: #999; font-size: 12px; }
    .band-hint { color: #b45309; font-size: 12px; margin-top: 2px; }
    .doc-divider { margin: 14px 0 6px; padding-top: 10px; border-top: 2px solid #e2e6ee;
      font-size: 13px; font-weight: 700; color: #1f2937; }
    .sec-kind { font-size: 11px; font-weight: 400; color: #0369a1; background: #e0f2fe; border-radius: 8px;
      padding: 1px 8px; margin-left: 8px; vertical-align: middle; }
    .sec-actions { display: flex; gap: 6px; }
    .sec-actions button { font: inherit; padding: 4px 10px; border: 1px solid #cbd5e1; background: #f8fafc;
      border-radius: 5px; cursor: pointer; }
    .sec-actions button.danger { color: #dc2626; border-color: #fca5a5; margin-left: auto; }
  `,
})
export class PagePropertiesComponent {
  state = inject(EditorStateService);
  papers = PAPER_PRESETS;

  /** Word 式邊界預設（pt）；custom 代表目前值不符任何預設 */
  marginPresets = [
    { key: 'normal', label: '標準', top: 72, bottom: 72, left: 72, right: 72 },
    { key: 'narrow', label: '窄', top: 36, bottom: 36, left: 36, right: 36 },
    { key: 'moderate', label: '中等', top: 72, bottom: 72, left: 54, right: 54 },
    { key: 'wide', label: '寬', top: 72, bottom: 72, left: 144, right: 144 },
    { key: 'none', label: '無邊界', top: 0, bottom: 0, left: 0, right: 0 },
    { key: 'custom', label: '自訂', top: -1, bottom: -1, left: -1, right: -1 },
  ];

  /** 預設在下拉顯示的尺寸描述（依目前尺規單位） */
  presetDesc(p: { top: number; left: number }): string {
    const u = this.state.rulerUnit();
    return `${this.state.ptToDisp(p.top)}×${this.state.ptToDisp(p.left)} ${u}`;
  }

  /** 目前邊界對應的預設 key（都相同才算某預設，否則 custom） */
  currentMarginPreset(): string {
    const pg = this.state.template().page;
    const m = { top: pg.marginTop ?? 0, bottom: pg.marginBottom ?? 0, left: pg.marginLeft ?? 0, right: pg.marginRight ?? 0 };
    const hit = this.marginPresets.find(p => p.key !== 'custom'
      && p.top === m.top && p.bottom === m.bottom && p.left === m.left && p.right === m.right);
    return hit ? hit.key : 'custom';
  }

  applyMarginPreset(key: string) {
    const p = this.marginPresets.find(x => x.key === key);
    if (!p || key === 'custom') return;
    this.state.patchPage({ marginTop: p.top, marginBottom: p.bottom, marginLeft: p.left, marginRight: p.right });
  }

  sec() {
    return this.state.activeSection();
  }

  num(v: unknown): number {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return isNaN(n) ? 0 : n;
  }

  /** 依尺規單位把輸入值換回 pt 並夾到 min 以上（欄位顯示單位、模型存 pt） */
  ptMin(v: unknown, min: number): number {
    return Math.max(min, this.state.dispToPt(this.num(v)));
  }

  mm(pt: number): number {
    return Math.round(ptToMm(pt) * 10) / 10;
  }

  removeSection() {
    if (confirm(`刪除節「${this.sec().name}」？此節上的元素會一併刪除。`)) {
      this.state.removeSection(this.sec().id);
    }
  }

  /** 下拉顯示值：目前節的紙張；不在預設清單內一律視為自訂 */
  paperValue(): string {
    const size = this.state.activePage().size;
    return this.papers.some(p => p.value === size) ? size : 'custom';
  }

  /** 套用紙張預設到目前節：以預設的自然方向帶入寬高，orientation 跟著寬高判定 */
  setPaper(v: string) {
    const cur = this.state.activePage();
    if (v === 'custom') {
      this.state.patchSection(this.sec().id, {
        page: { size: 'custom', orientation: cur.orientation, width: cur.width, height: cur.height },
      });
      return;
    }
    const p = this.papers.find(x => x.value === v);
    if (!p) return;
    const w = Math.round(mmToPt(p.wMm) * 100) / 100;
    const h = Math.round(mmToPt(p.hMm) * 100) / 100;
    this.state.patchSection(this.sec().id, {
      page: { size: v, width: w, height: h, orientation: w > h ? 'landscape' : 'portrait' },
    });
  }

  setCustom(dim: 'width' | 'height', v: unknown) {
    const mmVal = Math.max(20, this.num(v));
    const cur = this.state.activePage();
    const page = {
      size: 'custom',
      orientation: cur.orientation,
      width: cur.width,
      height: cur.height,
      [dim]: Math.round(mmToPt(mmVal) * 100) / 100,
    };
    page.orientation = page.width > page.height ? 'landscape' : 'portrait';
    this.state.patchSection(this.sec().id, { page });
  }

  setOrientation(o: 'portrait' | 'landscape') {
    const cur = this.state.activePage();
    const long = Math.max(cur.width, cur.height);
    const short = Math.min(cur.width, cur.height);
    this.state.patchSection(this.sec().id, {
      page: {
        size: cur.size,
        orientation: o,
        width: o === 'landscape' ? long : short,
        height: o === 'landscape' ? short : long,
      },
    });
  }

  /** 節浮水印模式；切到自訂時以文件浮水印為底稿初始化 */
  setSectionWmMode(mode: 'inherit' | 'none' | 'custom') {
    const s = this.sec();
    if (mode === 'custom' && !s.watermark) {
      const base = this.state.template().page.watermark;
      this.state.patchSection(s.id, {
        watermarkMode: 'custom',
        watermark: {
          enabled: true,
          text: base?.text ?? '副本',
          key: base?.key ?? '',
          fontSize: base?.fontSize ?? 72,
          color: base?.color ?? '#e5e7eb',
          rotation: base?.rotation ?? 45,
          repeat: base?.repeat ?? false,
          gapX: base?.gapX ?? 80,
          gapY: base?.gapY ?? 80,
          layer: base?.layer ?? 'below',
        },
      });
      return;
    }
    this.state.patchSection(s.id, { watermarkMode: mode });
  }

  patchSectionWatermark(patch: Partial<Watermark>) {
    const s = this.sec();
    if (!s.watermark) return;
    this.state.patchSection(s.id, { watermark: { ...s.watermark, ...patch } });
  }

  toggleWatermark(enabled: boolean) {
    const wm = this.state.template().page.watermark;
    this.state.patchPage({
      watermark: {
        enabled,
        text: wm?.text ?? '副本',
        key: wm?.key ?? '',
        fontSize: wm?.fontSize ?? 72,
        color: wm?.color ?? '#e5e7eb',
        rotation: wm?.rotation ?? 45,
        repeat: wm?.repeat ?? false,
        gapX: wm?.gapX ?? 80,
        gapY: wm?.gapY ?? 80,
        layer: wm?.layer ?? 'below',
      },
    });
  }

  patchWatermark(patch: Partial<NonNullable<TemplateDoc['page']['watermark']>>) {
    const wm = this.state.template().page.watermark;
    if (!wm) return;
    this.state.patchPage({ watermark: { ...wm, ...patch } });
  }
}
