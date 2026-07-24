import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

/**
 * 控制台路由守衛：未登入 → 轉 /login。
 * 只掛在控制台路由（專案 / 改密碼等）；**絕不可**掛到 /editor/*——
 * iframe 嵌入開編輯器沒有 session，掛了會被轉登入、嵌入即壞。
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.me();
  return user ? true : router.parseUrl('/login');
};

/**
 * 登入頁守衛：已登入就直接轉進控制台（不顯示登入表單、不閃一下）。
 * 掛在 /login。
 */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.me();
  return user ? router.parseUrl('/') : true;
};

/**
 * admin 專屬守衛：未登入 → /login；已登入但非 admin → 轉回控制台首頁。
 * 掛在 /users。
 */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.me();
  if (!user) return router.parseUrl('/login');
  return user.role === 'admin' ? true : router.parseUrl('/');
};
