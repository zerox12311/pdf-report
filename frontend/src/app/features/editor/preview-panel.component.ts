import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { t } from '../../core/i18n/i18n';
import { TemplateApiService } from '../../core/services/template-api.service';
import { JsonEditorComponent } from '../../shared/json-editor.component';
import { EditorStateService } from './editor-state.service';

/** 預覽分頁（Jasper 的 Preview tab）：資料 JSON + 後端引擎渲染結果 */
@Component({
  selector: 'app-preview-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, JsonEditorComponent],
  template: `
    <div class="layout">
      <div class="data-col">
        <div class="col-head">
          <span>{{ t('資料 JSON') }}</span>
          <button (click)="resetSampleData()">{{ t('用範例值重建') }}</button>
        </div>
        <app-json-editor [value]="state.previewData()" (valueChange)="state.setPreviewData($event)" />
        <label class="opt" [title]="t('不下載圖片、改畫佔位圖——調版面時不被圖片下載卡住')">
          <input type="checkbox" [ngModel]="placeholderImages()" (ngModelChange)="setPlaceholderImages($event)" />
          {{ t('圖片用佔位圖（加速版面預覽）') }}
        </label>
        <button class="primary" (click)="render()" [disabled]="loading()">
          {{ loading() ? t('產生中…') : t('重新產生 PDF') }}
        </button>
        @if (error(); as err) { <div class="error">{{ err }}</div> }
        <!-- 渲染警告（資料缺 key、圖片抓不到…）：不擋出 PDF，但一定要讓設計者看見。
             以前只把 PDF 塞進 iframe，警告整個吞掉，key 打錯就是一張默默少東西的單據。 -->
        @if (warnings().length) {
          <div class="warns" role="status">
            <b>{{ t('⚠ {n} 項渲染警告', { n: warnings().length }) }}</b>{{ t('（仍會出 PDF，但正式渲染帶') }} <code>?strict=1</code> {{ t('時會被擋下）') }}
            <ul>@for (w of warnings(); track $index) { <li>{{ w }}</li> }</ul>
          </div>
        }
      </div>
      <div class="pdf-col">
        @if (pdfUrl(); as u) { <iframe [src]="u"></iframe> } @else { <div class="empty">{{ t('尚未產生') }}</div> }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; flex: 1; min-height: 0; background: #eef1f5; }
    .layout { display: flex; gap: 10px; height: 100%; padding: 10px; box-sizing: border-box; }
    .data-col { width: 270px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
    .data-col app-json-editor { flex: 1; min-height: 0; }
    .pdf-col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .col-head { font-size: 13px; font-weight: 600; color: #333; display: flex; justify-content: space-between; align-items: center; }
    .col-head button {
      font-size: 12px; padding: 4px 10px; cursor: pointer;
      color: #2563eb; background: #fff; border: 1px solid #c7d2e8;
      border-radius: 6px; font-weight: 500; line-height: 1.4;
      transition: background .12s, border-color .12s;
    }
    .col-head button:hover { background: #eef2fb; border-color: #2563eb; }
    .col-head button:active { background: #dfe7fa; }
    iframe { flex: 1; border: 1px solid #ccc; border-radius: 6px; width: 100%; background: #fff; }
    .empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #999; background: #f5f5f5; border-radius: 6px; }
    .opt { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #475569; cursor: pointer; user-select: none; }
    .opt input { margin: 0; }
    .primary { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 10px; cursor: pointer; font-size: 14px; }
    .primary:disabled { opacity: .6; }
    .error { color: #dc2626; font-size: 12px; white-space: pre-wrap; }
    .warns { margin-top: 8px; padding: 8px 10px; background: #fffbeb; border: 1px solid #fcd34d;
      border-radius: 6px; color: #92400e; font-size: 11.5px; line-height: 1.6; }
    .warns b { color: #b45309; }
    .warns ul { margin: 4px 0 0; padding-left: 18px; }
    .warns code { background: #fef3c7; padding: 0 3px; border-radius: 3px; }
  `,
})
export class PreviewPanelComponent implements OnInit {
  protected readonly t = t;
  readonly state = inject(EditorStateService);
  private api = inject(TemplateApiService);
  private sanitizer = inject(DomSanitizer);

  loading = signal(false);
  /** 圖片用佔位圖（不下載）：**預設開啟**——切到預覽會立即自動渲染，預設抓圖等於每次都先吃
   *  一輪下載延遲；想看實圖再手動取消勾選（選擇存 localStorage，跨分頁切換保留）。 */
  placeholderImages = signal(localStorage.getItem('pdftpl.previewPlaceholderImages') !== '0');
  /** 後端回的渲染警告（X-Render-Warnings）；空陣列 = 這次渲染乾淨。 */
  warnings = signal<string[]>([]);
  error = signal<string | null>(null);
  pdfUrl = signal<SafeResourceUrl | null>(null);
  private objectUrl: string | null = null;

  constructor() {
    // 元件銷毀時釋放最後一個 blob URL（避免洩漏）
    inject(DestroyRef).onDestroy(() => {
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    });
  }

  get dataJson() { return this.state.previewData(); }
  set dataJson(v: string) { this.state.setPreviewData(v); }

  // 分頁切到預覽時元件會重新建立 → 自動產生一次
  ngOnInit() {
    if (!this.dataJson.trim()) this.resetSampleData();
    this.render();
  }

  resetSampleData() {
    this.dataJson = JSON.stringify(this.state.buildSampleData(), null, 2);
  }

  setPlaceholderImages(v: boolean) {
    this.placeholderImages.set(v);
    localStorage.setItem('pdftpl.previewPlaceholderImages', v ? '1' : '0');
    this.render(); // 切換立即重渲染，直接看到效果
  }

  async render() {
    this.loading.set(true);
    this.error.set(null);
    this.warnings.set([]);
    try {
      const data = this.dataJson.trim() ? JSON.parse(this.dataJson) : {};
      const { blob, warnings } = await this.api.renderAdhoc(this.state.template(), data, { placeholderImages: this.placeholderImages() });
      this.warnings.set(warnings);
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = URL.createObjectURL(blob);
      this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
    } catch (e) {
      // 錯誤訊息已由 TemplateApiService 正規化
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }
}
