# Release Process (npm CLI Package)

This repository publishes the `salmon-loop` CLI package to npm.
The package is installed with `npm install -g salmon-loop` or `bun install -g salmon-loop`.

The recommended way to cut a release is the repo helper script:

- `bun run release:cut` (safe-by-default, dry-run unless `--apply`)

## Prerequisites

- You are on the release branch (default: `main`).
- Your workspace is clean (no unstaged/staged/untracked changes), unless you explicitly use
  `--allow-dirty` (not recommended).
- You have Bun installed and can run `bun run verify` locally.
- You have npm access to publish the `salmon-loop` package.

## What a Release Does

When applied (`--apply`), the release script will:

1. Run safety checks (branch, cleanliness, upstream status when available, tag existence).
2. Run `bun run verify` (unless `--skip-verify`).
3. Run `bun run build` (unless `--skip-build`).
4. Update `package.json` version.
5. Create a commit: `chore(release): vX.Y.Z`
6. Create an annotated tag: `vX.Y.Z`
7. Optionally push commit + tag and publish the package to npm.

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

### Publish to npm (Optional)

To cut the release and publish the package to npm in one go:

```bash
bun run release:cut --bump patch --apply --push --publish
```

If you need a non-default dist-tag:

```bash
bun run release:cut --bump patch --apply --push --publish --npm-tag next
```

If you only need to publish the already-built package contents:

```bash
bun run release:publish --apply
```

If your npm account uses 2FA:

```bash
bun run release:cut --bump patch --apply --push --publish --npm-otp 123456
```

## Packaging Checks

Before publishing, verify the package shape:

```bash
bun run pack:dry
```

This should only include the runtime files needed by the CLI package, not repository-only content such as tests or GitHub workflows.

## Troubleshooting

- **"Refusing to cut a release from a dirty workspace"**
  - Commit/stash changes (including untracked files) and retry.
- **"Branch is behind upstream"**
  - Pull/rebase `main` first, then retry.
- **"Tag already exists"**
  - Pick a new version or delete the tag if it was created by mistake (use with caution).
- **"`npm publish` failed"**
  - Check npm authentication, package name availability, and 2FA requirements.
- **"Published files look wrong"**
  - Run `bun run pack:dry` and adjust the `files` field in `package.json`.
