import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launchTmax } from './fixtures/launch';

// Regression guard: tmax injects an OSC 7 cwd-reporter into every pwsh session.
// The old implementation wrote the full multi-line snippet to the PTY, which
// pwsh echoed before its profile was ready, leaving the snippet visible. The
// fix dot-sources a pre-written .ps1 file. If anyone reverts to inline
// injection these assertions fail.

test.describe('pwsh shell-integration does not leak into the terminal buffer', () => {
  test.skip(process.platform !== 'win32', 'Windows-only (pwsh integration only runs on Windows)');

  test('integration script is written to tmpdir at app launch', async () => {
    const { close } = await launchTmax();
    try {
      const expectedPath = join(tmpdir(), 'tmax-pwsh-integration.ps1');
      expect(existsSync(expectedPath)).toBe(true);
    } finally {
      await close();
    }
  });

  test('a fresh pwsh terminal does not show the prompt-wrapper snippet', async () => {
    const { window, close } = await launchTmax();
    try {
      await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
      // Give pwsh time to start, run profile, receive injection, and clear
      await window.waitForTimeout(4_000);

      const visible = await window.evaluate(() => {
        const id = (window as any).__terminalStore.getState().focusedTerminalId;
        const entry = (window as any).__getTerminalEntry(id);
        if (!entry) return '';
        const term = entry.terminal;
        const buf = term.buffer.active;
        const lines: string[] = [];
        for (let y = 0; y < buf.length; y++) {
          const line = buf.getLine(y);
          if (line) lines.push(line.translateToString(true));
        }
        return lines.join('\n');
      });

      // Distinctive fragments of the old inline injection. If any of these
      // show up in the buffer, the injection is leaking again.
      expect(visible).not.toContain('$__tmax_origPrompt');
      expect(visible).not.toContain('$function:prompt');
      expect(visible).not.toContain('SessionState.Path.CurrentLocation');
    } finally {
      await close();
    }
  });
});
