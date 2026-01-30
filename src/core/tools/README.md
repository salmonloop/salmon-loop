# Tools (Internal)

This directory contains the tool-calling subsystem:
- Tool specifications (ToolSpec)
- Policy gating (what tools are allowed in which phase)
- Budget/concurrency guards
- Audit logging
- Provider mapping (e.g., OpenAI tools format)

## Why This Exists

Tool execution is a high-risk side-effect surface. SalmonLoop routes all tool calls through a single gate
to enforce security constraints and auditing.

See `docs/design/tool-governance.md` for the public contract.

