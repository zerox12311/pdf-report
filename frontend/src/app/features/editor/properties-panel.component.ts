import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CornerRadii, ELEMENT_META, ElementPatch, FONT_FAMILIES, VALUE_FORMATS,
  RectElement, TableCell, TableElement, TemplateElement, cornerRadiiOf,
} from '../../core/models/template.model';
import { t } from '../../core/i18n/i18n';
import { FontService } from '../../core/services/font.service';
import { ModalService } from '../../core/services/modal.service';
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
      <!-- 受限模式（嵌入 fill/view）：屬性面板只留「填內容」。
           版面/樣式/頁面（紙張、方向、邊界、浮水印）一律不顯示 —— 這些改了會毀掉整份版面配置，
           後端與 state chokepoint 本來就會擋，這裡不顯示才不會讓人白拖半天。 -->
      @if (state.restricted()) {
        @if (state.selected(); as el) {
          @if (fillEditableCell(el); as cell) {
            <h3>{{ t('填寫欄位') }} <span class="type-tag">{{ t('儲存格') }}</span></h3>
            <label class="full">{{ t('內容') }}
              <!-- 走單格通道：用 patchSelectedCells 會把整個選取範圍一起覆寫，洗掉其他格的值 -->
              <textarea rows="3" [ngModel]="cell.value" (ngModelChange)="setFillCell(el, $event)"></textarea>
            </label>
          } @else if (el.type === 'text' && state.canEditElementContent(el)) {
            <h3>{{ t('填寫欄位') }} <span class="type-tag">{{ t('文字') }}</span></h3>
            <label class="full">{{ t('內容') }}
              <textarea rows="4" [ngModel]="el.content" (ngModelChange)="patch(el, { content: $event })"></textarea>
            </label>
          } @else {
            <div class="hint">{{ t('此欄位不開放修改。') }}</div>
          }
        } @else {
          <div class="hint">
            {{ state.viewMode() ? t('唯讀檢視：內容不可修改。') : t('點選畫布上綠色虛線標示的欄位即可填寫。') }}
          </div>
        }
      } @else if (state.selected(); as el) {
        <h3>{{ t('屬性') }} <span class="type-tag">{{ t(typeName(el.type)) }}</span>
          <span class="band-tag" [title]="t('依 Y 座標判定；移動元素跨過虛線會換區')">{{ bandOf(el) }}</span></h3>
        <!-- 多選時要講清楚面板在編誰：只顯示最後選到的那個屬性，但對齊/分佈作用在全部。
             不說的話使用者以為只選到一個（儲存格多選有寫「已選 N 格」，兩邊要一致）。 -->
        @if (state.selectedIds().length > 1) {
          <div class="multi-note">{{ t('已選 {n} 個元素——下方屬性只套用到這一個；上方對齊/分佈作用於全部。', { n: state.selectedIds().length }) }}</div>
        }

        <!-- 標籤可左右拖曳調整數值（Figma 式 scrub；指標鎖定可無限拖） -->
        <div class="grid4">
          <label [appScrub]="el.x" (scrubChange)="patch(el, { x: $event })">{{ t('X（{unit}）', { unit: state.rulerUnit() }) }}
            <input type="number" [ngModel]="state.ptToDisp(el.x)" (ngModelChange)="patch(el, { x: state.dispToPt(num($event)) })" /></label>
          <label [appScrub]="el.y" (scrubChange)="patch(el, { y: $event })">{{ t('Y（{unit}）', { unit: state.rulerUnit() }) }}
            <input type="number" [ngModel]="state.ptToDisp(el.y)" (ngModelChange)="patch(el, { y: state.dispToPt(num($event)) })" /></label>
          <label [appScrub]="el.width" [scrubMin]="1" (scrubChange)="scrubSize(el, { width: $event })">{{ t('寬（{unit}）', { unit: state.rulerUnit() }) }}
            <input type="number" [ngModel]="state.ptToDisp(el.width)" [disabled]="el.type === 'table'"
              (ngModelChange)="patch(el, { width: numMin(state.dispToPt(num($event)), 1) })" /></label>
          <label [appScrub]="el.height" [scrubMin]="0" (scrubChange)="scrubSize(el, { height: $event })">{{ t('高（{unit}）', { unit: state.rulerUnit() }) }}
            <input type="number" [ngModel]="state.ptToDisp(el.height)" [disabled]="el.type === 'table'"
              (ngModelChange)="patch(el, { height: numMin(state.dispToPt(num($event)), 0) })" /></label>
        </div>
        <label class="rot" [appScrub]="el.rotation ?? 0" [scrubStep]="1" (scrubChange)="patch(el, { rotation: $event })">{{ t('旋轉（°）') }}
          <input type="number" step="1" [ngModel]="el.rotation ?? 0" (ngModelChange)="patch(el, { rotation: num($event) })" />
        </label>

        @switch (el.type) {
          @case ('text') {
            <label class="full">{{ t('內容') }}
              <textarea rows="3" [ngModel]="el.content" (ngModelChange)="patch(el, { content: $event })"></textarea>
            </label>
            <div class="hint">{{ t('可混排資料：') }}<b>{{ '{' }}{{ '{' }}customer.name{{ '}' }}{{ '}' }}</b>、<b>{{ '{' }}{{ '{' }}total|comma{{ '}' }}{{ '}' }}</b>{{ t('（格式：comma/comma(2)/round(2)/twUpper/rocDate/rocDateLong）、') }}<b>{{ '{' }}{{ '{' }}$page{{ '}' }}{{ '}' }}</b>/<b>{{ '{' }}{{ '{' }}$sum(items.amount){{ '}' }}{{ '}' }}</b>{{ t(' 等引擎 key 皆可。') }}</div>
            <!-- 這裡已在「非受限」分支內（見上方 @if (state.restricted())），不需再判斷一次 -->
            <label class="chk full">
              <input type="checkbox" [ngModel]="!!el.fillable" (ngModelChange)="patchAllSelected(el, { fillable: $event })" />
              {{ t('允許在') }}<b>{{ t('填寫模式') }}</b>{{ t('修改') }}
            </label>
            <div class="hint">{{ t('勾選後，嵌入的填寫模式（mode=fill）使用者只能改這些欄位的文字，其餘一律動不了（後端強制）。多選時可一次勾起來。') }}</div>
            <app-text-style-form [el]="el" />
          }
          @case ('barcode') {
            <label class="full">{{ t('條碼類型') }}
              <select [ngModel]="el.symbology" (ngModelChange)="patch(el, { symbology: $event })">
                <option value="code128">Code 128</option>
                <option value="code39">{{ t('Code 39（超商三段條碼）') }}</option>
                <option value="ean13">EAN-13</option>
                <option value="qr">QR Code</option>
              </select>
            </label>
            <label class="full">{{ t('資料 key（綁定資料，留空用靜態值）') }}
              <input [ngModel]="el.key" (ngModelChange)="patch(el, { key: $event })" [placeholder]="t('例：payment.barcode1')" />
            </label>
            @if (el.key) {
              <label class="full">{{ t('範例值') }}
                <input [ngModel]="el.sample" (ngModelChange)="patch(el, { sample: $event })" />
              </label>
            } @else {
              <label class="full">{{ t('靜態內容') }}
                <input [ngModel]="el.content" (ngModelChange)="patch(el, { content: $event })" />
              </label>
            }
            @if (el.symbology !== 'qr') {
              <label class="row"><input type="checkbox" [ngModel]="el.showText" (ngModelChange)="patch(el, { showText: $event })" /> {{ t('下方顯示人讀文字') }}</label>
            }
            <div class="hint">{{ t('Code 39 僅支援數字、大寫英文與 - . $ / + % 空白（內容會自動轉大寫）；EAN-13 需 12~13 位數字。') }}</div>
          }
          @case ('container') {
            <label class="full">{{ t('標題') }}
              <input [ngModel]="el.title" (ngModelChange)="patch(el, { title: $event })" [placeholder]="t('例：繳費資訊')" />
            </label>
            <div class="grid2">
              <label>{{ t('邊框寬') }} <input type="number" step="0.5" min="0" [ngModel]="el.borderWidth" (ngModelChange)="patch(el, { borderWidth: num($event) })" /></label>
              <label>{{ t('邊框色') }} <input type="color" [ngModel]="el.borderColor" (ngModelChange)="patch(el, { borderColor: $event })" /></label>
            </div>
            <label class="row">
              <input type="checkbox" [ngModel]="el.borderWidth === 0"
                (ngModelChange)="patch(el, { borderWidth: $event ? 0 : 1 })" /> {{ t('外框透明（不畫框線，畫布以虛線輔助）') }}
            </label>
            <label class="row">
              <input type="checkbox" [ngModel]="el.fillColor !== null"
                (ngModelChange)="patch(el, { fillColor: $event ? '#f8fafc' : null })" /> {{ t('底色') }}
            </label>
            @if (el.fillColor !== null) {
              <label>{{ t('底色') }} <input type="color" [ngModel]="el.fillColor" (ngModelChange)="patch(el, { fillColor: $event })" /></label>
            }
            <div class="hint">{{ t('選取容器時從元件盤新增元素，會直接加進容器；子元素座標相對於容器。跨頁時容器整組不拆分。') }}</div>
          }
          @case ('list') {
            <label class="full">{{ t('資料陣列 key（渲染時對此陣列每筆蓋一次）') }}
              <input [ngModel]="el.key" (ngModelChange)="patch(el, { key: $event })" [placeholder]="t('例：orders（巢狀時用 lines）')" />
            </label>
            <div class="grid2">
              <label [appScrub]="el.gap ?? 0" [scrubMin]="0" (scrubChange)="patch(el, { gap: $event })"
                (scrubStart)="state.gapPreview.set(el.id)" (scrubEnd)="state.gapPreview.set(null)">{{ t('筆間距（pt）') }}
                <input type="number" step="1" min="0" [ngModel]="el.gap ?? 0" (ngModelChange)="patch(el, { gap: numMin(num($event), 0) })"
                  (focus)="state.gapPreview.set(el.id)" (blur)="state.gapPreview.set(null)" /></label>
              <div class="hint">{{ t('調整時畫布會出現半透明的第 2、3 筆示意，看得出每筆的落點。') }}</div>
              <label>{{ t('無資料範例筆數') }}
                <input type="number" step="1" min="1" [ngModel]="el.sampleCount ?? 1" (ngModelChange)="patch(el, { sampleCount: numMin(num($event), 1) })" /></label>
            </div>
            <div class="hint">
              {{ t('選取重複區塊時從元件盤新增元素，會直接加進「一筆」的版面；子元素座標相對於區塊左上角，') }}
              <b>{{ t('「高」＝一筆的高度') }}</b>{{ t('。子元素的 key ') }}<b>{{ t('相對當筆陣列元素') }}</b>{{ t('（例：') }}<b>name</b>、<b>qty</b>{{ t('），要取外層當筆用 ') }}<b>$parent.{{ t('欄位') }}</b>{{ t('；全域彙總 ') }}<b>$sum({{ t('路徑') }})</b>{{ t(' 仍對整份資料。巢狀明細：把另一個「重複區塊」放進來（在畫布內拖入），綁子陣列 key（例 lines）。上限兩層。') }}
            </div>
          }
          @case ('image') {
            <div class="sub">{{ t('圖片來源（三選一；優先序：動態 key > 固定連結 > 上傳）') }}</div>
            <button class="merge" (click)="pickElementImage(el)">{{ el.assetId ? t('更換上傳圖片…') : t('上傳圖片…') }}</button>
            <label class="full">{{ t('固定圖片連結（靜態 URL）') }}
              <input [ngModel]="el.url ?? ''" (ngModelChange)="patch(el, { url: $event || undefined })"
                placeholder="https://…/logo.png" />
            </label>
            <label class="full">{{ t('動態圖片 key（渲染資料的值 = 圖片 URL）') }}
              <input [ngModel]="el.key ?? ''" (ngModelChange)="patch(el, { key: $event || undefined })"
                [placeholder]="t('例：customer.logoUrl')" />
            </label>
            @if (el.key) {
              <label class="full">{{ t('範例 URL（畫布預覽用）') }}
                <input [ngModel]="el.sample ?? ''" (ngModelChange)="patch(el, { sample: $event || undefined })"
                  placeholder="https://…/logo.png" />
              </label>
              <div class="hint">{{ t('渲染時資料中該 key 的值需為可訪問的圖片 URL（http/https，PNG/JPEG，10MB 內），引擎當場抓取嵌入；抓取失敗發警告（strict 模式會擋）。') }}</div>
            }
            <label class="full">{{ t('縮放模式') }}
              <select [ngModel]="el.fit" (ngModelChange)="patch(el, { fit: $event })">
                <option value="contain">{{ t('contain（等比置中）') }}</option>
                <option value="stretch">{{ t('stretch（填滿）') }}</option>
              </select>
            </label>
          }
          @case ('rect') {
            <div class="grid2">
              <label>{{ t('形狀') }}
                <select [ngModel]="el.shape ?? 'rect'" (ngModelChange)="patch(el, { shape: $event === 'rect' ? undefined : $event })">
                  <option value="rect">{{ t('矩形') }}</option>
                  <option value="ellipse">{{ t('橢圓 / 圓') }}</option>
                </select>
              </label>
              @if ((el.shape ?? 'rect') === 'rect') {
                <label [appScrub]="radiusOf(el, 0)" [scrubMin]="0"
                  (scrubChange)="setUniformRadius(el, $event)">{{ t('圓角') }}
                  <span class="radius-row">
                    <input type="number" min="0" step="1" [ngModel]="uniformRadiusValue(el)"
                      [placeholder]="uniformRadiusValue(el) === null ? t('混合') : '0'"
                      (ngModelChange)="setUniformRadius(el, $event)" />
                    <button class="radius-toggle" [class.on]="perCorner()" [title]="t('分別設定四角')"
                      (click)="perCorner.set(!perCorner())">⛶</button>
                  </span>
                </label>
              }
            </div>
            @if ((el.shape ?? 'rect') === 'rect' && perCorner()) {
              <div class="grid2 radius-grid">
                <label [appScrub]="radiusOf(el, 0)" [scrubMin]="0" (scrubChange)="setCornerRadius(el, 'tl', $event)">◜ {{ t('左上') }}
                  <input type="number" min="0" step="1" [ngModel]="radiusOf(el, 0)"
                    (ngModelChange)="setCornerRadius(el, 'tl', num($event))" /></label>
                <label [appScrub]="radiusOf(el, 1)" [scrubMin]="0" (scrubChange)="setCornerRadius(el, 'tr', $event)">◝ {{ t('右上') }}
                  <input type="number" min="0" step="1" [ngModel]="radiusOf(el, 1)"
                    (ngModelChange)="setCornerRadius(el, 'tr', num($event))" /></label>
                <label [appScrub]="radiusOf(el, 3)" [scrubMin]="0" (scrubChange)="setCornerRadius(el, 'bl', $event)">◟ {{ t('左下') }}
                  <input type="number" min="0" step="1" [ngModel]="radiusOf(el, 3)"
                    (ngModelChange)="setCornerRadius(el, 'bl', num($event))" /></label>
                <label [appScrub]="radiusOf(el, 2)" [scrubMin]="0" (scrubChange)="setCornerRadius(el, 'br', $event)">◞ {{ t('右下') }}
                  <input type="number" min="0" step="1" [ngModel]="radiusOf(el, 2)"
                    (ngModelChange)="setCornerRadius(el, 'br', num($event))" /></label>
              </div>
            }
            <div class="grid2">
              <label>{{ t('框線色') }} <input type="color" [ngModel]="el.strokeColor" (ngModelChange)="patch(el, { strokeColor: $event })" /></label>
              <label>{{ t('框線寬') }} <input type="number" step="0.5" [ngModel]="el.strokeWidth" (ngModelChange)="patch(el, { strokeWidth: num($event) })" /></label>
            </div>
            <label class="full">{{ t('框線型') }}
              <select [ngModel]="el.lineStyle ?? 'solid'" (ngModelChange)="patch(el, { lineStyle: $event === 'solid' ? undefined : $event })">
                <option value="solid">{{ t('實線') }}</option>
                <option value="dashed">{{ t('虛線 ┄') }}</option>
                <option value="dotted">{{ t('點線 ┈') }}</option>
              </select>
            </label>
            <label class="row">
              <input type="checkbox" [ngModel]="el.strokeWidth === 0"
                (ngModelChange)="patch(el, { strokeWidth: $event ? 0 : 1 })" /> {{ t('外框透明（只留填色）') }}
            </label>
            <label class="row">
              <input type="checkbox" [ngModel]="el.fillColor !== null"
                (ngModelChange)="patch(el, { fillColor: $event ? '#eeeeee' : null })" /> {{ t('填色') }}
            </label>
            @if (el.fillColor !== null) {
              <label>{{ t('填色') }} <input type="color" [ngModel]="el.fillColor" (ngModelChange)="patch(el, { fillColor: $event })" /></label>
            }
          }
          @case ('line') {
            <div class="grid2">
              <label>{{ t('線色') }} <input type="color" [ngModel]="el.strokeColor" (ngModelChange)="patch(el, { strokeColor: $event })" /></label>
              <label>{{ t('線寬') }} <input type="number" step="0.5" [ngModel]="el.strokeWidth" (ngModelChange)="patch(el, { strokeWidth: num($event) })" /></label>
            </div>
            <label class="full">{{ t('線型') }}
              <select [ngModel]="el.lineStyle ?? 'solid'" (ngModelChange)="patch(el, { lineStyle: $event === 'solid' ? undefined : $event })">
                <option value="solid">{{ t('實線') }}</option>
                <option value="dashed">{{ t('虛線 ┄') }}</option>
                <option value="dotted">{{ t('點線 ┈') }}</option>
              </select>
            </label>
          }
          @case ('table') {
            <div class="grid2">
              <label>{{ t('列數') }} <input type="number" min="1" [ngModel]="el.rowHeights.length"
                (ngModelChange)="state.resizeTable(el.id, num($event), el.columnWidths.length)" /></label>
              <label>{{ t('欄數') }} <input type="number" min="1" [ngModel]="el.columnWidths.length"
                (ngModelChange)="state.resizeTable(el.id, el.rowHeights.length, num($event))" /></label>
              <label>{{ t('框線寬') }} <input type="number" step="0.5" [ngModel]="el.borderWidth" (ngModelChange)="patch(el, { borderWidth: num($event) })" /></label>
              <label>{{ t('框線色') }} <input type="color" [ngModel]="el.borderColor" (ngModelChange)="patch(el, { borderColor: $event })" /></label>
              <label>{{ t('字級') }} <input type="number" min="1" [ngModel]="el.fontSize" (ngModelChange)="patch(el, { fontSize: numMin($event, 1) })" /></label>
              <label>{{ t('內距') }} <input type="number" [ngModel]="el.cellPadding" (ngModelChange)="patch(el, { cellPadding: num($event) })" /></label>
            </div>
            <label class="row">
              <input type="checkbox" [ngModel]="el.borderWidth === 0"
                (ngModelChange)="patch(el, { borderWidth: $event ? 0 : 1 })" /> {{ t('框線透明（不畫格線，畫布以虛線輔助）') }}
            </label>
            <label class="full">{{ t('字型') }}
              <select [ngModel]="el.fontFamily ?? 'sans'" (ngModelChange)="patch(el, { fontFamily: $event })">
                @for (f of fontFamilies; track f.value) { <option [value]="f.value">{{ t(f.label) }}</option> }
                @for (f of fontSvc.fonts(); track f.id) { <option [value]="f.id">{{ t('{name}（匯入）', { name: f.name }) }}</option> }
              </select>
            </label>
            <div class="sub">{{ t('陣列迴圈（報表重複列）') }}</div>
            <label class="row">
              <input type="checkbox" [ngModel]="el.repeat?.enabled ?? false"
                (ngModelChange)="toggleRepeat(el, $event)" /> {{ t('啟用：某一列依陣列資料重複') }}
            </label>
            @if (el.repeat?.enabled) {
              <label class="full">{{ t('陣列 key') }}
                <input [ngModel]="el.repeat!.key" (ngModelChange)="patchRepeat(el, { key: $event })" [placeholder]="t('例：items')" />
              </label>
              <label>{{ t('重複列（第幾列）') }}
                <input type="number" min="1" [max]="el.rowHeights.length"
                  [ngModel]="el.repeat!.rowIndex + 1"
                  (ngModelChange)="patchRepeat(el, { rowIndex: num($event) - 1 })" />
              </label>
              <div class="hint">{{ t('重複列的儲存格 key 用「相對路徑」（例：name、qty）；渲染時該列依陣列筆數展開，下方元素自動往下推。序號用 $row。') }}<b>{{ t('變更重複列位置時，已綁 key 的儲存格不會自動搬移') }}</b>{{ t('——請確認相對 key 位於新的重複列上。') }}</div>
              <label class="full">{{ t('群組欄位（相對路徑，留空不分組）') }}
                <input [ngModel]="el.repeat!.groupBy ?? ''" (ngModelChange)="patchRepeat(el, { groupBy: $event })" [placeholder]="t('例：category')" />
              </label>
              @if (el.repeat!.groupBy) {
                <div class="grid2">
                  <label>{{ t('群組首列（第幾列，0=無）') }}
                    <input type="number" min="0" [max]="el.rowHeights.length"
                      [ngModel]="(el.repeat!.groupHeaderRowIndex ?? -1) + 1"
                      (ngModelChange)="patchRepeat(el, { groupHeaderRowIndex: num($event) >= 1 ? num($event) - 1 : null })" />
                  </label>
                  <label>{{ t('群組尾列（第幾列，0=無）') }}
                    <input type="number" min="0" [max]="el.rowHeights.length"
                      [ngModel]="(el.repeat!.groupFooterRowIndex ?? -1) + 1"
                      (ngModelChange)="patchRepeat(el, { groupFooterRowIndex: num($event) >= 1 ? num($event) - 1 : null })" />
                  </label>
                </div>
                <div class="hint">{{ t('群組首/尾列每組各插一次：相對 key 以該組第一筆解析（可放群組名稱）；小計用 $gsum(欄位)、$gcount、$gavg(欄位)。資料需先按群組欄位排序。') }}</div>
              }
            }
            <div class="sub">{{ t('欄寬（pt）') }}</div>
            <div class="chips">
              @for (w of el.columnWidths; track $index; let i = $index) {
                <input class="chip" type="number" [ngModel]="w" (ngModelChange)="setColWidth(el, i, num($event))" />
              }
            </div>
            <div class="sub">{{ t('列高（pt）') }}</div>
            <div class="chips">
              @for (h of el.rowHeights; track $index; let i = $index) {
                <input class="chip" type="number" [ngModel]="h" (ngModelChange)="setRowHeight(el, i, num($event))" />
              }
            </div>
            @if (selectedTableCell(); as cell) {
              <div class="cell-editor">
                @if (cellCount() > 1) {
                  <div class="sub">{{ t('儲存格（已選 {n} 格）', { n: cellCount() }) }}</div>
                  <div class="hint">{{ t('樣式（對齊/粗體/字級/顏色/背景色）一次套用到選取範圍。') }}</div>
                } @else {
                  <div class="sub">{{ t('儲存格 ({r}, {c})', { r: state.selectedCell()!.row + 1, c: state.selectedCell()!.col + 1 }) }}</div>
                }
                @if (cellCount() === 1) {
                  <label class="full">{{ t('類型') }}
                    <select [ngModel]="cell.kind" (ngModelChange)="patchCell(el, { kind: $event })">
                      <option value="text">{{ t('靜態文字') }}</option>
                      <option value="image">{{ t('圖片') }}</option>
                      <option value="barcode">{{ t('條碼') }}</option>
                    </select>
                  </label>
                  @if (cell.kind === 'barcode') {
                    <label class="full">{{ t('條碼類型') }}
                      <select [ngModel]="cell.symbology ?? 'code128'" (ngModelChange)="patchCell(el, { symbology: $event })">
                        <option value="code128">Code 128</option>
                        <option value="code39">{{ t('Code 39（超商三段條碼）') }}</option>
                        <option value="ean13">EAN-13</option>
                        <option value="qr">QR Code</option>
                      </select>
                    </label>
                    <label class="full">{{ t('資料 key（綁定資料，留空用靜態值；重複列內用相對 key）') }}
                      <input [ngModel]="cell.key" (ngModelChange)="patchCell(el, { key: $event })"
                        [placeholder]="t('例：payment.barcode1')" />
                    </label>
                    @if (cell.key) {
                      <label class="full">{{ t('範例值') }}
                        <input [ngModel]="cell.sample" (ngModelChange)="patchCell(el, { sample: $event })" />
                      </label>
                    } @else {
                      <label class="full">{{ t('靜態內容') }}
                        <input [ngModel]="cell.value" (ngModelChange)="patchCell(el, { value: $event })" />
                      </label>
                    }
                    @if (cell.symbology !== 'qr') {
                      <label class="row"><input type="checkbox" [ngModel]="cell.showText ?? false"
                        (ngModelChange)="patchCell(el, { showText: $event })" /> {{ t('下方顯示人讀文字') }}</label>
                    }
                    <div class="hint">{{ t('條碼以等比置入格內（QR 為正方形置中）；重複列內每列依資料產生各自的條碼。') }}</div>
                  } @else if (cell.kind === 'image') {
                    <button class="merge" (click)="pickCellImage(el)">{{ cell.assetId ? t('更換圖片…') : t('選擇圖片…') }}</button>
                    <label class="full">{{ t('固定圖片連結（靜態 URL）') }}
                      <input [ngModel]="cell.url ?? ''" (ngModelChange)="patchCell(el, { url: $event || undefined })"
                        placeholder="https://…/logo.png" />
                    </label>
                    <label class="full">{{ t('動態圖片 key（渲染資料的值 = 圖片 URL）') }}
                      <input [ngModel]="cell.key" (ngModelChange)="patchCell(el, { key: $event })"
                        [placeholder]="t('例：photoUrl（重複列內用相對 key）')" />
                    </label>
                    @if (cell.key) {
                      <label class="full">{{ t('範例 URL（畫布預覽用）') }}
                        <input [ngModel]="cell.sample" (ngModelChange)="patchCell(el, { sample: $event })"
                          placeholder="https://…/photo.png" />
                      </label>
                    }
                    <div class="hint">{{ t('也可以直接把元件盤的「圖片」拖到儲存格上。key 綁定時渲染資料的值需為圖片 URL（重複列每列可不同圖）。圖片以等比縮放置入格內。') }}</div>
                  } @else if (cell.kind === 'text') {
                    <label class="full">{{ t('文字') }} <input [ngModel]="cell.value" (ngModelChange)="patchCell(el, { value: $event })" /></label>
                    <div class="hint">{{ t('可混排資料：') }}{{ '{' }}{{ '{' }}name{{ '}' }}{{ '}' }}、{{ '{' }}{{ '{' }}amt|comma{{ '}' }}{{ '}' }}{{ t('——重複列內用相對路徑；序號 $row；小計 $gsum(欄位)/$gcount；總計 $sum(items.欄位)。') }}</div>
                    <label class="chk full">
                      <input type="checkbox" [ngModel]="!!cell.fillable"
                        (ngModelChange)="patchCellStyle(el, { fillable: $event || undefined })" />
                      {{ t('允許在') }}<b>{{ t('填寫模式') }}</b>{{ t('修改此格') }}
                    </label>
                  }
                }
                <div class="grid2">
                  <label>{{ t('水平對齊') }}
                    <select [ngModel]="cell.align" (ngModelChange)="patchCellStyle(el, { align: $event })">
                      <option value="left">{{ t('左') }}</option><option value="center">{{ t('中') }}</option><option value="right">{{ t('右') }}</option>
                    </select>
                  </label>
                  <label>{{ t('垂直對齊') }}
                    <select [ngModel]="cell.vAlign ?? 'middle'"
                      (ngModelChange)="patchCellStyle(el, { vAlign: $event === 'middle' ? undefined : $event })">
                      <option value="top">{{ t('上') }}</option><option value="middle">{{ t('中') }}</option><option value="bottom">{{ t('下') }}</option>
                    </select>
                  </label>
                </div>
                <label class="row"><input type="checkbox" [ngModel]="cell.bold" (ngModelChange)="patchCellStyle(el, { bold: $event })" /> {{ t('粗體') }}</label>
                <label class="row"><input type="checkbox" [ngModel]="!!cell.italic" (ngModelChange)="patchCellStyle(el, { italic: $event })" /> {{ t('斜體') }}</label>
                <label class="row">
                  <input type="checkbox" [ngModel]="cell.wrap ?? false"
                    (ngModelChange)="patchCellStyle(el, { wrap: $event || undefined })" /> {{ t('自動換行（列高自動延伸）') }}
                </label>
                @if (cell.wrap) {
                  <div class="hint">{{ t('內容超寬時換行、該列列高自動增加（適合長說明欄）；未勾選 = 單行裁切加「…」。實際列高以預覽/PDF 為準。') }}</div>
                }
                <label class="full">{{ t('字級（0 = 用表格）') }}
                  <input type="number" min="0" [ngModel]="cell.fontSize ?? 0"
                    (ngModelChange)="patchCellStyle(el, { fontSize: num($event) > 0 ? num($event) : undefined })" />
                </label>
                <div class="grid2">
                  <label>{{ t('文字顏色') }}
                    <span class="colorrow">
                      <input type="color" [ngModel]="cell.color || '#000000'"
                        (ngModelChange)="patchCellStyle(el, { color: $event })" />
                      @if (cell.color) {
                        <button class="clearcolor" [title]="t('還原預設（黑）')"
                          (click)="patchCellStyle(el, { color: undefined })">×</button>
                      }
                    </span>
                  </label>
                  <label>{{ t('背景色') }}
                    <span class="colorrow">
                      <input type="color" [ngModel]="cell.fillColor || '#ffffff'"
                        (ngModelChange)="patchCellStyle(el, { fillColor: $event })" />
                      @if (cell.fillColor) {
                        <button class="clearcolor" [title]="t('清除（透明）')"
                          (click)="patchCellStyle(el, { fillColor: undefined })">×</button>
                      }
                    </span>
                  </label>
                </div>
                <div class="sub">{{ t('框線（選取範圍）') }}</div>
                @if (el.borderWidth > 0) {
                  <div class="borderbtns">
                    <button [class.on]="state.selectionEdgeOn(el.id, 'top')" (click)="state.applyCellBorders(el.id, 'top')">{{ t('上框線') }}</button>
                    <button [class.on]="state.selectionEdgeOn(el.id, 'bottom')" (click)="state.applyCellBorders(el.id, 'bottom')">{{ t('下框線') }}</button>
                    <button [class.on]="state.selectionEdgeOn(el.id, 'left')" (click)="state.applyCellBorders(el.id, 'left')">{{ t('左框線') }}</button>
                    <button [class.on]="state.selectionEdgeOn(el.id, 'right')" (click)="state.applyCellBorders(el.id, 'right')">{{ t('右框線') }}</button>
                  </div>
                  <div class="borderbtns">
                    <button (click)="state.applyCellBorders(el.id, 'all')">{{ t('所有框線') }}</button>
                    <button (click)="state.applyCellBorders(el.id, 'outer')">{{ t('外框線') }}</button>
                    <button (click)="state.applyCellBorders(el.id, 'inner')">{{ t('內框線') }}</button>
                    <button (click)="state.applyCellBorders(el.id, 'none')">{{ t('無框線') }}</button>
                  </div>
                  <div class="borderbtns">
                    <button [class.on]="state.selectionDiagOn(el.id, 'diagDown')" (click)="state.applyCellBorders(el.id, 'diagDown')">╲ {{ t('左斜線') }}</button>
                    <button [class.on]="state.selectionDiagOn(el.id, 'diagUp')" (click)="state.applyCellBorders(el.id, 'diagUp')">╱ {{ t('右斜線') }}</button>
                  </div>
                  <div class="hint">{{ t('上下左右可切換選取範圍該側的線（亮 = 顯示中）；共用的線兩側都關掉才會消失。斜線可劃掉未使用的欄位。') }}</div>
                } @else {
                  <div class="hint">{{ t('表格框線寬為 0（框線透明），逐格框線無效——先把上方「框線寬」調大。') }}</div>
                }
                <div class="sub">{{ t('合併儲存格') }}</div>
                @if (state.selectedCellRange()) {
                  <button class="merge" (click)="mergeCells(el)"
                    [disabled]="!!mergeBlocked(el)"
                    [title]="mergeBlocked(el) ?? t('合併選取範圍')">{{ t('合併選取範圍') }}</button>
                  @if (mergeBlocked(el); as reason) { <div class="hint merge-blocked">⚠ {{ reason }}</div> }
                }
                @if ((cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1) {
                  <button class="merge" (click)="unmergeCell(el)">{{ t('取消合併（目前 {c}×{r}）', { c: cell.colSpan ?? 1, r: cell.rowSpan ?? 1 }) }}</button>
                }
                <div class="hint">{{ t('在表格上') }}<b>{{ t('按住拖曳') }}</b>{{ t('（或先點一格再 Shift+點選）框出範圍：可一次套樣式或合併；重複列內只能左右合併。移動表格請拖左上角 ✥ 手柄。') }}</div>
              </div>
            } @else {
              <div class="hint">{{ t('點儲存格可編輯內容；按住拖曳可框選範圍（同 Excel）。移動表格請拖選取後左上角的 ✥ 手柄。') }}</div>
            }
          }
        }

        <!-- 圖層（所有元素通用；容器子元素跟隨容器） -->
        @if (!state.parentOf(el.id)) {
          <div class="sub">{{ t('圖層') }}</div>
          <label class="row">
            <input type="checkbox" [ngModel]="el.aboveWatermark ?? false"
              (ngModelChange)="patch(el, { aboveWatermark: $event })" /> {{ t('置於浮水印之上') }}
          </label>
          <div class="hint">{{ t('浮水印設「蓋在內容上方」時，此元素仍顯示在浮水印之上——條碼、金額等不想被蓋的內容適用（新條碼預設開啟）。') }}</div>
        }

        <!-- 條件顯示（所有元素通用） -->
        <div class="sub">{{ t('條件顯示') }}</div>
        <label class="full">{{ t('依資料 key（留空 = 永遠顯示）') }}
          <input [ngModel]="el.visibleKey ?? ''" (ngModelChange)="patch(el, { visibleKey: $event })" [placeholder]="t('例：paid')" />
        </label>
        @if (el.visibleKey) {
          <div class="grid2">
            <label>{{ t('條件') }}
              <select [ngModel]="el.visibleOp ?? 'truthy'" (ngModelChange)="patch(el, { visibleOp: $event })">
                <option value="truthy">{{ t('有值/為真') }}</option>
                <option value="falsy">{{ t('無值/為假') }}</option>
                <option value="eq">{{ t('等於') }}</option>
                <option value="ne">{{ t('不等於') }}</option>
              </select>
            </label>
            @if (el.visibleOp === 'eq' || el.visibleOp === 'ne') {
              <label>{{ t('比較值') }} <input [ngModel]="el.visibleVal ?? ''" (ngModelChange)="patch(el, { visibleVal: $event })" /></label>
            }
          </div>
          <div class="hint">{{ t('隱藏時仍保留版面空間。key 與比較值可用 $page / $pages：例「$page 等於 1」＝只在第一頁；「$page 等於 $pages」＝只在最末頁。') }}</div>
        }

        <div class="actions">
          <button class="action" (click)="state.duplicateElement(el.id)">{{ t('複製') }}{{ el.type === 'container' ? t('容器（含子元素）') : '' }}</button>
          @if (state.parentOf(el.id)) {
            <button class="action" (click)="state.moveOutOfContainer(el.id)">{{ t('移出容器') }}</button>
          }
          <button class="danger" (click)="state.removeElement(el.id)">{{ t('刪除元素') }}</button>
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
    .multi-note { margin: -2px 0 8px; padding: 6px 8px; background: #eff6ff; border-left: 3px solid #2563eb;
      border-radius: 4px; color: #1e40af; font-size: 11.5px; line-height: 1.5; }
    /* 可填標記勾選（填寫模式權限）：綠色呼應畫布上的可填標示 */
    .chk { display: flex; flex-direction: row; align-items: center; gap: 6px; cursor: pointer;
      background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 6px 8px; color: #15803d; }
    .chk input { width: auto; margin: 0; }
    .actions { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .action { background: #e2e8f0; color: #1e293b; border: none; border-radius: 6px; padding: 8px; cursor: pointer; }
    .action:hover { background: #cbd5e1; }
    .danger { background: #dc2626; color: #fff; border: none; border-radius: 6px; padding: 8px; cursor: pointer; }
    .danger:hover { background: #b91c1c; }
  `,
})
export class PropertiesPanelComponent {
  protected readonly t = t;
  state = inject(EditorStateService);
  fontSvc = inject(FontService);
  private modal = inject(ModalService);

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

  /**
   * 受限模式用：目前選取的儲存格若是「可填的 text 格」就回傳它，否則 null。
   * 有選取範圍（多格）時一律不給編輯 —— 否則面板只顯示錨點的值，打字卻會影響其他格。
   */
  fillEditableCell(el: TemplateElement): TableCell | null {
    if (el.type !== 'table' || this.state.viewMode()) return null;
    if (this.state.selectedCellRange()) return null;
    const sel = this.state.selectedCell();
    const cell = sel ? el.cells[sel.row]?.[sel.col] : null;
    return this.state.canEditCell(cell) ? cell : null;
  }

  /** 受限模式填寫儲存格：只寫目前選取的那一格。 */
  setFillCell(el: TemplateElement, value: string) {
    const sel = this.state.selectedCell();
    if (!sel) return;
    this.state.setCellContent(el.id, sel.row, sel.col, value);
  }

  /** 套用到目前所有選取的元素（多選時批次設定，例如一次把數個文字標成可填）。 */
  patchAllSelected(el: TemplateElement, patch: ElementPatch) {
    const ids = this.state.selectedIds();
    const targets = ids.length > 1 && ids.includes(el.id) ? ids : [el.id];
    targets.forEach(id => this.state.patchElement(id, patch));
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
    if (err) void this.modal.alert({ title: t('無法合併儲存格'), message: err });
  }

  unmergeCell(el: TableElement) {
    const sc = this.state.selectedCell();
    if (sc) this.state.unmergeCell(el.id, sc.row, sc.col);
  }

  patchCell(el: TableElement, patch: Partial<TableCell>) {
    const sc = this.state.selectedCell();
    if (!sc) return;
    if (patch.kind !== undefined && patch.kind !== 'text' && patch.kind !== 'image' && patch.kind !== 'barcode') return; // 防呆

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
    if (sec.kind === 'single') return t('{name}（獨立頁）', { name: sec.name });
    const parent = this.state.parentOf(el.id);
    const y = parent ? parent.y : el.y;
    const page = this.state.activePage();
    if (y < page.headerHeight) return t('頁首（每頁重複）');
    if (y >= page.height - page.footerHeight) return t('頁尾（每頁重複）');
    return t('內文');
  }
}
