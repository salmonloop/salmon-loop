# Security

## Threat Model (Summary)

SalmonLoop can modify user repositories, so the primary security goal is preventing unintended data loss or unsafe side effects.

Key concerns:
- Applying partial diffs as full-file overwrites (data loss).
- Running untrusted tool commands (confused deputy).
- Mutating user workspaces without an explicit safety anchor.

## Reporting

This repository does not yet publish a formal security policy.
If you discover a security issue, open a private report channel (to be defined) rather than a public issue.

