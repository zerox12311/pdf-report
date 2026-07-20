import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TemplateDoc, TemplateSummary } from '../models/template.model';

/**
 * 樣板/圖片 API。所有方法失敗時 reject 一個訊息已正規化的 Error：
 * 優先取後端 `{ error: string }` 的訊息（含 PDF blob 回應的錯誤分支），呼叫端直接顯示 e.message 即可。
 */
@Injectable({ providedIn: 'root' })
export class TemplateApiService {
  private http = inject(HttpClient);

  list(): Promise<TemplateSummary[]> {
    return this.run(firstValueFrom(this.http.get<TemplateSummary[]>('/api/templates')));
  }

  get(id: string): Promise<TemplateDoc> {
    return this.run(firstValueFrom(this.http.get<TemplateDoc>(`/api/templates/${id}`)));
  }

  create(doc: TemplateDoc): Promise<TemplateDoc> {
    return this.run(firstValueFrom(this.http.post<TemplateDoc>('/api/templates', doc)));
  }

  update(doc: TemplateDoc): Promise<TemplateDoc> {
    return this.run(firstValueFrom(this.http.put<TemplateDoc>(`/api/templates/${doc.id}`, doc)));
  }

  delete(id: string): Promise<void> {
    return this.run(firstValueFrom(this.http.delete<void>(`/api/templates/${id}`)));
  }

  /** 後端渲染（未儲存的樣板也可直接送渲染，編輯器預覽用）。 */
  renderAdhoc(template: TemplateDoc, data: unknown): Promise<Blob> {
    return this.run(firstValueFrom(
      this.http.post('/api/templates/render', { template, data }, { responseType: 'blob' }),
    ));
  }

  uploadAsset(file: File): Promise<{ id: string }> {
    const form = new FormData();
    form.append('file', file);
    return this.run(firstValueFrom(this.http.post<{ id: string }>('/api/assets', form)));
  }

  /** 統一錯誤通道：HttpErrorResponse → Error(後端訊息)。 */
  private async run<T>(p: Promise<T>): Promise<T> {
    try {
      return await p;
    } catch (e) {
      throw new Error(await extractErrorMessage(e));
    }
  }
}

/** 從 HttpErrorResponse 取出後端 `{ error }` 訊息；blob 回應（渲染 API）需先讀出文字。 */
async function extractErrorMessage(e: unknown): Promise<string> {
  if (e instanceof HttpErrorResponse) {
    let payload: unknown = e.error;
    if (payload instanceof Blob) {
      try {
        payload = JSON.parse(await payload.text());
      } catch {
        payload = null;
      }
    }
    const msg = (payload as { error?: string } | null)?.error;
    if (msg) return msg;
    return e.status > 0 ? `伺服器回應 ${e.status}` : '無法連線到伺服器';
  }
  return e instanceof Error ? e.message : String(e);
}
