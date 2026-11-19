// src/math/affine-focal.ts
import { SNAP_THRESHOLD_LOW, SNAP_THRESHOLD_HIGH } from '../constants';
import type { AffineTransformState } from '../types';

/**
 * Geometry of the zoom target, used to clamp panning against the real
 * content instead of the viewport alone.
 *
 * All offsets are in CSS pixels. `originOffsetX/Y` is where the target's
 * untransformed top-left corner sits relative to the viewport's top-left
 * corner: negative Y when the note is scrolled down, positive X when the
 * readable-line-length column is centered with side margins.
 */
export interface PanBounds {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;   // Full unscaled content width (viewport scroller's scrollWidth)
  contentHeight: number;  // Full unscaled content height (viewport scroller's scrollHeight)
  originOffsetX: number;
  originOffsetY: number;
}

/**
 * Converts a client (pointer/pinch) coordinate into the focal coordinate the
 * affine formula expects: measured from the target's *untransformed* origin.
 *
 * `getBoundingClientRect()` on the transformed target already includes the
 * current translation, so the untransformed origin in client coordinates is
 * `(targetRectLeft - tx, targetRectTop - ty)`. Measuring the focal point from
 * the viewport instead is wrong by the scroll offset and the centered-column
 * margin, which makes zoom slide away from the pinch spot.
 */
export function focalPointFromClient(
  clientX: number,
  clientY: number,
  targetRectLeft: number,
  targetRectTop: number,
  tx: number,
  ty: number
): { focalX: number; focalY: number } {
  return {
    focalX: clientX - (targetRectLeft - tx),
    focalY: clientY - (targetRectTop - ty),
  };
}

/**
 * Clamps one translation axis so the scaled content always stays reachable
 * and can never be lost off-screen.
 *
 * The two limiting translations are: content's start edge flush with the
 * viewport's start edge (`-originOffset`), and content's end edge flush with
 * the viewport's end edge (`viewportSize - originOffset - scale * contentSize`).
 * When the scaled content is larger than the viewport, the valid range is
 * between those two values and the content always covers the viewport; when
 * it is smaller, the same two values bound the range and the content always
 * stays fully inside the viewport. Either way, every edge of the content can
 * be panned into view, and no further.
 */
function clampTranslation(
  value: number,
  scale: number,
  contentSize: number,
  viewportSize: number,
  originOffset: number
): number {
  const startEdgeFlush = -originOffset;
  const endEdgeFlush = viewportSize - originOffset - scale * contentSize;
  const lo = Math.min(startEdgeFlush, endEdgeFlush);
  const hi = Math.max(startEdgeFlush, endEdgeFlush);
  // `+ 0` normalizes a possible -0 (from -originOffset) to 0.
  return Math.min(hi, Math.max(lo, value)) + 0;
}

export function computeFocalZoomTransform(
  current: AffineTransformState,
  scaleMultiplier: number,
  focalX: number,
  focalY: number,
  panDX: number,
  panDY: number,
  minScale: number,
  maxScale: number,
  bounds: PanBounds
): AffineTransformState {
  const rawNextScale = current.scale * scaleMultiplier;

  // Soft rubber-band below 1.0x down to 0.92x during active gesture
  const clampedScale = Math.min(
    maxScale,
    Math.max(minScale * 0.92, rawNextScale)
  );

  const ratio = clampedScale / current.scale;

  let nextTx = focalX - (focalX - current.tx) * ratio + panDX;
  let nextTy = focalY - (focalY - current.ty) * ratio + panDY;

  // Clamp panning boundaries against the real content size so the note
  // cannot be lost off-screen, yet every edge stays reachable.
  if (clampedScale <= 1.0) {
    nextTx = 0;
    nextTy = 0;
  } else {
    nextTx = clampTranslation(
      nextTx, clampedScale, bounds.contentWidth, bounds.viewportWidth, bounds.originOffsetX
    );
    nextTy = clampTranslation(
      nextTy, clampedScale, bounds.contentHeight, bounds.viewportHeight, bounds.originOffsetY
    );
  }

  return {
    scale: clampedScale,
    tx: nextTx,
    ty: nextTy,
    isGestureActive: true,
  };
}

export function applyMagneticSnap(state: AffineTransformState): AffineTransformState {
  if (state.scale >= SNAP_THRESHOLD_LOW && state.scale <= SNAP_THRESHOLD_HIGH) {
    return { scale: 1.0, tx: 0, ty: 0, isGestureActive: false };
  }
  return { ...state, isGestureActive: false };
}
