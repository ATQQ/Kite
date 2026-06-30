// Field list is governed by plan/2026-06-30-f27-telemetry.md §2.
// Adding new fields MUST update the plan first.
import crypto from 'crypto';
import { readGlobalConfig, writeGlobalConfig } from './home.js';

const TELEMETRY_ENDPOINT = 'https://kite.sugarat.top/api/telemetry';
const REQUEST_TIMEOUT_MS = 3000;

export interface TelemetryStatus {
  enabled: boolean;
  instanceId?: string;
}

export function getTelemetryStatus(): TelemetryStatus {
  const config = readGlobalConfig();
  return {
    enabled: config.telemetry === true,
    instanceId: config.telemetryInstanceId,
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

function fireAndForget(payload: ReturnType<typeof buildPayload>, kiteVersion: string): void {
  try {
    const body = JSON.stringify(payload);
    const promise = globalThis.fetch(TELEMETRY_ENDPOINT, {
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
  fireAndForget(payload, kiteVersion);
}

export function reportPushStart(kiteVersion: string): void {
  const status = getTelemetryStatus();
  if (!status.enabled || !status.instanceId) return;
  const payload = buildPayload('kite.push.start', kiteVersion, status.instanceId);
  fireAndForget(payload, kiteVersion);
}
