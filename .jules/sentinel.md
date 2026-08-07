## 2026-08-07 - [API Key Leakage in Subprocesses]
**Vulnerability:** The internal framework secret `SALMONLOOP_API_KEY` (and the legacy `S8P_API_KEY`) was inadvertently leaked to child processes executed via `execa` in `shell.ts` and `MicroTaskRunner.ts` because the entire `process.env` was cloned blindly without redacting these keys.
**Learning:** Blindly spreading `...process.env` when executing shell commands can leak critical secrets loaded into the agent process memory to untrusted subcommands, leading to potential credentials exfiltration.
**Prevention:** Always explicitly delete sensitive framework-specific keys (e.g., `SALMONLOOP_API_KEY`, `S8P_API_KEY`) from the environment object before passing it to child process execution functions like `execa`.
