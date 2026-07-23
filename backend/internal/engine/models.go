package engine

// 樣板 JSON schema —— 與前端 template.model.ts 對應（camelCase JSON）。
// 渲染時才做強型別解碼；儲存走 raw JSON passthrough（見 storage.go），
// 因此後端 schema 落後前端欄位時也不會弄丟資料。

type TemplateDoc struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	Version  int          `json:"version"`
	Page     PageSettings `json:"page"`
	Elements []Element    `json:"elements"`

	Cover    *PageSection `json:"cover,omitempty"`    // 舊格式：首頁（封面）；Sections 存在時忽略
	BackPage *PageSection `json:"backPage,omitempty"` // 舊格式：最後一頁（封底）；Sections 存在時忽略

	// Sections 節清單（有序）：每節有自己的紙張/方向與內容，依序輸出、節間必換頁。
	// 有值時取代 Elements/Cover/BackPage 的舊版渲染路徑。
	Sections []DocSection `json:"sections,omitempty"`

	// Validation 輸入資料驗證（選填）：Enabled 時，正式渲染（renderByID）前先驗證宿主 POST 的 data，
	// 不過直接 422、不渲染。引擎本身不讀此欄位（驗證是渲染前的守門，見 internal/validate）。
	Validation *ValidationSpec `json:"validation,omitempty"`
}

// ValidationSpec 一份樣板的輸入驗證規則。
type ValidationSpec struct {
	Enabled bool              `json:"enabled"`
	Fields  []ValidationField `json:"fields"`
}

// ValidationField 單一欄位規則。
// Path 資料路徑：巢狀用點（school.name）；陣列逐元素用 []（items[].amount，對每個元素檢查）；
// 只寫陣列名（items）則檢查陣列本身。Type：string|number|boolean|array|object|any。
type ValidationField struct {
	Path     string `json:"path"`
	Required bool   `json:"required"`
	Type     string `json:"type"`
}

// DocSection 一節：flow = 有頁首/頁尾 band、內容自動分頁；single = 獨立一頁（無 band）。
type DocSection struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	Kind         string       `json:"kind"` // flow | single
	Page         *SectionPage `json:"page"` // nil = 跟隨文件預設 Page
	HeaderHeight float64      `json:"headerHeight"`
	FooterHeight float64      `json:"footerHeight"`
	// WatermarkMode 浮水印覆寫：inherit（空值同義，跟隨文件）| none（此節不蓋）| custom（用 Watermark）
	WatermarkMode string     `json:"watermarkMode"`
	Watermark     *Watermark `json:"watermark"`
	Elements      []Element  `json:"elements"`
}

// SectionPage 節的紙張覆寫。
type SectionPage struct {
	Size        string  `json:"size"`
	Orientation string  `json:"orientation"`
	Width       float64 `json:"width"`
	Height      float64 `json:"height"`
}

// PageSection 獨立頁（封面/封底）：自己的元素清單，整頁可用（無 band）。
type PageSection struct {
	Enabled  bool      `json:"enabled"`
	Elements []Element `json:"elements"`
}

type PageSettings struct {
	Size         string  `json:"size"`
	Orientation  string  `json:"orientation"`
	Width        float64 `json:"width"`
	Height       float64 `json:"height"`
	HeaderHeight float64 `json:"headerHeight"` // 頁首 band 高度；y < HeaderHeight 的元素每頁重複
	FooterHeight float64 `json:"footerHeight"` // 頁尾 band 高度；y >= Height-FooterHeight 的元素每頁重複

	Watermark *Watermark `json:"watermark"` // 每頁背景浮水印
}

// Watermark 頁面浮水印（每頁背景層，畫在所有元素之下）
type Watermark struct {
	Enabled  bool     `json:"enabled"`
	Text     string   `json:"text"`
	Key      string   `json:"key"` // 選填：資料綁定（有值時取代 Text；例如 status 欄位「作廢」）
	FontSize float64  `json:"fontSize"`
	Color    string   `json:"color"`
	Diagonal bool     `json:"diagonal"`           // 舊欄位：斜放 45°（Rotation 未給時的 fallback）
	Rotation *float64 `json:"rotation,omitempty"` // 旋轉角度（度）；nil 時依 Diagonal 補 45/0
	Repeat   bool     `json:"repeat"`             // 滿版平鋪（重複鋪滿整頁）
	GapX     float64  `json:"gapX"`               // 平鋪水平間隔（pt）
	GapY     float64  `json:"gapY"`               // 平鋪垂直間隔（pt）
	Layer    string   `json:"layer"`              // below（空值同義，蓋在內容下方）| above（蓋在內容上方）
}

// rotationDeg 實際旋轉角度（處理舊欄位 fallback）。
func (wm *Watermark) rotationDeg() float64 {
	if wm.Rotation != nil {
		return *wm.Rotation
	}
	if wm.Diagonal {
		return 45
	}
	return 0
}

// Element 用單一扁平結構承載所有元素型別（依 Type 取用對應欄位），
// Go 不需要 JSON 多型機制，未用到的欄位維持零值即可。
type Element struct {
	ID string `json:"id"`
	// AboveWatermark 置於浮水印之上：上層浮水印（Layer=above）不蓋此元素（條碼/金額適用）。
	// 只看頂層元素；容器子元素跟隨容器。
	AboveWatermark bool   `json:"aboveWatermark"`
	Type           string `json:"type"` // text | placeholder | image | rect | line | table
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
	// Rotation 繞元素中心旋轉的角度（度，順時針）；純視覺，版面仍用未旋轉的框
	Rotation float64 `json:"rotation"`

	// 條件顯示（所有元素通用）：VisibleKey 空 = 永遠顯示；隱藏時保留版面空間
	VisibleKey string `json:"visibleKey"`
	VisibleOp  string `json:"visibleOp"`  // truthy(預設) | falsy | eq | ne
	VisibleVal string `json:"visibleVal"` // eq / ne 的比較值

	// Hidden 設計者手動隱藏：不畫但保留版面空間（與條件顯示同閘門）。
	// Locked 純編輯器概念（畫布不可選/拖），引擎忽略。
	Hidden bool `json:"hidden"`
	Locked bool `json:"locked"`

	// text / placeholder 外框與底色（BorderColor/BorderWidth/FillColor 與 table/rect 共用欄位）
	Padding  float64 `json:"padding"`  // 文字內距（pt）
	AutoGrow bool    `json:"autoGrow"` // 內容超出時自動增高（內文區元素會把下方元素往下推）

	// text / placeholder（table 亦用 FontFamily / FontSize）
	Content    string  `json:"content"`
	Key        string  `json:"key"`
	Sample     string  `json:"sample"`
	FontSize   float64 `json:"fontSize"`
	FontFamily string  `json:"fontFamily"` // sans（黑體，預設）| serif（明體）| mono（等寬英數）
	Color      string  `json:"color"`
	Align      string  `json:"align"` // left | center | right
	LineHeight float64 `json:"lineHeight"`
	Bold       bool    `json:"bold"`
	Underline  bool    `json:"underline"` // text/placeholder 底線（gopdf 原生渲染）
	Format     string  `json:"format"`    // placeholder 格式化：comma | twUpper | 空 = 原樣

	// barcode（內容取 Key 綁定資料，否則用 Content 靜態值；Sample 為範例）
	Symbology string `json:"symbology"` // code128 | code39 | ean13 | qr
	ShowText  bool   `json:"showText"`  // 1D 條碼下方顯示人讀文字

	// container（Frame 容器）：子元素座標相對於容器左上角；跨頁 keep-together
	Title    string    `json:"title"`    // 容器標題（左上角）
	Children []Element `json:"children"` // 容器限一層；list 重複區塊可再巢狀一層 list

	// list（重複區塊 / JasperReports List 式）：綁 Key 陣列，Children 為「一筆」的自由版面
	// （座標相對 list 左上角，Width/Height = 一筆尺寸），每筆蓋一次往下堆。
	// Children 的 key 相對「當筆元素」解析，$parent. 回外層當筆。展開後攤平成扁平原子分頁。
	Gap         float64 `json:"gap"`         // 筆與筆之間的垂直間距（pt）
	SampleCount int     `json:"sampleCount"` // 無資料時仍畫的範例筆數（0 = 1；純設計預覽用）

	// image
	// image 三種來源（優先序 Key > URL > AssetID）：
	//   Key = 動態圖片，渲染資料中該 key 的值是圖片 URL（Sample 為畫布預覽用範例 URL）
	//   URL = 固定圖片連結（靜態），渲染時抓取
	//   AssetID = 已上傳圖片
	AssetID string `json:"assetId"`
	URL     string `json:"url"`
	Fit     string `json:"fit"` // contain | stretch

	// rect / line
	StrokeColor  string  `json:"strokeColor"`
	StrokeWidth  float64 `json:"strokeWidth"`
	FillColor    *string `json:"fillColor"`
	LineStyle    string  `json:"lineStyle"`    // 線型（空 = 實線）｜dashed｜dotted
	Shape        string       `json:"shape"`        // 形狀（空 = rect）｜ellipse
	CornerRadius float64      `json:"cornerRadius"` // 圓角半徑 pt（四角相同時用此值）
	CornerRadii  *CornerRadii `json:"cornerRadii"`  // 四角獨立半徑（有值時優先於 CornerRadius）

	// table
	ColumnWidths []float64     `json:"columnWidths"`
	RowHeights   []float64     `json:"rowHeights"`
	BorderColor  string        `json:"borderColor"`
	BorderWidth  float64       `json:"borderWidth"`
	CellPadding  float64       `json:"cellPadding"`
	Cells        [][]TableCell `json:"cells"`
	Repeat       *TableRepeat  `json:"repeat"`
}

// CellBorders 儲存格四邊框線開關（Word 式逐格框線；線在兩側儲存格都關掉時才消失）
// CornerRadii 四角獨立圓角半徑（pt）：左上/右上/右下/左下
type CornerRadii struct {
	TL float64 `json:"tl"`
	TR float64 `json:"tr"`
	BR float64 `json:"br"`
	BL float64 `json:"bl"`
}

type CellBorders struct {
	Top    bool `json:"top"`
	Right  bool `json:"right"`
	Bottom bool `json:"bottom"`
	Left   bool `json:"left"`

	DiagDown bool `json:"diagDown"` // 左斜線 ╲（左上到右下；劃掉未使用欄位用）
	DiagUp   bool `json:"diagUp"`   // 右斜線 ╱（左下到右上）
}

type TableCell struct {
	Kind   string `json:"kind"` // text | placeholder | image | barcode
	Value  string `json:"value"`
	Key    string `json:"key"`
	Sample string `json:"sample"`
	Align  string `json:"align"`
	VAlign string `json:"vAlign"` // 垂直對齊 top|middle|bottom（空 = middle）
	Bold   bool   `json:"bold"`
	Format string `json:"format"` // placeholder 格式化：comma | twUpper | 空 = 原樣

	ColSpan  int     `json:"colSpan"`  // 合併儲存格：向右合併欄數（<=1 = 不合併）
	RowSpan  int     `json:"rowSpan"`  // 合併儲存格：向下合併列數
	FontSize  float64 `json:"fontSize"`  // 逐格字級（0 = 用表格字級）
	Color     string  `json:"color"`     // 逐格文字顏色（空 = 黑）
	FillColor string  `json:"fillColor"` // 儲存格背景色（空 = 透明；表頭列底色用）
	AssetID   string  `json:"assetId"`   // Kind = image 時的圖片（contain 縮放進儲存格）
	URL       string  `json:"url"`       // Kind = image 時的固定圖片連結（優先序 Key > URL > AssetID）

	// Kind = barcode：內容 = Key 綁定（fallback Sample）或 Value 靜態值
	Symbology string `json:"symbology"` // 條碼類型（空 = code128）
	ShowText  bool   `json:"showText"`  // 1D 條碼下方顯示人讀文字

	Borders *CellBorders `json:"borders"` // 逐格框線（nil = 四邊都畫）
	Wrap    bool         `json:"wrap"`    // 自動換行：內容超寬換行、列高自動延伸（false = 單行裁切加 …）
}

// TableRepeat 陣列迴圈（報表重複列）設定
type TableRepeat struct {
	Enabled  bool   `json:"enabled"`
	Key      string `json:"key"`      // 資料中的陣列路徑，例：items
	RowIndex int    `json:"rowIndex"` // 重複列（0-based），該列儲存格 key 用相對路徑

	// 群組（選填）：GroupBy 為陣列元素上的相對路徑；相同值需相鄰（資料先排序）。
	// 群組首/尾列為樣板中的列索引（0-based），展開時每個群組各插一次；nil = 不用。
	GroupBy        string `json:"groupBy"`
	GroupHeaderRow *int   `json:"groupHeaderRowIndex"`
	GroupFooterRow *int   `json:"groupFooterRowIndex"`
}

