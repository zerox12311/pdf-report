import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CornerRadii, ELEMENT_META, ElementPatch, FONT_FAMILIES, VALUE_FORMATS,
  RectElement, TableCell, TableElement, TemplateElement, cornerRadiiOf,
} from '../../core/models/template.model';
import { FontService } from '../../core/services/font.service';
import { EditorStateService } from './editor-state.service';
import { PagePropertiesComponent } from './properties/page-properties.component';
import { TextStyleFormComponent } from './properties/text-style-form.component';
import { ScrubDirective } from './scrub.directive';

@Component({
  selector: 'app-properties-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TextStyleFormComponent, PagePropertiesComponent, ScrubDirective],
  template: `
    <div class="panel">
      @if (state.selected(); as el) {
        <h3>屬性 <span class="type-tag">{{ typeName(el.type) }}</span>
          <span class="band-tag" [title]="'依 Y 座標判定；移動元素跨過虛線會換區'">{{ bandOf(el) }}</span></h3>

        <!-- 標籤可左右拖曳調整數值（Figma 式 scrub；指標鎖定可無限拖） -->
        <div class="grid4">
          <label [appScrub]="el.x" (scrubChange)="patch(el, { x: $event })">X（{{ state.rulerUnit() }}）
            <input type="number" [ngModel]="state.ptToDisp(el.x)" (ngModelChange)="patch(el, { x: state.dispToPt(num($event)) })" /></label>
          <label [appScrub]="el.y" (scrubChange)="patch(el, { y: $event })">Y（{{ state.rulerUnit() }}）
            <input type="number" [ngModel]="state.ptToDisp(el.y)" (ngModelChange)="patch(el, { y: state.dispToPt(num($event)) })" /></label>
          <label [appScrub]="el.width" [scrubMin]="1" (scrubChange)="scrubSize(el, { width: $event })">寬（{{ state.rulerUnit() }}）
            <input type="number" [ngModel]="state.ptToDisp(el.width)" [disabled]="el.type === 'table'"
              (ngModelChange)="patch(el, { width: numMin(state.dispToPt(num($event)), 1) })" /></label>
          <label [appScrub]="el.height" [scrubMin]="0" (scrubChange)="scrubSize(el, { height: $event })">高（{{ state.rulerUnit() }}）
            <input type="number" [ngModel]="state.ptToDisp(el.height)" [disabled]="el.type === 'table'"
              (ngModelChange)="patch(el, { height: numMin(state.dispToPt(num($event)), 0) })" /></label>
        </div>
        <label class="rot" [appScrub]="el.rotation ?? 0" [scrubStep]="1" (scrubChange)="patch(el, { rotation: $event })">旋轉（°）
          <input type="number" step="1" [ngModel]="el.rotation ?? 0" (ngModelChange)="patch(el, { rotation: num($event) })" />
        </label>

        @switch (el.type) {
          @case ('text') {
            <label class="full">內容
              <textarea rows="3" [ngModel]="el.content" (ngModelChange)="patch(el, { content: $event })"></textarea>
            </label>
            <div class="hint" ngNonBindable>可混排資料：<b>{{customer.name}}</b>、<b>{{total|comma}}</b>（格式：comma/twUpper/rocDate/rocDateLong）、<b>{{$page}}</b>/<b>{{$sum(items.amount)}}</b> 等引擎 key 皆可。</div>
            <app-text-style-form [el]="el" />
          }
          @case ('placeholder') {
            <label class="full">資料 key（渲染時由後端資料填入）
              <input [ngModel]="el.key" (ngModelChange)="patch(el, { key: $event })" placeholder="例：customer.name" />
            </label>
            <div class="hint">支援路徑（customer.name、items[0].qty）與函式：$sum(items.amount)、$count(items)、$avg(…)、$page、$pages。</div>
            <label class="full">範例值
              <input [ngModel]="el.sample" (ngModelChange)="patch(el, { sample: $event })" />
            </label>
            <label class="full">格式（數值）
              <select [ngModel]="el.format ?? ''" (ngModelChange)="patch(el, { format: $event })">
                @for (f of formats; track f.value) { <option [value]="f.value">{{ f.label }}</option> }
              </select>
            </label>
            <app-text-style-form [el]="el" />
          }
          @case ('barcode') {
            <label class="full">條碼類型
              <select [ngModel]="el.symbology" (ngModelChange)="patch(el, { symbology: $event })">
                <option value="code128">Code 128</option>
                <option value="code39">Code 39（超商三段條碼）</option>
                <option value="ean13">EAN-13</option>
                <option value="qr">QR Code</option>
              </select>
            </label>
            <label class="full">資料 key（綁定資料，留空用靜態值）
              <input [ngModel]="el.key" (ngModelChange)="patch(el, { key: $event })" placeholder="例：payment.barcode1" />
            </label>
            @if (el.key) {
              <label class="full">範例值
                <input [ngModel]="el.sample" (ngModelChange)="patch(el, { sample: $event })" />
              </label>
            } @else {
              <label class="full">靜態內容
                <input [ngModel]="el.content" (ngModelChange)="patch(el, { content: $event })" />
              </label>
            }
            @if (el.symbology !== 'qr') {
              <label class="row"><input type="checkbox" [ngModel]="el.showText" (ngModelChange)="patch(el, { showText: $event })" /> 下方顯示人讀文字</label>
            }
            <div class="hint">Code 39 僅支援數字、大寫英文與 - . $ / + % 空白（內容會自動轉大寫）；EAN-13 需 12~13 位數字。</div>
          }
          @case ('container') {
            <label class="full">標題
              <input [ngModel]="el.title" (ngModelChange)="patch(el, { title: $event })" placeholder="例：繳費資訊" />
            </label>
            <div class="grid2">
              <label>邊框寬 <input type="number" step="0.5" min="0" [ngModel]="el.borderWidth" (ngModelChange)="patch(el, { borderWidth: num($event) })" /></label>
              <label>邊框色 <input type="color" [ngModel]="el.borderColor" (ngModelChange)="patch(el, { borderColor: $event })" /></label>
            </div>
            <label class="row">
              <input type="checkbox" [ngModel]="el.borderWidth === 0"
                (ngModelChange)="patch(el, { borderWidth: $event ? 0 : 1 })" /> 外框透明（不畫框線，畫布以虛線輔助）
            </label>
            <label class="row">
              <input type="checkbox" [ngModel]="el.fillColor !== null"
                (ngModelChange)="patch(el, { fillColor: $event ? '#f8fafc' : null })" /> 底色
            </label>
            @if (el.fillColor !== null) {
              <label>底色 <input type="color" [ngModel]="el.fillColor" (ngModelChange)="patch(el, { fillColor: $event })" /></label>
            }
            <div class="hint">選取容器時從元件盤新增元素，會直接加進容器；子元素座標相對於容器。跨頁時容器整組不拆分。</div>
          }
          @case ('image') {
            <div class="sub">圖片來源（三選一；優先序：動態 key > 固定連結 > 上傳）</div>
            <button class="merge" (click)="pickElementImage(el)">{{ el.assetId ? '更換上傳圖片…' : '上傳圖片…' }}</button>
            <label class="full">固定圖片連結（靜態 URL）
              <input [ngModel]="el.url ?? ''" (ngModelChange)="patch(el, { url: $event || undefined })"
                placeholder="https://…/logo.png" />
            </label>
            <label class="full">動態圖片 key（渲染資料的值 = 圖片 URL）
              <input [ngModel]="el.key ?? ''" (ngModelChange)="patch(el, { key: $event || undefined })"
                placeholder="例：customer.logoUrl" />
            </label>
            @if (el.key) {
              <label class="full">範例 URL（畫布預覽用）
                <input [ngModel]="el.sample ?? ''" (ngModelChange)="patch(el, { sample: $event || undefined })"
                  placeholder="https://…/logo.png" />
              </label>
              <div class="hint">渲染時資料中該 key 的值需為可訪問的圖片 URL（http/https，PNG/JPEG，10MB 內），引擎當場抓取嵌入；抓取失敗發警告（strict 模式會擋）。</div>
            }
            <label class="full">縮放模式
              <select [ngModel]="el.fit" (ngModelChange)="patch(el, { fit: $event })">
                <option value="contain">contain（等比置中）</option>
                <option value="stretch">stretch（填滿）</option>
              </select>
            </label>
          }
          @case ('rect') {
            <div class="grid2">
              <label>形狀
                <select [ngModel]="el.shape ?? 'rect'" (ngModelChange)="patch(el, { shape: $event === 'rect' ? undefined : $event })">
                  <option value="rect">矩形</option>
                  <option value="ellipse">橢圓 / 圓</option>
                </select>
              </label>
              @if ((el.shape ?? 'rect') === 'rect') {
                <label [appScrub]="radiusOf(el, 0)" [scrubMin]="0"
                  (scrubChange)="setUniformRadius(el, $event)">圓角
                  <span class="radius-row">
                    <input type="number" min="0" step="1" [ngModel]="uniformRadiusValue(el)"
                      [placeholder]="uniformRadiusValue(el) === null ? '混合' : '0'"
                      (ngModelChange)="setUniformRadius(el, $event)" />
                    <button class="radius-toggle" [class.on]="perCorner()" title="分別設定四角"
                      (click)="perCorner.set(!perCorner())">⛶</button>
                  </span>
                </label>
              }
            </div>
            @if ((el.shape ?? 'rect') === 'rect' && perCorner()) {
              <div class="grid2 radius-grid">
                <label [appScrub]="radiusOf(el, 0)" [scrubMin]="0" (scrubChange)="setCornerRadius(el, 'tl', $event)">◜ 左上
                  <input type="number" min="0" step="1" [ngModel]="radiusOf(el, 0)"
                    (ngModelChange)="setCornerRadius(el, 'tl', num($event))" /></label>
                <label [appScrub]="radiusOf(el, 1)" [scrubMin]="0" (scrubChange)="setCornerRadius(el, 'tr', $event)">◝ 右上
                  <input type="number" min="0" step="1" [ngModel]="radiusOf(el, 1)"
                    (ngModelChange)="setCornerRadius(el, 'tr', num($event))" /></label>
                <label [appScrub]="radiusOf(el, 3)" [scrubMin]="0" (scrubChange)="setCornerRadius(el, 'bl', $event)">◟ 左下
                  <input type="number" min="0" step="1" [ngModel]="radiusOf(el, 3)"
                    (ngModelChange)="setCornerRadius(el, 'bl', num($event))" /></label>
                <label [appScrub]="radiusOf(el, 2)" [scrubMin]="0" (scrubChange)="setCornerRadius(el, 'br', $event)">◞ 右下
                  <input type="number" min="0" step="1" [ngModel]="radiusOf(el, 2)"
                    (ngModelChange)="setCornerRadius(el, 'br', num($event))" /></label>
              </div>
            }
            <div class="grid2">
              <label>框線色 <input type="color" [ngModel]="el.strokeColor" (ngModelChange)="patch(el, { strokeColor: $event })" /></label>
              <label>框線寬 <input type="number" step="0.5" [ngModel]="el.strokeWidth" (ngModelChange)="patch(el, { strokeWidth: num($event) })" /></label>
            </div>
            <label class="full">框線型
              <select [ngModel]="el.lineStyle ?? 'solid'" (ngModelChange)="patch(el, { lineStyle: $event === 'solid' ? undefined : $event })">
                <option value="solid">實線</option>
                <option value="dashed">虛線 ┄</option>
                <option value="dotted">點線 ┈</option>
              </select>
            </label>
            <label class="row">
              <input type="checkbox" [ngModel]="el.strokeWidth === 0"
                (ngModelChange)="patch(el, { strokeWidth: $event ? 0 : 1 })" /> 外框透明（只留填色）
            </label>
            <label class="row">
              <input type="checkbox" [ngModel]="el.fillColor !== null"
                (ngModelChange)="patch(el, { fillColor: $event ? '#eeeeee' : null })" /> 填色
            </label>
            @if (el.fillColor !== null) {
              <label>填色 <input type="color" [ngModel]="el.fillColor" (ngModelChange)="patch(el, { fillColor: $event })" /></label>
            }
          }
          @case ('line') {
            <div class="grid2">
              <label>線色 <input type="color" [ngModel]="el.strokeColor" (ngModelChange)="patch(el, { strokeColor: $event })" /></label>
              <label>線寬 <input type="number" step="0.5" [ngModel]="el.strokeWidth" (ngModelChange)="patch(el, { strokeWidth: num($event) })" /></label>
            </div>
            <label class="full">線型
              <select [ngModel]="el.lineStyle ?? 'solid'" (ngModelChange)="patch(el, { lineStyle: $event === 'solid' ? undefined : $event })">
                <option value="solid">實線</option>
                <option value="dashed">虛線 ┄</option>
                <option value="dotted">點線 ┈</option>
              </select>
            </label>
          }
          @case ('table') {
            <div class="grid2">
              <label>列數 <input type="number" min="1" [ngModel]="el.rowHeights.length"
                (ngModelChange)="state.resizeTable(el.id, num($event), el.columnWidths.length)" /></label>
              <label>欄數 <input type="number" min="1" [ngModel]="el.columnWidths.length"
                (ngModelChange)="state.resizeTable(el.id, el.rowHeights.length, num($event))" /></label>
              <label>框線寬 <input type="number" step="0.5" [ngModel]="el.borderWidth" (ngModelChange)="patch(el, { borderWidth: num($event) })" /></label>
              <label>框線色 <input type="color" [ngModel]="el.borderColor" (ngModelChange)="patch(el, { borderColor: $event })" /></label>
              <label>字級 <input type="number" min="1" [ngModel]="el.fontSize" (ngModelChange)="patch(el, { fontSize: numMin($event, 1) })" /></label>
              <label>內距 <input type="number" [ngModel]="el.cellPadding" (ngModelChange)="patch(el, { cellPadding: num($event) })" /></label>
            </div>
            <label class="row">
              <input type="checkbox" [ngModel]="el.borderWidth === 0"
                (ngModelChange)="patch(el, { borderWidth: $event ? 0 : 1 })" /> 框線透明（不畫格線，畫布以虛線輔助）
            </label>
            <label class="full">字型
              <select [ngModel]="el.fontFamily ?? 'sans'" (ngModelChange)="patch(el, { fontFamily: $event })">
                @for (f of fontFamilies; track f.value) { <option [value]="f.value">{{ f.label }}</option> }
                @for (f of fontSvc.fonts(); track f.id) { <option [value]="f.id">{{ f.name }}（匯入）</option> }
              </select>
            </label>
            <div class="sub">陣列迴圈（報表重複列）</div>
            <label class="row">
              <input type="checkbox" [ngModel]="el.repeat?.enabled ?? false"
                (ngModelChange)="toggleRepeat(el, $event)" /> 啟用：某一列依陣列資料重複
            </label>
            @if (el.repeat?.enabled) {
              <label class="full">陣列 key
                <input [ngModel]="el.repeat!.key" (ngModelChange)="patchRepeat(el, { key: $event })" placeholder="例：items" />
              </label>
              <label>重複列（第幾列）
                <input type="number" min="1" [max]="el.rowHeights.length"
                  [ngModel]="el.repeat!.rowIndex + 1"
                  (ngModelChange)="patchRepeat(el, { rowIndex: num($event) - 1 })" />
              </label>
              <div class="hint">重複列的儲存格 key 用「相對路徑」（例：name、qty）；渲染時該列依陣列筆數展開，下方元素自動往下推。序號用 $row。<b>變更重複列位置時，已綁 key 的儲存格不會自動搬移</b>——請確認相對 key 位於新的重複列上。</div>
              <label class="full">群組欄位（相對路徑，留空不分組）
                <input [ngModel]="el.repeat!.groupBy ?? ''" (ngModelChange)="patchRepeat(el, { groupBy: $event })" placeholder="例：category" />
              </label>
              @if (el.repeat!.groupBy) {
                <div class="grid2">
                  <label>群組首列（第幾列，0=無）
                    <input type="number" min="0" [max]="el.rowHeights.length"
                      [ngModel]="(el.repeat!.groupHeaderRowIndex ?? -1) + 1"
                      (ngModelChange)="patchRepeat(el, { groupHeaderRowIndex: num($event) >= 1 ? num($event) - 1 : null })" />
                  </label>
                  <label>群組尾列（第幾列，0=無）
                    <input type="number" min="0" [max]="el.rowHeights.length"
                      [ngModel]="(el.repeat!.groupFooterRowIndex ?? -1) + 1"
                      (ngModelChange)="patchRepeat(el, { groupFooterRowIndex: num($event) >= 1 ? num($event) - 1 : null })" />
                  </label>
                </div>
                <div class="hint">群組首/尾列每組各插一次：相對 key 以該組第一筆解析（可放群組名稱）；小計用 $gsum(欄位)、$gcount、$gavg(欄位)。資料需先按群組欄位排序。</div>
              }
            }
            <div class="sub">欄寬（pt）</div>
            <div class="chips">
              @for (w of el.columnWidths; track $index; let i = $index) {
                <input class="chip" type="number" [ngModel]="w" (ngModelChange)="setColWidth(el, i, num($event))" />
              }
            </div>
            <div class="sub">列高（pt）</div>
            <div class="chips">
              @for (h of el.rowHeights; track $index; let i = $index) {
                <input class="chip" type="number" [ngModel]="h" (ngModelChange)="setRowHeight(el, i, num($event))" />
              }
            </div>
            @if (selectedTableCell(); as cell) {
              <div class="cell-editor">
                @if (cellCount() > 1) {
                  <div class="sub">儲存格（已選 {{ cellCount() }} 格）</div>
                  <div class="hint">樣式（對齊/粗體/字級/顏色/背景色）一次套用到選取範圍。</div>
                } @else {
                  <div class="sub">儲存格 ({{ state.selectedCell()!.row + 1 }}, {{ state.selectedCell()!.col + 1 }})</div>
                }
                @if (cellCount() === 1) {
                  <label class="full">類型
                    <select [ngModel]="cell.kind" (ngModelChange)="patchCell(el, { kind: $event })">
                      <option value="text">靜態文字</option>
                      <option value="placeholder">資料欄位</option>
                      <option value="image">圖片</option>
                      <option value="barcode">條碼</option>
                    </select>
                  </label>
                  @if (cell.kind === 'barcode') {
                    <label class="full">條碼類型
                      <select [ngModel]="cell.symbology ?? 'code128'" (ngModelChange)="patchCell(el, { symbology: $event })">
                        <option value="code128">Code 128</option>
                        <option value="code39">Code 39（超商三段條碼）</option>
                        <option value="ean13">EAN-13</option>
                        <option value="qr">QR Code</option>
                      </select>
                    </label>
                    <label class="full">資料 key（綁定資料，留空用靜態值；重複列內用相對 key）
                      <input [ngModel]="cell.key" (ngModelChange)="patchCell(el, { key: $event })"
                        placeholder="例：payment.barcode1" />
                    </label>
                    @if (cell.key) {
                      <label class="full">範例值
                        <input [ngModel]="cell.sample" (ngModelChange)="patchCell(el, { sample: $event })" />
                      </label>
                    } @else {
                      <label class="full">靜態內容
                        <input [ngModel]="cell.value" (ngModelChange)="patchCell(el, { value: $event })" />
                      </label>
                    }
                    @if (cell.symbology !== 'qr') {
                      <label class="row"><input type="checkbox" [ngModel]="cell.showText ?? false"
                        (ngModelChange)="patchCell(el, { showText: $event })" /> 下方顯示人讀文字</label>
                    }
                    <div class="hint">條碼以等比置入格內（QR 為正方形置中）；重複列內每列依資料產生各自的條碼。</div>
                  } @else if (cell.kind === 'image') {
                    <button class="merge" (click)="pickCellImage(el)">{{ cell.assetId ? '更換圖片…' : '選擇圖片…' }}</button>
                    <label class="full">固定圖片連結（靜態 URL）
                      <input [ngModel]="cell.url ?? ''" (ngModelChange)="patchCell(el, { url: $event || undefined })"
                        placeholder="https://…/logo.png" />
                    </label>
                    <label class="full">動態圖片 key（渲染資料的值 = 圖片 URL）
                      <input [ngModel]="cell.key" (ngModelChange)="patchCell(el, { key: $event })"
                        placeholder="例：photoUrl（重複列內用相對 key）" />
                    </label>
                    @if (cell.key) {
                      <label class="full">範例 URL（畫布預覽用）
                        <input [ngModel]="cell.sample" (ngModelChange)="patchCell(el, { sample: $event })"
                          placeholder="https://…/photo.png" />
                      </label>
                    }
                    <div class="hint">也可以直接把元件盤的「圖片」拖到儲存格上。key 綁定時渲染資料的值需為圖片 URL（重複列每列可不同圖）。圖片以等比縮放置入格內。</div>
                  } @else if (cell.kind === 'text') {
                    <label class="full">文字 <input [ngModel]="cell.value" (ngModelChange)="patchCell(el, { value: $event })" /></label>
                  } @else {
                    <label class="full">key <input [ngModel]="cell.key" (ngModelChange)="patchCell(el, { key: $event })" placeholder="例：items[0].name" /></label>
                    <div class="hint">重複列內用相對路徑（name、qty）；序號 $row；小計 $gsum(欄位)/$gcount；總計 $sum(items.欄位)。</div>
                    <label class="full">範例值 <input [ngModel]="cell.sample" (ngModelChange)="patchCell(el, { sample: $event })" /></label>
                    <label class="full">格式（數值）
                      <select [ngModel]="cell.format ?? ''" (ngModelChange)="patchCell(el, { format: $event })">
                        @for (f of formats; track f.value) { <option [value]="f.value">{{ f.label }}</option> }
                      </select>
                    </label>
                  }
                }
                <div class="grid2">
                  <label>水平對齊
                    <select [ngModel]="cell.align" (ngModelChange)="patchCellStyle(el, { align: $event })">
                      <option value="left">左</option><option value="center">中</option><option value="right">右</option>
                    </select>
                  </label>
                  <label>垂直對齊
                    <select [ngModel]="cell.vAlign ?? 'middle'"
                      (ngModelChange)="patchCellStyle(el, { vAlign: $event === 'middle' ? undefined : $event })">
                      <option value="top">上</option><option value="middle">中</option><option value="bottom">下</option>
                    </select>
                  </label>
                </div>
                <label class="row"><input type="checkbox" [ngModel]="cell.bold" (ngModelChange)="patchCellStyle(el, { bold: $event })" /> 粗體</label>
                <label class="row">
                  <input type="checkbox" [ngModel]="cell.wrap ?? false"
                    (ngModelChange)="patchCellStyle(el, { wrap: $event || undefined })" /> 自動換行（列高自動延伸）
                </label>
                @if (cell.wrap) {
                  <div class="hint">內容超寬時換行、該列列高自動增加（適合長說明欄）；未勾選 = 單行裁切加「…」。實際列高以預覽/PDF 為準。</div>
                }
                <label class="full">字級（0 = 用表格）
                  <input type="number" min="0" [ngModel]="cell.fontSize ?? 0"
                    (ngModelChange)="patchCellStyle(el, { fontSize: num($event) > 0 ? num($event) : undefined })" />
                </label>
                <div class="grid2">
                  <label>文字顏色
                    <span class="colorrow">
                      <input type="color" [ngModel]="cell.color || '#000000'"
                        (ngModelChange)="patchCellStyle(el, { color: $event })" />
                      @if (cell.color) {
                        <button class="clearcolor" title="還原預設（黑）"
                          (click)="patchCellStyle(el, { color: undefined })">×</button>
                      }
                    </span>
                  </label>
                  <label>背景色
                    <span class="colorrow">
                      <input type="color" [ngModel]="cell.fillColor || '#ffffff'"
                        (ngModelChange)="patchCellStyle(el, { fillColor: $event })" />
                      @if (cell.fillColor) {
                        <button class="clearcolor" title="清除（透明）"
                          (click)="patchCellStyle(el, { fillColor: undefined })">×</button>
                      }
                    </span>
                  </label>
                </div>
                <div class="sub">框線（選取範圍）</div>
                @if (el.borderWidth > 0) {
                  <div class="borderbtns">
                    <button [class.on]="state.selectionEdgeOn(el.id, 'top')" (click)="state.applyCellBorders(el.id, 'top')">上框線</button>
                    <button [class.on]="state.selectionEdgeOn(el.id, 'bottom')" (click)="state.applyCellBorders(el.id, 'bottom')">下框線</button>
                    <button [class.on]="state.selectionEdgeOn(el.id, 'left')" (click)="state.applyCellBorders(el.id, 'left')">左框線</button>
                    <button [class.on]="state.selectionEdgeOn(el.id, 'right')" (click)="state.applyCellBorders(el.id, 'right')">右框線</button>
                  </div>
                  <div class="borderbtns">
                    <button (click)="state.applyCellBorders(el.id, 'all')">所有框線</button>
                    <button (click)="state.applyCellBorders(el.id, 'outer')">外框線</button>
                    <button (click)="state.applyCellBorders(el.id, 'inner')">內框線</button>
                    <button (click)="state.applyCellBorders(el.id, 'none')">無框線</button>
                  </div>
                  <div class="borderbtns">
                    <button [class.on]="state.selectionDiagOn(el.id, 'diagDown')" (click)="state.applyCellBorders(el.id, 'diagDown')">╲ 左斜線</button>
                    <button [class.on]="state.selectionDiagOn(el.id, 'diagUp')" (click)="state.applyCellBorders(el.id, 'diagUp')">╱ 右斜線</button>
                  </div>
                  <div class="hint">上下左右可切換選取範圍該側的線（亮 = 顯示中）；共用的線兩側都關掉才會消失。斜線可劃掉未使用的欄位。</div>
                } @else {
                  <div class="hint">表格框線寬為 0（框線透明），逐格框線無效——先把上方「框線寬」調大。</div>
                }
                <div class="sub">合併儲存格</div>
                @if (state.selectedCellRange()) {
                  <button class="merge" (click)="mergeCells(el)"
                    [disabled]="!!mergeBlocked(el)"
                    [title]="mergeBlocked(el) ?? '合併選取範圍'">合併選取範圍</button>
                  @if (mergeBlocked(el); as reason) { <div class="hint merge-blocked">⚠ {{ reason }}</div> }
                }
                @if ((cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1) {
                  <button class="merge" (click)="unmergeCell(el)">取消合併（目前 {{ cell.colSpan ?? 1 }}×{{ cell.rowSpan ?? 1 }}）</button>
                }
                <div class="hint">在表格上<b>按住拖曳</b>（或先點一格再 Shift+點選）框出範圍：可一次套樣式或合併；重複列內只能左右合併。移動表格請拖左上角 ✥ 手柄。</div>
              </div>
            } @else {
              <div class="hint">點儲存格可編輯內容；按住拖曳可框選範圍（同 Excel）。移動表格請拖選取後左上角的 ✥ 手柄。</div>
            }
          }
        }

        <!-- 圖層（所有元素通用；容器子元素跟隨容器） -->
        @if (!state.parentOf(el.id)) {
          <div class="sub">圖層</div>
          <label class="row">
            <input type="checkbox" [ngModel]="el.aboveWatermark ?? false"
              (ngModelChange)="patch(el, { aboveWatermark: $event })" /> 置於浮水印之上
          </label>
          <div class="hint">浮水印設「蓋在內容上方」時，此元素仍顯示在浮水印之上——條碼、金額等不想被蓋的內容適用（新條碼預設開啟）。</div>
        }

        <!-- 條件顯示（所有元素通用） -->
        <div class="sub">條件顯示</div>
        <label class="full">依資料 key（留空 = 永遠顯示）
          <input [ngModel]="el.visibleKey ?? ''" (ngModelChange)="patch(el, { visibleKey: $event })" placeholder="例：paid" />
        </label>
        @if (el.visibleKey) {
          <div class="grid2">
            <label>條件
              <select [ngModel]="el.visibleOp ?? 'truthy'" (ngModelChange)="patch(el, { visibleOp: $event })">
                <option value="truthy">有值/為真</option>
                <option value="falsy">無值/為假</option>
                <option value="eq">等於</option>
                <option value="ne">不等於</option>
              </select>
            </label>
            @if (el.visibleOp === 'eq' || el.visibleOp === 'ne') {
              <label>比較值 <input [ngModel]="el.visibleVal ?? ''" (ngModelChange)="patch(el, { visibleVal: $event })" /></label>
            }
          </div>
          <div class="hint">隱藏時仍保留版面空間。key 與比較值可用 $page / $pages：例「$page 等於 1」＝只在第一頁；「$page 等於 $pages」＝只在最末頁。</div>
        }

        <div class="actions">
          <button class="action" (click)="state.duplicateElement(el.id)">複製{{ el.type === 'container' ? '容器（含子元素）' : '' }}</button>
          @if (state.parentOf(el.id)) {
            <button class="action" (click)="state.moveOutOfContainer(el.id)">移出容器</button>
          }
          <button class="danger" (click)="state.removeElement(el.id)">刪除元素</button>
        </div>
      } @else {
        <app-page-properties />
      }
    </div>
  `,
  styles: `
    :host { display: block; flex: 1; min-height: 0; background: #fafafa; overflow-y: auto; }
    .panel { padding: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
    h3 { margin: 0 0 4px; font-size: 14px; }
    .type-tag { font-size: 11px; background: #2563eb; color: #fff; border-radius: 4px; padding: 1px 6px; vertical-align: middle; }
    .band-tag { font-size: 10px; background: #fef3c7; color: #92400e; border-radius: 4px; padding: 1px 6px; vertical-align: middle; margin-left: 4px; }
    label { display: flex; flex-direction: column; gap: 2px; color: #444; }
    label.row { flex-direction: row; align-items: center; gap: 6px; }
    input, select, textarea { font: inherit; padding: 4px 6px; border: 1px solid #ccc; border-radius: 4px; width: 100%; box-sizing: border-box; }
    input[type='color'] { padding: 0; height: 28px; }
    input[type='checkbox'] { width: auto; }
    .grid4 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .full { width: 100%; }
    .borderbtns { display: flex; gap: 4px; margin-bottom: 4px; }
    .borderbtns button { flex: 1; font: inherit; font-size: 11px; padding: 4px 2px; cursor: pointer;
      border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #475569; white-space: nowrap; }
    .borderbtns button:hover { background: #f1f5f9; }
    .borderbtns button.on { background: #eff6ff; border-color: #93b4f8; color: #1d4ed8; font-weight: 700; }
    /* 可拖曳調整的數值標籤（Figma 式 scrub）：標籤顯示 ↔ 游標，輸入框維持文字游標 */
    .scrubbable { cursor: ew-resize; user-select: none; }
    .scrubbable input, .scrubbable select, .scrubbable button { cursor: auto; user-select: text; }
    /* 圓角：統一輸入＋展開四角（Figma 式） */
    .radius-row { display: flex; align-items: center; gap: 4px; }
    .radius-row input { flex: 1; min-width: 0; }
    .radius-toggle { width: 24px; height: 24px; flex-shrink: 0; padding: 0; cursor: pointer;
      border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #475569; font-size: 11px; }
    .radius-toggle.on { background: #eff6ff; border-color: #93b4f8; color: #1d4ed8; }
    .radius-grid { margin-top: -2px; }
    .colorrow { display: flex; align-items: center; gap: 4px; }
    .colorrow input[type=color] { flex: 1; min-width: 0; }
    .clearcolor { width: 20px; height: 20px; padding: 0; border: 1px solid #cbd5e1; border-radius: 4px;
      background: #fff; color: #64748b; font-size: 13px; line-height: 1; cursor: pointer; flex-shrink: 0; }
    .clearcolor:hover { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }
    .merge { font: inherit; padding: 5px 10px; border: 1px solid #93b4f8; background: #eff6ff;
      color: #1d4ed8; border-radius: 5px; cursor: pointer; }
    .merge:hover:not(:disabled) { background: #dbeafe; }
    .merge:disabled { opacity: .5; cursor: not-allowed; border-color: #d1d5db; color: #9ca3af; background: #f3f4f6; }
    .merge-blocked { color: #b45309; }
    .sub { font-weight: 600; color: #555; margin-top: 4px; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { width: 56px !important; }
    .cell-editor { border: 1px solid #dbe3f5; background: #eef3ff; border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
    .hint { color: #999; font-size: 12px; }
    .actions { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .action { background: #e2e8f0; color: #1e293b; border: none; border-radius: 6px; padding: 8px; cursor: pointer; }
    .action:hover { background: #cbd5e1; }
    .danger { background: #dc2626; color: #fff; border: none; border-radius: 6px; padding: 8px; cursor: pointer; }
    .danger:hover { background: #b91c1c; }
  `,
})
export class PropertiesPanelComponent {
  state = inject(EditorStateService);
  fontSvc = inject(FontService);

  selectedTableCell = computed<TableCell | null>(() => {
    const el = this.state.selected();
    const sc = this.state.selectedCell();
    if (!el || el.type !== 'table' || !sc) return null;
    return el.cells[sc.row]?.[sc.col] ?? null;
  });

  /** 選取的儲存格數（Shift 框選範圍；1 = 單格） */
  cellCount = computed<number>(() => {
    if (!this.selectedTableCell()) return 0;
    const range = this.state.selectedCellRange();
    if (!range) return 1;
    return (Math.abs(range.r2 - range.r1) + 1) * (Math.abs(range.c2 - range.c1) + 1);
  });

  fontFamilies = FONT_FAMILIES;
  formats = VALUE_FORMATS;

  num(v: unknown): number {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return isNaN(n) ? 0 : n;
  }

  /** 尺寸類欄位：解析並夾到 min 以上（負值/非法幾何無意義；x/y 可為負故仍用 num） */
  numMin(v: unknown, min = 0): number {
    return Math.max(min, this.num(v));
  }

  patch(el: TemplateElement, patch: ElementPatch) {
    this.state.patchElement(el.id, patch);
  }

  /** 寬/高 scrub：表格的寬高是欄寬/列高的衍生值，不直接改 */
  scrubSize(el: TemplateElement, patch: ElementPatch) {
    if (el.type === 'table') return;
    this.patch(el, patch);
  }

  pickCellImage(el: TableElement) {
    const sc = this.state.selectedCell();
    if (sc) this.state.imagePickRequest.set({ tableId: el.id, r: sc.row, c: sc.col });
  }

  /** 圖片元素的「上傳圖片…」：開檔案選擇器，上傳後設 assetId（並清掉 URL 綁定） */
  pickElementImage(el: TemplateElement) {
    this.state.imagePickRequest.set({ elementId: el.id });
  }

  // ---- 圓角（Figma 式：統一輸入＋展開四角）----
  /** 四角獨立輸入是否展開 */
  perCorner = signal(false);

  /** 第 i 角的半徑（順序 tl, tr, br, bl） */
  radiusOf(el: RectElement, i: number): number {
    return cornerRadiiOf(el)[i];
  }

  /** 統一輸入框的值：四角相同 → 該數字；不同 → null（欄位留空、顯示「混合」placeholder，同 Figma 的 Mixed） */
  uniformRadiusValue(el: RectElement): number | null {
    const [tl, tr, br, bl] = cornerRadiiOf(el);
    return tl === tr && tr === br && br === bl ? tl : null;
  }

  /** 統一輸入：設定四角相同（清掉個別半徑）。number 輸入已擋掉非數字；清空（null）則不動、保留原值 */
  setUniformRadius(el: RectElement, v: unknown) {
    if (v === null || v === undefined || v === '') return;
    const r = Math.max(0, this.num(v));
    this.patch(el, { cornerRadius: r || undefined, cornerRadii: undefined });
  }

  /** 個別角：寫進 cornerRadii（其餘角沿用目前值） */
  setCornerRadius(el: RectElement, corner: 'tl' | 'tr' | 'br' | 'bl', v: number) {
    const [tl, tr, br, bl] = cornerRadiiOf(el);
    const next: CornerRadii = { tl, tr, br, bl, [corner]: Math.max(0, v) } as CornerRadii;
    // 四角又相同 → 收斂回統一值，schema 保持精簡
    if (next.tl === next.tr && next.tr === next.br && next.br === next.bl) {
      this.patch(el, { cornerRadius: next.tl || undefined, cornerRadii: undefined });
      return;
    }
    this.patch(el, { cornerRadii: next, cornerRadius: undefined });
  }

  /** 合併阻擋原因（null = 可合併）；供按鈕 disabled/title 與 inline 提示 */
  mergeBlocked(el: TableElement): string | null {
    return this.state.mergeSelectionError(el.id);
  }

  mergeCells(el: TableElement) {
    const err = this.state.mergeSelectedCells(el.id);
    if (err) alert(err);
  }

  unmergeCell(el: TableElement) {
    const sc = this.state.selectedCell();
    if (sc) this.state.unmergeCell(el.id, sc.row, sc.col);
  }

  patchCell(el: TableElement, patch: Partial<TableCell>) {
    const sc = this.state.selectedCell();
    if (!sc) return;
    if (patch.kind !== undefined && patch.kind !== 'text' && patch.kind !== 'placeholder' && patch.kind !== 'image') return; // 防呆

    const cells = el.cells.map((row, r) =>
      row.map((cell, c) => (r === sc.row && c === sc.col ? { ...cell, ...patch } : cell)));
    this.state.patchElement(el.id, { cells });
  }

  /** 樣式類修改套用到整個選取範圍（單格時等同 patchCell） */
  patchCellStyle(el: TableElement, patch: Partial<TableCell>) {
    this.state.patchSelectedCells(el.id, patch);
  }

  toggleRepeat(el: TableElement, enabled: boolean) {
    // 保留既有設定（含群組欄位），只切換 enabled——關掉再打開不會弄丟群組設定
    this.state.patchElement(el.id, {
      repeat: {
        key: 'items',
        rowIndex: Math.min(1, el.rowHeights.length - 1),
        ...el.repeat,
        enabled,
      },
    });
  }

  patchRepeat(el: TableElement, patch: Partial<NonNullable<TableElement['repeat']>>) {
    if (!el.repeat) return;
    const rowIndex = patch.rowIndex !== undefined
      ? Math.max(0, Math.min(el.rowHeights.length - 1, patch.rowIndex))
      : el.repeat.rowIndex;
    this.state.patchElement(el.id, {
      repeat: { ...el.repeat, ...patch, rowIndex },
    });
  }

  setColWidth(el: TableElement, i: number, w: number) {
    const columnWidths = el.columnWidths.map((v, idx) => (idx === i ? Math.max(10, w) : v));
    this.state.patchElement(el.id, {
      columnWidths, width: columnWidths.reduce((a, b) => a + b, 0),
    });
  }

  setRowHeight(el: TableElement, i: number, h: number) {
    const rowHeights = el.rowHeights.map((v, idx) => (idx === i ? Math.max(10, h) : v));
    this.state.patchElement(el.id, {
      rowHeights, height: rowHeights.reduce((a, b) => a + b, 0),
    });
  }

  typeName(t: TemplateElement['type']): string {
    return ELEMENT_META[t].label;
  }

  /** 元素所屬區段（依設計 Y 判定；容器子元素跟隨容器；獨立頁顯示節名） */
  bandOf(el: TemplateElement): string {
    const sec = this.state.activeSection();
    if (sec.kind === 'single') return `${sec.name}（獨立頁）`;
    const parent = this.state.parentOf(el.id);
    const y = parent ? parent.y : el.y;
    const page = this.state.activePage();
    if (y < page.headerHeight) return '頁首（每頁重複）';
    if (y >= page.height - page.footerHeight) return '頁尾（每頁重複）';
    return '內文';
  }
}
