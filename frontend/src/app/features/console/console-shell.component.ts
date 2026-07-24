import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

/** 控制台外殼：頂列（品牌 / 使用者 / 改密碼 / 登出）＋內容 router-outlet。 */
@Component({
  selector: 'app-console-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink],
  template: `
    <header class="bar">
      <a class="brand" routerLink="/">PDF 樣板控制台</a>
      <div class="right">
        @if (auth.user(); as u) {
          <span class="who">{{ u.username }}<span class="role" [class.admin]="u.role === 'admin'">{{ u.role === 'admin' ? '管理員' : '使用者' }}</span></span>
        }
        @if (auth.isAdmin()) { <a routerLink="/users">使用者管理</a> }
        <a routerLink="/account/password">修改密碼</a>
        <button (click)="logout()">登出</button>
      </div>
    </header>
    <main><router-outlet /></main>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: #f8fafc; font-family: 'Noto Sans TC', sans-serif; }
    .bar { height: 52px; display: flex; align-items: center; justify-content: space-between;
      padding: 0 20px; background: #fff; border-bottom: 1px solid #e2e8f0; }
    .brand { font-weight: 700; color: #0f172a; text-decoration: none; font-size: 15px; }
    .right { display: flex; align-items: center; gap: 14px; font-size: 13px; }
    .who { color: #475569; display: inline-flex; align-items: center; gap: 6px; }
    .role { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #e2e8f0; color: #475569; }
    .role.admin { background: #dbeafe; color: #1d4ed8; }
    .right a { color: #2563eb; text-decoration: none; }
    .right a:hover { text-decoration: underline; }
    button { background: none; border: 1px solid #cbd5e1; border-radius: 7px; padding: 5px 12px;
      cursor: pointer; color: #475569; font-size: 13px; }
    button:hover { background: #f1f5f9; }
    main { max-width: 760px; margin: 0 auto; padding: 28px 16px; }
  `,
})
export class ConsoleShellComponent {
  auth = inject(AuthService);
  private router = inject(Router);

  async logout() {
    await this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
