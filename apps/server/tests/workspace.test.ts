import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'workspace-fixture.ts');

describe('workspace collaboration layer', () => {
  it('migrates legacy data and enforces scoped workspace workflows', () => {
    const result = spawnSync(process.execPath, [fixture], {
      cwd: path.join(here, '..'),
      env: { ...process.env, KITE_DB_DIR: '' },
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`workspace fixture failed:\n${result.stdout}\n${result.stderr}`);
    }
    expect(result.stdout).toContain('WORKSPACE_FIXTURE_OK');
  });
});
