# TUI Security Protocols: High-Risk Intercepts

## 1. Overview
Destructive operations (e.g., repository restoration, clearing history) must be intercepted at the UI level using a **Challenge-Response** mechanism.

## 2. The 6-Char Hash Challenge
For `/snapshot restore <hash>`:
1. **Trigger**: The command returns a `NEED_CONFIRMATION` signal.
2. **Intercept**: The UI locks the input field and enters `Confirmation Mode`.
3. **Challenge**: The user must physically type the first **6 characters** of the target snapshot hash.
4. **Validation**: Execution is strictly blocked until the input string matches the challenge.

## 3. Mandatory Safety Closures
Before any destructive physical write (restore):
- **Auto-Backup**: The system must invoke `CheckpointManager.createSafeSnapshot` with the prefix `[AUTO-BACKUP]`.
- **Atomic Execution**: If backup fails, the restoration must abort.

## 4. State Management
All confirmation states are managed via `pendingConfirmation` in the UI Store and rendered within the **Omni-Tray**.
- Use `SET_CONFIRMATION` to lock UI and activate Omni-Tray challenge mode.
- Use `CLEAR_CONFIRMATION` on success, error, or ESC keypress to reset the Omni-Tray.
