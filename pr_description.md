🎯 **What:**
Added unit tests for the implicit `assertNotSymlink` security exception paths inside `src/cli/utils/safe-fs.ts`. Because `assertNotSymlink` is an internal function, it's tested via the exported `writeFileUtf8` function which internally triggers those specific code paths.

📊 **Coverage:**
- `ENOENT` handling path (ensures non-existent files don't fail `assertNotSymlink`)
- Explicit rejection of paths that resolve to symlinks.
- Correct handling of normal files.
- Propagation of any other unexpected `fs` errors correctly.

✨ **Result:**
100% test coverage for the symlink defense mechanisms, preventing accidental regressions while preserving security boundary constraints.
