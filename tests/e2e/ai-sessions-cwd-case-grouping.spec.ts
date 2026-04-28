import { test, expect } from '@playwright/test';
import { launchTmax } from './fixtures/launch';

// TASK-35 repro: the AI sessions sidebar groups by `shortPath(cwd)` returned
// as-is from CopilotPanel.tsx:45-48, with no case normalization. The CSS
// uppercases the header label, so two cwds that differ only in case
// (e.g. C:\projects\ClawPilot vs C:\projects\clawpilot) become two distinct
// Map keys at the bucket step but render with identical-looking headers -
// the user sees "two CLAWPILOT groups" in the sidebar.
//
// On Windows the filesystem is case-insensitive so these refer to the
// SAME folder; the duplication is purely a grouping bug.

const FIXTURE_CWD_UPPER = 'C:\\__cwdcase__\\ProjA';
const FIXTURE_CWD_LOWER = 'C:\\__cwdcase__\\proja';

test('cwds differing only in case collapse into a single group (TASK-35)', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(500);

    // Open the AI sessions panel and let initial load IPC settle so our
    // fixture setState isn't stomped by a delayed full-replace.
    await window.evaluate(() => {
      (window as any).__terminalStore.setState({ showCopilotPanel: true });
      (window as any).__terminalStore.getState().updateConfig?.({ aiGroupByRepo: true });
    });
    await window.waitForSelector('.dir-panel-list', { timeout: 5_000 });
    await window.waitForTimeout(800);

    // Wipe loaded sessions and inject two fixtures whose cwds differ only
    // in case. Both have summary text we can find in the DOM.
    await window.evaluate(({ cwdU, cwdL }) => {
      const store = (window as any).__terminalStore;
      const now = Date.now();
      store.setState({
        copilotSessions: [],
        claudeCodeSessions: [
          { id: 'sess-cwdcase-A', provider: 'claude-code', status: 'waitingForUser',
            cwd: cwdU, branch: 'main', repository: 'fixture',
            summary: 'CWDCASE-A-fixture', messageCount: 1, toolCallCount: 0, lastActivityTime: now },
          { id: 'sess-cwdcase-B', provider: 'claude-code', status: 'waitingForUser',
            cwd: cwdL, branch: 'main', repository: 'fixture',
            summary: 'CWDCASE-B-fixture', messageCount: 1, toolCallCount: 0, lastActivityTime: now - 1000 },
        ],
      });
    }, { cwdU: FIXTURE_CWD_UPPER, cwdL: FIXTURE_CWD_LOWER });
    await window.waitForTimeout(300);

    // Expand any auto-collapsed groups so we can also verify both sessions
    // landed in the same bucket (the count badge alone is enough, but we
    // assert via the rendered group-header count too).
    await window.evaluate(() => {
      const store = (window as any).__terminalStore;
      // Force-clear collapsed groups via the panel re-render path: nothing
      // exposed for that, so just click each header. We do that via DOM
      // below if needed - here we just read.
      void store;
    });

    // Find headers whose name (case-insensitive, trimmed) matches one of
    // our fixture folders. Both fixtures share the same folder name
    // visually ("proja" / "ProjA") - the bug is that two headers exist.
    const result = await window.evaluate(() => {
      const headers = [...document.querySelectorAll('.ai-session-group-header')] as HTMLElement[];
      return headers
        .map((h) => {
          const name = (h.querySelector('.ai-session-group-name')?.textContent || '').trim();
          const count = parseInt((h.querySelector('.ai-session-group-count')?.textContent || '0').trim(), 10);
          return { name, count };
        })
        .filter((h) => h.name.toLowerCase() === 'proja');
    });

    // The fix should produce exactly ONE group containing both fixture
    // sessions. Pre-fix: two groups, each with count 1.
    expect(result.length).toBe(1);
    expect(result[0].count).toBe(2);
  } finally {
    await close();
  }
});
