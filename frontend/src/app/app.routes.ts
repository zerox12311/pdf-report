import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/template-list/template-list.component').then(m => m.TemplateListComponent),
  },
  {
    path: 'editor/:id',
    loadComponent: () =>
      import('./features/editor/editor-page.component').then(m => m.EditorPageComponent),
  },
  { path: '**', redirectTo: '' },
];
