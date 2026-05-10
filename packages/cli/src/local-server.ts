import fs from 'fs';
import fsp from 'fs/promises';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
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

    const busboy = Busboy({ headers: request.headers });

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

const runShellCommand = (command: string, cwd: string) => {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    exec(command, { cwd, shell: '/bin/sh' }, (error, stdout, stderr) => {
      resolve({
        stdout,
        stderr,
        exitCode: typeof (error as NodeJS.ErrnoException | null)?.code === 'number'
          ? Number((error as NodeJS.ErrnoException).code)
          : 0
      });
    });
  });
};

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

    if (url.pathname === '/api/deploy/upload' && request.method === 'POST') {
      const token = getAuthToken(request);
      let project = store.findProjectByToken(token);

      const form = await parseMultipart(request);

      if (!project) {
        // Fallback: 检查全局部署 token
        const globalToken = store.getGlobalDeployToken();
        if (!globalToken || token !== globalToken) {
          if (form.filePath) await fsp.rm(form.filePath, { force: true });
          return json(403, { error: 'Invalid Token' });
        }
        // 全局 token 匹配，通过 projectId 查找项目
        project = store.findProjectById(form.fields.projectId);
        if (!project) {
          if (form.filePath) await fsp.rm(form.filePath, { force: true });
          return json(404, { error: 'Project not found' });
        }
      } else if (form.fields.projectId !== project.id) {
        if (form.filePath) await fsp.rm(form.filePath, { force: true });
        return json(403, { error: 'Project ID mismatch' });
      }

      if (!form.filePath) return json(400, { error: 'Missing upload file' });

      const preDeployCmd = form.fields.preDeploy || project.preDeployScript;
      const postDeployCmd = form.fields.postDeploy || project.postDeployScript;
      const deployLog = store.createDeployment({
        projectId: project.id,
        projectName: project.name,
        status: 'running',
        triggerSource: 'cli',
        startTime: new Date().toISOString(),
        output: `[Kite Deploy] Starting deployment for ${project.name}...\n`
      });

      let output = deployLog.output;
      const appendLog = (line: string) => {
        output += `${line}\n`;
        store.updateDeployment(deployLog.id, { output });
      };

      const startedAt = Date.now();
      store.updateProject(project.id, { status: 'running' });

      try {
        await fsp.mkdir(project.deployPath, { recursive: true });
        appendLog(`[Kite Deploy] Target deploy path: ${project.deployPath}`);

        if (preDeployCmd) {
          appendLog(`[Kite Deploy] Running Pre-deploy: ${preDeployCmd}`);
          const result = await runShellCommand(preDeployCmd, project.deployPath);
          if (result.stdout) appendLog(result.stdout.trimEnd());
          if (result.exitCode !== 0) {
            if (result.stderr) appendLog(result.stderr.trimEnd());
            throw new Error('Pre-deploy failed');
          }
        }

        appendLog('[Kite Deploy] Extracting files...');
        new AdmZip(form.filePath).extractAllTo(project.deployPath, true);

        if (postDeployCmd) {
          appendLog(`[Kite Deploy] Running Post-deploy: ${postDeployCmd}`);
          const result = await runShellCommand(postDeployCmd, project.deployPath);
          if (result.stdout) appendLog(result.stdout.trimEnd());
          if (result.exitCode !== 0) {
            if (result.stderr) appendLog(result.stderr.trimEnd());
            throw new Error('Post-deploy failed');
          }
        }

        const duration = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
        appendLog(`[Kite Deploy] Deployment completed successfully in ${duration}.`);
        store.updateDeployment(deployLog.id, { status: 'success', duration, endTime: new Date().toISOString() });
        store.updateProject(project.id, { status: 'success' });
        await fsp.rm(form.filePath, { force: true });
        return json(200, { success: true, message: 'Deployed successfully' });
      } catch (error: any) {
        const duration = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
        appendLog(`[Kite Deploy] Deployment failed: ${error.message}`);
        store.updateDeployment(deployLog.id, { status: 'failed', duration, endTime: new Date().toISOString() });
        store.updateProject(project.id, { status: 'failed' });
        await fsp.rm(form.filePath, { force: true });
        return json(500, { error: error.message });
      }
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
    try {
      const url = new URL(request.url || '/', serverUrl);
      const result = url.pathname.startsWith('/api/')
        ? await handleApi(request, url)
        : await serveStatic(url);

      response.writeHead(result.status, result.headers);
      response.end(result.body);
    } catch (error: any) {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error.message }));
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
