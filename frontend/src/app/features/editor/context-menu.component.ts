import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { EditorStateService } from './editor-state.service';

/**
 * 右鍵情境選單（單例掛在 editor-page）。
 * 內容由觸發端組好放進 state.contextMenu；點外面/Esc/捲動關閉。
 */
@Component({
  selector: 'app-context-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (menu(); as m) {
      <div class="menu" [style.left.px]="pos().x" [style.top.px]="pos().y"
        (contextmenu)="$event.preventDefault()">
        @for (item of m.items; track $index) {
          @if (item.kind === 'sep') {
            <div class="sep"></div>
          } @else {
            <button class="item" [class.danger]="item.danger" [disabled]="item.disabled"
              (click)="run(item)">
              <span class="check">{{ item.checked ? '✓' : '' }}</span>
              <span class="label">{{ item.label }}</span>
              @if (item.shortcut) { <span class="key">{{ item.shortcut }}</span> }
            </button>
          }
        }
      </div>
    }
  `,
  styles: `
    .menu { position: fixed; z-index: 1000; min-width: 178px; padding: 4px;
      background: #fff; border: 1px solid #d3dae3; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, .18); font-size: 12.5px; user-select: none; }
    .item { display: flex; align-items: center; gap: 4px; width: 100%; padding: 5px 8px;
      border: 0; background: none; font: inherit; color: #1e293b; text-align: left;
      border-radius: 5px; cursor: pointer; white-space: nowrap; }
    .item:hover:not(:disabled) { background: #eff6ff; }
    .item:disabled { color: #a8b3c1; cursor: default; }
    .item.danger { color: #dc2626; }
    .item.danger:hover:not(:disabled) { background: #fef2f2; }
    .check { width: 14px; flex-shrink: 0; color: #2563eb; font-weight: 700; }
    .label { flex: 1; }
    .key { margin-left: 16px; font-size: 11px; color: #94a3b8; }
    .sep { height: 1px; margin: 4px 6px; background: #e2e8f0; }
  `,
})
export class ContextMenuComponent {
  state = inject(EditorStateService);
  menu = this.state.contextMenu;

  /** 夾在視窗內（選單靠右/靠下時往回收） */
  pos = computed(() => {
    const m = this.menu();
    if (!m) return { x: 0, y: 0 };
    const itemCount = m.items.filter(i => i.kind !== 'sep').length;
    const estH = itemCount * 27 + (m.items.length - itemCount) * 9 + 8;
    return {
      x: Math.max(4, Math.min(m.x, window.innerWidth - 200)),
      y: Math.max(4, Math.min(m.y, window.innerHeight - estH - 8)),
    };
  });

  run(item: { run?: () => void }) {
    this.state.closeContextMenu();
    item.run?.();
  }

  constructor() {
    // 捕獲階段搶在其他 handler 前判斷；點在選單內不關（等 click 執行動作後自行關閉）
    const close = (e?: Event) => {
      if (e?.target instanceof Element && e.target.closest('app-context-menu')) return;
      this.state.closeContextMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.menu()) close();
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('resize', close);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', close);
      window.removeEventListener('resize', close);
    });
  }
}
