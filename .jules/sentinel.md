## 2024-05-02 - [CRITICAL] Prevent Command Injection via `shell: true`
**Vulnerability:** `src/cli/authorization/non-interactive.ts` used `execa` with `shell: true` to execute commands defined in configurations, allowing potential command injection risks.
**Learning:** Configurations could be inadvertently set to strings that allow unintended shell executions since `shell: true` evaluates standard shell characters. It should be avoided unless strictly necessary, and inputs should be provided directly as arrays instead.
**Prevention:** Removed `shell: true` in `execa` calls. Exposed `args?: string[]` explicitly in configuration, and created a `splitCommand` utility for safely parsing argument strings to properly provide them as execution arrays without risking command injection.
