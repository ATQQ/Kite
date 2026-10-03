import { describe, test, expect } from 'bun:test';
import {
  parseHookCommands,
  pickRecentScripts,
  type DeploymentSnapshotLike,
} from '../src/lib/recent-scripts.js';

describe('parseHookCommands - 日志行格式兼容', () => {
  test('新版带时间戳前缀的 [Kite Deploy] post hook', () => {
    const output = [
      '2026-10-02T11:19:49.547Z [Kite Deploy] Starting deployment for ssr-basic...',
      '2026-10-02T11:19:49.555Z [Kite Deploy] Running Post-deploy: echo ssr-basic deployed && ls',
    ].join('\n');
    expect(parseHookCommands(output)).toEqual({
      preDeploy: null,
      postDeploy: 'echo ssr-basic deployed && ls',
    });
  });

  test('旧版无时间戳的 [Kite Deploy] pre/post hook', () => {
    const output = [
      '[Kite Deploy] Starting deployment for example-api...',
      '[Kite Deploy] Running Pre-deploy: pnpm install',
      '[Kite Deploy] Running Post-deploy: bash scripts/kite/post-deploy-pm2.sh',
      '[Kite Deploy] Deployment completed successfully in 0.0s.',
    ].join('\n');
    expect(parseHookCommands(output)).toEqual({
      preDeploy: 'pnpm install',
      postDeploy: 'bash scripts/kite/post-deploy-pm2.sh',
    });
  });

  test('初始版本无 Kite 前缀的 [Deploy] hook（兼容）', () => {
    const output = [
      '[Deploy] Received zip for project: 测试',
      '[Deploy] Running Pre-deploy: echo pre',
      '[Deploy] Running Post-deploy: echo post',
      '[Deploy] Error:',
    ].join('\n');
    expect(parseHookCommands(output)).toEqual({
      preDeploy: 'echo pre',
      postDeploy: 'echo post',
    });
  });

  test('回滚日志的 [Kite Rollback] hook', () => {
    const output = [
      '[Kite Rollback] Running Pre-deploy: npm run build',
      '[Kite Rollback] Running Post-deploy: pm2 restart app',
    ].join('\n');
    expect(parseHookCommands(output)).toEqual({
      preDeploy: 'npm run build',
      postDeploy: 'pm2 restart app',
    });
  });

  test('异步 post-deploy 的 Dispatching 行', () => {
    const output = '2026-07-06T03:45:28.000Z [Kite Deploy] Dispatching Post-deploy asynchronously (not waiting): nohup node server.js &';
    expect(parseHookCommands(output)).toEqual({
      preDeploy: null,
      postDeploy: 'nohup node server.js &',
    });
  });

  test('同一日志出现多次时取最后一次', () => {
    const output = [
      '[Kite Deploy] Running Post-deploy: first',
      '[Kite Deploy] Running Post-deploy: second',
    ].join('\n');
    expect(parseHookCommands(output).postDeploy).toBe('second');
  });

  test('命令首尾空白被 trim', () => {
    const output = '[Kite Deploy] Running Pre-deploy:    npm ci   ';
    expect(parseHookCommands(output).preDeploy).toBe('npm ci');
  });

  test('不以行首 marker 起始的行不匹配（避免误伤正文）', () => {
    const output = [
      'some output mentioning [Kite Deploy] Running Post-deploy: not-a-hook',
      '[Kite Deploy] Extracting files...',
      '[Kite Deploy] Running Post-deploy: real-cmd',
    ].join('\n');
    expect(parseHookCommands(output)).toEqual({
      preDeploy: null,
      postDeploy: 'real-cmd',
    });
  });

  test('空 / null 输出返回双 null', () => {
    expect(parseHookCommands('')).toEqual({ preDeploy: null, postDeploy: null });
    expect(parseHookCommands(undefined as unknown as string)).toEqual({ preDeploy: null, postDeploy: null });
  });
});

function deploy(patch: Partial<DeploymentSnapshotLike> & Pick<DeploymentSnapshotLike, 'id' | 'startTime' | 'status'>): DeploymentSnapshotLike {
  return { output: '', ...patch };
}

describe('pickRecentScripts - 选择最近含 hook 的成功部署', () => {
  test('history 为空返回 null', () => {
    expect(pickRecentScripts([])).toBeNull();
  });

  test('没有任何 success 返回 null', () => {
    const history = [
      deploy({ id: 'd1', startTime: '2026-06-01T00:00:00.000Z', status: 'failed' }),
      deploy({ id: 'd2', startTime: '2026-06-02T00:00:00.000Z', status: 'running' }),
    ];
    expect(pickRecentScripts(history)).toBeNull();
  });

  test('最近成功部署有结构化快照时优先返回 structured', () => {
    const history = [
      deploy({
        id: 'd1',
        startTime: '2026-06-02T00:00:00.000Z',
        status: 'success',
        preDeployScript: 'npm ci',
        postDeployScript: 'pm2 restart app',
        output: '[Kite Deploy] Running Post-deploy: should-be-ignored',
      }),
    ];
    expect(pickRecentScripts(history)).toEqual({
      deployId: 'd1',
      deployedAt: '2026-06-02T00:00:00.000Z',
      source: 'structured',
      preDeploy: 'npm ci',
      postDeploy: 'pm2 restart app',
    });
  });

  test('结构化快照仅含 post 时 pre 为 null', () => {
    const history = [
      deploy({
        id: 'd1',
        startTime: '2026-06-02T00:00:00.000Z',
        status: 'success',
        preDeployScript: null,
        postDeployScript: 'echo done',
      }),
    ];
    expect(pickRecentScripts(history)?.source).toBe('structured');
    expect(pickRecentScripts(history)).toMatchObject({ preDeploy: null, postDeploy: 'echo done' });
  });

  test('最近成功部署无 hook 时回溯到更早成功部署（结构化）', () => {
    const history = [
      deploy({ id: 'new', startTime: '2026-07-06T00:00:00.000Z', status: 'success' }),
      deploy({ id: 'old', startTime: '2026-06-14T00:00:00.000Z', status: 'success', postDeployScript: 'bash post.sh' }),
    ];
    expect(pickRecentScripts(history)).toEqual({
      deployId: 'old',
      deployedAt: '2026-06-14T00:00:00.000Z',
      source: 'structured',
      preDeploy: null,
      postDeploy: 'bash post.sh',
    });
  });

  test('最近成功部署无 hook 时回溯到更早成功部署（日志解析）', () => {
    const history = [
      deploy({ id: 'new', startTime: '2026-07-06T00:00:00.000Z', status: 'success' }),
      deploy({
        id: 'old',
        startTime: '2026-06-14T00:00:00.000Z',
        status: 'success',
        output: '[Kite Deploy] Running Post-deploy: bash scripts/kite/post-deploy-pm2.sh',
      }),
    ];
    expect(pickRecentScripts(history)).toEqual({
      deployId: 'old',
      deployedAt: '2026-06-14T00:00:00.000Z',
      source: 'parsed',
      preDeploy: null,
      postDeploy: 'bash scripts/kite/post-deploy-pm2.sh',
    });
  });

  test('中间夹着失败/进行中的部署不影响回溯', () => {
    const history = [
      deploy({ id: 'new', startTime: '2026-07-06T00:00:00.000Z', status: 'success' }),
      deploy({ id: 'fail', startTime: '2026-06-20T00:00:00.000Z', status: 'failed', output: '[Kite Deploy] Running Post-deploy: nope' }),
      deploy({ id: 'old', startTime: '2026-06-14T00:00:00.000Z', status: 'success', preDeployScript: 'npm ci' }),
    ];
    expect(pickRecentScripts(history)).toMatchObject({
      deployId: 'old',
      source: 'structured',
      preDeploy: 'npm ci',
    });
  });

  test('回溯命中的是「最近一条含 hook 的」，不跨部署拼接', () => {
    const history = [
      deploy({ id: 'newest', startTime: '2026-07-06T00:00:00.000Z', status: 'success' }),
      deploy({ id: 'mid', startTime: '2026-06-20T00:00:00.000Z', status: 'success', postDeployScript: 'post-only' }),
      deploy({ id: 'oldest', startTime: '2026-06-14T00:00:00.000Z', status: 'success', preDeployScript: 'pre-only' }),
    ];
    expect(pickRecentScripts(history)).toMatchObject({
      deployId: 'mid',
      preDeploy: null,
      postDeploy: 'post-only',
    });
  });

  test('所有成功部署都无 hook 时返回 none，锚定最近一次成功部署', () => {
    const history = [
      deploy({ id: 'new', startTime: '2026-07-06T00:00:00.000Z', status: 'success' }),
      deploy({ id: 'old', startTime: '2026-06-14T00:00:00.000Z', status: 'success' }),
    ];
    expect(pickRecentScripts(history)).toEqual({
      deployId: 'new',
      deployedAt: '2026-07-06T00:00:00.000Z',
      source: 'none',
      preDeploy: null,
      postDeploy: null,
    });
  });

  test('兼容旧格式 [Deploy] 日志作为回溯来源', () => {
    const history = [
      deploy({ id: 'new', startTime: '2026-07-06T00:00:00.000Z', status: 'success' }),
      deploy({
        id: 'old',
        startTime: '2026-06-14T00:00:00.000Z',
        status: 'success',
        output: '[Deploy] Running Post-deploy: echo legacy',
      }),
    ];
    expect(pickRecentScripts(history)).toMatchObject({
      deployId: 'old',
      source: 'parsed',
      postDeploy: 'echo legacy',
    });
  });
});
