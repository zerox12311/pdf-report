import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * 固定範圍數值的「滑桿＋數字」輸入：滑桿快速調、數字框精準輸入，兩邊同步。
 * 超出範圍的輸入會夾回 [min, max]。
 */
@Component({
  selector: 'app-slider-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <label class="sf">{{ label() }}
      <div class="sf-row">
        <input type="range" [min]="min()" [max]="max()" [step]="step()"
          [ngModel]="value()" (ngModelChange)="onChange($event)" />
        <input class="sf-num" type="number" [min]="min()" [max]="max()" [step]="step()"
          [ngModel]="value()" (ngModelChange)="onChange($event)" />
      </div>
    </label>
  `,
  styles: `
    :host { display: block; width: 100%; }
    .sf { display: flex; flex-direction: column; gap: 2px; color: #444; font-size: 13px; }
    .sf-row { display: flex; align-items: center; gap: 8px; }
    input[type='range'] { flex: 1; min-width: 0; accent-color: #2563eb; padding: 0; margin: 0; }
    .sf-num { width: 64px; font: inherit; padding: 4px 6px; border: 1px solid #ccc; border-radius: 4px;
      box-sizing: border-box; }
  `,
})
export class SliderFieldComponent {
  label = input.required<string>();
  min = input.required<number>();
  max = input.required<number>();
  step = input(1);
  value = input.required<number>();
  valueChange = output<number>();

  onChange(v: unknown) {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (isNaN(n)) return;
    this.valueChange.emit(Math.min(this.max(), Math.max(this.min(), n)));
  }
}
