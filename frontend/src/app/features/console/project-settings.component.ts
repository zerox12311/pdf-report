import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { BreadcrumbModule } from 'primeng/breadcrumb';

import { ModalService } from '../../core/services/modal.service';
import { ApiKeySummary, TemplateApiService } from '../../core/services/template-api.service';

/**
 * 專案設定頁（admin 專屬）：目前放「宿主整合 API 金鑰」。
 * 從專案樣板清單拆出來——樣板是日常內容、金鑰是專案級設定，分開放。
 * 未來專案改名／成員授權等管理功能也歸這頁。
 */
@Component({
  selector: 'app-project-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, BreadcrumbModule],
  template: `
    <p-breadcrumb [home]="home" [model]="crumbs()" />
    <h1>專案設定</h1>
    @if (error()) { <div class="err">{{ error() }}</div> }

    <section class="card">
      <div class="chead">
        <div>
          <h2>專案名稱</h2>
          <p class="khint">顯示在專案清單與麵包屑上。改名不影響已簽發的 API 金鑰與樣板。</p>
        </div>
        <button class="new" (click)="rename()">✎ 改名</button>
      </div>
      <div class="pname">{{ projectName() || '…' }}</div>
    </section>

    <section class="card">
      <div class="chead">
        <div>
          <h2>API 金鑰（宿主整合）</h2>
          <p class="khint">給宿主後端用的 server-to-server 金鑰，綁定此專案：可換取編輯器 embed token、正式渲染。明文只在建立當下顯示一次。</p>
        </div>
        <button class="new" (click)="createKey()">＋ 建立金鑰</button>
      </div>
      @if (keys().length === 0) {
        <div class="empty">尚無金鑰。</div>
      } @else {
        <ul class="klist">
          @for (k of keys(); track k.id) {
            <li>
              <span class="kname">{{ k.name }}</span>
              <span class="time">{{ k.createdAt | date: 'yyyy/MM/dd' }}</span>
              <button class="del" (click)="revokeKey(k)">撤銷</button>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    h1 { font-size: 22px; margin: 0 0 20px; }
    .err { color: #dc2626; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
      padding: 8px 12px; margin-bottom: 12px; font-size: 13px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 22px; }
    .chead { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 4px; }
    h2 { font-size: 16px; margin: 0; }
    .khint { color: #94a3b8; font-size: 12px; margin: 8px 0 0; line-height: 1.5; max-width: 620px; }
    .pname { font-size: 17px; font-weight: 600; color: #0f172a; padding: 4px 0 2px; }
    .new { flex: none; background: #2563eb; color: #fff; border: none; font-family: inherit; font-size: 14px;
      font-weight: 500; padding: 8px 16px; border-radius: 8px; cursor: pointer; white-space: nowrap;
      display: inline-flex; align-items: center; }
    .new:hover { background: #1d4ed8; }
    .empty { color: #94a3b8; text-align: center; padding: 24px 0; font-size: 14px; }
    .klist { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .klist li { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #f8fafc;
      border: 1px solid #e2e8f0; border-radius: 10px; }
    .kname { font-weight: 600; flex: 1; }
    .time { color: #94a3b8; font-size: 12px; }
    .del { background: none; border: 1px solid #fecaca; color: #dc2626; border-radius: 8px; padding: 6px 12px;
      cursor: pointer; font-family: inherit; font-size: 13px; }
    .del:hover { background: #fef2f2; }
  `,
})
export class ProjectSettingsComponent {
  private api = inject(TemplateApiService);
  private modal = inject(ModalService);
  private route = inject(ActivatedRoute);

  projectId = this.route.snapshot.paramMap.get('id') ?? '';
  projectName = signal('');
  keys = signal<ApiKeySummary[]>([]);
  error = signal('');

  readonly home: MenuItem = { icon: 'pi pi-home', routerLink: '/' };
  readonly crumbs = computed<MenuItem[]>(() => [
    { label: this.projectName() || '…', routerLink: ['/projects', this.projectId] },
    { label: '設定' },
  ]);

  constructor() {
    void this.loadName();
    void this.loadKeys();
  }

  private async loadName() {
    try {
      const p = (await this.api.listProjects()).find(x => x.id === this.projectId);
      if (p) this.projectName.set(p.name);
    } catch {
      /* 名稱只是裝飾，失敗不擋設定 */
    }
  }

  private async loadKeys() {
    try {
      this.keys.set(await this.api.listKeys(this.projectId));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  async rename() {
    const name = await this.modal.prompt({
      title: '專案改名',
      message: '輸入新的專案名稱',
      placeholder: '專案名稱',
      initial: this.projectName(),
      confirmLabel: '儲存',
    });
    if (name == null || !name.trim() || name.trim() === this.projectName()) return;
    this.error.set('');
    try {
      const p = await this.api.renameProject(this.projectId, name.trim());
      this.projectName.set(p.name);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  async createKey() {
    const name = await this.modal.prompt({
      title: '建立 API 金鑰',
      message: '給這把金鑰一個名稱（例如：ERP 整合、官網嵌入）',
      placeholder: '名稱',
      confirmLabel: '建立',
    });
    if (name == null) return;
    this.error.set('');
    try {
      const created = await this.api.createKey(this.projectId, name.trim() || 'API 金鑰');
      // 先刷新清單再開明文對話框：放在後面的話，關掉對話框還要等一次網路往返，
      // 這段空窗期畫面仍寫「尚無金鑰」，看起來像建立失敗。
      await this.loadKeys();
      await this.modal.alert({
        title: 'API 金鑰已建立',
        message: '請立即複製並妥善保存——離開後將無法再看到這串明文：',
        copy: created.key,
      });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  async revokeKey(k: ApiKeySummary) {
    const ok = await this.modal.confirm({
      title: '撤銷 API 金鑰',
      message: `撤銷「${k.name}」？使用這把金鑰的宿主整合會立即失效。`,
      confirmLabel: '撤銷',
      danger: true,
    });
    if (!ok) return;
    this.error.set('');
    try {
      await this.api.deleteKey(k.id);
      await this.loadKeys();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
