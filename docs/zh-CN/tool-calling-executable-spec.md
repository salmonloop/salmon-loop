# 工具调用规范（导读）

> 注意：本文件为中文导读（非 SSOT），仅做导航与说明，可能滞后。
> 权威内容请以英文文档为准。
该页面为导读，最新工具治理/权限模型请以英文为准：
- `docs/design/tool-governance.md`

## 三层分流模型 (Three-Layer Triage)
1. **确定性工具 (SimpleTool)**: 快速、稳定、无编排开销。
2. **微任务 (MicroTask)**: DSL 驱动，使用 `MicroTaskRunner` 实现数据补全。
3. **子代理 (SubAgent)**: LLM 驱动，处理复杂反思循环。

所有组件必须遵循 `IExecutable` 契约。

中文导读入口：`docs/zh-CN/README.md`

