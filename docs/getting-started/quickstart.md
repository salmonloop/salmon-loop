# Quickstart

This quickstart assumes:
- You have a git repository to patch.
- You can provide a verify command that exits non-zero on failure.

## Minimal Worktree Run

Example (Windows PowerShell):

```powershell
npm run dev -- -r "C:\path\to\your-repo" -f "src\\index.js" --instruction "Add a comment as the first line inside createSafeEnvProxy" --verify "node -e \"process.exit(0)\"" -cs worktree --verbose
```

## Notes

- If `S8P_API_KEY` / `SALMON_API_KEY` is not set, SalmonLoop uses a stub LLM and is not useful for real patching.
- Use `--dry-run` to prevent writing to the main workspace.

