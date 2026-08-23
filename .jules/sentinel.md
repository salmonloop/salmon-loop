## 2026-08-10 - Default Dangerous Patterns in SkillParser
**Vulnerability:** The default dangerous patterns in `SkillParser.extractCommands` (`DEFAULT_DANGEROUS_PATTERNS`) caught `curl ... | sh` but missed `wget ... | sh`, which is an equivalent vector for remote code execution via piped download. Also, variants like `bash`, `zsh`, or `python` were missed.
**Learning:** Hardcoded regexes for malicious shell patterns are prone to bypasses if they don't account for common aliases/alternatives (e.g., `wget` instead of `curl`, or `bash`/`zsh` instead of `sh`).
**Prevention:** Include broader shell command matching for network downloaders piped to interpreters.

## 2026-08-23 - Execa Environment Variable Leak
**Vulnerability:** Command execution environment could bypass variable redaction
**Learning:** When using execa and sanitizing the environment manually with env, execa will merge it back into process.env if extendEnv is not explicitly set to false
**Prevention:** Always add extendEnv: false to execa calls where environment variable redaction is intended
