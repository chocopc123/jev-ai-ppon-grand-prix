import { useLayoutEffect } from "react";

// 対戦画面のドキュメントスクロール禁止用フック。
// 回答 input 側の先取り防止 (onPointerDown/onTouchStart での preventDefault +
// focus({ preventScroll: true })) で iPhone Chrome の自動パン自体が発生しなく
// なったため、旧来の --arena-pan-y / CSS transform による後追い打ち消し機構は
// 削除した。transform 打ち消しは適用タイミングが次フレームになる上に符号管理
// が必要で、残すと逆方向ズレの原因になるため持たない方が安定する。
// ここでは html/body の position:fixed によるドキュメントスクロール禁止と、
// window スクロールの即時リセットのみ行う。
export function bindArenaViewport(browserWindow: Window = window) {
  const root = browserWindow.document.documentElement;
  const hadClass = root.classList.contains("arena-viewport-active");

  root.classList.add("arena-viewport-active");

  const onWindowScroll = () => {
    if (browserWindow.scrollX === 0 && browserWindow.scrollY === 0) return;
    browserWindow.scrollTo(0, 0);
  };
  const onFocusIn = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const tag = target.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA") return;
    onWindowScroll();
  };

  browserWindow.addEventListener("scroll", onWindowScroll);
  browserWindow.document.addEventListener("focusin", onFocusIn);

  return () => {
    browserWindow.removeEventListener("scroll", onWindowScroll);
    browserWindow.document.removeEventListener("focusin", onFocusIn);
    if (!hadClass) root.classList.remove("arena-viewport-active");
  };
}

export function useArenaViewport(enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled) return;
    return bindArenaViewport();
  }, [enabled]);
}
