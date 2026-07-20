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

	// 條件顯示（所有元素通用）：VisibleKey 空 = 永遠顯示；隱藏時保留版面空間
	VisibleKey string `json:"visibleKey"`
	VisibleOp  string `json:"visibleOp"`  // truthy(預設) | falsy | eq | ne
	VisibleVal string `json:"visibleVal"` // eq / ne 的比較值

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
	Format     string  `json:"format"` // placeholder 格式化：comma | twUpper | 空 = 原樣

	// barcode（內容取 Key 綁定資料，否則用 Content 靜態值；Sample 為範例）
	Symbology string `json:"symbology"` // code128 | code39 | ean13 | qr
	ShowText  bool   `json:"showText"`  // 1D 條碼下方顯示人讀文字

	// container（Frame 容器）：子元素座標相對於容器左上角；跨頁 keep-together
	Title    string    `json:"title"`    // 容器標題（左上角）
	Children []Element `json:"children"` // 限一層（容器內不再放容器）

	// image
	AssetID string `json:"assetId"`
	Fit     string `json:"fit"` // contain | stretch

	// rect / line
	StrokeColor string  `json:"strokeColor"`
	StrokeWidth float64 `json:"strokeWidth"`
	FillColor   *string `json:"fillColor"`

	// table
	ColumnWidths []float64     `json:"columnWidths"`
	RowHeights   []float64     `json:"rowHeights"`
	BorderColor  string        `json:"borderColor"`
	BorderWidth  float64       `json:"borderWidth"`
	CellPadding  float64       `json:"cellPadding"`
	Cells        [][]TableCell `json:"cells"`
	Repeat       *TableRepeat  `json:"repeat"`
}

type TableCell struct {
	Kind   string `json:"kind"` // text | placeholder
	Value  string `json:"value"`
	Key    string `json:"key"`
	Sample string `json:"sample"`
	Align  string `json:"align"`
	Bold   bool   `json:"bold"`
	Format string `json:"format"` // placeholder 格式化：comma | twUpper | 空 = 原樣

	ColSpan  int     `json:"colSpan"`  // 合併儲存格：向右合併欄數（<=1 = 不合併）
	RowSpan  int     `json:"rowSpan"`  // 合併儲存格：向下合併列數
	FontSize float64 `json:"fontSize"` // 逐格字級（0 = 用表格字級）
	Color    string  `json:"color"`    // 逐格文字顏色（空 = 黑）
	AssetID  string  `json:"assetId"`  // Kind = image 時的圖片（contain 縮放進儲存格）
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

