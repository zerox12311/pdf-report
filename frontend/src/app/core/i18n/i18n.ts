import { EN } from './en';

/**
 * 輕量 runtime i18n（gettext 風格）：以中文原文當 key，英文查 EN 字典、查不到退回中文。
 * 不走 DI（EditorStateService 等必須可直接 new）；切換語言後整頁 reload，
 * 因此 t() 不需要反應性，模組常數（如 ELEMENT_META 的 label）也能安全使用。
 * 語言來源優先序：?lang= 網址參數（嵌入宿主可控，不寫入 localStorage）→ localStorage → 預設 zh-TW。
 */
export type Lang = 'zh-TW' | 'en';

const STORAGE_KEY = 'pdftpl.lang';

function detectLang(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q) return q.toLowerCase().startsWith('en') ? 'en' : 'zh-TW';
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh-TW') return saved;
  } catch {
    /* SSR／測試環境沒有 location/localStorage 時退回預設 */
  }
  return 'zh-TW';
}

let current: Lang = detectLang();

export function currentLang(): Lang {
  return current;
}

/** 切換語言：寫入 localStorage 後 reload（?lang= 參數會蓋過選擇，切換時順手移除）。 */
export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    location.href = url.toString();
  } catch {
    current = lang; // 測試環境：直接切，不 reload
  }
}

/** 測試用：不經 localStorage/reload 直接切換語言。 */
export function forceLang(lang: Lang): void {
  current = lang;
}

/** 翻譯：zh 為原文 key；params 以 {name} 佔位符代入。 */
export function t(zh: string, params?: Record<string, string | number>): string {
  let s = current === 'en' ? (EN[zh] ?? zh) : zh;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}
