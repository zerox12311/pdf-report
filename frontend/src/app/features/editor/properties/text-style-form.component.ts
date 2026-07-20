import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ElementPatch, FONT_FAMILIES, PlaceholderElement, TextElement,
} from '../../../core/models/template.model';
import { FontService } from '../../../core/services/font.service';
import { EditorStateService } from '../editor-state.service';
import { SliderFieldComponent } from './slider-field.component';

/** 文字/資料欄位共用的樣式表單（原 properties-panel 的 untyped ng-template，改為強型別元件） */
@Component({
  selector: 'app-text-style-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SliderFieldComponent],
  template: `
    @if (el(); as el) {
      <label class="full">字型
        <div class="font-row">
          <select [ngModel]="el.fontFamily ?? 'sans'" (ngModelChange)="patch({ fontFamily: $event })">
            @for (f of fontFamilies; track f.value) { <option [value]="f.value">{{ f.label }}</option> }
            @for (f of fontSvc.fonts(); track f.id) { <option [value]="f.id">{{ f.name }}（匯入）</option> }
          </select>
          <button type="button" class="imp" (click)="fontInput.click()" title="匯入 TTF/OTF 字型">＋</button>
          <input #fontInput type="file" accept=".ttf,.otf" hidden (change)="onFontPicked($event)" />
        </div>
      </label>
      <app-slider-field label="字級（pt）" [min]="6" [max]="96"
        [value]="el.fontSize" (valueChange)="patch({ fontSize: $event })" />
      <app-slider-field label="行高（倍）" [min]="0.8" [max]="3" [step]="0.1"
        [value]="el.lineHeight" (valueChange)="patch({ lineHeight: $event })" />
      <div class="grid2">
        <label>顏色 <input type="color" [ngModel]="el.color" (ngModelChange)="patch({ color: $event })" /></label>
        <label>對齊
          <select [ngModel]="el.align" (ngModelChange)="patch({ align: $event })">
            <option value="left">左</option><option value="center">中</option><option value="right">右</option>
          </select>
        </label>
      </div>
      <label class="row"><input type="checkbox" [ngModel]="el.bold" (ngModelChange)="patch({ bold: $event })" /> 粗體</label>
      <label class="row"><input type="checkbox" [ngModel]="el.autoGrow ?? false" (ngModelChange)="patch({ autoGrow: $event })" /> 內容超出時自動增高（推擠下方元素）</label>
      <div class="sub">外框與底色</div>
      <div class="grid2">
        <label>邊框寬 <input type="number" step="0.5" min="0" [ngModel]="el.borderWidth ?? 0" (ngModelChange)="patch({ borderWidth: num($event) })" /></label>
        <label>邊框色 <input type="color" [ngModel]="el.borderColor ?? '#000000'" (ngModelChange)="patch({ borderColor: $event })" /></label>
        <label>內距 <input type="number" min="0" [ngModel]="el.padding ?? 0" (ngModelChange)="patch({ padding: num($event) })" /></label>
        <label class="row"><input type="checkbox" [ngModel]="el.fillColor != null"
          (ngModelChange)="patch({ fillColor: $event ? '#f8fafc' : null })" /> 底色</label>
      </div>
      @if (el.fillColor != null) {
        <label>底色 <input type="color" [ngModel]="el.fillColor" (ngModelChange)="patch({ fillColor: $event })" /></label>
      }
    }
  `,
  styles: `
    :host { display: contents; }
    label { display: flex; flex-direction: column; gap: 2px; color: #444; font-size: 13px; }
    label.row { flex-direction: row; align-items: center; gap: 6px; }
    input, select { font: inherit; padding: 4px 6px; border: 1px solid #ccc; border-radius: 4px; width: 100%; box-sizing: border-box; }
    input[type='color'] { padding: 0; height: 28px; }
    input[type='checkbox'] { width: auto; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .full { width: 100%; }
    .sub { font-weight: 600; color: #555; margin-top: 4px; font-size: 13px; }
    .font-row { display: flex; gap: 4px; }
    .font-row select { flex: 1; min-width: 0; }
    .imp { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 4px; width: 28px; cursor: pointer;
      color: #1d4ed8; font-size: 14px; flex-shrink: 0; }
    .imp:hover { background: #eff6ff; }
  `,
})
export class TextStyleFormComponent {
  private state = inject(EditorStateService);
  fontSvc = inject(FontService);
  el = input.required<TextElement | PlaceholderElement>();
  fontFamilies = FONT_FAMILIES;

  async onFontPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const info = await this.fontSvc.upload(file);
      this.patch({ fontFamily: info.id });
    } catch (e) {
      alert(e instanceof Error ? e.message : '字型上傳失敗');
    }
  }

  num(v: unknown): number {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return isNaN(n) ? 0 : n;
  }

  patch(patch: ElementPatch) {
    this.state.patchElement(this.el().id, patch);
  }
}
