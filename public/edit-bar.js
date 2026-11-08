// The slim edit bar (step T): what a typed line means, what to suggest as it is typed, finding the selected words again
// after the line changed, and where the bar goes.
// Pure module: no DOM. Imported by the app and by the tests.
import { ACTIONS } from "./doc.js";
import { plainView } from "./cues.js";

/* ---------- Typed commands: what the bar's buttons did ----------
   name is what the grey ghost offers. needs: "spoken" (only over spoken words, as the B-roll buttons were), "addBroll"
   (and only where a shot can be added). More's own items are in the menu it opens. */
const COMMANDS = [
  { action: "shorter", name: ACTIONS.shorter.name },
  { action: "simpler", name: ACTIONS.simpler.name },
  { action: "like", name: ACTIONS.like.name },
  { action: "broll", name: "B-roll", needs: "spoken" },
  { open: "add", name: "Add B-roll", needs: "addBroll" },
  { open: "more", name: "More" },
];
const same = (text) => text.trim().replace(/\s+/g, " ").toLowerCase();
// Why a command can't run here (for screen readers: the input only turns Send off), or "" when it can.
// can: { spoken, addBroll, guest }.
function refusal(c, can) {
  if (c.needs && !can.spoken) return "B-roll needs spoken words.";
  if (c.needs === "addBroll" && !can.addBroll) return can.guest ? "Only the host can add B-roll." : "The B-roll list isn't ready.";
  return "";
}

/** What the typed line does: null (nothing typed), { kind: "act", action }, { kind: "add" }, { kind: "more" },
 *  { kind: "blocked", say } or { kind: "ask", text }. */
export function resolveTyped(typed, can) {
  const text = String(typed ?? "").trim();
  if (!text) return null;
  const c = COMMANDS.find((x) => same(x.name) === same(text));
  if (!c) return { kind: "ask", text };
  const say = refusal(c, can);
  if (say) return { kind: "blocked", say };
  return c.open ? { kind: c.open } : { kind: "act", action: c.action };
}

/** What the ghost may offer for what is typed, best first: the commands that can run here, then earlier asks. Each is
 *  longer than the typed text and starts with it, whatever the case. */
export function suggestions(typed, { can, earlier = [] } = {}) {
  const text = String(typed ?? "");
  if (!text.trim()) return [];
  const fits = (s) => s.length > text.length && s.slice(0, text.length).toLowerCase() === text.toLowerCase();
  const out = [];
  for (const c of COMMANDS) if (!refusal(c, can) && fits(c.name)) out.push(c.name);
  for (const s of cleanAsks(earlier)) if (fits(s) && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  return out;
}

/* ---------- Earlier asks: kept in this browser only ---------- */
const ASKS_KEPT = 20, ASK_KEPT_LENGTH = 200;
const cleanAsks = (list) => (Array.isArray(list) ? list.filter((s) => typeof s === "string" && s.length <= ASK_KEPT_LENGTH) : []);
/** The list with this ask first: no repeats in any case, at most 20, none over 200 characters. */
export function rememberAsk(list, text) {
  const clean = cleanAsks(list);
  if (text.length > ASK_KEPT_LENGTH) return clean.slice(0, ASKS_KEPT);
  return [text, ...clean.filter((s) => s.toLowerCase() !== text.toLowerCase())].slice(0, ASKS_KEPT);
}

/* ---------- The selected words, after the line changed ----------
   Everything is compared in the words without their bold marks, so marks going on or off anywhere on the line, also several
   at once, never make another copy of the same words look nearer. */
/** Where `offset` in the content is in the text without its bold marks. */
export function plainOffset(content, offset) {
  const view = plainView(String(content ?? ""));
  if (!view) return offset;
  let n = 0;
  while (n < view.map.length && view.map[n] < offset) n++;
  return n;
}
/** Where the selected words (`quote`) are in the content now, the copy nearest to `near` (from plainOffset): { start, end,
 *  quote } (quote: the text there now, marks and all), or null when they are gone. */
export function findWords(content, quote, near) {
  if (!quote) return null;
  const text = String(content ?? ""), view = plainView(text), plain = view ? view.plain : text;
  const at = (x) => (view ? view.map[x] : x);
  // As written first: "a**b" is words here, not a mark.
  for (const words of quote.includes("**") ? [quote, quote.replaceAll("**", "")] : [quote]) {
    if (!words) continue;
    let best = -1, dist = Infinity;
    for (let i = plain.indexOf(words); i >= 0; i = plain.indexOf(words, i + 1)) {
      const d = Math.abs(i - near);
      if (d < dist) { best = i; dist = d; }
    }
    if (best < 0) continue;
    let start = at(best), end = at(best + words.length - 1) + 1;
    // A quote that took in a whole stretch's marks takes them in again.
    if (quote.startsWith("**") && text.slice(start - 2, start) === "**") start -= 2;
    if (quote.endsWith("**") && text.slice(end, end + 2) === "**") end += 2;
    return { start, end, quote: text.slice(start, end) };
  }
  // Real marks and plain "**" side by side: only the content itself still holds it as written.
  let best = -1, dist = Infinity;
  for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) {
    const d = Math.abs(plainOffset(text, i) - near);
    if (d < dist) { best = i; dist = d; }
  }
  return best < 0 ? null : { start: best, end: best + quote.length, quote };
}

/* ---------- Where the bar goes ----------
   Lex (2026-11-04): it must not cover the selected words or the line above them when that can be avoided. */
const EDGE = 8, GAP = 8;
const clamp = (n, low, high) => Math.max(low, Math.min(n, high));
/** The bar's place on a wide screen, in window pixels. Below the words if it fits; else above them with one line clear;
 *  else right above them; else, when the words fill the window, at the end with more room. Always on screen.
 *  first, last: the first and last line of the words; w, h: the bar; top: where the top bar ends; vw, vh: the window;
 *  line: the height of a line of text. */
export function barSpot({ first, last, w, h, top, vw, vh, line = 0 }) {
  const low = top + EDGE, high = Math.max(low, vh - EDGE - h);
  const below = last.bottom + GAP, clearAbove = first.top - line - GAP - h, above = first.top - GAP - h;
  let y, from = first;
  if (below + h <= vh - EDGE) { y = below; from = last; }
  else if (clearAbove >= low) y = clearAbove;
  else if (above >= low) y = above;
  else y = vh - last.bottom >= first.top - top ? high : low;
  return { x: Math.max(EDGE, Math.min(from.left - 4, vw - w - EDGE)), y: clamp(y, low, high) };
}
/** Where what is seen starts, below the top bar: the top bar is sticky (inside what is seen), so a pan of the page only moves it
 *  down when it is lower than the bar's end; the two are never added. */
export const seenFrom = (top, panned = 0) => Math.max(top, panned || 0);
/** On a phone the bar is docked at the bottom, so the system's selection handles stay free; at the top when it would sit
 *  on the words and they are clear of the top. lift: what the on-screen keyboard covers. */
export function phoneDock({ first, last, h, top, vh, lift = 0 }) {
  const barTop = vh - lift - EDGE - h;
  const onWords = last.bottom > barTop && first.top < vh - lift;
  return onWords && first.top >= top + EDGE + h + EDGE ? "top" : "bottom";
}

/* ---------- The bold colours by B (Lex 2026-11-07, Variant A) ----------
   A small popover by the bar: under it, over it, beside it, or at the top or the bottom of what is seen, whichever comes
   first that keeps it off the selected words and on screen. */
const POP_GAP = 6;
/** The popover's place in window pixels, and its side. bar: the bar's box; x: where B starts; words: the selected words'
 *  box ({ top, bottom, left, right }); w, h: the popover; top: where the top bar ends; vw, vh: the window. */
export function popSpot({ bar, x, words, w, h, top, vw, vh }) {
  const low = top + EDGE, high = Math.max(low, vh - EDGE - h), left = Math.max(EDGE, Math.min(x, vw - w - EDGE));
  const spots = [
    { side: "below", x: left, y: bar.bottom + POP_GAP },
    { side: "above", x: left, y: bar.top - POP_GAP - h },
    { side: "right", x: bar.right + POP_GAP, y: clamp(bar.top, low, high) },
    { side: "left", x: bar.left - POP_GAP - w, y: clamp(bar.top, low, high) },
    { side: "top", x: left, y: low },
    { side: "bottom", x: left, y: high },
  ];
  const fits = (s) => s.y >= low && s.y <= high && s.x >= EDGE && s.x + w <= vw - EDGE;
  const offWords = (s) => s.y >= words.bottom || s.y + h <= words.top || s.x >= words.right || s.x + w <= words.left;
  const spot = spots.find((s) => fits(s) && offWords(s)) || spots.slice(0, 2).find(fits) || (vh - bar.bottom >= bar.top - top ? spots[0] : spots[1]);
  return { side: spot.side, x: spot.x, y: clamp(spot.y, low, high) };
}
