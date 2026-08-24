## 2026-08-24 - execa extendEnv defaults to true
**Vulnerability:** When using `execa` with a customized/sanitized `env` object, `execa` defaults to `extendEnv: true`, which merges the unsanitized `process.env` back in, defeating the sanitization.
**Learning:** Always explicitly set `extendEnv: false` when passing a sanitized `env` object to `execa`.
**Prevention:** Ensure `extendEnv: false` is set in all `execa` calls where `env` is explicitly provided and sanitized.
## 2026-08-10 - Default Dangerous Patterns in SkillParser
**Vulnerability:** The default dangerous patterns in `SkillParser.extractCommands` (`DEFAULT_DANGEROUS_PATTERNS`) caught `curl ... | sh` but missed `wget ... | sh`, which is an equivalent vector for remote code execution via piped download. Also, variants like `bash`, `zsh`, or `python` were missed.
**Learning:** Hardcoded regexes for malicious shell patterns are prone to bypasses if they don't account for common aliases/alternatives (e.g., `wget` instead of `curl`, or `bash`/`zsh` instead of `sh`).
**Prevention:** Include broader shell command matching for network downloaders piped to interpreters.
