// Minimal runtime stub for the types-only `obsidian` package, used only by tests.
// src/constants.ts imports Platform from 'obsidian'; the real package ships
// types only, so tests alias it to these flags.
export const Platform = {
  isMobile: false,
  isIosApp: false,
  isAndroidApp: false,
  isMacOS: false,
  isWin: false,
  isLinux: true,
  isDesktop: true,
  isSafari: false,
  isPhone: false,
  isTablet: false,
};
export default { Platform };
