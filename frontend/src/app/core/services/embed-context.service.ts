import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** 後端 GET /api/embed/context 的回應：目前憑證的嵌入模式與能力。 */
export interface EmbedContext {
  kind: 'user' | 'apikey' | 'embed' | '';
  mode: 'design' | 'fill' | 'view';
  templateId: string;
  capabilities: { editLayout: boolean; editValues: boolean; upload: boolean };
}

const DESIGN_CONTEXT: EmbedContext = {
  kind: '', mode: 'design', templateId: '',
  capabilities: { editLayout: true, editValues: true, upload: true },
};

/**
 * 嵌入模式與能力。**能力來源是後端**（與後端強制讀同一份解析結果），
 * 前端只據此畫 UI——隱藏 UI 只是體驗，真正的擋在後端 capability/窄 API。
 */
@Injectable({ providedIn: 'root' })
export class EmbedContextService {
  private http = inject(HttpClient);

  readonly context = signal<EmbedContext>(DESIGN_CONTEXT);

  /** 版面可編輯（拖曳/縮放/新增/刪除元件、改樣式）；fill/view 為 false。 */
  readonly canEditLayout = computed(() => this.context().capabilities.editLayout);
  /** 可改被標記 fillable 的內容值；view 為 false。 */
  readonly canEditValues = computed(() => this.context().capabilities.editValues);
  /** 填寫模式：只能改可填欄位。 */
  readonly fillMode = computed(() => this.context().mode === 'fill');
  /** 唯讀模式。 */
  readonly viewMode = computed(() => this.context().mode === 'view');
  /** 受限模式（非完整設計）：fill 或 view。 */
  readonly restricted = computed(() => this.context().mode !== 'design');

  /** 載入目前憑證的能力；失敗時保守退回 design（後端仍會擋，前端不會誤鎖死畫面）。 */
  async refresh(): Promise<EmbedContext> {
    try {
      const ctx = await firstValueFrom(this.http.get<EmbedContext>('/api/embed/context'));
      this.context.set({ ...DESIGN_CONTEXT, ...ctx, capabilities: { ...DESIGN_CONTEXT.capabilities, ...ctx.capabilities } });
    } catch {
      this.context.set(DESIGN_CONTEXT);
    }
    return this.context();
  }
}
