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
 * 編輯器路由守衛（/editor/*）：
 * - **iframe 嵌入**（`window.parent !== window`）或 **URL 帶 embed token**（`#token=`）→ 直接放行：
 *   宿主的使用者沒有控制台 session，改由 embed token 授權；後端每個 API 仍鎖著（沒有
 *   有效 token → 401 → 編輯器顯示空樣板），故放行不外洩資料。
 * - **非嵌入且無 token**（直接開分頁）→ 比照控制台，需 session，否則轉 /login。
 */
export const editorGuard: CanActivateFn = async () => {
  const embedded = window.parent !== window;
  const hasUrlToken = /(?:^|&)token=/.test(window.location.hash.replace(/^#/, ''));
  if (embedded || hasUrlToken) return true;
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
