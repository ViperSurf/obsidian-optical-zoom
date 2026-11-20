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
  private zoomLocked = false;
  private noteZoomSaveTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Status Bar Pill (Desktop) or Floating Corner Reset Pill (Mobile)
    const statusBarItem = !IS_MOBILE ? this.addStatusBarItem() : null;
    this.statusIndicator = new ZoomStatusIndicator(
      statusBarItem,
      () => this.settings,
      () => {
        if (this.zoomLocked) {
          this.zoomLocked = false;
          this.statusIndicator?.refresh();
          return;
        }
        this.getActiveController()?.resetZoom(true);
      },
      () => this.zoomLocked
    );

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
          const filePath = (leaf.view as any)?.file?.path as string | undefined;
          if (ctrl) {
            if (this.settings.rememberZoomPerNote && filePath) {
              const saved = this.settings.savedNoteZooms[filePath];
              if (typeof saved === 'number' && saved > 1.005) {
                ctrl.setScale(saved);
              } else if (!this.settings.rememberZoomPerTab && ctrl.getScale() !== 1.0) {
                ctrl.resetZoom(false);
              }
            } else if (!this.settings.rememberZoomPerTab && ctrl.getScale() !== 1.0) {
              ctrl.resetZoom(false);
            }
          }
          this.statusIndicator?.update(ctrl?.getScale() ?? 1.0);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!file || !this.settings.rememberZoomPerNote) return;
        const activeLeaf = this.app.workspace.getMostRecentLeaf();
        const ctrl = activeLeaf ? this.controllers.get(activeLeaf) : null;
        if (!ctrl) return;
        const saved = this.settings.savedNoteZooms[file.path];
        if (typeof saved === 'number' && saved > 1.005) {
          ctrl.setScale(saved);
        } else if (ctrl.getScale() !== 1.0) {
          ctrl.resetZoom(false);
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
      name: 'Optical zoom in',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: '=' }],
      callback: () => {
        const factor = 1 + this.settings.hotkeyZoomStepPercent / 100;
        this.getActiveController()?.stepZoomByFactor(factor);
      },
    });

    this.addCommand({
      id: 'optical-zoom-out',
      name: 'Optical zoom out',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: '-' }],
      callback: () => {
        const factor = 1 + this.settings.hotkeyZoomStepPercent / 100;
        this.getActiveController()?.stepZoomByFactor(1 / factor);
      },
    });

    this.addCommand({
      id: 'toggle-loupe',
      name: 'Toggle magnifying loupe',
      callback: () => this.loupeController?.toggleLoupeAtCursor(),
    });

    this.addCommand({
      id: 'toggle-zoom-lock',
      name: 'Toggle zoom lock',
      callback: () => {
        this.zoomLocked = !this.zoomLocked;
        this.statusIndicator?.refresh();
      },
    });

    this.addSettingTab(new OpticalZoomSettingTab(this.app, this));

    // Optional Escape-to-reset when zoomed and no modal/loupe is active
    this.registerDomEvent(window, 'keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !this.settings.resetOnEscape) return;
      if (document.querySelector('.modal-container, .oz-loupe-lens')) return;
      const ctrl = this.getActiveController();
      if (ctrl && ctrl.getScale() > 1.005) {
        ctrl.resetZoom(true);
      }
    });
  }

  private syncWorkspaceLeaves(): void {
    const activeLeaves = new Set<WorkspaceLeaf>();

    // Only attach to MarkdownView so Canvas, PDF, and Excalidraw keep their own native zoom.
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
              if (this.settings.rememberZoomPerNote) {
                const filePath = (leaf.view as any)?.file?.path as string | undefined;
                if (filePath) {
                  this.scheduleSaveNoteZoom(filePath, scale);
                }
              }
            },
            () => this.zoomLocked
          );
          this.controllers.set(leaf, controller);
          this.trackedLeaves.add(leaf);
        }
      }
    });

    // Clean up detached or no-longer-eligible leaves to prevent memory leaks
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

  private scheduleSaveNoteZoom(filePath: string, scale: number): void {
    if (Math.abs(scale - 1.0) <= 0.005) {
      delete this.settings.savedNoteZooms[filePath];
    } else {
      this.settings.savedNoteZooms[filePath] = Number(scale.toFixed(3));
    }
    if (this.noteZoomSaveTimer !== null) {
      window.clearTimeout(this.noteZoomSaveTimer);
    }
    this.noteZoomSaveTimer = window.setTimeout(() => {
      this.noteZoomSaveTimer = null;
      void this.saveData(this.settings);
    }, 400);
  }

  onunload(): void {
    if (this.noteZoomSaveTimer !== null) {
      window.clearTimeout(this.noteZoomSaveTimer);
    }
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
    this.syncWorkspaceLeaves();
    this.statusIndicator?.refresh();
  }
}
