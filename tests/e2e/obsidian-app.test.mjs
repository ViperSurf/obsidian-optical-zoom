import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const DEFAULT_OBSIDIAN_EXE = path.resolve(root, '..', 'Obsidian', 'Obsidian.exe');
const OBSIDIAN_EXE = process.env.OBSIDIAN_EXE || DEFAULT_OBSIDIAN_EXE;
const HAS_OBSIDIAN = fs.existsSync(OBSIDIAN_EXE);

function buildLongMarkdownNote() {
  const lines = ['# Optical Zoom Real-Obsidian Stress Test\n'];
  for (let i = 1; i <= 35; i++) {
    lines.push(`## Section ${i}: Long Note & Table Stress Test`);
    lines.push(
      `Paragraph ${i}: Testing true GPU optical zoom without text reflow, ` +
        `inline math $x_{${i}} + y^2 = z_k$, and CJK/Arabic: 光学ズームテスト • اختبار التكبير البصري.`
    );
    if (i % 5 === 0) {
      lines.push('');
      lines.push('| Col A | Col B | Col C | Col D | Col E | Col F | Col G | Col H |');
      lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
      lines.push(`| R${i}.1 | Val101 | Val202 | Val303 | Val404 | Val505 | Val606 | End${i} |`);
      lines.push(`| R${i}.2 | Val107 | Val208 | Val309 | Val410 | Val511 | Val612 | End${i} |`);
      lines.push('');
    }
    if (i % 6 === 0) {
      lines.push('```ts');
      lines.push(`export const sample${i} = (tx: number, ty: number, scale: number) => tx + ty * scale;`);
      lines.push('```');
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function connectWithRetry(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(url);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastErr;
}

describe('Real Obsidian Desktop + Mobile-Emulated Integration E2E', { skip: !HAS_OBSIDIAN && `Obsidian.exe not found at ${OBSIDIAN_EXE}` }, () => {
  let userDataDir;
  let obsidianProc;
  let browser;
  let page;
  let cdp;
  const pageErrors = [];

  async function touchDrag(fromX, fromY, toX, toY, steps = 8, stepDelayMs = 14) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: fromX, y: fromY, id: 1 }],
    });
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(fromX + ((toX - fromX) * i) / steps);
      const y = Math.round(fromY + ((toY - fromY) * i) / steps);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y, id: 1 }],
      });
      if (stepDelayMs > 0) await page.waitForTimeout(stepDelayMs);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(24);
  }

  async function twoFingerPinch(cx, cy, startHalfDist, endHalfDist, steps = 10) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: Math.round(cx - startHalfDist), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + startHalfDist), y: Math.round(cy), id: 2 },
      ],
    });
    for (let i = 1; i <= steps; i++) {
      const d = startHalfDist + ((endHalfDist - startHalfDist) * i) / steps;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: Math.round(cx - d), y: Math.round(cy), id: 1 },
          { x: Math.round(cx + d), y: Math.round(cy), id: 2 },
        ],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(40);
  }

  async function twoFingerTap(cx, cy) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: Math.round(cx - 30), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 30), y: Math.round(cy), id: 2 },
      ],
    });
    await page.waitForTimeout(30);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  async function setLeafMode(mode) {
    await page.evaluate(async (m) => {
      const leaf = window.app.workspace.getMostRecentLeaf();
      const st = leaf.getViewState();
      await leaf.setViewState({ ...st, state: { ...st.state, mode: m } });
      window.app.workspace.trigger('layout-change');
    }, mode);
    const sel =
      mode === 'preview'
        ? '.oz-zoom-host .markdown-reading-view:not([style*="display: none"]) .markdown-preview-view'
        : '.oz-zoom-host .cm-scroller';
    await page.waitForSelector(sel, { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(200);
  }

  async function resetZoomAndScroll() {
    await page.evaluate(() => {
      window.app.commands.executeCommandById('optical-zoom:reset-zoom');
      const vp =
        document.querySelector('.oz-zoom-host .markdown-reading-view:not([style*="display: none"]) .markdown-preview-view') ||
        document.querySelector('.oz-zoom-host .cm-scroller');
      if (vp) vp.scrollTop = 0;
    });
    await page.waitForTimeout(180);
  }

  async function getEdges(mode) {
    return page.evaluate((m) => {
      const vpSel =
        m === 'preview'
          ? '.oz-zoom-host .markdown-reading-view .markdown-preview-view'
          : '.oz-zoom-host .cm-scroller';
      const sizerSel =
        m === 'preview'
          ? '.oz-zoom-host .markdown-reading-view .markdown-preview-sizer'
          : '.oz-zoom-host .cm-sizer';
      const vpEl = document.querySelector(vpSel);
      const sizerEl = document.querySelector(sizerSel);
      const vp = vpEl.getBoundingClientRect();
      const sizer = sizerEl.getBoundingClientRect();
      const match = /scale\(([-\d.]+)\)/.exec(sizerEl.style.transform || '');
      const scale = match ? parseFloat(match[1]) : 1;
      const contentWidth = Math.max(sizerEl.offsetWidth, sizerEl.scrollWidth);
      return {
        vpLeft: vp.left,
        vpRight: vp.right,
        vpTop: vp.top,
        vpBottom: vp.bottom,
        sizerLeft: sizer.left,
        sizerRight: sizer.left + contentWidth * scale,
        sizerTop: sizer.top,
        sizerBottom: sizer.bottom,
        scrollTop: vpEl.scrollTop,
        cancels: window.__ozTouchCancels || 0,
      };
    }, mode);
  }

  async function assertWheelReachesAllFourEdges(mode) {
    for (let i = 0; i < 80; i++) {
      const e = await getEdges(mode);
      if (e.sizerBottom <= e.vpBottom + 4) break;
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(12);
    }
    const atBottom = await getEdges(mode);
    assert.ok(atBottom.scrollTop > 400, `${mode}: expected deep scrollTop at bottom, got ${atBottom.scrollTop}`);

    for (let i = 0; i < 80; i++) {
      const e = await getEdges(mode);
      if (e.sizerTop >= e.vpTop - 4 && e.scrollTop === 0) break;
      await page.mouse.wheel(0, -600);
      await page.waitForTimeout(12);
    }
    assert.equal((await getEdges(mode)).scrollTop, 0, `${mode}: expected scrollTop === 0 at full top`);

    for (let i = 0; i < 20; i++) {
      const e = await getEdges(mode);
      if (e.sizerRight <= e.vpRight + 4) break;
      await page.mouse.wheel(250, 0);
      await page.waitForTimeout(12);
    }
    const atRight = await getEdges(mode);
    assert.ok(
      Math.abs(atRight.sizerRight - atRight.vpRight) <= 8,
      `${mode}: expected full right flush (${atRight.sizerRight} vs ${atRight.vpRight})`
    );

    for (let i = 0; i < 20; i++) {
      const e = await getEdges(mode);
      if (e.sizerLeft >= e.vpLeft - 4) break;
      await page.mouse.wheel(-250, 0);
      await page.waitForTimeout(12);
    }
    const atLeft = await getEdges(mode);
    assert.ok(
      Math.abs(atLeft.sizerLeft - atLeft.vpLeft) <= 8,
      `${mode}: expected full left flush (${atLeft.sizerLeft} vs ${atLeft.vpLeft})`
    );
  }

  async function assertTouchReachesAllFourEdges(mode, box, { fastVertical = false, fastRight = true } = {}) {
    const midX = Math.round(box.x + box.width / 2);
    const topY = Math.round(box.y + 80);
    const botY = Math.round(box.y + box.height - 80);
    const leftX = Math.round(box.x + 36);
    const rightX = Math.round(box.x + box.width - 36);
    const midY = Math.round(box.y + box.height / 2);

    const vSteps = fastVertical ? 4 : 6;
    const vDelay = fastVertical ? 8 : 12;
    const rSteps = fastRight ? 2 : 10;
    const rDelay = fastRight ? 4 : 12;

    for (let i = 0; i < 120; i++) {
      const e = await getEdges(mode);
      if (e.sizerBottom <= e.vpBottom + 4) break;
      await touchDrag(midX, botY, midX, topY, vSteps, vDelay);
    }
    const atBottom = await getEdges(mode);
    assert.ok(atBottom.scrollTop > 400, `${mode} touch: expected deep scrollTop, got ${atBottom.scrollTop}`);

    for (let i = 0; i < 200; i++) {
      const e = await getEdges(mode);
      if (e.sizerTop >= e.vpTop - 4 && e.scrollTop === 0) break;
      await touchDrag(midX, topY, midX, botY, vSteps, vDelay);
    }
    const atTop = await getEdges(mode);
    assert.equal(
      atTop.scrollTop,
      0,
      `${mode} touch: expected scrollTop === 0 at top (atBottom=${JSON.stringify(atBottom)}, atTop=${JSON.stringify(atTop)})`
    );

    for (let i = 0; i < 12; i++) {
      const e = await getEdges(mode);
      if (e.sizerRight <= e.vpRight + 4) break;
      await touchDrag(rightX, midY, leftX, midY, rSteps, rDelay);
    }
    await page.waitForTimeout(220);
    const atRight = await getEdges(mode);
    assert.ok(
      atRight.sizerRight <= atRight.vpRight + 8 && atRight.sizerRight >= atRight.vpRight - 40,
      `${mode} touch: expected full right flush (${atRight.sizerRight} vs ${atRight.vpRight})`
    );
    await touchDrag(rightX, midY, leftX, midY, 2, 4);
    await page.waitForTimeout(220);
    assert.ok(Math.abs((await getEdges(mode)).sizerRight - atRight.sizerRight) < 2);

    for (let i = 0; i < 12; i++) {
      const e = await getEdges(mode);
      if (e.sizerLeft >= e.vpLeft - 4) break;
      await touchDrag(leftX, midY, rightX, midY, 10, 14);
    }
    await page.waitForTimeout(220);
    const atLeft = await getEdges(mode);
    assert.ok(
      Math.abs(atLeft.sizerLeft - atLeft.vpLeft) <= 8,
      `${mode} touch: expected full left flush (${atLeft.sizerLeft} vs ${atLeft.vpLeft})`
    );
    await touchDrag(leftX, midY, rightX, midY, 2, 4);
    await page.waitForTimeout(220);
    assert.ok(Math.abs((await getEdges(mode)).sizerLeft - atLeft.sizerLeft) < 2);
    assert.equal(atLeft.cancels, 0);
  }

  before(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oz-obsidian-e2e-'));
    const vaultDir = path.join(userDataDir, 'TestVault');
    const pluginDir = path.join(vaultDir, '.obsidian', 'plugins', 'optical-zoom');
    fs.mkdirSync(pluginDir, { recursive: true });

    for (const file of ['main.js', 'manifest.json', 'styles.css']) {
      fs.copyFileSync(path.join(root, file), path.join(pluginDir, file));
    }
    fs.writeFileSync(path.join(vaultDir, '.obsidian', 'community-plugins.json'), JSON.stringify(['optical-zoom']));
    fs.writeFileSync(path.join(vaultDir, '.obsidian', 'app.json'), JSON.stringify({ livePreview: true, readableLineLength: true }));
    fs.writeFileSync(path.join(vaultDir, 'LongTestNote.md'), buildLongMarkdownNote(), 'utf8');
    fs.writeFileSync(
      path.join(userDataDir, 'obsidian.json'),
      JSON.stringify({ vaults: { oztest: { path: vaultDir, ts: Date.now(), open: true } } })
    );

    const port = 9232;
    obsidianProc = spawn(
      OBSIDIAN_EXE,
      [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
      { stdio: 'ignore' }
    );

    browser = await connectWithRetry(`http://127.0.0.1:${port}`, 25000);
    const ctx = browser.contexts()[0];
    page = ctx.pages()[0] || (await ctx.waitForEvent('page'));
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.waitForFunction(() => Boolean(window.app?.workspace?.layoutReady), { timeout: 20000 });
    await page.evaluate(async () => {
      if (window.app?.plugins) {
        if (!window.app.plugins.isEnabled?.()) await window.app.plugins.setEnable(true);
        await window.app.plugins.loadManifests();
        if (!window.app.plugins.enabledPlugins.has('optical-zoom')) {
          await window.app.plugins.enablePluginAndSave('optical-zoom');
        }
      }
      const file = window.app.vault.getAbstractFileByPath('LongTestNote.md');
      if (file) {
        const leaf = window.app.workspace.getLeaf(false);
        await leaf.openFile(file);
        await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source' } });
      }
      window.app.workspace.trigger('layout-change');
    });
    await page.waitForSelector('.oz-zoom-host .cm-scroller', { timeout: 15000 });
    await page.evaluate(() => {
      document.querySelectorAll('.modal-container').forEach((m) => m.remove());
      window.__ozTouchCancels = 0;
      window.__ozWorkspaceTouchMoves = 0;
      document.addEventListener('touchcancel', () => {
        window.__ozTouchCancels++;
      });
      const ws = document.querySelector('.workspace');
      if (ws) {
        ws.addEventListener('touchmove', () => {
          window.__ozWorkspaceTouchMoves++;
        });
      }
    });
    cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  });

  after(async () => {
    try {
      await browser?.close();
    } catch {}
    try {
      obsidianProc?.kill();
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
    if (userDataDir) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {}
    }
  });

  beforeEach(async () => {
    pageErrors.length = 0;
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await page.evaluate(() => {
      window.app.workspace.leftSplit?.collapse();
      window.app.workspace.rightSplit?.collapse();
    });
    await setLeafMode('source');
    await resetZoomAndScroll();
    await page.evaluate(() => {
      window.__ozTouchCancels = 0;
      window.__ozWorkspaceTouchMoves = 0;
    });
  });

  it('loads optical-zoom in real Obsidian and attaches .oz-zoom-host', async () => {
    const info = await page.evaluate(() => ({
      enabled: window.app.plugins.enabledPlugins.has('optical-zoom'),
      hasHost: Boolean(document.querySelector('.oz-zoom-host')),
      hasScroller: Boolean(document.querySelector('.oz-zoom-host .cm-scroller')),
    }));
    assert.equal(info.enabled, true);
    assert.equal(info.hasHost, true);
    assert.equal(info.hasScroller, true);
    assert.deepEqual(pageErrors, []);
  });

  it('Windows Desktop Editing View: Ctrl+Wheel zoom, status pill, 4-edge wheel pan, and pill reset', async () => {
    const box = await page.locator('.oz-zoom-host .cm-scroller').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -120);
      await page.keyboard.up('Control');
      await page.waitForTimeout(20);
    }

    const zoomed = await page.evaluate(() => ({
      isZoomed: document.querySelector('.oz-zoom-host')?.classList.contains('oz-is-zoomed') ?? false,
      pillHidden: document.querySelector('.oz-status-pill')?.classList.contains('oz-hidden') ?? true,
      pillText: document.querySelector('.oz-status-pill')?.textContent || '',
    }));
    assert.equal(zoomed.isZoomed, true);
    assert.equal(zoomed.pillHidden, false);
    assert.ok(zoomed.pillText.includes('%'));

    await assertWheelReachesAllFourEdges('source');

    await page.locator('.oz-status-pill').click();
    await page.waitForTimeout(180);
    assert.equal(
      await page.evaluate(() => document.querySelector('.oz-zoom-host')?.classList.contains('oz-is-zoomed')),
      false
    );
    assert.deepEqual(pageErrors, []);
  });

  it('Windows Desktop Reading View: Ctrl+Wheel zoom, 4-edge wheel pan, and Ctrl+0 reset', async () => {
    await setLeafMode('preview');
    const box = await page.locator('.oz-zoom-host .markdown-reading-view .markdown-preview-view').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -120);
      await page.keyboard.up('Control');
      await page.waitForTimeout(20);
    }

    await assertWheelReachesAllFourEdges('preview');

    await page.locator('.oz-status-pill').click();
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => document.querySelector('.oz-zoom-host')?.classList.contains('oz-is-zoomed')),
      false
    );
    assert.deepEqual(pageErrors, []);
  });

  it('Mobile-emulated Editing View: 2-finger pinch + fast/slow 4-edge touch pan without touchcancel', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 480,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await page.waitForTimeout(250);

    const box = await page.locator('.oz-zoom-host .cm-scroller').first().boundingBox();
    await twoFingerPinch(box.x + box.width / 2, box.y + box.height / 2, 40, 105);
    assert.equal(
      await page.evaluate(() => document.querySelector('.oz-zoom-host')?.classList.contains('oz-is-zoomed')),
      true
    );

    await assertTouchReachesAllFourEdges('source', box, { fastVertical: false, fastRight: true });
    assert.deepEqual(pageErrors, []);
  });

  it('Mobile-emulated Editing View: pinch while scrolled 2000px down + fast 4-edge touch pan', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 480,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      document.querySelector('.oz-zoom-host .cm-scroller').scrollTop = 2000;
    });
    await page.waitForTimeout(100);

    const box = await page.locator('.oz-zoom-host .cm-scroller').first().boundingBox();
    await twoFingerPinch(box.x + box.width / 2, box.y + box.height / 2, 40, 105);
    const afterPinchScroll = await page.evaluate(
      () => document.querySelector('.oz-zoom-host .cm-scroller').scrollTop
    );
    assert.ok(afterPinchScroll > 1200, `expected scrollTop near 1500-2000 after pinch, got ${afterPinchScroll}`);

    await assertTouchReachesAllFourEdges('source', box, { fastVertical: true, fastRight: false });
    assert.deepEqual(pageErrors, []);
  });

  it('Mobile-emulated drawer shielding: blocks mid-pane/slow/outward drags while allowing fast left/right edge flicks', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 480,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await page.waitForTimeout(250);

    const box = await page.locator('.oz-zoom-host .cm-scroller').first().boundingBox();
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);
    await twoFingerPinch(cx, cy, 40, 105);
    await page.evaluate(() => {
      window.__ozWorkspaceTouchMoves = 0;
    });

    // Mid-pane horizontal & diagonal drags + 2-finger pinch must NOT reach .workspace
    await touchDrag(cx, cy, cx + 100, cy, 6, 12);
    await touchDrag(cx + 80, cy, cx - 80, cy, 6, 12);
    await touchDrag(cx, cy - 60, cx + 80, cy + 80, 6, 12);
    await twoFingerPinch(cx, cy, 50, 90, 6);
    assert.equal(await page.evaluate(() => window.__ozWorkspaceTouchMoves), 0);

    // Outward drag from left edge must NOT reach .workspace
    await touchDrag(Math.round(box.x + 10), cy, Math.round(box.x + 1), cy, 4, 10);
    assert.equal(await page.evaluate(() => window.__ozWorkspaceTouchMoves), 0);

    // Fast inward flick from left edge MUST reach .workspace
    await touchDrag(Math.round(box.x + 4), cy, Math.round(box.x + 90), cy, 3, 4);
    assert.ok((await page.evaluate(() => window.__ozWorkspaceTouchMoves)) > 0);

    // Fast inward flick from right edge MUST reach .workspace
    await page.evaluate(() => {
      window.__ozWorkspaceTouchMoves = 0;
    });
    await touchDrag(Math.round(box.x + box.width - 4), cy, Math.round(box.x + box.width - 90), cy, 3, 4);
    assert.ok((await page.evaluate(() => window.__ozWorkspaceTouchMoves)) > 0);
    assert.deepEqual(pageErrors, []);
  });

  it('Mobile-emulated 2-finger double-tap reset & Reading View 4-edge touch pan', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 480,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await page.waitForTimeout(250);

    const box = await page.locator('.oz-zoom-host .cm-scroller').first().boundingBox();
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);

    await twoFingerPinch(cx, cy, 40, 105);
    assert.equal(
      await page.evaluate(() => document.querySelector('.oz-zoom-host')?.classList.contains('oz-is-zoomed')),
      true
    );

    await twoFingerTap(cx, cy);
    await page.waitForTimeout(80);
    await twoFingerTap(cx, cy);
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => document.querySelector('.oz-zoom-host')?.classList.contains('oz-is-zoomed')),
      false
    );

    // Switch to Reading View, pinch, and reach all 4 full edges
    await setLeafMode('preview');
    const pBox = await page.locator('.oz-zoom-host .markdown-reading-view .markdown-preview-view').first().boundingBox();
    await twoFingerPinch(pBox.x + pBox.width / 2, pBox.y + pBox.height / 2, 40, 105);
    await assertTouchReachesAllFourEdges('preview', pBox, { fastVertical: true, fastRight: true });
    assert.deepEqual(pageErrors, []);
  });

  it('Command step zoom and Alt-hold desktop loupe lens', async () => {
    await page.evaluate(() => {
      window.app.commands.executeCommandById('optical-zoom:zoom-in');
    });
    await page.waitForTimeout(200);
    const pillAfterIn = await page.evaluate(() => document.querySelector('.oz-status-pill')?.textContent || '');
    assert.ok(pillAfterIn.includes('125%'), `expected 125% after zoom-in command, got "${pillAfterIn}"`);

    await page.evaluate(() => {
      window.app.commands.executeCommandById('optical-zoom:zoom-out');
    });
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => document.querySelector('.oz-zoom-host')?.classList.contains('oz-is-zoomed')),
      false
    );

    // Hold Alt at 100% to trigger loupe lens
    const box = await page.locator('.oz-zoom-host .cm-scroller').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Alt');
    await page.waitForTimeout(80);
    assert.ok(await page.evaluate(() => Boolean(document.querySelector('.oz-loupe-lens'))), 'expected .oz-loupe-lens on Alt hold');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.oz-loupe-lens'))), false);
    assert.deepEqual(pageErrors, []);
  });
});
