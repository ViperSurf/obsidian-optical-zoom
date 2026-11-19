// src/input/input-recognizer.ts
import {
  IS_APPLE_WEBKIT,
  TOUCH_CLAIM_THRESHOLD_PX,
  DRAWER_FLICK_EDGE_PX,
  DRAWER_FLICK_MIN_TRAVEL_PX,
  DRAWER_FLICK_MAX_MS,
  EDGE_TOUCH_RESOLVE_MS,
} from '../constants';
import {
  classifyOneFingerDrag,
  edgeStartInfo,
  isDrawerFlick,
  shouldShield,
  type DrawerEdge,
} from './gesture-guards';
import type { OpticalZoomSettings, PinchGestureFrame } from '../types';

interface PointerSample {
  id: number;
  clientX: number;
  clientY: number;
}

interface SingleTouchPan {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startEpoch: number;
  claimed: boolean;   // Drag claimed as a full two-axis pan of the zoomed page
  // Deliberate-drawer classification for touches that start in the narrow
  // flick zone at a container edge. Mid-pane touches have edge === null
  // and are born resolved: they never go through classification.
  edge: DrawerEdge | null;
  edgeOffset: number;        // Distance from that edge at touchstart (px)
  edgeResolved: boolean;     // Classification finished (flick or pan candidate)
  drawerPassThrough: boolean; // Classified as a drawer flick: hands off for good
}

export class CrossPlatformInputRecognizer {
  private activePointers: Map<number, PointerSample> = new Map();
  private prevPinchDistance: number | null = null;
  private prevCentroid: { x: number; y: number } | null = null;
  private lastWebKitGestureScale = 1.0;
  private lastTwoFingerTapEpoch = 0;
  private twoFingerTouchStartEpoch = 0;
  private isWebKitGestureRunning = false;
  private singleTouchPan: SingleTouchPan | null = null;

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

    // 2b. Raw touch events. Obsidian's workspace drawer gestures are driven
    // by touch events at the workspace level, which pointer-event
    // preventDefault() never reaches — so pinch shielding and the
    // one-finger zoom pan have to happen here, on the container, before
    // the events bubble up to the workspace.
    // Capture phase first: while zoomed, touchmoves are stopped from the
    // very first pixel, before any workspace handler can latch onto them
    // (see the capture handler). Touchstarts are deliberately NOT stopped:
    // Obsidian's drawer gesture tracks from touchstart, and a fast inward
    // flick from the very edge must remain able to open a drawer on
    // purpose while zoomed. Edge touchstarts are classified on the move
    // instead (see handleTouchMove).
    this.container.addEventListener('touchmove', this.handleTouchMoveCapture, { capture: true, passive: true });
    this.container.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.container.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.container.addEventListener('touchend', this.handleTouchEndOrCancel, { passive: true });
    this.container.addEventListener('touchcancel', this.handleTouchEndOrCancel, { passive: true });

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
    if (shouldShield(this.getCurrentScale()) && e.deltaX !== 0) {
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

  private handleTouchMoveCapture = (e: TouchEvent): void => {
    if (this.getSettings().interactionMode === 'loupe-only') return;
    // A pinch must never reach workspace handlers from the first pixel.
    if (e.touches.length >= 2) {
      e.stopPropagation();
      return;
    }
    // While zoomed, a one-finger drag is stopped from the very first move,
    // whatever its direction. stopPropagation does NOT affect native
    // scrolling (only preventDefault does); the bubble-phase handler
    // below preventDefaults once the drag is claimed as a two-axis pan,
    // which is what hands vertical movement to the transform as well.
    // EXCEPTION: a touch that started in the edge flick zone is left
    // unshielded until the bubble-phase handler classifies it — shielding
    // it here would starve Obsidian's drawer gesture of the very moves it
    // needs to recognize a deliberate flick — and a touch already
    // classified as a drawer flick is never shielded at all.
    if (e.touches.length === 1 && shouldShield(this.getCurrentScale())) {
      const pan = this.singleTouchPan;
      if (pan && (pan.drawerPassThrough || (pan.edge !== null && !pan.edgeResolved))) {
        return;
      }
      e.stopPropagation();
    }
  };

  private handleTouchStart = (e: TouchEvent): void => {
    // Bubble phase records the touch for pan tracking. Nothing stops
    // touchstarts from propagating — at 100% the loupe controller at
    // window level sees every one (in particular a second finger landing,
    // which cancels its long-press), and while zoomed Obsidian's drawer
    // gesture must see edge touchstarts so a deliberate flick can work.
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const rect = this.container.getBoundingClientRect();
      const edgeInfo = edgeStartInfo(t.clientX, rect.left, rect.width, DRAWER_FLICK_EDGE_PX);
      this.singleTouchPan = {
        id: t.identifier,
        startX: t.clientX,
        startY: t.clientY,
        lastX: t.clientX,
        lastY: t.clientY,
        startEpoch: performance.now(),
        claimed: false,
        edge: edgeInfo?.edge ?? null,
        edgeOffset: edgeInfo?.offsetFromEdge ?? 0,
        edgeResolved: edgeInfo === null,
        drawerPassThrough: false,
      };
    } else {
      // A second finger supersedes any pending one-finger pan; the pinch
      // path (pointer events) takes over from here.
      this.singleTouchPan = null;
    }
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (this.getSettings().interactionMode === 'loupe-only') return;

    // Two-finger gesture: shield it from workspace-level touch handlers so
    // a pinch (or its pan component) can never be read as a drawer swipe.
    // The zoom frames themselves still come from the pointer-event path.
    if (e.touches.length >= 2) {
      e.preventDefault();
      e.stopPropagation();
      this.singleTouchPan = null;
      return;
    }

    if (e.touches.length !== 1 || !this.singleTouchPan) return;
    // At 100% a one-finger drag is native scrolling — never interfere.
    if (!shouldShield(this.getCurrentScale())) return;

    const t = e.touches[0];
    const pan = this.singleTouchPan;
    if (t.identifier !== pan.id) return;

    const dxTotal = t.clientX - pan.startX;
    const dyTotal = t.clientY - pan.startY;
    const stepDX = t.clientX - pan.lastX;
    const stepDY = t.clientY - pan.lastY;
    pan.lastX = t.clientX;
    pan.lastY = t.clientY;

    // A touch classified as a deliberate drawer flick is hands-off for
    // the rest of its life: no shielding, no claiming — Obsidian opens
    // the drawer.
    if (pan.drawerPassThrough) return;

    if (pan.edge !== null && !pan.edgeResolved) {
      // Edge-starting touch, not yet classified. Until it resolves, its
      // moves are neither shielded (the capture handler checks this same
      // state) nor claimed: the drawer gesture keeps seeing them.
      const elapsedMs = performance.now() - pan.startEpoch;
      if (
        isDrawerFlick(
          pan.edge,
          pan.edgeOffset,
          dxTotal,
          elapsedMs,
          DRAWER_FLICK_EDGE_PX,
          DRAWER_FLICK_MIN_TRAVEL_PX,
          DRAWER_FLICK_MAX_MS
        )
      ) {
        pan.drawerPassThrough = true;
        return;
      }
      const movingInOpeningDirection = pan.edge === 'left' ? dxTotal > 0 : dxTotal < 0;
      if (
        elapsedMs >= EDGE_TOUCH_RESOLVE_MS ||
        Math.abs(dxTotal) >= DRAWER_FLICK_MIN_TRAVEL_PX ||
        (Math.hypot(dxTotal, dyTotal) >= TOUCH_CLAIM_THRESHOLD_PX && !movingInOpeningDirection)
      ) {
        // Not a flick: too slow, travelled far but slowly, or heading in
        // the non-opening direction. It is a normal pan candidate — from
        // this move onward the usual shielding and claim logic apply
        // (this move itself is stopped below if it claims).
        pan.edgeResolved = true;
      } else {
        return; // Still ambiguous — keep hands off.
      }
    }

    if (!pan.claimed) {
      // Markor model: while zoomed, a one-finger drag past the threshold
      // is claimed as a full two-axis pan WHATEVER its direction — there
      // is no rejection path. The old direction classifier locked each
      // touch to a single fate (horizontal pan OR native vertical scroll),
      // so diagonal up/left drags were claimed or rejected inconsistently,
      // and a rejected drag could not move horizontally at all (the editor
      // has no native horizontal scroll), which read as "can't move up or
      // left". The 6px threshold matches the loupe's own move-to-cancel
      // distance, so claiming a pan and cancelling a pending loupe never
      // fight over the same gesture. classifyOneFingerDrag also re-checks
      // the zoom gate, so at 100% this never claims.
      if (
        classifyOneFingerDrag(dxTotal, dyTotal, TOUCH_CLAIM_THRESHOLD_PX, this.getCurrentScale()) !== 'pan'
      ) {
        return;
      }
      pan.claimed = true;
    }

    // Claimed pan: the finger drags the zoomed page around on both axes,
    // replacing native scrolling for this touch (the pan clamp ranges over
    // the note's full scroll extent, so every part of the note stays
    // reachable). preventDefault stops native scrolling of the scroller;
    // stopPropagation keeps the workspace drawer gestures from ever
    // seeing the drag — including the first claimed move. (While zoomed
    // the capture-phase handler has in fact already stopped every move
    // from propagating, and the loupe is gated off while zoomed, so
    // nothing of ours needs these events at window level.)
    e.preventDefault();
    e.stopPropagation();
    this.onFrame({
      scaleDelta: 1.0,
      panDeltaX: stepDX,
      panDeltaY: stepDY,
      focalClientX: t.clientX,
      focalClientY: t.clientY,
      source: 'pointer',
    });
  };

  private handleTouchEndOrCancel = (e: TouchEvent): void => {
    const wasClaimed = this.singleTouchPan?.claimed ?? false;
    if (e.touches.length === 0) {
      this.singleTouchPan = null;
    }
    // Never stopPropagation: the loupe controller clears its own state on
    // touchend at window level.
    if (wasClaimed && e.touches.length === 0) {
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
    this.container.removeEventListener('touchmove', this.handleTouchMoveCapture, true);
    this.container.removeEventListener('touchstart', this.handleTouchStart);
    this.container.removeEventListener('touchmove', this.handleTouchMove);
    this.container.removeEventListener('touchend', this.handleTouchEndOrCancel);
    this.container.removeEventListener('touchcancel', this.handleTouchEndOrCancel);
    this.singleTouchPan = null;
    if (IS_APPLE_WEBKIT && 'ongesturestart' in window) {
      this.container.removeEventListener('gesturestart', this.handleGestureStart as EventListener);
      this.container.removeEventListener('gesturechange', this.handleGestureChange as EventListener);
      this.container.removeEventListener('gestureend', this.handleGestureEnd as EventListener);
    }
    this.activePointers.clear();
  }
}
