// script.techies.tools · the editor UI. Plain ES module, no build step, no network except loading the sample.
import * as D from "./doc.js";
import * as Q from "./save-queue.js";
import * as B from "./broll.js";
import * as C from "./changes.js";
import * as L from "./links.js";
import { createTogether, parseLink, fitAsks, overlappingAsks, guestMayAct } from "./together-adapter.js";
import { agentBrand } from "./agent-brand.js";
import { makeZip } from "./zip.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const fine = matchMedia("(hover: hover) and (pointer: fine)");

const ICONS = {
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
// The B-roll list linked to this script (see broll.js). Shots keep the block ids they cover while the file is open.
const broll = {
  token: 0, link: null, status: "none", err: "", text: "",
  shots: [], sketches: {}, flags: {}, lit: null, filter: "all", saving: {}, problem: {},
  marked: {}, // step K2: pictures put in at once, per shot { prev, pic, askId }, with Undo until the list changes
};
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
  if (r.top < top || r.top > innerHeight - 40) el.scrollIntoView({ block: "center", behavior: "instant" });
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
    else if (C.isMarked(a) && a.blockId === id) items.push({ kind: "landed", ask: a, ...C.markRange(a) });
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
const linksOf = (b) => (b.type === "para" ? L.textLinks(D.contentOf(b)) : []);
function linkNodes(content, from, to, links) {
  const nodes = [];
  let at = from;
  for (const l of links) {
    if (l.start < at || l.end > to) continue;
    if (l.start > at) nodes.push(document.createTextNode(content.slice(at, l.start)));
    const a = h("span", "md-link", { "data-link": "", title: l.url });
    a.dataset.href = l.url;
    const head = h("span", "md-link__mark"), words = h("span", "md-link__words"), tail = h("span", "md-link__mark");
    head.textContent = "[";
    words.textContent = content.slice(l.words.start, l.words.end);
    tail.textContent = content.slice(l.words.end, l.end);
    a.append(head, words, tail);
    nodes.push(a);
    at = l.end;
  }
  if (to > at) nodes.push(document.createTextNode(content.slice(at, to)));
  return nodes;
}
// The links as drawn: the ones inside one stretch of plain text or one decoration (an old before/after has none).
function shownLinks(content, links, decos) {
  const cuts = [0, content.length];
  for (const d of decos) cuts.push(d.start, d.end);
  const inChange = (l) => decos.some((d) => d.kind === "ask" && d.ask.status === "answered" && d.ask.answer.kind !== "note" && l.start < d.end && l.end > d.start);
  return links.filter((l) => !cuts.some((c) => c > l.start && c < l.end) && !inChange(l));
}
// Where a link element starts in its block's content.
function linkStart(el, a) {
  const r = document.createRange();
  r.selectNodeContents(a);
  return offsetIn(el, r.startContainer, r.startOffset);
}
// A drawn link as L.textLinks gives it ({ start, end, words: { start, end } }), from its element and where it starts.
function shownLink({ a, start }) {
  const words = readContent(a.querySelector(".md-link__words")).length;
  return { start, end: start + readContent(a).length, words: { start: start + 1, end: start + 1 + words } };
}
const closedLinks = (el) => [...el.querySelectorAll(".md-link:not([data-open])")].map((a) => shownLink({ a, start: linkStart(el, a) }));
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
  return opened;
}
// After the selection moved: open the links it touches. A caret the person put on the edge of a closed link (where
// its words begin or end) goes just outside it, so typing there adds to the line, not to the link's words.
let composingLinks = false;
function refreshLinks(snap = false) {
  const sel = getSelection();
  const r = sel.rangeCount ? sel.getRangeAt(0) : null;
  for (const el of scriptEl.querySelectorAll(".block:has(.md-link)")) {
    const s = r && r.intersectsNode(el) ? selectionIn(el) : null;
    const opened = openLinks(el, s ? s.start : -1, s ? s.end : -1);
    if (!snap || composingLinks || !s || s.start !== s.end || !sel.isCollapsed || opened.length !== 1) continue;
    const to = L.edgeSnap(shownLink(opened[0]), s.start);
    if (to !== s.start) setCaretAt(el, to);
  }
}
scriptEl.addEventListener("compositionstart", () => { composingLinks = true; });
scriptEl.addEventListener("compositionend", () => { composingLinks = false; });
// Ctrl/Cmd+click opens a link in a new tab; a plain click only places the caret.
scriptEl.addEventListener("click", (e) => {
  const a = e.target.closest?.(".md-link");
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
// In a shared script only the person who asked, and the host, may Keep, Undo or cancel an ask.
const may = (ask) => !state.guest || !!together?.may(ask);
function fillBlock(el, b) {
  const content = D.contentOf(b);
  const decos = decorationsFor(b.id);
  const links = shownLinks(content, linksOf(b), decos);
  const nodes = [];
  let at = 0, chips = 0;
  const text = (from, to) => nodes.push(...linkNodes(content, from, to, links));
  const words = (m, d) => m.append(...linkNodes(content, d.start, d.end, links));
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
}

let sectionObserver = null;
function renderAll(caret = null) {
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
  renderBrollMarks();
  if (caret) placeCaret(caret.id, caret.offset);
  refreshLinks();
  together?.redraw();
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
  if (!tooLong) prompterUrl(pro);
  rematchBroll(false);
  refreshSuggestions();
}

let derivedTimer = 0, draftTimer = 0, saveTimer = 0;
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
  brollTouched();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 400);
  scheduleSave();
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
  state.doc = D.cloneDoc(snap.doc);
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
function syncFromDom(el) {
  const id = el.dataset.id, b = byId(id);
  if (!b) return;
  clearAskNote(id);
  const typed = readContent(el);
  const before = linksBefore?.id === id && linksBefore.content === D.contentOf(b) ? linksBefore.closed : null;
  linksBefore = null;
  const fix = before && L.keepHidden(D.contentOf(b), typed, before, getCaret()?.offset);
  const content = fix ? fix.content : typed;
  if (content === D.contentOf(b)) {
    if (fix || !domMatches(el, id)) renderBlock(id, fix ? { id, offset: fix.caret } : getCaret());
    return;
  }
  checkpoint("type", id);
  const caret = fix ? { id, offset: fix.caret } : getCaret();
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
  checkpoint("enter", id);
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
  checkpoint("merge", id);
  moveAsks(id, prevId, 0, offset);
  const m = D.mergeWithPrevious(state.doc, id);
  reanchorBlock(prevId);
  renderAll({ id: m.into, offset: m.offset });
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
  checkpoint("paste", id);
  const content = D.contentOf(b);
  moveAsks(id, id, sel.end, text.length - (sel.end - sel.start));
  applyContent(id, content.slice(0, sel.start) + text + content.slice(sel.end), sel.start + text.length);
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
  if (e.inputType.startsWith("delete") && !e.isComposing) linksBefore = el.querySelector(".md-link:not([data-open])") ? { id: el.dataset.id, content: readContent(el), closed: closedLinks(el) } : null;
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

/* ---------- Edit bar ---------- */
const bar = $("#editBar");
let barSel = null;
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
  const rects = r.getClientRects(), first = rects[0] || r.getBoundingClientRect(), last = rects[rects.length - 1] || first;
  bar.hidden = false;
  if (matchMedia("(max-width: 40rem)").matches) return;
  const w = bar.offsetWidth, ht = bar.offsetHeight, top = $(".top").getBoundingClientRect().bottom;
  const x = Math.max(8, Math.min(first.left - 4, document.documentElement.clientWidth - w - 8));
  let y = first.top - ht - 10;
  if (y < top + 8) y = last.bottom + 12;
  bar.style.setProperty("--bar-x", x + "px");
  bar.style.setProperty("--bar-y", y + "px");
}
function showBar() {
  if (state.locked) return hideBar();
  if (bar.contains(document.activeElement) || !shotCard.hidden) return;
  const s = currentSelection();
  if (!s) { hideBar(); return; }
  barSel = s;
  const spoken = spokenSelection(s.range).length > 0;
  $("#addBroll").disabled = !canAddBroll() || !spoken;
  for (const b of $$('#editBar [data-act="broll"]')) b.disabled = !spoken;
  $("#brollBtn").disabled = $("#addBroll").disabled && !spoken; // nothing usable in its menu
  // Guests can't add shots: their B-roll is the "Suggest B-roll" ask alone, as a plain button.
  $("#brollBtn").hidden = state.guest;
  $("#suggestBroll").hidden = !state.guest;
  const n = D.countWords(L.spokenText(s.quote));
  $("#ebLabel").textContent = `${n.toLocaleString("en")} ${n === 1 ? "word" : "words"}`;
  closeCard();
  placeBar(s.range);
}
function hideBar() { closeBarMenus(); bar.hidden = true; $("#askInput").value = ""; barSel = null; }

/* More ▾ and B-roll ▾: small menus in the bar. They never take the text selection (barSel keeps it), open below
   their button or above it, whichever fits, and work with the keyboard: Enter or Space opens, the arrow keys move,
   Escape closes and goes back to the button. */
const barMenus = [["#moreMenu", "#moreBtn"], ["#brollMenu", "#brollBtn"]].map(([m, b]) => ({ menu: $(m), btn: $(b), keys: false }));
function closeBarMenus() { for (const { menu } of barMenus) if (menu.matches(":popover-open")) menu.hidePopover(); }
// Escape: close the open bar menu and give its button the focus. Returns false when no menu was open.
function closeBarMenu() {
  const m = barMenus.find((x) => x.menu.matches(":popover-open"));
  if (!m) return false;
  m.menu.hidePopover();
  m.btn.focus();
  return true;
}
// The bar's controls in Tab order, as shown now (menus' items are not in it).
const barControls = () => [...$$(".edit-bar__controls > button", bar), $("#askInput"), $("#askForm button")].filter((el) => !el.hidden && !el.disabled && el.offsetParent);
function placeBarMenu({ menu, btn }) {
  const r = btn.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
  const below = innerHeight - r.bottom - 8, above = r.top - 8;
  const up = h + 6 > below && above > below;
  menu.style.top = `${Math.max(8, up ? r.top - h - 6 : r.bottom + 6)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, document.documentElement.clientWidth - w - 8))}px`;
}
const menuItems = (menu) => $$(".menu-action:not(:disabled):not([hidden])", menu);
for (const m of barMenus) {
  m.btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") m.keys = true;
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); m.keys = e.key === "ArrowUp" ? "last" : true; if (!m.menu.matches(":popover-open")) m.menu.showPopover(); }
  });
  m.menu.addEventListener("toggle", (e) => {
    const open = e.newState === "open";
    m.btn.setAttribute("aria-expanded", String(open));
    if (open) {
      placeBarMenu(m);
      if (m.keys) menuItems(m.menu)[m.keys === "last" ? menuItems(m.menu).length - 1 : 0]?.focus();
    }
    m.keys = false;
  });
  m.menu.addEventListener("keydown", (e) => {
    const items = menuItems(m.menu), i = items.indexOf(document.activeElement);
    let to = null;
    if (e.key === "ArrowDown") to = items[(i + 1) % items.length];
    else if (e.key === "ArrowUp") to = items[(i - 1 + items.length) % items.length];
    else if (e.key === "Home") to = items[0];
    else if (e.key === "End") to = items.at(-1);
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeBarMenu(); return; }
    else if (e.key === "Tab") {
      // Tab leaves the menu for the next (Shift: previous) bar control; the closing menu never takes the focus.
      e.preventDefault();
      m.menu.hidePopover();
      const list = barControls(), i = list.indexOf(m.btn);
      (list[i + (e.shiftKey ? -1 : 1)] || m.btn).focus();
      return;
    }
    else return;
    e.preventDefault();
    to?.focus();
  });
}
let selTimer = 0;
document.addEventListener("selectionchange", () => { refreshLinks(true); clearTimeout(selTimer); selTimer = setTimeout(showBar, 120); together?.caret(); });
addEventListener("scroll", () => { if (!bar.hidden && barSel?.range) { placeBar(barSel.range); for (const m of barMenus) if (m.menu.matches(":popover-open")) placeBarMenu(m); } if (!card.hidden && cardFor) positionCard(cardFor); positionShotCard(); }, { passive: true });
addEventListener("resize", () => { if (document.activeElement === $("#askInput")) fitAsk(true); if (!bar.hidden && barSel?.range) { placeBar(barSel.range); for (const m of barMenus) if (m.menu.matches(":popover-open")) placeBarMenu(m); } positionShotCard(); });
bar.addEventListener("pointerdown", (e) => { if (!e.target.closest("input")) e.preventDefault(); });
bar.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) makeAsk(b.dataset.act); });
$("#askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#askInput").value.trim();
  if (q) makeAsk("ask", q);
});
$("#askInput").addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // A bar menu opened with the mouse leaves the focus here: Escape closes only that menu and keeps the typed ask.
  if (closeBarMenu()) { e.preventDefault(); e.stopPropagation(); return; }
  hideBar();
});
// The field grows when focused, but only into the room the screen has; the bar is placed again as it grows and shrinks.
function fitAsk(focused) {
  const input = $("#askInput");
  if (focused) {
    // Measured against the field's resting width (7rem) and the bar's full content, so neither an already-widened
    // field (no transition with reduced motion) nor the bar's own width cap hides how much room there is.
    const rest = 7 * parseFloat(getComputedStyle(document.documentElement).fontSize);
    const controls = $(".edit-bar__controls", bar);
    const barAtRest = bar.offsetWidth - controls.offsetWidth + controls.scrollWidth - input.offsetWidth + rest;
    input.style.setProperty("--ask-max", `${rest + Math.max(0, document.documentElement.clientWidth - 16 - barAtRest)}px`);
  }
  if (!bar.hidden && barSel?.range) placeBar(barSel.range);
}
$("#askInput").addEventListener("focusin", () => fitAsk(true));
$("#askInput").addEventListener("focusout", () => fitAsk(false));
$("#askInput").addEventListener("transitionend", () => fitAsk(false));

function makeAsk(action, typed = "") {
  const s = barSel;
  if (!s || !state.doc) return;
  const b = byId(s.id);
  if (!b) return hideBar();
  const content = D.contentOf(b);
  let { start, end } = s;
  if (content.slice(start, end) !== s.quote) {
    const r = D.reanchor({ start, quote: s.quote }, content);
    if (!r) return hideBar();
    ({ start, end } = r);
  }
  hideBar();
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
  if (!ask || !C.isMarked(ask) || !may(ask)) return;
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
async function permitted(handle, ask, mode = "readwrite") {
  const o = { mode };
  try {
    if (!handle.queryPermission) return true;
    if ((await handle.queryPermission(o)) === "granted") return true;
    return ask ? (await handle.requestPermission(o)) === "granted" : false;
  } catch { return false; }
}

const draftKey = (name = state.name) => `draft:${name}`;
function persistDraft() {
  clearTimeout(draftTimer);
  if (!state.doc || state.pendingDraft || state.guest) return;
  // Open asks, and the agent's changes still marked, each with its exact place (so their mark and Undo come back
  // after a reload only there).
  // Waiting pictures (step K) stay out: local storage is small. After a reload a sketch ask's shot waits for its
  // sketch again; a suggested add shows without its picture.
  const open = C.withContext(state.asks.filter((a) => isOpen(a) || C.isMarked(a)), state.doc).map(B.withoutPictures);
  const dirty = isDirty();
  const flags = brollFlags();
  if (!dirty && !open.length && !flags) { store.del(draftKey()); return; }
  store.set(draftKey(), { text: dirty ? saveText() : null, at: Date.now(), asks: open, ...(flags ? { broll: flags } : {}) });
}

function loadText(text, { name, handle = null, modified = 0, fresh = false, browser = false }) {
  // Leaving a script: write what is still waiting to its own file, and keep a draft as a safety net.
  if (state.doc) { persistDraft(); flushSave(); }
  // A new script left as it came is not kept: empty ones would pile up in the browser.
  if (state.doc && state.inBrowser && state.blank && handle !== state.handle && D.serialize(state.doc) === state.blank && !state.asks.length) {
    deleteBrowserScript({ handle: state.handle, name: state.name });
  }
  // Sharing ends when another script opens; the same file read again from disk stays shared.
  if (together?.active && !(handle && handle === state.handle)) together.stop();
  $("#emptyNote").hidden = true;
  hideBar();
  closeCard();
  closeBroll();
  state.doc = D.parse(text);
  state.name = name;
  state.handle = handle;
  state.inBrowser = !!handle && browser;
  state.blank = "";
  state.savedText = fresh ? "" : text;
  if (fresh) state.savedText = D.serialize(state.doc);
  state.savedAt = fresh ? 0 : modified;
  state.fileModified = modified;
  state.saveError = "";
  state.needsPermission = false;
  state.conflict = false;
  clearTimeout(saveTimer);
  state.undo = [];
  state.redo = [];
  state.lastStep = null;
  state.asks = [];
  changeBase = null;
  state.pendingDraft = null;
  state.frontOpen = false;
  state.hint = null;
  const draft = store.get(draftKey(name));
  broll.flags = draft?.broll && typeof draft.broll === "object" ? { ...draft.broll } : {};
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
    B.cleanSketches(a); // a draft holds what storage gave it
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
  if (broll.status === "ok" || broll.status === "none") dropGoneSuggestions();
  hideBanner();
  rematchBroll(true);
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
  if (broll.status === "ok" || broll.status === "none") dropGoneSuggestions();
  store.del(draftKey());
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
    for (const known of [state.handle, saveQueue.waiting?.handle, ...(saveQueue.left || []).map((x) => x.handle)]) {
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

async function writeHandle(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
  try { return (await handle.getFile()).lastModified; } catch { return Date.now(); }
}
// Auto-save: about 1.5 s after the last change, to the opened file only. Ctrl/Cmd+S and page hide save at once.
const AUTOSAVE_MS = 1500;
function scheduleSave() {
  clearTimeout(saveTimer);
  if (slash.open) return; // a "/" command is being typed: auto-save waits until the menu closes
  if (state.handle && !state.conflict && isDirty()) saveTimer = setTimeout(() => save({ auto: true }), AUTOSAVE_MS);
}
function flushSave() {
  clearTimeout(saveTimer);
  if (state.handle && !state.conflict && isDirty()) save({ auto: true });
}
async function allowSaving() {
  if (!state.handle) return;
  if (await permitted(state.handle, true)) { state.needsPermission = false; renderSaveState(); save(); }
  else { state.needsPermission = false; state.saveError = "No permission to write this file."; renderSaveState(); }
}
// Saves asked for while another one runs wait here, one record per script (see save-queue.js).
let saveQueue = Q.emptyQueue();
const saveRequest = (force, auto) => ({
  handle: state.handle, name: state.name, text: saveText(),
  savedText: state.savedText, fileModified: state.fileModified, force, auto,
});
// A script the person left could not be written: its draft is stamped now, so reopening it offers "Unsaved changes from …".
function keepDraft(name, text) {
  const draft = store.get(draftKey(name));
  store.set(draftKey(name), { text, at: Date.now(), asks: draft?.asks ?? [], ...(draft?.broll ? { broll: draft.broll } : {}) });
}
// Write a left script's snapshot straight to its own file, with auto-save rules: no permission prompt, and the
// changed-on-disk check. Current `state` is never touched.
// The file's time when it changed on disk since our last write (and holds other text), else 0.
async function diskConflict(handle, request) {
  if (request.force || !request.fileModified) return 0;
  const f = await handle.getFile();
  if (f.lastModified <= request.fileModified) return 0;
  return Q.changedOnDisk(request, { lastModified: f.lastModified, text: await f.text() }) ? f.lastModified : 0;
}
async function writeLeft(snap) {
  try {
    if (await permitted(snap.handle, false)) {
      if (!(await diskConflict(snap.handle, snap))) {
        return { handle: snap.handle, text: snap.text, modified: await writeHandle(snap.handle, snap.text) };
      }
    }
  } catch { /* kept as a draft below */ }
  keepDraft(snap.name, snap.text);
  return null;
}
async function save({ force = false, auto = false } = {}) {
  if (!state.doc || state.guest) return;
  if (state.saving) {
    // Auto-save without a file does nothing; a click without a file waits for its turn to pick one.
    if (state.handle || !auto) saveQueue = Q.queueSave(saveQueue, saveRequest(force, auto));
    return;
  }
  // Auto-save only writes to a file that is already open; it never asks where to save.
  if (!state.handle && auto) return;
  if (!state.handle) return browserSaving ? saveInBrowser() : saveAs();
  clearTimeout(saveTimer);
  const { handle, name, savedText, fileModified } = state;
  const text = saveText();
  let written = null;
  state.saving = true;
  state.autoSaving = auto;
  state.saveError = "";
  renderSaveState();
  try {
    // A click or key press may show the browser's permission prompt; auto-save may not, so it shows "Allow saving to …".
    if (!(await permitted(handle, !auto))) {
      if (auto) { if (handle === state.handle) state.needsPermission = true; }
      else throw new Error("No permission to write this file.");
    } else {
      if (handle === state.handle) state.needsPermission = false;
      const conflict = await diskConflict(handle, { force, fileModified, savedText });
      if (conflict && handle === state.handle) {
        state.conflict = true;
        showBanner(`The file changed on disk at ${clock(conflict)}`, [["Save mine", () => { hideBanner(); state.conflict = false; save({ force: true }); }], ["Open that version", () => reloadFromDisk()]]);
      } else if (!conflict) {
        // Written to the file it was made for, even if another script was opened meanwhile.
        written = { handle, text, modified: await writeHandle(handle, text) };
        if (handle === state.handle) {
          state.fileModified = written.modified;
          state.conflict = false;
          state.savedText = text;
          state.savedAt = Date.now();
          if ($("#banner").textContent.startsWith("The file changed")) hideBanner();
          // A rename that fails leaves the old name; the text is saved either way.
          try { await followTitle(handle); } catch { /* keeps its name */ }
        }
      }
    }
  } catch (e) {
    // A script the person already left keeps its local draft; its problem must not show on the new one.
    if (handle === state.handle) state.saveError = e?.message || "Could not save.";
  }
  if (!written && handle !== state.handle) keepDraft(name, text);
  // Scripts the person left go straight to their own files; requests that arrive meanwhile keep waiting.
  saveQueue = Q.settleQueue(saveQueue, written);
  for (;;) {
    const { left, current } = Q.splitQueue(saveQueue, state.handle);
    if (!left.length) { saveQueue = Q.emptyQueue(); state.saving = false; finishSave(current); return; }
    saveQueue = { waiting: current, left: [] };
    for (const snap of left) saveQueue = Q.settleQueue(saveQueue, await writeLeft(snap));
  }
}
function finishSave(current) {
  state.autoSaving = false;
  renderTop();
  persistDraft();
  // The open script's own waiting request runs with its own flags.
  if (current) save({ force: current.force, auto: current.auto });
  else if (!state.saveError && !state.needsPermission) scheduleSave();
}
// "Markdown file (.md)" and Ctrl/Cmd+S without an open file: pick where to save, then keep auto-saving there.
async function saveAs() {
  if (!state.doc || state.saving || state.guest) return;
  const text = saveText();
  const was = state.inBrowser ? state.handle : null;
  // Where files can't be saved, a script in the browser stays there and a copy downloads.
  if (was && !("showSaveFilePicker" in window)) return download(text, state.name, "text/markdown");
  state.saveError = "";
  try {
    if ("showSaveFilePicker" in window) {
      let handle;
      try { handle = await window.showSaveFilePicker({ suggestedName: state.name, types: FILE_TYPES }); }
      catch (e) { if (e?.name === "AbortError") return; throw e; }
      state.saving = true;
      renderSaveState();
      state.fileModified = await writeHandle(handle, text);
      if (handle.name !== state.name) {
        store.del(draftKey());
        // The file's name takes this script's B-roll link and list, or none. A script leaving the browser frees its
        // name there, so its old keys are cleared; a file on disk or the demo keeps its own.
        moveKeys(state.name, handle.name, { clear: !!was, link: broll.link });
        state.name = handle.name;
      }
      state.handle = handle;
      state.inBrowser = false;
      state.blank = "";
      state.needsPermission = false;
      state.conflict = false;
      remember(handle);
      // The script moved to its file: the copy in the browser goes.
      if (was) {
        const gone = was.name;
        forget(was).then(() => scriptsDir()).then((d) => d.removeEntry(gone)).catch(() => {});
      }
    } else {
      download(text, state.name, "text/markdown");
    }
    state.savedText = text;
    state.savedAt = Date.now();
  } catch (e) {
    state.saveError = e?.message || "Could not save.";
  }
  state.saving = false;
  // Requests made during a save-as belonged to the old place; the new file is now current.
  saveQueue = Q.emptyQueue();
  renderTop();
  renderDerived();
  persistDraft();
  scheduleSave();
}
async function reloadFromDisk() {
  hideBanner();
  if (!state.handle) return;
  // Keep what is on screen as a draft, so "Restore" brings it back.
  if (isDirty()) store.set(draftKey(), { text: saveText(), at: Date.now(), asks: state.asks.filter(isOpen), ...(brollFlags() ? { broll: brollFlags() } : {}) });
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
function exportFile(kind) {
  if (!state.doc || state.guest) return;
  if (kind === "camera") download(D.exportCamera(state.doc), `${baseName()}-camera.txt`, "text/plain");
  else if (kind === "prompter") download(D.exportPrompter(state.doc), `${baseName()}-prompter.md`, "text/markdown");
  else if (kind === "prompter-open") openPrompter();
  else if (kind === "markdown") saveAs();
  else if (kind === "all") exportAll();
  else if ((kind === "broll" || kind === "storyboard") && broll.status === "ok") {
    const f = brollExports()[kind === "broll" ? 0 : 1];
    download(f.text, f.name, kind === "broll" ? "text/markdown" : "text/html");
  }
}
// The B-roll list and the storyboard, as the single exports and "Export all" give them.
function brollExports() {
  const shots = B.scriptOrder(state.doc, broll.shots), title = D.titleOf(state.doc) || baseName();
  return [
    { name: `${baseName()}-broll.md`, text: B.exportBroll(shots, broll.sketches, { title }) },
    { name: `${baseName()}-storyboard.html`, text: B.exportStoryboard(shots, broll.sketches, { title, missing: (s) => !covered(s).length }) },
  ];
}

// "Export all" (Lex, 2026-10-29): one zip with the script, the camera script, the prompter file and, with a B-roll
// list, the list and the storyboard.
function exportAll() {
  const base = baseName();
  const files = [
    { name: /\.(md|markdown|txt)$/i.test(state.name) ? state.name : `${base}.md`, text: saveText() },
    { name: `${base}-camera.txt`, text: D.exportCamera(state.doc) },
    { name: `${base}-prompter.md`, text: D.exportPrompter(state.doc) },
  ];
  if (broll.status === "ok") files.push(...brollExports());
  download(makeZip(files), `${base}.zip`, "application/zip");
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
$("#allowSave").addEventListener("click", allowSaving);
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
    return store.get(draftKey(n)) != null || (!!state.doc && l === state.name.toLowerCase());
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
  const draft = store.get(draftKey(from));
  if (draft != null) { store.set(draftKey(to), draft); store.del(draftKey(from)); }
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
// Ctrl/Cmd+S on a script without a file (the demo, or a file opened where files can't be saved): into the browser.
async function saveInBrowser() {
  if (!state.doc || state.saving || state.guest) return;
  const doc = state.doc, text = saveText(), from = state.name;
  state.saving = true;
  state.saveError = "";
  renderSaveState();
  try {
    const { handle, modified } = await createBrowserScript(D.scriptFileName("", doc, await nameTaken(from)), text);
    if (state.doc === doc) {
      moveKeys(from, handle.name, { link: broll.link });
      Object.assign(state, { name: handle.name, handle, inBrowser: true, fileModified: modified, savedText: text, savedAt: Date.now(), needsPermission: false, conflict: false });
    }
    remember(handle, true);
  } catch (e) {
    if (state.doc === doc) state.saveError = e?.message || "Could not save.";
  }
  state.saving = false;
  saveQueue = Q.emptyQueue();
  renderTop();
  renderDerived();
  persistDraft();
  scheduleSave();
}
// Its draft and B-roll keys go too: they are by name, as for every script (a file opened later under the same name
// starts without them).
async function deleteBrowserScript(r) {
  await forget(r.handle);
  try { await (await scriptsDir()).removeEntry(r.handle.name); } catch { /* gone already */ }
  store.del(draftKey(r.name));
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
  if (k === "s") { e.preventDefault(); save(); return; }
  if (!state.doc || e.target.closest?.("input, textarea")) return;
  if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (k === "y" && e.ctrlKey && !e.metaKey) { e.preventDefault(); redo(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // An open bar menu (from the mouse too, or with nothing usable in it) closes alone; the bar stays.
  if (closeBarMenu()) { e.preventDefault(); return; }
  hideBar(); closeCard(); closeShotCard(); if (broll.lit) lightShot(broll.lit, false);
});
addEventListener("beforeunload", (e) => {
  persistDraft();
  flushSave();
  if (isDirty() && !state.guest) { e.preventDefault(); e.returnValue = ""; }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { persistDraft(); flushSave(); } });
addEventListener("pagehide", () => { persistDraft(); flushSave(); });

/* ---------- Icons in the static markup ---------- */
$$("[data-icon]").forEach((el) => {
  if (el.classList.contains("menu-action__copy") || el.tagName === "BUTTON") el.innerHTML = icon(el.dataset.icon);
  else el.outerHTML = icon(el.dataset.icon);
});
$$("#editBar [data-act]").forEach((b) => (b.innerHTML = `${icon(ACT_ICON[b.dataset.act])}<span class="edit-bar__text">${esc(D.ACTIONS[b.dataset.act].name)}</span>`));


/* ---------- B-roll: sketch frames beside the lines, the storyboard view ---------- */
const KIND_ICON = { broll: "film", motion: "motion", screen: "screen" };
const KIND_NAME = B.KIND_NAME;
const brollKey = (name = state.name) => `broll:${name}`;
// Every read and write of a script's B-roll link goes through one queue, in the order they were made, so a move to
// a new name (step J) and a link or unlink made meanwhile never cross. The name is taken when the call is made.
let brollKeys = Promise.resolve();
function keyed(fn) {
  const run = brollKeys.then(fn);
  brollKeys = run.catch(() => {});
  return run;
}
const getLinkKey = (name = state.name) => keyed(() => idbGet(brollKey(name)));
const setLinkKey = (value, name = state.name) => keyed(() => idbSet(brollKey(name), value));
const shotById = (id) => broll.shots.find((s) => s.id === id) || null;
const wrapOf = (id) => (id ? scriptEl.querySelector(`.line[data-wrap="${CSS.escape(id)}"]`) : null);
const covered = (s) => (s.blockIds || []).filter((id) => byId(id));
const sketchAsk = () => state.asks.find((a) => a.scope === "broll" && a.action === "sketch" && isOpen(a)) || null;
const planAsk = () => state.asks.find((a) => a.scope === "broll" && a.action === "plan" && isOpen(a)) || null;
const pendingSketch = (id) => sketchAsk()?.answer?.sketches?.[id] || "";
function brollFlags() {
  const out = {};
  if (broll.status === "ok") for (const s of broll.shots) { if (s.check) out[s.id] = true; }
  else Object.assign(out, broll.flags);
  return Object.keys(out).length ? out : null;
}
function syncFlags() {
  broll.flags = brollFlags() || {};
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 400);
}

// Leaving a script: the old list goes with it.
function closeBroll() {
  broll.token++;
  closeShotCard();
  ui.scriptY = 0;
  Object.assign(broll, { link: null, status: "none", err: "", text: "", shots: [], sketches: {}, flags: {}, lit: null, filter: "all", saving: {}, problem: {}, marked: {} });
  renderBroll();
}
async function loadBroll() {
  const token = ++broll.token;
  if (!state.doc || state.guest) return; // guests get the host's list (setRoomBroll)
  // "none" must mean "no list linked", so the list counts as loading while its link is looked up.
  broll.status = "loading";
  let link = await getLinkKey();
  if (token !== broll.token) return;
  // The demo script links its own made-up list.
  if (!link && state.name === SAMPLE.name) link = { demo: true, name: SAMPLE_BROLL.name };
  if (!link || link.none) { broll.status = "none"; dropGoneSuggestions(); return renderBroll(); }
  broll.link = link;
  await readBroll(token, true);
}
async function readBroll(token, ask) {
  const link = broll.link;
  broll.status = "loading";
  renderBroll();
  let text = null;
  const kept = link.handle ? null : await getKept();
  try {
    if (typeof kept === "string") text = kept;
    else if (link.handle) {
      if (!(await permitted(link.handle, ask, "read"))) {
        if (token === broll.token) { broll.status = "permission"; renderBroll(); }
        return;
      }
      text = await (await link.handle.getFile()).text();
    } else if (typeof link.text === "string") text = link.text;
    else if (link.demo) {
      const res = await fetch(SAMPLE_BROLL.url, { cache: "no-store" });
      if (!res.ok) throw new Error(res.statusText);
      text = await res.text();
    }
  } catch { text = null; }
  if (token !== broll.token) return;
  if (text == null) { broll.status = "error"; renderBroll(); return; }
  adoptBroll(text);
}
function adoptBroll(text) {
  const { shots, sketches } = B.parseBroll(text);
  if (state.doc) B.matchShots(state.doc, shots);
  for (const s of shots) s.check = !!broll.flags[s.id];
  Object.assign(broll, { text, shots, sketches, status: "ok", err: "" });
  if (broll.lit && !shotById(broll.lit)) broll.lit = null;
  dropGoneSuggestions();
  renderBroll();
}
// After a reload or restore the block ids are new: match every shot again. Otherwise only the ones not found.
function rematchBroll(all) {
  if (broll.status !== "ok" || !state.doc) return;
  const list = B.spokenBlocks(state.doc);
  let moved = false;
  for (const s of broll.shots) {
    if (!all && covered(s).length) continue;
    const ids = B.matchOver(list, s.over);
    if (!ids.length && !all) continue;
    if (ids.join() !== (s.blockIds || []).join()) moved = true;
    s.blockIds = ids;
    s.sig = B.coverText(state.doc, ids);
  }
  if (moved) renderBroll();
}
// A covered line changed (typing, Keep, undo): its shot gets "Check".
function brollTouched() {
  if (broll.status !== "ok" || !state.doc) return;
  if (!B.touchShots(state.doc, broll.shots).length) { placeFrames(); return; }
  syncFlags();
  renderBroll();
}
// Everything that shows the list: the frames in the script, the storyboard and the export items.
function renderBroll() {
  renderBrollMarks();
  renderBoard();
  together?.sync(); // the host shares the list with guests when it changed
  const ok = broll.status === "ok";
  for (const b of $$('#exportMenu [data-export="broll"], #exportMenu [data-export="storyboard"]')) b.disabled = !ok;
  for (const n of $$('#exportMenu [data-note="broll"]')) n.hidden = ok;
}

/* One sketch frame, as in the script and the storyboard. Pending agent sketches carry Keep / Undo. */
// A line drawing, or a picture (step K; its data address was checked where it came in).
const sketchSvg = (svg, label) => (svg.startsWith("data:image/") ? `<img src="${svg}" alt="${esc(label)}" decoding="async">`
  : svg.replace("<svg ", label ? `<svg role="img" aria-label="${esc(label)}" ` : '<svg aria-hidden="true" '));
const markedSketch = (id) => { const m = broll.marked[id]; return !!m && !state.guest && broll.sketches[id] === m.pic; };
function frameImg(s, label) {
  const pending = pendingSketch(s.id);
  const svg = pending || broll.sketches[s.id] || "";
  const ask = sketchAsk();
  const waiting = !svg && ask && ask.shots.some((x) => x.id === s.id) && !ask.answer?.done?.[s.id];
  const marked = !pending && markedSketch(s.id);
  return `<span class="frame__img"${svg ? "" : " data-empty"}${pending || marked ? " data-pending" : ""}${waiting ? " data-waiting" : ""}>${svg ? sketchSvg(svg, label ? `Sketch ${s.id}` : "") : ""}</span>`;
}
function keepBar(s) {
  const ask = sketchAsk();
  // A picture put in at once (step K2): only Undo.
  if (!pendingSketch(s.id) && markedSketch(s.id)) {
    return `<span class="change__bar frame__bar">${broll.problem[s.id] ? `<span class="frame__problem" title="${esc(broll.problem[s.id])}">Not saved</span>` : ""}<button type="button" class="undo" data-act="mark-undo" data-b="${esc(s.id)}"${broll.saving[s.id] ? " disabled" : ""}>${icon("undo")}Undo</button></span>`;
  }
  if (!pendingSketch(s.id) || state.guest) return ""; // guests see the sketch; the host keeps or undoes it
  return `<span class="change__bar frame__bar" data-ask="${esc(ask.id)}">${broll.problem[s.id] ? `<span class="frame__problem" title="${esc(broll.problem[s.id])}">Not saved</span>` : ""}<button type="button" class="undo" data-act="undo" data-b="${esc(s.id)}">${icon("undo")}Undo</button><button type="button" class="keep" data-act="keep" data-b="${esc(s.id)}"${broll.saving[s.id] ? " disabled" : ""}>${icon("check")}Keep</button></span>`;
}
// Re-rendering keeps the keyboard where it was (the same frame, or the same button in it).
function focusKey(root) {
  const f = document.activeElement?.closest?.("[data-b], [data-act]");
  if (!f || !root.contains(f)) return null;
  return { b: f.dataset.b, s: f.dataset.s, act: f.dataset.act || "" };
}
function refocus(root, key) {
  if (!key) return;
  const sel = (act) => `${key.b ? `[data-b="${CSS.escape(key.b)}"]` : ""}${key.s ? `[data-s="${CSS.escape(key.s)}"]` : ""}${act ? `[data-act="${CSS.escape(act)}"]` : ":not([data-act])"}`;
  (root.querySelector(sel(key.act)) || (key.b && root.querySelector(sel(""))))?.focus({ preventScroll: true });
}

/* Frames beside the first line of each shot (never part of the text), and a thin rule beside every covered line. */
function renderBrollMarks() {
  const key = focusKey(scriptEl);
  for (const t of $$(".broll-tags", scriptEl)) t.remove();
  for (const l of $$(".line[data-covered]", scriptEl)) { delete l.dataset.covered; delete l.dataset.last; delete l.dataset.lit; }
  const goesOn = new Set();
  const boxFor = (first) => {
    let box = first.querySelector(":scope > .broll-tags");
    if (!box) { box = h("div", "broll-tags", { "data-skip": "", contenteditable: "false" }); first.prepend(box); }
    return box;
  };
  for (const s of broll.status === "ok" ? broll.shots : []) {
    const ids = covered(s);
    ids.forEach((id, i) => {
      const w = wrapOf(id);
      if (!w) return;
      w.dataset.covered = "";
      if (i < ids.length - 1) goesOn.add(w);
      if (broll.lit === s.id) w.dataset.lit = "";
    });
    const first = wrapOf(ids[0]);
    if (!first) continue;
    const box = boxFor(first);
    const lit = broll.lit === s.id;
    const label = `${KIND_NAME[s.kind]} ${s.id}: ${s.what}${s.check ? " · Check" : ""}`;
    const sug = suggestionsFor(s.id);
    box.insertAdjacentHTML("beforeend", `<div class="shot-frame" data-kind="${s.kind}"${lit ? " data-lit" : ""}${sug.some((x) => x.c.op === "remove") ? " data-remove" : ""}>`
      + `<button class="shot-frame__jump" type="button" data-b="${esc(s.id)}" aria-pressed="${lit}" aria-label="${esc(label)}" title="${esc(s.what)}">${frameImg(s, false)}`
      + `<span class="broll-tag"${s.check ? " data-check" : ""}>${icon(KIND_ICON[s.kind])}<b>${esc(s.id)}</b></span></button>${keepBar(s)}${sug.map((x) => suggestBlock(x, s)).join("")}</div>`);
  }
  const adds = suggestedAdds();
  addsSig = adds.map((x) => `${x.key}=${x.blockIds.join()}`).join("|");
  for (const x of adds) {
    const first = wrapOf(covered(x)[0]);
    if (first) boxFor(first).insertAdjacentHTML("beforeend", suggestedFrame(x));
  }
  for (const l of $$(".line[data-covered]", scriptEl)) if (!goesOn.has(l)) l.dataset.last = "";
  refocus(scriptEl, key);
  placeFrames();
}
// Wide screens: frames sit in the right margin; one that would overlap the frame above moves down.
let framesFrame = 0;
function placeFrames() {
  cancelAnimationFrame(framesFrame);
  framesFrame = requestAnimationFrame(() => {
    const boxes = $$(".broll-tags", scriptEl);
    for (const b of boxes) b.style.removeProperty("--push");
    let bottom = -Infinity;
    const pushes = boxes.map((b) => {
      if (getComputedStyle(b).position !== "absolute") return 0;
      const r = b.getBoundingClientRect();
      const push = Math.max(0, Math.ceil(bottom + 12 - r.top));
      bottom = r.bottom + push;
      return push;
    });
    boxes.forEach((b, i) => { if (pushes[i]) b.style.setProperty("--push", `${pushes[i]}px`); });
  });
}
new ResizeObserver(() => placeFrames()).observe(scriptEl);

/* Light a shot: its lines and its frame. Lighting clears its "Check". */
function lightShot(id, scroll) {
  const s = shotById(id);
  if (!s) return;
  const on = scroll || broll.lit !== id;
  broll.lit = on ? id : null;
  if (on && s.check && !state.guest) { s.check = false; syncFlags(); } // the host's "Check" flags are shared
  renderBroll();
  if (!on) return;
  const first = wrapOf(covered(s)[0]);
  if (scroll && first) first.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "center" });
}

scriptEl.addEventListener("click", (e) => {
  const act = e.target.closest(".shot-frame [data-act]");
  if (act) {
    e.preventDefault();
    const a = act.dataset.act;
    if (a === "s-keep") return keepSuggestions([act.dataset.s]);
    if (a === "s-undo") return undoSuggestions([act.dataset.s]);
    if (a === "mark-undo") return undoMarked(act.dataset.b);
    return a === "keep" ? keepSketch(act.dataset.b) : undoSketch(act.dataset.b);
  }
  const t = e.target.closest(".shot-frame__jump");
  if (!t) return;
  // A click lights the shot and opens its card to change or remove it; a click while its card is open puts both away.
  // After Cancel or Escape the shot stays lit, and one click opens the card again.
  const id = t.dataset.b;
  if (state.guest) return lightShot(id, false); // guests can't change shots: a click only lights it
  if (!shotCard.hidden && sc.mode === "edit" && sc.id === id) { closeShotCard(); if (broll.lit === id) lightShot(id, false); return; }
  if (broll.lit !== id) lightShot(id, false);
  openShotCard({ mode: "edit", id, anchor: shotFrameAnchor(id) });
});
// Frames are not text: a copy that runs across one gives only the script's words.
scriptEl.addEventListener("copy", (e) => {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const r = sel.getRangeAt(0);
  if (!$$(".broll-tags", scriptEl).some((f) => r.intersectsNode(f))) return;
  const parts = [];
  for (const el of $$(".block", scriptEl)) {
    if (!r.intersectsNode(el) || el.closest("details:not([open])")) continue;
    const content = readContent(el);
    const start = el.contains(r.startContainer) ? offsetIn(el, r.startContainer, r.startOffset) : 0;
    const end = el.contains(r.endContainer) ? offsetIn(el, r.endContainer, r.endOffset) : content.length;
    if (end > start) parts.push(content.slice(start, end));
  }
  e.preventDefault();
  e.clipboardData?.setData("text/plain", parts.join("\n\n"));
});

async function linkBroll() {
  if (!state.doc) return;
  if (!canPick) return $("#brollInput").click();
  let handle;
  const pick = (o) => window.showOpenFilePicker({ types: FILE_TYPES, multiple: false, ...o });
  try {
    try { [handle] = await pick(state.handle ? { startIn: state.handle } : {}); }
    catch (e) { if (e?.name === "TypeError") [handle] = await pick({}); else throw e; }
  } catch (e) { if (e?.name !== "AbortError") $("#brollInput").click(); return; }
  setLink({ handle, name: handle.name });
}
$("#brollInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file || !state.doc) return;
  try { setLink({ name: file.name, text: await file.text() }); }
  catch { broll.link = { name: file.name }; broll.status = "error"; renderBroll(); }
});
async function setLink(link) {
  const token = ++broll.token;
  // Changing the list closes the sketch ask made for the old one.
  const ask = sketchAsk();
  if (ask) { closeAsk(ask, ask.status === "answered" ? "undone" : "cancelled"); changed(); }
  delKept();
  broll.link = link;
  broll.marked = {};
  broll.flags = {};
  broll.lit = null;
  broll.saving = {};
  broll.problem = {};
  setLinkKey(link);
  await readBroll(token, true);
  if (token === broll.token) { syncFlags(); renderBroll(); }
}
function unlinkBroll() {
  broll.token++;
  // The demo links its list by itself, so unlinking it is remembered.
  setLinkKey(state.name === SAMPLE.name ? { none: true } : null);
  delKept();
  const ask = sketchAsk();
  if (ask) { closeAsk(ask, ask.status === "answered" ? "undone" : "cancelled"); changed(); }
  Object.assign(broll, { link: null, status: "none", err: "", text: "", shots: [], sketches: {}, flags: {}, lit: null, filter: "all", saving: {}, problem: {}, marked: {} });
  dropGoneSuggestions();
  syncFlags();
  renderBroll();
}

/* ---------- Script | Storyboard: the switch in the top bar (remembered) ---------- */
function setView(v) {
  const board = v === "board";
  if (board === (ui.view === "board")) return;
  if (board) ui.scriptY = scrollY;
  ui.view = board ? "board" : "script";
  store.set("view", ui.view);
  hideBar();
  closeCard();
  closeShotCard();
  renderView();
  scrollTo({ top: board ? 0 : ui.scriptY });
}
function renderView() {
  const board = ui.view === "board" && !!state.doc;
  $("#layout").dataset.view = board ? "board" : "";
  for (const b of $$("#viewSwitch button")) b.setAttribute("aria-pressed", String(b.dataset.view === (board ? "board" : "script")));
  renderBoard();
  if (!board) placeFrames();
}
$("#viewSwitch").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });

/* ---------- Storyboard: every frame in script order ---------- */
const FILTERS = [
  ["all", "All", () => true],
  ["broll", "B-roll", (s) => s.kind === "broll"],
  ["motion", "Motion plates", (s) => s.kind === "motion"],
  ["screen", "Screen", (s) => s.kind === "screen"],
];
function boardHead() {
  if (state.guest) return broll.status === "ok" ? `<div class="board__file">${icon("film")}<span class="board__name">${esc(broll.link?.name || "B-roll list")}</span></div>` : "";
  const show = B.boardHeadState(broll.link, broll.status);
  const more = planAction() + keepAllAction();
  if (show.link) return `<button class="board__link" type="button" data-act="link">${icon("film")}Link B-roll list…</button>${more}`;
  const name = esc(broll.link.name || "B-roll list");
  const ask = sketchAsk();
  let action = "";
  if (show.note) action = `<p class="board__note">Couldn't open ${name}</p>`;
  else if (show.allow) action = `<button class="board__link" type="button" data-act="allow">${icon("film")}Allow reading ${name}</button>`;
  else if (show.ask) {
    const missing = broll.shots.filter((s) => !broll.sketches[s.id] && !pendingSketch(s.id));
    const waiting = ask && (ask.status === "waiting" || ask.status === "taken");
    const asking = ask && ask.status === "answered" && ask.shots.some((s) => !ask.answer.done?.[s.id] && !ask.answer.sketches?.[s.id]);
    if (waiting || asking) action = `<span class="board__wait" data-taken="${ask.status === "taken"}"><span class="status-dot"></span>Waiting for sketches<button class="icon-btn" type="button" data-act="cancel" aria-label="Cancel">${icon("x")}</button></span>`;
    else if (!ask && missing.length) action = `<button class="board__ask" type="button" data-act="ask">${icon("sketch")}Ask for sketches</button>`;
  }
  const unsaved = show.saveAs ? `<p class="board__unsaved">Not saved to a file${"showSaveFilePicker" in window ? `<span aria-hidden="true">·</span><button class="board__btn" type="button" data-act="save-list">Save as…</button>` : ""}${broll.err ? `<span class="board__problem" title="${esc(broll.err)}">Not saved</span>` : ""}</p>` : "";
  return `<div class="board__file">${icon("film")}<span class="board__name">${name}</span><button class="board__btn" type="button" data-act="link">Change…</button><button class="board__btn" type="button" data-act="unlink">Unlink</button></div>${unsaved}${action}${more}`;
}
function boardFrame(s, missing) {
  if (s.suggested) return suggestedBoardFrame(s, missing);
  const check = s.check ? '<span class="check-note">Check</span>' : "";
  const sug = suggestionsFor(s.id);
  return `<li class="frame" data-b="${esc(s.id)}"${broll.lit === s.id ? ' aria-current="true"' : ""}${missing ? " data-missing" : ""}${sug.some((x) => x.c.op === "remove") ? " data-remove" : ""}>`
    + `<button class="frame__jump" type="button" data-b="${esc(s.id)}">${frameImg(s, true)}`
    + `<span class="frame__cap"><b>${esc(s.id)}</b><span class="kind-tag" data-kind="${s.kind}">${KIND_NAME[s.kind]}</span>${check} ${esc(s.what)}<span class="frame__over">Over: ${esc(s.over || "–")}</span></span></button>${keepBar(s)}${sug.map((x) => suggestBlock(x, s)).join("")}</li>`;
}
function renderBoard() {
  const el = $("#board");
  if (ui.view !== "board" || !state.doc) { el.hidden = true; el.replaceChildren(); return; }
  const key = focusKey(el);
  el.hidden = false;
  let body = "";
  const real = broll.status === "ok" ? broll.shots : [];
  const adds = suggestedAdds();
  if (real.length || adds.length) {
    // Suggested adds count in no filter until they are kept; they show under "All".
    const counts = FILTERS.map(([id, name, keep]) => [id, name, keep, real.filter(keep).length]).filter((f) => f[3] > 0);
    const current = counts.find((f) => f[0] === broll.filter) || counts[0] || ["all", "All", () => true, 0];
    const chips = counts.map(([id, name, , n]) => `<button class="chip" type="button" data-act="filter" data-filter="${id}" aria-pressed="${id === current[0]}">${name} · ${n}</button>`).join("");
    const order = B.scriptOrder(state.doc, [...real.filter(current[2]), ...(current[0] === "all" ? adds : [])]);
    const found = order.filter((s) => covered(s).length), lost = order.filter((s) => !covered(s).length);
    body = (chips ? `<div class="board__filters" role="group" aria-label="Show">${chips}</div>` : "")
      + (found.length ? `<ol class="board__grid">${found.map((s) => boardFrame(s, false)).join("")}</ol>` : "")
      + (lost.length ? `<h2 class="board__lost">Not found in the script</h2><ol class="board__grid" data-missing>${lost.map((s) => boardFrame(s, true)).join("")}</ol>` : "");
  }
  el.innerHTML = `<div class="board__bar">${boardHead()}</div>${body}`;
  refocus(el, key);
}
$("#board").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]");
  if (act) {
    const a = act.dataset.act;
    if (state.guest && a !== "filter") return; // guests only look at the list
    if (a === "link") linkBroll();
    else if (a === "unlink") unlinkBroll();
    else if (a === "allow") { const t = ++broll.token; readBroll(t, true); }
    else if (a === "filter") { broll.filter = act.dataset.filter; renderBoard(); }
    else if (a === "save-list") saveListAs();
    else if (a === "plan") requestPlan();
    else if (a === "plan-cancel") cancelPlan();
    else if (a === "s-keep") keepSuggestions([act.dataset.s]);
    else if (a === "s-undo") undoSuggestions([act.dataset.s]);
    else if (a === "s-keep-all") keepSuggestions(bulkKeys());
    else if (a === "s-undo-all") undoSuggestions(bulkKeys());
    else if (a === "ask") requestSketches();
    else if (a === "cancel") cancelSketches();
    else if (a === "keep") keepSketch(act.dataset.b);
    else if (a === "undo") undoSketch(act.dataset.b);
    else if (a === "mark-undo") undoMarked(act.dataset.b);
    return;
  }
  const jump = e.target.closest(".frame__jump");
  if (!jump) return;
  // Back to the script, with this shot's lines lit and its card open.
  setView("script");
  lightShot(jump.dataset.b, true);
  if (!state.guest) openShotCard({ mode: "edit", id: jump.dataset.b, anchor: shotFrameAnchor(jump.dataset.b) });
});

/* ---------- Sketch asks: the agent draws the missing frames, the person keeps or undoes each ---------- */
function requestSketches() {
  if (!state.doc || broll.status !== "ok") return null;
  const missing = broll.shots.filter((s) => !broll.sketches[s.id]);
  if (!missing.length) return null;
  const old = sketchAsk();
  if (old) closeAsk(old, old.status === "answered" ? "kept" : "cancelled");
  const ask = D.makeAsk(state.doc, { scope: "broll", action: "sketch", by: me });
  ask.shots = missing.map((s) => ({ id: s.id, what: s.what, over: s.over, kind: s.kind }));
  state.asks.push(ask);
  emit("created", ask);
  renderBroll();
  changed();
  offerAsks();
  return ask;
}
// Stop waiting: sketches already shown keep their Keep / Undo.
function cancelSketches() {
  const ask = sketchAsk();
  if (!ask) return;
  if (ask.status !== "answered") closeAsk(ask, "cancelled");
  else {
    for (const s of ask.shots) if (!ask.answer.sketches[s.id] && !ask.answer.done[s.id]) ask.answer.done[s.id] = "undone";
    settleSketches(ask);
  }
  renderBroll();
  changed();
}
function receiveSketch(ask, shotId, svg, by) {
  ask.answer ??= { kind: "sketches", sketches: {}, done: {} };
  ask.answer.sketches[shotId] = svg;
  delete ask.answer.done[shotId];
  ask.answeredBy = validBy(by);
  ask.status = "answered";
  delete broll.problem[shotId];
  emit("answered", ask);
  renderBroll();
  renderAgent();
  changed();
  // A picture for a shot in the list: the promise says whether it went in (else it waits for Keep).
  return putsInAtOnce(shotId, svg) ? pictureInAtOnce(ask, shotId, svg) : null;
}
// A picture for a shot in the list (step K2) goes into the list at once, lightly marked, with Undo, like a replace
// answer; a line drawing still waits for Keep. If the write fails it stays waiting, with Keep and "Not saved".
const putsInAtOnce = (shotId, sketch) => B.isImage(sketch) && broll.status === "ok" && !!shotById(shotId) && !state.guest;
// → "in", "waits" (not written: Keep, Undo and "Not saved" show, or another write for the shot runs) or "changed" (the
// list changed meanwhile, so nothing waits).
async function pictureInAtOnce(ask, id, pic) {
  const prev = broll.sketches[id] || "", token = broll.token;
  await keepSketch(id);
  if (token !== broll.token) return "changed";
  if (ask.answer?.done?.[id] !== "kept" || broll.sketches[id] !== pic) return "waits";
  broll.marked[id] = { prev, pic, askId: ask.id };
  renderBroll();
  return "in";
}
// sketch_shot answers once the picture is written, but within the Worker's 10 s for a call: after 7 s it says the
// picture is still being written (B.sketchAnswer), and its place is freed only once it went in.
const WRITE_ANSWER_MS = 7000;
const sketchAnswer = (atOnce, left = []) => B.sketchAnswer(atOnce, left, WRITE_ANSWER_MS);
// Undo puts back what the shot had before (a sketch, or none), if the agent's picture is still there.
async function undoMarked(id) {
  const m = broll.marked[id];
  if (!m || broll.saving[id]) return;
  if (broll.sketches[id] !== m.pic) { delete broll.marked[id]; return renderBroll(); }
  // Like keepSketch: if the list changes meanwhile, this Undo is gone with it and touches nothing of the new one (whoever
  // moves the token resets `saving` and `marked` for the list it brings).
  const token = broll.token;
  broll.saving[id] = true;
  delete broll.problem[id];
  renderBroll();
  try {
    await changeList((md) => (m.prev ? B.setSketch(md, id, m.prev) : B.removeSketch(md, id)));
    if (token !== broll.token) return;
    delete broll.marked[id];
    const ask = state.asks.find((a) => a.id === m.askId);
    if (ask?.answer?.done) {
      ask.answer.done[id] = "undone";
      if (!isOpen(ask)) ask.status = Object.values(ask.answer.done).includes("kept") ? "kept" : "undone";
    }
    changed();
  } catch (e) {
    if (token !== broll.token) return;
    broll.problem[id] = e?.message || "Could not save the B-roll list.";
  }
  delete broll.saving[id];
  renderBroll();
}
function settleSketches(ask) {
  const done = ask.answer?.done || {};
  if (!ask.shots.every((s) => done[s.id])) return;
  closeAsk(ask, Object.values(done).includes("kept") ? "kept" : "undone");
}
function undoSketch(id) {
  const ask = sketchAsk();
  if (!ask?.answer?.sketches?.[id]) return;
  delete ask.answer.sketches[id];
  ask.answer.done[id] = "undone";
  delete broll.problem[id];
  settleSketches(ask);
  renderBroll();
  changed();
}
// Keep writes the sketch into the B-roll file's "## Sketches" section, so it stays with the file.
let brollWrites = Promise.resolve();
async function keepSketch(id) {
  const ask = sketchAsk();
  const svg = B.cleanSketch(ask?.answer?.sketches?.[id] || "");
  if (!svg || broll.saving[id]) return;
  const token = broll.token;
  broll.saving[id] = true;
  delete broll.problem[id];
  renderBroll();
  try {
    // One file write at a time: two quick Keeps must not both read the old file.
    const run = brollWrites.then(() => writeSketch(id, svg));
    brollWrites = run.catch(() => {});
    await run;
    if (token !== broll.token) return;
    broll.sketches[id] = svg;
    delete ask.answer.sketches[id];
    ask.answer.done[id] = "kept";
    settleSketches(ask);
    changed();
  } catch (e) {
    if (token === broll.token) broll.problem[id] = e?.message || "Could not save the sketch.";
  }
  if (token !== broll.token) return;
  delete broll.saving[id];
  renderBroll();
}
async function writeSketch(id, svg) {
  const link = broll.link;
  if (!link) throw new Error("No B-roll list is linked.");
  if (link.handle) {
    if (!(await permitted(link.handle, true))) throw new Error(`No permission to write ${link.handle.name}.`);
    const now = await (await link.handle.getFile()).text();
    const next = B.setSketch(now, id, svg);
    await writeHandle(link.handle, next);
    broll.text = next;
  } else {
    // The demo list and lists without a file handle are kept in this browser (see keepList).
    const next = B.setSketch(broll.text, id, svg);
    await keepList(next);
    broll.text = next;
  }
}

/* ---------- Add, change and remove a shot (step C3): the shot card ---------- */
// Lists without a file (the demo, a list opened without a handle, a new list whose picker was cancelled, the list of
// a script in the browser) are kept in this browser per script. Since step K they live in IndexedDB, which has room
// for pictures; one left in local storage from before moves over when it is read. They go through the same queue as
// the B-roll links (keyed), so a rename and a write never cross. Discarding script changes leaves them alone.
const listKey = (name = state.name) => `brollList:${name}`;
async function readKept(name) {
  const kept = await idbGet(listKey(name));
  if (typeof kept === "string") return kept;
  const old = store.get(listKey(name));
  if (typeof old !== "string") return null;
  if (await idbPut(listKey(name), old).then(() => true, () => false)) store.del(listKey(name));
  return old;
}
const getKept = (name = state.name) => keyed(() => readKept(name));
const delKept = (name = state.name) => keyed(async () => { await idbSet(listKey(name), null); store.del(listKey(name)); });
async function keepList(text, name = state.name) {
  try { await keyed(() => idbPut(listKey(name), text)); }
  catch { throw new Error("This browser could not keep the B-roll list."); }
}
// One write to the list at a time (the same queue as the sketch Keep): read the newest text, change it, write it.
function changeList(mutate) {
  const token = broll.token, link = broll.link;
  const run = brollWrites.then(async () => {
    if (!link || token !== broll.token) throw new Error("The B-roll list changed.");
    if (link.handle) {
      if (!(await permitted(link.handle, true))) throw new Error(`No permission to write ${link.handle.name}.`);
      const now = await (await link.handle.getFile()).text();
      const next = mutate(now);
      if (next !== now) await writeHandle(link.handle, next);
      return next;
    }
    const next = mutate(broll.text);
    // The open script's name now (a rename queued its move before this write), and the token says it is still open.
    await keepList(next, state.name);
    return next;
  });
  brollWrites = run.catch(() => {});
  return run.then((next) => {
    if (token !== broll.token) return next;
    broll.flags = brollFlags() || {};
    adoptBroll(next);
    syncFlags();
    return next;
  });
}
// The first Add without a list makes one: a file next to the script where the browser can, else kept here.
async function startList() {
  const text = B.newList(D.titleOf(state.doc) || baseName());
  const name = `${baseName()}-broll.md`;
  const token = ++broll.token;
  let link = null;
  // A script in the browser (step J) keeps its list in the browser too; "Save as…" in the storyboard makes it a file.
  if ("showSaveFilePicker" in window && !state.inBrowser) {
    // Only a cancelled picker keeps the list in the browser; any other problem shows "Not saved" in the card.
    const pick = (o) => window.showSaveFilePicker({ suggestedName: name, types: FILE_TYPES, ...o });
    let handle = null;
    try {
      try { handle = await pick(state.handle ? { startIn: state.handle } : {}); }
      catch (e) { if (e?.name === "TypeError") handle = await pick({}); else throw e; }
    } catch (e) { if (e?.name !== "AbortError") throw e; }
    if (handle) {
      const run = brollWrites.then(() => writeHandle(handle, text));
      brollWrites = run.catch(() => {});
      await run;
      link = { handle, name: handle.name };
    }
  }
  if (token !== broll.token) throw new Error("The script changed.");
  if (!link) { link = { name, draft: true }; await keepList(text); }
  else delKept();
  // Keep "saving": a Keep that made this list is still writing, and a second click must not add the shot twice.
  Object.assign(broll, { link, flags: {}, lit: null, problem: {} });
  setLinkKey(link);
  adoptBroll(text);
}
// "Not saved to a file · Save as…": the kept list becomes a file and the linked list.
async function saveListAs() {
  if (broll.status !== "ok" || !broll.link || broll.link.handle || !("showSaveFilePicker" in window)) return;
  const token = broll.token;
  let handle;
  const pick = (o) => window.showSaveFilePicker({ suggestedName: broll.link.name || `${baseName()}-broll.md`, types: FILE_TYPES, ...o });
  try {
    try { handle = await pick(state.handle ? { startIn: state.handle } : {}); }
    catch (e) { if (e?.name === "TypeError") handle = await pick({}); else throw e; }
  } catch { return; }
  const run = brollWrites.then(() => writeHandle(handle, broll.text));
  brollWrites = run.catch(() => {});
  try { await run; } catch (e) { if (token === broll.token) { broll.err = e?.message || "Could not save the list."; renderBoard(); } return; }
  if (token !== broll.token) return;
  broll.link = { handle, name: handle.name };
  broll.err = "";
  setLinkKey(broll.link);
  delKept();
  renderBroll();
}

// The spoken paras a selection touches, with the selected part of each (the matcher only reads spoken paras).
function spokenSelection(range) {
  if (!state.doc || !range) return [];
  const spoken = new Set(B.spokenBlocks(state.doc).map((b) => b.id));
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
const canAddBroll = () => !state.guest && (broll.status === "ok" || broll.status === "none");

const shotCard = $("#shotCard");
const sc = { mode: "add", id: null, sel: null, anchor: null, kind: "broll", busy: false };
function renderShotCard() {
  for (const b of $$("#scKind button")) b.setAttribute("aria-pressed", String(b.dataset.kind === sc.kind));
  $("#scHowField").hidden = sc.kind === "screen";
  $("#scSave").disabled = sc.busy || !$("#scWhat").value.trim();
  $("#scRemove").disabled = sc.busy;
}
function positionShotCard() {
  if (shotCard.hidden || !sc.anchor || matchMedia("(max-width: 40rem)").matches) return;
  const a = sc.anchor();
  if (!a) return;
  const rects = a.getClientRects();
  const r = rects[rects.length - 1] || a.getBoundingClientRect();
  const w = shotCard.offsetWidth, ht = shotCard.offsetHeight;
  const x = Math.max(8, Math.min(r.left, document.documentElement.clientWidth - w - 8));
  let y = r.bottom + 8;
  if (y + ht > innerHeight - 8) y = Math.max($(".top").getBoundingClientRect().bottom + 8, r.top - ht - 8);
  shotCard.style.setProperty("--card-x", x + "px");
  shotCard.style.setProperty("--card-y", y + "px");
}
function openShotCard(o) {
  closeCard();
  hideBar();
  const s = o.mode === "edit" ? shotById(o.id) : null;
  if (o.mode === "edit" && !s) return;
  Object.assign(sc, { mode: o.mode, id: s?.id ?? null, sel: o.sel ?? null, anchor: o.anchor, kind: s?.kind || "broll", busy: false });
  $("#scTitle").textContent = s ? `${s.id} · ${KIND_NAME[s.kind]}` : "Add B-roll";
  $("#scWhat").value = s?.what || "";
  $("#scHow").value = s?.how || "";
  $("#scRemove").hidden = !s;
  $("#scSave").textContent = s ? "Save" : "Add";
  $("#scProblem").hidden = true;
  renderShotCard();
  shotCard.hidden = false;
  positionShotCard();
  $("#scWhat").focus({ preventScroll: true });
}
function closeShotCard(refocus = false) {
  if (shotCard.hidden) return;
  shotCard.hidden = true;
  const id = sc.mode === "edit" ? sc.id : null;
  sc.anchor = null;
  if (refocus && id) scriptEl.querySelector(`.shot-frame__jump[data-b="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}
function failShotCard(e) {
  sc.busy = false;
  const p = $("#scProblem");
  p.hidden = false;
  p.title = e?.message || "Could not save the B-roll list.";
  renderShotCard();
}
$("#addBroll").addEventListener("click", () => {
  const s = barSel;
  if (!s?.range || !canAddBroll()) return;
  const sel = spokenSelection(s.range);
  if (!sel.length) return;
  const range = s.range.cloneRange();
  openShotCard({ mode: "add", sel, anchor: () => range });
});
$("#scKind").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (!b || sc.busy) return;
  sc.kind = b.dataset.kind;
  renderShotCard();
});
$("#scWhat").addEventListener("input", renderShotCard);
// One line that can wrap: Enter adds (or saves) instead of starting a new line.
$("#scWhat").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); shotCard.requestSubmit(); }
});
shotCard.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeShotCard(true); } });
$("#scCancel").addEventListener("click", () => closeShotCard(true));
shotCard.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (sc.busy || !state.doc) return;
  const what = $("#scWhat").value.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!what) return $("#scWhat").focus();
  // A screen recording's card hides How: its cell in the file stays as it is.
  const how = sc.kind === "screen" ? undefined : $("#scHow").value.replace(/\s+/g, " ").trim().slice(0, 120);
  const { kind, mode, id } = sc;
  sc.busy = true;
  $("#scProblem").hidden = true;
  renderShotCard();
  try {
    if (mode === "add") {
      const over = B.overFor(state.doc, sc.sel || []);
      if (broll.status === "none") await startList();
      if (broll.status !== "ok") throw new Error("The B-roll list can't be read.");
      // The id comes from the newest text, so a file changed elsewhere still gets a free one.
      await changeList((md) => {
        const now = B.parseBroll(md);
        return B.addShot(md, { id: B.nextShotId(now.shots, kind, now.sketches), kind, what, over, how });
      });
    } else {
      await changeList((md) => B.updateShot(md, id, { kind, what, how }));
    }
    sc.busy = false;
    closeShotCard(true);
  } catch (err) { failShotCard(err); }
});
$("#scRemove").addEventListener("click", async () => {
  if (sc.busy || sc.mode !== "edit") return;
  const id = sc.id;
  sc.busy = true;
  renderShotCard();
  try {
    await changeList((md) => B.removeShot(md, id));
    // A sketch the agent was asked for, or one waiting for Keep or Undo, goes with the shot.
    const ask = sketchAsk();
    if (ask?.shots?.some((s) => s.id === id) && !ask.answer?.done?.[id]) {
      ask.answer ??= { kind: "sketches", sketches: {}, done: {} };
      delete ask.answer.sketches[id];
      ask.answer.done[id] = "undone";
      settleSketches(ask);
      changed();
    }
    delete broll.problem[id];
    if (broll.lit === id) broll.lit = null;
    sc.busy = false;
    closeShotCard();
    renderBroll();
  } catch (err) { failShotCard(err); }
});
// A press outside the card closes it (frames reopen it on their own click).
document.addEventListener("pointerdown", (e) => {
  if (shotCard.hidden || shotCard.contains(e.target) || e.target.closest?.(".shot-frame__jump")) return;
  closeShotCard();
}, true);
const shotFrameAnchor = (id) => () => scriptEl.querySelector(`.shot-frame__jump[data-b="${CSS.escape(id)}"]`);

/* ---------- B-roll suggestions from the agent (step C4): Keep or Undo per change ---------- */
function receiveBroll(ask, answer, by) {
  ask.answer = answer;
  ask.answeredBy = validBy(by);
  ask.status = "answered";
  emit("answered", ask);
  // The selection's highlight and chip give way to the suggestions beside the lines.
  if (ask.scope === "selection" && byId(ask.blockId)) renderBlock(ask.blockId, getCaret());
  renderBroll();
  renderTocDots();
  renderAgent();
  changed();
}
// A shot that is gone (removed, or the list changed) takes its open update or removal with it, so the ask settles
// and "Plan B-roll" comes back.
function dropGoneSuggestions() {
  const shots = broll.status === "ok" ? broll.shots : [];
  let dropped = 0;
  for (const a of state.asks) {
    if (!isBrollAnswer(a)) continue;
    const n = B.dropGone(a.answer, shots, (i) => !!broll.saving[`${a.id}:${i}`]);
    if (n) { dropped += n; settleSuggestions(a); }
  }
  if (dropped) changed();
}
// Every change still waiting for Keep or Undo, in ask order, with a stable key "askId:index".
function openSuggestions() {
  const out = [];
  for (const a of state.asks) {
    if (!isBrollAnswer(a)) continue;
    a.answer.changes.forEach((c, n) => { if (c.state === "open") out.push({ ask: a, n, c, key: `${a.id}:${n}` }); });
  }
  return out;
}
const suggestionsFor = (id) => openSuggestions().filter((x) => x.c.op !== "add" && x.c.id === id);
// Suggested adds look like shots; their lines are found from the Over each time, so an edit can move one to
// "Not found in the script", where it can still be kept or undone.
function suggestedAdds() {
  const list = state.doc ? B.spokenBlocks(state.doc) : [];
  return openSuggestions().filter((x) => x.c.op === "add")
    .map((x) => ({ ...x, suggested: true, kind: x.c.kind, what: x.c.what, how: x.c.how, over: x.c.over, why: x.c.why, sketch: x.c.sketch || "", blockIds: B.matchOver(list, x.c.over) }));
}
let addsSig = "";
function refreshSuggestions() {
  const sig = suggestedAdds().map((x) => `${x.key}=${x.blockIds.join()}`).join("|");
  if (sig !== addsSig) { addsSig = sig; renderBroll(); }
}
function suggestBar(x) {
  if (state.guest) return ""; // guests see suggestions; the host keeps or undoes them
  const k = esc(x.key);
  return `<span class="change__bar suggest__bar">${broll.problem[x.key] ? '<span class="suggest__problem">Not saved</span>' : ""}`
    + `<button type="button" class="undo" data-act="s-undo" data-s="${k}">${icon("undo")}Undo</button>`
    + `<button type="button" class="keep" data-act="s-keep" data-s="${k}"${broll.saving[x.key] ? " disabled" : ""}>${icon("check")}Keep</button></span>`;
}
const struck = (old, now) => `<del>${esc(old || "–")}</del> <ins>${esc(now || "–")}</ins>`;
// A change or a removal shown on the shot it is about.
function suggestBlock(x, s) {
  const c = x.c;
  let body = "";
  if (c.op === "remove") body = '<p class="suggest__head">Remove?</p>';
  else {
    body = '<p class="suggest__head">Suggested</p>';
    if (c.kind && c.kind !== s.kind) body += `<p>${struck(KIND_NAME[s.kind], KIND_NAME[c.kind])}</p>`;
    if (c.what != null && c.what !== s.what) body += `<p>${struck(s.what, c.what)}</p>`;
    if (c.how != null && c.how !== s.how) body += `<p class="suggest__how">${struck(s.how, c.how)}</p>`;
  }
  if (c.why) body += `<p class="suggest__why">${esc(c.why)}</p>`;
  return `<div class="suggest" data-op="${c.op}">${body}${suggestBar(x)}</div>`;
}
const addText = (x) => `<p class="suggest__what">${esc(x.what)}</p>${x.how ? `<p class="suggest__how">${esc(x.how)}</p>` : ""}${x.why ? `<p class="suggest__why">${esc(x.why)}</p>` : ""}`;
// A suggested add's own sketch (step I), or an empty frame. Sketches are cleaned where they come in: checkBrollAnswer,
// a restored draft (adoptAsks) and a guest's copy (setRoomAsks).
const suggestedImg = (x) => (x.sketch ? `<span class="frame__img" data-pending>${sketchSvg(x.sketch, "")}</span>` : '<span class="frame__img" data-empty></span>');
// A suggested add beside its line: the frame dashed in orange, the tag "Suggested", What, How, Keep and Undo.
const suggestedFrame = (x) => `<div class="shot-frame" data-suggested data-kind="${x.kind}"><div class="shot-frame__pic">${suggestedImg(x)}`
  + `<span class="broll-tag">${icon(KIND_ICON[x.kind])}Suggested</span></div><div class="suggest" data-op="add">${addText(x)}${suggestBar(x)}</div></div>`;
const suggestedBoardFrame = (x, missing) => `<li class="frame" data-suggested${missing ? " data-missing" : ""}><div class="frame__body">${suggestedImg(x)}`
  + `<span class="frame__cap"><span class="kind-tag" data-kind="suggested">Suggested</span><span class="kind-tag" data-kind="${x.kind}">${KIND_NAME[x.kind]}</span> ${esc(x.what)}`
  + `${x.how ? `<span class="frame__over">${esc(x.how)}</span>` : ""}<span class="frame__over">Over: ${esc(x.over || "–")}</span>${x.why ? `<span class="frame__over suggest__why">${esc(x.why)}</span>` : ""}</span></div>${suggestBar(x)}</li>`;

/* "Plan B-roll": one ask for the whole script. */
function requestPlan() {
  if (!state.doc || planAsk()) return null;
  const ask = D.makeAsk(state.doc, { scope: "broll", action: "plan", by: me });
  state.asks.push(ask);
  emit("created", ask);
  renderBroll();
  changed();
  offerAsks();
  return ask;
}
function cancelPlan() {
  const ask = planAsk();
  if (!ask || ask.status === "answered") return;
  closeAsk(ask, "cancelled");
  renderBroll();
  changed();
}
function planAction() {
  if (!state.doc || !(broll.status === "ok" || broll.status === "none")) return "";
  const ask = planAsk();
  if (!ask) return `<button class="board__ask" type="button" data-act="plan">${icon("suggest")}Plan B-roll</button>`;
  if (ask.status === "answered") return "";
  return `<span class="board__wait" data-taken="${ask.status === "taken"}"><span class="status-dot"></span>Waiting for a B-roll plan<button class="icon-btn" type="button" data-act="plan-cancel" aria-label="Cancel">${icon("x")}</button></span>`;
}
// "Keep all · Undo all" shows once while an answer with several changes still has some waiting,
// and acts on the waiting changes of those answers only (one-change answers keep their own Keep and Undo).
const bulkKeys = () => openSuggestions().filter((x) => x.ask.answer.changes.length > 1).map((x) => x.key);
function keepAllAction() {
  if (!bulkKeys().length) return "";
  return `<span class="board__all"><button class="board__btn" type="button" data-act="s-keep-all">Keep all</button><span aria-hidden="true">·</span><button class="board__btn" type="button" data-act="s-undo-all">Undo all</button></span>`;
}

/* Keep writes through addShot / updateShot / removeShot and the one-write-at-a-time queue; Undo writes nothing. */
function findSuggestion(key) {
  const i = String(key).lastIndexOf(":");
  const ask = state.asks.find((a) => a.id === key.slice(0, i));
  const n = Number(key.slice(i + 1));
  const c = ask && isBrollAnswer(ask) ? ask.answer.changes[n] : null;
  return c ? { ask, n, c, key } : null;
}
function settleSuggestions(ask) {
  const status = B.settleBroll(ask.answer);
  if (!status) return;
  closeAsk(ask, status);
  if (ask.scope === "selection" && byId(ask.blockId)) renderBlock(ask.blockId, getCaret());
}
function undoSuggestions(keys) {
  for (const key of keys) {
    const x = findSuggestion(key);
    if (!x || x.c.state !== "open" || broll.saving[key]) continue;
    x.c.state = "undone";
    delete broll.problem[key];
    settleSuggestions(x.ask);
  }
  renderBroll();
  renderTocDots();
  changed();
}
async function keepSuggestions(keys) {
  const items = keys.map(findSuggestion).filter((x) => x && x.c.state === "open" && !broll.saving[x.key]);
  if (!items.length) return;
  for (const x of items) { broll.saving[x.key] = true; delete broll.problem[x.key]; }
  renderBroll();
  try {
    // No list yet: the first Keep makes one, as "Add B-roll" does.
    if (broll.status === "none") await startList();
    if (broll.status !== "ok") throw new Error("The B-roll list can't be read.");
    // One queued write: every change in order, each add with the next free id at that moment. Only a change that
    // really applied counts as kept; one whose shot is gone becomes undone.
    const changes = items.flatMap((x) => B.changesToKeep(x.ask.answer, [x.n]));
    let report = null;
    await changeList((md) => { report = B.applyBrollChangesReport(md, changes); return report.markdown; });
    items.forEach((x, i) => { x.c.state = report?.applied[i] ? "kept" : "undone"; });
    for (const ask of new Set(items.map((x) => x.ask))) settleSuggestions(ask);
    changed();
  } catch (e) {
    for (const x of items) broll.problem[x.key] = e?.message || "Could not save the B-roll list.";
  }
  for (const x of items) delete broll.saving[x.key];
  renderBroll();
  renderTocDots();
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
const slashOnSpokenLine = (cmd) => canAddBroll() && B.spokenBlocks(state.doc).some((x) => x.id === cmd.id)
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
  scheduleSave();
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
    return openShotCard({ mode: "add", sel: [{ id, start: words.start, end: words.end }], anchor: () => blockNode(id) });
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
    if (e.data instanceof ArrayBuffer) return receivePictureBytes(e.data);
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
    receivePictureHead(m);
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
const askForAgent = (a) => B.askForAgent(a, {
  spokenText: a.scope === "selection" || a.action === "sketch" || !state.doc ? "" : D.exportCamera(state.doc),
  shots: broll.status === "ok" ? broll.shots : [],
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
    broll: broll.status === "ok" ? broll.shots.map(B.forAgent) : [],
  };
}
function handleCall({ id, tool, args = {} }) {
  const ws = agent.ws;
  let send = (payload) => { try { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "result", id, ...payload })); } catch { /* closed */ } };
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
    if (tool === "upload_image") return void pictureAddress().then(send, failed);
    if (tool === "sketch_shot" || tool === "answer_broll") {
      const used = withPictures(args);
      if (used.error) return send({ error: used.error });
      args = used.args;
      // Gone through: the pictures now live in the shot or the suggestion, and their places are free (step K2).
      // An answer sent while the picture is still being written (`later`) frees it only once it went in.
      if (used.used.length) {
        const reply = send, free = () => { for (const u of used.used) pictures.delete(u); };
        send = ({ later, ...payload }) => {
          if (!payload.error) { if (later) later.then((o) => { if (o !== "changed") free(); }, () => {}); else free(); }
          reply(payload);
        };
      }
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
      return send({ result: C.answerResult(checked.answer.kind) });
    }
    if (tool === "answer_broll") {
      if (args.askId == null) return send(ownBroll(args));
      const ask = state.asks.find((a) => a.id === args.askId);
      const checked = B.checkBrollAnswer(ask, args, { doc: state.doc, shots: broll.status === "ok" ? broll.shots : [] });
      if (checked.error) return send({ error: checked.error });
      receiveBroll(ask, checked.answer, agentBy());
      return send({ result: "Shown to the person. They choose Keep or Undo per change." });
    }
    if (tool === "sketch_shot") {
      if (args.askId == null) { const out = ownSketch(args); return out instanceof Promise ? void out.then(send, failed) : send(out); }
      const ask = state.asks.find((a) => a.id === args.askId);
      const checked = B.checkSketch(ask, args);
      if (checked.error) return send({ error: checked.error });
      const atOnce = receiveSketch(ask, args.shotId, checked.svg, agentBy());
      if (!atOnce) return send({ result: B.sketchResult("shown") });
      return void sketchAnswer(atOnce).then(send, failed);
    }
    send({ error: `Unknown tool: ${tool}` });
  } catch (e) {
    send({ error: `The editor could not do that: ${e?.message || e}` });
  }
}

/* ---------- Pictures from the agent as sketches (step K, Lex 2026-10-29) ---------- */
// upload_image gives a one-time address; the agent sends the file there, the Worker passes it through the relay in
// parts, and the tab shrinks it and keeps it here, in memory only, until sketch_shot or answer_broll uses its id:
// a call that uses it frees its place at once (step K2); the picture then lives in the shot or the suggestion.
// Only pictures not used yet hold a place: 24, a whole storyboard in one go (at most about 10 MB in memory).
const UPLOAD_MS = 15 * 60_000, PICTURE_MS = 30 * 60_000, PICTURES_MAX = 24;
const pictureRoom = () => B.pictureRoom(pictures.values(), Date.now(), { max: PICTURES_MAX, uploadMs: UPLOAD_MS, pictureMs: PICTURE_MS });
const pictures = new Map(); // id → { at, data: "" (waiting for the file) | data address }
function prunePictures() {
  const now = Date.now();
  // A picture still being shrunk stays: its imageId is about to be given out.
  for (const [id, p] of pictures) if (!p.busy && now - p.at > (p.data ? PICTURE_MS : UPLOAD_MS)) pictures.delete(id);
  for (const [id, x] of incoming) if (now - x.at > 60_000) incoming.delete(id);
}
async function pictureAddress() {
  prunePictures();
  const room = pictureRoom();
  if (!room.free) return { error: B.noRoomMessage(room, PICTURES_MAX, Date.now()) };
  const id = D.newId(22);
  pictures.set(id, { at: Date.now(), data: "" });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(agent.token));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const url = `${location.origin}/mcp/images/${hash}/${id}`;
  return { result: { url, how: `curl -sS -X PUT -H "Content-Type: image/png" --data-binary @picture.png "${url}"`, note: "The answer gives the imageId for sketch_shot or an answer_broll add; using it frees its place.", freePlaces: room.free - 1 } };
}
// The relay sends a JSON head, then the picture's bytes in binary parts (each: the head's id, 36 bytes; its number,
// 4 bytes; the bytes). The tab answers the head's id once: the imageId, or why not.
const incoming = new Map(); // relay id → { code, mime, parts, list, got, at }
function replyPicture(id, payload) {
  try { agent.ws?.send(JSON.stringify({ type: "result", id, ...payload })); } catch { /* closed */ }
}
function receivePictureHead(m) {
  const parts = Number(m.parts);
  if (!(Number.isInteger(parts) && parts >= 1 && parts <= 64)) return replyPicture(m.id, { error: "The picture did not arrive whole." });
  prunePictures();
  const p = pictures.get(m.code);
  if (!p || p.data || p.busy || state.guest) return replyPicture(m.id, { error: "This address is not valid (any more). Call upload_image again." });
  if (!B.IMAGE_TYPES.includes(m.mime)) return replyPicture(m.id, { error: "Send a PNG, JPEG or WebP picture." });
  incoming.set(m.id, { code: m.code, mime: m.mime, parts, size: Number(m.size), list: [], got: 0, at: Date.now() });
}
function receivePictureBytes(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 40) return;
  const id = new TextDecoder().decode(new Uint8Array(buf, 0, 36));
  const part = new DataView(buf).getUint32(36);
  const x = incoming.get(id);
  if (!x || part >= x.parts) return;
  if (!x.list[part]) { x.list[part] = new Uint8Array(buf, 40); x.got++; }
  if (x.got < x.parts) return;
  incoming.delete(id);
  const p = pictures.get(x.code);
  // One-time: the first picture to arrive whole takes the address.
  if (!p || p.data || p.busy) return replyPicture(id, { error: "This address is not valid (any more). Call upload_image again." });
  if (x.list.reduce((n, b) => n + b.byteLength, 0) !== x.size) return replyPicture(id, { error: "The picture did not arrive whole. Send it again." });
  p.busy = true;
  shrinkPicture(new Blob(x.list, { type: x.mime })).then((pic) => {
    Object.assign(p, { data: pic.data, at: Date.now(), busy: false });
    replyPicture(id, { result: { imageId: x.code, width: pic.width, height: pic.height } });
  }, (e) => { pictures.delete(x.code); replyPicture(id, { error: e?.message || "The editor could not read the picture." }); });
}
// At most 960 × 720, as JPEG, small enough to keep in the B-roll list (B.IMAGE_MAX).
async function shrinkPicture(blob) {
  let bitmap;
  try { bitmap = await createImageBitmap(blob); }
  catch { throw new Error("The editor could not read the picture. Send a PNG, JPEG or WebP file."); }
  try {
    for (const [max, quality] of [[960, 0.82], [960, 0.65], [720, 0.65], [480, 0.6]]) {
      const scale = Math.min(1, max / bitmap.width, (max * 0.75) / bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      Object.assign(canvas, { width, height });
      const g = canvas.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, width, height);
      g.drawImage(bitmap, 0, 0, width, height);
      const data = canvas.toDataURL("image/jpeg", quality);
      if (B.isImage(data)) return { data, width, height };
    }
  } finally { bitmap.close?.(); }
  throw new Error("The picture could not be made small enough.");
}
// sketch_shot { imageId } and answer_broll adds { imageId }: the picture's data address takes the svg's or sketch's place.
function withPictures(args) {
  prunePictures();
  const lookup = (id) => pictures.get(id)?.data || "";
  const unknown = (id) => ({ error: `Unknown imageId ${JSON.stringify(String(id).slice(0, 40))}: send the picture with upload_image first (an id is good for 30 minutes).` });
  // `used`: the ids to free once the call has gone through (a refused call keeps them, so the agent can try again).
  if (args.imageId != null) {
    const data = lookup(args.imageId);
    if (!data) return unknown(args.imageId);
    const { imageId, ...rest } = args;
    return { args: { ...rest, svg: data }, used: [imageId] };
  }
  if (!Array.isArray(args.changes) || !args.changes.some((c) => c?.imageId != null)) return { args, used: [] };
  const changes = [], used = [];
  for (const c of args.changes) {
    if (c?.imageId == null) { changes.push(c); continue; }
    const data = lookup(c.imageId);
    if (!data) return unknown(c.imageId);
    const { imageId, ...rest } = c;
    changes.push({ ...rest, sketch: data });
    used.push(imageId);
  }
  return { args: { ...args, changes }, used };
}

/* ---------- B-roll and sketches the person asked for in the agent's own chat (step I, Lex 2026-10-29) ---------- */
// They come in as an ask of the agent's own (own: true), already answered, so they show and are kept or undone
// exactly like the answer to "Plan B-roll" or "Ask for sketches".
function ownAsk(action, instruction) {
  const ask = D.makeAsk(state.doc, { scope: "broll", action, instruction, by: me });
  Object.assign(ask, { own: true, status: "taken", takenAt: ask.createdAt, takenBy: agentBy() });
  return ask;
}
// At most this many of the agent's own changes wait at once: each may carry an 8 KB sketch, and open answers go
// into the draft and to guests. Own sketches need no limit: one per shot in the list (a new one replaces the waiting
// one in answer.sketches), in one sketch ask at a time.
const OWN_OPEN_MAX = 2 * B.BROLL_LIMITS.changes;
function ownBroll(args) {
  if (broll.status !== "ok" && broll.status !== "none") return { error: brollUnreadable() };
  const ask = ownAsk("plan", "Your own B-roll suggestions, asked for in your chat.");
  const checked = B.checkBrollAnswer(ask, args, { doc: state.doc, shots: broll.status === "ok" ? broll.shots : [] });
  if (checked.error) return { error: checked.error };
  const waiting = openSuggestions().filter((x) => x.ask.own).length;
  if (waiting + checked.answer.changes.length > OWN_OPEN_MAX) {
    return { error: `${waiting} of your suggestions still wait for the person's Keep or Undo; at most ${OWN_OPEN_MAX} can wait at once${waiting < OWN_OPEN_MAX ? `, so send at most ${OWN_OPEN_MAX - waiting} now` : ". Ask them to keep or undo some first"}.` };
  }
  state.asks.push(ask);
  emit("created", ask);
  receiveBroll(ask, checked.answer, agentBy());
  return { result: "Shown to the person beside the script lines and in the storyboard. They choose Keep or Undo per change; a kept add keeps its sketch." };
}
function ownSketch(args) {
  if (broll.status !== "ok") return { error: broll.status === "none" ? "There is no B-roll list yet. Suggest shots with answer_broll (each add can bring its sketch)." : brollUnreadable() };
  const shot = shotById(args.shotId);
  if (!shot) return { error: `shotId must be one of the shots in the list: ${broll.shots.map((s) => s.id).join(", ") || "none yet"}.` };
  const svg = B.checkSketch({ scope: "broll", action: "sketch", status: "taken", shots: [shot] }, args);
  if (svg.error) return { error: svg.error };
  // One sketch ask at a time: an open one (also the person's) takes the shot in, else a new one of the agent's own.
  let ask = sketchAsk();
  if (!ask) {
    ask = ownAsk("sketch", "Your own sketches, asked for in your chat.");
    ask.shots = [];
    state.asks.push(ask);
    emit("created", ask);
  }
  if (!ask.shots.some((s) => s.id === shot.id)) ask.shots.push({ id: shot.id, what: shot.what, over: shot.over, kind: shot.kind });
  const atOnce = receiveSketch(ask, shot.id, svg.svg, agentBy());
  const left = ask.own ? [] : ask.shots.filter((s) => !ask.answer.sketches[s.id] && !ask.answer.done[s.id]).map((s) => s.id);
  if (!atOnce) return { result: B.sketchResult("shown", left) };
  // The answer waits for the write (at most 7 s), so it says what really happened.
  return sketchAnswer(atOnce, left);
}
function brollUnreadable() {
  return broll.status === "permission" ? "The editor needs the person's OK to read the B-roll list. Ask them to allow it in the storyboard first."
    : broll.status === "loading" ? "The B-roll list is still loading. Try again in a moment."
    : "The B-roll list can't be read. Ask the person to link it again in the storyboard.";
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
  if (together?.active) return { error: "The person is sharing this script with others; opening another one would end that. Ask them to stop sharing first." };
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
    const allowed = () => line === lineSeq && !together?.active && !(state.doc && (state.pendingDraft || state.conflict || (!state.handle && isDirty())));
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
function afterRoomOps(ops, sel) {
  followMarks(ops);
  const touched = new Set();
  let structure = false;
  for (const op of ops) {
    if (op.type === "text") touched.add(op.blockId);
    else if (op.type === "split") { moveAsks(op.blockId, op.newId, op.at, -op.at); touched.add(op.blockId).add(op.newId); structure = true; }
    else if (op.type === "merge") { moveAsks(op.blockId, op.into, 0, op.at); touched.add(op.into).add(op.blockId); structure = true; }
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
  for (const a of asks) B.cleanSketches(a); // what the room gave this guest
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
  markBase();
  const caret = getCaret();
  for (const id of new Set([...before.keys(), ...after.keys()])) if (before.get(id) !== after.get(id) && byId(id)) renderBlock(id, caret);
  renderTocDots();
  renderVoice();
  if (brollSig(asks) !== brollBefore) renderBroll();
  else refreshSuggestions();
}
// Host: the B-roll list as guests get it (in the snapshot and after each change).
function brollShare() {
  // A large list goes to guests without its pictures (step K): room messages stay small.
  const text = broll.text.length > 700_000 ? B.withoutPictureLines(broll.text) : broll.text;
  return broll.status === "ok" ? { status: "ok", name: broll.link?.name || "B-roll list", text, flags: brollFlags() || {} } : { status: "none" };
}
// Guest: the host's B-roll list, shown as the host shows it (no file, no changes from here).
function setRoomBroll(b) {
  if (!state.guest || !state.doc) return;
  if (b?.status === "ok" && typeof b.text === "string") {
    broll.link = { name: String(b.name || "B-roll list").slice(0, 120), shared: true };
    broll.flags = b.flags && typeof b.flags === "object" ? { ...b.flags } : {};
    adoptBroll(b.text);
  } else {
    Object.assign(broll, { link: null, status: "none", err: "", text: "", shots: [], sketches: {}, flags: {}, lit: null, marked: {} });
    renderBroll();
  }
}
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
  if (first) scrollTo({ top: 0 });
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
  note.textContent = status === "full" ? "This script already has 20 guests" : "This edit link has ended";
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
window.__scriptEditor = {
  answer: receiveAnswer,
  take: takeAsk,
  voiceCheck: () => requestVoiceCheck()?.id ?? null,
  asks: () => structuredClone(state.asks),
  markdown: () => (state.doc ? D.serialize(state.doc) : null),
  broll: () => (broll.status === "ok" ? broll.shots.map(B.forAgent) : null),
  sketchAsk: () => requestSketches()?.id ?? null,
  planAsk: () => requestPlan()?.id ?? null,
  answerBroll: (askId, args) => {
    const ask = state.asks.find((a) => a.id === askId);
    const checked = B.checkBrollAnswer(ask, args, { doc: state.doc, shots: broll.status === "ok" ? broll.shots : [] });
    if (checked.error) return checked.error;
    receiveBroll(ask, checked.answer, { id: "test", name: "Test" });
    return true;
  },
  sketch: (askId, shotId, svg) => {
    const ask = state.asks.find((a) => a.id === askId);
    const checked = B.checkSketch(ask, { shotId, svg });
    if (checked.error) return checked.error;
    receiveSketch(ask, shotId, checked.svg, { id: "test", name: "Test" });
    return true;
  },
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
