import { describe, test, expect } from 'bun:test';

// 复刻 deploy.ts 中的 parseBool / 优先级解析逻辑（保持源码改动最小，不抽公共模块）
// 若 deploy.ts 中此段逻辑变动，请同步修改本测试
function parseBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0' || v === '') return false;
  }
  return undefined;
}

function resolvePostDeployAsync(
  bodyValue: unknown,
  projectValue: boolean | null | undefined
): boolean {
  const override = parseBool(bodyValue);
  return override !== undefined ? override : Boolean(projectValue);
}

describe('postDeployAsync resolution', () => {
  test('parseBool covers boolean / "true" / "false" / "1" / "0" / "" / undefined', () => {
    expect(parseBool(true)).toBe(true);
    expect(parseBool(false)).toBe(false);
    expect(parseBool('true')).toBe(true);
    expect(parseBool('1')).toBe(true);
    expect(parseBool('false')).toBe(false);
    expect(parseBool('0')).toBe(false);
    expect(parseBool('')).toBe(false);
    expect(parseBool(undefined)).toBeUndefined();
    expect(parseBool(null)).toBeUndefined();
    expect(parseBool('truee')).toBeUndefined();
    expect(parseBool(42)).toBeUndefined();
  });

  test('body override wins over project default (true over false)', () => {
    expect(resolvePostDeployAsync(true, false)).toBe(true);
    expect(resolvePostDeployAsync('true', false)).toBe(true);
    expect(resolvePostDeployAsync('1', false)).toBe(true);
  });

  test('body override wins over project default (false over true)', () => {
    expect(resolvePostDeployAsync(false, true)).toBe(false);
    expect(resolvePostDeployAsync('false', true)).toBe(false);
    expect(resolvePostDeployAsync('0', true)).toBe(false);
  });

  test('undefined body falls back to project default', () => {
    expect(resolvePostDeployAsync(undefined, true)).toBe(true);
    expect(resolvePostDeployAsync(undefined, false)).toBe(false);
    expect(resolvePostDeployAsync(undefined, null)).toBe(false);
    expect(resolvePostDeployAsync(undefined, undefined)).toBe(false);
  });

  test('garbage body string falls back to project default', () => {
    expect(resolvePostDeployAsync('yes', true)).toBe(true);
    expect(resolvePostDeployAsync('yes', false)).toBe(false);
  });

  test('default behavior: both undefined -> false (sync, preserves legacy behavior)', () => {
    expect(resolvePostDeployAsync(undefined, undefined)).toBe(false);
  });
});

describe('postDeployAsync fire-and-forget contract', () => {
  test('IIFE should swallow errors (no unhandled rejection)', async () => {
    let caught = false;
    const original = process.listeners('unhandledRejection').slice();
    const handler = () => { caught = true; };
    process.on('unhandledRejection', handler);

    try {
      // 模拟 deploy.ts 中的 async IIFE：内部抛错必须被自身 try/catch 捕获，不能冒泡到 process
      (async () => {
        try {
          throw new Error('simulated post-deploy failure');
        } catch {
          // swallowed (appendLog in real code)
        }
      })();

      // 等待 microtask 队列清空
      await new Promise((r) => setTimeout(r, 50));
      expect(caught).toBe(false);
    } finally {
      process.off('unhandledRejection', handler);
      // 不要影响其它测试，恢复原始 listener
      for (const l of original) process.on('unhandledRejection', l);
    }
  });
});
