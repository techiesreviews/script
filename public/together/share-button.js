// The "Share to edit" button (the Native Site Editor's prototype 14: the button itself shows what happened).
//   Share to edit → (click: share and copy the link) → Link copied ✓ for 2.4 s → Copy edit link, with × Stop sharing.
// No toast: when the clipboard is not available, `fallback(link)` shows the link to copy by hand. When sharing could not
// start, the button shows a warning icon in the warning colour (`data-failed`), and its name says why; a click tries again.
export const COPIED_MS = 2400;

export function createShareButton({ button, stop, iconSlot, label, icons, share, end, fallback, copy = (t) => navigator.clipboard.writeText(t), timers = globalThis }) {
  let sharing = false, copied = false, timer = 0, failed = "", clicks = 0;
  function render() {
    iconSlot.innerHTML = icons[copied ? "check" : sharing ? "link" : failed ? "warn" : "share"];
    label.textContent = copied ? "Link copied" : sharing ? "Copy edit link" : failed || "Share to edit";
    button.title = label.textContent; // the button shows only its icon (Lex, 2026-10-29)
    button.toggleAttribute("data-done", copied);
    button.toggleAttribute("data-failed", !!failed && !sharing);
    stop.hidden = !sharing;
  }
  button.addEventListener("click", async () => {
    const link = share(); // starts sharing the first time; the copy stays inside the click
    if (!link) return;
    const mine = ++clicks; // only the latest click's copy speaks (an older one may land after a failed share's retry)
    sharing = true;
    if (failed) { failed = ""; render(); } // a retry drops the failed look at once
    try {
      await copy(link);
      if (!sharing || mine !== clicks) return; // sharing ended while the link was copied (its room could not start), or a newer click took over
      copied = true;
      timers.clearTimeout(timer);
      timer = timers.setTimeout(() => { copied = false; render(); }, COPIED_MS);
    } catch {
      if (sharing && mine === clicks) fallback?.(link);
    }
    render();
  });
  stop.addEventListener("click", () => { end(); set(false); });
  function set(on) {
    sharing = on;
    if (!on) { copied = false; timers.clearTimeout(timer); }
    render();
  }
  /** Sharing could not start: the button says why (`text`) until a click starts it again. */
  function fail(text) {
    failed = text;
    set(false);
  }
  render();
  return { set, fail, get sharing() { return sharing; } };
}
