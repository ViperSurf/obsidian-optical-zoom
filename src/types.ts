// src/types.ts
import type { WorkspaceLeaf } from 'obsidian';

export type ZoomInteractionMode = 'both' | 'pinch-only' | 'loupe-only';
export type LoupeSizePreset = 180 | 240 | 320;
export type LoupeMagnificationPreset = 1.5 | 2.0 | 2.5;
export type DesktopLoupeModifier = 'Alt' | 'Control' | 'Shift' | 'Disabled';

export interface OpticalZoomSettings {
  interactionMode: ZoomInteractionMode;
  zoomSensitivity: number;          // 0.5 to 2.0, default 1.0
  maxZoomScale: number;             // 2.0 to 5.0, default 3.0 (300%)
  minZoomScale: number;             // Fixed at 1.0 (100% floor with rubber-band to 0.92)
  loupeSizePx: LoupeSizePreset;     // default 240
  loupeMagnification: LoupeMagnificationPreset; // default 2.0
  desktopLoupeKey: DesktopLoupeModifier;        // default 'Alt'
  mobileTouchLoupe: boolean;        // default true (Long-press & drag finger-offset loupe)
  rememberZoomPerTab: boolean;      // default false
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
