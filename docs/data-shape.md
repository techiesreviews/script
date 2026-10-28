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

An ask is one request to the person's own agent. It is made from the edit bar (`scope: "selection"`) or from "Sounds like me" (`scope: "script"`).

```js
Ask {
  id, scope: "selection" | "script",
  blockId?, start?, end?, quote?,      // selection only: offsets in the block's content, and the selected text
  context?,                            // the block's content when the ask was made
  section?,                            // the heading text of the block's section
  action: "like" | "simpler" | "shorter" | "explain" | "facts" | "ask" | "voice",
  instruction,                         // the standard instruction, or the typed Ask text
  by: { id, name },                    // who asked
  createdAt,                           // ISO time
  status: "waiting" | "taken" | "answered" | "kept" | "undone" | "cancelled",
  takenAt?, takenBy?: { id, name },    // when and by which agent the ask was picked up
  answer?, answeredBy?: { id, name }
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

Answers (an optional `message` of at most 200 characters fits any kind):

```js
{ kind: "replace", text }                         // old text struck through, new text marked, Keep / Undo
{ kind: "add", text }                             // new text after the quote, Keep / Undo
{ kind: "note", text, tone: "ok" | "look" }       // a note chip, dismissed with ✕
{ kind: "marks", marks: [{ quote, why, rewrite }] }  // script scope only: dashed underlines with a voice card
```

When a `marks` answer arrives, the editor anchors each mark like a selection and tracks it:

```js
Mark { quote, why, rewrite, blockId, start, end, state: "open" | "kept" | "used" | "gone" }
```

`open` shows the dashed underline. "Keep mine" sets `kept`; "Use this" sets `used` and makes a new **selection-scope ask with `action: "voice"`** at the mark's place, already `answered` with `{ kind: "replace", text: rewrite }`, so it shows the usual Keep / Undo. A mark whose quote disappears after an edit becomes `gone`. The script ask is `kept` once no mark is open.

Life of an ask: `waiting` → `taken` (an agent picked it up with `wait_for_asks`; an ask taken more than two minutes ago without an answer is offered again) → `answered` → `kept` or `undone`. The person can cancel a waiting ask (`cancelled`). Anchors follow edits: the editor keeps `start`/`end` and the `quote`; after an edit in that block it finds the quote nearest the old offset, or cancels the ask when the quote is gone. Open asks (`waiting`, `taken`, `answered`) are kept in memory and in the browser's local storage with the draft, never in the file.

## Agent connection (step B)

The tab keeps `{ token, createdAt }` in local storage (`script-editor:agent`); a token lives at most eight hours. The relay (one Durable Object per `sha256(token)`) stores only `{ createdAt, revoked, agent: { name, version } }`. Asks, answers and script text pass through it in memory and are never stored. The voice guide (`{ name, text }`, at most 20 KB) stays in local storage and goes out with `like` and `voice` asks as `voiceGuide`.

## How several people fit later

- **Stable block ids** let edits, carets and asks point at a block while other people type in other blocks. A future edit message is `{ by, blockId, content, base }` (the content before and after), so a relay can merge edits block by block.
- **An author on everything:** every ask has `by`, every answer has `answeredBy`, and the future edit message has `by`. Undo per person can then undo only that person's steps, like the Native Site Editor's undo on a name tag.
- **Room for people and carets:** a shared session adds
  ```js
  people: [{ id, name, kind: "person" | "agent", colour }]
  carets: [{ personId, blockId, offset, end? }]
  ```
  Carets use the same block ids and content offsets as asks, so they follow edits the same way.
- The file on disk stays plain Markdown. Ids, asks, people and carets live only in the session.

## Files, recent scripts and the prompter link

- **Saving:** there is no Save button. The editor writes to the open file (File System Access handle) about 1.5 s after the last change, on Ctrl/Cmd+S and when the page is hidden. If the file changed on disk, it does not overwrite: "Save mine · Open that version". If write permission is missing, a quiet "Allow saving to <name>" button shows next to the save state. Without a handle (the sample, a new script, browsers without the API), Export → "Markdown file (.md)" picks a file (or downloads) and auto-save then writes there. A localStorage draft per file name stays as the safety net. Saves asked for while another runs wait per script (`public/save-queue.js`): a script the person has left is written to its own file with auto-save rules, or its draft is re-stamped so "Unsaved changes from …" shows when it is reopened.
- **Recent scripts:** IndexedDB `script-editor` → store `handles` → key `recent`: `[{ handle, name, at }]`, newest first, at most 20. Removing a row only edits this list; the file is never deleted. (The older key `last` is read once if `recent` is missing.)
- **Prompter link:** `prompterLink(exportPrompter(doc))` in `doc.js` builds `https://prompter.techies.tools/#s=<deflate-raw, base64url>` exactly like `makeLink` in techies-prompter's `src/core.mjs`, preset "default" (no `&p=`). Above 100,000 characters (`PROMPTER_MAX_CHARS`) there is no link and the Export item shows "Too long for the prompter". The script stays in the URL fragment, which is never sent to a server.
