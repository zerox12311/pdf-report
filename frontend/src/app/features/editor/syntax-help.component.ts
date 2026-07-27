import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ModalService } from '../../core/services/modal.service';

/** 一條語法：清單只顯示 code，說明與範例點開才出現 */
interface SyntaxEntry {
  code: string;
  title: string;
  detail: string;
  example?: string;
}

const GROUPS: { name: string; entries: SyntaxEntry[] }[] = [
  {
    name: '插值',
    entries: [
      {
        code: '{{key}}',
        title: '資料欄位插值',
        detail: '文字元件內容與表格儲存格皆可混排。key 支援點與索引路徑，例如 customer.name、items[0].qty。\n\n渲染時資料缺這個 key 會產生警告（回應標頭 X-Render-Warnings）；宿主端加 ?strict=1 時，有警告即回 422 不產生 PDF。',
        example: '收款人：{{customer.name}}',
      },
      {
        code: '{{key|格式}}',
        title: '插值加格式',
        detail: '在 key 後面加 | 與格式名稱，即可套用下方「格式」區列出的任一種。',
        example: '金額：{{total|comma}}',
      },
    ],
  },
  {
    name: '格式',
    entries: [
      { code: 'comma', title: '千分位', detail: '數值加上千分位逗號（小數原樣保留）。', example: '12345 → 12,345' },
      {
        code: 'comma(2)',
        title: '千分位＋固定小數位',
        detail: '四捨五入到括號指定的小數位數（固定顯示）再加千分位。金額慣用 comma(2)。',
        example: '329.96999 → 329.97',
      },
      {
        code: 'round(2)',
        title: '四捨五入',
        detail: '四捨五入到括號指定的小數位數並固定顯示；round 不帶參數＝取整數。不加千分位。',
        example: '99.94999 → 99.95；7.5 → 8',
      },
      {
        code: 'twUpper',
        title: '國字大寫金額',
        detail: '轉為銀行慣用的國字大寫。輸出已包含「元整」，樣板上不要再自己加一次。',
        example: '5400 → 伍仟肆佰元整',
      },
      { code: 'rocDate', title: '民國年', detail: '西元日期轉民國年。', example: '2026-08-10 → 115/08/10' },
      { code: 'rocDateLong', title: '民國年長式', detail: '西元日期轉民國年長格式。', example: '2026-08-10 → 民國115年8月10日' },
    ],
  },
  {
    name: '引擎函式',
    entries: [
      { code: '$page', title: '目前頁碼', detail: '由引擎計算，不需資料提供。通常放在頁尾。', example: '第 {{$page}} 頁／共 {{$pages}} 頁' },
      { code: '$pages', title: '總頁數', detail: '由引擎計算，不需資料提供。通常放在頁尾。', example: '第 {{$page}} 頁／共 {{$pages}} 頁' },
      { code: '$sum(路徑)', title: '陣列欄位總和', detail: '對整份資料的陣列路徑加總。', example: '{{$sum(items.amount)}}' },
      { code: '$count(路徑)', title: '陣列筆數', detail: '對整份資料的陣列路徑計數。', example: '{{$count(items)}}' },
      { code: '$avg(路徑)', title: '陣列欄位平均', detail: '對整份資料的陣列路徑取平均。', example: '{{$avg(items.amount)}}' },
      { code: '$row', title: '重複列序號', detail: '從 1 開始。只在重複列的儲存格內有效。', example: '{{$row}}' },
      { code: '$gsum(欄位)', title: '群組小計', detail: '放在群組尾列的儲存格。', example: '{{$gsum(amount)}}' },
      { code: '$gcount', title: '群組筆數', detail: '放在群組首列或尾列的儲存格。', example: '{{$gcount}}' },
      { code: '$gavg(欄位)', title: '群組平均', detail: '放在群組尾列的儲存格。', example: '{{$gavg(amount)}}' },
    ],
  },
  {
    name: '行內樣式（文字元件與表格文字格）',
    entries: [
      {
        code: '[b]…[/b]',
        title: '部分文字粗體',
        detail: '通常不用手寫：雙擊文字元件或表格文字格後選取一段，用浮動工具列的 B 上粗體即可。可與 [i]、[c=#…] 巢狀混用；插值 token 可以放在標記內。',
        example: '合計 [b]{{total|comma}}[/b] 元',
      },
      {
        code: '[i]…[/i]',
        title: '部分文字斜體',
        detail: '通常不用手寫：雙擊文字元件或表格文字格後選取一段，用浮動工具列的 I 上斜體即可。中文字型以假斜體（12° 斜切）呈現，同 Word 做法；匯入字型無斜體變體時以正體呈現。',
        example: '[i]備註：逾期另計違約金[/i]',
      },
      {
        code: '[c=#rrggbb]…[/c]',
        title: '部分文字變色',
        detail: '工具列色票提供常用 9 色；其他色值在屬性面板的內容欄（或儲存格值）手寫這個標記即可（六位十六進位色碼）。巢狀時內層優先。',
        example: '應繳金額 [c=#dc2626]{{amount|comma}}[/c] 元',
      },
    ],
  },
];

/**
 * 資料語法速查（可折疊）：只列語法本身，點一下才用 modal 顯示說明與範例。
 * 先前把所有說明攤在面板上，右欄整個被表格塞滿。
 */
@Component({
  selector: 'app-syntax-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sh">
      <button class="sh-toggle" (click)="open.set(!open())">
        <span class="chev" [class.o]="open()">▸</span> 資料語法速查
      </button>
      @if (open()) {
        <div class="sh-body">
          @for (g of groups; track g.name) {
            <div class="sh-sec">{{ g.name }}</div>
            <div class="chips">
              @for (e of g.entries; track e.code) {
                <button class="chip" [title]="e.title + '——點擊看說明'" (click)="show(e)">{{ e.code }}</button>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .sh { border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; font-size: 12px; }
    .sh-toggle { width: 100%; text-align: left; border: none; background: none; padding: 7px 10px;
      cursor: pointer; color: #1d4ed8; font-weight: 600; font-size: 12px; font-family: inherit; }
    .chev { display: inline-block; transition: transform .12s; }
    .chev.o { transform: rotate(90deg); }
    .sh-body { padding: 2px 10px 10px; }
    .sh-sec { font-weight: 700; color: #475569; margin: 8px 0 4px; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { border: 1px solid #dbe2ea; background: #f8fafc; border-radius: 4px; padding: 2px 7px;
      font-size: 11.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #0f172a; cursor: pointer; white-space: nowrap; }
    .chip:hover { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; }
  `,
})
export class SyntaxHelpComponent {
  private modal = inject(ModalService);
  readonly groups = GROUPS;
  open = signal(false);

  show(e: SyntaxEntry) {
    void this.modal.alert({
      title: `${e.code} — ${e.title}`,
      message: e.example ? `${e.detail}\n\n範例：\n${e.example}` : e.detail,
      copy: e.code,
    });
  }
}
