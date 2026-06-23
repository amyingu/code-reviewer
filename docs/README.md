# Code Reviewer MCP 服务器 + 自动循环审阅工作流

## 目录

- [概述](#概述)
- [架构设计](#架构设计)
- [Code Reviewer MCP 服务器](#code-reviewer-mcp-服务器)
  - [工作原理](#工作原理)
  - [安装配置](#安装配置)
  - [手动使用](#手动使用)
- [Workflow 工作流](#workflow-工作流)
  - [工作原理](#工作原理-1)
  - [核心概念](#核心概念)
  - [脚本语法](#脚本语法)
- [自动循环审阅工作流](#自动循环审阅工作流)
  - [使用方法](#使用方法)
  - [参数说明](#参数说明)
  - [执行流程](#执行流程)
  - [运行示例](#运行示例)
- [工作流详细使用指南](#工作流详细使用指南)
  - [支持的审阅模式](#支持的审阅模式)
  - [完整参数说明](#完整参数说明)
  - [Args 传递注意事项](#args-传递注意事项)
- [斜杠命令（Skill）](#斜杠命令skill)
  - [触发方式](#触发方式)
  - [使用示例](#使用示例)
  - [Skill 工作原理](#skill-工作原理)
- [编码过程中审阅（边写边审）](#编码过程中审阅边写边审)
  - [Claude 自审阅](#模式一claude-自审阅code-with-review)
  - [审阅当前改动](#模式二审阅当前改动review-current)
  - [Hook 自动触发](#模式三hook-自动触发可选)
  - [推荐工作流](#推荐工作流)
- [审阅过程文件存放位置](#审阅过程文件存放位置)
  - [文件结构总览](#文件结构总览)
  - [各文件说明](#各文件说明)
  - [最终输出文件](#最终输出文件)
  - [查看审阅记录](#查看审阅记录)
- [实际运行案例](#实际运行案例)
- [项目文件清单](#项目文件清单)
  - [核心文件](#核心文件)
  - [Skill 文件](#skill-文件斜杠命令)
  - [Hook 脚本](#hook-脚本)
  - [文件依赖关系](#文件依赖关系)
  - [配置文件位置汇总](#配置文件位置汇总)
- [更新日志](#更新日志)
- [常见问题](#常见问题)

---

## 概述

本项目包含两个核心组件：

1. **Code Reviewer MCP 服务器** — 调用 AI 模型 API 对代码进行结构化审阅
2. **自动循环审阅工作流** — 基于 Claude Code Workflow 引擎，自动执行「审阅→修改→再审阅」循环

两者结合实现了**全自动代码优化**：提交代码后，系统自动审阅、自动修改、自动再审阅，直到分数达标或达到最大轮数。

---

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code 主进程                         │
│                                                              │
│  用户输入 ──→ Workflow 引擎                                   │
│                │                                             │
│                ├──→ Agent 1 (审阅)                           │
│                │      │                                      │
│                │      └──→ mcp__code-reviewer__review_code   │
│                │                │                            │
│                │                └──→ AI 模型 API             │
│                │                      (mimo-v2.5-pro)        │
│                │                                             │
│                ├──→ Agent 2 (修改)                           │
│                │      └──→ 分析问题 + 生成新代码               │
│                │                                             │
│                └──→ 循环判断 ──→ 是否继续?                    │
│                        │                                     │
│                        ├── 分数 < 目标 → 继续下一轮           │
│                        └── 分数 >= 目标 → 输出结果            │
└─────────────────────────────────────────────────────────────┘
```

### 组件关系

| 组件 | 角色 | 说明 |
|------|------|------|
| **code-reviewer (MCP Server)** | 工具层 | 封装 AI 模型 API，提供标准化审阅接口 |
| **Workflow 引擎** | 编排层 | 管理多 Agent 协作，控制循环逻辑 |
| **Agent (审阅)** | 执行层 | 调用 MCP 工具审阅代码，返回结构化结果 |
| **Agent (修改)** | 执行层 | 根据审阅意见自动修改代码 |

---

## Code Reviewer MCP 服务器

### 工作原理

MCP（Model Context Protocol）服务器是一个独立进程，通过 stdio 与 Claude Code 通信：

```
Claude Code  ──(JSON-RPC over stdio)──→  MCP Server  ──(HTTP)──→  AI API
             ←──(JSON-RPC over stdio)──             ←──(HTTP)──
```

#### 请求处理流程

1. **Claude Code** 发送 JSON-RPC 请求（如 `tools/call`）
2. **MCP Server** 解析请求，提取代码和参数
3. **MCP Server** 构建审阅 prompt，调用 AI 模型 API
4. **AI 模型** 返回结构化审阅结果（JSON）
5. **MCP Server** 解析结果，封装为 MCP 响应
6. **Claude Code** 收到审阅结果

#### 核心代码逻辑

```python
def handle_code_review(code, language, ...):
    # 1. 构建审阅 prompt
    prompt = build_review_prompt(code, language, ...)

    # 2. 调用 AI 模型
    response_text = call_ai_model(prompt, model)

    # 3. 解析为结构化结果
    review_result = parse_review_response(response_text)

    return review_result
```

#### AI 模型调用

```python
def call_ai_model(prompt, model):
    request_payload = {
        "model": model,  # 从 .env 读取，默认 mimo-v2.5-pro
        "messages": [
            {"role": "system", "content": "你是一个专业的代码审阅专家..."},
            {"role": "user",   "content": prompt}
        ]
    }
    # POST 到 API 端点
    response = requests.post(f"{base_url}/chat/completions", ...)
    return response["choices"][0]["message"]["content"]
```

### 安装配置

#### 目录结构

```
~/.codex/mcp-servers/code-reviewer/
├── server.py          # MCP 服务器主程序
├── .env               # 配置文件（API Key、模型等）
└── README.md          # 本文档
```

#### 配置文件 `.env`

```bash
# Code Reviewer MCP 服务器配置
CODE_REVIEW_API_KEY=your-api-key-here
CODE_REVIEW_BASE_URL=https://api.example.com/v1
CODE_REVIEW_MODEL=mimo-v2.5-pro
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CODE_REVIEW_API_KEY` | AI 模型 API 密钥 | （必填） |
| `CODE_REVIEW_BASE_URL` | API 端点地址 | `https://api.openai.com/v1` |
| `CODE_REVIEW_MODEL` | 使用的模型名称 | `gpt-4` |
| `CODE_REVIEWER_DEBUG` | 启用调试日志（`1` 启用） | 空（关闭） |

#### 注册到 Claude Code

```bash
# 添加 MCP 服务器
claude mcp add code-reviewer -s user -- python3 ~/.codex/mcp-servers/code-reviewer/server.py

# 验证
claude  # 重启会话后输入 /mcp 查看状态
```

#### 添加权限（重要！）

在 `~/.claude/settings.json` 的 `permissions.allow` 中添加：

```json
{
  "permissions": {
    "allow": [
      "mcp__code-reviewer__review_code",
      "mcp__code-reviewer__review_code_reply"
    ]
  }
}
```

> **为什么需要权限？** 不添加权限时，每次调用都会弹出确认提示，导致 Workflow 中的 Agent 无法自动执行。

### 手动使用

在 Claude Code 中直接调用：

```
请使用 code-reviewer 审阅这段代码：
```python
def hello():
    print("hello")
```
```

Claude Code 会自动调用 `mcp__code-reviewer__review_code` 工具，返回结构化审阅结果。

---

## Workflow 工作流

### 工作原理

Workflow 是 Claude Code 的多 Agent 编排引擎，用于执行复杂的多步骤任务：

```
用户请求
    │
    ▼
Workflow 引擎（主控）
    │
    ├── Phase 1: 审阅
    │   └── Agent 1（独立上下文）
    │       └── 调用 MCP 工具
    │
    ├── Phase 2: 修改
    │   └── Agent 2（独立上下文）
    │       └── 分析 + 生成代码
    │
    └── Phase 3: 验证
        └── 汇总结果
```

### 核心概念

| 概念 | 说明 |
|------|------|
| **Workflow Script** | JavaScript 脚本，定义工作流逻辑 |
| **Phase** | 阶段，用于分组和展示进度 |
| **Agent** | 独立的 AI 执行单元，有自己的上下文 |
| **Pipeline** | 流水线，多个项目串行通过多个阶段 |
| **Parallel** | 并行，多个任务同时执行 |
| **Log** | 进度日志，展示给用户 |

### 脚本语法

#### 基本结构

```javascript
export const meta = {
  name: 'my-workflow',
  description: '工作流描述',
  phases: [
    { title: '阶段1', detail: '详细说明' },
    { title: '阶段2', detail: '详细说明' },
  ],
};

// 脚本主体（异步执行）
// 可用：agent(), pipeline(), parallel(), phase(), log(), args, budget
```

#### Agent — 调用 AI 执行任务

```javascript
const result = await agent('请审阅这段代码...', {
  label: '审阅Agent',     // 显示标签
  phase: '审阅',          // 所属阶段
  schema: { ... },        // 可选：强制输出 JSON Schema
  model: 'sonnet',        // 可选：模型覆盖
  effort: 'high',         // 可选：推理强度
  isolation: 'worktree',  // 可选：隔离模式
});
```

#### Pipeline — 流水线处理

```javascript
// items 依次通过 stage1, stage2, stage3
const results = await pipeline(
  [item1, item2, item3],
  (item) => agent(`处理 ${item}`, { phase: '阶段1' }),
  (result, item) => agent(`优化 ${result}`, { phase: '阶段2' }),
);
```

#### Parallel — 并行执行

```javascript
const [a, b, c] = await parallel([
  () => agent('任务A', { phase: '阶段1' }),
  () => agent('任务B', { phase: '阶段1' }),
  () => agent('任务C', { phase: '阶段1' }),
]);
```

#### Phase & Log — 进度控制

```javascript
phase('审阅');          // 开始新阶段
log('正在审阅...');     // 输出进度信息
```

#### Args — 参数传递

```javascript
// 通过 Workflow({args: {...}}) 传入的参数
const code = args?.code;
const maxRounds = args?.maxRounds ?? 5;
```

---

## 自动循环审阅工作流

### 使用方法

#### 方法一：直接在 Claude Code 中运行

在 Claude Code 中输入：

```
运行自动循环审阅，代码如下：
```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
```
目标分数 9，最多 5 轮。
```

Claude Code 会自动调用 Workflow 执行。

#### 方法二：通过 Workflow 工具调用

```javascript
Workflow({
  scriptPath: '~/.claude/workflows/auto-review-loop.js',
  args: {
    code: 'def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)',
    language: 'python',
    targetScore: 9,
    maxRounds: 5,
  }
})
```

#### 方法三：修改脚本后重新运行

```javascript
// 编辑脚本中的默认代码
// Write('~/.claude/workflows/auto-review-loop.js', newContent)

// 使用新脚本运行
Workflow({ scriptPath: '~/.claude/workflows/auto-review-loop.js', args: { ... } })
```

> **注意：** 如果 args 参数未正确传递（工作流使用了默认代码），可以编辑脚本文件，直接修改 `if (!code)` 块中的默认代码为你要审阅的代码。

### 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `code` | string | fibonacci 示例 | 待审阅的代码 |
| `language` | string | `"python"` | 编程语言 |
| `targetScore` | number | `9.0` | 目标分数（1-10） |
| `maxRounds` | number | `5` | 最大循环轮数 |

### 执行流程

```
开始
 │
 ▼
┌─────────────────────────────────┐
│ 第 N 轮 (N = 1, 2, ...)         │
│                                  │
│  ┌───────────────────────────┐  │
│  │ Phase 1: 审阅              │  │
│  │                            │  │
│  │  Agent → 调用 code-reviewer│  │
│  │        → 返回分数和问题     │  │
│  └───────────────────────────┘  │
│           │                      │
│           ▼                      │
│  ┌───────────────────────────┐  │
│  │ 判断：分数 >= 目标?        │──┼──→ 是 → 输出结果 → 结束
│  └───────────────────────────┘  │
│           │ 同                   │
│           ▼                      │
│  ┌───────────────────────────┐  │
│  │ 判断：无中高严重度问题?    │──┼──→ 是 → 输出结果 → 结束
│  └───────────────────────────┘  │
│           │ 否                   │
│           ▼                      │
│  ┌───────────────────────────┐  │
│  │ Phase 2: 修改              │  │
│  │                            │  │
│  │  Agent → 分析审阅问题      │  │
│  │        → 生成修改后代码    │  │
│  └───────────────────────────┘  │
│           │                      │
│           ▼                      │
│       继续下一轮                  │
└─────────────────────────────────┘
```

### 运行示例

#### 输入

```javascript
Workflow({
  scriptPath: '/tmp/auto-review-loop.js',
  args: {
    code: 'def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)',
    targetScore: 9,
    maxRounds: 5,
  }
})
```

#### 执行过程

```
==================================================
📋 第 1/5 轮审阅
==================================================
Phase: 审阅
提交代码给 code-reviewer...
📊 审阅结果：总分 3.8/10
🏆 新最高分：3.8
⚠️  3 个中高严重度问题需要修复：
   [high] correctness: 函数没有处理 n < 0 的输入
   [high] performance: 朴素递归 O(2^n)
   [high] testing: 完全没有测试

Phase: 修改
根据审阅意见自动修改代码...
✅ 代码已更新（45 行）

==================================================
📋 第 2/5 轮审阅
==================================================
Phase: 审阅
提交代码给 code-reviewer...
📊 审阅结果：总分 8.8/10
🏆 新最高分：8.8
✅ 无中高严重度问题，审阅通过

==================================================
📊 循环审阅完成
==================================================
总轮次：2
最终分数：8.8/10
目标分数：9.0/10
达标状态：❌ 未达标（仅差 0.2，全部为低严重度建议）
分数变化：第1轮=3.8 → 第2轮=8.8
```

#### 输出结果

```json
{
  "rounds": 2,
  "finalScore": 8.8,
  "targetScore": 9,
  "reached": false,
  "code": "from functools import lru_cache\n\n@lru_cache(maxsize=None)\ndef fibonacci(n: int) -> int:\n    ...",
  "reviews": [
    { "round": 1, "score": 3.8, "issues": [...], "summary": "..." },
    { "round": 2, "score": 8.8, "issues": [...], "summary": "..." }
  ]
}
```

---

## 常见问题

### Q: MCP 服务器显示 failed 怎么办？

1. 检查 `.env` 中 API Key 是否正确
2. 检查 API 端点是否可访问
3. 运行 `claude mcp remove code-reviewer -s user` 后重新添加
4. 重启 Claude Code 会话

### Q: 工作流中 Agent 调用 MCP 工具报错？

确保 `~/.claude/settings.json` 中已添加权限：

```json
"permissions": {
  "allow": [
    "mcp__code-reviewer__review_code",
    "mcp__code-reviewer__review_code_reply"
  ]
}
```

### Q: 如何切换审阅使用的模型？

编辑 `.env` 文件：

```bash
CODE_REVIEW_MODEL=mimo-v2.5      # 轻量版
CODE_REVIEW_MODEL=mimo-v2.5-pro  # 专业版（默认）
```

### Q: 如何调整循环审阅的参数？

修改 `Workflow` 调用时的 `args`：

```javascript
args: {
  targetScore: 8,    // 降低目标分数
  maxRounds: 3,      // 减少最大轮数
}
```

### Q: 审阅结果中的分数维度是什么？

| 维度 | 说明 |
|------|------|
| quality | 代码质量（可读性、可维护性、风格） |
| correctness | 功能正确性（逻辑、边界、错误处理） |
| performance | 性能（时间/空间复杂度、资源使用） |
| security | 安全性（输入验证、权限、漏洞风险） |
| testing | 测试（覆盖、质量、边界测试） |

### Q: 如何调试工作流？

1. 查看工作流进度：在 Claude Code 中输入 `/workflows`
2. 查看 Agent 日志：检查 `~/.claude/projects/.../subagents/workflows/` 目录
3. 启用 MCP 调试日志：在 `.env` 中设置 `CODE_REVIEWER_DEBUG=1`

### Q: 如何扩展为多语言审阅？

MCP 服务器支持任意语言，只需在调用时指定 `language` 参数：

```javascript
args: {
  code: 'function hello() { console.log("hello"); }',
  language: 'javascript',
}
```

审阅 prompt 会自动适配指定语言。

---

## 工作流详细使用指南

### 支持的审阅模式

工作流支持 4 种审阅模式，通过不同参数组合触发：

| 模式 | 参数 | 说明 |
|------|------|------|
| **代码片段** | `code` | 直接传入代码字符串 |
| **单文件** | `filePath` | 传入文件路径，自动读取内容 |
| **多文件** | `filePaths` | 传入文件路径数组，逐个审阅 |
| **整个目录** | `dirPath` | 扫描目录下所有代码文件 |

#### 模式一：代码片段审阅

直接传入代码字符串，适合快速审阅小段代码。

```javascript
Workflow({
  scriptPath: '~/.claude/workflows/auto-review-loop.js',
  args: {
    code: 'def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)',
    language: 'python',
    targetScore: 9,
    maxRounds: 5,
  }
})
```

自然语言说法：
```
运行自动审阅，代码如下：
```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
```
目标分数 9，最多 5 轮。
```

#### 模式二：单文件审阅

传入文件路径，工作流自动读取文件内容并审阅。

```javascript
Workflow({
  scriptPath: '~/.claude/workflows/auto-review-loop.js',
  args: {
    filePath: '/path/to/your/file.py',
    language: 'python',
    targetScore: 8,
    maxRounds: 3,
  }
})
```

自然语言说法：
```
用自动审阅工作流审阅文件 /path/to/file.py，目标分数 8
```

#### 模式三：多文件审阅

传入文件路径数组，逐个审阅每个文件并输出汇总报告。

```javascript
Workflow({
  scriptPath: '~/.claude/workflows/auto-review-loop.js',
  args: {
    filePaths: [
      '/path/to/file1.py',
      '/path/to/file2.py',
      '/path/to/file3.py',
    ],
    targetScore: 8,
  }
})
```

自然语言说法：
```
审阅以下文件：src/app.py, src/utils.py, src/models.py
```

多文件模式会输出每个文件的分数和汇总：
```
📁 多文件审阅模式：3 个文件
────────────────────────────────────
📄 审阅文件：src/app.py
  📊 分数：7.5/10，问题：3 个
📄 审阅文件：src/utils.py
  📊 分数：8.2/10，问题：1 个
📄 审阅文件：src/models.py
  📊 分数：6.8/10，问题：5 个

📊 多文件审阅汇总
==================================================
  ❌ src/models.py: 6.8/10
  ⚠️ src/app.py: 7.5/10
  ✅ src/utils.py: 8.2/10

平均分：7.5/10
```

#### 模式四：整个目录审阅

传入目录路径，自动扫描所有代码文件并逐个审阅。

```javascript
Workflow({
  scriptPath: '~/.claude/workflows/auto-review-loop.js',
  args: {
    dirPath: '/path/to/project/src',
    targetScore: 8,
    maxRounds: 3,
  }
})
```

自然语言说法：
```
审阅 ./src 目录下的所有代码文件，目标分数 8
```

支持的文件类型：`.py` `.js` `.ts` `.java` `.go` `.rs` `.c` `.cpp` `.h`

### 完整参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `code` | string | fibonacci 示例 | 代码内容（模式一） |
| `filePath` | string | — | 单个文件路径（模式二） |
| `filePaths` | string[] | — | 多个文件路径（模式三） |
| `dirPath` | string | — | 目录路径（模式四） |
| `language` | string | `"python"` | 编程语言 |
| `targetScore` | number | `9.0` | 目标分数（1-10） |
| `maxRounds` | number | `5` | 最大循环轮数 |
| `writeBack` | boolean | `false` | 是否将修改写回文件 |

**参数优先级：** `filePaths` > `filePath` > `dirPath` > `code`

### Args 传递注意事项

Workflow 引擎的 `args` 参数在传递时会被序列化为**字符串**，脚本内部需要解析：

```javascript
// 脚本内部已处理，无需手动操作
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {});
```

> **历史问题：** 早期版本未处理 args 字符串化问题，导致 `args.code` 始终为 `undefined`，
> 工作流总是使用默认 fibonacci 代码。已在 v2 版本中修复。

---

## 斜杠命令（Skill）

### 概述

`auto-review-loop` 已注册为 Claude Code 的 Skill（斜杠命令），可以通过自然语言直接触发，无需手动调用 Workflow。

### 文件位置

```
~/.claude/skills/auto-review-loop/SKILL.md
```

### 触发方式

在 Claude Code 中输入以下任意说法即可触发：

| 说法示例 | 触发模式 |
|----------|----------|
| `循环审阅这段代码：...` | 代码片段模式 |
| `自动审阅文件 ./src/app.py` | 单文件模式 |
| `审阅并修改到 8 分：...` | 代码片段模式 |
| `优化这段代码到 9 分` | 代码片段模式 |
| `审阅 src 目录下的所有代码` | 目录模式 |
| `review loop this code` | 代码片段模式 |
| `auto review file.py` | 单文件模式 |

### 使用示例

#### 示例 1：审阅代码片段

```
请循环审阅这段代码，目标分数 8：
```python
def binary_search(arr, target):
    left, right = 0, len(arr) - 1
    while left <= right:
        mid = (left + right) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1
```
```

Claude Code 会自动：
1. 识别为 `auto-review-loop` 技能
2. 提取代码、目标分数
3. 调用 Workflow 执行循环审阅
4. 展示结果

#### 示例 2：审阅单个文件

```
审阅文件 ./aris-monitor/focus.py，目标分数 8，最多 3 轮
```

#### 示例 3：审阅整个目录

```
审阅 ./src 目录下的所有 Python 文件，目标分数 7
```

#### 示例 4：简单说法

```
自动审阅 app.py
```

使用默认参数：目标分数 9，最多 5 轮。

### Skill 工作原理

```
用户输入
    │
    ▼
Claude Code 识别意图
    │
    ▼
匹配 auto-review-loop Skill
    │
    ▼
Skill 指导 Claude Code：
  1. 解析用户输入（代码/文件/目录/参数）
  2. 构建 args 对象
  3. 调用 Workflow({scriptPath, args})
  4. 等待结果
  5. 格式化展示给用户
```

### 与其他方式的对比

| 方式 | 触发 | 优点 | 缺点 |
|------|------|------|------|
| **Skill（推荐）** | 自然语言 | 简单直观，自动解析参数 | 需要安装 Skill 文件 |
| **Workflow 工具** | `Workflow({...})` | 精确控制参数 | 需要写代码 |
| **手动编排** | 直接对话 | 不需要任何文件 | 上下文长了不可靠 |

### 安装 Skill

Skill 文件位于：

```
~/.claude/skills/auto-review-loop/SKILL.md
```

如果文件不存在，重新启动 Claude Code 会话后会自动加载。

如需手动创建：

```bash
mkdir -p ~/.claude/skills/auto-review-loop
# 将 SKILL.md 写入该目录
```

---

## 编码过程中审阅（边写边审）

### 概述

除了写完再审，还支持在编码过程中实时审阅。有三种模式：

| 模式 | 技能 | 触发方式 | 适用场景 |
|------|------|----------|----------|
| **自审阅** | `code-with-review` | 用户说"写代码并审阅" | 写新代码时 |
| **审阅当前改动** | `review-current` | 用户说"审阅当前改动" | 修改代码后 |
| **Hook 自动触发** | PostToolUse hook | Write/Edit 自动触发 | 全程自动（可选） |

### 模式一：Claude 自审阅（code-with-review）

Claude 在完成代码编写后，自动调用 code-reviewer 审阅并修复问题。

**触发说法：**
- "写代码并审阅"
- "边写边审"
- "写完帮我检查"
- "code with review"

**执行流程：**
```
用户：写一个排序函数，并审阅
    │
    ▼
Claude：编写排序函数
    │
    ▼
Claude：调用 code-reviewer 审阅
    │
    ▼
审阅结果：7.2/10，3 个问题
    │
    ▼
Claude：自动修复问题
    │
    ▼
再次审阅：8.5/10，无中高严重度问题
    │
    ▼
Claude：✅ 代码编写完成，自审阅通过 (8.5/10)
```

**Skill 文件：**
```
~/.claude/skills/code-with-review/SKILL.md
```

### 模式二：审阅当前改动（review-current）

用户手动触发，审阅当前会话中最近修改的代码文件。

**触发说法：**
- "审阅当前改动"
- "review changes"
- "检查刚才写的代码"
- "帮我看看刚才的修改"

**执行流程：**
```
用户：写一个登录函数
    │
    ▼
Claude：编写登录函数
    │
    ▼
用户：审阅当前改动
    │
    ▼
Claude：
  1. 查找最近修改的文件（login.py）
  2. 调用 code-reviewer 审阅
  3. 展示结果
  4. 询问是否自动修复
    │
    ▼
用户：修复
    │
    ▼
Claude：修复后再次审阅确认
```

**Skill 文件：**
```
~/.claude/skills/review-current/SKILL.md
```

### 模式三：Hook 自动触发（可选）

通过 PostToolUse hook，在每次 Write/Edit 代码文件后自动提醒审阅。

**Hook 脚本：**
```
~/.codex/mcp-servers/code-reviewer/hooks/post-write-review.sh
```

**安装方式：**

在 `~/.claude/settings.json` 的 `hooks.PostToolUse` 中添加：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{
          "type": "command",
          "command": "bash ~/.codex/mcp-servers/code-reviewer/hooks/post-write-review.sh",
          "timeout": 30
        }]
      }
    ]
  }
}
```

**智能特性：**
- 只审阅代码文件（.py/.js/.ts/.java/.go/.rs/.c/.cpp）
- 冷却期 60 秒，避免频繁输出
- 输出提示到 stderr，不干扰正常流程

**⚠️ 当前限制：**
- Hook 只能输出文字提示，**不能调用 MCP 工具**
- 不会触发实际审阅，只是在终端显示一行建议
- 不会询问用户，不影响 Agent 行为
- 实际价值有限，建议使用 `code-with-review` 或 `review-current` 技能代替

### 两种模式对比

| 特性 | code-with-review | review-current |
|------|-----------------|----------------|
| 触发方式 | 用户说"写代码并审阅" | 用户说"审阅当前改动" |
| 审阅时机 | 代码编写完成后 | 用户手动触发 |
| 自动修复 | ✅ 是 | ❌ 需用户确认 |
| API 调用频率 | 每个任务 1-3 次 | 每次手动 1 次 |
| 效率影响 | 低 | 无 |
| 推荐场景 | 写新功能 | 修改现有代码 |

> **关于 Hook：** PostToolUse hook 受限于环境，只能输出文字提示，无法调用 MCP 工具。
> 如需「边写边审」，请使用 `code-with-review` 技能。

### 推荐工作流

```
编写阶段                    修改阶段                    收尾阶段
    │                          │                          │
    ▼                          ▼                          ▼
code-with-review          review-current           auto-review-loop
"写代码并审阅"            "审阅当前改动"           "优化到 9 分"
    │                          │                          │
    ▼                          ▼                          ▼
自动审阅+修复              手动审阅+可选修复         深度循环优化
```

---

## 审阅过程文件存放位置

每次工作流执行都会产生完整的审阅记录，存放在以下位置：

### 文件结构总览

```
~/.claude/projects/<project-id>/<session-id>/
├── subagents/
│   └── workflows/
│       └── wf_<run-id>/                    # 一次工作流执行
│           ├── journal.jsonl               # 执行日志
│           ├── agent-<id1>.jsonl           # 第1轮审阅 Agent 对话
│           ├── agent-<id1>.meta.json       # Agent 元数据
│           ├── agent-<id2>.jsonl           # 第1轮修改 Agent 对话
│           ├── agent-<id2>.meta.json
│           ├── agent-<id3>.jsonl           # 第2轮审阅 Agent 对话
│           └── ...                         # 更多轮次
└── ...
```

### 各文件说明

| 文件 | 格式 | 内容 |
|------|------|------|
| `journal.jsonl` | JSONL | 工作流执行日志，记录每个 Agent 的启动、完成和结果摘要 |
| `agent-*.jsonl` | JSONL | Agent 的完整对话记录，包括 prompt、工具调用、返回结果 |
| `agent-*.meta.json` | JSON | Agent 元数据（token 使用、耗时等） |

### 最终输出文件

```
~/tmp/claude-<pid>/<project-path>/<session-id>/tasks/
└── <task-id>.output                        # 工作流最终结果（JSON）
```

输出文件包含完整的审阅历史：

```json
{
  "mode": "single-file",
  "file": "/path/to/reviewed/file.py",
  "rounds": 3,
  "finalScore": 7.6,
  "targetScore": 8,
  "reached": false,
  "code": "...最终代码...",
  "reviews": [
    {
      "round": 1,
      "score": 5.0,
      "issues": [
        {
          "severity": "high",
          "category": "performance",
          "description": "...",
          "suggestion": "..."
        }
      ],
      "summary": "..."
    },
    {
      "round": 2,
      "score": 7.2,
      "issues": [...],
      "summary": "..."
    },
    {
      "round": 3,
      "score": 7.6,
      "issues": [...],
      "summary": "..."
    }
  ]
}
```

### 查看审阅记录

#### 查看最新工作流输出

```bash
# 列出所有工作流输出
ls -lt ~/tmp/claude-*/tasks/*.output

# 查看最新输出
cat $(ls -t ~/tmp/claude-*/tasks/*.output | head -1) | python3 -m json.tool
```

#### 查看 Agent 对话记录

```bash
# 列出某个工作流的所有 Agent 记录
ls ~/.claude/projects/.../subagents/workflows/wf_*/agent-*.jsonl

# 查看某个 Agent 的对话
cat ~/.claude/projects/.../subagents/workflows/wf_xxx/agent-yyy.jsonl | python3 -c "
import json, sys
for line in sys.stdin:
    d = json.loads(line)
    if d.get('type') == 'user':
        print('USER:', d['message']['content'][:200])
    elif d.get('type') == 'assistant':
        for c in d['message'].get('content', []):
            if c.get('type') == 'text':
                print('AI:', c['text'][:200])
"
```

#### 查看工作流执行日志

```bash
# 查看 journal
cat ~/.claude/projects/.../subagents/workflows/wf_xxx/journal.jsonl
```

#### 在 Claude Code 中查看

```
/workflows          # 打开工作流面板，查看实时进度和历史
```

### MCP 服务器审阅历史

code-reviewer 服务器内部也维护了一份审阅历史（内存中）：

```python
_reviews: dict[str, list[dict]] = {
    "review_id_1": [{
        "timestamp": "2026-06-23T22:00:00",
        "code": "...",
        "language": "python",
        "file_path": "...",
        "model": "mimo-v2.5-pro",
        "result": { "overall_score": 7.5, "issues": [...], "summary": "..." }
    }],
    "review_id_2": [...]
}
```

> **注意：** MCP 服务器的审阅历史存储在内存中，服务器重启后会丢失。
> 如需持久化，请使用工作流输出文件或 Agent 对话记录。

---

## 实际运行案例

### 案例 1：fibonacci 函数审阅（代码片段模式）

**输入：**
```javascript
Workflow({
  scriptPath: '~/.claude/workflows/auto-review-loop.js',
  args: {
    code: 'def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)',
    targetScore: 9,
    maxRounds: 5,
  }
})
```

**结果：**

| 轮次 | 分数 | 主要改动 |
|------|------|----------|
| 1 | 4.4 | 原始递归代码 |
| 2 | 8.0 | +迭代实现 +输入验证 +docstring +lru_cache |
| 3 | 8.6 | +generator +unittest +上限限制 |

**最终评价：** 「代码质量高，功能正确，仅在文档解释上有轻微改进空间。」

### 案例 2：focus.py 文件审阅（单文件模式）

**输入：**
```javascript
Workflow({
  scriptPath: '~/.claude/workflows/auto-review-loop.js',
  args: {
    filePath: 'aris-monitor/focus.py',
    targetScore: 8,
    maxRounds: 3,
  }
})
```

**结果：**

| 轮次 | 分数 | 主要改动 |
|------|------|----------|
| 1 | 5.0 | 原始代码（95 行） |
| 2 | 7.2 | +SHA-256 完整性校验 +logging +细化异常处理（195 行） |
| 3 | 7.6 | +完整单元测试（295 行） |

**最终评价：** 「安全加固和测试完善后可用于生产环境。」

### 案例 3：binary_search 审阅（代码片段模式）

**输入：**
```javascript
Workflow({
  scriptPath: '~/.claude/workflows/auto-review-loop.js',
  args: {
    code: 'def binary_search(arr, target):\n    left, right = 0, len(arr) - 1\n    while left <= right:\n        mid = (left + right) // 2\n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    return -1',
    language: 'python',
    targetScore: 8,
    maxRounds: 5,
  }
})
```

**结果：**

| 轮次 | 分数 | 主要改动 |
|------|------|----------|
| 1 | 3.8 | 原始代码 |
| 2 | 8.0 | +输入验证 +docstring +类型提示 +单元测试 |

---

## 项目文件清单

### 核心文件

| 文件 | 路径 | 说明 |
|------|------|------|
| **MCP 服务器** | `~/.codex/mcp-servers/code-reviewer/server.py` | code-reviewer MCP 服务器主程序，封装 AI 模型 API 提供标准化审阅接口 |
| **配置文件** | `~/.codex/mcp-servers/code-reviewer/.env` | API 密钥、端点地址、模型名称等配置 |
| **工作流脚本** | `~/.claude/workflows/auto-review-loop.js` | 自动循环审阅的 Workflow 执行脚本（v2），支持代码片段/单文件/多文件/目录模式 |
| **文档** | `~/.codex/mcp-servers/code-reviewer/README.md` | 本文档，包含完整使用说明和架构设计 |

### Skill 文件（斜杠命令）

| 文件 | 路径 | 说明 |
|------|------|------|
| **循环审阅** | `~/.claude/skills/auto-review-loop/SKILL.md` | 自然语言触发循环审阅，支持"循环审阅"、"自动审阅"、"优化到X分"等说法 |
| **自审阅** | `~/.claude/skills/code-with-review/SKILL.md` | 编写代码时自动审阅，支持"写代码并审阅"、"边写边审"等说法 |
| **审阅当前改动** | `~/.claude/skills/review-current/SKILL.md` | 手动触发审阅最近修改的文件，支持"审阅当前改动"、"review changes"等说法 |

### Hook 脚本

| 文件 | 路径 | 说明 |
|------|------|------|
| **Write/Edit 提醒** | `~/.codex/mcp-servers/code-reviewer/hooks/post-write-review.sh` | PostToolUse hook 脚本，Write/Edit 代码文件后输出审阅提醒（仅文字提示，不触发实际审阅） |

### 文件依赖关系

```
~/.claude/settings.json
├── permissions.allow: mcp__code-reviewer__review_code  ← MCP 权限
└── hooks.PostToolUse: post-write-review.sh             ← Hook（可选）

~/.claude/skills/
├── auto-review-loop/SKILL.md    ← 调用 Workflow
├── code-with-review/SKILL.md    ← 调用 MCP 工具
└── review-current/SKILL.md      ← 调用 MCP 工具

~/.claude/workflows/
└── auto-review-loop.js          ← 被 Skill 调用
    └── agent → mcp__code-reviewer__review_code
                    │
                    ▼
~/.codex/mcp-servers/code-reviewer/
├── server.py                    ← MCP 服务器
└── .env                         ← API 配置
```

### 配置文件位置汇总

| 配置项 | 文件 | 说明 |
|--------|------|------|
| API 密钥 | `~/.codex/mcp-servers/code-reviewer/.env` | CODE_REVIEW_API_KEY |
| API 端点 | `~/.codex/mcp-servers/code-reviewer/.env` | CODE_REVIEW_BASE_URL |
| 模型名称 | `~/.codex/mcp-servers/code-reviewer/.env` | CODE_REVIEW_MODEL |
| MCP 注册 | `~/.claude.json` | mcpServers.code-reviewer |
| MCP 权限 | `~/.claude/settings.json` | permissions.allow |
| Hook 配置 | `~/.claude/settings.json` | hooks.PostToolUse（可选） |
| Skill 注册 | `~/.claude/skills/*/SKILL.md` | 自动加载 |
| Workflow 注册 | `~/.claude/workflows/*.js` | 自动加载 |

---

## 更新日志

### v3 (2026-06-23)

- **新增斜杠命令（Skill）：** 注册 `auto-review-loop` 为 Claude Code Skill，支持自然语言触发
- **新增自审阅技能：** `code-with-review`，编写代码时自动审阅并修复
- **新增审阅当前改动技能：** `review-current`，手动触发审阅最近修改的文件
- **新增 Hook 脚本：** `post-write-review.sh`，Write/Edit 后自动提醒审阅
- **移除硬编码默认代码：** 无参数时不再使用 fibonacci 默认代码，改为报错提示
- **新增 Skill 文档：** 详细的触发方式、使用示例、工作原理说明
- **新增边写边审文档：** 三种模式对比、推荐工作流

### v2 (2026-06-23)

- **修复 args 传递问题：** args 在 Workflow 引擎中被序列化为字符串，脚本添加 `JSON.parse` 处理
- **新增文件审阅模式：** 支持 `filePath`、`filePaths`、`dirPath` 参数
- **新增多文件审阅：** 逐个审阅并输出汇总报告
- **新增目录扫描：** 自动发现目录下的代码文件
- **改进 JSON 解析：** 更健壮的审阅结果解析，支持 markdown 代码块清理
- **改进循环逻辑：** 无中高严重度问题但分数未达标时继续优化
- **新增进度日志：** 显示每轮发现的问题数量和评价摘要

### v1 (2026-06-23)

- 初始版本
- 支持代码片段审阅
- 基本循环审阅机制
