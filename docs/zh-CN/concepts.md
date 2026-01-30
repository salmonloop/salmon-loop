# 核心概念（导读）

## direct 与 worktree

- `direct`：在主仓库目录直接执行。
- `worktree`：在系统临时目录创建临时 worktree 执行，适合主仓库 dirty 的情况。

## Snapshot（T0）

worktree 模式会在执行前创建安全快照（回滚锚点），用于失败恢复与 apply-back 的安全策略选择。

## APPLY 与 apply-back

- APPLY：在执行工作区（通常是 worktree）应用 diff。
- apply-back：在 VERIFY 通过后把变更安全地回写到主仓库。

更精确的契约与边界请参考英文文档（SSOT）。

