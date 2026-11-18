// src/input/input-recognizer.ts
import { IS_APPLE_WEBKIT } from '../constants';
import type { OpticalZoomSettings, PinchGestureFrame } from '../types';

interface PointerSample {
  id: number;
  clientX: number;
  clientY: number;
}

export class CrossPlatformInputRecognizer {
  private activePointers: Map<number, PointerSample> = new Map();
  private prevPinchDistance: number | null = null;
  private prevCentroid: { x: number; y: number } | null = null;
  private lastWebKitGestureScale = 1.0;
  private lastTwoFingerTapEpoch = 0;
  private twoFingerTouchStartEpoch = 0;
  private isWebKitGestureRunning = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly getSettings: () => OpticalZoomSettings,
    private readonly onFrame: (frame: PinchGestureFrame) => void,
    private readonly onGestureEnd: () => void,
    private readonly onResetZoom: () => void,
    private readonly getCurrentScale: () => number
  ) {
    this.bindEvents();
  }

  private bindEvents(): void {
    // 1. Linux, Windows & macOS Precision Trackpad Pinch + Ctrl+Wheel
    this.container.addEventListener('wheel', this.handleWheel, { passive: false });

    // 2. Android, Windows Touch, Linux Touch & iOS Multi-Touch PointerEvents
    this.container.addEventListener('pointerdown', this.handlePointerDown, { passive: true });
    this.container.addEventListener('pointermove', this.handlePointerMove, { passive: false });
    this.container.addEventListener('pointerup', this.handlePointerUpOrCancel, { passive: true });
    this.container.addEventListener('pointercancel', this.handlePointerUpOrCancel, { passive: true });

    // 3. iOS / macOS WebKit Proprietary GestureEvents (Safari/WKWebView fallback)
    if (IS_APPLE_WEBKIT && 'ongesturestart' in window) {
      this.container.addEventListener('gesturestart', this.handleGestureStart as EventListener, { passive: false });
      this.container.addEventListener('gesturechange', this.handleGestureChange as EventListener, { passive: false });
      this.container.addEventListener('gestureend', this.handleGestureEnd as EventListener, { passive: true });
    }
  }

  private handleWheel = (e: WheelEvent): void => {
    const settings = this.getSettings();
    if (settings.interactionMode === 'loupe-only') return;

    // Case A: Trackpad two-finger pinch or Ctrl/Cmd + Wheel
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();

      // Normalize deltaY across Linux X11 DOM_DELTA_LINE (1) and Windows/Wayland DOM_DELTA_PIXEL (0)
      let pixelDelta = e.deltaY;
      if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        pixelDelta *= 16;
      } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        pixelDelta *= 320;
      }

      // Clamp extreme single-frame wheel jumps from discrete mouse wheels
      const clampedDelta = Math.max(-60, Math.min(60, pixelDelta));
      const zoomFactor = Math.exp(-clampedDelta * 0.0085 * settings.zoomSensitivity);

      this.onFrame({
        scaleDelta: zoomFactor,
        panDeltaX: 0,
        panDeltaY: 0,
        focalClientX: e.clientX,
        focalClientY: e.clientY,
        source: 'wheel',
      });
      this.onGestureEnd();
      return;
    }

    // Case B: Two-finger horizontal/vertical trackpad pan while zoomed in (> 1.0x)
    if (this.getCurrentScale() > 1.005 && e.deltaX !== 0) {
      e.preventDefault();
      this.onFrame({
        scaleDelta: 1.0,
        panDeltaX: -e.deltaX,
        panDeltaY: -e.deltaY,
        focalClientX: e.clientX,
        focalClientY: e.clientY,
        source: 'wheel',
      });
      this.onGestureEnd();
    }
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    this.activePointers.set(e.pointerId, {
      id: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
    });

    if (this.activePointers.size === 2) {
      this.twoFingerTouchStartEpoch = performance.now();
      const pts = Array.from(this.activePointers.values());
      this.prevPinchDistance = Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY);
      this.prevCentroid = {
        x: (pts[0].clientX + pts[1].clientX) / 2,
        y: (pts[0].clientY + pts[1].clientY) / 2,
      };
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.activePointers.has(e.pointerId) || this.isWebKitGestureRunning) return;
    this.activePointers.set(e.pointerId, {
      id: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
    });

    const settings = this.getSettings();
    if (settings.interactionMode === 'loupe-only') return;

    if (this.activePointers.size === 2 && this.prevPinchDistance && this.prevCentroid) {
      e.preventDefault();
      const pts = Array.from(this.activePointers.values());
      const dist = Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY);
      const centroid = {
        x: (pts[0].clientX + pts[1].clientX) / 2,
        y: (pts[0].clientY + pts[1].clientY) / 2,
      };

      if (dist > 8) {
        const rawRatio = dist / this.prevPinchDistance;
        const adjustedRatio = 1 + (rawRatio - 1) * settings.zoomSensitivity;
        const panDX = centroid.x - this.prevCentroid.x;
        const panDY = centroid.y - this.prevCentroid.y;

        this.onFrame({
          scaleDelta: adjustedRatio,
          panDeltaX: panDX,
          panDeltaY: panDY,
          focalClientX: centroid.x,
          focalClientY: centroid.y,
          source: 'pointer',
        });

        this.prevPinchDistance = dist;
        this.prevCentroid = centroid;
      }
    }
  };

  private handlePointerUpOrCancel = (e: PointerEvent): void => {
    const wasTwoFingers = this.activePointers.size === 2;
    this.activePointers.delete(e.pointerId);

    if (wasTwoFingers && this.activePointers.size < 2) {
      const now = performance.now();
      const touchDuration = now - this.twoFingerTouchStartEpoch;
      // Detect quick 2-finger tap / double-tap reset
      if (touchDuration < 220) {
        if (now - this.lastTwoFingerTapEpoch < 360) {
          this.onResetZoom();
          this.lastTwoFingerTapEpoch = 0;
        } else {
          this.lastTwoFingerTapEpoch = now;
        }
      }
      this.prevPinchDistance = null;
      this.prevCentroid = null;
      this.onGestureEnd();
    }
  };

  private handleGestureStart = (e: any): void => {
    if (this.getSettings().interactionMode === 'loupe-only') return;
    if (this.activePointers.size >= 2) return; // Handled by PointerEvents
    e.preventDefault();
    this.isWebKitGestureRunning = true;
    this.lastWebKitGestureScale = e.scale || 1.0;
  };

  private handleGestureChange = (e: any): void => {
    if (!this.isWebKitGestureRunning) return;
    e.preventDefault();
    const currentGestureScale = e.scale || 1.0;
    const delta = currentGestureScale / this.lastWebKitGestureScale;
    this.lastWebKitGestureScale = currentGestureScale;

    this.onFrame({
      scaleDelta: 1 + (delta - 1) * this.getSettings().zoomSensitivity,
      panDeltaX: 0,
      panDeltaY: 0,
      focalClientX: e.clientX ?? window.innerWidth / 2,
      focalClientY: e.clientY ?? window.innerHeight / 2,
      source: 'webkit-gesture',
    });
  };

  private handleGestureEnd = (): void => {
    if (!this.isWebKitGestureRunning) return;
    this.isWebKitGestureRunning = false;
    this.lastWebKitGestureScale = 1.0;
    this.onGestureEnd();
  };

  public destroy(): void {
    this.container.removeEventListener('wheel', this.handleWheel);
    this.container.removeEventListener('pointerdown', this.handlePointerDown);
    this.container.removeEventListener('pointermove', this.handlePointerMove);
    this.container.removeEventListener('pointerup', this.handlePointerUpOrCancel);
    this.container.removeEventListener('pointercancel', this.handlePointerUpOrCancel);
    if (IS_APPLE_WEBKIT && 'ongesturestart' in window) {
      this.container.removeEventListener('gesturestart', this.handleGestureStart as EventListener);
      this.container.removeEventListener('gesturechange', this.handleGestureChange as EventListener);
      this.container.removeEventListener('gestureend', this.handleGestureEnd as EventListener);
    }
    this.activePointers.clear();
  }
}
