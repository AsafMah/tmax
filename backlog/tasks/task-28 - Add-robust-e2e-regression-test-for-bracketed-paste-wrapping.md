---
id: TASK-28
title: Add robust e2e regression test for bracketed-paste wrapping
status: To Do
assignee: []
created_date: '2026-04-26 19:33'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
tmax now wraps the clipboard payload in CSI 200~ / 201~ when the focused pane has bracketed paste enabled (?2004h, used by PSReadLine, Claude Code, Copilot CLI, bash readline). Issue-72/73 specs were updated to accept both raw and wrapped sizes, but a dedicated spec that asserts the wrap actually happens (vs only that paste fired exactly once) would be stronger. Tried Ctrl+V via Playwright keyboard.press and it didn't fire in offscreen e2e mode - need to either drive the paste via xterm's helper-textarea direct dispatchEvent, or extract the wrap logic to a pure function that can be unit-tested without launching Electron.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Spec asserts that with bracketed paste enabled, paste payload is wrapped in CSI 200~ / 201~
- [ ] #2 Spec asserts that with bracketed paste disabled, payload is sent raw
- [ ] #3 Spec passes deterministically in the full e2e suite
<!-- AC:END -->
