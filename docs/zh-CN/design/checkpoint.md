# 检查点策略与生命周期 (Checkpoint Strategy & Lifecycle)

## 概述 (Overview)

SalmonLoop 采用稳健的 **检查点策略 (Checkpoint Strategy)**，在严格遵守 **"Source is Truth"（用户工作区即真理）** 原则的前提下，实现 AI 生成补丁的安全、隔离执行。

这意味着：
1.  **隔离性 (Isolation)**：AI 的修改在一次性的 "影子工作树 (Shadow Worktree)" 中运行，在验证通过前绝不会污染用户的主工作区。
2.  **保真度 (Fidelity)**：影子环境是用户当前状态的 *精确* 副本，包括 **暂存区更改 (staged changes)**、**未暂存更改 (unstaged changes)** 和 **未追踪文件 (untracked files)**。
3.  **稳定性 (Stability)**：我们通过直接从 Git 对象数据库读取数据，绕过了文件系统的竞态条件（特别是在 Windows 上）。

## 核心概念 (Core Concepts)

### 1. 快照 (Snapshot)
**快照** 是一个临时的、悬空的 (dangling) Git 提交，它捕获了用户工作区在特定时间点的精确状态。
- 它捕获 **Index/暂存区** (已暂存的更改)。
- 它捕获 **Worktree/工作树** (未暂存的更改)。
- 它捕获 **未追踪文件** (通过将它们临时添加到单独的索引中)。

### 2. 影子工作树 (Shadow Worktree)
**影子工作树** 是从快照创建的临时工作目录。它充当 AI Agent 的沙盒。

## 生命周期 (Lifecycle)

### 1. 捕获 (Capture / Snapshot Creation)
当任务开始时：
1.  **Stash 保护**：(可选) 现有的 stashes 会被保留。
2.  **索引捕获**：当前的索引被写入一个 tree 对象。
3.  **工作树捕获**：未暂存的更改实际上被 "提交" 进快照（但不修改用户的实际历史记录）。
4.  **未追踪捕获**：未追踪的文件被添加到快照提交中。
5.  **结果**：返回一个 `commitHash`，代表完整的总状态。

### 2. 隔离 (Isolation / Shadow Restoration)
`CheckpointManager` 将快照恢复到一个新的工作树中：
1.  `git worktree add <path> <snapshotHash>`
2.  **文件系统同步**：运行 `git update-index -q --refresh` 以确保新工作树的索引立即与其磁盘状态匹配。这防止了 "虚假脏状态 (false dirty)"。

### 3. 执行 (Execution / Direct Object Reading)
在 AI 的执行循环中，读取文件依赖于 **Git 对象数据库** 而不是文件系统：
- **问题**：在 Windows 上，文件系统缓存在 checkout 后立即读取可能会返回陈旧数据。
- **解决方案**：`CheckpointManager.readSnapshotFile()` 直接从快照的 blob 读取内容 (`git show <hash>:<file>`)。
- **优势**：零延迟，100% 数据一致性，免疫操作系统缓存问题。

### 4. 应用回写 (Apply Back / Merge & Update)
当任务完成并验证通过后：
1.  **Diff 生成**：在影子工作树的最终状态和 *原始* 快照之间生成补丁 (patch)。
2.  **应用**：补丁被应用到主工作区。
    - 如果用户在此期间修改了文件，将适用标准的 Git 合并冲突解决机制。
    - 尽可能保留暂存/未暂存的区别。

## 安全机制 (Safety Mechanisms)

1.  **主工作区只读**：直到最终的应用回写阶段，主工作区从未被触碰。
2.  **清理**：影子工作树会在执行后自动清理以节省磁盘空间。
    - **注意**：快照（Git 提交）会保留在 `.git/refs/s8p/snapshots/` 中，以供手动检查或恢复。使用 `s8p snap clear` 删除它们。
3.  **超时保护**：所有 Git 操作都有严格的超时限制。
4.  **被忽略的文件**：系统遵守 `.gitignore`，但如果用户明确请求，允许显式包含被忽略的文件。
