import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { EditorStateService } from './editor-state.service';

/**
 * 「連接」對話框：給宿主系統的整合說明——
 * iframe 嵌入 HTML（可複製）與後端渲染 API 的呼叫方式。
 */
@Component({
  selector: 'app-integration-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close.emit()">
      <div class="dialog" (click)="$event.stopPropagation()">
        <header>
          <h2>連接此樣板</h2>
          <button class="x" (click)="close.emit()">✕</button>
        </header>
        <div class="content">
          @if (!templateId()) {
            <div class="warn">此樣板尚未儲存——先按「儲存」取得樣板 id，下面範例目前以 <b>{{ '{樣板ID}' }}</b> 佔位。</div>
          }

          <section>
            <div class="sec-head">
              <h3>1. 前端：iframe 嵌入編輯器</h3>
              <button class="copy" (click)="copy('embed', embedHtml())">{{ copied() === 'embed' ? '已複製 ✓' : '複製' }}</button>
            </div>
            <p>貼進宿主系統的頁面即可。使用者按「儲存」時，編輯器會用 postMessage 把樣板 id 通知宿主頁——把它存進你的系統，之後渲染都靠這個 id。</p>
            <pre>{{ embedHtml() }}</pre>
            <p class="note">事件有三種：<code>editor-ready</code>（編輯器載入完成）、<code>template-loaded</code>（既有樣板載入完成）、<code>template-saved</code>（儲存成功，一定帶 id）。listener 要在 iframe 之前註冊，避免漏接 editor-ready。</p>
          </section>

          <section>
            <div class="sec-head">
              <h3>2. 後端：POST 資料渲染 PDF</h3>
              <button class="copy" (click)="copy('api', curlText())">{{ copied() === 'api' ? '已複製 ✓' : '複製' }}</button>
            </div>
            <p>宿主後端把正式資料 POST 到下面的位址，回應就是 <code>application/pdf</code>：</p>
            <pre class="endpoint">POST {{ renderUrl() }}
Content-Type: application/json</pre>
            <pre>{{ curlText() }}</pre>
            <p class="note">
              body 格式為 <code>{{ '{' }} "data": {{ '{' }} … {{ '}' }} {{ '}' }}</code>，內容對應樣板上各欄位的 key。<br />
              資料缺 key 時預設仍會出 PDF（用範例值代替），警告放在 <code>X-Render-Warnings</code> 回應標頭（URL 編碼的 JSON 陣列）；
              正式開票建議加 <code>?strict=1</code>——只要有任何警告就回 <b>422</b> 並附警告清單，避免簽出不完整的單據。<br />
              網址主機以你目前開啟編輯器的位置（{{ origin }}）為準；宿主後端若從別的網段連線，把主機換成連得到本服務的位址即可，路徑不變。
            </p>
          </section>

          <section>
            <div class="sec-head">
              <h3>3. 測試用範例資料</h3>
              <button class="copy" (click)="copy('data', sampleJson())">{{ copied() === 'data' ? '已複製 ✓' : '複製' }}</button>
            </div>
            <p>依這張樣板上的欄位自動產生，可直接當 POST body 試打：</p>
            <pre class="sample">{{ sampleJson() }}</pre>
          </section>
        </div>
      </div>
    </div>
  `,
  styles: `
    .backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, .55); z-index: 100;
      display: flex; align-items: center; justify-content: center; }
    .dialog { background: #fff; border-radius: 10px; width: min(720px, 92vw); max-height: 88vh;
      display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,.35); }
    header { display: flex; align-items: center; justify-content: space-between;
      padding: 12px 18px; border-bottom: 1px solid #e2e8f0; }
    h2 { margin: 0; font-size: 16px; }
    .x { border: none; background: none; font-size: 15px; cursor: pointer; color: #64748b; }
    .content { overflow-y: auto; padding: 8px 18px 18px; font-size: 13px; color: #334155; }
    .warn { background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; border-radius: 6px;
      padding: 8px 10px; margin-top: 8px; }
    section { margin-top: 14px; }
    .sec-head { display: flex; align-items: center; justify-content: space-between; }
    h3 { margin: 0; font-size: 14px; color: #0f172a; }
    .copy { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 6px; padding: 3px 12px;
      font-size: 12px; cursor: pointer; color: #1d4ed8; }
    .copy:hover { background: #eff6ff; }
    p { margin: 6px 0; }
    pre { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 12px; font-size: 12px;
      overflow-x: auto; white-space: pre; line-height: 1.5; margin: 6px 0; }
    pre.endpoint { background: #1e3a8a; }
    pre.sample { max-height: 200px; overflow-y: auto; }
    .note { color: #64748b; font-size: 12px; line-height: 1.7; }
    code { background: #f1f5f9; border-radius: 4px; padding: 1px 5px; color: #0f172a; font-size: 12px; }
  `,
})
export class IntegrationDialogComponent {
  private state = inject(EditorStateService);
  close = output();

  readonly origin = window.location.origin;
  copied = signal<'embed' | 'api' | 'data' | null>(null);

  templateId = computed(() => this.state.template().id);
  private idOrPlaceholder = computed(() => this.templateId() || '{樣板ID}');

  renderUrl = computed(() => `${this.origin}/api/templates/${this.idOrPlaceholder()}/render`);

  embedHtml = computed(() => `<script>
  // 先註冊 listener 再放 iframe，避免漏接編輯器的事件
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.source !== 'pdf-template-editor') return;
    if (e.data.type === 'template-saved') {
      // 使用者按了「儲存」：把樣板 id 存進你的系統，之後渲染 PDF 都用它
      console.log('樣板已儲存，id =', e.data.id);
    }
  });
<\/script>
<iframe src="${this.origin}/editor/${this.templateId() || 'new'}"
        style="width: 100%; height: 820px; border: 0;"></iframe>`);

  sampleJson = computed(() =>
    JSON.stringify({ data: this.state.buildSampleData() }, null, 2));

  curlText = computed(() => `curl -X POST '${this.renderUrl()}?strict=1' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify({ data: this.state.buildSampleData() })}' \\
  -o output.pdf`);

  async copy(which: 'embed' | 'api' | 'data', text: string) {
    await navigator.clipboard.writeText(text);
    this.copied.set(which);
    setTimeout(() => this.copied.set(null), 1500);
  }
}
