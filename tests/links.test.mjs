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
    { quote: "Claude", why: "already linked" },
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
