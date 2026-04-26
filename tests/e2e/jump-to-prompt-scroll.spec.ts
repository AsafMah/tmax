import { test, expect, Page } from '@playwright/test';
import { launchTmax, getStoreState } from './fixtures/launch';

// Reproduces "I click the latest-prompt banner, it highlights but the
// viewport doesn't actually scroll to it." We write a unique prompt near the
// end of the buffer, scroll the viewport to the top, then trigger the jump
// and assert the viewport moved AND the prompt row is now within view.
//
// Why this matters: xterm-addon-search only calls `scrollLines` when the
// match is OUTSIDE the current viewport. If the search engine resolves the
// match to a row that's *already* visible (or to the wrong occurrence), the
// user sees a highlight without any scroll motion - which is what the user
// reported.

const NEEDLE = 'unique-jump-needle-9f3a2c';
const PROMPT_TEXT = `${NEEDLE} please run this command for me`;

async function writeContent(window: Page, text: string): Promise<void> {
  await window.evaluate((t: string) => {
    return new Promise<void>((resolve) => {
      const id = (window as any).__terminalStore.getState().focusedTerminalId;
      const entry = (window as any).__getTerminalEntry(id);
      entry?.terminal.write(t, () => resolve());
    });
  }, text);
}

interface BufferState {
  viewportY: number;
  baseY: number;
  cursorY: number;
  rows: number;
  bufferLength: number;
  promptRow: number;
}

async function snapshotBuffer(window: Page, needle: string): Promise<BufferState & { allPromptRows: number[]; lastPromptRow: number }> {
  return window.evaluate((n: string) => {
    const id = (window as any).__terminalStore.getState().focusedTerminalId;
    const entry = (window as any).__getTerminalEntry(id);
    const term = entry.terminal;
    const buf = term.buffer.active;
    let promptRow = -1;
    const allPromptRows: number[] = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line && line.translateToString(true).includes(n)) {
        if (promptRow < 0) promptRow = i;
        allPromptRows.push(i);
      }
    }
    const lastPromptRow = allPromptRows.length ? allPromptRows[allPromptRows.length - 1] : -1;
    return {
      viewportY: buf.viewportY,
      baseY: buf.baseY,
      cursorY: buf.cursorY,
      rows: term.rows,
      bufferLength: buf.length,
      promptRow,
      allPromptRows,
      lastPromptRow,
    };
  }, needle);
}

test('clicking latest-prompt banner brings the prompt to a useful position even when it was already at the viewport edge', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(2500);

    const state = await getStoreState(window);
    const terminalId = state.terminalIds[0];

    await window.evaluate((id) => {
      const entry = (window as any).__getTerminalEntry(id);
      const term = entry.terminal;
      const orig = term.write.bind(term);
      (window as any).__origWrite = orig;
      let allow = false;
      (window as any).__allowWrite = (v: boolean) => { allow = v; };
      term.write = (data: any, cb?: any) => { if (allow) return orig(data, cb); if (cb) cb(); };
    }, terminalId);

    const lines: string[] = [];
    for (let i = 0; i < 60; i++) lines.push(`pre-line-${i}`);
    const blob = '\r\n' + lines.join('\r\n') + '\r\n' + PROMPT_TEXT + '\r\nshort-tail-1\r\nshort-tail-2\r\n';
    await window.evaluate((b: string) => {
      return new Promise<void>((resolve) => {
        const fn: any = (window as any).__allowWrite;
        const orig: any = (window as any).__origWrite;
        fn(true);
        orig(b, () => { fn(false); resolve(); });
      });
    }, blob);
    await window.waitForTimeout(300);

    await window.evaluate(({ id, prompt }) => {
      const store = (window as any).__terminalStore;
      const s = store.getState();
      const terminals = new Map(s.terminals);
      const tInst = terminals.get(id);
      terminals.set(id, { ...tInst, aiSessionId: 'edge-test-session' });
      store.setState({
        terminals,
        claudeCodeSessions: [{
          id: 'edge-test-session',
          provider: 'claude-code',
          status: 'idle',
          cwd: '', branch: '', repository: '', summary: 'edge test',
          latestPrompt: prompt, latestPromptTime: Date.now(),
          messageCount: 1, toolCallCount: 0, lastActivityTime: Date.now(),
        }],
      });
    }, { id: terminalId, prompt: PROMPT_TEXT });
    await window.waitForSelector('.terminal-pane-latest-prompt', { timeout: 5_000 });

    // Find the prompt row, then position the viewport so the prompt is
    // BARELY visible at the bottom edge (e.g., the very last visible row).
    const promptInfo = await window.evaluate(({ id, n }) => {
      const entry = (window as any).__getTerminalEntry(id);
      const buf = entry.terminal.buffer.active;
      let row = -1;
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);
        if (line && line.translateToString(true).includes(n)) row = i;
      }
      return { row, rows: entry.terminal.rows };
    }, { id: terminalId, n: NEEDLE });
    expect(promptInfo.row).toBeGreaterThan(0);

    // Scroll so the prompt is at the LAST visible row.
    await window.evaluate(({ id, target }) => {
      const term = (window as any).__getTerminalEntry(id).terminal;
      term.scrollToTop();
      term.scrollLines(target);
    }, { id: terminalId, target: promptInfo.row - promptInfo.rows + 1 });
    await window.waitForTimeout(150);

    const before = await snapshotBuffer(window, NEEDLE);
    // Prompt is on the very last visible row.
    expect(before.lastPromptRow).toBe(before.viewportY + before.rows - 1);

    await window.click('.terminal-pane-latest-prompt-jump');
    await window.waitForTimeout(400);

    const after = await snapshotBuffer(window, NEEDLE);

    // After the jump, the latest prompt should NOT be glued to the bottom
    // edge - the user wants to actually see context above it. Centering is
    // the convention (search addon does exactly this when scrolling).
    const distanceFromBottom = (after.viewportY + after.rows - 1) - after.lastPromptRow;
    expect(distanceFromBottom).toBeGreaterThan(2);
  } finally {
    await close();
  }
});

test('clicking latest-prompt banner scrolls the viewport to the prompt row', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    // Wait for the PowerShell prompt to fully render so it doesn't redraw
    // over our test content.
    await window.waitForTimeout(2500);

    const state = await getStoreState(window);
    const terminalId = state.terminalIds[0];

    // Disconnect the PTY data flow so our test writes aren't wiped by shell
    // prompt redraws. We replace the terminal's onData / pty data handler
    // with a no-op for the duration of the test.
    await window.evaluate((id) => {
      const entry = (window as any).__getTerminalEntry(id);
      const term = entry.terminal;
      // Hot-patch term.write so PTY data (which arrives via the data event)
      // can't get through; only direct calls from our test will land. The
      // tmax data plumbing pipes pty -> term.write, so by capturing this
      // write and gating it, we kill the PTY echo.
      const orig = term.write.bind(term);
      (window as any).__origWrite = orig;
      let allow = false;
      (window as any).__allowWrite = (v: boolean) => { allow = v; };
      term.write = (data: any, cb?: any) => {
        if (allow) return orig(data, cb);
        if (cb) cb();
      };
    }, terminalId);

    // Fill the buffer with enough lines to force scrollback. Real claude-code
    // sessions echo the user prompt MULTIPLE times across the buffer (initial
    // prompt entry + repeated TUI redraws of the conversation log). The
    // "latest" occurrence is the bottom-most one. We seed two earlier copies
    // of the prompt high in the buffer to make sure the search resolves to
    // the bottom-most copy, not an earlier one.
    const filler: string[] = [];
    for (let i = 0; i < 30; i++) filler.push(`filler-line-${i.toString().padStart(3, '0')}`);
    const middle: string[] = [];
    for (let i = 0; i < 30; i++) middle.push(`mid-line-${i.toString().padStart(3, '0')}`);
    const tail: string[] = [];
    for (let i = 0; i < 10; i++) tail.push(`assistant-reply-line-${i}`);
    const blob =
      '\r\n' + filler.join('\r\n')
      + '\r\n[TUI-RENDER-1] ' + PROMPT_TEXT
      + '\r\n' + middle.join('\r\n')
      + '\r\n[TUI-RENDER-2] ' + PROMPT_TEXT
      + '\r\n' + middle.slice(0, 10).join('\r\n')
      + '\r\n' + PROMPT_TEXT
      + '\r\n' + tail.join('\r\n') + '\r\n';
    await window.evaluate((b: string) => {
      return new Promise<void>((resolve) => {
        const fn: any = (window as any).__allowWrite;
        const orig: any = (window as any).__origWrite;
        fn(true);
        orig(b, () => { fn(false); resolve(); });
      });
    }, blob);
    await window.waitForTimeout(300);

    // Inject the fake session so the latest-prompt banner appears.
    await window.evaluate(({ id, prompt }) => {
      const store = (window as any).__terminalStore;
      const s = store.getState();
      const terminals = new Map(s.terminals);
      const tInst = terminals.get(id);
      if (!tInst) throw new Error('terminal not in store');
      terminals.set(id, { ...tInst, aiSessionId: 'jump-scroll-test-session' });
      store.setState({
        terminals,
        claudeCodeSessions: [{
          id: 'jump-scroll-test-session',
          provider: 'claude-code',
          status: 'idle',
          cwd: '',
          branch: '',
          repository: '',
          summary: 'Jump scroll test',
          latestPrompt: prompt,
          latestPromptTime: Date.now(),
          messageCount: 1,
          toolCallCount: 0,
          lastActivityTime: Date.now(),
        }],
      });
    }, { id: terminalId, prompt: PROMPT_TEXT });

    await window.waitForSelector('.terminal-pane-latest-prompt', { timeout: 5_000 });

    // Scroll the terminal viewport ALL the way to the top so the prompt row
    // is below the visible window.
    await window.evaluate((id) => {
      const entry = (window as any).__getTerminalEntry(id);
      entry.terminal.scrollToTop();
    }, terminalId);
    await window.waitForTimeout(150);

    const before = await snapshotBuffer(window, NEEDLE);
    expect(before.lastPromptRow).toBeGreaterThanOrEqual(0);
    // Sanity: viewport is at the top, and the LATEST prompt is below it.
    expect(before.lastPromptRow).toBeGreaterThan(before.viewportY + before.rows - 1);

    // Click the banner. This is the path the user reported broken.
    await window.click('.terminal-pane-latest-prompt-jump');
    await window.waitForTimeout(400);

    const after = await snapshotBuffer(window, NEEDLE);

    // The viewport must have moved.
    expect(after.viewportY).not.toBe(before.viewportY);
    // The LATEST prompt row (bottom-most occurrence) must be inside the
    // viewport. This is what the user expects when clicking "latest prompt"
    // - they want the most recent occurrence, not an earlier echo.
    expect(after.lastPromptRow).toBeGreaterThanOrEqual(after.viewportY);
    expect(after.lastPromptRow).toBeLessThanOrEqual(after.viewportY + after.rows - 1);
  } finally {
    await close();
  }
});
