import { test, expect, Page } from '@playwright/test';
import { launchTmax } from './fixtures/launch';

// TASK-37: bulk-archive sessions whose messageCount is below a threshold,
// skipping pinned sessions and any session that already has a manual
// lifecycle override. Pure store-action test - we don't drive the
// confirm/prompt UI from Playwright (those are window.prompt /
// window.confirm dialogs that can't be reached via DOM); we exercise
// the underlying cleanupLowPromptSessions / countLowPromptSessions
// actions directly.

interface Fixture {
  id: string;
  cwd: string;
  summary: string;
  messageCount: number;
  pinned?: boolean;
  override?: 'active' | 'completed' | 'old';
}

async function seedSessions(window: Page, fixtures: Fixture[]): Promise<void> {
  await window.evaluate((rows: Fixture[]) => {
    const store = (window as any).__terminalStore;
    const now = Date.now();
    const sessions = rows.map((r) => ({
      id: r.id,
      provider: 'claude-code',
      status: 'waitingForUser',
      cwd: r.cwd,
      branch: 'main',
      repository: 'fixture',
      summary: r.summary,
      messageCount: r.messageCount,
      toolCallCount: 0,
      lastActivityTime: now,
    }));
    const pinned: Record<string, true> = {};
    const overrides: Record<string, string> = {};
    for (const r of rows) {
      if (r.pinned) pinned[r.id] = true;
      if (r.override) overrides[r.id] = r.override;
    }
    store.setState({
      claudeCodeSessions: sessions,
      copilotSessions: [],
      sessionPinned: pinned,
      sessionLifecycleOverrides: overrides,
    });
  }, fixtures);
}

async function getLifecycle(window: Page, id: string): Promise<string | undefined> {
  return window.evaluate((sid) => {
    return (window as any).__terminalStore.getState().sessionLifecycleOverrides[sid];
  }, id);
}

test.describe('AI Sessions cleanup low-prompt sessions (TASK-37)', () => {
  test('archives only sessions below the threshold', async () => {
    const { window, close } = await launchTmax();
    try {
      await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
      await window.waitForTimeout(500);
      await window.evaluate(() => {
        (window as any).__terminalStore.setState({ showCopilotPanel: true });
      });
      await window.waitForSelector('.ai-session-item, .dir-panel-list', { timeout: 5_000 });
      await window.waitForTimeout(800);

      await seedSessions(window, [
        { id: 'low-1', cwd: 'C:\\__t37__\\a', summary: 'low-1', messageCount: 1 },
        { id: 'low-2', cwd: 'C:\\__t37__\\b', summary: 'low-2', messageCount: 4 },
        { id: 'edge-9', cwd: 'C:\\__t37__\\c', summary: 'edge-9', messageCount: 9 },
        { id: 'at-10', cwd: 'C:\\__t37__\\d', summary: 'at-10', messageCount: 10 },
        { id: 'high-50', cwd: 'C:\\__t37__\\e', summary: 'high-50', messageCount: 50 },
      ]);

      // Count first - should match the # below 10.
      const expectedCount = await window.evaluate(() => {
        return (window as any).__terminalStore.getState().countLowPromptSessions(10);
      });
      expect(expectedCount).toBe(3);

      // Apply.
      const archivedCount = await window.evaluate(() => {
        return (window as any).__terminalStore.getState().cleanupLowPromptSessions(10);
      });
      expect(archivedCount).toBe(3);

      // Verify which got the 'old' override.
      expect(await getLifecycle(window, 'low-1')).toBe('old');
      expect(await getLifecycle(window, 'low-2')).toBe('old');
      expect(await getLifecycle(window, 'edge-9')).toBe('old');
      expect(await getLifecycle(window, 'at-10')).toBeUndefined();
      expect(await getLifecycle(window, 'high-50')).toBeUndefined();
    } finally {
      await close();
    }
  });

  test('skips pinned sessions and existing lifecycle overrides', async () => {
    const { window, close } = await launchTmax();
    try {
      await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
      await window.waitForTimeout(500);
      await window.evaluate(() => {
        (window as any).__terminalStore.setState({ showCopilotPanel: true });
      });
      await window.waitForSelector('.ai-session-item, .dir-panel-list', { timeout: 5_000 });
      await window.waitForTimeout(800);

      await seedSessions(window, [
        // Pinned but below threshold - must NOT be archived.
        { id: 'pinned-low', cwd: 'C:\\__t37__\\a', summary: 'pinned-low', messageCount: 2, pinned: true },
        // Already has 'active' override (user un-archived) - must NOT be touched.
        { id: 'override-low', cwd: 'C:\\__t37__\\b', summary: 'override-low', messageCount: 2, override: 'active' },
        // Plain low - should be archived.
        { id: 'plain-low', cwd: 'C:\\__t37__\\c', summary: 'plain-low', messageCount: 2 },
      ]);

      const archived = await window.evaluate(() => {
        return (window as any).__terminalStore.getState().cleanupLowPromptSessions(10);
      });
      expect(archived).toBe(1);

      expect(await getLifecycle(window, 'pinned-low')).toBeUndefined();
      expect(await getLifecycle(window, 'override-low')).toBe('active');  // unchanged
      expect(await getLifecycle(window, 'plain-low')).toBe('old');
    } finally {
      await close();
    }
  });

  test('returns 0 and is a no-op when threshold is 0 or negative', async () => {
    const { window, close } = await launchTmax();
    try {
      await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
      await window.waitForTimeout(500);
      await window.evaluate(() => {
        (window as any).__terminalStore.setState({ showCopilotPanel: true });
      });
      await window.waitForSelector('.ai-session-item, .dir-panel-list', { timeout: 5_000 });
      await window.waitForTimeout(800);

      await seedSessions(window, [
        { id: 'a', cwd: 'C:\\__t37__\\a', summary: 'a', messageCount: 1 },
      ]);

      for (const bad of [0, -1, NaN]) {
        const n = await window.evaluate((t) => {
          return (window as any).__terminalStore.getState().cleanupLowPromptSessions(t);
        }, bad);
        expect(n).toBe(0);
        expect(await getLifecycle(window, 'a')).toBeUndefined();
      }
    } finally {
      await close();
    }
  });
});
