# Step Y: cache rules and a Content-Security-Policy

Lex (2026-11-16, Orbit TOOLS-305, pick 1 of the TOOLS-296 review): a faster, safer opening. The page is checked with the server on every visit, so a release is seen at once, and a strict Content-Security-Policy allows only what the editor really uses. Nothing on screen changes.

## What it does

- `public/_headers`, `/*`: `Cache-Control: no-cache` in place of `no-store`. The browser keeps every file but asks the server first ("changed?", with the ETag Cloudflare sends); an unchanged file comes back as `304 Not Modified` with no body, so a repeat open downloads a few KB instead of about 660 KB. No file name carries a content hash, so nothing is kept without asking: a long `max-age` or `immutable` would mix old and new files after a release.
- Content-Security-Policy, from what the code uses (checked 2026-11-16):
  - `default-src 'self'`; `script-src 'self'` (module scripts only, no inline script, no eval); `style-src 'self'` (the two style sheets; positions and colours set from code go through the CSSOM, which the CSP allows).
  - `img-src 'self' data:`: pictures from agents and guests are `data:image/png|jpeg|webp` addresses; line drawings are inline SVG.
  - `connect-src 'self' wss://script.techies.tools data:`: the agent token (`/api/agent-token`), the live relay and the rooms (`/api/relay`, `/api/room`, WebSockets on the same address; the live address is named for older browsers where `'self'` does not cover `wss:`; the workers.dev fallback and a copy on another address rely on `'self'`, which every current browser extends to `wss:` on the same host, and a copy on its own domain should put its own address here), the demo files in `samples/`, and `fetch(data:)` when a big picture is made lighter.
  - `object-src`, `base-uri`, `frame-ancestors`, `frame-src`, `worker-src`, `manifest-src`: `'none'`; `form-action 'self'`.
  - Not needed: no web fonts, no other site. The prompter link (`https://prompter.techies.tools/#s=…`) opens in a new tab, which the CSP does not limit; downloads use `blob:` links, which it does not limit either. The agent talks to `/mcp` from its own computer, not from the page.
- Also: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (older browsers), `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`), `Permissions-Policy` turning off camera, microphone, geolocation, payment and USB.
- The one inline style attribute the page built (a person's dot in the section list, `together-adapter.js` `dots`) now carries its colour as `data-c` (`colourKey` in `together/carets.js`), which `app.css` maps to the same colour variable.
- `_headers` covers the static files only; the Worker's own answers (`/api/`, `/mcp`) keep their headers (`no-store`, `noindex`).

## Where

`public/_headers`, `public/together/carets.js` (`colourKey`), `public/together-adapter.js` (`dots`), `public/app.css` (`.pdot--person[data-c]`). Tests: `tests/headers.test.mjs` (the cache rules, the CSP directive by directive, the security headers, nothing in the page the CSP blocks, the dot colour key); each failed before the change.

## Browser check

`scripts/smoke-csp.mjs` on `wrangler dev` (it applies `_headers`) and headless Chrome, at 1280 and 390 px with real clicks: the CSP and `no-cache` with an ETag come with the page, an unchanged file answers 304, a request to another site is refused by `connect-src`, a `data:` picture can be read back; then open the demo with its B-roll list and the agent connected over the relay, an agent's line drawing and picture, the storyboard, the selection bar and bold colours, typing, Open in prompter, three exports, Share to edit with a guest (the guest's dot keeps its colour), and a new script saved in the browser. No CSP violation and no page error in any flow. Evidence: `docs/agents/evidence/tools-305-browser.txt`.

## Done

Feature list: no change (cache and security headers; nothing on screen changes)

### Proof

- Failing test first: met. `tests/headers.test.mjs` failed 4 of 4 on `origin/dev` (`Cache-Control` was `no-store`, no CSP, no security headers, a style attribute in `together-adapter.js`); with the change it passes 5 of 5, and `kit specs` passes 440 of 440.
- No CSP violation on the main flows: met. `node scripts/smoke-csp.mjs` on `wrangler dev` with headless Chrome, 1280 and 390 px, real clicks: open the demo, the agent over the live relay, an agent's line drawing and picture, the storyboard, the selection bar, bold colours and typing, Open in prompter, three exports, Share to edit with a guest, a new script saved in the browser. 50 checks ok, no violation and no page error in any flow; a request to another site is refused by `connect-src` (the CSP is on) and is the only violation seen. `curl -sI` on the local server shows `Cache-Control: no-cache`, an ETag and the CSP; a request with that ETag answers 304.
- All checks green: met. `kit specs` 440 of 440; the older browser suites on the same server with the CSP on: `smoke-keep-all` 933 ok, `smoke-video-folder` 93 ok, `smoke-room` 27 ok, `smoke-relay` 41 ok and 1 fail that is older than this change (it expects 10 agent tools; there are 13 since the cue tools).

### Declined

- R3 (spec wording, P3): the Worker's 401, 404 and 426 answers and `/mcp` set `noindex` but not `no-store`; the sentence above says the Worker's answers keep their own headers, which is what happens. Nothing behaves differently.
- R3 (README and the test, P3): a person deploying their own copy who changes the `wss://` address also has to change `tests/headers.test.mjs`; a follow-up can loosen that check to any one `wss://` host.
- R3 (gap): no test yet for a `<style>` element built by the page; the page builds none today (only the storyboard export and the SVG file writer, both outside the page).
- R2 and R3 nits about `scripts/smoke-csp.mjs` (a swallowed error in `until`, a flow that goes on after a timeout, the colour probe for the agent's dot): a timeout is still counted as a failure; not worth another round.
