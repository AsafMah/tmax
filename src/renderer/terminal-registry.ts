/**
 * Global registry for xterm Terminal instances and their SearchAddons.
 * Used by components (e.g. PromptsDialog) that need to search/scroll
 * a terminal without holding a direct ref.
 */
import type { Terminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';

interface TerminalEntry {
  terminal: Terminal;
  searchAddon: SearchAddon;
  // Test-only hook for flipping bracketed-paste state without round-tripping
  // through the PTY data listener. Production code never calls this.
  setBracketedPasteForTest?: (value: boolean) => void;
}

const registry = new Map<string, TerminalEntry>();

export function registerTerminal(
  id: string,
  terminal: Terminal,
  searchAddon: SearchAddon,
  setBracketedPasteForTest?: (value: boolean) => void,
): void {
  registry.set(id, { terminal, searchAddon, setBracketedPasteForTest });
}

export function unregisterTerminal(id: string): void {
  registry.delete(id);
}

export function getTerminalEntry(id: string): TerminalEntry | undefined {
  return registry.get(id);
}

export function getAllTerminals(): Terminal[] {
  return Array.from(registry.values()).map((e) => e.terminal);
}
