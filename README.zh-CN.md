# Salmon-Loop

[English](README.md) | [简体中文](README.zh-CN.md)

SalmonLoop 是一个以对话为主入口的 coding agent CLI，适合对安全性、可审计性和干净 diff 有要求的代码仓库。
直接运行 `s8p` 就会进入主体验，后面的执行仍然会严格受验证、回滚和用户数据保护约束。

## 为什么用 SalmonLoop

- **是 Agent，但有边界**：它可以规划、打补丁、验证，也能通过 ACP / A2A 对外提供 Agent 能力，但不会无约束地乱改仓库。
- **对话优先**：`s8p` 直接进入主体验。
- **补丁优先**：底层依然默认产出 diff，而不是神秘的大段重写。
- **验证通过才算成功**：你的验证命令不过，任务就不算完成。
- **适合真实仓库**：`worktree` 策略可以在脏工作区里隔离执行，再谨慎地 apply back。
- **过程可追踪**：会话、审计事件、快照和结构化输出都方便排查问题。

## 整体气质

SalmonLoop 不是那种会一直在代码库里游荡的自动驾驶型 Agent。
它更像一个纪律严格的工程 Agent：输入明确指令，输出可审查的补丁。

它的执行模型也比较务实：

1. **确定性工具** 处理便宜、可靠的操作。
2. **微任务** 负责小范围逻辑拼装和上下文补全。
3. **子代理** 只在确实需要多步推理时出场。

## 快速开始

### 1. 安装

```bash
npm install -g salmon-loop
# 或
bun install -g salmon-loop
```

如果你用 Bun 作为包管理器，要求 `bun >= 1.3.9`。

### 2. 配置 LLM

新建本地 `.env`，优先使用这些环境变量：

```bash
SALMONLOOP_API_KEY=your-key
SALMONLOOP_BASE_URL=https://api.openai.com/v1
SALMONLOOP_MODEL=gpt-4.1-mini
```

旧的 `S8P_*` 别名仍然兼容，但新配置建议统一用 `SALMONLOOP_*`。

### 3. 进入对话模式

```bash
s8p
```

这是主推入口。进入目标仓库后，直接在对话里给它任务和验证命令即可。

例如：

```bash
Fix the null handling in src/user.ts and verify with bun run test
```

### 4. 需要一次性执行时再用 `run`

```bash
s8p run \
  --repo /path/to/your/repo \
  --instruction "Fix the null handling in src/user.ts" \
  --verify "bun run test" \
  --checkpoint-strategy worktree
```

### 5. 作为 Agent 服务运行

```bash
s8p serve
```

这会启动内置的 Agent 服务栈，用于 A2A 和本地 sidecar 集成。

## 用户最常用的能力

- **对话模式**：`s8p`
- **单次执行**：`s8p run --instruction "..." --verify "..."`，适合非交互场景
- **只构建上下文**：`s8p context -i "..."`
- **快照管理**：`s8p snap ls`、`s8p snap show <hash>`、`s8p checkout <hash>`
- **Headless / CI**：`--output-format json` 或 `--output-format stream-json`

更完整的用法可以看 [docs/user/cli.md](docs/user/cli.md)、[docs/user/config.md](docs/user/config.md)、[docs/reference/headless.md](docs/reference/headless.md)。

## 安全模型

SalmonLoop 在这里是故意严格的。

- **用户数据安全优先**：执行契约明确限制对主工作区和 Git index 的非预期写入。
- **脏工作区支持是显式设计**：需要隔离执行和更安全的 apply-back 时，就用 `worktree`。
- **回滚不是附属功能**：验证失败就是失败，不会含糊带过。
- **只读阶段必须只读**：探索、规划、验证阶段不会随便获得写权限。

如果你想看完整契约，先从 [docs/design/execution-contract.md](docs/design/execution-contract.md) 开始。

## 扩展能力

- **语言插件**：放到 `.salmonloop/languages/<lang>/index.js`
- **外部工具和 MCP**：通过 `.salmonloop/config/` 配置
相关文档见 [docs/user/plugins.md](docs/user/plugins.md) 和 [docs/user/extensions.md](docs/user/extensions.md)。

## 参与贡献

对贡献者来说，最短路径是：

```bash
bun run setup:hooks
bun run verify
```

这个仓库里，`bun run verify` 就是代码交付线。

建议先看：

- [docs/contributing/contributing.md](docs/contributing/contributing.md)
- [docs/contributing/testing.md](docs/contributing/testing.md)
- [docs/contributing/coding-standards.md](docs/contributing/coding-standards.md)
- [docs/contributing/release.md](docs/contributing/release.md)
- [docs/contributing/security.md](docs/contributing/security.md)

## 文档入口

完整文档目录在 [docs/README.md](docs/README.md)。

推荐先读这些：

- [docs/getting-started/overview.md](docs/getting-started/overview.md)
- [docs/getting-started/quickstart.md](docs/getting-started/quickstart.md)
- [docs/user/execution-safety.md](docs/user/execution-safety.md)
- [docs/design/execution-limits.md](docs/design/execution-limits.md)
- [docs/reference/changelog.md](docs/reference/changelog.md)

## License

MIT
