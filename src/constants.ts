// src/constants.ts
import { Platform } from 'obsidian';
import type { OpticalZoomSettings } from './types';

export const DEFAULT_SETTINGS: OpticalZoomSettings = {
  interactionMode: 'both',
  zoomSensitivity: 1.0,
  maxZoomScale: 3.0,
  minZoomScale: 1.0,
  loupeSizePx: 240,
  loupeMagnification: 2.0,
  desktopLoupeKey: 'Alt',
  mobileTouchLoupe: true,
  rememberZoomPerTab: false,
};

export const SNAP_THRESHOLD_LOW = 0.96;
export const SNAP_THRESHOLD_HIGH = 1.04;
export const SETTLE_DEBOUNCE_MS = 150;
export const MOBILE_LOUPE_Y_OFFSET_PX = 76; // Keeps lens above thumb on Android/iOS
export const MOBILE_LONG_PRESS_MS = 500;
export const TOUCH_CLAIM_THRESHOLD_PX = 6; // Movement (px) that claims a one-finger pan / cancels a pending loupe
export const DRAWER_EDGE_ZONE_PX = 28; // Touch-start zone at the container edges where Obsidian's drawer gestures trigger

export const IS_MOBILE = Platform.isMobile || Platform.isIosApp || Platform.isAndroidApp;
export const IS_APPLE_WEBKIT = Platform.isIosApp || Platform.isMacOS;
