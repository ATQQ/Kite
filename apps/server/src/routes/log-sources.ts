import { Elysia } from 'elysia';
import path from 'node:path';
import { db } from '../db/index.js';
import { moduleLogger } from '../lib/logger.js';
import { verifyAdminToken } from '../lib/auth.js';
import {
  pathGuard,
  readTail,
  readRange,
  watchTail,
  grepStream,
  DEFAULT_RANGE_SIZE,
  MAX_RANGE_SIZE,
  DEFAULT_TAIL_LINES,
  MAX_TAIL_LINES,
  DEFAULT_SEARCH_HITS,
  MAX_SEARCH_HITS,
  DEFAULT_SEARCH_CONTEXT,
  STREAM_HEARTBEAT_MS,
  STREAM_FLUSH_MS,
} from '../lib/log-tail.js';

const log = moduleLogger('log-sources');

const VALID_KINDS = new Set(['pm2', 'nginx', 'plain']);

function normalizeKind(input: unknown): string {
  if (typeof input !== 'string') return 'plain';
  return VALID_KINDS.has(input) ? input : 'plain';
}

function basename(p: string): string {
  return path.basename(p) || p;
}

function toInt(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

function sseLine(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseComment(text: string): Uint8Array {
  return new TextEncoder().encode(`: ${text}\n\n`);
}

export const logSourceRoutes = new Elysia()
  // ---------- CRUD ----------
  .get('/api/projects/:id/log-sources', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.findById(params.id);
    if (!project) { set.status = 404; return { error: 'Project not found' }; }
    const sources = await db.logSources.findByProject(params.id);
    return { items: sources };
  })
  .post('/api/projects/:id/log-sources', async ({ headers, params, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.findById(params.id);
    if (!project) { set.status = 404; return { error: 'Project not found' }; }

    const rawItems = Array.isArray((body as any)?.items) ? (body as any).items : null;
    if (!rawItems || rawItems.length === 0) {
      set.status = 400;
      return { error: 'items is required (array of {label, filePath, kind?})' };
    }
    if (rawItems.length > 50) {
      set.status = 400;
      return { error: 'too many items in one request (max 50)' };
    }

    const created: any[] = [];
    const errors: { index: number; error: string }[] = [];
    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i] || {};
      const filePath = typeof item.filePath === 'string' ? item.filePath : '';
      if (!filePath) { errors.push({ index: i, error: 'filePath is required' }); continue; }
      const guard = await pathGuard(filePath, { allowMissing: true });
      if (!guard.ok) { errors.push({ index: i, error: guard.error || 'invalid path' }); continue; }
      const label = (typeof item.label === 'string' && item.label.trim()) ? item.label.trim() : basename(filePath);
      const kind = normalizeKind(item.kind);
      const sortOrder = item.sortOrder !== undefined ? toInt(item.sortOrder, 0) : 0;
      const row = await db.logSources.create({
        projectId: params.id,
        label,
        filePath: guard.resolved || filePath,
        kind,
        sortOrder,
      });
      created.push(row);
    }

    if (created.length === 0) {
      set.status = 400;
      return { error: 'no item created', details: errors };
    }
    return { created, errors };
  })
  .patch('/api/log-sources/:sourceId', async ({ headers, params, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const existing = await db.logSources.findById(params.sourceId);
    if (!existing) { set.status = 404; return { error: 'Log source not found' }; }

    const patch: { label?: string; kind?: string; sortOrder?: number } = {};
    if (typeof (body as any)?.label === 'string') {
      const trimmed = (body as any).label.trim();
      if (!trimmed) { set.status = 400; return { error: 'label cannot be empty' }; }
      patch.label = trimmed;
    }
    if ((body as any)?.kind !== undefined) {
      patch.kind = normalizeKind((body as any).kind);
    }
    if ((body as any)?.sortOrder !== undefined) {
      patch.sortOrder = toInt((body as any).sortOrder, existing.sortOrder ?? 0);
    }
    const updated = await db.logSources.update(params.sourceId, patch);
    return updated;
  })
  .delete('/api/log-sources/:sourceId', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const ok = await db.logSources.remove(params.sourceId);
    if (!ok) { set.status = 404; return { error: 'Log source not found' }; }
    return { ok: true };
  })

  // ---------- Meta ----------
  .get('/api/log-sources/:sourceId/meta', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const src = await db.logSources.findById(params.sourceId);
    if (!src) { set.status = 404; return { error: 'Log source not found' }; }
    const guard = await pathGuard(src.filePath);
    if (!guard.ok) { set.status = guard.status || 500; return { error: guard.error || 'path error' }; }
    return {
      id: src.id,
      label: src.label,
      filePath: src.filePath,
      resolvedPath: guard.resolved,
      kind: src.kind ?? 'plain',
      size: guard.size ?? 0,
    };
  })

  // ---------- History (range) ----------
  .get('/api/log-sources/:sourceId/range', async ({ headers, params, query, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const src = await db.logSources.findById(params.sourceId);
    if (!src) { set.status = 404; return { error: 'Log source not found' }; }
    const guard = await pathGuard(src.filePath);
    if (!guard.ok) { set.status = guard.status || 500; return { error: guard.error || 'path error' }; }

    const rawOffset = (query as any).offset;
    const rawDirection = (query as any).direction;
    const size = Math.max(1024, Math.min(toInt((query as any).size, DEFAULT_RANGE_SIZE), MAX_RANGE_SIZE));
    const direction: 'forward' | 'backward' | 'tail' =
      rawDirection === 'backward' || rawDirection === 'forward' || rawDirection === 'tail'
        ? rawDirection
        : (rawOffset === undefined ? 'tail' : 'forward');
    const offset = rawOffset === undefined ? undefined : Math.max(0, toInt(rawOffset, 0));

    try {
      const result = await readRange(guard.resolved as string, { offset, size, direction });
      return result;
    } catch (err: any) {
      log.warn({ err: err?.message, sourceId: src.id }, 'readRange failed');
      set.status = 500;
      return { error: err?.message || 'read failed' };
    }
  })

  // ---------- Live (SSE) ----------
  .get('/api/log-sources/:sourceId/stream', async ({ headers, params, query, set, request }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return new Response('Unauthorized', { status: 401 }); }
    const src = await db.logSources.findById(params.sourceId);
    if (!src) { set.status = 404; return new Response('Not found', { status: 404 }); }
    const guard = await pathGuard(src.filePath);
    if (!guard.ok) { set.status = guard.status || 500; return new Response(guard.error || 'path error', { status: guard.status || 500 }); }

    const tailLines = Math.max(1, Math.min(toInt((query as any).tailLines, DEFAULT_TAIL_LINES), MAX_TAIL_LINES));
    const filePath = guard.resolved as string;

    let watcher: { close(): void } | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingLines: string[] = [];
    let closed = false;
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

    const safeEnqueue = (chunk: Uint8Array) => {
      if (closed || !controllerRef) return;
      try { controllerRef.enqueue(chunk); } catch { /* ignore */ }
    };

    const flush = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (pendingLines.length === 0) return;
      const batch = pendingLines;
      pendingLines = [];
      safeEnqueue(sseLine('lines', { lines: batch }));
    };

    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
    };

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (flushTimer) clearTimeout(flushTimer);
      if (watcher) { try { watcher.close(); } catch { /* ignore */ } }
      try { controllerRef?.close(); } catch { /* ignore */ }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        (async () => {
          try {
            const initial = await readTail(filePath, tailLines);
            safeEnqueue(sseLine('snapshot', {
              lines: initial.lines,
              size: initial.size,
              binary: initial.binary,
            }));
            if (initial.binary) {
              cleanup();
              return;
            }
            watcher = watchTail(filePath, initial.size, {
              onAppend: (chunk) => {
                if (closed) return;
                const parts = chunk.split('\n');
                if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
                if (parts.length === 0) return;
                if (pendingLines.length + parts.length > 2000) {
                  pendingLines = pendingLines.concat(parts).slice(-2000);
                } else {
                  pendingLines.push(...parts);
                }
                scheduleFlush();
              },
              onRotate: () => {
                if (closed) return;
                flush();
                safeEnqueue(sseLine('rotated', { at: new Date().toISOString() }));
                readTail(filePath, tailLines).then((again) => {
                  if (closed) return;
                  safeEnqueue(sseLine('snapshot', {
                    lines: again.lines,
                    size: again.size,
                    binary: again.binary,
                  }));
                }).catch((err) => {
                  safeEnqueue(sseLine('error', { message: err?.message || 'rotate read failed' }));
                });
              },
              onError: (err) => {
                if (closed) return;
                safeEnqueue(sseLine('error', { message: err?.message || 'watch error' }));
              },
            });
            heartbeat = setInterval(() => safeEnqueue(sseComment('keep-alive')), STREAM_HEARTBEAT_MS);
          } catch (err: any) {
            safeEnqueue(sseLine('error', { message: err?.message || 'init failed' }));
            cleanup();
          }
        })();
      },
      cancel() { cleanup(); },
    });

    request.signal?.addEventListener('abort', cleanup, { once: true });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  })

  // ---------- Search (SSE) ----------
  .get('/api/log-sources/:sourceId/search', async ({ headers, params, query, set, request }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return new Response('Unauthorized', { status: 401 }); }
    const src = await db.logSources.findById(params.sourceId);
    if (!src) { set.status = 404; return new Response('Not found', { status: 404 }); }
    const guard = await pathGuard(src.filePath);
    if (!guard.ok) { set.status = guard.status || 500; return new Response(guard.error || 'path error', { status: guard.status || 500 }); }

    const q = typeof (query as any).q === 'string' ? (query as any).q : '';
    if (!q) { set.status = 400; return new Response('q is required', { status: 400 }); }
    const regex = (query as any).regex === 'true' || (query as any).regex === '1';
    const caseInsensitive = (query as any).caseInsensitive === 'true' || (query as any).caseInsensitive === '1';
    const maxHits = Math.max(1, Math.min(toInt((query as any).maxHits, DEFAULT_SEARCH_HITS), MAX_SEARCH_HITS));
    const context = Math.max(0, Math.min(toInt((query as any).context, DEFAULT_SEARCH_CONTEXT), 20));
    const fromOffset = (query as any).fromOffset !== undefined
      ? Math.max(0, toInt((query as any).fromOffset, 0))
      : undefined;
    const toOffset = (query as any).toOffset !== undefined
      ? Math.max(0, toInt((query as any).toOffset, 0))
      : undefined;

    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let stopper: { abort(): void } | null = null;
    let closed = false;

    const safeEnqueue = (chunk: Uint8Array) => {
      if (closed || !controllerRef) return;
      try { controllerRef.enqueue(chunk); } catch { /* ignore */ }
    };

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (stopper) { try { stopper.abort(); } catch { /* ignore */ } }
      try { controllerRef?.close(); } catch { /* ignore */ }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        heartbeat = setInterval(() => safeEnqueue(sseComment('keep-alive')), STREAM_HEARTBEAT_MS);
        stopper = grepStream(guard.resolved as string, {
          q, regex, caseInsensitive, maxHits, context, fromOffset, toOffset,
          signal: request.signal,
        }, {
          onHit: (hit) => safeEnqueue(sseLine('hit', hit)),
          onTruncated: () => safeEnqueue(sseLine('truncated', { maxHits })),
          onDone: (scannedBytes) => {
            safeEnqueue(sseLine('done', { scannedBytes }));
            cleanup();
          },
          onError: (err) => {
            safeEnqueue(sseLine('error', { message: err?.message || 'search error' }));
            cleanup();
          },
        });
      },
      cancel() { cleanup(); },
    });

    request.signal?.addEventListener('abort', cleanup, { once: true });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });
