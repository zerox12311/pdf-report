import { Injectable } from '@angular/core';

/** postMessage 事件型別——宿主系統整合契約（見 docs/embed.md） */
export type HostEventType = 'editor-ready' | 'template-loaded' | 'template-saved';

export interface HostMessage {
  source: typeof HOST_MESSAGE_SOURCE;
  type: HostEventType;
  id: string | null;
}

export const HOST_MESSAGE_SOURCE = 'pdf-template-editor' as const;

/**
 * iframe 嵌入整合：把編輯器事件用 postMessage 通知宿主頁面。
 * 非嵌入（頂層視窗）時所有呼叫皆為 no-op。
 * targetOrigin 目前為 '*'（宿主未知）；正式佈署可在此收斂白名單。
 */
@Injectable({ providedIn: 'root' })
export class HostBridgeService {
  notify(type: HostEventType, id: string | null): void {
    if (window.parent === window) return;
    const msg: HostMessage = { source: HOST_MESSAGE_SOURCE, type, id };
    window.parent.postMessage(msg, '*');
  }
}
