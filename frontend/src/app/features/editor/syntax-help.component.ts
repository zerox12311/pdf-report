import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/**
 * 資料語法速查（可折疊）：插值 {{key|格式}}、格式對照、引擎函式。
 * 單一來源，放在資料分頁與「連接」對話框兩處，避免各處 hint 散落不一致。
 */
@Component({
  selector: 'app-syntax-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sh">
      @if (!always()) {
        <button class="sh-toggle" (click)="open.set(!open())">
          <span class="chev" [class.o]="open()">▸</span> 資料語法速查（插值、格式、函式）
        </button>
      }
      @if (open() || always()) {
        <div class="sh-body" ngNonBindable>
          <div class="sh-sec">插值：文字元件內容與表格儲存格皆可混排資料</div>
          <table class="sh-tbl">
            <tr><td><code>{{customer.name}}</code></td><td>資料欄位（點/索引路徑：<code>items[0].qty</code>）</td></tr>
            <tr><td><code>{{total|comma}}</code></td><td>加格式：<code>{{key|格式}}</code></td></tr>
          </table>

          <div class="sh-sec">格式（<code>|</code> 後綴 / 資料欄位的格式下拉）</div>
          <table class="sh-tbl">
            <tr><td><code>comma</code></td><td>千分位</td><td>12345 → 12,345</td></tr>
            <tr><td><code>twUpper</code></td><td>國字大寫金額<b>（已含「元整」，勿再加）</b></td><td>5400 → 伍仟肆佰元整</td></tr>
            <tr><td><code>rocDate</code></td><td>民國年</td><td>2026-08-10 → 115/08/10</td></tr>
            <tr><td><code>rocDateLong</code></td><td>民國年長式</td><td>→ 民國115年8月10日</td></tr>
          </table>

          <div class="sh-sec">引擎函式（<code>$</code> 開頭；不需資料提供，由引擎計算）</div>
          <table class="sh-tbl">
            <tr><td><code>$page</code> / <code>$pages</code></td><td>目前頁碼 / 總頁數（放頁尾）</td></tr>
            <tr><td><code>$sum(items.amount)</code></td><td>陣列欄位總和；另有 <code>$count(items)</code>、<code>$avg(items.amount)</code></td></tr>
            <tr><td><code>$row</code></td><td>重複列序號（1,2,3…）；只在重複列儲存格有效</td></tr>
            <tr><td><code>$gsum(amount)</code></td><td>群組小計（放群組尾列）；另有 <code>$gcount</code>、<code>$gavg(欄位)</code></td></tr>
          </table>
          <div class="sh-note">缺 key 時渲染會出警告（回應標頭 <code>X-Render-Warnings</code>）；宿主端加 <code>?strict=1</code> 有警告即回 422。</div>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .sh { border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; font-size: 12px; }
    .sh-toggle { width: 100%; text-align: left; border: none; background: none; padding: 7px 10px;
      cursor: pointer; color: #1d4ed8; font-weight: 600; font-size: 12px; }
    .chev { display: inline-block; transition: transform .12s; }
    .chev.o { transform: rotate(90deg); }
    .sh-body { padding: 4px 10px 10px; color: #334155; }
    .sh-sec { font-weight: 700; color: #475569; margin: 8px 0 3px; }
    .sh-tbl { width: 100%; border-collapse: collapse; }
    .sh-tbl td { padding: 2px 6px 2px 0; vertical-align: top; }
    .sh-tbl code { background: #f1f5f9; border-radius: 3px; padding: 0 4px; white-space: nowrap; }
    .sh-note { color: #64748b; margin-top: 8px; line-height: 1.6; }
  `,
})
export class SyntaxHelpComponent {
  /** always=true 時常開不可折疊（連接對話框用） */
  always = input(false);
  open = signal(false);
}
