import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MenuItem } from 'primeng/api';
import { BreadcrumbModule } from 'primeng/breadcrumb';
import { MultiSelect } from 'primeng/multiselect';

import { AuthService } from '../../core/services/auth.service';
import { ModalService } from '../../core/services/modal.service';
import {
  ConsoleUserView,
  ProjectSummary,
  TemplateApiService,
} from '../../core/services/template-api.service';

@Component({
  selector: 'app-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MultiSelect, BreadcrumbModule],
  template: `
    <p-breadcrumb [home]="home" [model]="crumbs" />
    <h1>使用者管理</h1>
    @if (error()) { <div class="err">{{ error() }}</div> }

    <!-- 建立 -->
    <form class="card create" (ngSubmit)="create()">
      <h2>建立使用者</h2>
      <div class="row">
        <input name="u" [(ngModel)]="newUsername" placeholder="帳號" autocomplete="off" />
        <input name="p" type="password" [(ngModel)]="newPassword" placeholder="密碼" autocomplete="new-password" />
        <select name="r" [(ngModel)]="newRole">
          <option value="user">使用者</option>
          <option value="admin">管理員</option>
        </select>
        <button type="submit" [disabled]="busy() || !newUsername.trim() || !newPassword">建立</button>
      </div>
      @if (newRole === 'user') {
        <div class="proj-pick">
          <span class="lbl">可存取專案：</span>
          <p-multiselect
            name="np"
            [options]="projects()"
            optionLabel="name"
            optionValue="id"
            [(ngModel)]="newProjectIds"
            [filter]="true"
            display="chip"
            [showToggleAll]="true"
            [showClear]="true"
            placeholder="選擇專案（可搜尋）"
            emptyMessage="尚無專案"
            [style]="{ minWidth: '260px', maxWidth: '520px' }"
            appendTo="body" />
        </div>
      }
    </form>

    <!-- 清單 -->
    @if (loading()) {
      <div class="hint">載入中…</div>
    } @else {
      <ul>
        @for (u of users(); track u.id) {
          <li class="card">
            <div class="row head">
              <span class="uname">{{ u.username }}</span>
              <select [ngModel]="u.role" (ngModelChange)="changeRole(u, $event)" [disabled]="u.id === selfId()">
                <option value="user">使用者</option>
                <option value="admin">管理員</option>
              </select>
              <button class="pw" (click)="resetPassword(u)">重設密碼</button>
              <button class="del" (click)="remove(u)" [disabled]="u.id === selfId()">刪除</button>
            </div>
            @if (u.role === 'user') {
              <div class="proj-pick">
                <span class="lbl">可存取專案：</span>
                <p-multiselect
                  [options]="projects()"
                  optionLabel="name"
                  optionValue="id"
                  [ngModel]="u.projectIds"
                  [ngModelOptions]="{ standalone: true }"
                  (onChange)="patchMembers(u, $event.value)"
                  [filter]="true"
                  display="chip"
                  [showToggleAll]="true"
                  [showClear]="true"
                  placeholder="選擇專案（可搜尋）"
                  emptyMessage="尚無專案"
                  [style]="{ minWidth: '260px', maxWidth: '520px' }"
                  appendTo="body" />
              </div>
            } @else {
              <div class="proj-pick muted">管理員可存取所有專案</div>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    p-breadcrumb { display: block; margin-bottom: 14px; }
    h1 { font-size: 22px; margin: 0 0 16px; }
    h2 { font-size: 15px; margin: 0 0 12px; }
    ul { list-style: none; margin: 0; padding: 0; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
    .create { border-color: #cbd5e1; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    input[type=text], input:not([type]), input[type=password], select {
      padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; }
    .head .uname { font-weight: 600; flex: 1; }
    button { border-radius: 8px; padding: 8px 12px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; font-size: 13px; }
    .create button[type=submit] { background: #2563eb; color: #fff; border: none; }
    button:disabled { opacity: .5; cursor: default; }
    .pw { color: #475569; }
    .del { color: #dc2626; border-color: #fecaca; }
    .del:hover:not(:disabled) { background: #fef2f2; }
    .proj-pick { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px;
      padding-top: 12px; border-top: 1px solid #f1f5f9; font-size: 13px; }
    .proj-pick .lbl { color: #475569; white-space: nowrap; }
    .muted { color: #94a3b8; }
    .hint { color: #94a3b8; text-align: center; padding: 40px 0; }
    .err { color: #dc2626; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
      padding: 8px 12px; margin-bottom: 12px; font-size: 13px; }
  `,
})
export class UsersComponent {
  private api = inject(TemplateApiService);
  private auth = inject(AuthService);
  private modal = inject(ModalService);

  readonly home: MenuItem = { icon: 'pi pi-home', routerLink: '/' };
  readonly crumbs: MenuItem[] = [{ label: '使用者管理' }];

  users = signal<ConsoleUserView[]>([]);
  projects = signal<ProjectSummary[]>([]);
  loading = signal(true);
  busy = signal(false);
  error = signal('');

  // 建立表單
  newUsername = '';
  newPassword = '';
  newRole: 'admin' | 'user' = 'user';
  newProjectIds: string[] = [];

  selfId = signal(''); // 自己（不能改自己的角色 / 刪自己）

  constructor() {
    void this.load();
  }


  private async load() {
    this.loading.set(true);
    try {
      const [users, projects] = await Promise.all([this.api.listUsers(), this.api.listProjects()]);
      this.users.set(users);
      this.projects.set(projects);
      const me = this.auth.user()?.username;
      this.selfId.set(users.find(u => u.username === me)?.id ?? '');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }

  async create() {
    if (this.busy() || !this.newUsername.trim() || !this.newPassword) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.createUser({
        username: this.newUsername.trim(),
        password: this.newPassword,
        role: this.newRole,
        projectIds: this.newRole === 'user' ? this.newProjectIds : [],
      });
      this.newUsername = '';
      this.newPassword = '';
      this.newRole = 'user';
      this.newProjectIds = [];
      await this.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }

  async changeRole(u: ConsoleUserView, role: 'admin' | 'user') {
    if (role === u.role) return;
    await this.patch(u.id, { role });
  }

  /** MultiSelect onChange → 以完整選取集覆寫成員資格。 */
  async patchMembers(u: ConsoleUserView, projectIds: string[]) {
    await this.patch(u.id, { projectIds });
  }

  async resetPassword(u: ConsoleUserView) {
    const pw = await this.modal.prompt({
      title: `重設「${u.username}」的密碼`,
      placeholder: '新密碼（至少 4 字元）',
      password: true,
      minLength: 4,
      confirmLabel: '更新',
    });
    if (pw == null) return;
    this.error.set('');
    try {
      await this.api.updateUser(u.id, { password: pw });
      await this.load();
      await this.modal.alert({ title: '密碼已重設', message: `已更新「${u.username}」的密碼。` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error.set(msg);
      await this.load();
      await this.modal.alert({ title: '重設失敗', message: `無法更新「${u.username}」的密碼：${msg}` });
    }
  }

  async remove(u: ConsoleUserView) {
    const ok = await this.modal.confirm({
      title: '刪除使用者',
      message: `確定刪除使用者「${u.username}」？`,
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;
    this.error.set('');
    try {
      await this.api.deleteUser(u.id);
      await this.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  private async patch(id: string, input: Parameters<TemplateApiService['updateUser']>[1]) {
    this.error.set('');
    try {
      await this.api.updateUser(id, input);
      await this.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      await this.load(); // 還原 UI 狀態
    }
  }
}
