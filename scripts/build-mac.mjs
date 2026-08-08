#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const electronVersion = '33.4.11';
const supportedArchs = new Set(['x64', 'arm64']);
const requestedArchs = process.argv
  .slice(2)
  .map((arg) => arg.replace(/^--/, ''))
  .filter((arg) => supportedArchs.has(arg));
const archs = requestedArchs.length > 0 ? requestedArchs : ['x64', 'arm64'];

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(`[build:mac] ${command} failed: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('node', ['scripts/prebuild-clean.mjs']);

for (const arch of archs) {
  console.log(`[build:mac] rebuilding better-sqlite3 for ${arch}`);
  run('node', [
    './node_modules/@electron/rebuild/lib/cli.js',
    '-f',
    '-w',
    'better-sqlite3',
    '-v',
    electronVersion,
    '-a',
    arch,
  ]);

  console.log(`[build:mac] packaging ${arch} DMG`);
  run('node', ['./node_modules/electron-builder/cli.js', '--mac', `--${arch}`]);
}
