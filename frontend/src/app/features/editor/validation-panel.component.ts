import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { t } from '../../core/i18n/i18n';
import { ValidationFieldType } from '../../core/models/template.model';
import { JsonEditorComponent } from '../../shared/json-editor.component';
import { TemplateApiService, ValidationResult } from '../../core/services/template-api.service';
import { EditorStateService } from './editor-state.service';

/**
 * 「驗證」分頁：定義輸入資料的 schema 驗證規則（綁樣板、可開關）。
 * 混合模式——「從樣板偵測欄位」合併補新，設計者再手動微調必填/型別。
 * 內建測試區：貼 data JSON 打 POST /api/validate（與正式渲染守門同一權威）當場驗。
 */
@Component({
  selector: 'app-validation-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, JsonEditorComponent],
  template: `
    <div class="page">
      <div class="col">
        <!-- 總開關 -->
        <label class="toggle">
          <input type="checkbox" [checked]="spec().enabled" (change)="setEnabled($any($event.target).checked)" />
          <span class="tg-title">{{ t('啟用輸入驗證') }}</span>
        </label>
        <div class="hint">
          {{ t('開啟後：宿主 POST 到') }} <code>/render</code> {{ t('的') }} <b>data</b> {{ t('會先過此驗證，不過 → 回') }} <b>422</b>{{ t('、不產生 PDF；關閉 → 完全跳過。') }}
          @if (!spec().enabled) { <span class="off-note">{{ t('（目前關閉，下方規則不會生效，但仍可先設計、用測試區試跑）') }}</span> }
        </div>

        <!-- 工具列 -->
        <div class="toolbar">
          <button class="secondary" (click)="detect()">{{ t('🔍 從樣板偵測欄位') }}</button>
          <button class="secondary" (click)="addField()">{{ t('＋ 手動新增欄位') }}</button>
          @if (detectMsg(); as m) { <span class="detect-msg">{{ m }}</span> }
        </div>

        <!-- 欄位表 -->
        @if (spec().fields.length) {
          <div class="table">
            <div class="thead">
              <span class="c-path">{{ t('欄位路徑') }}</span>
              <span class="c-req">{{ t('必填') }}</span>
              <span class="c-type">{{ t('型別') }}</span>
              <span class="c-src">{{ t('來源') }}</span>
              <span class="c-del"></span>
            </div>
            @for (f of spec().fields; track $index) {
              <div class="trow">
                <input class="c-path" [value]="f.path" (input)="setPath($index, $any($event.target).value)"
                  [placeholder]="t('例：school.name 或 items[].amount')" spellcheck="false" />
                <span class="c-req">
                  <input type="checkbox" [checked]="f.required" (change)="setRequired($index, $any($event.target).checked)" />
                </span>
                <select class="c-type" (change)="setType($index, $any($event.target).value)">
                  @for (t of types; track t) { <option [value]="t" [selected]="t === f.type">{{ typeLabel(t) }}</option> }
                </select>
                <span class="c-src" [class.manual]="f.source === 'manual'">{{ f.source === 'manual' ? t('手動') : t('偵測') }}</span>
                <button class="c-del del" (click)="removeField($index)" [title]="t('刪除此欄位')">✕</button>
              </div>
            }
          </div>
          <div class="syntax">
            {{ t('路徑語法：巢狀用') }} <code>.</code>（<code>school.name</code>）；{{ t('陣列') }}<b>{{ t('逐元素') }}</b>{{ t('用') }} <code>[]</code>（<code>items[].amount</code>{{ t('，對每筆檢查）；') }}
            {{ t('只寫陣列名（') }}<code>items</code>{{ t('）則檢查陣列本身。') }}
          </div>
        } @else {
          <div class="empty">
            {{ t('尚無欄位規則。按「') }}<b>{{ t('從樣板偵測欄位') }}</b>{{ t('」把樣板用到的資料欄位補進來，或「手動新增」。') }}
          </div>
        }
      </div>

      <!-- 測試區 -->
      <div class="col test">
        <div class="col-head">
          <span>{{ t('測試這份 schema') }}</span>
          <button class="secondary" (click)="fillSample()" [title]="sampleSourceHint()">{{ t('用範例資料填入') }}</button>
        </div>
        <div class="hint">{{ t('貼一段') }} <b>data</b> {{ t('JSON，按驗證當場檢查（不渲染）。測試會忽略上方總開關，一律套用目前規則。') }}</div>
        <app-json-editor [value]="testData()" (valueChange)="testData.set($event)"
          placeholderText='{ "school": { "name": "…" }, "items": [ … ] }' />
        <button class="primary" (click)="runTest()" [disabled]="testing()">{{ testing() ? t('驗證中…') : t('驗證') }}</button>
        @if (testError(); as e) { <div class="err">{{ e }}</div> }
        @if (result(); as r) {
          @if (r.ok) {
            <div class="pass">{{ t('✅ 通過——這組資料符合所有規則。') }}</div>
          } @else {
            <div class="fail-head">{{ t('❌ {n} 筆不通過：', { n: r.errors.length }) }}</div>
            <ul class="fail-list">
              @for (er of r.errors; track $index) {
                <li><code>{{ er.path }}</code> — {{ er.rule === 'required' ? t('必填') : t('型別') }}：{{ er.message }}</li>
              }
            </ul>
          }
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; flex: 1; min-height: 0; background: #eef1f5; overflow: auto; }
    .page { display: flex; gap: 16px; padding: 16px; box-sizing: border-box; align-items: flex-start; min-height: 100%; }
    .col { background: #fff; border: 1px solid #e2e6ee; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .col:first-child { flex: 1; min-width: 0; }
    .col.test { width: 340px; flex-shrink: 0; align-self: stretch; }

    .toggle { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .toggle input { width: 16px; height: 16px; }
    .tg-title { font-size: 15px; font-weight: 700; color: #1f2937; }
    .hint { font-size: 12px; color: #6b7280; line-height: 1.6; }
    .hint code, .syntax code { background: #eef2fb; color: #2563eb; padding: 0 4px; border-radius: 3px; font-size: 11px; }
    .off-note { color: #9ca3af; }

    .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
    .detect-msg { font-size: 12px; color: #059669; }

    .secondary {
      font-size: 12px; padding: 6px 12px; cursor: pointer;
      color: #2563eb; background: #fff; border: 1px solid #c7d2e8; border-radius: 6px; font-weight: 500;
      transition: background .12s, border-color .12s;
    }
    .secondary:hover { background: #eef2fb; border-color: #2563eb; }

    .table { display: flex; flex-direction: column; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
    .thead, .trow { display: grid; grid-template-columns: 1fr 48px 96px 52px 32px; align-items: center; gap: 8px; padding: 6px 10px; }
    .thead { background: #f7f8fa; font-size: 11px; font-weight: 600; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
    .trow { border-bottom: 1px solid #f0f1f4; }
    .trow:last-child { border-bottom: none; }
    .trow:hover { background: #fafbfc; }
    .c-req, .c-src { text-align: center; }
    .c-req input { width: 15px; height: 15px; }
    .c-path { font-family: monospace; font-size: 12px; padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 5px; min-width: 0; }
    .c-path:focus { outline: none; border-color: #2563eb; }
    .c-type { font-size: 12px; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 5px; background: #fff; cursor: pointer; }
    .c-src { font-size: 11px; color: #9ca3af; }
    .c-src.manual { color: #7c3aed; }
    .del { border: none; background: none; color: #b91c1c; cursor: pointer; font-size: 13px; padding: 2px; border-radius: 4px; }
    .del:hover { background: #fee2e2; }
    .syntax { font-size: 11px; color: #9ca3af; line-height: 1.6; }
    .empty { font-size: 13px; color: #6b7280; padding: 24px; text-align: center; background: #f9fafb; border-radius: 6px; border: 1px dashed #d1d5db; }

    .col-head { font-size: 13px; font-weight: 700; color: #1f2937; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .test app-json-editor { flex: 1; min-height: 200px; }
    .primary { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 10px; cursor: pointer; font-size: 14px; }
    .primary:disabled { opacity: .6; }
    .err { color: #dc2626; font-size: 12px; white-space: pre-wrap; }
    .pass { color: #059669; font-size: 13px; font-weight: 600; }
    .fail-head { color: #dc2626; font-size: 13px; font-weight: 600; }
    .fail-list { margin: 0; padding-left: 18px; font-size: 12px; color: #374151; line-height: 1.8; }
    .fail-list code { background: #fef2f2; color: #b91c1c; padding: 0 4px; border-radius: 3px; }
  `,
})
export class ValidationPanelComponent {
  protected readonly t = t;
  private state = inject(EditorStateService);
  private api = inject(TemplateApiService);

  spec = this.state.validation;
  types: ValidationFieldType[] = ['any', 'string', 'number', 'boolean', 'array', 'object'];

  detectMsg = signal('');
  testData = signal('');
  result = signal<ValidationResult | null>(null);
  testError = signal<string | null>(null);
  testing = signal(false);

  typeLabel(ty: ValidationFieldType): string {
    return { any: t('任意'), string: t('字串'), number: t('數字'), boolean: t('布林'), array: t('陣列'), object: t('物件') }[ty];
  }

  setEnabled(v: boolean) { this.state.setValidationEnabled(v); }
  detect() {
    const n = this.state.detectValidationFields();
    this.detectMsg.set(n > 0 ? t('已補進 {n} 個新欄位', { n }) : t('沒有新欄位（都在了）'));
  }
  addField() { this.state.addValidationField(); this.detectMsg.set(''); }
  removeField(i: number) { this.state.removeValidationField(i); }
  setPath(i: number, v: string) { this.state.updateValidationField(i, { path: v }); }
  setRequired(i: number, v: boolean) { this.state.updateValidationField(i, { required: v }); }
  setType(i: number, v: string) { this.state.updateValidationField(i, { type: v as ValidationFieldType }); }

  /** 按鈕提示：講清楚這一按會帶入哪來的資料（state 是 private，不能直接在樣板裡讀） */
  sampleSourceHint(): string {
    return this.state.previewData().trim()
      ? t('帶入「資料」分頁貼的那份 JSON')
      : t('「資料」分頁沒有資料 → 由樣板欄位合成一份');
  }

  /**
   * 帶入測試資料。優先用「資料」分頁貼的那份 —— 兩邊各自產生「範例資料」的話，
   * 設計者會拿一份跟預覽/渲染無關的資料去驗證，過了也不代表實際出單會過。
   * 資料分頁是空的或壞 JSON 才退回由樣板合成。
   */
  fillSample() {
    const pasted = this.state.previewData().trim();
    if (pasted) {
      try {
        const parsed: unknown = JSON.parse(pasted);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this.testData.set(JSON.stringify(parsed, null, 2));
          return;
        }
      } catch { /* 壞 JSON → 退回合成 */ }
    }
    this.testData.set(JSON.stringify(this.state.buildSampleData(), null, 2));
  }

  async runTest() {
    this.testing.set(true);
    this.testError.set(null);
    this.result.set(null);
    try {
      const text = this.testData().trim();
      const data = text ? JSON.parse(text) : {};
      this.result.set(await this.api.validate(this.spec(), data));
    } catch (e) {
      this.testError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.testing.set(false);
    }
  }
}
