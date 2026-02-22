# Contributing to SalmonLoop

We welcome contributions to SalmonLoop! As a design-driven project, we prioritize stability, determinism, and clear engineering contracts.

## Development Principles

1. **Safety First**: Any change that affects the execution loop must maintain or enhance safety guarantees (e.g., no unintended file mutations).
2. **Deterministic Logic**: Avoid heuristic "guessing" or AI-driven decision making for core execution logic. Prefer rule-based engineering.
3. **Documentation SSOT**: English documentation is the Single Source of Truth (SSOT). Chinese documentation is a user guide and may lag behind.
4. **Test-Driven**: New features or bug fixes should be accompanied by unit tests.

## Project Structure

- `src/core`: The execution kernel. Must remain editor-agnostic and self-contained.
- `src/locales`: Internationalization strings. No hardcoded user-facing text in core logic.
- `tests/unit`: Vitest unit tests. These are mocked to ensure they are fast, deterministic, and don't require a real Git environment or Ripgrep.

## Getting Started

1. Fork the repository.
2. Install dependencies: `bun install`.
3. Run tests: `bun run test:full`.
4. Run linting: `bun run lint`.
5. Create a feature branch and submit a pull request.

Notes:

- Use `bun` for dependency management in this repository.

### Debugging with `--verbose`
To debug issues, you can use the `--verbose` flag to get more detailed logs.
Use `--verbose` for basic execution steps, or `--verbose=extended` for detailed internal states and debug information.

Example:
```bash
salmon-loop --verbose=extended --instruction "Fix bug" --verify "bun run test"
```
