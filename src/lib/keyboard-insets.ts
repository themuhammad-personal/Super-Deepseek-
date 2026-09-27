/** Web equivalent of WindowInsetsAnimationCompat — sync composer with keyboard. */
export function bindKeyboardInsets(root: HTMLElement): () => void {
  const apply = () => {
    const vv = window.visualViewport;
    if (!vv) {
      root.style.setProperty("--kb", "0px");
      return;
    }
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty("--kb", `${Math.round(kb)}px`);
  };
  apply();
  const vv = window.visualViewport;
  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  return () => {
    vv?.removeEventListener("resize", apply);
    vv?.removeEventListener("scroll", apply);
    window.removeEventListener("resize", apply);
  };
}
