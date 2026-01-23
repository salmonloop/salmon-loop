# CLI 参考

SalmonLoop 提供了一个命令行界面 (`s8p`)，用于自动化代码补丁。

## 命令

### 默认运行
Agent Loop 的主入口点。

```bash
s8p [options]
```

## 全局选项

- `-r, --repo <path>`: git 仓库根目录的路径。默认为当前目录。
- `--verbose [level]`: 启用详细日志输出 (`basic` 或 `extended`)。

## 核心选项 (用于默认运行)

- `-i, --instruction <string>`: **(必填)** LLM 应当遵循的修改指令。
- `-v, --verify <command>`: **(必填)** 应用补丁后运行的验证命令 (例如 `npm test`, `pytest`)。
- `-f, --file <path>`: 将特定文件作为主要上下文（支持相对或绝对路径）。
- `-s, --selection <text>`: 直接提供文本片段作为上下文。

## 快照管理

SalmonLoop (s8p) 包含一个强大的快照系统，可在执行前捕获仓库的精确状态（暂存 + 未暂存的更改）。

**别名**: 您可以使用 `s8p snap` 代替 `s8p snapshot`。

### 创建快照
手动创建当前工作区状态的快照。

```bash
s8p snap create -m "重构前备份"
```

### 列出快照
列出当前仓库的所有可用快照。别名: `ls`。

```bash
s8p snap ls
```

### 查看快照详情
查看快照的详细信息。使用 `--files` 列出快照中包含的所有文件。

```bash
s8p snap show <hash> [--files]
```

### 对比快照
对比快照与当前工作区，或两个快照之间的差异。

```bash
# 显示变更统计
s8p snap diff <hash>

# 显示代码差异
s8p snap diff <hash> --code
```

### 查看文件内容
直接从快照中读取文件内容（"Source is Truth"）。

```bash
s8p snapshot cat <hash> <file_path>
```

### 导出快照
将快照的完整内容导出到一个目录。

```bash
s8p snapshot export <hash> <target_directory>
```

### 恢复快照
手动将工作区恢复到特定的快照状态。别名: `checkout`。

```bash
s8p checkout <hash> [--force]
```

### 删除与清空
管理快照生命周期。别名: `rm`。

```bash
# 删除单个快照
s8p snap rm <hash>

# 清空所有快照（需要确认）
s8p snap clear --force
```

## 执行与安全选项

- `-cs, --checkpoint-strategy <direct|worktree>`: (默认: `worktree`) 设置检查点策略。`worktree` 在隔离环境中运行，安全地**保留**您当前的工作区状态（包括未提交的更改）。
- `--apply-back-on-dirty <3way|abort>`: (默认: `3way`) 回写到脏工作区时的处理策略。
  - `3way`: (推荐) 自动对脏更改进行快照并执行三路合并。
  - `abort`: 如果工作区有未提交更改，则中止操作。
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

- `S8P_API_KEY`: 您的 LLM 提供商 API 密钥 (首选)。
- `S8P_BASE_URL`: (可选) 自定义 API 基础 URL。
- `S8P_MODEL`: (可选) 要使用的 LLM 模型。
- `SALMON_API_KEY`: (传统) 用于向后兼容的备选项。
