import { test, expect, Page } from '@playwright/test';
import { launchTmax } from './fixtures/launch';

// Regression for: "8 tabs, only 6 visible in grid" - some code path added a
// terminal to the terminals Map with mode='tiled' but didn't insert it into
// layout.tilingRoot, so the grid rendered fewer panes than there were tabs.
// The fix is a reconcileGridLayout action wired to a terminals-change effect
// in App.tsx. This test simulates the orphan state by trimming tilingRoot
// directly, then verifies the action heals the tree back to the full set.

async function treeLeafIds(window: Page): Promise<string[]> {
  return window.evaluate(() => {
    const root = (window as any).__terminalStore.getState().layout.tilingRoot;
    const out: string[] = [];
    const walk = (n: any) => {
      if (!n) return;
      if (n.kind === 'leaf') { out.push(n.terminalId); return; }
      if (n.kind === 'split') { walk(n.first); walk(n.second); }
    };
    walk(root);
    return out;
  });
}

async function tiledTerminalIds(window: Page): Promise<string[]> {
  return window.evaluate(() => {
    const terms = (window as any).__terminalStore.getState().terminals as Map<string, { mode: string }>;
    return Array.from(terms.entries())
      .filter(([, t]) => t.mode === 'tiled')
      .map(([id]) => id);
  });
}

test('orphan terminal in grid mode is healed by reconcileGridLayout (#grid-orphan)', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(500);

    // Create 3 more terminals (4 total) so we have enough to truncate and
    // still leave some visible
    for (let i = 0; i < 3; i++) {
      await window.keyboard.press('Control+Shift+n');
      await window.waitForTimeout(300);
    }
    await window.waitForFunction(
      () => document.querySelectorAll('.terminal-panel').length >= 4,
      null, { timeout: 10_000 },
    );

    // Enter grid mode from the default split layout. toggleViewMode cycles
    // to the next mode; call it until we land on grid.
    await window.evaluate(() => {
      const store = (window as any).__terminalStore;
      while (store.getState().viewMode !== 'grid') store.getState().toggleViewMode();
    });
    await window.waitForTimeout(300);

    // Baseline: tree has 4 leaves matching the 4 tiled terminals.
    const before = await treeLeafIds(window);
    const tiled = await tiledTerminalIds(window);
    expect(before.sort()).toEqual(tiled.sort());
    expect(before.length).toBe(4);

    // Simulate the orphan bug by trimming tilingRoot to just the first two
    // leaves - 4 terminals in the Map, only 2 in the tree. React's terminals
    // reference doesn't change here, so the self-heal useEffect alone would
    // not re-fire. We trigger reconcileGridLayout directly to exercise the
    // heal action itself.
    const trimmedIds = before.slice(0, 2);
    await window.evaluate((ids: string[]) => {
      const store = (window as any).__terminalStore;
      // Build a minimal valid tree: two leaves under a horizontal split.
      const orphanedRoot = {
        kind: 'split' as const,
        id: 'test-orphan-root',
        direction: 'horizontal' as const,
        splitRatio: 0.5,
        first: { kind: 'leaf' as const, terminalId: ids[0] },
        second: { kind: 'leaf' as const, terminalId: ids[1] },
      };
      store.setState((s: any) => ({ layout: { ...s.layout, tilingRoot: orphanedRoot } }));
    }, trimmedIds);

    const duringBug = await treeLeafIds(window);
    expect(duringBug.length).toBe(2);

    // Heal via the action.
    await window.evaluate(() => {
      (window as any).__terminalStore.getState().reconcileGridLayout();
    });
    await window.waitForTimeout(100);

    const after = await treeLeafIds(window);
    const tiledAfter = await tiledTerminalIds(window);
    expect(after.length).toBe(4);
    expect(after.sort()).toEqual(tiledAfter.sort());

    // Visible pane count matches the healed tree.
    const renderedPanes = await window.$$('.tiling-leaf');
    expect(renderedPanes.length).toBe(4);
  } finally {
    await close();
  }
});

test('self-heal useEffect reconciles when a new terminal is added', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(500);

    // Create 2 extra terminals so we have 3 total, enter grid mode
    for (let i = 0; i < 2; i++) {
      await window.keyboard.press('Control+Shift+n');
      await window.waitForTimeout(300);
    }
    await window.waitForFunction(
      () => document.querySelectorAll('.terminal-panel').length >= 3,
      null, { timeout: 10_000 },
    );
    await window.evaluate(() => {
      const store = (window as any).__terminalStore;
      while (store.getState().viewMode !== 'grid') store.getState().toggleViewMode();
    });
    await window.waitForTimeout(300);

    // Trim tilingRoot to a single leaf so the tree is 2 terms shy of the Map.
    const initial = await treeLeafIds(window);
    expect(initial.length).toBe(3);
    await window.evaluate((firstId: string) => {
      const store = (window as any).__terminalStore;
      store.setState((s: any) => ({
        layout: { ...s.layout, tilingRoot: { kind: 'leaf', terminalId: firstId } },
      }));
    }, initial[0]);

    // Creating a 4th terminal changes the terminals reference, which fires
    // the reconcile useEffect in App.tsx. The heal should include all 4.
    await window.keyboard.press('Control+Shift+n');
    await window.waitForTimeout(500);

    const healed = await treeLeafIds(window);
    const tiledAll = await tiledTerminalIds(window);
    expect(healed.length).toBe(4);
    expect(healed.sort()).toEqual(tiledAll.sort());
  } finally {
    await close();
  }
});
