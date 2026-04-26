import { test, expect } from '@playwright/test';
import { launchTmax } from './fixtures/launch';

// User's ask: "what about removing the top line in float" - i.e. when a pane
// is floating, the FloatingPanel wrapper used to render its OWN .title-bar
// (with maximize / dock / close buttons) on top of the TerminalPanel which
// already paints its per-pane title bar. Two bars, both saying the same
// name = visual noise. Drop the wrapper bar; let the per-pane title bar do
// the title display + drag-handle + ⋯ menu (which already has Restore +
// Close, so the buttons aren't lost).
//
// Test: float a pane, then assert the FloatingPanel root no longer holds a
// .title-bar child, and the .terminal-pane-title is its first visible row.
// Also drag the per-pane title bar by mouse and assert the float panel
// actually moves - confirming it took over as the drag handle.

test('floating pane has no FloatingPanel .title-bar; per-pane title bar serves as the drag handle', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(800);

    const id = await window.evaluate(() => {
      const s = (window as any).__terminalStore.getState();
      return s.focusedTerminalId ?? Array.from(s.terminals.keys())[0];
    });

    // Float the pane and de-maximize so it has a moveable bounding box.
    await window.evaluate((tid) => {
      const store = (window as any).__terminalStore.getState();
      store.moveToFloat(tid);
      store.updateFloatingPanel(tid, { x: 200, y: 200, width: 600, height: 400, maximized: false });
    }, id);
    await window.waitForTimeout(400);

    const layout = await window.evaluate(() => {
      const root = document.querySelector('.floating-panel');
      const ownTitleBar = root?.querySelector(':scope > .title-bar');
      const perPaneTitle = root?.querySelector('.terminal-pane-title');
      return {
        floatingPanelExists: !!root,
        hasOwnTitleBar: !!ownTitleBar,
        hasPerPaneTitleBar: !!perPaneTitle,
      };
    });
    expect(layout.floatingPanelExists).toBe(true);
    // The bug we fix: FloatingPanel's own .title-bar is gone.
    expect(layout.hasOwnTitleBar).toBe(false);
    // The per-pane title bar (which has the ⋯ menu) is still there.
    expect(layout.hasPerPaneTitleBar).toBe(true);

    // Drag the per-pane title bar by 50px and assert the floating panel's
    // store-recorded x moved by ~50.
    const before = await window.evaluate((tid) => {
      const s = (window as any).__terminalStore.getState();
      return s.layout.floatingPanels.find((p: any) => p.terminalId === tid);
    }, id);

    const titleBar = await window.$('.terminal-pane-title');
    expect(titleBar).not.toBeNull();
    const box = await titleBar!.boundingBox();
    if (!box) throw new Error('title-bar has no bounding box');
    // Aim for the empty area of the title bar (avoid the close-x and ⋯ btn).
    const startX = box.x + 50;
    const startY = box.y + box.height / 2;
    await window.mouse.move(startX, startY);
    await window.mouse.down();
    await window.mouse.move(startX + 50, startY, { steps: 6 });
    await window.mouse.up();
    await window.waitForTimeout(200);

    const after = await window.evaluate((tid) => {
      const s = (window as any).__terminalStore.getState();
      return s.layout.floatingPanels.find((p: any) => p.terminalId === tid);
    }, id);

    console.log('before x:', before.x, 'after x:', after.x);
    // Allow some slack for the drag rounding.
    expect(after.x - before.x).toBeGreaterThan(30);
  } finally {
    await close();
  }
});
