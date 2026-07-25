package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// 嵌入模式（embed token 的 mode claim）。
// **這是宿主後端換 token 時決定的政策**，不可由宿主前端傳入（見 docs/embed.md）。
const (
	modeDesign = "design" // 完整編輯器：改版面、改內容、上傳
	modeFill   = "fill"   // 只能改被設計者標記 fillable 的內容值
	modeView   = "view"   // 唯讀
)

// capability 能力代號。把 mode 解析成一組能力後**逐端點檢查**，
// 而不是在各 handler 內散落 mode 判斷 —— 否則新增端點必然漏掉。
const (
	capEditLayout = "editLayout" // 改版面（PUT 整份樣板）
	capEditValues = "editValues" // 改可填欄位的值（PATCH /values）
	capUpload     = "upload"     // 上傳圖片／字型
)

// modeCaps 各模式具備的能力。新增模式只要加一列。
var modeCaps = map[string]map[string]bool{
	modeDesign: {capEditLayout: true, capEditValues: true, capUpload: true},
	modeFill:   {capEditValues: true},
	modeView:   {},
}

// validMode 是否為認得的模式（mint 用；宿主明確傳了值就必須是合法值，不做寬容解析）。
func validMode(m string) bool {
	_, ok := modeCaps[m]
	return ok
}

// normalizeMode 解析**既有 token** 的 mode：
//   - 空值 = 加 mode 之前簽出、尚未過期的舊 token → design（相容）
//   - 未知值 = 只可能是版本回退或異常 → **降權到 view**，不是升到 design
//
// 注意：mint 端點不走這條寬容路徑，未知值直接 400（見 embedHandler.mint），
// 免得宿主把 "Fill"／"readonly" 這種拼錯的值送進來卻默默拿到最高權限。
func normalizeMode(m string) string {
	if m == "" {
		return modeDesign
	}
	if validMode(m) {
		return m
	}
	return modeView
}

// embedCan 指定模式是否具備某能力。
func embedCan(mode, capability string) bool {
	return modeCaps[normalizeMode(mode)][capability]
}

// capabilitiesOf 列出某模式的所有能力（給 /api/embed/context 回前端畫 UI 用，
// 讓 UI 與後端強制永遠讀同一份解析結果、不會漂移）。
func capabilitiesOf(mode string) map[string]bool {
	caps := map[string]bool{capEditLayout: false, capEditValues: false, capUpload: false}
	for k := range modeCaps[normalizeMode(mode)] {
		caps[k] = true
	}
	return caps
}

// requireCapability 端點所需能力。只對 embed principal 生效 ——
// 控制台使用者與宿主後端 API key 走各自既有的授權（authorizeTemplate 等）。
func requireCapability(capability string) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := principalOf(c)
		if p.kind == principalEmbed && !embedCan(p.mode, capability) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "此嵌入模式沒有執行這個操作的權限"})
			return
		}
		c.Next()
	}
}

// denyEmbed embed token 一律不可執行（不分模式）。
// 用於刪除樣板：embed token 綁單一樣板，刪掉後宿主端就成了指向不存在樣板的孤兒連結；
// 要刪請走控制台或宿主後端的 API key。
func denyEmbed() gin.HandlerFunc {
	return func(c *gin.Context) {
		if principalKind(c) == principalEmbed {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "嵌入模式不可執行此操作"})
			return
		}
		c.Next()
	}
}
