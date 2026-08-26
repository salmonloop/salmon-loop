## 2026-08-10 - Default Dangerous Patterns in SkillParser
**Vulnerability:** The default dangerous patterns in `SkillParser.extractCommands` (`DEFAULT_DANGEROUS_PATTERNS`) caught `curl ... | sh` but missed `wget ... | sh`, which is an equivalent vector for remote code execution via piped download. Also, variants like `bash`, `zsh`, or `python` were missed.
**Learning:** Hardcoded regexes for malicious shell patterns are prone to bypasses if they don't account for common aliases/alternatives (e.g., `wget` instead of `curl`, or `bash`/`zsh` instead of `sh`).
**Prevention:** Include broader shell command matching for network downloaders piped to interpreters.

## 2026-08-26 - API Key leakage to child processes via execa extendEnv
**Vulnerability:** Sanitized env object was passed to execa without setting extendEnv: false, causing execa to default to extendEnv: true and re-inject the unsanitized process.env.
**Learning:** When sanitizing environment variables for execa, you must explicitly set extendEnv: false alongside your sanitized env object, otherwise execa re-injects the original environment variables.
**Prevention:** Always add extendEnv: false when passing a custom env object to execa if the goal is to redact sensitive variables.
