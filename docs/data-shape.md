# Data shape

The document and the asks, as `public/doc.js` builds them. Version 1 is for one person; the shape leaves room for several people and agents later.

## Document

```js
Document { blocks: Block[], tail: string, eol: "\n" | "\r\n" }
Block    { id: string, type: "title" | "heading" | "note" | "raw" | "para", text: string, sep: string }
```

- `serialize(doc)` is `blocks.map(b => b.sep + b.text).join("") + tail`, and gives back the opened file byte for byte. `sep` is the exact separator before the block (`""` for the first block, or the file's leading blank lines). `tail` is the trailing whitespace. `eol` is the file's main line ending, used for new blocks (`sep` is two line endings) and for edited text.
- `text` is the block's exact Markdown, including `# ` or `## `. The editor shows and edits the **content**: the text without that marker, with `\n` line breaks (`contentOf(block)`).
- `id` is random and short (8 characters) and stays the same through every edit, split, merge and undo. New blocks get new ids. Ids are not written into the file; they live while the file is open.
- Sections: each `heading` starts one. A section is spoken when its heading starts with a number (`## 1 · Hook (0:00–0:40)`); when no heading is numbered, every section is spoken. Blocks before the first heading are the front matter.

## Ask

An ask is one request to the person's own agent. It is made from the edit bar (`scope: "selection"`) or from "Sounds like me" and "Find links in the script" (`scope: "script"`).

```js
Ask {
  id, scope: "selection" | "script",
  blockId?, start?, end?, quote?,      // selection only: offsets in the block's content, and the selected text
  context?,                            // the block's content when the ask was made
  section?,                            // the heading text of the block's section
  action: "like" | "simpler" | "shorter" | "explain" | "facts" | "ask" | "voice" | "links",
  instruction,                         // the standard instruction, or the typed Ask text
  by: { id, name },                    // who asked
  createdAt,                           // ISO time
  status: "waiting" | "taken" | "answered" | "kept" | "undone" | "cancelled",
  takenAt?, takenBy?: { id, name },    // when and by which agent the ask was picked up; id "agent:<clientInfo name>", name the model ("Claude", public/agent-brand.js)
  answer?, answeredBy?: { id, name },
  change?: { text, removed, at, ctx? } // step F: a replace or add that went straight in, while it is marked;
                                       // ctx = { index, before, after } where it is kept or shared (below)
  from?,                               // step G: one paragraph's links from a whole-script "Find links" (its id)
}
```

Standard instructions (`ACTIONS` in `doc.js`):

| action | instruction |
| --- | --- |
| like | Rewrite in the speaker's own voice: plain spoken words, short sentences, everyday metaphors. Keep the meaning and facts. |
| simpler | Use simpler words and shorter sentences a beginner understands. |
| shorter | Say the same in fewer words. |
| explain | Add one or two plain sentences that explain how this works. |
| facts | Check names, numbers and dates against what you know or can look up. Answer with a note. |
| voice | Mark lines in the spoken text that sound generic or AI-like, with a one-line reason and a rewrite in the speaker's voice. |
| links | Find the tools, sites and sources this text mentions and link each one to its official page: the maker's own site, the exact docs page or the original source. Never a search page, a shortener or an affiliate link. Skip a mention when you are not sure of the page. Answer with kind "links": each quote copied word for word from the spoken text. |

Answers (an optional `message` of at most 200 characters fits any kind):

```js
{ kind: "replace", text }                         // goes straight into the text in place of the quote (step F)
{ kind: "add", text }                             // goes straight into the text after the quote (step F)
{ kind: "note", text, tone: "ok" | "look" }       // a note chip, dismissed with ✕
{ kind: "marks", marks: [{ quote, why, rewrite }] }  // script scope only: dashed underlines with a voice card
{ kind: "links", links: [{ quote, url }] }        // "Find links" (a selection or the whole script) and free asks: straight in (step G)
```

**Straight in (step F, Lex 2026-10-28).** A `replace` or `add` answer on a selection goes into the text at once, as one change (one Ctrl/Cmd+Z step when alone; in a shared script the host's tab applies it and sends it under the agent's name, `by: "agent"`). The ask becomes `kept`, its `start`/`end` cover the changed text, and `change = { text, removed, at }` holds the new text, what it replaced (`""` for an add) and when (`at`, ms). While that text is untouched it is lightly tinted in the agent colour and the agent's caret sits at the newest such change; Undo on its name tag puts `removed` back in place of `text` and makes the ask `undone`. The mark follows edits around it (`public/changes.js`); an edit inside it, a new ask on it, or Ctrl/Cmd+Z of that step ends it (`change` is dropped; the ask stays `kept`, or becomes `undone` for Ctrl/Cmd+Z). **One paragraph:** a replace or add stays inside its block. Blank lines in its text become one space (single line breaks stay; in a heading or the title every line break becomes a space). A text that would turn the block into another kind (a `## ` or `- ` at its start, brackets around a para, a note losing its brackets) goes in on one line without the marks at its start (`#`, `-`, `*`, `+`, `_`, `>`, `|`, `` ` ``, `~`, `[`, `<`, `1.`) and a `]` at its end; when it still can't keep its type, the tab refuses the answer and tells the agent so. So every such answer is marked and has Undo (going in unmarked is only a safety net). A change of only spaces gets no mark. The answer's `message` shows under the line while the change is marked.

**Finding a marked change again.** Where a marked change is kept with the draft or shared with guests, its `change.ctx` = `{ index, before, after }` says its exact place: its block's position in the script and up to 40 characters on each side, as they are when it is stored or shared. After a reload, Restore or Discard (new block ids) it is placed in the block at `index`, a guest places it in the block with the same id, and only where its text and both sides match exactly, at one spot; otherwise it shows no mark and has no Undo, never a guess on another copy of the same words. A guest keeps a mark it already shows where its own copy has followed it since (its own typing in front of it), while its text is there. The "new" tint uses the time this tab got the change.

When a `marks` answer arrives, the editor anchors each mark like a selection and tracks it:

```js
Mark { quote, why, rewrite, blockId, start, end, state: "open" | "kept" | "used" | "gone" }
```

`open` shows the dashed underline. "Keep mine" sets `kept`; "Use this" sets `used` and makes a new **selection-scope ask with `action: "voice"`** at the mark's place, already `answered` with `{ kind: "replace", text: rewrite }`, which goes straight in like any replace (step F), with Undo on the agent's name tag. A mark whose quote disappears after an edit becomes `gone`. The script ask is `kept` once no mark is open.

Life of an ask: `waiting` → `taken` (an agent picked it up with `wait_for_asks`; an ask taken more than two minutes ago without an answer is offered again) → `answered` (a note) → `kept` or `undone`; a replace or add is `kept` as soon as it is in the text, and `undone` when the person undoes it. The person can cancel a waiting ask (`cancelled`). Anchors follow edits: the editor keeps `start`/`end` and the `quote`; after an edit in that block it finds the quote nearest the old offset, or cancels the ask when the quote is gone. Open asks (`waiting`, `taken`, `answered`) and marked changes are kept in memory and in the browser's local storage with the draft, never in the file; after a reload a marked change comes back only at its exact place (`change.ctx`, above).

## Links (step G)

Lex (2026-10-28): a link in the script opens by itself in the prompter. The format is the prompter's (`techies-prompter/src/core.mjs`), read in `public/links.js`:

- `[words](https://full-address)` inside a spoken line: the words are spoken, the address opens. Only `https://` and `http://`; the words hold no brackets; the address may hold one level of brackets (Wikipedia).
- `- Label: https://full-address` as a line of its own (a raw block, or a line inside a para): a prompter link line. The first one right under a heading opens when the section starts.
- Not in reminders or headings. A para that starts with a link (`[The docs](https://…) say…`) stays a spoken para even when it ends with `]`.

The file keeps the Markdown exactly; so do the editor's text model, the asks' offsets, carets and the room. Only the display changes: in a para a link shows as its words with a faint dotted underline, and `[`, `](` and the address are hidden while the caret is outside it; with the caret at or in it, or a selection touching it, all of it shows. A caret put on the edge of a closed link goes just outside it. A deletion next to a closed link never takes its hidden Markdown (Chromium and WebKit would, on Backspace after it): that part is put back (`keepHidden`), and a link whose words were all deleted goes whole. Ctrl/Cmd+click opens the address in a new tab; its title shows the address.

- **Exports.** `exportPrompter` never splits a sentence inside a link, and passes link lines through in their place (from paras and from raw blocks; the rest of a raw block stays out). `exportCamera`, `stats` and the edit bar's word count use only the words (`spokenText`: links become their words, link lines go).
- **The agent's links.** "Find links" in the edit bar's More menu makes a selection ask (`action: "links"`, guests too); "Find links in the script" in the agent menu makes a script ask (host only), whose `spokenText` the agent reads. The answer is `{ kind: "links", links: [{ quote, url }] }`, at most 30, each `quote` at most 500 characters and `url` a full `https://`/`http://` address of at most 2000 (no spaces, no `javascript:` or `data:`; `safeUrl`, checked by the Worker and the tab). Each quote's first unlinked occurrence in the asked text (whole words, inside the selection or in a spoken para) becomes `[words](url)`. A space in the quote matches any run of spaces and line breaks in the text, because the agent reads `spokenText` with them made one space ("Claude Code" finds "Claude⏎Code"); the link's words then get one space, and Undo gives the line break back. Quotes not found, repeated in the same answer, already linked (or in a link line), or only in headings and reminders are skipped and listed back to the agent; with none left the tab refuses the answer and the ask stays open.
- **Out of other open work.** Links never land in text that other open work points at: open asks on a selection (waiting, taken or answered, not B-roll suggestions), open "Sounds like me" marks and the agent's marked changes (`planFor(doc, ask, answer, { asks })` gives each block's ranges to `planLinks` as `avoid`). A paragraph's change runs from its first new link to its last, so it never takes such text in either. Those quotes are skipped with "under an open ask or change" (or "an open ask or change sits between it and another link in its paragraph"), so that work keeps its text, its mark and its Undo. This holds for the whole script and for a selection (other work in its block). A paragraph whose links would turn it into another kind of block gets none; its quotes are skipped too.
- **Straight in.** On a selection the links are one change like a replace (step F): `kept` at once, `change.text` runs from the first new link to the last, Undo puts the words back. On the whole script every para that gets links is its own marked change with an ask of its own (`scope: "selection"`, `action: "links"`, `from: <script ask id>`, the same `by`, already `kept`), so marks, Undo on the agent's name tag (one para at a time), drafts and guests work as in step F; the script ask is `kept`. The landing is one Ctrl/Cmd+Z step when alone: its `land` is `{ id: <script ask>, status, also: [<paras' asks>] }` and turns them all undone (or kept again on redo).

## B-roll list and sketches (step C)

`public/broll.js` reads a B-roll Markdown file linked to the script (IndexedDB store `handles`, key `broll:<script name>`: `{ handle, name }`, or `{ name, text }` without a file handle, or `{ none: true }` after unlinking the demo).

```js
Shot { id, what, over, how, kind: "broll" | "motion" | "screen", blockIds: string[], check: boolean }
```

- Main table `# | What to show | Over (A-roll line) | How to make it`; a table under a "Screen recordings" heading gives `kind: "screen"`; a "How" that mentions motion gives `kind: "motion"`.
- Optional `Kind` column (step C2): a cell naming "Screen…", "Motion…" or "B-roll" decides the kind and wins over the heading and the "How" text. An empty or unknown cell (for example "Photo") falls back to the heading and "How" rules.
- Export "B-roll list (.md)" (`exportBroll`) writes one table in script order, unmatched shots last, with the columns `# | Kind | What to show | Over (A-roll line) | How to make it | Check`, then `## Sketches` (the shots' sketches first, then any others; ids with spaces are left out). `Check` is written for people only and never read back: check flags live with the draft. The file can be linked again and gives the same shots and sketches.
- `over` is matched to spoken paras, ignoring quotes, `…`, case and punctuation: the block that starts with the words wins, else the first that contains them. `"A…" through "B"` covers every spoken para from A to B. No match: `blockIds: []` ("Not found in the script").
- `check` turns on when a covered block's text changes (typing, Keep, undo) and off when the shot is lit. Flags are kept with the draft as `broll: { [shotId]: true }`.
- Sketches live in the B-roll file under `## Sketches` as fenced blocks: ```` ```svg B4 ```` + one `<svg viewBox="0 0 260 140">` + ```` ``` ````, using only `svg g path rect circle ellipse line polyline polygon text`, geometry attributes, `class` (`s`, `l`, `o`, `mv`), `text-anchor` and `transform`. `sanitizeSvg` drops everything else, on read and on every agent sketch.
- "Ask for sketches" makes an ask `{ scope: "broll", action: "sketch", shots: [{ id, what, over, kind }] }`. The agent answers with `sketch_shot { askId, shotId, svg }` (svg at most 8 KB), once per shot; the answer is `{ kind: "sketches", sketches: { [shotId]: svg }, done: { [shotId]: "kept" | "undone" } }`. Keep writes the sketch into the file's `## Sketches` section (`setSketch`). The ask is `kept` (or `undone`) once every shot is done.
- `get_script` returns `broll: Shot[]`.
- B-roll from the agent (step C4): "Suggest B-roll" makes `{ scope: "selection", action: "broll" }`, "Plan B-roll" makes `{ scope: "broll", action: "plan" }`; those and free `ask` asks may be answered with `answer_broll`. The answer is `{ kind: "broll", changes: [{ op: "add", kind, what, how, quote, over, why, state } | { op: "update", id, what?, how?, kind?, why, state } | { op: "remove", id, why, state }], message? }` with `state` `open`, `kept` or `undone`; an add's `over` comes from its quote (`quoteSelection` + `overFor`). Keep writes through `applyBrollChanges` (the C3 functions, one queued write; "Keep all" writes them all in order at once); Undo writes nothing. The ask is `kept` or `undone` once every change is done. Open answers stay with the draft like other asks.
  - Rules: one change per shot in an answer (a second change to the same id is refused); an add's quote must start and end on whole words; an open update or remove whose shot has left the list becomes `undone` (when the list is adopted, unlinked, or a draft is restored or discarded, and on Keep, where only changes that really applied count as `kept`). "Keep all · Undo all" shows while an answer with several changes still has some waiting, and acts on the waiting changes of those answers.
- Shots added in the editor (step C3): "Add B-roll" on a selection writes a row with `addShot` (next free `B<n>`, or `S<n>` for a screen recording; Over from `overFor`, so the matcher finds the same spoken paras); the shot card changes it with `updateShot` and removes it, with its sketch, with `removeShot`. Each changes only its own lines. A linked file is written through the one-write-at-a-time queue. A list without a file (the demo, one opened without a handle, or a new list whose save picker was cancelled) is kept in local storage as `script-editor:brollList:<script name>`, apart from the script's draft, until "Save as…" turns it into a linked file.

## Agent connection (step B)

The Worker makes each token (`POST /api/agent-token` → `{ token, createdAt }`): `se2-<birth time>-<random>`, with the Worker's own time (`Date.now()` in base36) and 32 random bytes (base64url). The Worker's clock both writes the birth time and checks it, because a browser clock that is ahead would make a new token look as if it came from the future and be refused, and one that is behind would shorten or kill it. A token lives eight hours from its birth; one more than a minute in the future is refused. It needs no signature: the relay is picked by the hash of the whole token, so a changed birth time is another token with an empty relay, a past one only lives shorter, and a future one is refused. The Worker refuses a token past its time before any relay is touched (`/api/relay` closes the socket with `4003`, `/mcp` answers 401). Tokens made by the tab before this (43 random characters) work until 2026-10-30 12:00 UTC.

The tab fetches a spare token when the agent menu opens, so **Wait for MCP** can copy the prompt at once, and keeps `{ token, createdAt }` in local storage (`script-editor:agent`), with `createdAt` the time the token arrived on the tab's own clock. The relay (one Durable Object per `sha256(token)`) stores only `{ createdAt, expiresAt, revoked, agent: { name, version } }`, with `createdAt` the birth time and `expiresAt` eight hours later. An alarm a minute after `expiresAt` refuses what still waits, closes the tab's socket with `4003` and erases the note; a revoked note (Disconnect MCP) stays, refusing the token, until then. A note from before `expiresAt` existed gets its alarm when it is used again, for the day old tokens stop. Asks, answers and script text pass through it in memory and are never stored. The voice guide (`{ name, text }`, at most 20 KB) stays in local storage and goes out with `like` and `voice` asks as `voiceGuide`.

## Working together (step D)

Built in `public/together/` (see `docs/together.md`). While a script is shared, the room sees it as blocks `{ id, text: contentOf(block), attrs: { type, sep, prefix } }` and edits as block operations (`{ type: "text", blockId, at, del, ins }`, split, merge, insert, remove, attrs). The session adds

```js
people: [{ pid, name, colour, kind: "person" | "agent" }]   // colour: an index into the fixed caret palette
carets: { [pid]: { blockId, offset, selEnd? } }             // content offsets, like asks
```

A person's id is `pid` (the plan called it `personId`): `"host"` for the host, a fresh id per connection for a guest; messages carry it as `from`, and an operation's author as `by`. Carets use the same block ids and content offsets as asks, so they follow edits the same way. Every ask has `by` and every answer `answeredBy`; each operation the host sends carries `by`, so Undo on a name tag undoes only that person's change. The file on disk stays plain Markdown: ids, people and carets live only in the session, and the room stores no script text.

Asks in a shared script (step D2): the host keeps them. A guest's ask has `by: { id: <asker>, name }`, where `asker` is an opaque id the host made at random for that guest tab and tied to the hash of a private secret the tab sent (see docs/together.md); the host shares every open ask as it is in `state.asks`, and each guest places them in its own copy by their quotes (a marked change only at its exact place, `change.ctx`). Only `by` and the host may Keep, Undo or dismiss; that includes Undo on the agent's name tag for a marked change, which the host shares with the open asks. The agent's caret is not stored: every tab works it out from the asks (`takenBy` / `answeredBy` name, the ask's `end`, or the newest marked change). `agentBrand(name)` turns that name into the caret's name and logo (`{ name: "Claude", icon: "ai-claude" }`, an unknown agent keeps its name with `ai-sparkle`), so older names such as "Claude Code" map too.

## Files, recent scripts and the prompter link

- **Saving:** there is no Save button. The editor writes to the open file (File System Access handle) about 1.5 s after the last change, on Ctrl/Cmd+S and when the page is hidden. If the file changed on disk, it does not overwrite: "Save mine · Open that version". If write permission is missing, a quiet "Allow saving to <name>" button shows next to the save state. Without a handle (the sample, a new script, browsers without the API), Export → "Markdown file (.md)" picks a file (or downloads) and auto-save then writes there. A localStorage draft per file name stays as the safety net. Saves asked for while another runs wait per script (`public/save-queue.js`): a script the person has left is written to its own file with auto-save rules, or its draft is re-stamped so "Unsaved changes from …" shows when it is reopened.
- **Recent scripts:** IndexedDB `script-editor` → store `handles` → key `recent`: `[{ handle, name, at }]`, newest first, at most 20. Removing a row only edits this list; the file is never deleted. (The older key `last` is read once if `recent` is missing.)
- **Prompter link:** `prompterLink(exportPrompter(doc))` in `doc.js` builds `https://prompter.techies.tools/#s=<deflate-raw, base64url>` exactly like `makeLink` in techies-prompter's `src/core.mjs`, preset "default" (no `&p=`). Above 100,000 characters (`PROMPTER_MAX_CHARS`) there is no link and the Export item shows "Too long for the prompter". The script stays in the URL fragment, which is never sent to a server.
