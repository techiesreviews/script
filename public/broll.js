// The B-roll list next to a script: parse its Markdown tables, match each shot's "Over" line to the
// spoken blocks it covers, flag shots whose lines changed, and keep storyboard sketches in its
// "## Sketches" section. Pure module: no DOM, no network. Imported by the app and by the tests.
import { outline, contentOf, blockById } from "./doc.js";

export const SKETCH_MAX = 8 * 1024;
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
  return { id: find(/^(#|id|shot)$/i), what: find(/^what/i), over: find(/^over/i), how: find(/^how/i), record: head.some((h) => /record/i.test(h)) };
}

/**
 * parseBroll(markdown) → { shots: [{ id, what, over, how, kind }], sketches: { [id]: svg } }
 * Main table: # | What to show | Over (A-roll line) | How to make it. A table under a "Screen recordings"
 * heading (or with "What to record") lists screen recordings. Rows whose "How" mentions motion are motion plates.
 */
export function parseBroll(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const shots = [], sketches = {}, seen = new Set();
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
      if (f[2].toLowerCase() === "svg" && f[3]) {
        const svg = sanitizeSvg(body.join("\n"));
        if (svg) sketches[f[3]] = svg;
      }
      i = j;
      continue;
    }
    const h = line.match(/^[ \t]{0,3}#{1,6}[ \t]+(.*)$/);
    if (h) { heading = h[1]; continue; }
    if (!/^[ \t]*\|/.test(line) || !SEP_ROW_RE.test(lines[i + 1] ?? "")) continue;
    const col = columns(cells(line));
    i += 1;
    const table = [];
    while (i + 1 < lines.length && /^[ \t]*\|/.test(lines[i + 1])) table.push(cells(lines[++i]));
    if (col.what < 0 || col.over < 0) continue;
    const screen = /screen/i.test(heading) || col.record;
    for (const row of table) {
      const get = (k) => (col[k] >= 0 ? clean(row[col[k]] ?? "") : "");
      const what = get("what"), over = get("over"), how = get("how");
      if (!what && !over) continue;
      let id = get("id") || `#${shots.length + 1}`;
      for (let n = 2; seen.has(id); n++) id = `${get("id") || "#"}·${n}`;
      seen.add(id);
      shots.push({ id, what, over, how, kind: screen ? "screen" : /motion/i.test(how) ? "motion" : "broll" });
    }
  }
  return { shots, sketches };
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
    .map((b) => ({ id: b.id, n: ` ${normalize(contentOf(b))} ` }));
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
  return blockIds.map((id) => { const b = blockById(doc, id); return b ? contentOf(b) : "\u0000"; }).join("\u0001");
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

/** setSketch(markdown, id, svg) → the B-roll Markdown with the sketch stored as ```svg ID … ``` under "## Sketches". */
export function setSketch(markdown, id, svg) {
  const src = String(markdown ?? "");
  const eol = /\r\n/.test(src) ? "\r\n" : "\n";
  const text = src.replace(/\r\n?/g, "\n");
  const fence = `\`\`\`svg ${id}\n${sketchLines(svg)}\n\`\`\``;
  const existing = new RegExp(`^\`\`\`svg[ \\t]+${escRe(id)}[ \\t]*\\n(?:[\\s\\S]*?\\n)?\`\`\`[ \\t]*$`, "m");
  let out;
  if (existing.test(text)) out = text.replace(existing, () => fence);
  else {
    const lines = text.split("\n");
    const h = lines.findIndex((l) => /^##[ \t]+Sketches[ \t]*$/i.test(l));
    if (h < 0) out = `${text.replace(/\s+$/, "")}${text.trim() ? "\n\n" : ""}## Sketches\n\n${fence}\n`;
    else {
      let end = lines.length, inFence = false;
      for (let i = h + 1; i < lines.length; i++) {
        if (FENCE_RE.test(lines[i])) inFence = !inFence;
        else if (!inFence && /^#{1,2}[ \t]/.test(lines[i])) { end = i; break; }
      }
      const last = end === lines.length;
      let k = end;
      while (k > h + 1 && !lines[k - 1].trim()) k--;
      const add = ["", ...fence.split("\n"), ""];
      lines.splice(k, end - k, ...add);
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
  if (ask.scope !== "broll") return { error: "sketch_shot only answers \"Ask for sketches\" asks. Use answer_ask for this one." };
  if (!["waiting", "taken", "answered"].includes(ask.status)) return { error: `This ask is finished (${ask.status}).` };
  const a = args && typeof args === "object" ? args : {};
  if (typeof a.shotId !== "string" || !(ask.shots || []).some((s) => s.id === a.shotId)) return { error: `shotId must be one of: ${(ask.shots || []).map((s) => s.id).join(", ")}.` };
  if (typeof a.svg !== "string" || !a.svg.trim()) return { error: "svg is required." };
  if (a.svg.length > SKETCH_MAX) return { error: `svg is longer than ${SKETCH_MAX} characters.` };
  const svg = sanitizeSvg(a.svg);
  if (!svg) return { error: "Nothing drawable is left after cleaning. Use path, rect, circle, ellipse, line, polyline, polygon or text with class s, l, o or mv." };
  return { svg };
}
