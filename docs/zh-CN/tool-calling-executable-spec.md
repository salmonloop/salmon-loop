# SalmonLoop Tool Calling 可执行规范（v1）

## 1. 核心目标
建立**稳定、可控、可回放、可扩展**的工具调用体系；彻底消除“描述调用”与“真实调用”的混淆。

> **一句话总纲**：Tool Calling 是协议，不是对话技巧。任何模糊地带，向“不可执行”收敛。

---

## 2. System Prompt 结构（硬性）
工具定义必须且只能出现在 **System / Runtime Contract** 最前面，作为不可变的“法律文本”。

```text
SYSTEM
├─ Runtime Contract（协议/法律文本）
│  ├─ Tool Definitions（能力+简化 schema）
│  └─ Tool Calling Rules（唯一可执行格式）
├─ Task / User Instruction（动态）
└─ Notes / Examples（明确标注 NOT EXECUTE）
```

---

## 3. Tool 定义（对外 API）
### 3.1 命名规范
*   **唯一合法**：`domain.action[.qualifier]`（如 `code.search`, `fs.read`）
*   **禁止**：实现来源前缀（如 `builtin.`, `mcp.`, `plugin.`）

### 3.2 ToolSpec（强类型）
```typescript
interface ToolSpec<I, O> {
  name: string;
  source: "builtin" | "mcp" | "plugin"; // 仅内部使用，Agent 不可见
  description: string;
  riskLevel: "low" | "medium" | "high";
  sideEffects: SideEffect[]; // ["fs_read", "fs_write", "process", ...]
  allowedPhases: ExecutionPhase[]; // ["CONTEXT", "SHRINK"]
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  executor: (input: I, ctx: ToolRuntimeCtx) => Promise<O>;
}
```

---

## 4. Prompt 展示用 Schema（LLM 友好）
为避免 Prompt 过长，不直接使用 Zod 对象或 `zod-to-json-schema`，而是提取**最小集**：

```typescript
type PromptParam = {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  enum?: string[];
  description?: string;
};
```
*   **Runtime**: 使用 Zod 进行严格校验。
*   **Prompt**: 使用简化 Schema 进行展示。
*   **未来扩展**: 当对接 OpenAI/Anthropic 原生 Function Calling 时，再启用完整 JSON Schema。

---

## 5. 唯一可执行的 Tool Call 协议
仅支持以下格式，**任何字符偏差均不执行**：

```xml
<sl_tool_call v="1">
{"id":"tc_001","toolName":"code.search","args":{"pattern":"BudgetGuard","glob":"src/**/*.ts"}}
</sl_tool_call>
```

### 硬规则
1.  **Tag 严格匹配**：必须是 `<sl_tool_call v="1">`。
2.  **内容限制**：内部必须是**单行**、**标准 JSON**。
3.  **上下文隔离**：出现在 Markdown 代码块（```）内的标签一律视为文本，**不执行**。
4.  **排他性**：发现 Claude DSL（如 `<call:default_api:...>`）或其他格式，直接报错 `UNSUPPORTED_TOOL_PROTOCOL`。

---

## 6. Parser 规范（不容错）
解析器必须极其严格，拒绝猜测：
1.  **正则匹配**：仅匹配顶层 `<sl_tool_call v="1">`。
2.  **JSON 解析**：失败直接抛出 `PARSE_ERROR`。
3.  **名称校验**：`toolName` 不在 Registry 中，抛出 `TOOL_NOT_FOUND`。
4.  **协议卫士**：检测到 `<call:...>` 等非法协议，抛出 `UNSUPPORTED_TOOL_PROTOCOL`。

---

## 7. ToolRouter 单出口（固定执行链）
所有工具调用必须经过以下流水线：
1.  **Registry Resolve**: 查找工具定义。
2.  **Audit Start**: 记录调用意图。
3.  **Input Validation**: Zod Schema 校验参数。
4.  **Policy Gate**: 检查 `ExecutionPhase`、`SideEffects` 和允许名单。
5.  **Budget Gate**: 检查并发数、超时设置、输出大小限制。
6.  **Execute**: 执行逻辑（含 Capability/Backend 多后端回退）。
7.  **Output Validation**: 校验输出结构。
8.  **Sanitize**: 结果脱敏、摘要截断。
9.  **Audit End**: 记录最终状态（含 `backend` 来源）。
10. **Return**: 返回标准 `ToolResult`。

---

## 8. Discovery Loop（状态机）
采用“工具回合制”，不强制显式的 ReAct（Thought-Action-Observation）文本输出。

*   **逻辑**：每回合最多执行 **1** 个工具调用，或零个（直接产出结论）。
*   **上限**：`maxDiscoveryTurns = 8~12`。
*   **早停条件**：
    *   已获得“定位确认声明”。
    *   连续两次出现 `InsufficientCoverage` 或 `AmbiguousResult`。
    *   达到 Budget 阈值。

---

## 9. 错误码标准
所有工具执行错误必须映射到以下结构化代码：
*   `PARSE_ERROR`: 格式错误。
*   `TOOL_NOT_FOUND`: 工具不存在。
*   `INVALID_INPUT`: 参数不符合 Schema。
*   `DENIED_BY_POLICY`: 违反相位或安全策略。
*   `TIMEOUT`: 执行超时。
*   `EXEC_ERROR`: 运行时异常。
*   `UNSUPPORTED_TOOL_PROTOCOL`:使用了非法协议格式。

---

## 10. 日志规范
日志应清晰反映调用源和状态：
*   `Tool execution [code.search] (source=builtin): ok`
*   `Tool execution [code.read_file] (source=builtin): denied (phase=APPLY)`
*   `Tool execution [code.search] (source=builtin): ok (backend=rg→powershell)`

---

## 11. 测试硬要求（Vitest）
*   **环境隔离**：必须使用 `vi.useFakeTimers()`，Mock `process.nextTick`。
*   **禁止副作用**：禁止真实的磁盘读写、网络请求、子进程生成（集成测试除外）。
*   **必测场景**：
    *   描述性文本中的“假调用”不被执行。
    *   代码块内的 Tag 不被执行。
    *   非法协议格式触发 `UNSUPPORTED_TOOL_PROTOCOL`。
    *   Phase Deny（相位拦截）生效。
    *   Backend Fallback（回退机制）生效。
    *   Audit 日志完整记录。
