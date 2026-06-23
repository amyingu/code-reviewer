# Code Reviewer MCP 服务器 + 自动循环审阅工作流

基于 AI 模型的代码自动审阅系统，支持循环审阅、自动修改、边写边审。

## 功能特性

- 🔍 **结构化审阅** — 5 个维度评分（质量/正确性/性能/安全/测试）
- 🔄 **循环优化** — 自动审阅→修改→再审阅，直到分数达标
- 📁 **多模式支持** — 代码片段、单文件、多文件、整个目录
- ✍️ **边写边审** — 编写代码时自动审阅并修复
- 🛠️ **MCP 标准** — 兼容 Claude Code 的 MCP 协议

## 快速开始

### 1. 安装 MCP 服务器

```bash
# 克隆仓库
git clone https://github.com/your-username/code-reviewer.git
cd code-reviewer

# 安装依赖（无外部依赖，仅使用 Python 标准库）

# 配置 API
cp mcp-server/.env.example mcp-server/.env
# 编辑 .env 填入你的 API 密钥
```

### 2. 注册到 Claude Code

```bash
# 添加 MCP 服务器
claude mcp add code-reviewer -s user -- python3 $(pwd)/mcp-server/server.py

# 添加权限（在 ~/.claude/settings.json 的 permissions.allow 中）
# "mcp__code-reviewer__review_code"
# "mcp__code-reviewer__review_code_reply"

# 安装 Skills
mkdir -p ~/.claude/skills/auto-review-loop
cp skills/auto-review-loop.md ~/.claude/skills/auto-review-loop/SKILL.md
mkdir -p ~/.claude/skills/code-with-review
cp skills/code-with-review.md ~/.claude/skills/code-with-review/SKILL.md
mkdir -p ~/.claude/skills/review-current
cp skills/review-current.md ~/.claude/skills/review-current/SKILL.md

# 安装 Workflow
cp workflow/auto-review-loop.js ~/.claude/workflows/

# 重启 Claude Code 会话
```

### 3. 使用

```bash
# 方式一：自然语言（推荐）
请循环审阅这段代码，目标分数 8

# 方式二：审阅文件
自动审阅 ./src/app.py，目标分数 8

# 方式三：边写边审
写一个排序函数，并审阅

# 方式四：审阅当前改动
审阅当前改动
```

## 项目结构

```
code-reviewer/
├── mcp-server/                     # MCP 服务器
│   ├── server.py                   # 主程序
│   └── .env.example                # 配置模板
├── workflow/                       # Workflow 脚本
│   └── auto-review-loop.js         # 循环审阅工作流
├── skills/                         # Claude Code Skills
│   ├── auto-review-loop/
│   │   └── SKILL.md                # 循环审阅技能
│   ├── code-with-review/
│   │   └── SKILL.md                # 自审阅技能
│   └── review-current/
│       └── SKILL.md                # 审阅当前改动技能
├── hooks/                          # Hook 脚本
│   └── post-write-review.sh        # Write/Edit 后提醒
├── docs/                           # 文档
│   └── README.md                   # 完整文档
├── install.sh                      # 一键安装脚本
├── .gitignore
├── LICENSE
└── README.md                       # 本文件
```

## 支持的 API

| API | BASE_URL | 模型 |
|-----|----------|------|
| OpenAI | `https://api.openai.com/v1` | gpt-4, gpt-4-turbo |
| 小米 MiMo | `https://token-plan-cn.xiaomimimo.com/v1` | mimo-v2.5, mimo-v2.5-pro |
| 其他兼容 API | 自定义 | 自定义 |

## 审阅结果示例

```json
{
  "scores": {
    "quality": 8,
    "correctness": 7,
    "performance": 9,
    "security": 6,
    "testing": 5
  },
  "overall_score": 7.0,
  "issues": [
    {
      "severity": "high",
      "category": "performance",
      "description": "递归实现 O(2^n)",
      "suggestion": "改用迭代或 lru_cache"
    }
  ],
  "summary": "代码简洁但性能需优化..."
}
```

## 文档

完整文档见 [docs/README.md](docs/README.md)

## 许可证

[MIT License](LICENSE)
