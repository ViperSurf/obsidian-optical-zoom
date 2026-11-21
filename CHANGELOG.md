# Changelog

All notable changes to **Optical Zoom** are documented in this file.

## [1.5.4] - 2026-11-20

### Added
- **Declarative settings (`getSettingDefinitions`):** Added Obsidian `1.13.0+` `getSettingDefinitions()` alongside `display()` so settings appear in Obsidian's Settings Search while keeping full compatibility down to `1.5.0`.
- **GitHub build provenance attestations:** Updated `.github/workflows/release.yml` with `actions/attest-build-provenance@v2` and attached only `main.js`, `manifest.json`, and `styles.css` to releases.
- **Mobile loupe showcase screenshot:** Added `assets/mobile-loupe.webp` demonstrating the floating mobile touch loupe.

## [1.5.3] - 2026-11-20

### Changed
- **CSS & Review Scorecard cleanup:** Replaced all `!important` CSS rules in `styles.css` with higher-specificity selectors, replaced `builtin-modules` with Node's built-in `node:module` in `esbuild.config.mjs`, switched loupe lens creation to `document.body.createDiv()`, removed deprecated `setDynamicTooltip()`, `setWarning()`, and direct `this.display()` re-render calls in `src/ui/settings-tab.ts`, and added `CONTRIBUTING.md`.

## [1.5.2] - 2026-11-20

### Changed
- **Escape key reset enabled by default:** `resetOnEscape` is now `true` by default so pressing `Esc` while zoomed (with no modal or loupe open) resets note zoom back to 100%.
- **Obsidian Community Directory compliance:** Removed static `.style` assignments in favor of CSS classes / `removeProperty`, switched DOM element creation to `createEl`, removed default command hotkeys (documented recommended bindings in `README.md`), shortened command IDs/names, and tightened TypeScript types.

## [1.5.1] - 2026-11-20

### Changed
- **Separated loupe settings for clarity:** Split **Loupe lens size (px)** and **Loupe magnification power** onto separate lines, and split **Desktop loupe key** and **Mobile touch loupe** onto separate lines in `src/ui/settings-tab.ts` and `README.md` so the mobile long-press trigger is clearly visible.

## [1.5.0] - 2026-11-20

### Added
- **Pinch jitter stabilization:** Added `pinchJitterFilter` (on by default) in `src/input/input-recognizer.ts` and `src/ui/settings-tab.ts` to filter out tiny finger-distance fluctuations so 2-finger panning stays steady for shaky hands.
- **Smooth pan momentum:** Added `panMomentum` (on by default) in `src/input/input-recognizer.ts` for gentle deceleration after fast 1-finger touch pans.
- **Custom loupe size slider:** Replaced the 3-size loupe preset dropdown with a `140–400 px` slider (`step 10`, default `240 px`).
- **Reset zoom on Escape:** Added optional `resetOnEscape` toggle (off by default) in `src/main.ts` and `src/ui/settings-tab.ts`.
- **Clear saved note zooms:** Added a `Clear saved note zooms` button (with 5-second inline confirmation) in `src/ui/settings-tab.ts`.

### Changed
- **Canvas, PDF & Excalidraw:** Removed the experimental `nativeZoomViewBehavior` override so Canvas, PDF, and Excalidraw always use their own built-in zoom engines cleanly.

## [1.4.0] - 2026-11-20

### Added
- **Loupe lens shape & expanded magnification:** Added `Loupe lens shape` setting (`Rounded Rectangle` default or `Circle`) in `src/ui/settings-tab.ts`, `src/engine/loupe-lens.ts`, and `styles.css`, and expanded loupe magnification options to `1.25×`, `1.5×`, `2.0×`, `2.5×`, `3.0×`, and `4.0×`.
- **Per-note persistent zoom:** Added `Remember zoom per note` setting (`rememberZoomPerNote` / `savedNoteZooms`) to save and restore each file's magnification across sessions.
- **Toggle magnifying loupe command:** Added `Toggle magnifying loupe` (`optical-zoom:toggle-loupe`) command/hotkey so desktop users can toggle the loupe without holding a modifier key (`Escape` or running the command again closes it).
- **100% snap feedback:** Added `100% snap feedback` setting (`snapFeedback`, on by default) for a subtle accent border pulse and light mobile vibration when magnetic snap returns to 100%.
- **Zoom lock toggle:** Added `Toggle zoom lock` (`optical-zoom:toggle-zoom-lock`) command to lock the current magnification while still allowing panning, with a `🔒` indicator in the status pill.

### Documentation
- Updated `README.md` with the new commands and settings.

## [1.3.1] - 2026-11-20

### Changed
- **Separated Settings rows for clarity:** Split **Zoom speed** and **Maximum magnification** onto separate lines, and split **Zoom indicator visibility** and **Mobile indicator position** onto separate lines in `src/ui/settings-tab.ts`.
- **Center indicator positions:** Added `Bottom Center` and `Top Center` options to `mobileIndicatorPosition` in `src/types.ts`, `styles.css`, and `src/ui/status-pill.ts`, with **Bottom Center** as the new default.
- **Documentation:** Updated `README.md` settings table with the separated settings and new center indicator positions.

## [1.3.0] - 2026-11-19

### Added
- **Separated Settings:** Split **Loupe trigger** and **Remember zoom per tab** into separate setting rows in `src/ui/settings-tab.ts`.
- **Configurable hotkey zoom step:** Added `hotkeyZoomStepPercent` (5%–50%, default 25%) so `Optical zoom in` and `Optical zoom out` commands/hotkeys scale by your chosen step.
- **Canvas, PDF & Excalidraw zoom option:** Added `nativeZoomViewBehavior` (`native` default vs `plugin`) so you can let Canvas, PDF, and Excalidraw handle their own zoom or opt in to Optical Zoom for those views.
- **Status bar & indicator controls:** Added `showStatusBarZoom` (on by default), `zoomIndicatorMode` (`always`, `auto-fade` after 1.8s, or `hidden`), and `mobileIndicatorPosition` (`bottom-right` default, `bottom-left`, `top-right`, `top-left`).
- **Expanded E2E test suite:** Added full 4-edge fast/slow pan tests across Editing View, scrolled notes, Reading View, desktop `Ctrl+Wheel`, and drawer shielding/flicks in `tests/e2e/mobile-touch.test.mjs`.

### Documentation
- Clarified in `README.md` that Optical Zoom scales **without text reflow** and documented all new settings and E2E test commands.

## [1.2.4] - 2026-11-19

### Fixed
- **Fixed mobile 1-finger panning blocked by capture-phase `stopPropagation()`:** Removed `handleTouchMoveCapture` from `src/input/input-recognizer.ts` and moved `e.stopPropagation()` into `handleTouchMove` (bubble phase). Calling `stopPropagation()` in the capture phase on `this.container` aborted the DOM event before it could reach `handleTouchMove` on the same element, which prevented mid-pane 1-finger touch panning from running on mobile.

### Added
- **Automated Playwright Mobile WebView E2E suite (`tests/e2e/`):** Added `tests/e2e/mobile-touch.test.mjs` and `tests/e2e/run-e2e.mjs` (`npm run test:e2e`) running real headless Chromium (`hasTouch: true`, `isMobile: true`, `390×844`) with CDP touch events to verify 2-finger pinch, 4-direction 1-finger panning, `touch-action: none`, drawer flick shielding, and Reading View panning in CI (`.github/workflows/ci.yml`).

## [1.2.3] - 2026-11-19

### Fixed
- **Restored Android WebView panning:** Replaced `scrollTo({ behavior: 'instant' })` with direct `dom.viewport.scrollTop = desiredScrollTop` assignment in `src/engine/pane-zoom-controller.ts` (backed by `scroll-behavior: auto !important` in `styles.css`). Older Android WebViews reject `'instant'` as an invalid `ScrollBehavior` enum and threw a `TypeError` that aborted vertical/diagonal pan frames.

## [1.2.2] - 2026-11-19

### Fixed
- **Eliminated smooth-scroll bounce while panning:** Replaced `dom.viewport.scrollTop = desiredScrollTop` with `dom.viewport.scrollTo({ top: desiredScrollTop, behavior: 'instant' })` in `src/engine/pane-zoom-controller.ts` and added `scroll-behavior: auto !important` in `styles.css` so themes or Obsidian smooth-scroll settings cannot animate `scrollTop` asynchronously out of sync with `ty`.
- **Immediate mid-pane touchmove prevention on Android/iOS:** Called `e.preventDefault()` immediately on mid-pane `touchmove` events while zoomed (`src/input/input-recognizer.ts`) instead of waiting for the 6px pan-claim threshold, preventing mobile WebViews from cancelling left/up pans before the threshold is crossed.

## [1.2.1] - 2026-11-19

### Fixed
- **Full 4-direction touch panning without `touchcancel` freezes:** Added `.oz-is-zoomed` host state with `touch-action: none !important` and `overscroll-behavior: none !important` while zoomed (`scale > 1.005`), preventing Android/iOS WebViews from hijacking 1-finger pans for native scrolling or overscroll bounce (which previously froze left/up pans when `scrollLeft`/`scrollTop` was `0`). Native `pan-x pan-y` scrolling is restored automatically at 100%.
- **Accurate unscaled pan bounds:** Measured `contentWidth` and `contentHeight` from the zoom target's own untransformed layout/scroll dimensions (`Math.max(target.offsetWidth, target.scrollWidth)` and `Math.max(target.offsetHeight, target.scrollHeight)`) instead of the parent scroller's `scrollWidth`/`scrollHeight` (which were inflated by the child's CSS `scale` and shifted with `tx`/`ty`).
- **Frame-accurate focal & origin back-out:** Tracked the actually rendered `renderedTx`/`renderedTy` applied to `target.style.transform` so multiple input events arriving in the same animation frame never drift when backing out `targetRect`.
- **Scroll-synced Reading View & long-note hydration:** Centered `viewport.scrollTop` on the visible unscaled content coordinate (`yCenter - viewportHeight / 2`) with synchronous `ty` compensation whenever `scrollTop` shifts, eliminating Reading View jumping and white-screen blanks when scrolling fast through long notes or large tables at 2×–3× zoom.
- **Desktop wheel panning in all directions:** Intercepted vertical as well as horizontal wheel pan events while zoomed (with `stopPropagation()`), so desktop trackpad and mouse-wheel users can pan freely in all 4 directions without getting stuck at `scrollTop === 0`.
- **View-mode switch cleanup:** Reset stale transform state when switching between Live Preview/Source and Reading View while zoomed.

### Added
- **Seamless 2-finger-to-1-finger pinch-to-pan handoff:** Lifting one finger after a 2-finger pinch while zoomed immediately hands off to 1-finger panning without needing to lift both fingers first.
- **Unit test coverage:** Added pan-reach test in `tests/affine-focal.test.mjs` for scrolled notes inside centered readable-line-length columns.

---

## [1.2.0]

- **Pan cut-off:** Limits are now measured from the scroll area's true content size, and while zoomed a one-finger drag moves the page in every direction — up, left, diagonals, all of it, Markor-style. No more direction lottery, no more dead ends mid-note. New tests specifically cover the trip that used to dead-end: all the way down-right at 2× and back up-left to the start.
- **Sidebar on demand:** A quick flick from the very edge of the screen (fast, starting right at the edge) now opens the drawer even while zoomed. A slow drag from the same spot still pans. Flick = sidebar, drag = pan. Top-bar icons keep working as always.
- **The rename:** Renamed to **Optical Zoom** (`optical-zoom`) everywhere for the community store — manifest, package, zip, and folder.

---

## [1.1.1]

- **Loupe disabled while zoomed:** The loupe now refuses to activate whenever you're zoomed in at all — no timer even starts. At 100% it still works, with a stricter long-press: 500ms and your finger must stay within 6px.
- **No more multiples, no more blank:** Activation clears any existing lens first and sweeps for strays so two boxes can never exist, and the clone's scroll position is applied after the clone is attached to the page so WebViews don't drop it.
- **Left sidebar shielding at capture stage:** While zoomed, drags are stopped from the very first pixel before Obsidian's drawer gesture can see them, and any touch starting within 28px of the left or right edge while zoomed is blocked outright while keeping native vertical scrolling untouched.

---

## [1.1.0]

- **Pinch anchor fixed at the root:** Zoom now measures the pinch from the note content's own origin, so the spot under your fingers stays put whether you're at the top of a note or 3,000px down. Regression tests simulate scrolled notes at four depths with under 0.5px drift zooming 1.0→2.5 and back.
- **Pan limits & 1-finger sideways pan:** Pan limits use the note's real size so at 2× or 3× you can drag to every edge of a long note, and while zoomed a one-finger sideways drag pans the page.
- **Sidebar shielding:** Pinch and zoomed sideways drags are blocked at the touch layer so they never reach Obsidian's drawer gestures.

---

## [1.0.0]

- **GPU optical zoom on inner sizers only:** Transforms `.cm-sizer` / `.markdown-preview-sizer` — scrollers, scrollbars, and font-size are never touched.
- **Focal-point affine math:** Rubber-band floor at 0.92× and magnetic snap in [0.96, 1.04]; per-leaf `WeakMap` controllers so split panes never bleed into each other.
- **Cross-platform input:** Trackpad pinch / `Ctrl`+wheel (line/pixel delta normalized), 2-finger pinch + pan, WebKit gesture fallback, 2-finger double-tap and `Ctrl`/`Cmd`+`0` reset.
- **Snapshot loupe:** `Alt`-hold on desktop, 320ms long-press on mobile with the lens offset 76px above your finger, and canvas bitmaps copied once on activation.
- **UI & privacy:** Status pill that hides at 100%, 4-control settings tab with `(?)` tooltips everywhere, inline 5-second reset confirmation — no popups, no network, no telemetry.
