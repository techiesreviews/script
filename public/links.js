// Links in the script (step G, Lex 2026-10-28), in the prompter's format (techies-prompter src/core.mjs):
//   "[words](https://full-address)"  a link inside a spoken line; the words are what is spoken
//   "- Label: https://full-address"  a link line of its own (the first one under a heading opens with the section)
// The editor keeps the Markdown as it is; these find the links in a block's content, give the spoken words without
// them, and put the agent's links (answer kind "links") into the text. Pure: no DOM.

// The prompter's own patterns: link words hold no brackets and at least one letter that is not a space; the address
// may hold one level of brackets, as Wikipedia addresses do.
const TEXT_LINK = /\[([^[\]]*[^\s[\]][^[\]]*)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/gi;
export const LINK_LINE_RE = /^-\s*(?:(.+?):\s+)?(https?:\/\/\S+)\s*$/;
const ADDRESS_RE = /^https?:\/\/(?:[^\s()]|\([^\s()]*\))+$/i;
export const LINK_LIMITS = { links: 30, url: 2000 };
const WORDY = /[\p{L}\p{N}]/u;

/** The text links in a block's content: [{ start, end, words: { start, end }, label, url }] (content offsets;
 *  `start`…`end` is the whole "[…](…)", `words` the part between the brackets, `label` the words trimmed). */
export function textLinks(content) {
  const out = [];
  for (const m of String(content ?? "").matchAll(TEXT_LINK)) {
    out.push({ start: m.index, end: m.index + m[0].length, words: { start: m.index + 1, end: m.index + 1 + m[1].length }, label: m[1].trim(), url: m[2] });
  }
  return out;
}
/** Is this line (a line of a block) a prompter link line, "- Label: https://…"? */
export const isLinkLine = (line) => LINK_LINE_RE.test(String(line ?? "").trim());

/** What is spoken: the content without link lines, each text link replaced by its words (as the prompter reads it). */
export function spokenText(content) {
  const lines = String(content ?? "").split("\n").filter((l) => !isLinkLine(l));
  return lines.join("\n").replace(TEXT_LINK, (_, words) => words.trim());
}

/** A full https:// or http:// address the prompter reads as one link (no spaces, no control characters). */
export function safeUrl(url) {
  if (typeof url !== "string" || !url || url.length > LINK_LIMITS.url || /[\u0000-\u001f\u007f]/.test(url) || !ADDRESS_RE.test(url)) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch { return false; }
}

// Ranges a new link may not touch: the text links already there and the link lines.
function taken(content) {
  const out = textLinks(content).map((l) => [l.start, l.end]);
  let at = 0;
  for (const line of content.split("\n")) {
    if (isLinkLine(line)) out.push([at, at + line.length]);
    at += line.length + 1;
  }
  return out;
}
const overlaps = (ranges, s, e) => ranges.some(([a, b]) => s < b && e > a);
// A quote that starts or ends with a letter or digit is linked only on whole words ("AI" not inside "MAIL").
const wholeWords = (content, s, e) => !(WORDY.test(content[s] ?? "") && WORDY.test(content[s - 1] ?? "")) && !(WORDY.test(content[e - 1] ?? "") && WORDY.test(content[e] ?? ""));
// The agent reads the spoken text with line breaks and runs of spaces made one space, so a quote's spaces match any
// run of spaces and line breaks in the content ("Claude Code" finds "Claude\nCode"); the link's words get one space.
const quoteRe = (quote) => new RegExp(quote.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");
const oneSpace = (text) => text.replace(/\s+/g, " ");

/**
 * Put the agent's links into the asked text: each quote's first unlinked occurrence becomes "[quote](url)".
 * segments: [{ id, content, from, to, avoid? }] in reading order (the asked text in each block: a selection is one
 * segment, the whole script one per spoken paragraph). `avoid`: [[start, end]] in the content that other open work
 * points at (open asks, "Sounds like me" marks, the agent's marked changes): a segment's change (from its first new
 * link to its last) never reaches into them. others: the content of the blocks where links don't go (headings,
 * reminders), only to say why a quote found there was skipped.
 * Returns { segments: [{ id, content, links: [{ quote, url }], from, to, delta }] (only the ones that changed;
 * from…to is the changed stretch in the old content, delta the change in length), skipped: [{ quote, why }] }.
 */
export function planLinks(segments, links, { others = [] } = {}) {
  const state = segments.map((s) => ({ ...s, taken: taken(s.content), avoid: s.avoid || [], picks: [] }));
  const skipped = [], seen = new Set();
  for (const link of links || []) {
    const quote = String(link?.quote ?? "").trim(), url = link?.url;
    const skip = (why) => skipped.push({ quote: quote.slice(0, 80), why });
    if (!quote) { skip("empty quote"); continue; }
    if (!safeUrl(url)) { skip("not a full https:// address"); continue; }
    if (seen.has(oneSpace(quote))) { skip("already linked in this answer"); continue; }
    if (/[[\]]/.test(quote)) { skip("not found word for word in the asked text"); continue; }
    const re = quoteRe(quote);
    let found = false, linked = false, busy = false, across = false;
    for (const s of state) {
      re.lastIndex = s.from;
      for (let m = re.exec(s.content); m && m.index + m[0].length <= s.to; re.lastIndex = m.index + 1, m = re.exec(s.content)) {
        const i = m.index, e = i + m[0].length;
        if (!wholeWords(s.content, i, e)) continue;
        if (overlaps(s.taken, i, e)) { linked = true; continue; }
        if (overlaps(s.avoid, i, e)) { busy = true; continue; }
        // The segment's change runs from its first link to its last: it must not take in other open work.
        const from = Math.min(i, ...s.picks.map((p) => p.start)), to = Math.max(e, ...s.picks.map((p) => p.end));
        if (overlaps(s.avoid, from, to)) { across = true; continue; }
        s.picks.push({ start: i, end: e, words: oneSpace(m[0]), quote, url });
        s.taken.push([i, e]);
        found = true;
        break;
      }
      if (found) break;
    }
    if (found) { seen.add(oneSpace(quote)); continue; }
    if (busy) skip("under an open ask or change");
    else if (across) skip("an open ask or change sits between it and another link in its paragraph");
    else if (linked) skip("already linked");
    else if (others.some((c) => { re.lastIndex = 0; return re.test(String(c)); })) skip("in a heading or reminder, where links don't go");
    else skip("not found word for word in the asked text");
  }
  const out = [];
  for (const s of state) {
    if (!s.picks.length) continue;
    s.picks.sort((a, b) => a.start - b.start);
    let content = "", at = 0;
    for (const p of s.picks) { content += s.content.slice(at, p.start) + `[${p.words}](${p.url})`; at = p.end; }
    content += s.content.slice(at);
    out.push({ id: s.id, content, links: s.picks.map(({ quote, url }) => ({ quote, url })), from: s.picks[0].start, to: s.picks.at(-1).end, delta: content.length - s.content.length });
  }
  return { segments: out, skipped };
}

/* Closed links in the editor (app.js): a link shows only its words while the caret is outside it. `link` is one of
   textLinks()'s ({ start, end, words: { start, end } }, content offsets). */
/** A caret put on the edge of a closed link (where its words begin or end) goes just outside it, so typing there adds
 *  to the line, not to the link's words: the words' start → the link's start, their end → the link's end. */
export function edgeSnap(link, offset) {
  if (offset === link.words.start) return link.start;
  if (offset === link.words.end) return link.end;
  return offset;
}
/** Where an offset shows while these links are closed: inside a hidden "[" at the words' start, inside a hidden
 *  "](address)" at the words' end (others' carets and selections are drawn there). */
export function shownOffset(links, offset) {
  for (const l of links) {
    if (offset > l.start && offset < l.words.start) return l.words.start;
    if (offset > l.words.end && offset < l.end) return l.words.end;
  }
  return offset;
}
/**
 * After a deletion in a block (`old` → `now`; `caret`: the caret's offset in `now`, to place the deletion): next to a
 * closed link, Chromium and WebKit delete its hidden "](address)" (or "[") along with the character the person
 * deleted. That hidden Markdown is put back; a link whose words were all deleted goes as a whole, as it was seen.
 * `closed`: the links that were closed before the edit (textLinks() shape, offsets in `old`).
 * Returns { content, caret } (the caret where the deleted text was), or null when no hidden Markdown was lost.
 */
export function keepHidden(old, now, closed, caret) {
  const del = old.length - now.length;
  if (del <= 0 || !closed?.length) return null;
  const at = Number.isInteger(caret) && caret >= 0 && caret <= now.length && old.slice(0, caret) + old.slice(caret + del) === now ? caret : (() => {
    let p = 0;
    while (p < now.length && old[p] === now[p]) p++;
    return old.slice(0, p) + old.slice(p + del) === now ? p : -1;
  })();
  if (at < 0) return null; // not one deletion
  const end = at + del, gone = new Uint8Array(old.length).fill(1, at, end);
  let lost = false;
  for (const l of closed) {
    if (l.start >= end || l.end <= at || (at <= l.start && end >= l.end)) continue; // untouched, or gone as a whole
    const hidden = [[l.start, l.words.start], [l.words.end, l.end]];
    if (!hidden.some(([a, b]) => a < end && b > at)) continue; // only its words were touched
    lost = true;
    if (at <= l.words.start && end >= l.words.end) gone.fill(1, l.start, l.end);
    else for (const [a, b] of hidden) gone.fill(0, a, b);
  }
  if (!lost) return null;
  let content = "", to = -1;
  for (let i = 0; i < old.length; i++) {
    if (!gone[i]) content += old[i];
    else if (to < 0) to = content.length;
  }
  return { content, caret: to < 0 ? content.length - (old.length - end) : to };
}
