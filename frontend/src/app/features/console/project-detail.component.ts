import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { BreadcrumbModule } from 'primeng/breadcrumb';

import { TemplateSummary } from '../../core/models/template.model';
import { AuthService } from '../../core/services/auth.service';
import { ModalService } from '../../core/services/modal.service';
import { TemplateApiService } from '../../core/services/template-api.service';

@Component({
  selector: 'app-project-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, BreadcrumbModule],
  template: `
    <p-breadcrumb [home]="home" [model]="crumbs()" />
    <div class="head">
      <h1>{{ projectName() || '專案樣板' }}</h1>
      <div class="head-actions">
        @if (auth.isAdmin()) {
          <a class="settings" [routerLink]="['/projects', projectId, 'settings']">⚙ 專案設定</a>
        }
        <a class="new" routerLink="/editor/new" [queryParams]="{ project: projectId }">＋ 新增樣板</a>
      </div>
    </div>
    @if (error()) { <div class="err">{{ error() }}</div> }
    @if (loading()) {
      <div class="hint">載入中…</div>
    } @else if (templates().length === 0) {
      <div class="hint">這個專案還沒有樣板，點右上角「新增樣板」開始。</div>
    } @else {
      <ul>
        @for (t of templates(); track t.id) {
          <li>
            <a class="tpl" [routerLink]="['/editor', t.id]">
              <span class="name">{{ t.name }}</span>
              <span class="time">{{ t.updatedAt | date: 'yyyy/MM/dd HH:mm' }}</span>
            </a>
            <button class="del" (click)="remove(t)">刪除</button>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    p-breadcrumb { display: block; margin-bottom: 14px; }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 12px; }
    h1 { font-size: 22px; margin: 0; }
    .head-actions { display: flex; align-items: center; gap: 8px; }
    .new { background: #2563eb; color: #fff; text-decoration: none; padding: 8px 16px; border-radius: 8px;
      border: none; font-family: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
      display: inline-flex; align-items: center; }
    .new:hover { background: #1d4ed8; }
    .settings { color: #475569; text-decoration: none; padding: 8px 14px; border-radius: 8px;
      border: 1px solid #cbd5e1; font-size: 14px; display: inline-flex; align-items: center; background: #fff; }
    .settings:hover { background: #f1f5f9; border-color: #94a3b8; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    li { display: flex; align-items: center; gap: 8px; }
    .tpl { flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;
      border: 1px solid #e2e8f0; border-radius: 10px; text-decoration: none; color: inherit; background: #fff; }
    .tpl:hover { border-color: #2563eb; box-shadow: 0 1px 6px rgba(37, 99, 235, .15); }
    .name { font-weight: 600; }
    .time { color: #94a3b8; font-size: 12px; }
    .del { background: none; border: 1px solid #fecaca; color: #dc2626; border-radius: 8px; padding: 6px 12px;
      cursor: pointer; font-family: inherit; font-size: 13px; }
    .del:hover { background: #fef2f2; }
    .hint { color: #94a3b8; text-align: center; padding: 48px 0; }
    .err { color: #dc2626; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
      padding: 8px 12px; margin-bottom: 12px; font-size: 13px; }
  `,
})
export class ProjectDetailComponent {
  private api = inject(TemplateApiService);
  private modal = inject(ModalService);
  private route = inject(ActivatedRoute);
  auth = inject(AuthService);

  projectId = this.route.snapshot.paramMap.get('id') ?? '';
  projectName = signal('');
  templates = signal<TemplateSummary[]>([]);
  loading = signal(true);
  error = signal('');

  readonly home: MenuItem = { icon: 'pi pi-home', routerLink: '/' };
  readonly crumbs = computed<MenuItem[]>(() => [{ label: this.projectName() || '…' }]);

  constructor() {
    void this.loadName();
    this.refresh();
  }

  private async loadName() {
    try {
      const p = (await this.api.listProjects()).find(x => x.id === this.projectId);
      if (p) this.projectName.set(p.name);
    } catch {
      /* 名稱只是裝飾，失敗不擋清單 */
    }
  }

  async refresh() {
    this.loading.set(true);
    try {
      this.templates.set(await this.api.listProjectTemplates(this.projectId));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }

  async remove(t: TemplateSummary) {
    const ok = await this.modal.confirm({
      title: '刪除樣板',
      message: `確定刪除「${t.name}」？`,
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(t.id);
    } catch (e) {
      this.error.set('刪除失敗：' + (e instanceof Error ? e.message : e));
    }
    this.refresh();
  }
}
