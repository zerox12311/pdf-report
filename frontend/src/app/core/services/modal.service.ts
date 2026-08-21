import { Injectable, signal } from '@angular/core';

import { t } from '../i18n/i18n';

/** modal 內的按鈕 */
export interface ModalButton {
  label: string;
  /** 點下去 resolve 的值（submit 按鈕忽略此值，改回傳輸入內容） */
  value: unknown;
  kind?: 'primary' | 'danger' | 'default';
  /** prompt 的送出鈕：先驗證輸入再 resolve 輸入值 */
  submit?: boolean;
}

/** 目前顯示中的 modal 狀態（null = 無） */
export interface ModalState {
  title: string;
  message?: string;
  /** 有值 = prompt（帶輸入框） */
  input?: {
    type: 'text' | 'password';
    placeholder?: string;
    value: string;
    minLength?: number;
    error?: string;
  };
  /** 有值 = 顯示一格唯讀、可一鍵複製的內容（例如只顯示一次的 API 金鑰明文） */
  copy?: string;
  buttons: ModalButton[];
  /** 背景/Esc 取消時 resolve 的值 */
  cancelValue: unknown;
  resolve: (v: unknown) => void;
}

/**
 * 全域 modal 服務：取代瀏覽器內建的 confirm/prompt/alert。
 * 由 <app-modal-host> 統一渲染（掛在 app root）。
 */
@Injectable({ providedIn: 'root' })
export class ModalService {
  readonly state = signal<ModalState | null>(null);

  /** 是非確認；回傳 true=確認。 */
  confirm(opts: {
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this.open(
        {
          title: opts.title,
          message: opts.message,
          buttons: [
            { label: opts.cancelLabel ?? t('取消'), value: false, kind: 'default' },
            { label: opts.confirmLabel ?? t('確定'), value: true, kind: opts.danger ? 'danger' : 'primary' },
          ],
          cancelValue: false,
        },
        resolve as (v: unknown) => void,
      );
    });
  }

  /** 文字輸入；回傳輸入值，取消回傳 null。 */
  prompt(opts: {
    title: string;
    message?: string;
    placeholder?: string;
    password?: boolean;
    minLength?: number;
    initial?: string;
    confirmLabel?: string;
  }): Promise<string | null> {
    return new Promise<string | null>(resolve => {
      this.open(
        {
          title: opts.title,
          message: opts.message,
          input: {
            type: opts.password ? 'password' : 'text',
            placeholder: opts.placeholder,
            value: opts.initial ?? '',
            minLength: opts.minLength,
          },
          buttons: [
            { label: t('取消'), value: null, kind: 'default' },
            { label: opts.confirmLabel ?? t('確定'), value: null, kind: 'primary', submit: true },
          ],
          cancelValue: null,
        },
        resolve as (v: unknown) => void,
      );
    });
  }

  /** 訊息告知（單一確定鈕）。`copy` 有值時多顯示一格可一鍵複製的內容。 */
  alert(opts: { title: string; message?: string; copy?: string }): Promise<void> {
    return new Promise<void>(resolve => {
      this.open(
        {
          title: opts.title,
          message: opts.message,
          copy: opts.copy,
          buttons: [{ label: t('確定'), value: undefined, kind: 'primary' }],
          cancelValue: undefined,
        },
        () => resolve(),
      );
    });
  }

  private open(partial: Omit<ModalState, 'resolve'>, resolve: (v: unknown) => void) {
    this.state.set({ ...partial, resolve });
  }
}
