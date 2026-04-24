import { test, expect, Page } from '@playwright/test';
import { launchTmax } from './fixtures/launch';

// Regression: session pins must survive an app restart. The state lives in
// store.sessionPinned and ships through saveSession/restoreSession in the
// same bucket as sessionNameOverrides and sessionLifecycleOverrides. A prior
// build shipped the pin UI without wiring persistence, so this guards that
// the serialise → reload round-trip actually preserves the map.

async function pinCurrentState(window: Page): Promise<Record<string, true>> {
  return window.evaluate(() => {
    const s = (window as any).__terminalStore.getState();
    return { ...s.sessionPinned };
  });
}

test('togglePinSession writes to disk and restoreSession reads it back', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(500);

    // Start from a clean slate.
    expect(await pinCurrentState(window)).toEqual({});

    // Pin two synthetic session IDs - the action doesn't care whether the
    // sessions actually exist in the UI list, only that the map gets
    // updated and persisted.
    const ids = ['pin-session-aaa', 'pin-session-bbb'];
    await window.evaluate((sessionIds: string[]) => {
      const store = (window as any).__terminalStore.getState();
      for (const id of sessionIds) store.togglePinSession(id);
    }, ids);

    // In-memory state has both pins.
    const before = await pinCurrentState(window);
    expect(Object.keys(before).sort()).toEqual(ids.sort());

    // Force a save (togglePinSession already fires one, but saveSession is
    // async - wait for any pending writes to land).
    await window.evaluate(() => (window as any).__terminalStore.getState().saveSession());
    await window.waitForTimeout(400);

    // Round-trip: simulate restart by clearing state and calling restoreSession.
    const restored = await window.evaluate(async () => {
      const store = (window as any).__terminalStore;
      store.setState({ sessionPinned: {} });
      await store.getState().restoreSession();
      return { ...store.getState().sessionPinned };
    });
    expect(Object.keys(restored).sort()).toEqual(ids.sort());

    // Unpin one and verify the remaining pin still persists on another
    // round-trip - guards that togglePin doesn't clobber the whole map.
    await window.evaluate((id: string) => {
      (window as any).__terminalStore.getState().togglePinSession(id);
    }, ids[0]);
    await window.evaluate(() => (window as any).__terminalStore.getState().saveSession());
    await window.waitForTimeout(400);

    const afterUnpin = await window.evaluate(async () => {
      const store = (window as any).__terminalStore;
      store.setState({ sessionPinned: {} });
      await store.getState().restoreSession();
      return { ...store.getState().sessionPinned };
    });
    expect(Object.keys(afterUnpin)).toEqual([ids[1]]);
  } finally {
    await close();
  }
});
