// src/types.ts
import type { WorkspaceLeaf } from 'obsidian';

export type ZoomInteractionMode = 'both' | 'pinch-only' | 'loupe-only';
export type LoupeMagnificationPreset = 1.25 | 1.5 | 2.0 | 2.5 | 3.0 | 4.0;
export type LoupeShape = 'rounded' | 'circle';
export type DesktopLoupeModifier = 'Alt' | 'Control' | 'Shift' | 'Disabled';
export type ZoomIndicatorMode = 'always' | 'auto-fade' | 'hidden';
export type IndicatorCornerPosition =
  | 'bottom-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-center'
  | 'top-right'
  | 'top-left';

export interface OpticalZoomSettings {
  interactionMode: ZoomInteractionMode;
  zoomSensitivity: number;          // 0.5 to 2.0, default 1.0
  maxZoomScale: number;             // 2.0 to 5.0, default 3.0 (300%)
  minZoomScale: number;             // Fixed at 1.0 (100% floor with rubber-band to 0.92)
  hotkeyZoomStepPercent: number;    // 5 to 50, default 25
  loupeSizePx: number;              // 140 to 400, default 240
  loupeMagnification: LoupeMagnificationPreset; // default 2.0
  loupeShape: LoupeShape;           // default 'rounded'
  desktopLoupeKey: DesktopLoupeModifier;        // default 'Alt'
  mobileTouchLoupe: boolean;        // default true (Long-press & drag finger-offset loupe)
  rememberZoomPerTab: boolean;      // default false
  rememberZoomPerNote: boolean;     // default false
  savedNoteZooms: Record<string, number>; // persisted per-file zoom scales
  snapFeedback: boolean;            // default true (haptic + subtle pulse on 100% snap)
  panMomentum: boolean;             // default true (smooth deceleration after 1-finger pan)
  pinchJitterFilter: boolean;       // default true (ignore tiny pinch distance jitter during 2-finger pan)
  resetOnEscape: boolean;           // default false
  showStatusBarZoom: boolean;       // default true
  zoomIndicatorMode: ZoomIndicatorMode;           // default 'always'
  mobileIndicatorPosition: IndicatorCornerPosition; // default 'bottom-right'
}

export interface AffineTransformState {
  scale: number;       // Current optical scale factor (1.0 = 100%)
  tx: number;          // Horizontal translation in CSS pixels
  ty: number;          // Vertical translation in CSS pixels
  isGestureActive: boolean;
}

export interface PinchGestureFrame {
  scaleDelta: number;  // Multiplicative scale factor for this frame (e.g., 1.04)
  panDeltaX: number;   // Pan offset X in viewport client pixels
  panDeltaY: number;   // Pan offset Y in viewport client pixels
  focalClientX: number;// Pinch centroid or cursor X in client coordinates
  focalClientY: number;// Pinch centroid or cursor Y in client coordinates
  source: 'wheel' | 'pointer' | 'webkit-gesture' | 'keyboard';
}

export interface LeafZoomRecord {
  leaf: WorkspaceLeaf;
  scale: number;
  tx: number;
  ty: number;
}
