# Coding Standards

## Language

- All code (including comments and user-facing strings in code paths) must be written in English.

## Logging

- Production code must use the shared logger (not `console.*`) with an appropriate level.

## Localization

- User-facing copy must be sourced from localization files (no hardcoded UI text).
- **CLI-specific strings**: Must be placed in `src/cli/locales/`.
- **Core engine strings**: Must be placed in `src/locales/`.
- This separation keeps the engine lightweight and avoids leaking CLI-specific terminology into core logic.

## Testing

- Follow `docs/contributing/testing.md` and prioritize behavior-focused tests.

