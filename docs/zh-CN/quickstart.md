# 快速上手

建议优先使用 worktree 策略运行，以隔离执行环境并降低风险。

## 最小可用示例（PowerShell）

```powershell
npm run dev -- -r "C:\path\to\your-repo" -f "src\\index.js" --instruction "Add a comment as the first line inside createSafeEnvProxy" --verify "node -e \"process.exit(0)\"" -cs worktree --verbose
```

## 提示

- 需要配置 `SALMONLOOP_API_KEY`（或兼容的旧别名 `S8P_API_KEY`）才能进行真实 LLM 生成。
- 也可以在仓库内创建本地配置：`<repoRoot>/.salmonloop/config/config.json`（建议 gitignore）。
- 更完整的配置字段（例如 `client.package`）请以英文文档 `docs/user/config.md` 为准。
- `--dry-run` 可用于验证流程但不回写主仓库。
