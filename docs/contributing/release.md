# Release Process (npm CLI Package)

This repository publishes the `salmon-loop` CLI package to npm.
The package is installed with `npm install -g salmon-loop` or `bun install -g salmon-loop`.

The recommended way to cut a release is the repo helper script:

- `bun run release:cut` (safe-by-default, dry-run unless `--apply`)

Publishing is automated: pushing a `vX.Y.Z` tag triggers the `Publish` workflow, which validates the tag, runs the full test suite, runs publish smoke checks, and then publishes the npm package.

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
4. Run packaging checks: `npm pack`, temporary install, and CLI smoke tests for `s8p`, `s8p run`, and `s8p serve` (unless `--skip-package-check`).
5. Check npm authentication before publish when `--publish` is requested.
6. Update `package.json` version.
7. Create a commit: `chore(release): vX.Y.Z`
8. Create an annotated tag: `vX.Y.Z`
9. Optionally push commit + tag and publish the package to npm.

## Cut a Release (Recommended)

Always start with a dry-run:

```bash
bun run release:cut --bump patch
```

To apply the release, push the commit and tag:

```bash
bun run release:cut --bump patch --apply --push
```

The tag push will trigger CI to publish the package via trusted publishing (OIDC). The manual `workflow_dispatch` fallback uses `NPM_TOKEN` for emergency publishes.

To set an explicit version:

```bash
bun run release:cut --version 0.2.1 --apply --push
```

## Versioning Policy

Use `--bump patch|minor|major` as an explicit release decision. The script increments numbers mechanically; the team is responsible for choosing the correct level.

- `patch`
  - Bug fixes, internal refactors, documentation updates, packaging cleanup, or other changes that do not change the expected CLI contract.
- `minor`
  - New commands, new flags, new supported workflows, or behavior additions that stay backward-compatible for existing users.
- `major`
  - Breaking CLI behavior changes, removed commands/flags, incompatible config changes, or workflow changes that require users to update automation or scripts.

If the release does not fit a simple increment, set the version explicitly:

```bash
bun run release:cut --version 0.3.0 --apply --push
```

### Publish to npm (Optional)

To cut the release and publish the package to npm in one go:

```bash
bun run release:cut --bump patch --apply --push --publish
```

This is the standard team release path.

If you need a non-default dist-tag:

```bash
bun run release:cut --bump patch --apply --push --publish --npm-tag next
```

If you only need to publish the already-built package contents:

```bash
bun run release:publish --apply
```

This path assumes you have already verified the exact package contents you want to publish.

If your npm account uses 2FA:

```bash
bun run release:cut --bump patch --apply --push --publish --npm-otp 123456
```

## Packaging Checks

Before publishing, verify the package shape:

```bash
bun run pack:dry
```

The release script now runs package checks automatically unless `--skip-package-check` is used.
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
- **"npm authentication check failed"**
  - Run `npm login` (or refresh your npm token) and retry.
- **"Smoke test failed for: s8p ..."**
  - Rebuild, run `bun run pack:dry`, then validate the packed tarball in a temporary install before retrying.
- **"Published files look wrong"**
  - Run `bun run pack:dry` and adjust the `files` field in `package.json`.

## Failure Recovery

If the publish workflow fails after the tag was pushed, decide whether to re-run or roll back.

### Re-run the publish (preferred if the tag/version is correct)

1. Fix the issue (e.g., adjust `files`, fix CI, or retry after npm outage).
2. Re-run the `Publish` workflow on the existing tag.
3. If the package was partially published, delete the bad version and re-publish the same tag.

### Roll back the release (only when the tag/version is wrong)

1. Delete the tag locally and on origin:
```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
```
2. Revert the release commit:
```bash
git revert <release_commit_sha>
git push origin main
```
3. Cut a new release with the corrected version.

### If npm publish succeeded but CI failed after

1. Leave the tag as-is; the package is already released.
2. Fix CI separately and continue for the next version.
