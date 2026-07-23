import { BarcodeSymbology, NewTemplateElement, TableCell, TemplateElement, emptyCell, newId } from '../../core/models/template.model';

/** 元件盤可新增的元素動作 */
export type PaletteAction =
  | 'text' | 'placeholder' | 'image' | 'table' | 'rect' | 'line' | 'barcode' | 'cvs3' | 'container' | 'list';

/** 元件盤「條碼」的預設值（新元素與拖進儲存格共用，避免兩處 drift） */
const BARCODE_DEFAULTS = {
  symbology: 'code39' as BarcodeSymbology, // 收款單導向：超商條碼慣用 Code 39
  key: 'barcode1',
  sample: 'A123456789',
  showText: true,
};

/** 可拖進表格儲存格的元素型別（元件盤與畫布既有元素共用判斷） */
export function canDropIntoCell(type: TemplateElement['type'] | PaletteAction): boolean {
  return type === 'image' || type === 'barcode'; // cvs3 是三個元素的套件，不進單一格
}

/** 元件盤動作拖進儲存格時的儲存格 patch；不支援的動作回 null */
export function paletteToCellPatch(action: string): Partial<TableCell> | null {
  switch (action) {
    case 'image':
      // 佔位圖片格：來源（上傳/固定連結/動態 key）之後在屬性面板設定
      return { kind: 'image' };
    case 'barcode':
      return { kind: 'barcode', ...BARCODE_DEFAULTS, value: '' };
    default:
      return null;
  }
}

/** 既有畫布元素拖進儲存格時的儲存格 patch（繼承來源設定）；不支援的型別回 null */
export function elementToCellPatch(el: TemplateElement): Partial<TableCell> | null {
  switch (el.type) {
    case 'image':
      return {
        kind: 'image',
        assetId: el.assetId, url: el.url,
        key: el.key ?? '', sample: el.sample ?? '',
      };
    case 'barcode':
      return {
        kind: 'barcode',
        symbology: el.symbology, showText: el.showText,
        key: el.key, sample: el.sample, value: el.content,
      };
    default:
      return null;
  }
}

/**
 * 依元件盤動作產生預設元素（純函式）。
 * baseY 為內文區起點附近的建議位置；cvs3（超商三段條碼）會回傳三個元素。
 */
export function createElements(action: PaletteAction, baseY: number): NewTemplateElement[] {
  switch (action) {
    case 'text':
      return [{
        type: 'text', x: 40, y: baseY, width: 200, height: 24,
        content: '文字內容', fontSize: 14, color: '#000000', align: 'left', lineHeight: 1.2, bold: false,
      }];
    case 'placeholder':
      return [{
        type: 'placeholder', x: 40, y: baseY + 30, width: 160, height: 20,
        key: 'field1', sample: '範例值', fontSize: 12, color: '#000000', align: 'left', lineHeight: 1.2, bold: false,
      }];
    case 'image':
      // 佔位圖片：來源（上傳檔案或綁定圖片 URL）之後在屬性面板設定
      return [{
        type: 'image', x: 40, y: baseY + 30, width: 120, height: 90,
        assetId: '', fit: 'contain',
      }];
    case 'table':
      return [{
        type: 'table', x: 40, y: baseY + 60, width: 270, height: 72,
        columnWidths: [90, 90, 90], rowHeights: [24, 24, 24],
        borderColor: '#000000', borderWidth: 1, fontSize: 10, cellPadding: 4,
        cells: [
          [{ ...emptyCell(), value: '欄位1', bold: true, align: 'center' },
           { ...emptyCell(), value: '欄位2', bold: true, align: 'center' },
           { ...emptyCell(), value: '欄位3', bold: true, align: 'center' }],
          [emptyCell(), emptyCell(), emptyCell()],
          [emptyCell(), emptyCell(), emptyCell()],
        ],
      }];
    case 'rect':
      return [{
        type: 'rect', x: 40, y: baseY + 150, width: 160, height: 80,
        strokeColor: '#000000', strokeWidth: 1, fillColor: null,
      }];
    case 'line':
      return [{
        type: 'line', x: 40, y: baseY + 250, width: 200, height: 0,
        strokeColor: '#000000', strokeWidth: 1,
      }];
    case 'barcode':
      return [{
        type: 'barcode', x: 40, y: baseY + 100, width: 180, height: 50,
        content: '', ...BARCODE_DEFAULTS,
        aboveWatermark: true, // 條碼被浮水印蓋住會刷不出來，預設置頂
      }];
    case 'cvs3': {
      // 超商三段條碼：三條 Code39 直向堆疊（繳費期限段 / 帳號段 / 代收別+金額段）
      const samples = ['09902231104', '3453011508028023', '060615000001000'];
      return samples.map((sample, i) => ({
        type: 'barcode' as const, x: 40, y: baseY + i * 58, width: 200, height: 44,
        symbology: 'code39' as const, content: '', key: `payment.barcode${i + 1}`, sample, showText: true,
        aboveWatermark: true,
      }));
    }
    case 'container':
      return [{
        type: 'container', x: 40, y: baseY, width: 240, height: 130,
        title: '區塊', borderWidth: 1, borderColor: '#94a3b8', fillColor: null, children: [],
      }];
    case 'list':
      // 重複區塊：綁陣列 key，內含一筆的自由版面。預設放一個相對 key 的資料欄位起手。
      return [{
        type: 'list', x: 40, y: baseY, width: 320, height: 28, key: 'items', gap: 4,
        children: [{
          id: newId(), type: 'placeholder', x: 8, y: 5, width: 160, height: 18,
          key: 'name', sample: '範例', fontSize: 12, color: '#000000', align: 'left', lineHeight: 1.2, bold: false,
        }],
      }];
  }
}

/** 資料分頁拖曳 payload（application/x-datakey） */
export interface DataKeyPayload {
  kind: 'scalar' | 'array';
  key: string;
  sample?: string;
  fields?: { key: string; sample: string }[];
}

/** 從資料 key 生成資料欄位元素（拖曳資料分頁的 scalar 節點） */
export function placeholderFromData(key: string, sample: string): NewTemplateElement {
  return {
    type: 'placeholder', x: 0, y: 0, width: 140, height: 18,
    key, sample: sample || '範例',
    fontSize: 12, color: '#000000', align: 'left', lineHeight: 1.2, bold: false,
  };
}

/** 從陣列 key 生成重複列表格（表頭列 + 相對 key 的重複列；欄數上限 8） */
export function tableFromArray(key: string, fields: { key: string; sample: string }[]): NewTemplateElement {
  const cols = fields.slice(0, 8);
  const colW = 90;
  return {
    type: 'table', x: 0, y: 0,
    width: colW * cols.length, height: 50,
    columnWidths: cols.map(() => colW), rowHeights: [25, 25],
    borderColor: '#000000', borderWidth: 1, fontSize: 10, cellPadding: 4,
    repeat: { enabled: true, key, rowIndex: 1 },
    cells: [
      cols.map(f => ({ ...emptyCell(), value: f.key, align: 'center' as const, bold: true })),
      cols.map(f => ({ ...emptyCell(), kind: 'placeholder' as const, key: f.key, sample: f.sample })),
    ],
  };
}
