import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MenuItem } from 'primeng/api';
import { BreadcrumbModule } from 'primeng/breadcrumb';

import { t } from '../../core/i18n/i18n';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-change-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, BreadcrumbModule],
  template: `
    <p-breadcrumb [home]="home" [model]="crumbs" />
    <form class="card" (ngSubmit)="submit()">
      <h1>{{ t('修改密碼') }}</h1>
      <label>{{ t('目前密碼') }}
        <input name="old" type="password" [(ngModel)]="oldPassword" autocomplete="current-password" />
      </label>
      <label>{{ t('新密碼（至少 8 字元）') }}
        <input name="new" type="password" [(ngModel)]="newPassword" autocomplete="new-password" />
      </label>
      <label>{{ t('確認新密碼') }}
        <input name="confirm" type="password" [(ngModel)]="confirmPassword" autocomplete="new-password" />
      </label>
      @if (error()) { <div class="err">{{ error() }}</div> }
      @if (done()) { <div class="ok">{{ t('密碼已更新。') }}</div> }
      <button type="submit" [disabled]="busy()">{{ busy() ? t('更新中…') : t('更新密碼') }}</button>
    </form>
  `,
  styles: `
    /* 麵包屑維持主欄寬度（各頁位置固定，不隨內容寬窄移動）；只有卡片置中。 */
    :host { display: block; }
    .card { max-width: 420px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0;
      border-radius: 14px; padding: 28px; display: flex; flex-direction: column; gap: 14px; }
    h1 { font-size: 19px; margin: 0 0 4px; text-align: center; }
    label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #475569; }
    input { padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; }
    input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .12); }
    .err { color: #dc2626; font-size: 13px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 10px; }
    .ok { color: #15803d; font-size: 13px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 8px 10px; }
    button { margin-top: 6px; background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 11px; font-size: 15px; cursor: pointer; }
    button:hover:not(:disabled) { background: #1d4ed8; }
    button:disabled { opacity: .6; cursor: default; }
  `,
})
export class ChangePasswordComponent {
  protected readonly t = t;
  private auth = inject(AuthService);

  readonly home: MenuItem = { icon: 'pi pi-home', routerLink: '/' };
  readonly crumbs: MenuItem[] = [{ label: t('修改密碼') }];

  oldPassword = '';
  newPassword = '';
  confirmPassword = '';
  error = signal('');
  done = signal(false);
  busy = signal(false);

  async submit() {
    if (this.busy()) return;
    this.error.set('');
    this.done.set(false);
    if (this.newPassword.length < 8) {
      this.error.set(t('新密碼至少 8 字元'));
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.error.set(t('兩次新密碼不一致'));
      return;
    }
    this.busy.set(true);
    try {
      await this.auth.changePassword(this.oldPassword, this.newPassword);
      this.done.set(true);
      this.oldPassword = this.newPassword = this.confirmPassword = '';
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
