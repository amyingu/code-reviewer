# 混合方式代码循环审阅

## 架构说明

```
┌─────────────────────────────────────────────────────────────┐
│                    混合方式架构                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Workflow 脚本 (auto-review-loop-hybrid.js)                  │
│  ├── 控制层：循环逻辑、状态管理、错误处理                      │
│  ├── 调用 agent() 执行子任务                                 │
│  └── 参考 SKILL.md 标准构建提示                               │
│                                                             │
│  SKILL.md (code-review-standard/SKILL.md)                    │
│  ├── 配置层：审阅标准、评分规则、输出格式                      │
│  ├── 定义 5 个审阅维度                                       │
│  └── 定义达标标准                                            │
│                                                             │
│  MCP 服务器 (code-reviewer)                                  │
│  └── 工具层：单次审阅调用                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 文件结构

```
~/.claude/
├── workflows/
│   ├── auto-review-loop-hybrid.js    # 混合方式 Workflow
│   ├── auto-review-loop.js           # 原始 Workflow
│   └── README-hybrid.md              # 本说明文件
└── skills/
    └── code-review-standard/
        └── SKILL.md                  # 审阅标准定义
```

## 使用方法

### 基本用法

```bash
# 在 Claude Code 中

# 1. 审阅代码片段
> /workflow auto-review-loop-hybrid --args '{"code": "def fib(n): return fib(n-1)+fib(n-2)", "targetScore": 8}'

# 2. 审阅单个文件
> /workflow auto-review-loop-hybrid --args '{"filePath": "/path/to/file.py", "targetScore": 8}'

# 3. 审阅多个文件
> /workflow auto-review-loop-hybrid --args '{"filePaths": ["/path/to/file1.py", "/path/to/file2.py"]}'

# 4. 审阅整个目录
> /workflow auto-review-loop-hybrid --args '{"dirPath": "/path/to/project"}'
```

### 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `code` | string | - | 代码内容 |
| `filePath` | string | - | 单文件路径 |
| `filePaths` | string[] | - | 多文件路径列表 |
| `dirPath` | string | - | 目录路径 |
| `targetScore` | number | 9.0 | 目标分数 |
| `maxRounds` | number | 5 | 最大轮数 |
| `language` | string | 'python' | 编程语言 |
| `writeBack` | boolean | false | 是否写回文件 |

## 达标标准

根据 SKILL.md 定义：

| 条件 | 说明 |
|------|------|
| 总分 >= 目标分数 | 默认 9.0 分 |
| 无 high 严重度问题 | 必须满足 |
| medium 问题 <= 2 个 | 建议满足 |

## 输出格式

```json
{
  "mode": "single-file",
  "file": "/path/to/file.py",
  "rounds": 3,
  "finalScore": 9.2,
  "targetScore": 9.0,
  "reached": true,
  "code": "...",
  "reviews": [
    {
      "round": 1,
      "overall_score": 6.5,
      "issues": [...],
      "summary": "..."
    },
    {
      "round": 2,
      "overall_score": 8.0,
      "issues": [...],
      "summary": "..."
    },
    {
      "round": 3,
      "overall_score": 9.2,
      "issues": [...],
      "summary": "..."
    }
  ]
}
```

## 与原始版本的区别

| 维度 | 原始版本 | 混合版本 |
|------|----------|----------|
| 审阅标准 | 硬编码在脚本中 | 定义在 SKILL.md |
| 可维护性 | 需要改代码 | 只需改 SKILL.md |
| 灵活性 | 低 | 高 |
| 复用性 | 低 | 高 |

## 自定义审阅标准

编辑 `~/.claude/skills/code-review-standard/SKILL.md`：

1. 修改审阅维度
2. 修改评分权重
3. 修改达标标准
4. 修改输出格式

Workflow 脚本会自动使用新的标准。

## 示例

### 示例 1: 审阅简单函数

```bash
> /workflow auto-review-loop-hybrid --args '{
  "code": "def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)",
  "targetScore": 8,
  "maxRounds": 3
}'
```

### 示例 2: 审阅文件并写回

```bash
> /workflow auto-review-loop-hybrid --args '{
  "filePath": "/home/user/project/utils.py",
  "targetScore": 9,
  "writeBack": true
}'
```

### 示例 3: 审阅整个项目

```bash
> /workflow auto-review-loop-hybrid --args '{
  "dirPath": "/home/user/project",
  "targetScore": 8
}'
```
