## 2025-02-28 - [CRITICAL] Prevent command injection in non-interactive authorization
**Vulnerability:** Command injection risk due to the usage of `execa` with `shell: true` and direct user input in `src/cli/authorization/non-interactive.ts`.
**Learning:** `shell: true` allows shell metacharacters in commands, potentially leading to command injection if input is not rigorously sanitized.
**Prevention:** Avoid `shell: true` with `execa`. Instead, utilize `getPlatformShellInvocation` to correctly execute shell commands safely and securely by separating the executable file from its arguments.