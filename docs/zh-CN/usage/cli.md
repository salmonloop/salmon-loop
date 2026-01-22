# CLI 参考

SalmonLoop 提供了一个命令行界面，用于自动化代码补丁。

## 命令

`run` 命令是默认命令，也是目前唯一的命令。

```bash
salmon-loop [options]
```

## 选项

### 1. 核心选项

- `-i, --instruction <string>`: **(必填)** LLM 应当遵循的修改指令。
- `-v, --verify <command>`: **(必填)** 应用补丁后运行的验证命令。
- `-r, --repo <path>`: git 仓库根目录的路径。
- `-f, --file <path>`: 将特定文件作为主要上下文（支持相对或绝对路径）。
- `-s, --selection <text>`: 直接提供文本片段作为上下文。

### 2. 执行与安全选项

- `-cs, --checkpoint-strategy <direct|worktree>`: (默认: `direct`) 设置检查点策略。`worktree` 模式在隔离的临时目录中运行，更安全且会忽略脏工作区状态。
- `--apply-back-on-dirty <stash|abort>`: (默认: `stash`) 使用 `worktree` 时，回写到主工作区遇到脏状态的处理方式。
- `--worktree-prepare <command>`: 在 worktree 内运行的准备命令（例如 `npm ci`）。
- `--dry-run`: 生成并验证补丁，但不实际修改任何文件（预览模式）。
- `--force-reset`: 失败时强制执行硬重置 (`git reset --hard`)。**请谨慎使用**，因为它会丢弃所有未提交的更改。

### 3. 高级选项

- `--verbose [level]`: 启用不同级别的详细日志输出：
  - `basic`: 输出基本的日志和执行步骤（提供此标志时的默认值）。
  - `extended`: 输出详细日志，包括内部状态和调试信息。
- `--validate`: 在启动循环前运行代码质量检查（lint 和测试）。
- `--target-node <name>`: 允许修改的节点名称（例如函数名）。启用深度 AST 作用域完整性验证。

## 用户体验

### 进度反馈
SalmonLoop 具有可视化的进度条，跟踪各个阶段的执行情况：
- **Preflight**: 安全检查。
- **Context**: 收集代码库上下文。
- **Plan**: 创建修改计划。
- **Patch**: 生成统一 diff。
- **Validate**: 执行安全限制。
- **Apply**: 将更改写入磁盘。
- **Verify**: 运行验证命令。
- **Rollback**: 失败时恢复状态。

### 交互式建议
当循环失败时，SalmonLoop 会根据失败类型提供可操作的建议：
- **编译错误**: 建议检查语法或导入。
- **Lint 错误**: 建议运行本地 linter。
- **测试失败**: 指导检查测试输出。
- **工作区安全**: 提醒提交或暂存更改。

## 环境变量

- `SALMON_API_KEY`: 您的 LLM 提供商 API 密钥。
- `SALMON_BASE_URL`: (可选) 自定义 API 基础 URL。
- `SALMON_MODEL`: (可选) 要使用的 LLM 模型。
