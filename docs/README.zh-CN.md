# Salmon-Loop

[English](../README.md) | [简体中文](README.zh-CN.md)

一个用于自动化代码补丁的最小可行执行循环。

## 设计理念 (Philosophy)

Salmon-Loop 建立在三个核心原则之上：

1.  **补丁优先 (Patch-First)**：所有更改都通过标准的 unified diff (`git apply`) 应用。这确保了更改是精确的、可逆的和可审查的。
2.  **验证优先 (Verify-First)**：如果没有通过用户提供的验证命令（例如 `npm test`），任何更改都不会被视为成功。
3.  **快速失败 (Fail-Fast)**：如果验证失败，系统会立即回滚更改并报告错误。它不会试图在没有明确计划的情况下“猜测”如何修复破坏的状态。

## 非目标 (Non-Goals)

-   **不是代理 (Not an Agent)**：Salmon-Loop 是一个执行特定指令的工具，而不是一个无限探索代码库的自主代理。
-   **不进行重构 (No Refactors)**：它专为针对性的修复和功能开发而设计，而不是大规模的架构重构。
-   **不重写整个文件 (No Whole-File Rewrite)**：它通过补丁修改现有文件；它不会从头开始重写整个文件。

## 使用方法

### 安装

```bash
pnpm install
pnpm build
```

### 运行 CLI

您可以直接运行 CLI（`run` 命令是默认的）：

```bash
# 使用 npx (无需构建)
npx tsx src/cli.ts --instruction "fix bug" --verify "npm test"

# 或者在构建后
node dist/cli.js --instruction "fix bug" --verify "npm test"
```

### 选项

-   `-i, --instruction <string>`: (必填) 要执行的更改指令。
-   `-v, --verify <command>`: (必填) 用于验证更改的命令（例如 `npm test`）。
-   `-r, --repo <path>`: 仓库路径（默认：当前目录）。
-   `-f, --file <path>`: 提供作为主要上下文的特定文件路径。
-   `-s, --selection <text>`: 用户选择的文本作为上下文。
-   `--dry-run`: 仅生成补丁而不应用它们。
-   `--verbose`: 在执行期间打印详细的步骤日志。

### 示例

**1. 基本用法**

修复 bug 并使用 `npm test` 验证：

```bash
salmon-loop --instruction "Fix the null pointer exception in user.ts" --verify "npm test"
```

**2. 空运行 (Dry Run)**

生成补丁但不应用，用于预览更改：

```bash
salmon-loop --instruction "Add logging to auth service" --verify "npm run build" --dry-run --verbose
```

**3. 指定上下文**

提供特定文件作为上下文以减少干扰：

```bash
salmon-loop --instruction "Update email validation regex" --verify "jest tests/email.test.ts" --file "src/utils/validation.ts"
```

## 架构

核心循环包含以下步骤：

1.  **构建上下文 (Context Building)**：收集文件内容、ripgrep 搜索结果和 git diff。
2.  **规划 (Planning)**：根据指令和上下文生成结构化计划 (JSON)。
3.  **生成补丁 (Patching)**：根据计划生成 unified diff。
4.  **验证 (Validation)**：检查 diff 是否有效且在限制范围内。
5.  **应用 (Application)**：使用 `git apply --3way` 应用补丁。
6.  **验证 (Verification)**：运行用户提供的验证命令。
7.  **智能收敛 (Intelligent Convergence)**：如果验证失败，分析错误输出以识别失败的文件，回滚更改，将上下文收缩到这些文件，并重试（达到限制为止）。

## 项目结构 (Project Structure)

-   `src/core`: 包含执行循环，不得依赖 CLI、UI 或编辑器集成。
-   `src/cli.ts`: 命令行界面入口点。

## 安全限制 (Safety Limits)

为了防止意外损坏，Salmon-Loop 强制执行严格的限制：

-   **最大文件更改数**：每个补丁 2 个文件。
-   **最大 Diff 行数**：每个补丁 200 行。
-   **最大重试次数**：2 次尝试修复验证失败。
-   **上下文大小**：限制 token 窗口以确保 LLM 专注。
-   **Unified Diff**：仅接受有效的 unified diff 格式。
-   **禁止文件操作**：禁止创建、删除或重命名文件，以确保回滚的可靠性。

## 许可证

MIT
