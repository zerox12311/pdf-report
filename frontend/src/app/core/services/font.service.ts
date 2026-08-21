import { Injectable, signal } from '@angular/core';

import { t } from '../i18n/i18n';
import { FONT_FAMILIES, TemplateDoc, TemplateElement } from '../models/template.model';

export interface UserFont {
  id: string;
  name: string;
}

/**
 * 使用者匯入字型：清單、上傳、畫布預覽用的 FontFace 載入。
 * FontFace 以字型 id 為 family 名（對應 fontCss 的產出）；正式輸出由後端引擎渲染。
 */
@Injectable({ providedIn: 'root' })
export class FontService {
  readonly fonts = signal<UserFont[]>([]);
  private loadedFaces = new Set<string>();

  async refresh(): Promise<void> {
    try {
      const res = await fetch('/api/fonts');
      if (res.ok) this.fonts.set((await res.json()) ?? []);
    } catch {
      // 離線/後端未起：字型清單留空，不擋編輯
    }
  }

  async upload(file: File): Promise<UserFont> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', file.name.replace(/\.(ttf|otf)$/i, ''));
    const res = await fetch('/api/fonts', { method: 'POST', body: fd });
    if (!res.ok) {
      let msg = t('字型上傳失敗');
      try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
      throw new Error(msg);
    }
    const info: UserFont = await res.json();
    await this.refresh();
    await this.ensureFace(info.id);
    return info;
  }

  /** 載入 FontFace 讓畫布預覽用（重複呼叫免費） */
  async ensureFace(id: string): Promise<void> {
    if (this.loadedFaces.has(id)) return;
    this.loadedFaces.add(id);
    try {
      const face = new FontFace(id, `url(/api/fonts/${id})`);
      await face.load();
      document.fonts.add(face);
    } catch {
      // 載入失敗：畫布 fallback 黑體（fontCss 已含 fallback）
    }
  }

  /** 掃樣板中用到的匯入字型並預載 FontFace */
  ensureForDoc(doc: TemplateDoc): void {
    const builtin = new Set(FONT_FAMILIES.map(f => f.value as string));
    const visit = (els: TemplateElement[]) => {
      for (const el of els) {
        const fam = (el as { fontFamily?: string }).fontFamily;
        if (fam && !builtin.has(fam)) void this.ensureFace(fam);
        if (el.type === 'container') visit(el.children);
      }
    };
    for (const s of doc.sections) visit(s.elements);
  }
}
