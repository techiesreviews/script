import { test } from "node:test";
import assert from "node:assert/strict";
import { startPress, HOLD_MS } from "../public/press.js";

// Fake event targets, a fake clock and pointer events: no browser.
function target() {
  const on = new Map();
  return {
    hidden: false,
    addEventListener(type, fn) { (on.get(type) ?? on.set(type, new Set()).get(type)).add(fn); },
    removeEventListener(type, fn) { on.get(type)?.delete(fn); },
    fire(type, ev = {}) { for (const fn of [...(on.get(type) ?? [])]) fn({ type, ...ev }); },
    count() { let n = 0; for (const s of on.values()) n += s.size; return n; },
  };
}
function clock() {
  let now = 0, id = 0;
  const due = new Map();
  return {
    setTimeout(fn, ms) { due.set(++id, { fn, at: now + ms }); return id; },
    clearTimeout(i) { due.delete(i); },
    advance(ms) {
      now += ms;
      for (const [i, t] of [...due]) if (t.at <= now) { due.delete(i); t.fn(); }
    },
    pending: () => due.size,
  };
}
const down = (pointerType = "mouse", x = 100, y = 100, pointerId = 1) => ({ pointerId, pointerType, clientX: x, clientY: y, button: 0, isPrimary: true });
function press(pointerType = "mouse", opts = {}) {
  const doc = target(), win = target(), timers = clock(), log = [];
  let prevented = 0;
  const p = startPress(down(pointerType), {
    threshold: 5, touchSlop: 10, hold: HOLD_MS, doc, win, timers,
    onLift: (q) => log.push(["lift", q.px, q.py]),
    onMove: (q, ev) => { log.push(["move", q.px, q.py]); ev.preventDefault?.(); },
    onEnd: (q, how) => log.push(["end", how]),
    ...opts,
  });
  const ev = (x, y, more = {}) => ({ pointerId: 1, clientX: x, clientY: y, buttons: pointerType === "touch" || pointerType === "pen" || pointerType === "mouse" ? 1 : 0, preventDefault: () => prevented++, ...more });
  return { p, doc, win, timers, log, ev, prevented: () => prevented };
}
const ends = (log) => log.filter((l) => l[0] === "end");

test("press: a mouse lifts after 5 px, moves follow, and a release after the lift is a drop; the listeners go", () => {
  const { p, doc, win, timers, log, ev, prevented } = press("mouse");
  assert.equal(timers.pending(), 0, "a mouse has no hold timer");
  doc.fire("pointermove", ev(103, 102));
  assert.deepEqual(log, [], "under the threshold: nothing yet");
  doc.fire("pointermove", ev(104, 104));
  assert.deepEqual(log, [["lift", 104, 104], ["move", 104, 104]], "the lifting move is also a move");
  doc.fire("pointermove", ev(150, 160));
  assert.deepEqual(log.at(-1), ["move", 150, 160]);
  assert.equal(prevented(), 2);
  doc.fire("pointerup", ev(155, 170, { buttons: 0 }));
  assert.deepEqual(log.at(-1), ["end", "drop"]);
  assert.deepEqual([p.px, p.py, p.lifted, p.ended], [155, 170, true, true]);
  assert.equal(doc.count() + win.count(), 0, "every listener is removed");
  doc.fire("pointerup", ev(1, 1));
  p.end();
  assert.equal(ends(log).length, 1, "it ends once");
});

test("press: a release before the lift is a tap, for a mouse and a finger", () => {
  for (const type of ["mouse", "touch"]) {
    const { doc, timers, log, ev } = press(type);
    doc.fire("pointermove", ev(102, 101));
    doc.fire("pointerup", ev(102, 101, { buttons: 0 }));
    assert.deepEqual(log, [["end", "tap"]], type);
    assert.equal(timers.pending(), 0, `${type}: no hold left waiting`);
  }
});

test("press: a finger lifts after holding still for HOLD_MS, at where it is; a small wobble is fine", () => {
  const { doc, timers, log, ev } = press("touch");
  assert.equal(HOLD_MS, 400);
  doc.fire("pointermove", ev(106, 104)); // under touchSlop
  timers.advance(399);
  assert.deepEqual(log, [], "not yet");
  timers.advance(1);
  assert.deepEqual(log, [["lift", 106, 104]]);
  doc.fire("pointermove", ev(200, 300));
  assert.deepEqual(log.at(-1), ["move", 200, 300]);
  doc.fire("pointerup", ev(200, 300, { buttons: 0 }));
  assert.deepEqual(log.at(-1), ["end", "drop"]);
});

test("press: a finger that moves past touchSlop before its hold is a swipe: the page scrolls, no lift later", () => {
  const { doc, timers, log, ev } = press("touch");
  doc.fire("pointermove", ev(100, 111));
  assert.deepEqual(log, [["end", "swipe"]]);
  timers.advance(1000);
  assert.deepEqual(log, [["end", "swipe"]], "the hold timer is gone");
});

test("press: with hold 0 a finger lifts after the threshold, like a mouse", () => {
  const { doc, timers, log, ev } = press("touch", { hold: 0 });
  assert.equal(timers.pending(), 0);
  doc.fire("pointermove", ev(100, 120));
  assert.deepEqual(log.map((l) => l[0]), ["lift", "move"]);
});

test("press: a mouse or pen move with no button held is a lost release; a finger's moves never are", () => {
  for (const type of ["mouse", "pen"]) {
    const { doc, log, ev } = press(type);
    doc.fire("pointermove", ev(120, 120));
    doc.fire("pointermove", ev(300, 300, { buttons: 0 }));
    assert.deepEqual(log.at(-1), ["end", "lost"], type);
    assert.equal(log.filter((l) => l[0] === "move").length, 1, `${type}: the lost move is not followed`);
  }
  // Before the lift too.
  const early = press("mouse");
  early.doc.fire("pointermove", early.ev(101, 100, { buttons: 0 }));
  assert.deepEqual(early.log, [["end", "lost"]]);
  const finger = press("touch");
  finger.timers.advance(HOLD_MS);
  finger.doc.fire("pointermove", finger.ev(150, 150, { buttons: 0 }));
  assert.deepEqual(finger.log.at(-1), ["move", 150, 150]);
});

test("press: pointercancel, window blur and a hidden tab end it, before or after the lift", () => {
  const ways = [
    ["cancel", ({ doc, ev }) => doc.fire("pointercancel", ev(0, 0))],
    ["blur", ({ win }) => win.fire("blur")],
    ["hidden", ({ doc }) => { doc.hidden = true; doc.fire("visibilitychange"); }],
  ];
  for (const [how, fire] of ways) {
    for (const lifted of [false, true]) {
      const t = press("touch");
      if (lifted) t.timers.advance(HOLD_MS);
      fire(t);
      assert.deepEqual(t.log.at(-1), ["end", how], `${how}, lifted ${lifted}`);
      assert.equal(t.doc.count() + t.win.count() + t.timers.pending(), 0, `${how}: nothing left listening or waiting`);
    }
  }
  // A tab that becomes visible again ends nothing.
  const t = press("mouse");
  t.doc.fire("visibilitychange");
  assert.deepEqual(t.log, []);
});

test("press: other pointers are ignored, and end() is a stop that runs onEnd once", () => {
  const { p, doc, log, ev } = press("mouse");
  doc.fire("pointermove", ev(300, 300, { pointerId: 2 }));
  doc.fire("pointerup", ev(300, 300, { pointerId: 2 }));
  doc.fire("pointercancel", ev(300, 300, { pointerId: 2 }));
  doc.fire("pointermove", ev(300, 300, { pointerId: 2, buttons: 0 }));
  assert.deepEqual(log, [], "a second finger or another pointer changes nothing");
  p.end();
  p.end();
  assert.deepEqual(log, [["end", "stop"]]);
  assert.equal(doc.count(), 0);
});

test("press: onEnd runs after the listeners are gone, so it may start a new press", () => {
  const doc = target(), win = target(), timers = clock();
  let second = null;
  const first = startPress(down("mouse"), {
    doc, win, timers,
    onEnd: () => { assert.equal(doc.count() + win.count(), 0); second = startPress(down("mouse", 0, 0, 7), { doc, win, timers }); },
  });
  doc.fire("pointerup", { pointerId: 1, clientX: 100, clientY: 100, buttons: 0 });
  assert.ok(first.ended && second && !second.ended);
  assert.equal(doc.count(), 4, "only the new press listens (4 on the document, 1 on the window)");
  assert.equal(win.count(), 1);
});

test("press: a lift that ends the press itself (the shot re-rendered away) gets no move after it", () => {
  let ended = null;
  const t = press("mouse", { onLift: (q) => { ended = q; q.end?.("gone"); } });
  t.doc.fire("pointermove", t.ev(120, 100));
  assert.ok(ended, "it lifted");
  assert.deepEqual(t.log.filter((l) => l[0] === "move"), [], "no move on an ended press");
});
