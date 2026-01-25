# 执行契约 (Execution Contract)

SalmonLoop 遵循严格的执行契约，以确保安全性和确定性。

## 阶段保证 (Phase Guarantees)

1. **PREFLIGHT**: 只读。检查环境安全性（Git 仓库）。
2. **CONTEXT**: 只读。收集代码库上下文和目标文件内容。
3. **PLAN**: 只读。LLM 分析上下文和指令以生成 JSON 计划。不发生文件系统变更。
4. **PATCH**: 只读。LLM 根据计划生成统一 Diff。不发生文件系统变更。
5. **VALIDATE**: 只读。系统根据安全和大小限制验证 Diff。
6. **APPLY**: 变更。系统使用 **Shadow Merge Engine** (基于 `git merge-file` 的三路合并) 应用变更。该引擎将 Base (T0)、User (Current) 和 AI (Generated) 进行全量内容合并，确保在脏工作区（Dirty Workspace）下的原子性。应用后会进行 **AST 语义验证**（如果支持）以确保语法正确性。
7. **VERIFY**: 只读。系统运行用户提供的验证命令。
8. **ROLLBACK**: 变更。如果验证失败，系统使用 `git checkout` 恢复修改的文件。如果检测到 Git 冲突或异常状态，则执行鲁棒重置（`git stash`、`git reset --hard`、`git clean`）。
9. **SHRINK**: 只读。如果验证失败，系统会进行 **智能反馈 (Smart Feedback)** 分析以提取精确的错误诊断，并减少下一次尝试的上下文。

## 安全规则

### 1. 脏工作区策略 (Zero Index Access)
SalmonLoop 在处理脏工作区（包含未提交更改）时，遵循 **"Zero Index Access" (零索引访问)** 的铁律。

#### 设计哲学
SalmonLoop 在用户代码库中扮演**访客**而非主人的角色。
- **Commitment vs Draft**: 用户执行 `git add` 是明确的“承诺”动作，表示该代码已准备好。工作区 (Worktree) 则是自由的“草稿区”。
- **不作恶 (Do No Harm)**: 自动化工具绝不应破坏用户已承诺的成果。因此，暂存区对于 AI 来说是只读的“背景上下文”，而非可写的“目标”。

#### 状态矩阵 (Git Status Matrix)
系统根据用户当前文件状态（User Current）与 T0 快照（Base）的差异，采取不同的回写策略，最终结果**总是**收敛于 Unstaged 修改。

| 场景 (Scenario) | Base (T0) | User (Current) | AI (Patch) | 动作 (Action) | 最终状态 (git status) | 安全性 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Clean** | `A` | `A` | `B` | 直接写入 `B` | `M` (Unstaged) | ✅ 仅工作区变动 |
| **Staged** | `A` | `B` (已包含Staged) | `C` | Merge `A+B+C` | `M` (Index) + `M` (Worktree) | ✅ Staged 内容不丢 |
| **Unstaged** | `A` | `B` | `C` | Merge `A+B+C` | `M` (Unstaged - 融合版) | ✅ 用户修改不丢 |
| **Double Dirty** | `A` | `C` (含Staged `B`) | `D` | Merge `A+C+D` | `M` (Index) + `M` (Worktree - 融合版) | ✅ **绝对安全** |

#### 核心原则
*   **暂存区 (Staged Area) = 禁区**：用户已暂存的代码被视为神圣不可侵犯。AI 绝不会撤销、修改或覆盖暂存区的内容。
*   **工作区 (Worktree) = 草稿区**：AI 的所有补丁仅作为“未暂存的修改”应用到工作区，等待用户 Review。
*   **原子合并**：使用三路合并算法安全融合。若发生冲突，立即中止并生成 `.rej` 文件，绝不强行覆盖。

### 2. 一般安全规则
- **原子尝试**：每次尝试都是隔离的。如果尝试失败，工作区将在下一次尝试开始前回滚。回滚机制对 Git 冲突状态具有鲁棒性。
- **强制重置与清理**：开启 `forceReset` 时，SalmonLoop 会执行 `git reset --hard HEAD` 和 `git clean -fd`，以确保下一次尝试拥有完全干净的工作区。
- **文件结构变更**：SalmonLoop 支持创建 (Create) 和删除 (Delete) 文件，但这些操作必须通过 Shadow Transaction 事务管理器执行，并受原子快照保护。系统仍严禁在事务之外随意修改文件结构。
- **禁止翻译注释**：严禁 LLM 翻译或修改现有注释（除非明确指示），以保持代码完整性和上下文匹配。

## 错误处理

- **错误分类**：SalmonLoop 将错误分为以下几种类型：
    - `COMPILATION`：语法或类型错误（可重试）。
    - `LINT`：代码风格违规（可重试）。
    - `TEST`：功能测试失败（可重试）。
    - `LOGIC`：验证失败但无特定框架错误（可重试）。
    - `AST_VALIDATION_ERROR`：深度 AST 结构或作用域完整性检查失败（可重试）。
    - `DEPENDENCY_ERROR`：依赖缺失或版本不匹配（不可重试）。
    - `RESOURCE_LOCK_ERROR`：并发访问或文件锁冲突（不可重试）。
    - `UNKNOWN`：未分类错误（不可重试）。

- **重试策略**：只有被分类为“可重试”的错误才会触发新一轮尝试（伴随上下文收缩和反馈优化）。不可重试的错误将导致立即终止，以防止无限循环或资源损坏。

- **快速失败**：任何意外的系统错误都会导致立即回滚并终止。
- **结构化结果**：循环返回一个 `LoopResult` 对象，包含成功状态、失败阶段、错误类型和详细日志。
