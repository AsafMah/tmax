import { test, expect, Page } from '@playwright/test';
import { launchTmax } from './fixtures/launch';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Regression: when a TUI enables SGR mouse reporting (CSI ?1006h + ?1000h),
// xterm.js forwards mouse events to the pty. A right-click then delivered
// BOTH to the app (which could treat it as paste) AND to tmax's own context
// menu handler, causing a visible double paste.
//
// tmax now blocks right-button mouse events in the capture phase so xterm.js
// never forwards them. Right-click becomes a pure tmax terminal action.

async function setClipboard(window: Page, text: string): Promise<void> {
  await window.evaluate((t: string) => (window as any).terminalAPI.clipboardWrite(t), text);
}

function readDiagLog(userDataDir: string): string {
  const path = join(userDataDir, 'tmax-diag.log');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

async function logMarker(window: Page, marker: string): Promise<void> {
  await window.evaluate((m: string) => (window as any).terminalAPI.diagLog(m), marker);
}

async function enableMouseReporting(window: Page): Promise<void> {
  // Write the DECSET sequences directly into xterm so its mode tracking flips
  // to "send mouse events to the pty". We don't need a real TUI running.
  await window.evaluate(() => {
    const id = (window as any).__terminalStore.getState().focusedTerminalId;
    const entry = (window as any).__getTerminalEntry(id);
    if (!entry) throw new Error('no terminal entry');
    // 1000 = basic mouse reporting, 1006 = SGR extended format
    entry.terminal.write('\x1b[?1000h\x1b[?1006h');
  });
}

test('right-click paste with SGR mouse reporting on writes payload once, no mouse passthrough', async () => {
  const { window, userDataDir, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(800);

    await enableMouseReporting(window);
    await window.waitForTimeout(200);

    const payload = 'DOUBLE_PASTE_REGRESSION';
    await setClipboard(window, payload);
    await window.waitForTimeout(200);

    // Focus the terminal first
    await window.click('.terminal-panel .xterm-screen');
    await window.waitForTimeout(200);

    const marker = `e2e:dpm:${Date.now()}`;
    await logMarker(window, marker);
    await window.waitForTimeout(100);

    // Right-click
    await window.click('.terminal-panel .xterm-screen', { button: 'right' });
    await window.waitForTimeout(600);

    const log = readDiagLog(userDataDir);
    const sinceMarker = log.slice(log.lastIndexOf(marker));
    const writeLines = sinceMarker.split('\n').filter((l) => l.includes(' pty:write '));

    // 1) Exactly one pty:write matching the paste payload length
    const pasteWrites = writeLines.filter((l) => {
      const m = l.match(/"bytes":(\d+)/);
      return m && parseInt(m[1], 10) === payload.length;
    });
    expect(pasteWrites.length).toBe(1);

    // 2) Zero SGR mouse writes for the right button (button code 2)
    // SGR format: \x1b[<2;col;row(M|m)
    const mouseWrites = writeLines.filter((l) => /\\x1b\[<2;/.test(l));
    if (mouseWrites.length > 0) {
      console.log('UNEXPECTED right-button mouse writes leaked to pty:');
      for (const line of mouseWrites) console.log('  ', line);
    }
    expect(mouseWrites.length).toBe(0);
  } finally {
    await close();
  }
});
