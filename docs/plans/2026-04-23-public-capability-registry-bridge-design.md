# Public Capability Registry Bridge Design

**Date:** 2026-04-23

## Goal

Introduce one protocol-facing registry that becomes the single source of truth for publicly exposed capabilities across ACP and A2A, while keeping internal `flowMode`, local `Agent Skills`, and execution runtime concerns separate.

## Context

Recent `autopilot` work made protocol behavior substantially cleaner, but it also exposed a long-term structural gap:

- ACP `mode` and A2A `skills` are both protocol-facing capability surfaces.
- Internal execution still centers on `flowMode`.
- Local `Agent Skills` (`SKILL.md`) are internal assets, not protocol objects.
- When each protocol surface decides on its own what to expose, the system drifts into misleading declarations and mismatched runtime reachability.

The A2A review found the clearest example: the server briefly advertised multiple flow-backed A2A skills even though the production runtime had no standards-backed selection path to reach them. The immediate fix was to narrow served A2A exposure back to `autopilot`, but the architectural lesson is broader: public capability declaration needs one explicit source of truth.

## Design Summary

Add a new protocol-facing layer:

- `PublicCapabilityRegistry`

This registry owns:

- what is publicly exposed
- where it is exposed
- whether it is actually reachable
- how protocol adapters project it into ACP and A2A

It does **not** own:

- execution policy
- permission policy
- tool visibility
- local skill execution
- runtime dispatch mechanics

It is a projection and governance layer, not a runtime kernel.

## Core Principles

1. Public capability exposure must have exactly one source of truth.
2. Protocol adapters must project from registry data rather than inventing their own lists.
3. Internal `flowMode` and local `Agent Skills` must remain distinct concepts.
4. Capability reachability must be explicit, not inferred informally by developers.
5. Only capabilities that are actually reachable may be projected to external protocol surfaces.

## PublicCapability Model

Each public capability entry should contain:

- `id`
- `kind`: `'flow_mode' | 'workflow' | 'local_skill'`
- `target`
- `surfaces`: `{ a2a?: boolean; acp?: boolean }`
- `reachability`: `'reachable' | 'latent' | 'disabled'`
- `title`
- `description`
- optional `tags`
- optional `examples`
- optional `inputModes`
- optional `outputModes`

### Meaning of `kind`

- `flow_mode`
  - maps to internal `FlowMode`
  - example: `autopilot`, `patch`, `review`
- `workflow`
  - maps to a higher-level orchestrated path
  - reserved for future use
- `local_skill`
  - maps to an internal `SKILL.md` asset by internal skill id
  - reserved for future explicit public exposure

### Meaning of `reachability`

- `reachable`
  - there is a real production runtime path to execute this capability from the protocol surface
- `latent`
  - internal machinery exists, but the production protocol path is not available yet
- `disabled`
  - intentionally not exposed

This field is required because protocol advertisement drift is one of the main failure modes the new layer is meant to prevent.

## Separation of Concerns

### Internal `flowMode`

`flowMode` remains the primary internal execution selector. Public capabilities may project `flowMode`, but they do not redefine it.

### Local `Agent Skills`

Local `Agent Skills` remain internal assets:

- loaded from `SKILL.md`
- executed by the local skill/runtime stack
- not automatically public

Only explicitly registered local skills may ever become public capabilities.

This avoids coupling protocol behavior to repository file layout or skill asset structure.

### Protocol Objects

- ACP `mode` is a projection of reachable `flow_mode` public capabilities.
- A2A `AgentSkill` is a projection of reachable public capabilities for the A2A surface.

Neither ACP nor A2A should directly introspect internal skill assets.

## Surface Scope

This design intentionally covers only:

- ACP
- A2A

`sidecar` is explicitly excluded. The project no longer intends to evolve it, so adding it to the registry would increase complexity without durable value.

## Projection Rules

### ACP Projection

ACP should only project:

- entries with `surfaces.acp === true`
- `reachability === 'reachable'`
- `kind === 'flow_mode'`

These become the ACP mode list.

`local_skill` and `workflow` entries are not ACP modes by default.

### A2A Projection

A2A should project:

- entries with `surfaces.a2a === true`
- `reachability === 'reachable'`

These become `AgentCard.skills`.

Current practical consequence:

- `autopilot` is reachable and exposed
- broader flow-backed A2A skills may remain `latent` until there is a standards-backed runtime selection path

## Initial Registry Population

The first iteration should stay narrow:

- register `autopilot` as a reachable `flow_mode`
- allow ACP to continue exposing multiple reachable flow modes only where runtime wiring already exists
- keep A2A public exposure conservative
- do not auto-register local `Agent Skills`

This preserves current protocol honesty while creating the structure needed for future expansion.

## Recommended Code Shape

Add a new module family:

- `src/core/public-capabilities/types.ts`
- `src/core/public-capabilities/registry.ts`
- `src/core/public-capabilities/projections.ts`

Responsibilities:

- `types.ts`
  - model definitions only
- `registry.ts`
  - canonical static registry construction
- `projections.ts`
  - surface-specific selection and projection helpers

Suggested initial helpers:

- `buildPublicCapabilityRegistry()`
- `selectPublicCapabilitiesForSurface(surface)`
- `toA2APublicSkills(...)`
- `toAcpPublicModes(...)`

## Integration Plan

### `serve.ts`

Replace hand-written protocol exposure lists with registry projections.

### `agent-card.ts`

Reduce it to a formatter/builder over already-selected public A2A capabilities. It should stop defaulting to “all flow-backed skills”.

### `formal-agent.ts`

Replace protocol mode exposure list construction with ACP projection from registry, limited to reachable `flow_mode` entries.

## Compatibility Strategy

### ACP

Keep compatibility behavior such as `_salmonloop_mode` while moving the public mode list itself to registry-backed projection. This allows protocol surface cleanup later without reworking the list source again.

### A2A

Continue to expose only actually reachable skills. Keep deeper executor seams available for future standards-compliant runtime selection, but do not advertise latent capability prematurely.

### Local Skills

Do not auto-expose any local `Agent Skills` yet. Only prepare the bridge shape.

## Risks

### Risk: Registry Drift

If registry entries are not tied to real runtime reachability, the new layer fails its purpose.

Mitigation:

- make `reachability` explicit
- projection filters must exclude non-reachable entries by default
- add serve-level wiring tests that validate exposed capability lists directly

### Risk: Helper Footguns

If helper APIs silently default to “all flow modes” or “all skills”, future callers will reintroduce misleading exposure.

Mitigation:

- projection inputs should be explicit
- formatter helpers should not invent default exposure lists

## Testing Strategy

1. Unit tests for registry entry construction
2. Unit tests for surface filtering and reachability filtering
3. Unit tests for ACP projection
4. Unit tests for A2A projection
5. Serve wiring tests that assert the final public capability lists for ACP and A2A
6. Regression tests preventing advertisement of latent capabilities

## Why This Is The Right Size

This design is intentionally narrower than a full “capability platform” rewrite and broader than an A2A-only patch.

It is:

- broader than a one-off A2A bridge because ACP and A2A are both public protocol faces
- narrower than a kernel refactor because execution profiles, permissions, tools, and runtime dispatch remain unchanged

That makes it the smallest design that can prevent another round of protocol exposure drift without forcing a wider architecture rewrite.
