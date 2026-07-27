import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { closeBrackets } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, linter } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder as cmPlaceholder } from '@codemirror/view';

/**
 * JSON 程式碼編輯器（CodeMirror 6）：語法上色、行號、括號配對/自動閉合、
 * 即時 JSON 語法檢查（錯誤行有紅色底線與燈號）、Tab 縮排、undo/redo、
 * 自動排版（右上角按鈕或 Shift+Alt+F；JSON 有誤時按鈕短暫變紅、不動內容）。
 * 資料分頁／預覽資料／樣板JSON／驗證測試資料共用；取代原本的 <textarea>。
 * 高度由使用端 CSS 決定（app-json-editor 給 flex:1 或固定 height）。
 */
@Component({
  selector: 'app-json-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cm-host" #host></div>
    <button class="fmt" type="button" [class.bad]="fmtError()"
      [title]="fmtError() ? 'JSON 有誤，先修正紅線處' : '自動排版（Shift+Alt+F）'"
      (click)="format()">{{ fmtError() ? '格式錯誤' : '⌥ 排版' }}</button>
  `,
  styles: `
    :host { display: block; position: relative; min-height: 0; }
    .cm-host { height: 100%; min-height: inherit; }
    .fmt { position: absolute; top: 5px; right: 5px; z-index: 5; font-size: 11px; line-height: 1.4;
      padding: 2px 8px; border: 1px solid #d3dce8; border-radius: 5px; background: rgba(255, 255, 255, .92);
      color: #64748b; cursor: pointer; opacity: 0; transition: opacity .12s, color .12s, border-color .12s; }
    :host(:hover) .fmt, .fmt:focus-visible, .fmt.bad { opacity: 1; }
    .fmt:hover { color: #2563eb; border-color: #93b4f8; background: #fff; }
    .fmt.bad { color: #b91c1c; border-color: #fca5a5; background: #fef2f2; }
  `,
})
export class JsonEditorComponent {
  value = input<string>('');
  placeholderText = input<string>('');
  valueChange = output<string>();

  private host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private view?: EditorView;
  private emitting = false;

  /** 排版失敗（JSON 壞掉）短暫提示中 */
  readonly fmtError = signal(false);
  private fmtErrorTimer?: ReturnType<typeof setTimeout>;

  /** 自動排版：JSON.parse 成功 → 2 空格縮排重排；失敗 → 按鈕短暫變紅，不動內容 */
  format() {
    if (!this.view) return;
    const raw = this.view.state.doc.toString();
    if (!raw.trim()) return;
    try {
      const pretty = JSON.stringify(JSON.parse(raw), null, 2);
      if (pretty !== raw) {
        this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: pretty } });
      }
      this.view.focus();
    } catch {
      this.fmtError.set(true);
      clearTimeout(this.fmtErrorTimer);
      this.fmtErrorTimer = setTimeout(() => this.fmtError.set(false), 1800);
    }
  }

  constructor() {
    // 外部值變更 → 同步進編輯器（自己 emit 造成的回寫略過，避免游標跳動）
    effect(() => {
      const v = this.value();
      if (this.view && !this.emitting && v !== this.view.state.doc.toString()) {
        this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: v } });
      }
    });
    afterNextRender(() => this.init());
    inject(DestroyRef).onDestroy(() => this.view?.destroy());
  }

  private init() {
    const extensions = [
      lineNumbers(),
      history(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle),
      json(),
      linter(jsonParseLinter()),
      lintGutter(),
      EditorView.lineWrapping,
      keymap.of([
        { key: 'Shift-Alt-f', run: () => { this.format(); return true; } },
        ...defaultKeymap, ...historyKeymap, indentWithTab,
      ]),
      EditorView.updateListener.of(u => {
        if (!u.docChanged) return;
        this.emitting = true;
        try {
          this.valueChange.emit(u.state.doc.toString());
        } finally {
          this.emitting = false;
        }
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '12px', border: '1px solid #ccc', borderRadius: '6px', backgroundColor: '#fff' },
        '&.cm-focused': { outline: 'none', borderColor: '#2563eb' },
        '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.55' },
        '.cm-gutters': { backgroundColor: '#f8fafc', color: '#94a3b8', border: 'none', borderRight: '1px solid #e2e8f0', borderRadius: '6px 0 0 6px' },
        '.cm-activeLine': { backgroundColor: 'rgba(37, 99, 235, .04)' },
        '.cm-placeholder': { color: '#9ca3af' },
      }),
    ];
    if (this.placeholderText()) extensions.push(cmPlaceholder(this.placeholderText()));
    this.view = new EditorView({
      parent: this.host().nativeElement,
      state: EditorState.create({ doc: this.value(), extensions }),
    });
  }
}
