import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-change-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="crumbs"><a (click)="back()">← 返回</a></div>
    <form class="card" (ngSubmit)="submit()">
      <h1>修改密碼</h1>
      <label>目前密碼
        <input name="old" type="password" [(ngModel)]="oldPassword" autocomplete="current-password" />
      </label>
      <label>新密碼（至少 4 字元）
        <input name="new" type="password" [(ngModel)]="newPassword" autocomplete="new-password" />
      </label>
      <label>確認新密碼
        <input name="confirm" type="password" [(ngModel)]="confirmPassword" autocomplete="new-password" />
      </label>
      @if (error()) { <div class="err">{{ error() }}</div> }
      @if (done()) { <div class="ok">密碼已更新。</div> }
      <button type="submit" [disabled]="busy()">{{ busy() ? '更新中…' : '更新密碼' }}</button>
    </form>
  `,
  styles: `
    .crumbs { font-size: 13px; margin-bottom: 12px; }
    .crumbs a { color: #2563eb; cursor: pointer; }
    .card { max-width: 380px; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
      padding: 28px; display: flex; flex-direction: column; gap: 14px; }
    h1 { font-size: 19px; margin: 0; }
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
  private auth = inject(AuthService);
  private router = inject(Router);

  oldPassword = '';
  newPassword = '';
  confirmPassword = '';
  error = signal('');
  done = signal(false);
  busy = signal(false);

  back() {
    this.router.navigateByUrl('/');
  }

  async submit() {
    if (this.busy()) return;
    this.error.set('');
    this.done.set(false);
    if (this.newPassword.length < 4) {
      this.error.set('新密碼至少 4 字元');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.error.set('兩次新密碼不一致');
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
