import { NewTemplateElement, emptyCell } from '../../core/models/template.model';

/** 元件盤可新增的元素動作（image 走檔案選擇流程，不在此處理） */
export type PaletteAction =
  | 'text' | 'placeholder' | 'table' | 'rect' | 'line' | 'barcode' | 'cvs3' | 'container';

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
        symbology: 'code39', content: '', key: 'barcode1', sample: 'A123456789', showText: true,
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
