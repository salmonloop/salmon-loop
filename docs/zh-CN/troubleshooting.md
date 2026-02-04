# 故障排查（导读）

## 0/0 files processed

含义：APPLY 阶段没有生成可执行的文件操作（通常是 diff 格式不被转换层识别）。

建议：
- 确保 diff 是标准 unified diff。
- 使用最新版以支持缺少 `diff --git` 头的 unified diff。

## Unexpected end of JSON input

含义：PATCH 阶段发生了 JSON 解析错误（通常来自 Provider 响应解析或工具调用协议）。

建议：
- 查看最新的 `.salmonloop/runtime/audit/audit-*.json`，关注 `errorStack` 字段。
- 使用 `--verbose=extended` 获取更多运行时线索。
