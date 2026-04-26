import { test, expect } from '@playwright/test';
import { launchTmax } from './fixtures/launch';

// Regression for the "double cursor" seen in Claude Code / Copilot CLI.
//
// Ink-based CLIs enable bracketed paste (CSI ?2004h) but never send DECTCEM
// (CSI ?25l) to hide the terminal's hardware cursor. tmax worked around
// that by echoing CSI ?25l back whenever it saw ?2004h. The original fix
// also flipped the cursor back on at ?2004l - which broke when a TUI
// toggled ?2004l mid-session while still in alt-screen, leaving two
// cursors on screen.
//
// The fix also tracks alt-screen (?1049) and keeps the cursor hidden while
// EITHER signal is on. It also defers the ?25l write until AFTER the PTY
// data has been applied, because xterm's cursor visibility is per-buffer.
// This test drives ?1049h -> ?2004h -> ?2004l into a real pwsh, then
// asserts xterm's internal isCursorHidden is still true.

test('cursor stays hidden while alt-screen is on, even if bracketed paste toggles off', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    // pwsh + profile load can take ~900ms on this repo
    await window.waitForTimeout(2500);

    await window.click('.terminal-panel .xterm-screen');
    await window.waitForTimeout(300);

    const focusedId = await window.evaluate(
      () => (window as any).__terminalStore.getState().focusedTerminalId as string,
    );

    // PowerShell one-liner that emits the problematic byte sequence.
    // `e is ESC in PowerShell. Trailing sentinel lets us wait for the
    // command to actually flush before sampling xterm state.
    const cmd = '[Console]::Write("`e[?1049h`e[?2004h`e[?2004lESC_DONE_")';
    await window.evaluate(
      ({ id, c }: { id: string; c: string }) =>
        (window as any).terminalAPI.writePty(id, c + '\r'),
      { id: focusedId, c: cmd },
    );

    await window.waitForFunction(
      () => {
        const id = (window as any).__terminalStore.getState().focusedTerminalId;
        const entry = (window as any).__getTerminalEntry?.(id);
        if (!entry) return false;
        const buf = entry.terminal.buffer.active;
        for (let y = 0; y < buf.length; y++) {
          const line = buf.getLine(y)?.translateToString(true) ?? '';
          if (line.includes('ESC_DONE_')) return true;
        }
        return false;
      },
      null,
      { timeout: 10_000 },
    );
    await window.waitForTimeout(150);

    const state = await window.evaluate(() => {
      const id = (window as any).__terminalStore.getState().focusedTerminalId;
      const entry = (window as any).__getTerminalEntry(id);
      const term = entry.terminal;
      const core = (term as any)._core;
      // Minifier sometimes strips the leading underscore; try both paths.
      const svc = core?.coreService ?? core?._coreService;
      const buffers = core?.buffers ?? core?._bufferService?.buffers;
      return {
        isCursorHidden: !!svc?.isCursorHidden,
        bracketedPaste: !!term.modes.bracketedPasteMode,
        isInAltBuffer: !!buffers && buffers.active === buffers.alt,
      };
    });

    expect(state.bracketedPaste).toBe(false);
    expect(state.isInAltBuffer).toBe(true);
    expect(state.isCursorHidden).toBe(true);
  } finally {
    await close();
  }
});

test('cursor stays hidden when a TUI sends ?25h while alt-screen is on', async () => {
  // Repro for: Claude Code / Copilot CLI enter alt-screen + bracketed paste,
  // then later send ?25h to draw their own cursor in the input field. The
  // earlier fix only re-hid the cursor when the chunk also contained ?2004
  // or ?1049 - so a bare ?25h slipped past and we ended up with two cursors.
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(2500);

    await window.click('.terminal-panel .xterm-screen');
    await window.waitForTimeout(300);

    const focusedId = await window.evaluate(
      () => (window as any).__terminalStore.getState().focusedTerminalId as string,
    );

    // Step 1: enter alt-screen + bracketed paste (TUI startup), expect hidden.
    const setup = '[Console]::Write("`e[?1049h`e[?2004hSETUP_DONE_")';
    await window.evaluate(
      ({ id, c }: { id: string; c: string }) =>
        (window as any).terminalAPI.writePty(id, c + '\r'),
      { id: focusedId, c: setup },
    );
    await window.waitForFunction(
      () => {
        const id = (window as any).__terminalStore.getState().focusedTerminalId;
        const entry = (window as any).__getTerminalEntry?.(id);
        if (!entry) return false;
        const buf = entry.terminal.buffer.active;
        for (let y = 0; y < buf.length; y++) {
          if ((buf.getLine(y)?.translateToString(true) ?? '').includes('SETUP_DONE_')) return true;
        }
        return false;
      },
      null, { timeout: 10_000 },
    );
    await window.waitForTimeout(150);

    // Step 2: send a bare ?25h, no ?2004/?1049 in the same chunk. Mirrors
    // what Ink-based CLIs do when they render their own input cursor.
    const showCursor = '[Console]::Write("`e[?25hCURSOR_SHOW_DONE_")';
    await window.evaluate(
      ({ id, c }: { id: string; c: string }) =>
        (window as any).terminalAPI.writePty(id, c + '\r'),
      { id: focusedId, c: showCursor },
    );
    await window.waitForFunction(
      () => {
        const id = (window as any).__terminalStore.getState().focusedTerminalId;
        const entry = (window as any).__getTerminalEntry?.(id);
        if (!entry) return false;
        const buf = entry.terminal.buffer.active;
        for (let y = 0; y < buf.length; y++) {
          if ((buf.getLine(y)?.translateToString(true) ?? '').includes('CURSOR_SHOW_DONE_')) return true;
        }
        return false;
      },
      null, { timeout: 10_000 },
    );
    await window.waitForTimeout(150);

    const state = await window.evaluate(() => {
      const id = (window as any).__terminalStore.getState().focusedTerminalId;
      const entry = (window as any).__getTerminalEntry(id);
      const term = entry.terminal;
      const core = (term as any)._core;
      const svc = core?.coreService ?? core?._coreService;
      const buffers = core?.buffers ?? core?._bufferService?.buffers;
      return {
        isCursorHidden: !!svc?.isCursorHidden,
        isInAltBuffer: !!buffers && buffers.active === buffers.alt,
      };
    });

    // Even though the TUI just sent ?25h, our re-hide should have undone it.
    expect(state.isInAltBuffer).toBe(true);
    expect(state.isCursorHidden).toBe(true);
  } finally {
    await close();
  }
});
