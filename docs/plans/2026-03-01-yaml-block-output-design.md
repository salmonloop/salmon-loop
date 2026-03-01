# YAML Block Output Design

Date: 2026-03-01

## Context
Repo-local config files under `.salmonloop/config/` can be YAML or JSON. Today YAML writes use `Bun.YAML.stringify`, which emits flow-style YAML that looks like JSON. Users want all YAML writes to be block style for readability.

## Goals
- Emit block-style YAML for every config write that targets a `.yaml`/`.yml` file.
- Keep JSON output behavior unchanged.
- Preserve current config semantics and validation behavior.

## Non-Goals
- Changing the config schema.
- Changing CLI command surfaces or semantics.
- Reformatting YAML files that are not written by SalmonLoop.

## Proposed Approach
- Introduce the `yaml` (eemeli/yaml) package.
- In `src/core/config/file-format.ts`, replace `Bun.YAML.stringify` with `yaml.stringify` configured for block style:
  - `indent: 2`
  - `lineWidth: 0` (avoid forced line wraps)
  - Default block style (no flow output)
- Keep JSON stringify logic untouched.
- Keep YAML parsing using `Bun.YAML.parse` to minimize behavioral changes (optionally revisit later if needed).

## Data Flow
- CLI commands (`/config view`, `/mode`, `/output`) read and modify config objects.
- They call `stringifyConfigText` with detected format.
- YAML format routes through `yaml.stringify` and writes block-style output.

## Error Handling
- Existing `ConfigError` handling remains unchanged.
- YAML stringify errors will bubble through existing error reporting paths.

## Testing Strategy
- Add or update unit tests to assert YAML output uses block style.
- Add an integration test that writes config via CLI and validates YAML output shape (no flow-style braces).

## Tradeoffs
- Adds a dependency.
- Output becomes more readable and stable across edits.

## Risks
- Minor output differences could affect users relying on exact formatting.
- YAML stringify behavior differs slightly from Bun's implementation; keep parsing unchanged to reduce risk.
