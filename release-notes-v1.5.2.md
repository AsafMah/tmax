## What's new in v1.5.2

### Features

- **Git worktree panel** - Manage git worktrees without leaving tmax. Press `Ctrl+Shift+T` or click the Worktrees button in the footer. Browse repos from your favorites and recents, see each worktree's branch + creation date, create new worktrees from a base branch, jump to a worktree's folder in your terminal or in tmax's file explorer. (#36)
- **Auto-highlight AI session on pane focus** - Click a terminal pane and its AI session selects in the sidebar. Switches lifecycle tabs automatically if needed. Still lets you browse freely. (#37)
- **Paste URL from HTML clipboard** - Copying a PR title from ADO or a hyperlink from a docs page now pastes the URL into the terminal instead of the plain text, so xterm turns it into a clickable link. Multi-link HTML still falls back to plain text. (#53)
- **Hide tab close buttons** - New Appearance setting to hide the ✕ on tabs so you don't accidentally close them when switching. Off by default. (#49)
- **Report Issue** and **Open Diagnostics Log** - now available from the command palette and status bar.
- **Updated landing page** - Redesigned with a "When to reach for tmax" section covering parallel AI sessions, comparing model outputs, and long-running agent monitoring. New favicon, tighter hero, updated gallery.

### Bug Fixes

- **Duplicate cursors** intermittent bug - fixed cursor race on focus transitions. (#41)
- **Shift+Arrow** focus shortcut - keyboard input now correctly follows the visual focus when switching panes. (#44)
- **Scrolling** in multi-pane layouts - fixed ghost wheel listeners that blocked scroll in some panes. Scroll area now syncs after every fit. (#48)
- **Pane focus loss** after closing or splitting - surviving terminals remain clickable. (#50)
- **Session lifecycle persistence** - completed/old/renamed states now survive app restart. Previously they'd revert to active. (#37)
- **Session auto-reactivation** - completed sessions no longer flip back to active because of activity in other terminal apps. (#51)
- **macOS Cmd+Shift+N crash** when opening a new terminal in a specific directory. (#37)
- **macOS DMG packaging** - fixed "Cannot find module 'node-pty'" by correcting the `.app` bundle copy path and chmod'ing prebuilt binaries. (#47)
- **Clipboard temp directory cleanup** - stale `tmax-clipboard-*` folders are swept from the OS temp directory on startup. Older sessions no longer leak dozens of dirs.
- **Font size persistence** - `Ctrl+=`/`Ctrl+-` zoom now saves to config and survives restart. (#43)
- **Hydration guard** - prevents a race on startup where `saveSession` could overwrite persisted session state before it was loaded. (#43)
- **Screen lock** - ConPTY stays alive across Windows lock/unlock via periodic resize pings.
- **Performance** - CSS containment on terminal panels and faster resize debounce (100ms -> 30ms) for snappier splits. Grayscale font antialiasing for crisper text on HiDPI displays. (#38)
- **Shift+Enter** inserts a newline in Claude Code and Copilot (Windows uses `win32-input-mode`).

### Contributors

Thanks to everyone who contributed:

- @omer91se - session persistence, pane stability fixes, perf improvements, macOS packaging
- @m-tantan - git worktree panel feature, tab close buttons toggle
- @yoziv - HTML clipboard paste feature

**Full Changelog**: https://github.com/InbarR/tmax/compare/v1.5.1...v1.5.2
