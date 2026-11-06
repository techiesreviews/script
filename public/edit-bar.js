// The slim edit bar (step T): what a typed line means, what to suggest as it is typed, and where the bar goes.
// Pure module: no DOM. Imported by the app and by the tests.
import { ACTIONS } from "./doc.js";

/* ---------- Typed commands: what the bar's buttons did ----------
   name is what the grey ghost offers; also: other spellings that mean the same.
   needs: "spoken" (only over spoken words, as the B-roll buttons were), "addBroll" (and only where a shot can be added). */
const COMMANDS = [
  { action: "shorter", name: ACTIONS.shorter.name },
  { action: "simpler", name: ACTIONS.simpler.name },
  { action: "like", name: ACTIONS.like.name, also: ["Sounds like me"] },
  { action: "broll", name: "B-roll", also: [ACTIONS.broll.name, "Broll", "B roll", "Suggest broll"], needs: "spoken" },
  { open: "add", name: "Add B-roll", also: ["Add broll", "Add b roll"], needs: "addBroll" },
  { action: "explain", name: ACTIONS.explain.name, also: ["Explain"] },
  { action: "facts", name: ACTIONS.facts.name, also: ["Facts"] },
  { action: "links", name: ACTIONS.links.name, also: ["Links"] },
  { open: "more", name: "More" },
];
const same = (text) => text.trim().replace(/\s+/g, " ").toLowerCase();
const spellings = (c) => [c.name, ...(c.also || [])];
// Why a command can't run here; "" when it can. can: { spoken, addBroll, guest }.
function refusal(c, can) {
  if (c.needs && !can.spoken) return "no spoken words here";
  if (c.needs === "addBroll" && !can.addBroll) return can.guest ? "the host adds B-roll" : "the B-roll list isn't ready";
  return "";
}

/** What the typed line does: null (nothing typed), { kind: "act", action }, { kind: "add" }, { kind: "more" },
 *  { kind: "blocked", why } or { kind: "ask", text }. */
export function resolveTyped(typed, can) {
  const text = String(typed ?? "").trim();
  if (!text) return null;
  const c = COMMANDS.find((x) => spellings(x).some((s) => same(s) === same(text)));
  if (!c) return { kind: "ask", text };
  const why = refusal(c, can);
  if (why) return { kind: "blocked", why };
  return c.open ? { kind: c.open } : { kind: "act", action: c.action };
}

/** What the ghost may offer for what is typed, best first: the commands that can run here, then earlier asks. Each is
 *  longer than the typed text and starts with it, whatever the case. */
export function suggestions(typed, { can, earlier = [] } = {}) {
  const text = String(typed ?? "");
  if (!text.trim()) return [];
  const fits = (s) => s.length > text.length && s.slice(0, text.length).toLowerCase() === text.toLowerCase();
  const out = [];
  for (const c of COMMANDS) {
    if (refusal(c, can)) continue;
    const s = spellings(c).find(fits);
    if (s) out.push(s);
  }
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
/** On a phone the bar is docked at the bottom, so the system's selection handles stay free; at the top when it would sit
 *  on the words and they are clear of the top. lift: what the on-screen keyboard covers. */
export function phoneDock({ first, last, h, top, vh, lift = 0 }) {
  const barTop = vh - lift - EDGE - h;
  const onWords = last.bottom > barTop && first.top < vh - lift;
  return onWords && first.top >= top + EDGE + h + EDGE ? "top" : "bottom";
}
