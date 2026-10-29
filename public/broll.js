// The B-roll list next to a script: parse its Markdown tables, match each shot's "Over" line to the
// spoken blocks it covers, flag shots whose lines changed, and keep storyboard sketches in its
// "## Sketches" section. Pure module: no DOM, no network. Imported by the app and by the tests.
import { outline, contentOf, blockById } from "./doc.js";
import { spokenText } from "./links.js";

export const SKETCH_MAX = 8 * 1024;
// A picture as a sketch (step K): a PNG, JPEG or WebP data address, shrunk by the tab first.
export const IMAGE_MAX = 400_000;
// The file the agent sends may be bigger: the tab shrinks it.
export const IMAGE_UPLOAD_MAX = 6 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const IMAGE_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const IMAGE_LINE_RE = /^[ \t]{0,3}!\[([^\]\s]+)\]\((data:image\/[^)\s]+)\)[ \t]*$/;
export const isImage = (v) => typeof v === "string" && v.length <= IMAGE_MAX && IMAGE_RE.test(v);
/** A sketch as it may be kept and shown: a picture's data address as it is, a line drawing cleaned; else "". */
export const cleanSketch = (v) => (typeof v === "string" && v.startsWith("data:") ? (isImage(v) ? v : "") : sanitizeSvg(v));
/** A kept sketch as HTML: the picture or the line drawing, labelled (or hidden from screen readers without a label). */
export function sketchHtml(value, label = "") {
  const v = cleanSketch(value);
  if (!v) return "";
  if (isImage(v)) return `<img src="${v}" alt="${escHtml(label)}" decoding="async">`;
  return v.replace("<svg ", label ? `<svg role="img" aria-label="${escHtml(label)}" ` : '<svg aria-hidden="true" ');
}
export const SKETCH_VIEWBOX = "0 0 260 140";
export const SKETCH_CLASSES = ["s", "l", "o", "mv"];
export const KINDS = ["broll", "motion", "screen"];

/* ---------- Parse the list ---------- */
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*(\S*)/;
const SEP_ROW_RE = /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/;
const clean = (s) => s.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
function cells(row) {
  return row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}
function columns(head) {
  const find = (re) => head.findIndex((h) => re.test(clean(h)));
  return { id: find(/^(#|id|shot)$/i), what: find(/^what/i), over: find(/^over/i), how: find(/^how/i), kind: find(/^kind$/i), record: head.some((h) => /record/i.test(h)) };
}
// A "Kind" column (written by exportBroll) wins over the heading and the "How" text.
const kindOf = (cell) => (/screen/i.test(cell) ? "screen" : /motion/i.test(cell) ? "motion" : /b.?roll/i.test(cell) ? "broll" : "");

/**
 * parseBroll(markdown) → { shots: [{ id, what, over, how, kind }], sketches: { [id]: svg } }
 * Main table: # | What to show | Over (A-roll line) | How to make it. A table under a "Screen recordings"
 * heading (or with "What to record") lists screen recordings. Rows whose "How" mentions motion are motion plates.
 * An optional "Kind" column (B-roll, Motion plate, Screen recording) decides the kind on its own.
 */
export function parseBroll(markdown) {
  const { rows, sketches } = scan(markdown);
  return { shots: rows.map((r) => r.shot), sketches };
}

// Reads the list once, keeping where everything is: the tables (header, last row, columns), each row's line
// and shot, the fenced blocks and the headings. parseBroll and the row edits below share it, so they agree on ids.
function scan(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const tables = [], rows = [], sketches = {}, fences = [], headings = [], seen = new Set();
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = line.match(FENCE_RE);
    if (f) {
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const c = lines[j].match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
        if (c && c[1][0] === f[1][0] && c[1].length >= f[1].length) break;
        body.push(lines[j]);
      }
      const svgFence = f[2].toLowerCase() === "svg" && !!f[3];
      fences.push({ start: i, end: Math.min(j, lines.length - 1), id: svgFence ? f[3] : "" });
      if (svgFence) {
        const svg = sanitizeSvg(body.join("\n"));
        if (svg) sketches[f[3]] = svg;
      }
      i = j;
      continue;
    }
    const img = line.match(IMAGE_LINE_RE);
    if (img) {
      // A picture sketch (step K): one line, kept like a fence so a removed shot takes it along.
      fences.push({ start: i, end: i, id: img[1] });
      if (isImage(img[2])) sketches[img[1]] = img[2];
      continue;
    }
    const h = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.*)$/);
    // Only a section heading (## and deeper) names a table: a "# … Screen … · B-roll list" title does not.
    if (h) { heading = h[1].length > 1 ? h[2] : ""; headings.push({ i, level: h[1].length, text: h[2] }); continue; }
    if (!/^[ \t]*\|/.test(line) || !SEP_ROW_RE.test(lines[i + 1] ?? "")) continue;
    const head = cells(line);
    const col = columns(head);
    const start = i;
    i += 1;
    const table = [];
    while (i + 1 < lines.length && /^[ \t]*\|/.test(lines[i + 1])) table.push({ i: ++i, row: cells(lines[i]) });
    if (col.what < 0 || col.over < 0) continue;
    const screen = /screen/i.test(heading) || col.record;
    const t = { start, end: i, col, width: head.length, screen };
    tables.push(t);
    for (const { i: at, row } of table) {
      const get = (k) => (col[k] >= 0 ? clean(row[col[k]] ?? "") : "");
      const what = get("what"), over = get("over"), how = get("how");
      if (!what && !over) continue;
      // Ids double as sketch fence names: no spaces, at most 20 characters.
      let id = (get("id") || `#${rows.length + 1}`).replace(/\s+/g, "-").slice(0, 20);
      for (let n = 2; seen.has(id); n++) id = `${get("id") || "#"}·${n}`;
      seen.add(id);
      rows.push({ i: at, table: t, shot: { id, what, over, how, kind: kindOf(get("kind")) || (screen ? "screen" : /motion/i.test(how) ? "motion" : "broll") } });
    }
  }
  return { lines, tables, rows, sketches, fences, headings };
}

/* ---------- Match "Over" to the spoken blocks ---------- */
// Lower case, no quotes, apostrophes or punctuation, single spaces.
export const normalize = (s) => String(s).toLowerCase().normalize("NFKC").replace(/[’'`ʼ‘]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const unquote = (s) => s.trim().replace(/^["“”„]/, "").replace(/["“”]$/, "").trim();
const fragments = (quote) => quote.split(/…|\.{3}/).map(normalize).filter(Boolean);

/** parseOver('"A…" through "B."') → { from: ["a"], to: ["b"] }; a single quote has to: null. */
export function parseOver(over) {
  const parts = String(over ?? "").split(/(?<=["”])\s*(?:through|until|till|to|–|—)\s*(?=["“])/i);
  const from = fragments(unquote(parts[0] ?? ""));
  const to = parts.length > 1 ? fragments(unquote(parts.at(-1))) : null;
  return { from, to: to?.length ? to : null };
}

/** The spoken paragraphs, in order, as the matcher sees them. */
export function spokenBlocks(doc) {
  return outline(doc).sections.filter((s) => s.spoken)
    .flatMap((s) => s.blocks.filter((b) => b.type === "para"))
    .map((b) => ({ id: b.id, n: ` ${normalize(spokenText(contentOf(b)))} ` })); // a link counts as its words (step G)
}
// Where the fragments occur in order (as whole words): the index of the first, or -1.
function fragsAt(n, frags) {
  let pos = 0, first = -1;
  for (const f of frags) {
    const i = n.indexOf(` ${f} `, pos);
    if (i < 0) return -1;
    if (first < 0) first = i;
    pos = i + f.length + 1;
  }
  return first;
}
// A block that starts with the words wins; else the first that contains them.
function findBlock(list, frags, from = 0, startFirst = true) {
  let contains = -1;
  for (let i = from; i < list.length; i++) {
    const at = fragsAt(list[i].n, frags);
    if (at === 0 && startFirst) return i;
    if (at >= 0 && contains < 0) { contains = i; if (!startFirst) return i; }
  }
  return contains;
}

/** The block ids a shot's Over text covers, or [] when it matches nothing. */
export function matchOver(list, over) {
  const { from, to } = parseOver(over);
  if (!from.length) return [];
  const a = findBlock(list, from);
  if (a < 0) return [];
  const z = to ? findBlock(list, to, a, false) : a;
  return list.slice(a, (z < 0 ? a : z) + 1).map((b) => b.id);
}

export function matchShots(doc, shots) {
  const list = spokenBlocks(doc);
  for (const s of shots) {
    s.blockIds = matchOver(list, s.over);
    s.sig = coverText(doc, s.blockIds);
  }
  return shots;
}

/* ---------- Check flags ---------- */
export function coverText(doc, blockIds) {
  // What is spoken, spaces folded, so adding a link to a covered line (even across a line break) asks for no check;
  // a change of words, punctuation or case still does.
  return blockIds.map((id) => { const b = blockById(doc, id); return b ? spokenText(contentOf(b)).replace(/\s+/g, " ").trim() : "\u0000"; }).join("\u0001");
}
/** After an edit, Keep or undo: a shot whose covered text changed gets check = true. Returns the ids flagged now. */
export function touchShots(doc, shots) {
  const flagged = [];
  for (const s of shots) {
    if (!s.blockIds?.length) continue;
    const sig = coverText(doc, s.blockIds);
    if (s.sig != null && sig !== s.sig && !s.check) { s.check = true; flagged.push(s.id); }
    s.sig = sig;
  }
  return flagged;
}

/** Shots in script order (by their first covered block); unmatched ones keep their list order at the end. */
export function scriptOrder(doc, shots) {
  const at = new Map(doc.blocks.map((b, i) => [b.id, i]));
  const first = (s) => Math.min(...(s.blockIds || []).map((id) => at.get(id) ?? Infinity), Infinity);
  return shots.map((s, i) => ({ s, i, k: first(s) })).sort((x, y) => x.k - y.k || x.i - y.i).map((x) => x.s);
}

/** What the agent sees in get_script. */
export const forAgent = (s) => ({ id: s.id, what: s.what, over: s.over, how: s.how, kind: s.kind, blockIds: [...(s.blockIds || [])], check: !!s.check });

/* ---------- Sketch sanitiser ---------- */
const ELEMENTS = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text"]);
const GEOMETRY = new Set(["x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "d", "points", "dx", "dy", "viewbox"]);
const NUMBERS_RE = /^[\w\s.,%+-]*$/;
const TRANSFORM_RE = /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([-\d.eE,\s]*\)\s*,?)*\s*$/;
const TOKEN_RE = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[!?][^>]*>?|<\/\s*([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|<|[^<]+/g;
const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const escText = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const escAttr = (s) => escText(s).replace(/"/g, "&quot;");

function cleanAttrs(name, raw) {
  const out = [];
  for (const m of raw.matchAll(ATTR_RE)) {
    const key = m[1].toLowerCase();
    const value = decode(m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (value.length > 4000) continue;
    if (key === "class") {
      const keep = value.split(/\s+/).filter((c) => SKETCH_CLASSES.includes(c));
      if (keep.length) out.push(`class="${keep.join(" ")}"`);
    } else if (key === "text-anchor") {
      if (/^(start|middle|end)$/.test(value)) out.push(`text-anchor="${value}"`);
    } else if (key === "transform") {
      if (value && TRANSFORM_RE.test(value)) out.push(`transform="${escAttr(value)}"`);
    } else if (GEOMETRY.has(key) && NUMBERS_RE.test(value)) {
      if (key === "viewbox" && name !== "svg") continue;
      out.push(`${key === "viewbox" ? "viewBox" : key}="${escAttr(value)}"`);
    }
  }
  return out.length ? " " + out.join(" ") : "";
}

/**
 * sanitizeSvg(markup) → "<svg viewBox=\"0 0 260 140\">…</svg>" or "" when nothing drawable is left.
 * Keeps only svg, g, path, rect, circle, ellipse, line, polyline, polygon and text, with geometry
 * attributes, class (s, l, o, mv), text-anchor and transform. Everything else, with its content, is dropped.
 */
export function sanitizeSvg(markup) {
  const src = String(markup ?? "");
  if (src.length > SKETCH_MAX * 2) return "";
  const stack = []; // open elements: { name, keep }
  let out = "", skip = 0, root = false, drawn = false;
  for (const m of src.matchAll(TOKEN_RE)) {
    const [tok, close, open, attrs = "", self] = m;
    if (close) {
      const name = close.toLowerCase();
      const k = stack.map((e) => e.name).lastIndexOf(name);
      if (k < 0) continue;
      while (stack.length > k) {
        const e = stack.pop();
        if (!e.keep) skip--;
        else if (e.out) out += `</${e.name}>`;
      }
      continue;
    }
    if (open) {
      const name = open.toLowerCase();
      const keep = !skip && ELEMENTS.has(name);
      if (!keep) { if (!self) { stack.push({ name, keep: false }); skip++; } continue; }
      // The outer svg becomes the fixed root; its own attributes are not kept.
      if (name === "svg" && !root && !stack.length && !out) { root = true; if (!self) stack.push({ name, keep: true, out: false }); continue; }
      if (name !== "svg" && name !== "g") drawn = true;
      const el = `<${name}${cleanAttrs(name, attrs)}`;
      if (self) out += el + "/>";
      else { out += el + ">"; stack.push({ name, keep: true, out: true }); }
      continue;
    }
    if (skip || tok.startsWith("<")) continue;
    // Text only inside <text>.
    if (stack.at(-1)?.name === "text" && stack.at(-1).out) out += escText(decode(tok));
  }
  while (stack.length) { const e = stack.pop(); if (e.keep && e.out) out += `</${e.name}>`; }
  if (!drawn) return "";
  return `<svg viewBox="${SKETCH_VIEWBOX}">${out.replace(/>\s+</g, "><").trim()}</svg>`;
}

/* ---------- The "## Sketches" section ---------- */
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// One element per line, so the file stays readable.
export const sketchLines = (svg) => svg.replace(/></g, ">\n<");

/** setSketch(markdown, id, sketch) → the B-roll Markdown with the sketch stored under "## Sketches": a line drawing as
 *  ```svg ID … ```, a picture as ![ID](data:image/…). It takes the place of the shot's earlier sketch of either kind. */
export function setSketch(markdown, id, sketch) {
  const src = String(markdown ?? "");
  const eol = /\r\n/.test(src) ? "\r\n" : "\n";
  const text = src.replace(/\r\n?/g, "\n");
  const block = isImage(sketch) ? [`![${id}](${sketch})`] : `\`\`\`svg ${id}\n${sketchLines(sketch)}\n\`\`\``.split("\n");
  const { fences } = scan(text);
  const lines = text.split("\n");
  const old = fences.filter((f) => f.id === id);
  let out;
  if (old.length) {
    // In the first one's place; any other for the same id goes, with the blank line before it.
    for (const f of old.slice(1).reverse()) {
      const a = f.start > 0 && !lines[f.start - 1].trim() ? f.start - 1 : f.start;
      lines.splice(a, f.end - a + 1);
    }
    lines.splice(old[0].start, old[0].end - old[0].start + 1, ...block);
    out = lines.join("\n");
  } else {
    const h = lines.findIndex((l) => /^##[ \t]+Sketches[ \t]*$/i.test(l));
    if (h < 0) out = `${text.replace(/\s+$/, "")}${text.trim() ? "\n\n" : ""}## Sketches\n\n${block.join("\n")}\n`;
    else {
      let end = lines.length, inFence = false;
      for (let i = h + 1; i < lines.length; i++) {
        if (FENCE_RE.test(lines[i])) inFence = !inFence;
        else if (!inFence && /^#{1,2}[ \t]/.test(lines[i])) { end = i; break; }
      }
      const last = end === lines.length;
      let k = end;
      while (k > h + 1 && !lines[k - 1].trim()) k--;
      lines.splice(k, end - k, "", ...block, "");
      out = lines.join("\n");
      if (last) out = out.replace(/\n*$/, "\n");
    }
  }
  return eol === "\r\n" ? out.replace(/\n/g, "\r\n") : out;
}

/* ---------- Sketch asks (scope "broll", action "sketch") ---------- */
/** Check sketch_shot { askId, shotId, svg } against the ask. Returns { svg } (sanitised) or { error }. */
export function checkSketch(ask, args) {
  if (!ask) return { error: "Unknown ask. Call list_asks or wait_for_asks for current ask ids." };
  if (ask.scope !== "broll" || (ask.action && ask.action !== "sketch")) return { error: ask.action === "plan" ? "This is a \"Plan B-roll\" ask. Answer it with answer_broll." : "sketch_shot only answers \"Ask for sketches\" asks. Use answer_ask for this one." };
  if (!["waiting", "taken", "answered"].includes(ask.status)) return { error: `This ask is finished (${ask.status}).` };
  const a = args && typeof args === "object" ? args : {};
  if (typeof a.shotId !== "string" || !(ask.shots || []).some((s) => s.id === a.shotId)) return { error: `shotId must be one of: ${(ask.shots || []).map((s) => s.id).join(", ")}.` };
  if (ask.answer?.done?.[a.shotId]) return { error: `This shot is finished (${ask.answer.done[a.shotId]}).` };
  if (typeof a.svg !== "string" || !a.svg.trim()) return { error: "svg is required." };
  // A picture (step K) comes as its data address: the tab looked up the imageId.
  if (a.svg.startsWith("data:")) return isImage(a.svg) ? { svg: a.svg } : { error: "The picture can't be used." };
  if (a.svg.length > SKETCH_MAX) return { error: `svg is longer than ${SKETCH_MAX} characters.` };
  const svg = sanitizeSvg(a.svg);
  if (!svg) return { error: "Nothing drawable is left after cleaning. Use path, rect, circle, ellipse, line, polyline, polygon or text with class s, l, o or mv." };
  return { svg };
}

/** A copy of an ask without its waiting pictures (step K), for drafts and guests: a sketch ask's shot waits for its
 *  sketch again, an add keeps its suggestion without the picture. Asks without pictures come back as they are. */
export function withoutPictures(ask) {
  const a = ask?.answer;
  const pic = (v) => typeof v === "string" && v.startsWith("data:");
  if (a?.kind === "sketches" && Object.values(a.sketches || {}).some(pic)) {
    const sketches = Object.fromEntries(Object.entries(a.sketches).filter(([, v]) => !pic(v)));
    return { ...ask, answer: { ...a, sketches } };
  }
  if (a?.kind === "broll" && (a.changes || []).some((c) => pic(c?.sketch))) {
    return { ...ask, answer: { ...a, changes: a.changes.map((c) => { if (!pic(c?.sketch)) return c; const { sketch, ...rest } = c; return rest; }) } };
  }
  return ask;
}
/** The list without its picture lines (step K), for guests when it is large. */
export const withoutPictureLines = (markdown) => String(markdown ?? "").split(/(?<=\n)/).filter((l) => !IMAGE_LINE_RE.test(l.replace(/\r?\n$/, ""))).join("");

/** Clean an ask's agent sketches where they come in from a draft or the room (step I): a sketch ask's waiting
 *  sketches and the adds' sketches. One that cleans to nothing is dropped. Returns the ask. */
export function cleanSketches(ask) {
  const answer = ask?.answer;
  if (answer?.kind === "sketches" && answer.sketches && typeof answer.sketches === "object") {
    for (const [id, svg] of Object.entries(answer.sketches)) { const clean = cleanSketch(svg); if (clean) answer.sketches[id] = clean; else delete answer.sketches[id]; }
  }
  if (answer?.kind === "broll" && Array.isArray(answer.changes)) {
    for (const c of answer.changes) {
      if (c?.sketch == null) continue;
      const clean = cleanSketch(c.sketch);
      if (clean) c.sketch = clean; else delete c.sketch;
    }
  }
  return ask;
}

/* ---------- The storyboard header: what it offers for the linked list's state ---------- */
/**
 * boardHeadState(link, status) → { link, file, note, allow, ask, saveAs }
 * link: only "Link B-roll list…" (nothing linked). file: the file row with its name, "Change…" and "Unlink",
 * shown whenever a list is linked, also when it can't be read. note: "Couldn't open …". allow: "Allow reading …".
 * ask: room for "Ask for sketches" or the waiting state. saveAs: "Not saved to a file · Save as…" (a list kept
 * in the browser: the demo, one opened without a file handle, or a new one whose save picker was cancelled).
 */
export function boardHeadState(link, status) {
  const out = { link: false, file: false, note: false, allow: false, ask: false, saveAs: false };
  if (!link || status === "none") return { ...out, link: true };
  return { ...out, file: true, note: status === "error", allow: status === "permission", ask: status === "ok", saveAs: status === "ok" && !link.handle };
}

/* ---------- Export: the B-roll list and the storyboard ---------- */
export const KIND_NAME = { broll: "B-roll", motion: "Motion plate", screen: "Screen recording" };
const cell = (s) => String(s ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Kept sketches of the given shots in their order, then any others the list still holds.
function sketchOrder(shots, sketches) {
  const ids = shots.map((s) => s.id).filter((id) => sketches[id]);
  return [...ids, ...Object.keys(sketches).filter((id) => !ids.includes(id))];
}

/**
 * exportBroll(shots, sketches, { title }) → Markdown: one table in the given (script) order with the columns
 * # | Kind | What to show | Over (A-roll line) | How to make it | Check, then "## Sketches". parseBroll reads it back.
 * "Check" is written for people only: parseBroll never reads it, because check flags live with the script's draft.
 * Sketches of the shots come first, then any others the list holds; ids with spaces can't name a fence and are left out.
 */
export function exportBroll(shots, sketches = {}, { title = "" } = {}) {
  const rows = shots.map((s) => `| ${[s.id, KIND_NAME[s.kind] || KIND_NAME.broll, s.what, s.over, s.how, s.check ? "Check" : ""].map(cell).join(" | ")} |`);
  const out = [`# ${cell(title) ? `${cell(title)} · ` : ""}B-roll list`, "",
    "| # | Kind | What to show | Over (A-roll line) | How to make it | Check |", "| --- | --- | --- | --- | --- | --- |", ...rows];
  const ids = sketchOrder(shots, sketches).filter((id) => /^[^\s\]]+$/.test(id) && cleanSketch(sketches[id]));
  if (ids.length) {
    out.push("", "## Sketches");
    for (const id of ids) {
      const v = cleanSketch(sketches[id]);
      if (isImage(v)) out.push("", `![${id}](${v})`);
      else out.push("", `\`\`\`svg ${id}`, sketchLines(v), "```");
    }
  }
  return out.join("\n") + "\n";
}

const BOARD_CSS = `@page { size: A4; margin: 14mm; }
:root { color-scheme: light; --ink: oklch(22% 0 none); --muted: oklch(47% 0 none); --line: oklch(86% 0 none); --accent: oklch(70.4% 0.1915 37.1); --accent-ink: oklch(52% 0.17 37); }
* { box-sizing: border-box; }
body { margin: 0 auto; max-inline-size: 64rem; padding: 2rem 1.5rem; background: oklch(100% 0 none); color: var(--ink); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
h1 { margin-block: 0 1.25rem; font-size: 1.35rem; line-height: 1.25; }
h2 { margin-block: 1.75rem 0.75rem; color: var(--muted); font-size: 0.8rem; }
ol { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: 1.25rem 1rem; margin: 0; padding: 0; list-style: none; }
li { break-inside: avoid; }
.img { display: block; aspect-ratio: 260 / 140; overflow: clip; margin-block-end: 0.45rem; border: 1px solid var(--line); border-radius: 6px; }
.img.empty { border-style: dashed; }
svg { display: block; inline-size: 100%; block-size: auto; }
.img img { display: block; inline-size: 100%; block-size: 100%; object-fit: cover; }
svg :where(path, rect, circle, ellipse, line, polyline, polygon) { fill: none; stroke: var(--ink); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
svg .l { stroke: oklch(70% 0 none); }
svg .o { stroke: var(--accent); stroke-width: 2.2; }
svg .mv { stroke: var(--accent); stroke-width: 1.6; stroke-dasharray: 4 4; }
svg text { fill: var(--ink); stroke: none; font: 600 11px system-ui, sans-serif; }
b { margin-inline-end: 0.4rem; font-variant-numeric: tabular-nums; }
.kind { display: inline-block; margin-inline-end: 0.4rem; padding: 0 0.4rem; border: 1px solid var(--line); border-radius: 99px; color: var(--muted); font-size: 0.68rem; font-weight: 600; vertical-align: 0.1em; }
.kind.motion { border-color: var(--accent); color: var(--accent-ink); }
.over { display: block; margin-block-start: 0.2rem; color: var(--muted); font-style: italic; }
.missing { color: var(--muted); }
@media print { body { max-inline-size: none; padding: 0; } ol { grid-template-columns: repeat(3, 1fr); } }`;

/**
 * exportStoryboard(shots, sketches, { title, missing }) → one self-contained HTML page (no scripts, inline CSS,
 * light colours, A4 print): per shot in the given order its frame, id, kind, what and Over line.
 * Shots for which missing(shot) is true go last, under "Not found in the script". Sketches are sanitised again.
 */
export function exportStoryboard(shots, sketches = {}, { title = "", missing = (s) => !s.blockIds?.length } = {}) {
  const frame = (s) => {
    const img = sketchHtml(sketches[s.id] || "", `Sketch ${s.id}`);
    return `<li${missing(s) ? ' class="missing"' : ""}><span class="img${img ? "" : " empty"}">${img}</span>`
      + `<b>${escHtml(s.id)}</b><span class="kind ${escHtml(s.kind)}">${escHtml(KIND_NAME[s.kind] || KIND_NAME.broll)}</span>${escHtml(s.what)}`
      + `<span class="over">Over: ${escHtml(s.over || "–")}</span></li>`;
  };
  const found = shots.filter((s) => !missing(s)), lost = shots.filter((s) => missing(s));
  const name = String(title || "").trim();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(name ? `${name} · Storyboard` : "Storyboard")}</title>
<style>
${BOARD_CSS}
</style>
</head>
<body>
<h1>${escHtml(name || "Storyboard")}</h1>
<ol>${found.map(frame).join("\n")}</ol>
${lost.length ? `<h2>Not found in the script</h2>\n<ol>${lost.map(frame).join("\n")}</ol>\n` : ""}</body>
</html>
`;
}

/* ---------- Shots added and changed in the editor (step C3) ---------- */
// Every edit changes only its own lines: other rows, notes, headings, sketches and the line endings stay as they were.
function lineEdit(markdown, change) {
  const src = String(markdown ?? "");
  const eol = /\r\n/.test(src) ? "\r\n" : "\n";
  const lines = change(src.replace(/\r\n?/g, "\n"));
  const out = lines.join("\n");
  return eol === "\r\n" ? out.replace(/\n/g, "\r\n") : out;
}
// A row as written: the text before the first pipe, each cell with its own spaces and escapes, and the text after
// the closing pipe. Cells nobody changes are joined back exactly as they were.
function rawRow(line) {
  const parts = line.split(/(?<!\\)\|/);
  const lead = parts.shift();
  const tail = /(?<!\\)\|\s*$/.test(line) ? parts.pop() : null;
  return { lead, cells: parts, tail };
}
const joinRow = (r) => [r.lead, ...r.cells, ...(r.tail != null ? [r.tail] : [])].join("|");
const rawText = (c) => clean((c ?? "").replace(/\\\|/g, "|").trim());

// Without a Kind column a row is motion only when "How" mentions motion, so the written How must agree with the kind:
// a Motion plate's How says "Motion plate" (or "Motion plate: <how>"); a B-roll whose How mentions motion needs a
// Kind column (needsKind), which the table then gets, filled in for every row so they all read back the same.
function howFor(table, shot) {
  const how = (shot.how || "").replace(/\s+/g, " ").trim();
  if (shot.kind !== "motion") return how;
  if (!how) return "Motion plate";
  return table.col.kind < 0 && !/motion/i.test(how) ? `Motion plate: ${how}` : how;
}
// Without a How column nothing in the row can say "motion", so a motion plate needs the Kind column there.
const needsKind = (table, shot) => !!table && table.col.kind < 0 && !table.screen &&
  (table.col.how < 0 ? shot.kind === "motion" : shot.kind === "broll" && /motion/i.test(shot.how || ""));
function withKindColumn(markdown, table) {
  const { rows } = scan(markdown);
  const kindAt = new Map(rows.filter((r) => r.table.start === table.start).map((r) => [r.i, r.shot.kind]));
  const at = table.col.id >= 0 ? table.col.id + 1 : 0;
  return lineEdit(markdown, (text) => {
    const lines = text.split("\n");
    for (let i = table.start; i <= table.end; i++) {
      const r = rawRow(lines[i]);
      while (r.cells.length < at) r.cells.push(" ");
      const value = i === table.start ? "Kind" : i === table.start + 1 ? "---" : kindAt.has(i) ? KIND_NAME[kindAt.get(i)] : "";
      r.cells.splice(at, 0, ` ${value} `);
      lines[i] = joinRow(r);
    }
    return lines;
  });
}
function rowFor(table, shot) {
  const out = Array(Math.max(table.width, 1)).fill("");
  const { col } = table;
  out[col.id] = shot.id;
  if (col.kind >= 0) out[col.kind] = KIND_NAME[shot.kind] || KIND_NAME.broll;
  out[col.what] = shot.what;
  out[col.over] = shot.over;
  if (col.how >= 0) out[col.how] = howFor(table, shot);
  return `| ${out.map(cell).join(" | ")} |`;
}
// Where a shot of this kind goes: the main table, or the Screen recordings table when the main one has no Kind column.
// Only tables with an id column count, so a new row always carries its id; otherwise a standard table is made.
function tableFor(tables, kind) {
  const main = tables.find((t) => !t.screen && t.col.id >= 0);
  if (kind !== "screen" || main?.col.kind >= 0) return { table: main, screen: false };
  return { table: tables.find((t) => t.screen && t.col.id >= 0), screen: true };
}
// A new table goes before the given headings (outside fences), else at the end, with blank lines around it.
function insertBlock(lines, headings, before, block) {
  const at = headings.find(before)?.i ?? -1;
  if (at >= 0) {
    const pad = at > 0 && lines[at - 1].trim() ? [""] : [];
    lines.splice(at, 0, ...pad, ...block, "");
    return;
  }
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, ...(end > 0 ? [""] : []), ...block);
  if (lines.at(-1) !== "") lines.push("");
}

/**
 * addShot(markdown, { id, kind, what, over, how }) → the list with one new row: in the main table, or for a screen
 * recording in "## Screen recordings" (made when missing, before "## Sketches"). A list whose main table has a
 * Kind column keeps every kind there. Pipes are escaped.
 */
export function addShot(markdown, shot) {
  let md = String(markdown ?? "");
  const found = tableFor(scan(md).tables, shot.kind).table;
  if (needsKind(found, shot)) md = withKindColumn(md, found);
  return lineEdit(md, (text) => {
    const { lines, tables, headings } = scan(text);
    const { table, screen } = tableFor(tables, shot.kind);
    if (table) { lines.splice(table.end + 1, 0, rowFor(table, shot)); return lines; }
    if (screen) {
      const head = { width: 3, col: { id: 0, what: 1, over: 2, how: -1, kind: -1 } };
      insertBlock(lines, headings, (h) => /^sketches\b/i.test(h.text.trim()) && h.level <= 2,
        ["## Screen recordings", "", "| # | What to record | Over (A-roll line) |", "| --- | --- | --- |", rowFor(head, shot)]);
    } else {
      const kind = shot.kind === "broll" && /motion/i.test(shot.how || "");
      const head = kind ? { width: 5, col: { id: 0, kind: 1, what: 2, over: 3, how: 4 } } : { width: 4, col: { id: 0, what: 1, over: 2, how: 3, kind: -1 } };
      insertBlock(lines, headings, (h) => h.level === 2,
        [kind ? "| # | Kind | What to show | Over (A-roll line) | How to make it |" : "| # | What to show | Over (A-roll line) | How to make it |",
          kind ? "| --- | --- | --- | --- | --- |" : "| --- | --- | --- | --- |", rowFor(head, shot)]);
    }
    return lines;
  });
}

/** updateShot(markdown, id, { kind, what, over, how }) → the list with that row changed in place (or moved to the
 *  Screen recordings table and back when the kind needs it and there is no Kind column). Unknown id: unchanged. */
export function updateShot(markdown, id, fields) {
  let md = String(markdown ?? "");
  let r = scan(md).rows.find((x) => x.shot.id === id);
  if (!r) return md;
  const next = { ...r.shot, ...Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => v != null)) };
  // A Motion plate turned into something else loses the written "Motion plate" default.
  if (next.kind !== "motion" && r.shot.kind === "motion") next.how = (next.how || "").replace(/^Motion plate(?::\s*|$)/i, "");
  if (r.table.col.kind < 0 && (next.kind === "screen") !== r.table.screen) return addShot(removeRow(md, r.i), next);
  if (needsKind(r.table, next)) { md = withKindColumn(md, r.table); r = scan(md).rows.find((x) => x.shot.id === id); }
  const { col } = r.table;
  return lineEdit(md, (text) => {
    const lines = text.split("\n");
    const row = rawRow(lines[r.i]);
    while (row.cells.length < r.table.width) row.cells.push(" ");
    const set = (k, v) => { if (col[k] >= 0 && rawText(row.cells[col[k]]) !== v) row.cells[col[k]] = ` ${cell(v)} `; };
    set("what", next.what);
    set("over", next.over);
    if (col.how >= 0 && (fields?.how != null || next.kind !== r.shot.kind || next.how !== r.shot.how)) set("how", howFor(r.table, next));
    if (col.kind >= 0 && kindOf(rawText(row.cells[col.kind])) !== next.kind) row.cells[col.kind] = ` ${KIND_NAME[next.kind]} `;
    lines[r.i] = joinRow(row);
    return lines;
  });
}
function removeRow(markdown, at) {
  return lineEdit(markdown, (text) => { const lines = text.split("\n"); lines.splice(at, 1); return lines; });
}

/** removeShot(markdown, id) → the list without that row and without its sketch block. */
export function removeShot(markdown, id) {
  const { rows, fences } = scan(markdown);
  const r = rows.find((x) => x.shot.id === id);
  if (!r) return String(markdown ?? "");
  return lineEdit(markdown, (text) => {
    const lines = text.split("\n");
    const cuts = [[r.i, r.i]];
    for (const f of fences) {
      if (f.id !== id) continue;
      // The blank line before the block goes with it, so no double gap is left behind.
      cuts.push([f.start > 0 && !lines[f.start - 1].trim() ? f.start - 1 : f.start, f.end]);
    }
    for (const [a, z] of cuts.sort((x, y) => y[0] - x[0])) lines.splice(a, z - a + 1);
    return lines;
  });
}

/** removeSketch(markdown, id) → the list without that shot's sketch (a ```svg fence or a picture line), the shot's row
 *  left as it is (step K2: Undo on a picture put in at once, where the shot had no sketch before). */
export function removeSketch(markdown, id) {
  const { fences } = scan(markdown);
  const own = fences.filter((f) => f.id === id);
  if (!own.length) return String(markdown ?? "");
  return lineEdit(markdown, (text) => {
    const lines = text.split("\n");
    for (const f of own.reverse()) {
      const a = f.start > 0 && !lines[f.start - 1].trim() ? f.start - 1 : f.start;
      lines.splice(a, f.end - a + 1);
    }
    return lines;
  });
}

/* ---------- Waiting pictures (step K2) ---------- */
/** The places for pictures sent with upload_image: only pictures not used yet hold one (a use frees it at once).
 *  pictureRoom(entries, now, { max, uploadMs, pictureMs }) → { free, waiting, oldest }: oldest is when the first of
 *  them runs out (a file still to come after uploadMs, a received picture after pictureMs), or 0. */
export function pictureRoom(entries, now, { max, uploadMs, pictureMs }) {
  const list = [...entries];
  const ends = list.filter((p) => !p.busy).map((p) => p.at + (p.data ? pictureMs : uploadMs));
  return { free: Math.max(0, max - list.length), waiting: list.length, oldest: ends.length ? Math.min(...ends) : 0 };
}
/** upload_image's refusal when no place is free: how many are free (none), and when the oldest unused one runs out. */
export function noRoomMessage(room, max, now) {
  const mins = room.oldest ? Math.max(1, Math.ceil((room.oldest - now) / 60_000)) : 0;
  const when = room.oldest ? ` The oldest unused one runs out in ${mins} minute${mins === 1 ? "" : "s"} (${new Date(room.oldest).toISOString()}).` : "";
  return `${room.free} of ${max} places for pictures are free: ${room.waiting} picture${room.waiting === 1 ? " is" : "s are"} sent but not used yet. Use them with sketch_shot or an answer_broll add (each use frees its place at once).${when}`;
}

/** What sketch_shot answers (step K2). outcome: "shown" (a line drawing waits for Keep or Undo), "in" (a picture went
 *  into the list at once), "waits" (it could not be written, so it waits for Keep), "writing" (still being written when
 *  the answer had to go). `left`: shots the person's sketch ask still waits for. */
const SKETCH_RESULTS = {
  shown: "Shown to the person beside the script line and in the storyboard. They choose Keep or Undo.",
  in: "Put into the B-roll list at once: it shows beside the script line and in the storyboard, lightly marked, and the person can undo it.",
  waits: "The B-roll list could not be written just now, so the picture waits beside the script line and in the storyboard for the person's Keep or Undo.",
  writing: "It is being written into the B-roll list (a large list takes a moment); list_asks shows when it is in, and the person can undo it. If list_asks shows the shot undone because the list changed, its imageId can be used again.",
};
export const sketchResult = (outcome, left = []) => SKETCH_RESULTS[outcome] + (left.length ? ` They also asked for sketches of ${left.join(", ")}.` : "");
/** The refusal when the list changed while a picture was being put in: the picture was not used and stays usable. */
export const SKETCH_LIST_CHANGED = "The B-roll list changed meanwhile, so the picture was not put into this list. Its imageId still works: call sketch_shot again if the shot is still there.";
// sketch_shot answers within this, inside the Worker's 10 s for a call.
export const SKETCH_ANSWER_MS = 7000;
/** sketchAnswer(atOnce, left, ms) → the answer once the write settles ("in", "waits", "changed"), or after `ms` the
 *  "writing" answer with `later`, the write's own outcome, so the picture's place is freed only when it went in. */
export function sketchAnswer(atOnce, left = [], ms = SKETCH_ANSWER_MS) {
  let timer;
  const late = new Promise((res) => { timer = setTimeout(() => res("writing"), ms); });
  return Promise.race([atOnce, late]).then((outcome) => {
    clearTimeout(timer);
    if (outcome === "changed") return { error: SKETCH_LIST_CHANGED };
    return outcome === "writing" ? { result: sketchResult("writing", left), later: atOnce } : { result: sketchResult(outcome, left) };
  });
}

/** freeAfter(payload, { free, hold, release }) → the payload to send (without `later`), and the pictures' places
 *  settled: an error keeps them; a plain result frees them at once; a "writing" result (`later`) holds them, then frees
 *  them once the write went in ("in", "waits") and releases them, usable again, if the list changed or it failed. */
export function freeAfter({ later, ...payload }, { free, hold = () => {}, release = () => {} }) {
  if (payload.error) return payload;
  if (!later) { free(); return payload; }
  hold();
  later.then((o) => (o === "changed" ? release() : free()), () => release());
  return payload;
}

/** The next free id: B<n> for B-roll and Motion plate, S<n> for Screen recording, after the highest one in use. */
export function nextShotId(shots, kind, sketches = {}) {
  const prefix = kind === "screen" ? "S" : "B";
  const re = new RegExp(`^${prefix}(\\d+)$`, "i");
  const used = [...shots.map((s) => s.id), ...Object.keys(sketches)];
  return `${prefix}${Math.max(0, ...used.map((id) => Number(id.match(re)?.[1] ?? 0))) + 1}`;
}

/** A new list for a script: its title, the main table and the Screen recordings table. */
export const newList = (title) => `# ${cell(title) || "Script"} · B-roll list\n\n| # | What to show | Over (A-roll line) | How to make it |\n| --- | --- | --- | --- |\n\n## Screen recordings\n\n| # | What to record | Over (A-roll line) |\n| --- | --- | --- |\n`;

const OVER_WORDS = 8;
/**
 * overFor(doc, selection) → the Over text for a selection, so matchOver finds the same spoken blocks again.
 * selection: [{ id, start, end }] for the spoken paras it touches, in order. One block: its first words from the
 * selection's start (about 8, "…" when cut). Several: '"first words…" through "first words of the last block…"'.
 * When a quote would first match another line, it takes more words until it doesn't.
 */
export function overFor(doc, selection) {
  const list = spokenBlocks(doc);
  const sel = (selection || []).filter((s) => list.some((b) => b.id === s.id));
  if (!sel.length) return "";
  const a = list.findIndex((b) => b.id === sel[0].id), z = list.findIndex((b) => b.id === sel.at(-1).id);
  const want = list.slice(a, z + 1).map((b) => b.id).join();
  const first = contentOf(blockById(doc, sel[0].id));
  const fromWords = first.slice(sel[0].start).match(/\S+/g) || [];
  // One block: "…" when fewer words than selected are quoted (or, past the selection, fewer than the line has).
  const selected = z > a ? fromWords.length : (first.slice(sel[0].start, sel[0].end).match(/\S+/g) || []).length;
  const quote = (ws, n, whole) => `"${ws.slice(0, n).join(" ")}${n < whole ? "…" : ""}"`;
  const fromQuote = (n) => quote(fromWords, n, n <= selected ? selected : fromWords.length);
  const tries = (start, len) => { const out = []; for (let n = Math.max(1, start); n <= len; n++) out.push(n); return out.length ? out : [len]; };
  let from = "";
  for (const n of tries(Math.min(OVER_WORDS, selected || fromWords.length), fromWords.length)) {
    from = fromQuote(n);
    if (matchOver(list, from)[0] === list[a].id) break;
  }
  if (z === a) return from;
  const lastWords = contentOf(blockById(doc, sel.at(-1).id)).match(/\S+/g) || [];
  let over = "";
  for (const m of tries(Math.min(OVER_WORDS, lastWords.length), lastWords.length)) {
    over = `${from} through ${quote(lastWords, m, lastWords.length)}`;
    if (matchOver(list, over).join() === want) break;
  }
  return over;
}

/* ---------- The agent suggests B-roll (step C4): answer_broll ---------- */
export const BROLL_LIMITS = { changes: 20, what: 200, how: 120, quote: 500, why: 160, message: 200, id: 20 };
const OPS = ["add", "update", "remove"];
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const oneLine = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/** The spoken text a quote stands for, as a selection [{ id, start, end }] across spoken paras ([] when not found).
 *  The quote must be word for word; any run of spaces or line breaks matches any other, so it may span lines. */
export function quoteSelection(doc, quote) {
  const words = String(quote ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const paras = outline(doc).sections.filter((s) => s.spoken).flatMap((s) => s.blocks.filter((b) => b.type === "para"));
  let joined = "";
  const spans = paras.map((b) => { const text = contentOf(b), start = joined.length ? joined.length + 2 : 0; joined += (joined.length ? "\n\n" : "") + text; return { id: b.id, start, end: start + text.length }; });
  // Whole words only: a quote may not start or end inside a word ("ackup", "spare ke").
  const edge = (w, side) => (/[\p{L}\p{N}]/u.test(side === "start" ? w[0] : w.at(-1)) ? (side === "start" ? "(?<![\\p{L}\\p{N}])" : "(?![\\p{L}\\p{N}])") : "");
  const m = new RegExp(edge(words[0], "start") + words.map(escRe).join("\\s+") + edge(words.at(-1), "end"), "u").exec(joined);
  if (!m) return [];
  const a = m.index, z = m.index + m[0].length;
  return spans.filter((p) => p.start < z && p.end > a).map((p) => ({ id: p.id, start: Math.max(a, p.start) - p.start, end: Math.min(z, p.end) - p.start }));
}

/** Asks answer_broll may answer: "Suggest B-roll" on a selection, a free "Ask…" on a selection, and "Plan B-roll". */
export const brollAskAllowed = (ask) => (ask?.scope === "selection" && (ask.action === "broll" || ask.action === "ask")) || (ask?.scope === "broll" && ask.action === "plan");

/**
 * checkBrollAnswer(ask, args, { doc, shots }) → { answer: { kind: "broll", changes, message? } } or { error } for the agent.
 * Each add gets its Over from the quote (quoteSelection + overFor), so it matches the same lines as a person's selection.
 */
export function checkBrollAnswer(ask, args, { doc, shots = [] } = {}) {
  if (!ask) return { error: "Unknown ask. Call list_asks or wait_for_asks for current ask ids." };
  if (!brollAskAllowed(ask)) return { error: ask.scope === "broll" ? "This ask is for sketches. Answer it with sketch_shot." : "This ask is not about B-roll. Answer it with answer_ask." };
  if (ask.status !== "waiting" && ask.status !== "taken") return { error: `This ask is finished (${ask.status}).` };
  const a = isObj(args) ? args : {};
  const L = BROLL_LIMITS;
  if (!Array.isArray(a.changes) || !a.changes.length) return { error: `changes must be a list of 1 to ${L.changes} changes.` };
  if (a.changes.length > L.changes) return { error: `At most ${L.changes} changes.` };
  if (a.message != null && typeof a.message !== "string") return { error: "message must be text." };
  if (typeof a.message === "string" && a.message.length > L.message) return { error: `message is longer than ${L.message} characters.` };
  const known = new Map(shots.map((s) => [s.id, s]));
  const touched = new Set();
  const idList = shots.length ? shots.map((s) => s.id).join(", ") : "none yet";
  const changes = [];
  for (const [i, c] of a.changes.entries()) {
    const at = `Change ${i + 1}`;
    if (!isObj(c) || !OPS.includes(c.op)) return { error: `${at}: op must be add, update or remove.` };
    for (const k of ["id", "kind", "what", "how", "quote", "why"]) {
      if (c[k] != null && typeof c[k] !== "string") return { error: `${at}: ${k} must be text.` };
      if (typeof c[k] === "string" && L[k] && c[k].length > L[k]) return { error: `${at}: ${k} is longer than ${L[k]} characters.` };
    }
    if (c.kind != null && !KINDS.includes(c.kind)) return { error: `${at}: kind must be broll, motion or screen.` };
    // A new shot may bring its sketch (step I): it is kept with the shot. A shot in the list gets one with sketch_shot.
    let sketch = "";
    if (c.sketch != null) {
      if (c.op !== "add") return { error: `${at}: a sketch goes with an add. For a shot in the list, use sketch_shot.` };
      if (typeof c.sketch !== "string") return { error: `${at}: sketch must be text.` };
      const max = c.sketch.startsWith("data:") ? IMAGE_MAX : SKETCH_MAX;
      if (c.sketch.length > max) return { error: `${at}: sketch is longer than ${max} characters.` };
      sketch = c.sketch.trim() ? cleanSketch(c.sketch) : "";
      if (c.sketch.trim() && !sketch) return { error: `${at}: nothing drawable is left of the sketch after cleaning. Use path, rect, circle, ellipse, line, polyline, polygon or text with class s, l, o or mv.` };
    }
    const why = oneLine(c.why);
    if (c.op === "add") {
      if (!c.kind) return { error: `${at}: an add needs kind (broll, motion or screen).` };
      if (!oneLine(c.what)) return { error: `${at}: an add needs what.` };
      if (!oneLine(c.quote)) return { error: `${at}: an add needs quote, the exact spoken text the shot goes over.` };
      if (c.kind === "screen" && oneLine(c.how)) return { error: `${at}: a screen recording has no how.` };
      const sel = quoteSelection(doc, c.quote);
      if (!sel.length) return { error: `${at}: the quote is not in the spoken text word for word: ${JSON.stringify(oneLine(c.quote).slice(0, 80))}.` };
      changes.push({ op: "add", kind: c.kind, what: oneLine(c.what), how: c.kind === "screen" ? "" : oneLine(c.how), quote: oneLine(c.quote), over: overFor(doc, sel), why, ...(sketch ? { sketch } : {}), state: "open" });
      continue;
    }
    const shot = known.get(c.id);
    if (!shot) return { error: `${at}: unknown shot id ${JSON.stringify(c.id ?? "")}. Shot ids: ${idList}.` };
    if (touched.has(c.id)) return { error: `${at}: ${c.id} already has a change in this answer. Send one change per shot.` };
    touched.add(c.id);
    if (c.op === "remove") { changes.push({ op: "remove", id: c.id, why, state: "open" }); continue; }
    if (c.what == null && c.how == null && c.kind == null) return { error: `${at}: an update needs what, how or kind.` };
    if (c.what != null && !oneLine(c.what)) return { error: `${at}: what can't be empty.` };
    if ((c.kind ?? shot.kind) === "screen" && oneLine(c.how)) return { error: `${at}: a screen recording has no how.` };
    changes.push({ op: "update", id: c.id, ...(c.what != null ? { what: oneLine(c.what) } : {}), ...(c.how != null ? { how: oneLine(c.how) } : {}), ...(c.kind != null ? { kind: c.kind } : {}), why, state: "open" });
  }
  const message = oneLine(a.message);
  return { answer: { kind: "broll", changes, ...(message ? { message } : {}) } };
}

/** Keep one change: the same file the C3 functions give. An add gets the next free id at that moment, and its
 *  sketch, when it brought one, goes under "## Sketches" with that id. */
export function applyBrollChange(markdown, c) {
  if (c.op === "add") {
    const now = parseBroll(markdown);
    const id = nextShotId(now.shots, c.kind, now.sketches);
    const md = addShot(markdown, { id, kind: c.kind, what: c.what, over: c.over, how: c.how });
    const svg = c.sketch ? cleanSketch(c.sketch) : "";
    return svg ? setSketch(md, id, svg) : md;
  }
  if (c.op === "update") return updateShot(markdown, c.id, { what: c.what, how: c.kind === "screen" ? undefined : c.how, kind: c.kind });
  if (c.op === "remove") return removeShot(markdown, c.id);
  return String(markdown ?? "");
}
/**
 * Keep several in order, in one write: each change sees the ones before it. applied[i] says whether change i
 * really applied: an update or remove whose shot is no longer in the list changes nothing and is not kept.
 */
export function applyBrollChangesReport(markdown, changes) {
  let md = String(markdown ?? "");
  const applied = [];
  for (const c of changes) {
    if (c.op !== "add" && !parseBroll(md).shots.some((s) => s.id === c.id)) { applied.push(false); continue; }
    md = applyBrollChange(md, c);
    applied.push(true);
  }
  return { markdown: md, applied };
}
export const applyBrollChanges = (markdown, changes) => applyBrollChangesReport(markdown, changes).markdown;
/** Open updates and removals for shots that are gone: they can no longer apply, so they become undone.
 *  skip(i): a change still being kept, which the Keep itself settles. */
export function dropGone(answer, shots, skip = () => false) {
  const ids = new Set(shots.map((s) => s.id));
  let dropped = 0;
  (answer?.changes || []).forEach((c, i) => { if (c.state === "open" && c.op !== "add" && !ids.has(c.id) && !skip(i)) { c.state = "undone"; dropped++; } });
  return dropped;
}

/** What the agent sees of an ask in wait_for_asks: a selection's quote and context, a sketch ask's shots, or the
 *  whole spoken text; a plan ask also gets the B-roll list; like and voice asks get the voice guide. */
export function askForAgent(a, { spokenText = "", shots = null, voiceGuide = "" } = {}) {
  const out = { id: a.id, scope: a.scope, action: a.action, instruction: a.instruction, createdAt: a.createdAt };
  if (a.scope === "selection") Object.assign(out, { quote: a.quote, context: a.context, section: a.section });
  else if (a.scope === "broll" && a.action === "sketch") out.shots = a.shots;
  else out.spokenText = spokenText;
  if (a.action === "plan") out.broll = (shots || []).map(forAgent);
  if ((a.action === "like" || a.action === "voice") && voiceGuide) out.voiceGuide = voiceGuide;
  return out;
}
/** The changes a Keep writes: only the ones still open. An undone change writes nothing. */
export const changesToKeep = (answer, ns) => ns.map((n) => answer?.changes?.[n]).filter((c) => c?.state === "open");
/** After a Keep or Undo: the ask's final status once every change is done ("kept" when any was kept), else null. */
export function settleBroll(answer) {
  const list = answer?.changes || [];
  if (list.some((c) => c.state === "open")) return null;
  return list.some((c) => c.state === "kept") ? "kept" : "undone";
}
