// Other people's carets and selections, drawn in a layer over any contenteditable element. The editable text is
// never touched, so typing, the browser's own caret, spell check and input methods work as before.
//
//   const carets = createCarets({ container, element: (blockId) => el, onUndo: (pid) => … , icon });
//   carets.set([{ pid, name, colour, kind, icon?, blockId, offset, selEnd?, undo }]);  carets.draw();  carets.focus(pid);
//   (`icon(key)` returns the svg markup for a key; an agent caret (kind "agent") shows `icon(p.icon || "agent")`.)
//
// `container` must be positioned (position: relative) and scroll with the text.

/** The text nodes of an editable element, without decorations marked [data-skip]. */
export function textNodes(el, skip = "[data-skip]") {
  const out = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => { const s = n.parentElement.closest(skip); return s && el.contains(s) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
  });
  for (let n; (n = w.nextNode());) out.push(n);
  return out;
}
function pointAt(nodes, el, offset) {
  let acc = 0;
  for (const t of nodes) {
    if (offset <= acc + t.data.length) return [t, offset - acc];
    acc += t.data.length;
  }
  const last = nodes.at(-1);
  return last ? [last, last.data.length] : [el, 0];
}
/** A Range for text offsets start…end inside `el`. */
export function textRange(el, start, end = start) {
  const nodes = textNodes(el);
  const r = document.createRange();
  r.setStart(...pointAt(nodes, el, Math.max(0, start)));
  r.setEnd(...pointAt(nodes, el, Math.max(0, end)));
  return r;
}
const visible = (rect) => rect && (rect.width || rect.height);

// Where a caret goes: the collapsed range's box, else the edge of the character before or after it, else the
// start of the element (an empty line).
function caretBox(el, offset, rangeAt) {
  const len = textNodes(el).reduce((n, t) => n + t.data.length, 0);
  const o = Math.min(offset, len);
  const own = [...rangeAt(el, o, o).getClientRects()].find(visible);
  if (own) return { x: own.left, top: own.top, height: own.height };
  if (o > 0) {
    const r = [...rangeAt(el, o - 1, o).getClientRects()].filter(visible).at(-1);
    if (r && r.width < 40) return { x: r.right, top: r.top, height: r.height };
  }
  if (o < len) {
    const r = [...rangeAt(el, o, o + 1).getClientRects()].find(visible);
    if (r) return { x: r.left, top: r.top, height: r.height };
  }
  const box = el.getBoundingClientRect(), cs = getComputedStyle(el);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 20;
  const rtl = cs.direction === "rtl";
  return { x: rtl ? box.right - parseFloat(cs.paddingInlineStart || 0) : box.left + parseFloat(cs.paddingInlineStart || 0), top: box.top + parseFloat(cs.paddingBlockStart || 0), height: lh };
}

const firstLetter = (name) => Array.from(String(name || "?").trim() || "?")[0].toUpperCase();
const restOf = (name) => Array.from(String(name || "").trim()).slice(1).join("");
export const colourVar = (p) => (p.kind === "agent" ? "var(--agent)" : `var(--rc-${(Number(p.colour) % 6) + 1})`);
/** The icon key in an agent's circle: its own (`p.icon`), else "agent". People show their first letter instead (""). */
export const markIcon = (p) => (p.kind === "agent" ? String(p.icon || "agent") : "");

export function createCarets({ container, element, rangeAt = textRange, onUndo, icon = () => "", colour = colourVar }) {
  const layer = document.createElement("div");
  layer.className = "rc-layer";
  container.append(layer);
  const els = new Map();
  let list = [], frame = 0;

  function make(p) {
    const s = document.createElement("span");
    s.className = "rc";
    s.tabIndex = 0;
    s.dataset.who = p.pid;
    s.innerHTML = '<span class="rc__flag"><span class="rc__mark"></span><span class="rc__name" aria-hidden="true"></span></span>';
    layer.append(s);
    return s;
  }
  function fill(s, p) {
    s.style.setProperty("--c", colour(p));
    s.setAttribute("aria-label", p.name);
    const flag = s.firstChild, agent = p.kind === "agent";
    const mark = markIcon(p);
    const key = `${p.name}|${agent}|${mark}|${p.undo}`;
    if (s.dataset.key === key) return;
    s.dataset.key = key;
    flag.toggleAttribute("data-letter", !agent);
    const box = flag.querySelector(".rc__mark");
    if (agent) box.innerHTML = icon(mark);
    else { box.replaceChildren(document.createElement("b")); box.firstChild.textContent = firstLetter(p.name); }
    flag.querySelector(".rc__name").textContent = agent ? p.name : restOf(p.name);
    let undo = flag.querySelector(".rc__undo");
    if (p.undo && !undo) {
      undo = document.createElement("button");
      undo.type = "button";
      undo.className = "rc__undo";
      undo.innerHTML = icon("undo");
      flag.append(undo);
    } else if (!p.undo && undo) undo.remove();
    undo?.setAttribute("aria-label", `Undo ${String(p.name).split(" ")[0]}'s change`);
  }

  function draw() {
    frame = 0;
    for (const old of layer.querySelectorAll(".rc-sel")) old.remove();
    const box = layer.getBoundingClientRect();
    const rtl = getComputedStyle(layer).direction === "rtl";
    const x = (px) => (rtl ? px - box.right : px - box.left);
    const seen = new Set();
    for (const p of list) {
      const el = element(p.blockId);
      if (!el || !el.getClientRects().length) continue;
      seen.add(p.pid);
      const s = els.get(p.pid) || make(p);
      els.set(p.pid, s);
      fill(s, p);
      const c = caretBox(el, p.offset, rangeAt);
      s.style.translate = `${x(c.x)}px ${c.top - box.top}px`;
      s.style.setProperty("--h", `${c.height}px`);
      if (p.selEnd != null && p.selEnd !== p.offset) {
        const r = rangeAt(el, Math.min(p.offset, p.selEnd), Math.max(p.offset, p.selEnd));
        for (const rect of r.getClientRects()) {
          if (!rect.width) continue;
          const t = document.createElement("span");
          t.className = "rc-sel";
          t.style.setProperty("--c", colour(p));
          t.style.translate = `${x(rtl ? rect.right : rect.left)}px ${rect.top - box.top}px`;
          t.style.inlineSize = `${rect.width}px`;
          t.style.blockSize = `${rect.height}px`;
          layer.prepend(t);
        }
      }
    }
    for (const [pid, s] of els) if (!seen.has(pid)) { s.remove(); els.delete(pid); }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };

  // The undo button keeps the person's own caret where it is.
  layer.addEventListener("pointerdown", (e) => { if (e.target.closest(".rc__undo")) e.preventDefault(); });
  layer.addEventListener("click", (e) => {
    const b = e.target.closest(".rc__undo");
    if (b) onUndo?.(b.closest(".rc").dataset.who);
  });
  const resize = new ResizeObserver(schedule);
  resize.observe(container);

  return {
    layer,
    set(next) { list = next; schedule(); },
    draw: schedule,
    /** Scroll to someone's caret and focus it, so their name shows. */
    focus(pid, smooth = true) {
      if (frame) { cancelAnimationFrame(frame); draw(); }
      const s = els.get(pid);
      if (!s) return false;
      s.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
      s.focus({ preventScroll: true });
      return true;
    },
    destroy() { resize.disconnect(); if (frame) cancelAnimationFrame(frame); layer.remove(); els.clear(); },
  };
}
