import { pino, type Logger } from 'pino';
import { createRequire } from 'node:module';

const LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const FORMAT = (process.env.LOG_FORMAT || (process.stdout.isTTY ? 'pretty' : 'json')).toLowerCase();
const FALLBACK = process.env.LOG_FALLBACK === 'console';

function tryCreatePretty(): Logger | null {
  // pino-pretty is a dev dependency; in the bundled CLI build it may not be
  // available. We attempt to load it via createRequire so that failure is
  // graceful — falling back to JSON logging instead of crashing on boot.
  try {
    const localRequire = createRequire(import.meta.url);
    const pretty = localRequire('pino-pretty');
    const stream = pretty({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname',
      messageFormat: '{module} | {msg}',
      sync: true,
    });
    return pino(
      {
        level: LEVEL,
        base: undefined,
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      stream,
    );
  } catch {
    return null;
  }
}

function createPinoLogger(): Logger {
  if (FORMAT === 'pretty') {
    const pretty = tryCreatePretty();
    if (pretty) return pretty;
    // fall through to JSON below
  }
  return pino({
    level: LEVEL,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

function createConsoleFallback(): Logger {
  const noop = () => {};
  const make = (method: 'log' | 'error' | 'warn' | 'info' | 'debug') => (obj: any, msg?: string) => {
    if (typeof obj === 'string') console[method](obj);
    else if (msg) console[method](msg, obj);
    else console[method](JSON.stringify(obj));
  };
  return {
    level: LEVEL,
    fatal: make('error'),
    error: make('error'),
    warn: make('warn'),
    info: make('info'),
    debug: make('debug'),
    trace: noop,
    silent: noop,
    child: () => createConsoleFallback(),
  } as unknown as Logger;
}

export const rootLogger: Logger = FALLBACK ? createConsoleFallback() : createPinoLogger();

export function moduleLogger(module: string, bindings?: Record<string, unknown>): Logger {
  return rootLogger.child({ module, ...(bindings || {}) });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidTraceId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function pickTraceId(headers: Record<string, string | undefined> | undefined): string | undefined {
  if (!headers) return undefined;
  const raw = headers['x-kite-trace-id'] || headers['X-Kite-Trace-Id' as any];
  return isValidTraceId(raw) ? raw : undefined;
}
