import { useLayoutEffect, useRef } from "react";

// iOSではdvhだけではソフトウェアキーボードの高さを除外できない。
// ページを固定し、実際に見えている領域へ対戦画面を追従させる。
export function bindArenaViewport(
  element: HTMLElement,
  browserWindow: Window = window,
) {
  const root = browserWindow.document.documentElement;
  const viewport = browserWindow.visualViewport;
  const hadClass = root.classList.contains("arena-viewport-active");

  const update = () => {
    // ピンチズーム中はレイアウトを縮めず、ブラウザ本来の拡大・移動を許可する。
    if (viewport && viewport.scale !== 1) return;
    element.style.setProperty(
      "--arena-viewport-height",
      `${viewport?.height ?? browserWindow.innerHeight}px`,
    );
    element.style.setProperty(
      "--arena-viewport-top",
      `${viewport?.offsetTop ?? 0}px`,
    );
  };

  root.classList.add("arena-viewport-active");
  update();
  viewport?.addEventListener("resize", update);
  // WebKitがフォーカス時にvisual viewportをパンしても画面上端を維持する。
  viewport?.addEventListener("scroll", update);
  browserWindow.addEventListener("resize", update);

  return () => {
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    browserWindow.removeEventListener("resize", update);
    element.style.removeProperty("--arena-viewport-height");
    element.style.removeProperty("--arena-viewport-top");
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
