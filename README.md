# Salmon-Loop

[English](README.md) | [简体中文](README.zh-CN.md)

A minimal viable execution loop for automated code patching.

## Philosophy

Salmon-Loop is built on three core principles:

1.  **Patch-First**: All changes are applied via standard unified diffs (`git apply`). This ensures changes are precise, reversible, and reviewable.
2.  **Verify-First**: No change is considered successful without passing a user-provided verification command (e.g., `npm test`).
3.  **Fail-Fast**: If verification fails, the system immediately rolls back changes and reports the error. It does not attempt to "guess" its way out of a broken state without a clear plan.

## Non-Goals

-   **Not an Agent**: Salmon-Loop is a tool for executing specific instructions, not an autonomous agent that explores the codebase indefinitely.
-   **No Refactors**: It is designed for targeted fixes and features, not large-scale architectural refactoring.
-   **No Whole-File Rewrite**: It modifies existing files via patches; it does not rewrite entire files from scratch.

## Usage

### Installation

```bash
pnpm install
pnpm build
```

### Configuration

Copy the example environment file and add your API key:

```bash
cp .env.example .env
```

Edit `.env` and set your `SALMON_API_KEY`. You can also customize `SALMON_BASE_URL` and `SALMON_MODEL`.

### Running the CLI

You can run the CLI directly (the `run` command is default):

```bash
# Using pnpm (recommended for development)
pnpm dev --instruction "fix bug" --verify "npm test"

# Using npx (no build required)
npx tsx src/cli.ts --instruction "fix bug" --verify "npm test"

# Or after building
node dist/cli.js --instruction "fix bug" --verify "npm test"
```

### Quick Example

Fix a bug and verify with `npm test`:

```bash
salmon-loop --instruction "Fix the null pointer exception in user.ts" --verify "npm test"
```

### Library Usage

SalmonLoop can be embedded into your own tools:

```typescript
import { runSalmonLoop, OpenAILLM } from 'salmon-loop';

const result = await runSalmonLoop({
  instruction: 'Fix typo',
  verify: 'npm test',
  repoPath: process.cwd(),
  llm: new OpenAILLM()
});
```

## Safety & Constraints

- **Dirty Workspace**: By default, SalmonLoop will refuse to run if the git workspace has uncommitted changes. Use `allowDirty: true` to override.
- **Fail-Fast**: The loop terminates immediately if a patch cannot be applied or if verification fails after maximum retries.
- **Limits**: Execution is bound by strict limits on file count, diff size, and context budget.

## Documentation

For more details, please refer to [docs/README.md](docs/README.md):

- [Design & Limits](docs/en/design/execution-limits.md)
- [CLI Usage](docs/en/usage/cli.md)
- [Examples](docs/en/usage/examples.md)

## License

MIT
