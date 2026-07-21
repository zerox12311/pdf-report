#!/bin/bash
# Stop hook：功能寫完（回合結束）時檢查 docs 是否跟上程式碼變更。
# 有程式碼變更但 docs/、CLAUDE.md 都沒動 → 擋一次停止，提醒依
# 「功能完成 = 文件已更新」規範補文件（或說明本次不需要的原因）。
# 每個停止只擋一次（stop_hook_active 時放行），不會無限循環。

input=$(cat)

# 已被本 hook 擋過一次：Claude 已補文件或已說明原因 → 放行
if echo "$input" | grep -q '"stop_hook_active":[[:space:]]*true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# 未 commit 的變更（含新檔案）
changed=$( { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard; } | sort -u)

code_changed=$(echo "$changed" | grep -E '^(frontend/src/|backend/(cmd|internal)/)' || true)
docs_changed=$(echo "$changed" | grep -E '^(docs/|CLAUDE\.md)' || true)

if [ -n "$code_changed" ] && [ -z "$docs_changed" ]; then
  cat >&2 <<EOF
【docs 檢查】偵測到程式碼變更，但 docs/ 與 CLAUDE.md 都沒有更新：
$(echo "$code_changed" | head -10)

依 CLAUDE.md「功能完成 = 文件已更新」規範：
- 若本次變更影響功能行為 → 更新 docs/editor.md、docs/engine.md 或 docs/api.md（只記結果不記歷史）後再結束。
- 若確定不影響行為（純重構、測試、bugfix 未改行為）→ 在回覆中用一句話說明原因，即可結束。
EOF
  exit 2
fi

exit 0
