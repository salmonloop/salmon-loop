## 2025-02-14 - Fix Command Injection in Non-Interactive Authorization
**Vulnerability:** The `requestNonInteractiveAuthorizationDecision` function was using `shell: true` in its `execa` call when executing the non-interactive tool authorization command strategy. If a malicious configuration overrides the `cmd` parameter, this allows arbitrary command execution via shell characters.
**Learning:** We must avoid `shell: true` in `execa` across the codebase to mitigate command injection risks. Even executing via a manually invoked shell (e.g. `/bin/sh -c`) presents the exact same vulnerabilities.
**Prevention:** Use `parseCommandString` from `execa` to explicitly parse the command string into an array of arguments, and execute without enabling `shell: true`.
