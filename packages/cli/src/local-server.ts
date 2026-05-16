import fs from 'fs';
import fsp from 'fs/promises';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import * as readline from 'readline';
import AdmZip from 'adm-zip';
import Busboy from 'busboy';
import { LocalStore } from './local-store.js';
import { ensureKiteHome, randomToken, setGlobalConfig } from './home.js';

interface ServeOptions {
  host?: string;
  port?: number;
  runtime?: 'auto' | 'node' | 'bun';
}

interface UploadForm {
  fields: Record<string, string>;
  filePath?: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, 'web');

const json = (status: number, data: unknown) => ({
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(data)
});

const text = (status: number, body: string, contentType = 'text/plain; charset=utf-8') => ({
  status,
  headers: { 'Content-Type': contentType },
  body
});

const readBody = async (request: http.IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
};

const getAuthToken = (request: http.IncomingMessage) => {
  const auth = request.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return '';
  return auth.slice('Bearer '.length);
};

const parseMultipart = (request: http.IncomingMessage): Promise<UploadForm> => {
  return new Promise((resolve, reject) => {
    const storeHome = ensureKiteHome();
    const tempPath = path.join(storeHome, 'tmp', `${Date.now()}-${Math.random().toString(16).slice(2)}.zip`);
    const fields: Record<string, string> = {};
    let filePath: string | undefined;

    const busboy = Busboy({
      headers: request.headers,
      limits: { fileSize: 50 * 1024 * 1024, files: 1 }
    });

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (_name, file) => {
      filePath = tempPath;
      file.pipe(fs.createWriteStream(tempPath));
    });

    busboy.on('error', reject);
    busboy.on('finish', () => resolve({ fields, filePath }));
    request.pipe(busboy);
  });
};

// SSE broadcast: deployId -> Set of response objects
const deploySubscribers = new Map<string, Set<http.ServerResponse>>();

function broadcastToSubscribers(deployId: string, event: string, data: string) {
  const subs = deploySubscribers.get(deployId);
  if (!subs || subs.size === 0) return;
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) {
    try { res.write(message); } catch { subs.delete(res); }
  }
}

// Streaming shell command: yields lines with raw ANSI codes
async function* runShellCommand(command: string, cwd: string) {
  const proc = spawn('/bin/sh', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

  const rlStdout = readline.createInterface({ input: proc.stdout });
  const rlStderr = readline.createInterface({ input: proc.stderr });

  // Yield lines from both stdout and stderr as they arrive
  const lineQueue: string[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const pushLine = (line: string) => {
    lineQueue.push(line);
    if (resolve) { resolve(); resolve = null; }
  };

  rlStdout.on('line', pushLine);
  rlStderr.on('line', pushLine);

  const onClose = () => {
    done = true;
    if (resolve) { resolve(); resolve = null; }
  };
  proc.on('close', onClose);

  while (!done || lineQueue.length > 0) {
    if (lineQueue.length === 0) {
      await new Promise<void>(r => { resolve = r; });
    }
    while (lineQueue.length > 0) {
      yield lineQueue.shift()!;
    }
  }

  const exitCode = await new Promise<number>(r => proc.on('close', (code) => r(code ?? 0)));
  yield `\x00EXIT:${exitCode}`;
}

// Handle the streaming upload endpoint directly on the http response
async function handleStreamingUpload(request: http.IncomingMessage, response: http.ServerResponse, store: InstanceType<typeof LocalStore>) {
  const start = performance.now();
  try {
    const token = getAuthToken(request);
    let project = store.findProjectByToken(token);
    const form = await parseMultipart(request);

    if (!project) {
      const globalToken = store.getGlobalDeployToken();
      if (!globalToken || token !== globalToken) {
        if (form.filePath) await fsp.rm(form.filePath, { force: true });
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Invalid Token' }));
        return;
      }
      project = store.findProjectById(form.fields.projectId);
      if (!project) {
        if (form.filePath) await fsp.rm(form.filePath, { force: true });
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Project not found' }));
        return;
      }
    } else if (form.fields.projectId !== project.id) {
      if (form.filePath) await fsp.rm(form.filePath, { force: true });
      response.writeHead(403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Project ID mismatch' }));
      return;
    }

    if (!form.filePath) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Missing upload file' }));
      return;
    }

    const preDeployCmd = form.fields.preDeploy || project.preDeployScript;
    const postDeployCmd = form.fields.postDeploy || project.postDeployScript;
    const deployLog = store.createDeployment({
      projectId: project.id,
      projectName: project.name,
      status: 'running',
      triggerSource: 'cli',
      startTime: new Date().toISOString(),
      output: ''
    });

    let output = '';
    const appendLog = (line: string) => {
      output += `${line}\n`;
      store.updateDeployment(deployLog.id, { output });
      broadcastToSubscribers(deployLog.id, 'log', JSON.stringify(line));
    };

    // Start streaming response
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked' });
    const sendEvent = (event: string, data: any) => {
      response.write(JSON.stringify({ event, ...data }) + '\n');
    };

    const startedAt = Date.now();
    store.updateProject(project.id, { status: 'running' });

    try {
      await fsp.mkdir(project.deployPath, { recursive: true });
      sendEvent('log', { data: `[Kite Deploy] Starting deployment for ${project.name}...` });
      appendLog(`[Kite Deploy] Starting deployment for ${project.name}...`);
      sendEvent('log', { data: `[Kite Deploy] Target deploy path: ${project.deployPath}` });
      appendLog(`[Kite Deploy] Target deploy path: ${project.deployPath}`);

      if (preDeployCmd) {
        sendEvent('log', { data: `[Kite Deploy] Running Pre-deploy: ${preDeployCmd}` });
        appendLog(`[Kite Deploy] Running Pre-deploy: ${preDeployCmd}`);
        let failed = false;
        for await (const line of runShellCommand(preDeployCmd, project.deployPath)) {
          if (line.startsWith('\x00EXIT:')) {
            if (parseInt(line.slice(6)) !== 0) failed = true;
          } else {
            sendEvent('log', { data: line });
            appendLog(line);
          }
        }
        if (failed) throw new Error('Pre-deploy failed');
      }

      sendEvent('log', { data: '[Kite Deploy] Extracting files...' });
      appendLog('[Kite Deploy] Extracting files...');
      new AdmZip(form.filePath).extractAllTo(project.deployPath, true);

      if (postDeployCmd) {
        sendEvent('log', { data: `[Kite Deploy] Running Post-deploy: ${postDeployCmd}` });
        appendLog(`[Kite Deploy] Running Post-deploy: ${postDeployCmd}`);
        let failed = false;
        for await (const line of runShellCommand(postDeployCmd, project.deployPath)) {
          if (line.startsWith('\x00EXIT:')) {
            if (parseInt(line.slice(6)) !== 0) failed = true;
          } else {
            sendEvent('log', { data: line });
            appendLog(line);
          }
        }
        if (failed) throw new Error('Post-deploy failed');
      }

      const duration = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
      const successMsg = `[Kite Deploy] Deployment completed successfully in ${duration}.`;
      sendEvent('log', { data: successMsg });
      appendLog(successMsg);

      store.updateDeployment(deployLog.id, { status: 'success', duration, endTime: new Date().toISOString() });
      store.updateProject(project.id, { status: 'success' });

      sendEvent('status', { status: 'success', duration, deployId: deployLog.id });
      broadcastToSubscribers(deployLog.id, 'status', JSON.stringify({ status: 'success', duration }));
    } catch (error: any) {
      const duration = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
      const failMsg = `[Kite Deploy] Deployment failed: ${error.message}`;
      sendEvent('log', { data: failMsg });
      appendLog(failMsg);

      store.updateDeployment(deployLog.id, { status: 'failed', duration, endTime: new Date().toISOString() });
      store.updateProject(project.id, { status: 'failed' });

      sendEvent('status', { status: 'failed', duration, deployId: deployLog.id });
      broadcastToSubscribers(deployLog.id, 'status', JSON.stringify({ status: 'failed', duration }));
    } finally {
      if (form.filePath) await fsp.rm(form.filePath, { force: true });
      response.end();
    }
  } catch (error: any) {
    console.error('[Deploy] Error:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
    }
    response.end(JSON.stringify({ error: error.message }));
  }
  const ms = (performance.now() - start).toFixed(0);
  console.log(`POST /api/deploy/upload 200 ${ms}ms`);
}

const serveStatic = async (url: URL) => {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const decoded = decodeURIComponent(requested);
  const filePath = path.resolve(webRoot, decoded.replace(/^\/+/, ''));

  if (!filePath.startsWith(webRoot)) {
    return text(403, 'Forbidden');
  }

  const fallback = path.join(webRoot, 'index.html');
  const target = fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : fallback;

  if (!fs.existsSync(target)) {
    return text(404, 'Kite Web assets not found. Run `bun run build` before packaging the CLI.');
  }

  const ext = path.extname(target);
  const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8'
  };

  return {
    status: 200,
    headers: { 'Content-Type': contentTypes[ext] || 'application/octet-stream' },
    body: await fsp.readFile(target)
  };
};

export async function startLocalServer(options: ServeOptions = {}) {
  const runtime = options.runtime || 'auto';
  const host = options.host || '127.0.0.1';
  const port = Number(options.port || process.env.PORT || 3000);
  const store = new LocalStore();
  const serverUrl = `http://${host}:${port}`;

  if (runtime !== 'auto' && runtime !== 'node' && runtime !== 'bun') {
    throw new Error(`Unsupported runtime: ${runtime}`);
  }

  const handleApi = async (request: http.IncomingMessage, url: URL) => {
    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = JSON.parse(await readBody(request) || '{}');
      if (body.token === store.getAdminToken()) {
        return json(200, { success: true, message: 'Login successful' });
      }
      return json(401, { success: false, message: 'Invalid token' });
    }

    const adminToken = getAuthToken(request);
    if (adminToken !== store.getAdminToken()) {
      return json(401, { error: 'Unauthorized' });
    }

    if (url.pathname === '/api/projects' && request.method === 'GET') {
      return json(200, store.findProjects());
    }

    if (url.pathname === '/api/projects' && request.method === 'POST') {
      const body = JSON.parse(await readBody(request) || '{}');
      return json(200, { success: true, project: store.createProject(body) });
    }

    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch?.[1] && request.method === 'GET') {
      const project = store.findProjectById(projectMatch[1]);
      return project ? json(200, project) : json(404, { error: 'Project not found' });
    }

    if (projectMatch?.[1] && request.method === 'PUT') {
      const body = JSON.parse(await readBody(request) || '{}');
      const project = store.updateProject(projectMatch[1], body);
      return project ? json(200, { success: true, project }) : json(404, { error: 'Project not found' });
    }

    if (projectMatch?.[1] && request.method === 'DELETE') {
      const success = store.removeProject(projectMatch[1]);
      return success ? json(200, { success: true }) : json(404, { error: 'Project not found' });
    }

    const tokenMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/token$/);
    if (tokenMatch?.[1] && request.method === 'POST') {
      const project = store.updateProject(tokenMatch[1], { token: randomToken('kt') });
      return project ? json(200, { success: true, token: project.token }) : json(404, { error: 'Project not found' });
    }

    if (url.pathname === '/api/logs' && request.method === 'GET') {
      return json(200, store.findDeployments());
    }

    const logMatch = url.pathname.match(/^\/api\/logs\/([^/]+)$/);
    if (logMatch?.[1] && request.method === 'GET') {
      const log = store.findDeploymentById(logMatch[1]);
      return log ? json(200, log) : json(404, { error: 'Deployment log not found' });
    }

    // Settings routes
    if (url.pathname === '/api/settings' && request.method === 'GET') {
      return json(200, {
        global_deploy_token: store.getGlobalDeployToken(),
        default_deploy_path: '.deployments',
        max_upload_size: '50',
        webhook_url: '',
        webhook_events: 'deploy_success,deploy_failure'
      });
    }

    if (url.pathname === '/api/settings' && request.method === 'PUT') {
      const body = JSON.parse(await readBody(request) || '{}');
      if (body.global_deploy_token !== undefined) {
        store.updateGlobalDeployToken(String(body.global_deploy_token));
      }
      return json(200, { success: true, message: 'Settings updated' });
    }

    if (url.pathname === '/api/settings/status' && request.method === 'GET') {
      const projects = store.findProjects();
      const deployments = store.findDeployments();
      const successCount = deployments.filter(d => d.status === 'success').length;
      const failedCount = deployments.filter(d => d.status === 'failed').length;
      return json(200, {
        version: '1.0.0',
        uptime: '-',
        projectCount: projects.length,
        deploymentCount: deployments.length,
        successCount,
        failedCount,
        successRate: deployments.length > 0 ? Math.round((successCount / deployments.length) * 100) : 0,
      });
    }

    return json(404, { error: 'Not found' });
  };

  const server = http.createServer(async (request, response) => {
    const start = performance.now();
    try {
      const url = new URL(request.url || '/', serverUrl);

      // Handle SSE stream endpoint
      const sseMatch = url.pathname.match(/^\/api\/logs\/([^/]+)\/stream$/);
      if (sseMatch?.[1] && request.method === 'GET') {
        const adminToken = getAuthToken(request);
        if (adminToken !== store.getAdminToken()) {
          response.writeHead(401, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        const deployId = sseMatch[1];
        const log = store.findDeploymentById(deployId);
        if (!log) {
          response.writeHead(404, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'Deployment log not found' }));
          return;
        }
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        if (log.output) {
          response.write(`event: log\ndata: ${JSON.stringify(log.output)}\n\n`);
        }
        if (log.status !== 'running') {
          response.write(`event: status\ndata: ${JSON.stringify({ status: log.status, duration: log.duration })}\n\n`);
          response.end();
          return;
        }
        if (!deploySubscribers.has(deployId)) deploySubscribers.set(deployId, new Set());
        deploySubscribers.get(deployId)!.add(response);
        request.on('close', () => { deploySubscribers.get(deployId)?.delete(response); });
        return;
      }

      // Handle streaming upload endpoint
      if (url.pathname === '/api/deploy/upload' && request.method === 'POST') {
        await handleStreamingUpload(request, response, store);
        return;
      }

      const result = await handleApi(request, url);
      response.writeHead(result.status, result.headers);
      response.end(result.body);
      const ms = (performance.now() - start).toFixed(0);
      console.log(`${request.method} ${url.pathname} ${result.status} ${ms}ms`);
    } catch (error: any) {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error.message }));
      const ms = (performance.now() - start).toFixed(0);
      console.log(`${request.method} ${request.url} 500 ${ms}ms`);
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  setGlobalConfig('serverUrl', serverUrl);

  console.log(`Kite is running at ${serverUrl}`);
  console.log(`Web console: ${serverUrl}`);
  console.log(`Admin token: ${store.getAdminToken()}`);
  console.log(`Data home: ${store.home}`);
  console.log(`Runtime: ${runtime === 'auto' ? `auto (${process.versions.bun ? 'bun' : 'node'})` : runtime}`);
}
