# FAQ & Troubleshooting

## Common Issues

### 1. Why did the loop fail after 2 attempts?
SalmonLoop has a safety limit of 2 retries (3 attempts total). If the model cannot converge on a working solution within these attempts, it stops to prevent excessive API costs and potential "hallucination loops". You can try refining your instruction or providing more specific context using the `--file` option.

### 2. What does "Rollback failed; workspace may be dirty" mean?
This happens if `git checkout -- <files>` fails, usually because of a conflict that Git couldn't resolve automatically during a 3-way merge. You should manually check `git status` and run `git reset --hard` if you want to clear all changes.

### 3. How does context shrinking work?
When a verification command fails, SalmonLoop parses the output for file paths. If it finds specific files that failed (e.g., in a test trace), it removes all other code snippets from the LLM's context in the next round, forcing the model to focus only on the problematic files.

### 4. When should I use `--force-reset`?
Use `--force-reset` if you want SalmonLoop to perform a `git reset --hard` on every failure. This is safer for ensuring a clean state but will discard any uncommitted changes you had in your workspace before running the tool.

### 5. The patch failed to apply. Why?
This usually happens if the LLM generates a patch that doesn't match the current state of the file (e.g., line numbers are off or the surrounding context has changed). SalmonLoop uses 3-way merging to mitigate this, but complex changes may still fail. The next iteration will include the error message, helping the model fix the patch.
