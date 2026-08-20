## 2026-08-10 - Default Dangerous Patterns in SkillParser
**Vulnerability:** The default dangerous patterns in `SkillParser.extractCommands` (`DEFAULT_DANGEROUS_PATTERNS`) caught `curl ... | sh` but missed `wget ... | sh`, which is an equivalent vector for remote code execution via piped download. Also, variants like `bash`, `zsh`, or `python` were missed.
**Learning:** Hardcoded regexes for malicious shell patterns are prone to bypasses if they don't account for common aliases/alternatives (e.g., `wget` instead of `curl`, or `bash`/`zsh` instead of `sh`).
**Prevention:** Include broader shell command matching for network downloaders piped to interpreters.

## 2026-08-20 - Execa extendEnv True Defaults Defeat Environment Sanitization
**Vulnerability:** When using `execa` with a custom `env` object to sanitize sensitive keys from the environment, omitting `extendEnv: false` causes `execa` to default to `extendEnv: true`. This re-injects the unsanitized `process.env` on top of the sanitized `env` object, thereby bypassing the sanitization and leaking secrets to the child process.
**Learning:** Environment sanitization libraries or patterns must explicitly disable environment inheritance/extension in process spawning wrappers (like `execa`) to ensure the provided safe environment is the ONLY environment used.
**Prevention:** Always set `extendEnv: false` when providing a custom, sanitized `env` payload to `execa`.
