import { test, expect, Page } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { launchTmax } from './fixtures/launch';

// Regression for GitHub issue #72: right-click paste in a DETACHED window.
//
// The main window's TerminalPanel.tsx handles right-click by reading the
// system clipboard and writing once to the PTY, and also blocks right-button
// mouse events in the capture phase so xterm.js can't forward SGR mouse
// events to a TUI that could paste on its own.
//
// DetachedApp.tsx originally had neither. Right-click in a detached window
// either did nothing useful (the reported symptom) or leaked into the TUI
// via mouse reporting, which ended up pasting twice (TUI paste + whatever
// else caught the event). After the fix, a right-click in a detached
// window writes the clipboard content exactly once.

function readDiagLog(userDataDir: string): string {
  const path = join(userDataDir, 'tmax-diag.log');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

async function logMarker(win: Page, marker: string): Promise<void> {
  await win.evaluate((m: string) => (window as any).terminalAPI.diagLog(m), marker);
}

test('right-click in a detached window pastes clipboard exactly once', async () => {
  const { app, window: mainWin, userDataDir, close } = await launchTmax();
  try {
    await mainWin.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await mainWin.waitForTimeout(1500);

    // Detach the focused terminal into its own Electron window.
    const terminalId = await mainWin.evaluate(async () => {
      const store = (window as any).__terminalStore.getState();
      const id = store.focusedTerminalId as string;
      await store.detachTerminal(id);
      return id;
    });
    expect(terminalId).toBeTruthy();

    // Detached window URL contains ?detachedTerminalId=<id>
    await mainWin.waitForTimeout(1000);
    const detachedWin = app.windows().find((w) => w.url().includes('detachedTerminalId'));
    expect(detachedWin, 'detached window should exist').toBeTruthy();
    await detachedWin!.waitForSelector('.xterm-screen', { timeout: 15_000 });
    await detachedWin!.waitForTimeout(800);

    const payload = 'DETACHED_PASTE_REGRESSION';
    await detachedWin!.evaluate(
      (p: string) => (window as any).terminalAPI.clipboardWrite(p),
      payload,
    );
    await detachedWin!.waitForTimeout(200);

    const marker = `e2e:dd:${Date.now()}`;
    await logMarker(detachedWin!, marker);
    await detachedWin!.waitForTimeout(100);

    // Right-click on the detached window's xterm-screen
    await detachedWin!.click('.xterm-screen', { button: 'right' });
    await detachedWin!.waitForTimeout(600);

    const log = readDiagLog(userDataDir);
    const sinceMarker = log.slice(log.lastIndexOf(marker));
    const writeLines = sinceMarker.split('\n').filter((l) => l.includes(' pty:write '));

    const pasteWrites = writeLines.filter((l) => {
      const m = l.match(/"bytes":(\d+)/);
      return m && parseInt(m[1], 10) === payload.length;
    });
    const rightMouseWrites = writeLines.filter((l) => /\\x1b\[<2;/.test(l));

    console.log('[detached right-click] pty:write lines since marker:');
    for (const line of writeLines.slice(0, 20)) console.log('  ', line);

    // Exactly one paste write. Zero would be the current symptom (#72);
    // >1 would be the "paste twice" variant the user reported.
    expect(pasteWrites.length).toBe(1);
    // No SGR right-button leaks either.
    expect(rightMouseWrites.length).toBe(0);
  } finally {
    await close();
  }
});
