import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { currentLang, setLang, t } from '../../core/i18n/i18n';
import { AuthService } from '../../core/services/auth.service';

/** 控制台外殼：頂列（品牌 / 使用者 / 改密碼 / 登出）＋內容 router-outlet。 */
@Component({
  selector: 'app-console-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ButtonModule, TagModule],
  template: `
    <header class="bar">
      <a class="brand" routerLink="/">
        <i class="pi pi-file-edit"></i>
        <span>{{ t('PDF 樣板控制台') }}</span>
      </a>
      <nav class="nav">
        @if (auth.isAdmin()) {
          <a routerLink="/users" routerLinkActive="active">{{ t('使用者管理') }}</a>
        }
        <a routerLink="/account/password" routerLinkActive="active">{{ t('修改密碼') }}</a>
      </nav>
      <div class="right">
        @if (auth.user(); as u) {
          <span class="who">{{ u.username }}</span>
          <p-tag
            [value]="u.role === 'admin' ? t('管理員') : t('使用者')"
            [severity]="u.role === 'admin' ? 'info' : 'secondary'"
            [rounded]="true" />
        }
        <button class="lang" type="button" (click)="toggleLang()" [title]="t('切換語言')">
          {{ lang === 'en' ? '中文' : 'EN' }}
        </button>
        <p-button [label]="t('登出')" icon="pi pi-sign-out" severity="secondary"
          [outlined]="true" size="small" (onClick)="logout()" />
      </div>
    </header>
    <main><router-outlet /></main>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: #f8fafc; font-family: 'Noto Sans TC', sans-serif; }
    .bar { height: 56px; display: flex; align-items: center; gap: 24px;
      padding: 0 24px; background: #fff; border-bottom: 1px solid #e2e8f0;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .04); }
    .brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: #0f172a;
      text-decoration: none; font-size: 15px; }
    .brand .pi { color: #2563eb; font-size: 18px; }
    .nav { display: flex; align-items: center; gap: 4px; }
    .nav a { color: #475569; text-decoration: none; font-size: 14px; padding: 6px 12px; border-radius: 8px;
      transition: background .12s, color .12s; }
    .nav a:hover { background: #f1f5f9; color: #0f172a; }
    .nav a.active { background: #eff6ff; color: #1d4ed8; font-weight: 500; }
    .right { display: flex; align-items: center; gap: 12px; margin-left: auto; }
    .who { color: #0f172a; font-size: 14px; font-weight: 500; }
    .lang { border: 1px solid #e2e8f0; background: #fff; color: #475569; font-size: 12.5px;
      padding: 5px 10px; border-radius: 8px; cursor: pointer; }
    .lang:hover { background: #f1f5f9; color: #0f172a; }
    main { max-width: 760px; margin: 0 auto; padding: 28px 16px; }
  `,
})
export class ConsoleShellComponent {
  protected readonly t = t;
  protected readonly lang = currentLang();
  auth = inject(AuthService);
  private router = inject(Router);

  toggleLang() {
    setLang(this.lang === 'en' ? 'zh-TW' : 'en');
  }

  async logout() {
    await this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
