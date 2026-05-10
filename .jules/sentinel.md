## 2025-02-27 - Command Injection in config-driven execa calls
**Vulnerability:** Found `execa(cmd, { shell: true })` in `src/cli/authorization/non-interactive.ts` where `cmd` is sourced directly from user configuration (`nonInteractive.command.cmd`).
**Learning:** Using `shell: true` with unsanitized configuration data exposes the application to command injection if the configuration file is tampered with or controlled by a malicious actor.
**Prevention:** Always use `getPlatformShellInvocation(command)` from `src/core/utils/platform-shell.ts` which properly splits the shell executable and arguments for `execa`, and avoid `shell: true`.
