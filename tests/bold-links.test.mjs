// Bold links and the link icon (Lex 2026-11-07): bold words inside a link "[a **b** c](url)", a whole bold link
// "**[a](url)**" and a link inside bold "**a [b](url) c**". B and the link icon split a bold stretch at a link's edge so the
// marks nest; no spoken word or bold word is ever lost or changed. The prompter file keeps the links and drops the "**".
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../public/doc.js";
import * as C from "../public/changes.js";
import * as K from "../public/cues.js";
import * as L from "../public/links.js";

const U = "https://example.com/p";
const at = (content, words, from = 0) => { const s = content.indexOf(words, from); assert.ok(s >= 0, words); return [s, s + words.length]; };
const labels = (content) => K.textCues(content).map((c) => c.label);
const paras = (doc) => doc.blocks.filter((b) => b.type === "para");

test("reading: bold inside a link, a whole bold link and a link inside bold are bold; a bold piece across a link's edge is not", () => {
  assert.deepEqual(labels(`[read the **login** page](${U})`), ["login"]);
  assert.deepEqual(labels(`**[WP Activity Log](${U})**`), [`[WP Activity Log](${U})`]);
  assert.deepEqual(labels(`**try [WP Activity Log](${U}) today**`), [`try [WP Activity Log](${U}) today`]);
  assert.deepEqual(labels(`[**go**](${U})`), ["go"]);
  // Across a link's edge, or a star in the address: never a cue.
  assert.deepEqual(labels(`**try [WP** Activity](${U})`), []);
  assert.deepEqual(labels(`[try **WP](${U}) now**`), []);
  assert.deepEqual(labels(`**[a](https://x.example/*b*)**`), ["[a](https://x.example/*b*)"]);
  // A link line stays off limits.
  assert.deepEqual(labels("Read.\n- Docs: https://example.com/**guide**"), []);
  // What is spoken and counted: the words, never the marks or the address.
  assert.equal(K.spokenWords(`**try [WP **Activity** Log](${U}) today**`), "try WP Activity Log today");
  assert.equal(K.stripCues(`**try [WP](${U}) today** and [a **b** c](${U})`), `try [WP](${U}) today and [a b c](${U})`);
  const view = K.plainView(`**a [b](${U})** [c **d**](${U})`);
  assert.equal(view.plain, `a [b](${U}) [c d](${U})`);
});

test("prompter file: the words and the [words](url) links stay, the ** go; camera script and counts read only the words", () => {
  const doc = D.parse(`# T\n\n## Intro\n\n**Try [WP Activity Log](${U}) today.** Read [the **login** page](${U}). Then **[the docs](${U})**.\n`);
  const out = D.exportPrompter(doc).replace(/^### \*\*.*\*\*$/gm, "");
  assert.equal(out.includes("**"), false);
  assert.match(out, new RegExp(`Try \\[WP Activity Log\\]\\(${U.replace(/[./]/g, "\\$&")}\\) today\\.`));
  assert.ok(out.includes(`Read [the login page](${U}).`));
  assert.ok(out.includes(`Then [the docs](${U}).`));
  assert.equal(D.exportCamera(doc), "Try WP Activity Log today. Read the login page. Then the docs.\n");
  assert.equal(D.stats(doc).words, 12);
});

test("B: bold words in a link, a whole link, a link inside bold; split at a link's edge; B is on only when every word is bold", () => {
  const link = `Open [read the login page](${U}) now`;
  const inside = K.toggleCue(link, ...at(link, "login"));
  assert.equal(inside.content, `Open [read the **login** page](${U}) now`);
  assert.equal(K.cueSelected(inside.content, ...at(inside.content, "login")), true);
  assert.equal(K.cueSelected(inside.content, ...at(inside.content, "read the **login** page")), false);
  // The whole link's words: the whole link goes bold, marks outside it.
  const whole = K.toggleCue(link, ...at(link, "read the login page"));
  assert.equal(whole.content, `Open **[read the login page](${U})** now`);
  assert.equal(K.cueSelected(whole.content, ...at(whole.content, "read the login page")), true);
  // Words around a link and the link: one bold stretch holding the link.
  const around = K.toggleCue(link, ...at(link, `Open [read the login page](${U}) now`));
  assert.equal(around.content, `**Open [read the login page](${U}) now**`);
  // Across a link's edge: split there, so the marks nest.
  const s = link.indexOf("Open"), e = link.indexOf("read") + 4;
  assert.equal(K.toggleCue(link, s, e).content, `**Open** [**read** the login page](${U}) now`);
  const s2 = link.indexOf("page"), e2 = link.length;
  assert.equal(K.toggleCue(link, s2, e2).content, `Open [read the login **page**](${U}) **now**`);
  // B again over bold words takes the marks of the bold it touches off; words and link stay.
  assert.equal(K.toggleCue(whole.content, ...at(whole.content, "the login")).content, link);
  const split = `**Open** [**read** the login page](${U}) now`;
  assert.equal(K.cueSelected(split, split.indexOf("Open"), split.indexOf("read") + 4), true);
  assert.equal(K.toggleCue(split, split.indexOf("Open"), split.indexOf("read") + 4).content, link);
  // Bold that half covers a link joins with the new words, split at the edge.
  const half = `Then **try the** free [WP Activity Log](${U}) plan`;
  assert.equal(K.toggleCue(half, half.indexOf("the"), half.indexOf("WP") + 2).content, `Then **try the free** [**WP** Activity Log](${U}) plan`);
  // Words and all of a link's words, as the editor selects them (on the words, its Markdown hidden): one stretch holding it.
  const c = `Then try the free plan of [WP Activity Log](${U}) yourself.`;
  assert.equal(K.toggleCue(c, c.indexOf("of"), c.indexOf("Log") + 3).content, `Then try the free plan **of [WP Activity Log](${U})** yourself.`);
  assert.equal(K.toggleCue(c, c.indexOf("WP"), c.indexOf("yourself") + 8).content, `Then try the free plan of **[WP Activity Log](${U}) yourself**.`);
  // The same when the link's first or last word is already bold inside it.
  const first = `Then try [**WP** Activity Log](${U}) yourself.`;
  assert.equal(K.toggleCue(first, first.indexOf("WP"), first.indexOf("yourself") + 8).content, `Then try **[WP Activity Log](${U}) yourself**.`);
  const last = `Then try [WP Activity **Log**](${U}) yourself.`;
  assert.equal(K.toggleCue(last, last.indexOf("try"), last.indexOf("Log") + 3).content, `Then **try [WP Activity Log](${U})** yourself.`);
  // A bold link inside bold words that are selected with more words: the inner marks merge into one stretch.
  const inner = `Try [a **b** c](${U}) now`;
  assert.equal(K.toggleCue(inner, 0, inner.length).content, `**Try [a b c](${U}) now**`);
});

test("link state: off on plain or bold words, on inside one link, grey when part link part plain", () => {
  const c = `Try **the free** plan of [WP Activity Log](${U}) yourself.`;
  assert.deepEqual(K.linkState(c, ...at(c, "plan of")), { state: "off" });
  assert.deepEqual(K.linkState(c, ...at(c, "the free")), { state: "off" });
  const on = K.linkState(c, ...at(c, "Activity"));
  assert.equal(on.state, "on");
  assert.equal(on.link.url, U);
  assert.equal(K.linkState(c, ...at(c, "WP Activity Log")).state, "on");
  assert.equal(K.linkState(c, at(c, "of")[0], at(c, "WP")[1]).state, "mixed");
  assert.equal(K.linkState("one\ntwo", 0, 7).state, "mixed");
  assert.equal(K.linkState("Read.\n- Docs: https://example.com/guide", 15, 25).state, "none");
  assert.equal(K.linkState("a  b", 1, 3).state, "none");
});

test("the address field: a full https:// or http:// address with a dot in its host name, as typed so far", () => {
  assert.equal(L.typedAddress("  https://wordpress.org/docs  "), "https://wordpress.org/docs");
  assert.equal(L.typedAddress("http://x.example"), "http://x.example");
  for (const t of ["", "https://", "https://wordpress", "wordpress.org", "ftp://x.example", "javascript:alert(1)", "https://x.example/a b"]) assert.equal(L.typedAddress(t), null, t);
});

test("link: plain words, words inside bold, bold words inside, split at a bold edge; remove keeps words and bold", () => {
  const plain = "Then try the free plan yourself.";
  const add = K.addLink(plain, ...at(plain, "the free plan"), U);
  assert.equal(add.content, `Then try [the free plan](${U}) yourself.`);
  assert.deepEqual(add.ops.length, 2);
  // Inside bold: the link goes inside, and the whole bold words become a whole bold link.
  const bold = "Then **try the free plan** now.";
  assert.equal(K.addLink(bold, ...at(bold, "free"), U).content, `Then **try the [free](${U}) plan** now.`);
  assert.equal(K.addLink(bold, ...at(bold, "try the free plan"), U).content, `Then **[try the free plan](${U})** now.`);
  // Bold words wholly inside the new link stay inside it.
  const mid = "Read the **login** page now.";
  assert.equal(K.addLink(mid, ...at(mid, "the **login** page"), U).content, `Read [the **login** page](${U}) now.`);
  assert.equal(K.addLink(mid, ...at(mid, "login** page"), U).content, `Read the [**login** page](${U}) now.`);
  // Across a bold edge: the bold is split there.
  const cross = "Then **try the free plan** of WP now.";
  assert.equal(K.addLink(cross, cross.indexOf("plan"), cross.indexOf("WP") + 2, U).content, `Then **try the free** [**plan** of WP](${U}) now.`);
  assert.equal(K.addLink(cross, cross.indexOf("Then"), cross.indexOf("try") + 3, U).content, `[Then **try**](${U}) **the free plan** of WP now.`);
  // Not over links, not across lines, not without a full https:// or http:// address.
  const linked = `Try [WP](${U}) now`;
  assert.equal(K.addLink(linked, 0, linked.length, U), null);
  assert.equal(K.addLink("one\ntwo", 0, 7, U), null);
  assert.equal(K.addLink(plain, 0, 4, "javascript:alert(1)"), null);
  assert.equal(K.addLink(plain, 0, 4, "ftp://x.example"), null);
  // Remove: the words and the bold stay.
  for (const [content, words, now] of [
    [`Then try [the free plan](${U}) yourself.`, "free", plain],
    [`Then **[try the free plan](${U})** now.`, "the free", "Then **try the free plan** now."],
    [`Read [the **login** page](${U}) now.`, "login", "Read the **login** page now."],
    [`Then **try the [free](${U}) plan** now.`, "free", "Then **try the free plan** now."],
  ]) {
    const r = K.removeLink(content, ...at(content, words));
    assert.equal(r?.content, now, content);
  }
  assert.equal(K.removeLink(plain, 0, 4), null);
});

test("text safety: random selections, B and links never change or lose a spoken word or a bold word", () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const starts = [
    `Then **try the free** plan of [WP Activity Log](${U}) yourself today.`,
    `Open [read the **login** page](${U}) before **[we start](${U})** now.`,
    `**Try [WP](${U}) today** and [a **b** c](${U}) or not.`,
    "Plain words only, with a comma, and more words here.",
  ];
  const view = (t) => K.spokenWords(t).replace(/\s+/g, " ").trim();
  // Which spoken words are bold, in order: bold may change only on the words a toggle selected.
  for (const start of starts) {
    let text = start;
    for (let i = 0; i < 300; i++) {
      const a = rnd(text.length), b = a + 1 + rnd(Math.min(25, text.length - a));
      const snap = D.snapToWords(text, a, b);
      const pick = rnd(3);
      const r = pick === 0 ? K.toggleCue(text, snap.start, snap.end) : pick === 1 ? K.addLink(text, snap.start, snap.end, U) : K.removeLink(text, snap.start, snap.end);
      if (!r) continue;
      assert.equal(view(r.content), view(text), `${text} -> ${r.content}`);
      // Every "**" and every link reads back: no lone marks, no broken links.
      const stars = (r.content.match(/\*\*/g) || []).length;
      const urlStars = L.textLinks(r.content).reduce((n, l) => n + (l.url.match(/\*\*/g) || []).length, 0);
      assert.equal(stars - urlStars, K.textCues(r.content).length * 2, r.content);
      if (pick !== 0) {
        const bold = (t) => { const v = K.boldWords(t); return v.map((x) => x.bold); };
        assert.deepEqual(bold(r.content), bold(text), `${text} -> ${r.content}`);
      }
      text = r.content;
    }
  }
});

test("agent: Find links goes inside bold, around bold and splits a bold edge; mark_cue works inside and around links", () => {
  const seg = (content, extra = {}) => [{ id: "p", content, from: 0, to: content.length, ...extra }];
  // Inside bold words, and the whole bold words.
  const inBold = L.planLinks(seg("Try **WP Activity Log** today."), [{ quote: "WP Activity Log", url: U }]);
  assert.equal(inBold.segments[0].content, `Try **[WP Activity Log](${U})** today.`);
  const part = L.planLinks(seg("Try **the WP Activity Log** today."), [{ quote: "WP Activity Log", url: U }]);
  assert.equal(part.segments[0].content, `Try **the [WP Activity Log](${U})** today.`);
  // A quote read without the marks, across a bold edge.
  const across = L.planLinks(seg("Then **try the free** plan of WP now."), [{ quote: "free plan", url: U }]);
  assert.equal(across.segments[0].content, `Then **try the** [**free** plan](${U}) of WP now.`);
  assert.deepEqual(across.skipped, []);
  // Bold words wholly inside the quote stay inside the link.
  const around = L.planLinks(seg("Read the **login** page now."), [{ quote: "the login page", url: U }]);
  assert.equal(around.segments[0].content, `Read [the **login** page](${U}) now.`);
  // Through the app's plan, with the selection's cues.
  const doc = D.parse("# T\n\n## A\n\nTry **WP Activity Log** today.\n");
  const p = paras(doc)[0];
  const ask = D.makeAsk(doc, { blockId: p.id, start: 0, end: D.contentOf(p).length, action: "links", by: { id: "lex", name: "Lex" } });
  const plan = C.planFor(doc, ask, { kind: "links", links: [{ quote: "WP Activity Log", url: U }] });
  assert.equal(plan.segments[0].content, `Try **[WP Activity Log](${U})** today.`);
  // mark_cue: inside a link's words, a whole link's words, around a link.
  const mk = (content, quote) => K.planCues(seg(content), [{ quote }], "mark");
  assert.equal(mk(`Read [the login page](${U}) now.`, "login").segments[0].content, `Read [the **login** page](${U}) now.`);
  assert.equal(mk(`Read [the login page](${U}) now.`, "the login page").segments[0].content, `Read **[the login page](${U})** now.`);
  assert.equal(mk(`Read [the login page](${U}) now.`, "Read the login page now").segments[0].content, `**Read [the login page](${U}) now**.`);
  assert.equal(mk(`Read [the login page](${U}) now.`, "page now").segments[0].content, `Read [the login **page**](${U}) **now**.`);
  assert.equal(mk(`Read [the login page](${U}) now.`, "Read the login page").segments[0].content, `**Read [the login page](${U})** now.`);
  // unmark_cue on a bold link: the link stays.
  const un = K.planCues(seg(`Read **[the login page](${U})** now.`), [{ quote: `[the login page](${U})` }], "unmark");
  assert.equal(un.segments[0].content, `Read [the login page](${U}) now.`);
});

test("anchors follow a link going in or out by its edits; others' carets show at a nested link's words", () => {
  const c = "Then try the free plan of WP yourself.", ask = [c.indexOf("yourself"), c.indexOf("yourself") + 8];
  const add = K.addLink(c, ...at(c, "free plan"), U);
  const moved = K.opsRange(c, add.ops)(...ask);
  assert.equal(add.content.slice(moved.start, moved.end), "yourself");
  const words = K.opsRange(c, add.ops)(...at(c, "free plan"));
  assert.equal(add.content.slice(words.start, words.end), "free plan");
  const off = K.removeLink(add.content, ...at(add.content, "free"));
  const back = K.opsRange(add.content, off.ops)(moved.start, moved.end);
  assert.equal(off.content.slice(back.start, back.end), "yourself");
  // Splitting bold at a link's edge moves an ask after it too.
  const bold = "Then **try the free plan** of WP yourself.", b = K.addLink(bold, bold.indexOf("plan"), bold.indexOf("WP") + 2, U);
  const after = K.opsRange(bold, b.ops)(bold.indexOf("yourself"), bold.indexOf("yourself") + 8);
  assert.equal(b.content.slice(after.start, after.end), "yourself");
  // **[a](u)**: an offset in either hidden opening shows at the inner words' start, in either hidden end at their end.
  const nested = `x **[a](${U})** y`, closed = [...L.textLinks(nested), ...K.textCues(nested)];
  const cue = K.textCues(nested)[0], link = L.textLinks(nested)[0];
  for (const o of [cue.start + 1, cue.words.start, link.start + 1]) assert.equal(L.shownOffset(closed, o), link.words.start, String(o));
  for (const o of [link.words.end + 1, link.end, cue.end - 1]) assert.equal(L.shownOffset(closed, o), link.words.end, String(o));
  assert.equal(L.shownOffset(closed, cue.start), cue.start);
  assert.equal(L.shownOffset(closed, cue.end), cue.end);
});

test("agent rewrites: bold around and inside links survives when its words do; a rewrite never leaves a lone **", () => {
  assert.deepEqual(K.keepCues(`**[WP](${U})** now`, `Try **[WP](${U})** now`), { text: `Try **[WP](${U})** now`, dropped: 0 });
  assert.deepEqual(K.keepCues(`**[WP](${U})** now`, `Try [WP](${U}) now`), { text: `Try **[WP](${U})** now`, dropped: 0 });
  assert.deepEqual(K.keepCues(`[a **b** c](${U})`, `See [a b c](${U})`), { text: `See [a **b** c](${U})`, dropped: 0 });
  const w = K.widenOverCues(`We **try [a](https://x.example/*y*) now** ok`, 10, 11);
  assert.equal(w.before, "try [");
  assert.equal(w.after, "](https://x.example/*y*) now");
  // A rewrite of words inside a bold link lands and the bold stays where its words survive.
  const doc = D.parse(`# T\n\n## A\n\nRead **[the login page](${U})** now.\n`);
  const p = paras(doc)[0], c = D.contentOf(p);
  const [s, e] = at(c, "now");
  const ask = D.makeAsk(doc, { blockId: p.id, start: s, end: e, action: "simpler", by: { id: "lex", name: "Lex" } });
  Object.assign(ask, { status: "answered", answer: { kind: "replace", text: "today" }, answeredBy: { id: "agent:x", name: "X" } });
  C.land(doc, ask, 1);
  assert.equal(D.contentOf(p), `Read **[the login page](${U})** today.`);
});

test("edits around bold links: typing inside a bold link or a link in bold keeps the marks", () => {
  for (const [old, now, caret] of [
    [`**try [WP](${U}) today**`, `**try [WPX](${U}) today**`, 10],
    [`**try [WP](${U}) today**`, `**try now [WP](${U}) today**`, 10],
    [`[a **b** c](${U})`, `[a **bb** c](${U})`, 7],
  ]) {
    const r = K.settleMarks(old, now, caret);
    assert.ok(!r || r.content === now, `${old} -> ${now}: ${r?.content}`);
  }
  // All of a bold link's words gone: its marks go too.
  assert.equal(K.settleMarks(`We **[a](${U})** y`, "We **** y", 5)?.content, "We  y");
});
