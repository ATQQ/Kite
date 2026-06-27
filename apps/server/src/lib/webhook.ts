import { db } from '../db/index.js';
import { writeAudit } from './audit.js';
import { moduleLogger } from './logger.js';

const webhookLog = moduleLogger('webhook');

const REQUEST_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 1000;
const MAX_ATTEMPTS = 2;

export type DeployEvent = 'deploy_success' | 'deploy_failure';
export type DeployTrigger = 'cli' | 'rollback' | 'manual' | 'async_post_deploy';

export interface NotifyInput {
  event: DeployEvent;
  trigger: DeployTrigger;
  project: {
    id: string;
    name: string;
    deployPath: string;
  };
  deployment: {
    id: string;
    status: string;
    duration: string | null;
    startTime: string;
    endTime: string | null;
    rollbackOf?: string | null;
  };
  errorMessage?: string | null;
}

export interface SendResult {
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  attempts: number;
  error?: string;
}

function getHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function maskUrl(url: string): string {
  const host = getHost(url);
  return host ? `https://${host}/****` : '****';
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatTimeForHuman(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function emoji(event: DeployEvent): string {
  return event === 'deploy_success' ? '✅' : '❌';
}

function statusText(event: DeployEvent): string {
  return event === 'deploy_success' ? '部署成功' : '部署失败';
}

function triggerText(trigger: DeployTrigger): string {
  switch (trigger) {
    case 'cli': return 'CLI';
    case 'rollback': return '回滚';
    case 'manual': return '手动标记';
    case 'async_post_deploy': return '异步 postDeploy';
    default: return String(trigger);
  }
}

function buildGenericPayload(input: NotifyInput): unknown {
  return {
    event: input.event,
    trigger: input.trigger,
    project: input.project,
    deployment: {
      id: input.deployment.id,
      status: input.deployment.status,
      duration: input.deployment.duration,
      startTime: input.deployment.startTime,
      endTime: input.deployment.endTime,
      rollbackOf: input.deployment.rollbackOf ?? null,
    },
    errorMessage: input.errorMessage ?? null,
    timestamp: timestamp(),
  };
}

function buildFeishuPayload(input: NotifyInput): unknown {
  const title = `Kite ${emoji(input.event)} ${input.project.name} ${statusText(input.event)}`;
  const lines: { tag: 'text'; text: string }[][] = [
    [{ tag: 'text', text: `部署 ID：${input.deployment.id}` }],
    [{ tag: 'text', text: `项目：${input.project.name}（${input.project.id}）` }],
    [{ tag: 'text', text: `部署路径：${input.project.deployPath}` }],
    [{ tag: 'text', text: `耗时：${input.deployment.duration ?? '-'}` }],
    [{ tag: 'text', text: `触发源：${triggerText(input.trigger)}` }],
    [{ tag: 'text', text: `时间：${formatTimeForHuman(input.deployment.endTime || input.deployment.startTime)}` }],
  ];
  if (input.deployment.rollbackOf) {
    lines.push([{ tag: 'text', text: `回滚自：${input.deployment.rollbackOf}` }]);
  }
  if (input.errorMessage) {
    lines.push([{ tag: 'text', text: `错误：${input.errorMessage}` }]);
  }
  return {
    msg_type: 'post',
    content: {
      post: {
        zh_cn: {
          title,
          content: lines,
        },
      },
    },
  };
}

function buildDingtalkPayload(input: NotifyInput): unknown {
  const title = 'Kite 部署通知';
  const headLine = `**Kite** ${emoji(input.event)} 项目 \`${input.project.name}\` ${statusText(input.event)}`;
  const rows = [
    `- 部署 ID：\`${input.deployment.id}\``,
    `- 部署路径：\`${input.project.deployPath}\``,
    `- 耗时：${input.deployment.duration ?? '-'}`,
    `- 触发源：${triggerText(input.trigger)}`,
    `- 时间：${formatTimeForHuman(input.deployment.endTime || input.deployment.startTime)}`,
  ];
  if (input.deployment.rollbackOf) {
    rows.push(`- 回滚自：\`${input.deployment.rollbackOf}\``);
  }
  if (input.errorMessage) {
    rows.push(`- 错误：${input.errorMessage}`);
  }
  return {
    msgtype: 'markdown',
    markdown: {
      title,
      text: `${headLine}\n\n${rows.join('\n')}`,
    },
  };
}

export function buildPayload(input: NotifyInput, url: string): unknown {
  const host = getHost(url).toLowerCase();
  if (host.endsWith('feishu.cn') || host.endsWith('larksuite.com')) {
    return buildFeishuPayload(input);
  }
  if (host.endsWith('dingtalk.com')) {
    return buildDingtalkPayload(input);
  }
  return buildGenericPayload(input);
}

function createTimeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  if (typeof (AbortSignal as any).timeout === 'function') {
    return { signal: (AbortSignal as any).timeout(ms), cancel: () => {} };
  }
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(handle) };
}

async function sendOnce(url: string, payload: unknown): Promise<{ status: number }> {
  const { signal, cancel } = createTimeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    return { status: res.status };
  } finally {
    cancel();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendWithRetry(url: string, payload: unknown): Promise<SendResult> {
  const startedAt = Date.now();
  let attempts = 0;
  let lastError: string | undefined;
  let lastStatus: number | null = null;

  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const { status } = await sendOnce(url, payload);
      lastStatus = status;
      if (status >= 200 && status < 300) {
        return { success: true, statusCode: status, durationMs: Date.now() - startedAt, attempts };
      }
      lastError = `HTTP ${status}`;
      if (status < 500 && status !== 408 && status !== 429) {
        break;
      }
    } catch (err: any) {
      lastError = err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err));
    }
    if (attempts < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  return {
    success: false,
    statusCode: lastStatus,
    durationMs: Date.now() - startedAt,
    attempts,
    error: lastError,
  };
}

async function readSettings(): Promise<{ url: string; events: Set<string> }> {
  const url = (await db.settings.get('webhook_url')) || '';
  const rawEvents = (await db.settings.get('webhook_events')) || '';
  const events = new Set(
    rawEvents.split(',').map(s => s.trim()).filter(Boolean),
  );
  return { url, events };
}

// Fire-and-forget deployment notification. Never throws.
export async function notifyDeployment(input: NotifyInput): Promise<void> {
  try {
    const { url, events } = await readSettings();
    if (!url) return;
    if (!events.has(input.event)) return;

    const payload = buildPayload(input, url);
    const result = await sendWithRetry(url, payload);

    if (result.success) {
      webhookLog.info(
        {
          event: input.event,
          trigger: input.trigger,
          projectId: input.project.id,
          deployId: input.deployment.id,
          host: getHost(url),
          status: result.statusCode,
          ms: result.durationMs,
          attempts: result.attempts,
        },
        'webhook delivered',
      );
      return;
    }

    webhookLog.warn(
      {
        event: input.event,
        trigger: input.trigger,
        projectId: input.project.id,
        deployId: input.deployment.id,
        host: getHost(url),
        status: result.statusCode,
        ms: result.durationMs,
        attempts: result.attempts,
        err: result.error,
      },
      'webhook delivery failed',
    );

    await writeAudit({}, {
      action: 'webhook.send_failed',
      targetType: 'webhook',
      targetId: input.deployment.id,
      targetName: input.project.name,
      summary: `Webhook 投递失败（${maskUrl(url)}，事件 ${input.event}，重试 ${result.attempts} 次）`,
      status: 'failed',
      errorMessage: result.error || `HTTP ${result.statusCode}`,
      after: {
        event: input.event,
        trigger: input.trigger,
        host: getHost(url),
        statusCode: result.statusCode,
        attempts: result.attempts,
        durationMs: result.durationMs,
      },
    });
  } catch (err: any) {
    webhookLog.error({ err: { name: err?.name, message: err?.message } }, 'unexpected webhook error');
  }
}

// Synchronous variant used by the test endpoint: awaits result and returns details.
export async function sendTestWebhook(): Promise<SendResult & { skipped?: 'no_url' }> {
  const { url } = await readSettings();
  if (!url) {
    return { success: false, statusCode: null, durationMs: 0, attempts: 0, skipped: 'no_url', error: 'webhook_url is empty' };
  }
  const sample: NotifyInput = {
    event: 'deploy_success',
    trigger: 'manual',
    project: { id: 'proj_sample', name: 'kite-sample', deployPath: '/var/www/sample' },
    deployment: {
      id: 'test-' + Date.now(),
      status: 'success',
      duration: '0.1s',
      startTime: new Date(Date.now() - 100).toISOString(),
      endTime: new Date().toISOString(),
      rollbackOf: null,
    },
    errorMessage: null,
  };
  const payload = buildPayload(sample, url);
  const result = await sendWithRetry(url, payload);
  webhookLog.info(
    {
      host: getHost(url),
      status: result.statusCode,
      ms: result.durationMs,
      attempts: result.attempts,
      success: result.success,
    },
    'webhook test send',
  );
  return result;
}
