## 2025-05-09 - Command Injection Fix

**Vulnerability:** Unsanitized use of `shell: true` with `execa` in `src/cli/authorization/non-interactive.ts` can lead to command injection if `cmd` is untrusted.
**Learning:** Hardcoding `shell: true` exposes the system to command injection due to implicit shell syntax evaluation if an untrusted string makes it into the parameter list. It existed because tokenizing/splitting string arguments manually can be complex without introducing extra npm dependencies like `string-argv`.
**Prevention:** Rather than adding external dependencies to solve command tokenization, or relying on `shell: true`, parse and split the arguments as an array locally using custom, reliable tokenization logic like the new `splitCommand` function.
