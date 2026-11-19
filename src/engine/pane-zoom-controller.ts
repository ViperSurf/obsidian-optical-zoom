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
import type { AffineTransformState, OpticalZoomSettings, PinchGestureFrame } from '../types';

export class PaneZoomController {
  private state: AffineTransformState = {
    scale: 1.0,
    tx: 0,
    ty: 0,
    isGestureActive: false,
  };

  private rafId: number | null = null;
  private settleTimer: number | null = null;
  private recognizer: CrossPlatformInputRecognizer | null = null;
  private containerEl: HTMLElement;

  constructor(
    public readonly leaf: WorkspaceLeaf,
    private readonly getSettings: () => OpticalZoomSettings,
    private readonly onScaleChanged: (scale: number) => void
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
   * Content size comes from the VIEWPORT scroller's scrollWidth /
   * scrollHeight: by definition the full unscaled extent of the note —
   * the same measure that makes native scrolling reach the whole note.
   * The transformed sizer's offsetWidth/offsetHeight are NOT a
   * trustworthy substitute in CM6 / Reading layouts (the resolved target
   * can be a virtualized chunk whose layout size is only the rendered
   * window), and clamping against them made pan travel run out mid-note:
   * the page stopped partway up or to the left and only a zoom-out /
   * zoom-in cycle let the user reach that side.
   *
   * The origin offset is where the target's untransformed top-left corner
   * sits relative to the viewport (its transformed rect backs out tx/ty).
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
      contentWidth: viewport.scrollWidth,
      contentHeight: viewport.scrollHeight,
      originOffsetX: targetRect.left - this.state.tx - viewportRect.left,
      originOffsetY: targetRect.top - this.state.ty - viewportRect.top,
    };
  }

  private handlePinchFrame(frame: PinchGestureFrame): void {
    const dom = this.resolveDomTargets();
    if (!dom) return;

    // The affine formula anchors at the focal point measured from the
    // target's *untransformed* origin. The transformed target's rect already
    // includes the current translation, so focalPointFromClient backs it
    // out. (Measuring from the viewport instead is off by the scroll offset
    // and the centered-column margin, which made zoom slide vertically and
    // horizontally away from the pinch spot.)
    const targetRect = dom.target.getBoundingClientRect();
    const { focalX, focalY } = focalPointFromClient(
      frame.focalClientX,
      frame.focalClientY,
      targetRect.left,
      targetRect.top,
      this.state.tx,
      this.state.ty
    );

    const settings = this.getSettings();
    this.state = computeFocalZoomTransform(
      this.state,
      frame.scaleDelta,
      focalX,
      focalY,
      frame.panDeltaX,
      frame.panDeltaY,
      settings.minZoomScale,
      settings.maxZoomScale,
      this.resolvePanBounds(dom.viewport, dom.target, targetRect)
    );

    dom.target.classList.add('oz-gesturing');
    this.scheduleRender(dom.target);
  }

  public stepZoomByFactor(multiplier: number): void {
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

  public resetZoom(animate = true): void {
    const dom = this.resolveDomTargets();
    this.state = { scale: 1.0, tx: 0, ty: 0, isGestureActive: false };
    if (!dom) {
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
      target.style.transform = '';
      target.style.transformOrigin = '';
      return;
    }
    target.style.transformOrigin = '0 0';
    target.style.transform = `translate3d(${this.state.tx.toFixed(2)}px, ${this.state.ty.toFixed(2)}px, 0) scale(${this.state.scale.toFixed(4)})`;
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

      const dom = this.resolveDomTargets();
      if (dom) {
        // Remove will-change promotion so WebKit/Blink re-rasterizes SVGs and MathJax crisply at target scale
        dom.target.classList.remove('oz-gesturing');
        if (didSnap) {
          dom.target.classList.add('oz-smooth-reset');
          window.setTimeout(() => dom.target.classList.remove('oz-smooth-reset'), 130);
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
      dom.target.style.transform = '';
      dom.target.style.transformOrigin = '';
      dom.target.classList.remove('oz-gesturing', 'oz-smooth-reset');
    }
    this.containerEl.classList.remove('oz-zoom-host');
  }
}
