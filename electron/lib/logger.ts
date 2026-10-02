/**
 * Process-wide logger. Every log line goes to stderr with a level prefix so the
 * output is greppable and never mistaken for prose.
 *
 * There is deliberately no console.log in this codebase: console output is
 * dropped by the Electron main process on some platforms, which makes debugging
 * a data-integrity bug impossible.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function format(level: LogLevel, message: string, fields?: Record<string, unknown>) {
  const prefix = `[storyboard:${level}]`;
  if (fields === undefined || Object.keys(fields).length === 0) {
    return `${prefix} ${message}`;
  }
  const serialized = Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  return `${prefix} ${message} ${serialized}`;
}

function write(level: LogLevel, message: string, fields?: Record<string, unknown>) {
  process.stderr.write(`${format(level, message, fields)}\n`);
}

export function createLogger(): Logger {
  return {
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}