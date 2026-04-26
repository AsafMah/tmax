import type { Terminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';

/**
 * Run the "jump to this prompt" search and bring the match to a useful spot
 * on screen. Shared between the latest-prompt banner click and the
 * Ctrl+Shift+K dialog so both behave identically.
 *
 * Behavior we want from a click:
 *  - The match becomes visible.
 *  - There's a few rows of context above the match (so the user can read
 *    the surrounding turn, not just the prompt at the very edge).
 *  - The decoration goes away the moment the user starts scrolling, because
 *    the search addon's decoration drifts a row when xterm repaints during
 *    scroll - that visual jitter is what users perceive as "highlight
 *    glitches when I scroll".
 *
 * Why we scroll manually after findPrevious: xterm-addon-search only scrolls
 * when the match is fully outside the viewport. If the match was already at
 * the bottom edge, the addon does nothing, the highlight lands on the very
 * last visible row, and the user reads it as "it didn't scroll there." We
 * recenter ourselves so the result is consistent regardless of starting
 * scroll position.
 */
export function runJumpToPromptSearch(
  search: SearchAddon,
  terminal: Terminal,
  promptText: string,
): boolean {
  const trimmed = promptText.trim();
  if (!trimmed) return false;
  search.clearDecorations();
  // xterm's ISearchOptions wants matchBackground+matchOverviewRuler too, but
  // those decorate every occurrence in the buffer - bad UX for short prompts
  // like 'hi'. Only style the active match.
  const opts = {
    decorations: {
      activeMatchColorOverviewRuler: '#fff',
      activeMatchBackground: '#89b4fa',
    },
    caseSensitive: false,
  } as any;
  const queries = [
    trimmed.slice(0, 120),
    trimmed.slice(0, 60),
    trimmed.slice(0, 30),
    trimmed.slice(0, 15),
  ];
  const seen = new Set<string>();
  let found = false;
  for (const q of queries) {
    if (!q || seen.has(q)) continue;
    seen.add(q);
    // findPrevious has been observed to apply decorations but return false
    // on some calls, so the boolean isn't fully load-bearing - but it's the
    // best signal we have for "stop trying shorter prefixes."
    if (search.findPrevious(q, opts)) { found = true; break; }
  }
  if (!found) return false;

  // Recenter the match. The addon's selection is what just got placed, so
  // pull its row out of the terminal and scroll so the row sits ~1/3 down
  // from the top - leaves context above (you can see what the agent said
  // before the prompt) and plenty of room below for the response.
  const sel = terminal.getSelectionPosition();
  if (sel) {
    const buf = terminal.buffer.active;
    const targetTop = sel.start.y - Math.floor(terminal.rows / 3);
    const delta = targetTop - buf.viewportY;
    if (delta !== 0) terminal.scrollLines(delta);
  }

  // After our recenter scroll has fired, register a one-shot listener so
  // the active-match decoration disappears the next time the user scrolls.
  // The decoration drifts under xterm's scroll redraw, and clearing it on
  // first user scroll is cleaner than fighting the drift.
  // Defer to the next tick so we don't clear our own scroll's event.
  queueMicrotask(() => {
    const dispose = terminal.onScroll(() => {
      try { search.clearActiveDecoration(); } catch { /* ignore */ }
      dispose.dispose();
    });
  });

  return true;
}
