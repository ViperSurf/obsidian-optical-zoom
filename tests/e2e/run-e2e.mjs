// E2E test runner: bundles src/engine/pane-zoom-controller.ts for the browser
// (aliasing `obsidian` to tests/obsidian-stub.mjs) and runs node --test on
// tests/e2e/mobile-touch.test.mjs.
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const outdir = path.join(root, 'tests', '.tmp');
mkdirSync(outdir, { recursive: true });

const obsidianStub = {
  name: 'obsidian-stub',
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({
      path: path.join(root, 'tests', 'obsidian-stub.mjs'),
    }));
  },
};

await esbuild.build({
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  plugins: [obsidianStub],
  logLevel: 'warning',
  entryPoints: [path.join(root, 'src', 'engine', 'pane-zoom-controller.ts')],
  outfile: path.join(outdir, 'pane-zoom-controller.browser.mjs'),
});

const result = spawnSync(
  process.execPath,
  ['--test', path.join(here, 'mobile-touch.test.mjs')],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);
