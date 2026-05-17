import { Elysia } from 'elysia';
import path from 'path';
import fs from 'fs/promises';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export const staticPlugin = new Elysia()
  .get('/*', async ({ request, set }) => {
    const webDir = process.env.KITE_WEB_DIR;

    const url = new URL(request.url);
    let pathname = url.pathname;

    // No web dir configured — serve health check at root
    if (!webDir) {
      if (pathname === '/') return 'Deploy Server is running!';
      set.status = 404;
      return { error: 'Web console not available' };
    }

    const filePath = path.resolve(webDir, '.' + pathname);

    // Path traversal protection
    if (!filePath.startsWith(path.resolve(webDir))) {
      set.status = 403;
      return { error: 'Access denied' };
    }

    // Try to serve the exact file
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        const file = Bun.file(filePath);
        set.headers['Content-Type'] = getMimeType(filePath);
        set.headers['Cache-Control'] = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
        return file;
      }
    } catch {
      // File not found, fall through to SPA fallback
    }

    // SPA fallback: serve index.html for any unmatched route
    const indexPath = path.resolve(webDir, 'index.html');
    try {
      await fs.access(indexPath);
      set.headers['Content-Type'] = 'text/html; charset=utf-8';
      set.headers['Cache-Control'] = 'no-cache';
      return Bun.file(indexPath);
    } catch {
      set.status = 404;
      return { error: 'Web console not found' };
    }
  });
