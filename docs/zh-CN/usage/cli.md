# CLI 参考

SalmonLoop 提供了一个命令行界面，用于自动化代码补丁。

## 命令

`run` 命令是默认命令，也是目前唯一的命令。

```bash
salmon-loop [options]
```

## 选项

- `-i, --instruction <string>`: **(必填)** 代码修改指令。
- `-v, --verify <command>`: **(必填)** 用于验证的命令（例如 `npm test`, `pytest`）。
- `-r, --repo <path>`: 目标仓库路径。默认为当前目录。
- `-f, --file <path>`: 提供作为主要上下文的特定文件路径（相对于仓库或绝对路径）。
- `-s, --selection <text>`: 直接提供作为上下文的文本选择。
- `--dry-run`: 生成补丁并运行验证，但不应用到磁盘。
- `--verbose`: 打印详细的步骤日志，包括 LLM 计划和验证输出。
- `--force-reset`: 失败时强制执行硬重置 (`git reset --hard`)。**请谨慎使用**，因为它会丢弃所有未提交的更改。不能与 `--allow-dirty` 同时使用。
- `--allow-dirty`: 即使工作区有未提交的更改，也允许运行 SalmonLoop。不能与 `--force-reset` 同时使用。

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
