# StrataSystem 架构（实现对齐）

StrataSystem 是 SalmonLoop 的“分层执行环境”架构：它把“环境构建（依赖/沙盒）”与“逻辑计算（合并/回写）”分离，确保在 Native（Windows/macOS/Linux）环境下依然能做到可审计、可回滚、默认安全。

注意：当前代码库里 **没有** 一个叫 `StrataSystem` 的单体类。现状是按层拆成了可组合的模块（L1/L2/L3），由上层流程（如 SalmonLoop 的 worktree 策略与 apply-back 流程）编排使用。

## 分层与代码映射

- **L1: ImmutableGitLayer（Git 基础层）**
  - 目标：提供“可重建的、以 Git 为真相来源”的代码底座（worktree/snapshot）。
  - 实现位置：`src/core/strata/layers/immutable-git-layer.ts`（`ImmutableGitLayerImpl`），底层复用 `src/core/checkpoint/manager.ts`。

- **L2: ShadowDriver（依赖环境层）**
  - 目标：在不触碰 `.git` 的前提下，把依赖目录（如 `node_modules/target/build`）以“足够快且足够安全”的方式注入到 shadow/worktree，以便运行验证命令。
  - 实现位置：`src/core/strata/layers/shadow-driver/*`。

- **L3: SyntheticSidecarLayer（忽略/隐私文件层）**
  - 目标：为 ignored/untracked 文件提供“可选的基准（base）”与注入能力，避免 merge 退化为不安全的 2-way 覆盖。
  - 实现位置：`src/core/strata/layers/sidecar-layer.ts`（`SyntheticSidecarLayerImpl`）。

## 关键契约（与 ShadowMergeEngine 的关系）

- **Source is Truth**：Git（L1）是被信任的真相来源；L2 不应对 `.git` 进行任何复制/链接/修改；L3 只在显式声明需要时介入 ignored/untracked 文件。
- **默认不捕获**：Sidecar 的捕获是“显式输入”的行为（例如用户/上层把 `.env` 等文件列入 `contextFiles`）。没有显式输入时，Sidecar 不应做额外 I/O。
- **回滚语义（ignored/untracked）**：
  - 如果本次执行修改了 ignored/untracked 文件，则回滚应包含这些修改；
  - 如果本次没有修改它们，则回滚不应“碰它们”。

## L2 ShadowDriver 的设计要点（与实现对齐）

- **Safe by Default**：默认走 `ISOLATED`（物理隔离/复制），只有在显式白名单与只读任务下才允许更激进的优化。
- **One-shot Fallback**：仅允许一次降级重试，防止环境错误导致无限循环。
- **Linux 只读锁生命周期**：在启用只读锁时，清理阶段必须先恢复写权限，再删除目录，避免 `rm`/清理失败。
- **环境错误判定要“路径限定”**：例如 `ENOENT` 只在明确指向依赖路径时才算环境错误，否则容易掩盖真实业务代码错误。

## 使用方式（推荐）

### 通过 CLI 使用（SalmonLoop 编排）

多数情况下你不需要直接调用 L1/L2/L3。CLI 会按策略创建 worktree、运行验证命令，并在失败时回滚：

- `-cs worktree`：在临时 worktree 中执行（更安全，允许主仓库 dirty）。
- `--worktree-prepare <cmd>`：在 worktree 内执行依赖准备（例如 `npm ci`）。
- `--apply-back-on-dirty stash|abort`：回写到主仓库时遇到 dirty 的处理策略。

### 直接使用 ShadowDriver（仅当你需要在外部编排）

```ts
import os from 'os';
import { ShadowDriver } from '../../src/core/strata/layers/shadow-driver/shadow-driver.js';

const driver = new ShadowDriver({
  repoRoot: '/abs/path/to/repo',
  shadowRoot: '/abs/path/to/shadow',
  platform: os.platform() as any,
  readonly: true,
  dependencyPaths: ['node_modules'],
  whitelist: ['npm test'],
});

await driver.run({ command: 'npm test', mode: 'test_readonly' });
await driver.cleanup();
```

### 直接使用 SidecarLayer（显式捕获 ignored/untracked）

```ts
import { SyntheticSidecarLayerImpl } from '../../src/core/strata/layers/sidecar-layer.js';

const sidecar = new SyntheticSidecarLayerImpl('/abs/path/to/repo');
await sidecar.capture(['.env', 'local.config.json']);
await sidecar.inject('/abs/path/to/shadow');
```
