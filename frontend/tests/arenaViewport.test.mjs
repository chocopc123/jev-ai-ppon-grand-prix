import assert from "node:assert/strict";
import { test } from "node:test";
import { bindArenaViewport } from "../src/useArenaViewport.ts";

function createEnvironment(withViewport = true) {
  const classes = new Set();
  const properties = new Map();
  const element = {
    style: {
      setProperty: (key, value) => properties.set(key, value),
      removeProperty: (key) => properties.delete(key),
    },
  };
  const browserWindow = Object.assign(new EventTarget(), {
    innerHeight: 800,
    document: {
      documentElement: {
        classList: {
          contains: (name) => classes.has(name),
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
        },
      },
    },
    visualViewport: withViewport
      ? Object.assign(new EventTarget(), { height: 720, offsetTop: 0, scale: 1 })
      : null,
  });
  return { element, browserWindow, classes, properties };
}

test("キーボードの開閉・フォーカス時のパンに表示領域が追従する", () => {
  const { element, browserWindow, classes, properties } = createEnvironment();
  const cleanup = bindArenaViewport(element, browserWindow);
  const viewport = browserWindow.visualViewport;
  assert.ok(classes.has("arena-viewport-active"));
  assert.equal(properties.get("--arena-viewport-height"), "720px");

  viewport.height = 360;
  viewport.dispatchEvent(new Event("resize"));
  assert.equal(properties.get("--arena-viewport-height"), "360px");

  viewport.offsetTop = 120;
  viewport.dispatchEvent(new Event("scroll"));
  assert.equal(properties.get("--arena-viewport-top"), "120px");

  viewport.height = 720;
  viewport.offsetTop = 0;
  viewport.dispatchEvent(new Event("resize"));
  assert.equal(properties.get("--arena-viewport-height"), "720px");
  assert.equal(properties.get("--arena-viewport-top"), "0px");
  cleanup();
});

test("ピンチズーム中はレイアウトを変えず、等倍復帰後に追従する", () => {
  const { element, browserWindow, properties } = createEnvironment();
  const cleanup = bindArenaViewport(element, browserWindow);
  const viewport = browserWindow.visualViewport;
  viewport.scale = 2;
  viewport.height = 360;
  viewport.offsetTop = 80;
  viewport.dispatchEvent(new Event("resize"));
  viewport.dispatchEvent(new Event("scroll"));
  assert.equal(properties.get("--arena-viewport-height"), "720px");
  assert.equal(properties.get("--arena-viewport-top"), "0px");
  viewport.scale = 1;
  viewport.dispatchEvent(new Event("resize"));
  assert.equal(properties.get("--arena-viewport-height"), "360px");
  cleanup();
});

test("VisualViewport非対応環境ではwindowの高さに追従する", () => {
  const { element, browserWindow, properties } = createEnvironment(false);
  const cleanup = bindArenaViewport(element, browserWindow);
  assert.equal(properties.get("--arena-viewport-height"), "800px");
  assert.equal(properties.get("--arena-viewport-top"), "0px");
  browserWindow.innerHeight = 400;
  browserWindow.dispatchEvent(new Event("resize"));
  assert.equal(properties.get("--arena-viewport-height"), "400px");
  cleanup();
});

test("退出時にページ固定とイベント購読を解除し、再入室できる", () => {
  const { element, browserWindow, classes, properties } = createEnvironment();
  const cleanup = bindArenaViewport(element, browserWindow);
  cleanup();
  assert.equal(classes.has("arena-viewport-active"), false);
  browserWindow.visualViewport.dispatchEvent(new Event("resize"));
  browserWindow.visualViewport.dispatchEvent(new Event("scroll"));
  browserWindow.dispatchEvent(new Event("resize"));
  assert.equal(properties.size, 0);

  const cleanupAgain = bindArenaViewport(element, browserWindow);
  assert.ok(classes.has("arena-viewport-active"));
  assert.equal(properties.get("--arena-viewport-height"), "720px");
  cleanupAgain();
  assert.equal(classes.size, 0);
});
