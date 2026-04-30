import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { isMac } from './utils/platform';
import { prepareClipboardPaste } from './utils/paste';
import '@xterm/xterm/css/xterm.css';

/**
 * Extract a URL from HTML clipboard content when the content is essentially
 * a single hyperlink (e.g. ADO "Copy to clipboard" for PR titles).
 * Returns the href if found, null otherwise.
 */
function unwrapSafelinks(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)safelinks\.protection\.outlook\.com$/i.test(u.hostname)) {
      const real = u.searchParams.get('url');
      if (real && /^https?:\/\//i.test(real)) return real;
    }
  } catch { /* not a valid URL */ }
  return url;
}

function extractLinkFromHtml(html: string): string | null {
  if (!html) return null;
  const linkPattern = /<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(html)) !== null) {
    matches.push(m[1]);
  }
  if (matches.length === 1 && /^https?:\/\//i.test(matches[0])) return unwrapSafelinks(matches[0]);
  return null;
}

function hexToTerminalRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

interface DetachedAppProps {
  terminalId: string;
}

const DetachedApp: React.FC<DetachedAppProps> = ({ terminalId }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cleanup: (() => void) | null = null;

    (async () => {
      const config = await window.terminalAPI.getConfig();
      const themeConfig = config?.theme as Record<string, string> | undefined;
      const termConfig = config?.terminal as Record<string, unknown> | undefined;

      const materialActive = (config as any)?.backgroundMaterial && (config as any).backgroundMaterial !== 'none';
      const bgOpacity = materialActive ? ((config as any)?.backgroundOpacity ?? 0.8) : 1;
      const rawBg = themeConfig?.background ?? '#1e1e2e';
      const bgColor = bgOpacity < 1 ? hexToTerminalRgba(rawBg, bgOpacity) : rawBg;

      // Add transparency class so CSS layers become translucent
      if (materialActive) {
        document.documentElement.classList.add('transparency-active');
        document.body.style.background = 'transparent';
      }

      const term = new Terminal({
        theme: themeConfig
          ? {
              background: bgColor,
              foreground: themeConfig.foreground,
              cursor: themeConfig.cursor,
              selectionBackground: themeConfig.selectionBackground,
            }
          : {
              background: bgColor,
              foreground: '#cdd6f4',
              cursor: '#f5e0dc',
              selectionBackground: '#585b70',
            },
        fontSize: (termConfig?.fontSize as number) ?? 14,
        fontFamily:
          (termConfig?.fontFamily as string) ??
          "'CaskaydiaCove Nerd Font', 'Cascadia Code', 'Consolas', monospace",
        scrollback: (termConfig?.scrollback as number) ?? 5000,
        cursorStyle: (termConfig?.cursorStyle as 'block') ?? 'block',
        cursorBlink: (termConfig?.cursorBlink as boolean) ?? true,
        cursorInactiveStyle: 'none',
        allowTransparency: bgOpacity < 1,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      // Custom URL regex: include | (pipe) in URLs (xterm.js default excludes it)
      const urlRegex = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}\\\^<>`]*[^\s"':,.!?{}\\\^~\[\]`()<>]/;
      term.loadAddon(new WebLinksAddon(undefined, { urlRegex }));

      // Clipboard paste/copy handling
      const pasteToPty = (text: string) => {
        const payload = prepareClipboardPaste(text, !!term.modes.bracketedPasteMode);
        window.terminalAPI.writePty(terminalId, payload);
      };
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true;
        if ((event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')) {
          if (window.terminalAPI.clipboardHasImage()) {
            window.terminalAPI.clipboardSaveImage().then((filePath) => {
              pasteToPty(filePath);
            });
          } else {
            const html = window.terminalAPI.clipboardReadHTML();
            const linkUrl = extractLinkFromHtml(html);
            if (linkUrl) {
              pasteToPty(linkUrl);
            } else {
              navigator.clipboard
                .readText()
                .then((text) => {
                  if (text) pasteToPty(text);
                })
                .catch(() => {});
            }
          }
          return false;
        }
        if ((isMac ? event.metaKey : event.ctrlKey) && !event.shiftKey && event.key === 'c' && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          term.clearSelection();
          return false;
        }
        if ((isMac ? event.metaKey : event.ctrlKey) && event.shiftKey && event.key === 'C') {
          const sel = term.getSelection();
          if (sel) navigator.clipboard.writeText(sel);
          return false;
        }
        return true;
      });

      term.open(containerRef.current!);
      requestAnimationFrame(() => fitAddon.fit());

      const dataDisposable = term.onData((data) => {
        window.terminalAPI.writePty(terminalId, data);
      });

      const unsubscribePtyData = window.terminalAPI.onPtyData((id, data) => {
        if (id === terminalId) term.write(data);
      });

      const unsubscribePtyExit = window.terminalAPI.onPtyExit((id) => {
        if (id === terminalId) {
          term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
        }
      });

      const titleDisposable = term.onTitleChange((title) => {
        document.title = `tmax - ${title}`;
      });

      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          window.terminalAPI.resizePty(terminalId, term.cols, term.rows);
        } catch {}
      });
      resizeObserver.observe(containerRef.current!);

      const containerEl = containerRef.current!;
      const getBrowserSelectionInsideTerminal = () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return '';
        for (let i = 0; i < selection.rangeCount; i += 1) {
          if (selection.getRangeAt(i).intersectsNode(containerEl)) {
            return selection.toString();
          }
        }
        return '';
      };

      const getCopyableSelection = () => (
        term.hasSelection() ? term.getSelection() : getBrowserSelectionInsideTerminal()
      );

      const refocusTerminal = () => requestAnimationFrame(() => term.focus());

      // Block right-button mousedown/mouseup in capture so xterm.js can't
      // forward SGR mouse events to the pty. Otherwise a TUI with mouse
      // reporting on would see the right-click on top of our paste and the
      // user would see a double paste (issue #72 variant).
      // NOTE: Do NOT call preventDefault() on mousedown here. In Chromium/Electron,
      // preventing the default action of a right-click mousedown suppresses the
      // subsequent contextmenu event (especially on macOS where contextmenu is
      // generated from mousedown). stopPropagation() alone is sufficient to keep
      // xterm.js from seeing the event and forwarding SGR coordinates to the pty.
      //
      // Capture the selection text at mousedown time (capture phase) so it is
      // available in handleContextMenu even if focus changes between mousedown
      // and contextmenu cause xterm to clear it.
      let pendingRightClickSelection: string | null = null;
      const handleRightMouseButton = (e: MouseEvent) => {
        if (e.button === 2) {
          e.stopPropagation();
          if (e.type === 'mousedown') {
            pendingRightClickSelection = getCopyableSelection() || null;
          }
          if (e.type === 'mouseup') e.preventDefault();
        }
      };
      // Right-click: copy if selection, paste otherwise. Mirrors
      // TerminalPanel so detached windows match main window behaviour.
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const sel = pendingRightClickSelection || getCopyableSelection();
        pendingRightClickSelection = null;
        if (sel) {
          window.terminalAPI.clipboardWrite(sel);
          term.clearSelection();
          window.getSelection()?.removeAllRanges();
          refocusTerminal();
          return;
        }
        if (window.terminalAPI.clipboardHasImage()) {
          window.terminalAPI.clipboardSaveImage().then((filePath: string) => {
            window.terminalAPI.writePty(terminalId, filePath);
          });
          refocusTerminal();
          return;
        }
        const html = window.terminalAPI.clipboardReadHTML();
        const linkUrl = extractLinkFromHtml(html);
        let text = linkUrl || window.terminalAPI.clipboardRead();
        if (text && !linkUrl && /^https?:\/\/[^\s]+$/.test(text.trim())) {
          text = unwrapSafelinks(text.trim());
        }
        if (text) pasteToPty(text);
        refocusTerminal();
      };
      containerEl.addEventListener('contextmenu', handleContextMenu, true);
      containerEl.addEventListener('mousedown', handleRightMouseButton, true);
      containerEl.addEventListener('mouseup', handleRightMouseButton, true);

      term.focus();

      cleanup = () => {
        resizeObserver.disconnect();
        dataDisposable.dispose();
        unsubscribePtyData();
        unsubscribePtyExit();
        titleDisposable.dispose();
        containerEl.removeEventListener('contextmenu', handleContextMenu, true);
        containerEl.removeEventListener('mousedown', handleRightMouseButton, true);
        containerEl.removeEventListener('mouseup', handleRightMouseButton, true);
        term.dispose();
      };
    })();

    return () => cleanup?.();
  }, [terminalId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#1e1e2e',
      }}
    />
  );
};

export default DetachedApp;
