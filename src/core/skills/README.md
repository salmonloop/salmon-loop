# Skills Module

## Overview
The Skills module implements the **Three-Layer Triage** execution model.

## Architecture
- **IExecutable**: The core protocol for all executable units.
- **MicroTaskRunner**: The Layer 2 executor for deterministic, DSL-driven tasks.
- **SkillBridge**: Bridges Markdown-based skill definitions into the standard Tool calling system.

## Compliance
All skills must follow `docs/design/orchestration-dsl.md` and ensure no side effects in DRY_RUN mode.
