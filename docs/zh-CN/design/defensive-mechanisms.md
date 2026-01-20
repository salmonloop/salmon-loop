# 防御机制 (Defensive Mechanisms)

SalmonLoop 实现了多种防御机制，以确保系统的鲁棒性、稳定性和代码库的完整性。

## 1. WASM 初始化屏障 (WASM Initialization Barrier)

为了防止在初始化 `web-tree-sitter` WASM 环境时出现竞态条件，SalmonLoop 在 `AstParser` 中使用了基于状态机的初始化屏障。

- **状态**：`Idle` (空闲)、`Initializing` (初始化中)、`Ready` (就绪)、`Error` (错误)。
- **机制**：静态 `initPromise` 确保多个并发的 `init()` 调用返回同一个 Promise，从而防止重复的初始化尝试。
- **错误恢复**：如果初始化失败，状态将变为 `Error`，允许在后续操作中重试。

## 2. 文件锁协议 (File Locking Protocol)

为了防止并发的 SalmonLoop 实例或其他进程在补丁应用-验证循环期间损坏代码库，我们在 `src/core/git.ts` 中实现了文件锁协议。

- **锁文件**：在仓库根目录创建 `.salmon.lock`。
- **原子性**：使用 `fs.open` 的 `wx` 标志（排他性创建）确保只有一个进程能获取锁。
- **超时与重试**：进程将等待最多 30 秒，每 100 毫秒重试一次以获取锁。
- **陈旧锁保护**：超过 5 分钟的锁被自动视为陈旧并移除，以防止因进程崩溃导致的死锁。

## 3. 深度 AST 校验 (Deep AST Verification)

除了简单的语法检查，SalmonLoop 在 `APPLY` 阶段还会执行深度 AST 校验。

- **结构验证**：递归扫描应用补丁后的 AST，查找 `ERROR` 节点，这些节点表示简单的基于行的检查可能无法捕获的语法错误。
- **作用域完整性**：比较原始文件和补丁文件的顶层节点。它确保只有预期的目标节点（例如特定的函数）被修改，而所有其他顶层结构在内容和位置上保持一致。
- **类型保护**：使用 TypeScript 类型守卫确保安全地遍历 tree-sitter 节点。

## 4. 路径规范化 (Path Normalization)

为了确保跨平台兼容性（Windows 与 Linux/macOS），SalmonLoop 强制执行路径规范化。

- **正斜杠**：所有内部路径表示和比较均统一使用正斜杠 (`/`)。
- **安全工具函数**：`src/core/path.ts` 提供了 `safeJoin`、`safeResolve` 和 `normalizePath`，封装了 Node.js 的 `path` 模块调用，确保输出一致。

## 5. TOCTOU 防御

通过以下方式缓解检查时间到使用时间 (Time-of-Check to Time-of-Use, TOCTOU) 漏洞：
- **原子 Git 操作**：依靠 Git 内部的锁定和索引管理来进行文件修改。
- **应用后验证**：在修改后立即重新读取并重新解析文件，以验证磁盘上的实际状态。
