# Core Module Boundaries

## Purpose

This document defines migration-time boundaries for `src/core`.

Goals:
- prevent root-level module sprawl;
- move implementation to domain folders;
- keep compatibility with temporary facades;
- make cleanup measurable.

## Root Policy

`src/core` root is reserved for public compatibility facades and stable entrypoints.

Disallowed in root:
- new implementation-heavy modules;
- new utility modules that belong to a domain folder;
- ad-hoc cross-domain helpers.

Allowed in root during migration (temporary facades):
- `src/core/loop.ts`
- `src/core/types.ts`

All other root files should be moved to domain directories or deleted if unused.

## Domain Mapping Rules

Target domains:
- `src/core/context/*`
- `src/core/llm/*`
- `src/core/prompts/*`
- `src/core/runtime/*`
- `src/core/patch/*`
- `src/core/verification/*`
- `src/core/observability/*`
- `src/core/utils/*`
- `src/core/config/*`

Rule of thumb:
- if a module is called by one domain, move it into that domain;
- if shared by multiple domains, use `utils`, `config`, or a clearly named cross-domain folder;
- avoid putting new shared logic in root facades.

## Import Rules

Internal code should prefer domain imports over root facades.

Preferred:
- `src/core/context/service.ts` imports from `src/core/context/*`
- `src/core/grizzco/*` imports from concrete domain modules

Avoid:
- new internal imports from temporary root facades unless the module is an intentional public API.

## Audit and Exit Criteria

Use the audit script to track progress:

```bash
node --import tsx scripts/audit-core-root.ts
node --import tsx scripts/audit-core-root.ts --json
```

Minimum migration gate:
- root implementation modules continuously decrease;
- orphan root modules are removed;
- test-only root modules are moved out of root;
- only approved facades remain in root.
