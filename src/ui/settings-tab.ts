// src/ui/settings-tab.ts
import { App, PluginSettingTab, Setting, requireApiVersion, type SettingDefinitionItem } from 'obsidian';
import type OpticalZoomPlugin from '../main';
import { DEFAULT_SETTINGS } from '../constants';
import type { LoupeMagnificationPreset } from '../types';

export class OpticalZoomSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: OpticalZoomPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.renderFallbackSettings();
  }

  private renderFallbackSettings(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const def of this.getSettingDefinitions()) {
      if (!('name' in def)) continue;
      const s = new Setting(containerEl).setName(def.name);
      if (def.desc) s.setDesc(def.desc);
      if ('control' in def && def.control) {
        const c = def.control;
        if (c.type === 'toggle') {
          s.addToggle((t) =>
            t.setValue(Boolean(this.getControlValue(c.key))).onChange((v) => this.setControlValue(c.key, v))
          );
        } else if (c.type === 'dropdown') {
          const cur = this.getControlValue(c.key);
          s.addDropdown((d) =>
            d
              .addOptions(c.options)
              .setValue(typeof cur === 'string' ? cur : '')
              .onChange((v) => this.setControlValue(c.key, v))
          );
        } else if (c.type === 'slider') {
          s.addSlider((sl) =>
            sl
              .setLimits(c.min, c.max, c.step)
              .setValue(Number(this.getControlValue(c.key)))
              .onChange((v) => this.setControlValue(c.key, v))
          );
        }
      } else if ('action' in def && def.action) {
        const disabled = typeof def.disabled === 'function' ? def.disabled() : Boolean(def.disabled);
        const runAction = def.action;
        s.addButton((b) =>
          b
            .setButtonText(def.name)
            .setDisabled(disabled)
            .onClick(() => {
              runAction(b.buttonEl, 0);
              this.renderFallbackSettings();
            })
        );
      }
    }
  }

  getControlValue(key: string): unknown {
    const val = this.plugin.settings[key as keyof typeof DEFAULT_SETTINGS];
    if ((key === 'maxZoomScale' || key === 'loupeMagnification') && typeof val === 'number') {
      return String(val);
    }
    return val;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === 'maxZoomScale') {
      this.plugin.settings.maxZoomScale = Number(value);
    } else if (key === 'loupeMagnification') {
      this.plugin.settings.loupeMagnification = Number(value) as LoupeMagnificationPreset;
    } else {
      (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    }
    await this.plugin.saveSettings();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const savedCount = Object.keys(this.plugin.settings.savedNoteZooms || {}).length;
    return [
      {
        name: 'Zoom interaction mode',
        desc: 'Choose how optical magnification is triggered inside notes.',
        control: {
          type: 'dropdown',
          key: 'interactionMode',
          options: {
            both: 'Pinch-to-zoom + hold-to-loupe (both)',
            'pinch-only': 'Pinch-to-zoom only',
            'loupe-only': 'Hold-to-loupe only',
          },
        },
      },
      {
        name: 'Zoom speed',
        desc: 'Adjust trackpad and touch pinch velocity.',
        control: { type: 'slider', key: 'zoomSensitivity', min: 0.5, max: 2.0, step: 0.1 },
      },
      {
        name: 'Maximum magnification',
        desc: 'Set the upper zoom limit.',
        control: {
          type: 'dropdown',
          key: 'maxZoomScale',
          options: {
            '2': 'Max 200%',
            '3': 'Max 300% (default)',
            '4': 'Max 400%',
            '5': 'Max 500%',
          },
        },
      },
      {
        name: 'Hotkey zoom step (%)',
        desc: 'Step size used by the zoom in / out commands and hotkeys.',
        control: { type: 'slider', key: 'hotkeyZoomStepPercent', min: 5, max: 50, step: 5 },
      },
      {
        name: 'Pinch jitter stabilization',
        desc: 'Filter out tiny finger-distance fluctuations so 2-finger panning stays steady.',
        control: { type: 'toggle', key: 'pinchJitterFilter' },
      },
      {
        name: 'Smooth pan momentum',
        desc: 'Add gentle deceleration after releasing a fast 1-finger pan on touchscreens.',
        control: { type: 'toggle', key: 'panMomentum' },
      },
      {
        name: 'Reset zoom on escape',
        desc: 'Press escape while zoomed (with no modal or loupe open) to return to 100%.',
        control: { type: 'toggle', key: 'resetOnEscape' },
      },
      {
        name: 'Loupe lens size (px)',
        desc: 'Diameter of the magnifying glass lens (140–400 px).',
        control: { type: 'slider', key: 'loupeSizePx', min: 140, max: 400, step: 10 },
      },
      {
        name: 'Loupe magnification power',
        desc: 'Optical zoom strength inside the magnifying glass.',
        control: {
          type: 'dropdown',
          key: 'loupeMagnification',
          options: {
            '1.25': '1.25x zoom',
            '1.5': '1.5x zoom',
            '2': '2.0x zoom (default)',
            '2.5': '2.5x zoom',
            '3': '3.0x zoom',
            '4': '4.0x zoom',
          },
        },
      },
      {
        name: 'Loupe lens shape',
        desc: 'Choose between a rounded rectangle or circular magnifying glass.',
        control: {
          type: 'dropdown',
          key: 'loupeShape',
          options: {
            rounded: 'Rounded rectangle (default)',
            circle: 'Circle',
          },
        },
      },
      {
        name: 'Desktop loupe trigger',
        desc: 'Modifier key held on desktop to summon the loupe (or use the toggle magnifying loupe command).',
        control: {
          type: 'dropdown',
          key: 'desktopLoupeKey',
          options: {
            Alt: 'Hold alt / option',
            Control: 'Hold ctrl / cmd',
            Shift: 'Hold shift',
            none: 'Disabled (hotkey / command only)',
          },
        },
      },
      {
        name: 'Mobile touch loupe',
        desc: 'Long-press (500 ms) with 1 finger at 100% zoom and drag (lens floats above your finger).',
        control: { type: 'toggle', key: 'mobileTouchLoupe' },
      },
      {
        name: 'Remember zoom per tab',
        desc: "Keep each open tab's zoom level when switching between notes.",
        control: { type: 'toggle', key: 'rememberZoomPerTab' },
      },
      {
        name: 'Remember zoom per note',
        desc: "Save and restore each note's zoom level across sessions.",
        control: { type: 'toggle', key: 'rememberZoomPerNote' },
      },
      {
        name: 'Clear saved note zooms',
        desc: `Remove stored per-note zoom levels (${savedCount} saved).`,
        disabled: () => Object.keys(this.plugin.settings.savedNoteZooms || {}).length === 0,
        action: () => {
          this.plugin.settings.savedNoteZooms = {};
          void this.plugin.saveSettings().then(() => {
            if (requireApiVersion('1.13.0')) this.update();
          });
        },
      },
      {
        name: '100% snap feedback',
        desc: 'Subtle visual pulse (and light vibration on mobile) when snapping to 100%.',
        control: { type: 'toggle', key: 'snapFeedback' },
      },
      {
        name: 'Show zoom in status bar',
        desc: 'Display the zoom percentage pill in the desktop status bar when zoomed.',
        control: { type: 'toggle', key: 'showStatusBarZoom' },
      },
      {
        name: 'Zoom indicator visibility',
        desc: 'Choose whether the zoom pill stays visible, fades out, or stays hidden.',
        control: {
          type: 'dropdown',
          key: 'zoomIndicatorMode',
          options: {
            always: 'Always visible when zoomed',
            'auto-fade': 'Auto-fade after zooming',
            hidden: 'Hidden',
          },
        },
      },
      {
        name: 'Mobile indicator position',
        desc: 'Choose where the floating zoom reset pill appears on mobile.',
        control: {
          type: 'dropdown',
          key: 'mobileIndicatorPosition',
          options: {
            'bottom-center': 'Bottom center (default)',
            'bottom-right': 'Bottom right',
            'bottom-left': 'Bottom left',
            'top-center': 'Top center',
            'top-right': 'Top right',
            'top-left': 'Top left',
          },
        },
      },
      {
        name: 'Restore default settings',
        desc: 'Reset all settings back to factory defaults.',
        action: () => {
          this.plugin.settings = { ...DEFAULT_SETTINGS };
          void this.plugin.saveSettings().then(() => {
            if (requireApiVersion('1.13.0')) this.update();
          });
        },
      },
    ];
  }
}
