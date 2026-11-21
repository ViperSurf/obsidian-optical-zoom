// src/constants.ts
import { Platform } from 'obsidian';
import type { OpticalZoomSettings } from './types';

export const DEFAULT_SETTINGS: OpticalZoomSettings = {
  interactionMode: 'both',
  zoomSensitivity: 1.0,
  maxZoomScale: 3.0,
  minZoomScale: 1.0,
  hotkeyZoomStepPercent: 25,
  loupeSizePx: 240,
  loupeMagnification: 2.0,
  loupeShape: 'rounded',
  desktopLoupeKey: 'Alt',
  mobileTouchLoupe: true,
  rememberZoomPerTab: false,
  rememberZoomPerNote: false,
  savedNoteZooms: {},
  snapFeedback: true,
  panMomentum: true,
  pinchJitterFilter: true,
  resetOnEscape: true,
  showStatusBarZoom: true,
  zoomIndicatorMode: 'always',
  mobileIndicatorPosition: 'bottom-center',
};

export const INDICATOR_FADE_DELAY_MS = 1800;

export const SNAP_THRESHOLD_LOW = 0.96;
export const SNAP_THRESHOLD_HIGH = 1.04;
export const SETTLE_DEBOUNCE_MS = 150;
export const MOBILE_LOUPE_Y_OFFSET_PX = 76; // Keeps lens above thumb on Android/iOS
export const MOBILE_LONG_PRESS_MS = 500;
export const TOUCH_CLAIM_THRESHOLD_PX = 6; // Movement (px) that claims a one-finger pan / cancels a pending loupe
export const DRAWER_FLICK_EDGE_PX = 12; // Touch-start zone at the container edges where a fast inward flick means "open the drawer"
export const DRAWER_FLICK_MIN_TRAVEL_PX = 24; // Inward travel that, reached inside the flick window, classifies a drawer flick
export const DRAWER_FLICK_MAX_MS = 120; // Time window that makes an edge drag a deliberate flick rather than a pan
export const EDGE_TOUCH_RESOLVE_MS = 250; // An edge touch this old without flicking is classified as a pan candidate

export const IS_MOBILE = Platform.isMobile || Platform.isIosApp || Platform.isAndroidApp;
export const IS_APPLE_WEBKIT = Platform.isIosApp || Platform.isMacOS;
