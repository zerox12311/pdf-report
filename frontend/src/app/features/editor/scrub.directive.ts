import { Directive, ElementRef, DestroyRef, inject, input, output } from '@angular/core';

/**
 * 數值欄位的拖曳調整（Figma 式 scrub）：
 * 在標籤上按住左右拖曳即可增減數值。用 Pointer Lock API 鎖定指標——
 * 游標隱藏且不受螢幕邊界限制，可以一直往同方向拖（無限滾動）。
 *
 * 用法：<label [appScrub]="el.x" (scrubChange)="patch(el, { x: $event })">X <input …/></label>
 * 點在子 input 上不觸發（正常打字），只有標籤區域可拖。
 */
@Directive({
  selector: '[appScrub]',
  host: {
    '[class.scrubbable]': 'true',
    '(pointerdown)': 'onDown($event)',
  },
})
export class ScrubDirective {
  /** 目前值 */
  value = input.required<number>({ alias: 'appScrub' });
  /** 每格增量（預設 1；按住 Shift ×10） */
  scrubStep = input(1);
  scrubMin = input<number | undefined>(undefined);
  scrubMax = input<number | undefined>(undefined);
  scrubChange = output<number>();

  private host = inject(ElementRef).nativeElement as HTMLElement;
  private cleanup: (() => void) | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cleanup?.());
  }

  onDown(e: PointerEvent) {
    // 點在輸入框/按鈕上時不 scrub（讓使用者正常打字）
    const target = e.target as HTMLElement;
    if (e.button !== 0 || target.closest('input, select, button')) return;
    e.preventDefault();

    const start = this.value();
    const step = this.scrubStep();
    let acc = 0; // 累積的指標位移（px）
    // 指標鎖定：游標消失、movementX 不受視窗邊界限制 → 可無限往同方向拖
    void this.host.requestPointerLock?.();

    const onMove = (ev: PointerEvent) => {
      acc += ev.movementX;
      const mul = ev.shiftKey ? 10 : 1;
      // 每 2px 一格，手感不會過於敏感
      let v = start + Math.round(acc / 2) * step * mul;
      const min = this.scrubMin();
      const max = this.scrubMax();
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      if (v !== this.value()) this.scrubChange.emit(v);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (document.pointerLockElement === this.host) document.exitPointerLock?.();
      this.cleanup = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.cleanup = onUp;
  }
}
