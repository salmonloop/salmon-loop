# FAQ & Troubleshooting

## Common Issues

### 1. Why did the loop fail after 2 attempts?
SalmonLoop has a safety limit of 2 retries (3 attempts total). If the model cannot converge on a working solution within these attempts, it stops to prevent excessive API costs and potential "hallucination loops". You can try refining your instruction or providing more specific context using the `--file` option.

### 2. What does "Rollback failed; workspace may be dirty" mean?
This usually happens when Git is in a conflicted state. SalmonLoop has now enhanced its rollback mechanism; if a standard `git checkout` fails, it will automatically attempt a more thorough reset (`git stash`, `git reset --hard`, and `git clean`) to restore the workspace. If you still see this error, please manually check `git status`.

### 3. How does context shrinking work?
When a verification command fails, SalmonLoop parses the output for file paths. If it finds specific files that failed (e.g., in a test trace), it removes all other code snippets from the LLM's context in the next round, forcing the model to focus only on the problematic files.

### 4. When should I use `--force-reset`?
Use `--force-reset` if you want SalmonLoop to perform a `git reset --hard` on every failure. This is safer for ensuring a clean state but will discard any uncommitted changes you had in your workspace before running the tool.

### 5. The patch failed to apply. Why?
This usually happens if the LLM generates a patch that doesn't match the current state of the file (e.g., line numbers are off or the surrounding context has changed). SalmonLoop uses 3-way merging to mitigate this, but complex changes may still fail. The next iteration will include the error message, helping the model fix the patch.

### 6. What does "Patch is not in unified diff format" mean?
SalmonLoop requires the LLM to output patches in the standard `diff --git` format. If the model includes conversational text around the diff or uses a non-standard format, the validation phase will fail. We have optimized the parser to be robust against common LLM formatting issues, but the core diff must still follow the unified format.

### 7. What should I do if I encounter "Dependency version mismatch"?
SalmonLoop has strict version requirements for core dependencies like `web-tree-sitter`. If your environment version is inconsistent, it may cause AST parsing failures. Please run `pnpm install` to ensure dependency versions match the locked versions in `package.json`.

### 8. What should I do if I encounter "Timeout acquiring lock"?
To prevent concurrent operations from corrupting the codebase, SalmonLoop creates a `.salmon.lock` file during modifications. If a previous run was abnormally interrupted and the lock was not released, you can manually delete the `.salmon.lock` file in the repository root.

### 9. What does "File is in MM (Double Dirty) state" mean?
This message appears when a file has both **staged** (added to index) and **unstaged** (working tree) changes simultaneously. SalmonLoop automatically detects this and promotes your unstaged changes to the staging area to prevent merge conflicts.
*   **Old Behavior**: The tool would fail with a conflict error (`.rej` file generated).
*   **New Behavior**: The tool automatically runs `git add` for the affected file to include your latest changes before applying the AI's patch.
*   **Action Required**: Be aware that your unstaged changes are now staged. You can review them with `git diff --cached`.
