import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM & WebView globals required by PaneZoomController + CrossPlatformInputRecognizer.
const pendingRafs = [];
globalThis.WheelEvent = {
  DOM_DELTA_PIXEL: 0,
  DOM_DELTA_LINE: 1,
  DOM_DELTA_PAGE: 2,
};
globalThis.window = {
  innerWidth: 1000,
  innerHeight: 800,
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  requestAnimationFrame(cb) {
    pendingRafs.push(cb);
    return pendingRafs.length;
  },
  cancelAnimationFrame() {},
};

function flushRafs() {
  while (pendingRafs.length > 0) {
    const cb = pendingRafs.shift();
    cb(performance.now());
  }
}

const { PaneZoomController } = await import('./.tmp/pane-controller.mjs').catch(async () => {
  return await import('./.tmp/pane-zoom-controller.mjs');
});

class MockClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) {
    names.forEach((n) => this.set.add(n));
  }
  remove(...names) {
    names.forEach((n) => this.set.delete(n));
  }
  toggle(name, force) {
    if (force === undefined) {
      if (this.set.has(name)) this.set.delete(name);
      else this.set.add(name);
    } else if (force) {
      this.set.add(name);
    } else {
      this.set.delete(name);
    }
  }
  contains(name) {
    return this.set.has(name);
  }
}

function makeMockElement({ width = 1000, height = 800, contentWidth = 720, contentHeight = 6000, originX = 140 } = {}) {
  const listeners = new Map();
  let _scrollTop = 0;

  const el = {
    classList: new MockClassList(),
    style: {
      transform: '',
      transformOrigin: '',
      display: '',
      setProperty(k, v) {
        if (k === 'transform-origin') this.transformOrigin = v;
        else this[k] = v;
      },
      removeProperty(k) {
        if (k === 'transform-origin') this.transformOrigin = '';
        else this[k] = '';
      },
    },
    offsetWidth: contentWidth,
    offsetHeight: contentHeight,
    scrollWidth: contentWidth,
    scrollHeight: contentHeight,
    _viewportHeight: height,
    _viewportWidth: width,
    _originX: originX,
    get scrollTop() {
      return _scrollTop;
    },
    set scrollTop(v) {
      const max = Math.max(0, contentHeight - height);
      _scrollTop = Math.min(max, Math.max(0, v));
    },
    scrollTo(opts) {
      // Simulate older Android WebViews that throw on non-standard 'instant' ScrollBehavior.
      if (opts && opts.behavior === 'instant') {
        throw new TypeError("The provided value 'instant' is not a valid enum value of type ScrollBehavior.");
      }
      if (opts && typeof opts.top === 'number') {
        el.scrollTop = opts.top;
      }
    },
    getBoundingClientRect() {
      // Parse current translate3d(tx, ty, 0) if applied on this element.
      let tx = 0;
      let ty = 0;
      const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform || '');
      if (m) {
        tx = parseFloat(m[1]);
        ty = parseFloat(m[2]);
      }
      return {
        left: el._originX + tx,
        top: ty,
        width: el._viewportWidth,
        height: el._viewportHeight,
      };
    },
    addEventListener(type, fn, opts) {
      const capture = typeof opts === 'boolean' ? opts : Boolean(opts && opts.capture);
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ fn, capture });
    },
    removeEventListener(type, fn, opts) {
      const capture = typeof opts === 'boolean' ? opts : Boolean(opts && opts.capture);
      const list = listeners.get(type);
      if (!list) return;
      listeners.set(
        type,
        list.filter((entry) => entry.fn !== fn || entry.capture !== capture)
      );
    },
    dispatch(type, event, capturePhase = false) {
      const list = listeners.get(type) || [];
      for (const entry of list) {
        if (entry.capture === capturePhase) {
          entry.fn(event);
        }
      }
    },
  };
  return el;
}

function makeHarness({ readingMode = false } = {}) {
  const viewport = makeMockElement({ width: 1000, height: 800, contentWidth: 1000, contentHeight: 6000, originX: 0 });
  const cmSizer = makeMockElement({ width: 720, height: 6000, contentWidth: 720, contentHeight: 6000, originX: 140 });
  const previewViewport = makeMockElement({ width: 1000, height: 800, contentWidth: 1000, contentHeight: 6000, originX: 0 });
  const previewSizer = makeMockElement({ width: 720, height: 6000, contentWidth: 720, contentHeight: 6000, originX: 140 });

  // Couple sizer's top to viewport's scrollTop just like the real DOM.
  const bindScroll = (vp, sizer) => {
    const origRect = sizer.getBoundingClientRect.bind(sizer);
    sizer.getBoundingClientRect = () => {
      const r = origRect();
      return { ...r, top: r.top - vp.scrollTop };
    };
  };
  bindScroll(viewport, cmSizer);
  bindScroll(previewViewport, previewSizer);

  const readingView = {
    style: { display: readingMode ? '' : 'none' },
    querySelector(sel) {
      if (sel === '.markdown-preview-view') return previewViewport;
      if (sel === '.markdown-preview-sizer') return previewSizer;
      return null;
    },
  };

  const containerEl = makeMockElement({ width: 1000, height: 800, contentWidth: 1000, contentHeight: 6000, originX: 0 });
  containerEl.querySelector = (sel) => {
    if (sel === '.markdown-reading-view') return readingView;
    if (sel === '.cm-scroller') return viewport;
    if (sel === '.cm-sizer') return cmSizer;
    return null;
  };

  const settings = {
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

  const leaf = { view: { contentEl: containerEl, containerEl } };
  let lastScale = 1.0;
  const controller = new PaneZoomController(leaf, () => settings, (s) => {
    lastScale = s;
  });

  return {
    controller,
    containerEl,
    viewport,
    cmSizer,
    previewViewport,
    previewSizer,
    readingView,
    getLastScale: () => lastScale,
  };
}

function makeEvent(extra = {}) {
  return {
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    ...extra,
  };
}

function parseTransform(el) {
  const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px,\s*0\)\s*scale\(([-\d.]+)\)/.exec(
    el.style.transform || ''
  );
  if (!m) return { tx: 0, ty: 0, scale: 1 };
  return { tx: parseFloat(m[1]), ty: parseFloat(m[2]), scale: parseFloat(m[3]) };
}

describe('PaneZoomController + InputRecognizer integration', () => {
  beforeEach(() => {
    pendingRafs.length = 0;
  });

  it('toggles oz-is-zoomed when zoomed and clears it on reset', () => {
    const h = makeHarness();
    assert.equal(h.containerEl.classList.contains('oz-is-zoomed'), false);

    h.controller.stepZoomByFactor(2.0);
    flushRafs();
    assert.equal(h.containerEl.classList.contains('oz-is-zoomed'), true);
    assert.equal(h.getLastScale(), 2.0);

    h.controller.resetZoom(false);
    flushRafs();
    assert.equal(h.containerEl.classList.contains('oz-is-zoomed'), false);
    assert.equal(h.getLastScale(), 1.0);
    h.controller.destroy();
  });

  it('pans in all 4 directions with 1-finger touch on Android without throwing on scrollTo', () => {
    const h = makeHarness();
    h.controller.stepZoomByFactor(2.0);
    flushRafs();

    // Start mid-pane touch (x=500, y=400)
    h.containerEl.dispatch('touchstart', makeEvent({ touches: [{ identifier: 1, clientX: 500, clientY: 400 }] }));

    // Sub-threshold move (2px): mid-pane must still preventDefault immediately
    const earlyMove = makeEvent({ touches: [{ identifier: 1, clientX: 500, clientY: 398 }] });
    h.containerEl.dispatch('touchmove', earlyMove, true);
    h.containerEl.dispatch('touchmove', earlyMove, false);
    assert.equal(earlyMove.defaultPrevented, true);

    // Drag up (pan down into note)
    for (let y = 398; y >= 100; y -= 50) {
      const ev = makeEvent({ touches: [{ identifier: 1, clientX: 500, clientY: y }] });
      h.containerEl.dispatch('touchmove', ev, true);
      h.containerEl.dispatch('touchmove', ev, false);
      flushRafs();
    }
    assert.ok(h.viewport.scrollTop > 0, 'scrollTop should advance when panning down');

    // Drag down (pan back up)
    for (let y = 100; y <= 500; y += 50) {
      const ev = makeEvent({ touches: [{ identifier: 1, clientX: 500, clientY: y }] });
      h.containerEl.dispatch('touchmove', ev, true);
      h.containerEl.dispatch('touchmove', ev, false);
      flushRafs();
    }
    assert.equal(h.viewport.scrollTop, 0, 'should pan all the way back to top');

    // Drag left (pan right), then drag right (pan left)
    const dragLeft = makeEvent({ touches: [{ identifier: 1, clientX: 300, clientY: 500 }] });
    h.containerEl.dispatch('touchmove', dragLeft, false);
    flushRafs();
    const afterRight = parseTransform(h.cmSizer).tx;

    const dragRight = makeEvent({ touches: [{ identifier: 1, clientX: 600, clientY: 500 }] });
    h.containerEl.dispatch('touchmove', dragRight, false);
    flushRafs();
    const afterLeft = parseTransform(h.cmSizer).tx;

    assert.ok(afterLeft > afterRight, `expected left pan to increase tx (${afterRight} -> ${afterLeft})`);
    h.controller.destroy();
  });

  it('intercepts vertical and horizontal wheel pan while zoomed', () => {
    const h = makeHarness();
    h.controller.stepZoomByFactor(2.0);
    flushRafs();

    const wheelDown = makeEvent({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 120, deltaMode: 0, clientX: 500, clientY: 400 });
    h.containerEl.dispatch('wheel', wheelDown);
    flushRafs();
    assert.equal(wheelDown.defaultPrevented, true);
    assert.equal(wheelDown.propagationStopped, true);

    const wheelSide = makeEvent({ ctrlKey: false, metaKey: false, deltaX: 80, deltaY: 0, deltaMode: 0, clientX: 500, clientY: 400 });
    h.containerEl.dispatch('wheel', wheelSide);
    flushRafs();
    assert.equal(wheelSide.defaultPrevented, true);
    assert.equal(wheelSide.propagationStopped, true);
    h.controller.destroy();
  });

  it('keeps scrollTop centered on visible content at 3x zoom', () => {
    const h = makeHarness();
    h.controller.stepZoomByFactor(3.0);
    flushRafs();

    // Pan down 1800px via wheel
    for (let i = 0; i < 18; i++) {
      h.containerEl.dispatch('wheel', makeEvent({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 100, deltaMode: 0, clientX: 500, clientY: 400 }));
      flushRafs();
    }
    const { ty, scale } = parseTransform(h.cmSizer);
    const yCenter = (800 / 2 - (-h.viewport.scrollTop) - ty) / scale;
    // scrollTop should be near yCenter - 400, keeping visible lines inside [scrollTop, scrollTop + 800]
    assert.ok(
      Math.abs(h.viewport.scrollTop - (yCenter - 400)) < 2,
      `expected scrollTop (${h.viewport.scrollTop}) near yCenter - 400 (${yCenter - 400}) [ty=${ty}, scale=${scale}]`
    );
    h.controller.destroy();
  });

  it('resets stale transform when switching between Editing View and Reading View', () => {
    const h = makeHarness({ readingMode: false });
    h.controller.stepZoomByFactor(2.0);
    flushRafs();
    assert.notEqual(h.cmSizer.style.transform, '');

    // Switch to Reading View
    h.readingView.style.display = '';
    h.controller.stepZoomByFactor(1.5);
    flushRafs();
    assert.equal(h.cmSizer.style.transform, '');
    assert.equal(h.getLastScale(), 1.5);
    h.controller.destroy();
  });
});
