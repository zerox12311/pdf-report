import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TemplateDoc, TemplateSummary, ValidationSpec } from '../models/template.model';

/** POST /api/validate 的回應：ok=通過；errors 帶出錯位置與規則 */
export interface ValidationResult {
  ok: boolean;
  errors: { path: string; rule: 'required' | 'type'; message: string }[];
}

/** 控制台專案摘要 */
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
}

/** 控制台使用者（管理畫面用；含指派的專案 id） */
export interface ConsoleUserView {
  id: string;
  username: string;
  role: 'admin' | 'user';
  projectIds: string[];
}

/** 建立使用者的輸入 */
export interface CreateUserInput {
  username: string;
  password: string;
  role: 'admin' | 'user';
  projectIds: string[];
}

/** 更新使用者（帶哪個欄位就改哪個） */
export interface UpdateUserInput {
  role?: 'admin' | 'user';
  password?: string;
  projectIds?: string[];
}

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

  /** 建立樣板；projectId 有值時歸入該專案（控制台在專案內新建用），否則落預設專案。 */
  create(doc: TemplateDoc, projectId?: string): Promise<TemplateDoc> {
    const url = projectId ? `/api/templates?projectId=${encodeURIComponent(projectId)}` : '/api/templates';
    return this.run(firstValueFrom(this.http.post<TemplateDoc>(url, doc)));
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

  /** 測試 schema：拿當前（可能未存）規則 + data 驗證，不渲染（與 render 守門同一權威）。 */
  validate(validation: ValidationSpec, data: unknown): Promise<ValidationResult> {
    return this.run(firstValueFrom(
      this.http.post<ValidationResult>('/api/validate', { validation, data }),
    ));
  }

  // ---------- 控制台專案 ----------

  listProjects(): Promise<ProjectSummary[]> {
    return this.run(firstValueFrom(this.http.get<ProjectSummary[]>('/api/projects')));
  }

  createProject(name: string): Promise<ProjectSummary> {
    return this.run(firstValueFrom(this.http.post<ProjectSummary>('/api/projects', { name })));
  }

  deleteProject(id: string): Promise<void> {
    return this.run(firstValueFrom(this.http.delete<void>(`/api/projects/${id}`)));
  }

  listProjectTemplates(projectId: string): Promise<TemplateSummary[]> {
    return this.run(firstValueFrom(
      this.http.get<TemplateSummary[]>(`/api/projects/${projectId}/templates`),
    ));
  }

  // ---------- 使用者管理（admin） ----------

  listUsers(): Promise<ConsoleUserView[]> {
    return this.run(firstValueFrom(this.http.get<ConsoleUserView[]>('/api/users')));
  }

  createUser(input: CreateUserInput): Promise<ConsoleUserView> {
    return this.run(firstValueFrom(this.http.post<ConsoleUserView>('/api/users', input)));
  }

  updateUser(id: string, input: UpdateUserInput): Promise<void> {
    return this.run(firstValueFrom(this.http.patch<void>(`/api/users/${id}`, input)));
  }

  deleteUser(id: string): Promise<void> {
    return this.run(firstValueFrom(this.http.delete<void>(`/api/users/${id}`)));
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
