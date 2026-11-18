// src/math/affine-focal.ts
import { SNAP_THRESHOLD_LOW, SNAP_THRESHOLD_HIGH } from '../constants';
import type { AffineTransformState } from '../types';

export function computeFocalZoomTransform(
  current: AffineTransformState,
  scaleMultiplier: number,
  focalX: number,
  focalY: number,
  panDX: number,
  panDY: number,
  minScale: number,
  maxScale: number,
  viewportWidth: number,
  viewportHeight: number
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

  // Clamp panning boundaries so the note cannot be lost off-screen
  if (clampedScale <= 1.0) {
    nextTx = 0;
    nextTy = 0;
  } else {
    const maxPanX = viewportWidth * (clampedScale - 1);
    const maxPanY = viewportHeight * (clampedScale - 1);
    nextTx = Math.min(0, Math.max(-maxPanX, nextTx));
    nextTy = Math.min(0, Math.max(-maxPanY, nextTy));
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
