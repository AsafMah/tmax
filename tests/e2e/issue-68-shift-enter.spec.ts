import { test, expect, Page } from '@playwright/test';
import { launchTmax } from './fixtures/launch';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function readDiagLog(userDataDir: string): string {
  const path = join(userDataDir, 'tmax-diag.log');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function findPtyWritesSince(log: string, marker: string): string[] {
  const idx = log.lastIndexOf(marker);
  const tail = idx >= 0 ? log.slice(idx) : log;
  return tail.split(/\r?\n/).filter((l) => l.includes(' pty:write '));
}

async function logMarker(window: Page, marker: string): Promise<void> {
  await window.evaluate((m: string) => (window as any).terminalAPI.diagLog(m), marker);
}

test('Shift+Enter sends a multi-line-newline sequence (not plain CR) so apps can insert a newline (#68)', async () => {
  const { window, userDataDir, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(800);

    await window.click('.terminal-panel .xterm-screen');
    await window.waitForTimeout(200);

    const marker = `e2e:shift-enter:${Date.now()}`;
    await logMarker(window, marker);
    await window.waitForTimeout(100);

    await window.keyboard.press('Shift+Enter');
    await window.waitForTimeout(500);

    const log = readDiagLog(userDataDir);
    const writes = findPtyWritesSince(log, marker);
    console.log('pty:write lines after Shift+Enter:');
    for (const l of writes) console.log('  ', l);

    // Concatenate all preview bytes
    const previews = writes.map((l) => {
      const m = l.match(/preview":"([^"]*)"/);
      return m ? m[1] : '';
    });
    const combined = previews.join('');
    console.log('combined preview:', JSON.stringify(combined));

    // The fix: Shift+Enter sends ESC+CR which Claude Code & Copilot CLI's
    // Ink-based input parsers interpret as Meta+Enter → insert newline.
    // Their parsers set `meta=true` when the raw byte sequence begins with \x1B.
    // A plain \x0d (CR) by itself would be treated as "submit" and is the bug.
    expect(combined).toContain('\\\\x1b\\\\x0d');
    expect(combined).not.toBe('\\\\x0d');
  } finally {
    await close();
  }
});
