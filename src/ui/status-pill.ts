// src/ui/status-pill.ts
import { setTooltip } from 'obsidian';
import { IS_MOBILE } from '../constants';

export class ZoomStatusIndicator {
  private pillEl: HTMLElement;

  constructor(statusBarContainer: HTMLElement | null, private readonly onResetClick: () => void) {
    if (!IS_MOBILE && statusBarContainer) {
      this.pillEl = statusBarContainer;
      this.pillEl.addClass('oz-status-pill', 'oz-hidden');
    } else {
      // Lightweight mobile corner pill (only visible when zoomed != 100%)
      this.pillEl = document.createElement('button');
      this.pillEl.className = 'oz-mobile-reset-pill oz-hidden';
      document.body.appendChild(this.pillEl);
    }

    setTooltip(
      this.pillEl,
      'Current optical magnification. Click or press Ctrl/Cmd+0 (or 2-finger double-tap) to reset to 100%.'
    );
    this.pillEl.addEventListener('click', (e) => {
      e.preventDefault();
      this.onResetClick();
    });
  }

  public update(scale: number): void {
    const pct = Math.round(scale * 100);
    if (pct === 100) {
      this.pillEl.addClass('oz-hidden');
      return;
    }
    this.pillEl.removeClass('oz-hidden');
    this.pillEl.textContent = `🔍 ${pct}% • Reset (?)`;
  }

  public destroy(): void {
    if (IS_MOBILE) {
      this.pillEl.remove();
    }
  }
}
