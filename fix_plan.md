1. Modify `src/core/config/types/config-file.ts` to add an optional `args?: string[]` to the `command` interface in `ToolAuthorizationConfig`.
2. Add a `splitCommand` function in `src/core/utils/command-split.ts`.
3. In `src/cli/authorization/non-interactive.ts`:
   - Import `splitCommand`.
   - Update `requestNonInteractiveAuthorizationDecision` to handle `args` from config, falling back to `splitCommand(cmd)` if `args` is not provided.
   - Use the first item from `splitCommand` as the command, and the rest as arguments.
   - Remove `shell: true`.
