#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const electronVersion = '33.4.11';
const supportedArchs = new Set(['x64', 'arm64']);
const requestedArchs = process.argv
  .slice(2)
  .map((arg) => arg.replace(/^--/, ''))
  .filter((arg) => supportedArchs.has(arg));
const archs = requestedArchs.length > 0 ? requestedArchs : ['x64', 'arm64'];

const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

/**
 * electron-builder 以 package.json 中 build.mac.target[].arch 列表为准，
 * 即使 CLI 传了 --x64/--arm64 也会把列表里的架构全部打包。
 * 若不临时固定为单架构，后一次 rebuild（如 arm64）打包时会连同前一架构一起覆盖，
 * 导致 x64 包内混入 arm64 的 better-sqlite3 原生模块（Intel Mac 上无法加载）。
 * 这里在每次打包前把 arch 临时改成当前架构，打包后恢复。
 */
function withSingleArch(arch, fn) {
  const original = JSON.parse(readFileSync(pkgPath, 'utf8'));
  try {
    const patched = structuredClone(original);
    patched.build.mac.target[0].arch = [arch];
    writeFileSync(pkgPath, JSON.stringify(patched, null, 2) + '\n');
    console.log('[build:mac] package.json mac.target.arch temporarily set to ["' + arch + '"]');
    fn();
  } finally {
    writeFileSync(pkgPath, JSON.stringify(original, null, 2) + '\n');
    console.log('[build:mac] package.json mac.target.arch restored');
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error('[build:mac] ' + command + ' failed: ' + result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('node', ['scripts/prebuild-clean.mjs']);

for (const arch of archs) {
  console.log('[build:mac] rebuilding better-sqlite3 for ' + arch);
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

  console.log('[build:mac] packaging ' + arch + ' DMG');
  withSingleArch(arch, () => {
    run('node', ['./node_modules/electron-builder/cli.js', '--mac', '--' + arch]);
  });

  // ad-hoc 签名已改为 electron-builder afterPack 钩子(scripts/afterSign.cjs),
  // 在 DMG 打包前对 .app 签名, 保证安装包内即是已签名应用。
}
