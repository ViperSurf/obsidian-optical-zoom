import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFocalZoomTransform,
  applyMagneticSnap,
  focalPointFromClient,
} from './.tmp/affine-focal.mjs';

const VW = 800;
const VH = 600;
const MIN = 1.0;
const MAX = 3.0;

// Bounds where the content exactly fills the viewport at scale 1 and its
// untransformed origin coincides with the viewport origin. This preserves
// the geometry the original tests were written against.
function B(viewportWidth, viewportHeight) {
  return {
    viewportWidth,
    viewportHeight,
    contentWidth: viewportWidth,
    contentHeight: viewportHeight,
    originOffsetX: 0,
    originOffsetY: 0,
  };
}

function identity() {
  return { scale: 1.0, tx: 0, ty: 0, isGestureActive: false };
}

// Content coordinate currently displayed at viewport point (fx, fy).
function contentAt(state, fx, fy) {
  return { x: (fx - state.tx) / state.scale, y: (fy - state.ty) / state.scale };
}

// Viewport position where content coordinate (cx, cy) is displayed.
function screenOf(state, cx, cy) {
  return { x: cx * state.scale + state.tx, y: cy * state.scale + state.ty };
}

describe('computeFocalZoomTransform — focal point invariance', () => {
  it('keeps the focal point fixed on a direct 1.0 -> 3.0 zoom', () => {
    const fx = 200, fy = 300;
    const before = contentAt(identity(), fx, fy);
    const zoomed = computeFocalZoomTransform(identity(), 3.0, fx, fy, 0, 0, MIN, MAX, B(VW, VH));
    assert.equal(zoomed.scale, 3.0);
    const after = screenOf(zoomed, before.x, before.y);
    assert.ok(Math.abs(after.x - fx) < 0.01, `x drift ${after.x - fx}`);
    assert.ok(Math.abs(after.y - fy) < 0.01, `y drift ${after.y - fy}`);
  });

  it('keeps the focal point fixed across a 1.0 -> 3.0 -> 1.0 round trip', () => {
    const fx = 320, fy = 180;
    let s = identity();
    const before = contentAt(s, fx, fy);
    // Zoom in in small steps, like a real pinch gesture.
    for (let i = 0; i < 30; i++) {
      s = computeFocalZoomTransform(s, Math.pow(3.0, 1 / 30), fx, fy, 0, 0, MIN, MAX, B(VW, VH));
      const p = screenOf(s, before.x, before.y);
      assert.ok(Math.abs(p.x - fx) < 0.01, `zoom-in step ${i} x drift ${p.x - fx}`);
      assert.ok(Math.abs(p.y - fy) < 0.01, `zoom-in step ${i} y drift ${p.y - fy}`);
    }
    assert.ok(Math.abs(s.scale - 3.0) < 1e-9, `scale ${s.scale}`);
    // Zoom back out.
    for (let i = 0; i < 30; i++) {
      s = computeFocalZoomTransform(s, Math.pow(1 / 3.0, 1 / 30), fx, fy, 0, 0, MIN, MAX, B(VW, VH));
      const p = screenOf(s, before.x, before.y);
      assert.ok(Math.abs(p.x - fx) < 0.01, `zoom-out step ${i} x drift ${p.x - fx}`);
      assert.ok(Math.abs(p.y - fy) < 0.01, `zoom-out step ${i} y drift ${p.y - fy}`);
    }
    assert.ok(Math.abs(s.scale - 1.0) < 1e-9, `final scale ${s.scale}`);
    assert.ok(Math.abs(s.tx) < 0.01, `final tx ${s.tx}`);
    assert.ok(Math.abs(s.ty) < 0.01, `final ty ${s.ty}`);
  });

  it('keeps the focal point fixed at an off-center focal point', () => {
    const fx = 640, fy = 90;
    const before = contentAt(identity(), fx, fy);
    const zoomed = computeFocalZoomTransform(identity(), 2.0, fx, fy, 0, 0, MIN, MAX, B(VW, VH));
    const after = screenOf(zoomed, before.x, before.y);
    assert.ok(Math.abs(after.x - fx) < 0.01);
    assert.ok(Math.abs(after.y - fy) < 0.01);
  });
});

describe('applyMagneticSnap', () => {
  it('snaps to exactly 1.0 inside [0.96, 1.04]', () => {
    for (const scale of [0.96, 0.98, 1.0, 1.02, 1.04]) {
      const snapped = applyMagneticSnap({ scale, tx: -12, ty: -8, isGestureActive: true });
      assert.equal(snapped.scale, 1.0, `scale ${scale}`);
      assert.equal(snapped.tx, 0);
      assert.equal(snapped.ty, 0);
      assert.equal(snapped.isGestureActive, false);
    }
  });

  it('does not snap outside [0.96, 1.04]', () => {
    for (const scale of [0.92, 0.95, 1.05, 1.5, 3.0]) {
      const input = { scale, tx: -12, ty: -8, isGestureActive: true };
      const out = applyMagneticSnap(input);
      assert.equal(out.scale, scale, `scale ${scale}`);
      assert.equal(out.tx, -12);
      assert.equal(out.ty, -8);
      assert.equal(out.isGestureActive, false);
    }
  });
});

describe('computeFocalZoomTransform — clamping', () => {
  it('rubber-bands below min scale with a floor at 0.92 * min', () => {
    const out = computeFocalZoomTransform(identity(), 0.5, 400, 300, 0, 0, MIN, MAX, B(VW, VH));
    assert.equal(out.scale, 0.92);
    // Further zoom-out attempts stay at the floor.
    const out2 = computeFocalZoomTransform(out, 0.5, 400, 300, 0, 0, MIN, MAX, B(VW, VH));
    assert.equal(out2.scale, 0.92);
    // The floor scales with a non-1.0 min.
    const out3 = computeFocalZoomTransform(
      { scale: 0.8, tx: 0, ty: 0, isGestureActive: true },
      0.1, 400, 300, 0, 0, 0.8, MAX, B(VW, VH)
    );
    assert.ok(Math.abs(out3.scale - 0.8 * 0.92) < 1e-12, `floor ${out3.scale}`);
  });

  it('clamps at max scale', () => {
    const out = computeFocalZoomTransform(identity(), 10, 400, 300, 0, 0, MIN, MAX, B(VW, VH));
    assert.equal(out.scale, MAX);
    const out2 = computeFocalZoomTransform(
      { scale: 2.9, tx: -100, ty: -100, isGestureActive: true },
      2, 400, 300, 0, 0, MIN, 5.0, B(VW, VH)
    );
    assert.equal(out2.scale, 5.0);
  });

  it('forces tx = ty = 0 whenever scale <= 1', () => {
    const atOne = computeFocalZoomTransform(identity(), 1.0, 400, 300, 50, 40, MIN, MAX, B(VW, VH));
    assert.equal(atOne.scale, 1.0);
    assert.equal(atOne.tx, 0);
    assert.equal(atOne.ty, 0);
    const below = computeFocalZoomTransform(identity(), 0.95, 400, 300, 50, 40, MIN, MAX, B(VW, VH));
    assert.ok(below.scale < 1.0);
    assert.equal(below.tx, 0);
    assert.equal(below.ty, 0);
  });

  it('clamps pan so content cannot be lost off-screen when zoomed', () => {
    const zoomed = { scale: 2.0, tx: -100, ty: -100, isGestureActive: true };
    const panned = computeFocalZoomTransform(zoomed, 1.0, 400, 300, 100000, 100000, MIN, MAX, B(VW, VH));
    assert.equal(panned.tx, 0);
    assert.equal(panned.ty, 0);
    const pannedFar = computeFocalZoomTransform(zoomed, 1.0, 400, 300, -100000, -100000, MIN, MAX, B(VW, VH));
    assert.equal(pannedFar.tx, -VW * (2.0 - 1));
    assert.equal(pannedFar.ty, -VH * (2.0 - 1));
  });
});

describe('focalPointFromClient — production focal conversion', () => {
  it('measures the focal point from the target untransformed origin, not the viewport', () => {
    // Target untransformed origin sits at client (-120, -1500): the note is
    // scrolled far down and the column is margin-shifted. Current transform
    // is translate(-540, -5100) at scale 2.5, so the transformed target's
    // rect reports left = -120 + -540, top = -1500 + -5100.
    const { focalX, focalY } = focalPointFromClient(500, 400, -660, -6600, -540, -5100);
    assert.equal(focalX, 620);  // 500 - (-120)
    assert.equal(focalY, 1900); // 400 - (-1500)
  });
});

describe('scrolled-note focal invariance (controller flow)', () => {
  // A tall note (6000px high) in a 1000 x 800 viewport. The pinch centroid
  // stays at client (500, 400) while frames funnel through the exact
  // production path: transformed target rect -> focalPointFromClient ->
  // computeFocalZoomTransform, with the rect re-read every frame.
  // Content widths model real sizer layouts: full-width (1000), a centered
  // readable-line-length column (720 at a +140 margin, fully inside the
  // viewport), and wide content (1400) seen while horizontally scrolled
  // (origin -120, content covering the viewport).
  const CH = 6000;
  const VW2 = 1000;
  const VH2 = 800;

  function runScenario(originX, originY, contentWidth) {
    const bounds = {
      viewportWidth: VW2,
      viewportHeight: VH2,
      contentWidth,
      contentHeight: CH,
      originOffsetX: originX,
      originOffsetY: originY,
    };
    let state = identity();
    const P = { x: 500, y: 400 };
    // Content point under the centroid at scale 1 (tx = ty = 0).
    const content = { x: P.x - originX, y: P.y - originY };
    const screenOfContent = (s) => ({
      x: originX + s.tx + s.scale * content.x,
      y: originY + s.ty + s.scale * content.y,
    });
    const applyAt = (mult) => {
      const rectLeft = originX + state.tx; // transformed target rect
      const rectTop = originY + state.ty;
      const { focalX, focalY } = focalPointFromClient(
        P.x, P.y, rectLeft, rectTop, state.tx, state.ty
      );
      state = computeFocalZoomTransform(state, mult, focalX, focalY, 0, 0, MIN, MAX, bounds);
    };

    for (let i = 0; i < 25; i++) applyAt(Math.pow(2.5, 1 / 25));
    assert.ok(Math.abs(state.scale - 2.5) < 1e-9, `scale after zoom-in ${state.scale}`);
    let sp = screenOfContent(state);
    assert.ok(Math.abs(sp.x - P.x) < 0.5, `zoom-in x drift ${sp.x - P.x} (origin ${originX},${originY})`);
    assert.ok(Math.abs(sp.y - P.y) < 0.5, `zoom-in y drift ${sp.y - P.y} (origin ${originX},${originY})`);

    for (let i = 0; i < 25; i++) applyAt(Math.pow(1 / 2.5, 1 / 25));
    assert.ok(Math.abs(state.scale - 1.0) < 1e-6, `scale after zoom-out ${state.scale}`);
    sp = screenOfContent(state);
    assert.ok(Math.abs(sp.x - P.x) < 0.5, `zoom-out x drift ${sp.x - P.x} (origin ${originX},${originY})`);
    assert.ok(Math.abs(sp.y - P.y) < 0.5, `zoom-out y drift ${sp.y - P.y} (origin ${originX},${originY})`);
  }

  it('anchors at the pinch spot at scroll offset 0', () => runScenario(0, 0, 1000));
  it('anchors at the pinch spot at scroll offset -800 with a +140 column margin', () => runScenario(140, -800, 720));
  it('anchors at the pinch spot at scroll offset -1500 with a -120 margin shift', () => runScenario(-120, -1500, 1400));
  it('anchors at the pinch spot at scroll offset -3000 with a +140 column margin', () => runScenario(140, -3000, 720));
});

describe('computeFocalZoomTransform — pan reach with real content size', () => {
  // Content 900 x 6000 (a long note), viewport 1000 x 800, content column
  // offset +50px from the viewport's left edge, top aligned.
  const bounds = {
    viewportWidth: 1000,
    viewportHeight: 800,
    contentWidth: 900,
    contentHeight: 6000,
    originOffsetX: 50,
    originOffsetY: 0,
  };

  it('permits panning the bottom-right edge exactly into view at scale 2', () => {
    const start = { scale: 2.0, tx: -50, ty: 0, isGestureActive: true }; // top-left aligned
    // Required translation: right edge flush -> tx = 1000 - 50 - 2*900 = -850
    //                       bottom edge flush -> ty = 800 - 0 - 2*6000 = -11200
    const out = computeFocalZoomTransform(start, 1.0, 500, 400, -800, -11200, MIN, MAX, bounds);
    assert.equal(out.tx, -850);
    assert.equal(out.ty, -11200);
    // The bottom-right corner is exactly at the viewport's bottom-right.
    assert.equal(bounds.originOffsetX + out.tx + out.scale * bounds.contentWidth, bounds.viewportWidth);
    assert.equal(bounds.originOffsetY + out.ty + out.scale * bounds.contentHeight, bounds.viewportHeight);
  });

  it('clamps at the bottom-right edge at scale 2 and 3 so content cannot be pushed off-screen', () => {
    const s2 = computeFocalZoomTransform(
      { scale: 2.0, tx: -50, ty: 0, isGestureActive: true },
      1.0, 500, 400, -100000, -100000, MIN, MAX, bounds
    );
    assert.equal(s2.tx, -850);
    assert.equal(s2.ty, -11200);
    // Content still fully covers the viewport — nothing lost off-screen.
    assert.ok(bounds.originOffsetX + s2.tx <= 0);
    assert.ok(bounds.originOffsetX + s2.tx + s2.scale * bounds.contentWidth >= bounds.viewportWidth);
    assert.ok(bounds.originOffsetY + s2.ty <= 0);
    assert.ok(bounds.originOffsetY + s2.ty + s2.scale * bounds.contentHeight >= bounds.viewportHeight);

    const s3 = computeFocalZoomTransform(
      { scale: 3.0, tx: -50, ty: 0, isGestureActive: true },
      1.0, 500, 400, -100000, -100000, MIN, MAX, bounds
    );
    assert.equal(s3.tx, 1000 - 50 - 3 * 900);   // -1750
    assert.equal(s3.ty, 800 - 0 - 3 * 6000);    // -17200
  });

  it('clamps positive pan at the start edge', () => {
    const out = computeFocalZoomTransform(
      { scale: 2.0, tx: -400, ty: -5000, isGestureActive: true },
      1.0, 500, 400, 100000, 100000, MIN, MAX, bounds
    );
    assert.equal(out.tx, -bounds.originOffsetX); // left edge flush with viewport left
    assert.equal(out.ty, 0); // top edge flush with viewport top (originOffsetY = 0)
  });
});
