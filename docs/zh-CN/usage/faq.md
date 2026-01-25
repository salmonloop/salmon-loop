# 常见问题与故障排除 (FAQ)

## 常见问题

### 1. 为什么循环在 2 次尝试后失败？
SalmonLoop 有 2 次重试（共 3 次尝试）的安全限制。如果模型在这些尝试内无法收敛到有效的解决方案，它将停止以防止过高的 API 成本和潜在的“幻觉循环”。您可以尝试完善您的指令，或使用 `--file` 选项提供更具体的上下文。

### 2. “回滚失败；工作区可能已脏 (Rollback failed; workspace may be dirty)”是什么意思？
这通常发生在 Git 处于冲突状态时。SalmonLoop 现在已经增强了回滚机制，如果标准的 `git checkout` 失败，它会自动尝试执行更彻底的重置（`git stash`、`git reset --hard` 和 `git clean`）来恢复工作区。如果您仍然看到此错误，请手动检查 `git status`。

### 3. 上下文收缩 (Context Shrinking) 是如何工作的？
当验证命令失败时，SalmonLoop 会解析输出中的文件路径。如果它找到了失败的具体文件（例如在测试追踪中），它将在下一轮中从 LLM 的上下文中移除所有其他代码片段，迫使模型仅关注有问题的文件。

### 4. 我应该什么时候使用 `--force-reset`？
如果您希望 SalmonLoop 在每次失败时执行 `git reset --hard`，请使用 `--force-reset`。这对于确保干净的状态更安全，但会丢弃您在运行工具之前在工作区中拥有的任何未提交的更改。

### 5. 补丁应用失败。为什么？
这通常发生在 LLM 生成的补丁与文件的当前状态不匹配时（例如，行号不对或周围的上下文已更改）。SalmonLoop 使用 3-way 合并来缓解这种情况，但复杂的更改仍可能失败。下一次迭代将包含错误消息，帮助模型修复补丁。

### 6. “补丁不是统一 diff 格式 (Patch is not in unified diff format)”是什么意思？
SalmonLoop 要求 LLM 以标准的 `diff --git` 格式输出补丁。如果模型在 diff 周围包含了对话文本或使用了非标准格式，验证阶段将失败。我们已经优化了解析器，使其对常见的 LLM 格式问题具有鲁棒性，但核心 diff 仍必须遵循统一格式。

### 7. 遇到“依赖版本不匹配 (Dependency version mismatch)”怎么办？
SalmonLoop 对 `web-tree-sitter` 等核心依赖有严格的版本要求。如果您的环境版本不一致，可能会导致 AST 解析失败。请运行 `pnpm install` 确保依赖版本与 `package.json` 锁定版本一致。

### 8. 遇到“文件锁超时 (Timeout acquiring lock)”怎么办？
为了防止并发操作破坏代码库，SalmonLoop 在执行修改时会创建 `.salmon.lock` 文件。如果上一次运行异常中断导致锁未释放，您可以手动删除仓库根目录下的 `.salmon.lock` 文件。

### 9. "File is in MM (Double Dirty) state" 是什么意思？
当一个文件同时包含 **已暂存 (staged)** 和 **未暂存 (unstaged)** 的修改时，会出现此提示。SalmonLoop 会自动检测到这种情况，并将您的未暂存修改“晋升”到暂存区，以防止合并冲突。
*   **旧行为**：工具会报错并生成冲突文件 (`.rej`)。
*   **新行为**：工具会自动对受影响的文件执行 `git add`，以便在应用 AI 补丁之前包含您的最新修改。
*   **需要注意**：您的未暂存修改现在变成了已暂存状态。您可以使用 `git diff --cached` 查看它们。
