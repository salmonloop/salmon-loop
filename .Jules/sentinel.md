## 2024-05-18 - [Fix command injection in tool authorization]
**Vulnerability:** Command injection risk in `src/cli/authorization/non-interactive.ts` where the non-interactive authorization strategy `command` executed the configured `cmd` via `execa(cmd, { shell: true })`. This allows arbitrary code execution if the `cmd` is attacker-controlled.
**Learning:** `shell: true` should be avoided when possible as it creates a high risk of command injection. `ToolAuthorizationConfig` and `ToolAuthorizationRequest` do not provide guarantees against malicious input.
**Prevention:** Executed the authorization command by splitting `cmd` into a binary and arguments to avoid using the shell, or by allowing the `ToolAuthorizationConfig` to specify explicit `args` and running `execa(file, args)`.
