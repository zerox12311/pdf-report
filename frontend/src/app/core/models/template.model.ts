// 樣板 JSON schema —— 與後端 Models/TemplateModels.cs 對應，兩邊需同步修改
export interface TemplateDoc {
  id: string;
  name: string;
  version: number;
  updatedAt?: string;
  /** 文件預設紙張（新節的預設值）＋浮水印（全文件每頁） */
  page: PageSettings;
  /**
   * 節清單（有序，至少一節）：每節有自己的紙張/方向與內容，依序輸出、節間必換頁。
   * $page/$pages 全文件連續。舊格式（elements/cover/backPage）由 normalize 遷移。
   */
  sections: DocSection[];
}

/** 一節：flow = 有頁首/頁尾 band、內容自動分頁；single = 獨立一頁（無 band） */
export interface DocSection {
  id: string;
  name: string;
  kind: 'flow' | 'single';
  /** 節的紙張；null = 跟隨文件預設 page */
  page: SectionPage | null;
  /** band 高度（僅 flow 有意義） */
  headerHeight: number;
  footerHeight: number;
  /** 浮水印：inherit 跟隨文件（預設）｜none 此節不顯示｜custom 用 watermark 欄位 */
  watermarkMode: 'inherit' | 'none' | 'custom';
  /** watermarkMode = custom 時的節專屬浮水印 */
  watermark: Watermark | null;
  elements: TemplateElement[];
}

/** 節的有效浮水印（套用節的覆寫模式） */
export function sectionWatermark(t: TemplateDoc, s: DocSection): Watermark | null {
  switch (s.watermarkMode) {
    case 'none': return null;
    case 'custom': return s.watermark;
    default: return t.page.watermark ?? null;
  }
}

export interface SectionPage {
  size: string;
  orientation: 'portrait' | 'landscape';
  width: number;
  height: number;
}

/** 舊格式的獨立頁欄位（僅 normalize 讀入用） */
interface LegacyPageSection {
  enabled?: boolean;
  elements?: TemplateElement[];
}

/** normalize 的輸入：現行格式或含舊欄位的格式 */
export type TemplateInput = Partial<TemplateDoc> & {
  elements?: TemplateElement[];
  cover?: LegacyPageSection | null;
  backPage?: LegacyPageSection | null;
};

/** 節的有效頁面設定（套用節覆寫；single 節無 band） */
export function sectionPage(t: TemplateDoc, s: DocSection): PageSettings {
  return {
    ...t.page,
    size: s.page?.size ?? t.page.size,
    orientation: s.page?.orientation ?? t.page.orientation,
    width: s.page?.width ?? t.page.width,
    height: s.page?.height ?? t.page.height,
    headerHeight: s.kind === 'flow' ? s.headerHeight : 0,
    footerHeight: s.kind === 'flow' ? s.footerHeight : 0,
  };
}

export interface PageSettings {
  size: string;
  orientation: 'portrait' | 'landscape';
  width: number;   // pt
  height: number;  // pt
  /** 頁首 band 高度（pt）：設計 y < headerHeight 的元素每頁重複。0 = 無頁首 */
  headerHeight: number;
  /** 頁尾 band 高度（pt）：設計 y >= height - footerHeight 的元素每頁重複。0 = 無頁尾 */
  footerHeight: number;
  /** 頁面邊界（pt，設計輔助線＋吸附目標；不影響渲染，0 = 不顯示） */
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  /** 每頁背景浮水印 */
  watermark?: Watermark | null;
}

export interface Watermark {
  enabled: boolean;
  text: string;
  /** 選填：資料綁定（有值時取代 text，例如 status = 作廢） */
  key: string;
  fontSize: number;
  color: string;
  /** 旋轉角度（度）；舊樣板的 diagonal:true 由 normalize 轉成 45 */
  rotation: number;
  /** 滿版平鋪（重複鋪滿整頁）；false = 單一置中 */
  repeat: boolean;
  /** 平鋪水平間隔（pt） */
  gapX: number;
  /** 平鋪垂直間隔（pt） */
  gapY: number;
  /** 疊放位置：below 蓋在內容下方（預設）｜above 蓋在內容上方 */
  layer: 'below' | 'above';
  /** @deprecated 舊欄位：斜放 45°，讀入時轉為 rotation */
  diagonal?: boolean;
}

export interface ElementBase {
  id: string;
  x: number;      // pt, top-left 原點
  y: number;
  width: number;
  height: number;
  /** 條件顯示：visibleKey 空 = 永遠顯示；隱藏時保留版面空間 */
  visibleKey?: string;
  visibleOp?: 'truthy' | 'falsy' | 'eq' | 'ne';
  visibleVal?: string;
  /** 置於浮水印之上：上層浮水印（蓋在內容上方）不會蓋住此元素（條碼/金額適用）。
   *  容器內子元素跟隨容器設定 */
  aboveWatermark?: boolean;
}

/** 字型家族：sans 黑體（預設）| serif 明體 | mono 等寬（英數）| 其他 = 匯入字型的 id */
export type FontFamily = 'sans' | 'serif' | 'mono' | (string & {});

export const FONT_FAMILIES: { value: FontFamily; label: string; css: string }[] = [
  { value: 'sans', label: '黑體 Noto Sans TC', css: "'Noto Sans TC', sans-serif" },
  { value: 'serif', label: '明體 Noto Serif TC', css: "'Noto Serif TC', serif" },
  { value: 'mono', label: '等寬（英數）Mono', css: "'Noto Sans Mono', monospace" },
];

export function fontCss(family: FontFamily | undefined): string {
  const builtin = FONT_FAMILIES.find(f => f.value === (family ?? 'sans'));
  if (builtin) return builtin.css;
  // 匯入字型：FontFace 以字型 id 為 family 名（FontService 載入），失敗 fallback 黑體
  return `'${family}', 'Noto Sans TC', sans-serif`;
}

export interface TextStyle {
  fontSize: number;
  fontFamily?: FontFamily;
  color: string;       // #rrggbb
  align: 'left' | 'center' | 'right';
  lineHeight: number;  // 倍數
  bold: boolean;
  /** 外框與底色（選填） */
  borderWidth?: number;
  borderColor?: string;
  fillColor?: string | null;
  padding?: number;
  /** 內容超出時自動增高（內文區元素會把下方元素往下推） */
  autoGrow?: boolean;
}

export interface TextElement extends ElementBase, TextStyle {
  type: 'text';
  content: string;
}

/** 欄位值格式化：空 = 原樣 */
export type ValueFormat = '' | 'comma' | 'twUpper' | 'rocDate' | 'rocDateLong';

export const VALUE_FORMATS: { value: ValueFormat; label: string }[] = [
  { value: '', label: '原樣' },
  { value: 'comma', label: '千分位（12,345）' },
  { value: 'twUpper', label: '國字大寫（壹萬貳仟參佰肆拾伍元整）' },
  { value: 'rocDate', label: '民國年（114/07/20）' },
  { value: 'rocDateLong', label: '民國年長式（民國114年7月20日）' },
];

export interface PlaceholderElement extends ElementBase, TextStyle {
  type: 'placeholder';
  key: string;
  sample: string;
  format?: ValueFormat;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  assetId: string;
  fit: 'contain' | 'stretch';
}

export interface RectElement extends ElementBase {
  type: 'rect';
  strokeColor: string;
  strokeWidth: number;
  fillColor: string | null;
}

export interface LineElement extends ElementBase {
  type: 'line';
  strokeColor: string;
  strokeWidth: number;
}

export interface TableCell {
  kind: 'text' | 'placeholder' | 'image';
  value: string;
  key: string;
  sample: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  format?: ValueFormat;
  /** 合併儲存格：向右/向下合併的格數（<=1 或未設 = 不合併；被蓋住的格子不顯示） */
  colSpan?: number;
  rowSpan?: number;
  /** 逐格文字樣式（未設 = 用表格層級的字級／黑色） */
  fontSize?: number;
  color?: string;
  /** kind = image 時的圖片（contain 縮放進儲存格） */
  assetId?: string;
}

/** 表格中被合併儲存格蓋住的格子（"r,c" 集合） */
export function coveredCells(el: TableElement): Set<string> {
  const set = new Set<string>();
  el.cells.forEach((row, r) => row.forEach((cell, c) => {
    const cs = Math.min(cell.colSpan ?? 1, el.columnWidths.length - c);
    const rs = Math.min(cell.rowSpan ?? 1, el.cells.length - r);
    if (cs <= 1 && rs <= 1) return;
    for (let dr = 0; dr < rs; dr++) {
      for (let dc = 0; dc < cs; dc++) {
        if (dr !== 0 || dc !== 0) set.add(`${r + dr},${c + dc}`);
      }
    }
  }));
  return set;
}

/** 陣列迴圈（報表重複列）設定 */
export interface TableRepeat {
  enabled: boolean;
  /** 資料中的陣列路徑，例：items */
  key: string;
  /** 哪一列是重複列（0-based）；該列儲存格的 key 用相對路徑（例：name、qty） */
  rowIndex: number;
  /** 群組欄位（陣列元素上的相對路徑）；相同值需相鄰（資料先排序）。空 = 不分組 */
  groupBy?: string;
  /** 群組首列（樣板列索引，0-based）；每組開始插一次。null = 無 */
  groupHeaderRowIndex?: number | null;
  /** 群組尾列（小計列）；每組結束插一次，儲存格可用 $gsum(欄位)/$gcount/$gavg(欄位)。null = 無 */
  groupFooterRowIndex?: number | null;
}

export interface TableElement extends ElementBase {
  type: 'table';
  columnWidths: number[];
  rowHeights: number[];
  borderColor: string;
  borderWidth: number;
  fontSize: number;
  fontFamily?: FontFamily;
  cellPadding: number;
  cells: TableCell[][];
  repeat?: TableRepeat | null;
}

/** 條碼：內容 = key 綁定資料（fallback sample），key 空則用 content 靜態值 */
export interface BarcodeElement extends ElementBase {
  type: 'barcode';
  symbology: 'code128' | 'code39' | 'ean13' | 'qr';
  content: string;
  key: string;
  sample: string;
  /** 1D 條碼下方顯示人讀文字 */
  showText: boolean;
}

/** Frame 容器：子元素座標相對於容器左上角；跨頁 keep-together；限一層 */
export interface ContainerElement extends ElementBase {
  type: 'container';
  title: string;
  borderWidth: number;
  borderColor: string;
  fillColor: string | null;
  children: TemplateElement[];
}

export type TemplateElement =
  | TextElement
  | PlaceholderElement
  | ImageElement
  | RectElement
  | LineElement
  | TableElement
  | BarcodeElement
  | ContainerElement;

/** 對 union 分配的 Omit（一般 Omit 會把 union 塌縮成共同欄位） */
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type DistributivePartial<T> = T extends unknown ? Partial<T> : never;

/** 新增元素的輸入型別：各元素型別各自 Omit id 後的 union，保留完整欄位檢查 */
export type NewTemplateElement = DistributiveOmit<TemplateElement, 'id'>;

/** 修補元素的輸入型別：各元素型別 Partial 的 union */
export type ElementPatch = DistributivePartial<TemplateElement>;

export type ElementType = TemplateElement['type'];

/** 元素型別中繼資料：新增型別時漏寫會編譯失敗（取代 as any 查表） */
export const ELEMENT_META: Record<ElementType, { icon: string; label: string }> = {
  text: { icon: 'T', label: '文字' },
  placeholder: { icon: '{}', label: '資料欄位' },
  image: { icon: '🖼', label: '圖片' },
  rect: { icon: '▭', label: '矩形' },
  line: { icon: '─', label: '線條' },
  table: { icon: '▦', label: '表格' },
  barcode: { icon: '𝄃𝄂', label: '條碼' },
  container: { icon: '▣', label: '容器' },
};

/**
 * 樣板正規化（immutable）：補齊舊版樣板缺的欄位、確保基本結構存在。
 * 合法樣板經過此函式後內容不變；非法輸入（缺 page/elements）補安全預設而非 runtime 爆炸。
 */
export function normalizeTemplate(doc: TemplateInput | null | undefined): TemplateDoc {
  const base = emptyTemplate();
  if (!doc || typeof doc !== 'object') return base;
  const page = doc.page && typeof doc.page === 'object' ? doc.page : base.page;
  const normPage = {
    size: page.size ?? 'A4',
    orientation: page.orientation === 'landscape' ? 'landscape' as const : 'portrait' as const,
    width: page.width ?? A4.width,
    height: page.height ?? A4.height,
    headerHeight: page.headerHeight ?? 0,
    footerHeight: page.footerHeight ?? 0,
    marginTop: page.marginTop ?? 0,
    marginRight: page.marginRight ?? 0,
    marginBottom: page.marginBottom ?? 0,
    marginLeft: page.marginLeft ?? 0,
    watermark: normalizeWatermark(page.watermark),
  };
  return {
    id: doc.id ?? '',
    name: doc.name ?? base.name,
    version: doc.version ?? 1,
    updatedAt: doc.updatedAt,
    page: normPage,
    sections: normalizeSections(doc, normPage),
  };
}

/** 節清單正規化；無 sections 時把舊格式（cover/elements/backPage）遷移成節 */
function normalizeSections(doc: TemplateInput, page: PageSettings): DocSection[] {
  if (Array.isArray(doc.sections) && doc.sections.length) {
    return doc.sections.map(s => ({
      id: s.id || newId(),
      name: s.name || (s.kind === 'single' ? '獨立頁' : '內容節'),
      kind: s.kind === 'single' ? 'single' : 'flow',
      page: s.page && typeof s.page === 'object' ? {
        size: s.page.size ?? page.size,
        orientation: s.page.orientation === 'landscape' ? 'landscape' : 'portrait',
        width: s.page.width ?? page.width,
        height: s.page.height ?? page.height,
      } : null,
      headerHeight: s.headerHeight ?? 0,
      footerHeight: s.footerHeight ?? 0,
      watermarkMode: s.watermarkMode === 'none' || s.watermarkMode === 'custom' ? s.watermarkMode : 'inherit',
      watermark: normalizeWatermark(s.watermark),
      elements: Array.isArray(s.elements) ? s.elements : [],
    }));
  }
  // 舊格式遷移：封面（獨立頁）→ 內頁（flow，band 高度來自 page）→ 封底
  const out: DocSection[] = [];
  if (doc.cover?.enabled) {
    out.push({
      id: newId(), name: '封面', kind: 'single', page: null,
      headerHeight: 0, footerHeight: 0, watermarkMode: 'inherit', watermark: null,
      elements: Array.isArray(doc.cover.elements) ? doc.cover.elements : [],
    });
  }
  out.push({
    id: newId(), name: '內頁', kind: 'flow', page: null,
    headerHeight: page.headerHeight, footerHeight: page.footerHeight,
    watermarkMode: 'inherit', watermark: null,
    elements: Array.isArray(doc.elements) ? doc.elements : [],
  });
  if (doc.backPage?.enabled) {
    out.push({
      id: newId(), name: '封底', kind: 'single', page: null,
      headerHeight: 0, footerHeight: 0, watermarkMode: 'inherit', watermark: null,
      elements: Array.isArray(doc.backPage.elements) ? doc.backPage.elements : [],
    });
  }
  return out;
}

function normalizeWatermark(wm: Partial<Watermark> | null | undefined): Watermark | null {
  if (!wm || typeof wm !== 'object') return null;
  return {
    enabled: !!wm.enabled,
    text: wm.text ?? '',
    key: wm.key ?? '',
    fontSize: wm.fontSize ?? 72,
    color: wm.color ?? '#e5e7eb',
    rotation: wm.rotation ?? (wm.diagonal ? 45 : 0),
    repeat: !!wm.repeat,
    gapX: wm.gapX ?? 80,
    gapY: wm.gapY ?? 80,
    layer: wm.layer === 'above' ? 'above' : 'below',
  };
}


/** 深拷貝元素並重新配 id（含容器子元素） */
export function cloneWithNewIds(el: TemplateElement): TemplateElement {
  const copy = JSON.parse(JSON.stringify(el)) as TemplateElement;
  copy.id = newId();
  if (copy.type === 'container') {
    for (const child of copy.children) child.id = newId();
  }
  return copy;
}

export interface TemplateSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export const A4 = { width: 595.28, height: 841.89 };

/** mm ↔ pt 換算（1pt = 1/72 吋） */
export const mmToPt = (mm: number) => (mm * 72) / 25.4;
export const ptToMm = (pt: number) => (pt * 25.4) / 72;

/**
 * 紙張預設（UI 用；schema/引擎只認 width/height pt，任何尺寸都合法）。
 * wMm×hMm 為自然方向，套用時依寬高自動判定 orientation。
 */
export const PAPER_PRESETS: { value: string; label: string; wMm: number; hMm: number }[] = [
  { value: 'A4', label: 'A4（210×297mm）', wMm: 210, hMm: 297 },
  { value: 'A5', label: 'A5（148×210mm）', wMm: 148, hMm: 210 },
  { value: 'A3', label: 'A3（297×420mm）', wMm: 297, hMm: 420 },
  { value: 'B5', label: 'B5（176×250mm）', wMm: 176, hMm: 250 },
  { value: 'B4', label: 'B4（250×353mm）', wMm: 250, hMm: 353 },
  { value: 'Letter', label: 'Letter（215.9×279.4mm）', wMm: 215.9, hMm: 279.4 },
  { value: 'zhong1dao', label: '中一刀 241×140mm（三聯單/連續報表紙）', wMm: 241, hMm: 140 },
  { value: 'thermal80', label: '熱感 80mm（80×200mm）', wMm: 80, hMm: 200 },
];

export function emptyTemplate(): TemplateDoc {
  return {
    id: '',
    name: '未命名樣板',
    version: 1,
    page: { size: 'A4', orientation: 'portrait', ...A4, headerHeight: 0, footerHeight: 0 },
    sections: [{
      id: newId(), name: '內頁', kind: 'flow', page: null,
      headerHeight: 0, footerHeight: 0, watermarkMode: 'inherit', watermark: null, elements: [],
    }],
  };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyCell(): TableCell {
  return { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false };
}
