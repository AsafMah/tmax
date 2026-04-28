---
id: TASK-33
title: tmax copy inserts hard newlines at visual wrap points
status: To Do
assignee: []
created_date: '2026-04-28 10:12'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the user selects multi-line text in a tmax terminal pane and copies it (Ctrl+C with selection or selection-on-Enter), wrapped lines come out of the clipboard with literal 
 inserted at the visual wrap column. The user noticed this when pasting a JS snippet from a tmax pane into Chrome DevTools - a single-line "Allow rebinding" string was rendered as "Allow" on row N and "rebinding" on row N+1 (because the line exceeded terminal width), and the paste produced "Al
low rebinding".

xterm.js's default copy behavior is supposed to join wrap-continuation rows back into the original logical line; we may have buffer reflow disabled, an addon stripping the wrap metadata, or a custom getSelection path that walks visual rows. Worth checking term.options.disableStdin, term.buffer.active.getLine().isWrapped, and any custom copy handlers.\n\nUser-visible symptom: pasted commands break, pasted URLs split, pasted code introduces SyntaxError. Aside from the obvious "wrong content" annoyance, this is an active footgun for any user who copies multi-line content out of tmax.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Selecting and copying a single logical line that visually wraps yields a clipboard payload with no embedded \n
- [ ] #2 Selecting and copying multiple real lines (with hard newlines from the shell) preserves those newlines correctly
- [ ] #3 Works in both main and detached terminal windows
- [ ] #4 Repro: paste a long string into Claude Code, select it, copy, paste into a different app - clipboard content matches the original logical text
<!-- AC:END -->
