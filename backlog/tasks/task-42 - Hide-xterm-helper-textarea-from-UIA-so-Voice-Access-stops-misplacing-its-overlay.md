---
id: TASK-42
title: >-
  Hide xterm helper textarea from UIA so Voice Access stops misplacing its
  overlay
status: In Progress
assignee: []
created_date: '2026-04-30 06:59'
updated_date: '2026-04-30 06:59'
labels: []
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In tmax (xterm.js), Windows Voice Access shows its dictation preview overlay anchored to xterm's hidden helper textarea, which marches off the right edge of the pane and lands on the wrong line. Windows Terminal doesn't expose a UIA text field, so it commits straight in with no overlay. Mark the helper textarea aria-hidden=true (and role=presentation) so Voice Access treats tmax like Windows Terminal: dictated text just types straight into the prompt with no misplaced floating preview.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Right after term.open(), the xterm helper textarea has aria-hidden=true and role=presentation set
- [ ] #2 Reapplied if xterm rerenders / replaces the textarea (set on focus too as a safety net)
- [ ] #3 Smoke test with Windows Voice Access: dictated text types into the input with no floating preview overlay (matches Windows Terminal behavior)
- [ ] #4 Regular keyboard typing, copy/paste, and IME composition still work
<!-- AC:END -->
