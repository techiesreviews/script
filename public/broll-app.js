// Loaded on first B-roll use; startup must not import this module or broll.js (TOOLS-306).
// The app supplies dependencies through host and uses the frozen interface returned by createBroll.
import * as Doc from "./doc.js";
import * as Broll from "./broll.js";
import { startPress, HOLD_MS } from "./press.js";

// Bump with any change to the host createBroll takes or the interface it returns: app.js checks it, so a tab opened
// before a release that loads this file after it never mixes the two.
export const SEAM = 4;

/**
 * createBroll(host) → the B-roll part, frozen. `host` is what it may use of the app (app.js brollHost): its state,
 * the page helpers, the ask plumbing and the stored keys; values that change are read through a function.
 */
export function createBroll(host) {
  const {
    state, ui, scriptEl, $, $$, h, icon, esc, me, reduced, FILE_TYPES, SAMPLE, SAMPLE_BROLL, canPick, agent,
    isOpen, isBrollAnswer, byId, wrapOf, baseName, readContent, offsetIn, scriptView, personInput,
    emit, changed, closeAsk, validBy, offerAsks, renderBlock, getCaret, renderTocDots, renderAgent, agentBy,
    refreshBar, brollChanged, checkpointBrollMove, queueBrollHistory, schedulePersist, hideBar, closeCard, editorJump, placeOverText, positionSlash, setView,
    getLinkKey, setLinkKey, keyed, listKey, readKept, delKept, idbPut, permitted, writeHandle, scriptKey,
  } = host;
  // The list linked to this script (see broll.js). Shots keep the block ids they cover while the file is open.
  const broll = {
    token: 0, link: null, status: "none", err: "", text: "",
    shots: [], sketches: {}, flags: {}, lit: null, filter: "all", saving: {}, problem: {},
    marked: {}, // step K2: pictures put in at once, per shot { prev, pic, askId }, with Undo until the list changes
  };

  /* ---------- B-roll: sketch frames beside the lines, the storyboard view ---------- */
  const KIND_ICON = { broll: "film", motion: "motion", screen: "screen" };
  const KIND_NAME = Broll.KIND_NAME;
  const shotById = (id) => broll.shots.find((s) => s.id === id) || null;
  // A shot being dragged to other paragraphs (steps L, L2), and whether the next click ends a drag.
  const mv = { drag: null, dropped: false };
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
    schedulePersist();
  }

  // Leaving a script: the old list goes with it.
  function closeBroll() {
    broll.token++;
    endDrag();
    closeShotCard();
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
    if (!link && state.name === SAMPLE.name) link = { demo: true, name: SAMPLE_BROLL.name };
    if (!link || link.none) { broll.status = "none"; dropGoneSuggestions(); return renderBroll(); }
    broll.link = link;
    await readBroll(token, true);
  }
  // The read under way, so a write that crossed it can wait for it (step K2).
  function readBroll(token, ask) {
    broll.reading = readBrollNow(token, ask);
    return broll.reading;
  }
  async function readBrollNow(token, ask) {
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
    const { shots, sketches } = Broll.parseBroll(text);
    // A shot whose quote is as it was stays where it shows (one moved onto a paragraph that repeats an earlier one).
    if (state.doc) Broll.matchShots(state.doc, shots, broll.shots);
    for (const s of shots) s.check = !!broll.flags[s.id];
    Object.assign(broll, { text, shots, sketches, status: "ok", err: "" });
    if (broll.lit && !shotById(broll.lit)) broll.lit = null;
    dropGoneSuggestions();
    renderBroll();
  }
  // After a reload or restore the block ids are new: match every shot again. Otherwise only the ones not found.
  function rematchBroll(all) {
    if (broll.status !== "ok" || !state.doc) return;
    const list = Broll.spokenBlocks(state.doc);
    let moved = false;
    for (const s of broll.shots) {
      if (!all && covered(s).length) continue;
      const ids = Broll.matchOver(list, s.over);
      if (!ids.length && !all) continue;
      if (ids.join() !== (s.blockIds || []).join()) moved = true;
      s.blockIds = ids;
      s.sig = Broll.coverText(state.doc, ids);
    }
    if (moved) renderBroll();
  }
  // A covered line changed (typing, Keep, undo): its shot gets "Check".
  function brollTouched() {
    if (broll.status !== "ok" || !state.doc) return;
    if (!Broll.touchShots(state.doc, broll.shots).length) { placeFrames(); return; }
    syncFlags();
    renderBroll();
  }
  // Everything that shows the list: the frames in the script, the storyboard and the export items.
  function renderBroll() {
    refreshBar(); // "add b-roll" may have become possible, or stopped being
    renderBrollMarks();
    renderBoard();
    brollChanged(); // the list for guests, the export items and the folder note
  }

  /* One sketch frame, as in the script and the storyboard. Pending agent sketches carry Keep / Undo. */
  // A line drawing, or a picture (step K; its data address was checked where it came in).
  const sketchSvg = (svg, label) => (svg.startsWith("data:image/") ? `<img src="${svg}" alt="${esc(label)}" decoding="async" draggable="false">`
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
      if (!box) {
        box = h("div", "broll-tags", { "data-skip": "", contenteditable: "false" });
        box.addEventListener("touchmove", holdPage, { passive: false }); // only here, so other touch scrolling never waits
        first.prepend(box);
      }
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
      // It can be dragged to other lines (steps L, L2), unless a change to it waits for Keep or Undo.
      const drag = !state.guest && !sug.length && !pendingSketch(s.id) && !markedSketch(s.id);
      box.insertAdjacentHTML("beforeend", `<div class="shot-frame" data-kind="${s.kind}"${lit ? " data-lit" : ""}${drag ? " data-drag" : ""}${sug.some((x) => x.c.op === "remove") ? " data-remove" : ""}>`
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
    redrag();
    placeFrames();
    renderImagesAll();
  }
  // Wide screens: frames sit in the right margin; one that would overlap the frame above moves down.
  let framesFrame = 0;
  function placeFrames() {
    cancelAnimationFrame(framesFrame);
    framesFrame = requestAnimationFrame(() => {
      const boxes = $$(".broll-tags", scriptEl);
      for (const b of boxes) b.style.removeProperty("--push");
      const wide = boxes.filter((b) => getComputedStyle(b).position === "absolute");
      const pushes = Broll.stackPushes(wide.map((b) => { const r = b.getBoundingClientRect(); return { top: r.top, height: r.height }; }));
      wide.forEach((b, i) => { if (pushes[i]) b.style.setProperty("--push", `${pushes[i]}px`); });
      if (mv.drag?.on) dragTo(mv.drag); // a dragged frame keeps to its landing place
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
    if (scroll && first) { editorJump(); first.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "center" }); }
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
    if (mv.dropped) { mv.dropped = false; return; } // the click that ends a drag (steps L, L2)
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

  /* ---------- Storyboard: every frame in script order ---------- */
  const FILTERS = [
    ["all", "All", () => true],
    ["broll", "B-roll", (s) => s.kind === "broll"],
    ["motion", "Motion plates", (s) => s.kind === "motion"],
    ["screen", "Screen", (s) => s.kind === "screen"],
  ];
  const filterCounts = (real) => FILTERS.map(([id, name, keep]) => [id, name, keep, real.filter(keep).length]).filter((f) => f[3] > 0);
  function boardFilter(real) {
    const counts = filterCounts(real);
    return counts.find((f) => f[0] === broll.filter) || counts[0] || ["all", "All", () => true, 0];
  }
  function boardHead() {
    if (state.guest) return broll.status === "ok" ? `<div class="board__file">${icon("film")}<span class="board__name">${esc(broll.link?.name || "B-roll list")}</span></div>` : "";
    const show = Broll.boardHeadState(broll.link, broll.status);
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
      const counts = filterCounts(real);
      const current = boardFilter(real);
      const chips = counts.map(([id, name, , n]) => `<button class="chip" type="button" data-act="filter" data-filter="${id}" aria-pressed="${id === current[0]}">${name} · ${n}</button>`).join("");
      const order = Broll.scriptOrder(state.doc, [...real.filter(current[2]), ...(current[0] === "all" ? adds : [])]);
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
      else if (a === "filter") { broll.filter = act.dataset.filter; renderBoard(); renderImagesAll(); }
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
    const ask = Doc.makeAsk(state.doc, { scope: "broll", action: "sketch", by: me });
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
  const putsInAtOnce = (shotId, sketch) => Broll.isImage(sketch) && broll.status === "ok" && !!shotById(shotId) && !state.guest;
  // → "in"; "waits" (not written: Keep, Undo and "Not saved" show, or another write for the shot runs; or the same list
  // was read again and the write failed, so Keep works again); or "changed" (another list or script: nothing waits).
  async function pictureInAtOnce(ask, id, pic) {
    const prev = broll.sketches[id] || "", token = broll.token;
    const wrote = await keepSketch(id);
    if (token !== broll.token) {
      const outcome = Broll.afterListMoved({ live: sketchAsk() === ask, pending: ask.answer?.sketches?.[id] === pic, written: wrote === "written" });
      if (outcome !== "changed") {
        // The same list read again ("Allow"): the write went into its file, or Keep works again.
        delete broll.saving[id];
        if (outcome === "in") {
          delete ask.answer.sketches[id];
          ask.answer.done[id] = "kept";
          settleSketches(ask);
          broll.marked[id] = { prev, pic, askId: ask.id };
          // The read may have taken the file before the write: read it again, so what shows and later writes have it.
          // It waits its turn in the write queue (no write queued before it is overtaken) and keeps the token (writes
          // under way go on). The token is taken before waiting, so any list change while it waits skips the read.
          // No browser step covers a list change during this wait; Broll.rereadAfterIn is unit-tested.
          const t = broll.token;
          await broll.reading?.catch(() => {});
          const run = brollWrites.then(() => (Broll.rereadAfterIn({ token: t, now: broll.token, shown: broll.sketches[id], pic, link: broll.link }) ? readBroll(t, false) : null));
          brollWrites = run.catch(() => {});
          await run.catch(() => {});
        }
        renderBroll();
        changed();
        return outcome;
      }
      // Another list or script: a closed ask's shot counts as undone, so list_asks shows the imageId works again.
      if (!isOpen(ask) && ask.answer?.done && !ask.answer.done[id] && ask.answer.sketches?.[id] === pic) {
        delete ask.answer.sketches[id];
        ask.answer.done[id] = "undone";
        ask.status = Broll.sketchStatus(ask.answer.done);
        changed();
      }
      return "changed";
    }
    if (ask.answer?.done?.[id] !== "kept" || broll.sketches[id] !== pic) return "waits";
    broll.marked[id] = { prev, pic, askId: ask.id };
    renderBroll();
    return "in";
  }
  // sketch_shot answers once the picture is written, but within the Worker's 10 s for a call: after 7 s it says the
  // picture is still being written (Broll.sketchAnswer), and its place is freed only once it went in.
  const sketchAnswer = (atOnce, left = []) => Broll.sketchAnswer(atOnce, left, Broll.SKETCH_ANSWER_MS);
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
      await changeList((md) => (m.prev ? Broll.setSketch(md, id, m.prev) : Broll.removeSketch(md, id)));
      if (token !== broll.token) return;
      delete broll.marked[id];
      const ask = state.asks.find((a) => a.id === m.askId);
      if (ask?.answer?.done) {
        ask.answer.done[id] = "undone";
        if (!isOpen(ask)) ask.status = Broll.sketchStatus(ask.answer.done);
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
    closeAsk(ask, Broll.sketchStatus(done));
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
  // → "kept"; "written" (written into the list file, but the list moved meanwhile); "failed"; or undefined (nothing to do).
  async function keepSketch(id) {
    const ask = sketchAsk();
    const svg = Broll.cleanSketch(ask?.answer?.sketches?.[id] || "");
    if (!svg || broll.saving[id]) return;
    const token = broll.token;
    broll.saving[id] = true;
    delete broll.problem[id];
    renderBroll();
    try {
      // One file write at a time: two quick Keeps must not both read the old file.
      // The list's token as the Keep is made: the write waits its turn and then checks it is still this list.
      const run = brollWrites.then(() => writeSketch(id, svg, token));
      brollWrites = run.catch(() => {});
      await run;
      if (token !== broll.token) return "written";
      broll.sketches[id] ??= svg; // writeSketch set them as saved
      delete ask.answer.sketches[id];
      ask.answer.done[id] = "kept";
      settleSketches(ask);
      changed();
    } catch (e) {
      if (token !== broll.token) return "failed";
      broll.problem[id] = e?.message || "Could not save the sketch.";
      delete broll.saving[id];
      renderBroll();
      return "failed";
    }
    delete broll.saving[id];
    renderBroll();
    return "kept";
  }
  // `token`: the list's token as the Keep was made. The write waits its turn in the queue, and making pictures lighter
  // takes a while: if the person opened another script or list meanwhile, it stops before it reads or writes anything
  // of theirs. Where the list lives (its link, the script's name) is read when its turn comes, so a "Save as…" or a
  // rename of the same list before it is followed; a "Save as…" that lands while it makes pictures lighter stops it
  // ("Not saved", Keep again), a rename then is followed (its name is read at the write).
  async function writeSketch(id, svg, token = broll.token) {
    const link = broll.link;
    const still = () => { if (token !== broll.token || broll.link !== link) throw new Error("The B-roll list changed."); };
    if (!link || token !== broll.token) throw new Error("The B-roll list changed.");
    if (link.handle) {
      if (!(await permitted(link.handle, true))) throw new Error(`No permission to write ${link.handle.name}.`);
      const now = await (await link.handle.getFile()).text();
      const next = await lighterList(Broll.setSketch(now, id, svg));
      still();
      await writeHandle(link.handle, next);
      if (token !== broll.token) return;
      broll.text = next;
      broll.sketches = Broll.parseBroll(next).sketches; // other pictures may have been made lighter
    } else {
      // The demo list and lists without a file handle are kept in this browser (see keepList).
      const next = await lighterList(Broll.setSketch(broll.text, id, svg));
      still();
      await keepList(next, scriptKey()); // the token says it is still open, so its key now is its own
      if (token !== broll.token) return;
      broll.text = next;
      broll.sketches = Broll.parseBroll(next).sketches;
    }
  }
  // Every save of a B-roll list shrinks its big pictures (step K4, Lex 2026-10-29): a list made elsewhere, or pictures
  // kept before step K3, get the same treatment as pictures from an agent (cut to the frame, at most 640 × 345, WebP,
  // about 60 KB). Small pictures and line drawings stay as they are; a picture that can't be read stays too.
  async function lighterList(markdown) {
    let md = markdown;
    for (const { id, data } of Broll.bigPictures(md)) {
      try {
        const pic = await shrinkPicture(await (await fetch(data)).blob());
        if (Broll.worthLighter(data, pic.data)) md = Broll.setSketch(md, id, pic.data); // else as the editor made it: left alone
      } catch { /* a picture that can't be read stays as it is */ }
    }
    return md;
  }

  /* ---------- Add, change and remove a shot (step C3): the shot card ---------- */
  // Lists without a file (the demo, a list opened without a handle, a new list whose picker was cancelled, the list of
  // a script in the browser) are kept in this browser per script. Since step K they live in IndexedDB, which has room
  // for pictures (the app's listKey and readKept). They go through the same queue as the B-roll links (keyed), so a
  // rename and a write never cross. Discarding script changes leaves them alone.
  const getKept = (name = scriptKey()) => keyed(() => readKept(name));
  async function keepList(text, name = scriptKey()) {
    try { await keyed(() => idbPut(listKey(name), text)); }
    catch { throw new Error("This browser could not keep the B-roll list."); }
  }
  // One write to the list at a time (the same queue as the sketch Keep): read the newest text, change it, write it.
  function changeList(mutate) {
    const token = broll.token;
    const run = brollWrites.then(async () => {
      // Where the list lives is read when its turn comes (a "Save as…" of the same list before it is followed).
      const link = broll.link;
      if (!link || token !== broll.token) throw new Error("The B-roll list changed.");
      if (link.handle) {
        if (!(await permitted(link.handle, true))) throw new Error(`No permission to write ${link.handle.name}.`);
        const now = await (await link.handle.getFile()).text();
        const next = await lighterList(mutate(now));
        if (token !== broll.token || broll.link !== link) throw new Error("The B-roll list changed.");
        if (next !== now) await writeHandle(link.handle, next);
        return next;
      }
      const next = await lighterList(mutate(broll.text));
      // Checked again after making pictures lighter (it takes a while): the token says this list is still open (and
      // still kept in the browser), so the open script's key now is its own (a rename queued its move before this write).
      if (token !== broll.token || broll.link !== link) throw new Error("The B-roll list changed.");
      await keepList(next, scriptKey());
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
    const text = Broll.newList(Doc.titleOf(state.doc) || baseName());
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
    // This list's text when the write's turn comes (the token says it is still this list); nothing is written if
    // another list or script opened since.
    const run = brollWrites.then(async () => {
      if (token !== broll.token) throw new Error("The B-roll list changed.");
      const text = await lighterList(broll.text);
      if (token !== broll.token) throw new Error("The B-roll list changed.");
      await writeHandle(handle, text);
      return text;
    });
    brollWrites = run.catch(() => {});
    let saved;
    try { saved = await run; } catch (e) { if (token === broll.token) { broll.err = e?.message || "Could not save the list."; renderBoard(); } return; }
    if (token !== broll.token) return;
    broll.link = { handle, name: handle.name };
    if (saved !== broll.text) adoptBroll(saved); // its big pictures were made lighter
    broll.err = "";
    setLinkKey(broll.link);
    delKept();
    renderBroll();
  }

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
        const over = Broll.overFor(state.doc, sc.sel || []);
        if (broll.status === "none") await startList();
        if (broll.status !== "ok") throw new Error("The B-roll list can't be read.");
        // The id comes from the newest text, so a file changed elsewhere still gets a free one.
        await changeList((md) => {
          const now = Broll.parseBroll(md);
          return Broll.addShot(md, { id: Broll.nextShotId(now.shots, kind, now.sketches), kind, what, over, how });
        });
      } else {
        await changeList((md) => Broll.updateShot(md, id, { kind, what, how }));
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
      await changeList((md) => Broll.removeShot(md, id));
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

  /* ---------- Move a shot to other paragraphs (steps L, L2): drag it ---------- */
  // The whole shot in the margin, its picture or line drawing and its tag, can be dragged at once: a mouse or a pen after
  // a few pixels, a finger after a hold (a quick swipe still scrolls, a tap still opens the card). While dragging, its
  // frame jumps to where it will sit beside the spoken paragraph under the pointer (or the nearest one); the drop puts
  // it there. The title, the front matter, outside the script or Escape leave it where it was.
  const spokenList = () => (state.doc ? Broll.spokenBlocks(state.doc) : []);
  // The spoken paragraph a point is in, or null (a heading, the title, a frame, anything outside the script).
  function paraAt(target) {
    const el = target?.closest?.(".block");
    if (!el || !scriptEl.contains(el) || el.closest("details:not([open])")) return null;
    return spokenList().some((b) => b.id === el.dataset.id) ? el.dataset.id : null;
  }
  // Where it would land: the covered-line rule in the accent beside those lines.
  function showTarget(ids) {
    for (const l of $$(".line[data-target]", scriptEl)) delete l.dataset.target;
    ids.forEach((id, i) => { const w = wrapOf(id); if (w) w.dataset.target = i < ids.length - 1 ? "on" : "last"; });
  }
  const targetFor = (id, para) => { const s = shotById(id); return s && para ? Broll.moveTo(spokenList(), covered(s), para) : []; };
  // Only the shot's Over is written again; it shows in its new place once the list is written. Moving it is checking it.
  async function moveShot(id, sel) {
    const s = shotById(id);
    if (!s || !state.doc || state.guest) return;
    const destination = sel.map((part) => part.id);
    const source = { over: s.over, ids: covered(s) }, atDrop = new Set(Broll.spokenBlocks(state.doc).map((b) => b.id));
    if (!Broll.moveOver(state.doc, covered(s), sel)) return; // onto the lines it covers already
    const token = broll.token;
    let origin, before, over, checked, words, invalid = false;
    const gone = (ids, spoken) => !ids.length || ids.some((pid) => !spoken.some((b) => b.id === pid));
    // Where the shot is when a step's turn comes: beside the paragraphs it shows on, whose words may have changed since
    // its quote was written. When it shows on none, or the list was changed outside this page: where its quote matches.
    const placeNow = (md) => {
      const saved = Broll.parseBroll(md).shots.find((shot) => shot.id === id), shown = shotById(id);
      if (!saved || !shown) return null;
      const ids = saved.over === shown.over ? covered(shown) : [];
      return { over: saved.over, ids: ids.length ? ids : Broll.matchOver(Broll.spokenBlocks(state.doc), saved.over), check: !!shown.check };
    };
    // A written list is matched to the script again by its quotes, and takes a moment to write. Words typed into the
    // shot's paragraphs meanwhile (`words`: what they said when the quote was chosen) give it "Check"; when they leave
    // the fresh quote matching nothing, or matching an earlier paragraph that says the same, the shot stays on the
    // paragraphs it was put on. `check`: its flag otherwise. Only changed words (a deleted paragraph among them) add it.
    const land = (ids, check) => {
      const shot = token === broll.token && shotById(id);
      if (!shot) return;
      // Keep ids deleted during the write too: a queued move still needs the source this step left it.
      const lost = covered(shot).join() !== ids.join();
      if (lost) Object.assign(shot, { blockIds: ids, sig: Broll.coverText(state.doc, ids) });
      const flag = check || Broll.coverText(state.doc, ids) !== words;
      if (!lost && shot.check === flag) return;
      shot.check = flag;
      syncFlags();
      renderBroll();
    };
    // Undo and Redo run in their turn too (the app's queueBrollHistory), so the script and the list are as the step
    // before left them: the shot goes back only from the place this move left it, onto paragraphs that are still spoken.
    // That place can show as other paragraphs that say the same: when its own were deleted the shot went to those, and
    // it stays there when Undo brings its own back. With the quote this move left, the list is the same either way, so
    // the step still fits.
    const restoreMove = async (redo) => {
      const ids = redo ? destination : origin, from = redo ? origin : destination, left = redo ? before : over;
      try {
        let keep;
        await changeList((md) => {
          const now = placeNow(md), spoken = Broll.spokenBlocks(state.doc);
          const there = now && (now.ids.join() === from.join() || (now.over === left && Broll.fitsOver(spoken, from, left)));
          if (!there || gone(ids, spoken)) {
            invalid = true; // The shot was changed since: this step will never fit again, so history skips it.
            throw new Error("The shot changed.");
          }
          // Keep the exact quote while it matches; a stale one follows the same paragraphs' current words.
          const quote = redo ? over : before;
          keep = Broll.matchOver(spoken, quote).join() === ids.join() ? quote : Broll.overFor(state.doc, Broll.wholeParas(state.doc, ids));
          words = Broll.coverText(state.doc, ids);
          return Broll.updateShot(md, id, { over: keep });
        });
        if (redo) over = keep; else before = keep; // the quote the list has now, for the step after this one
        if (token !== broll.token) return false;
        land(ids, redo ? false : checked);
        return true;
      } catch (err) {
        if (!invalid && token === broll.token && shotById(id)) {
          openShotCard({ mode: "edit", id, anchor: shotFrameAnchor(id) });
          failShotCard(err);
        }
        return false;
      }
    };
    // Registered before the save starts, so an Undo pressed at once waits for this move instead of undoing typing.
    const cancel = checkpointBrollMove({ valid: () => !invalid && token === broll.token && !!shotById(id), undo: () => restoreMove(false), redo: () => restoreMove(true) });
    // In its turn, after any Undo or Redo still saving: the move starts from where that step leaves the shot, and its
    // quote is of the words its paragraphs have by then (typing goes on while it waits).
    const write = queueBrollHistory(async () => {
      if (token !== broll.token) throw new Error("The B-roll list changed.");
      const shown = shotById(id);
      if (!shown) throw new Error("The shot changed.");
      // Remember the source before a list read can rematch it. An earlier queued step may have moved it; paragraphs
      // deleted before this drag stay out, while ones deleted since the drop keep their separate text Undo above it.
      // Moved: another quote, or a paragraph the drop did not find it on (two paragraphs can say the same).
      const stayed = shown.over === source.over && (shown.blockIds || []).every((pid) => source.ids.includes(pid));
      const from = { over: shown.over, ids: stayed ? source.ids
        : (shown.blockIds || []).filter((pid) => atDrop.has(pid) || Doc.blockById(state.doc, pid)) };
      await changeList((md) => {
        const now = placeNow(md);
        if (!now) throw new Error("The shot changed.");
        if (gone(destination, Broll.spokenBlocks(state.doc))) throw new Error("The script changed.");
        ({ over: before, check: checked } = now);
        origin = now.over === from.over ? from.ids : now.ids;
        if (origin.join() === destination.join()) return md; // the step before put the shot here already
        over = Broll.overFor(state.doc, Broll.wholeParas(state.doc, destination));
        words = Broll.coverText(state.doc, destination);
        return Broll.updateShot(md, id, { over });
      });
      if (over == null) return void cancel(); // nothing moved: nothing to undo
      land(destination, false);
    });
    try { await write; }
    catch (err) {
      cancel();
      // "Not saved" in the card, where its other changes show it; the shot stays where it was.
      if (token !== broll.token || !shotById(id)) return;
      openShotCard({ mode: "edit", id, anchor: shotFrameAnchor(id) });
      return failShotCard(err);
    }
  }
  // The paragraph a drag at (x, y) snaps to: the one under it, or the nearest spoken one above or below (a heading, a gap,
  // a note, the frames in the margin, the space below the script's end). None over the title, the front matter or beside
  // the script (the list of sections).
  function dropPara(x, y) {
    const s = scriptEl.getBoundingClientRect();
    const right = Math.max(s.right, ...$$(".broll-tags", scriptEl).map((b) => b.getBoundingClientRect().right));
    const top = $(".front", scriptEl)?.getBoundingClientRect().bottom ?? s.top;
    if (x < s.left - 48 || x > right + 48 || y < top) return null;
    const hit = paraAt(document.elementFromPoint(x, y));
    if (hit) return hit;
    const paras = [];
    for (const b of spokenList()) {
      const w = wrapOf(b.id);
      const r = w && !w.closest("details:not([open])") ? w.getBoundingClientRect() : null;
      if (r?.height) paras.push({ id: b.id, top: r.top, bottom: r.bottom });
    }
    return Broll.snapPara(paras, y);
  }
  // Where the dragged frame will sit beside a paragraph after the drop, as a shift from its own place. Nothing else in
  // the margin moves meanwhile. Wide screens: the margin column, stacked as placeFrames will stack it. Narrow ones: in
  // the paragraph's row of frames, or just above its text.
  const listIndex = (frame) => { const i = broll.shots.findIndex((s) => s.id === frame.querySelector(":scope > .shot-frame__jump")?.dataset.b); return i < 0 ? Infinity : i; };
  function landing(f, toId) {
    const own = f.parentElement, line = wrapOf(toId);
    const box = line?.querySelector(":scope > .broll-tags");
    if (!line || box === own) return { x: 0, y: 0 };
    const r = f.getBoundingClientRect(), t = getComputedStyle(f).translate;
    const [tx = 0, ty = 0] = t === "none" ? [] : t.split(" ").map(parseFloat);
    const at = { left: r.left - tx, top: r.top - ty }; // its own place, without the drag's shift
    const css = getComputedStyle(own), gap = parseFloat(css.rowGap) || 0;
    const kids = box ? [...box.children].filter((k) => k !== f) : [];
    const before = kids.filter((k) => listIndex(k) < listIndex(f)); // frames come in list order
    if (css.position === "absolute") {
      const natural = (b) => b.getBoundingClientRect().top - (parseFloat(b.style.getPropertyValue("--push")) || 0);
      const edge = natural(own) - own.parentElement.getBoundingClientRect().top; // a box's place below its line's top
      const boxes = [];
      for (const b of $$(".broll-tags", scriptEl)) {
        let height = b.getBoundingClientRect().height;
        if (b === own) { if (b.children.length === 1) continue; height -= r.height + gap; }
        if (b === box) height += gap + r.height;
        boxes.push({ b, top: natural(b), height });
      }
      if (!box) boxes.push({ b: null, top: line.getBoundingClientRect().top + edge, height: r.height });
      boxes.sort((p, q) => p.top - q.top);
      const pushes = Broll.stackPushes(boxes);
      const i = boxes.findIndex((x) => x.b === (box || null));
      const offset = before.reduce((sum, k) => sum + k.getBoundingClientRect().height + gap, 0);
      return { x: 0, y: Math.round(boxes[i].top + pushes[i] + offset - at.top) };
    }
    if (kids.length) {
      const next = kids[before.length];
      if (next) { const n = next.getBoundingClientRect(); return { x: Math.round(n.left - at.left), y: Math.round(n.top - at.top) }; }
      const last = kids.at(-1).getBoundingClientRect(), col = parseFloat(css.columnGap) || 0;
      const fits = last.right + col + r.width <= box.getBoundingClientRect().right + 1;
      return fits ? { x: Math.round(last.right + col - at.left), y: Math.round(last.top - at.top) }
        : { x: Math.round(box.getBoundingClientRect().left - at.left), y: Math.round(last.bottom + gap - at.top) };
    }
    const text = (line.querySelector(":scope > .block") || line).getBoundingClientRect();
    return { x: Math.round(text.left - at.left), y: Math.round(text.top - (parseFloat(css.marginBlockEnd) || 0) - r.height - at.top) };
  }
  // Follow the pointer: the target rule and the frame's place; near the top or bottom edge the page scrolls (per frame,
  // only while a drag is on and the page can still move).
  function dragTo(d) {
    d.to = targetFor(d.id, dropPara(d.px, d.py));
    showTarget(d.to);
    const at = d.to.length ? landing(d.el, d.to[0]) : null;
    d.el.toggleAttribute("data-nowhere", !at);
    d.el.style.translate = at && (at.x || at.y) ? `${at.x}px ${at.y}px` : "";
  }
  function dragFrame(d) {
    d.frame = 0;
    if (mv.drag !== d || !d.on) return;
    const toc = $(".toc");
    const top = Math.max(scriptView().top, toc && getComputedStyle(toc).position === "sticky" ? toc.getBoundingClientRect().bottom : 0);
    const v = Broll.edgeSpeed(d.py, top, scriptView().bottom), y = scrollY;
    if (v) { personInput(); scrollBy(0, v); }
    dragTo(d);
    // motion-exception: the edge scroll goes on frame by frame while a dragged shot is held near the edge
    if (scrollY !== y) d.frame = requestAnimationFrame(() => dragFrame(d));
  }
  function liftShot(d) {
    d.on = true;
    closeShotCard();
    hideBar();
    getSelection().removeAllRanges();
    document.documentElement.dataset.dragging = "";
    d.el.dataset.dragged = "";
    try { d.jump.setPointerCapture(d.press.pid); } catch { /* the drag still follows the document's events */ }
    dragFrame(d);
  }
  // Ends the drag in hand, if any: its press ends ("stop") and the frame goes back.
  function endDrag() { mv.drag?.press.end(); }
  // The frame goes back to its own place, unless it waits there for its move to be written (the list re-renders it).
  function putBack(d, keep) {
    if (mv.drag !== d) return;
    mv.drag = null;
    cancelAnimationFrame(d.frame);
    delete document.documentElement.dataset.dragging;
    delete d.el.dataset.dragged;
    delete d.el.dataset.nowhere;
    if (!keep) d.el.style.translate = "";
    showTarget([]);
  }
  // A re-render during a drag (the list or the script changed) gives the shot a new frame: the drag goes on with it.
  function redrag() {
    const d = mv.drag;
    if (!d) return;
    const jump = scriptEl.querySelector(`.shot-frame[data-drag] .shot-frame__jump[data-b="${CSS.escape(d.id)}"]`);
    if (!jump) return endDrag();
    Object.assign(d, { jump, el: jump.closest(".shot-frame") });
    if (!d.on) return;
    d.el.dataset.dragged = "";
    dragTo(d);
  }
  document.addEventListener("pointerdown", () => { mv.dropped = false; }, true);
  // A mouse or pen lifts a shot once it moves 5 px; a finger holds still for HOLD_MS first, and a swipe before that
  // scrolls the page. The press ends on every way out (press.js): a lost release, a cancel, blur or a hidden tab put
  // the shot back.
  scriptEl.addEventListener("pointerdown", (e) => {
    const t = e.target.closest(".shot-frame[data-drag] .shot-frame__jump");
    if (!t || e.button !== 0 || !e.isPrimary || mv.drag || state.guest || state.locked) return;
    const d = mv.drag = { id: t.dataset.b, jump: t, el: t.closest(".shot-frame"), px: e.clientX, py: e.clientY, on: false, to: [], frame: 0, press: null };
    const follow = (p) => { d.px = p.px; d.py = p.py; };
    d.press = startPress(e, {
      threshold: 5, touchSlop: 10, hold: HOLD_MS,
      onLift: (p) => { follow(p); liftShot(d); },
      onMove: (p, ev) => {
        follow(p);
        ev.preventDefault();
        // motion-exception: the dragged frame follows the pointer, one update per frame
        d.frame ||= requestAnimationFrame(() => dragFrame(d));
      },
      onEnd: (p, how) => (how === "drop" ? dropShot(d, p) : putBack(d)),
    });
  });
  // Released after the lift: the shot lands beside the paragraph under the pointer, or goes back.
  function dropShot(d, p) {
    d.px = p.px;
    d.py = p.py;
    dragTo(d);
    const sel = d.to.length && state.doc ? Broll.wholeParas(state.doc, d.to) : null;
    putBack(d, !!sel);
    mv.dropped = true;
    if (sel) moveShot(d.id, sel).finally(() => { if (d.el.isConnected) d.el.style.translate = ""; });
  }
  // Pictures are never dragged out by the browser; a held finger brings no menu.
  scriptEl.addEventListener("dragstart", (e) => { if (e.target.closest?.(".broll-tags")) e.preventDefault(); });
  scriptEl.addEventListener("contextmenu", (e) => { if (mv.drag && e.target.closest?.(".shot-frame")) e.preventDefault(); });
  // While a finger drags a shot the page scrolls only by the edges (each box of frames listens).
  function holdPage(e) { if (mv.drag?.on) e.preventDefault(); }
  // A wheel turned while dragging moves the script under a still pointer.
  // motion-exception: the dragged frame keeps its landing place while the page scrolls under it, one update per frame
  addEventListener("scroll", () => { const d = mv.drag; if (d?.on) d.frame ||= requestAnimationFrame(() => dragFrame(d)); }, { passive: true });
  // Escape puts a dragged shot back where it was.
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !mv.drag?.on) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag();
    mv.dropped = true;
  }, true);

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
      const n = Broll.dropGone(a.answer, shots, (i) => !!broll.saving[`${a.id}:${i}`]);
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
    const list = state.doc ? Broll.spokenBlocks(state.doc) : [];
    return openSuggestions().filter((x) => x.c.op === "add")
      .map((x) => ({ ...x, suggested: true, kind: x.c.kind, what: x.c.what, how: x.c.how, over: x.c.over, why: x.c.why, sketch: x.c.sketch || "", blockIds: Broll.matchOver(list, x.c.over) }));
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
    const ask = Doc.makeAsk(state.doc, { scope: "broll", action: "plan", by: me });
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

  /* "Keep all" and "Undo all" for the agent's pictures (step Q): in a row at the top of the script and the storyboard,
     from two pictures on. Each picture goes the way its own Keep or Undo goes; a kept picture has no Undo afterwards, like a single Keep. */
  function imagesOpen() {
    if (state.guest || !state.doc) return Broll.pendingImages(); // guests see the pictures; the host keeps or undoes them
    // Only what is in sight: over the script the shots with a frame, over the storyboard the shots its filter shows.
    const board = ui.view === "board";
    const real = broll.status === "ok" ? broll.shots : [];
    const filter = boardFilter(real);
    const inScript = (s) => !!wrapOf(covered(s)[0]);
    return Broll.pendingImages({
      shotIds: real.filter((s) => (board ? filter[2](s) : inScript(s))).map((s) => s.id),
      waiting: sketchAsk()?.answer?.sketches,
      marked: Object.keys(broll.marked).filter(markedSketch),
      suggestions: suggestedAdds().filter((x) => (board ? filter[0] === "all" : inScript(x))),
      saving: broll.saving,
    });
  }
  let imagesWhere = ""; // the list and the view the bar last showed in
  function renderImagesAll() {
    const open = imagesOpen();
    const el = $("#imagesAll");
    const where = `${broll.token}:${ui.view}`;
    if (!open.show) {
      // The keyboard doesn't fall back to the top of the page: it goes to the view switch, earlier in the page.
      if (el.contains(document.activeElement)) $('#viewSwitch [aria-pressed="true"]').focus({ preventScroll: true });
      if (el.hidden) return;
      // Its row stays while this list and view stay, so what is under the pointer doesn't jump as the count goes down.
      if (imagesWhere === where) {
        if (el.firstChild) { el.style.blockSize = `${el.getBoundingClientRect().height}px`; el.replaceChildren(); }
        return;
      }
      el.hidden = true;
      el.replaceChildren();
      el.style.removeProperty("block-size");
      placeOverText();
      positionSlash();
      return;
    }
    imagesWhere = where;
    // Built once, then only its words change: focus and a press in progress stay, and it doesn't animate in again.
    if (!el.firstChild) {
      el.innerHTML = `<span class="change__bar"><span class="change__what">${icon("sketch")}<span></span></span>`
        + `<button type="button" class="undo" data-act="undo-all">${icon("undo")}Undo all</button>`
        + `<button type="button" class="keep" data-act="keep-all">${icon("check")}Keep all</button></span>`;
      const came = el.hidden;
      el.style.removeProperty("block-size");
      el.hidden = false;
      if (came) { placeOverText(); positionSlash(); }
    }
    const n = open.count;
    $(".change__what > span", el).textContent = `${n} images`;
    $(".undo", el).setAttribute("aria-label", `Undo all ${n} images`);
    $(".keep", el).setAttribute("aria-label", `Keep all ${n} images`);
  }
  function keepAllImages() {
    const open = imagesOpen();
    // A picture put in at once is in the list already: keeping it only takes its mark and its Undo away.
    for (const id of open.marked) { delete broll.marked[id]; delete broll.problem[id]; }
    for (const id of open.waiting) keepSketch(id);
    if (open.suggested.length) keepSuggestions(open.suggested);
    renderBroll();
  }
  function undoAllImages() {
    const open = imagesOpen();
    for (const id of open.waiting) undoSketch(id);
    for (const id of open.marked) undoMarked(id);
    if (open.suggested.length) undoSuggestions(open.suggested);
  }
  $("#imagesAll").addEventListener("pointerdown", (e) => { if (e.target.closest(".change__bar")) e.preventDefault(); }); // the caret stays in the script
  $("#imagesAll").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "keep-all") keepAllImages();
    else if (act === "undo-all") undoAllImages();
  });

  /* Keep writes through addShot / updateShot / removeShot and the one-write-at-a-time queue; Undo writes nothing. */
  function findSuggestion(key) {
    const i = String(key).lastIndexOf(":");
    const ask = state.asks.find((a) => a.id === key.slice(0, i));
    const n = Number(key.slice(i + 1));
    const c = ask && isBrollAnswer(ask) ? ask.answer.changes[n] : null;
    return c ? { ask, n, c, key } : null;
  }
  function settleSuggestions(ask) {
    const status = Broll.settleBroll(ask.answer);
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
      const changes = items.flatMap((x) => Broll.changesToKeep(x.ask.answer, [x.n]));
      let report = null;
      await changeList((md) => { report = Broll.applyBrollChangesReport(md, changes); return report.markdown; });
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

  /* ---------- Pictures from the agent as sketches (step K, Lex 2026-10-29) ---------- */
  // upload_image gives a one-time address; the agent sends the file there, the Worker passes it through the relay in
  // parts, and the tab shrinks it and keeps it here, in memory only, until sketch_shot or answer_broll uses its id:
  // a call that uses it frees its place at once (step K2); the picture then lives in the shot or the suggestion.
  // Only pictures not used yet hold a place: 24, a whole storyboard in one go (at most about 10 MB in memory).
  const UPLOAD_MS = 15 * 60_000, PICTURE_MS = 30 * 60_000, PICTURES_MAX = 24;
  const pictureRoom = () => Broll.pictureRoom(pictures.values(), Date.now(), { max: PICTURES_MAX, uploadMs: UPLOAD_MS, pictureMs: PICTURE_MS });
  const pictures = new Map(); // id → { at, data: "" (waiting for the file) | data address }
  function prunePictures() {
    const now = Date.now();
    // A picture still being shrunk stays: its imageId is about to be given out.
    for (const [id, p] of pictures) if (!p.busy && !p.held && now - p.at > (p.data ? PICTURE_MS : UPLOAD_MS)) pictures.delete(id);
    for (const [id, x] of incoming) if (now - x.at > 60_000) incoming.delete(id);
  }
  async function pictureAddress() {
    prunePictures();
    const room = pictureRoom();
    if (!room.free) return { error: Broll.noRoomMessage(room, PICTURES_MAX, Date.now()) };
    const id = Doc.newId(22);
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
    if (!Broll.IMAGE_TYPES.includes(m.mime)) return replyPicture(m.id, { error: "Send a PNG, JPEG or WebP picture." });
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
  // Cut to the storyboard frame and made small in this browser (step K3, Broll.pictureFit): at most 640 × 345, WebP (JPEG
  // where the browser can't make WebP), stepping down quality and size until it fits Broll.PICTURE_BUDGET.
  async function shrinkPicture(blob) {
    let bitmap;
    try { bitmap = await createImageBitmap(blob); }
    catch { throw new Error("The editor could not read the picture. Send a PNG, JPEG or WebP file."); }
    try {
      const results = [];
      for (const [scale, quality] of Broll.PICTURE_STEPS) {
        const fit = Broll.pictureFit(bitmap.width, bitmap.height, scale);
        const canvas = document.createElement("canvas");
        Object.assign(canvas, { width: fit.width, height: fit.height });
        const g = canvas.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, fit.width, fit.height);
        g.imageSmoothingQuality = "high";
        g.drawImage(bitmap, fit.sx, fit.sy, fit.sw, fit.sh, 0, 0, fit.width, fit.height);
        let data = canvas.toDataURL("image/webp", quality);
        if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/jpeg", quality);
        results.push({ data, width: fit.width, height: fit.height });
        if (Broll.isImage(data) && data.length <= Broll.PICTURE_BUDGET) break;
      }
      // The first step within the budget; a very busy picture keeps the smallest, still far under the list's limit.
      const pic = Broll.pickPicture(results);
      if (pic) return pic;
    } finally { bitmap.close?.(); }
    throw new Error("The picture could not be made small enough.");
  }
  // sketch_shot { imageId } and answer_broll adds { imageId }: the picture's data address takes the svg's or sketch's place.
  function withPictures(args) {
    prunePictures();
    const requested = args.imageId != null ? [args.imageId] : (Array.isArray(args.changes) ? args.changes : []).map((c) => c?.imageId).filter((x) => x != null);
    const twice = requested.find((id, i) => requested.indexOf(id) !== i);
    if (twice != null) return { error: Broll.sketchTwice(twice) };
    const busy = requested.find((id) => pictures.get(id)?.held);
    if (busy) return { error: Broll.sketchHeld(busy) };
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
    const ask = Doc.makeAsk(state.doc, { scope: "broll", action, instruction, by: me });
    Object.assign(ask, { own: true, status: "taken", takenAt: ask.createdAt, takenBy: agentBy() });
    return ask;
  }
  // At most this many of the agent's own changes wait at once: each may carry an 8 KB sketch, and open answers go
  // into the draft and to guests. Own sketches need no limit: one per shot in the list (a new one replaces the waiting
  // one in answer.sketches), in one sketch ask at a time.
  const OWN_OPEN_MAX = 2 * Broll.BROLL_LIMITS.changes;
  function ownBroll(args) {
    if (broll.status !== "ok" && broll.status !== "none") return { error: brollUnreadable() };
    const ask = ownAsk("plan", "Your own B-roll suggestions, asked for in your chat.");
    const checked = Broll.checkBrollAnswer(ask, args, { doc: state.doc, shots: broll.status === "ok" ? broll.shots : [] });
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
    const svg = Broll.checkSketch({ scope: "broll", action: "sketch", status: "taken", shots: [shot] }, args);
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
    if (!atOnce) return { result: Broll.sketchResult("shown", left) };
    // The answer waits for the write (at most 7 s), so it says what really happened.
    return sketchAnswer(atOnce, left);
  }
  function brollUnreadable() {
    return broll.status === "permission" ? "The editor needs the person's OK to read the B-roll list. Ask them to allow it in the storyboard first."
      : broll.status === "loading" ? "The B-roll list is still loading. Try again in a moment."
      : "The B-roll list can't be read. Ask the person to link it again in the storyboard.";
  }

  /* ---------- What the app asks of the B-roll part ---------- */
  // The B-roll list and the storyboard, as the single exports and "Export all" give them.
  function brollExports() {
    const shots = Broll.scriptOrder(state.doc, broll.shots), title = Doc.titleOf(state.doc) || baseName();
    return [
      { name: `${baseName()}-broll.md`, text: Broll.exportBroll(shots, broll.sketches, { title }) },
      { name: `${baseName()}-storyboard.html`, text: Broll.exportStoryboard(shots, broll.sketches, { title, missing: (s) => !covered(s).length }) },
    ];
  }
  // The agent's B-roll tools: upload_image, sketch_shot and answer_broll (the app's handleCall passes them on).
  function agentTool(tool, input, reply, noScript) {
    let args = input, send = reply;
    const failed = (e) => send({ error: `The editor could not do that: ${e?.message || e}` });
    try {
      if (tool === "upload_image") return void pictureAddress().then(send, failed);
      const used = withPictures(args);
      if (used.error) return send({ error: used.error });
      args = used.args;
      // Held from now on, so no other call can use them meanwhile (Broll.freeAfter settles them with the answer).
      for (const u of used.used) { const p = pictures.get(u); if (p) p.held = true; }
      // Gone through: the pictures now live in the shot or the suggestion, and their places are free (step K2).
      // An answer sent while the picture is still being written (`later`) holds its id (no second use) and frees it
      // only once it went in; if the list changed or the write failed, the id works again (Broll.freeAfter).
      if (used.used.length) {
        const each = (fn) => () => { for (const u of used.used) fn(u); };
        send = (payload) => reply(Broll.freeAfter(payload, {
          free: each((u) => pictures.delete(u)),
          release: each((u) => { const p = pictures.get(u); if (p) delete p.held; }),
        }));
      }
      if (!state.doc) return send({ error: noScript });
      if (tool === "answer_broll") {
        if (args.askId == null) return send(ownBroll(args));
        const error = answerBroll(state.asks.find((a) => a.id === args.askId), args, agentBy());
        if (error) return send({ error });
        return send({ result: "Shown to the person. They choose Keep or Undo per change." });
      }
      if (args.askId == null) { const out = ownSketch(args); return out instanceof Promise ? void out.then(send, failed) : send(out); }
      const ask = state.asks.find((a) => a.id === args.askId);
      const checked = Broll.checkSketch(ask, args);
      if (checked.error) return send({ error: checked.error });
      const atOnce = receiveSketch(ask, args.shotId, checked.svg, agentBy());
      if (!atOnce) return send({ result: Broll.sketchResult("shown") });
      return void sketchAnswer(atOnce).then(send, failed);
    } catch (e) {
      failed(e);
    }
  }
  // An agent's answer to a B-roll ask, checked against the list: "" once it shows, else why not.
  function answerBroll(ask, args, by) {
    const checked = Broll.checkBrollAnswer(ask, args, { doc: state.doc, shots: broll.status === "ok" ? broll.shots : [] });
    if (checked.error) return checked.error;
    receiveBroll(ask, checked.answer, by);
    return "";
  }
  function sketch(ask, shotId, svg, by) {
    const checked = Broll.checkSketch(ask, { shotId, svg });
    if (checked.error) return checked.error;
    receiveSketch(ask, shotId, checked.svg, by);
    return "";
  }
  // Host: the B-roll list as guests get it (in the snapshot and after each change).
  function roomShare() {
    // A large list goes to guests without its pictures (step K): room messages stay small.
    const text = broll.text.length > 700_000 ? Broll.withoutPictureLines(broll.text) : broll.text;
    return broll.status === "ok" ? { status: "ok", name: broll.link?.name || "B-roll list", text, flags: brollFlags() || {} } : { status: "none" };
  }
  // Guest: the host's B-roll list, shown as the host shows it (no file, no changes from here).
  function adoptRoom(b) {
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

  // Asks already here when it loads (a restored draft, a guest's copy) are cleaned like the ones that come later.
  for (const a of state.asks) Broll.cleanSketches(a);

  return Object.freeze({
    status: () => broll.status,
    link: () => broll.link,
    shots: () => (broll.status === "ok" ? broll.shots : []),
    flags: brollFlags,
    setFlags: (flags) => { broll.flags = flags && typeof flags === "object" ? { ...flags } : {}; },
    canAdd: () => !state.guest && (broll.status === "ok" || broll.status === "none"),
    load: loadBroll,
    close: closeBroll,
    render: renderBroll,
    renderMarks: renderBrollMarks,
    renderView: (board) => { renderBoard(); if (!board) placeFrames(); renderImagesAll(); },
    rematch: rematchBroll,
    touched: brollTouched,
    refreshSuggestions,
    dropGone: () => { if (broll.status === "ok" || broll.status === "none") dropGoneSuggestions(); },
    cleanSketches: (ask) => Broll.cleanSketches(ask),
    // A script kept aside (TOOLS-358): its shots over lines the agent's answer changed get "Check"; gives their ids.
    touchKept: (doc, shots) => Broll.touchShots(doc, shots),
    cardOpen: () => !shotCard.hidden,
    openCard: openShotCard,
    positionCard: positionShotCard,
    closeCard: closeShotCard,
    endDrag,
    escape: () => { closeShotCard(); if (broll.lit) lightShot(broll.lit, false); },
    requestSketches,
    requestPlan,
    answerBroll,
    sketch,
    agentTool,
    pictureHead: receivePictureHead,
    pictureBytes: receivePictureBytes,
    exports: brollExports,
    folder: (doc) => (broll.status === "ok" ? { linked: true, shots: Broll.scriptOrder(doc, broll.shots), sketches: broll.sketches, broll: Broll } : { linked: false, shots: [], sketches: {} }),
    roomShare,
    adoptRoom,
  });
}
