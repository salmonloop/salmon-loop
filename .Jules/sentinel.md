## YYYY-MM-DD - [Title]
**Vulnerability:** [What you found]
**Learning:** [Why it existed]
**Prevention:** [How to avoid next time]

## 2024-04-20 - Command Injection via execa with shell: true
**Vulnerability:** Command injection vulnerability in `src/cli/authorization/non-interactive.ts` where `execa` was used with `shell: true` while executing a command specified via the `config.nonInteractive.command.cmd` parameter. This parameter is used to check for tool authorizations interactively, but since `shell: true` is enabled, an attacker who controls the command string could append additional shell commands to be executed on the system.
**Learning:** `execa` configurations allowing `shell: true` bypass the native argument escaping mechanisms provided by spawn/exec. If parameters derived from configuration files or inputs aren't completely validated, an attacker can exploit the flexibility of the shell parsing.
**Prevention:** Avoid `shell: true` with `execa` whenever possible, preferring to explicitly define the executable path and an array of individual arguments. In cases where arguments must be parsed from a single string, implement or use a safe command-splitting utility to break the command into an executable string and an arguments array.
