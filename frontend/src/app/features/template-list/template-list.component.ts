import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TemplateSummary } from '../../core/models/template.model';
import { TemplateApiService } from '../../core/services/template-api.service';

@Component({
  selector: 'app-template-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe],
  template: `
    <div class="page">
      <header>
        <h1>PDF 樣板編輯器</h1>
        <a class="new" routerLink="/editor/new">＋ 新增樣板</a>
      </header>
      @if (loading()) {
        <div class="hint">載入中…</div>
      } @else if (templates().length === 0) {
        <div class="hint">還沒有樣板，點右上角「新增樣板」開始。</div>
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
    </div>
  `,
  styles: `
    .page { max-width: 720px; margin: 0 auto; padding: 32px 16px; font-family: 'Noto Sans TC', sans-serif; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
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
  `,
})
export class TemplateListComponent {
  private api = inject(TemplateApiService);
  templates = signal<TemplateSummary[]>([]);
  loading = signal(true);

  constructor() {
    this.refresh();
  }

  async refresh() {
    try {
      this.templates.set(await this.api.list());
    } catch (e) {
      console.error('載入樣板清單失敗', e);
    } finally {
      this.loading.set(false);
    }
  }

  async remove(t: TemplateSummary) {
    if (!confirm(`確定刪除「${t.name}」？`)) return;
    try {
      await this.api.delete(t.id);
    } catch (e) {
      alert('刪除失敗：' + (e instanceof Error ? e.message : e));
    }
    this.refresh();
  }
}
