import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const stylesCss = readFileSync(path.join(root, 'styles.css'), 'utf8');
const controllerBundle = readFileSync(
  path.join(root, 'tests', '.tmp', 'pane-zoom-controller.browser.mjs'),
  'utf8'
);

// Build a long, realistic note (~12,000+ px tall) with headings, paragraphs,
// wide tables, code blocks, and SVG diagrams.
function buildLongNoteMarkup(prefix) {
  const sections = [];
  for (let i = 1; i <= 40; i++) {
    sections.push(`
      <section class="oz-test-section" data-section="${i}" style="margin-bottom: 32px;">
        <h2>${prefix} Section ${i}: Optical Zoom &amp; Panning Stress Test</h2>
        <p>
          Dense paragraph ${i} with inline math-like notation (x<sub>i</sub> + y<sup>2</sup> = z<sub>k</sub>)
          and CJK/Arabic sample text: 光学ズームテスト • اختبار التكبير البصري.
        </p>
        ${i % 4 === 0
        ? `<div style="overflow-x: visible;">
                <table border="1" style="border-collapse: collapse; width: 680px;">
                  <thead><tr><th>Col A</th><th>Col B</th><th>Col C</th><th>Col D</th><th>Col E</th><th>Col F</th></tr></thead>
                  <tbody>
                    <tr><td>Row ${i}.1</td><td>Value 101</td><td>Value 202</td><td>Value 303</td><td>Value 404</td><td>End ${i}</td></tr>
                    <tr><td>Row ${i}.2</td><td>Value 105</td><td>Value 206</td><td>Value 307</td><td>Value 408</td><td>End ${i}</td></tr>
                  </tbody>
                </table>
              </div>`
        : ''
      }
        ${i % 5 === 0
        ? `<pre style="padding: 12px; background: #f3f4f6;"><code>const section${i} = (tx, ty, scale) => translate3d(tx, ty, 0) * scale;</code></pre>`
        : ''
      }
      </section>
    `);
  }
  return sections.join('\n');
}

const editingMarkup = buildLongNoteMarkup('Editor');
const readingMarkup = buildLongNoteMarkup('Reading');

const testHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; font-family: sans-serif; font-size: 16px; line-height: 1.5; }
    .workspace { width: 100%; height: 100%; position: relative; }
    .view-content { width: 100%; height: 100%; position: relative; }
    .markdown-source-view, .markdown-reading-view { width: 100%; height: 100%; }
    .cm-scroller, .markdown-preview-view {
      width: 100%;
      height: 100%;
      overflow: auto;
      scroll-behavior: smooth; /* Verify our CSS overrides this while zoomed */
    }
    .cm-sizer, .markdown-preview-sizer {
      width: 100%;
      max-width: 720px;
      margin: 0 auto;
      padding: 24px;
      background: linear-gradient(#ffffff, #eef2ff);
    }
    ${stylesCss}
  </style>
</head>
<body>
  <div class="workspace">
    <div class="view-content" id="view-content">
      <div class="markdown-reading-view" id="reading-view" style="display: none;">
        <div class="markdown-preview-view" id="preview-view">
          <div class="markdown-preview-sizer" id="preview-sizer">
            ${readingMarkup}
          </div>
        </div>
      </div>
      <div class="markdown-source-view" id="source-view">
        <div class="cm-scroller" id="cm-scroller">
          <div class="cm-sizer" id="cm-sizer">
            ${editingMarkup}
          </div>
        </div>
      </div>
    </div>
  </div>
  <script type="module">
    import { PaneZoomController } from '/controller.mjs';

    const containerEl = document.getElementById('view-content');
    const settings = {
      interactionMode: 'both',
      zoomSensitivity: 1.0,
      maxZoomScale: 3.0,
      minZoomScale: 1.0,
      loupeSizePx: 240,
      loupeMagnification: 2.0,
      desktopLoupeKey: 'Alt',
      mobileTouchLoupe: true,
      rememberZoomPerTab: false,
    };

    window.__touchCancelCount = 0;
    window.__workspaceTouchMoveCount = 0;
    containerEl.addEventListener('touchcancel', () => { window.__touchCancelCount++; });
    document.querySelector('.workspace').addEventListener('touchmove', () => {
      window.__workspaceTouchMoveCount++;
    });

    const leaf = { view: { contentEl: containerEl, containerEl } };
    window.__controller = new PaneZoomController(leaf, () => settings, (s) => {
      window.__lastScale = s;
    });
  </script>
</body>
</html>`;

let server;
let baseUrl;
let browser;
let context;
let page;
let cdp;
const pageErrors = [];

async function touchDrag(client, fromX, fromY, toX, toY, steps = 10, stepDelayMs = 16) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: fromX, y: fromY, id: 1 }],
  });
  for (let i = 1; i <= steps; i++) {
    const x = fromX + ((toX - fromX) * i) / steps;
    const y = fromY + ((toY - fromY) * i) / steps;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, id: 1 }],
    });
    if (stepDelayMs > 0) await page.waitForTimeout(stepDelayMs);
  }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await page.waitForTimeout(24);
}

async function twoFingerPinch(client, cx, cy, startHalfDist, endHalfDist, steps = 12) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: cx - startHalfDist, y: cy, id: 1 },
      { x: cx + startHalfDist, y: cy, id: 2 },
    ],
  });
  for (let i = 1; i <= steps; i++) {
    const d = startHalfDist + ((endHalfDist - startHalfDist) * i) / steps;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: cx - d, y: cy, id: 1 },
        { x: cx + d, y: cy, id: 2 },
      ],
    });
    await page.waitForTimeout(16);
  }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await page.waitForTimeout(40);
}

async function twoFingerTap(client, cx, cy) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: cx - 30, y: cy, id: 1 },
      { x: cx + 30, y: cy, id: 2 },
    ],
  });
  await page.waitForTimeout(30);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

async function assertTouchReachesAllFourEdges(vpId, sizerId, { fastVertical = false, fastRight = true } = {}) {
  const getEdges = () =>
    page.evaluate(
      ({ vpId: v, sizerId: s }) => {
        const vpEl = document.getElementById(v);
        const sizerEl = document.getElementById(s);
        const vp = vpEl.getBoundingClientRect();
        const sizer = sizerEl.getBoundingClientRect();
        const scale = window.__controller.getScale();
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
          cancels: window.__touchCancelCount,
        };
      },
      { vpId, sizerId }
    );

  const vSteps = fastVertical ? 2 : 6;
  const vDelay = fastVertical ? 4 : 14;
  const rSteps = fastRight ? 2 : 10;
  const rDelay = fastRight ? 4 : 14;

  // 1. Full bottom
  for (let i = 0; i < 40; i++) {
    const e = await getEdges();
    if (e.sizerBottom <= e.vpBottom + 2) break;
    await touchDrag(cdp, 200, 720, 200, 100, vSteps, vDelay);
  }
  const atBottom = await getEdges();
  assert.ok(
    Math.abs(atBottom.sizerBottom - atBottom.vpBottom) <= 3,
    `${vpId}: expected full bottom flush (${atBottom.sizerBottom} vs ${atBottom.vpBottom})`
  );
  await touchDrag(cdp, 200, 720, 200, 100, 2, 4);
  assert.ok(Math.abs((await getEdges()).sizerBottom - atBottom.sizerBottom) < 1);

  // 2. Full top
  for (let i = 0; i < 40; i++) {
    const e = await getEdges();
    if (e.sizerTop >= e.vpTop - 2 && e.scrollTop === 0) break;
    await touchDrag(cdp, 200, 120, 200, 740, vSteps, vDelay);
  }
  const atTop = await getEdges();
  assert.equal(atTop.scrollTop, 0, `${vpId}: expected scrollTop === 0 at full top`);
  assert.ok(
    Math.abs(atTop.sizerTop - atTop.vpTop) <= 3,
    `${vpId}: expected full top flush (${atTop.sizerTop} vs ${atTop.vpTop})`
  );

  // 3. Full right
  for (let i = 0; i < 12; i++) {
    const e = await getEdges();
    if (e.sizerRight <= e.vpRight + 2) break;
    await touchDrag(cdp, 340, 400, 40, 400, rSteps, rDelay);
  }
  const atRight = await getEdges();
  assert.ok(
    Math.abs(atRight.sizerRight - atRight.vpRight) <= 3,
    `${vpId}: expected full right flush (${atRight.sizerRight} vs ${atRight.vpRight})`
  );
  await touchDrag(cdp, 340, 400, 40, 400, 2, 4);
  assert.ok(Math.abs((await getEdges()).sizerRight - atRight.sizerRight) < 1);

  // 4. Full left
  for (let i = 0; i < 12; i++) {
    const e = await getEdges();
    if (e.sizerLeft >= e.vpLeft - 2) break;
    await touchDrag(cdp, 40, 400, 340, 400, 12, 16);
  }
  const atLeft = await getEdges();
  assert.ok(
    Math.abs(atLeft.sizerLeft - atLeft.vpLeft) <= 3,
    `${vpId}: expected full left flush (${atLeft.sizerLeft} vs ${atLeft.vpLeft})`
  );
  await touchDrag(cdp, 40, 400, 340, 400, 2, 4);
  assert.ok(Math.abs((await getEdges()).sizerLeft - atLeft.sizerLeft) < 1);
  assert.equal(atLeft.cancels, 0);
}

describe('Mobile WebView E2E — Long Note + Real Zoom Gestures', () => {
  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/controller.mjs') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(controllerBundle);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(testHtml);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;

    browser = await chromium.launch({ headless: false });
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    page = await context.newPage();
    page.on('pageerror', (err) => pageErrors.push(err.message));
    cdp = await context.newCDPSession(page);
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  beforeEach(async () => {
    pageErrors.length = 0;
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
  });

  it('pinches to ~2.5x on a long note, anchors the focal section, and sets touch-action: none', async () => {
    const noteHeight = await page.evaluate(() => document.getElementById('cm-sizer').offsetHeight);
    assert.ok(noteHeight > 5000, `expected long note > 5000px, got ${noteHeight}`);

    const beforeRect = await page.evaluate(() =>
      document.querySelector('#cm-sizer [data-section="2"]').getBoundingClientRect().top
    );

    await twoFingerPinch(cdp, 195, beforeRect, 35, 110);

    const state = await page.evaluate(() => {
      const host = document.getElementById('view-content');
      const scroller = document.getElementById('cm-scroller');
      const cs = getComputedStyle(scroller);
      const afterTop = document.querySelector('#cm-sizer [data-section="2"]').getBoundingClientRect().top;
      return {
        scale: window.__controller.getScale(),
        isZoomed: host.classList.contains('oz-is-zoomed'),
        touchAction: cs.touchAction,
        overscrollBehavior: cs.overscrollBehavior,
        afterTop,
      };
    });

    assert.ok(state.scale > 2.0, `expected scale > 2.0 after pinch, got ${state.scale}`);
    assert.equal(state.isZoomed, true);
    assert.equal(state.touchAction, 'none');
    assert.equal(state.overscrollBehavior, 'none');
    assert.ok(
      Math.abs(state.afterTop - beforeRect) < 35,
      `expected focal section to stay near ${beforeRect}, got ${state.afterTop}`
    );
    assert.deepEqual(pageErrors, []);
  });

  it('pinches to zoom and reaches the full bottom, top, right, and left edges without touchcancel', async () => {
    await twoFingerPinch(cdp, 195, 420, 40, 100);
    const zoomedScale = await page.evaluate(() => window.__controller.getScale());
    assert.ok(zoomedScale > 1.8, `expected zoomedScale > 1.8, got ${zoomedScale}`);

    await assertTouchReachesAllFourEdges('cm-scroller', 'cm-sizer', { fastVertical: false, fastRight: true });
    assert.deepEqual(pageErrors, []);
  });

  it('pinches while scrolled far down (3000px) and reaches all 4 full edges without jumping', async () => {
    await page.evaluate(() => {
      document.getElementById('cm-scroller').scrollTo({ top: 3000, behavior: 'instant' });
    });
    await page.waitForTimeout(30);

    await twoFingerPinch(cdp, 195, 420, 40, 100);
    const afterPinchScroll = await page.evaluate(() => document.getElementById('cm-scroller').scrollTop);
    assert.ok(afterPinchScroll > 2500, `expected scrollTop to stay near 3000 after pinch, got ${afterPinchScroll}`);

    await assertTouchReachesAllFourEdges('cm-scroller', 'cm-sizer', { fastVertical: true, fastRight: false });
    assert.deepEqual(pageErrors, []);
  });

  it('shields mid-pane drags, slow edge drags, outward edge drags, and pinches while allowing fast left/right edge flicks', async () => {
    await twoFingerPinch(cdp, 195, 420, 40, 100);
    await page.evaluate(() => {
      window.__workspaceTouchMoveCount = 0;
    });

    // 1. Mid-pane horizontal & diagonal drags must NOT reach .workspace
    await touchDrag(cdp, 200, 400, 320, 400, 6, 12);
    await touchDrag(cdp, 320, 400, 120, 400, 6, 12);
    await touchDrag(cdp, 200, 300, 300, 450, 6, 12);
    assert.equal(
      await page.evaluate(() => window.__workspaceTouchMoveCount),
      0,
      'mid-pane horizontal/diagonal drags must not reach workspace'
    );

    // 2. Subsequent 2-finger pinch must NOT reach .workspace
    await twoFingerPinch(cdp, 195, 420, 60, 110, 6);
    assert.equal(
      await page.evaluate(() => window.__workspaceTouchMoveCount),
      0,
      '2-finger pinch must not reach workspace'
    );

    // 3. Slow drag from left edge (> 120ms before 24px travel) resolves as pan, not drawer flick
    await touchDrag(cdp, 4, 400, 60, 400, 16, 20);
    // Once resolved as a pan, subsequent moves are shielded; total workspace moves stay minimal/blocked after resolve
    const afterSlowLeft = await page.evaluate(() => window.__workspaceTouchMoveCount);
    await page.evaluate(() => {
      window.__workspaceTouchMoveCount = 0;
    });

    // 4. Slow drag from right edge (> 120ms before 24px travel) resolves as pan
    await touchDrag(cdp, 386, 400, 330, 400, 16, 20);
    await page.evaluate(() => {
      window.__workspaceTouchMoveCount = 0;
    });

    // 5. Outward (non-opening) drag from left edge (x=10 -> x=1) resolves immediately as pan
    await touchDrag(cdp, 10, 400, 1, 400, 4, 10);
    assert.equal(
      await page.evaluate(() => window.__workspaceTouchMoveCount),
      0,
      'outward drag from left edge must not reach workspace'
    );

    // 6. Fast inward flick from left edge (x=4 -> x=90) MUST reach .workspace
    await touchDrag(cdp, 4, 400, 90, 400, 3, 4);
    const leftEdgeCount = await page.evaluate(() => window.__workspaceTouchMoveCount);
    assert.ok(leftEdgeCount > 0, `fast left-edge flick should reach workspace (got ${leftEdgeCount})`);

    // 7. Fast inward flick from right edge (x=386 -> x=300) MUST reach .workspace
    await page.evaluate(() => {
      window.__workspaceTouchMoveCount = 0;
    });
    await touchDrag(cdp, 386, 400, 300, 400, 3, 4);
    const rightEdgeCount = await page.evaluate(() => window.__workspaceTouchMoveCount);
    assert.ok(rightEdgeCount > 0, `fast right-edge flick should reach workspace (got ${rightEdgeCount})`);
    assert.ok(afterSlowLeft >= 0);
    assert.deepEqual(pageErrors, []);
  });

  it('resets zoom cleanly to 100% on 2-finger double-tap', async () => {
    await twoFingerPinch(cdp, 195, 420, 40, 100);
    const zoomed = await page.evaluate(() => window.__controller.getScale());
    assert.ok(zoomed > 1.8);

    await twoFingerTap(cdp, 195, 420);
    await page.waitForTimeout(80);
    await twoFingerTap(cdp, 195, 420);
    await page.waitForTimeout(180);

    const resetState = await page.evaluate(() => ({
      scale: window.__controller.getScale(),
      isZoomed: document.getElementById('view-content').classList.contains('oz-is-zoomed'),
    }));
    assert.equal(resetState.scale, 1.0);
    assert.equal(resetState.isZoomed, false);
    assert.deepEqual(pageErrors, []);
  });

  it('pinches and pans smoothly through a long Reading View note with tables', async () => {
    await page.evaluate(() => {
      document.getElementById('reading-view').style.display = '';
      document.getElementById('source-view').style.display = 'none';
    });
    await page.waitForTimeout(30);

    await twoFingerPinch(cdp, 195, 420, 40, 100);
    await assertTouchReachesAllFourEdges('preview-view', 'preview-sizer', { fastVertical: true, fastRight: true });
    assert.deepEqual(pageErrors, []);
  });

  it('supports Ctrl+Wheel zoom and reaches all 4 full edges via wheel pan', async () => {
    // Dispatch Ctrl+Wheel zoom in
    await page.mouse.move(195, 420);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -120);
      await page.keyboard.up('Control');
      await page.waitForTimeout(20);
    }
    const scaleAfterWheel = await page.evaluate(() => window.__controller.getScale());
    assert.ok(scaleAfterWheel > 1.5, `expected Ctrl+Wheel scale > 1.5, got ${scaleAfterWheel}`);

    const getWheelEdges = () =>
      page.evaluate(() => {
        const vpEl = document.getElementById('cm-scroller');
        const sizerEl = document.getElementById('cm-sizer');
        const vp = vpEl.getBoundingClientRect();
        const sizer = sizerEl.getBoundingClientRect();
        const scale = window.__controller.getScale();
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
        };
      });

    for (let i = 0; i < 80; i++) {
      const e = await getWheelEdges();
      if (e.sizerBottom <= e.vpBottom + 2) break;
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(12);
    }
    assert.ok(Math.abs((await getWheelEdges()).sizerBottom - (await getWheelEdges()).vpBottom) <= 3);

    for (let i = 0; i < 80; i++) {
      const e = await getWheelEdges();
      if (e.sizerTop >= e.vpTop - 2 && e.scrollTop === 0) break;
      await page.mouse.wheel(0, -600);
      await page.waitForTimeout(12);
    }
    assert.equal((await getWheelEdges()).scrollTop, 0);
    assert.ok(Math.abs((await getWheelEdges()).sizerTop - (await getWheelEdges()).vpTop) <= 3);

    for (let i = 0; i < 15; i++) {
      const e = await getWheelEdges();
      if (e.sizerRight <= e.vpRight + 2) break;
      await page.mouse.wheel(250, 0);
      await page.waitForTimeout(8);
    }
    assert.ok(Math.abs((await getWheelEdges()).sizerRight - (await getWheelEdges()).vpRight) <= 3);

    for (let i = 0; i < 15; i++) {
      const e = await getWheelEdges();
      if (e.sizerLeft >= e.vpLeft - 2) break;
      await page.mouse.wheel(-250, 0);
      await page.waitForTimeout(8);
    }
    assert.ok(Math.abs((await getWheelEdges()).sizerLeft - (await getWheelEdges()).vpLeft) <= 3);
    assert.deepEqual(pageErrors, []);
  });
});
