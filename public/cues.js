// Cues in the script (fleet issue #14, Lex 2026-11-04), shown as bold: "**words**" in a spoken line, the standard Markdown
// bold (the fleet lead's decision after the release review; first built as "==words==", never released, so no script
// holds that). Always on (Lex, 2026-11-06). The prompter shows "**" as literal asterisks today, so its export strips them.
// Rules like links (links.js): words on one line, no brackets or "*" inside, at least one letter or digit. A pair starts
// and ends at word boundaries: no letter, digit or "*" outside it, no space inside its edges, so a**b, **kwargs, 2**3 and
// a ** b are plain text.
// Bold links (Lex 2026-11-07): bold may sit inside a link's words ("[a **b** c](url)") or hold whole links ("**[a](url)**",
// "**a [b](url) c**"), never cut across a link's edge; B and the link icon split a bold stretch at a link's edge so the
// marks nest. Link lines ("- Label: https://…") stay off limits.
// Pure: no DOM. app.js draws cues with the links' show/hide trick; changes.js plans the agent's cue changes.
import { textLinks, isLinkLine, spokenText, quoteRe, overlaps, safeUrl } from "./links.js";

export const CUE_LIMITS = { cues: 30 };
const CUE = /(?<![\p{L}\p{N}\p{M}*])\*\*([^\s*[\]](?:[^*[\]\n]*[^\s*[\]])?)\*\*(?![\p{L}\p{N}\p{M}*])/gu;
const WORDY = /[\p{L}\p{N}]/u;
const BAD_WORDS = /[*[\]\n]/;
// Whole words for a cue: a letter, digit or combining mark on both sides of an edge means the edge cuts a word (or,
// for a combining mark, a letter). Languages written without spaces only get cues on whole runs of text.
export const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const wholeWords = (t, s, e) => !(WORD_CHAR.test(t[s] ?? "") && WORD_CHAR.test(t[s - 1] ?? "")) && !(WORD_CHAR.test(t[e - 1] ?? "") && WORD_CHAR.test(t[e] ?? ""));

/* ---------- How bold looks (Lex 2026-11-06): orange and bold, or the person's own colours ----------
   Kept per person. null: not chosen, so the page's own look (--bold-ink in app.css, no background). Only "#rrggbb" values
   reach the page's CSS. A choice saved before 2026-11-06 counted only with `own: true`. */
const HEX = /^#[0-9a-f]{6}$/i;
export const boldStyle = (stored) => ({
  color: stored?.own !== false && HEX.test(stored?.color) ? stored.color : null,
  background: stored?.own !== false && HEX.test(stored?.background) ? stored.background : null,
});
// The ready-made colours by B (Lex 2026-11-07, Variant A); the default orange and "None" are the null of boldStyle. Saved as
// `hex` (the night look); light mode shows each one's `light` partner, so bold words stay readable on white. `was`: the
// values the first build of step U saved, before the release review made them readable; they count as the same swatch.
export const BOLD_SWATCHES = {
  color: [
    { name: "Yellow", hex: "#fbd530", light: { name: "Yellow", hex: "#8a6500" } },
    { name: "White", hex: "#f3f4fc", light: { name: "Black", hex: "#26262e" } },
    { name: "Pink", hex: "#fb75bb", light: { name: "Pink", hex: "#b8226e" } },
    { name: "Cyan", hex: "#3adaf2", light: { name: "Cyan", hex: "#00708a" } },
    { name: "Green", hex: "#5edb81", light: { name: "Green", hex: "#1f7a3c" } },
  ],
  background: [
    { name: "Yellow", hex: "#fff3a0", was: ["#fbd530"], light: { name: "Yellow", hex: "#fff3a0" } },
    { name: "Dark orange", hex: "#6e1e07", was: ["#96290a"], light: { name: "Peach", hex: "#ffdccb" } },
    { name: "Indigo", hex: "#34317f", was: ["#3c3990"], light: { name: "Lavender", hex: "#dedcff" } },
    { name: "Teal", hex: "#00434a", was: ["#005b60"], light: { name: "Mint", hex: "#c8efec" } },
    { name: "Red", hex: "#731519", was: ["#8d1a1e"], light: { name: "Rose", hex: "#ffd7d7" } },
  ],
};
/** The ready-made colour a saved value is (its own hex or one it `was`), or undefined for your own colour or none. */
export const boldSwatch = (kind, value) => {
  const v = value?.toLowerCase();
  return v ? BOLD_SWATCHES[kind].find((x) => x.hex === v || x.was?.includes(v)) : undefined;
};
/** What the page shows for a boldStyle in a mode ("dark" or "light"): a ready-made colour as that mode's look; your own
 *  colours and nothing chosen as they are. */
export function boldShown(style, mode) {
  const shown = (kind) => {
    const s = boldSwatch(kind, style[kind]);
    return s ? (mode === "light" ? s.light.hex : s.hex) : style[kind];
  };
  return { color: shown("color"), background: shown("background") };
}

/* ---------- Reading cues ---------- */
// The link lines ("- Label: https://…"), where cues may not be.
function lineRanges(text) {
  const out = [];
  let at = 0;
  for (const line of text.split("\n")) {
    if (isLinkLine(line)) out.push([at, at + line.length]);
    at += line.length + 1;
  }
  return out;
}
// Text links and link lines.
const linkRanges = (text) => [...textLinks(text).map((l) => [l.start, l.end]), ...lineRanges(text)];
// The text with each text link made one run of a sign that is no letter, digit, space, "*" or bracket: a bold stretch may
// hold whole links, and its own rules read the rest.
const MASK = "\uE000";
function maskLinks(text, links = textLinks(text)) {
  let out = "", at = 0;
  for (const l of links) { out += text.slice(at, l.start) + MASK.repeat(l.end - l.start); at = l.end; }
  return out + text.slice(at);
}
// Bold words: no "*", bracket or line break outside the links they hold, and a letter or digit among what is spoken.
const badWords = (s) => BAD_WORDS.test(maskLinks(s));
const wordy = (s) => WORDY.test(spokenText(s));
/** The cues in a block's content: [{ start, end, words: { start, end }, label, cue: true }] (content offsets, the
 *  same shape as textLinks() so the editor draws both alike), by where they start. A cue may sit inside a link's words or
 *  hold whole links; a "**…**" across a link's edge, or in a link line, is not a cue. */
export function textCues(content) {
  const text = String(content ?? ""), links = textLinks(text), lines = lineRanges(text);
  const out = [];
  const read = (src, base) => {
    for (const m of src.matchAll(CUE)) {
      const start = base + m.index, end = start + m[0].length, label = text.slice(start + 2, end - 2);
      if (!wordy(label) || overlaps(lines, start, end)) continue;
      out.push({ start, end, words: { start: start + 2, end: end - 2 }, label, cue: true });
    }
  };
  read(maskLinks(text, links), 0);
  for (const l of links) read(text.slice(l.words.start, l.words.end), l.words.start);
  return out.sort((x, y) => x.start - y.start || y.end - x.end);
}
// Which characters are not spoken: the cues' "**", each link's "[" and "](address)", and the link lines.
function markup(text, cues = textCues(text), links = textLinks(text)) {
  const m = new Uint8Array(text.length);
  for (const c of cues) m.fill(1, c.start, c.words.start).fill(1, c.words.end, c.end);
  for (const l of links) m.fill(2, l.start, l.words.start).fill(2, l.words.end, l.end);
  for (const [a, b] of lineRanges(text)) m.fill(3, a, b);
  return m;
}
// The text without some characters (gone[i] set) and where each kept one is: { text, map } (map[i]: the offset in `text`
// of out[i]; map[out.length] is text.length).
function without(text, gone) {
  let out = "";
  const map = [];
  for (let i = 0; i < text.length; i++) if (!gone[i]) { map.push(i); out += text[i]; }
  map.push(text.length);
  return { text: out, map };
}
const cueMarks = (text, cues = textCues(text)) => markup(text, cues, []).map((x) => (x === 1 ? 1 : 0));
/** An AI's new text, when the text it was asked about held marks: a "**" it copied that makes no cue goes. Ordinary text
 *  stays: a letter or digit on both sides (a**b), or spaces on both sides (a ** b). */
export function dropLoneMarks(text) {
  const t = String(text ?? ""), cues = textCues(t);
  let out = "", at = 0;
  for (const m of t.matchAll(/(?<!\*)\*\*(?!\*)/g)) {
    const i = m.index, e = i + 2, l = t[i - 1] ?? "", r = t[e] ?? "";
    if (cues.some((c) => i === c.start || e === c.end)) continue;
    if ((WORD_CHAR.test(l) && WORD_CHAR.test(r)) || (/\s/.test(l) && /\s/.test(r))) continue;
    out += t.slice(at, i);
    at = e;
  }
  return out + t.slice(at);
}
/** The text with each cue replaced by its words (also cues inside links and around them). */
export function stripCues(text) {
  const t = String(text ?? "");
  return without(t, cueMarks(t)).text;
}
// Where each character of `from` is in `to` (when only "*" marks differ), and which ones stayed.
function marksAlign(from, to) {
  const at = new Array(from.length + 1), stayed = new Array(from.length).fill(false);
  let i = 0, j = 0;
  while (i < from.length) {
    if (j < to.length && from[i] === to[j]) { stayed[i] = true; at[i++] = j++; continue; }
    if (from[i] === "*") { at[i++] = j; continue; }
    if (j < to.length && to[j] === "*") { j++; continue; }
    at[i++] = j;
  }
  at[from.length] = to.length;
  return { at, stayed };
}
/** Where each offset of `from` is in `to`, when only "*" marks differ between them: an anchor follows its own characters,
 *  never a search through the text. An offset on a mark goes to the next character that stays. */
export function marksMap(from, to) {
  const { at } = marksAlign(from, to);
  return (x) => at[x];
}
/** Where a range of `from` goes in `to`: from its first character to just after its last one that stays, so its end never
 *  slides past a closing mark. */
export function marksRange(from, to) {
  const { at, stayed } = marksAlign(from, to);
  return (start, end) => {
    let last = end - 1;
    while (last >= start && !stayed[last]) last--;
    return { start: at[start], end: last >= start ? at[last] + 1 : at[start] };
  };
}
/** A quote read without the marks (the agent gets the spoken text that way), found across a cue's edge: its range, only
 *  as far as was quoted, and the text there as it is now. A rewrite of it takes in the whole cue and keeps the cue's other
 *  words (widenOverCues), so no spoken word is lost and no lone "**" is left. null when not found. */
export function quoteAcrossCues(content, quote) {
  const view = plainView(content);
  if (!view || !quote) return null;
  const i = view.plain.indexOf(quote);
  if (i < 0) return null;
  const start = view.map[i], end = view.map[i + quote.length - 1] + 1;
  return { start, end, quote: String(content).slice(start, end) };
}
/** The text without its cues' marks and where each of its characters is in the text:
 *  { plain, map } (map[i] is the offset in `content` of plain[i]), or null when there is no cue. */
export function plainView(content) {
  const text = String(content ?? ""), cues = textCues(text);
  if (!cues.length) return null;
  const v = without(text, cueMarks(text, cues));
  return { plain: v.text, map: v.map.slice(0, -1) };
}
/** What is spoken, for finding the agent's quotes: the text without the cues' marks, the links' "[" and "](address)" and
 *  the link lines (kept with `lines`, so a quote found there can be named): { text, map } (map[i]: the offset in `content`
 *  of text[i]; map[text.length] is content.length). */
export function spokenView(content, { lines = false } = {}) {
  const text = String(content ?? ""), m = markup(text);
  return without(text, lines ? m.map((x) => (x === 3 ? 0 : x)) : m);
}
/** The spoken letters and digits in order, each with whether it is bold: [{ ch, bold }] (the safety check that a change
 *  of marks never changes, loses or un-bolds a word). */
export function boldWords(content) {
  const text = String(content ?? ""), cues = textCues(text), m = markup(text, cues), bold = new Uint8Array(text.length);
  for (const c of cues) bold.fill(1, c.words.start, c.words.end);
  const out = [];
  for (let i = 0; i < text.length; i++) if (!m[i] && WORD_CHAR.test(text[i])) out.push({ ch: text[i], bold: !!bold[i] });
  return out;
}
/** What is spoken (links.js spokenText) without the cue marks: for word counts and the camera script. */
export const spokenWords = (content) => spokenText(stripCues(content));

/* ---------- Ctrl/Cmd+B on a selection ---------- */
// The selection without the spaces at its ends.
function trimRange(content, start, end) {
  let s = Math.max(0, Math.min(start, end)), e = Math.min(content.length, Math.max(start, end));
  while (s < e && /\s/.test(content[s])) s++;
  while (e > s && /\s/.test(content[e - 1])) e--;
  return [s, e];
}
// Apply edits made against `text`: [{ at, del, ins, order }] (order: which goes first of the insertions at one place).
function applyOps(text, ops) {
  const list = [...ops].sort((x, y) => x.at - y.at || (x.order ?? 0) - (y.order ?? 0));
  let out = "", at = 0;
  for (const o of list) { out += text.slice(at, o.at) + (o.ins || ""); at = Math.max(at, o.at + (o.del || 0)); }
  return out + text.slice(at);
}
/** Where a range of the text goes through these edits (addLink's or removeLink's `ops`): from its first character to
 *  just after its last one that stays, as marksRange does; text put in where a range starts goes before it. */
export function opsRange(text, ops) {
  const n = String(text ?? "").length, stayed = new Array(n).fill(true), put = new Map(), at = new Array(n + 1);
  for (const o of ops) {
    for (let i = o.at; i < o.at + (o.del || 0); i++) stayed[i] = false;
    if (o.ins) put.set(o.at, (put.get(o.at) || 0) + o.ins.length);
  }
  let j = 0;
  for (let i = 0; i <= n; i++) { j += put.get(i) || 0; at[i] = j; if (i < n && stayed[i]) j++; }
  return (start, end) => {
    let last = end - 1;
    while (last >= start && !stayed[last]) last--;
    return { start: at[start], end: last >= start ? at[last] + 1 : at[start] };
  };
}
// A change of marks only: the same spoken words, and the same of them bold (`sameBold`).
const sameWords = (a, b) => spokenWords(a) === spokenWords(b);
const sameBold = (a, b) => JSON.stringify(boldWords(a)) === JSON.stringify(boldWords(b));
// The spoken characters of start…end that are not spaces.
function spokenIn(text, s, e, m) {
  const out = [];
  for (let i = s; i < e; i++) if (!m[i] && !/\s/.test(text[i])) out.push(i);
  return out;
}

/** Is every selected word bold (the button shows pressed, a toggle takes the bold off)? */
export function cueSelected(content, start, end) {
  const text = String(content ?? ""), [s, e] = trimRange(text, start, end);
  if (e <= s) return false;
  const cues = textCues(text), at = spokenIn(text, s, e, markup(text, cues));
  return at.length > 0 && at.every((i) => cues.some((c) => i >= c.words.start && i < c.words.end));
}
/**
 * Toggle bold on the selected words (start…end, content offsets, already snapped to whole words):
 * every selected word bold: the marks of the bold stretches they are in go, their words stay; otherwise the selection and
 * every cue it touches become one cue (half a cue or across two joins into one), holding the links it covers whole and
 * split at the edge of a link it half covers ("**a** [**b** c](url)"); the whole words of one link make the whole link bold.
 * Returns { content, start, end, cue } (start…end: the words, to select again; cue: whether they are bold now; from…to:
 * the stretch of the old content it changes) or null when nothing can change (no words, a line break, a bracket or "*"
 * in the way, a link line).
 */
export function toggleCue(content, start, end) {
  const text = String(content ?? "");
  const [s, e] = trimRange(text, start, end);
  if (e <= s || overlaps(lineRanges(text), s, e)) return null;
  const cues = textCues(text), m = markup(text, cues);
  if (cueSelected(text, s, e)) {
    const at = spokenIn(text, s, e, m);
    const touched = cues.filter((c) => at.some((i) => i >= c.words.start && i < c.words.end));
    const gone = new Uint8Array(text.length);
    for (const c of touched) gone.fill(1, c.start, c.words.start).fill(1, c.words.end, c.end);
    const v = without(text, gone), pos = (x) => { let n = 0; while (n < v.map.length - 1 && v.map[n] < x) n++; return n; };
    const from = Math.min(...touched.map((c) => c.start)), to = Math.max(...touched.map((c) => c.end));
    return { content: v.text, start: pos(touched[0].words.start), end: pos(Math.max(...touched.map((c) => c.words.end))), cue: false, from, to };
  }
  const touched = cues.filter((c) => s < c.end && e > c.start);
  let from = Math.min(s, ...touched.map((c) => c.start)), to = Math.max(e, ...touched.map((c) => c.end));
  // An edge in a link's hidden Markdown goes to the link's edge.
  for (const l of textLinks(text)) {
    if (from > l.start && from < l.words.start) from = l.start;
    else if (from >= l.words.end && from < l.end) from = l.end;
    if (to > l.start && to <= l.words.start) to = l.start;
    else if (to > l.words.end && to < l.end) to = l.end;
  }
  // All of a link's words and more: the bold holds the whole link. The editor hides the Markdown, so a selection ends on the
  // link's last word (its words' end), not after its address, and starts on its first word.
  for (const l of textLinks(text)) {
    const [ws, we] = trimRange(text, l.words.start, l.words.end);
    if (from >= l.words.start && from <= ws && to >= l.end) from = l.start;
    if (to <= l.words.end && to >= we && from <= l.start) to = l.end;
  }
  if (to <= from) return null;
  // The touched cues' marks go; the new marks go around the pieces.
  const gone = new Uint8Array(text.length);
  for (const c of touched) gone.fill(1, c.start, c.words.start).fill(1, c.words.end, c.end);
  const v = without(text, gone), t = v.text;
  const pos = (x) => { let n = 0; while (n < v.map.length - 1 && v.map[n] < x) n++; return n; };
  let pieces = [[pos(from), pos(to)]];
  const links = textLinks(t);
  for (const l of links) {
    const next = [];
    for (const [a, b] of pieces) {
      if (b <= l.start || a >= l.end || (a <= l.start && b >= l.end) || (a >= l.words.start && b <= l.words.end)) { next.push([a, b]); continue; }
      if (a < l.start) next.push([a, l.start]);
      next.push([Math.max(a, l.words.start), Math.min(b, l.words.end)]);
      if (b > l.end) next.push([l.end, b]);
    }
    pieces = next;
  }
  pieces = pieces.map(([a, b]) => trimRange(t, a, b)).filter(([a, b]) => b > a && wordy(t.slice(a, b)));
  if (!pieces.length || pieces.some(([a, b]) => badWords(t.slice(a, b)))) return null;
  // All of one link's words: the whole link goes bold, marks outside it (when nothing that makes them plain is next to it).
  pieces = pieces.map(([a, b]) => {
    const l = links.find((x) => a >= x.words.start && b <= x.words.end);
    if (!l) return [a, b];
    const [ws, we] = trimRange(t, l.words.start, l.words.end), out = (ch) => !WORD_CHAR.test(ch ?? "") && ch !== "*";
    return ws === a && we === b && out(t[l.start - 1]) && out(t[l.end]) ? [l.start, l.end] : [a, b];
  });
  const next = applyOps(t, pieces.flatMap(([a, b]) => [{ at: a, ins: "**", order: 1 }, { at: b, ins: "**", order: 0 }]));
  const after = textCues(next), placed = pieces.map(([a, b], k) => [a + 4 * k, b + 4 * k + 4]);
  if (after.length !== cues.length - touched.length + pieces.length || !placed.every(([a, b]) => after.some((c) => c.start === a && c.end === b))) return null;
  if (!sameWords(text, next)) return null;
  return { content: next, start: placed[0][0] + 2, end: placed.at(-1)[1] - 2, cue: true, from, to };
}

/* ---------- The link icon (Lex 2026-11-07) ---------- */
/** What the link icon does on the selected words: { state: "off" } (plain or bold words: it can link them), { state: "on",
 *  link } (all inside one link: it removes it; textLinks() shape), "mixed" (part link, part plain, or across lines: grey)
 *  or "none" (no words, or a link line). */
export function linkState(content, start, end) {
  const text = String(content ?? ""), links = textLinks(text);
  let [s, e] = trimRange(text, start, end);
  // An edge in a link's hidden Markdown (a drag that starts right after its last word, or ends right before its first)
  // goes outside the link: only Markdown inside the selection counts.
  for (const l of links) {
    if (s >= l.words.end && s < l.end) s = l.end;
    if (e > l.start && e <= l.words.start) e = l.start;
  }
  [s, e] = trimRange(text, s, Math.max(s, e));
  if (e <= s || overlaps(lineRanges(text), s, e)) return { state: "none" };
  if (text.slice(s, e).includes("\n")) return { state: "mixed" };
  const m = markup(text, textCues(text), links);
  const seen = new Set();
  let plain = false, linkMarks = false;
  for (let i = s; i < e; i++) {
    const l = links.find((x) => i >= x.start && i < x.end);
    if (m[i] === 2) { linkMarks = true; continue; }
    if (m[i] || /\s/.test(text[i])) continue;
    if (l) seen.add(l); else plain = true;
  }
  if (!plain && seen.size === 1) return { state: "on", link: [...seen][0] };
  if (plain && !seen.size && !linkMarks) return { state: "off" };
  return { state: plain || seen.size ? "mixed" : "none" };
}
/**
 * Link the selected words (linkState "off") to a full https:// or http:// address: "[words](url)". Inside bold words the
 * link goes inside them (all of them: a whole bold link "**[words](url)**"); bold words wholly inside go inside the link;
 * bold half covered is split at the link's edge. Returns { content, start, end, from, to, ops } (start…end: the link's
 * words now; from…to: the stretch of the old content it changes; ops: the edits, for opsRange) or null.
 */
export function addLink(content, start, end, url) {
  const text = String(content ?? "");
  if (!safeUrl(url) || linkState(text, start, end).state !== "off") return null;
  const cues = textCues(text), m = markup(text, cues);
  let [s, e] = trimRange(text, start, end);
  for (const l of textLinks(text)) {
    if (s >= l.words.end && s < l.end) s = l.end;
    if (e > l.start && e <= l.words.start) e = l.start;
  }
  while (s < e && (m[s] || /\s/.test(text[s]))) s++;
  while (e > s && (m[e - 1] || /\s/.test(text[e - 1]))) e--;
  if (e <= s) return null;
  const ops = [];
  const holder = cues.find((c) => c.words.start <= s && e <= c.words.end);
  if (!holder) {
    // A cue whose words begin or end with the link's: its marks go inside the link.
    for (const c of cues) {
      if (c.words.start === s && c.words.end <= e) s = c.start;
      if (c.words.end === e && c.words.start >= s) e = c.end;
    }
    for (const c of cues) {
      if (c.words.end <= s || c.words.start >= e || (c.start >= s && c.end <= e)) continue;
      if (c.words.start < s) {
        // Starts before the link: close it before the link, open it again inside.
        let p = s;
        while (p > c.words.start && /\s/.test(text[p - 1])) p--;
        if (wordy(text.slice(c.words.start, p))) ops.push({ at: p, ins: "**", order: 0 });
        else ops.push({ at: c.start, del: 2 });
        ops.push({ at: s, ins: "**", order: 2 });
      } else {
        // Ends after the link: close it inside, open it again after.
        let q = e;
        while (q < c.words.end && /\s/.test(text[q])) q++;
        ops.push({ at: e, ins: "**", order: 0 });
        if (wordy(text.slice(q, c.words.end))) ops.push({ at: q, ins: "**", order: 2 });
        else ops.push({ at: c.words.end, del: 2 });
      }
    }
  }
  ops.push({ at: s, ins: "[", order: 1 }, { at: e, ins: `](${url})`, order: 1 });
  const next = applyOps(text, ops);
  const placed = opsRange(text, ops)(s, e);
  const link = textLinks(next).find((l) => l.url === url && l.start <= placed.start && l.end >= placed.end);
  if (!link || !sameWords(text, next) || !sameBold(text, next)) return null;
  return { content: next, start: link.words.start, end: link.words.end, from: Math.min(...ops.map((o) => o.at)), to: Math.max(...ops.map((o) => o.at + (o.del || 0))), ops };
}
/** Remove the link the selected words are in (linkState "on"): its words stay, and so does their bold. Returns
 *  { content, start, end, from, to, ops } (start…end: the words now) or null. */
export function removeLink(content, start, end) {
  const text = String(content ?? ""), st = linkState(text, start, end);
  if (st.state !== "on") return null;
  const l = st.link, ops = [{ at: l.start, del: l.words.start - l.start }, { at: l.words.end, del: l.end - l.words.end }];
  const next = applyOps(text, ops);
  if (!sameWords(text, next) || !sameBold(text, next)) return null;
  return { content: next, start: l.start, end: l.start + l.words.end - l.words.start, from: l.start, to: l.end, ops };
}

/* ---------- The person's edits ---------- */
// One edit from `old` to `now`: [from, end in old, end in now]. A repeated letter reads more than one way: the caret says
// where the edit really happened.
function editSpan(old, now, caret) {
  let p = 0, oe = old.length, ne = now.length;
  while (p < oe && p < ne && old[p] === now[p]) p++;
  while (oe > p && ne > p && old[oe - 1] === now[ne - 1]) { oe--; ne--; }
  const grew = now.length - old.length;
  if (Number.isInteger(caret) && grew > 0 && caret >= grew && old.slice(0, caret - grew) + now.slice(caret - grew, caret) + old.slice(caret - grew) === now) return [caret - grew, caret - grew, caret];
  if (Number.isInteger(caret) && grew < 0 && caret - grew <= old.length && old.slice(0, caret) + old.slice(caret - grew) === now) return [caret, caret - grew, caret];
  return [p, oe, ne];
}
// Where an offset of the old text is after the edit's spans ([from, to, length put in]), for a character the edit left.
const throughSpans = (spans, i) => spans.reduce((at, [a, b, put]) => (i >= b ? at + put - (b - a) : at), i);
// The offsets of a range through the edit (null when the edit fell inside the range), then through the marks' moves: an
// ask anchors by these, never by a search through the text.
const followEdit = (spans, now, content) => {
  const range = marksRange(now, content);
  return (start, end) => {
    if (spans.some(([a, b]) => (a < b ? a < end && b > start : a > start && a < end))) return null;
    return range(throughSpans(spans, start), end > start ? throughSpans(spans, end - 1) + 1 : throughSpans(spans, start));
  };
};
// The last words of a stretch deleted: its marks go, read by the text alone. Looks past
// spaces, as an earlier deletion may have left them at one inner edge ("**two **", "** words**"). Both edges spaced around
// words ("a ** b ** c") was never a stretch, unless the stretch is the whole block: then its last words going would leave
// "**  **", a rule line, so its marks go. Neither was a word or "*" outside the marks, or a link, and marks with only
// spaces between them hold no words to delete. Anything else stays byte for byte.
function emptied(old, now, p, oe, ne) {
  if (ne !== p || oe <= p) return null;
  let open = p, close = oe;
  while (open > 0 && /[^\S\n]/.test(old[open - 1])) open--;
  while (close < old.length && /[^\S\n]/.test(old[close])) close++;
  if (open < 2 || old.slice(open - 2, open) !== "**" || old.slice(close, close + 2) !== "**") return null;
  const inner = old.slice(open, close), before = old[open - 3] ?? "", after = old[close + 2] ?? "";
  // A stretch that is the whole block (only spaces or tabs around it) has nothing to read "a ** b ** c" with: it may be
  // spaced on both edges. With more lines in the block, a spaces-only first line could turn the next line into a list,
  // heading or raw block, so those stay byte for byte.
  const alone = /^[ \t]*$/.test(old.slice(0, open - 2)) && /^[ \t]*$/.test(old.slice(close + 2));
  if (badWords(inner) || !wordy(inner) || (!alone && /\s/.test(inner[0]) && /\s/.test(inner.at(-1)))) return null;
  if (WORD_CHAR.test(before) || before === "*" || WORD_CHAR.test(after) || after === "*" || overlaps(linkRanges(old), open - 2, close + 2)) return null;
  // A mark that belongs to a real stretch the edit didn't touch isn't this one's to take.
  if (textCues(old).some((c) => c.end === open || c.start === close)) return null;
  const delta = ne - oe, end = close + delta;
  const content = now.slice(0, open - 2) + now.slice(open, end) + now.slice(end + 2);
  return { content, caret: p - 2, typedBefore: null, follow: followEdit([[p, oe, 0]], now, content) };
}
/**
 * After one edit of a block (`old` → `now`; caret: its offset in `now`): every cue the edit broke is settled, so its
 * marks never stay behind as literal text. All its words gone, or a "*", bracket or line break in them, or one of its
 * marks hit: the marks go, the words stay. Spaces at its edges move outside it. A word now right before or right after it
 * (typed, or the space between deleted) joins it. A "*" right outside it: the marks go.
 * A word being typed in front of a cue joins it only until its space is typed, then stays plain: `typedBefore` says where
 * that word ends in `old`, and the result's `typedBefore` where it ends now (null once the person is doing anything else).
 * An edit that empties a stretch takes its marks with it: `emptied`.
 * `deleted`: the [start, end] ranges of `old` that really went, when hidden marks were put back (L.keepHidden), so several
 * stretches of text went while the marks stayed: marks put back aren't hit.
 * Returns { content, caret, typedBefore, follow }, or null when no cue needs settling (no cue was there, or the edit broke
 * none). follow(start, end): where a range of `old` goes, or null when the edit fell inside it.
 */
export function settleMarks(old, now, caret = null, { typedBefore = null, deleted = null } = {}) {
  if (old === now) return null;
  const [p, oe, ne] = editSpan(old, now, caret);
  const cues = textCues(old);
  if (!cues.length) return emptied(old, now, p, oe, ne);
  const spans = deleted?.length ? deleted.map(([a, b]) => [a, b, 0]) : [[p, oe, ne - p]];
  const inSpan = (i) => spans.some(([a, b]) => i >= a && i < b);
  const to = (i) => throughSpans(spans, i), ops = [], added = !deleted?.length && oe === p ? now.slice(p, ne) : "";
  if (deleted?.length) typedBefore = null;
  let typing = null;
  const take = (at, del) => ops.push({ at, del, ins: "" }), put = (at) => ops.push({ at, del: 0, ins: "**" });
  for (const c of cues) {
    const marks = [c.start, c.end - 2];
    if (marks.some((m) => spans.some(([a, b]) => (a < m + 2 && b > m) || (a === b && a > m && a < m + 2)))) {
      for (const m of marks) for (const i of [m, m + 1]) if (!inSpan(i)) take(to(i), 1);
      continue;
    }
    const open = to(c.start), close = to(c.end - 2), inner = now.slice(open + 2, close), words = inner.trim();
    const lead = inner.length - inner.trimStart().length, trail = inner.length - inner.trimEnd().length;
    let start = open, finish = close + 2;
    if (!lead) while (start > 0 && WORD_CHAR.test(now[start - 1])) start--;
    if (!trail) while (finish < now.length && WORD_CHAR.test(now[finish])) finish++;
    if (!wordy(words) || badWords(words) || now[close + 2] === "*" || now[finish] === "*" || now[open - 1] === "*" || now[start - 1] === "*") {
      take(open, 2);
      take(close, 2);
      continue;
    }
    // The word being typed in front of this cue: its space ends it and it stays plain; more letters or Backspace go on.
    if (typedBefore != null && typedBefore > c.words.start && typedBefore < c.words.end) {
      if (p === typedBefore && added && !added.trim()) { take(open, 2); put(p + added.length); continue; }
      if (p === typedBefore && added.trim() && !/\s/.test(added)) typing = p + added.length;
      else if (oe === typedBefore && ne === p && p > c.words.start) typing = p;
    }
    if (lead || start < open) {
      take(open, 2);
      put(lead ? open + 2 + lead : start);
      if (!lead && added && p === c.start && !/\s/.test(added)) typing = ne + 2;
    }
    if (trail) { put(close - trail); take(close, 2); }
    else if (finish > close + 2) { take(close, 2); put(finish); }
  }
  if (!ops.length) return typing != null ? { content: now, caret, typedBefore: typing, follow: followEdit(spans, now, now) } : deleted?.length ? null : emptied(old, now, p, oe, ne);
  ops.sort((a, b) => a.at - b.at);
  let content = "", at = 0, moved = caret;
  for (const op of ops) {
    content += now.slice(at, op.at) + op.ins;
    at = op.at + op.del;
    if (caret != null && op.at < caret) moved += op.ins.length - Math.min(op.del, caret - op.at);
  }
  content += now.slice(at);
  return { content, caret: moved, typedBefore: typing, follow: followEdit(spans, now, content) };
}

/* ---------- The agent's rewrites ---------- */
// Does start…end cut a link (neither holding it whole nor inside its words)?
const cuts = (l, start, end) => start < l.end && end > l.start && !(start <= l.start && end >= l.end) && !(start >= l.words.start && end <= l.words.end);
/**
 * A replace by the agent over text that held cues: each cue whose words are still in the new text (whole words,
 * outside links and cues already there) is marked on them again; the others are dropped. Cues the agent kept itself
 * stay. Returns { text, dropped } (dropped: how many cues went, for the agent's answer).
 */
export function keepCues(removed, text) {
  const old = textCues(removed);
  let out = String(text ?? ""), dropped = 0;
  // Cues the agent kept itself count once each, so two old cues on the same words need two in the new text.
  const already = new Map();
  for (const x of textCues(out)) already.set(x.label, (already.get(x.label) || 0) + 1);
  for (const c of old) {
    if (already.get(c.label) > 0) { already.set(c.label, already.get(c.label) - 1); continue; }
    const taken = [...textCues(out).map((x) => [x.start, x.end]), ...lineRanges(out)], links = textLinks(out);
    const re = quoteRe(c.label);
    let hit = null;
    for (let m = re.exec(out); m; re.lastIndex = m.index + 1, m = re.exec(out)) {
      const i = m.index, j = i + m[0].length;
      if (!wholeWords(out, i, j) || overlaps(taken, i, j) || m[0].includes("\n") || links.some((l) => cuts(l, i, j))) continue;
      // It must read back as a cue there (not right next to a "*", say).
      if (textCues(`${out.slice(0, i)}**${m[0]}**${out.slice(j)}`).some((x) => x.start === i)) { hit = [i, j]; break; }
    }
    if (!hit) { dropped++; continue; }
    out = `${out.slice(0, hit[0])}**${out.slice(hit[0], hit[1])}**${out.slice(hit[1])}`;
  }
  return { text: out, dropped };
}

/** A replace over start…end that reaches into a cue takes the whole cue in, so no lone "**" is left and keepCues
 *  applies Lex's rule (the cue stays only if its words survive): the new range, and the cue's words outside the old
 *  range (plain) to put around the new text. null when no cue is reached into. */
export function widenOverCues(content, start, end) {
  const text = String(content ?? "");
  let s = start, e = end;
  const cut = [];
  for (const c of textCues(text)) {
    const startIn = start > c.start && start < c.end, endIn = end > c.start && end < c.end;
    if (startIn || endIn) { s = Math.min(s, c.start); e = Math.max(e, c.end); cut.push(c); }
  }
  if (s === start && e === end) return null;
  // Exactly the cut cues' marks go (an address in a link they hold may have a "*" of its own).
  const gone = new Uint8Array(text.length);
  for (const c of cut) gone.fill(1, c.start, c.words.start).fill(1, c.words.end, c.end);
  const keep = (a, b) => { let out = ""; for (let i = a; i < b; i++) if (!gone[i]) out += text[i]; return out; };
  return { start: s, end: e, before: keep(s, start), after: keep(end, e) };
}

/* ---------- The agent's mark_cue and unmark_cue ---------- */
// New bold on these ranges of a paragraph, the last first so the earlier offsets hold: { content, from, to } (from…to: the
// changed stretch of the old content) or null when one would not read as bold there.
function boldAll(content, picks) {
  let next = content;
  for (const p of [...picks].sort((a, b) => b.start - a.start)) {
    if (cueSelected(next, p.start, p.end)) return null;
    const r = toggleCue(next, p.start, p.end);
    if (!r?.cue) return null;
    next = r.content;
  }
  let from = 0, end = 0;
  while (from < content.length && from < next.length && content[from] === next[from]) from++;
  while (end < content.length - from && end < next.length - from && content[content.length - 1 - end] === next[next.length - 1 - end]) end++;
  return { content: next, from, to: content.length - end };
}
/**
 * Plan the agent's cue changes in the spoken paragraphs. segments: [{ id, content, avoid? }] in reading order
 * (`avoid`: [[start, end]] other open work points at, as for links). mode "mark": items [{ quote, occurrence? }]:
 * the quote's first free whole-word occurrence (or its `occurrence`-th one, counting every match in reading order)
 * becomes a cue. mode "unmark": items [{ quote } | { cueId }]: that cue's marks go (cueId "<blockId>:<n>:<words>",
 * the n-th cue in its block with those words, as listCues gives it). others: the content of blocks where cues don't go, only to explain a skip.
 * Returns { segments: [{ id, content, cues: [{ quote }], from, to, delta }] (only the ones that changed; from…to the
 * changed stretch in the old content), skipped: [{ quote, why }] }.
 */
export function planCues(segments, items, mode, { others = [] } = {}) {
  const state = segments.map((s) => ({ ...s, cues: textCues(s.content), view: spokenView(s.content), avoid: s.avoid || [], picks: [] }));
  const skipped = [], seen = new Set();
  const span = (s, i, e) => [Math.min(i, ...s.picks.map((p) => p.start)), Math.max(e, ...s.picks.map((p) => p.end))];
  for (const item of items || []) {
    const quote = String(item?.quote ?? "").trim(), cueId = typeof item?.cueId === "string" ? item.cueId : "";
    const skip = (why) => skipped.push({ quote: (quote || cueId).slice(0, 80), why });
    if (mode === "unmark") {
      let found = null;
      if (cueId) {
        // "<blockId>:<n>:<words>": the n-th cue in its paragraph, which must still have those words.
        const m = /^([^:]+):(\d+):(.*)$/s.exec(cueId);
        const s = m && state.find((x) => x.id === m[1]);
        const c = s ? s.cues[Number(m[2]) - 1] : null;
        if (!s || (!c && !s.cues.some((x) => x.label === m[3]))) { skip("no cue with this cueId"); continue; }
        if (!c || c.label !== m[3]) { skip("this cue has changed; call list_cues again"); continue; }
        found = { s, c };
      } else {
        const key = quote.split(/\s+/).join(" ");
        const same = (x) => x.label.split(/\s+/).join(" ") === key || spokenText(x.label).split(/\s+/).join(" ") === key;
        for (const s of state) { const c = s.cues.find((x) => same(x) && !s.picks.some((p) => p.start === x.start)); if (c) { found = { s, c }; break; } }
        if (!found) { skip(quote ? "no cue with these words" : "empty quote"); continue; }
      }
      const { s, c } = found;
      if (s.picks.some((p) => p.start === c.start)) { skip("already in this answer"); continue; }
      if (overlaps(s.avoid, c.start, c.end)) { skip("under an open ask or change"); continue; }
      if (overlaps(s.avoid, ...span(s, c.start, c.end))) { skip("an open ask or change sits between it and another cue in its paragraph"); continue; }
      s.picks.push({ start: c.start, end: c.end, put: c.label, quote: c.label });
      continue;
    }
    const occurrence = Number.isInteger(item?.occurrence) ? item.occurrence : 0;
    if (!quote) { skip("empty quote"); continue; }
    if (BAD_WORDS.test(quote)) { skip("cue words hold no brackets, * signs or line breaks"); continue; }
    if (!WORDY.test(quote)) { skip("not found word for word in the spoken text"); continue; }
    const key = `${quote.split(/\s+/).join(" ")}#${occurrence}`;
    if (seen.has(key)) { skip("already in this answer"); continue; }
    const re = quoteRe(quote);
    let n = 0, done = false, why = "";
    for (const s of state) {
      const { text, map } = s.view;
      re.lastIndex = 0;
      for (let m = re.exec(text); m; re.lastIndex = m.index + 1, m = re.exec(text)) {
        if (!wholeWords(text, m.index, m.index + m[0].length)) continue;
        const i = map[m.index], e = map[m.index + m[0].length - 1] + 1;
        n++;
        if (occurrence && n !== occurrence) continue;
        const cueHere = overlaps(s.cues.map((c) => [c.start, c.end]), i, e) || s.picks.some((p) => i < p.end && e > p.start);
        let problem = "", tried = null;
        if (cueHere) problem = "already a cue";
        else if (m[0].includes("\n")) problem = "spans a line break";
        else if (!(tried = boldAll(s.content, [...s.picks, { start: i, end: e }]))) problem = "would not read as a cue there";
        else if (overlaps(s.avoid, i, e)) problem = "under an open ask or change";
        else if (overlaps(s.avoid, tried.from, tried.to)) problem = "an open ask or change sits between it and another cue in its paragraph";
        if (problem) { why ||= problem; if (occurrence) break; continue; }
        s.picks.push({ start: i, end: e, quote });
        done = true;
        break;
      }
      if (done || (occurrence && n >= occurrence)) break;
    }
    if (done) { seen.add(key); continue; }
    if (why) skip(why);
    else if (occurrence && n) skip(`only ${n} ${n === 1 ? "occurrence" : "occurrences"} in the spoken text`);
    else if (state.some((s) => lineRanges(s.content).some(([a, b]) => { re.lastIndex = 0; return re.test(s.content.slice(a, b)); }))) skip("inside a link line");
    else if (others.some((c) => { re.lastIndex = 0; return re.test(String(c)); })) skip("in a heading or reminder, where cues don't go");
    else skip("not found word for word in the spoken text");
  }
  const out = [];
  for (const s of state) {
    if (!s.picks.length) continue;
    s.picks.sort((a, b) => a.start - b.start);
    let r;
    if (mode === "mark") r = boldAll(s.content, s.picks);
    else {
      // Exactly the picked stretches' marks go (one may sit inside another, through a link: bold links).
      const gone = new Uint8Array(s.content.length);
      for (const p of s.picks) gone.fill(1, p.start, p.start + 2).fill(1, p.end - 2, p.end);
      r = { content: without(s.content, gone).text, from: Math.min(...s.picks.map((p) => p.start)), to: Math.max(...s.picks.map((p) => p.end)) };
    }
    // Safety net: every new cue must read back as one (else the paragraph would show stray "**"), and no word changes.
    if (!r || (mode === "mark" && textCues(r.content).length < s.cues.length + s.picks.length) || !sameWords(s.content, r.content)) {
      for (const p of s.picks) skipped.push({ quote: p.quote.slice(0, 80), why: "would not read as a cue there" });
      continue;
    }
    out.push({ id: s.id, content: r.content, cues: s.picks.map(({ quote }) => ({ quote })), from: r.from, to: r.to, delta: r.content.length - s.content.length });
  }
  return { segments: out, skipped };
}
