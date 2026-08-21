// 樣板 JSON schema —— 與後端 Models/TemplateModels.cs 對應，兩邊需同步修改
import { t } from '../i18n/i18n';

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

  /** 輸入資料驗證（選填）：enabled 時，正式渲染（renderByID）前先驗證宿主 POST 的 data */
  validation?: ValidationSpec;

  /** 允許匿名渲染（選填，預設 false）：開啟後 render-by-id 可不帶憑證呼叫——
   *  任何拿到樣板 id 的人都能渲染此樣板（含靜態內容與範例值），依樣板敏感度自行決定。
   *  僅影響 render；樣板本體讀寫仍要憑證。後端 requireAnyOrAnonymousRender 讀此欄位。 */
  allowAnonymousRender?: boolean;

  /**
   * 設計期的測試資料（「資料」分頁貼的 JSON 原文，跟著樣板存檔）。
   * 只服務設計與預覽——**引擎完全忽略**，正式渲染一律用宿主 POST 進來的 data。
   * 存原文而不是解析後的物件：使用者的排版原樣保留，打到一半的壞 JSON 也不會擋存檔。
   */
  sampleData?: string;
}

/** 輸入驗證的欄位型別 */
export type ValidationFieldType = 'any' | 'string' | 'number' | 'boolean' | 'array' | 'object';

/**
 * 單一欄位驗證規則。path 語法（與後端 internal/validate 對應）：
 * 巢狀用點（school.name）；陣列逐元素用 []（items[].amount，對每個元素檢查）；
 * 只寫陣列名（items）則檢查陣列本身。
 */
export interface ValidationField {
  path: string;
  required: boolean;
  type: ValidationFieldType;
  /** 純前端：偵測來的 vs 手動加的（合併偵測時保留手動列） */
  source?: 'detected' | 'manual';
}

/** 一份樣板的輸入驗證設定 */
export interface ValidationSpec {
  enabled: boolean;
  fields: ValidationField[];
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
  /** 繞元素中心旋轉角度（度，順時針）；純視覺，版面仍用未旋轉的框 */
  rotation?: number;
  /** 條件顯示：visibleKey 空 = 永遠顯示；隱藏時保留版面空間 */
  visibleKey?: string;
  visibleOp?: 'truthy' | 'falsy' | 'eq' | 'ne';
  visibleVal?: string;
  /** 置於浮水印之上：上層浮水印（蓋在內容上方）不會蓋住此元素（條碼/金額適用）。
   *  容器內子元素跟隨容器設定 */
  aboveWatermark?: boolean;
  /** 鎖定（純編輯器）：畫布上不可選/拖/縮放，只能從大綱操作；不影響渲染 */
  locked?: boolean;
  /** 隱藏：設計時與渲染都不顯示（保留版面空間，與條件顯示 visibleKey 同閘門）；設計者手動關 */
  hidden?: boolean;
  /** 允許在**填寫模式**（embed token mode=fill）修改內容值。
   *  設計者在設計模式勾選；目前只有 text 元素有效（後端白名單，見 httpapi/values.go）。
   *  不影響渲染。 */
  fillable?: boolean;
}

/** 字型家族：sans 黑體（預設）| serif 明體 | mono 等寬（英數）| 其他 = 匯入字型的 id */
export type FontFamily = 'sans' | 'serif' | 'mono' | (string & {});

export const FONT_FAMILIES: { value: FontFamily; label: string; css: string }[] = [
  { value: 'sans', label: t('黑體 Noto Sans TC'), css: "'Noto Sans TC', sans-serif" },
  { value: 'serif', label: t('明體 Noto Serif TC'), css: "'Noto Serif TC', serif" },
  { value: 'mono', label: t('等寬（英數）Mono'), css: "'Noto Sans Mono', monospace" },
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
  /** 整個元素斜體（假斜體字型變體；text 亦可用 [i] 標記做局部） */
  italic?: boolean;
  /** 底線（text/placeholder；引擎原生渲染） */
  underline?: boolean;
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
  { value: '', label: t('原樣') },
  { value: 'comma', label: t('千分位（12,345）') },
  { value: 'twUpper', label: t('國字大寫（壹萬貳仟參佰肆拾伍元整）') },
  { value: 'rocDate', label: t('民國年（114/07/20）') },
  { value: 'rocDateLong', label: t('民國年長式（民國114年7月20日）') },
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
  /** 動態圖片：key 綁定的資料值 = 可訪問的圖片 URL（http/https），渲染時由引擎抓取嵌入 */
  key?: string;
  /** 範例 URL（畫布預覽與範例資料用） */
  sample?: string;
  /** 固定圖片連結（靜態 URL，渲染時抓取）。優先序：key > url > assetId */
  url?: string;
}

/** 線型：實線（未設）｜虛線｜點線（裁切線/騎縫線用） */
export type LineStyle = 'dashed' | 'dotted';

export interface RectElement extends ElementBase {
  type: 'rect';
  strokeColor: string;
  strokeWidth: number;
  fillColor: string | null;
  /** 框線線型（未設 = 實線） */
  lineStyle?: LineStyle;
  /** 形狀（未設 = 矩形）：ellipse = 橢圓/圓（印章框用） */
  shape?: 'rect' | 'ellipse';
  /** 圓角半徑（pt，shape=rect 時有效；0/未設 = 直角）。四角相同時用此值 */
  cornerRadius?: number;
  /** 四角獨立半徑（pt）；有值時優先於 cornerRadius（Figma 式混合圓角） */
  cornerRadii?: CornerRadii;
}

/** 四角圓角半徑（pt）：左上/右上/右下/左下 */
export interface CornerRadii {
  tl: number;
  tr: number;
  br: number;
  bl: number;
}

/** 元素的四角半徑（統一 cornerRadius 或個別 cornerRadii）；回傳 [tl,tr,br,bl] */
export function cornerRadiiOf(el: { cornerRadius?: number; cornerRadii?: CornerRadii }): [number, number, number, number] {
  const c = el.cornerRadii;
  if (c) return [c.tl ?? 0, c.tr ?? 0, c.br ?? 0, c.bl ?? 0];
  const r = el.cornerRadius ?? 0;
  return [r, r, r, r];
}

export interface LineElement extends ElementBase {
  type: 'line';
  strokeColor: string;
  strokeWidth: number;
  /** 線型（未設 = 實線） */
  lineStyle?: LineStyle;
}

/** 儲存格四邊框線開關（Word 式逐格框線；線在兩側儲存格都關掉時才消失） */
export interface CellBorders {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
  /** 左斜線 ╲（左上到右下；劃掉未使用欄位用） */
  diagDown?: boolean;
  /** 右斜線 ╱（左下到右上） */
  diagUp?: boolean;
}

export interface TableCell {
  kind: 'text' | 'placeholder' | 'image' | 'barcode';
  value: string;
  key: string;
  sample: string;
  /** 允許在**填寫模式**修改此格的值（只有 kind='text' 有效；見 ElementBase.fillable） */
  fillable?: boolean;
  align: 'left' | 'center' | 'right';
  /** 垂直對齊（未設 = middle）；與 align 組成九點對齊 */
  vAlign?: 'top' | 'middle' | 'bottom';
  bold: boolean;
  /** 整格斜體（text 格亦可用 [i] 標記做局部） */
  italic?: boolean;
  format?: ValueFormat;
  /** 合併儲存格：向右/向下合併的格數（<=1 或未設 = 不合併；被蓋住的格子不顯示） */
  colSpan?: number;
  rowSpan?: number;
  /** 逐格文字樣式（未設 = 用表格層級的字級／黑色） */
  fontSize?: number;
  color?: string;
  /** 儲存格背景色（未設 = 透明；表頭列底色用） */
  fillColor?: string;
  /** 逐格框線（未設 = 四邊都畫；只在表格框線寬 > 0 時有意義） */
  borders?: CellBorders;
  /** 自動換行：內容超寬時換行、列高自動延伸（未設 = 單行裁切加 …） */
  wrap?: boolean;
  /** kind = image 時的圖片（contain 縮放進儲存格） */
  assetId?: string;
  /** kind = image 時的固定圖片連結（靜態 URL）。優先序：key > url > assetId */
  url?: string;
  /** kind = barcode 時的條碼類型（未設 = code128）；內容 = key 綁定（fallback sample）或 value 靜態值 */
  symbology?: BarcodeSymbology;
  /** kind = barcode 時 1D 條碼下方顯示人讀文字 */
  showText?: boolean;
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

/** 條碼類型（元素與表格儲存格共用） */
export type BarcodeSymbology = 'code128' | 'code39' | 'ean13' | 'qr';

/** 條碼：內容 = key 綁定資料（fallback sample），key 空則用 content 靜態值 */
export interface BarcodeElement extends ElementBase {
  type: 'barcode';
  symbology: BarcodeSymbology;
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

/**
 * 重複區塊 / 列表（JasperReports List 式）：綁一個陣列 key，children 描述「一筆」的自由版面
 * （座標相對 list 左上角，width/height = 一筆的尺寸）；每筆資料蓋一次、往下堆。
 * children 的 key 相對「當筆元素」解析，`$parent.xxx` 回外層當筆。限兩層巢狀（list 內可再放一個 list）。
 * 展開時攤平成扁平原子分頁（外層區塊不 keep-together），單一原子超過整頁 → 渲染警告。
 */
export interface ListElement extends ElementBase {
  type: 'list';
  /** 資料陣列路徑；頂層相對整份資料，巢狀時相對外層當筆元素（可用 $parent.） */
  key: string;
  /** 無資料時仍畫一筆的範例筆數（未設 = 1）；純設計預覽用，不影響實際渲染 */
  sampleCount?: number;
  /** 筆與筆之間的垂直間距（pt，未設 = 0） */
  gap?: number;
  /** 一筆的版面：自由擺放，座標相對 list 左上角 */
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
  | ContainerElement
  | ListElement;

/** 帶 children 的容器型元素（Frame 容器與重複區塊）；子元素座標相對其左上角 */
export type ChildHostElement = ContainerElement | ListElement;

/** 是否為帶 children 的容器型元素（container / list）——child 操作共用此判斷 */
export function isChildHost(el: TemplateElement): el is ChildHostElement {
  return el.type === 'container' || el.type === 'list';
}

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
  text: { icon: 'T', label: t('文字') },
  placeholder: { icon: '{}', label: t('資料欄位') },
  image: { icon: '🖼', label: t('圖片') },
  rect: { icon: '▭', label: t('矩形') },
  line: { icon: '─', label: t('線條') },
  table: { icon: '▦', label: t('表格') },
  barcode: { icon: '𝄃𝄂', label: t('條碼') },
  container: { icon: '▣', label: t('容器') },
  list: { icon: '⧉', label: t('重複區塊') },
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
    validation: normalizeValidation(doc.validation),
    // 設計期測試資料：只有字串才收（別的型別視同沒有，不讓壞資料進畫面）
    sampleData: typeof doc.sampleData === 'string' ? doc.sampleData : undefined,
    allowAnonymousRender: doc.allowAnonymousRender === true ? true : undefined,
  };
}

/** 驗證設定正規化：舊樣板無此欄位 → 關閉、空規則（等同不驗證） */
function normalizeValidation(v: Partial<ValidationSpec> | null | undefined): ValidationSpec {
  const types: ValidationFieldType[] = ['any', 'string', 'number', 'boolean', 'array', 'object'];
  const fields = Array.isArray(v?.fields) ? v!.fields : [];
  return {
    enabled: !!v?.enabled,
    fields: fields
      .filter(f => f && typeof f.path === 'string')
      .map(f => ({
        path: f.path,
        required: !!f.required,
        type: types.includes(f.type as ValidationFieldType) ? (f.type as ValidationFieldType) : 'any',
        source: f.source === 'manual' ? 'manual' as const : 'detected' as const,
      })),
  };
}

/** 確保 container/list 元素帶 children 陣列、table 元素帶可渲染的維度
 *  （手改樣板 JSON 缺欄位時防呆；遞迴巢狀 list）。
 *  只補缺的欄位、其餘原樣保留（維持 raw passthrough）。 */
/** key＋格式 → 插值 token（資料欄位遷移用） */
function bindingToken(key: string | undefined, format?: string): string {
  if (!key) return '';
  return format ? `{{${key}|${format}}}` : `{{${key}}}`;
}

/**
 * 資料欄位（placeholder）收斂：統一遷移成 text＋`{{key|format}}`（2026-07 拍板，
 * 只保留「文字」一種綁定介面）。引擎仍渲染舊格式（宿主可能直接送舊 JSON）；
 * 編輯器載入即遷移、存檔後落新格式。sample 不再保留（畫布預覽改吃資料面板的範例資料）。
 */
function migratePlaceholderCell(cell: TableCell): TableCell {
  if (cell.kind !== 'placeholder') return cell;
  const { format, ...rest } = cell;
  return { ...rest, kind: 'text', value: bindingToken(cell.key, format), key: '', sample: '' };
}

function ensureChildren(els: unknown): TemplateElement[] {
  if (!Array.isArray(els)) return [];
  return els.map(e => {
    if (!e || typeof e !== 'object') return e;
    const type = (e as TemplateElement).type;
    if (type === 'placeholder') {
      const { key, sample, format, ...rest } = e as PlaceholderElement;
      return { ...rest, type: 'text', content: bindingToken(key, format) } as TemplateElement;
    }
    if (type === 'container' || type === 'list') {
      return { ...e, children: ensureChildren((e as { children?: unknown }).children) };
    }
    if (type === 'table') return ensureTable(e as TableElement);
    return e;
  }) as TemplateElement[];
}

/** 有效的尺寸陣列：非空、且每個元素都是有限數字。否則視為缺漏，由呼叫端推導。 */
function sizeArray(v: unknown): number[] | null {
  return Array.isArray(v) && v.length > 0 && v.every(n => typeof n === 'number' && Number.isFinite(n))
    ? (v as number[])
    : null;
}

/**
 * 表格防呆：缺 columnWidths/rowHeights 或 cells 維度不足時補齊。
 *
 * 為什麼要有：畫布在 `el.columnWidths.length` 上取值，缺這個欄位會丟 TypeError，
 * 而 Angular 的樣板錯誤會中斷整棵渲染樹——結果是**整張畫布空白**，一個元素都畫不出來，
 * 使用者只看到白畫面、沒有任何錯誤提示。（後端引擎對同一份 JSON 是安全的，
 * 只會把表格畫成空的，所以這是純前端的健壯性缺口。）
 *
 * 結構完整時原樣回傳同一個物件，不改既有樣板；補齊時只加不減（既有儲存格一律保留）。
 */
function ensureTable(el: TableElement): TableElement {
  const widths = sizeArray(el.columnWidths);
  const heights = sizeArray(el.rowHeights);
  const rawSrc = Array.isArray(el.cells) ? el.cells : null;
  // 資料欄位格遷移（見 migratePlaceholderCell）
  const hadPh = !!rawSrc?.some(r => Array.isArray(r) && r.some(c => c && (c as TableCell).kind === 'placeholder'));
  const src = hadPh ? rawSrc!.map(r => (Array.isArray(r) ? r.map(migratePlaceholderCell) : r)) : rawSrc;

  const cols = widths?.length ?? src?.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0) ?? 0;
  const rows = heights?.length ?? src?.length ?? 0;
  const colCount = cols > 0 ? cols : 1;
  const rowCount = rows > 0 ? rows : 1;

  const cellsOk = !!src && src.length >= rowCount
    && src.every(r => Array.isArray(r) && r.length >= colCount);
  if (widths && heights && cellsOk) return hadPh ? { ...el, cells: src as TableCell[][] } : el;

  // 缺尺寸 → 以元素本身的寬高均分（寬高也不可用時退回單格預設值）
  const totalW = typeof el.width === 'number' && el.width > 0 ? el.width : colCount * 80;
  const totalH = typeof el.height === 'number' && el.height > 0 ? el.height : rowCount * 24;

  const cells: TableCell[][] = [];
  for (let r = 0; r < Math.max(rowCount, src?.length ?? 0); r++) {
    const srcRow = Array.isArray(src?.[r]) ? (src[r] as TableCell[]) : null;
    const row: TableCell[] = [];
    for (let c = 0; c < Math.max(colCount, srcRow?.length ?? 0); c++) {
      const cell = srcRow?.[c];
      row.push(cell && typeof cell === 'object' ? cell : emptyCell());
    }
    cells.push(row);
  }

  return {
    ...el,
    columnWidths: widths ?? Array.from({ length: colCount }, () => totalW / colCount),
    rowHeights: heights ?? Array.from({ length: rowCount }, () => totalH / rowCount),
    cells,
  };
}

/** 節清單正規化；無 sections 時把舊格式（cover/elements/backPage）遷移成節 */
function normalizeSections(doc: TemplateInput, page: PageSettings): DocSection[] {
  if (Array.isArray(doc.sections) && doc.sections.length) {
    return doc.sections.map(s => ({
      id: s.id || newId(),
      name: s.name || (s.kind === 'single' ? t('獨立頁') : t('內容節')),
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
      elements: ensureChildren(s.elements),
    }));
  }
  // 舊格式遷移：封面（獨立頁）→ 內頁（flow，band 高度來自 page）→ 封底
  const out: DocSection[] = [];
  if (doc.cover?.enabled) {
    out.push({
      id: newId(), name: t('封面'), kind: 'single', page: null,
      headerHeight: 0, footerHeight: 0, watermarkMode: 'inherit', watermark: null,
      elements: ensureChildren(doc.cover.elements),
    });
  }
  out.push({
    id: newId(), name: t('內頁'), kind: 'flow', page: null,
    headerHeight: page.headerHeight, footerHeight: page.footerHeight,
    watermarkMode: 'inherit', watermark: null,
    elements: ensureChildren(doc.elements),
  });
  if (doc.backPage?.enabled) {
    out.push({
      id: newId(), name: t('封底'), kind: 'single', page: null,
      headerHeight: 0, footerHeight: 0, watermarkMode: 'inherit', watermark: null,
      elements: ensureChildren(doc.backPage.elements),
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


/** 子元素遞迴重配 id（容器與重複區塊都帶 children，重複區塊可再巢狀一層） */
function reassignChildIds(el: TemplateElement): void {
  if (el.type === 'container' || el.type === 'list') {
    for (const child of el.children) {
      child.id = newId();
      reassignChildIds(child);
    }
  }
}

/** 深拷貝元素並重新配 id（含容器/重複區塊的巢狀子元素） */
export function cloneWithNewIds(el: TemplateElement): TemplateElement {
  const copy = JSON.parse(JSON.stringify(el)) as TemplateElement;
  copy.id = newId();
  reassignChildIds(copy);
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
  { value: 'zhong1dao', label: t('中一刀 241×140mm（三聯單/連續報表紙）'), wMm: 241, hMm: 140 },
  { value: 'thermal80', label: t('熱感 80mm（80×200mm）'), wMm: 80, hMm: 200 },
];

export function emptyTemplate(): TemplateDoc {
  return {
    id: '',
    name: t('未命名樣板'),
    version: 1,
    page: {
      size: 'A4', orientation: 'portrait', ...A4, headerHeight: 0, footerHeight: 0,
      // 新樣板預設給 Word「標準」邊界（72pt = 2.54cm），讓印刷邊界一開始就看得到、可調
      marginTop: 72, marginRight: 72, marginBottom: 72, marginLeft: 72,
    },
    sections: [{
      id: newId(), name: t('內頁'), kind: 'flow', page: null,
      headerHeight: 0, footerHeight: 0, watermarkMode: 'inherit', watermark: null, elements: [],
    }],
    validation: { enabled: false, fields: [] },
  };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyCell(): TableCell {
  return { kind: 'text', value: '', key: '', sample: '', align: 'left', bold: false };
}

/**
 * 收集所有「被標記可填」欄位的目前值，供填寫模式儲存（PATCH /values）。
 * 定址與後端 httpapi/values.go 一致：一般元素 `id`、表格儲存格 `id#row,col`。
 * 只收 text 元素與 text 儲存格（與後端白名單相同）；後端仍會再驗一次。
 */
export function collectFillableValues(doc: TemplateDoc): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (els: TemplateElement[]) => {
    for (const el of els) {
      if (el.type === 'text' && el.fillable) out[el.id] = el.content;
      if (el.type === 'table') {
        // 被合併蓋住的格編輯不到（onCellDbl 會導向主格），送出去只會在 DB 養一個看不見的值
        const covered = coveredCells(el);
        el.cells.forEach((row, r) => row.forEach((cell, c) => {
          if (cell.kind === 'text' && cell.fillable && !covered.has(`${r},${c}`)) {
            out[`${el.id}#${r},${c}`] = cell.value;
          }
        }));
      }
      if (isChildHost(el)) walk(el.children);
    }
  };
  doc.sections.forEach(s => walk(s.elements));
  return out;
}
