import { test, expect } from '@playwright/test';
import { launchTmax } from './fixtures/launch';

// User asked for a "Wake all" affordance + cleaner UX in the hidden-panes
// popover. Pin the new behavior:
//
//  - Header shows count (compact: "Hidden (N)") plus a "Wake all" pill
//    button when >1 pane is dormant.
//  - Clicking Wake all pulls every dormant pane back into the tile tree.
//  - Per-item lines show pid + last-process to disambiguate identical
//    "pwsh / C:\\projects" rows the user complained about.

test('Wake all button restores every dormant pane in one click', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(800);

    // Spawn 3 panes total via splits, then dormant the last two.
    const ids = await window.evaluate(async () => {
      const store = (window as any).__terminalStore.getState();
      const t0 = store.focusedTerminalId ?? Array.from(store.terminals.keys())[0];
      await store.splitTerminal(t0, 'horizontal', undefined, 'right');
      const t1 = (window as any).__terminalStore.getState().focusedTerminalId;
      await (window as any).__terminalStore.getState().splitTerminal(t1, 'horizontal', undefined, 'right');
      const t2 = (window as any).__terminalStore.getState().focusedTerminalId;
      return [t0, t1, t2];
    });
    await window.waitForTimeout(800);
    const [, t1, t2] = ids;

    await window.evaluate((toHide) => {
      const store = (window as any).__terminalStore.getState();
      for (const id of toHide) store.moveToDormant(id);
    }, [t1, t2]);
    await window.waitForTimeout(300);

    // Click the 👁 hidden button to open the popover.
    await window.click('.status-dormant-btn');
    await window.waitForSelector('.dormant-popover', { timeout: 3_000 });

    // Wake all should be visible since 2 panes are dormant.
    const wakeAll = window.locator('.dormant-popover-wake-all');
    await expect(wakeAll).toBeVisible();
    await wakeAll.click();
    await window.waitForTimeout(400);

    const after = await window.evaluate(({ a, b }) => {
      const s = (window as any).__terminalStore.getState();
      return {
        modeA: s.terminals.get(a)?.mode,
        modeB: s.terminals.get(b)?.mode,
      };
    }, { a: t1, b: t2 });

    expect(after.modeA).toBe('tiled');
    expect(after.modeB).toBe('tiled');

    // Popover auto-closes after Wake all.
    const popover = await window.$('.dormant-popover');
    expect(popover).toBeNull();
  } finally {
    await close();
  }
});

test('Wake all is hidden when there is only one dormant pane (single-click already does the job)', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(800);

    const id = await window.evaluate(() => {
      const s = (window as any).__terminalStore.getState();
      const t0 = s.focusedTerminalId ?? Array.from(s.terminals.keys())[0];
      return t0;
    });
    // Make a second pane so we can hide one without leaving the layout empty.
    await window.evaluate(async (anchor) => {
      await (window as any).__terminalStore.getState()
        .splitTerminal(anchor, 'horizontal', undefined, 'right');
    }, id);
    await window.waitForTimeout(600);

    await window.evaluate((tid) => {
      (window as any).__terminalStore.getState().moveToDormant(tid);
    }, id);
    await window.waitForTimeout(300);

    await window.click('.status-dormant-btn');
    await window.waitForSelector('.dormant-popover', { timeout: 3_000 });
    const wakeAll = await window.$('.dormant-popover-wake-all');
    expect(wakeAll).toBeNull();
  } finally {
    await close();
  }
});
