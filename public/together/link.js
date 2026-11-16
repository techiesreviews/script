// Edit links and room keys (step D). Small, so the page loads it at startup: a guest's link is read and a host's link
// is made inside the Share to edit click, before the room itself (room.js, loaded on first use) is here.
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export const ROOM_RE = /^[A-Za-z0-9_-]{22}$/;
export const SECRET_RE = /^[A-Za-z0-9_-]{32}$/;
export const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
/** A new room: its id, the edit key in the link, and the host key that never leaves the host's tab. */
export const newRoom = () => ({ room: random(16), key: random(32), hostKey: random(32) });
/** The edit link. The key stays after "#", so browsers never send it to a server. */
export const makeLink = (origin, { room, key }) => `${String(origin).replace(/\/+$/, "")}/#room=${room}&k=${key}`;
export function parseLink(hash) {
  const p = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  const room = p.get("room") ?? "", key = p.get("k") ?? "";
  return ROOM_RE.test(room) && KEY_RE.test(key) ? { room, key } : null;
}
