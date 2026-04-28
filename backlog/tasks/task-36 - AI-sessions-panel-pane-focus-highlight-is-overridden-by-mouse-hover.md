---
id: TASK-36
title: 'AI sessions panel: pane-focus highlight is overridden by mouse hover'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-04-28 10:54'
updated_date: '2026-04-28 10:57'
labels:
  - bug
  - ai-sessions
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two related symptoms reported via screenshots 2026-04-28:\n\n1. Clicking a terminal pane sometimes highlights the wrong session in the sidebar.\n2. When the correct session IS highlighted, moving the mouse over the list (without clicking) overrides the highlight to whichever row the cursor passes over.\n\nRoot cause (single bug, two visible symptoms): CopilotPanel.tsx 'selectedIndex' (line 135) is doing double duty - both as the 'reveal-on-pane-focus' target (set at line 403 from the focused-terminal effect) AND as the mouse hover state (overwritten by onMouseEnter at line 776). Hover stomps the pane-driven selection. Symptom #1 is just symptom #2 happening at click-time when the cursor is already over a row.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Clicking a terminal pane in the main grid highlights the matching AI session in the sidebar, regardless of where the mouse is at click time
- [ ] #2 Hovering over other rows in the sidebar does NOT change the active-session highlight
- [ ] #3 Hover provides its own visual affordance distinct from the active-session highlight (or no hover style at all if that's simpler)
- [ ] #4 Keyboard arrow navigation in the panel still works as before (j/k or up/down)
- [ ] #5 Playwright repro spec lands alongside the fix
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Repro test in tests/e2e/ai-sessions-pane-active-vs-hover.spec.ts: inject 2 sessions linked to 2 panes; focus pane A; hover the row of session B in the sidebar; assert the row classed as the "current pane session" remains A even while B is hovered.
2. Fix CopilotPanel.tsx: derive activePaneSessionId from focusedTerminalId via the existing terminals Map. Add CSS class `pane-active` to the row whose session.id === activePaneSessionId.
3. Add .ai-session-item.pane-active CSS rule with a distinct visual style (left border / subtle background) that is NOT shared with :hover or .selected, so hover cannot stomp it.
4. Keep the existing setSelectedIndex on pane-focus effect so keyboard Enter still opens the pane-focused row when nothing else is selected.
5. Run the new spec + the existing session-sidebar-highlight specs to confirm no regression.
<!-- SECTION:PLAN:END -->
