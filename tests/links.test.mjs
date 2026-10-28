// Step G: links in the script, in the prompter's format; the camera script and word counts see only the words;
// the agent's "links" answer goes straight in as one change, marked, with Undo.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../public/doc.js";
import * as C from "../public/changes.js";
import * as L from "../public/links.js";
import { readBlocks } from "../public/together-adapter.js";
import { diff } from "../public/together/ops.js";
import { checkArgs, TOOLS, INSTRUCTIONS, WATCH_PROMPT } from "../worker/mcp.js";

/* The prompter's own line reading, copied from techies-prompter src/core.mjs (regexes unchanged). */
const linkRe = /^-\s*(?:(.+?):\s+)?(https?:\/\/\S+)\s*$/;
const textLinkRe = /\[([^[\]]*[^\s[\]][^[\]]*)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/gi;
function prompterLinks(md) {
  const out = [];
  let section = null;
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    const h = line.match(/^#{2,3}\s+(.*)$/);
    if (h) { section = h[1].replace(/\*\*/g, "").trim(); continue; }
    if (!section || !line) continue;
    const link = line.match(linkRe);
    if (link) { out.push({ section, kind: "line", label: link[1], url: link[2] }); continue; }
    if (/^\[.*\]$/.test(line) && !/^\[[^[\]]*\]\(https?:\/\//i.test(line)) continue; // a reminder
    for (const m of line.matchAll(textLinkRe)) out.push({ section, kind: "text", label: m[1].trim(), url: m[2], line });
  }
  return out;
}

const SCRIPT = [
  "# Links",
  "",
  "## 1 · Hook (0:00–0:30)",
  "",
  "- Docs: https://example.com/docs",
  "",
  "We use [Mr. Smith's tool. Really](https://example.com/smith) every day. It works.",
  "",
  "[The editor](https://script.techies.tools) opens files. Then you read [the prompter](https://prompter.techies.tools).",
  "",
  "## 2 · Demo",
  "",
  "First a line.",
  "- Example page: https://example.com/page",
  "Then the end with [Wikipedia](https://en.wikipedia.org/wiki/Foo_(bar)).",
  "",
  "- a plain list item",
  "- Second: https://example.com/second",
  "",
  "[a reminder](not a link)",
  "",
].join("\n");

test("links: found with their words and address; link lines; spoken text without them", () => {
  const c = "Use [the docs](https://x.com/a) and [Wiki](https://w.org/A_(b)) now.";
  const links = L.textLinks(c);
  assert.deepEqual(links.map((l) => [c.slice(l.start, l.end), c.slice(l.words.start, l.words.end), l.url]), [
    ["[the docs](https://x.com/a)", "the docs", "https://x.com/a"],
    ["[Wiki](https://w.org/A_(b))", "Wiki", "https://w.org/A_(b)"],
  ]);
  assert.equal(L.textLinks("[x](javascript:alert(1)) [y](ftp://a) [ ](https://a.b)").length, 0);
  assert.ok(L.isLinkLine("  - Docs: https://example.com"));
  assert.ok(L.isLinkLine("- https://example.com"));
  assert.ok(!L.isLinkLine("- Docs at example.com"));
  assert.equal(L.spokenText("Read [the docs](https://x.com/a) now.\n- Docs: https://x.com\nBye."), "Read the docs now.\nBye.");
});

test("safe addresses: full https:// or http:// only, no javascript:, data:, spaces or control characters", () => {
  for (const ok of ["https://example.com", "http://example.com/a?b=1#c", "https://en.wikipedia.org/wiki/Foo_(bar)"]) assert.ok(L.safeUrl(ok), ok);
  for (const bad of ["javascript:alert(1)", "data:text/html,hi", "example.com", "https://", "https://a b.com", "https://a.com/\u0000", "ftp://a.com", "//a.com", "https://a.com/(x", "https://" + "a".repeat(2000), 42, null]) {
    assert.ok(!L.safeUrl(bad), String(bad).slice(0, 40));
  }
});

test("a para that starts with a link stays spoken; a reminder is still a note", () => {
  const doc = D.parse("[The docs](https://x.com) say so [pause]\n\n[a reminder]\n\n[a reminder with [Docs](https://x.com) in it]\n");
  assert.deepEqual(doc.blocks.map((b) => b.type), ["para", "note", "note"]);
});

test("prompter export: every link whole, in its section; sentences never split inside a link", () => {
  const out = D.exportPrompter(D.parse(SCRIPT));
  const lines = out.split("\n");
  assert.ok(lines.includes("We use [Mr. Smith's tool. Really](https://example.com/smith) every day."), "a link whose words hold \". X\" stays whole");
  assert.ok(lines.includes("It works."));
  assert.ok(lines.includes("[The editor](https://script.techies.tools) opens files."), "a link at the start of a sentence");
  assert.ok(lines.includes("Then you read [the prompter](https://prompter.techies.tools)."), "a link at the end of a sentence");
  assert.ok(!lines.includes("- a plain list item"), "lists stay out of the prompter");
  // The prompter finds each link in its section, in reading order.
  assert.deepEqual(prompterLinks(out).map(({ section, kind, label, url }) => [section.split(" · ")[0], kind, label ?? null, url]), [
    ["1", "line", "Docs", "https://example.com/docs"],
    ["1", "text", "Mr. Smith's tool. Really", "https://example.com/smith"],
    ["1", "text", "The editor", "https://script.techies.tools"],
    ["1", "text", "the prompter", "https://prompter.techies.tools"],
    ["2", "line", "Example page", "https://example.com/page"],
    ["2", "text", "Wikipedia", "https://en.wikipedia.org/wiki/Foo_(bar)"],
    ["2", "line", "Second", "https://example.com/second"],
  ]);
  // The link line right under the heading comes first in its section (it opens when the section starts); the one
  // inside a para stays in its place between the sentences.
  const s1 = lines.indexOf("### **1 · HOOK · 0:00**");
  assert.deepEqual(lines.slice(s1 + 1, s1 + 3), ["", "- Docs: https://example.com/docs"]);
  const mid = lines.indexOf("- Example page: https://example.com/page");
  assert.deepEqual([lines[mid - 1], lines[mid + 1]], ["First a line.", "Then the end with [Wikipedia](https://en.wikipedia.org/wiki/Foo_(bar))."]);
});

test("camera script and word counts: only the words, never the address", () => {
  const doc = D.parse("## 1 · Hook\n\nRead [the docs](https://example.com/a/very/long/path) now.\n- Docs: https://example.com\nBye.\n");
  assert.equal(D.exportCamera(doc), "Read the docs now. Bye.\n");
  assert.equal(D.stats(doc).words, 5);
});

test("planLinks: each quote's first unlinked occurrence in the asked text, on whole words", () => {
  const content = "Try Claude and Claude Code. MAIL AI. [Docs](https://d.com) and Docs.";
  const seg = [{ id: "b", content, from: 0, to: content.length }];
  const plan = L.planLinks(seg, [
    { quote: "Claude", url: "https://claude.ai" },
    { quote: "AI", url: "https://ai.com" },
    { quote: "Docs", url: "https://docs.com" },
    { quote: "Claude", url: "https://other.ai" },
    { quote: "missing", url: "https://m.com" },
    { quote: "Code", url: "javascript:alert(1)" },
  ]);
  assert.equal(plan.segments[0].content, "Try [Claude](https://claude.ai) and Claude Code. MAIL [AI](https://ai.com). [Docs](https://d.com) and [Docs](https://docs.com).");
  assert.deepEqual(plan.skipped, [
    { quote: "Claude", why: "already linked in this answer" },
    { quote: "missing", why: "not found word for word in the asked text" },
    { quote: "Code", why: "not a full https:// address" },
  ]);
  assert.deepEqual([plan.segments[0].from, plan.segments[0].to], [4, 67]);
  // Only inside the asked stretch; text already linked is skipped.
  const inside = L.planLinks([{ id: "b", content, from: 11, to: 26 }], [{ quote: "Claude", url: "https://c.ai" }, { quote: "Try", url: "https://t.com" }]);
  assert.equal(inside.segments[0].content, "Try Claude and [Claude](https://c.ai) Code. MAIL AI. [Docs](https://d.com) and Docs.");
  assert.equal(inside.skipped[0].quote, "Try");
  const linked = L.planLinks([{ id: "b", content: "[Docs](https://d.com)", from: 0, to: 21 }], [{ quote: "Docs", url: "https://x.com" }]);
  assert.deepEqual([linked.segments.length, linked.skipped[0].why], [0, "already linked"]);
  // Link lines are not linked again; headings and reminders are named as the reason.
  const lines = L.planLinks([{ id: "b", content: "- Docs: https://docs.com", from: 0, to: 24 }], [{ quote: "Docs", url: "https://x.com" }, { quote: "Hook", url: "https://h.com" }], { others: ["1 · Hook", "[ON SCREEN: Docs]"] });
  assert.deepEqual(lines.skipped.map((s) => s.why), ["already linked", "in a heading or reminder, where links don't go"]);
});

test("checkAnswer and cleanAnswer: links answers, their limits and which asks they fit", () => {
  const doc = D.parse("## 1 · Hook\n\nWe use Claude here.\n");
  const p = doc.blocks[1];
  const sel = D.makeAsk(doc, { blockId: p.id, start: 0, end: 18, action: "links", by: { id: "lex", name: "Lex" } });
  const whole = D.makeAsk(doc, { scope: "script", action: "links", by: { id: "lex", name: "Lex" } });
  const voice = D.makeAsk(doc, { scope: "script", action: "voice", by: { id: "lex", name: "Lex" } });
  const simpler = D.makeAsk(doc, { blockId: p.id, start: 0, end: 18, action: "simpler", by: { id: "lex", name: "Lex" } });
  const good = { kind: "links", links: [{ quote: " Claude ", url: "https://claude.ai" }], message: "One link." };
  assert.deepEqual(D.checkAnswer(sel, good, doc).answer, { kind: "links", links: [{ quote: "Claude", url: "https://claude.ai" }], message: "One link." });
  assert.ok(D.checkAnswer(whole, good, doc).answer);
  assert.ok(D.checkAnswer({ ...simpler, action: "ask" }, good, doc).answer, "a free ask may be answered with links");
  assert.match(D.checkAnswer(whole, { kind: "note", text: "x" }, doc).error, /Find links.*kind "links"/);
  assert.match(D.checkAnswer(simpler, good, doc).error, /links answers fit/);
  assert.match(D.checkAnswer(voice, good, doc).error, /links answers fit/);
  assert.match(D.checkAnswer(sel, { kind: "links", links: [] }, doc).error, /list of \{ quote, url \}/);
  assert.match(D.checkAnswer(sel, { kind: "links", links: Array(31).fill(good.links[0]) }, doc).error, /At most 30 links/);
  assert.match(D.checkAnswer(sel, { kind: "links", links: [{ quote: "Claude", url: "javascript:alert(1)" }] }, doc).error, /full https:\/\/ address/);
  assert.match(D.checkAnswer(sel, { kind: "links", links: [{ quote: "Claude", url: "data:text/html,x" }] }, doc).error, /full https:\/\/ address/);
  assert.match(D.checkAnswer(sel, { kind: "links", links: [{ quote: "", url: "https://a.com" }] }, doc).error, /needs a quote/);
  assert.match(D.checkAnswer(sel, { kind: "links", links: [{ quote: "q".repeat(501), url: "https://a.com" }] }, doc).error, /500/);
  assert.equal(D.cleanAnswer(simpler, good), null);
});

const LINKS_SCRIPT = () => D.parse("# T\n\n## 1 · Hook\n\nWe use Claude and the prompter. Then Claude again.\n\n[ON SCREEN: Claude]\n\nA line about Wikipedia.\n\n## Notes\n\nClaude in notes.\n");
const linksAsk = (doc, blockId, quote, links) => {
  const c = D.contentOf(D.blockById(doc, blockId)), start = c.indexOf(quote);
  const ask = D.makeAsk(doc, { blockId, start, end: start + quote.length, action: "links", by: { id: "lex", name: "Lex" } });
  return Object.assign(ask, { status: "answered", answer: { kind: "links", links }, answeredBy: { id: "agent:claude-code", name: "Claude" } });
};

test("links on a selection: one change, marked from the first new link to the last, and Undo takes it all back", () => {
  const doc = LINKS_SCRIPT(), p = doc.blocks[2];
  const old = D.contentOf(p);
  const ask = linksAsk(doc, p.id, "We use Claude and the prompter.", [{ quote: "the prompter", url: "https://prompter.techies.tools" }, { quote: "Claude", url: "https://claude.ai" }, { quote: "Wikipedia", url: "https://wikipedia.org" }]);
  assert.ok(C.goesStraightIn(ask, ask.answer));
  const before = readBlocks(doc);
  const res = C.land(doc, ask, 7);
  C.setMark(ask, res.mark);
  assert.equal(D.contentOf(p), "We use [Claude](https://claude.ai) and [the prompter](https://prompter.techies.tools). Then Claude again.");
  assert.equal(diff(before, readBlocks(doc)).length, 1, "one change");
  assert.equal(ask.status, "kept");
  assert.ok(C.isMarked(ask));
  assert.equal(D.contentOf(p).slice(ask.start, ask.end), "[Claude](https://claude.ai) and [the prompter](https://prompter.techies.tools)");
  assert.deepEqual(ask.change, { text: "[Claude](https://claude.ai) and [the prompter](https://prompter.techies.tools)", removed: "Claude and the prompter", at: 7 });
  assert.deepEqual(res.skipped, [{ quote: "Wikipedia", why: "not found word for word in the asked text" }]);
  assert.deepEqual(ask.answer.links.map((l) => l.quote), ["Claude", "the prompter"]);
  C.undo(doc, ask);
  assert.equal(D.contentOf(p), old);
  assert.equal(ask.status, "undone");
});

test("links on the whole script: spoken paragraphs only, one marked change per paragraph, one landing", () => {
  const doc = LINKS_SCRIPT();
  const ask = Object.assign(D.makeAsk(doc, { scope: "script", action: "links", by: { id: "lex", name: "Lex" } }), { status: "taken" });
  const answer = { kind: "links", links: [{ quote: "Claude", url: "https://claude.ai" }, { quote: "Wikipedia", url: "https://wikipedia.org" }, { quote: "Hook", url: "https://hook.com" }, { quote: "nowhere", url: "https://n.com" }] };
  const plan = C.planFor(doc, ask, answer);
  assert.equal(plan.segments.length, 2);
  const before = readBlocks(doc);
  const res = C.landScript(doc, { ...ask, answer }, 9);
  assert.equal(res.parts.length, 2);
  assert.equal(D.serialize(doc), "# T\n\n## 1 · Hook\n\nWe use [Claude](https://claude.ai) and the prompter. Then Claude again.\n\n[ON SCREEN: Claude]\n\nA line about [Wikipedia](https://wikipedia.org).\n\n## Notes\n\nClaude in notes.\n");
  assert.equal(diff(before, readBlocks(doc)).length, 2, "one operation per paragraph that changed");
  assert.deepEqual(res.skipped.map((s) => [s.quote, s.why]), [["Hook", "in a heading or reminder, where links don't go"], ["nowhere", "not found word for word in the asked text"]]);
  for (const { ask: part } of res.parts) {
    assert.deepEqual([part.scope, part.action, part.from, part.status, part.by.id], ["selection", "links", ask.id, "kept", "lex"]);
    assert.ok(C.isMarked(part));
  }
  assert.equal(res.parts[0].ask.change.text, "[Claude](https://claude.ai)");
  // Undo on the tag: one paragraph at a time, newest first.
  const asks = res.parts.map((p) => p.ask);
  C.undo(doc, C.newestMarked(asks));
  assert.equal(asks.filter(C.isMarked).length, 1);
  // Ctrl/Cmd+Z of the landing: the script ask and all its paragraphs' asks are undone together.
  const parent = { ...ask, status: "kept" };
  const step = C.landStep([parent, ...asks], { id: parent.id, status: "undone", also: asks.map((a) => a.id) });
  assert.deepEqual([parent, ...asks].map((a) => a.status), ["undone", "undone", "undone"]);
  assert.deepEqual(step.back, { id: parent.id, status: "kept", also: asks.map((a) => a.id) });
  // Nothing to link: nothing changes.
  const none = D.parse("## 1 · Hook\n\nPlain words.\n");
  const n = Object.assign(D.makeAsk(none, { scope: "script", action: "links", by: { id: "lex", name: "Lex" } }), { answer: { kind: "links", links: [{ quote: "absent", url: "https://a.com" }] } });
  assert.equal(C.landScript(none, n), null);
  assert.equal(D.serialize(none), "## 1 · Hook\n\nPlain words.\n");
});

test("a link at a para's start keeps it a para; the agent hears what went in and what was skipped", () => {
  const doc = D.parse("## 1 · Hook\n\nClaude helps [a lot]\n");
  const p = doc.blocks[1];
  const ask = linksAsk(doc, p.id, "Claude helps", [{ quote: "Claude", url: "https://claude.ai" }]);
  const res = C.land(doc, ask, 1);
  assert.ok(res);
  assert.equal(p.type, "para");
  assert.equal(D.contentOf(p), "[Claude](https://claude.ai) helps [a lot]");
  assert.equal(C.answerResult("links", { linked: 2, skipped: [{ quote: "X", why: "already linked" }] }), "Done: 2 links are in the text now. The person can undo them. Skipped: \"X\" (already linked).");
  assert.equal(C.answerResult("links", { linked: 1 }), "Done: 1 link is in the text now. The person can undo them.");
  assert.match(C.noLinksError([{ quote: "X", why: "already linked" }]), /^No link went in\. Skipped: "X" \(already linked\)\./);
});

test("MCP: answer_ask takes links, at most 30, full https:// addresses only; the agent is told how", () => {
  const answer = TOOLS.find((t) => t.name === "answer_ask").inputSchema;
  assert.ok(answer.properties.kind.enum.includes("links"));
  assert.equal(answer.properties.links.maxItems, 30);
  assert.equal(answer.properties.links.items.properties.quote.maxLength, 500);
  assert.equal(answer.properties.links.items.properties.url.maxLength, 2000);
  const ok = { askId: "a1", kind: "links", links: [{ quote: "Claude", url: "https://claude.ai" }] };
  assert.equal(checkArgs("answer_ask", ok), "");
  for (const [args, re] of [
    [{ ...ok, links: [] }, /list of \{ quote, url \}/],
    [{ ...ok, links: Array(31).fill(ok.links[0]) }, /At most 30 links/],
    [{ ...ok, links: [{ quote: "a", url: "javascript:alert(1)" }] }, /no javascript:, data:/],
    [{ ...ok, links: [{ quote: "a", url: "data:text/html,x" }] }, /no javascript:, data:/],
    [{ ...ok, links: [{ quote: "a", url: "https://a.com/" + "x".repeat(2000) }] }, /at most 2000/],
    [{ ...ok, links: [{ quote: "", url: "https://a.com" }] }, /needs quote/],
    [{ ...ok, links: [{ quote: "a", url: "https://a.com", why: "x" }] }, /unknown field why/],
    [{ askId: "a1", kind: "links" }, /needs links/],
  ]) assert.match(checkArgs("answer_ask", args), re);
  assert.match(INSTRUCTIONS, /official page/);
  assert.match(INSTRUCTIONS, /never a search page, a shortener or an affiliate link/);
  assert.match(WATCH_PROMPT, /links \(on a selection, or scope "script"/);
});

test("B-roll: a shot's Over still finds a line that got a link, and the link alone asks for no check", async () => {
  const B = await import("../public/broll.js");
  const doc = D.parse("# T\n\n## 1 · Hook\n\nRead the docs here before you start.\n");
  const shots = [{ id: "B1", over: '"Read the docs here before"', what: "x", how: "", kind: "broll" }];
  B.matchShots(doc, shots);
  assert.equal(shots[0].blockIds.length, 1);
  const p = doc.blocks.find((b) => b.type === "para");
  D.setContent(doc, p.id, "Read [the docs](https://example.com/docs) here before you start.");
  const again = [{ ...shots[0] }];
  B.matchShots(doc, again);
  assert.deepEqual(again[0].blockIds, shots[0].blockIds);
  assert.deepEqual(B.touchShots(doc, shots), []);
});

test("links on the whole script stay out of other open work: a waiting ask and a marked change both survive", () => {
  const doc = LINKS_SCRIPT(), p = doc.blocks[2];
  const by = { id: "lex", name: "Lex" };
  // "We use Claude and the prompter. Then Claude again."
  const waiting = D.makeAsk(doc, { blockId: p.id, start: 18, end: 30, action: "simpler", by });
  assert.equal(waiting.quote, "the prompter");
  const c = D.contentOf(p), at = c.indexOf("again");
  const marked = { id: "m1", scope: "selection", action: "simpler", status: "kept", by, blockId: p.id, start: at, end: at + 5, quote: "again", change: { text: "again", removed: "once more", at: 1 } };
  const voice = Object.assign(D.makeAsk(doc, { scope: "script", action: "voice", by }), { status: "answered", answer: { kind: "marks", marks: [{ quote: "line", blockId: doc.blocks[4].id, start: 2, end: 6, state: "open" }] } });
  const asks = [waiting, marked, voice];
  const ask = Object.assign(D.makeAsk(doc, { scope: "script", action: "links", by }), { status: "taken" });
  const answer = { kind: "links", links: [
    { quote: "Claude", url: "https://claude.ai" },
    { quote: "the prompter", url: "https://prompter.techies.tools" },
    { quote: "again", url: "https://again.com" },
    { quote: "Then", url: "https://then.com" },
    { quote: "A line", url: "https://line.com" },
    { quote: "Wikipedia", url: "https://wikipedia.org" },
  ] };
  const plan = C.planFor(doc, ask, answer, { asks });
  assert.deepEqual(plan.skipped, [
    { quote: "the prompter", why: "under an open ask or change" },
    { quote: "again", why: "under an open ask or change" },
    { quote: "Then", why: "an open ask or change sits between it and another link in its paragraph" },
    { quote: "A line", why: "under an open ask or change" },
  ]);
  // Without the asks, the same answer would have reached into them.
  assert.equal(C.planFor(doc, ask, answer).skipped.length, 0);
  const before = C.blocksOf(doc);
  const res = C.landScript(doc, { ...ask, answer }, 9, { asks });
  for (const part of res.parts) D.moveAsks(asks, part.blockId, part.blockId, part.at, part.delta); // as the editor does
  assert.equal(D.contentOf(p), "We use [Claude](https://claude.ai) and the prompter. Then Claude again.");
  assert.equal(D.contentOf(doc.blocks[4]), "A line about [Wikipedia](https://wikipedia.org).");
  // The waiting ask still points at its words, the marked change keeps its mark and Undo, the voice mark its text.
  assert.equal(D.contentOf(p).slice(waiting.start, waiting.end), "the prompter");
  assert.deepEqual(D.reanchor(waiting, D.contentOf(p)), { start: waiting.start, end: waiting.end });
  C.follow(asks, before, C.blocksOf(doc));
  assert.ok(C.isMarked(marked));
  assert.equal(D.contentOf(p).slice(marked.start, marked.end), "again");
  assert.equal(D.contentOf(doc.blocks[4]).slice(2, 6), "line");
  assert.deepEqual(res.skipped.map((s) => s.quote), ["the prompter", "again", "Then", "A line"]);
});

test("links on a selection stay out of other open work in its block", () => {
  const doc = LINKS_SCRIPT(), p = doc.blocks[2];
  const ask = linksAsk(doc, p.id, "We use Claude and the prompter.", [{ quote: "Claude", url: "https://claude.ai" }, { quote: "the prompter", url: "https://prompter.techies.tools" }]);
  const voice = Object.assign(D.makeAsk(doc, { scope: "script", action: "voice", by: ask.by }), { status: "answered", answer: { kind: "marks", marks: [{ quote: "prompter", blockId: p.id, start: 22, end: 30, state: "open" }] } });
  const res = C.land(doc, ask, 3, { asks: [ask, voice] });
  assert.equal(D.contentOf(p), "We use [Claude](https://claude.ai) and the prompter. Then Claude again.");
  assert.deepEqual(res.skipped, [{ quote: "the prompter", why: "under an open ask or change" }]);
  // With nothing else but the open work, nothing goes in and the ask is not touched.
  const doc2 = LINKS_SCRIPT(), p2 = doc2.blocks[2];
  const only = linksAsk(doc2, p2.id, "the prompter", [{ quote: "the prompter", url: "https://prompter.techies.tools" }]);
  const voice2 = { ...voice, answer: { kind: "marks", marks: [{ quote: "prompter", blockId: p2.id, start: 22, end: 30, state: "open" }] } };
  assert.equal(C.land(doc2, only, 3, { asks: [only, voice2] }), null);
  assert.equal(only.status, "answered");
});

test("a quote copied from the spoken text lands across a soft line break or a double space", () => {
  const doc = D.parse("## 1 · Hook\n\nWe use Claude\nCode daily with  the  prompter.\n");
  const spoken = D.exportCamera(doc);
  assert.match(spoken, /We use Claude Code daily with the prompter\./, "the agent reads one space");
  const ask = Object.assign(D.makeAsk(doc, { scope: "script", action: "links", by: { id: "lex", name: "Lex" } }), { status: "taken" });
  const answer = { kind: "links", links: [{ quote: "Claude Code", url: "https://claude.ai/code" }, { quote: "the prompter", url: "https://prompter.techies.tools" }, { quote: "Claude  Code", url: "https://x.com" }] };
  const plan = C.planFor(doc, ask, answer);
  assert.equal(plan.segments.length, 1);
  assert.deepEqual(plan.skipped, [{ quote: "Claude  Code", why: "already linked in this answer" }]);
  const old = D.contentOf(doc.blocks[1]);
  const res = C.landScript(doc, { ...ask, answer }, 1);
  // The link's words get one space (the spaces around them stay); Undo gives back the line break and the spaces.
  assert.equal(D.contentOf(doc.blocks[1]), "We use [Claude Code](https://claude.ai/code) daily with  [the prompter](https://prompter.techies.tools).");
  assert.equal(res.parts[0].ask.change.removed, "Claude\nCode daily with  the  prompter");
  C.undo(doc, res.parts[0].ask);
  assert.equal(D.contentOf(doc.blocks[1]), old);
  // Still whole words only, and a run of spaces does not reach over a link line.
  const lines = L.planLinks([{ id: "b", content: "Docs\n- Docs: https://d.com\nend", from: 0, to: 31 }], [{ quote: "Docs end", url: "https://x.com" }]);
  assert.equal(lines.segments.length, 0);
});

test("closed links: a caret on a link's edge goes just outside it; hidden offsets show at the words", () => {
  const content = "Try [Claude](https://claude.ai) now.";
  const [link] = L.textLinks(content);
  assert.deepEqual([link.start, link.end, link.words.start, link.words.end], [4, 31, 5, 11]);
  assert.equal(L.edgeSnap(link, link.start + 1), link.start, "the words' start goes before the link");
  assert.equal(L.edgeSnap(link, link.start + 1 + "Claude".length), link.end, "the words' end goes after the link");
  for (const o of [0, 4, 7, 31, 33]) assert.equal(L.edgeSnap(link, o), o);
  // Inside "](https://claude.ai)" an offset shows at the end of the words; inside "[" at their start.
  for (let o = link.words.end + 1; o < link.end; o++) assert.equal(L.shownOffset([link], o), link.words.end);
  assert.equal(L.shownOffset([link], link.words.end), link.words.end);
  assert.equal(L.shownOffset([link], link.start), link.start);
  assert.equal(L.shownOffset([link], link.end), link.end);
  assert.equal(L.shownOffset([link], 8), 8, "inside the words stays");
  assert.equal(L.shownOffset([], 20), 20);
});

test("closed links: a deletion that took a link's hidden Markdown gets it back; a link whose words all went goes whole", () => {
  const old = "Try [Claude](https://claude.ai)Y now.";
  const closed = L.textLinks(old);
  // Chromium and WebKit: Backspace on the "Y" also takes "](https://claude.ai)"; the caret is left at the words' end.
  assert.deepEqual(L.keepHidden(old, "Try [Claude now.", closed, 11), { content: "Try [Claude](https://claude.ai) now.", caret: 31 });
  // The same read without a caret (by the text alone).
  assert.deepEqual(L.keepHidden(old, "Try [Claude now.", closed, null), { content: "Try [Claude](https://claude.ai) now.", caret: 31 });
  // A head "[" taken with the letter before the link.
  const head = "XA[Claude](https://claude.ai) now.";
  assert.deepEqual(L.keepHidden(head, "XClaude](https://claude.ai) now.", L.textLinks(head), 1), { content: "X[Claude](https://claude.ai) now.", caret: 1 });
  // A word deletion that took all of the words and the tail: the whole link goes, as it was seen.
  const word = "Try [Claude](https://claude.ai) now.";
  assert.deepEqual(L.keepHidden(word, "Try [now.", L.textLinks(word), 5), { content: "Try now.", caret: 4 });
  // Edits that lose no hidden Markdown are left alone: a letter of the words, a whole link, text elsewhere, typing.
  assert.equal(L.keepHidden(word, "Try [Claud](https://claude.ai) now.", L.textLinks(word), 10), null);
  assert.equal(L.keepHidden(word, "Try  now.", L.textLinks(word), 4), null);
  assert.equal(L.keepHidden(word, "Try [Claude](https://claude.ai) no.", L.textLinks(word), 34), null);
  assert.equal(L.keepHidden(word, word + "!", L.textLinks(word), 37), null);
  assert.equal(L.keepHidden(word, "Try now.", [], 4), null, "no closed links: nothing to keep");
});

test("B-roll: a link placed across a soft line break asks for no check", async () => {
  const B = await import("../public/broll.js");
  const doc = D.parse("# T\n\n## 1 · Hook\n\nWe use Claude\nCode every day.\n");
  const shots = [{ id: "B1", over: '"We use Claude Code every day."', what: "x", how: "", kind: "broll" }];
  B.matchShots(doc, shots);
  assert.equal(shots[0].blockIds.length, 1);
  const by = { id: "lex", name: "Lex" };
  const ask = Object.assign(D.makeAsk(doc, { scope: "script", action: "links", by }), { status: "taken", answer: { kind: "links", links: [{ quote: "Claude Code", url: "https://claude.com/claude-code" }] } });
  assert.ok(C.landScript(doc, ask, 1));
  assert.match(D.contentOf(doc.blocks.find((b) => b.type === "para")), /\[Claude Code\]\(https:\/\/claude\.com\/claude-code\)/);
  assert.deepEqual(B.touchShots(doc, shots), []);
});

test("a B-roll suggestion is not open work for links, waiting or answered", () => {
  const doc = LINKS_SCRIPT(), p = doc.blocks[2];
  const by = { id: "guest", name: "Ana" };
  const s = D.contentOf(p).indexOf("the prompter");
  const broll = D.makeAsk(doc, { blockId: p.id, start: s, end: s + 12, action: "broll", by });
  const ask = Object.assign(D.makeAsk(doc, { scope: "script", action: "links", by: { id: "lex", name: "Lex" } }), { status: "taken" });
  const answer = { kind: "links", links: [{ quote: "the prompter", url: "https://prompter.techies.tools" }] };
  for (const status of ["waiting", "answered"]) {
    Object.assign(broll, { status }, status === "answered" ? { answer: { kind: "broll", changes: [] } } : {});
    assert.deepEqual(C.planFor(doc, ask, answer, { asks: [broll] }).skipped, [], status);
  }
});
