import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TemplateApiService } from '../../core/services/template-api.service';
import { EditorStateService } from './editor-state.service';

/** 預覽分頁（Jasper 的 Preview tab）：資料 JSON + 後端引擎渲染結果 */
@Component({
  selector: 'app-preview-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="layout">
      <div class="data-col">
        <div class="col-head">
          <span>資料 JSON</span>
          <button (click)="resetSampleData()">用範例值重建</button>
        </div>
        <textarea [(ngModel)]="dataJson" spellcheck="false"></textarea>
        <button class="primary" (click)="render()" [disabled]="loading()">
          {{ loading() ? '產生中…' : '重新產生 PDF' }}
        </button>
        @if (error(); as err) { <div class="error">{{ err }}</div> }
      </div>
      <div class="pdf-col">
        @if (pdfUrl(); as u) { <iframe [src]="u"></iframe> } @else { <div class="empty">尚未產生</div> }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; flex: 1; min-height: 0; background: #eef1f5; }
    .layout { display: flex; gap: 10px; height: 100%; padding: 10px; box-sizing: border-box; }
    .data-col { width: 270px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
    .data-col textarea { flex: 1; font-family: monospace; font-size: 12px; border: 1px solid #ccc; border-radius: 6px; padding: 8px; resize: none; }
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
    .primary { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 10px; cursor: pointer; font-size: 14px; }
    .primary:disabled { opacity: .6; }
    .error { color: #dc2626; font-size: 12px; white-space: pre-wrap; }
  `,
})
export class PreviewPanelComponent implements OnInit {
  private state = inject(EditorStateService);
  private api = inject(TemplateApiService);
  private sanitizer = inject(DomSanitizer);

  loading = signal(false);
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
  set dataJson(v: string) { this.state.previewData.set(v); }

  // 分頁切到預覽時元件會重新建立 → 自動產生一次
  ngOnInit() {
    if (!this.dataJson.trim()) this.resetSampleData();
    this.render();
  }

  resetSampleData() {
    this.dataJson = JSON.stringify(this.state.buildSampleData(), null, 2);
  }

  async render() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = this.dataJson.trim() ? JSON.parse(this.dataJson) : {};
      const blob = await this.api.renderAdhoc(this.state.template(), data);
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
