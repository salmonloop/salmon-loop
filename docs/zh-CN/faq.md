# FAQ（导读）

## 为什么日志里会出现 ROLLBACK？

执行流包含 ROLLBACK 阶段用于统一的流程与审计；当 VERIFY 通过时该阶段可能是 no-op。

## 为什么看不到工具调用？

工具调用仅在启用支持 OpenAI tools 的 Provider 且策略允许时才会发生。
如果未配置 API key，系统可能会使用 stub LLM，从而不会发生真实的 tool calling。

