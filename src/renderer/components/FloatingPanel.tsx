import React, { useCallback, useRef } from 'react';
import { useTerminalStore } from '../state/terminal-store';
import type { FloatingPanelState } from '../state/types';
import TerminalPanel from './TerminalPanel';

interface FloatingPanelProps {
  panel: FloatingPanelState;
}

const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;

const FloatingPanel: React.FC<FloatingPanelProps> = ({ panel }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const focusedTerminalId = useTerminalStore((s) => s.focusedTerminalId);
  const isFocused = focusedTerminalId === panel.terminalId;
  const maximized = panel.maximized ?? false;
  const savedBounds = useRef({ x: 200, y: 150, width: 600, height: 400 });

  const handleFocus = useCallback(() => {
    useTerminalStore.getState().setFocus(panel.terminalId);
  }, [panel.terminalId]);

  const handleMaximize = useCallback(() => {
    const store = useTerminalStore.getState();
    if (maximized) {
      // Restore to saved bounds
      store.updateFloatingPanel(panel.terminalId, { ...savedBounds.current, maximized: false });
    } else {
      // Save current bounds and maximize
      savedBounds.current = { x: panel.x, y: panel.y, width: panel.width, height: panel.height };
      store.updateFloatingPanel(panel.terminalId, { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight - 60, maximized: true });
    }
  }, [panel.terminalId, panel.x, panel.y, panel.width, panel.height, maximized]);

  // Title bar drag
  const handleTitleBarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Ignore if clicking interactive children. The per-pane title bar
      // hosts: ⋯ menu button, status dot (click closes), rename input
      // (active during rename), and the title text (double-click renames).
      const t = e.target as HTMLElement;
      if (t.closest('button') || t.closest('input') || t.closest('.status-dot-container')) return;

      e.preventDefault();
      handleFocus();

      const startX = e.clientX;
      const startY = e.clientY;
      const startPanelX = panel.x;
      const startPanelY = panel.y;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        useTerminalStore.getState().updateFloatingPanel(panel.terminalId, {
          x: startPanelX + dx,
          y: startPanelY + dy,
        });
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [panel.terminalId, panel.x, panel.y, handleFocus]
  );

  // Resize handles
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, edges: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean }) => {
      e.preventDefault();
      e.stopPropagation();
      handleFocus();

      const startX = e.clientX;
      const startY = e.clientY;
      const startPanelX = panel.x;
      const startPanelY = panel.y;
      const startWidth = panel.width;
      const startHeight = panel.height;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const updates: Partial<FloatingPanelState> = {};

        if (edges.right) {
          updates.width = Math.max(MIN_WIDTH, startWidth + dx);
        }
        if (edges.bottom) {
          updates.height = Math.max(MIN_HEIGHT, startHeight + dy);
        }
        if (edges.left) {
          const newWidth = Math.max(MIN_WIDTH, startWidth - dx);
          updates.width = newWidth;
          updates.x = startPanelX + (startWidth - newWidth);
        }
        if (edges.top) {
          const newHeight = Math.max(MIN_HEIGHT, startHeight - dy);
          updates.height = newHeight;
          updates.y = startPanelY + (startHeight - newHeight);
        }

        useTerminalStore.getState().updateFloatingPanel(panel.terminalId, updates);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [panel.terminalId, panel.x, panel.y, panel.width, panel.height, handleFocus]
  );

  const panelClassName = `floating-panel${isFocused ? ' focused' : ''}`;

  return (
    <div
      ref={panelRef}
      className={panelClassName}
      style={{
        left: panel.x,
        top: panel.y,
        width: panel.width,
        height: panel.height,
        zIndex: panel.zIndex,
      }}
      onMouseDown={handleFocus}
    >
      {/* Resize handles */}
      <div
        className="resize-handle top"
        onMouseDown={(e) => handleResizeMouseDown(e, { top: true })}
      />
      <div
        className="resize-handle bottom"
        onMouseDown={(e) => handleResizeMouseDown(e, { bottom: true })}
      />
      <div
        className="resize-handle left"
        onMouseDown={(e) => handleResizeMouseDown(e, { left: true })}
      />
      <div
        className="resize-handle right"
        onMouseDown={(e) => handleResizeMouseDown(e, { right: true })}
      />
      <div
        className="resize-handle top-left"
        onMouseDown={(e) => handleResizeMouseDown(e, { top: true, left: true })}
      />
      <div
        className="resize-handle top-right"
        onMouseDown={(e) => handleResizeMouseDown(e, { top: true, right: true })}
      />
      <div
        className="resize-handle bottom-left"
        onMouseDown={(e) => handleResizeMouseDown(e, { bottom: true, left: true })}
      />
      <div
        className="resize-handle bottom-right"
        onMouseDown={(e) => handleResizeMouseDown(e, { bottom: true, right: true })}
      />

      {/* Terminal content. The per-pane title bar inside TerminalPanel is
          its own title + \u22ef menu (with Restore-to-grid and Close), and we
          attach drag + maximize-toggle handlers via the floatTitleBar prop
          so the user only sees ONE title bar in float mode instead of two
          stacked. */}
      <div className="panel-content">
        <TerminalPanel
          terminalId={panel.terminalId}
          floatTitleBar={{ onMouseDown: handleTitleBarMouseDown, onDoubleClick: handleMaximize }}
        />
      </div>
    </div>
  );
};

export default FloatingPanel;
