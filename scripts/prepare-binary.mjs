import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(rootDir, '.build-bin');
const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));

await rm(buildDir, { force: true, recursive: true });
await mkdir(buildDir, { recursive: true });

await build({
  banner: {
    js: "const import_meta_url = require('url').pathToFileURL(__filename).href;",
  },
  bundle: true,
  define: {
    'import.meta.url': 'import_meta_url',
  },
  entryPoints: [path.join(rootDir, 'index.js')],
  format: 'cjs',
  outfile: path.join(buildDir, 'landu.cjs'),
  platform: 'node',
  target: 'node20',
});

await cp(path.join(rootDir, 'client'), path.join(buildDir, 'client'), { recursive: true });
await writeFile(
  path.join(buildDir, 'package.json'),
  `${JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      bin: 'landu.cjs',
      license: packageJson.license,
      pkg: {
        assets: ['client/**/*'],
      },
    },
    null,
    2,
  )}\n`,
);
