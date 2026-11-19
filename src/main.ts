// src/main.ts
import { MarkdownView, Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, IS_MOBILE } from './constants';
import { PaneZoomController } from './engine/pane-zoom-controller';
import { OpticalLoupeController } from './engine/loupe-lens';
import { OpticalZoomSettingTab } from './ui/settings-tab';
import { ZoomStatusIndicator } from './ui/status-pill';
import type { OpticalZoomSettings } from './types';

export default class OpticalZoomPlugin extends Plugin {
  public settings: OpticalZoomSettings = { ...DEFAULT_SETTINGS };
  private controllers = new WeakMap<WorkspaceLeaf, PaneZoomController>();
  private trackedLeaves = new Set<WorkspaceLeaf>();
  private loupeController: OpticalLoupeController | null = null;
  private statusIndicator: ZoomStatusIndicator | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Status Bar Pill (Desktop) or Floating Corner Reset Pill (Mobile)
    const statusBarItem = !IS_MOBILE ? this.addStatusBarItem() : null;
    this.statusIndicator = new ZoomStatusIndicator(statusBarItem, () => {
      this.getActiveController()?.resetZoom(true);
    });

    // Global Optical Loupe Controller. It receives the active pane's
    // optical scale so it can refuse to activate while zoomed (a held
    // finger on a zoomed pane is a pan, not a loupe request).
    this.loupeController = new OpticalLoupeController(
      () => this.settings,
      () => this.getActiveController()?.getScale() ?? 1.0
    );

    // Attach controllers to existing and future Markdown leaves
    this.app.workspace.onLayoutReady(() => {
      this.syncWorkspaceLeaves();
    });

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.syncWorkspaceLeaves();
      })
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        this.syncWorkspaceLeaves();
        if (leaf) {
          const ctrl = this.controllers.get(leaf);
          if (ctrl && !this.settings.rememberZoomPerTab && ctrl.getScale() !== 1.0) {
            ctrl.resetZoom(false);
          }
          this.statusIndicator?.update(ctrl?.getScale() ?? 1.0);
        }
      })
    );

    // Register Command Palette Actions & Hotkeys
    this.addCommand({
      id: 'reset-optical-zoom',
      name: 'Reset optical zoom to 100%',
      hotkeys: [{ modifiers: ['Mod'], key: '0' }],
      callback: () => this.getActiveController()?.resetZoom(true),
    });

    this.addCommand({
      id: 'optical-zoom-in',
      name: 'Optical zoom in (+25%)',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: '=' }],
      callback: () => this.getActiveController()?.stepZoomByFactor(1.25),
    });

    this.addCommand({
      id: 'optical-zoom-out',
      name: 'Optical zoom out (-20%)',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: '-' }],
      callback: () => this.getActiveController()?.stepZoomByFactor(0.8),
    });

    this.addSettingTab(new OpticalZoomSettingTab(this.app, this));
  }

  private syncWorkspaceLeaves(): void {
    const activeLeaves = new Set<WorkspaceLeaf>();

    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        activeLeaves.add(leaf);
        if (!this.controllers.has(leaf)) {
          const controller = new PaneZoomController(
            leaf,
            () => this.settings,
            (scale) => {
              if (this.app.workspace.getMostRecentLeaf() === leaf) {
                this.statusIndicator?.update(scale);
              }
            }
          );
          this.controllers.set(leaf, controller);
          this.trackedLeaves.add(leaf);
        }
      }
    });

    // Clean up detached leaves to prevent memory leaks
    for (const tracked of Array.from(this.trackedLeaves)) {
      if (!activeLeaves.has(tracked)) {
        this.controllers.get(tracked)?.destroy();
        this.controllers.delete(tracked);
        this.trackedLeaves.delete(tracked);
      }
    }
  }

  private getActiveController(): PaneZoomController | null {
    const activeLeaf = this.app.workspace.getMostRecentLeaf();
    if (!activeLeaf) return null;
    return this.controllers.get(activeLeaf) ?? null;
  }

  onunload(): void {
    for (const leaf of Array.from(this.trackedLeaves)) {
      this.controllers.get(leaf)?.destroy();
    }
    this.trackedLeaves.clear();
    this.loupeController?.destroy();
    this.statusIndicator?.destroy();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
