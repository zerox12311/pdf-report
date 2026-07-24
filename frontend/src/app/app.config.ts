import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { embedTokenInterceptor } from './core/interceptors/embed-token.interceptor';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';

// 客製主題：麵包屑拿掉預設白底卡片外觀，融入頁面背景（用 design token，非硬蓋）。
const AppPreset = definePreset(Aura, {
  components: {
    breadcrumb: {
      root: {
        background: 'transparent',
        padding: '0',
      },
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([embedTokenInterceptor])),
    provideAnimationsAsync(),
    providePrimeNG({ theme: { preset: AppPreset, options: { darkModeSelector: false } } }),
  ],
};
