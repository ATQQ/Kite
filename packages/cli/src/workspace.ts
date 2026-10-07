import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import chalk from 'chalk';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getConfigPath, readGlobalConfig, writeGlobalConfig } from './home.js';

export interface WorkspaceManifest {
  workspaceId: string;
  docsDir?: string;
  agents?: Record<string, { provider: string }>;
}

export interface WorkspaceAuth {
  serverUrl: string;
  workspaceId: string;
  token: string;
  agent: string;
  root: string;
  manifest: WorkspaceManifest;
}

type CommandOptions = Record<string, any>;

function maskToken(token: string): string {
  if (!token) return '(not set)';
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function apiUrl(serverUrl: string, suffix: string) {
  return `${serverUrl.replace(/\/$/, '')}${suffix}`;
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { error: text }; }
}

async function requestJson(serverUrl: string, token: string, suffix: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(apiUrl(serverUrl, suffix), { ...init, headers });
  const data = await readJson(res);
  if (!res.ok) {
    const error = new Error(data?.error || data?.message || `HTTP ${res.status}`) as Error & { status?: number; data?: any };
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export function findWorkspaceManifest(cwd = process.cwd()): { root: string; path: string; manifest: WorkspaceManifest } | null {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, 'kite.workspace.json');
    if (fs.existsSync(candidate)) {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      if (!parsed.workspaceId || typeof parsed.workspaceId !== 'string') {
        throw new Error(`Invalid workspace manifest: workspaceId is required (${candidate})`);
      }
      return { root: current, path: candidate, manifest: parsed };
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function resolveWorkspaceAuth(options: CommandOptions = {}): WorkspaceAuth {
  const global = readGlobalConfig();
  const found = findWorkspaceManifest(options.cwd || process.cwd());
  const workspaceId = options.workspace || process.env.KITE_WORKSPACE_ID || found?.manifest.workspaceId;
  if (!workspaceId) {
    throw new Error('Workspace id not found. Run `kite workspace init` or pass --workspace.');
  }
  const serverUrl = options.server || process.env.KITE_SERVER_URL || global.serverUrl;
  if (!serverUrl) {
    throw new Error('Server URL not found. Pass --server or run `kite config:set serverUrl <url> --global`.');
  }
  const token = options.token
    || process.env.KITE_WORKSPACE_TOKEN
    || global.workspaceToken?.[workspaceId];
  if (!token) {
    throw new Error(`Workspace token not found for ${workspaceId}. Run \`kite workspace init\` or pass --token.`);
  }
  const agent = options.agent || process.env.KITE_AGENT || 'codex';
  return {
    serverUrl,
    workspaceId,
    token,
    agent,
    root: found?.root || process.cwd(),
    manifest: found?.manifest || { workspaceId },
  };
}

function ensureManagedBlock(filePath: string, marker: string, content: string) {
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const block = `${start}\n${content.trim()}\n${end}`;
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const pattern = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next);
}

function workspaceInstruction() {
  const agentArg = '<cursor|claude|codex|workbuddy|trae>';
  return `## Kite Workspace Agent Workflow

When this repository is part of a Kite Workspace, use the Kite CLI as the source of truth for requirements, tasks and documents.

- Start work with \`kite task inbox --agent ${agentArg} --json\`.
- Claim only an assigned task or an unassigned task in the inbox with \`kite task claim <taskId> --agent ${agentArg}\`.
- Report meaningful progress with \`kite task update <taskId> --agent ${agentArg} --status <status> --summary "<what changed>"\`.
- Put durable process knowledge in \`kite doc push <file> --agent ${agentArg} --title "<title>" --kind <spec|design|handoff|report|note>\` and link it to the active requirement or task.
- Before editing an existing document, run \`kite doc pull <docId> --agent ${agentArg}\`; never overwrite a revision conflict.
- Do not write tokens into repository files. Tokens live in \`~/.kite/config.json\`.
- Do not manage workspace membership, rotate tokens, delete requirements, or reassign another agent's task.`;
}

function writeInstructionPacks(root: string) {
  ensureManagedBlock(path.join(root, 'AGENTS.md'), 'kite-workspace', workspaceInstruction());
}

function ensureGitignore(root: string, docsDir: string) {
  const ignorePath = path.join(root, '.gitignore');
  const normalized = docsDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  const entry = `/${normalized}/`;
  const current = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf-8') : '';
  if (current.split(/\r?\n/).includes(entry)) return;
  fs.writeFileSync(ignorePath, `${current.trimEnd()}${current.trim() ? '\n' : ''}${entry}\n`);
}

export async function initWorkspace(options: CommandOptions) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const global = readGlobalConfig();
  let workspaceId = options.workspace || process.env.KITE_WORKSPACE_ID;
  let serverUrl = options.server || process.env.KITE_SERVER_URL || global.serverUrl;
  let token = options.token || process.env.KITE_WORKSPACE_TOKEN;

  if (process.stdin.isTTY && (!workspaceId || !serverUrl || !token)) {
    const rl = readline.createInterface({ input, output });
    workspaceId ||= (await rl.question('Workspace ID: ')).trim();
    serverUrl ||= (await rl.question('Kite server URL: ')).trim();
    token ||= (await rl.question('Workspace token: ')).trim();
    rl.close();
  }
  if (!workspaceId || !serverUrl || !token) {
    throw new Error('workspace init requires --workspace, --server and --token in non-interactive mode.');
  }
  const workspace = await requestJson(serverUrl, token, `/api/workspaces/${encodeURIComponent(workspaceId)}`);
  const docsDir = options.docsDir || '.kite/workspace';
  const manifest: WorkspaceManifest = {
    workspaceId,
    docsDir,
    agents: Object.fromEntries(['cursor', 'claude', 'codex', 'workbuddy', 'trae'].map((provider) => [provider, { provider }])),
  };
  fs.writeFileSync(path.join(cwd, 'kite.workspace.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  global.serverUrl = serverUrl;
  global.workspaceToken = { ...(global.workspaceToken || {}), [workspaceId]: token };
  writeGlobalConfig(global);
  writeInstructionPacks(cwd);
  ensureGitignore(cwd, docsDir);
  fs.mkdirSync(path.join(cwd, docsDir), { recursive: true });
  console.log(chalk.green(`Workspace ready: ${workspace.name} (${workspaceId})`));
  console.log(chalk.gray(`  manifest: ${path.join(cwd, 'kite.workspace.json')}`));
  console.log(chalk.gray(`  token:    ${maskToken(token)} (stored in ${getConfigPath()})`));
  console.log(chalk.gray(`  docs:     ${path.join(cwd, docsDir)}`));
}

function printTable(rows: string[][], headers: string[]) {
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => String(row[index] || '').replace(/\x1b\[[0-9;]*m/g, '').length),
  ));
  console.log(headers.map((header, i) => chalk.bold(header.padEnd(widths[i]))).join('  '));
  console.log(chalk.gray(widths.map((width) => '-'.repeat(width)).join('  ')));
  for (const row of rows) {
    console.log(row.map((cell, i) => String(cell || '').padEnd(widths[i])).join('  '));
  }
}

async function workspaceStatus(options: CommandOptions) {
  const auth = resolveWorkspaceAuth(options);
  const [workspace, board] = await Promise.all([
    requestJson(auth.serverUrl, auth.token, `/api/workspaces/${auth.workspaceId}`),
    requestJson(auth.serverUrl, auth.token, `/api/workspaces/${auth.workspaceId}/board`),
  ]);
  if (options.json) return printJson({ workspace, board });
  console.log(chalk.bold(workspace.name) + chalk.gray(`  ${workspace.id}`));
  console.log(chalk.gray(`Projects ${board.counts.projects}  Requirements ${board.counts.requirements}  Tasks ${board.counts.tasks}  Unassigned ${board.counts.unassigned}  Docs ${board.counts.documents}`));
  const rows = board.agents.map((agent: any) => [agent.provider, agent.state, String(agent.openTaskIds.length)]);
  printTable(rows, ['AGENT', 'STATE', 'OPEN']);
}

async function workspaceAgents(options: CommandOptions) {
  const auth = resolveWorkspaceAuth(options);
  const agents = await requestJson(auth.serverUrl, auth.token, `/api/workspaces/${auth.workspaceId}/agents`);
  if (options.json) return printJson(agents);
  printTable(agents.map((agent: any) => [agent.provider, agent.state, String(agent.openTaskIds.length)]), ['AGENT', 'STATE', 'OPEN']);
}

async function requirementCommand(action: string, id: string | undefined, options: CommandOptions) {
  const auth = resolveWorkspaceAuth(options);
  const base = `/api/workspaces/${auth.workspaceId}/requirements`;
  if (action === 'list') {
    const rows = await requestJson(auth.serverUrl, auth.token, base);
    if (options.json) return printJson(rows);
    return printTable(rows.map((row: any) => [row.id, row.priority, row.effectiveStatus, row.title]), ['ID', 'PRI', 'STATUS', 'TITLE']);
  }
  if (action === 'show' && id) {
    const row = await requestJson(auth.serverUrl, auth.token, `${base}/${id}`);
    return options.json ? printJson(row) : printJson(row);
  }
  if (action === 'create') {
    const row = await requestJson(auth.serverUrl, auth.token, base, {
      method: 'POST',
      body: JSON.stringify({
        title: options.title,
        description: options.description,
        priority: options.priority,
        acceptanceCriteria: options.acceptance,
        tags: options.tags ? String(options.tags).split(',').map((item: string) => item.trim()).filter(Boolean) : [],
        projectIds: options.project ? String(options.project).split(',').map((item: string) => item.trim()).filter(Boolean) : [],
      }),
    });
    return options.json ? printJson(row) : console.log(chalk.green(`Created ${row.requirement.id}`));
  }
  if (action === 'update' && id) {
    const row = await requestJson(auth.serverUrl, auth.token, `${base}/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: options.title,
        description: options.description,
        priority: options.priority,
        statusMode: options.statusMode,
        manualStatus: options.status,
        acceptanceCriteria: options.acceptance,
        tags: options.tags !== undefined ? String(options.tags).split(',').map((item) => item.trim()).filter(Boolean) : undefined,
      }),
    });
    return options.json ? printJson(row) : console.log(chalk.green(`Updated ${id}`));
  }
  throw new Error('Usage: kite requirement <list|show|create|update> [id]');
}

export async function taskCommand(action: string, id: string | undefined, options: CommandOptions) {
  const auth = resolveWorkspaceAuth(options);
  const base = `/api/workspaces/${auth.workspaceId}/tasks`;
  if (action === 'inbox') {
    const rows = await requestJson(auth.serverUrl, auth.token, base);
    const inbox = rows.filter((row: any) =>
      row.status === 'todo' && (!row.assignedProvider || row.assignedProvider === auth.agent),
    );
    if (options.json) return printJson(inbox);
    return printTable(inbox.map((row: any) => [
      row.id,
      row.assignedProvider || chalk.gray('unassigned'),
      row.requirementPriority || '',
      row.title,
    ]), ['ID', 'AGENT', 'PRI', 'TITLE']);
  }
  if (action === 'claim' && id) {
    const row = await requestJson(auth.serverUrl, auth.token, `${base}/${id}/claim`, {
      method: 'POST',
      headers: { 'X-Kite-Agent': auth.agent },
      body: JSON.stringify({}),
    });
    return options.json ? printJson(row) : console.log(chalk.green(`Claimed ${id} as ${auth.agent}`));
  }
  if (action === 'release' && id) {
    const row = await requestJson(auth.serverUrl, auth.token, `${base}/${id}/release`, {
      method: 'POST',
      headers: { 'X-Kite-Agent': auth.agent },
      body: JSON.stringify({}),
    });
    return options.json ? printJson(row) : console.log(chalk.green(`Released ${id}`));
  }
  if (action === 'update' && id) {
    const row = await requestJson(auth.serverUrl, auth.token, `${base}/${id}`, {
      method: 'PUT',
      headers: { 'X-Kite-Agent': auth.agent },
      body: JSON.stringify({
        status: options.status,
        progress: options.progress !== undefined ? Number(options.progress) : undefined,
        summary: options.summary,
        documentId: options.doc,
      }),
    });
    return options.json ? printJson(row) : console.log(chalk.green(`Updated ${id}${row.task?.status ? chalk.gray(` -> ${row.task.status}`) : ''}`));
  }
  throw new Error('Usage: kite task <inbox|claim|update|release> [id]');
}

function localDocPath(root: string, docsDir: string, document: any) {
  const dir = path.join(root, docsDir, 'documents');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${document.id}-${String(document.title || 'document').replace(/[^\w\u4e00-\u9fa5-]+/g, '-')}.md`);
}

function replaceLocalImagesWithAssets(
  content: string,
  filePath: string,
  uploaded: Array<{ localPath: string; assetId: string }>,
) {
  let next = content;
  for (const item of uploaded) {
    const rel = path.relative(path.dirname(filePath), item.localPath).replace(/\\/g, '/');
    next = next.split(rel).join(`asset://${item.assetId}`);
    next = next.split(item.localPath.replace(/\\/g, '/')).join(`asset://${item.assetId}`);
  }
  return next;
}

async function uploadImages(auth: WorkspaceAuth, documentId: string, filePath: string, content: string) {
  const uploads: Array<{ localPath: string; assetId: string }> = [];
  const matches = Array.from(content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g));
  for (const match of matches) {
    const raw = match[1].trim().replace(/^<|>$/g, '');
    if (!raw || /^(https?:|data:|asset:\/\/)/.test(raw)) continue;
    const localPath = path.resolve(path.dirname(filePath), decodeURIComponent(raw));
    if (!fs.existsSync(localPath)) continue;
    const buffer = fs.readFileSync(localPath);
    const ext = path.extname(localPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : '';
    if (!mime) continue;
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), path.basename(localPath));
    const res = await fetch(apiUrl(auth.serverUrl, `/api/workspaces/${auth.workspaceId}/documents/${documentId}/assets`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'X-Kite-Agent': auth.agent },
      body: form,
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(data?.error || `Failed to upload ${raw}`);
    uploads.push({ localPath, assetId: data.asset.id });
  }
  return replaceLocalImagesWithAssets(content, filePath, uploads);
}

export async function docCommand(action: string, idOrPath: string | undefined, options: CommandOptions) {
  const auth = resolveWorkspaceAuth(options);
  const docsDir = auth.manifest.docsDir || '.kite/workspace';
  const base = `/api/workspaces/${auth.workspaceId}/documents`;
  if (action === 'list') {
    const rows = await requestJson(auth.serverUrl, auth.token, base);
    if (options.json) return printJson(rows);
    return printTable(rows.map((row: any) => [row.id, row.kind, String(row.revisionCount || row.revision_count || 1), row.title]), ['ID', 'KIND', 'REV', 'TITLE']);
  }
  if (action === 'pull' && options.all) {
    const rows = await requestJson(auth.serverUrl, auth.token, base);
    for (const row of rows) await pullDocument(auth, row.id, docsDir);
    console.log(chalk.green(`Pulled ${rows.length} document(s)`));
    return;
  }
  if (action === 'pull' && idOrPath) {
    const document = await pullDocument(auth, idOrPath, docsDir);
    return options.json ? printJson(document) : console.log(chalk.green(`Pulled ${document.id}`));
  }
  if (action === 'push' && idOrPath) {
    const filePath = path.resolve(idOrPath);
    if (!fs.existsSync(filePath)) throw new Error(`Document file not found: ${filePath}`);
    let documentId = options.doc as string | undefined;
    if (!documentId) {
      const localMatch = path.basename(filePath).match(/^(doc_[a-zA-Z0-9]+)-/);
      if (localMatch) documentId = localMatch[1];
    }
    const title = options.title || path.basename(filePath, path.extname(filePath));
    if (!documentId) {
      const created = await requestJson(auth.serverUrl, auth.token, base, {
        method: 'POST',
        headers: { 'X-Kite-Agent': auth.agent },
        body: JSON.stringify({
          title,
          kind: options.kind || 'note',
          contentMarkdown: '',
          links: [
            ...(options.requirement ? [{ targetType: 'requirement', targetId: options.requirement }] : []),
            ...(options.task ? [{ targetType: 'task', targetId: options.task }] : []),
          ],
        }),
      });
      documentId = created.document.id;
    }
    let document = await requestJson(auth.serverUrl, auth.token, `${base}/${documentId}`, {
      headers: { 'X-Kite-Agent': auth.agent },
    });
    let content = fs.readFileSync(filePath, 'utf-8');
    content = await uploadImages(auth, documentId!, filePath, content);
    const latest = document.latestRevision;
    const result = await requestJson(auth.serverUrl, auth.token, `${base}/${documentId}/revisions`, {
      method: 'POST',
      headers: { 'X-Kite-Agent': auth.agent },
      body: JSON.stringify({ contentMarkdown: content, baseRevisionId: latest?.id || null }),
    });
    if (options.requirement) {
      await requestJson(auth.serverUrl, auth.token, `${base}/${documentId}/links`, {
        method: 'POST',
        headers: { 'X-Kite-Agent': auth.agent },
        body: JSON.stringify({ targetType: 'requirement', targetId: options.requirement }),
      });
    }
    if (options.task) {
      await requestJson(auth.serverUrl, auth.token, `${base}/${documentId}/links`, {
        method: 'POST',
        headers: { 'X-Kite-Agent': auth.agent },
        body: JSON.stringify({ targetType: 'task', targetId: options.task }),
      });
    }
    const localPath = localDocPath(auth.root, docsDir, await requestJson(auth.serverUrl, auth.token, `${base}/${documentId}`, {
      headers: { 'X-Kite-Agent': auth.agent },
    }));
    return options.json ? printJson(result) : console.log(chalk.green(`Pushed ${documentId}`) + chalk.gray(`  ${localPath}`));
  }
  throw new Error('Usage: kite doc <list|pull|push> [docId|file]');
}

async function pullDocument(auth: WorkspaceAuth, documentId: string, docsDir: string) {
  const base = `/api/workspaces/${auth.workspaceId}/documents`;
  const document = await requestJson(auth.serverUrl, auth.token, `${base}/${documentId}`, {
    headers: { 'X-Kite-Agent': auth.agent },
  });
  const filePath = localDocPath(auth.root, docsDir, document);
  const assetsDir = path.join(auth.root, docsDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const assetMap = new Map<string, string>();
  for (const asset of document.assets || []) {
    const target = path.join(assetsDir, `${asset.id}-${path.basename(asset.originalName || 'asset')}`);
    const res = await fetch(apiUrl(auth.serverUrl, `/api/workspaces/${auth.workspaceId}/assets/${asset.id}`), {
      headers: { Authorization: `Bearer ${auth.token}`, 'X-Kite-Agent': auth.agent },
    });
    if (res.ok) {
      fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      assetMap.set(`asset://${asset.id}`, path.relative(path.dirname(filePath), target).replace(/\\/g, '/'));
    }
  }
  let content = document.contentMarkdown || '';
  for (const [from, to] of assetMap) content = content.split(from).join(to);
  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`);
  return document;
}

export function registerWorkspaceCommands(cli: any) {
  cli.command('workspace <action>', 'Manage Kite Workspace')
    .option('--workspace <id>', 'Workspace id')
    .option('--server <url>', 'Kite server URL')
    .option('--token <token>', 'Workspace token')
    .option('--agent <provider>', 'Agent provider')
    .option('--cwd <dir>', 'Working directory')
    .option('--docs-dir <dir>', 'Local documents directory')
    .option('--json', 'JSON output')
    .action(async (action: string, options: CommandOptions) => {
      try {
        if (action === 'init') return await initWorkspace(options);
        if (action === 'status') return await workspaceStatus(options);
        if (action === 'agents') return await workspaceAgents(options);
        throw new Error('Usage: kite workspace <init|status|agents>');
      } catch (error: any) {
        console.error(chalk.red(error.message));
        process.exit(1);
      }
    });

  cli.command('requirement <action> [id]', 'Manage workspace requirements')
    .option('--workspace <id>', 'Workspace id')
    .option('--server <url>', 'Kite server URL')
    .option('--token <token>', 'Workspace token')
    .option('--agent <provider>', 'Agent provider')
    .option('--title <title>', 'Requirement title')
    .option('--description <text>', 'Requirement description')
    .option('--priority <p0-p3>', 'Priority')
    .option('--status <status>', 'Manual status')
    .option('--status-mode <mode>', 'auto or manual')
    .option('--acceptance <text>', 'Acceptance criteria')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--project <ids>', 'Comma-separated project ids')
    .option('--json', 'JSON output')
    .action(async (action: string, id: string | undefined, options: CommandOptions) => {
      try { await requirementCommand(action, id, options); }
      catch (error: any) { console.error(chalk.red(error.message)); process.exit(1); }
    });

  cli.command('task <action> [id]', 'Manage workspace tasks')
    .option('--workspace <id>', 'Workspace id')
    .option('--server <url>', 'Kite server URL')
    .option('--token <token>', 'Workspace token')
    .option('--agent <provider>', 'Agent provider')
    .option('--status <status>', 'Task status')
    .option('--progress <n>', 'Progress percentage')
    .option('--summary <text>', 'Activity summary')
    .option('--doc <id>', 'Linked document id')
    .option('--json', 'JSON output')
    .action(async (action: string, id: string | undefined, options: CommandOptions) => {
      try { await taskCommand(action, id, options); }
      catch (error: any) { console.error(chalk.red(error.message)); process.exit(1); }
    });

  cli.command('doc <action> [idOrPath]', 'Manage workspace documents')
    .option('--workspace <id>', 'Workspace id')
    .option('--server <url>', 'Kite server URL')
    .option('--token <token>', 'Workspace token')
    .option('--agent <provider>', 'Agent provider')
    .option('--doc <id>', 'Existing document id')
    .option('--title <title>', 'Document title')
    .option('--kind <kind>', 'spec|design|handoff|report|note')
    .option('--requirement <id>', 'Link to requirement')
    .option('--task <id>', 'Link to task')
    .option('--all', 'Pull all documents')
    .option('--json', 'JSON output')
    .action(async (action: string, idOrPath: string | undefined, options: CommandOptions) => {
      try { await docCommand(action, idOrPath, options); }
      catch (error: any) { console.error(chalk.red(error.message)); process.exit(1); }
    });
}
