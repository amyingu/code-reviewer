#!/bin/bash
# PostToolUse Hook: Write/Edit 后自动审阅
#
# 安装方式：
# 在 ~/.claude/settings.json 的 hooks.PostToolUse 中添加：
# {
#   "matcher": "Write|Edit",
#   "hooks": [{
#     "type": "command",
#     "command": "bash ~/.codex/mcp-servers/code-reviewer/hooks/post-write-review.sh",
#     "timeout": 30
#   }]
# }
#
# 功能：
# - 只审阅代码文件（.py/.js/.ts/.java/.go/.rs/.c/.cpp）
# - 冷却期 60 秒，避免频繁审阅
# - 审阅结果输出到 stderr，不影响正常流程

# 冷却期（秒）
COOLDOWN=60
COOLDOWN_FILE="/tmp/.code-reviewer-last-review"

# 检查冷却期
if [ -f "$COOLDOWN_FILE" ]; then
    LAST_REVIEW=$(cat "$COOLDOWN_FILE")
    NOW=$(date +%s)
    ELAPSED=$((NOW - LAST_REVIEW))
    if [ "$ELAPSED" -lt "$COOLDOWN" ]; then
        exit 0  # 冷却期内，跳过
    fi
fi

# 从环境变量获取工具信息
TOOL_NAME="${CLAUDE_TOOL_NAME:-}"
TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"

# 只处理 Write 和 Edit
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
    exit 0
fi

# 提取文件路径
FILE_PATH=$(echo "$TOOL_INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('file_path', ''))
except:
    print('')
" 2>/dev/null)

# 检查是否是代码文件
if [[ -z "$FILE_PATH" ]]; then
    exit 0
fi

EXTENSION="${FILE_PATH##*.}"
case "$EXTENSION" in
    py|js|ts|java|go|rs|c|cpp|h|hpp|rb|php|swift|kt)
        ;;
    *)
        exit 0  # 不是代码文件，跳过
        ;;
esac

# 检查文件是否存在且非空
if [ ! -f "$FILE_PATH" ] || [ ! -s "$FILE_PATH" ]; then
    exit 0
fi

# 记录审阅时间
date +%s > "$COOLDOWN_FILE"

# 读取文件内容（截取前 500 行避免过大）
FILE_CONTENT=$(head -500 "$FILE_PATH")
LINE_COUNT=$(wc -l < "$FILE_PATH")

# 输出审阅提示到 stderr（用户可见但不干扰流程）
echo "🔍 [auto-review] 审阅 ${FILE_PATH##*/} (${LINE_COUNT} 行)..." >&2

# 这里可以调用 code-reviewer MCP，但 hook 环境中无法直接调用 MCP
# 改为输出提示，让用户或 Claude 看到
echo "📝 [auto-review] 代码文件已修改，建议审阅: $FILE_PATH" >&2
