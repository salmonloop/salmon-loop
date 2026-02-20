# Salmon-Loop

[English](README.md) | [简体中文](README.zh-CN.md)

一个用于自动化代码补丁的最小可行执行循环。

## 架构设计：三层分流模型 (Three-Layer Triage)

Salmon-Loop 采用独特的 **三层分流模型**，以最高效、最安全的方式处理不同复杂度的任务：

1.  **确定性工具 (SimpleTool)**：原子化、极速执行的操作（如 Git、文件系统操作），作为纯函数执行。零编排开销。
2.  **微任务 (MicroTask)**：需要微决策或数据补全（如动态上下文组装）的确定性任务。由 **Grizzco DSL** 和 `MicroTaskRunner` 驱动。
3.  **子代理 (SubAgent)**：需要反思循环和自主规划的复杂多步目标。通过完整的 LLM 驱动执行循环管理。

这种分层方法确保了简单任务保持极速和可预测，而复杂任务则能获得所需的认知计算能力。

## 设计理念 (Philosophy)

Salmon-Loop 建立在三个核心原则之上：

1.  **补丁优先 (Patch-First)**：所有更改都通过标准的 unified diff (`git apply`) 应用，并使用鲁棒的三路合并策略进行集成。这确保了更改是精确的、可逆的和可审查的。
2.  **验证优先 (Verify-First)**：如果没有通过用户提供的验证命令（例如 `npm test`），任何更改都不会被视为成功。
3.  **快速失败 (Fail-Fast)**：如果验证失败，系统会立即回滚更改并报告错误。它不会试图在没有明确计划的情况下“猜测”如何修复破坏的状态。

## 非目标 (Non-Goals)

- **不是代理 (Not an Agent)**：Salmon-Loop 是一个执行特定指令的工具，而不是一个无限探索代码库的自主代理。
- **不进行重构 (No Refactors)**：它专为针对性的修复和功能开发而设计，而不是大规模的架构重构。
- **不重写整个文件 (No Whole-File Rewrite)**：它通过补丁修改现有文件；它不会从头开始重写整个文件。

## 使用方法

### 安装

```bash
pnpm install
pnpm build
```

### 配置

复制示例环境文件并添加您的 API 密钥：

```bash
cp .env.example .env
```

编辑 `.env` 并设置您的 `SALMONLOOP_API_KEY`（或兼容的旧别名 `S8P_API_KEY`）。您还可以自定义 `SALMONLOOP_BASE_URL`（优先）或旧名 `S8P_BASE_URL`，以及 `SALMONLOOP_MODEL`（优先）或旧名 `S8P_MODEL`。

### 运行 CLI

默认情况下，Salmon-Loop 会进入交互式的 **chat** 模式。对于单次执行的任务，请使用 **run** 命令：

```bash
# 使用 pnpm (推荐开发使用)
pnpm dev run --instruction "fix bug" --verify "npm test"

# 使用 npx (无需构建)
npx tsx src/cli/index.ts run --instruction "fix bug" --verify "npm test"

# 或者在构建后
node dist/cli/index.js run --instruction "fix bug" --verify "npm test"
```

### 快速示例

修复 bug 并使用 `npm test` 验证：

```bash
salmon-loop run --instruction "Fix the null pointer exception in user.ts" --verify "npm test"
```

### 库使用方式

SalmonLoop 可以嵌入到您自己的工具中：

```typescript
import { runSalmonLoop, AiSdkLLM } from 'salmon-loop';

const llm = new AiSdkLLM({
  clientPackage: '@ai-sdk/openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.SALMONLOOP_API_KEY,
  modelId: process.env.SALMONLOOP_MODEL || 'gpt-4o',
});

const result = await runSalmonLoop({
  instruction: '修复拼写错误',
  verify: 'npm test',
  repoPath: process.cwd(),
  llm,
});
```

## 开发 (Development)

### 运行测试与代码检查

您可以在本地运行与 CI 相同的检查：

```bash
# 运行所有测试
pnpm test

# 运行代码风格检查 (Lint)
pnpm lint

# 运行代码格式化
pnpm format
```

### 本地 CI 模拟

为了在本地模拟 GitHub Actions 环境，我们建议使用 [act](https://github.com/nektos/act)：

```bash
# 在本地运行 CI 工作流
act
```

## 安全与约束

- **脏工作区检查**：默认情况下，如果 git 工作区有未提交的更改，SalmonLoop 将拒绝运行。使用 `worktree` 策略可以在隔离环境中运行。
- **影子合并 (Shadow Merge)**：在隔离的影子环境中使用三路合并策略，安全地集成 AI 更改与用户修改。
- **快速失败**：如果补丁无法应用或在达到最大重试次数后验证仍失败，循环将立即终止。
- **AST 校验**：执行深度 AST 结构和作用域完整性检查，防止语法错误和意外的副作用。
- **文件锁**：使用鲁棒的锁定协议防止并发修改和仓库损坏。
- **执行限制**：执行过程受到文件数量、Diff 大小和上下文预算的严格限制。

## 文档 (Documentation)

更多详细信息请参阅 [docs/README.md](docs/README.md)：

- [设计与限制](docs/zh-CN/design/execution-limits.md)
- [CLI 使用说明](docs/zh-CN/usage/cli.md)
- [示例库](docs/zh-CN/usage/examples.md)

## 许可证

MIT
