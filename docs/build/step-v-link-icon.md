# Step V: the link icon and bold links

Lex (2026-11-07): "I am missing the possibility to bold links or have bold links. Would also be nice to add a link icon besides the bold icon." On the sketch: "No explainer text please, enter is accepting, and esc is canceling. When something is in the field connect it, than see a breaking chain when it is linked, on hover see the link, on click remove the link. Prompter should just see the words, not the bold words. The prompter format should have a link, on where we want to use that site." Approved: "The prototype is awesome, rest is good". The sketch is kept outside this repository, with the fleet lead.

## What changes

- **The link icon** sits right after B on the selection bar, for spoken paragraphs (where B shows).
  - On words that aren't a link it is a chain. A click turns the input into an address field (placeholder `https://`). Enter links the words, Escape goes back to asking (the bar stays). No Apply or Remove buttons and no explainer text; Send does what Enter does.
  - The field takes addresses up to 2,000 characters (the asking input keeps its 500).
  - While a full `https://` or `http://` address is in the field (a dot in its host name: `L.typedAddress`), the selected words show linked (a dotted underline, the `link-preview` highlight) and the icon shows on.
  - On a link it is a broken chain, shown on. Hover (or keyboard focus) shows the address under it (screen readers hear it as the icon's description). A click removes the link: its words stay, and so does their bold. Ctrl/Cmd+Z brings it back, one step per change.
  - Part link, part plain words (or words across a line break): the icon is grey. Over open work (an ask, a marked change) it is grey too, as B is.
  - The field keeps at least 200 px (step T): under about 430 px (most phones) B and the link icon take a row of their own above the input; before, B did that only under about 378 px.
  - Guests link and unlink too; it reaches everyone and the guest's own Ctrl/Cmd+Z undoes it.
- **Bold links**, stored as plain Markdown, three ways (`public/cues.js`):
  - bold words inside a link: `[read the **login** page](https://…)`;
  - a whole bold link: `**[WP Activity Log](https://…)**` (B on all of a link's words makes this one);
  - a link inside bold words: `**try [WP Activity Log](https://…) today**`.
  - A bold stretch never crosses a link's edge: B or the link icon on words that half cover a link (or half a bold stretch) split the bold at the link's edge, so the marks nest (`**free plan of** [**WP** Activity Log](https://…)`).
  - B shows on when every selected word is bold; B then takes off the bold the selected words are in, as before. The link icon shows on when every selected word is in one link.
  - The editor draws each inside the other's words; each hides and shows its own Markdown with the caret, as before.
  - Every change of marks is checked to keep the same spoken words and, for links, the same bold words (`boldWords`); else nothing changes.
- **The prompter file** keeps the words and every `[words](https://…)` link where it is used, and drops the `**` marks, as before (`stripCues` now also takes the marks inside and around links). The camera script, word counts and spoken time read only the words.
- **The agent**:
  - Find links reads a quote in the spoken words without bold marks: inside bold words the link goes inside them (all of them: a whole bold link), bold words it covers go inside the link, and bold half covered is split at the link's edge. No quote is skipped any more for being bold.
  - `mark_cue` marks words inside a link's words or holding whole links, and splits at a link's edge; link lines stay off limits ("inside a link line"). `unmark_cue` takes a bold link's quote with or without its Markdown.
  - A rewrite keeps bold that holds a link or sits inside one when its words survive (`keepCues`), and a rewrite that cuts into such bold drops exactly its marks, never a `*` of an address (`widenOverCues`).
  - The instructions say bold and links nest; the server's version goes to 0.11.0.

## What to watch

- Older scripts with stars around a link (`**[words](https://…)**`, `[**words**](https://…)` or `**a [b](https://…) c**`) now show those words bold, where they showed the stars as text before. The prompter file drops those stars, as it does for all bold.
- Only `https://` and `http://` addresses. No link preview, no link checking, no keyboard shortcut, no new settings.

## Checks

`tests/bold-links.test.mjs` (reading, the prompter file, B, the link state, adding and removing links, the address field, random selections with B and links that never change a spoken word or lose bold, Find links, `mark_cue`, rewrites, edits around bold links); older tests that said bold could not touch a link now say what Lex asked for (`tests/cues.test.mjs`, `tests/bold-always-on.test.mjs`). In a real browser `scripts/smoke-keep-all.mjs` with `SMOKE_ONLY=link`: `runLinkIcon` at 1280x800 and 390x760 (the icon right after B, the address field, no explainer and no extra buttons, the preview, Escape, Enter, the broken chain and its address, a click removing, Ctrl+Z, a whole bold link drawn bold and underlined, B and the link icon both on, grey on part link, a link inside bold, four Ctrl+Z back to the start) and `runLinkGuest` at 1280x800 and 390x760 (a guest links, unlinks and undoes). Evidence: `docs/agents/evidence/step-v-browser.txt`.

Not checked: a real phone, Firefox and Safari. Headless Chrome has no hovering pointer: the hover rule is read from the styles and the same look is checked on keyboard focus.

## Done

Feature list: updated (`docs/features.md`).

### Follow-ups
- Spec (P3): fa83b08:docs/build/step-v-link-icon.md:37 — P3 ticket: the "Checks" paragraph still lists only the browser checks from before this slice and still says "four Ctrl+Z back to the start". The checks added here are not listed: typing inside a bold link keeps its marks, Ctrl+B in the address field closing it when the words become part link, and a 600-character address going in whole. The evidence file and the smoke script already have them. Fix: add these three to the `runLinkIcon` list and change "four Ctrl+Z" to "the last four Ctrl+Z", to match the new check name.
- Standards (P3): fa83b08:public/app.js:1377 — P3 fault: the link icon's address now reaches screen readers only through `aria-description`. Before, it was part of the accessible name (`Remove link <url>`). `aria-description` is still a draft (ARIA 1.3), and older Safari and Firefox builds ignore it. In those browsers, a screen reader user on a link hears "Link, pressed" with no address. The CSS tip is no help, because `aria-label` overrides the pseudo-element text. The spec now asks for exactly this ("screen readers hear it as the icon's description"), so this is a choice, not a spec breach. Fix if wanted: also point `aria-describedby` at a hidden span holding the URL, which every current browser supports. Or accept it and add it to "Not checked" next to Firefox and Safari.
- Validation gaps (gap): Nothing checks the button's new names. In `runLinkIcon` (`scripts/smoke-keep-all.mjs`), after the focus check near line 345, add at both widths: on a link, `#linkBtn` has `aria-label === "Link"` and `aria-description === URL`. After the click that removes the link, `aria-description` is gone and `aria-label` is still `"Link"`.
- Validation gaps (gap): Nothing checks that `aria-describedby` comes back on the asking input. In the long-address block (line 194), next to the `maxLength === 500` check, add: `#askInput` has `aria-describedby === "askHint"` after Enter. Also add a check while the address field is open that the attribute is absent.
- Validation gaps (gap): The 2,000 limit itself is not tested; only 600 characters is. Add a check that typing 2,050 characters into the address field leaves `value.length === 2000`, so the field's `maxLength` and `L.LINK_LIMITS.url` stay the same number.
- Validation gaps (gap): The new test only removes both stretches of a nested pair, using their cueIds. Add a test in `tests/bold-links.test.mjs` that removes only the outer one. Take `` `try [WP Activity Log](${U}) today` `` with `{ cueId: "p:1:…" }` alone, and check: the content is `` `try [WP Activity Log](${U}) today` ``; `K.boldWords` still marks only "Activity" as bold; `delta === -4`. Add the mirror case too: removing only the inner stretch keeps the outer bold whole.
- Validation gaps (gap): Nothing checks `delta` on the nested case that is already tested. Add `assert.equal(both.segments[0].delta, -8)` next to the from/to check, so the length the server applies matches the content.


