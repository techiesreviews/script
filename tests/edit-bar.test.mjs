// The slim edit bar (step T, Lex 2026-11-04): the text input and B only. The old buttons are typed commands with a grey
// ghost of the rest of the suggestion; Tab takes it, Enter sends what was typed. The bar never sits on the selected words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveTyped, suggestions, rememberAsk, findWords, plainOffset, barSpot, phoneDock } from "../public/edit-bar.js";
import { ACTIONS } from "../public/doc.js";
import { GUEST_ACTIONS } from "../public/together-adapter.js";

const file = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const host = { spoken: true, addBroll: true, guest: false };
const guest = { spoken: true, addBroll: false, guest: true };

test("every old button is a typed command that makes the same ask", () => {
  const acts = { Shorter: "shorter", simpler: "simpler", "SOUND LIKE ME": "like", "b-roll": "broll", " shorter ": "shorter" };
  for (const [typed, action] of Object.entries(acts)) {
    assert.deepEqual(resolveTyped(typed, host), { kind: "act", action }, typed);
    assert.ok(ACTIONS[action].instruction, `${action} has its standard instruction`);
  }
  assert.deepEqual(resolveTyped("add b-roll", host), { kind: "add" });
  assert.deepEqual(resolveTyped("more", host), { kind: "more" });
});

test("anything else is an ask with the words as typed; nothing typed does nothing", () => {
  assert.deepEqual(resolveTyped("  make it funnier ", host), { kind: "ask", text: "make it funnier" });
  assert.deepEqual(resolveTyped("shorter please", host), { kind: "ask", text: "shorter please" });
  assert.deepEqual(resolveTyped("S", host), { kind: "ask", text: "S" }, "Enter sends what is typed, not the ghost");
  for (const empty of ["", "   ", "\t"]) assert.equal(resolveTyped(empty, host), null);
});

test("guests keep what they could do: asks and Suggest B-roll go through, adding a shot is the host's", () => {
  for (const typed of ["shorter", "simpler", "sound like me", "b-roll", "free words"]) {
    const r = resolveTyped(typed, guest);
    assert.ok(GUEST_ACTIONS.includes(r.action ?? "ask"), typed);
  }
  assert.equal(resolveTyped("add b-roll", guest).kind, "blocked");
  assert.equal(resolveTyped("add b-roll", guest).say, "Only the host can add B-roll.");
  assert.ok(!suggestions("a", { can: guest }).some((s) => /^add/i.test(s)));
});

test("B-roll needs spoken words, as its buttons did: it sends nothing, and only screen readers hear why", () => {
  const notSpoken = { ...host, spoken: false };
  assert.equal(resolveTyped("b-roll", notSpoken).kind, "blocked");
  assert.equal(resolveTyped("add b-roll", notSpoken).kind, "blocked");
  assert.equal(resolveTyped("b-roll", notSpoken).say, "B-roll needs spoken words.");
  assert.deepEqual(resolveTyped("shorter", notSpoken), { kind: "act", action: "shorter" });
  assert.ok(!suggestions("b", { can: notSpoken }).length);
  assert.equal(resolveTyped("add b-roll", { ...host, addBroll: false }).say, "The B-roll list isn't ready.");
});

test("suggestions: the commands first, then earlier asks; only longer than what is typed; any case", () => {
  assert.deepEqual(suggestions("s", { can: host }), ["Shorter", "Simpler", "Sound like me"]);
  assert.deepEqual(suggestions("SH", { can: host }), ["Shorter"]);
  assert.deepEqual(suggestions("b", { can: host }), ["B-roll"]);
  assert.deepEqual(suggestions("m", { can: host, earlier: ["Make it funnier", "more jokes"] }), ["More", "Make it funnier", "more jokes"]);
  assert.deepEqual(suggestions("shorter", { can: host, earlier: ["Shorter and punchier"] }), ["Shorter and punchier"]);
  assert.deepEqual(suggestions("", { can: host, earlier: ["x"] }), []);
  assert.deepEqual(suggestions("   ", { can: host, earlier: ["x"] }), []);
  assert.deepEqual(suggestions("zzz", { can: host }), []);
  // More's items are in its menu, not commands.
  assert.deepEqual(suggestions("e", { can: host }), []);
  assert.deepEqual(resolveTyped("check facts", host), { kind: "ask", text: "check facts" });
});

test("earlier asks: newest first, no repeats in any case, a short list, long ones and rubbish stay out", () => {
  assert.deepEqual(rememberAsk(["a", "b"], "c"), ["c", "a", "b"]);
  assert.deepEqual(rememberAsk(["a", "B"], "b"), ["b", "a"]);
  assert.equal(rememberAsk(Array.from({ length: 30 }, (_, i) => `x${i}`), "y").length, 20);
  assert.deepEqual(rememberAsk(["a"], "x".repeat(201)), ["a"]);
  assert.deepEqual(rememberAsk(null, "a"), ["a"]);
  assert.deepEqual(rememberAsk(["a", 3, null, "x".repeat(201)], "b"), ["b", "a"]);
});

test("the selected words after the line changed: marks don't lose them, and they never jump to another copy", () => {
  // Bold on part of them, and off again: found both ways, from each state.
  const marked = findWords("**Most** of us", "Most of", 0);
  assert.deepEqual(marked, { start: 2, end: 11, quote: "Most** of" });
  assert.deepEqual(findWords("Most of us", marked.quote, 0), { start: 0, end: 7, quote: "Most of" });
  assert.deepEqual(findWords("**Most of** us", marked.quote, 0), { start: 2, end: 9, quote: "Most of" });
  assert.deepEqual(findWords("**Most** **of** us", marked.quote, 0), { start: 2, end: 13, quote: "Most** **of" });
  // Repeated words: the copy nearest to where they were, marks or no marks, on or off.
  const near = plainOffset("**Most** of us wait. **Most** of them.", 23);
  assert.equal(near, 17);
  assert.equal(findWords("**Most** of us wait. **Most** of them.", "Most of", near).start, 23);
  assert.equal(findWords("**Most** of us wait. Most of them.", "Most** of", near).start, 21, "bold off the second: it stays the second");
  assert.equal(findWords("Most of us wait. **Most** of them.", "Most of", near).start, 19);
  assert.equal(findWords("Most of us wait. Most of them.", "Most** of", near).start, 17);
  // A mark before it moves another copy onto its old offset: still its own copy.
  const last = plainOffset("say the the the", 12);
  assert.equal(findWords("say **the** the the", "the", last).start, 16);
  // Several marks landing at once between the copies.
  const it = plainOffset("A B C it D E it", 13);
  assert.equal(findWords("A B C it **D** **E** it", "it", it).start, 21);
  // A quote that took in a whole stretch's marks, moved along the line.
  assert.deepEqual(findWords("So **go** now", "**go** now", 0), { start: 3, end: 13, quote: "**go** now" });
  // Plain text that only looks like marks stays as it is.
  assert.deepEqual(findWords("x a**b y", "a**b", 0), { start: 2, end: 6, quote: "a**b" });
  // Gone.
  assert.equal(findWords("nothing here", "Most of", 0), null);
  assert.equal(findWords("nothing here", "", 0), null);
  assert.equal(findWords("nothing here", "****", 0), null);
});

test("an offset without marks: nothing to count on a line with none; the marks before it don't count", () => {
  assert.equal(plainOffset("no marks", 3), 3);
  assert.equal(plainOffset("**go** now", 7), 3);
  assert.equal(plainOffset("**go** now", 2), 0);
});

const place = (o) => barSpot({ first: { left: 100, top: 300, bottom: 330 }, last: { left: 60, top: 300, bottom: 330 }, w: 400, h: 72, top: 50, vw: 1280, vh: 800, line: 32, ...o });
const clear = (spot, rect, h = 72) => spot.y + h <= rect.top || spot.y >= rect.bottom;

test("the bar goes below the selected words, so they and the line above stay readable", () => {
  const s = place({});
  assert.equal(s.y, 338);
  assert.equal(s.x, 56, "lined up with the last line, where it sits");
  assert.ok(clear(s, { top: 300, bottom: 330 }));
});

test("no room below: above, one line clear when it fits, else right above the words", () => {
  const atBottom = { first: { left: 100, top: 740, bottom: 770 }, last: { left: 60, top: 740, bottom: 770 } };
  const s = place(atBottom);
  assert.equal(s.y, 740 - 32 - 8 - 72, "the line above stays readable");
  assert.equal(s.x, 96);
  const short = place({ vh: 240, first: { left: 100, top: 150, bottom: 180 }, last: { left: 100, top: 150, bottom: 180 } });
  assert.equal(short.y, 70, "short window: right above the words, over the line above only because nothing else fits");
  assert.ok(clear(short, { top: 150, bottom: 180 }));
});

test("a selection taller than the window: the bar stays on screen, on the side with more room", () => {
  const huge = place({ vh: 400, first: { left: 100, top: 90, bottom: 120 }, last: { left: 60, top: 340, bottom: 370 } });
  assert.ok(huge.y >= 58 && huge.y + 72 <= 392);
  const up = place({ vh: 400, first: { left: 100, top: 300, bottom: 330 }, last: { left: 60, top: 380, bottom: 395 } });
  assert.equal(up.y, 300 - 32 - 8 - 72);
});

test("words scrolled out of the window: the bar stays on screen and reachable", () => {
  const above = place({ first: { left: 100, top: -500, bottom: -470 }, last: { left: 60, top: -500, bottom: -470 } });
  assert.equal(above.y, 58);
  const below = place({ first: { left: 100, top: 1500, bottom: 1530 }, last: { left: 60, top: 1500, bottom: 1530 } });
  assert.equal(below.y, 800 - 8 - 72);
});

test("never past the sides of the window", () => {
  assert.equal(place({ last: { left: 1200, top: 300, bottom: 330 } }).x, 1280 - 400 - 8);
  assert.equal(place({ last: { left: -50, top: 300, bottom: 330 } }).x, 8);
});

test("phone: docked at the bottom, at the top when it would sit on the words and they are clear of the top", () => {
  const dock = (first, last, o = {}) => phoneDock({ first: { top: first }, last: { bottom: last }, h: 90, top: 50, vh: 760, ...o });
  assert.equal(dock(200, 230), "bottom");
  assert.equal(dock(640, 670), "top");
  assert.equal(dock(100, 700), "bottom", "words on the whole screen: it stays where it is");
  assert.equal(dock(300, 330, { lift: 400 }), "top", "the keyboard pushes the bar up onto the words");
  assert.equal(dock(500, 530, { lift: 400 }), "bottom", "words under the keyboard: nothing to clear");
});

test("the bar's markup: the word count, B, then the input with its ghost, Tab key and Send; no old buttons", () => {
  const html = file("public/index.html");
  const bar = html.slice(html.indexOf('<div class="edit-bar" id="editBar"'), html.indexOf('<div class="slash-menu"'));
  const order = ['id="ebLabel"', 'id="boldBtn"', 'id="askForm"', 'id="askGhost"', 'id="askInput"', 'id="askSending"', 'id="askTab"', 'type="submit"'].map((k) => bar.indexOf(k));
  assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), `order: ${order}`);
  for (const gone of ["edit-bar__button--voice", 'id="brollBtn"', 'id="moreBtn"', 'id="suggestBroll"', 'id="brollMenu"', 'id="addBroll"', 'data-act="shorter"', 'data-act="simpler"', 'data-act="like"']) assert.ok(!bar.includes(gone), gone);
  assert.match(bar, /<input id="askInput"[^>]*maxlength="500"/);
  assert.match(bar, /<input id="askInput"[^>]*aria-label="[^"]+"/);
  assert.match(bar, /<input id="askInput"[^>]*enterkeyhint="send"/);
  // What More did stays in reach, with the typed command "more".
  const menu = bar.slice(bar.indexOf('id="moreMenu"'));
  assert.deepEqual([...menu.matchAll(/data-act="(\w+)"/g)].map((m) => m[1]), ["explain", "facts", "links"]);
});

test("every command is named for screen readers", () => {
  const html = file("public/index.html");
  const hint = html.slice(html.indexOf('id="askHint"'), html.indexOf("</span>", html.indexOf('id="askHint"')));
  for (const name of ["Shorter", "Simpler", "Sound like me", "B-roll", "Add B-roll", "More"]) assert.ok(hint.includes(name), name);
});

test("the Tab key takes its room all the time, so showing it never changes the input's size", () => {
  const css = file("public/app.css");
  const slot = css.match(/\.edit-bar__tab \{[^}]*\}/)?.[0] ?? "";
  assert.match(slot, /flex: none/);
  assert.match(slot, /inline-size: 3\.1rem/);
  assert.match(css, /\.edit-bar__tab\[data-on="false"\] \{ visibility: hidden; \}/);
  assert.doesNotMatch(css, /\.edit-bar__tab\[data-on="false"\] \{[^}]*display: none/);
  assert.doesNotMatch(css, /--ask-max/);
  assert.doesNotMatch(css, /edit-bar__ask input:focus \{ inline-size/);
});

test("phone: no zoom on focus, room for the thumb, and the bar clear of the home bar", () => {
  const css = file("public/app.css");
  const at = css.indexOf("@media (width < 40rem) {\n  .edit-bar {");
  const phone = css.slice(at, css.indexOf("\n}\n", at));
  assert.match(phone, /--ask-fs: 16px/);
  assert.match(phone, /min-block-size: 2\.75rem/);
  assert.match(phone, /env\(safe-area-inset-bottom/);
});
