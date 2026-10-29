# Step K4: big pictures in a B-roll list made lighter when it is saved

Lex (2026-10-29), asked whether the script editor would also shrink "a B-roll list file made somewhere else that already contains big pictures, which you then link in the editor", the next time it saves that list: "Yes".

## What changes

- **Every save of a B-roll list** (a Keep, a shot added, changed or removed, an Undo, a sketch, "Save as…") first makes its big pictures lighter, the same way as pictures from an agent (step K3): cut to the storyboard frame, at most 640 × 345, WebP (JPEG where the browser can't make WebP), about 60 KB. All in the person's browser.
- **Big** means over `PICTURE_BUDGET` (80,000 characters as a data address, about 60 KB): pictures in a list made elsewhere, and pictures kept before step K3 (up to 960 × 720 JPEG). Pictures over `IMAGE_MAX` (about 300 KB), which the editor doesn't show, are made lighter too, so they show again. A picture is read up to 8 MB; bigger ones, other formats (such as GIF), small pictures and line drawings stay as they are. A picture that can't be read stays as it is.
- Linking a list writes nothing, so nothing changes until the list is saved.
- What shows follows the saved list at once.

## Checks

`tests/broll.test.mjs` (`bigPictures`: small, big, too big to show, other formats, line drawings, CRLF, beyond 8 MB). In a real browser (headless Chrome, local Worker, MCP over fetch): a list kept in the browser with a big picture, one too big to show, a small one and a line drawing; a Keep saves it with both big ones made lighter (WebP, within the budget), the one too big now showing, the small one and the line drawing unchanged; "Save as…" writes a lighter file. The run is in `docs/agents/evidence/step-k4-browser.txt`.
