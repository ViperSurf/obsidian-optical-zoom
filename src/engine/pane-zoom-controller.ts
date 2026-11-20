// src/engine/pane-zoom-controller.ts
import type { WorkspaceLeaf } from 'obsidian';
import { SETTLE_DEBOUNCE_MS } from '../constants';
import {
  computeFocalZoomTransform,
  applyMagneticSnap,
  focalPointFromClient,
  type PanBounds,
} from '../math/affine-focal';
import { CrossPlatformInputRecognizer } from '../input/input-recognizer';
import { shouldShield } from '../input/gesture-guards';
import type { AffineTransformState, OpticalZoomSettings, PinchGestureFrame } from '../types';

function clearTransformProps(el: HTMLElement): void {
  if (typeof el.setCssProps === 'function') {
    el.setCssProps({ transform: '', 'transform-origin': '' });
  } else if (typeof el.style.removeProperty === 'function') {
    el.style.removeProperty('transform');
    el.style.removeProperty('transform-origin');
  } else {
    el.style.cssText = '';
  }
}

function setTransformOriginZero(el: HTMLElement): void {
  if (typeof el.setCssProps === 'function') {
    el.setCssProps({ 'transform-origin': '0 0' });
  } else if (typeof el.style.setProperty === 'function') {
    el.style.setProperty('transform-origin', '0 0');
  }
}

export class PaneZoomController {
  private state: AffineTransformState = {
    scale: 1.0,
    tx: 0,
    ty: 0,
    isGestureActive: false,
  };

  private renderedTx = 0;
  private renderedTy = 0;
  private lastTargetEl: HTMLElement | null = null;
  private rafId: number | null = null;
  private settleTimer: number | null = null;
  private recognizer: CrossPlatformInputRecognizer | null = null;
  private containerEl: HTMLElement;

  constructor(
    public readonly leaf: WorkspaceLeaf,
    private readonly getSettings: () => OpticalZoomSettings,
    private readonly onScaleChanged: (scale: number) => void,
    private readonly isZoomLocked: () => boolean = () => false
  ) {
    this.containerEl = (this.leaf.view as any).contentEl ?? this.leaf.view.containerEl;
    this.containerEl.classList.add('oz-zoom-host');

    this.recognizer = new CrossPlatformInputRecognizer(
      this.containerEl,
      this.getSettings,
      (frame) => this.handlePinchFrame(frame),
      () => this.scheduleGestureSettle(),
      () => this.resetZoom(true),
      () => this.state.scale
    );
  }

  /**
   * Resolves the active viewport scroll container and inner content target
   * without touching outer scrollbars.
   */
  private resolveDomTargets(): { viewport: HTMLElement; target: HTMLElement } | null {
    const viewEl = this.containerEl;
    // Check Reading View active first
    const readingView = viewEl.querySelector<HTMLElement>('.markdown-reading-view');
    if (readingView && readingView.style.display !== 'none') {
      const previewViewport = readingView.querySelector<HTMLElement>('.markdown-preview-view');
      const previewSizer = readingView.querySelector<HTMLElement>('.markdown-preview-sizer');
      if (previewViewport && previewSizer) {
        return { viewport: previewViewport, target: previewSizer };
      }
    }

    // Fallback to CodeMirror 6 Live Preview / Source View
    const cmScroller = viewEl.querySelector<HTMLElement>('.cm-scroller');
    const cmSizer = viewEl.querySelector<HTMLElement>('.cm-sizer') ?? viewEl.querySelector<HTMLElement>('.cm-content');
    if (cmScroller && cmSizer) {
      return { viewport: cmScroller, target: cmSizer };
    }

    return null;
  }

  /**
   * Builds the pan-clamp geometry for the current DOM state.
   *
   * Content size comes from the target's own local (untransformed) layout
   * dimensions (`offsetWidth`/`offsetHeight` and `scrollWidth`/`scrollHeight`
   * on the target itself). Unlike `viewport.scrollWidth`/`scrollHeight`, a
   * transformed element's own layout/scroll dimensions are invariant to its
   * own CSS `transform` — using `viewport.scrollWidth`/`scrollHeight` inflated
   * `contentSize` by `scale` and shifted it with `tx`/`ty`, which caused the
   * clamp to multiply by `scale` twice and shift bounds mid-pan.
   *
   * The origin offset is where the target's untransformed top-left corner
   * sits relative to the viewport (its transformed rect backs out the
   * currently rendered `renderedTx`/`renderedTy`).
   */
  private resolvePanBounds(
    viewport: HTMLElement,
    target: HTMLElement,
    targetRect: DOMRect
  ): PanBounds {
    const viewportRect = viewport.getBoundingClientRect();
    return {
      viewportWidth: viewportRect.width,
      viewportHeight: viewportRect.height,
      contentWidth: Math.max(target.offsetWidth, target.scrollWidth),
      contentHeight: Math.max(target.offsetHeight, target.scrollHeight),
      originOffsetX: targetRect.left - this.renderedTx - viewportRect.left,
      originOffsetY: targetRect.top - this.renderedTy - viewportRect.top,
    };
  }

  private syncZoomHostClass(): void {
    this.containerEl.classList.toggle('oz-is-zoomed', shouldShield(this.state.scale));
  }

  private handlePinchFrame(frame: PinchGestureFrame): void {
    const dom = this.resolveDomTargets();
    if (!dom) return;

    // If the user switched between Reading View and Live Preview while zoomed,
    // reset stale state on the previous target before applying new frames.
    if (this.lastTargetEl && this.lastTargetEl !== dom.target) {
      clearTransformProps(this.lastTargetEl);
      this.lastTargetEl.classList.remove('oz-gesturing', 'oz-smooth-reset');
      this.state = { scale: 1.0, tx: 0, ty: 0, isGestureActive: false };
      this.renderedTx = 0;
      this.renderedTy = 0;
    }
    this.lastTargetEl = dom.target;

    // The affine formula anchors at the focal point measured from the
    // target's *untransformed* origin. The transformed target's rect already
    // includes the currently rendered translation, so focalPointFromClient
    // backs out `renderedTx`/`renderedTy` (not pending `state.tx`/`state.ty`
    // in case multiple frames arrive before rAF).
    const targetRect = dom.target.getBoundingClientRect();
    const { focalX, focalY } = focalPointFromClient(
      frame.focalClientX,
      frame.focalClientY,
      targetRect.left,
      targetRect.top,
      this.renderedTx,
      this.renderedTy
    );

    const bounds = this.resolvePanBounds(dom.viewport, dom.target, targetRect);
    const settings = this.getSettings();
    const effectiveScaleDelta = this.isZoomLocked() ? 1.0 : frame.scaleDelta;
    this.state = computeFocalZoomTransform(
      this.state,
      effectiveScaleDelta,
      focalX,
      focalY,
      frame.panDeltaX,
      frame.panDeltaY,
      settings.minZoomScale,
      settings.maxZoomScale,
      bounds
    );

    // Keep viewport.scrollTop centered on the *visible* unscaled content
    // coordinate (y_center) rather than tracking screen-pixel ty. At 2x–3x
    // zoom, clamping ty alone pushes scrollTop up to 3x further down the note
    // than what is actually on screen, causing CM6 / Reading View to unload
    // visible lines and tables (white screen on fast scrolls).
    let scrollChanged = false;
    if (this.state.scale > 1.0) {
      const maxScrollTop = Math.max(0, bounds.contentHeight - bounds.viewportHeight);
      const yCenter =
        (bounds.viewportHeight / 2 - bounds.originOffsetY - this.state.ty) / this.state.scale;
      const desiredScrollTop = Math.min(
        maxScrollTop,
        Math.max(0, yCenter - bounds.viewportHeight / 2)
      );
      if (Math.abs(desiredScrollTop - dom.viewport.scrollTop) >= 1) {
        const prevScrollTop = dom.viewport.scrollTop;
        // Use direct scrollTop assignment (with CSS scroll-behavior: auto !important)
        // rather than scrollTo({ behavior: 'instant' }), which throws TypeError on
        // older Android WebViews where 'instant' is not a valid ScrollBehavior enum.
        dom.viewport.scrollTop = desiredScrollTop;
        const actualDelta = dom.viewport.scrollTop - prevScrollTop;
        if (actualDelta !== 0) {
          this.state = { ...this.state, ty: this.state.ty + actualDelta };
          scrollChanged = true;
        }
      }
    }

    this.syncZoomHostClass();
    dom.target.classList.add('oz-gesturing');
    if (scrollChanged) {
      // Apply transform synchronously when scrollTop changed so there is zero 1-frame jump.
      this.applyTransformToElement(dom.target);
      this.onScaleChanged(this.state.scale);
    } else {
      this.scheduleRender(dom.target);
    }
  }

  public stepZoomByFactor(multiplier: number): void {
    if (this.isZoomLocked()) return;
    const dom = this.resolveDomTargets();
    if (!dom) return;
    const rect = dom.viewport.getBoundingClientRect();
    this.handlePinchFrame({
      scaleDelta: multiplier,
      panDeltaX: 0,
      panDeltaY: 0,
      focalClientX: rect.left + rect.width / 2,
      focalClientY: rect.top + rect.height / 2,
      source: 'keyboard',
    });
    this.scheduleGestureSettle();
  }

  public setScale(targetScale: number): void {
    const dom = this.resolveDomTargets();
    const settings = this.getSettings();
    const clamped = Math.min(settings.maxZoomScale, Math.max(settings.minZoomScale, targetScale));
    if (Math.abs(clamped - 1.0) <= 0.005) {
      this.resetZoom(false);
      return;
    }
    this.lastTargetEl = dom?.target ?? null;
    this.state = { scale: clamped, tx: 0, ty: 0, isGestureActive: false };
    this.syncZoomHostClass();
    if (dom) {
      this.applyTransformToElement(dom.target);
    }
    this.onScaleChanged(clamped);
  }

  public resetZoom(animate = true): void {
    const dom = this.resolveDomTargets();
    this.state = { scale: 1.0, tx: 0, ty: 0, isGestureActive: false };
    this.syncZoomHostClass();
    if (!dom) {
      this.renderedTx = 0;
      this.renderedTy = 0;
      this.onScaleChanged(1.0);
      return;
    }

    if (animate) {
      dom.target.classList.add('oz-smooth-reset');
      window.setTimeout(() => dom.target.classList.remove('oz-smooth-reset'), 140);
    }

    this.applyTransformToElement(dom.target);
    this.onScaleChanged(1.0);
  }

  private scheduleRender(target: HTMLElement): void {
    if (this.rafId !== null) return;
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      this.applyTransformToElement(target);
      this.onScaleChanged(this.state.scale);
    });
  }

  private applyTransformToElement(target: HTMLElement): void {
    if (this.state.scale === 1.0 && this.state.tx === 0 && this.state.ty === 0) {
      clearTransformProps(target);
      this.renderedTx = 0;
      this.renderedTy = 0;
      return;
    }
    setTransformOriginZero(target);
    target.style.transform = `translate3d(${this.state.tx.toFixed(2)}px, ${this.state.ty.toFixed(2)}px, 0) scale(${this.state.scale.toFixed(4)})`;
    this.renderedTx = this.state.tx;
    this.renderedTy = this.state.ty;
  }

  private scheduleGestureSettle(): void {
    if (this.settleTimer !== null) {
      window.clearTimeout(this.settleTimer);
    }
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = null;
      const snapped = applyMagneticSnap(this.state);
      const didSnap = snapped.scale !== this.state.scale;
      this.state = snapped;
      this.syncZoomHostClass();

      const dom = this.resolveDomTargets();
      if (dom) {
        // Remove will-change promotion so WebKit/Blink re-rasterizes SVGs and MathJax crisply at target scale
        dom.target.classList.remove('oz-gesturing');
        if (didSnap) {
          dom.target.classList.add('oz-smooth-reset');
          window.setTimeout(() => dom.target.classList.remove('oz-smooth-reset'), 130);
          if (snapped.scale === 1.0 && this.getSettings().snapFeedback) {
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
              navigator.vibrate(10);
            }
            dom.viewport.classList.add('oz-snap-pulse');
            window.setTimeout(() => dom.viewport.classList.remove('oz-snap-pulse'), 240);
          }
        }
        this.applyTransformToElement(dom.target);
      }
      this.onScaleChanged(this.state.scale);
    }, SETTLE_DEBOUNCE_MS);
  }

  public getScale(): number {
    return this.state.scale;
  }

  public destroy(): void {
    if (this.rafId !== null) window.cancelAnimationFrame(this.rafId);
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.recognizer?.destroy();
    const dom = this.resolveDomTargets();
    if (dom) {
      clearTransformProps(dom.target);
      dom.target.classList.remove('oz-gesturing', 'oz-smooth-reset');
    }
    this.lastTargetEl = null;
    this.containerEl.classList.remove('oz-zoom-host', 'oz-is-zoomed');
  }
}
