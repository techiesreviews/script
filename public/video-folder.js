// "Save to video folder" (Lex, 2026-11-10, Orbit TOOLS-194): the script, the cue files, the B-roll data and its pictures
// under the names a video folder uses (chat `youtube/workflow/project-files.md`), plus a short receipt. Pure but for
// writeFolder, which takes a directory handle. Imported by export-pack.js and the tests; nothing here changes script text.
// The B-roll helpers come in with a linked list (`broll`, the broll.js module): broll.js loads only once a script uses
// B-roll (TOOLS-306). This file loads on first use, through export-pack.js (TOOLS-311); the note on the menu item is in
// folder-note.js, which loads at startup.
import { exportPrompter, stats, prompterLink } from "./doc.js";
import { plural, listState, settleFolder, folderNote } from "./folder-note.js";

export { listState, settleFolder, folderNote };

export const FOLDER_NAMES = ["script.md", "prompter.md", "recording-notes.md", "b-roll.md", "b-roll.json"];
// Cue files are written by hand after the script is final; a folder that already has them keeps them.
export const FOLDER_KEEP = ["prompter.md", "recording-notes.md"];
export const RECEIPT_NAME = "save-receipt.md";
// The prompter link (TOOLS-201): one line, the link to the saved prompter.md text with the day the script was saved.
export const LINK_NAME = "prompter-link.txt";
const PICTURES = "pictures";

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const pad = (n) => String(n).padStart(2, "0");
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// A shot's id as a file name: letters, digits, dot, dash and underscore, starting with a letter (`shot-` is put in front otherwise), never twice.
function fileStem(id, taken) {
  let stem = String(id).normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "");
  if (!/^[A-Za-z]/.test(stem)) stem = `shot-${stem || "x"}`;
  let name = stem;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${stem}-${n}`;
  taken.add(name.toLowerCase());
  return name;
}

function pictureBytes(data) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(data);
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { ext: EXT[m[1]], bytes };
}

// A line drawing as a file of its own: the same lines and colours as the storyboard page.
const SVG_STYLE = "path,rect,circle,ellipse,line,polyline,polygon{fill:none;stroke:#1a1a1a;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.l{stroke:#a8a8a8}.o{stroke:#ff6a3d;stroke-width:2.2}.mv{stroke:#ff6a3d;stroke-width:1.6;stroke-dasharray:4 4}text{fill:#1a1a1a;stroke:none;font:600 11px system-ui,sans-serif}";
const standaloneSvg = (svg, { sketchLines, SKETCH_VIEWBOX }) => {
  const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SKETCH_VIEWBOX}">\n<style>${SVG_STYLE}</style>\n<rect width="260" height="140" style="fill:#fff;stroke:none"/>\n${sketchLines(inner)}\n</svg>\n`;
};

/**
 * videoFolder({ doc, scriptText, shots, sketches, title, date, linked, broll }) → { files, receipt }
 * files: [{ name, text }] where text is a string, or bytes for a picture (the zip and writeFolder take both).
 * shots are in script order; with no B-roll list linked there are no B-roll files and no pictures. A linked list needs
 * `broll`, the broll.js module the app loaded for it.
 */
export function videoFolder({ doc, scriptText, shots = [], sketches = {}, title = "", date = new Date(), linked = true, broll = null }) {
  const prompter = exportPrompter(doc);
  const files = [{ name: "script.md", text: scriptText }, { name: "prompter.md", text: prompter }, { name: "recording-notes.md", text: prompter }];
  let pictures = 0;
  if (linked) {
    if (!broll) throw new Error("A linked B-roll list needs the B-roll helpers.");
    const { exportBroll, cleanSketch, isImage } = broll;
    const paths = Object.create(null), taken = new Set(), pictureFiles = [];
    for (const s of shots) {
      const v = Object.hasOwn(sketches, s.id) ? cleanSketch(sketches[s.id] || "") : "";
      if (!v) continue;
      const stem = fileStem(s.id, taken);
      if (isImage(v)) {
        const { ext, bytes } = pictureBytes(v);
        paths[s.id] = `${PICTURES}/${stem}.${ext}`;
        pictureFiles.push({ name: paths[s.id], text: bytes });
      } else {
        paths[s.id] = `${PICTURES}/${stem}.svg`;
        pictureFiles.push({ name: paths[s.id], text: standaloneSvg(v, broll) });
      }
    }
    pictures = pictureFiles.length;
    // Only the shots' pictures: a sketch of no shot has no file, so it must not come along as an embedded picture.
    const own = Object.fromEntries(Object.keys(paths).map((id) => [id, sketches[id]]));
    files.push({ name: "b-roll.md", text: exportBroll(shots, own, { title, paths }) });
    files.push({
      name: "b-roll.json",
      text: JSON.stringify({ title, shots: shots.map((s) => ({ id: s.id, kind: s.kind, what: s.what, over: s.over, how: s.how, check: !!s.check, picture: paths[s.id] || null })) }, null, 2) + "\n",
    });
    files.push(...pictureFiles);
  }
  const receipt = { date: day(date), words: stats(doc).words, shots: linked ? shots.length : null, pictures };
  files.push({
    name: RECEIPT_NAME,
    text: ["# Save receipt", "", `- Saved: ${receipt.date}`, `- Words: ${receipt.words}`,
      linked ? `- B-roll: ${plural(shots.length, "shot")}, ${plural(pictures, "picture")}` : "- B-roll: no list linked", ""].join("\n"),
  });
  return { files, receipt };
}

/** A file's last-saved time as a day on this device (YYYY-MM-DD); null when the browser gives none. */
export const fileDay = (ms) => (Number.isFinite(ms) && ms > 0 ? day(new Date(ms)) : null);

/** The day the script was saved, for the prompter link: its own file's day (when it has one, handle or not) while the
 *  file holds what is on screen; otherwise the day of this save, as the folder's copy is written now. Never a day nobody read. */
export function scriptDay({ modified, dirty, now = new Date() }) {
  return (!dirty && fileDay(modified)) || day(now);
}

/** The prompter-link.txt file for a prompter text, or null when the text is longer than the prompter accepts. */
export async function prompterLinkFile(text, saved = null) {
  const link = await prompterLink(text, undefined, saved);
  return link && { name: LINK_NAME, text: `${link}\n` };
}

/** The files with prompter-link.txt added (made from their prompter.md); as they were, and `noLink`, when it is too long. */
export async function withPrompterLink(files, saved = null) {
  const prompter = files.find((f) => f.name === "prompter.md");
  const link = prompter && await prompterLinkFile(prompter.text, saved);
  if (link) return [...files, link];
  const out = [...files];
  out.noLink = true;
  return out;
}

const missing = (e) => e?.name === "NotFoundError";
async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch (e) { if (missing(e)) return false; throw e; }
}
async function put(dir, name, data) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(data);
  await w.close();
}

/** writeFolder(dir, files, { keep, saved }) → { written, kept, noLink? }: every file into the chosen folder under its name
 *  (a name with a slash goes in its sub-folder). A name in `keep` that is already there is left as it is. Then
 *  prompter-link.txt, made from the prompter.md that is in the folder now (kept or written) with the day `saved`;
 *  `noLink` when that text is too long for the prompter. */
export async function writeFolder(dir, files, { keep = FOLDER_KEEP, saved = null } = {}) {
  const written = [], kept = [];
  for (const f of files) {
    if (keep.includes(f.name) && await exists(dir, f.name)) { kept.push(f.name); continue; }
    const parts = f.name.split("/");
    let at = dir;
    for (const p of parts.slice(0, -1)) at = await at.getDirectoryHandle(p, { create: true });
    await put(at, parts.at(-1), f.text);
    written.push(f.name);
  }
  // Every file is written by now: a kept prompter.md that can't be read back only costs the link.
  let prompter = null;
  try {
    prompter = kept.includes("prompter.md")
      ? await (await (await dir.getFileHandle("prompter.md")).getFile()).text()
      : files.find((f) => f.name === "prompter.md")?.text;
  } catch { prompter = null; }
  const link = prompter == null ? null : await prompterLinkFile(prompter, saved);
  if (!link) return { written, kept, noLink: true };
  await put(dir, link.name, link.text);
  written.push(link.name);
  return { written, kept };
}
