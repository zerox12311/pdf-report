import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EditorStateService } from './editor-state.service';
import { DataKeyPayload } from './element-factory';

interface DataNode {
  label: string;
  path: string;
  depth: number;
  type: 'scalar' | 'object' | 'array';
  preview: string;
  fields?: { key: string; sample: string }[];
}

/**
 * 右側「資料」分頁：貼上宿主系統預計 POST 的 data JSON（與預覽分頁共用同一份），
 * 解析成 key 樹，拖曳到畫布即可生成資料欄位（scalar）或重複列表格（陣列）。
 */
@Component({
  selector: 'app-data-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="panel">
      <h3>資料</h3>
      <div class="hint">貼上後端預計 POST 過來的 <b>data</b> JSON（預覽分頁用同一份）。從下方清單把欄位<b>拖到畫布</b>生成元件；<b>拖到表格的儲存格上</b>則直接把該格變成資料欄位（拖進重複列會自動轉相對 key）。</div>
      <button class="fill" (click)="fillSample()">用畫布現有欄位產生範例資料</button>
      <textarea spellcheck="false" placeholder='{"customer":{"name":"王小明"},"items":[{"name":"商品A","qty":1}]}'
        [ngModel]="state.previewData()" (ngModelChange)="state.previewData.set($event)"></textarea>
      @if (parsed().error; as err) {
        <div class="error">{{ err }}</div>
      }
      @if (parsed().nodes.length) {
        <div class="tree-title">欄位（拖到畫布）</div>
        <div class="tree">
          @for (n of parsed().nodes; track n.path) {
            <div class="dnode" [class.obj]="n.type === 'object'"
              [style.paddingLeft.px]="6 + n.depth * 14"
              [draggable]="n.type !== 'object'"
              (dragstart)="onDragStart($event, n)">
              @if (n.type !== 'object') { <span class="grip">⠿</span> }
              <span class="k">{{ n.label }}</span>
              @if (n.type === 'array') {
                <span class="badge">陣列 → 拖出重複表格</span>
              } @else {
                <span class="v">{{ n.preview }}</span>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; flex: 1; min-height: 0; overflow-y: auto; background: #fafafa; }
    .panel { padding: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
    h3 { margin: 0; font-size: 14px; }
    .hint { color: #999; font-size: 12px; }
    .fill { font: inherit; padding: 5px 10px; border: 1px solid #93b4f8; background: #eff6ff;
      color: #1d4ed8; border-radius: 5px; cursor: pointer; }
    .fill:hover { background: #dbeafe; }
    textarea { font-family: monospace; font-size: 11px; min-height: 140px; border: 1px solid #ccc;
      border-radius: 6px; padding: 8px; resize: vertical; }
    .error { color: #dc2626; font-size: 12px; }
    .tree-title { font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: .06em; text-transform: uppercase; }
    .tree { display: flex; flex-direction: column; gap: 1px; }
    .dnode { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 5px;
      font-size: 12px; color: #334155; cursor: grab; }
    .dnode:active { cursor: grabbing; }
    .dnode:hover:not(.obj) { background: #e3e9f1; }
    .dnode.obj { cursor: default; color: #0369a1; font-weight: 700; }
    .grip { color: #94a3b8; font-size: 11px; }
    .k { font-family: monospace; }
    .v { color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 90px;
      margin-left: auto; }
    .badge { margin-left: auto; font-size: 10px; color: #92400e; background: #fef3c7; border-radius: 8px;
      padding: 1px 6px; white-space: nowrap; }
  `,
})
export class DataPanelComponent {
  state = inject(EditorStateService);

  readonly parsed = computed<{ nodes: DataNode[]; error: string | null }>(() => {
    const txt = this.state.previewData().trim();
    if (!txt) return { nodes: [], error: null };
    try {
      const data: unknown = JSON.parse(txt);
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return { nodes: [], error: 'data 必須是 JSON 物件' };
      }
      const nodes: DataNode[] = [];
      const walk = (obj: Record<string, unknown>, prefix: string, depth: number) => {
        for (const [k, v] of Object.entries(obj)) {
          const path = prefix ? `${prefix}.${k}` : k;
          if (Array.isArray(v)) {
            const first: unknown = v[0];
            if (first && typeof first === 'object' && !Array.isArray(first)) {
              // 物件陣列：本身可拖出重複表格，欄位可個別拖（[0] 路徑）
              const fields = Object.entries(first as Record<string, unknown>)
                .filter(([, fv]) => fv === null || typeof fv !== 'object')
                .map(([fk, fv]) => ({ key: fk, sample: fv == null ? '' : String(fv) }));
              nodes.push({ label: k, path, depth, type: 'array', preview: '', fields });
              for (const f of fields) {
                nodes.push({ label: f.key, path: `${path}[0].${f.key}`, depth: depth + 1, type: 'scalar', preview: f.sample });
              }
            } else {
              nodes.push({ label: k, path: `${path}[0]`, depth, type: 'scalar', preview: String(first ?? '') });
            }
          } else if (v !== null && typeof v === 'object') {
            nodes.push({ label: k, path, depth, type: 'object', preview: '' });
            walk(v as Record<string, unknown>, path, depth + 1);
          } else {
            nodes.push({ label: k, path, depth, type: 'scalar', preview: v == null ? '' : String(v) });
          }
        }
      };
      walk(data as Record<string, unknown>, '', 0);
      return { nodes, error: null };
    } catch (e) {
      return { nodes: [], error: 'JSON 格式錯誤：' + (e instanceof Error ? e.message : e) };
    }
  });

  fillSample() {
    this.state.previewData.set(JSON.stringify(this.state.buildSampleData(), null, 2));
  }

  onDragStart(ev: DragEvent, n: DataNode) {
    if (n.type === 'object' || !ev.dataTransfer) return;
    const payload: DataKeyPayload = n.type === 'array'
      ? { kind: 'array', key: n.path, fields: n.fields ?? [] }
      : { kind: 'scalar', key: n.path, sample: n.preview };
    ev.dataTransfer.setData('application/x-datakey', JSON.stringify(payload));
    ev.dataTransfer.effectAllowed = 'copy';
  }
}
