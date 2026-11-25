// Loaded when Export first opens. The app captures the script before waiting for this module (TOOLS-311).
import { makeZip } from "./zip.js";
import { videoFolder, scriptDay, writeFolder, withPrompterLink } from "./video-folder.js";

// The interface version; the app checks it (a tab from before a release that gets a newer pack counts it as not loaded).
export const SEAM = 1;

/** Export all: the files ([{ name, text }]) as one zip, as bytes. */
export const zipAll = (files) => makeZip(files);

/**
 * saveFolder({ dir, doc, scriptText, title, broll, modified, dirty }) → the save's receipt ({ date, words, shots,
 * pictures }) with what writeFolder did ({ written, kept, noLink? }) when `dir` is a folder, or, with no folder, the
 * same files with the prompter link as a zip (`zip`, bytes; `noLink` when the prompter text is too long for it).
 * `broll` is the B-roll module's folder() result ({ linked, shots, sketches, broll }), or { linked: false }.
 * `modified` and `dirty` give the day the script was saved, for the prompter link.
 */
export async function saveFolder({ dir, doc, scriptText, title, broll, modified, dirty }) {
  const { files, receipt } = videoFolder({ doc, scriptText, title, ...broll });
  const saved = scriptDay({ modified, dirty });
  if (dir) return { ...receipt, ...(await writeFolder(dir, files, { saved })) };
  const withLink = await withPrompterLink(files, saved);
  return { ...receipt, zip: makeZip(withLink), ...(withLink.noLink && { noLink: true }) };
}
