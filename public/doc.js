// The script document: parse, serialize, edit, export and ask anchoring.
// Pure module: no DOM, no network. Imported by the app and by the tests.

/* ---------- Actions and their standard instructions ---------- */
export const ACTIONS = {
  like: { name: "Sound like me", instruction: "Rewrite in the speaker's own voice: plain spoken words, short sentences, everyday metaphors. Keep the meaning and facts." },
  simpler: { name: "Simpler", instruction: "Use simpler words and shorter sentences a beginner understands." },
  shorter: { name: "Shorter", instruction: "Say the same in fewer words." },
  explain: { name: "Explain how it works", instruction: "Add one or two plain sentences that explain how this works." },
  facts: { name: "Check facts", instruction: "Check names, numbers and dates against what you know or can look up. Answer with a note." },
  ask: { name: "Ask", instruction: "" },
  voice: { name: "Sounds like me", instruction: "Mark lines in the spoken text that sound generic or AI-like, with a one-line reason and a rewrite in the speaker's voice." },
  broll: { name: "Suggest B-roll", instruction: "Suggest 1–3 B-roll shots for these lines with answer_broll, only where a picture helps the viewer. Each add has a short \"What to show\", a short \"How to make it\" (none for a screen recording) and quote: the exact spoken text it goes over." },
  plan: { name: "Plan B-roll", instruction: "Go through the whole script and suggest B-roll with answer_broll: adds, changes and removals, at most 20 in all, without repeating shots that are already there (get_script returns them). Each add quotes the exact spoken text it goes over." },
  sketch: { name: "Ask for sketches", instruction: "Draw a simple storyboard sketch for each listed B-roll shot: an SVG line drawing with viewBox 0 0 260 140, using only g, path, rect, circle, ellipse, line, polyline, polygon and text, with class s (ink line), l (soft line), o (orange accent) or mv (dashed orange movement). No colours, styles or images. Send each one with sketch_shot." },
};
export const OPEN_STATUSES = ["waiting", "taken", "answered"];
export const WORDS_PER_MINUTE = 160;
export const MESSAGE_MAX = 200;
// Limits for answers from an agent (shared with the Worker's tool schemas).
export const LIMITS = { askId: 40, shotId: 20, text: 4000, message: MESSAGE_MAX, marks: 20, quote: 500, why: 160, rewrite: 1000, instruction: 500, voiceGuide: 20 * 1024 };
export const ANSWER_KINDS = ["replace", "add", "note", "marks"];

/* ---------- Ids ---------- */
const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newId(length = 8) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let id = "";
  for (const b of bytes) id += ID_CHARS[b % ID_CHARS.length];
  return /^[a-z]/.test(id) ? id : "b" + id.slice(1);
}
function freshId(doc) {
  const taken = new Set(doc.blocks.map((b) => b.id));
  let id;
  do id = newId(); while (taken.has(id));
  return id;
}

/* ---------- Parse and serialize ---------- */
// A separator is a line break followed by one or more blank (or whitespace-only) lines.
const SEP_RE = /\r?\n(?:[ \t]*\r?\n)+/g;
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const TITLE_RE = /^#[ \t]/;
const HEADING_RE = /^##[ \t]/;
const RAW_RE = /^[ \t]*(?:[-*+][ \t]|\d+[.)][ \t]|\||>|`{3}|~{3}|#{1,6}[ \t]|<!--|<\/?[a-z])/i;
const RULE_RE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

function lineEnding(md) {
  const crlf = (md.match(/\r\n/g) || []).length;
  const lf = (md.match(/\n/g) || []).length - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

// Classify one block's text. `titleSeen` makes later "# " lines raw, so a document has one title.
export function typeOf(text, titleSeen = false) {
  const single = !/\n/.test(text);
  if (single && TITLE_RE.test(text)) return titleSeen ? "raw" : "title";
  if (single && HEADING_RE.test(text)) return "heading";
  const t = text.trim();
  if (/^\[[\s\S]*\]$/.test(t)) return "note";
  const first = text.split(/\r?\n/, 1)[0];
  if (RAW_RE.test(first) || RULE_RE.test(first)) return "raw";
  return "para";
}

export function parse(markdown) {
  const md = String(markdown ?? "");
  const eol = lineEnding(md);
  const lead = md.match(/^(?:[ \t]*\r?\n)*/)[0];
  const rest = md.slice(lead.length);
  const tail = rest.match(/\s*$/)[0];
  const body = rest.slice(0, rest.length - tail.length);
  if (!body) return { blocks: [], tail: md, eol };

  // Chunks between separators.
  const chunks = [];
  let at = 0, sep = lead;
  for (const m of body.matchAll(SEP_RE)) {
    chunks.push({ sep, text: body.slice(at, m.index) });
    sep = m[0];
    at = m.index + m[0].length;
  }
  chunks.push({ sep, text: body.slice(at) });

  // Keep a code fence with blank lines inside it as one block.
  const merged = [];
  let fence = null;
  for (const c of chunks) {
    if (fence) merged.at(-1).text += c.sep + c.text;
    else merged.push({ ...c });
    for (const line of c.text.split(/\r?\n/)) {
      const f = line.match(FENCE_RE);
      if (!f) continue;
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f.index + f[0].length).trim()) fence = null;
    }
  }

  // A "#"/"##" heading line followed by more lines becomes a heading block plus a rest block.
  const pieces = [];
  for (const c of merged) {
    let { sep: s, text } = c;
    for (;;) {
      const m = /^#{1,2}[ \t]/.test(text) && text.match(/^([^\r\n]*)(\r?\n)([\s\S]+)$/);
      if (!m) break;
      pieces.push({ sep: s, text: m[1] });
      s = m[2];
      text = m[3];
    }
    pieces.push({ sep: s, text });
  }

  const doc = { blocks: [], tail, eol };
  let titleSeen = false;
  for (const p of pieces) {
    const type = typeOf(p.text, titleSeen);
    if (type === "title") titleSeen = true;
    doc.blocks.push({ id: freshId(doc), type, text: p.text, sep: p.sep });
  }
  return doc;
}

export function serialize(doc) {
  let out = "";
  for (const b of doc.blocks) out += b.sep + b.text;
  return out + doc.tail;
}

export function cloneDoc(doc) {
  return { blocks: doc.blocks.map((b) => ({ ...b })), tail: doc.tail, eol: doc.eol };
}

/* ---------- Block content (what the person sees and edits) ---------- */
// Titles and headings hide their "# " / "## " marker. Line breaks are always "\n" in content.
export function prefixOf(block) {
  if (block.type === "title") return block.text.match(/^#[ \t]+/)?.[0] ?? "# ";
  if (block.type === "heading") return block.text.match(/^##[ \t]+/)?.[0] ?? "## ";
  return "";
}
export function contentOf(block) {
  const prefix = prefixOf(block);
  const text = block.text.startsWith(prefix) ? block.text.slice(prefix.length) : block.text;
  return text.replace(/\r\n/g, "\n");
}
function textFor(block, content, eol) {
  const clean = content.replace(/\r/g, "");
  return prefixOf(block) + (eol === "\r\n" ? clean.replace(/\n/g, "\r\n") : clean);
}
export const blockById = (doc, id) => doc.blocks.find((b) => b.id === id);
const indexOf = (doc, id) => doc.blocks.findIndex((b) => b.id === id);
const newSep = (doc) => doc.eol + doc.eol;

// A single-line "# " block is the title only when it is the first one in the document, as in parse().
function normalizeTitles(doc) {
  let seen = false;
  for (const b of doc.blocks) {
    if ((b.type === "title" || b.type === "raw") && !/\n/.test(b.text) && TITLE_RE.test(b.text)) {
      b.type = seen ? "raw" : "title";
      seen = true;
    }
  }
}

// Set a block's visible content. Paras, notes and raw blocks follow their text with the same
// rules as parse(): brackets make a note, "## " a heading, "- " / "> " / "|" / "---" / fences raw,
// "# " the title, and a blank line inside the text splits it into several blocks.
// Returns { block, changed, created: Block[], pieces: [{ id, start, prefix }] }, where each piece
// says at which offset of the given content a resulting block begins (for placing the caret).
export function setContent(doc, id, content) {
  const block = blockById(doc, id);
  if (!block) return null;
  const before = block.type;
  const clean = content.replace(/\r/g, "");
  const result = { block, changed: false, created: [], pieces: [{ id, start: 0, prefix: 0 }] };
  if (block.type === "title" || block.type === "heading") {
    if (contentOf(block) !== clean) block.text = textFor(block, clean, doc.eol);
    return result;
  }
  const parsed = parse(clean);
  const eolize = (t) => (doc.eol === "\r\n" ? t.replace(/\n/g, "\r\n") : t);
  if (parsed.blocks.length <= 1) {
    block.text = eolize(clean);
    block.type = parsed.blocks[0]?.type ?? "para";
    if (block.type === "heading" || block.type === "title") {
      const lead = clean.match(/^\s*/)[0];
      if (lead) { block.sep += eolize(lead); block.text = eolize(clean.slice(lead.length)); }
      result.pieces[0].start = lead.length;
      result.pieces[0].prefix = prefixOf(block).length;
    }
  } else {
    const lead = parsed.blocks[0].sep;
    const at = indexOf(doc, id);
    let pos = 0;
    const made = parsed.blocks.map((pb, i) => {
      const last = i === parsed.blocks.length - 1;
      const head = pb.type === "heading" || pb.type === "title";
      const b = i === 0 ? block : { id: freshId(doc), type: pb.type, text: "", sep: eolize(pb.sep) };
      b.type = pb.type;
      let text = pb.text, start;
      if (i === 0) {
        if (head) { b.sep += eolize(lead); start = lead.length; }
        else { text = lead + text; start = 0; }
        pos = lead.length + pb.text.length;
      } else {
        start = pos + pb.sep.length;
        pos = start + pb.text.length;
      }
      if (last) text += parsed.tail;
      b.text = eolize(text);
      result.pieces[i] = { id: b.id, start, prefix: head ? prefixOf(b).length : 0 };
      if (i > 0) { doc.blocks.splice(at + i, 0, b); result.created.push(b); }
      return b;
    });
    void made;
  }
  normalizeTitles(doc);
  result.changed = block.type !== before;
  return result;
}

// Where a content offset lands after setContent split or retyped a block.
export function locate(result, offset) {
  let piece = result.pieces[0];
  for (const p of result.pieces) if (p.start <= offset) piece = p;
  return { id: piece.id, offset: Math.max(0, offset - piece.start - piece.prefix) };
}

// Insert a new block after `afterId` (or at the start when afterId is null).
export function insertBlock(doc, afterId, type, content = "") {
  const block = { id: freshId(doc), type, text: "", sep: newSep(doc) };
  block.text = textFor(block, content, doc.eol);
  const i = afterId == null ? 0 : indexOf(doc, afterId) + 1;
  if (i === 0 && doc.blocks.length) { block.sep = doc.blocks[0].sep; doc.blocks[0].sep = newSep(doc); }
  else if (i === 0) block.sep = "";
  doc.blocks.splice(i, 0, block);
  return block;
}

// Enter: split a block at a content offset. The new block takes the text after the caret.
// A title or heading keeps its left part and the rest becomes a para.
export function splitBlock(doc, id, at) {
  const block = blockById(doc, id);
  if (!block) return null;
  const content = contentOf(block);
  const k = Math.max(0, Math.min(at, content.length));
  const left = content.slice(0, k), right = content.slice(k);
  const nextType = block.type === "raw" ? "raw" : "para";
  block.text = textFor(block, left, doc.eol);
  if (block.type === "para" || block.type === "note") setContent(doc, id, left);
  const next = insertBlock(doc, id, nextType, right);
  setContent(doc, next.id, right);
  return next;
}

// Backspace at the start of a para: join it to the previous para or note.
// Returns { into, offset } (the caret goes to `offset` in `into`) or null when not allowed.
export function mergeWithPrevious(doc, id) {
  const i = indexOf(doc, id);
  if (i <= 0) return null;
  const block = doc.blocks[i], prev = doc.blocks[i - 1];
  if (block.type !== "para" || (prev.type !== "para" && prev.type !== "note")) return null;
  const offset = contentOf(prev).length;
  const joined = contentOf(prev) + contentOf(block);
  doc.blocks.splice(i, 1);
  setContent(doc, prev.id, joined);
  return { into: prev.id, offset };
}

// Remove a block. The first block passes its leading separator on, so the file still starts the same way.
export function removeBlock(doc, id) {
  const i = indexOf(doc, id);
  if (i < 0) return null;
  const [gone] = doc.blocks.splice(i, 1);
  if (i === 0 && doc.blocks.length) doc.blocks[0].sep = gone.sep;
  return gone;
}

/* ---------- Sections ---------- */
export function parseHeading(content) {
  let s = content.trim();
  const tm = s.match(/\s*\((\d{1,2}:\d{2})(?:\s*[–—-]\s*(\d{1,2}:\d{2}))?\)\s*$/);
  if (tm) s = s.slice(0, tm.index);
  const nm = s.match(/^(\d+)(?:\s*[·.:)–—-])?\s*/);
  return {
    num: nm ? nm[1] : "",
    name: (nm ? s.slice(nm[0].length) : s).trim(),
    start: tm ? tm[1] : "",
    end: tm?.[2] ?? "",
  };
}

// front: blocks before the first heading. sections: one per heading, with its blocks.
// With no headings at all, everything after the title is one spoken section (heading: null).
export function outline(doc) {
  const heads = doc.blocks.filter((b) => b.type === "heading");
  const numbered = heads.some((h) => /^\s*\d/.test(contentOf(h)));
  const front = [], sections = [];
  let cur = null;
  if (!heads.length) {
    const t = doc.blocks.findIndex((b) => b.type === "title");
    const cut = t >= 0 ? t + 1 : 0;
    front.push(...doc.blocks.slice(0, cut));
    if (doc.blocks.length > cut || !doc.blocks.length) sections.push({ heading: null, info: parseHeading(""), spoken: true, blocks: doc.blocks.slice(cut) });
    return { front, sections };
  }
  for (const b of doc.blocks) {
    if (b.type === "heading") {
      const info = parseHeading(contentOf(b));
      cur = { heading: b, info, spoken: numbered ? /^\s*\d/.test(contentOf(b)) : true, blocks: [] };
      sections.push(cur);
    } else (cur ? cur.blocks : front).push(b);
  }
  return { front, sections };
}

export function titleOf(doc) {
  const t = doc.blocks.find((b) => b.type === "title");
  return t ? contentOf(t).trim() : "";
}

/* ---------- Exports ---------- */
const collapse = (s) => s.replace(/[ \t]*\r?\n[ \t]*/g, " ").replace(/\s+/g, " ").trim();
const spokenParas = (doc) => outline(doc).sections.filter((s) => s.spoken).flatMap((s) => s.blocks.filter((b) => b.type === "para"));

export function exportCamera(doc) {
  const paras = spokenParas(doc).map((b) => collapse(contentOf(b))).filter(Boolean);
  return paras.length ? paras.join("\n\n") + "\n" : "";
}

// One sentence per line. Splits after . ! ? … (and closing quotes) before a capital, digit or opening quote.
export function sentences(text) {
  return collapse(text).split(/(?<=[.!?…]["'”’)\]]*)\s+(?=["'“‘(\[]?[\p{Lu}\p{N}])/u).filter(Boolean);
}

function noteLines(content) {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.every((l) => /^\[.*\]$/.test(l)) ? lines : [collapse(content)];
}

export function prompterLabel(info) {
  return [info.num, info.name.toUpperCase(), info.start].filter(Boolean).join(" · ");
}

export function exportPrompter(doc) {
  const out = [`# ${titleOf(doc) || "Script"}`];
  for (const s of outline(doc).sections) {
    if (!s.spoken) continue;
    out.push("", "---", "");
    if (s.heading) out.push(`### **${prompterLabel(s.info) || "SECTION"}**`);
    else out.push("### **SCRIPT**");
    for (const b of s.blocks) {
      const c = contentOf(b);
      if (!c.trim()) continue;
      if (b.type === "para") out.push("", ...sentences(c));
      else if (b.type === "note") out.push("", ...noteLines(c));
    }
  }
  return out.join("\n") + "\n";
}

/* ---------- Prompter link (prompter.techies.tools) ---------- */
// Built like makeLink() in techies-prompter's src/core.mjs: deflate-raw, base64url, in the #s= fragment,
// preset "default" (no &p=). The script travels only in the fragment, never to a server.
export const PROMPTER_SITE = "https://prompter.techies.tools";
export const PROMPTER_MAX_CHARS = 100_000;

function toBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The prompter link for a prompter export, or null when it is longer than the prompter accepts. */
export async function prompterLink(text, origin = PROMPTER_SITE) {
  text = String(text);
  if (text.length > PROMPTER_MAX_CHARS) return null;
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return `${origin.replace(/\/+$/, "")}/#s=${toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
}

/* ---------- Word count and spoken length ---------- */
export function countWords(text) {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,%&@/-]*/gu) || []).length;
}
export function formatDuration(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function stats(doc) {
  const words = spokenParas(doc).reduce((n, b) => n + countWords(contentOf(b)), 0);
  const seconds = Math.round((words / WORDS_PER_MINUTE) * 60);
  return { words, seconds, spoken: formatDuration(seconds) };
}

/* ---------- Asks ---------- */
const WORD = /[\p{L}\p{N}'’_-]/u;
// Half words snap to whole words; spaces at the ends are left out.
export function snapToWords(content, start, end) {
  let s = Math.max(0, Math.min(start, end)), e = Math.min(content.length, Math.max(start, end));
  while (s > 0 && s < content.length && WORD.test(content[s - 1]) && WORD.test(content[s])) s--;
  while (e > 0 && e < content.length && WORD.test(content[e - 1]) && WORD.test(content[e])) e++;
  while (s < e && /\s/.test(content[s])) s++;
  while (e > s && /\s/.test(content[e - 1])) e--;
  return { start: s, end: e };
}

// After an edit: keep the anchor if the quote is still there, else find the quote nearest
// the old offset. Returns { start, end } or null when the quote is gone.
export function reanchor(anchor, content) {
  const { start = 0, quote } = anchor;
  if (!quote) return null;
  if (content.slice(start, start + quote.length) === quote) return { start, end: start + quote.length };
  let best = -1, dist = Infinity;
  for (let i = content.indexOf(quote); i >= 0; i = content.indexOf(quote, i + 1)) {
    const d = Math.abs(i - start);
    if (d < dist) { best = i; dist = d; }
  }
  return best < 0 ? null : { start: best, end: best + quote.length };
}

export function sectionOfBlock(doc, blockId) {
  for (const s of outline(doc).sections) {
    if (s.heading?.id === blockId || s.blocks.some((b) => b.id === blockId)) return s.heading ? contentOf(s.heading).trim() : "";
  }
  return "";
}

export function makeAsk(doc, { blockId, start, end, action, instruction, by, scope = "selection", now = new Date() }) {
  const ask = {
    id: newId(10),
    scope,
    action,
    instruction: (instruction ?? ACTIONS[action]?.instruction ?? "").trim() || ACTIONS[action]?.instruction || "",
    by,
    createdAt: now.toISOString(),
    status: "waiting",
  };
  if (scope === "selection") {
    const block = blockById(doc, blockId);
    const content = contentOf(block);
    Object.assign(ask, { blockId, start, end, quote: content.slice(start, end), context: content, section: sectionOfBlock(doc, blockId) });
  }
  return ask;
}

// Find a quote for a "Sounds like me" mark: spoken paras first, then any block.
export function findQuote(doc, quote, near = null) {
  if (!quote) return null;
  const spoken = new Set(spokenParas(doc).map((b) => b.id));
  const order = [...doc.blocks.filter((b) => spoken.has(b.id)), ...doc.blocks.filter((b) => !spoken.has(b.id))];
  if (near?.blockId) {
    const b = blockById(doc, near.blockId);
    const r = b && reanchor({ start: near.start ?? 0, quote }, contentOf(b));
    if (r) return { blockId: b.id, ...r };
  }
  for (const b of order) {
    const i = contentOf(b).indexOf(quote);
    if (i >= 0) return { blockId: b.id, start: i, end: i + quote.length };
  }
  return null;
}

// Check an answer from an agent. Returns a clean answer or null.
export function cleanAnswer(ask, answer) {
  if (!answer || typeof answer !== "object" || ask.scope === "broll") return null;
  const str = (v) => (typeof v === "string" ? v : "");
  const message = str(answer.message).trim().slice(0, MESSAGE_MAX);
  const extra = message ? { message } : {};
  if (ask.scope === "script") {
    if (answer.kind !== "marks" || !Array.isArray(answer.marks)) return null;
    const marks = answer.marks
      .map((m) => ({ quote: str(m?.quote), why: str(m?.why).trim(), rewrite: str(m?.rewrite).trim() }))
      .filter((m) => m.quote.trim());
    return { kind: "marks", marks, ...extra };
  }
  if (answer.kind === "replace" || answer.kind === "add") {
    const text = str(answer.text).replace(/\r\n?/g, "\n");
    if (!text.trim()) return null;
    return { kind: answer.kind, text, ...extra };
  }
  if (answer.kind === "note") {
    const text = str(answer.text).trim();
    if (!text) return null;
    return { kind: "note", text, tone: answer.tone === "look" ? "look" : "ok", ...extra };
  }
  return null;
}

// The content after keeping an answer. "add" puts the text after the quote, with one space between.
export function applyAnswer(content, ask) {
  const { start, end } = ask, a = ask.answer;
  if (a.kind === "replace") return { content: content.slice(0, start) + a.text + content.slice(end), start, end: start + a.text.length };
  if (a.kind === "add") {
    let text = a.text;
    if (!/^\s/.test(text) && end > 0 && !/\s/.test(content[end - 1] ?? "")) text = " " + text;
    if (!/\s$/.test(text) && end < content.length && !/\s/.test(content[end])) text += " ";
    return { content: content.slice(0, end) + text + content.slice(end), start: end + (text.length - text.trimStart().length), end: end + text.trimEnd().length };
  }
  return { content, start, end };
}

// Anchors that sit at or after `fromStart` in block `fromId` move to `toId`, shifted by `shift`.
// Used after Keep (the text after the quote moves), paste, split and merge.
export function moveAsks(asks, fromId, toId, fromStart, shift) {
  for (const a of asks) {
    if (a.scope === "selection" && a.blockId === fromId && OPEN_STATUSES.includes(a.status) && a.start >= fromStart) {
      a.blockId = toId; a.start += shift; a.end += shift;
    }
    if (a.scope === "script" && a.status === "answered") {
      for (const m of a.answer.marks) {
        if (m.state === "open" && m.blockId === fromId && m.start >= fromStart) { m.blockId = toId; m.start += shift; m.end += shift; }
      }
    }
  }
}

// Check an agent's answer_ask arguments against the ask and the script.
// Returns { answer } ready for receiveAnswer, or { error } with a short reason for the agent.
export function checkAnswer(ask, args, doc) {
  if (!ask) return { error: "Unknown ask. Call list_asks or wait_for_asks for current ask ids." };
  if (ask.scope === "broll") return { error: ask.action === "plan" ? "This is a \"Plan B-roll\" ask. Answer it with answer_broll." : "This ask is for B-roll sketches. Answer it with sketch_shot, one call per shot." };
  if (ask.scope === "selection" && ask.action === "broll") return { error: "This is a \"Suggest B-roll\" ask. Answer it with answer_broll." };
  if (ask.status !== "waiting" && ask.status !== "taken") return { error: `This ask is finished (${ask.status}).` };
  const a = args && typeof args === "object" ? args : {};
  if (!ANSWER_KINDS.includes(a.kind)) return { error: "kind must be replace, add, note or marks." };
  if (a.kind === "marks" && ask.scope !== "script") return { error: "marks answers only fit the \"Sounds like me\" script check. Use replace, add or note." };
  if (a.kind !== "marks" && ask.scope === "script") return { error: "This is the \"Sounds like me\" script check. Answer with kind \"marks\"." };
  const tooLong = (v, n, name) => (typeof v === "string" && v.length > n ? `${name} is longer than ${n} characters.` : "");
  const err = tooLong(a.text, LIMITS.text, "text") || tooLong(a.message, LIMITS.message, "message");
  if (err) return { error: err };
  if (a.kind === "marks") {
    if (!Array.isArray(a.marks)) return { error: "marks must be a list of { quote, why, rewrite }." };
    if (a.marks.length > LIMITS.marks) return { error: `At most ${LIMITS.marks} marks.` };
    for (const m of a.marks) {
      const e = !m || typeof m.quote !== "string" || !m.quote.trim() ? "Every mark needs a quote."
        : tooLong(m.quote, LIMITS.quote, "quote") || tooLong(m.why, LIMITS.why, "why") || tooLong(m.rewrite, LIMITS.rewrite, "rewrite");
      if (e) return { error: e };
    }
    const missing = a.marks.filter((m) => !findQuote(doc, m.quote)).map((m) => m.quote.slice(0, 80));
    if (missing.length) return { error: `These quotes are not in the script word for word: ${missing.map((q) => JSON.stringify(q)).join(", ")}` };
  } else if (a.kind !== "note" && (typeof a.text !== "string" || !a.text.trim())) {
    return { error: `A ${a.kind} answer needs text.` };
  } else if (a.kind === "note" && (typeof a.text !== "string" || !a.text.trim())) {
    return { error: "A note answer needs text." };
  }
  if (a.tone != null && a.tone !== "ok" && a.tone !== "look") return { error: "tone must be ok or look." };
  const answer = cleanAnswer(ask, a);
  return answer ? { answer } : { error: "That answer could not be shown." };
}

/* ---------- Parts added with "/" while typing (step C5) ---------- */
// In menu order. Spoken parts add "## N · <Name>" and an empty spoken para; Section leaves the name to type.
export const PARTS = [
  ...["Hook", "Intro", "Problem", "Point", "Demo", "Recap", "Call to action", "Close"].map((name) => ({ id: name.toLowerCase().replace(/\s+/g, "-"), name, kind: "spoken" })),
  { id: "section", name: "Section", kind: "spoken", named: true },
  { id: "on-screen", name: "On screen", kind: "note", text: "[ON SCREEN: ]" },
  { id: "silent", name: "Silent note", kind: "note", text: "[SILENT: ]" },
  { id: "broll", name: "B-roll", kind: "broll" },
  { id: "divider", name: "Divider", kind: "divider", text: "---" },
];
// A part matches when the typed letters start its name, one of its words, or its initials ("cta").
function partKeys(p) {
  const name = p.name.toLowerCase(), words = name.split(/[\s-]+/).filter(Boolean);
  return [name, ...words, ...(words.length > 1 ? [words.map((w) => w[0]).join("")] : [])];
}
/** matchParts(query, { spokenLine }) → the parts for "/<query>", in menu order. B-roll only on a spoken line. */
export function matchParts(query, { spokenLine = false } = {}) {
  const q = String(query ?? "").toLowerCase();
  return PARTS.filter((p) => (p.kind !== "broll" || spokenLine) && (!q || partKeys(p).some((k) => k.startsWith(q))));
}
/** The "/" command at the caret: { start, end, query }, or null. "/" counts at the start of a line or after a
 *  space, never inside a word ("and/or", "https://"). With the caret inside the command, the whole command word
 *  counts (letters, digits and "-" after the caret too), so picking removes all of it. */
export function slashCommand(content, offset) {
  const text = String(content ?? "");
  const before = text.slice(0, offset);
  const m = before.match(/(^|\s)\/([\p{L}\p{N}-]*)$/u);
  if (!m) return null;
  const rest = text.slice(before.length).match(/^[\p{L}\p{N}-]*/u)[0];
  return { start: m.index + m[1].length, end: before.length + rest.length, query: m[2] + rest };
}
/** Where "/" may open the menu: not in the title, and not in raw blocks (lists, tables, code), where "/" is text. */
export const slashAllowed = (block) => !!block && block.type !== "title" && block.type !== "raw";
/** cutCommand(content, cmd) → { content, at }: the text without the command. A command that ended the line also
 *  takes the one space before it ("Some text /on" → "Some text"). `at` is where the command was. */
export function cutCommand(content, { start, end }) {
  const text = String(content ?? "");
  const atEnd = end >= text.length || text[end] === "\n";
  const from = atEnd && start > 0 && text[start - 1] === " " ? start - 1 : start;
  return { content: text.slice(0, from) + text.slice(end), at: from };
}
/** withoutCommand(doc, { id, start, end }) → a copy of the document without the "/" command (what a save writes
 *  while the menu is open). `doc` itself is not changed. */
export function withoutCommand(doc, cmd) {
  const copy = cloneDoc(doc);
  const b = blockById(copy, cmd?.id);
  if (b) setContent(copy, b.id, cutCommand(contentOf(b), cmd).content);
  return copy;
}
/** In a shared script, is the "/" command at the caret held back from the others? Yes while the parts menu is open,
 *  or about to open (a command with matching parts, not dismissed, in the focused script). The same for the host and
 *  for guests (step D2): the command text is never sent before a part is picked. */
export function slashHold({ open = false, focused = false, cmd = null, dismissed = null, matches = 0 } = {}) {
  if (open) return true;
  if (!focused || !cmd) return false;
  if (dismissed && dismissed.id === cmd.id && dismissed.start === cmd.start) return false;
  return matches > 0;
}
/** The line a part replaces: the block where only the command was typed, when it is now an empty para without an
 *  open ask and not the only block. Otherwise null, and the part goes after it. */
export function lineToReplace(doc, id, asks = []) {
  const b = blockById(doc, id);
  if (!b || b.type !== "para" || contentOf(b).trim() || doc.blocks.length <= 1) return null;
  return asks.some((a) => a.blockId === id && OPEN_STATUSES.includes(a.status)) ? null : id;
}

const NUM_RE = /^(\s*)(\d+)/;
/** shiftHeadings(doc, from, by) → numbered headings at block index `from` and later move by `by`. Only the number
 *  changes: their names, separators, time ranges and every other block stay exactly as they were. */
export function shiftHeadings(doc, from, by = 1) {
  for (let i = Math.max(0, from); i < doc.blocks.length; i++) {
    const b = doc.blocks[i];
    if (b.type !== "heading") continue;
    const content = contentOf(b);
    const m = content.match(NUM_RE);
    if (!m) continue;
    b.text = textFor(b, m[1] + String(Number(m[2]) + by) + content.slice(m[0].length), doc.eol);
  }
}
/** The number a new spoken heading gets at block index `at`: one after the numbered heading before it, else the
 *  number of the first one after it (which then moves up), else 1. */
export function numberAt(doc, at) {
  const num = (b) => (b.type === "heading" ? contentOf(b).match(NUM_RE)?.[2] : null);
  for (let i = Math.min(at, doc.blocks.length) - 1; i >= 0; i--) { const n = num(doc.blocks[i]); if (n) return Number(n) + 1; }
  for (let i = at; i < doc.blocks.length; i++) { const n = num(doc.blocks[i]); if (n) return Number(n); }
  return 1;
}
// Ids of the blocks outline() reads as spoken (front matter is never spoken).
const spokenIds = (doc) => new Set(outline(doc).sections.filter((x) => x.spoken).flatMap((x) => x.blocks.map((b) => b.id)));
function addSpoken(doc, afterId, part, numbered) {
  const spoken = spokenIds(doc);
  let at = afterId == null ? 0 : indexOf(doc, afterId) + 1;
  // Text above the caret with no heading over it would turn into front matter: the heading goes above that text.
  if (!doc.blocks.slice(0, at).some((b) => b.type === "heading")) {
    const first = doc.blocks.findIndex((b, i) => i < at && spoken.has(b.id));
    if (first >= 0) at = first;
  }
  const moved = at < (afterId == null ? 0 : indexOf(doc, afterId) + 1);
  let content = part.named ? "" : part.name;
  if (numbered) {
    const n = numberAt(doc, at);
    shiftHeadings(doc, at, 1);
    content = `${n} · ${content}`;
  }
  const head = insertBlock(doc, at === 0 ? null : doc.blocks[at - 1].id, "heading", content);
  const para = insertBlock(doc, moved ? afterId : head.id, "para", "");
  return { caret: part.named ? { id: head.id, offset: content.length } : { id: para.id, offset: 0 } };
}
/**
 * insertPart(doc, afterId, partId, { replaceId }) → { caret: { id, offset } } with the part's blocks inserted after
 * `afterId` (or at the start when null). replaceId (see lineToReplace): that empty line is removed and the part takes
 * its place. Spoken parts: a heading and an empty para. The heading is numbered "## N · Name" (later numbered
 * headings move up by one) when the script already numbers its headings or has no headings yet
 * (a new script); otherwise "## Name", in the script's own style. A part never makes spoken text stop being spoken.
 * On screen / Silent note: the note, caret inside the brackets. Divider: "---" and an empty para.
 */
export function insertPart(doc, afterId, partId, { replaceId = null } = {}) {
  const part = PARTS.find((p) => p.id === partId);
  if (!part || part.kind === "broll") return null;
  if (replaceId && blockById(doc, replaceId)) {
    const i = indexOf(doc, replaceId);
    removeBlock(doc, replaceId);
    afterId = i > 0 ? doc.blocks[i - 1].id : null;
  }
  if (part.kind === "spoken") {
    const before = spokenIds(doc);
    const heads = doc.blocks.filter((b) => b.type === "heading");
    // Numbered when the script has no headings yet (a new script) or already numbers them; the [true, false] check below keeps spoken text spoken.
    const numbered = !heads.length || heads.some((h) => NUM_RE.test(contentOf(h)));
    for (const n of numbered ? [true, false] : [false]) {
      const copy = cloneDoc(doc);
      const res = addSpoken(copy, afterId, part, n);
      const after = spokenIds(copy);
      if ([...before].every((id) => after.has(id)) || !n) {
        doc.blocks = copy.blocks;
        return res;
      }
    }
  }
  const block = insertBlock(doc, afterId, typeOf(part.text), part.text);
  if (part.kind === "divider") return { caret: { id: insertBlock(doc, block.id, "para", "").id, offset: 0 } };
  return { caret: { id: block.id, offset: part.text.length - 1 } };
}
