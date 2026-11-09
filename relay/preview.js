// ============================================================
// orOS Mail relay — link previews for shared songs (BR-SHARE-PREVIEW,
// Music share wave 2): GET /p/<code>.
//
// A "Send to someone" link keeps its item in the #fragment, which chat
// apps never see, so their card shows the general orOS picture. For an
// unlocked song (kind "track") the sender may instead give
//   https://<relay>/p/1.<base64url of deflate-raw JSON>
// This page answers with Open Graph / Twitter tags (title, artist,
// album, licence, the cover's own address) and forwards the browser to
//   https://useoros.online/share/#<the same code>
// where the song opens as before. The song's details pass through the
// relay in the path: nothing is stored, logged or fetched (the cover is
// only named, never proxied), and the sender chose this link.
//
// Rules (Mail thread, 2026-11-07): GET / HEAD only (405), path ≤ 4 KB,
// the code's characters checked before any decoding, only "1." codes
// (a locked code is never parsed), inflate stopped past 16 KB, kinds
// "track" and "tracks" (album / playlist, wave 3) only, through the same
// normalizers as share/kinds.js (normTrack / normTracks below; parity-tested),
// every field escaped with control and bidi characters out and capped,
// the cover an https URL on the music hosts only (exact host or a
// subdomain, no userinfo, no port, ≤ 512 characters), the forward URL
// rebuilt from the checked code. Anything else gets a plain 302 to
// /share/ that echoes nothing of the code. Fixed text on errors; nothing
// throws out of handlePreview().
//
// GET /p/s.<id> (BR-SHARE-SHORT, relay/short.js) is the short form: the
// song's normalized details come from D1, go through the normalizers
// again, and the page and its forward code are made the same way.
// ============================================================

import { shortItem, SHORT_RE } from "./short.js";

export const PV_LIMITS = {
  path: 4096,          // characters of the whole path
  json: 16384,         // bytes after inflate (bomb guard)
  perMin: 120,         // GET /p/ per client IP per minute (per isolate, best effort)
  t: 120, a: 120, al: 120, li: 60, img: 512
};
export const SHARE_PAGE = "https://useoros.online/share/";
const OG_FALLBACK = "https://useoros.online/icons/og-image.png";
const CODE_RE = /^1\.[A-Za-z0-9_-]{4,4090}$/;

// ---------- the song normalizer (= share/kinds.js normTrack) ----------
const TRACK_SRC = ["ia", "ov", "cc", "jm", "ln", "own"];
const OPEN_HOSTS = /(^|\.)(archive\.org|jamendo\.com|ccmixter\.org|openverse\.org|freesound\.org|wikimedia\.org)$/i;
const TRACK_LI = /^(cc0|pdm|lma|by(-nc)?(-sa|-nd)?|(nc-)?sampling\+)( \d\.\d)?$/;
function line(v, max) {
  if (typeof v !== "string") return "";
  v = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  return v.length > max ? v.slice(0, max).trim() : v;
}
function num(v, lo, hi) { return (typeof v === "number" && isFinite(v) && v >= lo && v <= hi) ? v : null; }
function httpsOn(v, hosts, plain) {
  v = line(v, 2048);
  if (!/^https:\/\//i.test(v)) return "";
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password) return "";
    if (hosts && !hosts.test(u.hostname)) return "";
    if (plain && (u.search || u.hash)) return "";
    return u.href.length > 2048 ? "" : u.href;
  } catch (e) { return ""; }
}
export function normTrack(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const t = line(d.t, 200);
  if (!t) return null;
  const s = TRACK_SRC.indexOf(d.s) >= 0 ? d.s : "own";
  const o = { t, a: line(d.a, 200), s };
  const al = line(d.al, 200);
  if (al) o.al = al;
  if (typeof d.y === "string" && /^\d{4}$/.test(d.y)) o.y = d.y;
  const len = num(d.d, 1, 359999);
  if (len !== null) o.d = Math.round(len);
  if (s === "own") return o;
  const open = s !== "ln";
  const u = httpsOn(d.u, open ? OPEN_HOSTS : null, !open);
  if (u) o.u = u;
  if (typeof d.k === "string" && d.k.length <= 44 && d.k.indexOf(s + ":") === 0 && /^[a-z]{1,3}:[0-9a-z]{6,40}$/.test(d.k)) o.k = d.k;
  if (!open) return o;
  const pg = httpsOn(d.pg, OPEN_HOSTS), art = httpsOn(d.art, OPEN_HOSTS);
  if (pg) o.pg = pg;
  if (art) o.art = art;
  if (typeof d.li === "string" && TRACK_LI.test(d.li)) o.li = d.li;
  if (typeof d.vi === "string" && /^[a-z_]{1,30}$/.test(d.vi)) o.vi = d.vi;
  const cr = line(d.cr, 600);
  if (cr) o.cr = cr;
  return o;
}

// An album or a playlist (= share/kinds.js normTracks).
export function normTracks(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const i = [];
  (Array.isArray(d.i) ? d.i.slice(0, 200) : []).forEach((x) => {
    const o = x && typeof x === "object" && !Array.isArray(x) ? normTrack(x) : null;
    if (o) { delete o.cr; i.push(o); }
  });
  if (!i.length) return null;
  const o = { t: line(d.t, 200), ty: d.ty === "al" ? "al" : "pl", i };
  const a = line(d.a, 200), art = httpsOn(d.art, OPEN_HOSTS), cr = line(d.cr, 600);
  if (a) o.a = a;
  if (art) o.art = art;
  if (cr) o.cr = cr;
  return o;
}

// ---------- decoding ----------
function unb64u(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
// Inflate with a hard cap: the reader stops (and cancels) past PV_LIMITS.json.
async function inflate(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  w.write(bytes).catch(() => {});
  w.close().catch(() => {});
  const r = ds.readable.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const x = await r.read();
    if (x.done) break;
    n += x.value.length;
    if (n > PV_LIMITS.json) { r.cancel().catch(() => {}); throw new Error("big"); }
    parts.push(x.value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
// The code → { k, d } normalized (a song, an album or a playlist), or
// null (any failure, any other kind).
export async function songOf(code) {
  if (typeof code !== "string" || !CODE_RE.test(code)) return null;
  try {
    const raw = await inflate(unb64u(code.slice(2)));
    const env = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!env || env.v !== 1) return null;
    // A list over 200 songs gets no preview (never cut silently).
    if (env.k === "tracks" && !(env.d && Array.isArray(env.d.i) && env.d.i.length <= 200)) return null;
    const d = env.k === "track" ? normTrack(env.d) : env.k === "tracks" ? normTracks(env.d) : null;
    return d ? { k: env.k, d } : null;
  } catch (e) { return null; }
}

// ---------- the page ----------
function clean(v, max) {
  if (typeof v !== "string") return "";
  v = v.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  return v.length > max ? v.slice(0, max - 1).trim() + "\u2026" : v;
}
export function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const IMG_HOSTS = ["archive.org", "jamendo.com", "ccmixter.org", "openverse.org", "freesound.org", "wikimedia.org"];
export function coverOk(v) {
  if (typeof v !== "string" || v.length > PV_LIMITS.img || !/^https:\/\//i.test(v)) return "";
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return "";
    const h = u.hostname.toLowerCase();
    if (!IMG_HOSTS.some((x) => h === x || h.endsWith("." + x))) return "";
    return u.href.length > PV_LIMITS.img ? "" : u.href;
  } catch (e) { return ""; }
}
function licText(li) {
  if (!li) return "";
  if (li.indexOf("cc0") === 0) return "CC0";
  if (li.indexOf("pdm") === 0) return "Public domain";
  if (li === "lma") return "Live Music Archive";
  return "CC " + li.toUpperCase();
}
export function pageFor(item, code) {
  const d = item.d, list = item.k === "tracks";
  // A list shows only its name, "Album/Playlist · N songs" (N counted
  // after the normalizer) and its own cover: no song titles, no
  // artist, never a song's cover in its place (Mail thread, 2026-11-07).
  const t = clean(d.t || (list ? (d.ty === "al" ? "Album" : "Playlist") : ""), PV_LIMITS.t), a = list ? "" : clean(d.a, PV_LIMITS.a);
  const al = list ? (d.ty === "al" ? "Album" : "Playlist") + " \u00b7 " + (d.i.length === 1 ? "1 song" : d.i.length + " songs") : clean(d.al || "", PV_LIMITS.al);
  const li = list ? "" : clean(licText(d.li), PV_LIMITS.li);
  const img = coverOk(d.art);
  const title = "\ud83c\udfb5 " + t + (a ? " \u00b7 " + a : "");
  const desc = [al, li, "orOS"].filter(Boolean).join(" \u00b7 ");
  const go = SHARE_PAGE + "#" + code;        // code passed CODE_RE
  return "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    "<title>" + esc(title) + "</title>" +
    "<meta property=\"og:type\" content=\"music.song\">" +
    "<meta property=\"og:site_name\" content=\"orOS\">" +
    "<meta property=\"og:title\" content=\"" + esc(title) + "\">" +
    "<meta property=\"og:description\" content=\"" + esc(desc) + "\">" +
    "<meta property=\"og:image\" content=\"" + esc(img || OG_FALLBACK) + "\">" +
    "<meta name=\"twitter:card\" content=\"" + (img ? "summary" : "summary_large_image") + "\">" +
    "<meta name=\"twitter:title\" content=\"" + esc(title) + "\">" +
    "<meta name=\"twitter:description\" content=\"" + esc(desc) + "\">" +
    "<meta name=\"twitter:image\" content=\"" + esc(img || OG_FALLBACK) + "\">" +
    "<meta http-equiv=\"refresh\" content=\"0;url=" + esc(go) + "\">" +
    "</head><body><p><a href=\"" + esc(go) + "\">" + esc(title) + "</a></p></body></html>\n";
}

const CSP = "default-src 'none'; img-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function headers(extra) {
  return Object.assign({
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex",
    "Content-Security-Policy": CSP
  }, extra || {});
}
// No preview: straight to the share page, nothing of the code echoed.
function away() {
  return new Response(null, { status: 302, headers: headers({ "Location": SHARE_PAGE, "Cache-Control": "no-store" }) });
}

const hits = new Map();
function limited(ip, now) {
  if (!ip) return false;
  const h = hits.get(ip);
  if (!h || now - h.t > 60000) hits.set(ip, { t: now, n: 1 });
  else if (++h.n > PV_LIMITS.perMin) return true;
  if (hits.size > 5000) hits.clear();
  return false;
}
export function resetPreviewLimits() { hits.clear(); }

export async function handlePreview(request, url, ip, now, env) {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed\n", { status: 405, headers: headers({ "Content-Type": "text/plain; charset=utf-8", "Allow": "GET, HEAD", "Cache-Control": "no-store" }) });
    }
    if (limited(ip, now)) {
      return new Response("too many requests\n", { status: 429, headers: headers({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }) });
    }
    const path = url.pathname;
    if (path.length > PV_LIMITS.path || url.search) return away();
    let code = path.slice(3);                   // after "/p/"
    let item;
    if (SHORT_RE.test(code)) {
      const got = await shortItem(code, env, now);
      if (!got) return away();
      item = got.item;
      code = got.code;
    } else {
      if (!CODE_RE.test(code)) return away();
      item = await songOf(code);
    }
    if (!item) return away();
    const body = pageFor(item, code);
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers: headers({ "Cache-Control": "public, max-age=86400" }) });
  } catch (e) {
    return new Response("unavailable\n", { status: 503, headers: headers({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }) });
  }
}
