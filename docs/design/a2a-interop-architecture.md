# A2A / Interop Architecture Design

Date: 2026-02-28
Status: Approved

## Summary

This design does not treat A2A as a one-off integration. Instead, it introduces a general interaction and protocol substrate that can support:

- A2A as the first standards-based protocol adapter
- Future protocol adapters such as ACP
- Future interface adapters such as CLI, VS Code, web, native client, and Roo

The design goal is architectural cleanliness, protocol correctness, and long-term extensibility. A2A should be the first protocol adapter on top of a stable canonical task/event model, not the center of the system.

## Goals

- Expose Salmon-Loop as a public, standards-aligned A2A service
- Support both A2A server and A2A client roles
- Keep protocol semantics separate from transport mechanics
- Keep protocol/interface adapters separate from execution orchestration
- Reuse the existing Grizzco transaction and pipeline kernel where it is a natural fit
- Preserve a clean extension path for ACP, VS Code, web, native, and other adapters
- Make the core model tenant-aware, while only enabling single-tenant deployment in the first release
- Define a unified auth abstraction, while implementing Bearer/API key first and reserving room for OAuth2/OIDC

## Non-Goals

- Replacing MCP with A2A
- Forcing A2A into the existing tool/MCP extension layer
- Building every future adapter now
- Shipping all A2A bindings on day one
- Enabling full multi-tenant operations in the first release

## External Constraints

Based on the A2A specification and guides reviewed on 2026-02-28:

- Public discovery should expose `/.well-known/agent-card.json`
- Standard HTTP streaming for A2A is still SSE
- A2A also defines gRPC and HTTP+JSON/REST bindings
- Custom bindings are allowed, but not the baseline target for v1
- A2A is agent-to-agent, while MCP is model-to-tool; they are complementary

These constraints imply that protocol semantics, transport bindings, and execution orchestration must remain separate.

## Architectural Decision

Adopt an interop-first architecture:

- A shared canonical interaction layer represents tasks, capabilities, events, artifacts, auth, and tenancy
- A2A is implemented as the first protocol adapter
- CLI, Roo, and future clients become interface adapters over the same substrate
- Grizzco remains the orchestration kernel for task execution, retries, attempt control, and stage transitions

This is preferred over:

1. A thin A2A facade over the CLI or `runSalmonLoop()`
2. Treating A2A as just another entry inside the MCP/tool extension system

Both alternatives would create long-term conceptual leakage and make future protocol growth harder.

## Layered Architecture

### 1. Execution Core

The existing Salmon-Loop execution engine remains the source of truth for patch/review/debug/verify behavior.

Responsibilities:

- Execute real code tasks
- Preserve workspace safety guarantees
- Produce internal execution events and audit signals

This layer should not know about A2A, ACP, CLI, SSE, Agent Cards, or VS Code.

### 2. Task Orchestration Core

This is the shared runtime facade that all external adapters call into.

Responsibilities:

- Create, resume, cancel, and inspect canonical tasks
- Drive lifecycle transitions
- Maintain idempotency boundaries
- Coordinate retries and terminal outcome mapping
- Publish canonical task events and artifacts

This layer should reuse Grizzco transaction and pipeline machinery.

### 3. Interaction Canonical Model

This layer defines protocol-agnostic interaction objects. It should not copy A2A naming blindly.

Recommended canonical objects:

- `AgentDescriptor`
- `CapabilityDescriptor`
- `TaskEnvelope`
- `TaskState`
- `TaskEvent`
- `ArtifactDescriptor`
- `ConversationContext`
- `AuthContext`
- `TenantContext`
- `PolicyDecision`
- `InteractionRequest`
- `InteractionResponseProjection`

Mapping examples:

- A2A `AgentCard` -> `AgentDescriptor`
- A2A `skill` -> `CapabilityDescriptor`
- A2A `Task` -> `TaskEnvelope`
- A2A task/artifact/status updates -> `TaskEvent`

### 4. Protocol Adapters

Protocol adapters translate between protocol-specific wire/domain objects and the canonical interaction model.

Initial target:

- `A2A server adapter`
- `A2A client adapter`

Future targets:

- `ACP adapter`
- other protocol adapters

Responsibilities:

- Validate protocol payloads
- Map protocol objects to canonical objects
- Map canonical task outcomes/events back to protocol responses
- Expose protocol-specific discovery and capability metadata

Protocol adapters must not own task state, retries, or execution logic.

### 5. Interface Adapters

Interface adapters represent product or host entry points that are not primarily protocol standards.

Targets:

- CLI
- VS Code extension
- Web client
- Native client
- Roo integration

Responsibilities:

- Host-specific UX and session behavior
- Request shaping into canonical task calls
- Rendering or projecting canonical events into host-specific views

Interface adapters should depend on the shared orchestration facade, not on protocol adapters.

### 6. Transport Adapters

Transport mechanics should be isolated from both protocol semantics and execution logic.

Targets:

- HTTP
- SSE
- WebSocket
- gRPC
- stdio
- local IPC

Responsibilities:

- Connection lifecycle
- framing and serialization
- streaming mechanics
- reconnect behavior and cursors where needed

Transport adapters must remain thin.

## Recommended Module Layout

Suggested long-term layout:

- `src/core/interaction/model/*`
- `src/core/interaction/orchestration/*`
- `src/core/interaction/events/*`
- `src/core/interaction/policy/*`
- `src/core/backends/salmon-loop/*`
- `src/core/protocols/a2a/*`
- `src/core/protocols/acp/*`
- `src/core/transports/*`
- `src/interfaces/cli/*`
- `src/interfaces/vscode/*`
- `src/interfaces/web/*`
- `src/interfaces/native/*`

The main architectural intent is:

- protocol adapters live under `src/core/protocols`
- interface adapters live under `src/interfaces`
- orchestration and canonical types stay under `src/core/interaction`

## Relationship To Existing CLI and Roo Adapters

There is meaningful overlap with the current CLI/headless architecture, but not enough to merge them directly with A2A.

Observed reusable foundations:

- shared execution entry through `runSalmonLoop()`
- shared event bus behavior
- an existing canonical streaming direction in `src/core/streaming/canonical/*`
- headless reporters already acting as output protocol adapters

Decision:

- do not merge CLI and A2A into one module
- do extract shared orchestration and canonical event infrastructure
- treat CLI, Roo, and A2A as separate adapters over the same substrate

## Grizzco Fit

### Use Grizzco For

- canonical task execution transactions
- mode-aware execution pipelines
- retry policy and attempt control
- terminal outcome mapping
- policy-driven backend selection
- other pure, auditable routing decisions

### Do Not Use Grizzco For

- A2A or ACP protocol wire objects
- HTTP/SSE/gRPC transport management
- host UX concerns
- protocol-specific discovery documents
- async connection/session plumbing

### DSL Boundary

The Grizzco DSL should stay limited to pure rule evaluation.

Good candidates:

- capability routing
- execution backend selection
- artifact publication policy
- redaction/visibility policy

Bad candidates:

- protocol method orchestration
- HTTP request handling
- streaming session control
- async protocol retries

## Canonical State Model

The canonical task lifecycle should be richer than a single synchronous run, because A2A and future adapters need pause, stream, cancel, and recovery semantics.

Suggested state families:

- `accepted`
- `running`
- `awaiting_input`
- `streaming`
- `completed`
- `failed`
- `cancelled`

The exact external projection can differ by adapter, but the canonical model should carry enough information to support:

- polling
- push/stream updates
- resumability
- cancellation
- artifact publication
- audit and observability

## Auth and Tenancy

### Auth

Use a unified auth abstraction:

- canonical `SecuritySchemeDescriptor`
- canonical `AuthContext`
- policy-driven authorization checks

First implementation:

- Bearer/API key

Reserved next-step implementations:

- OAuth2
- OIDC

### Tenancy

Make the canonical model tenant-aware, but keep the first release effectively single-tenant.

This means:

- include `tenantId` or equivalent in canonical contexts and policy boundaries
- keep storage and quota interfaces tenant-capable
- do not force multi-tenant operational complexity into the first shipping slice

## A2A v1 Scope

The first public A2A slice should be standards-first and intentionally narrow.

Recommended scope:

- `/.well-known/agent-card.json`
- JSON-RPC over HTTP(S)
- SSE streaming
- A2A server adapter
- A2A client adapter
- task submission
- task streaming
- task inspection
- task cancellation
- capability projection from canonical capabilities into A2A skill metadata
- Bearer/API key auth

Explicitly not required in v1:

- ACP
- REST binding
- gRPC binding
- OAuth2/OIDC implementation
- multi-tenant rollout
- every future interface adapter

## MVP Cut For Shared Infrastructure

The smallest clean foundation should include exactly four things:

1. `Canonical Task Facade`

- single entry for create/resume/cancel/get task
- shared by CLI, Roo, and A2A

2. `Canonical Event Bus`

- unify task lifecycle and streamable result events
- evolve from current `LoopEvent` and canonical streaming primitives

3. `Execution Bridge`

- route canonical tasks into the existing Salmon-Loop execution runtime
- map results back into canonical outcomes and artifacts

4. `A2A Adapter v1`

- discovery
- request/response mapping
- streaming projection via SSE
- auth integration

## Migration Strategy

### Phase 1

- Introduce canonical task and event model
- Build orchestration facade over existing execution runtime
- Keep CLI behavior unchanged externally

### Phase 2

- Refactor CLI/headless and Roo to use the orchestration facade
- Move reusable canonical streaming logic into the shared interaction layer

### Phase 3

- Add A2A server adapter and public discovery
- Add A2A client adapter

### Phase 4

- Add more interface adapters and protocol adapters as needed
- Only then consider ACP, WebSocket, gRPC, VS Code, web, and native clients

## Risks

- Over-generalizing too early and creating a fake abstraction
- Letting A2A naming dominate the canonical model
- Mixing transport and protocol semantics
- Pulling CLI UX concerns into the interaction core
- Expanding v1 to include too many bindings or adapters

## Success Criteria

- A2A can be added without distorting the MCP/tool architecture
- CLI, Roo, and future adapters can share one task/orchestration substrate
- Grizzco stays cleanly positioned as orchestration kernel, not protocol layer
- Future ACP or interface adapters can be added without renaming or breaking the core model
- The first public A2A surface is standards-aligned and operationally sane

## Final Recommendation

Build an interop-first substrate, not an A2A-only feature.

Use:

- canonical interaction model
- shared orchestration facade
- Grizzco as execution orchestration kernel
- A2A as the first protocol adapter

Do not:

- stuff A2A into the MCP/tool layer
- merge CLI and A2A directly
- let transport concerns leak into the canonical core

This is the cleanest path for A2A now and for ACP, VS Code, web, native, CLI, and Roo later.
