import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { t } from '../core/i18n/i18n';
import { ModalButton, ModalService, ModalState } from '../core/services/modal.service';

/**
 * 全域 modal 渲染器。掛在 app root，顯示 ModalService 目前的請求。
 * 取代瀏覽器內建 confirm/prompt/alert。
 */
@Component({
  selector: 'app-modal-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (modal.state(); as s) {
      <div class="overlay" (click)="cancel(s)">
        <div class="card" (click)="$event.stopPropagation()">
          <h2>{{ s.title }}</h2>
          @if (s.message) { <p class="msg">{{ s.message }}</p> }
          @if (s.copy; as copy) {
            <div class="copybox">
              <code>{{ copy }}</code>
              <button class="copybtn" [class.done]="copied()" (click)="copyValue(copy)">
                {{ copied() ? t('已複製') : t('複製') }}
              </button>
            </div>
          }
          @if (s.input; as inp) {
            <input
              #field
              [type]="inp.type"
              [placeholder]="inp.placeholder ?? ''"
              [ngModel]="inp.value"
              (ngModelChange)="onInput(s, $event)"
              (keydown.enter)="submitPrompt(s, $event)"
              autocomplete="off"
              autofocus />
            @if (inp.error) { <div class="err">{{ inp.error }}</div> }
          }
          <div class="actions">
            @for (b of s.buttons; track b.label) {
              <button [class]="'btn ' + (b.kind ?? 'default')" (click)="click(s, b)">{{ b.label }}</button>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, .45); z-index: 9999;
      display: flex; align-items: center; justify-content: center; font-family: 'Noto Sans TC', sans-serif; }
    .card { width: 360px; max-width: calc(100vw - 32px); background: #fff; border-radius: 14px;
      padding: 24px; box-shadow: 0 12px 40px rgba(15, 23, 42, .25); }
    h2 { font-size: 17px; margin: 0 0 8px; color: #0f172a; }
    .msg { font-size: 14px; color: #475569; margin: 0 0 14px; line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere; }
    input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #cbd5e1;
      border-radius: 8px; font-size: 14px; margin-bottom: 4px; }
    input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .12); }
    .err { color: #dc2626; font-size: 12px; margin-bottom: 8px; }
    .copybox { display: flex; align-items: stretch; gap: 8px; margin: 0 0 14px; }
    .copybox code { flex: 1; min-width: 0; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px;
      padding: 10px 12px; font-family: 'Noto Sans Mono', ui-monospace, monospace; font-size: 13px;
      color: #0f172a; overflow-wrap: anywhere; word-break: break-all; }
    .copybtn { flex: none; padding: 8px 14px; border-radius: 8px; border: 1px solid #2563eb; background: #eff6ff;
      color: #2563eb; font-size: 13px; cursor: pointer; white-space: nowrap; }
    .copybtn:hover { background: #dbeafe; }
    .copybtn.done { border-color: #16a34a; background: #f0fdf4; color: #16a34a; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    .btn { padding: 8px 16px; border-radius: 8px; font-size: 14px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; color: #475569; }
    .btn.default:hover { background: #f1f5f9; }
    .btn.primary { background: #2563eb; color: #fff; border: none; }
    .btn.primary:hover { background: #1d4ed8; }
    .btn.danger { background: #dc2626; color: #fff; border: none; }
    .btn.danger:hover { background: #b91c1c; }
  `,
})
export class ModalHostComponent {
  modal = inject(ModalService);
  protected readonly t = t;
  /** 複製按鈕的「已複製」回饋狀態；每次 modal 切換時重置 */
  copied = signal(false);

  constructor() {
    effect(() => {
      this.modal.state();
      this.copied.set(false);
    });
  }

  async copyValue(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
    } catch {
      // clipboard API 不可用（非安全內容等）時退回 execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        this.copied.set(document.execCommand('copy'));
      } catch {
        /* 都失敗就維持未複製狀態，使用者仍可手動選取 */
      }
      ta.remove();
    }
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    const s = this.modal.state();
    if (s) this.cancel(s);
  }

  onInput(s: ModalState, value: string) {
    this.modal.state.set({ ...s, input: { ...s.input!, value, error: undefined } });
  }

  click(s: ModalState, b: ModalButton) {
    if (s.input && b.submit) {
      this.submitPrompt(s);
      return;
    }
    this.resolve(s, b.value);
  }

  submitPrompt(s: ModalState, ev?: Event) {
    // 注音／輸入法選字中按 Enter 是確認選字，不可當提交
    const ke = ev as KeyboardEvent | undefined;
    if (ke && (ke.isComposing || ke.keyCode === 229)) return;
    const inp = s.input!;
    if (inp.minLength && inp.value.length < inp.minLength) {
      this.modal.state.set({ ...s, input: { ...inp, error: t('至少 {n} 字元', { n: inp.minLength }) } });
      return;
    }
    this.resolve(s, inp.value);
  }

  cancel(s: ModalState) {
    this.resolve(s, s.cancelValue);
  }

  private resolve(s: ModalState, value: unknown) {
    this.modal.state.set(null);
    s.resolve(value);
  }
}
