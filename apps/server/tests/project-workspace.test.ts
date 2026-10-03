import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'project-workspace-fixture.ts');

// The db module binds its connection to KITE_DB_DIR at import time, so the
// workspace assertions (legacy migration, pin/last-opened, saved-view CRUD) run
// in a dedicated bun process with an isolated database.
describe('project workspace', () => {
  it('migrates legacy databases and exposes pin / last-opened / saved-view APIs', () => {
    const env = { ...process.env };
    delete env.KITE_DB_DIR;
    const result = spawnSync(process.execPath, [fixture], {
      cwd: path.join(here, '..'),
      env,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`project workspace fixture failed:\n${result.stdout}\n${result.stderr}`);
    }
    expect(result.stdout).toContain('PROJECT_WORKSPACE_FIXTURE_OK');
  });
});
