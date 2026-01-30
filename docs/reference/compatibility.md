# Compatibility

## Platforms

SalmonLoop is tested on Windows and expects:
- `git` available on PATH
- `rg` (ripgrep) available for best context gathering (optional; fallback paths may exist)

## Line Endings

- Unified diffs must match the repository's effective line endings.
- For CRLF-heavy repositories on Windows, prefer generating diffs against the same worktree state SalmonLoop will apply to.

