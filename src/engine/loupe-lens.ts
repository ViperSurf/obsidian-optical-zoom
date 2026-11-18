// src/engine/loupe-lens.ts
import { IS_MOBILE, MOBILE_LONG_PRESS_MS, MOBILE_LOUPE_Y_OFFSET_PX } from '../constants';
import type { OpticalZoomSettings } from '../types';

export class OpticalLoupeController {
  private lensEl: HTMLElement | null = null;
  private cloneViewportEl: HTMLElement | null = null;
  private isActive = false;
  private rafId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private sourceRect: DOMRect | null = null;
  private longPressTimer: number | null = null;
  private activeTouchId: number | null = null;

  constructor(private readonly getSettings: () => OpticalZoomSettings) {
    this.bindGlobalListeners();
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
    if (IS_MOBILE || !this.isLoupeEnabled()) return;
    const requiredKey = this.getSettings().desktopLoupeKey;
    if (requiredKey === 'Disabled') return;

    if (e.key === requiredKey && !this.isActive) {
      this.activateLoupe(this.lastPointerX, this.lastPointerY, false);
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    const requiredKey = this.getSettings().desktopLoupeKey;
    if (e.key === requiredKey && this.isActive) {
      this.deactivateLoupe();
    }
  };

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

    if (!this.isActive && movedDist > 10) {
      // User is scrolling normally with 1 finger; cancel loupe activation
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
    const targetPane = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(
      '.markdown-preview-view, .cm-scroller'
    );
    if (!targetPane) return;

    this.sourceRect = targetPane.getBoundingClientRect();
    const settings = this.getSettings();
    const size = settings.loupeSizePx;

    // Build lens container
    this.lensEl = document.createElement('div');
    this.lensEl.className = 'oz-loupe-lens';
    this.lensEl.style.width = `${size}px`;
    this.lensEl.style.height = `${size}px`;

    // Clone current visible pane once per activation
    const clonedPane = targetPane.cloneNode(true) as HTMLElement;
    clonedPane.className = `${targetPane.className} oz-loupe-clone`;
    clonedPane.style.width = `${this.sourceRect.width}px`;
    clonedPane.style.height = `${this.sourceRect.height}px`;
    clonedPane.style.overflow = 'hidden';
    clonedPane.scrollTop = targetPane.scrollTop;
    clonedPane.scrollLeft = targetPane.scrollLeft;

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
    document.body.appendChild(this.lensEl);

    this.isActive = true;
    this.scheduleLensPositionUpdate(clientX, clientY, isTouchOffset);
  }

  private scheduleLensPositionUpdate(clientX: number, clientY: number, isTouchOffset: boolean): void {
    if (this.rafId !== null) return;
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      if (!this.isActive || !this.lensEl || !this.cloneViewportEl || !this.sourceRect) return;

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

      this.cloneViewportEl.style.transformOrigin = '0 0';
      this.cloneViewportEl.style.transform = `translate3d(${innerTx.toFixed(1)}px, ${innerTy.toFixed(1)}px, 0) scale(${mag})`;
    });
  }

  public deactivateLoupe = (): void => {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lensEl?.remove();
    this.lensEl = null;
    this.cloneViewportEl = null;
    this.sourceRect = null;
    this.isActive = false;
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
