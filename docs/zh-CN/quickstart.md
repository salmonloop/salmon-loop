# 快速上手

建议优先使用 worktree 策略运行，以隔离执行环境并降低风险。

## 最小可用示例（PowerShell）

```powershell
bun run  -- -r "C:\path\to\your-repo" -f "src\\index.js" --instruction "Add a comment as the first line inside createSafeEnvProxy" --verify "bun -e \"process.exit(0)\"" -cs worktree --verbose
```

## 提示

- 需要配置 `SALMONLOOP_API_KEY`（或兼容的旧别名 `S8P_API_KEY`）才能进行真实 LLM 生成。
- 如需自定义提供商地址/模型，可设置 `SALMONLOOP_BASE_URL`（优先）或旧名 `S8P_BASE_URL`，并指定 `SALMONLOOP_MODEL`（优先）以避免默认 `gpt-4o` 被拒绝，框架会自动去除末尾 `/`。
- 也可以在仓库内创建本地配置：`<repoRoot>/.salmonloop/config/config.json`（建议 gitignore）。
- 更完整的配置字段（例如 `client.package`）请以英文文档 `docs/user/config.md` 为准。
- `--dry-run` 可用于验证流程但不回写主仓库。
- 需要实时看到 LLM 流式回复时，可以追加 `--stream-output`（取决于提供商是否支持流式接口）。
