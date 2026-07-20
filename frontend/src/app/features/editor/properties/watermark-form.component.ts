import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Watermark } from '../../../core/models/template.model';
import { SliderFieldComponent } from './slider-field.component';

/** 浮水印設定表單（文件層與節層共用；啟用/模式切換由外層控制） */
@Component({
  selector: 'app-watermark-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SliderFieldComponent],
  template: `
    <label class="full">文字
      <input [ngModel]="wm().text" (ngModelChange)="patchWm.emit({ text: $event })" placeholder="例：副本 / 作廢" />
    </label>
    <label class="full">依資料切換文字（選填）——例：綁 status，資料給「作廢」就蓋作廢
      <input [ngModel]="wm().key" (ngModelChange)="patchWm.emit({ key: $event })" placeholder="例：watermark" />
    </label>
    <app-slider-field label="字級（pt）" [min]="12" [max]="200"
      [value]="wm().fontSize" (valueChange)="patchWm.emit({ fontSize: $event })" />
    <app-slider-field label="旋轉（度）" [min]="0" [max]="360"
      [value]="wm().rotation" (valueChange)="patchWm.emit({ rotation: $event })" />
    <label>顏色 <input type="color" [ngModel]="wm().color" (ngModelChange)="patchWm.emit({ color: $event })" /></label>
    <label class="full">疊放位置
      <select [ngModel]="wm().layer" (ngModelChange)="patchWm.emit({ layer: $event })">
        <option value="below">蓋在內容下方（預設）</option>
        <option value="above">蓋在內容上方</option>
      </select>
    </label>
    <label class="row"><input type="checkbox" [ngModel]="wm().repeat"
      (ngModelChange)="patchWm.emit({ repeat: $event })" /> 重複平鋪（鋪滿整頁）</label>
    @if (wm().repeat) {
      <app-slider-field label="水平間隔（pt）" [min]="10" [max]="400"
        [value]="wm().gapX" (valueChange)="patchWm.emit({ gapX: $event })" />
      <app-slider-field label="垂直間隔（pt）" [min]="10" [max]="400"
        [value]="wm().gapY" (valueChange)="patchWm.emit({ gapY: $event })" />
    }
  `,
  styles: `
    :host { display: contents; }
    label { display: flex; flex-direction: column; gap: 2px; color: #444; font-size: 13px; }
    label.row { flex-direction: row; align-items: center; gap: 6px; }
    input, select { font: inherit; padding: 4px 6px; border: 1px solid #ccc; border-radius: 4px; width: 100%; box-sizing: border-box; }
    input[type='color'] { padding: 0; height: 28px; }
    input[type='checkbox'] { width: auto; }
    .full { width: 100%; }
  `,
})
export class WatermarkFormComponent {
  wm = input.required<Watermark>();
  patchWm = output<Partial<Watermark>>();
}
