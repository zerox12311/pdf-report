import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { EditorStateService } from './editor-state.service';
import { SyntaxHelpComponent } from './syntax-help.component';

/**
 * 「連接」對話框：給宿主系統的整合說明——
 * iframe 嵌入 HTML（可複製）與後端渲染 API 的呼叫方式。
 */
@Component({
  selector: 'app-integration-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SyntaxHelpComponent],
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
              <h3>1. 嵌入編輯器（宿主前端零事件）</h3>
              <button class="copy" (click)="copy('embed', embedHtml())">{{ copied() === 'embed' ? '已複製 ✓' : '複製' }}</button>
            </div>
            <p>宿主<b>後端</b>用專案 API 金鑰（專案設定頁簽發）換一張短效 token，前端把它接在 iframe 網址的 <code>#token=</code> 後面即可，<b>不用寫任何 JavaScript</b>。</p>
            <pre>{{ embedHtml() }}</pre>
            <p class="note">
              <b>權限模式（mode）</b>由宿主後端在換 token 時指定，簽在 token 裡、前端改不了：
              <code>design</code> 完整編輯器｜<code>fill</code> 只能改被標記「允許在填寫模式修改」的欄位、版面鎖死｜<code>view</code> 唯讀。
              可填欄位在設計模式的屬性面板勾選，畫布上顯示綠色虛線。
              <br />token 放 <code>#</code>（fragment）不放 <code>?</code>：不會進後端 log 與 Referer。不想讓 token 進網址可改用 postMessage 交付（見 docs/embed.md）。
            </p>
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

          <section>
            <h3>4. 樣板可用的資料語法</h3>
            <p>樣板文字與表格儲存格支援下列插值、格式與引擎函式——宿主端據此準備 data：</p>
            <app-syntax-help [always]="true" />
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

  // 宿主前端零事件：後端換好 token，前端只放 iframe（token 接在 #token= 後）
  embedHtml = computed(() => `<!-- 1) 宿主「後端」用 project API key 換短效 token（mode 決定權限） -->
<!--    POST ${this.origin}/api/embed-token
        Authorization: Bearer <API key>
        { "templateId": "${this.idOrPlaceholder()}", "mode": "design" }   // design｜fill｜view  -->

<!-- 2) 宿主前端只要這一行，不需要寫任何 JavaScript -->
<iframe src="${this.origin}/editor/${this.templateId() || 'new'}#token={上一步拿到的 token}"
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
