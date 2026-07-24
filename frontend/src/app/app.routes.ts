import { Routes } from '@angular/router';

import { adminGuard, authGuard, guestGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  // 登入頁：已登入 → 直接轉進控制台（guestGuard）
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/console/login.component').then(m => m.LoginComponent),
  },

  // 控制台外殼（需登入）：專案清單 / 專案內樣板 / 修改密碼
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/console/console-shell.component').then(m => m.ConsoleShellComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/console/projects.component').then(m => m.ProjectsComponent),
      },
      {
        path: 'projects/:id',
        loadComponent: () =>
          import('./features/console/project-detail.component').then(m => m.ProjectDetailComponent),
      },
      {
        path: 'account/password',
        loadComponent: () =>
          import('./features/console/change-password.component').then(m => m.ChangePasswordComponent),
      },
      {
        path: 'users',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/console/users.component').then(m => m.UsersComponent),
      },
    ],
  },

  // 編輯器（**無 guard**）：控制台進來帶 session；iframe 嵌入無 session 也要能開
  {
    path: 'editor/:id',
    loadComponent: () =>
      import('./features/editor/editor-page.component').then(m => m.EditorPageComponent),
  },

  { path: '**', redirectTo: '' },
];
