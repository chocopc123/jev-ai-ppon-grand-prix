import assert from "node:assert/strict";
import { test } from "node:test";
import { bindArenaViewport } from "../src/useArenaViewport.ts";

function createEnvironment() {
  const classes = new Set();
  const listeners = new Map();
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
  });
  return { browserWindow, classes, listeners, scrolledTo };
}

test("画面固定クラスを付与し、フォーカス監視を開始する", () => {
  const { browserWindow, classes, listeners } = createEnvironment();
  const cleanup = bindArenaViewport(browserWindow);
  assert.ok(classes.has("arena-viewport-active"));
  assert.ok(listeners.has("focusin"));
  cleanup();
});

test("窓スクロールは即時に0へ戻す", () => {
  const { browserWindow, scrolledTo } = createEnvironment();
  const cleanup = bindArenaViewport(browserWindow);

  browserWindow.scrollX = 0;
  browserWindow.scrollY = 30;
  browserWindow.dispatchEvent(new Event("scroll"));
  assert.deepEqual(scrolledTo[0], [0, 0]);

  scrolledTo.length = 0;
  browserWindow.scrollX = 0;
  browserWindow.scrollY = 0;
  browserWindow.dispatchEvent(new Event("scroll"));
  assert.equal(scrolledTo.length, 0);
  cleanup();
});

test("フォーカスインでドキュメントスクロールだけを戻す", () => {
  const { browserWindow, listeners, scrolledTo } = createEnvironment();
  const cleanup = bindArenaViewport(browserWindow);
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

test("退出時にページ固定とイベント購読を解除し、再入室できる", () => {
  const { browserWindow, classes, listeners } = createEnvironment();
  const cleanup = bindArenaViewport(browserWindow);
  cleanup();
  assert.equal(classes.has("arena-viewport-active"), false);
  assert.equal(listeners.has("focusin"), false);

  const cleanupAgain = bindArenaViewport(browserWindow);
  assert.ok(classes.has("arena-viewport-active"));
  cleanupAgain();
  assert.equal(classes.size, 0);
});
