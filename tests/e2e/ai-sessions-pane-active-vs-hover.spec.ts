import { test, expect, Page } from '@playwright/test';
import { launchTmax } from './fixtures/launch';

// TASK-36 repro: in CopilotPanel.tsx, `selectedIndex` (line 135) does double
// duty - it's both the keyboard-cursor / pane-focus reveal target AND it's
// rewritten by `onMouseEnter` (line 776) for every row the cursor passes
// over. Because the .selected CSS class is bound to selectedIndex, hovering
// over any row stomps the active-pane highlight. Symptoms:
//   1. clicking a pane while the cursor was already over a different row
//      visually highlights the wrong session
//   2. once highlighted correctly, mouse-over of any other row removes
//      the highlight
//
// The fix introduces a separate concept: which session belongs to the
// currently focused pane. That row gets a stable `pane-active` class
// regardless of where the cursor is.

const cwdA = 'C:\\__task36__\\projA';
const cwdB = 'C:\\__task36__\\projB';
const idA = 'sess-task36-A';
const idB = 'sess-task36-B';
const summaryA = 'TASK36-A-fixture-summary';
const summaryB = 'TASK36-B-fixture-summary';

async function setFocus(window: Page, id: string): Promise<void> {
  await window.evaluate((tid) => {
    (window as any).__terminalStore.getState().setFocus(tid);
  }, id);
}

test('pane-active highlight survives mouse hover over other rows (TASK-36)', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(500);

    // Two panes
    const ids = await window.evaluate(async () => {
      const s = (window as any).__terminalStore.getState();
      const t0 = s.focusedTerminalId ?? Array.from(s.terminals.keys())[0];
      await s.splitTerminal(t0, 'horizontal', undefined, 'right');
      const t1 = (window as any).__terminalStore.getState().focusedTerminalId;
      return [t0, t1] as [string, string];
    });
    await window.waitForTimeout(300);
    const [t0, t1] = ids;

    // Open panel, group off (so both fixture rows render without expanding).
    await window.evaluate(() => {
      const store = (window as any).__terminalStore;
      store.setState({ showCopilotPanel: true });
      store.getState().updateConfig?.({ aiGroupByRepo: false });
    });
    await window.waitForSelector('.ai-session-item', { timeout: 5_000 });
    await window.waitForTimeout(800);

    // Inject fixtures and link each pane to its session
    await window.evaluate((args) => {
      const { t0, t1, cwdA, cwdB, idA, idB, summaryA, summaryB } = args;
      const store = (window as any).__terminalStore;
      const now = Date.now();
      const s = store.getState();
      const terminals = new Map(s.terminals);
      terminals.set(t0, { ...terminals.get(t0)!, cwd: cwdA, aiSessionId: idA });
      terminals.set(t1, { ...terminals.get(t1)!, cwd: cwdB, aiSessionId: idB });
      store.setState({
        terminals,
        claudeCodeSessions: [
          { id: idA, provider: 'claude-code', status: 'waitingForUser',
            cwd: cwdA, branch: 'main', repository: 'fixture',
            summary: summaryA, messageCount: 1, toolCallCount: 0, lastActivityTime: now },
          { id: idB, provider: 'claude-code', status: 'waitingForUser',
            cwd: cwdB, branch: 'main', repository: 'fixture',
            summary: summaryB, messageCount: 1, toolCallCount: 0, lastActivityTime: now },
        ],
        copilotSessions: [],
      });
    }, { t0, t1, cwdA, cwdB, idA, idB, summaryA, summaryB });
    await window.waitForTimeout(200);

    // Focus pane A.
    await setFocus(window, t0);
    await window.waitForTimeout(150);
    await setFocus(window, t1);
    await setFocus(window, t0);
    await window.waitForTimeout(300);

    // The focused pane is t0 → session A's row should carry .pane-active.
    const beforeHover = await window.evaluate(({ summaryA }) => {
      const items = [...document.querySelectorAll('.ai-session-item')] as HTMLElement[];
      const paneActive = items.find((el) => el.classList.contains('pane-active'));
      return {
        paneActiveText: paneActive ? (paneActive.textContent || '').trim() : null,
        paneActiveCount: items.filter((el) => el.classList.contains('pane-active')).length,
      };
    }, { summaryA });
    expect(beforeHover.paneActiveCount).toBe(1);
    expect(beforeHover.paneActiveText).toContain(summaryA);

    // Now hover over session B's row in the sidebar.
    const bRow = await window.evaluate(({ summaryB }) => {
      const items = [...document.querySelectorAll('.ai-session-item')] as HTMLElement[];
      const target = items.find((el) => (el.textContent || '').includes(summaryB));
      if (!target) return null;
      const r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, { summaryB });
    expect(bRow).toBeTruthy();
    await window.mouse.move(bRow!.x, bRow!.y);
    await window.waitForTimeout(150);

    // The pane-active class must STILL be on session A's row, not B's.
    const afterHover = await window.evaluate(({ summaryA, summaryB }) => {
      const items = [...document.querySelectorAll('.ai-session-item')] as HTMLElement[];
      const paneActive = items.filter((el) => el.classList.contains('pane-active'));
      return {
        count: paneActive.length,
        paneActiveText: paneActive[0] ? (paneActive[0].textContent || '').trim() : null,
        bIsPaneActive: paneActive.some((el) => (el.textContent || '').includes(summaryB)),
        aIsPaneActive: paneActive.some((el) => (el.textContent || '').includes(summaryA)),
      };
    }, { summaryA, summaryB });
    expect(afterHover.count).toBe(1);
    expect(afterHover.aIsPaneActive).toBe(true);
    expect(afterHover.bIsPaneActive).toBe(false);
  } finally {
    await close();
  }
});
