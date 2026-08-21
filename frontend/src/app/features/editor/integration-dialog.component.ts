import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { EditorStateService } from './editor-state.service';

/**
 * 「連接」對話框＝本產品對外的 API 參考（刻意不做 OpenAPI：那類端點正式環境通常要關掉）。
 *
 * 內容原則：**只寫端點、請求、回應**。實作機制、設計理由、內部防護怎麼做的，
 * 一律不寫進來——那是我們的事，不是呼叫方需要知道的。
 */
@Component({
  selector: 'app-integration-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close.emit()">
      <div class="dialog" (click)="$event.stopPropagation()">
        <header>
          <h2>API 說明</h2>
          <button class="copy" (click)="copy('all', allText())">
            {{ copied() === 'all' ? '已複製 ✓' : '複製整份' }}
          </button>
          <button class="x" (click)="close.emit()">✕</button>
        </header>
        <div class="content">
          @if (!templateId()) {
            <div class="warn">此樣板尚未儲存——先按「儲存」取得樣板 id，下面範例目前以 <b>{{ '{樣板ID}' }}</b> 佔位。</div>
          }

          <div class="tabs" role="tablist">
            <button role="tab" [class.on]="tab() === 'backend'" [attr.aria-selected]="tab() === 'backend'"
              (click)="tab.set('backend')">後端 API</button>
            <button role="tab" [class.on]="tab() === 'frontend'" [attr.aria-selected]="tab() === 'frontend'"
              (click)="tab.set('frontend')">前端嵌入</button>
          </div>

          @if (tab() === 'frontend') {
            <section>
              <div class="sec-head">
                <h3>嵌入 iframe</h3>
                <button class="copy" (click)="copy('embed', embedHtml())">{{ copied() === 'embed' ? '已複製 ✓' : '複製' }}</button>
              </div>
              <pre>{{ embedHtml() }}</pre>
            </section>

            <section>
              <div class="sec-head">
                <h3>改用 postMessage 交付 token（選用）</h3>
                <button class="copy" (click)="copy('pm', postMessageHtml())">{{ copied() === 'pm' ? '已複製 ✓' : '複製' }}</button>
              </div>
              <pre>{{ postMessageHtml() }}</pre>
            </section>

            <section>
              <h3>編輯器送出的事件（選用）</h3>
              <p>格式：<code>{{ '{ source: "pdf-template-editor", type, id }' }}</code></p>
              <table class="ref">
                <tr><th>type</th><th>說明</th></tr>
                <tr><td><code>editor-ready</code></td><td>編輯器載入完成</td></tr>
                <tr><td><code>template-loaded</code></td><td>樣板載入完成</td></tr>
                <tr><td><code>template-saved</code></td><td>使用者儲存成功</td></tr>
              </table>
            </section>
          }

          @if (tab() === 'backend') {
            <section>
              <h3>API 金鑰</h3>
              <p>控制台 → 專案 →「⚙ 專案設定」→「API 金鑰」→ 建立。明文僅顯示一次。</p>
              <pre class="endpoint">Authorization: Bearer &lt;API 金鑰&gt;</pre>
            </section>

            <section>
              <div class="sec-head">
                <h3>換取 embed token</h3>
                <button class="copy" (click)="copy('token', tokenCurl())">{{ copied() === 'token' ? '已複製 ✓' : '複製' }}</button>
              </div>
              <pre class="endpoint">POST {{ origin }}/api/embed-token</pre>
              <p>Request</p>
              <pre>{{ tokenCurl() }}</pre>
              <p>Response 200</p>
              <pre>{{ tokenResponse() }}</pre>
              <table class="ref">
                <tr><th>欄位</th><th>說明</th></tr>
                <tr><td><code>templateId</code></td><td>要開啟的樣板 id；不帶則新建一張空樣板</td></tr>
                <tr><td><code>mode</code></td><td><code>design</code> 完整編輯｜<code>fill</code> 僅可修改被標記的欄位｜<code>view</code> 唯讀。預設 <code>design</code></td></tr>
                <tr><td><code>expiresAt</code></td><td>token 有效期限（預設 30 分鐘）</td></tr>
              </table>
            </section>

            <section>
              <div class="sec-head">
                <h3>渲染 PDF</h3>
                <button class="copy" (click)="copy('api', curlText())">{{ copied() === 'api' ? '已複製 ✓' : '複製' }}</button>
              </div>
              <pre class="endpoint">POST {{ renderUrl() }}</pre>
              <p>Request</p>
              <pre>{{ curlText() }}</pre>
              <p>Response 200：<code>application/pdf</code></p>
              <table class="ref">
                <tr><th>參數</th><th>說明</th></tr>
                <tr><td><code>data</code></td><td>對應樣板各欄位 key 的資料物件</td></tr>
                <tr><td><code>?strict=1</code></td><td>資料不完整時回 422，不產生 PDF</td></tr>
              </table>
              <p>樣板開啟「允許匿名渲染」（屬性面板底部的危險區）時，此端點可不帶 <code>Authorization</code> 直接呼叫；未開啟則需 API key 或 embed token。從瀏覽器跨網域呼叫時，需將呼叫端網域加入本服務的 <code>CORS_ORIGINS</code> 環境變數。</p>
            </section>

            <section>
              <div class="sec-head">
                <h3>修改欄位內容（fill 模式）</h3>
                <button class="copy" (click)="copy('values', valuesCurl())">{{ copied() === 'values' ? '已複製 ✓' : '複製' }}</button>
              </div>
              <pre class="endpoint">PATCH {{ origin }}/api/templates/{{ idOrPlaceholder() }}/values</pre>
              <p>Request（<code>Authorization</code> 帶 embed token）</p>
              <pre>{{ valuesCurl() }}</pre>
              <p>Response 200：更新後的樣板 JSON</p>
              <table class="ref">
                <tr><th>定址</th><th>對象</th></tr>
                <tr><td><code>元素id</code></td><td>文字元素</td></tr>
                <tr><td><code>表格id#列,欄</code></td><td>表格儲存格（列、欄自 0 起算）</td></tr>
              </table>
            </section>

            <section>
              <h3>狀態碼</h3>
              <table class="ref codes">
                <tr><th>碼</th><th>說明</th></tr>
                <tr><td>400</td><td>參數或內容格式不合法</td></tr>
                <tr><td>401</td><td>憑證無效或已過期</td></tr>
                <tr><td>403</td><td>權限不足</td></tr>
                <tr><td>404</td><td>樣板不存在</td></tr>
                <tr><td>409</td><td>樣板正被其他請求寫入，可重試</td></tr>
                <tr><td>422</td><td>資料未通過驗證，不產生 PDF</td></tr>
                <tr><td>429</td><td>請求過於頻繁，依 <code>Retry-After</code> 等待</td></tr>
              </table>
              <p>回應標頭 <code>X-Render-Warnings</code>：資料警告（URL 編碼的 JSON 陣列）。</p>
            </section>

            <section>
              <div class="sec-head">
                <h3>範例資料</h3>
                <button class="copy" (click)="copy('data', sampleJson())">{{ copied() === 'data' ? '已複製 ✓' : '複製' }}</button>
              </div>
              <pre class="sample">{{ sampleJson() }}</pre>
            </section>

          }
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
    section { margin-top: 16px; }
    .sec-head { display: flex; align-items: center; justify-content: space-between; }
    h3 { margin: 0; font-size: 14px; color: #0f172a; }
    .copy { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 6px; padding: 3px 12px;
      font-size: 12px; cursor: pointer; color: #1d4ed8; }
    .copy:hover { background: #eff6ff; }
    p { margin: 8px 0 4px; color: #64748b; font-size: 12px; }
    pre { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 12px; font-size: 12px;
      overflow-x: auto; white-space: pre; line-height: 1.5; margin: 4px 0; }
    pre.endpoint { background: #1e3a8a; }
    pre.sample { max-height: 200px; overflow-y: auto; }
    .tabs { display: flex; gap: 6px; margin: 12px 0 2px; border-bottom: 1px solid #e2e8f0; }
    .tabs button { border: none; background: none; padding: 7px 14px; font-size: 13px; cursor: pointer;
      color: #64748b; border-bottom: 2px solid transparent; font-family: inherit; }
    .tabs button.on { color: #1d4ed8; border-bottom-color: #1d4ed8; font-weight: 600; }
    .tabs button:hover:not(.on) { color: #334155; }
    table.ref { width: 100%; border-collapse: collapse; font-size: 11.5px; margin: 6px 0; }
    table.ref th, table.ref td { border: 1px solid #e2e8f0; padding: 4px 7px; text-align: left; vertical-align: top; }
    table.ref th { background: #f1f5f9; color: #475569; font-weight: 600; white-space: nowrap; }
    table.codes td:first-child { white-space: nowrap; text-align: center; width: 1%; }
    code { background: #f1f5f9; border-radius: 4px; padding: 1px 5px; color: #0f172a; font-size: 12px; }
  `,
})
export class IntegrationDialogComponent {
  private state = inject(EditorStateService);
  close = output();

  readonly origin = window.location.origin;
  copied = signal<string | null>(null);
  tab = signal<'backend' | 'frontend'>('backend');

  templateId = computed(() => this.state.template().id);
  idOrPlaceholder = computed(() => this.templateId() || '{樣板ID}');

  renderUrl = computed(() => `${this.origin}/api/templates/${this.idOrPlaceholder()}/render`);

  embedHtml = computed(() => `<iframe src="${this.origin}/editor/${this.templateId() || 'new'}#token={embed token}"
        style="width: 100%; height: 820px; border: 0;"></iframe>`);

  postMessageHtml = computed(() => `<iframe id="tpl" src="${this.origin}/editor/${this.templateId() || 'new'}"
        style="width: 100%; height: 820px; border: 0;"></iframe>
<script>
  const SERVICE = '${this.origin}';
  const iframe = document.getElementById('tpl');
  window.addEventListener('message', (e) => {
    if (e.origin !== SERVICE) return;
    if (e.data?.source === 'pdf-template-editor' && e.data.type === 'editor-ready') {
      iframe.contentWindow.postMessage(
        { type: 'pdf-template-set-token', token: '{embed token}' }, SERVICE);
    }
  });
</script>`);

  tokenCurl = computed(() => `curl -X POST '${this.origin}/api/embed-token' \\
  -H 'Authorization: Bearer <API 金鑰>' \\
  -H 'Content-Type: application/json' \\
  -d '{"templateId":"${this.idOrPlaceholder()}","mode":"fill"}'`);

  tokenResponse = computed(() => JSON.stringify({
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…',
    templateId: this.idOrPlaceholder(),
    mode: 'fill',
    expiresAt: '2026-07-25T10:30:00Z',
  }, null, 2));

  valuesCurl = computed(() => `curl -X PATCH '${this.origin}/api/templates/${this.idOrPlaceholder()}/values' \\
  -H 'Authorization: Bearer <embed token>' \\
  -H 'Content-Type: application/json' \\
  -d '{"values":{"<元素id>":"新文字","<表格id>#2,3":"新文字"}}'`);

  curlText = computed(() => `curl -X POST '${this.renderUrl()}?strict=1' \\
  -H 'Authorization: Bearer <API 金鑰>' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify({ data: this.state.buildSampleData() })}' \\
  -o output.pdf`);

  sampleJson = computed(() =>
    JSON.stringify({ data: this.state.buildSampleData() }, null, 2));

  /** 「複製整份」：目前分頁的純文字版，可直接貼給對應的工程師。 */
  allText = computed(() => this.tab() === 'frontend' ? this.frontendText() : this.backendText());

  private frontendText = computed(() => [
    `PDF 樣板服務 — 前端嵌入（樣板 ${this.idOrPlaceholder()}）`,
    '',
    '── 嵌入 iframe ──',
    this.embedHtml(),
    '',
    '── 改用 postMessage 交付 token（選用）──',
    this.postMessageHtml(),
    '',
    '── 編輯器送出的事件（選用）──',
    '格式：{ source: "pdf-template-editor", type, id }',
    'editor-ready     編輯器載入完成',
    'template-loaded  樣板載入完成',
    'template-saved   使用者儲存成功',
  ].join('\n'));

  private backendText = computed(() => [
    `PDF 樣板服務 — 後端 API（樣板 ${this.idOrPlaceholder()}）`,
    `Base URL：${this.origin}`,
    '',
    '── API 金鑰 ──',
    '控制台 → 專案 → ⚙ 專案設定 → API 金鑰 → 建立（明文僅顯示一次）',
    'Authorization: Bearer <API 金鑰>',
    '',
    '── 換取 embed token ──',
    `POST ${this.origin}/api/embed-token`,
    this.tokenCurl(),
    'Response 200：',
    this.tokenResponse(),
    'templateId  要開啟的樣板 id；不帶則新建一張空樣板',
    'mode        design 完整編輯｜fill 僅可修改被標記的欄位｜view 唯讀（預設 design）',
    'expiresAt   token 有效期限（預設 30 分鐘）',
    '',
    '── 渲染 PDF ──',
    `POST ${this.renderUrl()}`,
    this.curlText(),
    'Response 200：application/pdf',
    'data       對應樣板各欄位 key 的資料物件',
    '?strict=1  資料不完整時回 422，不產生 PDF',
    '樣板開啟「允許匿名渲染」時，此端點可不帶 Authorization 直接呼叫；未開啟則需 API key 或 embed token',
    '',
    '── 修改欄位內容（fill 模式，Authorization 帶 embed token）──',
    `PATCH ${this.origin}/api/templates/${this.idOrPlaceholder()}/values`,
    this.valuesCurl(),
    'Response 200：更新後的樣板 JSON',
    '定址：元素id（文字元素）／表格id#列,欄（表格儲存格，自 0 起算）',
    '',
    '── 狀態碼 ──',
    '400 參數或內容格式不合法',
    '401 憑證無效或已過期',
    '403 權限不足',
    '404 樣板不存在',
    '409 樣板正被其他請求寫入，可重試',
    '422 資料未通過驗證，不產生 PDF',
    '429 請求過於頻繁，依 Retry-After 等待',
    'X-Render-Warnings 回應標頭：資料警告（URL 編碼的 JSON 陣列）',
    '',
    '── 範例資料 ──',
    this.sampleJson(),
  ].join('\n'));

  async copy(which: string, text: string) {
    await navigator.clipboard.writeText(text);
    this.copied.set(which);
    setTimeout(() => this.copied.set(null), 1500);
  }
}
