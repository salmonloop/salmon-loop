# Sentinel Journal
## 2024-04-18 - [Fix Command Injection in ToolAuthorizationConfig]
**Vulnerability:** In `src/cli/authorization/non-interactive.ts`, the codebase executed `execa` with `shell: true` directly passing user-provided command via `config.nonInteractive?.command?.cmd`. This allowed arbitrary command execution.
**Learning:** Found an unused configuration field `cmd` which is executed unsafely.
**Prevention:** Instead of using `shell: true`, we should use a command splitting utility (`splitCommand`) if `args` aren't provided, and then execute securely using `execa(cmd, args, { shell: false })`.
