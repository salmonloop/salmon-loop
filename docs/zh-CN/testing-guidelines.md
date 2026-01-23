# 测试指南与安全哲学

本文档概述了 Salmon Loop 项目的测试哲学和安全准则。遵守这些原则对于防止数据丢失和确保软件稳健性至关重要。

## 1. 核心哲学：行为重于实现

在编写测试时，应关注 **可观测的行为**（系统为用户做了什么），而不是 **内部实现细节**（系统内部是如何做到的）。

### 黄金法则
问自己：*“如果我重构了内部代码但输出结果不变，这个测试还能通过吗？”*
*   **是**：好的行为测试。
*   **否**：脆弱的实现测试。

### 对比：回滚逻辑 (Rollback Logic)

#### ❌ 糟糕的测试（关注实现）
断言系统执行了特定的内部动作（重置到 HEAD），忽略了用户的上下文。
```typescript
it('应该回滚文件', async () => {
  // 准备 (Arrange)
  await modifyFile('file.ts', '用户暂存内容', true); // 用户暂存了这个文件
  await modifyFile('file.ts', 'Agent 搞乱的内容');

  // 行动 (Act)
  await rollbackFiles(['file.ts']);

  // 断言 (Assert) - 糟糕
  // 这迫使实现必须销毁用户的暂存内容！
  expect(content).toBe('原始提交内容');
});
```

#### ✅ 优秀的测试（关注行为）
断言系统将用户的资产（暂存内容）恢复到了正确的状态。
```typescript
it('应该安全地回滚', async () => {
  // 准备 (Arrange)
  await modifyFile('file.ts', '用户暂存内容', true); // 用户暂存了这个文件
  await modifyFile('file.ts', 'Agent 搞乱的内容');

  // 行动 (Act)
  await rollbackFiles(['file.ts']);

  // 断言 (Assert) - 优秀
  // 这允许实现使用 `git checkout --` (Index) 而不是 `HEAD`，从而保护了数据。
  expect(content).toBe('用户暂存内容');
});
```

## 2. 安全基线 (至关重要)

用户数据的完整性至高无上。Agent 在用户仓库中必须表现得像一个访客，绝不能是一个破坏者。

### “不作恶”规则
1.  **绝不删除暂存更改 (`git add`)**：回滚机制必须回退到暂存区 (Index)，而不是 HEAD，除非有明确指令。
2.  **绝不删除未追踪文件 (Untracked Files)**：除非是 Agent 自己创建的垃圾文件。
3.  **脏工作区保护**：在应用复杂补丁 (ApplyBack) 之前，系统必须验证工作区状态或创建全量备份。

### 验证
所有关键安全逻辑由以下测试套件验证：
*   `tests/integration/rollback_safety.test.ts`

**规则**：此测试套件必须 **始终通过**。这是防止数据丢失的最后一道防线。

## 3. API 契约

### `rollbackFiles(repoPath, files, forceReset?, ref?)`

*   **默认行为 (不传 ref)**：`git checkout -- <files>`
    *   将文件恢复到 **暂存区 (Index)** 状态。
    *   对用户数据 **安全**。
    *   用于常规 Agent 错误恢复。

*   **强制重置行为 (ref='HEAD')**：`git reset --hard HEAD` (或指定 ref)
    *   将文件恢复到 **提交 (Commit)** 状态。
    *   **会销毁** 暂存区的更改。
    *   仅当用户明确请求“硬重置”或“清空环境”时使用。

## 4. 开发工作流

1.  **修改核心 git 逻辑前**：运行 `npm test tests/integration/rollback_safety.test.ts`。
2.  **当测试失败时**：
    *   不要为了通过测试而盲目修改生产代码。
    *   分析：*“这个测试是否在断言一个危险的实现细节？”*
    *   如果是，请修复测试，而不是代码。
3.  **添加安全注释**：在生产代码中使用 `// CRITICAL SAFETY:` 注释，以警告未来的维护者注意关键逻辑。

## 5. 测试最佳实践与黄金法则

### 测试金字塔 (The Testing Pyramid)
1.  **单元测试 (Unit)**：快速、隔离、测试独立函数。
    *   **Mock 一切外部依赖**：不要使用真实文件系统、网络，不要用 `new Date()` (使用伪造时间)。
    *   **关注点**：逻辑验证。
2.  **集成测试 (Integration)**：验证组件交互。
    *   **真理在源码 (Source is Truth)**：使用真实文件系统 (如 `RealFsTestHelper`) 而不是 Mock `fs`。验证真实的副作用。
    *   **关注点**：正确的连接和副作用。
3.  **端到端测试 (E2E)**：模拟完整的用户工作流。

### 单元测试准则
*   **确定性 (Determinism)**：测试必须每次都产生相同的结果。绝不要在没有 Mock 的情况下依赖系统时间 (`new Date()`) 或随机性 (`Math.random()`)。
*   **零副作用 (Mock Externalities)**：单元测试 **绝不允许** 发起真实网络请求、读写真实文件系统或启动子进程。所有外部依赖必须被 Mock。
*   **保持安静 (No Console Output)**：测试执行期间不应有 `console.log` 输出。这会污染测试报告。如果需要调试，请使用断点或临时日志，并在提交前删除。
*   **隔离性 (Isolation)**：测试不应依赖于前一个测试留下的状态。

### 集成测试准则
*   **真理在源码 (Source is Truth)**：在测试文件操作时，验证磁盘上的真实文件。不要验证 `fs.writeFile` 是否被调用；验证 `fs.readFile` 是否返回预期的内容。
*   **白板环境 (Clean Slate)**：确保每个测试前环境重置 (使用 `afterEach(cleanup)`)。

### FIRST 原则
*   **F**ast (快速)：测试应快速运行以提供即时反馈。
*   **I**ndependent (独立)：测试不应相互依赖。
*   **R**epeatable (可重复)：测试应在任何环境中运行结果相同。
*   **S**elf-validating (自验证)：测试应有布尔输出 (通过/失败)。
*   **T**imely (及时)：测试应与代码同时编写或在代码之前编写。
