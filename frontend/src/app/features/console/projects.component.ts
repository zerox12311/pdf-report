import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { ModalService } from '../../core/services/modal.service';
import { ProjectSummary, TemplateApiService } from '../../core/services/template-api.service';

@Component({
  selector: 'app-projects',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, FormsModule],
  template: `
    <div class="head">
      <h1>專案</h1>
      @if (auth.isAdmin()) {
        <form class="new" (ngSubmit)="add()">
          <input name="name" [(ngModel)]="newName" placeholder="新專案名稱" />
          <button type="submit" [disabled]="busy() || !newName.trim()">＋ 建立</button>
        </form>
      }
    </div>
    @if (error()) { <div class="err">{{ error() }}</div> }
    @if (loading()) {
      <div class="hint">載入中…</div>
    } @else if (projects().length === 0) {
      <div class="hint">{{ auth.isAdmin() ? '還沒有專案，在上方建立一個開始。' : '你還沒有被指派任何專案，請聯絡管理員。' }}</div>
    } @else {
      <ul>
        @for (p of projects(); track p.id) {
          <li>
            <a [routerLink]="['/projects', p.id]">
              <span class="name">{{ p.name }}</span>
              <span class="time">{{ p.createdAt | date: 'yyyy/MM/dd' }}</span>
            </a>
            @if (auth.isAdmin() && p.id !== 'default') {
              <button class="del" (click)="remove(p)">刪除</button>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 12px; }
    h1 { font-size: 22px; margin: 0; }
    .new { display: flex; gap: 8px; }
    .new input { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; }
    .new button { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
    .new button:disabled { opacity: .5; cursor: default; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    li { display: flex; align-items: center; gap: 8px; }
    li a { flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 14px 16px;
      border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; text-decoration: none; color: inherit; }
    li a:hover { border-color: #2563eb; box-shadow: 0 1px 6px rgba(37, 99, 235, .15); }
    .name { font-weight: 600; }
    .time { color: #94a3b8; font-size: 12px; }
    .del { background: none; border: 1px solid #fecaca; color: #dc2626; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
    .del:hover { background: #fef2f2; }
    .hint { color: #94a3b8; text-align: center; padding: 48px 0; }
    .err { color: #dc2626; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
      padding: 8px 12px; margin-bottom: 12px; font-size: 13px; }
  `,
})
export class ProjectsComponent {
  private api = inject(TemplateApiService);
  private modal = inject(ModalService);
  auth = inject(AuthService);
  projects = signal<ProjectSummary[]>([]);
  loading = signal(true);
  busy = signal(false);
  error = signal('');
  newName = '';

  constructor() {
    this.refresh();
  }

  async refresh() {
    this.loading.set(true);
    try {
      this.projects.set(await this.api.listProjects());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }

  async add() {
    const name = this.newName.trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.createProject(name);
      this.newName = '';
      await this.refresh();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(p: ProjectSummary) {
    const ok = await this.modal.confirm({
      title: '刪除專案',
      message: `確定刪除專案「${p.name}」？\n（專案內若有樣板需先清空）`,
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;
    this.error.set('');
    try {
      await this.api.deleteProject(p.id);
      await this.refresh();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
