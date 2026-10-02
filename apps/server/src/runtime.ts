/**
 * Bun/Node runtime compatibility layer.
 * All platform-specific APIs are isolated here.
 */

const isBun = typeof globalThis.Bun !== 'undefined';

// ============ File I/O ============

export async function writeFile(filePath: string, data: ArrayBuffer | Uint8Array): Promise<void> {
  if (isBun) {
    await Bun.write(filePath, data);
    return;
  }
  const fs = await import('node:fs/promises');
  // Buffer.from accepts ArrayBuffer at runtime despite strict types
  await fs.writeFile(filePath, Buffer.from(data as ArrayBuffer));
}

export async function readFileBuffer(filePath: string): Promise<Uint8Array> {
  if (isBun) {
    const file = Bun.file(filePath);
    return new Uint8Array(await file.arrayBuffer());
  }
  const { readFile } = await import('node:fs/promises');
  return readFile(filePath);
}

// ============ Process / Shell ============

export interface SpawnResult {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

const KITE_INTERNAL_ENV_KEYS = [
  'PORT',
  'HOST',
  'ADMIN_TOKEN',
  'KITE_WEB_DIR',
  'KITE_DB_DIR',
  'KITE_HOME',
  'KITE_SERVER_VERSION',
  'KITE_SEED_DEMO_PROJECT',
  'KITE_ARTIFACT_KEEP_N',
] as const;

// 危险 env 键：只对调用方传入的 overrides 生效（继承的 base env 需保留 PATH 等）。
// 避免 CLI 借 body.env 劫持子进程（加载恶意库 / 覆盖可执行文件查找路径等）。
const DANGEROUS_ENV_KEYS = new Set([
  'PATH',
  'SHELL',
  'IFS',
  'ENV',
  'BASH_ENV',
  'CDPATH',
  'ZDOTDIR',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'PYTHONSTARTUP',
  'PYTHONPATH',
  'PERL5OPT',
  'RUBYOPT',
  'GIT_SSH_COMMAND',
]);

function buildChildEnv(overrides?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if ((KITE_INTERNAL_ENV_KEYS as readonly string[]).includes(k)) continue;
    base[k] = v;
  }
  if (!overrides) return base;
  const safeOverrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (DANGEROUS_ENV_KEYS.has(k.toUpperCase())) continue;
    safeOverrides[k] = v;
  }
  return { ...base, ...safeOverrides };
}

export async function spawn(cmd: string, args: string[], options: { cwd?: string; env?: Record<string, string> }): Promise<SpawnResult> {
  const mergedEnv = buildChildEnv(options.env);

  if (isBun) {
    const proc = Bun.spawn([cmd, ...args], {
      cwd: options.cwd,
      env: mergedEnv,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      stdout: proc.stdout,
      stderr: proc.stderr,
      exited: proc.exited,
    };
  }

  // Node.js fallback using child_process
  const nodeCp = await import('node:child_process');
  const proc = nodeCp.spawn(cmd, args, {
    cwd: options.cwd,
    env: mergedEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wrap Node streams into web ReadableStream
  const toWebStream = (nodeStream: NodeJS.ReadableStream): ReadableStream<Uint8Array> => {
    return new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        nodeStream.on('end', () => controller.close());
        nodeStream.on('error', (err: Error) => controller.error(err));
      },
    });
  };

  const exited = new Promise<number>((resolve) => {
    proc.on('close', (code: number | null) => resolve(code ?? 0));
  });

  return {
    stdout: toWebStream(proc.stdout as unknown as NodeJS.ReadableStream),
    stderr: toWebStream(proc.stderr as unknown as NodeJS.ReadableStream),
    exited,
  };
}

// ============ Server ============

export const RUNTIME = isBun ? 'bun' : 'node';
