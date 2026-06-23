export const meta = {
  name: 'auto-review-loop',
  description: '自动循环审阅：审阅→修改→再审阅，直到分数达标。支持代码片段、单文件、多文件、整个目录',
  phases: [
    { title: '审阅', detail: '调用 code-reviewer 审阅代码' },
    { title: '修改', detail: '根据审阅意见自动修改代码' },
    { title: '验证', detail: '汇总结果，判断是否达标' },
  ],
};

// 修复：args 可能是字符串，需要解析
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {});

const TARGET_SCORE = _args.targetScore ?? 9.0;
const MAX_ROUNDS = _args.maxRounds ?? 5;
const LANGUAGE = _args.language ?? 'python';

// ========== 代码来源 ==========
// 优先级：filePaths > filePath > dirPath > code
let code = _args.code;
let filePaths = _args.filePaths || [];
let filePath = _args.filePath;
const dirPath = _args.dirPath;
const writeBack = _args.writeBack ?? false;

// 如果指定了单个文件路径，读取内容
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

// 如果指定了目录，扫描代码文件
if (dirPath && filePaths.length === 0 && !code) {
  try {
    const fileList = await agent(`列出目录 ${dirPath} 下所有代码文件（递归），返回文件路径列表，每行一个路径，只包含 .py .js .ts .java .go .rs .c .cpp .h 文件`, {
      label: '扫描目录',
      phase: '审阅',
    });
    if (fileList) {
      filePaths = String(fileList).split('\n').filter(f => f.trim().length > 0);
      log(`📁 扫描目录：${dirPath}（发现 ${filePaths.length} 个代码文件）`);
    }
  } catch {
    log(`❌ 无法扫描目录：${dirPath}`);
  }
}

// 多文件模式：逐个审阅
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

    // 调用审阅
    const reviewResult = await agent(
      `调用 mcp__code-reviewer__review_code 工具审阅以下代码。工具返回的 JSON 中有 result 字段，内含 overall_score、issues、summary。请将 result 字段的内容原样输出，不要加 markdown 标记：\n\n文件：${fp}\n\n\`\`\`\n${String(fileCode)}\n\`\`\``,
      { label: `审阅-${fp}`, phase: '审阅' }
    );

    // 解析结果
    let score = 0;
    let issues = [];
    let summary = '';
    try {
      let raw = String(reviewResult).replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}'); }
      score = parsed.overall_score || parsed.result?.overall_score || 0;
      issues = parsed.issues || parsed.result?.issues || [];
      summary = parsed.summary || parsed.result?.summary || '';
    } catch {}

    log(`  📊 分数：${score}/10，问题：${issues.length} 个`);
    fileResults.push({ file: fp, score, issues, summary, code: String(fileCode) });
  }

  // 汇总结果
  log(`\n${'='.repeat(50)}`);
  log('📊 多文件审阅汇总');
  log('='.repeat(50));
  fileResults.sort((a, b) => a.score - b.score);
  fileResults.forEach(r => {
    const icon = r.score >= 8 ? '✅' : r.score >= 6 ? '⚠️' : '❌';
    log(`  ${icon} ${r.file}: ${r.score}/10`);
  });

  const avgScore = fileResults.reduce((s, r) => s + r.score, 0) / fileResults.length;
  log(`\n平均分：${avgScore.toFixed(1)}/10`);

  return {
    mode: 'multi-file',
    fileCount: fileResults.length,
    averageScore: avgScore,
    files: fileResults.map(r => ({ file: r.file, score: r.score, issues: r.issues })),
  };
}

// ========== 单文件/代码片段模式 ==========
// 如果没有任何输入，报错退出
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

let currentRound = 0;
let bestScore = 0;
let bestCode = code;
let allReviews = [];

while (currentRound < MAX_ROUNDS) {
  currentRound++;
  log(`\n${'='.repeat(50)}`);
  log(`📋 第 ${currentRound}/${MAX_ROUNDS} 轮审阅`);
  log(`${'='.repeat(50)}`);

  // === 阶段1：审阅 ===
  phase('审阅');
  log('提交代码给 code-reviewer...');

  const reviewResult = await agent(
    `调用 mcp__code-reviewer__review_code 工具审阅以下代码。工具返回的 JSON 中有 result 字段，内含 overall_score、issues、summary。请将 result 字段的内容原样输出，不要加 markdown 标记，不要修改：\n\n\`\`\`${LANGUAGE}\n${code}\n\`\`\``,
    {
      label: `审阅-第${currentRound}轮`,
      phase: '审阅',
    }
  );

  if (!reviewResult) {
    log('❌ 审阅失败，跳过本轮');
    continue;
  }

  // 解析审阅结果
  let score = 0;
  let issues = [];
  let summary = '';

  try {
    let raw = String(reviewResult).trim();
    raw = raw.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    }

    if (parsed) {
      score = parsed.overall_score || parsed.result?.overall_score || 0;
      issues = parsed.issues || parsed.result?.issues || [];
      summary = parsed.summary || parsed.result?.summary || '';
    }
  } catch {
    const match = String(reviewResult).match(/overall_score["\s:]+(\d+\.?\d*)/);
    score = match ? parseFloat(match[1]) : 0;
    log('⚠️  无法解析完整结果，仅提取分数: ' + score);
  }

  log(`📊 审阅结果：总分 ${score}/10`);
  if (issues.length > 0) log(`   发现 ${issues.length} 个问题`);

  allReviews.push({ round: currentRound, score, issues, summary });

  if (score > bestScore) {
    bestScore = score;
    bestCode = code;
    log(`🏆 新最高分：${bestScore}`);
  }

  // 达标判断
  if (score >= TARGET_SCORE) {
    log(`\n🎉 达标！分数 ${score} >= 目标 ${TARGET_SCORE}`);
    break;
  }

  const criticalIssues = issues.filter(i => i.severity === 'high' || i.severity === 'medium');
  const lowIssues = issues.filter(i => i.severity === 'low');

  if (criticalIssues.length === 0 && score >= TARGET_SCORE - 1) {
    log(`\n✅ 分数 ${score} 接近目标，无中高严重度问题，审阅通过`);
    break;
  }

  if (criticalIssues.length > 0) {
    log(`⚠️  ${criticalIssues.length} 个中高严重度问题需要修复：`);
    criticalIssues.forEach(i => log(`   [${i.severity}] ${i.category}: ${i.description}`));
  } else {
    log(`ℹ️  无中高严重度问题，继续优化低严重度问题`);
    lowIssues.forEach(i => log(`   [${i.severity}] ${i.category}: ${i.description}`));
  }

  // === 阶段2：修改 ===
  phase('修改');
  log('根据审阅意见自动修改代码...');

  const allIssues = criticalIssues.length > 0 ? criticalIssues : lowIssues;
  const issuesText = allIssues.map(i =>
    `- [${i.severity}] ${i.category}: ${i.description}\n  建议: ${i.suggestion}`
  ).join('\n');

  const fixPrompt = `你是代码修复专家。根据审阅意见修改代码，只返回修改后的完整代码。

当前代码：
\`\`\`${LANGUAGE}
${code}
\`\`\`

审阅问题（总分 ${score}/10）：
${issuesText}

${summary ? '审阅总结：' + summary : ''}

要求：
1. 修复所有中高严重度问题，尽量改善低严重度问题
2. 保持代码功能不变
3. 不要引入新问题
4. 添加完善的 docstring、类型提示、输入验证、单元测试
5. 只返回代码块，不要解释`;

  const fixResult = await agent(fixPrompt, {
    label: `修改-第${currentRound}轮`,
    phase: '修改',
  });

  if (!fixResult) {
    log('❌ 修改失败，跳过本轮');
    continue;
  }

  const codeMatch = String(fixResult).match(/```(?:python)?\n([\s\S]*?)```/);
  if (codeMatch) {
    code = codeMatch[1].trim();
    log(`✅ 代码已更新（${code.split('\n').length} 行）`);
  } else {
    code = String(fixResult).trim();
    log(`✅ 代码已更新（${code.split('\n').length} 行）`);
  }
}

// === 阶段3：验证 ===
phase('验证');
log('\n' + '='.repeat(50));
log('📊 循环审阅完成');
log('='.repeat(50));
log(`总轮次：${currentRound}`);
log(`最终分数：${bestScore}/10`);
log(`目标分数：${TARGET_SCORE}/10`);
log(`达标状态：${bestScore >= TARGET_SCORE ? '✅ 达标' : '❌ 未达标'}`);
log('\n分数变化：' + allReviews.map(r => `第${r.round}轮=${r.score}`).join(' → '));

// 写回文件
if (writeBack && filePath && bestCode) {
  log(`\n💾 写回文件：${filePath}`);
  // 通过 agent 写文件（workflow 脚本无文件系统权限）
  await agent(`将以下内容写入文件 ${filePath}，覆盖原有内容：\n\n${bestCode}`, {
    label: '写回文件',
    phase: '验证',
  });
  log(`✅ 已写入`);
}

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
