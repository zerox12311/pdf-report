import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TemplateSummary } from '../../core/models/template.model';
import { ModalService } from '../../core/services/modal.service';
import { TemplateApiService } from '../../core/services/template-api.service';

@Component({
  selector: 'app-project-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe],
  template: `
    <div class="crumbs"><a routerLink="/">專案</a> ／ {{ projectName() || '…' }}</div>
    <div class="head">
      <h1>{{ projectName() || '專案樣板' }}</h1>
      <a class="new" routerLink="/editor/new" [queryParams]="{ project: projectId }">＋ 新增樣板</a>
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
    .crumbs { font-size: 13px; color: #94a3b8; margin-bottom: 10px; }
    .crumbs a { color: #2563eb; text-decoration: none; }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    h1 { font-size: 22px; margin: 0; }
    .new { background: #2563eb; color: #fff; text-decoration: none; padding: 8px 16px; border-radius: 8px; }
    .new:hover { background: #1d4ed8; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    li { display: flex; align-items: center; gap: 8px; }
    .tpl { flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;
      border: 1px solid #e2e8f0; border-radius: 10px; text-decoration: none; color: inherit; background: #fff; }
    .tpl:hover { border-color: #2563eb; box-shadow: 0 1px 6px rgba(37, 99, 235, .15); }
    .name { font-weight: 600; }
    .time { color: #94a3b8; font-size: 12px; }
    .del { background: none; border: 1px solid #fecaca; color: #dc2626; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
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

  projectId = this.route.snapshot.paramMap.get('id') ?? '';
  projectName = signal('');
  templates = signal<TemplateSummary[]>([]);
  loading = signal(true);
  error = signal('');

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
