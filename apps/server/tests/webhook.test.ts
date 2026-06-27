import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { buildPayload, sendWithRetry, type NotifyInput } from '../src/lib/webhook.js';

const baseInput: NotifyInput = {
  event: 'deploy_success',
  trigger: 'cli',
  project: { id: 'proj_demo', name: 'demo-app', deployPath: '/srv/demo' },
  deployment: {
    id: 'deploy-1',
    status: 'success',
    duration: '1.5s',
    startTime: '2026-06-27T00:00:00.000Z',
    endTime: '2026-06-27T00:00:01.500Z',
    rollbackOf: null,
  },
};

describe('webhook.buildPayload', () => {
  it('builds generic JSON payload for unknown host', () => {
    const payload: any = buildPayload(baseInput, 'https://example.com/hook');
    expect(payload.event).toBe('deploy_success');
    expect(payload.trigger).toBe('cli');
    expect(payload.project.id).toBe('proj_demo');
    expect(payload.deployment.id).toBe('deploy-1');
    expect(payload.deployment.rollbackOf).toBeNull();
    expect(typeof payload.timestamp).toBe('string');
  });

  it('builds Feishu post message payload', () => {
    const payload: any = buildPayload(baseInput, 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx');
    expect(payload.msg_type).toBe('post');
    expect(payload.content.post.zh_cn.title).toContain('demo-app');
    expect(payload.content.post.zh_cn.title).toContain('Kite');
    const flat = JSON.stringify(payload.content.post.zh_cn.content);
    expect(flat).toContain('deploy-1');
    expect(flat).toContain('1.5s');
  });

  it('builds Dingtalk markdown payload that includes the "Kite" keyword', () => {
    const payload: any = buildPayload(baseInput, 'https://oapi.dingtalk.com/robot/send?access_token=xxx');
    expect(payload.msgtype).toBe('markdown');
    expect(payload.markdown.title).toContain('Kite');
    expect(payload.markdown.text).toContain('Kite');
    expect(payload.markdown.text).toContain('demo-app');
    expect(payload.markdown.text).toContain('deploy-1');
  });

  it('includes rollbackOf and errorMessage when present', () => {
    const payload: any = buildPayload(
      {
        ...baseInput,
        event: 'deploy_failure',
        deployment: { ...baseInput.deployment, status: 'failed', rollbackOf: 'src-deploy-9' },
        errorMessage: 'boom',
      },
      'https://example.com/hook',
    );
    expect(payload.deployment.rollbackOf).toBe('src-deploy-9');
    expect(payload.errorMessage).toBe('boom');
  });
});

describe('webhook.sendWithRetry', () => {
  let server: http.Server;
  let baseUrl = '';
  const requestLog: { path: string; body: string }[] = [];
  // path -> array of status codes to return on successive hits
  const responseQueue = new Map<string, number[]>();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const url = req.url || '/';
        requestLog.push({ path: url, body });
        const queue = responseQueue.get(url) ?? [200];
        const status = queue.shift() ?? 200;
        responseQueue.set(url, queue);
        res.statusCode = status;
        res.setHeader('Content-Type', 'text/plain');
        res.end(`status=${status}`);
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('resolves success on 2xx in a single attempt', async () => {
    responseQueue.set('/ok', [200]);
    const result = await sendWithRetry(`${baseUrl}/ok`, { ping: 1 });
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.attempts).toBe(1);
  });

  it('retries once on 5xx and succeeds on the second attempt', async () => {
    responseQueue.set('/flaky', [500, 200]);
    const result = await sendWithRetry(`${baseUrl}/flaky`, { ping: 2 });
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.attempts).toBe(2);
    // server got 2 hits on /flaky
    const hits = requestLog.filter(r => r.path === '/flaky').length;
    expect(hits).toBe(2);
  });

  it('gives up after 2 attempts when target keeps returning 500', async () => {
    responseQueue.set('/fail', [500, 500, 500]);
    const result = await sendWithRetry(`${baseUrl}/fail`, { ping: 3 });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.attempts).toBe(2);
    expect(result.error).toBe('HTTP 500');
  });

  it('does not retry on 4xx (client error)', async () => {
    responseQueue.set('/bad', [400, 200]);
    const result = await sendWithRetry(`${baseUrl}/bad`, { ping: 4 });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.attempts).toBe(1);
  });

  it('forwards JSON body to receiver', async () => {
    requestLog.length = 0;
    responseQueue.set('/echo', [200]);
    await sendWithRetry(`${baseUrl}/echo`, { hello: 'world', n: 42 });
    const last = requestLog.find(r => r.path === '/echo');
    expect(last).toBeDefined();
    expect(JSON.parse(last!.body)).toEqual({ hello: 'world', n: 42 });
  });
});
