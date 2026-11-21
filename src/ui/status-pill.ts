// src/ui/status-pill.ts
import { setTooltip } from 'obsidian';
import { INDICATOR_FADE_DELAY_MS, IS_MOBILE } from '../constants';
import type { IndicatorCornerPosition, OpticalZoomSettings } from '../types';

const CORNER_CLASSES: IndicatorCornerPosition[] = [
  'bottom-center',
  'bottom-right',
  'bottom-left',
  'top-center',
  'top-right',
  'top-left',
];

export class ZoomStatusIndicator {
  private pillEl: HTMLElement;
  private fadeTimer: number | null = null;
  private lastScale = 1.0;

  constructor(
    statusBarContainer: HTMLElement | null,
    private readonly getSettings: () => OpticalZoomSettings,
    private readonly onResetClick: () => void,
    private readonly isZoomLocked: () => boolean = () => false
  ) {
    if (!IS_MOBILE && statusBarContainer) {
      this.pillEl = statusBarContainer;
      this.pillEl.addClass('oz-status-pill', 'oz-hidden');
    } else {
      // Lightweight mobile corner pill (only visible when zoomed != 100%)
      this.pillEl = createEl('button');
      this.pillEl.className = 'oz-mobile-reset-pill oz-hidden';
      document.body.appendChild(this.pillEl);
    }

    this.applyCornerPosition();
    setTooltip(
      this.pillEl,
      'Current optical magnification. Click, press Esc, or 2-finger double-tap to reset to 100%.'
    );
    this.pillEl.addEventListener('click', (e) => {
      e.preventDefault();
      this.onResetClick();
    });
  }

  private applyCornerPosition(): void {
    if (!IS_MOBILE) return;
    const pos = this.getSettings().mobileIndicatorPosition;
    for (const corner of CORNER_CLASSES) {
      this.pillEl.classList.toggle(`oz-pos-${corner}`, corner === pos);
    }
  }

  private clearFadeTimer(): void {
    if (this.fadeTimer !== null) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  public refresh(): void {
    this.applyCornerPosition();
    this.update(this.lastScale);
  }

  public update(scale: number): void {
    this.lastScale = scale;
    this.clearFadeTimer();

    const settings = this.getSettings();
    const pct = Math.round(scale * 100);
    const locked = this.isZoomLocked();
    const hiddenByPlatformToggle = !IS_MOBILE && !settings.showStatusBarZoom;

    if ((pct === 100 && !locked) || settings.zoomIndicatorMode === 'hidden' || hiddenByPlatformToggle) {
      this.pillEl.classList.add('oz-hidden');
      this.pillEl.classList.remove('oz-faded');
      return;
    }

    this.applyCornerPosition();
    this.pillEl.classList.remove('oz-hidden', 'oz-faded');
    this.pillEl.textContent = locked ? `🔒 ${pct}% • Locked` : `🔍 ${pct}% • Reset (?)`;

    if (settings.zoomIndicatorMode === 'auto-fade') {
      this.fadeTimer = window.setTimeout(() => {
        this.fadeTimer = null;
        this.pillEl.classList.add('oz-faded');
      }, INDICATOR_FADE_DELAY_MS);
    }
  }

  public destroy(): void {
    this.clearFadeTimer();
    if (IS_MOBILE) {
      this.pillEl.remove();
    }
  }
}
