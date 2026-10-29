// The "Share to edit" button (the Native Site Editor's prototype 14: the button itself shows what happened).
//   Share to edit → (click: share and copy the link) → Link copied ✓ for 2.4 s → Copy edit link, with × Stop sharing.
// No toast: when the clipboard is not available, `fallback(link)` shows the link to copy by hand.
export const COPIED_MS = 2400;

export function createShareButton({ button, stop, iconSlot, label, icons, share, end, fallback, copy = (t) => navigator.clipboard.writeText(t), timers = globalThis }) {
  let sharing = false, copied = false, timer = 0;
  function render() {
    iconSlot.innerHTML = icons[copied ? "check" : sharing ? "link" : "share"];
    label.textContent = copied ? "Link copied" : sharing ? "Copy edit link" : "Share to edit";
    button.title = label.textContent; // the button shows only its icon (Lex, 2026-10-29)
    button.toggleAttribute("data-done", copied);
    stop.hidden = !sharing;
  }
  button.addEventListener("click", async () => {
    const link = share(); // starts sharing the first time; the copy stays inside the click
    if (!link) return;
    sharing = true;
    try {
      await copy(link);
      copied = true;
      timers.clearTimeout(timer);
      timer = timers.setTimeout(() => { copied = false; render(); }, COPIED_MS);
    } catch {
      fallback?.(link);
    }
    render();
  });
  stop.addEventListener("click", () => { end(); set(false); });
  function set(on) {
    sharing = on;
    if (!on) { copied = false; timers.clearTimeout(timer); }
    render();
  }
  render();
  return { set, get sharing() { return sharing; } };
}
