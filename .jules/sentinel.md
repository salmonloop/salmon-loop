## 2026-08-04 - [Prevent Secret Leakage in Spawned Processes]
**Vulnerability:** Spawned processes (e.g., via `execa` or child_process) inherit the host's `process.env` by default, leaking internal framework secrets (API keys) to untrusted tools.
**Learning:** Never pass the raw `process.env` down when executing third-party tools or shells.
**Prevention:** Implement and enforce an environment sanitization function (`sanitizeEnvironment`) that strips known sensitive keys before launching external processes.
