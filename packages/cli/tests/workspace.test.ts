import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  docCommand,
  findWorkspaceManifest,
  initWorkspace,
  requirementCommand,
  resolveWorkspaceAuth,
  taskCommand,
} from '../src/workspace.js';
import { maskToken, readGlobalConfig } from '../src/home.js';

const originalHome = process.env.KITE_HOME;
const tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'kite-cli-workspace-home-'));
const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'kite-cli-workspace-repo-'));
const nested = path.join(repoRoot, 'packages', 'api');
await fsp.mkdir(nested, { recursive: true });

process.env.KITE_HOME = tempHome;
delete process.env.KITE_WORKSPACE_ID;
delete process.env.KITE_WORKSPACE_TOKEN;
delete process.env.KITE_AGENT;

const requests: Array<{ method: string; path: string; search: string; agent: string | null; body: any }> = [];

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      let body: any = null;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const type = request.headers.get('content-type') || '';
        body = type.includes('application/json') ? await request.json().catch(() => null) : await request.formData().catch(() => null);
      }
      requests.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        agent: request.headers.get('x-kite-agent'),
        body,
      });

      if (url.pathname === '/api/workspaces/ws_cli' && request.method === 'GET') {
        return jsonResponse({ id: 'ws_cli', name: 'CLI Workspace', description: 'test' });
      }
      if (url.pathname === '/api/workspaces/ws_cli/tasks' && request.method === 'GET') {
        return jsonResponse([
          { id: 'task_1', title: 'Implement CLI', status: 'todo', assignedProvider: null, requirementPriority: 'P1' },
          { id: 'task_2', title: 'Other work', status: 'in_progress', assignedProvider: 'codex', requirementPriority: 'P2' },
        ]);
      }
      if (url.pathname === '/api/workspaces/ws_cli/tasks' && request.method === 'POST') {
        return jsonResponse({
          success: true,
          task: {
            id: 'task_created',
            title: body?.title,
            status: 'todo',
            assignedProvider: null,
            activities: [],
          },
        });
      }
      if (url.pathname === '/api/workspaces/ws_cli/tasks/task_1' && request.method === 'GET') {
        return jsonResponse({
          id: 'task_1',
          title: 'Implement CLI',
          status: 'todo',
          assignedProvider: null,
          activities: [],
        });
      }
      if (url.pathname === '/api/workspaces/ws_cli/requirements' && request.method === 'POST') {
        return jsonResponse({
          success: true,
          requirement: {
            id: 'req_cli',
            title: body?.title,
            projectIds: [],
            tags: [],
          },
        });
      }
      if (url.pathname === '/api/workspaces/ws_cli/tasks/task_1/claim' && request.method === 'POST') {
        return jsonResponse({ success: true, task: { id: 'task_1', status: 'claimed', assignedProvider: 'cursor' } });
      }
      if (url.pathname === '/api/workspaces/ws_cli/tasks/task_1' && request.method === 'PUT') {
        return jsonResponse({ success: true, task: { id: 'task_1', status: 'in_progress', assignedProvider: 'cursor' } });
      }
      if (url.pathname === '/api/workspaces/ws_cli/documents/doc_test' && request.method === 'GET') {
        return jsonResponse({
          id: 'doc_test',
          workspaceId: 'ws_cli',
          title: 'Spec',
          kind: 'spec',
          currentRevisionId: 'rev_1',
          latestRevision: { id: 'rev_1', revisionNumber: 1, contentMarkdown: '![img](asset://asset1)' },
          contentMarkdown: '![img](asset://asset1)',
          links: [],
          revisions: [{ id: 'rev_1', revisionNumber: 1, contentMarkdown: '![img](asset://asset1)', createdAt: '2026-10-03T00:00:00.000Z' }],
          assets: [{ id: 'asset1', documentId: 'doc_test', originalName: 'pixel.png', mime: 'image/png' }],
        });
      }
      if (url.pathname === '/api/workspaces/ws_cli/documents/doc_test/revisions' && request.method === 'GET') {
        return jsonResponse([
          { id: 'rev_1', revisionNumber: 1, contentMarkdown: '![img](asset://asset1)' },
        ]);
      }
      if (url.pathname === '/api/workspaces/ws_cli/documents/doc_test' && request.method === 'PUT') {
        return jsonResponse({ success: true, document: { id: 'doc_test', title: body?.title, kind: body?.kind } });
      }
      if (url.pathname === '/api/workspaces/ws_cli/assets/asset1' && request.method === 'GET') {
        return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
      }
      if (url.pathname === '/api/workspaces/ws_cli/documents/doc_test/assets' && request.method === 'POST') {
        return jsonResponse({ success: true, asset: { id: 'asset1', documentId: 'doc_test', originalName: 'pixel.png', mime: 'image/png' } });
      }
      if (url.pathname === '/api/workspaces/ws_cli/documents/doc_test/revisions' && request.method === 'POST') {
        if (body?.contentMarkdown?.includes('CONFLICT')) {
          return jsonResponse({ error: 'Revision conflict', latest: { id: 'rev_2', revisionNumber: 2 } }, 409);
        }
        return jsonResponse({ success: true, revision: { id: 'rev_2', revisionNumber: 2, contentMarkdown: body.contentMarkdown } });
      }
      if (url.pathname === '/api/workspaces/ws_cli/documents/doc_test/links' && request.method === 'POST') {
        return jsonResponse({ success: true });
      }
      if (url.pathname === '/api/workspaces/ws_cli/documents/doc_test/links/requirement/req_1' && request.method === 'DELETE') {
        return jsonResponse({ success: true });
      }
      if (url.pathname === '/api/workspaces/ws_cli/documents/doc_test' && request.method === 'PUT') {
        return jsonResponse({ success: true, document: { id: 'doc_test', title: 'Spec', kind: 'spec' } });
      }
      return jsonResponse({ error: `No fixture for ${request.method} ${url.pathname}` }, 404);
    },
  });
});

afterAll(async () => {
  server.stop(true);
  await fsp.rm(tempHome, { recursive: true, force: true });
  await fsp.rm(repoRoot, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.KITE_HOME;
  else process.env.KITE_HOME = originalHome;
});

describe('workspace CLI', () => {
  it('discovers manifests upward and keeps tokens out of the repository', async () => {
    const serverUrl = `http://127.0.0.1:${server.port}`;
    const options = {
      cwd: repoRoot,
      workspace: 'ws_cli',
      server: serverUrl,
      token: 'wst_cli_secret',
      docsDir: '.kite/workspace',
    };
    await initWorkspace(options);
    await initWorkspace(options);

    const manifestPath = path.join(repoRoot, 'kite.workspace.json');
    const manifestText = fs.readFileSync(manifestPath, 'utf-8');
    expect(manifestText).not.toContain('wst_cli_secret');
    expect(readGlobalConfig().workspaceToken?.ws_cli).toBe('wst_cli_secret');
    expect(manifestText).toContain('.kite/workspace');

    const agentsText = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf-8');
    expect(agentsText.match(/kite-workspace:start/g)?.length).toBe(1);
    expect(fs.existsSync(path.join(repoRoot, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'KITE_WORKSPACE_AGENT.md'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, '.cursor'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, '.trae'))).toBe(false);
    expect(fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf-8')).toContain('/.kite/workspace/');

    const found = findWorkspaceManifest(nested);
    expect(found?.root).toBe(repoRoot);
    const auth = resolveWorkspaceAuth({ cwd: nested, agent: 'cursor' });
    expect(auth.workspaceId).toBe('ws_cli');
    expect(auth.token).toBe('wst_cli_secret');
    expect(auth.serverUrl).toBe(serverUrl);
    expect(auth.agent).toBe('cursor');
    expect(auth.root).toBe(repoRoot);
  });

  it('writes only the AGENTS.md block and preserves user content', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kite-cli-workspace-agents-'));
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Existing project rules\n\nKeep this line.\n');
    const options = {
      cwd: dir,
      workspace: 'ws_cli',
      server: `http://127.0.0.1:${server.port}`,
      token: 'wst_cli_secret',
    };
    await initWorkspace(options);
    await initWorkspace(options);

    const text = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    expect(text).toContain('# Existing project rules');
    expect(text).toContain('Keep this line.');
    expect(text.match(/kite-workspace:start/g)?.length).toBe(1);
    expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'KITE_WORKSPACE_AGENT.md'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.cursor'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.trae'))).toBe(false);

    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('supports inbox, claim and task updates with agent identity', async () => {
    const authOptions = { cwd: nested, agent: 'cursor', json: true };
    await taskCommand('inbox', undefined, authOptions);
    await taskCommand('claim', 'task_1', authOptions);
    await taskCommand('update', 'task_1', {
      ...authOptions,
      status: 'in_progress',
      progress: '40',
      summary: 'CLI integration',
    });

    const claim = requests.find((item) => item.path.endsWith('/task_1/claim'));
    const update = requests.find((item) => item.path.endsWith('/task_1') && item.method === 'PUT');
    expect(claim?.agent).toBe('cursor');
    expect(update?.agent).toBe('cursor');
    expect(update?.body.status).toBe('in_progress');
    expect(update?.body.progress).toBe(40);
  });

  it('lists, shows and creates tasks through workspace auth', async () => {
    const authOptions = { cwd: nested, agent: 'cursor', json: true };
    await taskCommand('list', undefined, {
      ...authOptions,
      status: 'todo',
      requirement: 'req_1',
      assignee: 'unassigned',
    });
    await taskCommand('show', 'task_1', authOptions);
    await taskCommand('create', undefined, {
      ...authOptions,
      requirement: 'req_1',
      title: 'CLI-created task',
      description: 'Created through workspace auth',
    });

    const list = requests.find((item) => item.path.endsWith('/tasks') && item.method === 'GET' && item.search.includes('requirementId=req_1'));
    const create = requests.find((item) => item.path.endsWith('/tasks') && item.method === 'POST');
    expect(list?.search).toBe('?status=todo&requirementId=req_1&assignee=unassigned');
    expect(create?.agent).toBe('cursor');
    expect(create?.body.requirementId).toBe('req_1');
    expect(create?.body.title).toBe('CLI-created task');
  });

  it('creates requirements with workspace auth', async () => {
    const authOptions = { cwd: nested, agent: 'cursor', json: true };
    await requirementCommand('create', undefined, {
      ...authOptions,
      title: 'CLI-managed requirement',
      description: 'Created through workspace auth',
      priority: 'P0',
      statusMode: 'manual',
      status: 'ready',
      tags: 'cli,workspace',
    });

    const create = requests.find((item) => item.path.endsWith('/requirements') && item.method === 'POST');
    expect(create?.agent).toBe('cursor');
    expect(create?.body.title).toBe('CLI-managed requirement');
    expect(create?.body.projectIds).toEqual([]);
    expect(create?.body.tags).toEqual(['cli', 'workspace']);
    expect(create?.body.statusMode).toBe('manual');
    expect(create?.body.manualStatus).toBe('ready');
  });

  it('shows, updates and links documents', async () => {
    const authOptions = { cwd: nested, agent: 'cursor', json: true };
    await docCommand('show', 'doc_test', authOptions);
    await docCommand('revisions', 'doc_test', authOptions);
    await docCommand('update', 'doc_test', {
      ...authOptions,
      title: 'Updated spec',
      kind: 'design',
    });
    await docCommand('link', 'doc_test', { ...authOptions, requirement: 'req_1' });
    await docCommand('unlink', 'doc_test', { ...authOptions, requirement: 'req_1' });

    const update = requests.find((item) => item.path.endsWith('/doc_test') && item.method === 'PUT');
    const link = requests.find((item) => item.path.endsWith('/doc_test/links') && item.method === 'POST');
    const unlink = requests.find((item) => item.path.endsWith('/doc_test/links/requirement/req_1') && item.method === 'DELETE');
    expect(update?.body.title).toBe('Updated spec');
    expect(update?.body.kind).toBe('design');
    expect(link?.body.targetId).toBe('req_1');
    expect(unlink?.path).toBe('/api/workspaces/ws_cli/documents/doc_test/links/requirement/req_1');
  });

  it('masks token values for display', () => {
    expect(maskToken('kt_1234567890abcdef')).toBe('kt_1...cdef');
    expect(maskToken('short')).toBe('****');
  });

  it('pulls and pushes documents while rewriting local image paths', async () => {
    const authOptions = { cwd: nested, agent: 'cursor', json: true };
    await docCommand('pull', 'doc_test', authOptions);

    const docsDir = path.join(repoRoot, '.kite', 'workspace', 'documents');
    const localFile = path.join(docsDir, fs.readdirSync(docsDir).find((name) => name.startsWith('doc_test-'))!);
    const pulled = fs.readFileSync(localFile, 'utf-8');
    expect(pulled).toContain('../assets/asset1-pixel.png');
    expect(pulled).not.toContain('asset://asset1');

    fs.writeFileSync(localFile, `${pulled.trimEnd()}\n\nCLI push body\n`);
    await docCommand('push', localFile, {
      ...authOptions,
      doc: 'doc_test',
      requirement: 'req_1',
      kind: 'spec',
    });

    const revision = requests.findLast((item) => item.path.endsWith('/doc_test/revisions') && item.method === 'POST');
    const link = requests.findLast((item) => item.path.endsWith('/doc_test/links') && item.method === 'POST');
    const upload = requests.findLast((item) => item.path.endsWith('/doc_test/assets') && item.method === 'POST');
    expect(revision?.body.baseRevisionId).toBe('rev_1');
    expect(revision?.body.contentMarkdown).toContain('asset://asset1');
    expect(revision?.body.contentMarkdown).toContain('CLI push body');
    expect(upload?.agent).toBe('cursor');
    expect(link?.body.targetId).toBe('req_1');

    fs.writeFileSync(localFile, 'CONFLICT\n');
    let conflictStatus = 0;
    try {
      await docCommand('push', localFile, { ...authOptions, doc: 'doc_test' });
    } catch (error: any) {
      conflictStatus = error.status;
    }
    expect(conflictStatus).toBe(409);
  });
});
