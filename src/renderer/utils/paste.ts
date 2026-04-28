// Normalize CRLF/CR to LF so readline-style shells (PSReadLine, bash readline,
// Claude Code, Copilot CLI) don't submit twice on a single embedded newline.
// When the focused shell has advertised bracketed paste (?2004h), wrap the
// payload in CSI 200~ / 201~ so embedded newlines are treated as data rather
// than Enter.
export function prepareClipboardPaste(text: string, bracketedPaste: boolean): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return bracketedPaste ? `\x1b[200~${normalized}\x1b[201~` : normalized;
}
