# Salmon-Loop

[English](README.md) | [简体中文](README.zh-CN.md)

A minimal viable execution loop for automated code patching.

## Architecture: Three-Layer Triage

Salmon-Loop employs a unique **Three-Layer Triage** model to handle varying levels of task complexity with maximum efficiency and safety:

1.  **SimpleTool (Deterministic)**: Atomic, high-speed operations (e.g., Git, FS) executed as pure functions. Zero orchestration overhead.
2.  **MicroTask (Logic Bridge)**: Deterministic tasks requiring micro-decisions or data resolution (e.g., dynamic context assembly). Driven by the **Grizzco DSL** and `MicroTaskRunner`.
3.  **SubAgent (Probabilistic)**: Complex, multi-step goals requiring reflection and autonomous planning. Managed via full LLM-driven execution loops.

This tiered approach ensures that simple tasks remain blazing fast and predictable, while complex tasks have the cognitive power they need.

## Philosophy

Salmon-Loop is built on three core principles:

1.  **Patch-First**: All changes are applied via standard unified diffs (`git apply`) and integrated using a robust 3-way merge strategy. This ensures changes are precise, reversible, and reviewable.
2.  **Verify-First**: No change is considered successful without passing a user-provided verification command (e.g., `npm test`).
3.  **Fail-Fast**: If verification fails, the system immediately rolls back changes and reports the error. It does not attempt to "guess" its way out of a broken state without a clear plan.

## Non-Goals

- **Not an Agent**: Salmon-Loop is a tool for executing specific instructions, not an autonomous agent that explores the codebase indefinitely.
- **No Refactors**: It is designed for targeted fixes and features, not large-scale architectural refactoring.
- **No Whole-File Rewrite**: It modifies existing files via patches; it does not rewrite entire files from scratch.

## Language Support & Plugins

Salmon-Loop features a pluggable architecture for programming language support.

- **Built-in Support**: TypeScript and JavaScript are supported out of the box.
- **Extensibility**: You can add support for other languages (Python, Go, Rust, etc.) by adding a plugin.
- **Zero-Config**: Place your plugin in `.salmonloop/languages/<lang>/index.js` and it will be automatically loaded.

See [Plugin Documentation](docs/user/plugins.md) for details on how to create custom language plugins.

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

Edit `.env` and set your `SALMONLOOP_API_KEY` (or legacy `S8P_API_KEY`). You can also customize `SALMONLOOP_BASE_URL` (preferred) or legacy `S8P_BASE_URL`, plus `SALMONLOOP_MODEL` (preferred) or legacy `S8P_MODEL`.

### Running the CLI

By default, Salmon-Loop enters interactive **chat** mode. For single-turn tasks, use the **run** command:

```bash
# Using pnpm (recommended for development)
pnpm dev run --instruction "fix bug" --verify "npm test"

# Using npx (no build required)
npx tsx src/cli/index.ts run --instruction "fix bug" --verify "npm test"

# Or after building
node dist/cli/index.js run --instruction "fix bug" --verify "npm test"
```

### Quick Example

Fix a bug and verify with `npm test`:

```bash
salmon-loop run --instruction "Fix the null pointer exception in user.ts" --verify "npm test"
```

### Library Usage

SalmonLoop can be embedded into your own tools:

```typescript
import { runSalmonLoop, AiSdkLLM } from 'salmon-loop';

const llm = new AiSdkLLM({
  clientPackage: '@ai-sdk/openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.SALMONLOOP_API_KEY,
  modelId: process.env.SALMONLOOP_MODEL || 'gpt-4o',
});

const result = await runSalmonLoop({
  instruction: 'Fix typo',
  verify: 'npm test',
  repoPath: process.cwd(),
  llm,
});
```

## Development

### Running Tests & Linting

You can run the same checks that the CI performs locally:

```bash
# Run all tests
pnpm test

# Run linting
pnpm lint

# Run formatting
pnpm format
```

### Local CI Simulation

To simulate the GitHub Actions environment locally, we recommend using [act](https://github.com/nektos/act):

```bash
# Run the CI workflow locally
act
```

## Safety & Constraints

- **Dirty Workspace**: By default, SalmonLoop will refuse to run if the git workspace has uncommitted changes. Use `worktree` strategy to run in an isolated environment.
- **Shadow Merge**: Safely integrates AI changes with user modifications using a 3-way merge strategy in an isolated shadow environment.
- **Fail-Fast**: The loop terminates immediately if a patch cannot be applied or if verification fails after maximum retries.
- **AST Verification**: Performs deep AST structure and scope integrity checks to prevent syntax errors and unintended side effects.
- **File Locking**: Uses a robust locking protocol to prevent concurrent modifications and repository corruption.
- **Limits**: Execution is bound by strict limits on file count, diff size, and context budget.

## Documentation

For more details, please refer to [docs/README.md](docs/README.md):

- [Design & Limits](docs/design/execution-limits.md)
- [CLI Usage](docs/user/cli.md)
- [Examples](docs/user/examples.md)

## License

MIT
