// Test runner: bundles the real src/math/affine-focal.ts (and its constants
// dependency) and src/input/gesture-guards.ts with esbuild, aliasing the
// types-only `obsidian` package to a small stub, then runs the node:test
// suites against those bundles.
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

const bundleOpts = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  plugins: [obsidianStub],
  logLevel: 'warning',
};

await esbuild.build({
  ...bundleOpts,
  entryPoints: [path.join(here, '..', 'src', 'math', 'affine-focal.ts')],
  outfile: path.join(outdir, 'affine-focal.mjs'),
});

await esbuild.build({
  ...bundleOpts,
  entryPoints: [path.join(here, '..', 'src', 'input', 'gesture-guards.ts')],
  outfile: path.join(outdir, 'gesture-guards.mjs'),
});

const result = spawnSync(
  process.execPath,
  [
    '--test',
    path.join(here, 'affine-focal.test.mjs'),
    path.join(here, 'gesture-guards.test.mjs'),
  ],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);
