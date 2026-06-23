---
name: auto-review-loop
description: 自动循环审阅代码并修改直到达标。当用户说"循环审阅"、"自动审阅"、"审阅并修改"、"优化代码到X分"、"auto review"、"review loop"时使用此技能。支持代码片段、单文件、多文件、整个目录。
version: 2.0.0
---

# 自动循环审阅工作流

自动执行「审阅→修改→再审阅」循环，直到代码分数达标或达到最大轮数。

## 触发条件

当用户的请求包含以下关键词或意图时使用此技能：
- "循环审阅"、"自动审阅"、"审阅并修改"
- "优化代码到X分"、"审阅目标分数X"
- "auto review"、"review loop"
- "审阅文件"、"审阅目录"、"审阅项目"
- 提供了代码或文件路径并要求审阅+改进

## 使用方式

### 步骤 1：解析用户输入

从用户输入中提取以下信息：

| 信息 | 提取方式 | 示例 |
|------|----------|------|
| 代码内容 | 用户直接提供的代码块 | `def hello(): ...` |
| 文件路径 | 用户提到的文件路径 | `./src/app.py` |
| 目录路径 | 用户提到的目录 | `./src` |
| 目标分数 | "目标分数X" 或 "到X分" | `8`、`9` |
| 最大轮数 | "最多X轮" 或 "轮数X" | `3`、`5` |
| 编程语言 | 文件扩展名或用户指定 | `python`、`javascript` |

### 步骤 2：调用 Workflow

根据用户输入构建 args 并调用 Workflow：

```javascript
Workflow({
  scriptPath: '~/.claude/workflows/auto-review-loop.js',
  args: {
    // 以下三选一
    code: '用户的代码',           // 代码片段模式
    filePath: '/path/to/file.py', // 单文件模式
    filePaths: ['a.py', 'b.py'],  // 多文件模式
    dirPath: '/path/to/src',      // 目录模式

    // 可选参数
    language: 'python',           // 默认 python
    targetScore: 9,               // 默认 9.0
    maxRounds: 5,                 // 默认 5
    writeBack: false,             // 是否写回文件
  }
})
```

### 步骤 3：展示结果

工作流完成后，向用户展示：
- 总轮次
- 每轮分数变化
- 最终分数和达标状态
- 主要改进内容
- 最终代码（如为代码片段模式）

## 支持的审阅模式

### 模式一：代码片段

用户直接提供代码：
```
请循环审阅这段代码，目标分数 8：
```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
```
```

args:
```json
{
  "code": "def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)",
  "language": "python",
  "targetScore": 8
}
```

### 模式二：单文件

用户提供文件路径：
```
审阅文件 ./src/app.py，目标分数 8，最多 3 轮
```

args:
```json
{
  "filePath": "./src/app.py",
  "targetScore": 8,
  "maxRounds": 3
}
```

### 模式三：多文件

用户提供多个文件：
```
审阅以下文件：src/app.py, src/utils.py, src/models.py
```

args:
```json
{
  "filePaths": ["src/app.py", "src/utils.py", "src/models.py"]
}
```

### 模式四：整个目录

用户提供目录路径：
```
审阅 ./src 目录下的所有代码
```

args:
```json
{
  "dirPath": "./src"
}
```

## 默认值

当用户未指定时使用以下默认值：

| 参数 | 默认值 |
|------|--------|
| language | `"python"` |
| targetScore | `9.0` |
| maxRounds | `5` |
| writeBack | `false` |

## 语言推断

根据文件扩展名自动推断语言：

| 扩展名 | 语言 |
|--------|------|
| `.py` | python |
| `.js` | javascript |
| `.ts` | typescript |
| `.java` | java |
| `.go` | go |
| `.rs` | rust |
| `.c` | c |
| `.cpp` | cpp |
| `.h` | c |

## 输出格式

工作流返回结果后，用以下格式展示给用户：

```
📊 循环审阅完成

| 轮次 | 分数 | 主要改动 |
|------|------|----------|
| 1 | X.X | ... |
| 2 | X.X | ... |
| 3 | X.X | ... |

总轮次：X
最终分数：X.X/10
目标分数：X.X/10
达标状态：✅ 达标 / ❌ 未达标

主要改进：
- ✅ ...
- ✅ ...
- ✅ ...
```

## 注意事项

1. **args 必须是对象**：Workflow 的 args 参数会被序列化为字符串，脚本内部已处理 JSON.parse
2. **权限要求**：需要在 `~/.claude/settings.json` 中添加 `mcp__code-reviewer__review_code` 到 allow 列表
3. **MCP 服务器**：需要 code-reviewer MCP 服务器处于 connected 状态
4. **文件路径**：支持相对路径和绝对路径
5. **大文件**：超过 1000 行的文件可能需要更多轮次

## 相关文件

| 文件 | 路径 | 说明 |
|------|------|------|
| 工作流脚本 | `~/.claude/workflows/auto-review-loop.js` | Workflow 执行脚本 |
| MCP 服务器 | `~/.codex/mcp-servers/code-reviewer/server.py` | code-reviewer 服务 |
| 配置文件 | `~/.codex/mcp-servers/code-reviewer/.env` | API 配置 |
| 文档 | `~/.codex/mcp-servers/code-reviewer/README.md` | 完整文档 |
