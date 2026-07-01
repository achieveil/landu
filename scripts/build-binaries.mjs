import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

await import('./prepare-binary.mjs');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgBin = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'pkg.cmd' : 'pkg');
const targets = process.argv.slice(2);
const defaultTargets = ['node22-linux-x64', 'node22-linux-arm64', 'node22-win-x64'];
const outputName = (target) => {
  if (target === 'host') return process.platform === 'win32' ? 'landu.exe' : 'landu';
  if (target.includes('win')) return 'landu-windows-x64.exe';
  if (target.includes('linux-arm64')) return 'landu-linux-arm64';
  return 'landu-linux-x64';
};

await mkdir(path.join(rootDir, 'dist'), { recursive: true });

for (const target of targets.length ? targets : defaultTargets) {
  const result = spawnSync(
    pkgBin,
    [
      '.build-bin',
      '--no-bytecode',
      '--public-packages',
      '*',
      '--targets',
      target,
      '--output',
      path.join('dist', outputName(target)),
    ],
    { cwd: rootDir, stdio: 'inherit' },
  );
  if (result.status) process.exit(result.status);
}
