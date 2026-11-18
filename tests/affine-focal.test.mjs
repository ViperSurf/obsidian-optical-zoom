import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeFocalZoomTransform, applyMagneticSnap } from './.tmp/affine-focal.mjs';

const VW = 800;
const VH = 600;
const MIN = 1.0;
const MAX = 3.0;

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
    const zoomed = computeFocalZoomTransform(identity(), 3.0, fx, fy, 0, 0, MIN, MAX, VW, VH);
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
      s = computeFocalZoomTransform(s, Math.pow(3.0, 1 / 30), fx, fy, 0, 0, MIN, MAX, VW, VH);
      const p = screenOf(s, before.x, before.y);
      assert.ok(Math.abs(p.x - fx) < 0.01, `zoom-in step ${i} x drift ${p.x - fx}`);
      assert.ok(Math.abs(p.y - fy) < 0.01, `zoom-in step ${i} y drift ${p.y - fy}`);
    }
    assert.ok(Math.abs(s.scale - 3.0) < 1e-9, `scale ${s.scale}`);
    // Zoom back out.
    for (let i = 0; i < 30; i++) {
      s = computeFocalZoomTransform(s, Math.pow(1 / 3.0, 1 / 30), fx, fy, 0, 0, MIN, MAX, VW, VH);
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
    const zoomed = computeFocalZoomTransform(identity(), 2.0, fx, fy, 0, 0, MIN, MAX, VW, VH);
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
    const out = computeFocalZoomTransform(identity(), 0.5, 400, 300, 0, 0, MIN, MAX, VW, VH);
    assert.equal(out.scale, 0.92);
    // Further zoom-out attempts stay at the floor.
    const out2 = computeFocalZoomTransform(out, 0.5, 400, 300, 0, 0, MIN, MAX, VW, VH);
    assert.equal(out2.scale, 0.92);
    // The floor scales with a non-1.0 min.
    const out3 = computeFocalZoomTransform(
      { scale: 0.8, tx: 0, ty: 0, isGestureActive: true },
      0.1, 400, 300, 0, 0, 0.8, MAX, VW, VH
    );
    assert.ok(Math.abs(out3.scale - 0.8 * 0.92) < 1e-12, `floor ${out3.scale}`);
  });

  it('clamps at max scale', () => {
    const out = computeFocalZoomTransform(identity(), 10, 400, 300, 0, 0, MIN, MAX, VW, VH);
    assert.equal(out.scale, MAX);
    const out2 = computeFocalZoomTransform(
      { scale: 2.9, tx: -100, ty: -100, isGestureActive: true },
      2, 400, 300, 0, 0, MIN, 5.0, VW, VH
    );
    assert.equal(out2.scale, 5.0);
  });

  it('forces tx = ty = 0 whenever scale <= 1', () => {
    const atOne = computeFocalZoomTransform(identity(), 1.0, 400, 300, 50, 40, MIN, MAX, VW, VH);
    assert.equal(atOne.scale, 1.0);
    assert.equal(atOne.tx, 0);
    assert.equal(atOne.ty, 0);
    const below = computeFocalZoomTransform(identity(), 0.95, 400, 300, 50, 40, MIN, MAX, VW, VH);
    assert.ok(below.scale < 1.0);
    assert.equal(below.tx, 0);
    assert.equal(below.ty, 0);
  });

  it('clamps pan so content cannot be lost off-screen when zoomed', () => {
    const zoomed = { scale: 2.0, tx: -100, ty: -100, isGestureActive: true };
    const panned = computeFocalZoomTransform(zoomed, 1.0, 400, 300, 100000, 100000, MIN, MAX, VW, VH);
    assert.equal(panned.tx, 0);
    assert.equal(panned.ty, 0);
    const pannedFar = computeFocalZoomTransform(zoomed, 1.0, 400, 300, -100000, -100000, MIN, MAX, VW, VH);
    assert.equal(pannedFar.tx, -VW * (2.0 - 1));
    assert.equal(pannedFar.ty, -VH * (2.0 - 1));
  });
});
