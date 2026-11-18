// Test runner: bundles the real src/math/affine-focal.ts (and its constants
// dependency) with esbuild, aliasing the types-only `obsidian` package to a
// small stub, then runs the node:test suite against that bundle.
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(here, '.tmp');
mkdirSync(outdir, { recursive: true });

const obsidianStub = {
  name: 'obsidian-stub',
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({
      path: path.join(here, 'obsidian-stub.mjs'),
    }));
  },
};

await esbuild.build({
  entryPoints: [path.join(here, '..', 'src', 'math', 'affine-focal.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  outfile: path.join(outdir, 'affine-focal.mjs'),
  plugins: [obsidianStub],
  logLevel: 'warning',
});

const result = spawnSync(
  process.execPath,
  ['--test', path.join(here, 'affine-focal.test.mjs')],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);
