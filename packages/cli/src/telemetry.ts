// Field list is governed by plan/2026-06-30-f27-telemetry.md §2.
// Adding new fields MUST update the plan first.
import crypto from 'crypto';
import { readGlobalConfig, writeGlobalConfig } from './home.js';

const DEFAULT_TELEMETRY_ENDPOINT = 'https://kite.sugarat.top/api/telemetry';
const REQUEST_TIMEOUT_MS = 3000;

export type TelemetryEndpointSource = 'env' | 'config' | 'default';

export interface TelemetryStatus {
  enabled: boolean;
  instanceId?: string;
  endpoint: string;
  endpointSource: TelemetryEndpointSource;
}

function resolveEndpoint(): { endpoint: string; source: TelemetryEndpointSource } {
  const env = process.env.KITE_TELEMETRY_ENDPOINT?.trim();
  if (env) return { endpoint: env, source: 'env' };
  const cfg = readGlobalConfig().telemetryEndpoint?.trim();
  if (cfg) return { endpoint: cfg, source: 'config' };
  return { endpoint: DEFAULT_TELEMETRY_ENDPOINT, source: 'default' };
}

export function getTelemetryStatus(): TelemetryStatus {
  const config = readGlobalConfig();
  const { endpoint, source } = resolveEndpoint();
  return {
    enabled: config.telemetry === true,
    instanceId: config.telemetryInstanceId,
    endpoint,
    endpointSource: source,
  };
}

export function setTelemetryEnabled(enabled: boolean): { instanceId: string } {
  const config = readGlobalConfig();
  config.telemetry = enabled;
  if (enabled && !config.telemetryInstanceId) {
    config.telemetryInstanceId = crypto.randomUUID();
  }
  writeGlobalConfig(config);
  return { instanceId: config.telemetryInstanceId || '' };
}

export function setTelemetryEndpoint(endpoint: string | null): void {
  const config = readGlobalConfig();
  if (endpoint === null || endpoint === '') {
    delete config.telemetryEndpoint;
  } else {
    config.telemetryEndpoint = endpoint;
  }
  writeGlobalConfig(config);
}

export function getDefaultTelemetryEndpoint(): string {
  return DEFAULT_TELEMETRY_ENDPOINT;
}

function buildPayload(event: 'kite.serve.startup' | 'kite.push.start', kiteVersion: string, instanceId: string) {
  return {
    event,
    ts: Date.now(),
    kiteVersion,
    instanceId,
    os: process.platform,
    arch: process.arch,
  };
}

function fireAndForget(payload: ReturnType<typeof buildPayload>, kiteVersion: string, endpoint: string): void {
  try {
    const body = JSON.stringify(payload);
    const promise = globalThis.fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': `kite-cli/${kiteVersion}`,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    promise.catch(() => {});
  } catch {
    // swallow any synchronous error (e.g. fetch not available); never throw to caller
  }
}

export function reportServeStartup(kiteVersion: string): void {
  const status = getTelemetryStatus();
  if (!status.enabled || !status.instanceId) return;
  const payload = buildPayload('kite.serve.startup', kiteVersion, status.instanceId);
  fireAndForget(payload, kiteVersion, status.endpoint);
}

export function reportPushStart(kiteVersion: string): void {
  const status = getTelemetryStatus();
  if (!status.enabled || !status.instanceId) return;
  const payload = buildPayload('kite.push.start', kiteVersion, status.instanceId);
  fireAndForget(payload, kiteVersion, status.endpoint);
}
