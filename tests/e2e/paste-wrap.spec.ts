import { test, expect } from '@playwright/test';
import { prepareClipboardPaste } from '../../src/renderer/utils/paste';

// Pure-function regression test for TASK-28. Earlier paste-related specs
// (issue-72/73, detached-double-paste, double-paste mouse-reporting) only
// asserted the byte count of the resulting pty:write; they didn't pin down
// the bracketed-paste wrapping itself, and Ctrl+V keypresses don't fire
// reliably in offscreen e2e windows. By extracting the wrap into a pure
// function we can lock the behaviour down without launching Electron.

test.describe('prepareClipboardPaste (TASK-28)', () => {
  test('with bracketed paste enabled, payload is wrapped in CSI 200~ / 201~', () => {
    const out = prepareClipboardPaste('hello\nworld', true);
    expect(out).toBe('\x1b[200~hello\nworld\x1b[201~');
  });

  test('with bracketed paste disabled, payload is sent raw (after newline normalize)', () => {
    const out = prepareClipboardPaste('hello\nworld', false);
    expect(out).toBe('hello\nworld');
  });

  test('CRLF is normalized to LF whether or not bracketed paste is on', () => {
    expect(prepareClipboardPaste('a\r\nb\r\nc', false)).toBe('a\nb\nc');
    expect(prepareClipboardPaste('a\r\nb\r\nc', true)).toBe('\x1b[200~a\nb\nc\x1b[201~');
  });

  test('lone CR (old Mac line endings) is normalized to LF', () => {
    expect(prepareClipboardPaste('a\rb\rc', false)).toBe('a\nb\nc');
    expect(prepareClipboardPaste('a\rb\rc', true)).toBe('\x1b[200~a\nb\nc\x1b[201~');
  });

  test('mixed CRLF + lone CR + LF is normalized cleanly without doubling newlines', () => {
    // The CRLF→LF pass runs first, then the lone-CR pass. A naive lone-CR
    // pass that ran before the CRLF pass would turn \r\n into \n\n.
    expect(prepareClipboardPaste('a\r\nb\rc\nd', false)).toBe('a\nb\nc\nd');
  });

  test('empty string is preserved (no spurious wrapper added)', () => {
    expect(prepareClipboardPaste('', false)).toBe('');
    // Even with bracketed paste on, an empty payload still gets wrapped
    // because the caller decides whether to skip empty strings; this
    // function does not silently drop input.
    expect(prepareClipboardPaste('', true)).toBe('\x1b[200~\x1b[201~');
  });

  test('payload with no newlines is unchanged (modulo wrapping)', () => {
    expect(prepareClipboardPaste('npm install', false)).toBe('npm install');
    expect(prepareClipboardPaste('npm install', true)).toBe('\x1b[200~npm install\x1b[201~');
  });

  test('large multi-line payload (release notes-sized) round-trips intact', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}: some content here`);
    const payload = lines.join('\r\n');
    const wrapped = prepareClipboardPaste(payload, true);
    expect(wrapped.startsWith('\x1b[200~')).toBe(true);
    expect(wrapped.endsWith('\x1b[201~')).toBe(true);
    // Every original line still present
    for (const line of lines) expect(wrapped.includes(line)).toBe(true);
    // No CRLF survived
    expect(wrapped.includes('\r')).toBe(false);
    // Newline count matches: 59 separators between 60 lines
    expect((wrapped.match(/\n/g) || []).length).toBe(59);
  });
});
