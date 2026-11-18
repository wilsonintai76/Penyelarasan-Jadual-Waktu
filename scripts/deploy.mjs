#!/usr/bin/env node
/**
 * Deploys the Worker while stamping the app version into Worker runtime vars,
 * so /api/version always matches package.json.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const builtAt = new Date().toISOString();
const wranglerPackage = createRequire(import.meta.url).resolve('wrangler/package.json');
const wranglerBin = path.join(path.dirname(wranglerPackage), 'bin', 'wrangler.js');

console.log(`Deploying ${pkg.name} v${pkg.version} (built ${builtAt})`);

execFileSync(
  process.execPath,
  [
    wranglerBin,
    'deploy',
    '--var',
    `APP_VERSION:${pkg.version}`,
    '--var',
    `APP_BUILT_AT:${builtAt}`
  ],
  { cwd: root, stdio: 'inherit' }
);
