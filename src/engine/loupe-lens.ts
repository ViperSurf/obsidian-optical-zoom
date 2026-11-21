// src/engine/loupe-lens.ts
import { IS_MOBILE, MOBILE_LONG_PRESS_MS, MOBILE_LOUPE_Y_OFFSET_PX, TOUCH_CLAIM_THRESHOLD_PX } from '../constants';
import { shouldShield } from '../input/gesture-guards';
import type { OpticalZoomSettings } from '../types';

export class OpticalLoupeController {
  private lensEl: HTMLElement | null = null;
  private cloneViewportEl: HTMLElement | null = null;
  private isActive = false;
  private rafId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private sourceRect: DOMRect | null = null;
  private sourceScrollTop = 0;
  private sourceScrollLeft = 0;
  private longPressTimer: number | null = null;
  private activeTouchId: number | null = null;
  private isToggledMode = false;

  constructor(
    private readonly getSettings: () => OpticalZoomSettings,
    private readonly getActiveScale: () => number = () => 1.0
  ) {
    this.bindGlobalListeners();
  }

  /**
   * The loupe never activates while the active pane is optically zoomed:
   * a still finger on a zoomed pane is a pan about to happen, and a loupe
   * over already-magnified content is pointless.
   */
  private isZoomed(): boolean {
    return shouldShield(this.getActiveScale());
  }

  private bindGlobalListeners(): void {
    window.addEventListener('keydown', this.handleKeyDown, { passive: true });
    window.addEventListener('keyup', this.handleKeyUp, { passive: true });
    window.addEventListener('blur', this.deactivateLoupe, { passive: true });
    window.addEventListener('pointermove', this.handlePointerMove, { passive: true });

    if (IS_MOBILE) {
      window.addEventListener('touchstart', this.handleTouchStart, { passive: true });
      window.addEventListener('touchmove', this.handleTouchMove, { passive: false });
      window.addEventListener('touchend', this.handleTouchEnd, { passive: true });
      window.addEventListener('touchcancel', this.handleTouchEnd, { passive: true });
    }
  }

  private isLoupeEnabled(): boolean {
    const mode = this.getSettings().interactionMode;
    return mode === 'both' || mode === 'loupe-only';
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isActive && this.isToggledMode) {
      this.deactivateLoupe();
      return;
    }
    if (IS_MOBILE || !this.isLoupeEnabled()) return;
    const requiredKey = this.getSettings().desktopLoupeKey;
    if (requiredKey === 'Disabled') return;

    if (e.key === requiredKey && !this.isActive) {
      this.isToggledMode = false;
      this.activateLoupe(this.lastPointerX, this.lastPointerY, false);
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (this.isToggledMode) return;
    const requiredKey = this.getSettings().desktopLoupeKey;
    if (e.key === requiredKey && this.isActive) {
      this.deactivateLoupe();
    }
  };

  public toggleLoupeAtCursor(): void {
    if (!this.isLoupeEnabled()) return;
    if (this.isActive) {
      this.deactivateLoupe();
      return;
    }
    const x = this.lastPointerX || window.innerWidth / 2;
    const y = this.lastPointerY || window.innerHeight / 2;
    this.isToggledMode = true;
    this.activateLoupe(x, y, false);
  }

  private handlePointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (this.isActive) {
      this.scheduleLensPositionUpdate(e.clientX, e.clientY, false);
    }
  };

  private handleTouchStart = (e: TouchEvent): void => {
    const settings = this.getSettings();
    if (!this.isLoupeEnabled() || !settings.mobileTouchLoupe) return;

    // While zoomed, holding a finger still is the start of a pan, not a
    // loupe request — never even schedule the long-press.
    if (this.isZoomed()) {
      this.clearLongPressTimer();
      return;
    }

    if (e.touches.length !== 1) {
      this.clearLongPressTimer();
      if (this.isActive) this.deactivateLoupe();
      return;
    }

    const touch = e.touches[0];
    this.activeTouchId = touch.identifier;
    this.lastPointerX = touch.clientX;
    this.lastPointerY = touch.clientY;

    this.clearLongPressTimer();
    this.longPressTimer = window.setTimeout(() => {
      this.activateLoupe(this.lastPointerX, this.lastPointerY, true);
    }, MOBILE_LONG_PRESS_MS);
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (e.touches.length !== 1) {
      this.clearLongPressTimer();
      return;
    }
    const touch = e.touches[0];
    const movedDist = Math.hypot(touch.clientX - this.lastPointerX, touch.clientY - this.lastPointerY);

    if (!this.isActive && movedDist > TOUCH_CLAIM_THRESHOLD_PX) {
      // User is scrolling or panning with 1 finger; cancel loupe activation
      this.clearLongPressTimer();
      return;
    }

    if (this.isActive) {
      e.preventDefault(); // Prevent scrolling while dragging the active loupe
      this.lastPointerX = touch.clientX;
      this.lastPointerY = touch.clientY;
      this.scheduleLensPositionUpdate(touch.clientX, touch.clientY, true);
    }
  };

  private handleTouchEnd = (): void => {
    this.clearLongPressTimer();
    this.activeTouchId = null;
    if (this.isActive) {
      this.deactivateLoupe();
    }
  };

  private clearLongPressTimer(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  public activateLoupe(clientX: number, clientY: number, isTouchOffset: boolean): void {
    // Single-instance guard: any previous lens (active or orphaned) is
    // removed first, so there can never be two lens elements in the DOM.
    this.deactivateLoupe();

    // Never activate while the active pane is zoomed. This is also the
    // long-press timer's fire-time check: if a pinch zoom intervened
    // while the timer was pending, the activation is refused here.
    if (this.isZoomed()) return;

    const targetPane = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(
      '.markdown-preview-view, .cm-scroller'
    );
    if (!targetPane) return;

    this.sourceRect = targetPane.getBoundingClientRect();
    this.sourceScrollTop = targetPane.scrollTop;
    this.sourceScrollLeft = targetPane.scrollLeft;
    const settings = this.getSettings();
    const size = settings.loupeSizePx;

    // Build lens container
    this.lensEl = document.body.createDiv({
      cls: settings.loupeShape === 'circle' ? 'oz-loupe-lens oz-loupe-circle' : 'oz-loupe-lens',
    });
    this.lensEl.style.width = `${size}px`;
    this.lensEl.style.height = `${size}px`;

    // Clone current visible pane once per activation
    const clonedPane = targetPane.cloneNode(true) as HTMLElement;
    clonedPane.className = `${targetPane.className} oz-loupe-clone`;
    clonedPane.style.width = `${this.sourceRect.width}px`;
    clonedPane.style.height = `${this.sourceRect.height}px`;

    // Neutralize any optical-zoom transform carried by the cloned inner
    // sizer — the loupe magnifies the clean content with its own scale.
    clonedPane
      .querySelectorAll<HTMLElement>('.cm-sizer, .markdown-preview-sizer')
      .forEach((sizer) => {
        sizer.style.removeProperty('transform');
        sizer.style.removeProperty('transform-origin');
      });

    // Copy any canvas bitmaps (e.g., Excalidraw/charts) once on activation
    const origCanvases = targetPane.querySelectorAll('canvas');
    const cloneCanvases = clonedPane.querySelectorAll('canvas');
    origCanvases.forEach((origCanvas, idx) => {
      const destCanvas = cloneCanvases[idx];
      if (destCanvas && origCanvas.width > 0 && origCanvas.height > 0) {
        const ctx = destCanvas.getContext('2d');
        ctx?.drawImage(origCanvas, 0, 0);
      }
    });

    this.cloneViewportEl = clonedPane;
    this.lensEl.appendChild(this.cloneViewportEl);

    // Apply the captured scroll position only AFTER the clone is attached:
    // scroll assignments on a detached node are dropped (no layout), which
    // left the lens showing the empty region above CodeMirror's rendered
    // lines — a blank white box. It is re-applied on the first rAF too.
    clonedPane.scrollTop = this.sourceScrollTop;
    clonedPane.scrollLeft = this.sourceScrollLeft;

    this.isActive = true;
    this.scheduleLensPositionUpdate(clientX, clientY, isTouchOffset);
  }

  private scheduleLensPositionUpdate(clientX: number, clientY: number, isTouchOffset: boolean): void {
    if (this.rafId !== null) return;
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      if (!this.isActive || !this.lensEl || !this.cloneViewportEl || !this.sourceRect) return;

      // Re-apply the captured scroll position inside the frame as well:
      // if the first post-append assignment raced layout, this guarantees
      // the clone is scrolled to the same lines as the source pane.
      this.cloneViewportEl.scrollTop = this.sourceScrollTop;
      this.cloneViewportEl.scrollLeft = this.sourceScrollLeft;

      const settings = this.getSettings();
      const size = settings.loupeSizePx;
      const half = size / 2;
      const mag = settings.loupeMagnification;

      // On Android/iOS, offset the lens above the user's finger so the thumb does not block the view
      const lensCenterX = clientX;
      const lensCenterY = isTouchOffset ? Math.max(half + 12, clientY - MOBILE_LOUPE_Y_OFFSET_PX) : clientY;

      this.lensEl.style.transform = `translate3d(${(lensCenterX - half).toFixed(1)}px, ${(lensCenterY - half).toFixed(1)}px, 0)`;

      // Align the exact pixel at (clientX, clientY) inside the center of the magnified lens
      const relX = clientX - this.sourceRect.left;
      const relY = clientY - this.sourceRect.top;
      const innerTx = half - relX * mag;
      const innerTy = half - relY * mag;

      this.cloneViewportEl.style.transform = `translate3d(${innerTx.toFixed(1)}px, ${innerTy.toFixed(1)}px, 0) scale(${mag})`;
    });
  }

  public deactivateLoupe = (): void => {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lensEl?.remove();
    // Sweep any stray lens elements too — an orphaned lens must never
    // survive in the DOM, whatever path created it.
    document.querySelectorAll('.oz-loupe-lens').forEach((el) => el.remove());
    this.lensEl = null;
    this.cloneViewportEl = null;
    this.sourceRect = null;
    this.sourceScrollTop = 0;
    this.sourceScrollLeft = 0;
    this.isActive = false;
    this.isToggledMode = false;
  };

  public destroy(): void {
    this.clearLongPressTimer();
    this.deactivateLoupe();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.deactivateLoupe);
    window.removeEventListener('pointermove', this.handlePointerMove);
    if (IS_MOBILE) {
      window.removeEventListener('touchstart', this.handleTouchStart);
      window.removeEventListener('touchmove', this.handleTouchMove);
      window.removeEventListener('touchend', this.handleTouchEnd);
      window.removeEventListener('touchcancel', this.handleTouchEnd);
    }
  }
}
