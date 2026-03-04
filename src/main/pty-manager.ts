import { IPty, spawn } from 'node-pty';
import { existsSync, statSync } from 'fs';
import { homedir } from 'os';

export interface PtyCreateOpts {
  id: string;
  shellPath: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

export interface PtyCallbacks {
  onData: (id: string, data: string) => void;
  onExit: (id: string, exitCode: number | undefined) => void;
}

// Electron injects env vars that break Node.js child processes (npm, npx, etc.)
const ELECTRON_ENV_BLOCKLIST = new Set([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_ENABLE_LOGGING',
  'ELECTRON_ENABLE_STACK_DUMPING',
  'ELECTRON_DEFAULT_ERROR_MODE',
  'ELECTRON_OVERRIDE_DIST_PATH',
  'GOOGLE_API_KEY',
  'GOOGLE_DEFAULT_CLIENT_ID',
  'GOOGLE_DEFAULT_CLIENT_SECRET',
  'ORIGINAL_XDG_CURRENT_DESKTOP',
  'NODE_OPTIONS',
]);

function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (ELECTRON_ENV_BLOCKLIST.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

export class PtyManager {
  private ptys = new Map<string, IPty>();
  private callbacks: PtyCallbacks;

  constructor(callbacks: PtyCallbacks) {
    this.callbacks = callbacks;
  }

  create(opts: PtyCreateOpts): { id: string; pid: number } {
    // Validate cwd is an existing directory; fall back to home dir
    let cwd = opts.cwd;
    try {
      if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
        cwd = homedir();
      }
    } catch {
      cwd = homedir();
    }

    const baseEnv = sanitizeEnv(opts.env ?? (process.env as Record<string, string>));
    const ptyProcess = spawn(opts.shellPath, opts.args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd,
      useConpty: true,
      env: { ...baseEnv, TERM_PROGRAM: 'tmax', COLORTERM: 'truecolor' },
    });

    this.ptys.set(opts.id, ptyProcess);

    ptyProcess.onData((data) => {
      this.callbacks.onData(opts.id, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.ptys.delete(opts.id);
      this.callbacks.onExit(opts.id, exitCode);
    });

    return { id: opts.id, pid: ptyProcess.pid };
  }

  write(id: string, data: string): void {
    const pty = this.ptys.get(id);
    if (pty) {
      pty.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const pty = this.ptys.get(id);
    if (pty) {
      pty.resize(cols, rows);
    }
  }

  kill(id: string): void {
    const pty = this.ptys.get(id);
    if (pty) {
      pty.kill();
      this.ptys.delete(id);
    }
  }

  killAll(): void {
    for (const [id, pty] of this.ptys) {
      pty.kill();
      this.ptys.delete(id);
    }
  }
}
