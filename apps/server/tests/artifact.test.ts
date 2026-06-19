import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let TEST_HOME: string;

beforeAll(async () => {
  TEST_HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'kite-artifact-'));
  process.env.KITE_DB_DIR = TEST_HOME;
  process.env.KITE_SEED_DEMO_PROJECT = 'false';
});

afterAll(async () => {
  await fs.rm(TEST_HOME, { recursive: true, force: true });
});

async function makeFakeZip(p: string, bytes: number): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, Buffer.alloc(bytes, 0x42));
}

describe('artifact', () => {
  test('archiveZip copies into ~/.kite/deployments/<projectId>/artifacts/<id>.zip', async () => {
    const { archiveZip, artifactDir, artifactPathFor } = await import('../src/lib/artifact.js');
    const projectId = 'proj_arch_1';
    const deployId = 'd_one';
    const src = path.join(TEST_HOME, 'tmp', `${deployId}.zip`);
    await makeFakeZip(src, 1024);
    const res = await archiveZip({ projectId, deployId, sourceZip: src });
    expect(res.artifactPath).toBe(artifactPathFor(projectId, deployId));
    expect(res.artifactSize).toBe(1024);
    const stat = await fs.stat(res.artifactPath);
    expect(stat.size).toBe(1024);
    expect(artifactDir(projectId).startsWith(TEST_HOME)).toBe(true);
  });

  test('gcArtifacts keeps newest N, removes the rest by reference count', async () => {
    const { db } = await import('../src/db/index.js');
    const { archiveZip, gcArtifacts, artifactPathFor } = await import('../src/lib/artifact.js');

    const projectId = 'proj_gc_1';
    await db.projects.create({
      id: projectId,
      name: 'GC Project',
      description: '',
      deployPath: path.join(TEST_HOME, 'site-gc'),
      token: 'kt_gctest',
      preDeployScript: '',
      postDeployScript: '',
    });

    const deployIds = ['d_a', 'd_b', 'd_c', 'd_d'];
    let t = Date.now() - 4000;
    for (const id of deployIds) {
      const src = path.join(TEST_HOME, 'tmp', `${id}.zip`);
      await makeFakeZip(src, 100);
      const arch = await archiveZip({ projectId, deployId: id, sourceZip: src });
      await db.deployments.insert({
        id,
        projectId,
        projectName: 'GC Project',
        status: 'success',
        triggerSource: 'cli',
        startTime: new Date(t).toISOString(),
        artifactPath: arch.artifactPath,
        artifactSize: arch.artifactSize,
      });
      t += 1000;
    }

    // Rollback of d_a shares the same artifactPath (newest by startTime)
    await db.deployments.insert({
      id: 'd_a_rb',
      projectId,
      projectName: 'GC Project',
      status: 'success',
      triggerSource: 'rollback',
      startTime: new Date(t).toISOString(),
      artifactPath: artifactPathFor(projectId, 'd_a'),
      artifactSize: 100,
      rollbackOf: 'd_a',
    });

    // Sorted by startTime desc → [d_a_rb, d_d, d_c, d_b, d_a]
    // Rollback rows are excluded from keepN accounting → normal = [d_d, d_c, d_b, d_a]
    // keepN=2 → keep [d_d, d_c], stale = [d_b, d_a]
    // d_a's file is still referenced by d_a_rb → preserved.
    const result = await gcArtifacts({ projectId, keepN: 2 });
    expect(result.inspected).toBe(5);
    expect(result.detached).toBe(2);
    expect(result.removedFiles).toBe(1);
    expect(result.preserved).toBe(1);

    await expect(fs.access(artifactPathFor(projectId, 'd_b'))).rejects.toThrow();
    await fs.access(artifactPathFor(projectId, 'd_c')); // d_c zip kept (within keepN of normal rows)
    await fs.access(artifactPathFor(projectId, 'd_a')); // d_a zip still present (referenced by rollback)
    await fs.access(artifactPathFor(projectId, 'd_d')); // d_d zip still present (within keepN)
  });

  test('reconcileArtifacts clears DB references when file disappears', async () => {
    const { db } = await import('../src/db/index.js');
    const { archiveZip, reconcileArtifacts, artifactPathFor } = await import('../src/lib/artifact.js');

    const projectId = 'proj_rec_1';
    await db.projects.create({
      id: projectId,
      name: 'Rec',
      description: '',
      deployPath: path.join(TEST_HOME, 'site-rec'),
      token: 'kt_rectest',
      preDeployScript: '',
      postDeployScript: '',
    });
    const src = path.join(TEST_HOME, 'tmp', 'd_x.zip');
    await makeFakeZip(src, 50);
    const arch = await archiveZip({ projectId, deployId: 'd_x', sourceZip: src });
    await db.deployments.insert({
      id: 'd_x',
      projectId,
      projectName: 'Rec',
      status: 'success',
      triggerSource: 'cli',
      startTime: new Date().toISOString(),
      artifactPath: arch.artifactPath,
      artifactSize: arch.artifactSize,
    });

    await fs.unlink(artifactPathFor(projectId, 'd_x'));
    const res = await reconcileArtifacts(projectId);
    expect(res.scanned).toBe(1);
    expect(res.cleared).toBe(1);
    const row = await db.deployments.findById('d_x');
    expect(row.artifactPath).toBeNull();
  });
});
