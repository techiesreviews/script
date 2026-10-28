import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIONS, parse, serialize, contentOf, setContent, splitBlock, mergeWithPrevious, removeBlock, insertBlock,
  outline, parseHeading, exportCamera, exportPrompter, sentences, stats, countWords, snapToWords, reanchor,
  makeAsk, findQuote, cleanAnswer, applyAnswer, cloneDoc, titleOf, moveAsks, locate, checkAnswer,
  prompterLink, PROMPTER_SITE, PROMPTER_MAX_CHARS,
  PARTS, matchParts, slashCommand, shiftHeadings, numberAt, insertPart,
  slashAllowed, cutCommand, withoutCommand, lineToReplace,
} from "../public/doc.js";

const read = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
// The demo script the start screen offers ("Try a demo script"): made up, so it can be public.
const SCRIPT = readFileSync(new URL("../public/samples/demo-good-script.md", import.meta.url), "utf8");
const PROMPTER_EXAMPLE = read("prompter-example.md");

/* The prompter's own parse(), copied from the original prompter page (kept outside this repo; regexes unchanged). */
const timeRe = /^(.*?)\s*·\s*(\d{1,2}:\d{2})\s*$/;
const linkRe = /^-\s*(?:(.+?):\s+)?(https?:\/\/\S+)\s*$/;
function prompterParse(md) {
  const body = md.replace(/\r/g, "").split("<!--SCRIPT-START-->").pop().split("<!--SCRIPT-END-->")[0];
  const out = [];
  let cur = null;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const heading = line.match(/^#{2,3}\s+(.*)$/);
    if (heading) {
      const title = heading[1].replace(/\*\*/g, "").trim();
      const t = title.match(timeRe);
      cur = { title: t ? t[1] : title, time: t ? t[2] : "", items: [], links: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (!line) { if (cur.items.length && cur.items.at(-1).type !== "gap") cur.items.push({ type: "gap" }); continue; }
    if (line === "---" || /^(OPEN|Links to open):?$/i.test(line)) continue;
    const link = line.match(linkRe);
    if (link) { cur.links.push({ label: link[1] || new URL(link[2]).hostname, url: link[2] }); continue; }
    if (/^QL:/i.test(line)) cur.items.push({ type: "ql", text: line.replace(/^QL:\s*/i, "") });
    else if (/^\[.*\]$/.test(line)) cur.items.push({ type: "note", text: line.slice(1, -1) });
    else if (/^(Next week|Next):/i.test(line)) cur.items.push({ type: "next", text: line });
    else if (/^Now:/i.test(line)) cur.items.push({ type: "now", text: line });
    else if (/^[-*]\s+/.test(line)) cur.items.push({ type: "bullet", text: line.replace(/^[-*]\s+/, "") });
    else cur.items.push({ type: "say", text: line });
  }
  return out;
}

const roundTrip = (md) => assert.equal(serialize(parse(md)), md);
const types = (md) => parse(md).blocks.map((b) => b.type);

/* ---------- Round trip ---------- */
test("round-trips both fixtures exactly", () => {
  roundTrip(SCRIPT);
  roundTrip(PROMPTER_EXAMPLE);
});

test("round-trips edge cases exactly", () => {
  const cases = [
    "",
    "\n",
    "\n\n\n",
    "   ",
    "one line, no newline",
    "# Title\n\nPara one.\n\nPara two.",
    "# Title\n\nPara one.\n",
    "# Title\r\n\r\nPara one.\r\nSoft break.\r\n\r\n## 1 · Hook (0:00–0:40)\r\n\r\nText.\r\n",
    "A\n\n\nB\n\n\n\nC\n",
    "A\n  \n\t\nB\n",
    "## 1 · Hook (0:00–0:40)\nText right under the heading.\n\nNext para.\n",
    "# Title\nSubtitle line\n- a list\n",
    "## A\n## B\ntext",
    "\n\n# Leading blank lines\n\nText\n\n\n",
    "Para\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter\n",
    "Trailing spaces  \nhard break\n\n[ON SCREEN: x]   \n\n",
    "Mixed\r\nendings\n\nhere\r\n\r\nend",
    "| a | b |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n---\n\n1. one\n2. two\n",
    "   indented first line\n\nnext",
  ];
  for (const md of cases) roundTrip(md);
});

test("3 blank lines are kept in the separator", () => {
  const doc = parse("A\n\n\n\nB");
  assert.equal(doc.blocks.length, 2);
  assert.equal(doc.blocks[1].sep, "\n\n\n\n");
  assert.equal(doc.blocks[0].sep, "");
});

test("no trailing newline: tail is empty; trailing whitespace goes to tail", () => {
  assert.equal(parse("A\n\nB").tail, "");
  assert.equal(parse("A\n\nB\n\n").tail, "\n\n");
});

test("CRLF: separators keep \\r\\n and content shows \\n", () => {
  const md = "# T\r\n\r\nline one\r\nline two\r\n";
  const doc = parse(md);
  assert.equal(doc.eol, "\r\n");
  assert.equal(doc.blocks[1].sep, "\r\n\r\n");
  assert.equal(contentOf(doc.blocks[1]), "line one\nline two");
  setContent(doc, doc.blocks[1].id, "line one\nline 2");
  assert.equal(serialize(doc), "# T\r\n\r\nline one\r\nline 2\r\n");
});

test("a heading directly followed by text splits into heading + rest with sep \\n", () => {
  const doc = parse("## 1 · Hook (0:00–0:40)\nText right under.\n");
  assert.deepEqual(doc.blocks.map((b) => [b.type, b.sep, b.text]), [
    ["heading", "", "## 1 · Hook (0:00–0:40)"],
    ["para", "\n", "Text right under."],
  ]);
  const crlf = parse("## H\r\nText");
  assert.equal(crlf.blocks[1].sep, "\r\n");
});

test("a code fence with blank lines inside stays one raw block", () => {
  const doc = parse("```\na\n\nb\n```\n\nafter");
  assert.equal(doc.blocks.length, 2);
  assert.equal(doc.blocks[0].type, "raw");
  assert.equal(doc.blocks[0].text, "```\na\n\nb\n```");
});

/* ---------- Types ---------- */
test("block types", () => {
  assert.deepEqual(types("# T\n\n## H\n\n[ON SCREEN: x]\n\n[SILENT: y]\n\n- a\n\n* b\n\n1. c\n\n| t |\n\n---\n\n> q\n\n```\nx\n```\n\nPlain words.\n\n### Sub\n\n# Second title"),
    ["title", "heading", "note", "note", "raw", "raw", "raw", "raw", "raw", "raw", "raw", "para", "raw", "raw"]);
});

test("demo script: title, front matter, 7 numbered spoken sections and 2 others", () => {
  const doc = parse(SCRIPT);
  assert.equal(doc.blocks[0].type, "title");
  assert.equal(titleOf(doc), "DEMO · How to Write a Good Video Script");
  const { front, sections } = outline(doc);
  assert.ok(front.length >= 3);
  assert.equal(sections.length, 9);
  assert.equal(sections.filter((s) => s.spoken).length, 7);
  assert.deepEqual(sections.slice(7).map((s) => s.info.name), ["Before recording", "Notes for the editor"]);
  assert.equal(sections.every((s, i) => s.spoken === i < 7), true);
});

test("prompter fixture: the prompter's parse reads sections, times, links, QL and notes", () => {
  const sections = prompterParse(PROMPTER_EXAMPLE);
  assert.deepEqual(sections.map((s) => [s.title, s.time]), [
    ["PREP", ""], ["INTRO", "00:00"], ["1 · WHAT TO BACK UP", "02:00"], ["2 · WHERE IT GOES WRONG", "09:00"], ["3 · TEST RESTORE", "16:00"],
  ]);
  assert.deepEqual(sections[2].links, [{ label: "Demo site", url: "https://example.com/demo" }, { label: "Checklist", url: "https://example.org/backup-checklist" }]);
  assert.deepEqual(sections[4].links, [{ label: "staging.example.net", url: "https://staging.example.net" }]);
  const kinds = (s) => s.items.filter((i) => i.type !== "gap").map((i) => i.type);
  assert.deepEqual(kinds(sections[2]), ["next", "now", "bullet", "bullet", "bullet", "ql", "note", "note"]);
  assert.deepEqual(kinds(sections[4]), ["next", "now", "bullet", "bullet", "bullet", "note", "note"]);
});

test("when no heading is numbered, all sections are spoken", () => {
  const doc = parse("# T\n\n## Intro\n\nHello there.\n\n## Outro\n\nBye now.\n");
  assert.equal(outline(doc).sections.every((s) => s.spoken), true);
  assert.equal(exportCamera(doc), "Hello there.\n\nBye now.\n");
});

test("parseHeading reads number, name and times", () => {
  assert.deepEqual(parseHeading("1 · Hook (0:00–0:40)"), { num: "1", name: "Hook", start: "0:00", end: "0:40" });
  assert.deepEqual(parseHeading("Before recording"), { num: "", name: "Before recording", start: "", end: "" });
  assert.deepEqual(parseHeading("12. Close (10:05)"), { num: "12", name: "Close", start: "10:05", end: "" });
});

/* ---------- Editing ---------- */
test("block ids are short, unique and stable across edits", () => {
  const doc = parse(SCRIPT);
  const ids = doc.blocks.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[a-z][a-z0-9]{7}$/.test(id)));
  const para = doc.blocks.find((b) => b.type === "para");
  setContent(doc, para.id, contentOf(para) + " More.");
  assert.deepEqual(doc.blocks.map((b) => b.id), ids);
});

test("split and merge keep every character", () => {
  const md = "# T\n\nFirst part. Second part.\n";
  const doc = parse(md);
  const p = doc.blocks[1];
  const next = splitBlock(doc, p.id, "First part.".length);
  assert.equal(next.sep, "\n\n");
  assert.equal(contentOf(p), "First part.");
  assert.equal(contentOf(next), " Second part.");
  assert.equal(serialize(doc), "# T\n\nFirst part.\n\n Second part.\n");
  const m = mergeWithPrevious(doc, next.id);
  assert.deepEqual(m, { into: p.id, offset: "First part.".length });
  assert.equal(serialize(doc), md);
});

test("split a note turns the halves into paras; merging brings the note back", () => {
  const doc = parse("[ON SCREEN: a b]");
  const n = doc.blocks[0];
  const next = splitBlock(doc, n.id, 12);
  assert.equal(n.type, "para");
  assert.equal(next.type, "para");
  mergeWithPrevious(doc, next.id);
  assert.equal(n.type, "note");
  assert.equal(serialize(doc), "[ON SCREEN: a b]");
});

test("merge only into a para or note", () => {
  const doc = parse("## H\n\nText");
  assert.equal(mergeWithPrevious(doc, doc.blocks[1].id), null);
});

test("Enter at the end of a heading adds an empty para after it", () => {
  const doc = parse("## 1 · Hook\n\nText");
  const h = doc.blocks[0];
  const next = splitBlock(doc, h.id, contentOf(h).length);
  assert.equal(h.type, "heading");
  assert.equal(next.type, "para");
  assert.equal(contentOf(next), "");
  assert.equal(doc.blocks[1].id, next.id);
});

test("typing '## ' at the start of a para makes it a heading", () => {
  const doc = parse("# T\n\nIntro");
  const p = doc.blocks[1];
  const r = setContent(doc, p.id, "## 1 · Intro");
  assert.equal(r.changed, true);
  assert.equal(p.type, "heading");
  assert.equal(contentOf(p), "1 · Intro");
  assert.equal(serialize(doc), "# T\n\n## 1 · Intro");
  const doc2 = parse("Line one\nline two");
  setContent(doc2, doc2.blocks[0].id, "## Line one\nline two");
  assert.deepEqual(doc2.blocks.map((b) => b.type), ["heading", "para"]);
  assert.equal(serialize(doc2), "## Line one\nline two");
});

test("brackets make a para a note and back", () => {
  const doc = parse("text");
  setContent(doc, doc.blocks[0].id, "[SILENT: text]");
  assert.equal(doc.blocks[0].type, "note");
  setContent(doc, doc.blocks[0].id, "[SILENT: text");
  assert.equal(doc.blocks[0].type, "para");
});

test("removing the first block keeps the file's leading separator", () => {
  const doc = parse("\n\nA\n\nB\n");
  removeBlock(doc, doc.blocks[0].id);
  assert.equal(serialize(doc), "\n\nB\n");
});

test("insertBlock uses a blank-line separator in the file's line ending", () => {
  const doc = parse("A\r\n\r\nB\r\n");
  insertBlock(doc, doc.blocks[0].id, "para", "New\nline");
  assert.equal(serialize(doc), "A\r\n\r\nNew\r\nline\r\n\r\nB\r\n");
});

test("cloneDoc copies blocks", () => {
  const doc = parse(SCRIPT);
  const copy = cloneDoc(doc);
  copy.blocks[0].text = "# Changed";
  assert.notEqual(doc.blocks[0].text, "# Changed");
  assert.equal(serialize(cloneDoc(doc)), SCRIPT);
});

/* ---------- Exports ---------- */
test("camera script: spoken paras only, joined by one blank line, ending with a newline", () => {
  const doc = parse(SCRIPT);
  const cam = exportCamera(doc);
  assert.ok(cam.startsWith("A blank page. A deadline."));
  assert.ok(cam.endsWith("Thanks for watching, and see you in the next one.\n"));
  assert.ok(!/\[|^#|^- /m.test(cam), "no notes, headings or lists");
  assert.ok(!cam.includes("fresh staging copy") && !cam.includes("Music low"), "no unspoken sections");
  assert.ok(!cam.includes("Episode question"), "no front matter");
  assert.ok(!cam.includes("\n\n\n"));
  assert.equal(cam.split("\n\n").length, 19);
});

test("camera script collapses soft line breaks", () => {
  const doc = parse("## 1 · A\n\nOne line\nand the next.\n");
  assert.equal(exportCamera(doc), "One line and the next.\n");
});

test("sentences: one per line, nothing lost", () => {
  const s = 'A plugin update. A white screen. And a client asking: "Where did the shop go?" All before lunch. 99.9% said yes. WordPress.org posts it.';
  assert.deepEqual(sentences(s), [
    "A plugin update.", "A white screen.", 'And a client asking: "Where did the shop go?"', "All before lunch.", "99.9% said yes.", "WordPress.org posts it.",
  ]);
});

test("prompter export reads back in the prompter: 7 sections, titles, times, no line lost", () => {
  const doc = parse(SCRIPT);
  const md = exportPrompter(doc);
  assert.ok(md.startsWith("# DEMO · How to Write a Good Video Script\n\n---\n\n### **1 · HOOK · 0:00**\n\n"));
  assert.ok(md.endsWith("\n") && !md.endsWith("\n\n"));
  const sections = prompterParse(md);
  assert.equal(sections.length, 7);
  assert.deepEqual(sections.map((s) => s.title), [
    "1 · HOOK", "2 · START WITH THE PROBLEM", "3 · WRITE FOR THE EAR", "4 · SOUND LIKE YOU, NOT LIKE AI",
    "5 · READ IT OUT LOUD", "6 · MAKE IT A HABIT", "7 · RECAP AND CLOSE",
  ]);
  assert.deepEqual(sections.map((s) => s.time), ["0:00", "0:20", "0:45", "1:10", "1:40", "2:05", "2:20"]);

  // Every content line of the export is an item in the prompter.
  const body = md.split("\n").slice(1).filter((l) => l.trim() && l !== "---" && !l.startsWith("### "));
  const items = sections.flatMap((s) => s.items.filter((i) => i.type !== "gap"));
  assert.equal(items.length, body.length);
  assert.equal(sections.reduce((n, s) => n + s.links.length, 0), 0);

  // Every spoken para and note of the script is in the export, word for word.
  const spoken = outline(doc).sections.filter((s) => s.spoken).flatMap((s) => s.blocks);
  const paras = spoken.filter((b) => b.type === "para");
  const notes = spoken.filter((b) => b.type === "note");
  const exportedParas = md.split(/\n\n/).filter((c) => !/^(#|---|\[)/.test(c.trim()));
  assert.equal(exportedParas.length, paras.length);
  paras.forEach((p, i) => assert.equal(exportedParas[i].trim().replace(/\n/g, " "), contentOf(p).replace(/\s+/g, " ").trim()));
  // A note block with several bracketed lines (two [SILENT: …] lines in section 4) keeps one prompter line each.
  const noteLineCount = notes.reduce((n, b) => n + contentOf(b).split("\n").filter((l) => l.trim()).length, 0);
  assert.ok(noteLineCount > notes.length);
  assert.equal(items.filter((i) => i.type === "note").length, noteLineCount);
  assert.equal(items.filter((i) => i.type === "say").length, paras.reduce((n, p) => n + sentences(contentOf(p)).length, 0));
});

test("prompter leaves out the time when the heading has none", () => {
  const md = exportPrompter(parse("# T\n\n## Intro\n\nHi. Bye.\n"));
  assert.equal(md, "# T\n\n---\n\n### **INTRO**\n\nHi.\nBye.\n");
  assert.deepEqual(prompterParse(md).map((s) => [s.title, s.time]), [["INTRO", ""]]);
});

async function readPrompterLink(link) {
  const data = new URL(link).hash.replace(/^#s=/, "");
  assert.match(data, /^[A-Za-z0-9_-]+$/);
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((data.length + 3) % 4);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

test("prompter link: deflate-raw + base64url in #s=, default preset, round-trips the export", async () => {
  const md = exportPrompter(parse(SCRIPT));
  const link = await prompterLink(md);
  assert.ok(link.startsWith(`${PROMPTER_SITE}/#s=`));
  assert.ok(!link.includes("&p="));
  assert.ok(link.length < md.length);
  assert.equal(await readPrompterLink(link), md);
  // Non-Latin text and emoji survive; a trailing slash on the origin is not doubled.
  const odd = "# Tést 🎬\n\n---\n\n### **1 · ÜBER · 0:00**\n\nПривет. 你好.\n";
  const local = await prompterLink(odd, "http://localhost:8787/");
  assert.ok(local.startsWith("http://localhost:8787/#s="));
  assert.equal(await readPrompterLink(local), odd);
});

test("prompter link: refuses a script longer than the prompter accepts", async () => {
  assert.equal(PROMPTER_MAX_CHARS, 100_000);
  assert.equal(await prompterLink("a".repeat(PROMPTER_MAX_CHARS + 1)), null);
  assert.equal(await readPrompterLink(await prompterLink("a".repeat(PROMPTER_MAX_CHARS))), "a".repeat(PROMPTER_MAX_CHARS));
});

test("word count and spoken length at 160 words a minute", () => {
  assert.equal(countWords("Hi, I'm Sam — 99.9% said yes."), 6);
  const doc = parse(SCRIPT);
  const s = stats(doc);
  assert.ok(s.words > 380 && s.words < 440, String(s.words));
  assert.equal(s.seconds, Math.round((s.words / 160) * 60));
  assert.match(s.spoken, /^2:\d\d$/);
});

/* ---------- Asks ---------- */
test("snapToWords: half words snap to whole words, outer spaces drop", () => {
  const c = "Say the same in fewer words.";
  assert.deepEqual(snapToWords(c, 5, 10), { start: 4, end: 12 });
  assert.equal(c.slice(...Object.values(snapToWords(c, 3, 9))), "the same");
});

test("reanchor follows edits to the nearest copy of the quote, or drops the ask", () => {
  const ask = { start: 10, end: 13, quote: "fix" };
  assert.deepEqual(reanchor(ask, "A fix and fix and fix."), { start: 10, end: 13 });
  assert.deepEqual(reanchor(ask, "XX A fix and fix and fix."), { start: 13, end: 16 });
  assert.deepEqual(reanchor({ start: 20, quote: "fix" }, "A fix and fix and fix."), { start: 18, end: 21 });
  assert.equal(reanchor(ask, "A repair."), null);
});

test("makeAsk fills the data shape", () => {
  const doc = parse(SCRIPT);
  const b = doc.blocks.find((x) => contentOf(x).startsWith("Most of us"));
  const ask = makeAsk(doc, { blockId: b.id, start: 0, end: 10, action: "simpler", by: { id: "me", name: "Lex" } });
  assert.equal(ask.scope, "selection");
  assert.equal(ask.quote, "Most of us");
  assert.equal(ask.context, contentOf(b));
  assert.equal(ask.section, "1 · Hook (0:00–0:20)");
  assert.equal(ask.instruction, ACTIONS.simpler.instruction);
  assert.equal(ask.status, "waiting");
  assert.ok(ask.id && ask.createdAt);
  const typed = makeAsk(doc, { blockId: b.id, start: 0, end: 4, action: "ask", instruction: "Make it a question", by: { id: "me", name: "Lex" } });
  assert.equal(typed.instruction, "Make it a question");
  const voice = makeAsk(doc, { scope: "script", action: "voice", by: { id: "me", name: "Lex" } });
  assert.equal(voice.blockId, undefined);
  assert.equal(voice.instruction, ACTIONS.voice.instruction);
});

test("cleanAnswer accepts the four kinds and caps the message", () => {
  const sel = { scope: "selection" }, script = { scope: "script" };
  assert.deepEqual(cleanAnswer(sel, { kind: "replace", text: "New" }), { kind: "replace", text: "New" });
  assert.equal(cleanAnswer(sel, { kind: "note", text: "x", tone: "look", message: "m".repeat(300) }).message.length, 200);
  assert.equal(cleanAnswer(sel, { kind: "note", text: "x", tone: "odd" }).tone, "ok");
  assert.equal(cleanAnswer(sel, { kind: "marks", marks: [] }), null);
  assert.equal(cleanAnswer(script, { kind: "replace", text: "x" }), null);
  assert.equal(cleanAnswer(script, { kind: "marks", marks: [{ quote: "a", why: "b", rewrite: "c" }, { quote: "" }] }).marks.length, 1);
  assert.equal(cleanAnswer(sel, { kind: "replace", text: "  " }), null);
});

test("applyAnswer: replace swaps the quote; add goes after it with one space", () => {
  const content = "Because a fix also shows attackers where the hole is. Next.";
  const q = "Because a fix also shows attackers where the hole is.";
  const rep = applyAnswer(content, { start: 0, end: q.length, answer: { kind: "replace", text: "A fix points at the hole." } });
  assert.equal(rep.content, "A fix points at the hole. Next.");
  const add = applyAnswer(content, { start: 0, end: q.length, answer: { kind: "add", text: "They compare the code." } });
  assert.equal(add.content, "Because a fix also shows attackers where the hole is. They compare the code. Next.");
  assert.equal(add.content.slice(add.start, add.end), "They compare the code.");
});

test("findQuote looks in spoken paras first", () => {
  const doc = parse(SCRIPT);
  const hit = findQuote(doc, "So that's the first rule.");
  assert.ok(hit);
  const b = doc.blocks.find((x) => x.id === hit.blockId);
  assert.equal(contentOf(b).slice(hit.start, hit.end), "So that's the first rule.");
  assert.equal(findQuote(doc, "not in the script at all"), null);
});

/* ---------- Review fixes from step A ---------- */
test("after setContent, block types match a save and reopen, and exports do not change", () => {
  for (const typed of ["- item", "> q", "| a |", "# x", "---", "```\ncode\n```", "[ON SCREEN: x]", "## 2 · Next (1:00)", "plain words"]) {
    const doc = parse("# Title\n\n## 1 · Hook (0:00)\n\nFirst para.\n\nSecond para.\n");
    setContent(doc, doc.blocks[2].id, typed);
    const again = parse(serialize(doc));
    assert.deepEqual(doc.blocks.map((b) => b.type), again.blocks.map((b) => b.type), typed);
    assert.equal(exportCamera(doc), exportCamera(again), typed);
    assert.equal(exportPrompter(doc), exportPrompter(again), typed);
  }
});

test("'# x' typed in a para becomes the title only when there is no title before it", () => {
  const doc = parse("Intro words\n\n# Real title\n");
  setContent(doc, doc.blocks[0].id, "# New first");
  assert.deepEqual(doc.blocks.map((b) => b.type), ["title", "raw"]);
  assert.deepEqual(parse(serialize(doc)).blocks.map((b) => b.type), ["title", "raw"]);
});

test("a blank line typed or pasted inside a para splits it into blocks; locate follows the caret", () => {
  const doc = parse("# T\n\nOne");
  const p = doc.blocks[1];
  const content = "One\n\nTwo\n\n## 2 · Three\nfour";
  const r = setContent(doc, p.id, content);
  assert.deepEqual(doc.blocks.map((b) => [b.type, contentOf(b)]), [["title", "T"], ["para", "One"], ["para", "Two"], ["heading", "2 · Three"], ["para", "four"]]);
  assert.equal(r.created.length, 3);
  assert.equal(serialize(doc), "# T\n\n" + content);
  assert.deepEqual(locate(r, content.indexOf("Two") + 2), { id: doc.blocks[2].id, offset: 2 });
  assert.deepEqual(locate(r, content.indexOf("Three")), { id: doc.blocks[3].id, offset: 4 });
  assert.deepEqual(locate(r, content.length), { id: doc.blocks[4].id, offset: 4 });
  assert.deepEqual(parse(serialize(doc)).blocks.map((b) => b.type), doc.blocks.map((b) => b.type));
});

test("trailing spaces stay in the block while typing", () => {
  const doc = parse("Hello");
  setContent(doc, doc.blocks[0].id, "Hello ");
  assert.equal(contentOf(doc.blocks[0]), "Hello ");
  assert.equal(serialize(doc), "Hello ");
});

test("no numbered headings and no headings: the prompter gets one SCRIPT section it can read", () => {
  const md = exportPrompter(parse("Hello. There.\n"));
  assert.equal(md, "# Script\n\n---\n\n### **SCRIPT**\n\nHello.\nThere.\n");
  const sections = prompterParse(md);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, "SCRIPT");
  assert.deepEqual(sections[0].items.filter((i) => i.type === "say").map((i) => i.text), ["Hello.", "There."]);
});

test("CRLF: '## ' typed on a multi-line para splits with \\r\\n", () => {
  const doc = parse("Line\r\nmore");
  setContent(doc, doc.blocks[0].id, "## Line\nmore");
  assert.equal(serialize(doc), "## Line\r\nmore");
  assert.deepEqual(doc.blocks.map((b) => b.type), ["heading", "para"]);
});

test("insertBlock at the start keeps the file's leading separator", () => {
  const doc = parse("\n\nA");
  insertBlock(doc, null, "para", "x");
  assert.equal(serialize(doc), "\n\nx\n\nA");
});

test("applyAnswer add: quote at the very end, and text that already starts with a space", () => {
  const c = "Say it.";
  const end = applyAnswer(c, { start: 0, end: c.length, answer: { kind: "add", text: "Then more." } });
  assert.equal(end.content, "Say it. Then more.");
  assert.equal(end.content.slice(end.start, end.end), "Then more.");
  const spaced = applyAnswer("A. B.", { start: 0, end: 2, answer: { kind: "add", text: " Extra." } });
  assert.equal(spaced.content, "A. Extra. B.");
  assert.equal(spaced.content.slice(spaced.start, spaced.end), "Extra.");
});

test("moveAsks: anchors after a Keep keep their quote (replace that changes length, and add)", () => {
  for (const answer of [{ kind: "replace", text: "Much longer replacement text" }, { kind: "replace", text: "X" }, { kind: "add", text: "Added words." }]) {
    const content = "First bit. Second bit. Third bit.";
    const kept = { start: 0, end: 10, answer };
    const later = { scope: "selection", blockId: "b", status: "waiting", start: 23, end: 33, quote: "Third bit." };
    const res = applyAnswer(content, kept);
    moveAsks([later], "b", "b", kept.end, res.content.length - content.length);
    assert.equal(res.content.slice(later.start, later.end), "Third bit.", answer.text);
    assert.deepEqual(reanchor(later, res.content), { start: later.start, end: later.end });
  }
});

test("moveAsks: a paste before an anchor shifts it; a split moves it to the new block", () => {
  const asks = [
    { scope: "selection", blockId: "a", status: "waiting", start: 6, end: 11, quote: "world" },
    { scope: "selection", blockId: "a", status: "kept", start: 6, end: 11, quote: "world" },
  ];
  const pasted = "Hello " + "big " + "world";
  moveAsks(asks, "a", "a", 6, 4);
  assert.equal(pasted.slice(asks[0].start, asks[0].end), "world");
  assert.equal(asks[1].start, 6, "closed asks do not move");
  moveAsks(asks, "a", "n", 10, -10);
  assert.deepEqual([asks[0].blockId, asks[0].start], ["n", 0]);
  const marks = [{ scope: "script", status: "answered", answer: { marks: [{ state: "open", blockId: "a", start: 3, end: 5 }] } }];
  moveAsks(marks, "a", "a", 0, 2);
  assert.equal(marks[0].answer.marks[0].start, 5);
});

/* ---------- Tab-side answer checks (answer_ask) ---------- */
test("checkAnswer refuses unknown or finished asks and kinds that do not fit", () => {
  const doc = parse(SCRIPT);
  const b = doc.blocks.find((x) => contentOf(x).startsWith("Most of us"));
  const sel = makeAsk(doc, { blockId: b.id, start: 0, end: 10, action: "simpler", by: { id: "me", name: "Lex" } });
  const script = makeAsk(doc, { scope: "script", action: "voice", by: { id: "me", name: "Lex" } });
  assert.match(checkAnswer(undefined, { kind: "note", text: "x" }, doc).error, /Unknown ask/);
  assert.match(checkAnswer({ ...sel, status: "kept" }, { kind: "note", text: "x" }, doc).error, /finished \(kept\)/);
  assert.match(checkAnswer(sel, { kind: "marks", marks: [] }, doc).error, /only fit/);
  assert.match(checkAnswer(script, { kind: "replace", text: "x" }, doc).error, /marks/);
  assert.match(checkAnswer(sel, { kind: "replace" }, doc).error, /needs text/);
  assert.match(checkAnswer(sel, { kind: "replace", text: "x".repeat(4001) }, doc).error, /4000/);
  assert.match(checkAnswer(sel, { kind: "note", text: "x", message: "m".repeat(201) }, doc).error, /200/);
  assert.match(checkAnswer(sel, { kind: "note", text: "x", tone: "loud" }, doc).error, /tone/);
  assert.deepEqual(checkAnswer({ ...sel, status: "taken" }, { kind: "replace", text: "Most people" }, doc), { answer: { kind: "replace", text: "Most people" } });
});

test("checkAnswer: marks must quote the script word for word, within the limits", () => {
  const doc = parse(SCRIPT);
  const script = makeAsk(doc, { scope: "script", action: "voice", by: { id: "me", name: "Lex" } });
  const good = { quote: "So that's the first rule.", why: "Headline phrase.", rewrite: "So what does that mean for you?" };
  assert.equal(checkAnswer(script, { kind: "marks", marks: [good] }, doc).answer.marks.length, 1);
  assert.match(checkAnswer(script, { kind: "marks", marks: [{ ...good, quote: "Not in the script." }] }, doc).error, /word for word/);
  assert.match(checkAnswer(script, { kind: "marks", marks: Array(21).fill(good) }, doc).error, /At most 20/);
  assert.match(checkAnswer(script, { kind: "marks", marks: [{ ...good, why: "w".repeat(161) }] }, doc).error, /160/);
  assert.match(checkAnswer(script, { kind: "marks", marks: [{ ...good, rewrite: "r".repeat(1001) }] }, doc).error, /1000/);
  assert.match(checkAnswer(script, { kind: "marks", marks: [{ ...good, quote: "q".repeat(501) }] }, doc).error, /500/);
});

test("a CRLF file keeps CRLF when one block is split in two", () => {
  const doc = parse("A\r\n\r\nB");
  setContent(doc, doc.blocks[0].id, "One\n\nTwo");
  assert.equal(serialize(doc), "One\r\n\r\nTwo\r\n\r\nB");
  assert.deepEqual(doc.blocks.map((b) => b.type), parse(serialize(doc)).blocks.map((b) => b.type));
});

/* ---------- Step C5: parts added with "/" ---------- */
const SCRIPT3 = "# Title\n\n## 1 · Hook (0:00–0:20)\n\nHello.\n\n## 2. The problem\n\nIt breaks.\n\n## 3 · Close (2:00–2:20)\n\nBye.\n\n## Notes\n\nNot spoken.\n";
const at = (doc, text) => doc.blocks.find((b) => contentOf(b) === text);

test("renumbering: a part at the start, in the middle and at the end; names, separators and times stay", () => {
  // Start: before the first heading, it takes number 1 and every numbered heading moves up.
  let doc = parse(SCRIPT3);
  insertPart(doc, at(doc, "Title").id, "intro");
  assert.equal(serialize(doc), "# Title\n\n## 1 · Intro\n\n\n\n## 2 · Hook (0:00–0:20)\n\nHello.\n\n## 3. The problem\n\nIt breaks.\n\n## 4 · Close (2:00–2:20)\n\nBye.\n\n## Notes\n\nNot spoken.\n");
  // Middle: after "Hello." it is 2; "2. The problem" becomes "3. The problem" with its own separator kept.
  doc = parse(SCRIPT3);
  const r = insertPart(doc, at(doc, "Hello.").id, "demo");
  assert.equal(serialize(doc), "# Title\n\n## 1 · Hook (0:00–0:20)\n\nHello.\n\n## 2 · Demo\n\n\n\n## 3. The problem\n\nIt breaks.\n\n## 4 · Close (2:00–2:20)\n\nBye.\n\n## Notes\n\nNot spoken.\n");
  assert.equal(doc.blocks.find((b) => b.id === r.caret.id).type, "para");
  assert.equal(r.caret.offset, 0);
  // End: after the last block; the unnumbered "Notes" heading is not touched.
  doc = parse(SCRIPT3);
  insertPart(doc, at(doc, "Not spoken.").id, "recap");
  assert.equal(serialize(doc), SCRIPT3.replace(/\n$/, "") + "\n\n## 4 · Recap\n\n\n");
  // A fresh script (no headings, no spoken text yet): 1.
  doc = parse("# New\n");
  insertPart(doc, at(doc, "New").id, "hook");
  assert.equal(serialize(doc), "# New\n\n## 1 · Hook\n\n\n");
  // Spoken text without a heading above it: the heading goes above that text, unnumbered, so it stays spoken.
  doc = parse("# New\n\nFirst line.\n");
  insertPart(doc, at(doc, "First line.").id, "hook");
  assert.equal(serialize(doc), "# New\n\n## Hook\n\nFirst line.\n\n\n");
  // CRLF stays CRLF, also in the moved headings.
  doc = parse(SCRIPT3.replace(/\n/g, "\r\n"));
  insertPart(doc, at(doc, "Hello.").id, "point");
  assert.equal(serialize(doc), "# Title\r\n\r\n## 1 · Hook (0:00–0:20)\r\n\r\nHello.\r\n\r\n## 2 · Point\r\n\r\n\r\n\r\n## 3. The problem\r\n\r\nIt breaks.\r\n\r\n## 4 · Close (2:00–2:20)\r\n\r\nBye.\r\n\r\n## Notes\r\n\r\nNot spoken.\r\n");
  // shiftHeadings and numberAt on their own; leading spaces after "##" and odd numbers are kept.
  doc = parse("##  7 · Odd (1:00)\n\nx\n\n## 9) Nine\n");
  assert.equal(numberAt(doc, 0), 7);
  assert.equal(numberAt(doc, 2), 8);
  shiftHeadings(doc, 0, 1);
  assert.equal(serialize(doc), "##  8 · Odd (1:00)\n\nx\n\n## 10) Nine\n");
  // After a reload the new heading reads as a numbered spoken section.
  const back = parse(serialize((() => { const d = parse(SCRIPT3); insertPart(d, at(d, "Hello.").id, "call-to-action"); return d; })()));
  assert.deepEqual(outline(back).sections.map((x) => [x.info.num, x.info.name, x.spoken]), [["1", "Hook", true], ["2", "Call to action", true], ["3", "The problem", true], ["4", "Close", true], ["", "Notes", false]]);
});

test("part templates: the exact Markdown each one inserts, and where the caret goes", () => {
  const made = (id) => {
    const doc = parse("# T\n\n## 1 · Start\n\nLine.\n");
    const r = insertPart(doc, at(doc, "Line.").id, id);
    const caret = doc.blocks.find((b) => b.id === r.caret.id);
    return [serialize(doc).slice("# T\n\n## 1 · Start\n\nLine.".length), caret.type, contentOf(caret).slice(0, r.caret.offset)];
  };
  assert.deepEqual(made("hook"), ["\n\n## 2 · Hook\n\n\n", "para", ""]);
  assert.deepEqual(made("call-to-action"), ["\n\n## 2 · Call to action\n\n\n", "para", ""]);
  assert.deepEqual(made("section"), ["\n\n## 2 · \n\n\n", "heading", "2 · "]);
  assert.deepEqual(made("on-screen"), ["\n\n[ON SCREEN: ]\n", "note", "[ON SCREEN: "]);
  assert.deepEqual(made("silent"), ["\n\n[SILENT: ]\n", "note", "[SILENT: "]);
  assert.deepEqual(made("divider"), ["\n\n---\n\n\n", "para", ""]);
  assert.equal(insertPart(parse("x\n"), null, "broll"), null); // B-roll opens the card instead
  assert.deepEqual(PARTS.map((p) => p.name), ["Hook", "Intro", "Problem", "Point", "Demo", "Recap", "Call to action", "Close", "Section", "On screen", "Silent note", "B-roll", "Divider"]);
});

test("the / filter and where / opens a menu", () => {
  const names = (q, o) => matchParts(q, o).map((p) => p.name);
  assert.deepEqual(names("re"), ["Recap"]);
  assert.deepEqual(names("cta"), ["Call to action"]);
  assert.deepEqual(names("b", { spokenLine: true }), ["B-roll"]);
  assert.deepEqual(names("b"), []); // B-roll only on a spoken line
  assert.deepEqual(names("on"), ["On screen"]);
  assert.deepEqual(names("sec"), ["Section"]);
  assert.deepEqual(names("SI"), ["Silent note"]);
  assert.equal(names("").length, 12);
  assert.equal(names("", { spokenLine: true }).length, 13);
  assert.deepEqual(names("xyz"), []);
  // "/" at the start of a line or after a space; never in the middle of a word.
  assert.deepEqual(slashCommand("/re", 3), { start: 0, end: 3, query: "re" });
  assert.deepEqual(slashCommand("Some text /on", 13), { start: 10, end: 13, query: "on" });
  assert.deepEqual(slashCommand("Line one\n/", 10), { start: 9, end: 10, query: "" });
  assert.deepEqual(slashCommand("/hook and more", 5), { start: 0, end: 5, query: "hook" });
  assert.equal(slashCommand("and/or", 6), null);
  assert.equal(slashCommand("https://example.com", 8), null);
  assert.equal(slashCommand("word/", 5), null);
  assert.equal(slashCommand("/re now", 7), null); // a space after the command ends it
});

/* ---------- Step C5 review: spoken text stays spoken, the whole command, raw blocks, saves, replaced lines ---------- */
const spokenOf = (doc) => outline(doc).sections.filter((x) => x.spoken).flatMap((x) => x.blocks.map((b) => contentOf(b)));
const frontOf = (doc) => outline(doc).front.map((b) => contentOf(b));

test("a part never makes spoken text stop being spoken; unnumbered scripts get unnumbered headings", () => {
  for (const [md, where] of [
    ["# T\n\nFirst line.\n", "First line."],
    ["# T\n\nFirst line.\n\nSecond line.\n", "First line."],
    ["# T\n\n## Intro\n\nA.\n\n## Body\n\nB.\n", "A."],
    ["# T\n\n## Intro\n\nA.\n\n## Body\n\nB.\n", "B."],
    ["# T\n\n## 1 · Hook\n\nA.\n\n## Notes\n\nN.\n", "A."],
    ["# T\n\nLead.\n\n## 1 · Hook\n\nA.\n", "Lead."],
    [SCRIPT3, "It breaks."],
  ]) {
    for (const id of PARTS.filter((p) => p.kind !== "broll").map((p) => p.id)) {
      const doc = parse(md);
      const was = spokenOf(doc).filter((t) => t.trim());
      insertPart(doc, at(doc, where).id, id);
      const now = spokenOf(doc);
      for (const t of was) assert.ok(now.includes(t), `${id} after "${where}" in ${JSON.stringify(md)}: "${t}" is no longer spoken`);
      for (const t of was) assert.ok(!frontOf(doc).includes(t), `${id}: "${t}" moved into front`);
    }
  }
  // The script's own style: "## Hook" between unnumbered headings, "## 2 · Hook" between numbered ones.
  const plain = parse("# T\n\n## Intro\n\nA.\n\n## Body\n\nB.\n");
  insertPart(plain, at(plain, "A.").id, "hook");
  assert.equal(serialize(plain), "# T\n\n## Intro\n\nA.\n\n## Hook\n\n\n\n## Body\n\nB.\n");
  const first = parse("# T\n\nFirst line.\n");
  insertPart(first, at(first, "First line.").id, "section");
  assert.deepEqual(outline(first).front.map((b) => b.type), ["title"]);
  // "## 2026 plans" counts as numbered, as parseHeading already reads it, and moves up like the others.
  const year = parse("# T\n\n## 2026 plans\n\nA.\n");
  insertPart(year, at(year, "T").id, "hook");
  assert.equal(serialize(year), "# T\n\n## 2026 · Hook\n\n\n\n## 2027 plans\n\nA.\n");
});

test("the whole command word counts with the caret inside it; no menu in raw blocks or the title", () => {
  assert.deepEqual(slashCommand("/recap", 4), { start: 0, end: 6, query: "recap" });
  assert.deepEqual(slashCommand("Text /on-screen more", 8), { start: 5, end: 15, query: "on-screen" });
  assert.deepEqual(slashCommand("/re", 3), { start: 0, end: 3, query: "re" });
  assert.equal(slashCommand("/recap", 0), null);
  const doc = parse("# T\n\nPara\n\n[ON SCREEN: x]\n\n## 1 · Hook\n\n```\n/p a path\n```\n\n- list /p\n\n| a | /p |\n|---|---|\n");
  assert.deepEqual(doc.blocks.map((b) => [b.type, slashAllowed(b)]), [["title", false], ["para", true], ["note", true], ["heading", true], ["raw", false], ["raw", false], ["raw", false]]);
  assert.equal(slashAllowed(null), false);
});

test("withoutCommand: what a save writes while the menu is open; the document itself is not changed", () => {
  const doc = parse("# T\r\n\r\nSome text /on\r\n\r\n/recap\r\n\r\nMiddle /pro here\r\n");
  const before = serialize(doc);
  const b = (t) => doc.blocks.find((x) => contentOf(x).startsWith(t)).id;
  assert.equal(serialize(withoutCommand(doc, { id: b("Some"), start: 10, end: 13 })), "# T\r\n\r\nSome text\r\n\r\n/recap\r\n\r\nMiddle /pro here\r\n");
  assert.equal(serialize(withoutCommand(doc, { id: b("Middle"), start: 7, end: 11 })), "# T\r\n\r\nSome text /on\r\n\r\n/recap\r\n\r\nMiddle  here\r\n");
  assert.equal(serialize(withoutCommand(doc, { id: b("/recap"), start: 0, end: 6 })), "# T\r\n\r\nSome text /on\r\n\r\n\r\n\r\nMiddle /pro here\r\n");
  assert.equal(serialize(doc), before);
  assert.deepEqual(cutCommand("Some text /on", { start: 10, end: 13 }), { content: "Some text", at: 9 });
  assert.deepEqual(cutCommand("Line\n/on\nnext", { start: 5, end: 8 }), { content: "Line\n\nnext", at: 5 });
  assert.deepEqual(cutCommand("A /x b", { start: 2, end: 4 }), { content: "A  b", at: 2 });
});

test("a line that held only the command is replaced by the part, unless it has an open ask; at the start too", () => {
  let doc = parse("# T\n\n## 1 · Hook\n\nA.\n\nB.\n");
  const a = at(doc, "A.");
  setContent(doc, a.id, "");
  const id = lineToReplace(doc, a.id, []);
  assert.equal(id, a.id);
  insertPart(doc, a.id, "point", { replaceId: id });
  assert.equal(serialize(doc), "# T\n\n## 1 · Hook\n\n## 2 · Point\n\n\n\nB.\n");
  // An open ask on the line keeps it; a line with text, or the only block, is never replaced.
  doc = parse("# T\n\nx\n\nB.\n");
  const x = at(doc, "x");
  setContent(doc, x.id, "");
  assert.equal(lineToReplace(doc, x.id, [{ blockId: x.id, status: "waiting" }]), null);
  assert.equal(lineToReplace(doc, x.id, [{ blockId: x.id, status: "kept" }]), x.id);
  assert.equal(lineToReplace(doc, at(doc, "B.").id, []), null);
  const only = parse("x\n");
  setContent(only, only.blocks[0].id, "");
  assert.equal(lineToReplace(only, only.blocks[0].id, []), null);
  // Block 0: the part goes at the start.
  doc = parse("x\n\n## 1 · Hook\n\nA.\n");
  const first = doc.blocks[0];
  setContent(doc, first.id, "");
  insertPart(doc, first.id, "intro", { replaceId: lineToReplace(doc, first.id, []) });
  assert.equal(serialize(doc), "## 1 · Intro\n\n\n\n## 2 · Hook\n\nA.\n");
});
