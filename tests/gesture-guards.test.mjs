import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldShield,
  isEdgeStart,
  classifyOneFingerDrag,
  ZOOMED_SCALE_THRESHOLD,
} from './.tmp/gesture-guards.mjs';

// Container geometry used below: a 400px-wide pane starting at client x=100,
// with the 28px drawer edge zone from DRAWER_EDGE_ZONE_PX.
const LEFT = 100;
const WIDTH = 400;
const EDGE = 28;

describe('shouldShield — zoom gate for drawer shielding and the loupe', () => {
  it('is false at and below the threshold (100% is never shielded)', () => {
    assert.equal(shouldShield(0.92), false); // rubber-band floor
    assert.equal(shouldShield(1.0), false);
    assert.equal(shouldShield(ZOOMED_SCALE_THRESHOLD), false); // boundary: strictly greater
  });

  it('is true for any real zoom level', () => {
    assert.equal(shouldShield(1.006), true);
    assert.equal(shouldShield(1.5), true);
    assert.equal(shouldShield(3.0), true);
  });
});

describe('isEdgeStart — drawer trigger zones at both container edges', () => {
  it('flags touches inside the left edge zone', () => {
    assert.equal(isEdgeStart(LEFT, LEFT, WIDTH, EDGE), true);        // rel 0
    assert.equal(isEdgeStart(LEFT + 14, LEFT, WIDTH, EDGE), true);   // rel 14
    assert.equal(isEdgeStart(LEFT + EDGE, LEFT, WIDTH, EDGE), true); // rel 28 (boundary)
  });

  it('does not flag touches just outside the left edge zone or mid-pane', () => {
    assert.equal(isEdgeStart(LEFT + EDGE + 1, LEFT, WIDTH, EDGE), false); // rel 29
    assert.equal(isEdgeStart(LEFT + WIDTH / 2, LEFT, WIDTH, EDGE), false); // center
  });

  it('flags touches inside the right edge zone', () => {
    assert.equal(isEdgeStart(LEFT + WIDTH, LEFT, WIDTH, EDGE), true);       // rel 400 (right edge)
    assert.equal(isEdgeStart(LEFT + WIDTH - 14, LEFT, WIDTH, EDGE), true);  // rel 386
    assert.equal(isEdgeStart(LEFT + WIDTH - EDGE, LEFT, WIDTH, EDGE), true); // rel 372 (boundary)
  });

  it('does not flag touches just outside the right edge zone', () => {
    assert.equal(isEdgeStart(LEFT + WIDTH - EDGE - 1, LEFT, WIDTH, EDGE), false); // rel 371
  });

  it('never flags touches outside the container or a degenerate container', () => {
    assert.equal(isEdgeStart(LEFT - 5, LEFT, WIDTH, EDGE), false);
    assert.equal(isEdgeStart(LEFT + WIDTH + 5, LEFT, WIDTH, EDGE), false);
    assert.equal(isEdgeStart(LEFT, LEFT, 0, EDGE), false);
  });

  it('respects a custom edge width', () => {
    assert.equal(isEdgeStart(LEFT + 10, LEFT, WIDTH, 10), true);
    assert.equal(isEdgeStart(LEFT + 11, LEFT, WIDTH, 10), false);
    assert.equal(isEdgeStart(LEFT + WIDTH - 10, LEFT, WIDTH, 10), true);
    assert.equal(isEdgeStart(LEFT + WIDTH - 11, LEFT, WIDTH, 10), false);
  });
});

describe('classifyOneFingerDrag — Markor-model one-finger pan claim', () => {
  const THRESH = 6; // TOUCH_CLAIM_THRESHOLD_PX
  const ZOOMED = 2.0;

  it('stays pending below the threshold while zoomed', () => {
    assert.equal(classifyOneFingerDrag(0, 0, THRESH, ZOOMED), 'pending');
    assert.equal(classifyOneFingerDrag(3, 0, THRESH, ZOOMED), 'pending');
    assert.equal(classifyOneFingerDrag(0, -5, THRESH, ZOOMED), 'pending');
    assert.equal(classifyOneFingerDrag(4, 4, THRESH, ZOOMED), 'pending'); // hypot ≈ 5.66 < 6
  });

  it('claims at exactly the threshold', () => {
    assert.equal(classifyOneFingerDrag(6, 0, THRESH, ZOOMED), 'pan');
    assert.equal(classifyOneFingerDrag(0, -6, THRESH, ZOOMED), 'pan');
  });

  it('claims drags in all four cardinal directions while zoomed — no rejection path', () => {
    assert.equal(classifyOneFingerDrag(30, 0, THRESH, ZOOMED), 'pan');   // right
    assert.equal(classifyOneFingerDrag(-30, 0, THRESH, ZOOMED), 'pan');  // left
    assert.equal(classifyOneFingerDrag(0, 30, THRESH, ZOOMED), 'pan');   // down
    assert.equal(classifyOneFingerDrag(0, -30, THRESH, ZOOMED), 'pan');  // up
  });

  it('claims 45° diagonals while zoomed (the old classifier stranded these)', () => {
    assert.equal(classifyOneFingerDrag(20, 20, THRESH, ZOOMED), 'pan');
    assert.equal(classifyOneFingerDrag(-20, 20, THRESH, ZOOMED), 'pan');
    assert.equal(classifyOneFingerDrag(20, -20, THRESH, ZOOMED), 'pan');  // up-right
    assert.equal(classifyOneFingerDrag(-20, -20, THRESH, ZOOMED), 'pan'); // up-left
  });

  it('never claims at 100% (or in the rubber band), however far the drag', () => {
    assert.equal(classifyOneFingerDrag(200, 200, THRESH, 1.0), 'pending');
    assert.equal(classifyOneFingerDrag(-200, 0, THRESH, 1.0), 'pending');
    assert.equal(classifyOneFingerDrag(0, -200, THRESH, 0.92), 'pending');
    assert.equal(classifyOneFingerDrag(0, -200, THRESH, ZOOMED_SCALE_THRESHOLD), 'pending');
  });
});
