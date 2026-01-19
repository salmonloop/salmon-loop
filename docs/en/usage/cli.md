# CLI Reference

SalmonLoop provides a command-line interface for automated code patching.

## Commands

The `run` command is the default and currently the only command.

```bash
salmon-loop [options]
```

## Options

- `-i, --instruction <string>`: **(Required)** Instruction for the code modification.
- `-v, --verify <command>`: **(Required)** Command to run for verification (e.g., `npm test`, `pytest`).
- `-r, --repo <path>`: Path to the target repository. Defaults to the current directory.
- `-f, --file <path>`: Path to a specific file to provide as primary context (repo-relative or absolute).
- `-s, --selection <text>`: Direct text selection to provide as context.
- `--dry-run`: Generate the patch and run validation, but do not apply it to the disk.
- `--verbose`: Print detailed step logs, including LLM plans and verification output.
- `--force-reset`: Force a hard reset (`git reset --hard`) on failure. **Use with caution** as it discards all uncommitted changes.

## Environment Variables

- `SALMON_API_KEY`: Your LLM provider API key.
- `SALMON_BASE_URL`: (Optional) Custom API base URL.
- `SALMON_MODEL`: (Optional) LLM model to use.
