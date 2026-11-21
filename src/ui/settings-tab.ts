// src/ui/settings-tab.ts
import { App, PluginSettingTab, Setting, setTooltip } from 'obsidian';
import type OpticalZoomPlugin from '../main';
import { DEFAULT_SETTINGS } from '../constants';
import type {
  DesktopLoupeModifier,
  IndicatorCornerPosition,
  LoupeMagnificationPreset,
  LoupeShape,
  ZoomIndicatorMode,
  ZoomInteractionMode,
} from '../types';

export class OpticalZoomSettingTab extends PluginSettingTab {
  private pendingResetConfirm = false;
  private resetConfirmTimer: number | null = null;
  private pendingClearNotesConfirm = false;
  private clearNotesConfirmTimer: number | null = null;

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
    this.renderSettings();
  }

  private renderSettings(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 1. Zoom Interaction Mode
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
      'Pinch-to-Zoom scales the whole note without text reflow or font-size changes; Hold-to-Loupe pops up a temporary magnifying lens while keeping the rest of your note at 100%.'
    );

    // 2. Zoom Sensitivity
    const speedSetting = new Setting(containerEl)
      .setName('Zoom speed')
      .setDesc('Adjust trackpad and touch pinch velocity.')
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 2.0, 0.1)
          .setValue(this.plugin.settings.zoomSensitivity)
          .onChange(async (val) => {
            this.plugin.settings.zoomSensitivity = val;
            await this.plugin.saveSettings();
          })
      );
    this.appendHelpBadge(
      speedSetting.nameEl,
      'Controls how fast pinching zooms in or out (1.0x is natural 1:1 tracking).'
    );

    // 3. Maximum Magnification Cap
    const maxZoomSetting = new Setting(containerEl)
      .setName('Maximum magnification')
      .setDesc('Set the upper zoom limit.')
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
      maxZoomSetting.nameEl,
      'Caps how far you can zoom into dense formulas, graphs, tables, or images.'
    );

    // 3. Hotkey Zoom Step
    const stepSetting = new Setting(containerEl)
      .setName('Hotkey zoom step (%)')
      .setDesc('Step size used by the Optical zoom in / out commands and hotkeys.')
      .addSlider((slider) =>
        slider
          .setLimits(5, 50, 5)
          .setValue(this.plugin.settings.hotkeyZoomStepPercent)
          .onChange(async (val) => {
            this.plugin.settings.hotkeyZoomStepPercent = val;
            await this.plugin.saveSettings();
          })
      );
    this.appendHelpBadge(
      stepSetting.nameEl,
      'Controls how much each "Optical zoom in" or "Optical zoom out" command/hotkey scales the view (default 25%).'
    );

    // 4. Pinch Jitter Stabilization (for shaky hands during 2-finger pan)
    const jitterSetting = new Setting(containerEl)
      .setName('Pinch jitter stabilization')
      .setDesc('Filter out tiny finger-distance fluctuations so 2-finger panning stays steady.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.pinchJitterFilter)
          .onChange(async (val) => {
            this.plugin.settings.pinchJitterFilter = val;
            await this.plugin.saveSettings();
          });
      });
    this.appendHelpBadge(
      jitterSetting.nameEl,
      'Requires a small intentional pinch movement before changing zoom level, preventing sporadic zoom jitter if your hands shake while 2-finger panning.'
    );

    // 5. Smooth Pan Momentum
    const momentumSetting = new Setting(containerEl)
      .setName('Smooth pan momentum')
      .setDesc('Add gentle deceleration after releasing a fast 1-finger pan on touchscreens.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.panMomentum)
          .onChange(async (val) => {
            this.plugin.settings.panMomentum = val;
            await this.plugin.saveSettings();
          });
      });
    this.appendHelpBadge(
      momentumSetting.nameEl,
      'Lets fast 1-finger pans glide smoothly to a stop instead of halting abruptly on finger lift.'
    );

    // 6. Reset Zoom on Escape
    const escapeSetting = new Setting(containerEl)
      .setName('Reset zoom on Escape')
      .setDesc('Press Escape while zoomed (with no modal or loupe open) to return to 100%.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.resetOnEscape)
          .onChange(async (val) => {
            this.plugin.settings.resetOnEscape = val;
            await this.plugin.saveSettings();
          });
      });
    this.appendHelpBadge(
      escapeSetting.nameEl,
      'On by default. Turn off if you want Escape to keep its normal editor behavior while zoomed.'
    );

    // 7. Loupe Lens Diameter
    const loupeSizeSetting = new Setting(containerEl)
      .setName('Loupe lens size (px)')
      .setDesc('Diameter of the magnifying glass lens (140–400 px).')
      .addSlider((slider) =>
        slider
          .setLimits(140, 400, 10)
          .setValue(this.plugin.settings.loupeSizePx)
          .onChange(async (val) => {
            this.plugin.settings.loupeSizePx = val;
            await this.plugin.saveSettings();
          })
      );
    this.appendHelpBadge(
      loupeSizeSetting.nameEl,
      'Sets the diameter in pixels of the temporary magnifying glass.'
    );

    // 8. Loupe Magnification Power
    const loupePowerSetting = new Setting(containerEl)
      .setName('Loupe magnification power')
      .setDesc('Optical zoom strength inside the magnifying glass.')
      .addDropdown((drop) =>
        drop
          .addOption('1.25', '1.25x Zoom')
          .addOption('1.5', '1.5x Zoom')
          .addOption('2', '2.0x Zoom (Default)')
          .addOption('2.5', '2.5x Zoom')
          .addOption('3', '3.0x Zoom')
          .addOption('4', '4.0x Zoom')
          .setValue(String(this.plugin.settings.loupeMagnification))
          .onChange(async (val) => {
            this.plugin.settings.loupeMagnification = Number(val) as LoupeMagnificationPreset;
            await this.plugin.saveSettings();
          })
      );
    this.appendHelpBadge(
      loupePowerSetting.nameEl,
      'Controls how strongly the loupe magnifies tiny LaTeX subscripts, non-Western CJK/Arabic glyphs, or diagram labels without zooming the rest of the page.'
    );

    // 7. Loupe Lens Shape
    const loupeShapeSetting = new Setting(containerEl)
      .setName('Loupe lens shape')
      .setDesc('Choose between a rounded rectangle or circular magnifying glass.')
      .addDropdown((drop) =>
        drop
          .addOption('rounded', 'Rounded Rectangle (Default)')
          .addOption('circle', 'Circle')
          .setValue(this.plugin.settings.loupeShape)
          .onChange(async (val) => {
            this.plugin.settings.loupeShape = val as LoupeShape;
            await this.plugin.saveSettings();
          })
      );
    this.appendHelpBadge(
      loupeShapeSetting.nameEl,
      'Changes the shape of the magnifying loupe lens on both desktop and mobile.'
    );

    // 10. Desktop Loupe Trigger
    const desktopLoupeSetting = new Setting(containerEl)
      .setName('Desktop loupe key')
      .setDesc('Modifier key held on desktop to summon the loupe (or use the Toggle magnifying loupe command).')
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
      );
    this.appendHelpBadge(
      desktopLoupeSetting.nameEl,
      'Hold the chosen modifier key on Linux/Windows/macOS and hover to summon the magnifying glass.'
    );

    // 11. Mobile Touch Loupe Trigger
    const mobileLoupeSetting = new Setting(containerEl)
      .setName('Mobile touch loupe')
      .setDesc('Long-press (500 ms) with 1 finger at 100% zoom and drag (lens floats above your finger).')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.mobileTouchLoupe)
          .onChange(async (val) => {
            this.plugin.settings.mobileTouchLoupe = val;
            await this.plugin.saveSettings();
          });
      });
    this.appendHelpBadge(
      mobileLoupeSetting.nameEl,
      'When enabled on Android/iOS, holding 1 finger still for 500 ms at 100% zoom opens the loupe 76 px above your thumb so it never covers the text.'
    );

    // 7. Tab Zoom Memory (its own separate area)
    const tabMemorySetting = new Setting(containerEl)
      .setName('Remember zoom per tab')
      .setDesc('Keep each open tab’s zoom level when switching between notes.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.rememberZoomPerTab)
          .onChange(async (val) => {
            this.plugin.settings.rememberZoomPerTab = val;
            await this.plugin.saveSettings();
          });
      });
    this.appendHelpBadge(
      tabMemorySetting.nameEl,
      'When enabled, each note tab preserves its magnification when you switch away and come back. When off, switching tabs resets zoom to 100%.'
    );

    // 9. Per-Note Persistent Zoom
    const noteMemorySetting = new Setting(containerEl)
      .setName('Remember zoom per note')
      .setDesc('Save and restore each note’s zoom level across sessions.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.rememberZoomPerNote)
          .onChange(async (val) => {
            this.plugin.settings.rememberZoomPerNote = val;
            await this.plugin.saveSettings();
          });
      });
    this.appendHelpBadge(
      noteMemorySetting.nameEl,
      'Stores magnification per file path in plugin settings so reopening a note restores its last zoom level.'
    );

    // Clear Saved Note Zooms (inline 5s confirmation)
    const savedCount = Object.keys(this.plugin.settings.savedNoteZooms || {}).length;
    const clearNotesSetting = new Setting(containerEl)
      .setName('Clear saved note zooms')
      .setDesc(`Remove stored per-note zoom levels (${savedCount} saved).`)
      .addButton((btn) => {
        btn
          .setButtonText('Clear saved zooms')
          .setDisabled(savedCount === 0)
          .onClick(async () => {
            if (!this.pendingClearNotesConfirm) {
              this.pendingClearNotesConfirm = true;
              btn.setButtonText('Tap again within 5s to clear');
              btn.buttonEl.addClass('mod-warning');
              this.clearNotesConfirmTimer = window.setTimeout(() => {
                this.pendingClearNotesConfirm = false;
                btn.setButtonText('Clear saved zooms');
                btn.buttonEl.removeClass('mod-warning');
              }, 5000);
              return;
            }
            if (this.clearNotesConfirmTimer) window.clearTimeout(this.clearNotesConfirmTimer);
            this.pendingClearNotesConfirm = false;
            this.plugin.settings.savedNoteZooms = {};
            await this.plugin.saveSettings();
            this.renderSettings();
          });
      });
    this.appendHelpBadge(
      clearNotesSetting.nameEl,
      'Uses an inline 2-tap confirmation to wipe all saved per-note magnification entries.'
    );

    // 10. 100% Snap Feedback
    const snapFeedbackSetting = new Setting(containerEl)
      .setName('100% snap feedback')
      .setDesc('Subtle visual pulse (and light vibration on mobile) when snapping to 100%.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.snapFeedback)
          .onChange(async (val) => {
            this.plugin.settings.snapFeedback = val;
            await this.plugin.saveSettings();
          });
      });
    this.appendHelpBadge(
      snapFeedbackSetting.nameEl,
      'Gives gentle confirmation when magnetic snap returns the page to 100%.'
    );

    // 8. Status Bar & Zoom Indicator Appearance
    const statusBarSetting = new Setting(containerEl)
      .setName('Show zoom in status bar')
      .setDesc('Display the zoom percentage pill in the desktop status bar when zoomed.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showStatusBarZoom)
          .onChange(async (val) => {
            this.plugin.settings.showStatusBarZoom = val;
            await this.plugin.saveSettings();
          });
      });
    this.appendHelpBadge(
      statusBarSetting.nameEl,
      'On by default. Turn off if you prefer a minimal desktop status bar while still using pinch/hotkeys.'
    );

    const indicatorVisibilitySetting = new Setting(containerEl)
      .setName('Zoom indicator visibility')
      .setDesc('Choose whether the zoom pill stays visible, fades out, or stays hidden.')
      .addDropdown((drop) =>
        drop
          .addOption('always', 'Always visible when zoomed')
          .addOption('auto-fade', 'Auto-fade after zooming')
          .addOption('hidden', 'Hidden')
          .setValue(this.plugin.settings.zoomIndicatorMode)
          .onChange(async (val) => {
            this.plugin.settings.zoomIndicatorMode = val as ZoomIndicatorMode;
            await this.plugin.saveSettings();
          })
      );
    this.appendHelpBadge(
      indicatorVisibilitySetting.nameEl,
      'Auto-fade hides the zoom pill shortly after you stop zooming so it stays out of the way while reading.'
    );

    const indicatorPositionSetting = new Setting(containerEl)
      .setName('Mobile indicator position')
      .setDesc('Choose where the floating zoom reset pill appears on mobile.')
      .addDropdown((drop) =>
        drop
          .addOption('bottom-center', 'Bottom Center (Default)')
          .addOption('bottom-right', 'Bottom Right')
          .addOption('bottom-left', 'Bottom Left')
          .addOption('top-center', 'Top Center')
          .addOption('top-right', 'Top Right')
          .addOption('top-left', 'Top Left')
          .setValue(this.plugin.settings.mobileIndicatorPosition)
          .onChange(async (val) => {
            this.plugin.settings.mobileIndicatorPosition = val as IndicatorCornerPosition;
            await this.plugin.saveSettings();
          })
      );
    this.appendHelpBadge(
      indicatorPositionSetting.nameEl,
      'Positions the floating mobile reset pill along the bottom or top edge so it never covers your controls.'
    );

    // Tier-2 Inline Confirmation Footer for Resetting Defaults (Zero Popups)
    const resetSetting = new Setting(containerEl)
      .setName('Restore default settings')
      .setDesc('Reset all settings back to factory defaults.')
      .addButton((btn) => {
        btn.setButtonText('Reset defaults').onClick(async () => {
          if (!this.pendingResetConfirm) {
            this.pendingResetConfirm = true;
            btn.setButtonText('Tap again within 5s to confirm reset');
            btn.buttonEl.addClass('mod-warning');
            this.resetConfirmTimer = window.setTimeout(() => {
              this.pendingResetConfirm = false;
              btn.setButtonText('Reset defaults');
              btn.buttonEl.removeClass('mod-warning');
            }, 5000);
            return;
          }
          if (this.resetConfirmTimer) window.clearTimeout(this.resetConfirmTimer);
          this.pendingResetConfirm = false;
          this.plugin.settings = { ...DEFAULT_SETTINGS };
          await this.plugin.saveSettings();
          this.renderSettings();
        });
      });
    this.appendHelpBadge(
      resetSetting.nameEl,
      'Uses an inline 2-tap confirmation instead of a popup dialog to prevent accidental resets.'
    );
  }
}
