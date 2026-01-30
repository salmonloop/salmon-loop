# Troubleshooting

## "Grizzco V3 transaction completed: 0/0 files processed"

Meaning: the APPLY step received a diff that validated but did not produce any file operations.

Actions:
- Ensure the patch is a standard git unified diff.
- If the diff starts with `--- a/...` and has no `diff --git`, upgrade to a version that supports headerless unified diffs.

## "repository lacks the necessary blob to perform 3-way merge"

Meaning: `git apply -3` requires valid preimage blob ids from `index <old>..<new>` lines, but the repository does not contain them (often due to fake index lines in generated diffs).

Actions:
- Prefer diffs without `index` lines.
- Use a version that strips unsafe `index` lines or falls back safely.

## "Unexpected end of JSON input" during PATCH

Meaning: a JSON parse error occurred while generating the patch (typically upstream/provider response parsing or tool-calling protocol handling).

Actions:
- Inspect the latest `.s8p/audit/audit-*.json` for `errorStack`.
- Retry with `--verbose=extended` and ensure your provider configuration is correct.

