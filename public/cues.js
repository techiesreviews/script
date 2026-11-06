// Cues in the script (fleet issue #14, Lex 2026-11-04), shown as bold: "**words**" in a spoken line, the standard Markdown
// bold (the fleet lead's decision after the release review; first built as "==words==", never released, so no script
// holds that). Optional and off by default
// (settings below). The prompter shows "**" as literal asterisks today, so its export strips them unless the setting
// `export` says show. Rules like links (links.js): words on one line, no brackets or "*" inside, at least one letter or
// digit, never inside a link. A pair starts and ends at word boundaries: no letter, digit or "*" outside it, no space
// inside its edges, so a**b, **kwargs, 2**3 and a ** b are plain text.
// With cue marking off nothing reads "**" anywhere: textCues finds none, so the page, the exports, word counts, links and
// rewrites treat it as plain text, byte for byte (Lex's promise, 2026-11-05). The app says when cues are read
// (readCuesWhen); until it does, they are not. The one thing that happens while off: an edit that empties a stretch takes
// its marks (settleMarks), read from the text alone, as no setting travels to a guest.
// Pure: no DOM. app.js draws cues with the links' show/hide trick; changes.js plans the agent's cue changes.
import { textLinks, isLinkLine, spokenText, quoteRe, overlaps } from "./links.js";

export const CUE_LIMITS = { cues: 30 };
const CUE = /(?<![\p{L}\p{N}\p{M}*])\*\*([^\s*[\]](?:[^*[\]\n]*[^\s*[\]])?)\*\*(?![\p{L}\p{N}\p{M}*])/gu;
let reading = () => false;
/** Say when cues are read: fn() is true while cue marking is on (asked each time, so it follows the open script). */
export const readCuesWhen = (fn) => { reading = fn; };
const WORDY = /[\p{L}\p{N}]/u;
const BAD_WORDS = /[*[\]\n]/;
// Whole words for a cue: a letter, digit or combining mark on both sides of an edge means the edge cuts a word (or,
// for a combining mark, a letter). Languages written without spaces only get cues on whole runs of text.
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const wholeWords = (t, s, e) => !(WORD_CHAR.test(t[s] ?? "") && WORD_CHAR.test(t[s - 1] ?? "")) && !(WORD_CHAR.test(t[e - 1] ?? "") && WORD_CHAR.test(t[e] ?? ""));

/* ---------- Settings (Lex 2026-11-04: chosen by the person and by the agent) ----------
   on: cue marking on or off (off: no shortcut, no button, cues show as plain text, as before).
   action: "highlight" (only a highlight) or "camera" (also a camera action; stored only, the prompter acts later).
   export: "strip" (the prompter file shows plain words) or "show" (it keeps the "**" marks). */
export const CUE_DEFAULTS = Object.freeze({ on: false, action: "highlight", export: "strip" });
const CHOICES = { on: [true, false], action: ["highlight", "camera"], export: ["strip", "show"] };
const pick = (from) => Object.fromEntries(Object.keys(CHOICES).filter((k) => from && CHOICES[k].includes(from[k])).map((k) => [k, from[k]]));
/** The settings in force: the defaults, then the person's, then the open script's own (the agent may set those). */
export const cueSettings = (person, script) => ({ ...CUE_DEFAULTS, ...pick(person), ...pick(script) });
/** A settings change's problem ("" when fine). `extra`: other argument names allowed beside the settings. */
export function checkSettings(patch, extra = []) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return "Settings must be an object.";
  for (const k of Object.keys(patch)) if (!(k in CHOICES) && !extra.includes(k)) return `Unknown setting: ${k}.`;
  if (!Object.keys(CHOICES).some((k) => patch[k] !== undefined)) return "Give at least one of on, action or export.";
  if (patch.on !== undefined && typeof patch.on !== "boolean") return "on must be true or false.";
  if (patch.action !== undefined && !CHOICES.action.includes(patch.action)) return "action must be highlight or camera.";
  if (patch.export !== undefined && !CHOICES.export.includes(patch.export)) return "export must be strip or show.";
  return "";
}

/* ---------- How bold looks (Lex 2026-11-04): plain bold, or the person's own colours ----------
   Kept per person, apart from the settings above. Only "#rrggbb" values reach the page's CSS. */
export const BOLD_DEFAULTS = Object.freeze({ own: false, background: "#fff1b8", color: "#1f1f1f" });
const HEX = /^#[0-9a-f]{6}$/i;
export const boldStyle = (stored) => ({
  own: stored?.own === true,
  background: HEX.test(stored?.background) ? stored.background : BOLD_DEFAULTS.background,
  color: HEX.test(stored?.color) ? stored.color : BOLD_DEFAULTS.color,
});

/** What the person (the banner, after the agent's name; null for none) and the agent are told after set_cue_settings.
 *  words: what changed in force (empty when nothing did); forScript: where it was saved; hadOwn: the open script had
 *  its own settings before; stored: whether what is saved changed; saved: false when the browser refused to store it. */
export function settingsOutcome({ words, forScript, hadOwn, stored, saved = true }) {
  if (!saved) return { banner: null, message: "The change could not be saved: this browser's storage is full or turned off. Nothing changed." };
  const same = { banner: null, message: "Those settings were in force already: nothing changed." };
  if (words) return { banner: `${words}${forScript ? " for this script" : ""}`, message: "Done: the person sees the change, with Undo." };
  if (!stored) return same;
  if (forScript && !hadOwn) return { banner: "gave this script its own bold settings", message: "Done: this script now has its own settings, the same as those in force. The person can undo it." };
  if (forScript) return { banner: "changed this script's bold settings", message: "Done: saved in this script's own settings; what is in force did not change. The person can undo it." };
  if (hadOwn) return { banner: "changed your own bold settings; this script keeps its own", message: "Saved for the person, but this script has its own cue settings, which win; pass forScript: true to change them." };
  return same;
}

/* ---------- Reading cues ---------- */
// Where cues may not be: text links and link lines ("- Label: https://…").
function linkRanges(text) {
  const out = textLinks(text).map((l) => [l.start, l.end]);
  let at = 0;
  for (const line of text.split("\n")) {
    if (isLinkLine(line)) out.push([at, at + line.length]);
    at += line.length + 1;
  }
  return out;
}
// The stretches in the text, whatever the setting says.
function readCues(content) {
  const text = String(content ?? "");
  const links = linkRanges(text);
  const out = [];
  for (const m of text.matchAll(CUE)) {
    const start = m.index, end = start + m[0].length;
    if (!WORDY.test(m[1]) || overlaps(links, start, end)) continue;
    out.push({ start, end, words: { start: start + 2, end: end - 2 }, label: m[1], cue: true });
  }
  return out;
}
/** The cues in a block's content: [{ start, end, words: { start, end }, label, cue: true }] (content offsets, the
 *  same shape as textLinks() so the editor draws both alike). A "**…**" inside or across a link is not a cue. None while
 *  cue marking is off. */
export const textCues = (content) => (reading() ? readCues(content) : []);
/** An AI's new text, when the text it was asked about held marks: a "**" it copied that makes no cue goes. Ordinary text
 *  stays: a letter or digit on both sides (a**b), or spaces on both sides (a ** b). */
export function dropLoneMarks(text) {
  const t = String(text ?? ""), cues = textCues(t);
  if (!reading()) return t;
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
/** The text with each cue replaced by its words. */
export function stripCues(text) {
  const t = String(text ?? "");
  let out = "", at = 0;
  for (const c of textCues(t)) { out += t.slice(at, c.start) + c.label; at = c.end; }
  return out + t.slice(at);
}
/** The text without its stretches' marks, whatever the setting says: for what must not depend on anyone's setting (a
 *  B-roll shot's check, which a host and a guest share). */
export function withoutMarks(text) {
  const t = String(text ?? "");
  let out = "", at = 0;
  for (const c of readCues(t)) { out += t.slice(at, c.start) + c.label; at = c.end; }
  return out + t.slice(at);
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
/** The text without its cues' marks (as the setting reads them) and where each of its characters is in the text:
 *  { plain, map } (map[i] is the offset in `content` of plain[i]), or null when there is no cue. */
export function plainView(content) {
  const text = String(content ?? ""), cues = textCues(text);
  if (!cues.length) return null;
  const map = [];
  let plain = "", at = 0;
  const copy = (from, to) => { for (let i = from; i < to; i++) { map.push(i); plain += text[i]; } };
  for (const c of cues) { copy(at, c.start); copy(c.words.start, c.words.end); at = c.end; }
  copy(at, text.length);
  return { plain, map };
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
const inside = (c, s, e) => s >= c.start && e <= c.end;
/** Is the selection inside one cue (the button shows pressed, a toggle takes the cue off)? */
export function cueSelected(content, start, end) {
  const [s, e] = trimRange(String(content ?? ""), start, end);
  return e > s && textCues(content).some((c) => inside(c, s, e));
}
/**
 * Toggle a cue on the selected words (start…end, content offsets, already snapped to whole words):
 * inside one cue: that cue's marks go, its words stay; otherwise the selection and every cue it touches become one
 * cue (half a cue or across two joins into one). Returns { content, start, end, cue } (start…end: the words, to
 * select again; cue: whether they are a cue now; from…to: the stretch of the old content it changes) or null when nothing can change (no words, a line break, a
 * bracket or "*" in the way, a link touched).
 */
export function toggleCue(content, start, end) {
  const text = String(content ?? "");
  const [s, e] = trimRange(text, start, end);
  if (e <= s) return null;
  const cues = textCues(text);
  const own = cues.find((c) => inside(c, s, e));
  if (own) {
    return { content: text.slice(0, own.start) + own.label + text.slice(own.end), start: own.start, end: own.start + own.label.length, cue: false, from: own.start, to: own.end };
  }
  const touched = cues.filter((c) => s < c.end && e > c.start);
  const from = Math.min(s, ...touched.map((c) => c.start)), to = Math.max(e, ...touched.map((c) => c.end));
  if (overlaps(linkRanges(text), from, to)) return null;
  const words = stripCues(text.slice(from, to));
  if (!WORDY.test(words) || BAD_WORDS.test(words) || words !== words.trim()) return null;
  const next = `${text.slice(0, from)}**${words}**${text.slice(to)}`;
  // The new marks must read back as one cue (not next to a word or a "*"), with every other cue still there.
  if (!textCues(next).some((c) => c.start === from && c.label === words) || textCues(next).length !== cues.length - touched.length + 1) return null;
  return { content: next, start: from + 2, end: from + 2 + words.length, cue: true, from, to };
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
// The last words of a stretch deleted: its marks go, read by the text alone, as no setting travels to a guest. Looks past
// spaces, as an earlier deletion may have left them at one inner edge ("**two **", "** words**"). Both edges spaced around
// words ("a ** b ** c") was never a stretch, unless it is alone on its line: then its last words going would leave
// "**  **", a rule line (on the block's first line, where a rule can read), so its marks go. Neither was a word or "*" outside the marks, or a link, and marks with only
// spaces between them hold no words to delete. Anything else stays byte for byte.
function emptied(old, now, p, oe, ne) {
  if (ne !== p || oe <= p) return null;
  let open = p, close = oe;
  while (open > 0 && /[^\S\n]/.test(old[open - 1])) open--;
  while (close < old.length && /[^\S\n]/.test(old[close])) close++;
  if (open < 2 || old.slice(open - 2, open) !== "**" || old.slice(close, close + 2) !== "**") return null;
  const inner = old.slice(open, close), before = old[open - 3] ?? "", after = old[close + 2] ?? "";
  // A stretch alone on the first line of the block (only spaces or tabs around it, where a rule can read) has nothing to read
  // "a ** b ** c" with: it may be spaced on both edges. On later lines the spaces-only rest would only split the block.
  const lineEnd = old.indexOf("\n", close + 2);
  const alone = /^[ \t]*$/.test(old.slice(0, open - 2)) && /^[ \t]*$/.test(old.slice(close + 2, lineEnd < 0 ? old.length : lineEnd));
  if (BAD_WORDS.test(inner) || !WORDY.test(inner) || (!alone && /\s/.test(inner[0]) && /\s/.test(inner.at(-1)))) return null;
  if (WORD_CHAR.test(before) || before === "*" || WORD_CHAR.test(after) || after === "*" || overlaps(linkRanges(old), open - 2, close + 2)) return null;
  // A mark that belongs to a real stretch the edit didn't touch isn't this one's to take.
  if (readCues(old).some((c) => c.end === open || c.start === close)) return null;
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
 * Whatever the settings say (a guest's are their own), an edit that empties a stretch takes its marks with it: `emptied`.
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
    if (!WORDY.test(words) || BAD_WORDS.test(words) || now[close + 2] === "*" || now[finish] === "*" || now[open - 1] === "*" || now[start - 1] === "*") {
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
    const taken = [...textCues(out).map((x) => [x.start, x.end]), ...linkRanges(out)];
    const re = quoteRe(c.label);
    let hit = null;
    for (let m = re.exec(out); m; re.lastIndex = m.index + 1, m = re.exec(out)) {
      const i = m.index, j = i + m[0].length;
      if (!wholeWords(out, i, j) || overlaps(taken, i, j) || m[0].includes("\n")) continue;
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
  for (const c of textCues(text)) {
    const startIn = start > c.start && start < c.end, endIn = end > c.start && end < c.end;
    if (startIn || endIn) { s = Math.min(s, c.start); e = Math.max(e, c.end); }
  }
  if (s === start && e === end) return null;
  // Cue words hold no "*", so dropping every "*" outside the old range takes exactly the cut cue's marks away.
  return { start: s, end: e, before: text.slice(s, start).replace(/\*/g, ""), after: text.slice(end, e).replace(/\*/g, "") };
}

/* ---------- The agent's mark_cue and unmark_cue ---------- */
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
  const state = segments.map((s) => ({ ...s, cues: textCues(s.content), links: linkRanges(s.content), avoid: s.avoid || [], picks: [] }));
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
        for (const s of state) { const c = s.cues.find((x) => x.label.split(/\s+/).join(" ") === key && !s.picks.some((p) => p.start === x.start)); if (c) { found = { s, c }; break; } }
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
      re.lastIndex = 0;
      for (let m = re.exec(s.content); m; re.lastIndex = m.index + 1, m = re.exec(s.content)) {
        const i = m.index, e = i + m[0].length;
        if (!wholeWords(s.content, i, e)) continue;
        n++;
        if (occurrence && n !== occurrence) continue;
        const cueHere = overlaps(s.cues.map((c) => [c.start, c.end]), i, e) || s.picks.some((p) => i < p.end && e > p.start);
        let problem = "";
        if (cueHere) problem = "already a cue";
        else if (m[0].includes("\n")) problem = "spans a line break";
        else if (overlaps(s.links, i, e)) problem = "inside a link";
        else if (!textCues(`${s.content.slice(0, i)}**${m[0]}**${s.content.slice(e)}`).some((c) => c.start === i)) problem = "would not read as a cue there";
        else if (overlaps(s.avoid, i, e)) problem = "under an open ask or change";
        else if (overlaps(s.avoid, ...span(s, i, e))) problem = "an open ask or change sits between it and another cue in its paragraph";
        if (problem) { why ||= problem; if (occurrence) break; continue; }
        s.picks.push({ start: i, end: e, put: `**${m[0]}**`, quote });
        done = true;
        break;
      }
      if (done || (occurrence && n >= occurrence)) break;
    }
    if (done) { seen.add(key); continue; }
    if (why) skip(why);
    else if (occurrence && n) skip(`only ${n} ${n === 1 ? "occurrence" : "occurrences"} in the spoken text`);
    else if (others.some((c) => { re.lastIndex = 0; return re.test(String(c)); })) skip("in a heading or reminder, where cues don't go");
    else skip("not found word for word in the spoken text");
  }
  const out = [];
  for (const s of state) {
    if (!s.picks.length) continue;
    s.picks.sort((a, b) => a.start - b.start);
    let content = "", at = 0;
    for (const p of s.picks) { content += s.content.slice(at, p.start) + p.put; at = p.end; }
    content += s.content.slice(at);
    // Safety net: every new cue must read back as one (else the paragraph would show stray "**").
    if (mode === "mark" && textCues(content).length !== s.cues.length + s.picks.length) {
      for (const p of s.picks) skipped.push({ quote: p.quote.slice(0, 80), why: "would not read as a cue there" });
      continue;
    }
    out.push({ id: s.id, content, cues: s.picks.map(({ quote }) => ({ quote })), from: s.picks[0].start, to: s.picks.at(-1).end, delta: content.length - s.content.length });
  }
  return { segments: out, skipped };
}
