// ============================================================
// orOS Maps — osm.js (OpenStreetMap core, v1.0.0)
// Pure functions shared by the Maps OSM features (notes now; POI,
// quests and tracks in later waves). No DOM, no network, no storage:
// Node-tested in tests/maps-osm.test.js.
//
// What lives here:
//   - SERVERS: the two OSM servers (live / dev test server) and the
//     OAuth 2.0 client ids registered by the owner (public clients,
//     PKCE, no secret — a client id is not a secret).
//   - PKCE helpers (verifier, S256 challenge) and the authorize URL.
//   - Note parsing: OSM API GeoJSON → a strict, text-only shape. The
//     API's "html" field is NEVER used; links are split out of the
//     plain text so the UI can build them with textContent.
//   - The synced slice "mapsosm" (key oros-maps-osm-data):
//       { ver, set{m, comment}, drafts{id: draft}, tombs{id: ts} }
//     drafts = note actions not sent yet (new note, comment, close,
//     reopen), created offline or after a failed send. LWW by m,
//     equal m → larger canonical JSON; tombs max; a tomb ≥ m drops
//     the draft (delete wins ties, a newer edit resurrects). Only the
//     device named in draft.dev sends a draft automatically, so two
//     devices never send the same note twice.
//
// API (window.OrosMapsOSM, module.exports in Node):
//   VER, DATA_VER, SERVERS, DEFAULT_COMMENT, SCOPES, limits
//   b64url(bytes), randomString(n), pkceChallenge(verifier) → Promise
//   authorizeUrl(srv, opts)
//   parseNote(feature), parseNotes(json), splitLinks(text)
//   cleanText(s, max), normDraft(d), normalize(data), merge(A, B)
//   uploadComment(data), nearNotes(notes, lat, lon, m), distM(...)
//   osmDate(s) → ms, lastOtherDate(note, uid) → ms
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var DATA_VER = 1;
  var DEFAULT_COMMENT = "Uploaded using orOS Maps";

  // client: the OAuth 2.0 client id registered on that server by the
  // owner (Register new application → "Confidential application?"
  // UNCHECKED, redirect https://useoros.online/maps/osm-callback.html).
  // Empty = sign-in not set up yet; the UI says so instead of failing.
  var SERVERS = {
    live: {
      web: "https://www.openstreetmap.org",
      api: "https://api.openstreetmap.org",
      client: ""
    },
    dev: {
      web: "https://master.apis.dev.openstreetmap.org",
      api: "https://master.apis.dev.openstreetmap.org",
      client: ""
    }
  };
  var SCOPES = ["read_prefs", "write_api", "write_notes", "read_gpx", "write_gpx"];

  var LIM = {
    noteText: 2000,          // OSM rejects longer note text
    commentText: 2000,
    userName: 255,
    drafts: 500,
    tombs: 2000,
    err: 200,
    setComment: 255          // changeset tag value limit
  };
  var KINDS = { note: 1, comment: 1, close: 1, reopen: 1 };
  var ACTIONS = { opened: 1, commented: 1, closed: 1, reopened: 1, hidden: 1 };
  var ID_RE = /^[a-z0-9]{6,40}$/;
  var DEV_RE = /^[a-z0-9]{4,40}$/;

  // ---------- small helpers ----------
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function okLat(v) { return isNum(v) && v >= -90 && v <= 90; }
  function okLon(v) { return isNum(v) && v >= -180 && v <= 180; }
  function okM(v) { return isNum(v) && v >= 0 && v <= 8.64e15 && Math.floor(v) === v; }

  // Control characters out (tab / newline kept), trimmed, capped.
  function cleanText(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    s = s.replace(/^\s+|\s+$/g, "");
    if (max && s.length > max) s = s.slice(0, max);
    return s;
  }

  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ":" + canon(v[k]);
    }).join(",") + "}";
  }

  function b64url(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    var b = typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
    return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function cryptoObj() {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) return crypto;
    return null;
  }

  // URL-safe random string of n characters (PKCE verifier, state).
  function randomString(n) {
    var c = cryptoObj();
    var bytes = new Uint8Array(Math.ceil(n * 3 / 4) + 3);
    c.getRandomValues(bytes);
    return b64url(bytes).slice(0, n);
  }

  // S256 code challenge (RFC 7636).
  function pkceChallenge(verifier) {
    var c = cryptoObj();
    var data = new TextEncoder().encode(verifier);
    return c.subtle.digest("SHA-256", data).then(function (buf) {
      return b64url(new Uint8Array(buf));
    });
  }

  function authorizeUrl(srv, opts) {
    var s = SERVERS[srv] || SERVERS.live;
    var q = [
      "response_type=code",
      "client_id=" + encodeURIComponent(opts.client || s.client),
      "redirect_uri=" + encodeURIComponent(opts.redirect),
      "scope=" + encodeURIComponent(SCOPES.join(" ")),
      "state=" + encodeURIComponent(opts.state),
      "code_challenge=" + encodeURIComponent(opts.challenge),
      "code_challenge_method=S256"
    ];
    return s.web + "/oauth2/authorize?" + q.join("&");
  }

  // ---------- notes (OSM API 0.6, GeoJSON) ----------
  // Text only. Unknown actions / statuses are dropped or defaulted;
  // the "html" field of a comment is never read.
  function parseNote(f) {
    if (!f || typeof f !== "object") return null;
    var g = f.geometry, p = f.properties;
    if (!g || !p || !Array.isArray(g.coordinates)) return null;
    var lon = g.coordinates[0], lat = g.coordinates[1];
    if (!okLat(lat) || !okLon(lon)) return null;
    var id = p.id;
    if (typeof id === "string" && /^\d{1,12}$/.test(id)) id = +id;
    if (!isNum(id) || id <= 0 || Math.floor(id) !== id) return null;
    var status = p.status === "closed" ? "closed" : p.status === "hidden" ? "hidden" : "open";
    var comments = [];
    (Array.isArray(p.comments) ? p.comments : []).slice(0, 500).forEach(function (c) {
      if (!c || typeof c !== "object") return;
      var action = ACTIONS[c.action] ? c.action : "commented";
      var uid = isNum(c.uid) ? c.uid : 0;
      comments.push({
        date: cleanText(typeof c.date === "string" ? c.date : "", 40),
        user: cleanText(typeof c.user === "string" ? c.user : "", LIM.userName),
        uid: uid,
        action: action,
        text: cleanText(typeof c.text === "string" ? c.text : "", 20000)
      });
    });
    return {
      id: id, lat: lat, lon: lon, status: status,
      created: cleanText(typeof p.date_created === "string" ? p.date_created : "", 40),
      closedAt: cleanText(typeof p.closed_at === "string" ? p.closed_at : "", 40),
      comments: comments
    };
  }

  function parseNotes(json) {
    var out = [];
    if (!json || typeof json !== "object") return out;
    var list = json.type === "FeatureCollection" ? json.features :
               json.type === "Feature" ? [json] : null;
    if (!Array.isArray(list)) return out;
    var seen = {};
    list.forEach(function (f) {
      var n = parseNote(f);
      if (n && !seen[n.id]) { seen[n.id] = 1; out.push(n); }
    });
    return out;
  }

  // Plain text → [{t:"text"|"link", v}]. Only http(s) URLs become
  // links; trailing punctuation stays text. The UI builds both parts
  // with textContent, so nothing in a note is ever parsed as HTML.
  var URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
  function splitLinks(text) {
    var out = [];
    text = typeof text === "string" ? text : "";
    var last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text))) {
      var url = m[0];
      var trail = url.match(/[.,;:!?)\]}]+$/);
      if (trail) url = url.slice(0, url.length - trail[0].length);
      if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
      out.push({ t: "link", v: url });
      last = m.index + url.length;
      URL_RE.lastIndex = last;
    }
    if (last < text.length) out.push({ t: "text", v: text.slice(last) });
    return out;
  }

  // "2026-10-13 06:00:00 UTC" (API 0.6) or ISO → ms, 0 if unreadable.
  function osmDate(s) {
    if (typeof s !== "string") return 0;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(?:UTC|Z|\+00:00)?$/);
    if (!m) return 0;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return isFinite(t) ? t : 0;
  }

  // Latest comment date by someone other than uid (replies to me).
  function lastOtherDate(note, uid) {
    var best = 0;
    (note && note.comments || []).forEach(function (c) {
      if (c.uid !== uid) best = Math.max(best, osmDate(c.date));
    });
    return best;
  }

  var R = 6371000;
  function distM(lat1, lon1, lat2, lon2) {
    var toR = Math.PI / 180;
    var dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toR) * Math.cos(lat2 * toR) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Open notes within m metres, nearest first (duplicate check
  // before a new note).
  function nearNotes(notes, lat, lon, m) {
    return (notes || []).filter(function (n) { return n.status === "open"; })
      .map(function (n) { return { n: n, d: distM(lat, lon, n.lat, n.lon) }; })
      .filter(function (x) { return x.d <= m; })
      .sort(function (a, b) { return a.d - b.d || a.n.id - b.n.id; })
      .map(function (x) { return x.n; });
  }

  // ---------- slice "mapsosm" ----------
  function normDraft(d) {
    if (!d || typeof d !== "object") return null;
    if (typeof d.id !== "string" || !ID_RE.test(d.id)) return null;
    if (!okM(d.m) || !KINDS[d.kind]) return null;
    if (typeof d.dev !== "string" || !DEV_RE.test(d.dev)) return null;
    var srv = d.srv === "dev" ? "dev" : "live";
    var max = d.kind === "note" ? LIM.noteText : LIM.commentText;
    var text = cleanText(d.text, max);
    var o = { id: d.id, m: d.m, dev: d.dev, kind: d.kind, srv: srv };
    if (d.kind === "note") {
      if (!okLat(d.lat) || !okLon(d.lon) || !text) return null;
      o.lat = Math.round(d.lat * 1e7) / 1e7;
      o.lon = Math.round(d.lon * 1e7) / 1e7;
    } else {
      if (!isNum(d.note) || d.note <= 0 || Math.floor(d.note) !== d.note) return null;
      if (d.kind === "comment" && !text) return null;
      o.note = d.note;
    }
    o.text = text;
    var err = cleanText(d.err, LIM.err);
    if (err) o.err = err;
    return o;
  }

  function normalize(data) {
    var out = { ver: DATA_VER, set: { m: 0, comment: "" }, drafts: {}, tombs: {} };
    if (!data || typeof data !== "object") return out;
    var s = data.set;
    if (s && typeof s === "object" && okM(s.m)) {
      out.set = { m: s.m, comment: cleanText(s.comment, LIM.setComment).replace(/\s+/g, " ") };
    }
    var tombs = {};
    var t = data.tombs && typeof data.tombs === "object" ? data.tombs : {};
    Object.keys(t).forEach(function (id) {
      if (ID_RE.test(id) && okM(t[id])) tombs[id] = t[id];
    });
    var tids = Object.keys(tombs);
    if (tids.length > LIM.tombs) {
      tids.sort(function (a, b) { return tombs[b] - tombs[a] || (a < b ? -1 : a > b ? 1 : 0); });
      tids.slice(LIM.tombs).forEach(function (id) { delete tombs[id]; });
    }
    Object.keys(tombs).sort().forEach(function (id) { out.tombs[id] = tombs[id]; });
    var drafts = {};
    var src = data.drafts && typeof data.drafts === "object" ? data.drafts : {};
    Object.keys(src).forEach(function (k) {
      var d = normDraft(src[k]);
      if (!d || d.id !== k) return;
      if (out.tombs[d.id] !== undefined && out.tombs[d.id] >= d.m) return;
      drafts[d.id] = d;
    });
    var ids = Object.keys(drafts).sort(function (a, b) {
      return drafts[b].m - drafts[a].m || (a < b ? -1 : a > b ? 1 : 0);
    }).slice(0, LIM.drafts).sort();
    ids.forEach(function (id) { out.drafts[id] = drafts[id]; });
    return out;
  }

  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }

  // Symmetric, idempotent, associative (fuzz in the tests).
  function merge(A, B) {
    var a = normalize(A), b = normalize(B);
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (t) {
      Object.keys(t).forEach(function (id) { tombs[id] = Math.max(tombs[id] || 0, t[id]); });
    });
    var drafts = {};
    [a.drafts, b.drafts].forEach(function (ds) {
      Object.keys(ds).forEach(function (id) { drafts[id] = newer(drafts[id], ds[id]); });
    });
    return normalize({ set: newer(a.set, b.set), drafts: drafts, tombs: tombs });
  }

  function uploadComment(data) {
    var c = data && data.set && data.set.comment;
    return c ? c : DEFAULT_COMMENT;
  }

  var api = {
    VER: VER, DATA_VER: DATA_VER, SERVERS: SERVERS, SCOPES: SCOPES,
    DEFAULT_COMMENT: DEFAULT_COMMENT, LIM: LIM, ID_RE: ID_RE, DEV_RE: DEV_RE,
    cleanText: cleanText, canon: canon, b64url: b64url,
    randomString: randomString, pkceChallenge: pkceChallenge, authorizeUrl: authorizeUrl,
    parseNote: parseNote, parseNotes: parseNotes, splitLinks: splitLinks,
    distM: distM, nearNotes: nearNotes, osmDate: osmDate, lastOtherDate: lastOtherDate,
    normDraft: normDraft, normalize: normalize, merge: merge, uploadComment: uploadComment
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsOSM = api;
})(typeof window !== "undefined" ? window : this);
