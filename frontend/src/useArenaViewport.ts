import { useLayoutEffect, useRef } from "react";

// iPhone Chrome (iOS WebKit) のフォーカス時ガクつき対策。
// 対戦画面は layout viewport に完全固定し、高さの追従は一切行わない。
// WebKit は入力が見切れていなくても実機で visualViewport をパンさせる
// ことがある (offsetTop > 0)。window.scrollTo では offsetTop は戻せない
// ため、パン量を --arena-pan-y として保持し、CSS transform で打ち消す。
// transform は合成スレッド処理のためレイアウト再計算を起こさず、
// キーボード開閉アニメ中も画面は1pxも動かず、下から重なるだけになる。
export function bindArenaViewport(
  element: HTMLElement,
  browserWindow: Window = window,
) {
  const root = browserWindow.document.documentElement;
  const viewport = browserWindow.visualViewport;
  const hadClass = root.classList.contains("arena-viewport-active");

  root.classList.add("arena-viewport-active");

  const syncPan = () => {
    // ピンチズーム中のパンには干渉しない。
    if (viewport && viewport.scale !== 1) return;
    element.style.setProperty(
      "--arena-pan-y",
      `${viewport?.offsetTop ?? 0}px`,
    );
  };

  const onViewportScroll = () => syncPan();
  const onViewportResize = () => syncPan();
  const onWindowScroll = () => {
    if (browserWindow.scrollX === 0 && browserWindow.scrollY === 0) return;
    browserWindow.scrollTo(0, 0);
  };
  const onFocusIn = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const tag = target.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA") return;
    // ドキュメント側のスクロールだけ即時リセット。
    // visualViewport のパンは scroll イベント経由で transform 打ち消しする。
    onWindowScroll();
  };

  syncPan();
  viewport?.addEventListener("scroll", onViewportScroll);
  viewport?.addEventListener("resize", onViewportResize);
  browserWindow.addEventListener("scroll", onWindowScroll);
  browserWindow.document.addEventListener("focusin", onFocusIn);

  return () => {
    viewport?.removeEventListener("scroll", onViewportScroll);
    viewport?.removeEventListener("resize", onViewportResize);
    browserWindow.removeEventListener("scroll", onWindowScroll);
    browserWindow.document.removeEventListener("focusin", onFocusIn);
    element.style.removeProperty("--arena-pan-y");
    if (!hadClass) root.classList.remove("arena-viewport-active");
  };
}

export function useArenaViewport(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    return bindArenaViewport(ref.current);
  }, [enabled]);

  return ref;
}
