#!/usr/bin/env python3
"""
跨模型代码审阅 MCP 服务器

支持多模型代码审阅，提供结构化审阅结果：
- 代码质量评分
- 具体问题列表
- 改进建议
- 安全性检查
- 性能分析
"""

import json
import sys
import os
import uuid
import urllib.request
import re
from typing import Any
from datetime import datetime
from pathlib import Path

def _load_dotenv():
    """从 .env 文件加载环境变量"""
    env_file = Path(__file__).parent / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        # 去除引号
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        os.environ.setdefault(key, value)

_load_dotenv()

# 配置
SERVER_NAME = "code-reviewer"
DEFAULT_MODEL = os.environ.get("CODE_REVIEW_MODEL", "mimo-v2.5-pro")
DEFAULT_TIMEOUT = 600

# 审阅历史
_reviews: dict[str, list[dict[str, Any]]] = {}

# MCP 协议：响应格式跟踪
_use_ndjson = False

# 初始化 stdin/stdout 为二进制模式
_stdio_initialized = False

def _init_stdio():
    """初始化标准输入输出为二进制模式"""
    global _stdio_initialized
    if _stdio_initialized:
        return
    sys.stdout = os.fdopen(sys.stdout.fileno(), "wb", buffering=0)
    sys.stdin = os.fdopen(sys.stdin.fileno(), "rb", buffering=0)
    _stdio_initialized = True

# 调试日志（设置环境变量 CODE_REVIEWER_DEBUG=1 启用）
_DEBUG = os.environ.get("CODE_REVIEWER_DEBUG", "") == "1"

def debug_log(msg: str):
    """调试日志"""
    if _DEBUG:
        print(f"[{datetime.now().isoformat()}] {msg}", file=sys.stderr)

def read_request() -> dict[str, Any] | None:
    """读取 MCP 请求"""
    # 读取 Content-Length 行
    debug_log("等待读取请求...")
    line = sys.stdin.readline()
    if not line:
        debug_log("没有更多输入")
        return None

    line_text = line.decode("utf-8").rstrip("\r\n")
    debug_log(f"读取到行: {line_text[:50]}...")
    if line_text.lower().startswith("content-length:"):
        try:
            content_length = int(line_text.split(":", 1)[1].strip())
            debug_log(f"Content-Length: {content_length}")
        except ValueError:
            return None

        # 读取头部直到空行
        while True:
            header_line = sys.stdin.readline()
            if not header_line:
                return None
            if header_line in {b"\r\n", b"\n"}:
                break

        # 读取请求体
        body = sys.stdin.read(content_length)
        debug_log(f"读取到请求体长度: {len(body)}")
        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError as e:
            debug_log(f"JSON 解析失败: {e}")
            return None

    # 处理 JSON 行格式
    if line_text.startswith("{") or line_text.startswith("["):
        global _use_ndjson
        _use_ndjson = True
        try:
            return json.loads(line_text)
        except json.JSONDecodeError:
            return None

    return None

def send_response(response: dict[str, Any]):
    """发送 MCP 响应"""
    payload = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if _use_ndjson:
        sys.stdout.write(payload + b"\n")
    else:
        header = f"Content-Length: {len(payload)}\r\n\r\n".encode("utf-8")
        sys.stdout.write(header + payload)
    sys.stdout.flush()

def generate_review_id() -> str:
    """生成审阅 ID"""
    return uuid.uuid4().hex[:12]

def call_ai_model(prompt: str, model: str = DEFAULT_MODEL) -> str:
    """调用 AI 模型"""
    api_key = os.environ.get("CODE_REVIEW_API_KEY", "")
    base_url = os.environ.get("CODE_REVIEW_BASE_URL", "https://api.openai.com/v1")

    request_payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": """你是一个专业的代码审阅专家。请从以下维度审阅代码：

1. **代码质量** (1-10分)
   - 可读性
   - 可维护性
   - 代码风格

2. **功能正确性** (1-10分)
   - 逻辑正确性
   - 边界条件处理
   - 错误处理

3. **性能** (1-10分)
   - 时间复杂度
   - 空间复杂度
   - 资源使用

4. **安全性** (1-10分)
   - 输入验证
   - 权限控制
   - 漏洞风险

5. **测试** (1-10分)
   - 测试覆盖
   - 测试质量
   - 边界测试

请以 JSON 格式返回结果：
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
            "severity": "high/medium/low",
            "category": "quality/correctness/performance/security/testing",
            "line": 42,
            "description": "问题描述",
            "suggestion": "改进建议"
        }
    ],
    "strengths": ["优点1", "优点2"],
    "summary": "总体评价"
}"""
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.2,
        "max_tokens": 4096
    }

    url = f"{base_url}/chat/completions"
    request = urllib.request.Request(
        url,
        data=json.dumps(request_payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        },
        method="POST"
    )

    with urllib.request.urlopen(request, timeout=DEFAULT_TIMEOUT) as response:
        result = json.loads(response.read().decode("utf-8"))

    return result["choices"][0]["message"]["content"]

def build_review_prompt(
    code: str,
    language: str,
    context: str,
    focus_areas: list[str],
    file_path: str
) -> str:
    """构建审阅提示"""
    prompt = f"""请审阅以下 {language} 代码：

文件路径: {file_path}

```{language}
{code}
```

上下文信息:
{context if context else "无"}

审阅重点:
{', '.join(focus_areas) if focus_areas else "全面审阅"}

请提供详细的代码审阅意见，包括：
1. 各维度评分 (1-10分)
2. 具体问题列表（包含行号）
3. 代码优点
4. 改进建议
5. 总体评价

请以 JSON 格式返回结果。"""

    return prompt

def parse_review_response(response_text: str) -> dict[str, Any]:
    """解析审阅响应"""
    try:
        # 尝试直接解析 JSON
        return json.loads(response_text)
    except json.JSONDecodeError:
        # 尝试从文本中提取 JSON
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass

        # 返回默认结构
        return {
            "scores": {
                "quality": 5,
                "correctness": 5,
                "performance": 5,
                "security": 5,
                "testing": 5
            },
            "overall_score": 5.0,
            "issues": [],
            "strengths": [],
            "summary": response_text
        }

def handle_code_review(
    code: str,
    language: str = "python",
    context: str = "",
    focus_areas: list[str] = None,
    file_path: str = "unknown",
    model: str = DEFAULT_MODEL
) -> dict[str, Any]:
    """处理代码审阅请求"""
    # 构建提示
    prompt = build_review_prompt(
        code=code,
        language=language,
        context=context,
        focus_areas=focus_areas or [],
        file_path=file_path
    )

    # 调用 AI 模型
    response_text = call_ai_model(prompt, model)

    # 解析响应
    review_result = parse_review_response(response_text)

    # 生成审阅 ID
    review_id = generate_review_id()

    # 保存审阅历史
    _reviews[review_id] = [{
        "timestamp": datetime.now().isoformat(),
        "code": code,
        "language": language,
        "file_path": file_path,
        "model": model,
        "result": review_result
    }]

    return {
        "reviewId": review_id,
        "model": model,
        "language": language,
        "file_path": file_path,
        "result": review_result
    }

def handle_code_review_reply(
    review_id: str,
    code: str,
    question: str,
    model: str = DEFAULT_MODEL
) -> dict[str, Any]:
    """处理代码审阅后续问题"""
    # 加载历史
    history = _reviews.get(review_id, [])

    # 构建上下文
    context = ""
    if history:
        last_review = history[-1]
        context = f"""之前的审阅结果：
评分: {last_review['result'].get('overall_score', 'N/A')}
问题: {json.dumps(last_review['result'].get('issues', []), ensure_ascii=False)}
评价: {last_review['result'].get('summary', 'N/A')}
"""

    # 构建提示
    prompt = f"""{context}

当前代码：
```{history[-1]['language'] if history else 'python'}
{code}
```

用户问题：{question}

请回答用户的问题，并提供具体的建议。"""

    # 调用 AI 模型
    response_text = call_ai_model(prompt, model)

    return {
        "reviewId": review_id,
        "model": model,
        "response": response_text
    }

def handle_request(request: dict[str, Any]) -> dict[str, Any] | None:
    """处理 MCP 请求"""
    method = request.get("method", "")
    request_id = request.get("id")

    debug_log(f"处理请求: {method}")

    # 处理通知（没有 id）
    if request_id is None:
        if method in {"notifications/initialized", "initialized"}:
            debug_log("收到 initialized 通知")
            return None
        debug_log(f"收到未知通知: {method}")
        return None

    # 初始化
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {
                    "name": SERVER_NAME,
                    "version": "1.0.0"
                }
            }
        }

    # Ping
    if method == "ping":
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}

    # 工具列表
    if method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "tools": [
                    {
                        "name": "review_code",
                        "description": "审阅代码并返回详细意见",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "code": {
                                    "type": "string",
                                    "description": "要审阅的代码"
                                },
                                "language": {
                                    "type": "string",
                                    "description": "编程语言",
                                    "default": "python"
                                },
                                "context": {
                                    "type": "string",
                                    "description": "代码上下文信息"
                                },
                                "focus_areas": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "审阅重点"
                                },
                                "file_path": {
                                    "type": "string",
                                    "description": "文件路径"
                                },
                                "model": {
                                    "type": "string",
                                    "description": "模型名称"
                                }
                            },
                            "required": ["code"]
                        }
                    },
                    {
                        "name": "review_code_reply",
                        "description": "对代码审阅结果提出后续问题",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "review_id": {
                                    "type": "string",
                                    "description": "之前的审阅 ID"
                                },
                                "code": {
                                    "type": "string",
                                    "description": "当前代码"
                                },
                                "question": {
                                    "type": "string",
                                    "description": "后续问题"
                                },
                                "model": {
                                    "type": "string",
                                    "description": "模型名称"
                                }
                            },
                            "required": ["review_id", "code", "question"]
                        }
                    }
                ]
            }
        }

    # 工具调用
    if method == "tools/call":
        name = request["params"]["name"]
        args = request["params"]["arguments"]

        debug_log(f"调用工具: {name}")

        if name == "review_code":
            result = handle_code_review(
                code=args["code"],
                language=args.get("language", "python"),
                context=args.get("context", ""),
                focus_areas=args.get("focus_areas", []),
                file_path=args.get("file_path", "unknown"),
                model=args.get("model", DEFAULT_MODEL)
            )
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
            }

        if name == "review_code_reply":
            result = handle_code_review_reply(
                review_id=args["review_id"],
                code=args["code"],
                question=args["question"],
                model=args.get("model", DEFAULT_MODEL)
            )
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
            }

        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": f"Unknown tool: {name}"}
        }

    # 未知方法
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": -32601, "message": f"Unknown method: {method}"}
    }

def main():
    """主循环"""
    _init_stdio()
    debug_log(f"启动代码审阅 MCP 服务器: {SERVER_NAME}")

    while True:
        request = None
        try:
            request = read_request()
            if not request:
                break

            debug_log(f"收到请求: {request.get('method')}")

            response = handle_request(request)

            if response:
                send_response(response)
                debug_log("响应已发送")

        except Exception as e:
            debug_log(f"错误: {e}")
            error_response = {
                "jsonrpc": "2.0",
                "id": request.get("id") if request else None,
                "error": {"code": -32603, "message": str(e)}
            }
            send_response(error_response)

if __name__ == "__main__":
    main()
