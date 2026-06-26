#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  // Find node-pty installation (works in both ESM and CommonJS)
  let nodePtyPath;
  try {
    if (typeof import.meta.resolve === 'function') {
      // ESM compatible (Node ≥16, Bun)
      const resolved = import.meta.resolve('node-pty/package.json');
      nodePtyPath = path.dirname(fileURLToPath(resolved));
    } else if (typeof require !== 'undefined') {
      // CommonJS fallback
      nodePtyPath = path.dirname(require.resolve('node-pty/package.json'));
    } else {
      throw new Error('Unable to resolve node-pty');
    }
  } catch (e) {
    console.log('node-pty not found, skipping chmod');
    process.exit(0);
  }

  const prebuildsDir = path.join(nodePtyPath, 'prebuilds');

  if (!fs.existsSync(prebuildsDir)) {
    console.log('node-pty prebuilds directory not found, skipping chmod');
    process.exit(0);
  }

  // Find all spawn-helper files in prebuilds subdirectories
  const platforms = fs.readdirSync(prebuildsDir);
  for (const platform of platforms) {
    const platformDir = path.join(prebuildsDir, platform);
    if (!fs.statSync(platformDir).isDirectory()) continue;

    const spawnHelper = path.join(platformDir, 'spawn-helper');
    if (!fs.existsSync(spawnHelper)) continue;

    try {
      fs.chmodSync(spawnHelper, 0o755);
      console.log(`chmod +x ${spawnHelper}`);
    } catch (e) {
      console.warn(`Failed to chmod ${spawnHelper}:`, e.message);
    }
  }
} catch (e) {
  // Ignore all errors - if this fails, node-pty might still work on some systems
  console.warn('Postinstall failed (non-critical):', e.message);
}
