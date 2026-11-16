// script.techies.tools · the editor UI. Plain ES module, no build step, no network except loading the sample.
import * as D from "./doc.js";
import { createSaving, writeHandle, permitted } from "./saving.js";
import * as C from "./changes.js";
import * as L from "./links.js";
import * as K from "./cues.js";
import { createTogether, parseLink, fitAsks, overlappingAsks, guestMayAct } from "./together-adapter.js";
import { agentBrand } from "./agent-brand.js";
import { listState, settleFolder, folderNote } from "./folder-note.js";
import { resolveTyped, suggestions, rememberAsk, findWords, plainOffset, barSpot, phoneDock, popSpot, seenFrom } from "./edit-bar.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const fine = matchMedia("(hover: hover) and (pointer: fine)");

const ICONS = {
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>',
  simpler: '<path d="M4 7h16M4 12h10M4 17h6"/>',
  shorter: '<path d="M4 12h10M10 8l4 4-4 4M20 5v14"/>',
  explain: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01"/>',
  facts: '<path d="M9 12l2 2 4-4"/><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
  send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  camera: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  prompter: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 9h10M8 12h8M10 21h4M12 17v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  // The Model Context Protocol mark, drawn on 195 units: "Connect your agent" while it can be connected.
  mcp: '<g transform="scale(.1231)" stroke-width="14"><path d="M25 97.85 92.88 29.97a24 24 0 0 1 33.94 0 24 24 0 0 1 0 33.94L75.56 115.18"/><path d="M76.27 114.47 126.82 63.91a24 24 0 0 1 33.94 0l.36.36a24 24 0 0 1 0 33.94L99.72 159.6a8 8 0 0 0 0 11.31l12.61 12.61"/><path d="M109.85 46.94 59.65 97.15a24 24 0 0 0 0 33.94 24 24 0 0 0 33.94 0l50.2-50.21"/></g>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>',
  export: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  motion: '<path d="M4 17c3-8 6-11 9-10s3 6 7 3"/><circle cx="20" cy="10" r="1.2"/><circle cx="4" cy="17" r="1.2"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><circle cx="12" cy="10" r="2.2"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M9 11h6M9 15h6"/>',
  board: '<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>',
  sketch: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/>',
  suggest: '<rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 7v13M3 11.5h4M3 15.5h4"/><path d="M19.5 2.5v5M17 5h5"/>',
  share: '<path d="M16 5l3 3-3 3"/><path d="M19 8h-6a6 6 0 0 0-6 6v4"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  unlink: '<path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-.12-7.07 5 5 0 0 0-6.95 0l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 .12 7.07 5 5 0 0 0 6.95 0l1.71-1.71"/><path d="M8 2v3M2 8h3M16 19v3M19 16h3"/>',
  agent: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/>', // the old agent mark, kept as a fallback
  // The agent's logo in its caret, avatar and button (agent-brand.js), filled in one colour like the other icons.
  // Phosphor Icons (MIT): OpenAI logo and sparkle, drawn on 256 units. Simple Icons (CC0): Claude, Gemini, Cursor, Copilot.
  "ai-claude": '<path class="i-fill" d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>',
  "ai-openai": '<path class="i-fill" transform="scale(.09375)" d="M224.32,114.24a56,56,0,0,0-60.07-76.57A56,56,0,0,0,67.93,51.44a56,56,0,0,0-36.25,90.32A56,56,0,0,0,69,217,56.39,56.39,0,0,0,83.59,219a55.75,55.75,0,0,0,8.17-.61,56,56,0,0,0,96.31-13.78,56,56,0,0,0,36.25-90.32ZM182.85,54.43a40,40,0,0,1,28.56,48c-.95-.63-1.91-1.24-2.91-1.81L164,74.88a8,8,0,0,0-8,0l-44,25.41V81.81l40.5-23.38A39.76,39.76,0,0,1,182.85,54.43ZM144,137.24l-16,9.24-16-9.24V118.76l16-9.24,16,9.24ZM80,72a40,40,0,0,1,67.53-29c-1,.51-2,1-3,1.62L100,70.27a8,8,0,0,0-4,6.92V128l-16-9.24ZM40.86,86.93A39.75,39.75,0,0,1,64.12,68.57C64.05,69.71,64,70.85,64,72v51.38a8,8,0,0,0,4,6.93l44,25.4L96,165,55.5,141.57A40,40,0,0,1,40.86,86.93ZM73.15,201.57a40,40,0,0,1-28.56-48c.95.63,1.91,1.24,2.91,1.81L92,181.12a8,8,0,0,0,8,0l44-25.41v18.48l-40.5,23.38A39.76,39.76,0,0,1,73.15,201.57ZM176,184a40,40,0,0,1-67.52,29.05c1-.51,2-1.05,3-1.63L156,185.73a8,8,0,0,0,4-6.92V128l16,9.24Zm39.14-14.93a39.75,39.75,0,0,1-23.26,18.36c.07-1.14.12-2.28.12-3.43V132.62a8,8,0,0,0-4-6.93l-44-25.4,16-9.24,40.5,23.38A40,40,0,0,1,215.14,169.07Z"/>',
  "ai-gemini": '<path class="i-fill" d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/>',
  "ai-cursor": '<path class="i-fill" d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"/>',
  "ai-copilot": '<path class="i-fill" d="M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z"/>',
  "ai-sparkle": '<path class="i-fill" transform="scale(.09375)" d="M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169A8,8,0,0,0,87,164.22L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${Object.hasOwn(ICONS, n) ? ICONS[n] : ""}</svg>`;
const ACT_ICON = { like: "wave", simpler: "simpler", shorter: "shorter", explain: "explain", facts: "facts", voice: "wave", ask: "send", sketch: "sketch", broll: "suggest", plan: "suggest", links: "link" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const actName = (ask) => (ask.action === "ask" ? `“${ask.instruction.length > 26 ? ask.instruction.slice(0, 25) + "…" : ask.instruction}”` : D.ACTIONS[ask.action]?.name || ask.action);

const LS = "script-editor:";
const FILE_TYPES = [{ description: "Markdown script", accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] } }];
const SAMPLE = { url: "samples/demo-good-script.md", name: "demo-good-script.md" };
const SAMPLE_BROLL = { url: "samples/demo-good-script-broll.md", name: "demo-good-script-broll.md" };
const TYPING_GROUP_MS = 600;
const UNDO_LIMIT = 300;

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(LS + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(LS + k); } catch { /* storage off */ } },
};
const me = (() => {
  let p = store.get("me");
  if (!p?.id) { p = { id: D.newId(10), name: "You" }; store.set("me", p); }
  return { id: p.id, name: p.name };
})();

const state = {
  doc: null,
  name: "",
  handle: null,
  savedText: "",
  savedAt: 0,
  fileModified: 0,
  inBrowser: false, // saved in the browser, not in a file on the computer (step J)
  blank: "", // a new script's first text: left untouched, it is removed from the browser (step J)
  saving: false,
  autoSaving: false,
  saveError: "",
  needsPermission: false,
  conflict: false,
  asks: [],
  undo: [],
  redo: [],
  lastStep: null,
  preCaret: null,
  pendingDraft: null,
  frontOpen: false,
  hint: null,
  guest: false, // in someone else's shared script (step D): no saving, B-roll, agent, export or sharing
  locked: false, // a guest whose host stopped sharing
};
// Working together (step D): set up at the end of this file. A room link in the address makes this tab a guest.
let together = null;
const roomLink = parseLink(location.hash);
// Script or Storyboard (the switch in the top bar), remembered; where the script was scrolled.
const ui = { view: store.get("view") === "board" ? "board" : "script", scriptY: 0 };

/* ---------- Small helpers ---------- */
const scriptEl = $("#script");
const isOpen = (a) => D.OPEN_STATUSES.includes(a.status);
// A selection or plan ask answered with B-roll changes: its suggestions live beside the lines, not in the text,
// so the text decorations, anchors and "newest ask wins" leave it alone.
const isBrollAnswer = (a) => a.status === "answered" && a.answer?.kind === "broll";
const byId = (id) => (state.doc ? D.blockById(state.doc, id) : null);
const blockNode = (id) => scriptEl.querySelector(`.block[data-id="${id}"]`);
const blockOf = (node) => {
  const el = node?.nodeType === 3 ? node.parentElement : node;
  const b = el?.closest?.(".block");
  return b && scriptEl.contains(b) ? b : null;
};
const isDirty = () => !!state.doc && D.serialize(state.doc) !== state.savedText;
const clock = (t) => {
  const d = new Date(t), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
};
const baseName = () => state.name.replace(/\.(md|markdown|txt)$/i, "") || "script";
function emit(type, ask) {
  document.dispatchEvent(new CustomEvent("scripteditor:ask", { detail: { type, ask: structuredClone(ask) } }));
}
function editable(el) {
  el.contentEditable = "plaintext-only";
  if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
  el.spellcheck = true;
}
function h(tag, cls, attrs = {}) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/* ---------- Text and caret inside a block ---------- */
// The block's text is every text node except decorations marked data-skip (chips, bars, inserted text).
function contentNodes(root) {
  const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest("[data-skip]") && root.contains(n.parentElement.closest("[data-skip]")) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n; (n = w.nextNode()); ) out.push(n);
  return out;
}
const readContent = (el) => contentNodes(el).map((n) => n.data).join("").replace(/\r/g, "");
function offsetIn(el, node, off) {
  const p = document.createRange();
  try { p.setStart(node, off); } catch { return 0; }
  let acc = 0;
  for (const t of contentNodes(el)) {
    if (t === node) return acc + Math.min(off, t.data.length);
    if (p.comparePoint(t, t.data.length) <= 0) acc += t.data.length;
    else break;
  }
  return acc;
}
function pointAt(el, offset) {
  const nodes = contentNodes(el);
  let acc = 0;
  for (const t of nodes) {
    if (offset <= acc + t.data.length) return [t, offset - acc];
    acc += t.data.length;
  }
  const last = nodes.at(-1);
  return last ? [last, last.data.length] : [el, 0];
}
function rangeAt(el, start, end) {
  const r = document.createRange();
  const [sn, so] = pointAt(el, start);
  const [en, eo] = pointAt(el, end);
  r.setStart(sn, so);
  r.setEnd(en, eo);
  return r;
}
function setCaretAt(el, offset) {
  openLinks(el, offset, offset); // a link the caret is put at shows its Markdown before the caret lands
  const r = document.createRange();
  const [n, o] = pointAt(el, Math.max(0, offset));
  const lock = n.nodeType === 3 ? n.parentElement.closest('[contenteditable="false"]') : null;
  if (lock && el.contains(lock)) r.setStartAfter(lock);
  else r.setStart(n, o);
  r.collapse(true);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
function getCaret() {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const el = blockOf(sel.focusNode);
  return el ? { id: el.dataset.id, offset: offsetIn(el, sel.focusNode, sel.focusOffset) } : null;
}
function selectionIn(el) {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const len = readContent(el).length;
  const start = el.contains(r.startContainer) ? offsetIn(el, r.startContainer, r.startOffset) : 0;
  const end = el.contains(r.endContainer) ? offsetIn(el, r.endContainer, r.endOffset) : len;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}
function placeCaret(id, offset) {
  const el = blockNode(id);
  if (!el) return;
  const fold = el.closest("details");
  if (fold && !fold.open) { fold.open = true; state.frontOpen = true; }
  el.focus({ preventScroll: true });
  setCaretAt(el, offset);
  const r = el.getBoundingClientRect();
  const top = $(".top").getBoundingClientRect().bottom + 8;
  if (r.top < top || r.top > innerHeight - 40) { editorJump(); el.scrollIntoView({ block: "center", behavior: "instant" }); }
}

/* ---------- Rendering ---------- */
function blockShell(b) {
  const wrap = h("div", `line line--${b.type}`);
  wrap.dataset.wrap = b.id;
  let el;
  if (b.type === "title") el = h("h1", "block title");
  else if (b.type === "heading") {
    const head = h("h2", "section__head");
    el = h("span", "block");
    head.append(el);
    wrap.append(head);
  } else if (b.type === "raw") el = h("div", "block raw");
  else el = h("p", "block line__text");
  el.dataset.id = b.id;
  el.dataset.type = b.type;
  // While "Unsaved changes from … · Restore · Discard" shows, the script is read-only, so no edit is lost.
  if (b.id === state.hint) el.dataset.placeholder = "Type / for parts"; // a brand-new script's first spoken line
  if (state.pendingDraft || state.locked) el.contentEditable = "false";
  else editable(el);
  if (b.type !== "heading") wrap.append(el);
  fillBlock(el, b);
  return wrap;
}

// Decorations for a block: open asks on a selection, the agent's marked changes (step F), and open "Sounds like
// me" marks.
function decorationsFor(id) {
  const items = [];
  for (const a of state.asks) {
    if (a.scope === "selection" && a.blockId === id && isOpen(a) && !isBrollAnswer(a)) items.push({ kind: "ask", ask: a, start: a.start, end: a.end });
    else if (shownMarked(a) && a.blockId === id) items.push({ kind: "landed", ask: a, ...C.markRange(a) });
  }
  for (const a of state.asks) {
    if (a.scope !== "script" || a.status !== "answered") continue;
    a.answer.marks.forEach((m, i) => { if (m.state === "open" && m.blockId === id) items.push({ kind: "mark", ask: a, mark: m, i, start: m.start, end: m.end }); });
  }
  items.sort((x, y) => x.start - y.start || (x.kind === "ask" ? -1 : 1));
  const out = [];
  let at = 0;
  for (const it of items) {
    if (it.start < at || it.end <= it.start) continue;
    out.push(it);
    at = it.end;
  }
  return out;
}

/* Links (step G): a "[words](https://…)" in a para shows as its words with a faint dotted underline. "[", "](" and the
   address are hidden while the caret is outside the link; with the caret at or in it, or a selection touching it, the
   link is open (data-open) and shows all of its Markdown. The text nodes are still the block's exact content, so
   offsets, asks, carets and the room are unchanged. A link cut by a decoration's edge shows as plain Markdown. */
/* Cues (fleet issue #14, Lex 2026-11-04): a "**words**" in a para is drawn with the same trick: the "**" marks are hidden
   while the caret is outside it, and the words show orange and bold (.md-cue in app.css). */
/* Bold links (Lex 2026-11-07): a link may hold bold words and bold may hold whole links; each is drawn inside the
   other's words, and each opens and closes on its own. */
const linksOf = (b) => {
  if (b.type !== "para") return [];
  const content = D.contentOf(b), links = L.textLinks(content);
  return [...links, ...K.textCues(content)].sort((x, y) => x.start - y.start || y.end - x.end);
};
function linkNodes(content, from, to, links, cuts = []) {
  const nodes = [];
  let at = from;
  const list = links.filter((l) => l.start >= from && l.end <= to);
  for (let k = 0; k < list.length; k++) {
    const l = list[k];
    if (l.start < at) continue;
    // The ones inside this one's words are drawn there; one that only starts inside it is not drawn.
    const inner = [];
    while (k + 1 < list.length && list[k + 1].start < l.end) {
      k++;
      if (list[k].start >= l.words.start && list[k].end <= l.words.end) inner.push(list[k]);
    }
    if (l.start > at) nodes.push(...plainNodes(content, at, l.start, cuts));
    const a = l.cue ? h("span", "md-link md-cue", { "data-link": "", "data-cue": "" }) : h("span", "md-link", { "data-link": "", title: l.url });
    if (!l.cue) a.dataset.href = l.url;
    const head = h("span", "md-link__mark"), words = h("span", "md-link__words"), tail = h("span", "md-link__mark");
    head.textContent = content.slice(l.start, l.words.start);
    words.append(...linkNodes(content, l.words.start, l.words.end, inner, cuts));
    tail.textContent = content.slice(l.words.end, l.end);
    a.append(head, words, tail);
    nodes.push(a);
    at = l.end;
  }
  if (to > at) nodes.push(...plainNodes(content, at, to, cuts));
  return nodes;
}
// Plain text from…to, where a bold stretch cut by an ask's edge (TOOLS-52 item 5) has its "**" hidden and its words bold:
// the same words as one stretch drawn whole, in pieces (.md-cut), each a [data-link] so the line still reads as drawn.
function plainNodes(content, from, to, cuts) {
  const nodes = [], text = (a, b) => { if (b > a) nodes.push(document.createTextNode(content.slice(a, b))); };
  let at = from;
  for (const c of cuts) {
    if (c.end <= at || c.start >= to) continue;
    text(at, Math.max(at, c.start));
    for (const [a, b, kind] of [[c.start, c.words.start, "mark"], [c.words.start, c.words.end, "words"], [c.words.end, c.end, "mark"]]) {
      const x = Math.max(a, at), y = Math.min(b, to);
      if (y <= x) continue;
      const piece = h("span", `md-cut${kind === "mark" ? "__mark" : ""}`, { "data-link": "", "data-cut": String(c.start) });
      piece.textContent = content.slice(x, y);
      nodes.push(piece);
    }
    at = Math.min(c.end, to);
  }
  text(at, to);
  return nodes;
}
// The links as drawn: the ones inside one stretch of plain text or one decoration (an old before/after has none).
function shownLinks(content, links, decos) {
  const cuts = [0, content.length];
  for (const d of decos) cuts.push(d.start, d.end);
  return links.filter((l) => !cuts.some((c) => c > l.start && c < l.end) && !inChange(l, decos));
}
const inChange = (l, decos) => decos.some((d) => d.kind === "ask" && d.ask.status === "answered" && d.ask.answer.kind !== "note" && l.start < d.end && l.end > d.start);
// The bold stretches an ask, note or mark cuts through (not shown whole): drawn in pieces with their "**" hidden.
const cutCues = (links, shown, decos) => links.filter((l) => l.cue && !shown.includes(l) && !inChange(l, decos));
// Where a link element starts in its block's content.
function linkStart(el, a) {
  const r = document.createRange();
  r.selectNodeContents(a);
  return offsetIn(el, r.startContainer, r.startOffset);
}
// A drawn link as L.textLinks gives it ({ start, end, words: { start, end } }), from its element and where it starts.
function shownLink({ a, start }) {
  const words = readContent(a.querySelector(".md-link__words")).length, head = readContent(a.querySelector(".md-link__mark")).length;
  return { start, end: start + readContent(a).length, words: { start: start + head, end: start + head + words } };
}
// The bold stretches an ask cuts through, drawn in pieces (plainNodes): [{ link: { start, end, words }, els }], one per stretch,
// read from the pieces as they are now (typing inside a stretch needs no redraw, so nothing is saved on them). Like a whole
// stretch, its "**" show only while the selection touches it (data-open on its mark pieces).
function cutGroups(el) {
  const groups = new Map();
  for (const p of el.querySelectorAll("[data-cut]")) {
    const start = linkStart(el, p), end = start + readContent(p).length;
    let g = groups.get(p.dataset.cut);
    if (!g) groups.set(p.dataset.cut, g = { els: [], start, end, ws: null, we: null });
    g.els.push(p);
    g.start = Math.min(g.start, start);
    g.end = Math.max(g.end, end);
    if (!p.classList.contains("md-cut__mark")) { g.ws ??= start; g.we = end; }
  }
  return [...groups.values()].map((g) => ({ els: g.els, link: { start: g.start, end: g.end, words: { start: g.ws ?? g.start, end: g.we ?? g.end } } }));
}
const cutOpen = (g) => g.els.some((p) => p.hasAttribute("data-open"));
const closedLinks = (el) => [
  ...[...el.querySelectorAll(".md-link:not([data-open])")].map((a) => shownLink({ a, start: linkStart(el, a) })),
  ...cutGroups(el).filter((g) => !cutOpen(g)).map((g) => g.link),
].sort((x, y) => x.start - y.start || y.end - x.end);
// Open the links in `el` that touch start…end (content offsets); close the others (start < 0: close all).
// Returns the links that were closed and are open now, with their place: [{ a, start, end }].
function openLinks(el, start, end) {
  const opened = [];
  for (const a of el.querySelectorAll(".md-link")) {
    const s = linkStart(el, a), e = s + readContent(a).length;
    const open = start >= 0 && start <= e && end >= s;
    if (open && !a.hasAttribute("data-open")) opened.push({ a, start: s, end: e });
    a.toggleAttribute("data-open", open);
  }
  for (const g of cutGroups(el)) {
    const { start: s, end: e } = g.link, open = start >= 0 && start <= e && end >= s;
    if (open && !cutOpen(g)) opened.push({ link: g.link, start: s, end: e });
    for (const p of g.els) if (p.classList.contains("md-cut__mark")) p.toggleAttribute("data-open", open);
  }
  return opened;
}
// After the selection moved: open the links it touches. A caret the person put on the edge of a closed link (where
// its words begin or end) goes just outside it, so typing there adds to the line, not to the link's words.
let composingLinks = false;
function refreshLinks(snap = false) {
  const sel = getSelection();
  const r = sel.rangeCount ? sel.getRangeAt(0) : null;
  for (const el of scriptEl.querySelectorAll(".block:has(.md-link, [data-cut])")) {
    const s = r && r.intersectsNode(el) ? selectionIn(el) : null;
    const opened = openLinks(el, s ? s.start : -1, s ? s.end : -1);
    if (!snap || composingLinks || !s || s.start !== s.end || !sel.isCollapsed || !opened.length) continue;
    // A link inside another's words (bold links): from the inner one out, each edge to just outside it.
    const chain = opened.map((o) => o.link || shownLink(o)).sort((x, y) => (x.end - x.start) - (y.end - y.start));
    if (!chain.every((l, i) => i === 0 || (l.start <= chain[i - 1].start && l.end >= chain[i - 1].end))) continue;
    const to = chain.reduce((at, l) => L.edgeSnap(l, at), s.start);
    if (to !== s.start) setCaretAt(el, to);
  }
}
scriptEl.addEventListener("compositionstart", () => { composingLinks = true; });
scriptEl.addEventListener("compositionend", () => { composingLinks = false; });
// Ctrl/Cmd+click opens a link in a new tab; a plain click only places the caret.
scriptEl.addEventListener("click", (e) => {
  const a = e.target.closest?.(".md-link[data-href]");
  if (!a || !(e.ctrlKey || e.metaKey) || !L.safeUrl(a.dataset.href)) return;
  e.preventDefault();
  window.open(a.dataset.href, "_blank", "noopener,noreferrer");
});
// While Ctrl/Cmd is held, links show the pointer (they open on click).
const modKey = (e) => scriptEl.toggleAttribute("data-mod", e.ctrlKey || e.metaKey);
addEventListener("keydown", modKey);
addEventListener("keyup", modKey);
addEventListener("blur", () => scriptEl.removeAttribute("data-mod"));
// Others' carets are drawn where the text shows: an offset inside a closed link's hidden Markdown sits at its words.
function visibleRange(el, start, end = start) {
  const closed = closedLinks(el);
  return rangeAt(el, L.shownOffset(closed, start), L.shownOffset(closed, end));
}

// When this tab got each of the agent's changes (its own clock): it shows a little stronger as it arrives.
const arrived = new Map();
/* The mark goes away by itself (step M): once the person has scrolled past it, or 60 minutes after it went in. Alone,
   and the host's 60 minutes, end it for good (C.endExpired); in a shared script scrolling past ends it on this screen
   only (`passedHere`, by ask id), so everyone else keeps theirs until they scroll past it too. */
const passedHere = new Set();
const seenMarks = new Set(); // the asks whose mark has been on screen here
const shownMarked = (a) => C.isMarked(a) && !passedHere.has(a.id);
// The visible part of the script: below the top bar.
const scriptView = () => ({ top: $(".top").getBoundingClientRect().bottom, bottom: innerHeight });
// Each drawn mark is watched for when it is on screen (not under the top bar); the observer follows the bar's height.
let seenObserver = null, seenTop = -1;
function watchMark(m) {
  if (!seenObserver) watchSeen();
  seenObserver.observe(m);
}
function watchSeen() {
  const top = Math.round($(".top").getBoundingClientRect().height);
  if (top === seenTop) return;
  seenObserver?.disconnect();
  seenTop = top;
  seenObserver = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting && e.target.isConnected) seenMarks.add(e.target.dataset.ask);
  }, { rootMargin: `-${top}px 0px 0px 0px` });
  for (const old of $$(".agent-change[data-ask]", scriptEl)) seenObserver.observe(old);
}
addEventListener("resize", () => { if (seenObserver) watchSeen(); });
// Only the person's own scrolling reads past a mark: the wheel, a touch, the scroll keys or the scrollbar, until the
// scrolling stops. A jump the editor makes (a section, a shot, the caret brought into view) calls editorJump().
let personAt = -Infinity, personScroll = false, passTimer = 0;
const personInput = () => { personAt = performance.now(); };
const typing = (t) => !!t?.closest?.("[contenteditable]:not([contenteditable='false']), input, textarea, select");
addEventListener("wheel", personInput, { passive: true, capture: true });
addEventListener("touchmove", personInput, { passive: true, capture: true });
addEventListener("keydown", (e) => {
  if (["PageUp", "PageDown", "ArrowUp", "ArrowDown"].includes(e.key) || ([" ", "Home", "End"].includes(e.key) && !typing(e.target))) personInput();
}, { capture: true });
let scrollbarHeld = false; // the scrollbar: its scroll is the person's while the pointer stays down, also after a pause
addEventListener("pointerdown", (e) => { if (e.target === document.documentElement) { scrollbarHeld = true; personInput(); } }, { capture: true });
// A browser may not send pointerup after a scrollbar drag: the first move without a button held, leaving the window
// or the tab ends it too.
for (const t of ["pointerup", "pointercancel", "blur"]) addEventListener(t, () => { scrollbarHeld = false; }, { capture: true });
addEventListener("pointermove", (e) => { if (!e.buttons) scrollbarHeld = false; }, { passive: true, capture: true });
document.addEventListener("visibilitychange", () => { if (document.hidden) scrollbarHeld = false; });
addEventListener("scroll", () => {
  if (!personScroll && !scrollbarHeld && performance.now() - personAt > 1000) return;
  personScroll = true;
  clearTimeout(passTimer);
  passTimer = setTimeout(() => { personScroll = false; checkPassed(); }, 150);
}, { passive: true });
function editorJump() { personAt = -Infinity; personScroll = false; scrollbarHeld = false; clearTimeout(passTimer); }
// After the person's scroll: the marks seen here whose last line is now above the middle end.
function checkPassed() {
  if (!state.doc) return;
  const view = scriptView(), ended = [];
  for (const m of $$(".agent-change[data-ask]:not([data-ending])", scriptEl)) {
    const ask = state.asks.find((a) => a.id === m.dataset.ask);
    const r = m.getBoundingClientRect();
    if (ask && shownMarked(ask) && (r.width || r.height) && C.readPast(r, view, seenMarks.has(ask.id))) ended.push(ask);
  }
  endMarks(ended, state.guest || !!together?.active);
}
// The host's tab (or alone) ends the marks whose 60 minutes are over, for everyone: about once a minute and when the
// tab comes back into view (and when a script or draft is opened: adoptAsks). Marks scrolled past while shared end
// for good once the script is no longer shared.
function expireMarks() {
  if (!state.doc || state.guest) return;
  if (passedHere.size && !together?.active) {
    endMarks(state.asks.filter((a) => passedHere.has(a.id) && C.isMarked(a)));
    passedHere.clear();
  }
  endMarks(C.endExpired(state.asks, Date.now()));
}
setInterval(expireMarks, 60_000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") expireMarks(); });
// These marks end: on this screen only (`here`) or for good (the ask stays kept, its change goes; the draft and the
// room get the asks). The agent's caret moves to the next newest marked change, or leaves, at once; the tint fades
// out where motion is allowed, then the blocks are drawn again (keeping the person's selection).
function endMarks(asks, here = false) {
  if (!asks.length) return;
  for (const a of asks) { if (here) passedHere.add(a.id); else delete a.change; }
  const ids = new Set(asks.map((a) => a.id)), blocks = new Set(asks.map((a) => a.blockId));
  const spans = $$(".agent-change[data-ask]", scriptEl).filter((m) => ids.has(m.dataset.ask));
  const redraw = () => {
    const sel = localSelection();
    for (const id of blocks) if (byId(id) && blockNode(id)) fillBlock(blockNode(id), byId(id));
    if (sel && blocks.has(sel.id)) restoreSelection(sel);
    refreshLinks();
    together?.redraw();
  };
  if (!here) {
    markBase();
    together?.sync();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persistDraft, 400);
  }
  together?.redraw();
  if (reduced.matches || !spans.length) return redraw();
  for (const m of spans) { delete m.dataset.new; m.dataset.ending = ""; }
  setTimeout(() => { if (spans.some((m) => m.isConnected)) redraw(); }, 400);
}
// In a shared script only the person who asked, and the host, may Keep, Undo or cancel an ask.
const may = (ask) => !state.guest || !!together?.may(ask);
function fillBlock(el, b) {
  const content = D.contentOf(b);
  const decos = decorationsFor(b.id);
  const all = linksOf(b), links = shownLinks(content, all, decos), cuts = cutCues(all, links, decos);
  const nodes = [];
  let at = 0, chips = 0;
  const text = (from, to) => nodes.push(...linkNodes(content, from, to, links, cuts));
  const words = (m, d) => m.append(...linkNodes(content, d.start, d.end, links, cuts));
  for (const d of decos) {
    text(at, d.start);
    const quote = content.slice(d.start, d.end);
    if (d.kind === "mark") {
      const m = h("mark", "voice", { tabindex: "0", "data-deco": "", "data-ask": d.ask.id, "data-mark": String(d.i) });
      words(m, d);
      nodes.push(m);
    } else if (d.kind === "landed") {
      // The agent's change went straight in: a light tint in the agent's colour while it is untouched.
      const m = h("span", "agent-change", { "data-deco": "", "data-ask": d.ask.id });
      if ((arrived.get(d.ask.id) ?? 0) > Date.now() - 1500) m.dataset.new = "";
      words(m, d);
      nodes.push(m);
      watchMark(m);
    } else if (d.ask.status === "answered" && d.ask.answer.kind === "note") {
      const c = h("span", "checked", { "data-deco": "", "data-ask": d.ask.id, "data-tone": d.ask.answer.tone });
      words(c, d);
      const n = h("span", "note", { contenteditable: "false", "data-skip": "", "data-deco": "", "data-ask": d.ask.id, "data-tone": d.ask.answer.tone });
      n.innerHTML = `${icon(d.ask.answer.tone === "look" ? "flag" : "check")}<span></span>${may(d.ask) ? `<button type="button" class="note__x" aria-label="Done">${icon("x")}</button>` : ""}`;
      n.querySelector("span").textContent = d.ask.answer.text;
      nodes.push(c, n);
      chips++;
    } else if (d.ask.status === "answered") {
      const a = d.ask.answer;
      const c = h("span", "change", { contenteditable: "false", "data-deco": "", "data-ask": d.ask.id });
      const ins = h("ins", "", { "data-skip": "" });
      if (a.kind === "replace") {
        const del = h("del");
        del.textContent = quote;
        ins.textContent = a.text;
        c.append(del, ins);
      } else {
        const from = h("span", "change__from");
        from.textContent = quote;
        ins.textContent = (/^\s/.test(a.text) ? "" : " ") + a.text;
        c.append(from, ins);
      }
      const bar = h("span", "change__bar", { "data-skip": "" });
      // Keep and Undo for the person who asked, and the host (step D2); everyone else sees the change. Answers that
      // go straight in (step F) never show this; only an answer kept from before (a draft) still can.
      bar.innerHTML = `<span class="change__what">${icon(ACT_ICON[d.ask.action])}<span></span></span>${may(d.ask) ? `<button type="button" class="undo">${icon("undo")}Undo</button><button type="button" class="keep">${icon("check")}Keep</button>` : ""}`;
      bar.querySelector(".change__what span").textContent = actName(d.ask);
      c.append(bar);
      nodes.push(c);
      chips++;
    } else {
      const s = h("span", "ask", { "data-deco": "", "data-ask": d.ask.id });
      words(s, d);
      const chip = h("span", "ask-chip", { contenteditable: "false", "data-skip": "", "data-deco": "", "data-ask": d.ask.id });
      if (d.ask.status === "taken") { s.dataset.taken = ""; chip.dataset.taken = ""; }
      chip.innerHTML = `${icon(ACT_ICON[d.ask.action])}<span></span><span class="ask-chip__dot"></span>${may(d.ask) ? `<button type="button" class="ask-chip__x" aria-label="Cancel">${icon("x")}</button>` : ""}`;
      chip.querySelector("span").textContent = actName(d.ask);
      nodes.push(s, chip);
      chips++;
    }
    at = d.end;
  }
  text(at, content.length);
  if (content.endsWith("\n")) nodes.push(h("br", "", { "data-skip": "", "data-deco": "" }));
  for (const old of el.querySelectorAll(".agent-change")) seenObserver?.unobserve(old);
  el.replaceChildren(...nodes);
  el._decos = decos.length;
  el._chips = chips;
  // Messages from the agent: one small line under the block.
  const wrap = el.closest(".line") || el.parentElement?.closest(".line");
  const msgs = decos.filter((d) => ((d.kind === "ask" && d.ask.status === "answered") || d.kind === "landed") && d.ask.answer?.message);
  const host = wrap || null;
  if (host) {
    host.querySelectorAll(":scope > .line__msg, :scope > .ask-note").forEach((m) => m.remove());
    if (askNotes.has(b.id)) {
      const n = h("p", "banner ask-note", { role: "status" });
      n.textContent = askNotes.get(b.id);
      host.append(n);
    }
    for (const d of msgs) {
      const p = h("p", "line__msg", { "data-ask": d.ask.id });
      p.innerHTML = icon("message") + "<span></span>";
      p.querySelector("span").textContent = d.ask.answer.message;
      host.append(p);
    }
  }
}

// After typing: is the DOM still what the model would render?
function domMatches(el, id) {
  if (el.querySelector(":not(br):not([data-deco]):not([data-deco] *):not([data-link]):not([data-link] *)")) return false;
  const brs = el.querySelectorAll("br:not([data-skip])");
  if (brs.length > 1 || (brs.length === 1 && el.lastChild !== brs[0])) return false;
  const decos = el.querySelectorAll(".ask, .checked, .change, .agent-change, mark.voice");
  if (decos.length !== (el._decos || 0)) return false;
  if (el.querySelectorAll(".ask-chip, .note, .change__bar").length !== (el._chips || 0)) return false;
  const expected = decorationsFor(id);
  let k = 0;
  for (const d of decos) {
    const want = expected[k++];
    if (!want) return false;
    const r = document.createRange();
    r.selectNodeContents(d);
    if (offsetIn(el, r.startContainer, r.startOffset) !== want.start || readContent(d) !== D.contentOf(byId(id)).slice(want.start, want.end)) return false;
  }
  const content = D.contentOf(byId(id));
  if (content.endsWith("\n") !== !!el.querySelector("br[data-skip]")) return false;
  // Every link drawn as the model reads it now: its place, its Markdown, its words and its address.
  const links = shownLinks(content, linksOf(byId(id)), expected), shown = el.querySelectorAll(".md-link");
  if (shown.length !== links.length) return false;
  return links.every((l, i) => {
    const a = shown[i], w = a.querySelector(".md-link__words");
    return a.childElementCount === 3 && a.dataset.href === l.url && linkStart(el, a) === l.start && readContent(a) === content.slice(l.start, l.end) && !!w && readContent(w) === content.slice(l.words.start, l.words.end);
  });
}

function renderBlock(id, caret = null) {
  const el = blockNode(id), b = byId(id);
  if (!el || !b) return renderAll(caret);
  if (el.dataset.type !== b.type) return renderAll(caret);
  fillBlock(el, b);
  if (caret && caret.id === id) setCaretAt(el, caret.offset);
  refreshLinks();
  together?.redraw();
  keepBarSel(id);
}

let sectionObserver = null;
function renderAll(caret = null) {
  for (const old of scriptEl.querySelectorAll(".agent-change")) seenObserver?.unobserve(old);
  const { front, sections } = D.outline(state.doc);
  const frag = document.createDocumentFragment();
  const head = h("header", "front");
  const title = front.find((b) => b.type === "title");
  if (title) head.append(blockShell(title));
  const rest = front.filter((b) => b !== title);
  if (rest.length) {
    const more = h("details", "front__more");
    more.open = state.frontOpen;
    more.addEventListener("toggle", () => { state.frontOpen = more.open; });
    const summary = h("summary");
    summary.textContent = "Details";
    const body = h("div", "front__body");
    for (const b of rest) body.append(blockShell(b));
    more.append(summary, body);
    head.append(more);
  }
  frag.append(head);
  for (const s of sections) {
    const sec = h("section", "section");
    sec.dataset.spoken = String(s.spoken);
    if (s.heading) { sec.id = `s-${s.heading.id}`; sec.dataset.sec = s.heading.id; sec.append(blockShell(s.heading)); }
    for (const b of s.blocks) sec.append(blockShell(b));
    frag.append(sec);
  }
  scriptEl.replaceChildren(frag);
  scriptEl.toggleAttribute("data-locked", !!state.pendingDraft || state.locked);
  renderToc();
  renderVoice();
  brollApi?.renderMarks();
  if (caret) placeCaret(caret.id, caret.offset);
  refreshLinks();
  together?.redraw();
  if (barSel) keepBarSel(barSel.id);
}

function renderToc() {
  const { sections } = D.outline(state.doc);
  const toc = $("#toc");
  const current = toc.querySelector('[aria-current="true"]')?.dataset.sec;
  toc.innerHTML = sections.filter((s) => s.heading).map((s) => {
    const { num, name, start } = s.info;
    return `<li><a href="#s-${s.heading.id}" data-sec="${s.heading.id}" data-spoken="${s.spoken}"${s.heading.id === current ? ' aria-current="true"' : ""}><span class="toc__num">${esc(num)}</span><span class="toc__title">${esc(name || D.contentOf(s.heading).trim() || "Untitled")}</span><span class="toc__side"><span class="toc__dots"></span><span class="toc__time">${esc(start)}</span></span></a></li>`;
  }).join("");
  sectionObserver?.disconnect();
  sectionObserver = new IntersectionObserver((entries) => {
    const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!vis) return;
    $$("#toc a").forEach((a) => a.setAttribute("aria-current", String(a.dataset.sec === vis.target.dataset.sec)));
    const cur = $('#toc a[aria-current="true"]');
    if (cur && matchMedia("(max-width: 52rem)").matches) cur.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, { rootMargin: "-30% 0px -60% 0px" });
  $$(".section[data-sec]", scriptEl).forEach((s) => sectionObserver.observe(s));
  renderTocDots();
}
function renderTocDots() {
  const { sections } = D.outline(state.doc);
  for (const s of sections) {
    if (!s.heading) continue;
    const dots = $(`#toc a[data-sec="${s.heading.id}"] .toc__dots`);
    if (!dots) continue;
    const ids = new Set([s.heading.id, ...s.blocks.map((b) => b.id)]);
    const voice = state.asks.some((a) => a.scope === "script" && a.status === "answered" && a.answer.marks.some((m) => m.state === "open" && ids.has(m.blockId)));
    const asks = state.asks.some((a) => a.scope === "selection" && isOpen(a) && !isBrollAnswer(a) && ids.has(a.blockId));
    dots.innerHTML = (voice ? '<span class="pdot pdot--voice"></span>' : "") + (asks ? '<span class="pdot pdot--ask"></span>' : "") + (together?.dots(ids) || "");
  }
}
$("#toc").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-sec]");
  if (!a) return;
  e.preventDefault();
  editorJump();
  document.getElementById(`s-${a.dataset.sec}`)?.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });
});

/* ---------- Top bar and meta ---------- */
function renderTop() {
  const open = !!state.doc;
  $("#docInfo").hidden = !open;
  // A guest has no export, agent, voice check or sharing; each person picks their own Script/Storyboard view.
  for (const id of ["exportBtn", "voiceBtn"]) $("#" + id).hidden = !open || state.guest;
  // The agent is there on the start screen too, so it can open or write a script (step H); never in a guest's tab.
  $("#agentBtn").hidden = state.guest || !!roomLink;
  $("#viewSwitch").hidden = !open;
  together?.renderShare(open, state.guest);
  $("#docSwitch").disabled = state.guest;
  $("#empty").hidden = open;
  $("#layout").hidden = !open;
  renderView();
  renderAgent();
  if (!open) return;
  $("#fileName").textContent = state.name;
  document.title = `${D.titleOf(state.doc) || state.name} · script.techies.tools`;
  renderSaveState();
}
function renderSaveState() {
  const s = $("#saveState");
  if (state.guest) { s.dataset.state = ""; s.textContent = ""; s.removeAttribute("aria-label"); s.removeAttribute("role"); s.title = ""; $("#allowSave").hidden = true; return; }
  const dirty = isDirty();
  const allow = $("#allowSave");
  allow.hidden = !(state.needsPermission && state.handle);
  if (!allow.hidden) allow.textContent = `Allow saving to ${state.handle.name}`;
  $("#saveAsAction").hidden = !!state.handle && !state.inBrowser;
  if (state.saving && !state.autoSaving) { s.dataset.state = "saving"; s.textContent = "Saving…"; s.removeAttribute("aria-label"); s.title = ""; }
  else if (state.saveError) { s.dataset.state = "error"; s.textContent = "Not saved"; s.title = state.saveError; s.removeAttribute("aria-label"); }
  else if (dirty) { s.dataset.state = "dirty"; s.textContent = ""; s.setAttribute("aria-label", "Unsaved changes"); s.title = "Unsaved changes"; s.setAttribute("role", "img"); }
  // No "Saved" time (Lex, 2026-10-29): a saved script shows nothing here. The switcher's "Browser" tag says where it lives.
  else { s.dataset.state = ""; s.textContent = ""; s.removeAttribute("aria-label"); s.removeAttribute("role"); s.title = ""; }
}
function renderDerived() {
  if (!state.doc) return;
  const st = D.stats(state.doc);
  $("#docMeta").textContent = `${st.words.toLocaleString("en")} words · ${st.spoken} spoken`;
  // The prompter link is made ahead of the click; a script that is too long gets a quiet note instead.
  const pro = D.exportPrompter(state.doc);
  const tooLong = pro.length > D.PROMPTER_MAX_CHARS;
  $("#prompterAction").disabled = tooLong;
  $("#prompterNote").hidden = !tooLong;
  renderFolderNote();
  if (!tooLong) prompterUrl(pro);
  brollApi?.rematch(false);
  brollApi?.refreshSuggestions();
}

let derivedTimer = 0, draftTimer = 0;
// While the agent's whole text is untouched: the line at the top with Undo puts `before` back.
let replaced = null;
// Counts the lines shown at the top (and on the start screen), so an old line's buttons never hide a newer line.
let lineSeq = 0;
// The file a "wants to open" line asks about, until the person answers or another line takes its place.
let askingToOpen = null;
function changed() {
  if (replaced && D.serialize(state.doc) !== replaced.text) hideBanner();
  followMarks();
  together?.local();
  together?.redraw();
  renderSaveState();
  clearTimeout(derivedTimer);
  derivedTimer = setTimeout(renderDerived, 250);
  renderTocDots();
  brollApi?.touched();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 400);
  saving.schedule();
}

/* ---------- Prompter (prompter.techies.tools) ---------- */
// The link is made ahead of the click, so opening the tab stays inside the click and is not blocked.
const prompterCache = { text: null, url: null, seq: 0 };
async function prompterUrl(text) {
  if (prompterCache.text === text) return prompterCache.url;
  const seq = ++prompterCache.seq;
  const url = await D.prompterLink(text);
  if (seq === prompterCache.seq) Object.assign(prompterCache, { text, url });
  return url;
}
async function openPrompter() {
  if (!state.doc) return;
  const text = D.exportPrompter(state.doc);
  const url = prompterCache.text === text ? prompterCache.url : await prompterUrl(text);
  if (url) window.open(url, "_blank", "noopener");
}

/* ---------- Undo and redo ---------- */
// `before`: the script as it was before the change, when the step is taken after it (only once it happened).
function checkpoint(kind, id, before = null) {
  // In a shared script, undo follows each person's own changes instead (see together/room.js).
  if (together?.active) return;
  const now = Date.now(), last = state.lastStep;
  if (kind === "type" && last?.kind === "type" && last.id === id && now - last.at < TYPING_GROUP_MS) { last.at = now; return; }
  state.undo.push({ doc: before || D.cloneDoc(state.doc), caret: state.preCaret || getCaret() });
  if (state.undo.length > UNDO_LIMIT) state.undo.shift();
  state.redo = [];
  state.lastStep = { kind, id, at: now };
}
function restore(snap, from, to) {
  // A step that put the agent's change in (or took it out) says what its ask becomes: undone or kept, unmarked.
  const { back, closed } = C.landStep(state.asks, snap.land);
  to.push({ doc: D.cloneDoc(state.doc), caret: getCaret(), ...(back ? { land: back } : {}) });
  const was = state.doc;
  state.doc = D.cloneDoc(snap.doc);
  // A step that only moved bold marks: asks follow by their offsets, so one on a repeated word stays on that word.
  for (const b of state.doc.blocks) {
    const old = D.blockById(was, b.id), a = old && D.contentOf(old), z = D.contentOf(b);
    if (old && a !== z && a.replace(/\*/g, "") === z.replace(/\*/g, "")) followAnchors(b.id, z, marksMoved(a, z));
  }
  state.lastStep = null;
  if (closed) emit(closed.status, closed);
  reanchorAll();
  renderAll(snap.caret && byId(snap.caret.id) ? snap.caret : null);
  hideBar();
  changed();
}
function undo() {
  if (together?.active) { hideBar(); return void together.undo(); }
  const s = state.undo.pop();
  if (s) restore(s, state.undo, state.redo);
}
function redo() {
  if (together?.active) return;
  const s = state.redo.pop();
  if (s) restore(s, state.redo, state.undo);
}

/* ---------- Ask anchors follow edits ---------- */
function closeAsk(a, status) {
  a.status = status;
  emit(status, a);
}
// Returns true when an anchor moved or was dropped.
function reanchorBlock(id) {
  const b = byId(id);
  let moved = false;
  for (const a of state.asks) {
    if (a.scope === "selection" && a.blockId === id && isOpen(a) && !isBrollAnswer(a)) {
      const r = b && D.reanchor(a, D.contentOf(b));
      if (!r) { closeAsk(a, "cancelled"); moved = true; }
      else if (r.start !== a.start) { a.start = r.start; a.end = r.end; moved = true; }
    }
    if (a.scope === "script" && a.status === "answered") {
      for (const m of a.answer.marks) {
        if (m.state !== "open" || m.blockId !== id) continue;
        const r = b && D.reanchor(m, D.contentOf(b));
        if (!r) { m.state = "gone"; moved = true; }
        else if (r.start !== m.start) { m.start = r.start; m.end = r.end; moved = true; }
      }
      settleVoice(a);
    }
  }
  return moved;
}
function reanchorAll() {
  const ids = new Set(state.asks.flatMap((a) => (a.scope === "selection" ? [a.blockId] : (a.answer?.marks || []).map((m) => m.blockId))));
  for (const id of ids) reanchorBlock(id);
}
const moveAsks = (fromId, toId, fromStart, shift) => D.moveAsks(state.asks, fromId, toId, fromStart, shift);
// Bold marks moved in a block: open asks and "Sounds like me" marks there follow by their offsets (`at(start, end)` gives
// the new range of one, or null when an edit fell inside it), with their quote as it reads now (`content`; null when it
// stays), so they can't jump into another word by a search. `insideGoes`: one the edit fell inside is cancelled, for the
// same reason.
function followAnchors(id, content, at, { insideGoes = false } = {}) {
  const move = (x, gone) => {
    const r = at(x.start, x.end);
    if (r) Object.assign(x, r, content == null ? {} : { quote: content.slice(r.start, r.end) });
    else if (insideGoes) gone();
  };
  for (const a of state.asks) {
    if (a.scope === "selection" && a.blockId === id && isOpen(a) && !isBrollAnswer(a)) move(a, () => closeAsk(a, "cancelled"));
    if (a.scope === "script" && a.status === "answered") for (const m of a.answer?.marks || []) if (m.state === "open" && m.blockId === id) move(m, () => { m.state = "gone"; });
  }
}
const marksMoved = (from, to) => K.marksRange(from, to);
// The agent's marked changes (step F) follow every edit from the script as it was when they last followed
// (changeBase); an edit inside one ends its mark. `ops`: the room's operations, when they are known.
let changeBase = null;
function followMarks(ops = null) {
  if (!state.doc || !state.asks.some(C.isMarked)) { changeBase = null; return; }
  const now = C.blocksOf(state.doc);
  const c = ops ? null : getCaret();
  const touched = C.follow(state.asks, changeBase, now, { ops, caret: c && { blockId: c.id, offset: c.offset } });
  changeBase = now;
  if (!touched.size) return;
  const caret = getCaret();
  for (const id of touched) if (byId(id)) renderBlock(id, caret);
}
// The script as it is now is where the marks are (after they were made, placed or adopted).
function markBase() { changeBase = state.doc && state.asks.some(C.isMarked) ? C.blocksOf(state.doc) : null; }
// After setContent split or retyped a block: anchors move into the blocks their text went to.
function followPieces(id, r) {
  for (let i = r.pieces.length - 1; i >= 0; i--) {
    const p = r.pieces[i];
    if (i > 0) moveAsks(id, p.id, p.start, -(p.start + p.prefix));
    else if (p.start + p.prefix) moveAsks(id, id, 0, -(p.start + p.prefix));
  }
  let moved = false;
  for (const p of r.pieces) moved = reanchorBlock(p.id) || moved;
  return moved;
}
// Set a block's content, follow splits and type changes, re-render and put the caret back.
function applyContent(id, content, caretOffset) {
  const r = D.setContent(state.doc, id, content);
  followPieces(id, r);
  const caret = caretOffset == null ? null : D.locate(r, caretOffset);
  if (r.changed || r.created.length) renderAll(caret);
  else renderBlock(id, caret);
  return r;
}

/* ---------- Editing ---------- */
// The links that were closed when a deletion began (beforeinput), so that their hidden Markdown survives it.
let linksBefore = null;
let boldTyping = null; // A word being typed in front of a bold word: { id, content, end } (K.settleMarks).
function syncFromDom(el) {
  const id = el.dataset.id, b = byId(id);
  if (!b) return;
  clearAskNote(id);
  const typed = readContent(el);
  const before = linksBefore?.id === id && linksBefore.content === D.contentOf(b) ? linksBefore.closed : null;
  linksBefore = null;
  let fix = before && L.keepHidden(D.contentOf(b), typed, before, getCaret()?.offset), settledNow = null;
  // A bold stretch this edit broke is settled, so its marks never stay behind as literal text (K.settleMarks). A word
  // being typed in front of one is followed from edit to edit, until its space is typed.
  if (b.type === "para") {
    const old = D.contentOf(b), going = boldTyping?.id === id && boldTyping.content === old ? boldTyping.end : null;
    const now = fix ? fix.content : typed, caret = fix ? fix.caret : getCaret()?.offset;
    const settled = K.settleMarks(old, now, caret, { typedBefore: going, deleted: fix?.gone });
    // The space that ends a word typed in front of a bold word: the person is writing, say a numbered list, and asked for it.
    const endsTyped = going != null && now.length === old.length + 1 && /\s/.test(now[caret - 1] ?? "");
    // A deletion is judged against the text before it, as it can take the marks itself; text put in, against what was put in.
    if (settled && !endsTyped && C.settlingChangesKind(now.length < old.length ? old : now, settled.content)) {
      // Without its marks this line would read as another kind of block ("- item", "# Plan"), and its words would leave
      // the spoken text: the edit is refused, quietly, and it keeps them, with the caret where it was.
      const was = state.preCaret?.id === id ? state.preCaret.offset : (caret ?? 0) + old.length - now.length;
      fix = { content: old, caret: Math.max(0, Math.min(old.length, was)) };
      boldTyping = null;
    } else {
      fix = settled || fix;
      boldTyping = settled?.typedBefore != null ? { id, content: settled.content, end: settled.typedBefore } : null;
      settledNow = settled;
    }
  }
  const content = fix ? fix.content : typed;
  if (content === D.contentOf(b)) {
    if (fix || !domMatches(el, id)) renderBlock(id, fix ? { id, offset: fix.caret } : getCaret());
    return;
  }
  checkpoint("type", id);
  const caret = fix ? { id, offset: fix.caret } : getCaret();
  if (settledNow) followAnchors(id, content, settledNow.follow, { insideGoes: true });
  const r = D.setContent(state.doc, id, content);
  const moved = followPieces(id, r);
  if (r.changed || r.created.length) {
    renderAll(D.locate(r, caret?.offset ?? 0));
  } else {
    if (moved || fix || !domMatches(el, id)) renderBlock(id, caret);
    if (b.type === "heading" || b.type === "title") { renderToc(); renderTop(); }
  }
  changed();
}

function splitAt(el, start, end, lineBreak) {
  const id = el.dataset.id, b = byId(id);
  let content = D.contentOf(b);
  const after = state.doc.blocks[state.doc.blocks.indexOf(b) + 1];
  if (!lineBreak && start === end && start === content.length && after?.type === "para" && D.contentOf(after) === "") {
    placeCaret(after.id, 0);
    return;
  }
  // Enter inside a bold stretch: it is settled as if the line broke there, so no lone marks are left in either part. If a
  // part would then read as another kind of block, its words would leave the spoken text: nothing changes.
  const settled = b.type === "para" ? K.settleMarks(content, `${content.slice(0, start)}\n${content.slice(end)}`, start + 1) : null;
  const broke = settled?.content[settled.caret - 1] === "\n";
  if (broke) {
    const at = settled.caret - 1, left = settled.content.slice(0, at), right = settled.content.slice(at + 1);
    // The left part is tried with a letter after it: "1. " alone reads as text, but as a list once anything follows. The
    // two parts joined without their marks must keep the type too: "**1. x y**" would join as the list "1. x y", "**## Plan**"
    // as a heading (Enter and Shift+Enter alike).
    const parts = lineBreak ? C.keepsType(settled.content, b.type) : C.keepsType(`${left}x`, b.type) && C.keepsType(right, b.type);
    if (!(parts && C.keepsType(left + right, b.type))) return;
  }
  checkpoint("enter", id);
  if (broke) {
    start = end = settled.caret - 1;
    content = settled.content.slice(0, start) + settled.content.slice(start + 1);
    followAnchors(id, content, (from, to) => {
      const r = settled.follow(from, to);
      return r && { start: r.start > start ? r.start - 1 : r.start, end: r.end > start ? r.end - 1 : r.end };
    }, { insideGoes: true });
    D.setContent(state.doc, id, content);
    reanchorBlock(id);
  }
  if (end > start) {
    content = content.slice(0, start) + content.slice(end);
    D.setContent(state.doc, id, content);
    reanchorBlock(id);
  }
  // A second line break in a row starts a new block, so a para never holds a blank line.
  if (lineBreak && b.type !== "raw" && content[start - 1] === "\n") {
    content = content.slice(0, start - 1) + content.slice(start);
    D.setContent(state.doc, id, content);
    moveAsks(id, id, start, -1);
    start -= 1;
    lineBreak = false;
  }
  if (lineBreak) {
    moveAsks(id, id, start, 1);
    applyContent(id, content.slice(0, start) + "\n" + content.slice(start), start + 1);
  } else if ((b.type === "heading" || b.type === "title") && start === 0 && content.length) {
    const i = state.doc.blocks.indexOf(b);
    D.insertBlock(state.doc, i > 0 ? state.doc.blocks[i - 1].id : null, "para", "");
    renderAll({ id, offset: 0 });
  } else {
    const next = D.splitBlock(state.doc, id, start);
    moveAsks(id, next.id, start, -start);
    reanchorBlock(id);
    reanchorBlock(next.id);
    renderAll({ id: next.id, offset: 0 });
  }
  changed();
}

function removeEmpty(el, dir) {
  const id = el.dataset.id;
  const i = state.doc.blocks.findIndex((b) => b.id === id);
  if (state.doc.blocks.length <= 1) return;
  checkpoint("remove", id);
  D.removeBlock(state.doc, id);
  reanchorBlock(id);
  const prev = state.doc.blocks[i - 1], next = state.doc.blocks[i];
  const target = dir < 0 ? prev || next : next || prev;
  renderAll(target ? { id: target.id, offset: target === prev && dir < 0 ? D.contentOf(prev).length : 0 } : null);
  changed();
}

function mergeInto(prevId, id) {
  const prev = byId(prevId);
  const offset = D.contentOf(prev).length;
  // The next paragraph's bold word right after a word: it is settled as if the line break between them was deleted. If
  // that would turn the line into another kind of block, the join is refused, quietly, and both lines stay as they are.
  const joined = D.contentOf(prev) + D.contentOf(byId(id));
  const settled = prev.type === "para" ? K.settleMarks(`${D.contentOf(prev)}\n${D.contentOf(byId(id))}`, joined, offset) : null;
  if (settled && C.settlingChangesKind(joined, settled.content)) return;
  checkpoint("merge", id);
  moveAsks(id, prevId, 0, offset);
  const m = D.mergeWithPrevious(state.doc, id);
  if (settled) {
    followAnchors(prevId, settled.content, marksMoved(joined, settled.content));
    D.setContent(state.doc, prevId, settled.content);
  }
  reanchorBlock(prevId);
  renderAll({ id: m.into, offset: settled ? settled.caret : m.offset });
  changed();
}

function onBackspace(el) {
  const sel = selectionIn(el);
  if (!sel || sel.start !== sel.end || sel.start !== 0) return false;
  const id = el.dataset.id, b = byId(id);
  if (D.contentOf(b) === "") { removeEmpty(el, -1); return true; }
  const i = state.doc.blocks.indexOf(b), prev = state.doc.blocks[i - 1];
  if (b.type === "para" && prev && (prev.type === "para" || prev.type === "note")) { mergeInto(prev.id, id); return true; }
  return true;
}
function onDelete(el) {
  const sel = selectionIn(el);
  const id = el.dataset.id, b = byId(id), len = D.contentOf(b).length;
  if (!sel || sel.start !== sel.end || sel.end !== len) return false;
  if (len === 0) { removeEmpty(el, 1); return true; }
  const i = state.doc.blocks.indexOf(b), next = state.doc.blocks[i + 1];
  if (next && next.type === "para" && (b.type === "para" || b.type === "note")) { mergeInto(id, next.id); return true; }
  return true;
}

// Plain text only. Blank lines in the pasted text make new blocks (setContent splits them).
function pasteText(el, raw) {
  const id = el.dataset.id, b = byId(id);
  let text = raw.replace(/\r\n?/g, "\n");
  if (b.type === "title" || b.type === "heading") text = text.replace(/\s*\n\s*/g, " ");
  if (!text) return;
  const sel = selectionIn(el) || { start: 0, end: 0 };
  const content = D.contentOf(b);
  const pasted = content.slice(0, sel.start) + text + content.slice(sel.end), settled = b.type === "para" ? K.settleMarks(content, pasted, sel.start + text.length) : null;
  // Without its marks this line would read as another kind of block: the paste is refused, quietly. A paste that makes
  // paragraphs or a list itself reads the same with or without them, and goes in.
  if (settled && C.settlingChangesKind(pasted, settled.content)) return;
  checkpoint("paste", id);
  // Bold settled: asks follow by their offsets from the text before the paste; one it fell inside isn't moved at all.
  if (settled) followAnchors(id, settled.content, settled.follow, { insideGoes: true });
  else moveAsks(id, id, sel.end, text.length - (sel.end - sel.start));
  applyContent(id, settled ? settled.content : pasted, settled ? settled.caret : sel.start + text.length);
  changed();
}

// Arrow keys move between blocks (each block is its own editing area).
function caretRect() {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(false);
  const rect = r.getClientRects()[0];
  return rect && (rect.height || rect.width) ? rect : null;
}
function neighbour(el, dir) {
  const all = $$(".block", scriptEl).filter((b) => b === el || !b.closest("details:not([open])"));
  return all[all.indexOf(el) + dir] || null;
}
function caretFromPoint(x, y) {
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p ? [p.offsetNode, p.offset] : null; }
  if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); return r ? [r.startContainer, r.startOffset] : null; }
  return null;
}
function jumpTo(el, dir, x) {
  const target = neighbour(el, dir);
  if (!target) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest" });
  const tb = target.getBoundingClientRect();
  const tlh = parseFloat(getComputedStyle(target).lineHeight) || 24;
  const p = x == null ? null : caretFromPoint(Math.min(Math.max(x, tb.left + 1), tb.right - 1), dir < 0 ? tb.bottom - tlh / 2 : tb.top + tlh / 2);
  if (p && target.contains(p[0])) setCaretAt(target, offsetIn(target, p[0], p[1]));
  else setCaretAt(target, dir < 0 ? readContent(target).length : 0);
  return true;
}
// Up/down leave the block from its first or last line. Where the caret has no box (some empty
// lines), let the browser move first and jump only when the caret did not move.
function moveVertical(el, dir) {
  if (!getSelection().isCollapsed) return false;
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
  const box = el.getBoundingClientRect();
  const rect = caretRect();
  if (!rect) {
    const before = getCaret();
    setTimeout(() => {
      const now = getCaret();
      if (before && now && now.id === before.id && now.offset === before.offset && document.activeElement === el) jumpTo(el, dir, null);
    }, 0);
    return false;
  }
  if (dir < 0 && rect.top - box.top > lh * 0.6) return false;
  if (dir > 0 && box.bottom - rect.bottom > lh * 0.6) return false;
  return jumpTo(el, dir, rect.left);
}
function moveSideways(el, dir) {
  const sel = selectionIn(el);
  if (!sel || sel.start !== sel.end || !getSelection().isCollapsed) return false;
  const len = readContent(el).length;
  if ((dir < 0 && sel.start !== 0) || (dir > 0 && sel.end !== len)) return false;
  const target = neighbour(el, dir);
  if (!target) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest" });
  setCaretAt(target, dir < 0 ? readContent(target).length : 0);
  return true;
}

scriptEl.addEventListener("keydown", (e) => {
  const el = blockOf(e.target);
  if (!el) return;
  state.preCaret = getCaret();
  if (e.isComposing || e.keyCode === 229) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === "Enter" && !mod) {
    e.preventDefault();
    const s = selectionIn(el);
    if (s) splitAt(el, s.start, s.end, e.shiftKey && (el.dataset.type === "para" || el.dataset.type === "note") || el.dataset.type === "raw");
  } else if (e.key === "Backspace" && !mod && !e.altKey) {
    if (onBackspace(el)) e.preventDefault();
  } else if (e.key === "Delete" && !mod && !e.altKey) {
    if (onDelete(el)) e.preventDefault();
  } else if (!e.shiftKey && !mod && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    if (moveVertical(el, e.key === "ArrowUp" ? -1 : 1)) e.preventDefault();
  } else if (!e.shiftKey && !mod && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    const rtl = getComputedStyle(el).direction === "rtl";
    if (moveSideways(el, (e.key === "ArrowLeft") !== rtl ? -1 : 1)) e.preventDefault();
  }
});
scriptEl.addEventListener("beforeinput", (e) => {
  const el = blockOf(e.target);
  if (!el) return;
  if (!state.preCaret) state.preCaret = getCaret();
  if (e.inputType.startsWith("delete") && !e.isComposing) linksBefore = el.querySelector(".md-link:not([data-open]), .md-cut__mark:not([data-open])") ? { id: el.dataset.id, content: readContent(el), closed: closedLinks(el) } : null;
  if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
    e.preventDefault();
    e.inputType === "historyUndo" ? undo() : redo();
  } else if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") {
    // Keyboards that skip keydown (some phones).
    e.preventDefault();
    const s = selectionIn(el);
    if (s) splitAt(el, s.start, s.end, (e.inputType === "insertLineBreak" && (el.dataset.type === "para" || el.dataset.type === "note")) || el.dataset.type === "raw");
  } else if (e.inputType === "deleteContentBackward") {
    if (onBackspace(el)) e.preventDefault();
  }
});
scriptEl.addEventListener("input", (e) => {
  if (e.isComposing) return;
  const el = blockOf(e.target);
  if (el) syncFromDom(el);
  state.preCaret = null;
});
scriptEl.addEventListener("compositionend", (e) => { const el = blockOf(e.target); if (el) syncFromDom(el); });
scriptEl.addEventListener("paste", (e) => {
  const el = blockOf(e.target);
  if (!el) return;
  e.preventDefault();
  pasteText(el, e.clipboardData?.getData("text/plain") || "");
});

/* ---------- Cues (fleet issue #14; always on, Lex 2026-11-06) ---------- */
// The on/off and export settings saved before 2026-11-06 mean nothing now: they go from this browser.
try { for (const k of Object.keys(localStorage)) if (k === `${LS}cues` || k.startsWith(`${LS}cues:`)) localStorage.removeItem(k); } catch { /* storage off */ }
// Bold style: orange and bold (app.css), or the person's own colours (K.boldStyle lets only "#rrggbb" through to the CSS).
// Picked in the small popover by B on the selection bar (Lex 2026-11-07, Variant A); the popover's sample word follows too.
const boldPop = $("#boldPop"), boldBtn = $("#boldBtn");
const darkMode = matchMedia("(prefers-color-scheme: dark)");
const boldMode = () => (darkMode.matches ? "dark" : "light");
function applyBoldStyle() {
  const b = K.boldStyle(store.get("boldStyle")), shown = K.boldShown(b, boldMode());
  for (const el of [scriptEl, boldPop]) for (const [prop, value] of [["--bold-fg", shown.color], ["--bold-bg", shown.background]]) {
    if (value) el.style.setProperty(prop, value);
    else el.style.removeProperty(prop);
  }
  return b;
}
applyBoldStyle();
const setBoldStyle = (patch) => { store.set("boldStyle", { ...K.boldStyle(store.get("boldStyle")), ...patch }); renderBoldPop(); };
$("#boldBg").addEventListener("input", (e) => setBoldStyle({ background: e.target.value }));
$("#boldFg").addEventListener("input", (e) => setBoldStyle({ color: e.target.value }));
// What the colour fields show while nothing is chosen: the default orange (as sRGB) and the page's own colour (--bg).
const BOLD_SHOWN = { light: { color: "#b53707", background: "#fafafa" }, dark: { color: "#fb401e", background: "#080721" } };
for (const row of $$(".bold-pop__row", boldPop)) {
  const custom = $(".bold-pop__custom", row);
  for (const { hex } of K.BOLD_SWATCHES[row.dataset.kind]) custom.insertAdjacentHTML("beforebegin", `<button class="bold-pop__swatch" type="button" data-hex="${hex}" aria-pressed="false"></button>`);
}
// Each row is one Tab stop (the picked one, or the last one reached with the arrows), and the arrow keys move along it: B to the input is a few presses, not fifteen.
const popRowItems = (row) => [...$$(".bold-pop__swatch", row), $(".bold-pop__custom input", row)];
function renderBoldPop() {
  const bold = applyBoldStyle(), mode = boldMode(), seen = K.boldShown(bold, mode), fallback = BOLD_SHOWN[mode];
  $("#boldFg").value = seen.color || fallback.color;
  $("#boldBg").value = seen.background || fallback.background;
  for (const row of $$(".bold-pop__row", boldPop)) {
    const kind = row.dataset.kind, now = K.boldSwatch(kind, bold[kind])?.hex || (bold[kind] || "").toLowerCase();
    let picked = null;
    for (const sw of $$(".bold-pop__swatch", row)) {
      const s = K.BOLD_SWATCHES[kind].find((x) => x.hex === sw.dataset.hex);
      if (s) {
        const look = mode === "light" ? s.light : s;
        sw.style.setProperty("--swatch-colour", look.hex);
        sw.setAttribute("aria-label", look.name);
        sw.title = look.name;
      }
      const on = sw.dataset.hex === now;
      if (on) picked = sw;
      sw.setAttribute("aria-pressed", String(on));
    }
    const custom = $(".bold-pop__custom", row);
    custom.dataset.on = String(!picked);
    custom.style.setProperty("--swatch-colour", picked ? "transparent" : seen[kind]);
    const stop = row.contains(document.activeElement) ? document.activeElement : picked || $("input", custom);
    for (const el of popRowItems(row)) el.tabIndex = el === stop ? 0 : -1;
  }
  $("#boldReset").disabled = !bold.color && !bold.background;
}
boldPop.addEventListener("keydown", (e) => {
  const row = e.target.closest(".bold-pop__row");
  if (!row || !["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
  const items = popRowItems(row), i = items.indexOf(e.target);
  const to = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
  e.preventDefault();
  for (const el of items) el.tabIndex = el === items[to] ? 0 : -1;
  items[to].focus();
});
// The system switching between light and dark: the ready-made colours follow.
darkMode.addEventListener("change", renderBoldPop);
boldPop.addEventListener("click", (e) => {
  const sw = e.target.closest(".bold-pop__swatch");
  if (sw) setBoldStyle({ [sw.closest(".bold-pop__row").dataset.kind]: sw.dataset.hex || null });
});
// Reset: the default orange and no background, and nothing saved.
$("#boldReset").addEventListener("click", () => { store.del("boldStyle"); renderBoldPop(); });
// Colours changed in another tab of this browser.
addEventListener("storage", (e) => { if (e.key === `${LS}boldStyle` || e.key === null) renderBoldPop(); });
renderBoldPop();
// Ctrl/Cmd+B and the B button: toggle a cue (the person sees it as bold words) on the selected words of one spoken paragraph. One Ctrl/Cmd+Z step.
// Anything else (across paragraphs, a heading, a reminder, a link line) changes nothing, quietly.
function toggleCueHere() {
  const s = markupSel();
  if (s) changeMarkup(s, "cue", (content) => K.toggleCue(content, s.start, s.end));
}
// The selection B or the link icon acts on: the bar's saved one while the focus is in the bar (input, B or the link icon by
// keyboard: the browser takes the page's selection away then), as makeAsk does; else the page's. Only spoken paragraphs.
function markupSel() {
  if (state.locked || state.pendingDraft) return null;
  const inBar = bar.contains(document.activeElement);
  const s = (inBar && barSel) || currentSelection();
  const b = s && byId(s.id);
  if (!b || b.type !== "para" || D.contentOf(b).slice(s.start, s.end) !== s.quote) return null;
  return D.spokenBlocks(state.doc).some((x) => x.id === b.id) ? s : null;
}
// Put a change of marks in (K.toggleCue, K.addLink, K.removeLink): one Ctrl/Cmd+Z step; the words stay selected and the
// bar shows their new state. Anything that can't work there (a link line, open work in the way) changes nothing, quietly.
function changeMarkup(s, kind, make) {
  const b = byId(s.id), old = D.contentOf(b), inBar = bar.contains(document.activeElement);
  if (!s.el.contains(s.range.startContainer) || !s.el.contains(s.range.endContainer)) return;
  const res = make(old);
  if (!C.canToggleCue(state.asks, b.id, b.type, res)) return;
  checkpoint(kind, b.id);
  followAnchors(b.id, res.content, res.ops ? K.opsRange(old, res.ops) : marksMoved(old, res.content));
  const r = D.setContent(state.doc, b.id, res.content);
  followPieces(b.id, r);
  // The bar's words have new marks now: said before the redraw, so it doesn't look for the old ones.
  if (barSel?.id === b.id) Object.assign(barSel, { start: res.start, end: res.end, quote: res.content.slice(res.start, res.end), plainAt: plainOffset(res.content, res.start) });
  // A link put in or taken out ends the address field; B pressed while it is open keeps what is typed there.
  if (kind === "link") leaveLinkMode();
  renderBlock(b.id);
  const el = blockNode(b.id);
  if (el) {
    const range = rangeAt(el, res.start, res.end);
    if (!inBar) {
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    barSel = { id: b.id, el, start: res.start, end: res.end, quote: res.content.slice(res.start, res.end), range: range.cloneRange(), spoken: true, plainAt: plainOffset(res.content, res.start) };
    // B made the words part link, part not: the address field has nothing left to link.
    if (linkMode && linkTry(barSel)?.state !== "off") leaveLinkMode();
    cueBtnState(barSel);
    linkBtnState(barSel);
    barLabel(barSel.quote);
    paintBarSel();
    renderAsk();
  }
  changed();
}
// What the toggle would do on this selection: null where it can't work (across paragraphs, a link or "*" in the way).
function cueTry(s) {
  const b = byId(s.id);
  return b && s.el.contains(s.range.startContainer) && s.el.contains(s.range.endContainer) ? K.toggleCue(D.contentOf(b), s.start, s.end) : null;
}
// The B button: pressed when the selection is bold; disabled where the toggle can't work or is stopped.
function cueBtnState(s) {
  const b = byId(s.id), btn = $("#boldBtn"), res = !btn.hidden && cueTry(s);
  btn.setAttribute("aria-pressed", String(!!b && K.cueSelected(D.contentOf(b), s.start, s.end)));
  btn.disabled = !res || !C.canToggleCue(state.asks, b.id, b.type, res);
}
// No title tooltip: hovering B opens the colours, and a tooltip would sit on them. The keys stay in aria-keyshortcuts.
$("#boldBtn").addEventListener("click", toggleCueHere);

/* The link icon (Lex 2026-11-07), right after B: on words that aren't a link it turns the input into an address field
   (placeholder https://; Enter links, Escape goes back to asking). While a full address is typed, the words show linked
   and the icon on. On a link it shows a broken chain, the address on hover, and a click removes the link (its words and
   their bold stay; Ctrl/Cmd+Z brings it back). Grey when the words are part link, part not. */
const linkBtn = $("#linkBtn");
const ASK_PLACEHOLDER = askInputDefaults();
let linkMode = false;
function askInputDefaults() { const i = $("#askInput"); return { placeholder: i.placeholder, label: i.getAttribute("aria-label"), hint: i.getAttribute("enterkeyhint"), max: i.maxLength, describedBy: i.getAttribute("aria-describedby") }; }
const typedLink = () => (linkMode ? L.typedAddress($("#askInput").value) : null);
function linkTry(s) {
  const b = s && byId(s.id);
  return b && s.el.contains(s.range.startContainer) && s.el.contains(s.range.endContainer) ? K.linkState(D.contentOf(b), s.start, s.end) : null;
}
function linkBtnState(s) {
  const b = s && byId(s.id), st = s && !linkBtn.hidden ? linkTry(s) : null, on = st?.state === "on";
  // Off: the stretch a link would change (its address doesn't matter for that) must be free of open work.
  const res = !b || !st ? null : on ? K.removeLink(D.contentOf(b), s.start, s.end) : st.state === "off" ? K.addLink(D.contentOf(b), s.start, s.end, "https://example.com") : null;
  linkBtn.disabled = barSending > 0 || !C.canToggleCue(state.asks, b?.id, b?.type, res);
  linkBtn.setAttribute("aria-pressed", String(on || !!typedLink()));
  const name = on ? "unlink" : "link";
  if (linkBtn.dataset.icon !== name) { linkBtn.dataset.icon = name; linkBtn.innerHTML = icon(name); }
  linkBtn.dataset.tip = on ? st.link.url : "";
  // One name for the toggle; pressed says it is a link, and the address is its description.
  if (on) linkBtn.setAttribute("aria-description", st.link.url);
  else linkBtn.removeAttribute("aria-description");
}
// While a full address is typed, the selected words show linked.
function paintLinkPreview() {
  if (!window.Highlight || !CSS.highlights) return;
  if (typedLink() && barSel?.range) CSS.highlights.set("link-preview", new Highlight(barSel.range));
  else CSS.highlights.delete("link-preview");
}
function enterLinkMode() {
  linkMode = true;
  closeBarMenus();
  askInput.value = "";
  askPick = 0;
  askInput.placeholder = "https://";
  askInput.inputMode = "url";
  askInput.setAttribute("enterkeyhint", "done");
  askInput.setAttribute("aria-label", "Link address");
  askInput.removeAttribute("aria-describedby");
  askInput.maxLength = L.LINK_LIMITS.url;
  askField.dataset.mode = "link";
  askInput.focus({ preventScroll: true });
  renderAsk();
}
function leaveLinkMode() {
  if (!linkMode) return;
  linkMode = false;
  askInput.value = "";
  askInput.placeholder = ASK_PLACEHOLDER.placeholder;
  askInput.inputMode = "text";
  askInput.setAttribute("enterkeyhint", ASK_PLACEHOLDER.hint);
  askInput.setAttribute("aria-label", ASK_PLACEHOLDER.label);
  if (ASK_PLACEHOLDER.describedBy) askInput.setAttribute("aria-describedby", ASK_PLACEHOLDER.describedBy);
  askInput.maxLength = ASK_PLACEHOLDER.max;
  delete askField.dataset.mode;
  renderAsk();
  paintLinkPreview();
  if (barSel) linkBtnState(barSel);
}
linkBtn.addEventListener("click", () => {
  const s = markupSel(), st = s && linkTry(s);
  if (st?.state === "on") changeMarkup(s, "link", (content) => K.removeLink(content, s.start, s.end));
  else if (st?.state === "off") { if (linkMode) { leaveLinkMode(); askInput.focus({ preventScroll: true }); } else enterLinkMode(); }
});
function applyLink() {
  const url = typedLink(), s = url && markupSel();
  if (s) changeMarkup(s, "link", (content) => K.addLink(content, s.start, s.end, url));
}
// The agent's mark_cue and unmark_cue: one change (one Ctrl/Cmd+Z step when alone, the agent's in a shared script),
// a marked change with Undo on the agent's name tag per paragraph (C.landCues). Returns how many cues changed.
function landAgentCues(plan, mode, by) {
  together?.local();
  const before = D.cloneDoc(state.doc);
  for (const seg of plan.segments) followAnchors(seg.id, seg.content, marksMoved(D.contentOf(byId(seg.id)), seg.content));
  const parts = C.landCues(state.doc, plan, mode, by, Date.now());
  if (!parts.length) return 0;
  checkpoint("agent", parts[0].blockId, before);
  if (!together?.active) state.undo.at(-1).land = { id: parts[0].ask.id, status: "undone", ...(parts.length > 1 ? { also: parts.slice(1).map((p) => p.ask.id) } : {}) };
  for (const p of parts) followPieces(p.blockId, p.result);
  followMarks(); // the agent's earlier changes follow these
  const now = Date.now();
  for (const p of parts) {
    arrived.set(p.ask.id, now);
    state.asks.push(p.ask);
    emit("kept", p.ask);
  }
  markBase();
  together?.localAs("agent");
  renderAll(getCaret());
  renderAgent();
  changed();
  return parts.reduce((n, p) => n + p.ask.answer.cues.length, 0);
}
const cueSkips = (skipped) => (skipped.length ? ` Skipped: ${skipped.map((x) => `${JSON.stringify(x.quote)} (${x.why})`).join("; ")}.` : "");
// How many cues a rewrite dropped, per ask, for the agent's answer_ask result.
const cueDrops = new Map();

/* ---------- Edit bar ---------- */
const bar = $("#editBar");
const askInput = $("#askInput"), askField = $("#askField"), askTab = $("#askTab"), askSend = $("#askForm .edit-bar__send"), moreMenu = $("#moreMenu");
let barSel = null, barSending = 0, askPick = 0, scriptPress = false, pressMoved = false, askSayTimer = 0, askSayWant = "";
// The bold colours by B: open and close timers, kept open by a tap (until a tap elsewhere), focus B again without reopening.
let popOpenTimer = 0, popCloseTimer = 0, popStuck = false, popTouch = false, popQuietFocus = false, popByHover = false;
// A selection across blocks is clamped to the first block where it covers at least one word.
function currentSelection() {
  if (state.pendingDraft) return null;
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  for (const el of $$(".block", scriptEl)) {
    if (!r.intersectsNode(el) || el.closest("details:not([open])")) continue;
    const content = readContent(el);
    const start = el.contains(r.startContainer) ? offsetIn(el, r.startContainer, r.startOffset) : 0;
    const end = el.contains(r.endContainer) ? offsetIn(el, r.endContainer, r.endOffset) : content.length;
    const snap = D.snapToWords(content, start, end);
    if (snap.end > snap.start) return { id: el.dataset.id, el, start: snap.start, end: snap.end, quote: content.slice(snap.start, snap.end), range: r.cloneRange() };
  }
  return null;
}
function placeBar(r) {
  const rects = [...r.getClientRects()].filter((x) => x.width > 0), first = rects[0] || r.getBoundingClientRect(), last = rects[rects.length - 1] || first;
  bar.hidden = false;
  const top = $(".top").getBoundingClientRect().bottom;
  if (matchMedia("(width < 40rem)").matches) {
    const v = window.visualViewport, lift = v ? Math.max(0, innerHeight - v.height - v.offsetTop) : 0;
    bar.style.setProperty("--bar-lift", lift + "px");
    const clear = seenFrom(top, v?.offsetTop); // a keyboard can pan the page up: the top of what is seen is lower down
    bar.style.setProperty("--bar-y", clear + 8 + "px");
    bar.dataset.dock = phoneDock({ first, last, h: bar.offsetHeight, top: clear, vh: innerHeight, lift });
    return;
  }
  const at = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  const line = parseFloat(getComputedStyle(at).lineHeight) || first.height;
  // What is really seen: on a tablet the on-screen keyboard covers the end of the window and may pan the page.
  const v = window.visualViewport, seenEnd = v ? v.height + v.offsetTop : innerHeight, seenTop = seenFrom(top, v?.offsetTop);
  const { x, y } = barSpot({ first, last, w: bar.offsetWidth, h: bar.offsetHeight, top: seenTop, vw: document.documentElement.clientWidth, vh: seenEnd, line });
  bar.style.setProperty("--bar-x", x + "px");
  bar.style.setProperty("--bar-y", y + "px");
}
function showBar() {
  if (state.locked) return hideBar();
  // A mouse selecting: the bar comes on release (selTimer), not under the pointer in the middle of a drag.
  if (scriptPress) { if (!bar.hidden) hideBar(); return; }
  // The moment an ask is sending: a new selection ends it at once; nothing else changes it.
  if (barSending) {
    if (!currentSelection()) return;
    hideBar();
  }
  if (bar.contains(document.activeElement) || brollApi?.cardOpen()) return;
  const s = currentSelection();
  if (!s) { hideBar(); return; }
  barSel = s;
  barSel.spoken = spokenSelection(s.range).length > 0;
  barSel.plainAt = plainOffset(D.contentOf(byId(s.id)), s.start);
  $("#boldBtn").hidden = linkBtn.hidden = byId(s.id)?.type !== "para" || !barSel.spoken;
  leaveLinkMode();
  cueBtnState(s);
  linkBtnState(s);
  barLabel(s.quote);
  closeCard();
  renderAsk();
  placeBar(s.range);
  if ($("#boldBtn").hidden) closeBoldPop();
  else if (boldPop.matches(":popover-open")) placeBoldPop();
}
function hideBar() {
  leaveLinkMode();
  closeBarMenus();
  clearTimeout(barSending);
  clearTimeout(askSayTimer);
  askSayWant = "";
  barSending = 0;
  bar.hidden = true;
  barSel = null;
  askField.dataset.state = "idle";
  askInput.readOnly = false;
  askInput.removeAttribute("aria-busy");
  askInput.value = "";
  askPick = 0;
  $("#askLive").textContent = "";
  paintBarSel();
  renderAsk();
}
// The bar's word count, for the words it holds (also after B widened them over a bold edge).
function barLabel(quote) {
  const n = D.countWords(K.spokenWords(quote));
  $("#ebLabel").textContent = `${n.toLocaleString("en")} ${n === 1 ? "word" : "words"}`;
}
// A redraw of the selected line (an agent's answer, a guest's edit) while the focus is in the bar: its range went with the
// old nodes, so it is made again on the same words. If they are gone the ask stops at makeAsk, as before.
function keepBarSel(id) {
  if (!barSel?.range || barSel.id !== id || !bar.contains(document.activeElement)) return;
  const b = byId(id), el = blockNode(id);
  if (!b || !el) return;
  const content = D.contentOf(b);
  // Always searched: the same text at the old offset can be another copy, moved there by a mark before it.
  const r = findWords(content, barSel.quote, barSel.plainAt ?? barSel.start);
  if (!r) return;
  const { start, end } = r;
  Object.assign(barSel, { el, start, end, quote: r.quote, plainAt: plainOffset(content, start), range: rangeAt(el, start, end) });
  cueBtnState(barSel);
  linkBtnState(barSel);
  paintBarSel();
  placeBar(barSel.range);
}
// The browser takes the page's selection away while the focus is in the bar, so the words stay marked by the script.
function paintBarSel() {
  if (!window.Highlight || !CSS.highlights) return;
  if (barSel?.range && bar.contains(document.activeElement)) CSS.highlights.set("bar-selection", new Highlight(barSel.range));
  else CSS.highlights.delete("bar-selection");
  paintLinkPreview();
}
bar.addEventListener("focusin", paintBarSel);
bar.addEventListener("focusout", (e) => { if (!bar.contains(e.relatedTarget)) CSS.highlights?.delete("bar-selection"); });

/* The input: an ask in the person's words, or a typed command (edit-bar.js). A grey ghost shows the rest of the suggestion
   after the caret; Tab or the Tab key takes it, Up and Down switch it, Enter sends what is typed. */
const askCan = () => ({ spoken: !!barSel?.spoken, addBroll: canAddBroll(), guest: !!state.guest });
const ASK_HISTORY = "askHistory";
// For screen readers: the ghost is hidden from them. A suggestion waits for a pause in the typing.
function sayAsk(text, wait = 0) {
  clearTimeout(askSayTimer);
  askSayTimer = setTimeout(() => { if (!barSending) $("#askLive").textContent = text; }, wait);
}
// The suggestion on offer, with the caret at the end of the typed words only.
function askGhostNow() {
  const end = askInput.value.length;
  if (barSending || linkMode || askInput.selectionStart !== end || askInput.selectionEnd !== end) return null;
  if (resolveTyped(askInput.value, askCan())?.kind === "blocked") return null;
  const list = suggestions(askInput.value, { can: askCan(), earlier: store.get(ASK_HISTORY) });
  if (!list.length) return null;
  const at = ((askPick % list.length) + list.length) % list.length;
  return { text: list[at], at, count: list.length };
}
function renderAsk() {
  if (linkMode) return renderLinkField();
  const typed = askInput.value, g = askGhostNow(), plan = resolveTyped(typed, askCan()), blocked = plan?.kind === "blocked";
  $("#askGhost span").textContent = typed;
  $("#askGhost b").textContent = g ? g.text.slice(typed.length) : "";
  const say = barSending ? askSayWant : blocked ? plan.say : g ? `Suggestion: ${g.text}${g.count > 1 ? `, ${g.at + 1} of ${g.count}` : ""}` : "";
  if (say !== askSayWant) { askSayWant = say; sayAsk(say, blocked ? 0 : 400); }
  $("#askGhost").scrollLeft = askInput.scrollLeft;
  askTab.dataset.on = String(!!g);
  askTab.title = g ? `Accept “${g.text}”${g.count > 1 ? ` (${g.at + 1} of ${g.count}; Up and Down switch)` : ""}` : "";
  askSend.disabled = !!barSending || !plan || blocked;
  if (blocked) askInput.setAttribute("aria-invalid", "true");
  else askInput.removeAttribute("aria-invalid");
}
// The address field: no ghost or Tab key; Enter (or Send) links once a full address is typed.
function renderLinkField() {
  $("#askGhost span").textContent = "";
  $("#askGhost b").textContent = "";
  askTab.dataset.on = "false";
  askTab.title = "";
  askSend.disabled = !typedLink();
  askInput.removeAttribute("aria-invalid");
  if (barSel) linkBtnState(barSel);
  paintLinkPreview();
}
function acceptGhost() {
  const g = askGhostNow();
  if (!g) return;
  askInput.value = g.text;
  askInput.setSelectionRange(g.text.length, g.text.length);
  askInput.scrollLeft = askInput.scrollWidth;
  askPick = 0;
  askInput.focus({ preventScroll: true });
  renderAsk();
  sayAsk(`Accepted: ${g.text}`);
}
askInput.addEventListener("input", () => { askPick = 0; renderAsk(); });
for (const type of ["keyup", "click", "select", "scroll"]) askInput.addEventListener(type, renderAsk);
askInput.addEventListener("compositionend", renderAsk);
askTab.addEventListener("click", acceptGhost);
askInput.addEventListener("keydown", (e) => {
  // Enter that ends a composition (some browsers send it after the composition): never a send.
  if (e.isComposing || e.keyCode === 229) { if (e.key === "Enter") e.preventDefault(); return; }
  if (e.key === "Escape") {
    // The address field: back to asking, the bar stays.
    if (linkMode) { e.preventDefault(); e.stopPropagation(); leaveLinkMode(); return; }
    // The menu that "more" opens closes alone and keeps what is typed.
    if (closeBarMenu() || escapeBoldPop()) { e.preventDefault(); e.stopPropagation(); return; }
    hideBar();
    return;
  }
  const g = askGhostNow();
  if (!g) return;
  if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); acceptGhost(); }
  else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && g.count > 1) { e.preventDefault(); askPick = g.at + (e.key === "ArrowDown" ? 1 : -1); renderAsk(); }
});
$("#askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (barSending) return;
  if (linkMode) return applyLink();
  const plan = resolveTyped(askInput.value, askCan());
  if (!plan || plan.kind === "blocked") return;
  if (plan.kind === "more") return void moreMenu.showPopover();
  if (plan.kind === "add") return addBrollHere();
  if (plan.kind === "act") return void makeAsk(plan.action);
  makeAsk("ask", plan.text);
  // Kept only when it went: the words may have gone since.
  if (barSending) store.set(ASK_HISTORY, rememberAsk(store.get(ASK_HISTORY), plan.text));
});
// The ask is made at once and shows on its words; for this moment the input says so too, then the bar goes.
const SENDING_MS = 700;
function showSending() {
  closeBarMenus();
  barSel = null;
  paintBarSel();
  askInput.value = "";
  askInput.readOnly = true;
  askInput.setAttribute("aria-busy", "true");
  askField.dataset.state = "sending";
  $("#boldBtn").disabled = linkBtn.disabled = true;
  clearTimeout(askSayTimer);
  $("#askLive").textContent = "Sending";
  barSending = setTimeout(hideBar, SENDING_MS);
  renderAsk();
}

/* What the old More button held: the typed command "more" opens it. It never takes the text selection (barSel keeps it),
   opens below the input or above it, whichever fits, and works with the keyboard: the arrow keys move, Escape and Tab
   go back to the input. */
function closeBarMenus() { if (moreMenu.matches(":popover-open")) moreMenu.hidePopover(); closeBoldPop(); }
// Escape: close the menu and give the input the focus. Returns false when it was not open.
function closeBarMenu() {
  if (!moreMenu.matches(":popover-open")) return false;
  moreMenu.hidePopover();
  askInput.focus();
  return true;
}
function placeBarMenu() {
  const r = $("#askForm").getBoundingClientRect(), w = moreMenu.offsetWidth, h = moreMenu.offsetHeight;
  const below = innerHeight - r.bottom - 8, above = r.top - 8;
  const up = h + 6 > below && above > below;
  moreMenu.style.top = `${Math.max(8, up ? r.top - h - 6 : r.bottom + 6)}px`;
  moreMenu.style.left = `${Math.max(8, Math.min(r.left, document.documentElement.clientWidth - w - 8))}px`;
}
const menuItems = () => $$(".menu-action:not(:disabled):not([hidden])", moreMenu);
moreMenu.addEventListener("toggle", (e) => {
  if (e.newState !== "open") return;
  placeBarMenu();
  menuItems()[0]?.focus();
});
moreMenu.addEventListener("keydown", (e) => {
  const items = menuItems(), i = items.indexOf(document.activeElement);
  let to = null;
  if (e.key === "ArrowDown") to = items[(i + 1) % items.length];
  else if (e.key === "ArrowUp") to = items[(i - 1 + items.length) % items.length];
  else if (e.key === "Home") to = items[0];
  else if (e.key === "End") to = items.at(-1);
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeBarMenu(); return; }
  else if (e.key === "Tab") { e.preventDefault(); closeBarMenu(); return; }
  else return;
  e.preventDefault();
  to?.focus();
});

/* The bold colours by B (Lex 2026-11-07, Variant A): hovering B, or keyboard focus on it, opens them; a tap on B bolds and
   opens them too, until a tap elsewhere. Clicking B still only bolds. They close when the pointer leaves B and them, on
   Escape, or when the focus leaves them. Never on the selected words (popSpot); in the top layer, so the bar keeps its size. */
function placeBoldPop() {
  boldPop.style.setProperty("--pop-room", `${document.documentElement.clientWidth - 16}px`);
  const r = bar.getBoundingClientRect(), b = boldBtn.getBoundingClientRect();
  // What is seen: below the top bar (and a pan), down to the end of the visual viewport. A short window or large text: the
  // colours are no taller than that; they scroll inside themselves.
  const v = window.visualViewport, top = seenFrom($(".top").getBoundingClientRect().bottom, v?.offsetTop), vh = v ? v.height + v.offsetTop : innerHeight;
  boldPop.style.setProperty("--pop-room-y", `${vh - top - 16}px`);
  const rects = barSel?.range ? [...barSel.range.getClientRects()].filter((x) => x.width > 0) : [];
  const words = rects.length ? { top: Math.min(...rects.map((x) => x.top)), bottom: Math.max(...rects.map((x) => x.bottom)), left: Math.min(...rects.map((x) => x.left)), right: Math.max(...rects.map((x) => x.right)) } : { top: 0, bottom: 0, left: 0, right: 0 };
  const { x, y, side } = popSpot({ bar: r, x: b.left, words, w: boldPop.offsetWidth, h: boldPop.offsetHeight, top, vw: document.documentElement.clientWidth, vh });
  boldPop.style.left = `${x}px`;
  boldPop.style.top = `${y}px`;
  boldPop.dataset.side = side;
}
// byHover: opened by the pointer resting on B; then, while they sit away from B, the pointer crossing the bar keeps them.
function openBoldPop(stick = false, byHover = false) {
  clearTimeout(popOpenTimer);
  clearTimeout(popCloseTimer);
  if (bar.hidden || boldBtn.hidden || barSending) return;
  if (stick) popStuck = true;
  if (!boldPop.matches(":popover-open")) { renderBoldPop(); boldPop.showPopover(); popByHover = byHover; }
  boldBtn.setAttribute("aria-expanded", "true");
  placeBoldPop();
}
function closeBoldPop() {
  clearTimeout(popOpenTimer);
  clearTimeout(popCloseTimer);
  popStuck = false;
  if (boldPop.matches(":popover-open")) boldPop.hidePopover();
  boldBtn.setAttribute("aria-expanded", "false");
}
// Escape: the colours close and the focus, if it was in them, goes back to B. Returns false when they were not open.
function escapeBoldPop() {
  if (!boldPop.matches(":popover-open")) return false;
  const inside = boldPop.contains(document.activeElement);
  closeBoldPop();
  if (inside) { popQuietFocus = true; boldBtn.focus(); }
  return true;
}
// What keeps them open: the pointer over B or them, keyboard focus on B or in them, a colour field (its own picker may be
// open), or a tap. A swatch some browser focused on a mouse click doesn't count: the pointer leaving still closes them.
const popHeld = () => {
  const f = document.activeElement, inside = boldPop.contains(f) && (f.matches(":focus-visible") || f.type === "color");
  return popStuck || inside || boldBtn.matches(":hover") || boldPop.matches(":hover") || boldBtn.matches(":focus-visible") || (popByHover && popFar() && bar.matches(":hover"));
};
// Beside the bar, or at the top or bottom of the window: the way there crosses the bar or the page, so it takes longer.
const popFar = () => !["below", "above"].includes(boldPop.dataset.side);
function closeBoldPopSoon() {
  clearTimeout(popOpenTimer);
  clearTimeout(popCloseTimer);
  popCloseTimer = setTimeout(() => { if (!popHeld()) closeBoldPop(); }, popFar() ? 700 : 220);
}
boldBtn.addEventListener("pointerenter", (e) => {
  if (e.pointerType !== "mouse") return;
  clearTimeout(popCloseTimer);
  clearTimeout(popOpenTimer);
  popOpenTimer = setTimeout(() => openBoldPop(false, true), 120);
});
boldBtn.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") closeBoldPopSoon(); });
boldPop.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") clearTimeout(popCloseTimer); });
boldPop.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") closeBoldPopSoon(); });
// The pointer leaving the bar after resting on it (they may have been held by the bar then); the colours are inside it.
bar.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && boldPop.matches(":popover-open")) closeBoldPopSoon(); });
boldBtn.addEventListener("pointerdown", (e) => { popTouch = e.pointerType !== "mouse"; });
// After the bold: a tap opens the colours as well (no hover on a phone); keys and the mouse already have them.
boldBtn.addEventListener("click", () => { if (popTouch) openBoldPop(true); popTouch = false; });
boldBtn.addEventListener("focus", () => {
  if (popQuietFocus) { popQuietFocus = false; return; }
  if (boldBtn.matches(":focus-visible")) openBoldPop();
});
for (const el of [boldBtn, boldPop]) el.addEventListener("focusout", (e) => {
  if (e.relatedTarget && (boldPop.contains(e.relatedTarget) || e.relatedTarget === boldBtn)) return;
  closeBoldPopSoon();
});
// A colour field's picker closed: the pointer may have left meanwhile. A mouse pick leaves the focus on the field, which
// would keep the colours open (popHeld), so it goes, unless the keyboard is there (:focus-visible).
for (const id of ["#boldFg", "#boldBg"]) $(id).addEventListener("change", (e) => {
  if (!e.target.matches(":focus-visible")) e.target.blur();
  closeBoldPopSoon();
});
// A press anywhere else closes them.
document.addEventListener("pointerdown", (e) => {
  if (boldPop.matches(":popover-open") && !boldPop.contains(e.target) && !boldBtn.contains(e.target)) closeBoldPop();
}, { capture: true });
let selTimer = 0;
// Started anywhere but in the bar: a drag can start in the page's margin and run into the text.
document.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" && e.button === 0 && !bar.contains(e.target)) { scriptPress = true; pressMoved = false; } }, { capture: true });
function scriptReleased() {
  if (!scriptPress) return;
  scriptPress = false;
  // A press that moved no selection (a toolbar button, say) has nothing to do with the bar.
  if (!pressMoved) return;
  clearTimeout(selTimer);
  selTimer = setTimeout(showBar, 120);
}
for (const t of ["pointerup", "pointercancel"]) addEventListener(t, scriptReleased, { capture: true });
// The window losing the focus only, so without capture: a press often moves the focus between the page's blocks.
addEventListener("blur", scriptReleased);
// A release outside the window can go unseen: the first move with no button held ends the press too.
addEventListener("pointermove", (e) => { if (!e.buttons) scriptReleased(); }, { passive: true, capture: true });
document.addEventListener("selectionchange", () => { if (scriptPress) pressMoved = true; refreshLinks(true); clearTimeout(selTimer); selTimer = setTimeout(showBar, 120); together?.caret(); });
// What floats over the text follows it: on a scroll, and when the Keep all row moves the text without one (step Q).
function placeBarAgain() { if (!bar.hidden && barSel?.range) { placeBar(barSel.range); if (moreMenu.matches(":popover-open")) placeBarMenu(); if (boldPop.matches(":popover-open")) placeBoldPop(); } }
function placeOverText() { placeBarAgain(); if (!card.hidden && cardFor) positionCard(cardFor); brollApi?.positionCard(); }
addEventListener("scroll", placeOverText, { passive: true });
addEventListener("resize", () => { placeBarAgain(); brollApi?.positionCard(); });
// The on-screen keyboard: the bar stays above it.
window.visualViewport?.addEventListener("resize", placeBarAgain);
window.visualViewport?.addEventListener("scroll", placeBarAgain);
bar.addEventListener("pointerdown", (e) => { if (!e.target.closest("input")) e.preventDefault(); });
bar.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) makeAsk(b.dataset.act); });
function makeAsk(action, typed = "") {
  const s = barSel;
  if (!s || !state.doc) return;
  const b = byId(s.id);
  if (!b) return hideBar();
  const content = D.contentOf(b);
  // Always searched: the same text at the old offset can be another copy, moved there by a mark before it.
  const r = findWords(content, s.quote, s.plainAt ?? s.start);
  if (!r) return hideBar();
  const { start, end } = r;
  if (bar.hidden) hideBar();
  else showSending();
  getSelection().removeAllRanges();
  // A guest's ask goes to the host, which adds it for everyone and hands it to its agent.
  if (state.guest) {
    clearAskNote(s.id);
    return void together.ask({ blockId: s.id, start, end, quote: content.slice(start, end), action, instruction: typed });
  }
  return addAsk({ blockId: s.id, start, end, action, typed, by: me });
}
// A new ask on the agent's marked change: the text is being worked on again, so its mark (and Undo) goes.
function unmarkOver(blockId, start, end) {
  for (const a of state.asks) if (C.isMarked(a) && a.blockId === blockId && a.start < end && a.end > start) delete a.change;
}
// onlyBy: a guest's ask closes only that guest's own overlapping asks; the host's closes any ("the newest ask wins").
function addAsk({ blockId, start, end, action, typed = "", by, onlyBy = null }) {
  for (const a of overlappingAsks(state.asks, { blockId, start, end }, onlyBy)) closeAsk(a, a.status === "answered" ? "undone" : "cancelled");
  unmarkOver(blockId, start, end);
  const ask = D.makeAsk(state.doc, { blockId, start, end, action, instruction: action === "ask" ? typed : undefined, by });
  state.asks.push(ask);
  emit("created", ask);
  renderBlock(blockId, getCaret());
  changed();
  offerAsks();
  return ask;
}

/* ---------- Answers ---------- */
function validBy(by) {
  return by && typeof by === "object" && typeof by.id === "string" ? { id: by.id.slice(0, 80), name: String(by.name ?? "").slice(0, 80) } : null;
}
export function receiveAnswer(askId, answer) {
  const ask = state.asks.find((a) => a.id === askId);
  if (!ask || !state.doc || ask.scope === "broll" || (ask.status !== "waiting" && ask.status !== "taken")) return false;
  const clean = D.cleanAnswer(ask, answer);
  if (!clean) return false;
  if (ask.scope === "selection") {
    const b = byId(ask.blockId);
    const r = b && D.reanchor(ask, D.contentOf(b));
    if (!r) { closeAsk(ask, "cancelled"); if (b) renderBlock(b.id); changed(); return false; }
    ask.start = r.start; ask.end = r.end;
    ask.answer = clean;
    ask.answeredBy = validBy(answer.by);
    ask.status = "answered";
    // A new text or an addition goes straight in (step F); a note shows beside its text.
    if (C.goesStraightIn(ask, clean)) { emit("answered", ask); return landAnswer(ask); }
    renderBlock(ask.blockId, getCaret());
  } else if (clean.kind === "links") {
    // The whole script's links (step G): nothing changes when none can go in, and the ask waits for another answer.
    return landScriptLinks(ask, clean, validBy(answer.by));
  } else {
    clean.marks = clean.marks.map((m) => ({ ...m, ...(D.findQuote(state.doc, m.quote) || {}), state: "open" })).filter((m) => m.blockId);
    ask.answer = clean;
    ask.answeredBy = validBy(answer.by);
    ask.status = "answered";
    const caret = getCaret();
    for (const id of new Set(clean.marks.map((m) => m.blockId))) renderBlock(id, caret);
    emit("answered", ask);
    settleVoice(ask);
  }
  if (ask.scope === "selection") emit("answered", ask);
  renderVoice();
  changed();
  return true;
}
export function takeAsk(askId, by) {
  const ask = state.asks.find((a) => a.id === askId);
  if (!ask || ask.status !== "waiting") return false;
  ask.status = "taken";
  ask.takenAt = new Date().toISOString();
  if (by) ask.takenBy = validBy(by);
  emit("taken", ask);
  if (ask.scope === "selection") renderBlock(ask.blockId, getCaret());
  if (ask.scope === "broll") renderBroll();
  renderVoice();
  renderAgent();
  changed();
  return true;
}
export function requestVoiceCheck() {
  if (!state.doc || state.pendingDraft) return null;
  for (const a of state.asks) if (a.scope === "script" && a.action === "voice" && isOpen(a)) closeAsk(a, "cancelled");
  const ask = D.makeAsk(state.doc, { scope: "script", action: "voice", by: me });
  state.asks.push(ask);
  emit("created", ask);
  renderAll(getCaret());
  changed();
  offerAsks();
  return ask;
}

// "Find links" on the whole script (the host's, like the other whole-script jobs): its links go straight in.
export function requestLinks() {
  if (!state.doc || state.pendingDraft || state.guest) return null;
  for (const a of state.asks) if (a.scope === "script" && a.action === "links" && isOpen(a)) closeAsk(a, "cancelled");
  const ask = D.makeAsk(state.doc, { scope: "script", action: "links", by: me });
  state.asks.push(ask);
  emit("created", ask);
  renderAgent();
  changed();
  offerAsks();
  return ask;
}

function keepAnswer(askId) {
  const ask = state.asks.find((a) => a.id === askId);
  if (!ask || ask.status !== "answered") return;
  const b = byId(ask.blockId);
  const r = b && D.reanchor(ask, D.contentOf(b));
  if (!r) { closeAsk(ask, "cancelled"); if (b) renderBlock(b.id); changed(); return; }
  ask.start = r.start; ask.end = r.end;
  checkpoint("keep", b.id);
  const res = D.applyAnswer(D.contentOf(b), ask);
  const delta = res.content.length - D.contentOf(b).length;
  closeAsk(ask, "kept");
  moveAsks(b.id, b.id, ask.end, delta);
  const r2 = D.setContent(state.doc, b.id, res.content);
  followPieces(b.id, r2);
  if (r2.changed || r2.created.length) renderAll();
  else { renderBlock(b.id); glow(b.id, res.start, res.end); }
  changed();
}
function glow(id, start, end) {
  const el = blockNode(id);
  if (!el || end <= start) return;
  try {
    const r = rangeAt(el, start, end);
    const s = h("span", "landed", { "data-deco": "" });
    s.append(r.extractContents());
    r.insertNode(s);
    setTimeout(() => {
      if (!s.isConnected) return;
      const caret = document.activeElement === el ? getCaret() : null;
      s.replaceWith(...s.childNodes);
      el.normalize();
      if (caret?.id === id) setCaretAt(el, caret.offset);
    }, 1500);
  } catch { /* the glow is only decoration */ }
}
/* The agent's replace or add goes straight into the text (step F): one change (one Ctrl/Cmd+Z step when alone),
   the agent's in a shared script, lightly marked while untouched, with Undo on the agent's name tag. */
// Returns whether it went in (when not, the ask is cancelled).
function landAnswer(ask) {
  const b = byId(ask.blockId);
  if (!b) return false;
  together?.local(); // the host's own typing goes out first, under the host's name
  const before = D.cloneDoc(state.doc);
  const res = C.land(state.doc, ask, Date.now(), { asks: state.asks });
  if (!res) { closeAsk(ask, "cancelled"); renderBlock(b.id, getCaret()); changed(); return false; }
  if (res.cuesDropped) cueDrops.set(ask.id, res.cuesDropped);
  // One Ctrl/Cmd+Z step, taken only now the change happened; undoing it makes the ask undone again (restore).
  checkpoint("agent", b.id, before);
  if (!together?.active) state.undo.at(-1).land = { id: ask.id, status: "undone" };
  arrived.set(ask.id, Date.now());
  closeAsk(ask, "kept");
  moveAsks(b.id, b.id, res.at, res.delta);
  followPieces(b.id, res.result);
  followMarks(); // the agent's earlier changes follow this one
  C.setMark(ask, res.mark);
  markBase();
  together?.localAs("agent");
  if (res.result.changed || res.result.created.length) renderAll(getCaret());
  else renderBlock(b.id, getCaret());
  changed();
  return true;
}
// The whole script's links: one change (one Ctrl/Cmd+Z step when alone, the agent's in a shared script), with a marked
// change and Undo per paragraph (C.landScript).
function landScriptLinks(ask, clean, by) {
  together?.local();
  const before = D.cloneDoc(state.doc);
  const res = C.landScript(state.doc, { ...ask, answer: clean }, Date.now(), { asks: state.asks });
  if (!res) return false;
  ask.answer = { ...clean, links: res.parts.flatMap((p) => p.ask.answer.links) };
  ask.answeredBy = by;
  checkpoint("agent", res.parts[0].blockId, before);
  if (!together?.active) state.undo.at(-1).land = { id: ask.id, status: "undone", also: res.parts.map((p) => p.ask.id) };
  emit("answered", ask);
  closeAsk(ask, "kept");
  const now = Date.now();
  for (const p of res.parts) {
    moveAsks(p.blockId, p.blockId, p.at, p.delta);
    followPieces(p.blockId, p.result);
  }
  followMarks(); // the agent's earlier changes follow these
  for (const p of res.parts) {
    if (by) p.ask.answeredBy = by;
    arrived.set(p.ask.id, now);
    state.asks.push(p.ask);
    emit("kept", p.ask);
  }
  markBase();
  together?.localAs("agent");
  renderAll(getCaret());
  renderAgent();
  changed();
  return true;
}
// Undo on the agent's name tag: its marked change goes back to what was there; its caret moves to the newest
// change still marked, or leaves.
function undoChange(ask) {
  const b = byId(ask.blockId);
  if (!b || !C.isMarked(ask)) return;
  together?.local();
  const before = D.cloneDoc(state.doc);
  const res = C.undo(state.doc, ask);
  if (!res) { renderBlock(b.id, getCaret()); changed(); return; }
  checkpoint("agent-undo", b.id, before);
  if (!together?.active) state.undo.at(-1).land = { id: ask.id, status: "kept" };
  emit("undone", ask);
  moveAsks(b.id, b.id, res.at, res.delta);
  reanchorBlock(b.id);
  followMarks();
  together?.localAs("agent");
  renderBlock(b.id, getCaret());
  changed();
}
function undoAgent(askId) {
  const ask = state.asks.find((a) => a.id === askId);
  if (!ask || !shownMarked(ask) || !may(ask)) return;
  if (state.guest) return void together.act(ask.id, "undo"); // the host undoes it, for everyone
  undoChange(ask);
}
function undoAnswer(askId) {
  const ask = state.asks.find((a) => a.id === askId);
  if (!ask) return;
  if (C.isMarked(ask)) return undoChange(ask);
  if (!isOpen(ask)) return;
  closeAsk(ask, ask.status === "answered" ? "undone" : "cancelled");
  renderBlock(ask.blockId, getCaret());
  changed();
}
scriptEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".change__bar button, .note__x, .ask-chip__x");
  if (!btn || btn.closest(".shot-frame")) return;
  e.preventDefault();
  const id = btn.closest("[data-ask]")?.dataset.ask;
  const act = btn.classList.contains("keep") ? "keep" : btn.classList.contains("note__x") ? "dismiss" : "undo";
  if (state.guest) return together.act(id, act); // the host keeps or undoes it, for everyone
  doAsk(id, act);
});
function doAsk(id, act) {
  if (act === "keep") return keepAnswer(id);
  if (act === "undo") return undoAnswer(id);
  const ask = state.asks.find((a) => a.id === id);
  if (ask && isOpen(ask)) { closeAsk(ask, "kept"); renderBlock(ask.blockId, getCaret()); changed(); }
}
// Keep the caret where it is when pressing a chip or bar button.
scriptEl.addEventListener("pointerdown", (e) => { if (e.target.closest(".change__bar button, .note__x, .ask-chip__x")) e.preventDefault(); });

/* ---------- "Sounds like me" marks and voice card ---------- */
function settleVoice(ask) {
  if (ask.scope === "script" && ask.status === "answered" && !ask.answer.marks.some((m) => m.state === "open")) closeAsk(ask, "kept");
}
function renderVoice() {
  const open = state.asks.filter((a) => a.scope === "script" && a.status === "answered").flatMap((a) => a.answer.marks.filter((m) => m.state === "open"));
  const waiting = state.asks.some((a) => a.scope === "script" && a.action === "voice" && (a.status === "waiting" || a.status === "taken"));
  const btn = $("#voiceBtn");
  btn.dataset.state = waiting ? "waiting" : "";
  btn.disabled = !(state.doc && !state.pendingDraft && agent.state === "on");
  $("#voiceCount").hidden = !open.length;
  $("#voiceCount").textContent = open.length;
  btn.title = open.length ? `${open.length} ${open.length === 1 ? "line" : "lines"} to check` : "";
  renderTocDots();
}
const card = $("#voiceCard");
let cardFor = null, cardTimer = 0;
function markOf(el) {
  const ask = state.asks.find((a) => a.id === el.dataset.ask);
  return ask?.answer?.marks?.[Number(el.dataset.mark)] ? { ask, mark: ask.answer.marks[Number(el.dataset.mark)] } : null;
}
function positionCard(m) {
  const r = m.getClientRects()[0] || m.getBoundingClientRect();
  if (matchMedia("(max-width: 40rem)").matches) return;
  const w = card.offsetWidth, ht = card.offsetHeight;
  const x = Math.max(8, Math.min(r.left, document.documentElement.clientWidth - w - 8));
  let y = r.bottom + 8;
  if (y + ht > innerHeight - 8) y = r.top - ht - 8;
  card.style.setProperty("--card-x", x + "px");
  card.style.setProperty("--card-y", y + "px");
}
// A rewrite that can't stay in its line's type (step F) is not offered: "Use this" would change nothing.
function rewriteFits(mark) {
  const b = byId(mark.blockId);
  const r = b && D.reanchor(mark, D.contentOf(b));
  if (!r) return false;
  const probe = D.makeAsk(state.doc, { blockId: b.id, start: r.start, end: r.end, action: "voice", by: me });
  return C.fits(state.doc, probe, { kind: "replace", text: mark.rewrite });
}
function openCard(m) {
  const found = markOf(m);
  if (!found) return;
  clearTimeout(cardTimer);
  if (cardFor && cardFor !== m) delete cardFor.dataset.open;
  cardFor = m;
  m.dataset.open = "";
  $("#vcWhy").innerHTML = icon("wave") + "<span></span>";
  $("#vcWhy span").textContent = found.mark.why || D.ACTIONS.voice.name;
  $("#vcTry").textContent = found.mark.rewrite;
  $("#vcUse").hidden = !found.mark.rewrite || !rewriteFits(found.mark);
  $("#vcKeep").parentElement.hidden = state.guest; // the host's "Sounds like me" check: only the host acts on it
  card.hidden = false;
  positionCard(m);
}
function closeCard() { card.hidden = true; if (cardFor) delete cardFor.dataset.open; cardFor = null; }
const closeLater = () => { clearTimeout(cardTimer); cardTimer = setTimeout(closeCard, 260); };
scriptEl.addEventListener("mouseover", (e) => { const m = e.target.closest(".voice"); if (m && fine.matches) { clearTimeout(cardTimer); cardTimer = setTimeout(() => openCard(m), 140); } });
scriptEl.addEventListener("mouseout", (e) => { if (e.target.closest(".voice") && !e.relatedTarget?.closest?.(".voice")) closeLater(); });
scriptEl.addEventListener("focusin", (e) => { const m = e.target.closest(".voice"); if (m) openCard(m); });
scriptEl.addEventListener("click", (e) => { const m = e.target.closest(".voice"); if (m && getSelection().isCollapsed) openCard(m); });
card.addEventListener("mouseenter", () => clearTimeout(cardTimer));
card.addEventListener("mouseleave", closeLater);
document.addEventListener("pointerdown", (e) => { if (!card.hidden && !card.contains(e.target) && !e.target.closest(".voice")) closeCard(); });
$("#vcKeep").addEventListener("click", () => {
  const found = cardFor && markOf(cardFor);
  closeCard();
  if (!found) return;
  found.mark.state = "kept";
  settleVoice(found.ask);
  renderBlock(found.mark.blockId, getCaret());
  renderVoice();
  changed();
});
$("#vcUse").addEventListener("click", () => {
  const found = cardFor && markOf(cardFor);
  closeCard();
  if (!found) return;
  const { ask: voice, mark } = found;
  const b = byId(mark.blockId);
  const r = b && D.reanchor(mark, D.contentOf(b));
  if (r && !rewriteFits(mark)) return;
  mark.state = "used";
  settleVoice(voice);
  if (r) {
    for (const a of state.asks) if (a.scope === "selection" && a.blockId === b.id && isOpen(a) && !isBrollAnswer(a) && a.start < r.end && a.end > r.start) closeAsk(a, a.status === "answered" ? "undone" : "cancelled");
    const ask = D.makeAsk(state.doc, { blockId: b.id, start: r.start, end: r.end, action: "voice", by: me });
    ask.status = "answered";
    ask.answer = { kind: "replace", text: mark.rewrite };
    ask.answeredBy = voice.answeredBy ?? null;
    unmarkOver(b.id, r.start, r.end);
    state.asks.push(ask);
    emit("answered", ask);
    landAnswer(ask); // the person picked the rewrite: it goes straight in, with Undo on the agent's name tag
    cueDrops.delete(ask.id); // no answer_ask waits to hear about dropped cues
  }
  if (b) renderBlock(b.id, getCaret());
  renderVoice();
  changed();
});

/* ---------- Files ---------- */
const canPick = "showOpenFilePicker" in window;
// Scripts saved in the browser (step J): its own private file system, where the browser can write to it.
const browserSaving = !!navigator.storage?.getDirectory && typeof FileSystemFileHandle === "function" && "createWritable" in FileSystemFileHandle.prototype;
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("script-editor", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("handles");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) {
  try {
    const db = await idb();
    return await new Promise((res) => { const q = db.transaction("handles").objectStore("handles").get(k); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); });
  } catch { return null; }
}
// Like idbSet, but a failed write is an error (a B-roll list kept in the browser must not vanish silently).
async function idbPut(k, v) {
  const db = await idb();
  await new Promise((res, rej) => {
    const t = db.transaction("handles", "readwrite");
    t.objectStore("handles").put(v, k);
    t.oncomplete = res;
    t.onerror = t.onabort = () => rej(t.error || new Error("IndexedDB write failed"));
  });
}
// The names that still have a B-roll link stored (a cleared link is stored as null and doesn't count; the demo's
// unlinked { none: true } does).
async function idbLinkedNames() {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const out = [];
      const q = db.transaction("handles").objectStore("handles").openCursor();
      q.onsuccess = () => {
        const c = q.result;
        if (!c) return res(out);
        // A B-roll link, or a B-roll list kept in the browser (step K).
        if (typeof c.key === "string" && c.value != null) {
          if (c.key.startsWith("broll:")) out.push(c.key.slice(6));
          else if (c.key.startsWith("brollList:")) out.push(c.key.slice(10));
        }
        c.continue();
      };
      q.onerror = () => res(out);
    });
  } catch { return []; }
}
async function idbSet(k, v) {
  try {
    const db = await idb();
    await new Promise((res) => { const t = db.transaction("handles", "readwrite"); t.objectStore("handles").put(v, k); t.oncomplete = res; t.onerror = res; });
  } catch { /* storage off: reopen is not offered */ }
}

function persistDraft() {
  clearTimeout(draftTimer);
  if (!state.doc || state.pendingDraft || state.guest) return;
  // Open asks, and the agent's changes still marked, each with its exact place (so their mark and Undo come back
  // after a reload only there).
  // Waiting pictures (step K) stay out: local storage is small. After a reload a sketch ask's shot waits for its
  // sketch again; a suggested add shows without its picture.
  const open = C.withContext(state.asks.filter((a) => isOpen(a) || C.isMarked(a)), state.doc).map(D.withoutPictures);
  const dirty = isDirty();
  const flags = brollFlags();
  if (!dirty && !open.length && !flags) { saving.drafts.del(state.name); return; }
  saving.drafts.set(state.name, { text: dirty ? saveText() : null, at: Date.now(), asks: open, ...(flags ? { broll: flags } : {}) });
}

function loadText(text, { name, handle = null, modified = 0, fresh = false, browser = false }) {
  // Leaving a script: write what is still waiting to its own file, and keep a draft as a safety net.
  if (state.doc) { persistDraft(); saving.flush(); }
  // A new script left as it came is not kept: empty ones would pile up in the browser.
  if (state.doc && state.inBrowser && state.blank && handle !== state.handle && D.serialize(state.doc) === state.blank && !state.asks.length) {
    deleteBrowserScript({ handle: state.handle, name: state.name });
  }
  // Sharing ends when another script opens; the same file read again from disk stays shared.
  if (together?.sharing && !(handle && handle === state.handle)) together.stop();
  $("#emptyNote").hidden = true;
  hideBar();
  closeCard();
  closeBroll();
  state.doc = D.parse(text);
  saving.open({ handle, name, browser, savedText: fresh ? D.serialize(state.doc) : text, modified, fresh });
  state.undo = [];
  state.redo = [];
  state.lastStep = null;
  state.asks = [];
  changeBase = null;
  passedHere.clear();
  seenMarks.clear();
  state.pendingDraft = null;
  state.frontOpen = false;
  state.hint = null;
  const draft = saving.drafts.get(name);
  setBrollFlags(draft?.broll);
  hideBanner();
  if (draft?.text != null && draft.text !== text && (draft.at || 0) > modified) {
    state.pendingDraft = draft;
    showBanner(`Unsaved changes from ${clock(draft.at)}`, [["Restore", restoreDraft], ["Discard", discardDraft]]);
  } else {
    adoptAsks(draft?.asks);
  }
  renderTop();
  renderAll();
  renderDerived();
  editorJump();
  scrollTo({ top: 0 });
  loadBroll();
  together?.local();
}
function adoptAsks(asks) {
  if (!Array.isArray(asks)) return;
  for (const a of asks) {
    // Its new text, only at its exact place in this script's block of the same place (ids are new); else no mark.
    if (C.isMarked(a)) { if (C.place(a, state.doc, { byIndex: true })) state.asks.push(a); continue; }
    if (!a?.id || !isOpen(a)) continue;
    brollApi?.cleanSketches(a); // a draft holds what storage gave it (the B-roll module cleans the rest when it loads)
    if (a.scope === "selection" && !byId(a.blockId)) {
      // Ids are new after a reload: find the quote again. B-roll suggestions stay even when it is gone.
      const hit = D.findQuote(state.doc, a.quote, null);
      if (hit) Object.assign(a, hit);
      else if (!isBrollAnswer(a)) continue;
    }
    if (a.scope === "script" && a.answer?.marks) {
      for (const m of a.answer.marks) {
        if (m.state !== "open") continue;
        const hit = D.findQuote(state.doc, m.quote, byId(m.blockId) ? m : null);
        if (hit) Object.assign(m, hit); else m.state = "gone";
      }
    }
    state.asks.push(a);
  }
  reanchorAll();
  for (const a of state.asks) if (a.scope === "script") settleVoice(a);
  C.endExpired(state.asks, Date.now()); // a mark whose 60 minutes are over comes back without its tint (step M)
  markBase();
}
function showBanner(text, actions) {
  replaced = null;
  askingToOpen = null;
  lineSeq++;
  const banner = $("#banner");
  banner.replaceChildren();
  const s = h("span");
  s.textContent = text;
  banner.append(s);
  for (const [label, fn] of actions) {
    const b = h("button", "", { type: "button" });
    b.textContent = label;
    b.addEventListener("click", fn);
    banner.append(b);
  }
  banner.hidden = false;
}
function hideBanner() { replaced = null; askingToOpen = null; $("#banner").hidden = true; $("#banner").replaceChildren(); }
function restoreDraft() {
  const draft = state.pendingDraft;
  if (!draft) return hideBanner();
  state.preCaret = null;
  checkpoint("restore", null);
  state.doc = D.parse(draft.text);
  state.pendingDraft = null;
  state.asks = [];
  adoptAsks(draft.asks);
  brollApi?.dropGone();
  brollIfAsks();
  hideBanner();
  brollApi?.rematch(true);
  renderAll();
  changed();
  offerAsks();
}
function discardDraft() {
  const draft = state.pendingDraft;
  state.pendingDraft = null;
  hideBanner();
  // The agent's marked changes come back only where the file itself has them, at their exact place (adoptAsks).
  if (draft?.asks) adoptAsks(draft.asks.filter((a) => a.scope === "script" || C.isMarked(a) || D.findQuote(state.doc, a.quote)));
  brollApi?.dropGone();
  brollIfAsks();
  saving.drafts.del(state.name);
  renderAll(getCaret());
  changed();
  offerAsks();
}

async function openFile() {
  if (!canPick) return $("#fileInput").click();
  let handle;
  try { [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, multiple: false }); }
  catch (e) { if (e?.name !== "AbortError") $("#fileInput").click(); return; }
  // Ask for write access while the person's pick still counts as a click, so auto-save can write.
  // If the browser refuses to ask now, "Allow saving to …" shows at the first save.
  permitted(handle, true);
  await openHandle(handle);
}
async function openHandle(handle) {
  try {
    // The switcher hands over a fresh handle object for a known file; reuse the one the save queue holds.
    for (const known of [state.handle, ...saving.queued()]) {
      if (known && known !== handle && (await sameFile(known, handle))) { handle = known; break; }
    }
    const file = await handle.getFile();
    const text = await file.text();
    const browser = await isInBrowser(handle);
    loadText(text, { name: handle.name, handle, modified: file.lastModified, browser });
    remember(handle, browser);
    return true;
  } catch {
    openProblem(handle.name);
    return false;
  }
}
// A file that could not be opened: one quiet line where the person is looking.
function openProblem(name) {
  const text = `Couldn't open ${name}`;
  // While the Restore/Discard choice is open, keep it: the script stays locked until the person chooses.
  if (state.doc && state.pendingDraft) return showBanner(`${text} · Unsaved changes are still waiting`, [["Restore", restoreDraft], ["Discard", discardDraft], ["Open a script", openFile]]);
  if (state.doc) return showBanner(text, [["Open a script", () => { hideBanner(); openFile(); }]]);
  emptyNote(text, [["Open a script", openFile]]);
}
// One quiet line on the start screen, with its buttons.
function emptyNote(text, actions) {
  askingToOpen = null;
  lineSeq++;
  const note = $("#emptyNote");
  note.replaceChildren();
  const s = h("span");
  s.textContent = text;
  note.append(s);
  for (const [label, fn] of actions) {
    const b = h("button", "", { type: "button" });
    b.textContent = label;
    b.addEventListener("click", fn);
    note.append(b);
  }
  note.hidden = false;
}
$("#fileInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try { loadText(await file.text(), { name: file.name, modified: file.lastModified }); }
  catch { openProblem(file.name); }
});

// Saving lives in saving.js (TOOLS-308): it gets the file system, local storage and the clock, and writes the save
// fields of `state`; what the person sees follows through `on`.
const saving = createSaving({
  script: state,
  editor: { ready: () => !!state.doc && !state.guest, doc: () => state.doc, text: () => saveText(), dirty: () => isDirty(), paused: () => slash.open },
  files: {
    write: (handle, text) => writeHandle(handle, text),
    file: (handle) => handle.getFile(),
    permitted: (handle, ask) => permitted(handle, ask),
    get pickSave() { return "showSaveFilePicker" in window ? (name) => window.showSaveFilePicker({ suggestedName: name, types: FILE_TYPES }) : null; },
    download: (text, name) => download(text, name, "text/markdown"),
  },
  // Scripts saved in the browser (step J), named after their title.
  browser: browserSaving ? { name: async (from, doc) => D.scriptFileName("", doc, await nameTaken(from)), create: (name, text) => createBrowserScript(name, text) } : null,
  drafts: store,
  clock: { now: () => Date.now(), later: (fn, ms) => setTimeout(fn, ms), cancel: (id) => clearTimeout(id) },
  on: {
    status: () => renderSaveState(),
    conflict: (at) => showBanner(`The file changed on disk at ${clock(at)}`, [["Save mine", () => { hideBanner(); saving.saveMine(); }], ["Open that version", () => reloadFromDisk()]]),
    async written(handle) {
      if ($("#banner").textContent.startsWith("The file changed")) hideBanner();
      await followTitle(handle);
    },
    done(moved) { renderTop(); if (moved) renderDerived(); persistDraft(); },
    renamed: (from, to, { clear }) => moveKeys(from, to, { clear, link: brollLink() }),
    placed(handle, { was = null, browser = false }) {
      remember(handle, browser);
      if (was) {
        const gone = was.name;
        forget(was).then(() => scriptsDir()).then((d) => d.removeEntry(gone)).catch(() => {});
      }
    },
  },
});
async function reloadFromDisk() {
  hideBanner();
  if (!state.handle) return;
  // Keep what is on screen as a draft, so "Restore" brings it back.
  if (isDirty()) saving.drafts.set(state.name, { text: saveText(), at: Date.now(), asks: state.asks.filter(isOpen), ...(brollFlags() ? { broll: brollFlags() } : {}) });
  await openHandle(state.handle);
}
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type: typeof text === "string" ? `${type};charset=utf-8` : type }));
  const a = h("a", "", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
// Export all and Save to video folder use the export pack (the zip maker and the folder writer, TOOLS-311). It loads
// when the Export menu first opens, so a click finds it here (a folder picker or download still runs in the click);
// a pack that can't load (or speaks another version) says so on both items until a reload.
const PACK_SEAM = 1;
let packLoading = null, packFailed = false;
function needPack() {
  packLoading ??= import("./export-pack.js").then((m) => {
    if (m.SEAM !== PACK_SEAM) throw new Error("The export pack speaks another version.");
    return m;
  }).catch((e) => { packFailed = true; renderFolderNote(); throw e; });
  return packLoading;
}
// beforetoggle, not toggle: a menu opened and closed at once still asks for it (toggle events are merged).
$("#exportMenu").addEventListener("beforetoggle", (e) => { if (e.newState === "open") needPack().catch(() => {}); });
function exportFile(kind) {
  if (!state.doc || state.guest) return;
  if (kind === "camera") download(D.exportCamera(state.doc), `${baseName()}-camera.txt`, "text/plain");
  else if (kind === "prompter") download(D.exportPrompter(state.doc), `${baseName()}-prompter.md`, "text/markdown");
  else if (kind === "prompter-open") openPrompter();
  else if (kind === "markdown") saving.saveAs();
  else if (kind === "all") exportAll();
  else if (kind === "folder") saveToFolder();
  else if ((kind === "broll" || kind === "storyboard") && brollStatus() === "ok") {
    const f = brollApi.exports()[kind === "broll" ? 0 : 1];
    download(f.text, f.name, kind === "broll" ? "text/markdown" : "text/html");
  }
}
// "Export all" (Lex, 2026-10-29): one zip with the script, the camera script, the prompter file and, with a B-roll
// list, the list and the storyboard.
// The files are read in the click: the zip holds the script that was on screen, even if another opens meanwhile.
async function exportAll() {
  const base = baseName();
  const files = [
    { name: /\.(md|markdown|txt)$/i.test(state.name) ? state.name : `${base}.md`, text: saveText() },
    { name: `${base}-camera.txt`, text: D.exportCamera(state.doc) },
    { name: `${base}-prompter.md`, text: D.exportPrompter(state.doc) },
  ];
  if (brollStatus() === "ok") files.push(...brollApi.exports());
  let pack;
  try { pack = await needPack(); } catch { return; } // the note on the item says it
  download(pack.zipAll(files), `${base}.zip`, "application/zip");
}

// "Save to video folder" (Lex, 2026-11-10, TOOLS-194): the video-folder names in a folder the person picks (a zip with the
// same names where the browser can't write to a folder). What happened shows on the menu item itself.
let folderSaved = null;
function renderFolderNote() {
  folderSaved = settleFolder(folderSaved, brollStatus()); // once the list is ready, a save it stopped is over
  const note = folderNote(packFailed ? { unloaded: true } : folderSaved?.for === state.name ? folderSaved : null, brollStatus());
  $("#folderNote").textContent = note;
  $("#folderNote").hidden = !note;
  $("#zipNote").textContent = packFailed ? folderNote({ unloaded: true }) : "";
  $("#zipNote").hidden = !packFailed;
  $("#folderLabel").textContent = "showDirectoryPicker" in window ? "Save to video folder" : "Save to video folder (.zip)";
}
async function saveToFolder() {
  if (folderSaved?.saving || packFailed) return; // one save at a time: a second click would race the first one's writes
  const list = listState(brollStatus());
  if (list === "wait") { folderSaved = { for: state.name, error: true, wait: brollStatus() }; return renderFolderNote(); }
  const prior = folderSaved, mine = (folderSaved = { for: state.name, saving: true });
  let dir = null;
  try {
    if ("showDirectoryPicker" in window) {
      renderFolderNote();
      dir = await window.showDirectoryPicker({ id: "video-folder", mode: "readwrite" });
    }
  } catch (e) {
    folderSaved = e?.name === "AbortError" ? prior : { for: mine.for, error: true }; // a cancel leaves the last note as it was
    return renderFolderNote();
  }
  // Read after the picker closes: it is the script on screen now that is saved (an open "/" command is not part of it).
  if (!state.doc) { folderSaved = prior; return renderFolderNote(); }
  const name = state.name, zipName = `${baseName()}-video-folder.zip`; // both read before any waiting: the script on screen may change meanwhile
  // A list that was still loading or blocked while the picker was open is not left out of the folder.
  if (listState(brollStatus()) === "wait") { folderSaved = { for: name, error: true, wait: brollStatus() }; return renderFolderNote(); }
  try {
    // Everything is read from the script before the pack is awaited: it is this script that is saved, whatever opens next.
    const doc = slash.open ? D.withoutCommand(state.doc, slash) : state.doc;
    const what = {
      dir, doc, scriptText: saveText(), title: D.titleOf(doc) || baseName(),
      // A linked list brings its shots in script order, its sketches and the B-roll helpers (the module is loaded then).
      broll: brollApi?.folder(doc) ?? { linked: false },
      // The prompter link carries the day the script was saved (its file's own day, else the day of this save).
      modified: state.fileModified, dirty: isDirty(),
    };
    const pack = await needPack().catch(() => null);
    if (!pack) { folderSaved = prior; return renderFolderNote(); } // the note says the pack can't load
    const { zip, ...result } = await pack.saveFolder(what);
    if (zip) download(zip, zipName, "application/zip");
    folderSaved = { for: name, ...result, ...(zip && { zip: true }) };
  } catch { folderSaved = { for: name, error: true }; }
  renderFolderNote();
}

async function openSample() {
  try {
    const res = await fetch(SAMPLE.url, { cache: "no-store" });
    if (!res.ok) throw new Error(res.statusText);
    loadText(await res.text(), { name: SAMPLE.name });
  } catch { openProblem("the demo script"); }
}
async function newScript() {
  // A new script still as it came is the new script: its title is selected again.
  if (state.doc && state.inBrowser && state.blank && D.serialize(state.doc) === state.blank) return selectTitle();
  const doc = { blocks: [], tail: "\n", eol: "\n" };
  const t = D.insertBlock(doc, null, "title", "Untitled script");
  t.sep = "";
  const hint = D.insertBlock(doc, t.id, "para", "").id;
  const text = D.serialize(doc);
  // Saved in the browser at once (step J); where it can't be, it waits for the first save as before.
  let made = null;
  if (browserSaving) {
    try { made = await createBrowserScript(D.scriptFileName("", doc, await nameTaken()), text); } catch { made = null; }
  }
  if (made) {
    loadText(text, { name: made.handle.name, handle: made.handle, modified: made.modified, browser: true });
    state.blank = text;
    remember(made.handle, true);
  } else loadText("", { name: "untitled-script.md", fresh: true });
  state.doc = doc;
  state.hint = hint;
  state.savedText = text;
  renderTop();
  renderAll();
  renderDerived();
  selectTitle();
}
function selectTitle() {
  const el = blockNode(state.doc.blocks.find((b) => b.type === "title")?.id);
  if (!el) return;
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
}

/* ---------- Buttons ---------- */
$("#emptyOpen").addEventListener("click", openFile);
$("#emptyNew").addEventListener("click", newScript);
$("#emptySample").addEventListener("click", openSample);
$("#allowSave").addEventListener("click", () => saving.allow());
$("#exportMenu").addEventListener("click", (e) => {
  const b = e.target.closest("[data-export]");
  if (!b) return;
  exportFile(b.dataset.export);
  $("#exportMenu").hidePopover();
});
$("#emptyReopen").addEventListener("click", async () => {
  if (!lastHandle) return;
  if (!(await permitted(lastHandle, true))) return openFile();
  if (!(await openHandle(lastHandle))) {
    // The file was moved or deleted: stop offering it.
    $("#emptyReopen").hidden = true;
    forget(lastHandle);
  }
});

/* ---------- Recent scripts: the switcher under the file name ---------- */
// Kept in IndexedDB with their file handles, newest first. Removing one only takes it off the list.
const RECENT_MAX = 20;
let lastHandle = null;
async function sameFile(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  try { return await a.isSameEntry(b); } catch { return false; }
}
async function recentScripts() {
  const stored = await idbGet("recent");
  const last = Array.isArray(stored) ? null : await idbGet("last"); // before the list, only the last file was kept
  const list = Array.isArray(stored) ? stored : last?.name ? [{ handle: last, name: last.name, at: 0 }] : [];
  // Scripts in the browser are kept by name (their handles are found again), and every one of them is listed,
  // also those that fell off the list: they have no other way back.
  const inside = new Map((await browserScripts()).map((b) => [b.name, b]));
  const out = [];
  for (const r of list) {
    if (r?.browser) { const b = inside.get(r.name); if (b) { out.push({ ...b, at: r.at || b.at }); inside.delete(r.name); } }
    else if (r?.handle?.name) out.push(r);
  }
  return [...out, ...[...inside.values()].sort((a, b) => b.at - a.at)];
}
async function without(list, handle) {
  const out = [];
  for (const r of list) if (!(await sameFile(r.handle, handle))) out.push(r);
  return out;
}
let recentQueue = Promise.resolve();
function updateRecent(change) {
  recentQueue = recentQueue.then(async () => {
    const list = await change(await recentScripts());
    await idbSet("recent", list.map((r) => (r.browser ? { name: r.name, at: r.at, browser: true } : r)));
    lastHandle = list[0]?.handle ?? null;
  }).catch(() => {});
  return recentQueue;
}
const remember = (handle, browser = false) => updateRecent(async (list) => [{ handle, name: handle.name, at: Date.now(), ...(browser ? { browser: true } : {}) }, ...(await without(list, handle))].slice(0, RECENT_MAX));
const forget = (handle) => updateRecent((list) => without(list, handle));

/* ---------- Scripts saved in the browser (step J, Lex 2026-10-29) ---------- */
// Every new script is saved in the browser's private file system at once ("always in the browser first"); its
// files are real handles, so saving, the changed-on-disk check, drafts and the switcher work as for files.
// Export → "Markdown file (.md)" moves one to a file on the computer.
let scriptsDirP = null;
function scriptsDir() {
  scriptsDirP ??= navigator.storage.getDirectory().then((root) => root.getDirectoryHandle("scripts", { create: true }));
  return scriptsDirP.catch((e) => { scriptsDirP = null; throw e; });
}
async function browserScripts() {
  if (!browserSaving) return [];
  const out = [];
  try {
    for await (const handle of (await scriptsDir()).values()) {
      if (handle.kind !== "file") continue;
      let at = 0;
      try { at = (await handle.getFile()).lastModified; } catch { /* listed without a time */ }
      out.push({ handle, name: handle.name, at, browser: true });
    }
  } catch { /* storage off: none */ }
  return out;
}
async function isInBrowser(handle) {
  if (!browserSaving || !handle) return false;
  try { return !!(await (await scriptsDir()).resolve(handle)); } catch { return false; }
}
// Names a new or renamed script may not take: recent files, scripts in the browser, kept drafts, names with a B-roll
// link or list kept (a file taken off the list keeps them) and the open script (all by name, in any capitals; drafts
// and B-roll keys go by name). `own`: the script being named.
async function nameTaken(own = "") {
  const names = new Set((await recentScripts()).map((r) => r.name.toLowerCase()));
  for (const n of await keyed(idbLinkedNames)) names.add(n.toLowerCase());
  names.add(SAMPLE.name.toLowerCase()); // the demo's name brings the demo's own B-roll list
  try {
    const lists = LS + "brollList:";
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(lists)) names.add(k.slice(lists.length).toLowerCase()); }
  } catch { /* storage off */ }
  const mine = own.toLowerCase();
  return (n) => {
    const l = n.toLowerCase();
    if (names.has(l)) return true;
    if (l === mine) return false;
    return saving.drafts.get(n) != null || (!!state.doc && l === state.name.toLowerCase());
  };
}
let keepAsked = false;
async function createBrowserScript(name, text) {
  const dir = await scriptsDir();
  // Never over another script: getFileHandle with create would open it.
  try { await dir.getFileHandle(name); throw new Error(`${name} is in the browser already.`); } catch (e) { if (e?.name !== "NotFoundError") throw e; }
  const handle = await dir.getFileHandle(name, { create: true });
  const modified = await writeHandle(handle, text);
  // Ask once that the browser keeps the site's storage rather than clearing it to make room.
  if (!keepAsked) { keepAsked = true; navigator.storage.persist?.().catch(() => {}); }
  return { handle, modified };
}
// A script's name goes with its draft, its B-roll link and a B-roll list kept in the browser (drafts and B-roll keys
// go by name, as for files on disk). `clear`: the old name goes away (a rename, a move to a file), so its B-roll keys
// are cleared; else a file on disk or the demo keeps its own. The new name's link and list are replaced: by the link
// as stored when the move runs in the queue, or `link` when none is stored (the demo links its list by itself).
async function moveKeys(from, to, { clear = false, link = null } = {}) {
  if (from === to) return;
  saving.drafts.move(from, to);
  // The new name belongs to this script now: it takes this script's link, or none (never one left there before).
  await keyed(async () => {
    const stored = await idbGet(brollKey(from));
    await idbSet(brollKey(to), stored ?? link);
    if (clear && stored != null) await idbSet(brollKey(from), null);
    // Its B-roll list kept in the browser goes along; the new name gets none when it has none.
    const kept = await readKept(from);
    // The old list goes only once the new name holds it (a full storage must not lose it).
    const moved = await idbPut(listKey(to), kept).then(() => true, () => false);
    if (clear && moved) { await idbSet(listKey(from), null); store.del(listKey(from)); }
  });
}
// While a script is in the browser its file has the title's name: "My video" → my-video.md (-2 when taken).
async function followTitle(handle) {
  if (!state.inBrowser || handle !== state.handle || typeof handle.move !== "function") return;
  const from = state.name, doc = state.doc;
  if (D.scriptFileName("", doc).toLowerCase() === from.toLowerCase()) return; // the title's own name: nothing to look up
  const name = D.titleFileName(from, doc, await nameTaken(from));
  if (!name || handle !== state.handle) return;
  await handle.move(name);
  // The move is queued before the name changes: a link or unlink made before it went to the old name and moves with
  // it; one made after goes to the new name, after it.
  const moved = moveKeys(from, name, { clear: true });
  if (handle === state.handle) { state.name = name; renderTop(); }
  await moved;
  await updateRecent((list) => list.map((r) => (r.browser && r.name === from ? { ...r, handle, name } : r)));
}
// Its draft and B-roll keys go too: they are by name, as for every script (a file opened later under the same name
// starts without them).
async function deleteBrowserScript(r) {
  await forget(r.handle);
  try { await (await scriptsDir()).removeEntry(r.handle.name); } catch { /* gone already */ }
  saving.drafts.del(r.name);
  delKept(r.name);
  setLinkKey(null, r.name);
}

let listToken = 0;
async function renderScriptList() {
  const token = ++listToken;
  const rows = [];
  let currentListed = false;
  for (const r of await recentScripts()) {
    const current = !!state.doc && (await sameFile(r.handle, state.handle));
    currentListed ||= current;
    rows.push({ ...r, current });
  }
  // The open script is always in the list, also the sample or a new script without a file.
  if (state.doc && !currentListed) rows.unshift({ handle: null, name: state.name, at: 0, current: true });
  if (token !== listToken) return;
  const q = $("#scriptSearch").value.trim().toLowerCase();
  const ul = $("#scriptList");
  ul.replaceChildren();
  for (const r of rows) {
    if (q && !r.name.toLowerCase().includes(q)) continue;
    const li = h("li", "scripts__row");
    const open = h("button", "scripts__open", { type: "button" });
    if (r.current) open.setAttribute("aria-current", "true");
    const name = h("span", "scripts__name");
    name.textContent = r.name;
    open.append(name);
    if (r.browser) {
      const tag = h("span", "scripts__tag");
      tag.textContent = "Browser";
      open.append(tag);
    }
    if (r.at && !r.current) {
      const when = h("span", "scripts__when");
      when.textContent = clock(r.at);
      open.append(when);
    }
    if (r.current) open.insertAdjacentHTML("beforeend", icon("check"));
    open.addEventListener("click", async () => {
      $("#scriptMenu").hidePopover();
      if (r.current || !r.handle) return;
      await permitted(r.handle, true);
      await openHandle(r.handle);
    });
    li.append(open);
    if (r.handle && r.browser && !r.current) {
      // A script in the browser has no other copy: × asks once more, as "Delete", before it is gone.
      const x = h("button", "icon-btn scripts__remove", { type: "button", "aria-label": `Delete ${r.name}` });
      x.innerHTML = icon("x");
      x.addEventListener("click", async () => {
        if (!("confirm" in x.dataset)) { x.dataset.confirm = ""; x.className = "scripts__delete"; x.textContent = "Delete"; return; }
        x.disabled = true;
        await deleteBrowserScript(r);
        renderScriptList();
      });
      x.addEventListener("blur", () => { if (x.isConnected && !x.disabled) { delete x.dataset.confirm; x.className = "icon-btn scripts__remove"; x.innerHTML = icon("x"); } });
      li.append(x);
    } else if (r.handle && !r.browser) {
      const x = h("button", "icon-btn scripts__remove", { type: "button", "aria-label": `Remove ${r.name} from the list` });
      x.innerHTML = icon("x");
      x.addEventListener("click", async () => { await forget(r.handle); renderScriptList(); });
      li.append(x);
    }
    ul.append(li);
  }
  if (!ul.children.length) {
    const li = h("li", "scripts__empty");
    li.textContent = q ? "No match" : "No recent scripts";
    ul.append(li);
  }
}
$("#scriptMenu").addEventListener("toggle", (e) => {
  if (e.newState !== "open") return;
  $("#scriptSearch").value = "";
  renderScriptList();
  if (fine.matches) $("#scriptSearch").focus();
});
$("#scriptSearch").addEventListener("input", renderScriptList);
$("#scriptSearch").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  $("#scriptList .scripts__open")?.click();
});
$("#menuOpen").addEventListener("click", () => { $("#scriptMenu").hidePopover(); openFile(); });
$("#menuNew").addEventListener("click", () => { $("#scriptMenu").hidePopover(); newScript(); });
(async () => {
  if (!(canPick || browserSaving) || roomLink) return;
  lastHandle = (await recentScripts())[0]?.handle ?? null;
  if (lastHandle?.name) {
    $("#reopenLabel").textContent = `Reopen ${lastHandle.name}`;
    $("#emptyReopen").hidden = false;
  }
})();

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "s") { e.preventDefault(); saving.save(); return; }
  // Focus in the edit bar (the input, the B button): Ctrl/Cmd+B works there too, on the bar's saved selection.
  if (k === "b" && !e.shiftKey && state.doc && bar.contains(e.target)) { e.preventDefault(); toggleCueHere(); return; }
  if (!state.doc || e.target.closest?.("input, textarea")) return;
  if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (k === "y" && e.ctrlKey && !e.metaKey) { e.preventDefault(); redo(); }
  else if (k === "b" && !e.shiftKey && scriptEl.contains(e.target)) { e.preventDefault(); toggleCueHere(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // The menu that "more" opens closes alone; the bar stays.
  if (closeBarMenu() || escapeBoldPop()) { e.preventDefault(); return; }
  hideBar(); closeCard(); brollApi?.escape();
});
addEventListener("beforeunload", (e) => {
  persistDraft();
  saving.flush();
  if (isDirty() && !state.guest) { e.preventDefault(); e.returnValue = ""; }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { persistDraft(); saving.flush(); } });
addEventListener("pagehide", () => { persistDraft(); saving.flush(); });

/* ---------- Icons in the static markup ---------- */
$$("[data-icon]").forEach((el) => {
  if (el.classList.contains("menu-action__copy") || el.tagName === "BUTTON") el.innerHTML = icon(el.dataset.icon);
  else el.outerHTML = icon(el.dataset.icon);
});
$$("#editBar [data-act]").forEach((b) => (b.innerHTML = `${icon(ACT_ICON[b.dataset.act])}<span class="edit-bar__text">${esc(D.ACTIONS[b.dataset.act].name)}</span>`));


/* ---------- B-roll: one module, loaded the first time a script needs it (TOOLS-306) ---------- */
// public/broll-app.js holds the B-roll list and everything that shows or changes it: the frames beside the lines, the
// storyboard, the shot card, dragging a shot, the agent's suggestions, sketches and pictures. It loads (with broll.js)
// when a script has a linked list or B-roll asks, when the Storyboard opens, or when the agent sends B-roll; opening a
// script without any of that downloads none of it. Until it is here, the app answers for it below: no list.
// Bump with createBroll's: a tab opened before a release that loads the module after it stops instead of mixing them.
const BROLL_SEAM = 1;
let brollApi = null, brollLoading = null, brollFailed = false;
// Before the module is here: the open script (`token`, which only opening another script changes), whether its link
// is being looked up and the link found, the draft's "Check" flags and, for a guest, the host's list as it came last.
const brollPre = { token: 0, status: "none", link: null, flags: {}, room: null };
// Asks that show B-roll: a plan or sketches, or suggestions beside the lines.
const needsBroll = (a) => a.scope === "broll" || isBrollAnswer(a);
const wrapOf = (id) => (id ? scriptEl.querySelector(`.line[data-wrap="${CSS.escape(id)}"]`) : null);

// Its link and a list kept in the browser are stored by the script's name. Every read and write of a script's B-roll
// link goes through one queue, in the order they were made, so a move to a new name (step J) and a link or unlink
// made meanwhile never cross. The name is taken when the call is made.
const brollKey = (name = state.name) => `broll:${name}`;
let brollKeys = Promise.resolve();
function keyed(fn) {
  const run = brollKeys.then(fn);
  brollKeys = run.catch(() => {});
  return run;
}
const getLinkKey = (name = state.name) => keyed(() => idbGet(brollKey(name)));
const setLinkKey = (value, name = state.name) => keyed(() => idbSet(brollKey(name), value));
// Lists without a file are kept in IndexedDB per script; one left in local storage from before moves over when read.
const listKey = (name = state.name) => `brollList:${name}`;
async function readKept(name) {
  const kept = await idbGet(listKey(name));
  if (typeof kept === "string") return kept;
  const old = store.get(listKey(name));
  if (typeof old !== "string") return null;
  if (await idbPut(listKey(name), old).then(() => true, () => false)) store.del(listKey(name));
  return old;
}
const delKept = (name = state.name) => keyed(async () => { await idbSet(listKey(name), null); store.del(listKey(name)); });

// What the module may use of the app. Values that change are read through a function.
const brollHost = () => ({
  state, ui, scriptEl, $, $$, h, icon, esc, me, reduced, FILE_TYPES, SAMPLE, SAMPLE_BROLL, canPick, agent,
  isOpen, isBrollAnswer, byId, wrapOf, baseName, readContent, offsetIn, scriptView, personInput,
  emit, changed, closeAsk, validBy, offerAsks, renderBlock, getCaret, renderTocDots, renderAgent, agentBy,
  refreshBar, brollChanged, schedulePersist: () => { clearTimeout(draftTimer); draftTimer = setTimeout(persistDraft, 400); },
  hideBar, closeCard, editorJump, placeOverText, positionSlash, setView,
  getLinkKey, setLinkKey, keyed, listKey, readKept, delKept, idbPut, permitted, writeHandle,
});
// Loads the module once and, the first time, reads the open script's list; it settles once that first read is done.
// A load that failed stays failed until the page is reloaded: browsers keep a failed module for the page's life.
function needBroll() {
  if (brollApi) return Promise.resolve(brollApi);
  if (brollFailed) return Promise.reject(new Error("The B-roll part could not load."));
  const asked = brollPre.token; // the script that asked for it, unless another opened since
  brollLoading ??= import("./broll-app.js").then((m) => {
    if (m.SEAM !== BROLL_SEAM) throw new Error("The editor was updated: reload the page.");
    const api = m.createBroll(brollHost());
    api.setFlags(brollPre.flags);
    brollApi = api;
    return api;
  }).then((api) => {
    let first = null;
    if (!state.guest) first = api.load();
    else if (brollPre.room) api.adoptRoom(brollPre.room);
    else api.render();
    return Promise.resolve(first).then(() => api, () => api);
  }, (e) => {
    brollLoading = null;
    brollFailed = true;
    // Unreadable for the script that needed it (nothing is added or saved over its list), or for a script opened since
    // that waits for it too; one opened since without B-roll keeps "none".
    if (brollPre.token === asked || brollPre.status === "loading") brollPre.status = "error";
    renderView();
    renderBroll();
    throw e;
  });
  return brollLoading;
}
// The open script needs the module (a linked list, B-roll asks, the Storyboard): it loads, or the script's B-roll
// counts as unreadable when it could not load.
function wantBroll() {
  if (brollApi || brollLoading) return;
  if (!brollFailed) return void needBroll().catch(() => {});
  brollPre.status = "error";
  renderBroll();
}
// Runs at once when the module is here, else once it has loaded (nothing happens if it can't load).
function withBroll(fn) {
  if (brollApi) return fn(brollApi);
  needBroll().then(fn, () => {});
}
// Loads it when asks that show B-roll came in (a restored draft, a guest's copy) and it isn't here yet.
function brollIfAsks() {
  if (!brollApi && state.asks.some(needsBroll)) wantBroll();
}
// "none" (no list linked), "loading", "ok", "permission" or "error" (also: the module could not load for this script).
const brollStatus = () => (brollApi ? brollApi.status() : brollPre.status);
const brollShots = () => brollApi?.shots() ?? [];
// The script's link, also while the module is still on its way (a save under a new name takes it along, step J).
const brollLink = () => brollApi?.link() ?? (brollApi && brollApi.status() !== "loading" ? null : brollPre.link);
function brollFlags() {
  if (brollApi) return brollApi.flags();
  return Object.keys(brollPre.flags).length ? { ...brollPre.flags } : null;
}
function setBrollFlags(flags) {
  const f = flags && typeof flags === "object" ? { ...flags } : {};
  if (brollApi) brollApi.setFlags(f);
  else brollPre.flags = f;
}
// What follows the list outside the module: "add b-roll" in the bar, the list for guests, the export items and the
// folder note.
function refreshBar() { if (!bar.hidden) renderAsk(); }
function brollChanged() {
  together?.sync(); // the host shares the list with guests when it changed
  const ok = brollStatus() === "ok";
  for (const b of $$('#exportMenu [data-export="broll"], #exportMenu [data-export="storyboard"]')) b.disabled = !ok;
  for (const n of $$('#exportMenu [data-note="broll"]')) n.hidden = ok;
  renderFolderNote(); // a note about the list follows it: it clears once the list is ready
}
function renderBroll() {
  if (brollApi) return brollApi.render();
  refreshBar();
  brollChanged();
}
// Leaving a script: the old list goes with it.
function closeBroll() {
  brollPre.token++;
  brollPre.link = null; // also with the module here: a save before the next script's lookup must not take this link
  ui.scriptY = 0;
  ui.scriptTop = null;
  if (brollApi) return brollApi.close();
  Object.assign(brollPre, { status: "none", flags: {}, room: null });
  renderBroll();
}
// Opening a script: the module reads its list; without the module, its link is looked up here first, and the module
// loads only for a linked list, B-roll asks or the Storyboard.
async function loadBroll() {
  if (brollApi) return brollApi.load();
  const token = ++brollPre.token;
  if (!state.doc || state.guest) return; // guests get the host's list (setRoomBroll)
  // "none" must mean "no list linked", so the list counts as loading while its link is looked up.
  brollPre.status = "loading";
  const link = await getLinkKey();
  if (token !== brollPre.token || brollApi) return;
  // The demo script links its own made-up list, unless it was unlinked.
  const linked = link ? !link.none : state.name === SAMPLE.name;
  brollPre.link = linked ? link || { demo: true, name: SAMPLE_BROLL.name } : null;
  if (linked || state.asks.some(needsBroll) || ui.view === "board") return wantBroll();
  brollPre.status = "none";
  renderBroll();
}
// Guest: the host's B-roll list, shown as the host shows it (no file, no changes from here).
function setRoomBroll(b) {
  if (brollApi) return brollApi.adoptRoom(b);
  if (!state.guest || !state.doc) return;
  brollPre.room = b;
  brollPre.flags = b?.status === "ok" && b.flags && typeof b.flags === "object" ? { ...b.flags } : {};
  if (b?.status === "ok" && typeof b.text === "string") wantBroll();
  else renderBroll();
}

/* ---------- Script | Storyboard: the switch in the top bar (remembered) ---------- */
const sheetTop = () => $(".sheet").getBoundingClientRect().top + scrollY;
function setView(v) {
  const board = v === "board";
  if (board === (ui.view === "board")) return;
  if (board) { ui.scriptY = scrollY; ui.scriptTop = sheetTop(); }
  ui.view = board ? "board" : "script";
  store.set("view", ui.view);
  hideBar();
  closeCard();
  brollApi?.closeCard();
  brollApi?.endDrag();
  renderView();
  editorJump();
  // The Keep all row may have come or gone while away (step Q): the text comes back where it was all the same.
  scrollTo({ top: board || !ui.scriptY ? 0 : Math.max(0, ui.scriptY + sheetTop() - (ui.scriptTop ?? sheetTop())) });
}
function renderView() {
  const board = ui.view === "board" && !!state.doc;
  $("#layout").dataset.view = board ? "board" : "";
  for (const b of $$("#viewSwitch button")) b.setAttribute("aria-pressed", String(b.dataset.view === (board ? "board" : "script")));
  if (brollApi) return brollApi.renderView(board);
  // The storyboard is drawn by the B-roll module: opening it loads the module, which draws it.
  const el = $("#board");
  el.hidden = !board;
  el.replaceChildren();
  if (!board) return;
  if (brollFailed) el.innerHTML = '<div class="board__bar"><p class="board__note">Couldn\'t load the storyboard. Reload the page.</p></div>';
  else wantBroll();
}
$("#viewSwitch").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });

// The spoken paras a selection touches, with the selected part of each (the matcher only reads spoken paras).
function spokenSelection(range) {
  if (!state.doc || !range) return [];
  const spoken = new Set(D.spokenBlocks(state.doc).map((b) => b.id));
  const out = [];
  for (const el of $$(".block", scriptEl)) {
    if (!range.intersectsNode(el) || !spoken.has(el.dataset.id) || el.closest("details:not([open])")) continue;
    const content = readContent(el);
    const start = el.contains(range.startContainer) ? offsetIn(el, range.startContainer, range.startOffset) : 0;
    const end = el.contains(range.endContainer) ? offsetIn(el, range.endContainer, range.endOffset) : content.length;
    const snap = D.snapToWords(content, start, end);
    if (snap.end > snap.start) out.push({ id: el.dataset.id, start: snap.start, end: snap.end });
  }
  return out;
}
// Not once the module could not load: the card would never open.
const canAddBroll = () => !state.guest && (brollApi ? brollApi.canAdd() : !brollFailed && brollPre.status === "none");
// The typed command "add b-roll": the shot card opens on the selected spoken words (the module may load first).
function addBrollHere() {
  const s = barSel;
  if (!s?.range || !canAddBroll()) return;
  const sel = spokenSelection(s.range);
  if (!sel.length) return;
  const range = s.range.cloneRange(), asked = brollPre.token;
  withBroll((b) => { if (brollPre.token === asked) b.openCard({ mode: "add", sel, anchor: () => range }); });
}

/* ---------- Parts with "/" while typing (step C5) ---------- */
// "/" at the start of a line or after a space opens the parts menu at the caret; the typed letters filter it.
// The menu never takes the focus: the caret stays in the script, and the command is never saved (see saveText).
const slashMenu = $("#slashMenu");
const slash = { open: false, id: null, start: 0, end: 0, items: [], active: 0, dismissed: null };
function slashAtCaret() {
  if (!state.doc || state.pendingDraft) return null;
  const sel = getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return null;
  const caret = getCaret();
  const b = caret && byId(caret.id);
  if (!D.slashAllowed(b)) return null;
  const content = D.contentOf(b);
  const cmd = D.slashCommand(content, caret.offset);
  return cmd ? { id: b.id, content, ...cmd } : null;
}
// B-roll is offered on a spoken line that has words besides the command.
const slashOnSpokenLine = (cmd) => canAddBroll() && D.spokenBlocks(state.doc).some((x) => x.id === cmd.id)
  && /[\p{L}\p{N}]/u.test(D.cutCommand(cmd.content, cmd).content);
function updateSlash(typed) {
  const cmd = slashAtCaret();
  if (!cmd) { slash.dismissed = null; return closeSlash(); }
  // After Escape the typed text stays text until this command is gone.
  if (slash.dismissed?.id === cmd.id && slash.dismissed.start === cmd.start) return closeSlash();
  slash.dismissed = null;
  if (!slash.open && !typed) return;
  const items = D.matchParts(cmd.query, { spokenLine: slashOnSpokenLine(cmd) });
  if (!items.length) return closeSlash();
  const same = slash.open && slash.id === cmd.id && slash.start === cmd.start && slash.items.map((p) => p.id).join() === items.map((p) => p.id).join();
  Object.assign(slash, { open: true, id: cmd.id, start: cmd.start, end: cmd.end, items, active: same ? slash.active : 0 });
  renderSlash();
}
function renderSlash() {
  slashMenu.innerHTML = slash.items.map((p, i) => `${i && p.kind !== "spoken" && slash.items[i - 1].kind === "spoken" ? '<div class="slash-menu__sep" role="separator"></div>' : ""}`
    + `<div class="slash-menu__item" role="option" id="slash-${p.id}" data-part="${p.id}" aria-selected="${i === slash.active}">${esc(p.name)}</div>`).join("");
  slashMenu.hidden = false;
  const el = blockNode(slash.id);
  if (el) {
    for (const [k, v] of [["role", "combobox"], ["aria-controls", "slashMenu"], ["aria-expanded", "true"], ["aria-autocomplete", "list"], ["aria-activedescendant", `slash-${slash.items[slash.active].id}`]]) el.setAttribute(k, v);
  }
  slashMenu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  positionSlash();
}
function positionSlash() {
  if (!slash.open) return;
  const r = caretRect() || blockNode(slash.id)?.getBoundingClientRect();
  if (!r) return;
  const w = slashMenu.offsetWidth, ht = slashMenu.offsetHeight;
  const x = Math.max(8, Math.min(r.left - 8, document.documentElement.clientWidth - w - 8));
  let y = r.bottom + 6;
  if (y + ht > innerHeight - 8) y = Math.max(8, r.top - ht - 6);
  slashMenu.style.setProperty("--slash-x", x + "px");
  slashMenu.style.setProperty("--slash-y", y + "px");
}
function closeSlash() {
  if (!slash.open) return;
  slash.open = false;
  slashMenu.hidden = true;
  const el = blockNode(slash.id);
  if (el) for (const k of ["role", "aria-controls", "aria-expanded", "aria-autocomplete", "aria-activedescendant"]) el.removeAttribute(k);
  saving.schedule();
  // In a shared script the command text was held back; a picked part replaces it before this runs.
  queueMicrotask(() => together?.local());
}
// Picking removes the command and inserts the part, all in one undo step.
function pickSlash(partId) {
  const part = D.PARTS.find((p) => p.id === partId);
  if (!slash.open || !part) return;
  const { id, start, end } = slash;
  closeSlash();
  const b = byId(id);
  if (!b || D.contentOf(b).slice(start, start + 1) !== "/") return;
  state.preCaret = { id, offset: end };
  checkpoint("part", id);
  const cut = D.cutCommand(D.contentOf(b), { start, end });
  D.setContent(state.doc, id, cut.content);
  moveAsks(id, id, end, cut.at - end);
  reanchorBlock(id);
  if (part.kind === "broll") {
    renderAll({ id, offset: cut.at });
    changed();
    const text = D.contentOf(byId(id));
    const words = D.snapToWords(text, 0, text.length);
    const asked = brollPre.token;
    return void withBroll((b) => { if (brollPre.token === asked) b.openCard({ mode: "add", sel: [{ id, start: words.start, end: words.end }], anchor: () => blockNode(id) }); });
  }
  // A line that held only the command gives its place to the part.
  const replaceId = D.lineToReplace(state.doc, id, state.asks);
  if (replaceId && replaceId === state.hint) state.hint = null;
  const res = D.insertPart(state.doc, id, part.id, { replaceId });
  renderAll(res.caret);
  changed();
}
// In a shared script, a "/" command is held back from the others from its first character: the menu opens after the
// change is reported, so this asks what updateSlash is about to do.
function slashHeld() {
  if (slash.open) return true;
  const focused = scriptEl.contains(document.activeElement);
  const cmd = focused ? slashAtCaret() : null;
  const matches = cmd ? D.matchParts(cmd.query, { spokenLine: slashOnSpokenLine(cmd) }).length : 0;
  return D.slashHold({ focused, cmd, dismissed: slash.dismissed, matches });
}
// What a save writes: the script without an open "/" command.
function saveText() {
  return D.serialize(slash.open && state.doc ? D.withoutCommand(state.doc, slash) : state.doc);
}
scriptEl.addEventListener("input", (e) => { if (!e.isComposing) updateSlash(true); });
scriptEl.addEventListener("compositionend", () => updateSlash(true));
document.addEventListener("selectionchange", () => { if (slash.open) updateSlash(false); });
scriptEl.addEventListener("focusout", (e) => { if (slash.open && !slashMenu.contains(e.relatedTarget)) closeSlash(); });
addEventListener("scroll", positionSlash, { passive: true });
addEventListener("resize", positionSlash);
// The keys go to the menu first while it is open.
scriptEl.addEventListener("keydown", (e) => {
  if (!slash.open || e.isComposing || e.altKey || e.metaKey || e.ctrlKey) return;
  const n = slash.items.length;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { slash.active = (slash.active + (e.key === "ArrowDown" ? 1 : -1) + n) % n; renderSlash(); }
  else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) pickSlash(slash.items[slash.active].id);
  else if (e.key === "Escape") { slash.dismissed = { id: slash.id, start: slash.start }; closeSlash(); }
  else return;
  e.preventDefault();
  e.stopPropagation();
}, true);
// Phone keyboards may send Enter only as an input.
scriptEl.addEventListener("beforeinput", (e) => {
  if (!slash.open || (e.inputType !== "insertParagraph" && e.inputType !== "insertLineBreak")) return;
  e.preventDefault();
  e.stopPropagation();
  pickSlash(slash.items[slash.active].id);
}, true);
slashMenu.addEventListener("pointerdown", (e) => e.preventDefault());
slashMenu.addEventListener("click", (e) => { const it = e.target.closest("[data-part]"); if (it) pickSlash(it.dataset.part); });

/* ---------- Your own agent over MCP (live relay) ---------- */
const AGENT_MAX_AGE = 8 * 60 * 60 * 1000;
const NO_ASKS = "No asks yet. Call wait_for_asks again to keep listening.";
const STAYS_IN_PARAGRAPH = "This text would turn the asked paragraph into another kind of line (a heading, a list, a note). Send text that stays in the paragraph, with no new paragraphs.";
const RETAKE_AFTER_MS = 2 * 60 * 1000;
const BROLL_GONE = "The editor could not load its B-roll part. Ask the person to reload the page.";
const SCRIPT_MOVED = "The person opened another script meanwhile, so nothing changed. Call get_script and send it again if it still fits.";
const NOT_HERE = "This tab is editing someone else's shared script. Your agent works only in your own scripts.";
const agent = { token: null, createdAt: 0, ws: null, state: "off", info: null, retry: 0, timer: 0, waiters: [], copiedTimer: 0 };

// Tokens come from the Worker, which writes its own time into them. A clipboard write needs the click itself, so a
// spare is fetched when the menu opens; it is used if it is younger than ten minutes. Ages here use this tab's clock,
// counted from when the token arrived.
const SPARE_MS = 10 * 60 * 1000;
let spareToken = null, spareFetch = null;
function fetchToken() {
  return fetch("/api/agent-token", { method: "POST", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => (typeof b?.token === "string" && b.token ? { token: b.token, at: Date.now() } : null))
    .catch(() => null);
}
function prefetchToken() {
  if (spareFetch || (spareToken && Date.now() - spareToken.at < SPARE_MS)) return;
  spareFetch = fetchToken().then((t) => { spareFetch = null; if (t) spareToken = t; return t; });
}
const liveToken = () => !!agent.token && Date.now() - agent.createdAt < AGENT_MAX_AGE;
const agentBy = () => ({ id: `agent:${agent.info?.name || "agent"}`, name: agentBrand(agent.info?.name).name });
// Written for any MCP client: the plain facts first, then the usual ways to add a server, so the agent picks its own.
function connectionPrompt() {
  const url = `${location.origin}/mcp`, auth = `Bearer ${agent.token}`;
  return `Connect to my script editor as an MCP server and answer my asks.
Server: ${url} (Streamable HTTP)
Header: Authorization: ${auth}
1. Add this server as "script-editor" in your own MCP settings, the way your app does it. If a script-editor entry is already there, replace it: the token changes after Disconnect MCP or 8 hours. For example:
   - Claude Code: claude mcp add --transport http script-editor ${url} --header "Authorization: ${auth}"
   - Codex (~/.codex/config.toml):
     [mcp_servers.script-editor]
     url = "${url}"
     http_headers = { Authorization = "${auth}" }
   - Most other apps (JSON settings; use your app's key names):
     { "mcpServers": { "script-editor": { "url": "${url}", "headers": { "Authorization": "${auth}" } } } }
   If you can't change your settings yourself, tell me exactly what to paste where.
2. Reload MCP servers, then use the watch_script prompt (or call wait_for_asks in a loop and answer each ask with answer_ask, answer_broll or sketch_shot, as the ask calls for).
Keep the token private. It works until I press Disconnect MCP.`;
}

function connectRelay() {
  clearTimeout(agent.timer);
  if (!agent.token) return;
  if (Date.now() - agent.createdAt >= AGENT_MAX_AGE) return disconnectAgent();
  try { agent.ws?.close(); } catch { /* closed */ }
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/relay`, ["script-editor", `t.${agent.token}`]);
  agent.ws = ws;
  ws.binaryType = "arraybuffer"; // a picture's parts (step K)
  ws.addEventListener("open", () => { agent.retry = 0; });
  ws.addEventListener("message", (e) => {
    let m;
    if (agent.ws !== ws) return; // a detached socket (Disconnect) only carries the revoke
    if (e.data instanceof ArrayBuffer) return void brollApi?.pictureBytes(e.data);
    try { m = JSON.parse(e.data); } catch { return; }
    onRelayMessage(m);
  });
  ws.addEventListener("close", (e) => {
    if (agent.ws !== ws) return;
    agent.ws = null;
    dropWaiters();
    if (e.code === 4001) { agent.state = "elsewhere"; renderAgent(); return; }
    if (e.code === 4003) { forgetAgent(); return; }
    if (!agent.token) return;
    const delay = Math.min(30000, 1000 * 2 ** agent.retry++) * (0.75 + Math.random() * 0.5);
    agent.timer = setTimeout(connectRelay, delay);
  });
}
function onRelayMessage(m) {
  if (m.type === "agent") {
    agent.info = { name: String(m.name || ""), version: String(m.version || "") };
    agent.state = "on";
    renderAgent();
  } else if (m.type === "call" && typeof m.id === "string") {
    if (agent.state !== "on") { agent.state = "on"; renderAgent(); }
    handleCall(m);
  } else if (m.type === "image" && typeof m.id === "string") {
    if (brollApi) brollApi.pictureHead(m);
    else needBroll().then((b) => b.pictureHead(m), () => { try { agent.ws?.send(JSON.stringify({ type: "result", id: m.id, error: BROLL_GONE })); } catch { /* closed */ } });
  }
}
function forgetAgent() {
  clearTimeout(agent.timer);
  dropWaiters();
  const ws = agent.ws;
  agent.ws = null;
  try { ws?.close(1000, "bye"); } catch { /* closed */ }
  agent.token = null;
  agent.createdAt = 0;
  agent.info = null;
  agent.state = "off";
  store.del("agent");
  renderAgent();
}
// Disconnect MCP: the relay forgets the token, so the agent is refused from now on.
function disconnectAgent() {
  // Detach the socket and token first, then show "off" at once; the revoke finishes quietly behind it.
  const token = agent.token;
  let ws = agent.ws;
  agent.ws = null; // the app's own close handler now ignores this socket and won't reconnect
  forgetAgent(); // clears any pending reconnect, the token and the menu state
  if (!token) return;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/relay`;
  const close = () => { try { ws?.close(1000, "bye"); } catch { /* closed */ } };
  const send = () => { try { ws.send(JSON.stringify({ type: "revoke" })); } catch { /* closed */ } setTimeout(close, 200); };
  try {
    if (!ws || ws.readyState >= WebSocket.CLOSING) ws = new WebSocket(url, ["script-editor", `t.${token}`]);
    if (ws.readyState === WebSocket.OPEN) send();
    else ws.addEventListener("open", send, { once: true });
  } catch { /* offline: the token still ends after 8 hours */ }
  setTimeout(close, 5000);
}
function dropWaiters() {
  for (const w of agent.waiters) clearTimeout(w.timer);
  agent.waiters = [];
}

// Asks the agent has not seen yet; taken asks come back if no answer arrived within two minutes.
function takeUnseen() {
  const now = Date.now();
  const list = state.asks.filter((a) => a.status === "waiting" || (a.status === "taken" && now - Date.parse(a.takenAt || 0) > RETAKE_AFTER_MS));
  for (const a of list) {
    if (a.status === "waiting") takeAsk(a.id, agentBy());
    else a.takenAt = new Date().toISOString();
  }
  return list.map(askForAgent);
}
function voiceGuide() { return store.get("voiceGuide"); }
const askForAgent = (a) => D.askForAgent(a, {
  spokenText: a.scope === "selection" || a.action === "sketch" || !state.doc ? "" : D.exportCamera(state.doc),
  shots: brollShots(),
  voiceGuide: voiceGuide()?.text || "",
});
function askForList(a) {
  const out = { id: a.id, scope: a.scope, action: a.action, instruction: a.instruction, status: a.status, createdAt: a.createdAt };
  if (a.scope === "selection") Object.assign(out, { quote: a.quote, section: a.section });
  if (a.from) out.from = a.from; // one paragraph's links from a whole-script "Find links"
  if (a.own) out.own = true; // B-roll or sketches asked for in the agent's chat (step I)
  if (a.scope === "broll" && a.action === "sketch") out.shots = a.shots.map((s) => ({ id: s.id, state: a.answer?.done?.[s.id] || (a.answer?.sketches?.[s.id] ? "shown" : "waiting") }));
  else if (a.answer?.kind === "broll") {
    out.answer = { kind: "broll", changes: a.answer.changes.map(({ op, id, kind, what, how, quote, sketch, state }) => ({ op, ...(id ? { id } : {}), ...(kind ? { kind } : {}), ...(what != null ? { what } : {}), ...(how != null ? { how } : {}), ...(quote ? { quote } : {}), ...(sketch ? { sketch: true } : {}), state: state === "open" ? "waiting" : state })), ...(a.answer.message ? { message: a.answer.message } : {}) };
  } else if (a.answer) out.answer = a.answer.kind === "marks" ? { kind: "marks", marks: a.answer.marks.map((m) => ({ quote: m.quote, state: m.state })) } : a.answer;
  return out;
}
function offerAsks() {
  while (agent.waiters.length) {
    const list = takeUnseen();
    if (!list.length) return;
    const w = agent.waiters.shift();
    clearTimeout(w.timer);
    w.send({ result: { asks: list } });
  }
}
function scriptInfo() {
  const { sections } = D.outline(state.doc);
  const st = D.stats(state.doc);
  return {
    fileName: state.name,
    title: D.titleOf(state.doc),
    markdown: D.serialize(state.doc),
    sections: sections.map((sec) => ({ heading: sec.heading ? D.contentOf(sec.heading).trim() : "", spoken: sec.spoken })),
    words: st.words,
    spoken: st.spoken,
    broll: brollShots().map(D.forAgent),
    cues: C.listCues(state.doc),
  };
}
// `ws`: the socket the call came on, which its answer goes back on (also after the B-roll module has loaded).
function handleCall(call, ws = agent.ws) {
  const { id, tool, args = {} } = call;
  const send = (payload) => { try { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "result", id, ...payload })); } catch { /* closed */ } };
  if (state.guest) return send({ error: NOT_HERE });
  try {
    if (tool === "wait_for_asks") {
      const list = takeUnseen();
      if (list.length) return send({ result: { asks: list } });
      const seconds = Math.min(25, Math.max(0, Number(args.waitSeconds ?? 25) || 0));
      const w = { send };
      w.timer = setTimeout(() => { agent.waiters = agent.waiters.filter((x) => x !== w); send({ result: { asks: [], message: NO_ASKS } }); }, seconds * 1000);
      agent.waiters.push(w);
      return;
    }
    const failed = (e) => send({ error: `The editor could not do that: ${e?.message || e}` });
    if (tool === "list_scripts") return void scriptList().then((result) => send({ result }), failed);
    // The B-roll tools go to the B-roll module, which loads first if it isn't here yet. A sketch or suggestion is for
    // the script open when it was sent: if the person opened another one meanwhile, it goes nowhere.
    if (tool === "upload_image" || tool === "sketch_shot" || tool === "answer_broll") {
      const asked = brollPre.token; // the open script (undo or the agent's whole text keep it; opening another changes it)
      if (!brollApi) return void needBroll().then(() => (tool === "upload_image" || brollPre.token === asked ? handleCall(call, ws) : send({ error: SCRIPT_MOVED })), () => send({ error: BROLL_GONE }));
      return brollApi.agentTool(tool, args, send, NO_SCRIPT);
    }
    if (tool === "open_script") return void openScript(args, agentBy()).then(send, failed);
    if (!state.doc) return send({ error: NO_SCRIPT });
    if (tool === "get_script") return send({ result: scriptInfo() });
    if (tool === "set_script") {
      const problem = scriptProblem(args.markdown) || busyChoice();
      if (problem) return send({ error: problem });
      if (!setScript(args.markdown, agentBy())) return send({ result: "That is the script's text already: nothing changed." });
      return send({ result: "Done: the whole text is in the editor now. The person can undo it." });
    }
    if (tool === "list_asks") return send({ result: { asks: state.asks.map(askForList) } });
    if (tool === "list_cues") return send({ result: { cues: C.listCues(state.doc) } });
    if (tool === "mark_cue" || tool === "unmark_cue") {
      const busy = busyChoice(); // not while the person chooses about unsaved changes or a changed file
      if (busy) return send({ error: busy });
      const mode = tool === "mark_cue" ? "mark" : "unmark";
      const plan = C.planCues(state.doc, mode, args.cues, { asks: state.asks });
      const n = plan.segments.length ? landAgentCues(plan, mode, agentBy()) : 0;
      if (!n) return send({ error: `No cue changed.${cueSkips(plan.skipped)}` });
      return send({ result: `Done: ${n} ${n === 1 ? "cue" : "cues"} ${mode === "mark" ? "marked" : "removed"} in the text now. The person can undo it.${cueSkips(plan.skipped)}` });
    }
    if (tool === "answer_ask") {
      const ask = state.asks.find((a) => a.id === args.askId);
      const checked = D.checkAnswer(ask, args, state.doc);
      if (checked.error) return send({ error: checked.error });
      if (checked.answer.kind === "links") {
        // Links (step G): the quotes that can't be linked are skipped and listed back; with none left, nothing changes.
        const plan = C.planFor(state.doc, ask, checked.answer, { asks: state.asks });
        if (plan && !plan.segments.length) return send({ error: C.noLinksError(plan.skipped) });
        if (!receiveAnswer(ask.id, { ...checked.answer, by: agentBy() })) return send({ error: !plan || ask.status === "cancelled" ? "The text this ask was about has changed, so the ask was cancelled." : C.noLinksError(plan.skipped) });
        return send({ result: C.answerResult("links", { linked: ask.answer.links.length, skipped: plan.skipped }) });
      }
      if (!C.fits(state.doc, ask, checked.answer)) return send({ error: STAYS_IN_PARAGRAPH });
      if (!receiveAnswer(ask.id, { ...checked.answer, by: agentBy() })) return send({ error: "The text this ask was about has changed, so the ask was cancelled." });
      const cuesDropped = cueDrops.get(ask.id) || 0;
      cueDrops.delete(ask.id);
      return send({ result: C.answerResult(checked.answer.kind, { cuesDropped }) });
    }
    send({ error: `Unknown tool: ${tool}` });
  } catch (e) {
    send({ error: `The editor could not do that: ${e?.message || e}` });
  }
}

/* ---------- The agent opens a script or puts in its whole text (step H, Lex 2026-10-29) ---------- */
const NO_SCRIPT = "No script is open in the editor. Open one with open_script (list_scripts gives the person's recent scripts), or ask the person to open one.";
function busyChoice() {
  if (askingToOpen) return `The editor is waiting for the person to answer whether to open ${askingToOpen}. Try again after they answer.`;
  if (state.pendingDraft) return "The editor is waiting for the person to choose Restore or Discard for unsaved changes. Ask them to choose first.";
  if (state.conflict) return "The script's file changed on disk and the editor is waiting for the person to choose a version. Ask them to choose first.";
  return "";
}
function scriptProblem(markdown) {
  if (typeof markdown !== "string" || !markdown.trim()) return "markdown is required: the script's whole text.";
  if (markdown.length > D.SCRIPT_LIMITS.markdown) return `markdown is longer than ${D.SCRIPT_LIMITS.markdown} characters.`;
  return "";
}
async function scriptList() {
  const recent = [];
  for (const r of await recentScripts()) {
    recent.push({ name: r.name, ...(r.at ? { openedAt: new Date(r.at).toISOString() } : {}), open: !!state.doc && (await sameFile(r.handle, state.handle)), ...(r.browser ? { inBrowser: true } : {}) });
  }
  return { open: state.doc ? state.name : null, recent };
}
async function openScript(args, by) {
  if (askingToOpen) return { error: busyChoice() };
  if (together?.sharing) return { error: "The person is sharing this script with others; opening another one would end that. Ask them to stop sharing first." };
  const busy = state.doc ? busyChoice() : "";
  if (busy) return { error: busy };
  // A script without a file can't be saved on the way out: leaving it would leave it only as a hidden draft.
  if (state.doc && !state.handle && isDirty()) return { error: `The script open now (${state.name}) is not saved yet. Ask the person to save it first (Ctrl/Cmd+S).` };
  if (args.markdown != null) {
    const problem = scriptProblem(args.markdown);
    if (problem) return { error: problem };
    const name = D.scriptFileName(args.fileName, D.parse(args.markdown), await nameTaken());
    // Saved in the browser at once (step J), where the browser can.
    let made = null;
    if (browserSaving) { try { made = await createBrowserScript(name, args.markdown); } catch { made = null; } }
    if (made) {
      loadText(args.markdown, { name, handle: made.handle, modified: made.modified, browser: true });
      remember(made.handle, true);
      return { result: `Opened as ${name}, saved in the person's browser. They can save it as a file on their computer (Export → Markdown file).` };
    }
    loadText(args.markdown, { name });
    // None of it is in a file yet: it shows as unsaved, is kept as a draft, and the first save asks where.
    state.savedText = "";
    renderSaveState();
    persistDraft();
    return { result: `Opened as ${name}, not saved yet: the person picks where to save it.` };
  }
  const name = String(args.name ?? "").trim();
  const list = await recentScripts();
  const r = list.find((x) => x.name === name) || list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!r) return { error: `No recent script is called ${name}. list_scripts gives their names.` };
  if (state.doc && (await sameFile(r.handle, state.handle))) return { result: `${r.name} is already open.` };
  if (await permitted(r.handle, false)) {
    if (await openHandle(r.handle)) return { result: `Opened ${r.name}. get_script reads it.` };
    return { error: `The editor couldn't open ${r.name}: it may have been moved or deleted.` };
  }
  // The browser asks the person before reading a file again; that takes their click.
  const text = `${by.name} wants to open ${r.name}`;
  const undoLine = replaced;
  // One answer per line: a second Open while the browser's prompt is up does nothing, and a Not now then wins.
  let choice = null; // "open" while the browser's prompt is up, then "done"
  let line = 0;
  const notNow = () => {
    if (choice === "done") return;
    choice = "done";
    if (line !== lineSeq) return; // a newer line took its place
    hideBanner();
    $("#emptyNote").hidden = true;
    if (undoLine && state.doc && D.serialize(state.doc) === undoLine.text) showReplaced(undoLine);
  };
  const open = async () => {
    if (choice) return;
    choice = "open";
    // Things may have changed since the line showed up (sharing, a choice, unsaved text without a file), or the
    // browser's prompt may be refused: then nothing opens and the line goes, as with Not now.
    const allowed = () => line === lineSeq && !together?.sharing && !(state.doc && (state.pendingDraft || state.conflict || (!state.handle && isDirty())));
    const ok = allowed() && (await permitted(r.handle, true));
    if (choice !== "open") return;
    if (!(ok && allowed())) return notNow();
    choice = "done";
    // The line, and with it the wait for the agent, stays until the file is open (or why it isn't shows).
    openHandle(r.handle);
  };
  if (state.doc) showBanner(text, [["Open", open], ["Not now", notNow]]);
  else emptyNote(text, [["Open", open], ["Not now", notNow]]);
  line = lineSeq;
  askingToOpen = r.name;
  return { result: `The browser needs the person's OK to open ${r.name}: an Open button shows in the editor. Call get_script later to see which script is open.` };
}
// The agent's whole text goes in as one change: one Ctrl/Cmd+Z step when alone, the agent's in a shared script.
// Paragraphs it left word for word keep their ids, so their asks and marks stay; asks on text that is gone end.
function putScript(next, { by = null, before = D.cloneDoc(state.doc) } = {}) {
  together?.local(); // the host's own typing goes out first, under the host's name
  hideBar();
  closeCard();
  state.doc = D.keepIds(state.doc, next);
  state.preCaret = null;
  checkpoint("agent", null, before);
  reanchorAll();
  if (by) together?.localAs("agent");
  renderAll(null);
}
function setScript(markdown, by) {
  // The file keeps its own line endings; compared with the text as saved (a "/" command being typed is left out).
  const text = D.wholeText(state.doc, markdown, saveText());
  if (text == null) return false;
  const before = D.cloneDoc(state.doc);
  putScript(D.parse(text), { by, before });
  showReplaced({ text: D.serialize(state.doc), before, step: together?.active ? null : state.undo.at(-1), by });
  changed();
  return true;
}
function showReplaced(r) {
  showBanner(`${r.by.name} replaced the text`, [["Undo", undoScript]]);
  replaced = r;
}
// Undo on the line: exactly the text from before, while the agent's text is untouched.
function undoScript() {
  const r = replaced;
  hideBanner();
  if (!r || D.serialize(state.doc) !== r.text) return;
  if (r.step && state.undo.at(-1) === r.step) return undo();
  putScript(D.cloneDoc(r.before));
  changed();
}

function renderAgent() {
  const btn = $("#agentBtn"), act = $("#mcpAction");
  btn.dataset.state = agent.state;
  act.dataset.state = agent.state === "elsewhere" ? "off" : agent.state;
  const brand = agentBrand(agent.info?.name), name = brand.name;
  // While connected, the button shows the agent's own logo; until then the MCP mark (Lex, 2026-10-29).
  const key = agent.state === "on" ? brand.icon : "mcp", mark = btn.querySelector("svg.i");
  if (mark && mark.dataset.key !== key) mark.outerHTML = icon(key).replace("<svg ", `<svg data-key="${key}" `);
  $("#agentBtnLabel").textContent = agent.state === "on" ? name : agent.state === "waiting" ? "Waiting for MCP" : agent.state === "elsewhere" ? "Open in another tab" : "Connect your agent";
  btn.title = agent.state === "elsewhere" ? "Open in another tab" : agent.state === "on" ? name : "";
  $("#mcpActionText").textContent = agent.state === "on" ? "Disconnect MCP" : agent.state === "elsewhere" ? "Use this tab" : "Wait for MCP";
  $("#mcpCopy").hidden = agent.state === "on" || agent.state === "elsewhere";
  const rows = $("#agentRows");
  if (agent.state === "on") {
    const busy = state.asks.find((a) => a.status === "taken");
    const where = busy ? (busy.scope === "script" ? "whole script" : busy.scope === "broll" ? "storyboard" : `section ${D.parseHeading(busy.section || "").num || "·"}`) : "listening";
    rows.innerHTML = `<li class="agent-row"><span class="status-dot"></span><span class="agent-row__name"></span><span class="agent-row__where"></span><button class="small-btn" type="button" id="agentStop">Stop</button></li>`;
    rows.querySelector(".agent-row__name").textContent = name;
    rows.querySelector(".agent-row__where").textContent = where;
  } else rows.replaceChildren();
  $("#voiceBtn").disabled = !(state.doc && !state.pendingDraft && agent.state === "on");
  const links = $("#findLinks");
  links.disabled = !(state.doc && !state.pendingDraft && agent.state === "on");
  links.dataset.state = state.asks.some((a) => a.scope === "script" && a.action === "links" && (a.status === "waiting" || a.status === "taken")) ? "waiting" : "";
  renderVoiceGuide();
}
function renderVoiceGuide(problem = "") {
  const guide = voiceGuide();
  const text = $("#voiceGuideText");
  $("#voiceGuideName").textContent = problem || guide?.name || "none";
  text.dataset.state = problem ? "error" : "";
  $("#voiceGuideClear").hidden = !guide || !!problem;
}
async function copyPrompt() {
  const text = connectionPrompt();
  const box = $("#mcpPrompt");
  try {
    await navigator.clipboard.writeText(text);
    box.hidden = true;
    const act = $("#mcpAction");
    act.dataset.copied = "";
    $("#mcpCopy").innerHTML = icon("check");
    clearTimeout(agent.copiedTimer);
    agent.copiedTimer = setTimeout(() => { delete act.dataset.copied; $("#mcpCopy").innerHTML = icon("copy"); }, 2000);
  } catch {
    // No clipboard here: show the prompt, selected, to copy by hand.
    box.value = text;
    box.hidden = false;
    box.focus();
    box.select();
  }
}
let tokenWait = false;
$("#mcpAction").addEventListener("click", async () => {
  if (agent.state === "on") return disconnectAgent();
  if (agent.state === "elsewhere") { agent.state = "waiting"; connectRelay(); renderAgent(); return; }
  if (!liveToken()) {
    if (tokenWait) return;
    let t = spareToken && Date.now() - spareToken.at < SPARE_MS ? spareToken : null;
    spareToken = null;
    if (!t) {
      tokenWait = true;
      $("#mcpAction").setAttribute("aria-busy", "true");
      $("#mcpActionText").textContent = "Wait for MCP"; // a retry clears the last "No connection"
      $("#mcpCopy").hidden = false;
      t = await (spareFetch ?? fetchToken());
      tokenWait = false;
      $("#mcpAction").removeAttribute("aria-busy");
      if (spareToken === t) spareToken = null;
    }
    if (liveToken()) return;
    // No token from the Worker (offline, say): it stays off, and the button says so until the next try.
    if (!t) { $("#mcpActionText").textContent = "No connection, try again"; $("#mcpCopy").hidden = true; return; }
    agent.token = t.token;
    agent.createdAt = t.at;
    store.set("agent", { token: agent.token, createdAt: agent.createdAt });
    connectRelay();
  } else if (!agent.ws) connectRelay();
  agent.state = "waiting";
  renderAgent();
  copyPrompt();
});
$("#agentMenu").addEventListener("click", (e) => { if (e.target.closest("#agentStop")) disconnectAgent(); });
$("#agentMenu").addEventListener("toggle", (e) => {
  if (e.newState === "closed") $("#mcpPrompt").hidden = true;
  else if (!liveToken()) prefetchToken();
});
$("#voiceBtn").addEventListener("click", () => { if (agent.state === "on") requestVoiceCheck(); });
$("#findLinks").addEventListener("click", () => { if (agent.state === "on") requestLinks(); });
$("#voiceGuideOpen").addEventListener("click", () => $("#voiceGuideInput").click());
$("#voiceGuideClear").addEventListener("click", () => { store.del("voiceGuide"); renderVoiceGuide(); });
$("#voiceGuideInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > D.LIMITS.voiceGuide) return renderVoiceGuide("too large, 20 KB at most");
  try {
    const text = await file.text();
    if (!store.set("voiceGuide", { name: file.name, text })) return renderVoiceGuide("could not be kept");
    renderVoiceGuide();
  } catch { renderVoiceGuide(`couldn't open ${file.name}`); }
});
setInterval(() => { try { if (agent.ws?.readyState === WebSocket.OPEN) agent.ws.send('{"type":"ping"}'); } catch { /* closed */ } }, 45_000);
// A token lives at most eight hours; then it is replaced like Disconnect MCP.
setInterval(() => { if (agent.token && !liveToken()) disconnectAgent(); }, 60_000);
(() => {
  if (roomLink) return; // a guest's tab never connects its own agent to someone else's script
  const saved = store.get("agent");
  if (saved?.token && Date.now() - saved.createdAt < AGENT_MAX_AGE) {
    agent.token = saved.token;
    agent.createdAt = saved.createdAt;
    agent.state = "waiting";
    connectRelay();
  } else if (saved) store.del("agent");
  renderAgent();
})();

// Menus sit under their button; browsers without anchor positioning get the place from here.
for (const [menu, btn] of [["#exportMenu", "#exportBtn"], ["#agentMenu", "#agentBtn"], ["#scriptMenu", "#docInfo"], ["#shareMenu", "#share"]]) {
  $(menu).addEventListener("toggle", (e) => {
    if (e.newState !== "open" || CSS.supports("position-area: block-end")) return;
    const r = $(btn).getBoundingClientRect(), m = $(menu);
    const x = menu === "#scriptMenu" ? r.left : r.right - m.offsetWidth;
    m.style.top = `${r.bottom + 6}px`;
    m.style.left = `${Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8))}px`;
  });
}

/* ---------- Working together (step D): Share to edit, guests, carets ---------- */
// The selection inside one block, in content offsets: { id, anchor, focus, focused }.
function localSelection() {
  if (!state.doc) return null;
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const fe = blockOf(sel.focusNode);
  if (!fe) return null;
  const focus = offsetIn(fe, sel.focusNode, sel.focusOffset);
  const anchor = blockOf(sel.anchorNode) === fe ? offsetIn(fe, sel.anchorNode, sel.anchorOffset) : focus;
  return { id: fe.dataset.id, anchor, focus, focused: scriptEl.contains(document.activeElement) };
}
function restoreSelection(sel) {
  const el = sel?.focused && blockNode(sel.id);
  if (!el || el.contentEditable === "false") return;
  if (document.activeElement !== el) el.focus({ preventScroll: true });
  const [an, ao] = pointAt(el, sel.anchor), [fn, fo] = pointAt(el, sel.focus);
  try { getSelection().setBaseAndExtent(an, ao, fn, fo); } catch { setCaretAt(el, sel.focus); }
}
// Someone else's change (or an undo on a name tag) is in state.doc: asks follow the text, then the script redraws.
function afterRoomOps(ops, sel, before = new Map()) {
  followMarks(ops);
  const touched = new Set();
  let structure = false;
  // The host closes an ask or mark that an edit fell inside (as for the person's own edit that
  // breaks a bold stretch), so it can't jump to a later copy of its words by a search; the same for its own Undo and an
  // Undo on a name tag. A guest leaves that to the host's asks message.
  const strict = together?.room?.role === "host";
  const was = new Map(before); // the text of each block before the edit being followed (edits of a batch come one by one)
  for (const op of ops) {
    if (op.type === "text") {
      touched.add(op.blockId);
      const old = was.get(op.blockId);
      followAnchors(op.blockId, null, (start, end) => (strict ? C.followRoomEdit({ start, end }, op, old) : C.followTextOp({ start, end }, op)), { insideGoes: strict });
      if (typeof old === "string") was.set(op.blockId, old.slice(0, op.at) + op.ins + old.slice(op.at + op.del));
    }
    else if (op.type === "split") {
      if (strict) followAnchors(op.blockId, null, (start, end) => C.followRoomEdit({ start, end }, op), { insideGoes: true });
      const old = was.get(op.blockId);
      if (typeof old === "string") { was.set(op.blockId, old.slice(0, op.at)); was.set(op.newId, old.slice(op.at)); } else was.delete(op.blockId);
      moveAsks(op.blockId, op.newId, op.at, -op.at);
      touched.add(op.blockId).add(op.newId);
      structure = true;
    }
    else if (op.type === "merge") { was.delete(op.blockId); was.delete(op.into); moveAsks(op.blockId, op.into, 0, op.at); touched.add(op.into).add(op.blockId); structure = true; }
    else { touched.add(op.blockId ?? op.block.id); structure = true; }
  }
  for (const id of touched) reanchorBlock(id);
  const heads = [...touched].some((id) => byId(id)?.type === "title" || byId(id)?.type === "heading");
  if (structure) renderAll();
  else for (const id of touched) renderBlock(id);
  if (heads && !structure) renderToc();
  if (heads) renderTop();
  restoreSelection(sel);
  changed();
}
/* Asks and B-roll in a shared script (step D2): the host keeps them, guests see them as the host does. */
// Host: a guest's ask, already checked and found in this script (together-adapter.js guestAsk).
function guestAsk(spec, by) {
  if (!state.doc || !byId(spec.blockId)) return;
  addAsk({ blockId: spec.blockId, start: spec.start, end: spec.end, action: spec.action, typed: spec.instruction || "", by, onlyBy: by.id });
}
// Host: Keep, Undo or dismiss from the guest who asked. B-roll suggestions stay with the host.
function guestAct(id, act, askerId) {
  if (guestMayAct(state.asks.find((a) => a.id === id), act, askerId)) doAsk(id, act);
}
// Guest: the host could not take an ask (its text changed meanwhile, or someone else's ask is on it). A quiet line under that line says so, until the
// person types there or asks again.
const askNotes = new Map();
function askRefused(ask, reason = "changed") {
  if (!byId(ask?.blockId)) return;
  askNotes.set(ask.blockId, reason === "taken" ? "Couldn't ask: someone else's ask is on this text" : "Couldn't ask: this text changed");
  renderBlock(ask.blockId, getCaret());
}
function clearAskNote(id) {
  if (!askNotes.delete(id)) return;
  wrapOf(id)?.querySelector(":scope > .ask-note")?.remove();
}
// Guest: the host's open asks, already placed in this copy (fitAsks). Only blocks whose asks changed are drawn again.
function setRoomAsks(asks) {
  for (const a of asks) brollApi?.cleanSketches(a); // what the room gave this guest (the B-roll module cleans the rest when it loads)
  const perBlock = (list) => {
    const m = new Map();
    for (const a of list) {
      const ids = a.scope === "selection" ? [a.blockId] : (a.answer?.marks || []).map((x) => x.blockId);
      const sig = JSON.stringify([a.id, a.status, a.start, a.end, a.answer, a.action, a.by?.id, a.change?.text, a.change?.at]);
      for (const id of ids) m.set(id, (m.get(id) || "") + sig);
    }
    return m;
  };
  const brollSig = (list) => JSON.stringify(list.filter((a) => a.scope === "broll" || isBrollAnswer(a)));
  const before = perBlock(state.asks), after = perBlock(asks), brollBefore = brollSig(state.asks);
  // An ask this guest saw open whose change is now in the text arrived just now (this tab's clock).
  const was = new Map(state.asks.map((a) => [a.id, a]));
  for (const a of asks) if (C.isMarked(a) && was.has(a.id) && was.get(a.id).status !== "kept") arrived.set(a.id, Date.now());
  state.asks = asks;
  brollIfAsks();
  markBase();
  // The text is the same, only the asks drawn on it changed: a selection in a line that is drawn again stays selected
  // (TOOLS-52 item 6), as for a mark that ends (endMarks).
  const caret = getCaret(), sel = localSelection();
  for (const id of new Set([...before.keys(), ...after.keys()])) if (before.get(id) !== after.get(id) && byId(id)) renderBlock(id, caret);
  if (sel && before.get(sel.id) !== after.get(sel.id)) restoreSelection(sel);
  renderTocDots();
  renderVoice();
  if (brollSig(asks) !== brollBefore) renderBroll();
  else brollApi?.refreshSuggestions();
}
// Host: the B-roll list as guests get it (in the snapshot and after each change).
const brollShare = () => brollApi?.roomShare() ?? { status: "none" };
// A guest gets the host's script (the first time, and again after a fresh snapshot).
function loadGuest(doc, name, sharedBroll = null) {
  const first = !state.guest || !state.doc;
  const sel = first ? null : localSelection();
  hideBar();
  closeCard();
  if (first) closeBroll();
  Object.assign(state, {
    guest: true, locked: false, doc, name, handle: null, savedText: D.serialize(doc), savedAt: 0, saveError: "",
    needsPermission: false, conflict: false, undo: [], redo: [], lastStep: null, pendingDraft: null, hint: null,
    // A fresh snapshot keeps the host's asks, placed again in the new copy; the first one starts with none.
    asks: first ? [] : fitAsks(state.asks, doc),
  });
  markBase();
  hideBanner();
  renderTop();
  renderAll();
  renderDerived();
  if (sharedBroll) setRoomBroll(sharedBroll);
  if (sel) restoreSelection(sel);
  if (first) { editorJump(); scrollTo({ top: 0 }); }
}
// The host stopped sharing: the guest keeps reading, but can no longer edit.
function guestEnded(status) {
  state.locked = true;
  closeSlash();
  hideBar();
  renderAll();
  showBanner(status === "full" ? "This script already has 20 guests" : "Sharing stopped", []);
}
function joinFailed(status) {
  $("#joinForm").hidden = true;
  const note = $("#emptyNote");
  note.textContent = status === "full" ? "This script already has 20 guests" : status === "unloaded" ? "Couldn't load the edit link. Reload the page." : "This edit link has ended";
  note.hidden = false;
}
if (roomLink) {
  for (const b of $$(".empty__actions > .tb")) b.hidden = true;
  const form = $("#joinForm");
  form.hidden = false;
  $("#joinName").value = me.name !== "You" ? me.name : "";
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#joinName").value.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name) return $("#joinName").focus();
    me.name = name;
    store.set("me", { id: me.id, name });
    form.querySelector("button").disabled = true;
    together.join(roomLink, name);
  });
}
together = createTogether({
  doc: () => state.doc,
  jump: () => editorJump(),
  name: () => state.name,
  me,
  held: slashHeld,
  selection: localSelection,
  restore: restoreSelection,
  element: (id) => blockNode(id),
  rangeAt: visibleRange,
  applied: afterRoomOps,
  loadGuest,
  guestEnded,
  joinFailed,
  // Undo steps from before sharing would bring back old text over other people's work.
  sharing: () => { state.undo = []; state.redo = []; state.lastStep = null; },
  renderTop: () => renderTop(),
  renderDots: () => { if (state.doc) renderTocDots(); },
  asks: () => state.asks,
  seenAsks: () => C.seenAsks(state.asks, passedHere), // the agent's caret: without the marks scrolled past here
  setRoomAsks,
  guestAsk,
  guestAct,
  askRefused,
  brollShare,
  setRoomBroll,
  undoAgent,
  sheet: $(".sheet"),
  scriptEl,
  icon,
});
if (roomLink) together.preload(); // a guest's edit link: the room's part comes while they type a name

// The Script/Storyboard switch stays centred on the bar whenever the actions fit beside it.
function fitTop() {
  const top = $(".top"), sw = $("#viewSwitch"), end = $(".top__end");
  const cs = getComputedStyle(top);
  const room = top.clientWidth - parseFloat(cs.paddingInlineEnd) - end.offsetWidth;
  const crowded = !sw.hidden && room < top.clientWidth / 2 + sw.offsetWidth / 2 + (parseFloat(cs.columnGap) || 0);
  if (crowded !== ("crowded" in top.dataset)) top.toggleAttribute("data-crowded", crowded);
}
const topFit = new ResizeObserver(() => fitTop());
for (const el of [$(".top"), $(".top__end"), $("#viewSwitch")]) topFit.observe(el);

/* ---------- Hooks for tests and step B ---------- */
const brollHook = (fn) => (brollApi ? fn(brollApi) : needBroll().then(fn));
window.__scriptEditor = {
  answer: receiveAnswer,
  take: takeAsk,
  voiceCheck: () => requestVoiceCheck()?.id ?? null,
  asks: () => structuredClone(state.asks),
  markdown: () => (state.doc ? D.serialize(state.doc) : null),
  broll: () => (brollStatus() === "ok" ? brollShots().map(D.forAgent) : null),
  // The B-roll hooks answer at once while the B-roll module is here, else with a promise once it has loaded.
  sketchAsk: () => brollHook((b) => b.requestSketches()?.id ?? null),
  planAsk: () => brollHook((b) => b.requestPlan()?.id ?? null),
  answerBroll: (askId, args) => brollHook((b) => b.answerBroll(state.asks.find((a) => a.id === askId), args, { id: "test", name: "Test" }) || true),
  sketch: (askId, shotId, svg) => brollHook((b) => b.sketch(state.asks.find((a) => a.id === askId), shotId, svg, { id: "test", name: "Test" }) || true),
  dropRoom: () => { try { together.room?.ws?.close(); } catch { /* closed */ } },
  room: () => (together.room ? { role: together.room.role, status: together.room.status, v: together.room.v, people: together.room.peopleList(), carets: together.room.caretList(), link: together.room.role === "host" ? together.room.link(location.origin) : null, settled: together.room.role === "guest" ? together.room.settled() : null, outbox: together.outbox.length } : null),
  ask: (blockIndex, start, end, action = "simpler", typed = "") => {
    const b = state.doc?.blocks[blockIndex];
    if (!b) return null;
    const content = D.contentOf(b);
    barSel = { id: b.id, start, end, quote: content.slice(start, end) };
    return makeAsk(action, typed)?.id ?? null;
  },
};
renderTop();
