# Step AA: saving in one module (TOOLS-308)

Lex (2026-11-15): pick 3 of the script editor review (TOOLS-296, report `script-editor-architecture-review-2026-11-15.html`, item 4 "Deepen the script-file module"): first tests for every way a script is saved, as it works today; then saving moves into one module with a small interface, and the same tests keep passing. Nothing on screen changes. Saving goes live only after Lex has clicked through it.

## What

1. **Characterization first.** `scripts/smoke-saving.mjs` drives the real editor in headless Chrome and checks every saving path as it works on `dev` before the move: a new script saved in the browser at once and named after its title, auto-save after about 1.5 s, Ctrl+S at once, a new script left untouched is not kept, reopening after a reload, the demo's draft with "Unsaved changes from …", Restore and Discard, Ctrl+S on the demo into the browser, a file from the computer auto-saved, "The file changed on disk at …" with "Save mine" and "Open that version", "Allow saving to …" and a refused Ctrl+S, Export → "Markdown file (.md)" moving a browser script to a file, the prompter link and Save to video folder carrying the saved script, switching scripts while a save runs (every save goes to the script it was made for), a failed write on a script the person left kept as unsaved changes, a B-roll link that stays with its own script when another script is saved under a new name during its link lookup, two tabs on one file, and Share to edit (the guest's words reach the host's file; the guest's browser keeps nothing).
2. **One module.** Saving moves out of `public/app.js` into `public/saving.js`, which gets the storage, the clock and the file system passed in; `app.js` only calls it.

## Done

Feature list: no change (saving moved into one module; nothing on screen changes)
