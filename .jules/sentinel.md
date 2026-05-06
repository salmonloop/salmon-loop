## 2024-05-20 - Command Injection in Tool Authorization
**Vulnerability:** Command injection in `src/cli/authorization/non-interactive.ts` where user-provided command configuration was executed via `execa` with `shell: true`.
**Learning:** Using `shell: true` with unsanitized configuration data in `execa` allows arbitrary command execution. The project provides `splitCommand` via `src/core/utils/command-split.ts` or explicitly configured arguments.
**Prevention:** Avoid `shell: true` entirely. Either accept explicit command arrays in configuration (e.g. `cmd` and `args` separately), or safely parse the string command into an array of arguments using a dedicated utility like `splitCommand`.
