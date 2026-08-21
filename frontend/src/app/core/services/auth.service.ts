import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { t } from '../i18n/i18n';

/** 角色 */
export type Role = 'admin' | 'user';

/** 控制台登入使用者 */
export interface ConsoleUser {
  username: string;
  role: Role;
}

/**
 * 控制台認證：登入 / 登出 / 目前使用者 / 改密碼。
 * session 走 httpOnly cookie（同源自動帶），前端只保存 username 供顯示與 route guard。
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  /** 目前登入者（null = 未登入）。 */
  readonly user = signal<ConsoleUser | null>(null);

  /** 目前登入者是否為 admin。 */
  readonly isAdmin = computed(() => this.user()?.role === 'admin');

  /** 查目前登入者；未登入（401）回 null 並清空。guard 用。 */
  async me(): Promise<ConsoleUser | null> {
    try {
      const u = await firstValueFrom(this.http.get<ConsoleUser>('/api/auth/me'));
      this.user.set(u);
      return u;
    } catch {
      this.user.set(null);
      return null;
    }
  }

  async login(username: string, password: string): Promise<void> {
    try {
      const u = await firstValueFrom(
        this.http.post<ConsoleUser>('/api/auth/login', { username, password }),
      );
      this.user.set(u);
    } catch (e) {
      throw new Error(errMessage(e));
    }
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } finally {
      this.user.set(null);
    }
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post('/api/auth/change-password', { oldPassword, newPassword }),
      );
    } catch (e) {
      throw new Error(errMessage(e));
    }
  }
}

/** 取後端 { error } 訊息，供 UI 直接顯示。 */
function errMessage(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    const msg = (e.error as { error?: string } | null)?.error;
    if (msg) return msg;
    return e.status > 0 ? t('伺服器回應 {status}', { status: e.status }) : t('無法連線到伺服器');
  }
  return e instanceof Error ? e.message : String(e);
}
