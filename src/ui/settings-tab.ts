// src/ui/settings-tab.ts
import { App, PluginSettingTab, Setting, setTooltip } from 'obsidian';
import type OpticalZoomPlugin from '../main';
import { DEFAULT_SETTINGS } from '../constants';
import type {
  DesktopLoupeModifier,
  LoupeMagnificationPreset,
  LoupeSizePreset,
  ZoomInteractionMode,
} from '../types';

export class OpticalZoomSettingTab extends PluginSettingTab {
  private pendingResetConfirm = false;
  private resetConfirmTimer: number | null = null;

  constructor(app: App, private readonly plugin: OpticalZoomPlugin) {
    super(app, plugin);
  }

  private appendHelpBadge(nameEl: HTMLElement, tooltipText: string): void {
    const badge = nameEl.createSpan({ cls: 'oz-help-badge', text: ' (?)' });
    badge.setAttribute('tabindex', '0');
    badge.setAttribute('role', 'button');
    badge.setAttribute('aria-label', tooltipText);
    setTooltip(badge, tooltipText, { placement: 'top' });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Control 1: Zoom Interaction Mode
    const modeSetting = new Setting(containerEl)
      .setName('Zoom interaction mode')
      .setDesc('Choose how optical magnification is triggered inside notes.')
      .addDropdown((drop) =>
        drop
          .addOption('both', 'Pinch-to-Zoom + Hold-to-Loupe (Both)')
          .addOption('pinch-only', 'Pinch-to-Zoom Only')
          .addOption('loupe-only', 'Hold-to-Loupe Only')
          .setValue(this.plugin.settings.interactionMode)
          .onChange(async (val) => {
            this.plugin.settings.interactionMode = val as ZoomInteractionMode;
            await this.plugin.saveSettings();
          })
      );
    this.appendHelpBadge(
      modeSetting.nameEl,
      'Pinch-to-Zoom scales the whole note around your fingers/cursor without changing font-size; Hold-to-Loupe pops up a temporary magnifying lens while keeping the rest of your note at 100%.'
    );

    // Control 2: Zoom Sensitivity & Max Magnification Cap
    const speedSetting = new Setting(containerEl)
      .setName('Zoom speed & maximum magnification')
      .setDesc('Adjust trackpad/touch pinch velocity and upper zoom limit.')
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 2.0, 0.1)
          .setValue(this.plugin.settings.zoomSensitivity)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.zoomSensitivity = val;
            await this.plugin.saveSettings();
          })
      )
      .addDropdown((drop) =>
        drop
          .addOption('2', 'Max 200%')
          .addOption('3', 'Max 300% (Default)')
          .addOption('4', 'Max 400%')
          .addOption('5', 'Max 500%')
          .setValue(String(this.plugin.settings.maxZoomScale))
          .onChange(async (val) => {
            this.plugin.settings.maxZoomScale = Number(val);
            await this.plugin.saveSettings();
          })
      );
    this.appendHelpBadge(
      speedSetting.nameEl,
      'Sensitivity controls how fast pinching zooms in or out (1.0x is natural 1:1 tracking). Maximum magnification caps how far you can zoom into dense formulas, graphs, or images.'
    );

    // Control 3: Loupe Lens Diameter & Power
    const loupeSetting = new Setting(containerEl)
      .setName('Loupe lens size & magnification power')
      .setDesc('Configure the spotlight magnifying glass for small characters and formulas.')
      .addDropdown((drop) =>
        drop
          .addOption('180', 'Small (180 px)')
          .addOption('240', 'Medium (240 px)')
          .addOption('320', 'Large (320 px)')
          .setValue(String(this.plugin.settings.loupeSizePx))
          .onChange(async (val) => {
            this.plugin.settings.loupeSizePx = Number(val) as LoupeSizePreset;
            await this.plugin.saveSettings();
          })
      )
      .addDropdown((drop) =>
        drop
          .addOption('1.5', '1.5x Zoom')
          .addOption('2', '2.0x Zoom (Default)')
          .addOption('2.5', '2.5x Zoom')
          .setValue(String(this.plugin.settings.loupeMagnification))
          .onChange(async (val) => {
            this.plugin.settings.loupeMagnification = Number(val) as LoupeMagnificationPreset;
            await this.plugin.saveSettings();
          })
      );
    this.appendHelpBadge(
      loupeSetting.nameEl,
      'Sets the diameter and optical power of the temporary magnifying glass so you can inspect tiny LaTeX subscripts, non-Western CJK/Arabic glyphs, or diagram labels without losing full-page context.'
    );

    // Control 4: Desktop Hold Key, Mobile Touch Loupe & Per-Tab Memory
    const triggerSetting = new Setting(containerEl)
      .setName('Loupe trigger & tab zoom memory')
      .setDesc('Desktop modifier key, mobile finger-offset loupe, and tab zoom persistence.')
      .addDropdown((drop) =>
        drop
          .addOption('Alt', 'Hold Alt / Option')
          .addOption('Control', 'Hold Ctrl')
          .addOption('Shift', 'Hold Shift')
          .addOption('Disabled', 'Desktop Key Disabled')
          .setValue(this.plugin.settings.desktopLoupeKey)
          .onChange(async (val) => {
            this.plugin.settings.desktopLoupeKey = val as DesktopLoupeModifier;
            await this.plugin.saveSettings();
          })
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.mobileTouchLoupe)
          .setTooltip('Enable mobile long-press & drag loupe (offset above your finger)')
          .onChange(async (val) => {
            this.plugin.settings.mobileTouchLoupe = val;
            await this.plugin.saveSettings();
          });
      })
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.rememberZoomPerTab)
          .setTooltip('Remember zoom level when switching between open tabs')
          .onChange(async (val) => {
            this.plugin.settings.rememberZoomPerTab = val;
            await this.plugin.saveSettings();
          });
      });
    this.appendHelpBadge(
      triggerSetting.nameEl,
      'Hold the chosen modifier key on Linux/Windows/macOS (or long-press with 1 finger on Android/iOS) to summon the magnifying glass. The second toggle keeps each tab\u2019s zoom level when switching notes.'
    );

    // Tier-2 Inline Confirmation Footer for Resetting Defaults (Zero Popups)
    const resetSetting = new Setting(containerEl)
      .setName('Restore default settings')
      .setDesc('Reset all 4 controls back to factory defaults.')
      .addButton((btn) => {
        btn.setButtonText('Reset defaults').onClick(async () => {
          if (!this.pendingResetConfirm) {
            this.pendingResetConfirm = true;
            btn.setButtonText('Tap again within 5s to confirm reset');
            btn.setWarning();
            this.resetConfirmTimer = window.setTimeout(() => {
              this.pendingResetConfirm = false;
              btn.setButtonText('Reset defaults');
            }, 5000);
            return;
          }
          if (this.resetConfirmTimer) window.clearTimeout(this.resetConfirmTimer);
          this.pendingResetConfirm = false;
          this.plugin.settings = { ...DEFAULT_SETTINGS };
          await this.plugin.saveSettings();
          this.display();
        });
      });
    this.appendHelpBadge(
      resetSetting.nameEl,
      'Uses an inline 2-tap confirmation instead of a popup dialog to prevent accidental resets.'
    );
  }
}
