## 2025-05-03 - Mitigation of Command Injection in Tool Authorization
**Vulnerability:** Command injection risk in `src/cli/authorization/non-interactive.ts` where `execa` was called with `shell: true` and unsanitized command inputs directly appended into the shell execution flow.
**Learning:** Hardcoded `shell: true` exposes the system to command injection vulnerabilities, especially when executing arbitrary or external tools/commands from configuration.
**Prevention:** Remove `shell: true` and execute commands by separating the file and arguments into individual string parameters for `execa`, parsing the original string into an arguments array safely as a fallback.
