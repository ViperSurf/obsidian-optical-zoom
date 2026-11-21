import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readText(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

function listTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('manifest.json, package.json, and versions.json stay aligned without v-prefix', () => {
  const manifest = JSON.parse(readText('manifest.json'));
  const pkg = JSON.parse(readText('package.json'));
  const versions = JSON.parse(readText('versions.json'));

  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, manifest.version);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
  assert.equal(pkg.dependencies, undefined, 'Plugin should have zero runtime dependencies');
  assert.equal(pkg.devDependencies?.['builtin-modules'], undefined, 'Use node:module instead of builtin-modules');
});

test('styles.css avoids !important declarations', () => {
  const css = readText('styles.css');
  assert.equal(css.includes('!important'), false, 'styles.css must not use !important');
});

test('src/ avoids Obsidian review red flags (innerHTML, document.createElement, default hotkeys)', () => {
  const files = listTsFiles(path.join(rootDir, 'src'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file);
    assert.equal(/\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b/.test(src), false, `${rel}: disallowed HTML injection`);
    assert.equal(/\beval\(|new Function\b|console\.log\b/.test(src), false, `${rel}: disallowed eval/console.log`);
    assert.equal(/\bdocument\.createElement\b/.test(src), false, `${rel}: use createEl/createDiv instead of document.createElement`);
  }
  const mainTs = readText('src/main.ts');
  assert.equal(/\bhotkeys\s*:/.test(mainTs), false, 'src/main.ts must not bind default command hotkeys');
});

test('release workflow attests assets and attaches only required Obsidian files', () => {
  const yml = readText('.github/workflows/release.yml');
  assert.ok(yml.includes('attest-build-provenance'), 'release.yml must attest build provenance');
  assert.equal(yml.includes('.zip'), false, 'release.yml must not attach unsupported zip files');
});
