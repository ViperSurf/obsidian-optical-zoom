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
