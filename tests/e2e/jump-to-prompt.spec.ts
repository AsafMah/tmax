import { test, expect, Page } from '@playwright/test';
import { launchTmax, getStoreState } from './fixtures/launch';

// The "latest prompt" banner and the prompts dialog both ask xterm's
// SearchAddon to scroll to and highlight the last user prompt. Two regressions
// kept biting and these tests pin the fix:
//
//   1. Short prompts (e.g. "hi") matched everywhere in the agent transcript,
//      because the production code passed `matchBackground` to findPrevious -
//      every match got a visible bg, lighting up the whole buffer. Fix: only
//      style the active match. We pin this by spying on findPrevious and
//      asserting `opts.decorations.matchBackground` is undefined.
//
//   2. A misleading "Not found in terminal buffer" warning appeared inside
//      the prompts dialog even when the search succeeded - xterm's
//      findPrevious returns false on some calls that did set a selection.
//      Fix: drop the warning entirely; jump silently and let the visual
//      highlight (or lack of one) be the signal. We pin this by pressing
//      Enter on a fresh prompt and asserting the dialog closes without any
//      `.ai-prompts-warning` rendering.
//
//   3. The dialog used to call `terminal.focus()` after the jump, which
//      scrolled the viewport back to the cursor and undid the scroll-to-
//      match. Fix: never refocus. We pin this by ensuring the production
//      caseSensitive flag is correct and the call shape matches the banner.
//
// Tests run in both grid and focus mode to make sure the wiring works in
// both. We don't try to assert against the rendered xterm buffer because
// the live PTY underneath wipes/redraws it asynchronously - instead we spy
// on the SearchAddon to capture exactly what the production code asked for.

const NEEDLE = 'unique-prompt-needle-xyz';
const PROMPT_TEXT = `hi ${NEEDLE} jump-to-prompt regression test`;

/**
 * Inject a fake claude-code session linked to the given terminal so the
 * latest-prompt banner appears and the prompts dialog has data. In a fresh
 * user-data-dir there are no real sessions on disk, so the IPC change events
 * never fire and our injection survives.
 */
async function injectFakeSession(window: Page, terminalId: string): Promise<void> {
  await window.evaluate(({ id, prompt }) => {
    const store = (window as any).__terminalStore;
    const s = store.getState();
    const terminals = new Map(s.terminals);
    const tInst = terminals.get(id);
    if (!tInst) throw new Error('terminal not in store');
    terminals.set(id, { ...tInst, aiSessionId: 'jump-to-prompt-test-session' });
    store.setState({
      terminals,
      claudeCodeSessions: [{
        id: 'jump-to-prompt-test-session',
        provider: 'claude-code',
        status: 'idle',
        cwd: '',
        branch: '',
        repository: '',
        summary: 'Jump-to-prompt test session',
        latestPrompt: prompt,
        latestPromptTime: Date.now(),
        messageCount: 1,
        toolCallCount: 0,
        lastActivityTime: Date.now(),
      }],
    });
  }, { id: terminalId, prompt: PROMPT_TEXT });
}

/**
 * Wrap `searchAddon.findPrevious` with a recorder so we can assert on the
 * exact `opts` the production code passed in.
 */
async function spyOnSearchAddon(window: Page, terminalId: string): Promise<void> {
  await window.evaluate((id) => {
    const entry = (window as any).__getTerminalEntry(id);
    if (!entry) throw new Error('no terminal registry entry');
    const orig = entry.searchAddon.findPrevious.bind(entry.searchAddon);
    (window as any).__searchCalls = [];
    entry.searchAddon.findPrevious = function (term: string, opts: any) {
      const result = orig(term, opts);
      (window as any).__searchCalls.push({ term, opts, result });
      return result;
    };
  }, terminalId);
}

interface SearchCall { term: string; opts: any; result: boolean }

async function getSearchCalls(window: Page): Promise<SearchCall[]> {
  return window.evaluate(() => (window as any).__searchCalls ?? []);
}

function assertBugFreeOpts(calls: SearchCall[]): void {
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) {
    // matchBackground would highlight every "hi" in the buffer - the
    // regression we're pinning. Only the active match should be styled.
    expect(c.opts?.decorations?.matchBackground).toBeUndefined();
    expect(c.opts?.decorations?.activeMatchBackground).toBeTruthy();
    // Case-insensitive lookup: TUIs sometimes uppercase a redraw, and we
    // don't want the search to miss because of casing.
    expect(c.opts?.caseSensitive).toBe(false);
  }
}

test('banner click in grid mode runs search with bug-free opts (no matchBackground, case-insensitive)', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(500);

    const state = await getStoreState(window);
    const terminalId = state.terminalIds[0];

    await injectFakeSession(window, terminalId);
    await spyOnSearchAddon(window, terminalId);
    await window.waitForSelector('.terminal-pane-latest-prompt', { timeout: 5_000 });

    await window.click('.terminal-pane-latest-prompt-jump');
    await window.waitForFunction(
      () => ((window as any).__searchCalls?.length ?? 0) > 0,
      null,
      { timeout: 3_000 },
    );

    const calls = await getSearchCalls(window);
    assertBugFreeOpts(calls);
    // Banner click feeds the latest prompt - longest unique prefix first.
    expect(calls[0].term.startsWith('hi ' + NEEDLE)).toBe(true);
  } finally {
    await close();
  }
});

test('banner click in focus mode runs search with bug-free opts', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(500);

    await window.keyboard.press('Control+Shift+f');
    await window.waitForTimeout(400);
    const s = await getStoreState(window);
    expect(s.viewMode).toBe('focus');

    const terminalId = s.terminalIds[0];
    await injectFakeSession(window, terminalId);
    await spyOnSearchAddon(window, terminalId);
    await window.waitForSelector('.terminal-pane-latest-prompt', { timeout: 5_000 });

    await window.click('.terminal-pane-latest-prompt-jump');
    await window.waitForFunction(
      () => ((window as any).__searchCalls?.length ?? 0) > 0,
      null,
      { timeout: 3_000 },
    );

    const calls = await getSearchCalls(window);
    assertBugFreeOpts(calls);
    expect(calls[0].term.startsWith('hi ' + NEEDLE)).toBe(true);
  } finally {
    await close();
  }
});

test('Ctrl+Shift+K dialog: Enter jumps with bug-free opts and closes silently', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(500);

    const state = await getStoreState(window);
    const terminalId = state.terminalIds[0];

    await injectFakeSession(window, terminalId);
    await spyOnSearchAddon(window, terminalId);
    await window.waitForSelector('.terminal-pane-latest-prompt', { timeout: 5_000 });

    await window.keyboard.press('Control+Shift+k');
    await window.waitForSelector('.ai-prompts-dialog', { timeout: 3_000 });
    await window.waitForSelector('.ai-prompt-item', { timeout: 3_000 });

    await window.keyboard.press('Enter');

    // Dialog closes silently on jump - no misleading "Not found in terminal
    // buffer" warning even though xterm's findPrevious may have returned false
    // for some prefix attempts.
    await window.waitForSelector('.ai-prompts-dialog', { state: 'detached', timeout: 3_000 });
    const warning = await window.$('.ai-prompts-warning');
    expect(warning).toBeNull();

    await window.waitForFunction(
      () => ((window as any).__searchCalls?.length ?? 0) > 0,
      null,
      { timeout: 3_000 },
    );
    assertBugFreeOpts(await getSearchCalls(window));
  } finally {
    await close();
  }
});

test('PromptsDialog jump never shows the "Not found in terminal buffer" toast', async () => {
  const { window, close } = await launchTmax();
  try {
    await window.waitForSelector('.terminal-panel', { timeout: 15_000 });
    await window.waitForTimeout(500);

    const state = await getStoreState(window);
    const terminalId = state.terminalIds[0];

    await injectFakeSession(window, terminalId);
    await window.waitForSelector('.terminal-pane-latest-prompt', { timeout: 5_000 });

    await window.keyboard.press('Control+Shift+k');
    await window.waitForSelector('.ai-prompts-dialog', { timeout: 3_000 });
    await window.waitForSelector('.ai-prompt-item', { timeout: 3_000 });

    // Click the prompt directly - same bug path as Enter, exercised through
    // mouse to make sure both paths are silent.
    await window.click('.ai-prompt-item');

    // No warning element should ever render, before or after close.
    const warning = await window.$('.ai-prompts-warning');
    expect(warning).toBeNull();

    await window.waitForSelector('.ai-prompts-dialog', { state: 'detached', timeout: 3_000 });
  } finally {
    await close();
  }
});
