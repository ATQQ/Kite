import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';

const ADMIN_TOKEN = 'test-workspace-admin';
const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'kite-workspace-layer-'));

process.env.KITE_DB_DIR = HOME;
process.env.KITE_SEED_DEMO_PROJECT = 'false';
process.env.ADMIN_TOKEN = ADMIN_TOKEN;

const legacy = createClient({ url: `file:${path.join(HOME, 'kite.db')}` });
await legacy.execute(`
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    deploy_path TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    pre_deploy_script TEXT,
    post_deploy_script TEXT,
    post_deploy_async INTEGER DEFAULT 0,
    allow_cli_hooks INTEGER DEFAULT 0,
    env TEXT,
    status TEXT DEFAULT 'idle',
    clean_mode TEXT,
    protect_paths TEXT,
    category_id TEXT,
    pm2_app_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
await legacy.execute(`
  CREATE TABLE deployments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    status TEXT NOT NULL,
    trigger_source TEXT NOT NULL,
    duration TEXT,
    output TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT
  );
`);
await legacy.execute(`
  INSERT INTO projects (id, name, deploy_path, token, env, status, created_at, updated_at)
  VALUES ('proj_legacy_ws', 'Legacy Workspace App', '/tmp/legacy-ws', 'kt_legacy_ws', 'prod', 'idle',
          '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
`);
await legacy.execute(`
  INSERT INTO deployments (id, project_id, project_name, status, trigger_source, start_time)
  VALUES ('dep_legacy_ws', 'proj_legacy_ws', 'Legacy Workspace App', 'success', 'cli', '2026-01-03T00:00:00.000Z');
`);
legacy.close();

const { db } = await import('../../src/db/index.js');
const { workspaceStore } = await import('../../src/db/workspace-store.js');
const { workspaceRoutes } = await import('../../src/routes/workspaces.js');

function api(
  pathname: string,
  init: RequestInit = {},
  token = ADMIN_TOKEN,
  agent?: string,
) {
  const headers: Record<string, string> = {
    ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
    authorization: `Bearer ${token}`,
    ...(agent ? { 'x-kite-agent': agent } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  return workspaceRoutes.handle(new Request(`http://localhost${pathname}`, { ...init, headers }));
}

async function json(response: Response) {
  return await response.json() as any;
}

const legacyProject = await db.projects.findById('proj_legacy_ws');
assert.ok(legacyProject, 'legacy project should survive workspace migrations');
assert.equal(legacyProject!.name, 'Legacy Workspace App');

const createdWorkspace = await api('/api/workspaces', {
  method: 'POST',
  body: JSON.stringify({ name: 'Product Workspace', description: 'Cross-project delivery' }),
});
assert.equal(createdWorkspace.status, 200);
const workspacePayload = await json(createdWorkspace);
assert.match(workspacePayload.token, /^wst_/);
assert.equal(typeof workspacePayload.workspace.createdAt, 'string');
const workspaceId = String(workspacePayload.workspace.id);
const workspaceToken = String(workspacePayload.token);

const detail = await api(`/api/workspaces/${workspaceId}`, {}, workspaceToken, 'cursor');
assert.equal(detail.status, 200);
const detailPayload = await json(detail);
assert.equal(detailPayload.projectCount, undefined);
assert.equal(Array.isArray(detailPayload.requirements), true);
assert.equal(Array.isArray(detailPayload.documents), true);
assert.equal(detailPayload.agents.length, 6);
assert.equal(typeof detailPayload.createdAt, 'string');

const link = await api(`/api/workspaces/${workspaceId}/projects/proj_legacy_ws`, {
  method: 'PUT',
  body: JSON.stringify({ role: 'backend', sortOrder: 1 }),
});
assert.equal(link.status, 200);
const linkPayload = await json(link);
assert.equal(linkPayload.link.workspaceId, workspaceId);
assert.equal(linkPayload.link.projectId, 'proj_legacy_ws');

const requirementResponse = await api(`/api/workspaces/${workspaceId}/requirements`, {
  method: 'POST',
  body: JSON.stringify({
    title: 'Ship workspace collaboration',
    description: 'Implement requirements, tasks and documents.',
    priority: 'P1',
    acceptanceCriteria: 'CLI and Web stay in sync',
    projectIds: ['proj_legacy_ws'],
    tags: ['workspace', 'cli'],
  }),
});
assert.equal(requirementResponse.status, 200);
const requirementPayload = await json(requirementResponse);
const requirementId = String(requirementPayload.requirement.id);
assert.equal(requirementPayload.requirement.effectiveStatus, 'draft');
assert.deepEqual(requirementPayload.requirement.projectIds, ['proj_legacy_ws']);
assert.deepEqual(requirementPayload.requirement.tags.map((tag: any) => tag.name).sort(), ['cli', 'workspace']);

const taskResponse = await api(`/api/workspaces/${workspaceId}/tasks`, {
  method: 'POST',
  body: JSON.stringify({
    requirementId,
    title: 'Build task lifecycle',
    description: 'Atomic claim and activity log',
    assignedProvider: 'cursor',
  }),
});
assert.equal(taskResponse.status, 200);
const taskPayload = await json(taskResponse);
const taskId = String(taskPayload.task.id);
assert.equal(taskPayload.task.status, 'todo');
assert.equal(taskPayload.task.assignedProvider, 'cursor');

const inbox = await api(`/api/workspaces/${workspaceId}/tasks`, {}, workspaceToken, 'cursor');
assert.equal(inbox.status, 200);
assert.equal((await json(inbox)).some((task: any) => task.id === taskId), true);

const claimCursor = await api(`/api/workspaces/${workspaceId}/tasks/${taskId}/claim`, {
  method: 'POST',
  body: JSON.stringify({}),
}, workspaceToken, 'cursor');
assert.equal(claimCursor.status, 200);
assert.equal((await json(claimCursor)).task.status, 'claimed');

const claimClaude = await api(`/api/workspaces/${workspaceId}/tasks/${taskId}/claim`, {
  method: 'POST',
  body: JSON.stringify({}),
}, workspaceToken, 'claude');
assert.equal(claimClaude.status, 409);

const wrongOwner = await api(`/api/workspaces/${workspaceId}/tasks/${taskId}`, {
  method: 'PUT',
  body: JSON.stringify({ status: 'in_progress' }),
}, workspaceToken, 'claude');
assert.equal(wrongOwner.status, 403);

const progressResponse = await api(`/api/workspaces/${workspaceId}/tasks/${taskId}`, {
  method: 'PUT',
  body: JSON.stringify({ status: 'in_progress', progress: 35, summary: 'API wiring complete' }),
}, workspaceToken, 'cursor');
assert.equal(progressResponse.status, 200);
const progressPayload = await json(progressResponse);
assert.equal(progressPayload.task.status, 'in_progress');
assert.equal(progressPayload.task.progress, 35);
assert.ok(progressPayload.task.activities.some((activity: any) => activity.kind === 'claimed'));
assert.ok(progressPayload.task.activities.some((activity: any) => activity.summary === 'API wiring complete'));

const inProgressRequirement = await api(`/api/workspaces/${workspaceId}/requirements/${requirementId}`);
assert.equal((await json(inProgressRequirement)).effectiveStatus, 'in_progress');

const workingAgents = await api(`/api/workspaces/${workspaceId}/agents`);
const workingAgentPayload = await json(workingAgents);
assert.equal(workingAgentPayload.find((agent: any) => agent.provider === 'cursor').state, 'working');

const doneResponse = await api(`/api/workspaces/${workspaceId}/tasks/${taskId}`, {
  method: 'PUT',
  body: JSON.stringify({ status: 'done', progress: 100, summary: 'Merged' }),
}, workspaceToken, 'cursor');
assert.equal(doneResponse.status, 200);
const doneRequirement = await api(`/api/workspaces/${workspaceId}/requirements/${requirementId}`);
assert.equal((await json(doneRequirement)).effectiveStatus, 'done');

const manualBlocked = await api(`/api/workspaces/${workspaceId}/requirements/${requirementId}`, {
  method: 'PUT',
  body: JSON.stringify({ statusMode: 'manual', manualStatus: 'blocked' }),
});
assert.equal(manualBlocked.status, 200);
assert.equal((await json(manualBlocked)).requirement.effectiveStatus, 'blocked');

const unassignedTaskResponse = await api(`/api/workspaces/${workspaceId}/tasks`, {
  method: 'POST',
  body: JSON.stringify({ requirementId, title: 'Unassigned follow-up' }),
});
const unassignedTaskId = String((await json(unassignedTaskResponse)).task.id);
const firstClaim = await api(`/api/workspaces/${workspaceId}/tasks/${unassignedTaskId}/claim`, {
  method: 'POST',
  body: JSON.stringify({}),
}, workspaceToken, 'claude');
assert.equal(firstClaim.status, 200);
assert.equal((await json(firstClaim)).task.assignedProvider, 'claude');
const release = await api(`/api/workspaces/${workspaceId}/tasks/${unassignedTaskId}/release`, {
  method: 'POST',
  body: JSON.stringify({}),
}, workspaceToken, 'claude');
assert.equal(release.status, 200);
assert.equal((await json(release)).task.status, 'todo');

const documentResponse = await api(`/api/workspaces/${workspaceId}/documents`, {
  method: 'POST',
  body: JSON.stringify({
    title: 'Implementation notes',
    kind: 'spec',
    contentMarkdown: '# Version 1',
    links: [{ targetType: 'requirement', targetId: requirementId }],
  }),
}, workspaceToken, 'cursor');
assert.equal(documentResponse.status, 200);
const documentPayload = await json(documentResponse);
const documentId = String(documentPayload.document.id);
const firstRevisionId = String(documentPayload.document.currentRevisionId);
assert.equal(documentPayload.document.revisions.length, 1);
assert.equal(documentPayload.document.links[0].targetId, requirementId);

const staleRevision = await api(`/api/workspaces/${workspaceId}/documents/${documentId}/revisions`, {
  method: 'POST',
  body: JSON.stringify({ contentMarkdown: '# Stale', baseRevisionId: 'rev_missing' }),
}, workspaceToken, 'cursor');
assert.equal(staleRevision.status, 409);

const revision = await api(`/api/workspaces/${workspaceId}/documents/${documentId}/revisions`, {
  method: 'POST',
  body: JSON.stringify({ contentMarkdown: '# Version 2', baseRevisionId: firstRevisionId }),
}, workspaceToken, 'cursor');
assert.equal(revision.status, 200);
const revisionPayload = await json(revision);
assert.equal(revisionPayload.revision.revisionNumber, 2);

const staleAgain = await api(`/api/workspaces/${workspaceId}/documents/${documentId}/revisions`, {
  method: 'POST',
  body: JSON.stringify({ contentMarkdown: '# Conflict', baseRevisionId: firstRevisionId }),
}, workspaceToken, 'cursor');
assert.equal(staleAgain.status, 409);

const assetDocumentResponse = await api(`/api/workspaces/${workspaceId}/documents`, {
  method: 'POST',
  body: JSON.stringify({ title: 'Asset notes', kind: 'design', contentMarkdown: '![pixel](asset://pending)' }),
}, workspaceToken, 'cursor');
const assetDocumentId = String((await json(assetDocumentResponse)).document.id);

const form = new FormData();
form.append('file', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'pixel.png', { type: 'image/png' }));
const assetResponse = await api(`/api/workspaces/${workspaceId}/documents/${assetDocumentId}/assets`, {
  method: 'POST',
  body: form,
}, workspaceToken, 'cursor');
assert.equal(assetResponse.status, 200);
const assetPayload = await json(assetResponse);
assert.equal(assetPayload.asset.originalName, 'pixel.png');
assert.equal(assetPayload.asset.mime, 'image/png');

const assetRead = await api(`/api/workspaces/${workspaceId}/assets/${assetPayload.asset.id}`, {}, workspaceToken, 'cursor');
assert.equal(assetRead.status, 200);
assert.equal(assetRead.headers.get('content-type'), 'image/png');

const invalidAssetForm = new FormData();
invalidAssetForm.append('file', new File(['hello'], 'note.txt', { type: 'text/plain' }));
const invalidAsset = await api(`/api/workspaces/${workspaceId}/documents/${assetDocumentId}/assets`, {
  method: 'POST',
  body: invalidAssetForm,
}, workspaceToken, 'cursor');
assert.equal(invalidAsset.status, 400);

const archiveDocument = await api(`/api/workspaces/${workspaceId}/documents/${documentId}`, { method: 'DELETE' });
assert.equal(archiveDocument.status, 200);
const archivedDocument = await api(`/api/workspaces/${workspaceId}/documents/${documentId}`);
assert.equal(archivedDocument.status, 404);
assert.equal((await workspaceStore.documents.listRevisions(documentId)).length, 2, 'archiving preserves revisions');

const forbiddenRotate = await api(`/api/workspaces/${workspaceId}/token/rotate`, { method: 'POST' }, workspaceToken);
assert.equal(forbiddenRotate.status, 403);

const rotated = await api(`/api/workspaces/${workspaceId}/token/rotate`, { method: 'POST' });
assert.equal(rotated.status, 200);
const rotatedToken = String((await json(rotated)).token);
assert.notEqual(rotatedToken, workspaceToken);

const oldToken = await api(`/api/workspaces/${workspaceId}`, {}, workspaceToken, 'cursor');
assert.equal(oldToken.status, 401);
const newToken = await api(`/api/workspaces/${workspaceId}`, {}, rotatedToken, 'cursor');
assert.equal(newToken.status, 200);

await fs.rm(HOME, { recursive: true, force: true });
console.log('WORKSPACE_FIXTURE_OK');
