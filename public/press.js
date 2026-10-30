// One press of a pointer, from its pointerdown to the moment it ends, whatever ends it. Three review findings were
// about presses that did not end cleanly (a swipe that became a scroll, a mouse release lost outside the window, the
// window losing focus), so every way out is here, once:
//   tap     released before it lifted (a click or a tap)
//   drop    released after it lifted
//   cancel  pointercancel (the browser took the pointer: a scroll, a gesture)
//   lost    a mouse or pen moved with no button held: its release happened outside the window
//   swipe   a finger moved past touchSlop before its hold was over: the page scrolls instead
//   blur    the window lost focus
//   hidden  the tab was hidden
//   stop    the caller ended it (press.end())
// A mouse or pen lifts once it has moved `threshold` px; a finger lifts after holding still for `hold` ms (0: a finger
// lifts like a mouse). After the lift every move goes to onMove. onEnd runs exactly once, after the listeners are gone.

export const HOLD_MS = 400;

/**
 * startPress(e, { threshold, touchSlop, hold, onLift, onMove, onEnd, doc, win, timers }) for a pointerdown event e.
 * Returns { pid, touch, x, y, px, py, lifted, ended, end() }; px/py follow the pointer.
 */
export function startPress(e, {
  threshold = 5, touchSlop = 10, hold = 0,
  onLift = () => {}, onMove = () => {}, onEnd = () => {},
  doc = globalThis.document, win = globalThis, timers = globalThis,
} = {}) {
  const p = {
    pid: e.pointerId, touch: e.pointerType === "touch",
    x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY,
    lifted: false, ended: false,
    end: (how = "stop", ev = null) => finish(how, ev),
  };
  let timer = 0;
  const mine = (ev) => ev.pointerId === p.pid;
  const lift = (ev) => { p.lifted = true; timers.clearTimeout(timer); onLift(p, ev); };
  const move = (ev) => {
    if (!mine(ev)) return;
    if (!p.touch && !ev.buttons) return finish("lost", ev);
    p.px = ev.clientX;
    p.py = ev.clientY;
    if (!p.lifted) {
      const far = Math.hypot(p.px - p.x, p.py - p.y);
      if (p.touch && hold) { if (far > touchSlop) finish("swipe", ev); return; }
      if (far < threshold) return;
      lift(ev);
    }
    onMove(p, ev);
  };
  const up = (ev) => {
    if (!mine(ev)) return;
    p.px = ev.clientX;
    p.py = ev.clientY;
    finish(p.lifted ? "drop" : "tap", ev);
  };
  const cancel = (ev) => { if (mine(ev)) finish("cancel", ev); };
  const blur = (ev) => finish("blur", ev);
  const visibility = (ev) => { if (doc.hidden) finish("hidden", ev); };
  const listeners = [[doc, "pointermove", move], [doc, "pointerup", up], [doc, "pointercancel", cancel], [win, "blur", blur], [doc, "visibilitychange", visibility]];
  function finish(how, ev) {
    if (p.ended) return;
    p.ended = true;
    timers.clearTimeout(timer);
    for (const [t, type, fn] of listeners) t.removeEventListener(type, fn);
    onEnd(p, how, ev);
  }
  for (const [t, type, fn] of listeners) t.addEventListener(type, fn);
  if (p.touch && hold) timer = timers.setTimeout(() => { if (!p.ended) lift(null); }, hold);
  return p;
}
