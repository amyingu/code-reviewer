#!/bin/bash
# Code Reviewer 安装脚本
# 用法: bash install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🔧 Code Reviewer 安装脚本"
echo "========================"
echo ""

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "❌ 需要 Python 3"
    exit 1
fi

echo "✅ Python 3 已安装"

# 检查 Claude Code
if ! command -v claude &> /dev/null; then
    echo "⚠️  未找到 claude 命令，请先安装 Claude Code"
    echo "   npm install -g @anthropic-ai/claude-code"
    exit 1
fi

echo "✅ Claude Code 已安装"

# 配置 .env
if [ ! -f "$SCRIPT_DIR/mcp-server/.env" ]; then
    cp "$SCRIPT_DIR/mcp-server/.env.example" "$SCRIPT_DIR/mcp-server/.env"
    echo ""
    echo "📝 请编辑配置文件填入你的 API 密钥："
    echo "   $SCRIPT_DIR/mcp-server/.env"
    echo ""
    echo "   CODE_REVIEW_API_KEY=your-api-key"
    echo "   CODE_REVIEW_BASE_URL=https://api.openai.com/v1"
    echo "   CODE_REVIEW_MODEL=gpt-4"
    echo ""
    read -p "按 Enter 继续（已填好配置）..."
fi

echo "✅ 配置文件已就绪"

# 注册 MCP 服务器
echo ""
echo "📦 注册 MCP 服务器..."
claude mcp add code-reviewer -s user -- python3 "$SCRIPT_DIR/mcp-server/server.py" 2>/dev/null || true
echo "✅ MCP 服务器已注册"

# 安装 Skills
echo ""
echo "📚 安装 Skills..."
for skill in auto-review-loop code-with-review review-current code-review-standard; do
    mkdir -p ~/.claude/skills/$skill
    cp "$SCRIPT_DIR/skills/$skill/SKILL.md" ~/.claude/skills/$skill/SKILL.md
done
echo "✅ Skills 已安装"

# 安装 Workflow
echo ""
echo "⚙️  安装 Workflow..."
mkdir -p ~/.claude/workflows
cp "$SCRIPT_DIR/workflow/auto-review-loop.js" ~/.claude/workflows/
cp "$SCRIPT_DIR/workflow/auto-review-loop-hybrid.js" ~/.claude/workflows/
echo "✅ Workflow 已安装（基础版 + 混合版）"

# 安装 Hook（可选）
echo ""
read -p "是否安装 Write/Edit 后自动提醒 Hook？(y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    mkdir -p ~/.codex/mcp-servers/code-reviewer/hooks
    cp "$SCRIPT_DIR/hooks/post-write-review.sh" ~/.codex/mcp-servers/code-reviewer/hooks/
    echo "✅ Hook 已安装"
    echo "   请手动在 ~/.claude/settings.json 的 hooks.PostToolUse 中添加配置"
fi

echo ""
echo "🎉 安装完成！"
echo ""
echo "📋 已安装内容："
echo "   - MCP 服务器（带 429 限流重试）"
echo "   - 4 个 Skills（auto-review-loop, code-with-review, review-current, code-review-standard）"
echo "   - 2 个 Workflow（基础版 + 混合版）"
echo ""
echo "📋 下一步："
echo "   1. 编辑 $SCRIPT_DIR/mcp-server/.env 填入 API 密钥"
echo "   2. 重启 Claude Code 会话"
echo "   3. 输入以下命令测试："
echo ""
echo "      # 基础版 Workflow"
echo "      /workflow auto-review-loop --args '{\"code\": \"def hello(): print('hello')\", \"targetScore\": 8}'"
echo ""
echo "      # 混合版 Workflow（推荐）"
echo "      /workflow auto-review-loop-hybrid --args '{\"code\": \"def hello(): print('hello')\", \"targetScore\": 8}'"
echo ""
echo "   或使用自然语言："
echo ""
echo "      循环审阅这段代码，目标分数 8："
echo "      \`\`\`python"
echo "      def fibonacci(n):"
echo "          if n <= 1: return n"
echo "          return fibonacci(n-1) + fibonacci(n-2)"
echo "      \`\`\`"
echo ""
