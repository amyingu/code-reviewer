/**
 * 混合方式代码循环审阅 Workflow
 *
 * 结合 Workflow 脚本（控制流）+ SKILL.md（审阅标准）
 *
 * 架构：
 * - Workflow 脚本：负责循环逻辑、状态管理、错误处理
 * - SKILL.md：负责审阅标准、评分规则、输出格式
 * - MCP 服务器：负责单次审阅调用
 */

export const meta = {
  name: 'auto-review-loop-hybrid',
  description: '混合方式代码循环审阅：Workflow 控制流 + SKILL.md 审阅标准',
  phases: [
    { title: '审阅', detail: '按照 SKILL.md 标准调用 code-reviewer 审阅代码' },
    { title: '修改', detail: '根据审阅意见自动修改代码' },
    { title: '验证', detail: '汇总结果，判断是否达标' },
  ],
};

// ========== 参数解析 ==========
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {});

const TARGET_SCORE = _args.targetScore ?? 9.0;
const MAX_ROUNDS = _args.maxRounds ?? 5;
const LANGUAGE = _args.language ?? 'python';

// 代码来源
let code = _args.code;
let filePaths = _args.filePaths || [];
let filePath = _args.filePath;
const dirPath = _args.dirPath;
const writeBack = _args.writeBack ?? false;

// ========== 辅助函数 ==========

/**
 * 解析审阅结果 JSON
 */
function parseReviewResult(raw) {
  try {
    // 清理 markdown 代码块
    let cleaned = String(raw).trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();

    // 尝试解析 JSON
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    }

    if (!parsed) return null;

    // 提取字段（支持嵌套）
    return {
      scores: parsed.scores || parsed.result?.scores || {},
      overall_score: parsed.overall_score || parsed.result?.overall_score || 0,
      issues: parsed.issues || parsed.result?.issues || [],
      strengths: parsed.strengths || parsed.result?.strengths || [],
      summary: parsed.summary || parsed.result?.summary || '',
    };
  } catch (e) {
    log(`⚠️  解析失败: ${e.message}`);
    return null;
  }
}

/**
 * 判断是否达标
 */
function isPassing(review, targetScore) {
  if (!review) return false;

  const score = review.overall_score;
  const highIssues = review.issues.filter(i => i.severity === 'high');
  const mediumIssues = review.issues.filter(i => i.severity === 'medium');

  // 达标条件：
  // 1. 总分 >= 目标分数
  // 2. 无 high 严重度问题
  // 3. medium 问题 <= 2 个
  return (
    score >= targetScore &&
    highIssues.length === 0 &&
    mediumIssues.length <= 2
  );
}

/**
 * 格式化问题列表
 */
function formatIssues(issues) {
  return issues
    .map(i => `- [${i.severity}] ${i.category}: ${i.description}\n  建议: ${i.suggestion}`)
    .join('\n');
}

/**
 * 构建审阅提示（参考 SKILL.md 标准）
 */
function buildReviewPrompt(code, language) {
  return `请从以下维度审阅代码：

1. 代码质量 (1-10分)：可读性、可维护性、代码风格
2. 功能正确性 (1-10分)：逻辑正确性、边界条件、错误处理
3. 性能 (1-10分)：时间复杂度、空间复杂度、资源使用
4. 安全性 (1-10分)：输入验证、权限控制、数据保护
5. 测试 (1-10分)：测试覆盖、测试质量、边界测试

代码：
\`\`\`${language}
${code}
\`\`\`

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
}`;
}

/**
 * 构建修复提示
 */
function buildFixPrompt(code, language, review) {
  const issuesText = formatIssues(review.issues);

  return `你是代码修复专家。根据审阅意见修改代码，只返回修改后的完整代码。

当前代码：
\`\`\`${language}
${code}
\`\`\`

审阅结果（总分 ${review.overall_score}/10）：
${issuesText}

${review.summary ? '审阅总结：' + review.summary : ''}

要求：
1. 修复所有 high 严重度问题
2. 尽量修复 medium 严重度问题
3. 保持代码功能不变
4. 不要引入新问题
5. 添加完善的 docstring 和类型提示
6. 只返回代码块，不要解释`;
}

// ========== 代码来源处理 ==========

// 读取单个文件
if (filePath && !code) {
  try {
    const content = await agent(`读取文件 ${filePath} 的完整内容，原样输出，不要修改`, {
      label: '读取文件',
      phase: '审阅',
    });
    if (content) {
      code = String(content);
      log(`📄 读取文件：${filePath}（${code.split('\n').length} 行）`);
    }
  } catch {
    log(`❌ 无法读取文件：${filePath}`);
  }
}

// 扫描目录
if (dirPath && filePaths.length === 0 && !code) {
  try {
    const fileList = await agent(
      `列出目录 ${dirPath} 下所有代码文件（递归），返回文件路径列表，每行一个路径，只包含 .py .js .ts .java .go .rs .c .cpp .h 文件`,
      { label: '扫描目录', phase: '审阅' }
    );
    if (fileList) {
      filePaths = String(fileList).split('\n').filter(f => f.trim().length > 0);
      log(`📁 扫描目录：${dirPath}（发现 ${filePaths.length} 个代码文件）`);
    }
  } catch {
    log(`❌ 无法扫描目录：${dirPath}`);
  }
}

// ========== 多文件审阅模式 ==========
if (filePaths.length > 0 && !code) {
  log(`📋 多文件审阅模式：${filePaths.length} 个文件`);

  const fileResults = [];

  for (const fp of filePaths) {
    log(`\n${'─'.repeat(40)}`);
    log(`📄 审阅文件：${fp}`);

    // 读取文件
    let fileCode;
    try {
      fileCode = await agent(`读取文件 ${fp} 的完整内容，原样输出`, {
        label: `读取-${fp}`,
        phase: '审阅',
      });
    } catch {
      log(`  ❌ 读取失败，跳过`);
      continue;
    }

    if (!fileCode) {
      log(`  ❌ 文件为空，跳过`);
      continue;
    }

    // 构建审阅提示
    const prompt = buildReviewPrompt(String(fileCode), LANGUAGE);

    // 调用审阅
    const reviewResult = await agent(prompt, {
      label: `审阅-${fp}`,
      phase: '审阅',
    });

    // 解析结果
    const review = parseReviewResult(reviewResult);

    if (!review) {
      log(`  ❌ 解析失败，跳过`);
      continue;
    }

    log(`  📊 分数：${review.overall_score}/10，问题：${review.issues.length} 个`);
    fileResults.push({ file: fp, ...review, code: String(fileCode) });
  }

  // 汇总结果
  log(`\n${'='.repeat(50)}`);
  log('📊 多文件审阅汇总');
  log('='.repeat(50));
  fileResults.sort((a, b) => a.overall_score - b.overall_score);
  fileResults.forEach(r => {
    const icon = r.overall_score >= 8 ? '✅' : r.overall_score >= 6 ? '⚠️' : '❌';
    log(`  ${icon} ${r.file}: ${r.overall_score}/10`);
  });

  const avgScore = fileResults.reduce((s, r) => s + r.overall_score, 0) / fileResults.length;
  log(`\n平均分：${avgScore.toFixed(1)}/10`);

  return {
    mode: 'multi-file',
    fileCount: fileResults.length,
    averageScore: avgScore,
    files: fileResults.map(r => ({
      file: r.file,
      score: r.overall_score,
      issues: r.issues,
    })),
  };
}

// ========== 输入验证 ==========
if (!code && !filePath && filePaths.length === 0 && !dirPath) {
  log('❌ 错误：未提供代码或文件路径');
  log('请通过 args 传入以下参数之一：');
  log('  code: "你的代码"');
  log('  filePath: "/path/to/file.py"');
  log('  filePaths: ["/path/to/file1.py", "/path/to/file2.py"]');
  log('  dirPath: "/path/to/project"');
  return { error: 'No input provided', received_args: _args };
}

log(`📝 初始代码（${code.split('\n').length} 行）`);
log(`🎯 目标分数：${TARGET_SCORE}/10`);
log(`🔄 最大轮数：${MAX_ROUNDS}`);

// ========== 循环审阅 ==========
let currentRound = 0;
let bestScore = 0;
let bestCode = code;
let allReviews = [];

while (currentRound < MAX_ROUNDS) {
  currentRound++;
  log(`\n${'='.repeat(50)}`);
  log(`📋 第 ${currentRound}/${MAX_ROUNDS} 轮审阅`);
  log(`${'='.repeat(50)}`);

  // === 阶段 1: 审阅 ===
  phase('审阅');
  log('提交代码给 code-reviewer...');

  // 构建审阅提示（使用 SKILL.md 标准）
  const reviewPrompt = buildReviewPrompt(code, LANGUAGE);

  const reviewResult = await agent(reviewPrompt, {
    label: `审阅-第${currentRound}轮`,
    phase: '审阅',
  });

  if (!reviewResult) {
    log('❌ 审阅失败，跳过本轮');
    continue;
  }

  // 解析审阅结果
  const review = parseReviewResult(reviewResult);

  if (!review) {
    log('❌ 解析失败，跳过本轮');
    continue;
  }

  log(`📊 审阅结果：总分 ${review.overall_score}/10`);
  if (review.issues.length > 0) {
    log(`   发现 ${review.issues.length} 个问题`);
    review.issues.forEach(i => {
      log(`   [${i.severity}] ${i.category}: ${i.description}`);
    });
  }

  allReviews.push({ round: currentRound, ...review });

  if (review.overall_score > bestScore) {
    bestScore = review.overall_score;
    bestCode = code;
    log(`🏆 新最高分：${bestScore}`);
  }

  // 达标判断（使用 SKILL.md 标准）
  if (isPassing(review, TARGET_SCORE)) {
    log(`\n🎉 达标！`);
    log(`   总分 ${review.overall_score} >= 目标 ${TARGET_SCORE}`);
    log(`   high 问题：${review.issues.filter(i => i.severity === 'high').length} 个`);
    log(`   medium 问题：${review.issues.filter(i => i.severity === 'medium').length} 个`);
    break;
  }

  // 显示需要修复的问题
  const criticalIssues = review.issues.filter(i => i.severity === 'high' || i.severity === 'medium');
  if (criticalIssues.length > 0) {
    log(`⚠️  ${criticalIssues.length} 个中高严重度问题需要修复`);
  }

  // === 阶段 2: 修改 ===
  phase('修改');
  log('根据审阅意见自动修改代码...');

  // 构建修复提示
  const fixPrompt = buildFixPrompt(code, LANGUAGE, review);

  const fixResult = await agent(fixPrompt, {
    label: `修改-第${currentRound}轮`,
    phase: '修改',
  });

  if (!fixResult) {
    log('❌ 修改失败，跳过本轮');
    continue;
  }

  // 提取代码
  const codeMatch = String(fixResult).match(/```(?:\w+)?\n([\s\S]*?)```/);
  if (codeMatch) {
    code = codeMatch[1].trim();
  } else {
    code = String(fixResult).trim();
  }
  log(`✅ 代码已更新（${code.split('\n').length} 行）`);
}

// ========== 阶段 3: 验证 ==========
phase('验证');
log('\n' + '='.repeat(50));
log('📊 循环审阅完成');
log('='.repeat(50));
log(`总轮次：${currentRound}`);
log(`最终分数：${bestScore}/10`);
log(`目标分数：${TARGET_SCORE}/10`);
log(`达标状态：${bestScore >= TARGET_SCORE ? '✅ 达标' : '❌ 未达标'}`);
log('\n分数变化：' + allReviews.map(r => `第${r.round}轮=${r.overall_score}`).join(' → '));

// 写回文件
if (writeBack && filePath && bestCode) {
  log(`\n💾 写回文件：${filePath}`);
  await agent(`将以下内容写入文件 ${filePath}，覆盖原有内容：\n\n${bestCode}`, {
    label: '写回文件',
    phase: '验证',
  });
  log(`✅ 已写入`);
}

// 返回结果
return {
  mode: filePath ? 'single-file' : 'snippet',
  file: filePath || null,
  rounds: currentRound,
  finalScore: bestScore,
  targetScore: TARGET_SCORE,
  reached: bestScore >= TARGET_SCORE,
  code: bestCode,
  reviews: allReviews,
};
