# Coding Standards

## Language

- All code (including comments and user-facing strings in code paths) must be written in English.

## Logging

- Production code must use the shared logger (not `console.*`) with an appropriate level.

## Localization

- User-facing copy must be sourced from `src/locales/*` (no hardcoded UI text).

## Testing

- Follow `docs/contributing/testing.md` and prioritize behavior-focused tests.

