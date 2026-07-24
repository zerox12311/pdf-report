import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { EmbedTokenService } from '../services/embed-token.service';

/**
 * 有嵌入 token 時，對 /api 請求掛 Authorization: Bearer。
 * 控制台（無 token）不動，走 session cookie。
 */
export const embedTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(EmbedTokenService).token();
  if (token && req.url.startsWith('/api/')) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
