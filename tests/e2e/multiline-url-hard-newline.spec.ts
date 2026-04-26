import { test, expect, Page } from '@playwright/test';
import { launchTmax } from './fixtures/launch';

/**
 * Reproduces the case the user hit with `gh auth login`-style output: a long
 * URL that some upstream tool has split across rows with HARD newlines
 * (\r\n) instead of relying on the terminal's soft-wrap. Our existing
 * provider in TerminalPanel.tsx only stitches lines via xterm's `isWrapped`
 * flag, so hard-newlined URLs only get the first row hyperlinked.
 *
 * When this test fails, the bug is reproduced. When the provider learns to
 * stitch URL-shaped fragments across hard newlines, this should pass.
 */

async function writeToTerminal(window: Page, text: string): Promise<void> {
  await window.evaluate((t: string) => {
    const id = (window as any).__terminalStore.getState().focusedTerminalId;
    const entry = (window as any).__getTerminalEntry(id);
    entry?.terminal.write(t);
  }, text);
}

async function getLinksViaProvider(window: Page, row: number): Promise<any> {
  return window.evaluate(async (r: number) => {
    const id = (window as any).__terminalStore.getState().focusedTerminalId;
    const entry = (window as any).__getTerminalEntry(id);
    if (!entry) return { error: 'no entry' };
    const term = entry.terminal;
    const core = (term as any)._core;
    const service = core?._linkProviderService;
    if (!service) return { error: 'no service' };
    const providers = service.linkProviders || service._linkProviders;
    if (!providers) return { error: 'no providers' };

    const results: any[] = [];
    for (const p of providers) {
      await new Promise<void>((resolve) => {
        try {
          p.provideLinks(r, (links: any) => {
            if (links) {
              for (const l of links) {
                results.push({ text: l.text, startY: l.range?.start?.y, endY: l.range?.end?.y });
              }
            }
            resolve();
          });
        } catch (e: any) {
          results.push({ error: String(e) });
          resolve();
        }
      });
    }
    return { results };
  }, row);
}

async function summarizeRows(window: Page, max: number): Promise<string> {
  return window.evaluate((m: number) => {
    const id = (window as any).__terminalStore.getState().focusedTerminalId;
    const entry = (window as any).__getTerminalEntry(id);
    if (!entry) return '';
    const buf = entry.terminal.buffer.active;
    const out: string[] = [];
    for (let y = 0; y <= m && y < buf.length; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      out.push(`y=${y} wrapped=${line.isWrapped} text=${JSON.stringify(line.translateToString(true).slice(0, 100))}`);
    }
    return out.join('\n');
  }, max);
}

test('a URL hard-split across rows by upstream output (gh-style) is detected on every row it occupies', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(800);

    // Mimic the screenshot: a github SSO URL that the upstream tool decided to
    // hard-newline at a certain width. Three logical lines, no isWrapped.
    const segs = [
      'https://github.com/enterprises/microsoft/sso?authorization_request=A42LHL6C3YUGMB6AZ7S',
      'OB03J5URWHA5PN5ZGOYLONF5GC5DJN5XF62LEZYDGHOG3VVRXEZLEMVXHI2LBNRPWSZGOZDTEIFVPMNZGKZDFN',
      'Z2GSYML52HS4DFVNHWC5LUNBAWGY3FONZQ',
    ];
    const fullUrl = segs.join('');
    await writeToTerminal(window, '\r\n' + segs.join('\r\n') + '\r\n');
    await window.waitForTimeout(400);

    console.log('buffer rows:\n' + (await summarizeRows(window, 12)));

    // Probe each row for links and look for the full URL.
    const allRows: Record<number, any> = {};
    for (let y = 1; y <= 10; y++) allRows[y] = await getLinksViaProvider(window, y);
    console.log('per-row links:');
    for (const y of Object.keys(allRows)) {
      const results = allRows[+y].results || [];
      console.log(`  row ${y}:`, JSON.stringify(results.map((l: any) => ({ textLen: l.text?.length, startY: l.startY, endY: l.endY }))));
    }

    // Find every row that detects the FULL URL (all segments stitched).
    const rowsDetectingFull: number[] = [];
    for (const y of Object.keys(allRows)) {
      const results = allRows[+y].results || [];
      if (results.some((l: any) => l.text === fullUrl)) rowsDetectingFull.push(+y);
    }
    console.log('rows detecting full URL:', rowsDetectingFull);

    // The bug: only the first row is detected. The fix should make every row
    // the URL visually occupies detect the same full URL.
    expect(rowsDetectingFull.length).toBeGreaterThanOrEqual(3);
  } finally {
    await close();
  }
});
