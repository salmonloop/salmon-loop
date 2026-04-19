## 2023-11-09 - Added Keyboard Navigation Hints to Intercept Screens
**Learning:** Users lack discoverability for interaction in multi-select or single-select command line interfaces (like `ink` and `ink-text-input`). Providing explicit keyboard hints below selection lists drastically improves usability, especially for complex selections requiring Space/Enter to toggle/confirm.
**Action:** Always append subtle navigation helper text (`↑↓ nav · space toggle · ⏎ confirm · esc cancel`) to contextual overlay interfaces.
