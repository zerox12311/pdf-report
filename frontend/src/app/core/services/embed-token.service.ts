import { Injectable, signal } from '@angular/core';

/**
 * 嵌入 token：iframe 情境下由宿主前端透過 postMessage 交進來，
 * 之後所有 /api 呼叫由 interceptor 掛上 Authorization: Bearer。
 * 非嵌入（控制台）時為 null，走 session cookie。
 */
@Injectable({ providedIn: 'root' })
export class EmbedTokenService {
  readonly token = signal<string | null>(null);
}
