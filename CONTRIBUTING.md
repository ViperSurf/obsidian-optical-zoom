# Contributing to Optical Zoom

Contributions, bug reports, and feature suggestions are welcome.

## Development Setup

```bash
npm install
npm run dev
```

## Running Checks

Before opening a pull request, please verify:

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
```

- Keep runtime dependencies at zero (`dependencies` is omitted; Obsidian APIs only).
- Follow Obsidian plugin guidelines (no static `.style` assignments, use `createEl` / `createDiv`, clean up listeners/DOM in `onunload()`).
- Add unit tests in `tests/` or E2E coverage in `tests/e2e/` for math, gesture, or controller changes.
