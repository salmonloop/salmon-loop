# Release Process (Compiled Binaries)

This repository publishes **compiled CLI binaries** via GitHub Releases using the workflow
`/.github/workflows/release-compiled.yml`.

The recommended way to cut a release is the repo helper script:

- `bun run release:cut` (safe-by-default, dry-run unless `--apply`)

## Prerequisites

- You are on the release branch (default: `main`).
- Your workspace is clean (no unstaged/staged/untracked changes), unless you explicitly use
  `--allow-dirty` (not recommended).
- You have Bun installed and can run `bun run verify` locally.
- If you want to dispatch the GitHub Actions workflow from your terminal, install GitHub CLI (`gh`)
  and ensure you are authenticated.

## What a Release Does

When applied (`--apply`), the release script will:

1. Run safety checks (branch, cleanliness, upstream status when available, tag existence).
2. Run `bun run verify` (unless `--skip-verify`).
3. Run `bun run build` (unless `--skip-build`).
4. Update `package.json` version.
5. Create a commit: `chore(release): vX.Y.Z`
6. Create an annotated tag: `vX.Y.Z`
7. Optionally push commit + tag and dispatch the GitHub Actions release workflow.

## Cut a Release (Recommended)

Always start with a dry-run:

```bash
bun run release:cut --bump patch
```

To apply the release, push the commit and tag:

```bash
bun run release:cut --bump patch --apply --push
```

To set an explicit version:

```bash
bun run release:cut --version 0.2.1 --apply --push
```

### Dispatch GitHub Release Build (Optional)

To build and publish compiled binaries to the GitHub Release, dispatch the workflow:

```bash
bun run release:cut --bump patch --apply --push --dispatch
```

Notes:

- The dispatch step uses the workflow name `Release (compiled binaries)` by default.
- If you prefer, you can dispatch an existing tag without cutting a new one:

```bash
bun run release:dispatch --tag v0.2.1 --apply
```

## Artifacts (Workflow Output)

The workflow publishes these assets to the GitHub Release:

- `salmon-loop-darwin-arm64`
- `salmon-loop-darwin-x64`
- `salmon-loop-linux-x64-gnu`
- `salmon-loop-linux-x64-musl`
- `salmon-loop-windows-x64.exe`
- `SHA256SUMS`

These names are consumed by the install scripts under `scripts/install/`.

## Troubleshooting

- **"Refusing to cut a release from a dirty workspace"**
  - Commit/stash changes (including untracked files) and retry.
- **"Branch is behind upstream"**
  - Pull/rebase `main` first, then retry.
- **"Tag already exists"**
  - Pick a new version or delete the tag if it was created by mistake (use with caution).
- **"GitHub CLI (gh) is not available"**
  - Install `gh`, or dispatch the workflow from the GitHub Actions UI.

