// src/input/gesture-guards.ts
// Pure, dependency-free decisions shared by the input recognizer and the
// loupe controller. Kept free of DOM and Obsidian imports so they can be
// unit-tested directly.

/** Scale above which a pane counts as "zoomed" for gesture shielding. */
export const ZOOMED_SCALE_THRESHOLD = 1.005;

/**
 * Whether touch gestures on a pane at `scale` should be shielded from
 * Obsidian's workspace-level drawer handlers (and the loupe kept off):
 * while zoomed, a finger drag is a pan, never a drawer swipe or a loupe
 * request.
 */
export function shouldShield(scale: number): boolean {
  return scale > ZOOMED_SCALE_THRESHOLD;
}

/**
 * Whether a touch starting at `clientX` lands inside the drawer trigger
 * zone: within `edgePx` of the container's left or right edge.
 * `containerLeft` / `containerWidth` come from the container's bounding
 * rect. Touches outside the container are never edge starts.
 */
export function isEdgeStart(
  clientX: number,
  containerLeft: number,
  containerWidth: number,
  edgePx: number
): boolean {
  if (containerWidth <= 0) return false;
  const relX = clientX - containerLeft;
  if (relX < 0 || relX > containerWidth) return false;
  return relX <= edgePx || relX >= containerWidth - edgePx;
}

/**
 * Fate of a one-finger drag, Markor-style: while zoomed, once the drag has
 * travelled at least `thresholdPx` (in ANY direction — diagonals included)
 * it is claimed as a full two-axis pan of the zoomed page. There is no
 * direction-based rejection: a vertical or diagonal drag pans through the
 * transform instead of falling back to native scrolling (which cannot move
 * horizontally in the editor at all, and made up/left drags feel stuck).
 *
 * Below the threshold — and at any distance while at 100% — the drag is
 * still 'pending': native scrolling and text selection stay untouched.
 */
export function classifyOneFingerDrag(
  dxTotal: number,
  dyTotal: number,
  thresholdPx: number,
  scale: number
): 'pending' | 'pan' {
  if (!shouldShield(scale)) return 'pending';
  return Math.hypot(dxTotal, dyTotal) >= thresholdPx ? 'pan' : 'pending';
}

/** Which container edge a touch started at, if it started in an edge zone. */
export type DrawerEdge = 'left' | 'right';

/**
 * Locates a touch start inside the narrow drawer-flick zone at either
 * container edge: returns which edge and how far from it the touch
 * started (0 = exactly on the edge), or null for mid-pane starts and
 * touches outside the container.
 */
export function edgeStartInfo(
  clientX: number,
  containerLeft: number,
  containerWidth: number,
  edgePx: number
): { edge: DrawerEdge; offsetFromEdge: number } | null {
  if (containerWidth <= 0) return null;
  const relX = clientX - containerLeft;
  if (relX < 0 || relX > containerWidth) return null;
  if (relX <= edgePx) return { edge: 'left', offsetFromEdge: relX };
  if (relX >= containerWidth - edgePx) {
    return { edge: 'right', offsetFromEdge: containerWidth - relX };
  }
  return null;
}

/**
 * Whether an edge-starting touch is a DELIBERATE drawer flick: it started
 * within `edgePx` of an edge and has already travelled at least
 * `minTravelPx` INWARD (right from the left edge, left from the right
 * edge) within `maxMs`. Slow edge drags, mid-pane starts (edge === null),
 * and movement in the non-opening direction are not flicks — those are
 * pans. Defaults mirror DRAWER_FLICK_* in constants.ts.
 */
export function isDrawerFlick(
  edge: DrawerEdge | null,
  startOffsetFromEdgePx: number,
  dxSinceStart: number,
  elapsedMs: number,
  edgePx = 12,
  minTravelPx = 24,
  maxMs = 120
): boolean {
  if (edge === null) return false;
  if (startOffsetFromEdgePx > edgePx) return false;
  if (elapsedMs > maxMs) return false;
  return edge === 'left' ? dxSinceStart >= minTravelPx : dxSinceStart <= -minTravelPx;
}
