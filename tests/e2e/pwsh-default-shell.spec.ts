import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { launchTmax } from './fixtures/launch';

function pwshInstalled(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('where.exe', ['pwsh.exe'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const first = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
    if (first && existsSync(first) && !/\\WindowsApps\\/i.test(first)) return true;
  } catch { /* not on PATH */ }
  const candidates = [
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\PowerShell\\7\\pwsh.exe`,
    process.env.ProgramW6432 && `${process.env.ProgramW6432}\\PowerShell\\7\\pwsh.exe`,
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  ];
  return candidates.some((p) => p && existsSync(p));
}

test.describe('pwsh as default shell on Windows', () => {
  test.skip(process.platform !== 'win32', 'Windows-only');
  test.skip(!pwshInstalled(), 'PowerShell 7 not installed on this machine');

  test('defaultShellId is pwsh and its path points to a real pwsh.exe', async () => {
    const { window, close } = await launchTmax();
    try {
      await window.waitForFunction(
        () => !!((window as any).__terminalStore?.getState?.().config),
        null,
        { timeout: 15_000 },
      );

      const config = await window.evaluate(() => {
        const s = (window as any).__terminalStore.getState();
        return s.config;
      });

      expect(config).toBeTruthy();
      expect(config.defaultShellId).toBe('pwsh');

      const pwshProfile = config.shells.find((sh: any) => sh.id === 'pwsh');
      expect(pwshProfile).toBeTruthy();
      expect(pwshProfile.path.toLowerCase()).toContain('pwsh.exe');
      expect(existsSync(pwshProfile.path)).toBe(true);
    } finally {
      await close();
    }
  });
});
