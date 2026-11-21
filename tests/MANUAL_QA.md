# Manual QA Checklist (Desktop & Mobile)

Run this checklist before tagging a release (`main.js`, `manifest.json`, `styles.css`).

## 1. Editing View (Live Preview & Source)
- [ ] **Pinch / `Ctrl`+Wheel zoom in & out:** Focal spot under cursor/fingers stays anchored from 100% → 300% → 100% (at top of note and scrolled 2,000+ px down).
- [ ] **Pan all 4 directions while zoomed (200%–300%):**
  - [ ] Pan left, right, up, and down smoothly with no freeze or bounce-back.
  - [ ] Scroll fast through a long note with tables/callouts—no blank white sections.
- [ ] **Sidebars & Drawers (Mobile):**
  - [ ] Slow mid-pane drag never opens left/right drawers.
  - [ ] Fast inward flick from the very edge (< 12 px) still opens the left/right drawer.

## 2. Reading View
- [ ] **Zoom + Pan downwards:** Panning down through long notes, tables, and MathJax/Mermaid diagrams stays smooth without jumping or blanking out.
- [ ] **View-mode toggle:** Switching between Editing View and Reading View while zoomed resets cleanly without stale zoom pills or stuck `touch-action`.

## 3. Loupe & Reset Controls
- [ ] **Desktop Loupe:** Hold `Alt` (or configured key) at 100% and move cursor—single sharp lens, disappears immediately on key release.
- [ ] **Mobile Loupe:** Long-press (500 ms) at 100% opens lens 76 px above thumb; never opens while zoomed (`> 100%`).
- [ ] **Reset:** `Esc` (default on, when no modal/loupe is open), status pill click, 2-finger double-tap, and the **Reset zoom to 100%** command all snap cleanly to 100% and hide the zoom pill.

## 4. Settings & Pre-Release Gate
- [ ] **Settings UI & Search:** Open **Settings → Optical Zoom** and verify all controls render and persist; on Obsidian `1.13.0+`, verify settings appear in Settings Search.
- [ ] **Automated Checks (must all pass before pushing):**
  - `npm run lint` (`0` errors, `0` warnings)
  - `npm run typecheck`
  - `npm test` (unit, controller, and release-compliance regression tests)
  - `npm run test:e2e` (headless Playwright E2E)
  - `npm run test:obsidian` (real Obsidian desktop + mobile-emulated E2E)
  - `npm run build`
- [ ] **Portal Pre-Check:** Push to `main` and click **Review branch** on `https://community.obsidian.md/account/plugins/optical-zoom` **before** creating a Git tag.
