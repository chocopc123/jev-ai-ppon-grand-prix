import assert from "node:assert/strict";
import { test } from "node:test";
import { bindArenaViewport } from "../src/useArenaViewport.ts";

function createEnvironment() {
  const classes = new Set();
  const properties = new Map();
  const listeners = new Map();
  const element = {
    style: {
      setProperty: (key, value) => properties.set(key, value),
      removeProperty: (key) => properties.delete(key),
    },
  };
  const viewport = Object.assign(new EventTarget(), {
    height: 800,
    offsetTop: 0,
    scale: 1,
  });
  const scrolledTo = [];
  const browserWindow = Object.assign(new EventTarget(), {
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    scrollTo: (x, y) => scrolledTo.push([x, y]),
    document: {
      documentElement: {
        classList: {
          contains: (name) => classes.has(name),
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
        },
      },
      addEventListener: (type, cb) => listeners.set(type, cb),
      removeEventListener: (type) => listeners.delete(type),
    },
    visualViewport: viewport,
  });
  return { element, browserWindow, classes, properties, listeners, scrolledTo };
}

test("画面固定クラスを付与し、パン量の初期値は0", () => {
  const { element, browserWindow, classes, properties } = createEnvironment();
  const cleanup = bindArenaViewport(element, browserWindow);
  assert.ok(classes.has("arena-viewport-active"));
  assert.equal(properties.get("--arena-pan-y"), "0px");
  assert.equal(properties.has("--keyboard-height"), false);
  assert.equal(properties.has("--arena-viewport-height"), false);
  assert.equal(properties.has("--arena-viewport-top"), false);
  cleanup();
});

test("visualViewportの自動パン量をtransform打ち消し量として保持する", () => {
  const { element, browserWindow, properties } = createEnvironment();
  const cleanup = bindArenaViewport(element, browserWindow);
  const viewport = browserWindow.visualViewport;

  viewport.offsetTop = 120;
  viewport.dispatchEvent(new Event("scroll"));
  assert.equal(properties.get("--arena-pan-y"), "120px");

  viewport.offsetTop = 0;
  viewport.dispatchEvent(new Event("scroll"));
  assert.equal(properties.get("--arena-pan-y"), "0px");
  cleanup();
});

test("フォーカスインでドキュメントスクロールだけを戻す", () => {
  const { element, browserWindow, listeners, scrolledTo } = createEnvironment();
  const cleanup = bindArenaViewport(element, browserWindow);
  const onFocusIn = listeners.get("focusin");
  assert.ok(onFocusIn);

  browserWindow.scrollX = 0;
  browserWindow.scrollY = 30;
  onFocusIn({ target: { tagName: "INPUT" } });
  assert.deepEqual(scrolledTo[0], [0, 0]);

  scrolledTo.length = 0;
  onFocusIn({ target: { tagName: "DIV" } });
  assert.equal(scrolledTo.length, 0);
  cleanup();
});

test("ピンチズーム中のパンには干渉しない", () => {
  const { element, browserWindow, properties } = createEnvironment();
  const cleanup = bindArenaViewport(element, browserWindow);
  const viewport = browserWindow.visualViewport;

  viewport.scale = 2;
  viewport.offsetTop = 80;
  viewport.dispatchEvent(new Event("scroll"));
  assert.equal(properties.get("--arena-pan-y"), "0px");
  cleanup();
});

test("退出時にページ固定とイベント購読を解除し、再入室できる", () => {
  const { element, browserWindow, classes, listeners, properties } =
    createEnvironment();
  const cleanup = bindArenaViewport(element, browserWindow);
  cleanup();
  assert.equal(classes.has("arena-viewport-active"), false);
  assert.equal(listeners.has("focusin"), false);
  assert.equal(properties.has("--arena-pan-y"), false);

  const cleanupAgain = bindArenaViewport(element, browserWindow);
  assert.ok(classes.has("arena-viewport-active"));
  assert.equal(properties.get("--arena-pan-y"), "0px");
  cleanupAgain();
  assert.equal(classes.size, 0);
});
