import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { currentLang, setLang, t } from '../../core/i18n/i18n';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="wrap">
      <form class="card" (ngSubmit)="submit()">
        <h1>{{ t('PDF 樣板控制台') }}</h1>
        <p class="sub">{{ t('請登入以管理專案與樣板') }}</p>
        <label>{{ t('帳號') }}
          <input name="username" [(ngModel)]="username" autocomplete="username" autofocus />
        </label>
        <label>{{ t('密碼') }}
          <input name="password" type="password" [(ngModel)]="password" autocomplete="current-password" />
        </label>
        @if (error()) { <div class="err">{{ error() }}</div> }
        <button type="submit" [disabled]="busy()">{{ busy() ? t('登入中…') : t('登入') }}</button>
        <button type="button" class="lang" (click)="toggleLang()">{{ lang === 'en' ? '中文' : 'English' }}</button>
      </form>
    </div>
  `,
  styles: `
    .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #f1f5f9; font-family: 'Noto Sans TC', sans-serif; }
    .card { width: 340px; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
      padding: 32px 28px; display: flex; flex-direction: column; gap: 14px;
      box-shadow: 0 4px 24px rgba(15, 23, 42, .06); }
    h1 { font-size: 20px; margin: 0; }
    .sub { color: #94a3b8; font-size: 13px; margin: 0 0 8px; }
    label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #475569; }
    input { padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; }
    input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .12); }
    .err { color: #dc2626; font-size: 13px; background: #fef2f2; border: 1px solid #fecaca;
      border-radius: 8px; padding: 8px 10px; }
    button { margin-top: 8px; background: #2563eb; color: #fff; border: none; border-radius: 8px;
      padding: 11px; font-size: 15px; cursor: pointer; }
    button:hover:not(:disabled) { background: #1d4ed8; }
    button:disabled { opacity: .6; cursor: default; }
    button.lang { background: none; color: #94a3b8; font-size: 12.5px; padding: 2px; margin-top: 0; }
    button.lang:hover:not(:disabled) { background: none; color: #475569; text-decoration: underline; }
  `,
})
export class LoginComponent {
  protected readonly t = t;
  protected readonly lang = currentLang();
  private auth = inject(AuthService);
  private router = inject(Router);

  toggleLang() {
    setLang(this.lang === 'en' ? 'zh-TW' : 'en');
  }

  username = '';
  password = '';
  error = signal('');
  busy = signal(false);

  async submit() {
    if (this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.login(this.username.trim(), this.password);
      this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
