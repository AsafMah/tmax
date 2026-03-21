import { appendFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

const MAX_SIZE = 2 * 1024 * 1024; // 2 MB — rotate when exceeded
let logPath = '';

export function initDiagLogger(): string {
  logPath = join(app.getPath('userData'), 'tmax-diag.log');
  diagLog('app:start', { version: app.getVersion(), time: new Date().toISOString() });
  return logPath;
}

export function getDiagLogPath(): string {
  return logPath;
}

function sanitize(s: string, maxLen = 40): string {
  return s.slice(0, maxLen).replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

export function diagLog(event: string, data?: Record<string, unknown>): void {
  if (!logPath) return;
  try {
    if (existsSync(logPath) && statSync(logPath).size > MAX_SIZE) {
      writeFileSync(logPath, `--- log rotated at ${new Date().toISOString()} ---\n`);
    }
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const payload = data ? ' ' + JSON.stringify(data) : '';
    appendFileSync(logPath, `${ts} ${event}${payload}\n`);
  } catch { /* ignore write errors */ }
}

export { sanitize };
