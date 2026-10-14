// ============================================================
// orOS Quote — accept-core.js (pure, v1.0.0, wave 46)
// "Accept by link": a quote travels to the client INSIDE a link and
// the client's answer travels back inside another one. No server,
// no account, nothing stored anywhere but the user's own orOS.
//
//   offer link   https://<orOS>/quote/accept.html#q1.<base64url of
//                deflate-raw JSON>   ("q0." = plain JSON when the
//                browser has no CompressionStream)
//   answer link  https://<orOS>/quote/#acc=a1.<base64url of JSON>
//
// The part after "#" never reaches a server (the same rule as the
// "Send to someone" links, share/kinds.js).
//
// How tampering is caught (a simple scheme, documented honestly):
//   - When the user sends a quote, Quote makes a random token (128
//     bits) and the SHA-256 of the exact snapshot it puts in the
//     link (the token is inside the snapshot), and keeps both on the
//     quote (q.share = { tok, h, at, f, fe }, synced with the quote).
//   - The client's page computes the SHA-256 of what it SHOWED and
//     puts it in the answer with the token, the typed name and the
//     time.
//   - Back in Quote, an answer counts only when its token is the
//     quote's current token (it came from the link the user sent
//     last) AND its hash equals the stored hash (the client saw
//     exactly what was sent, not an edited link).
//   What it does NOT prove: who the person is (the name is typed),
//   or that the answer was not copied by someone else who had the
//   link. It is not a legal electronic signature.
//
// API (window.OrosQuoteAccept / module.exports):
//   snapshot(q, client, from)  → the normalized snapshot of a quote
//                                (needs q.share.tok or from.tok)
//   norm(o)                    → normalized snapshot | null (hostile)
//   canon(o)                   → canonical JSON (sorted keys)
//   digest(snap)               → Promise<hex SHA-256 of canon(snap)>
//   totals(snap)               → { sub, disc, net, vat, total, lines[] }
//   encodeOffer(snap)          → Promise<code "q1.…" | "q0.…">
//   decodeOffer(code)          → Promise<{ snap } | { error }>
//   offerCodeFromHash(hash)    → the code in "#q1.…", or ""
//   makeReply(r)               → "a1.…" for { i, t, h, n, at, m? }
//   readReply(text)            → { i, t, h, n, at, m } | null
//                                (takes a code or a whole link)
//   verify(q, reply)           → "ok" | "tampered" | "stale" | "none"
//   newToken()                 → 22 base64url characters (128 bits)
// ============================================================
(function (root) {
  "use strict";

  var MAX_CODE = 32768;           // characters after "#"
  var MAX_JSON = 262144;          // bytes after inflating (bomb guard)
  var YMD = /^\d{4}-\d{2}-\d{2}$/;
  var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  var TOK_RE = /^[A-Za-z0-9_-]{16,43}$/;
  var HEX_RE = /^[0-9a-f]{64}$/;

  // ---------- text caps (plain text only; views use textContent) ----------
  function line(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function block(v, max) {
    return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "";
  }
  function num(v, lo, hi) {
    return typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? Math.round(v * 1000) / 1000 : 0;
  }
  function ymd(v) { return typeof v === "string" && YMD.test(v) ? v : ""; }
  function email(v) {
    var s = line(v, 120);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
  }
  function cur(v) { return typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : "EUR"; }

  // ---------- the snapshot ----------
  // Short keys keep the link short:
  //   v 1 · id quote id · tok token · n number · d date · u valid until
  //   c currency · f from (sender) · fe sender email (for the answer)
  //   cl { n name, a address, t tax id } · it [{ c code, d text, q qty,
  //   p unit price, x line discount %, v VAT % }] · g discount %
  //   pay payment terms · no notes · ins [{ d day, a amount }]
  function norm(o) {
    if (!o || typeof o !== "object" || Array.isArray(o) || o.v !== 1) return null;
    if (typeof o.id !== "string" || !ID_RE.test(o.id)) return null;
    if (typeof o.tok !== "string" || !TOK_RE.test(o.tok)) return null;
    var cl = o.cl && typeof o.cl === "object" ? o.cl : {};
    var out = {
      v: 1, id: o.id, tok: o.tok, n: line(o.n, 60), d: ymd(o.d), u: ymd(o.u), c: cur(o.c),
      f: line(o.f, 120), fe: email(o.fe),
      cl: { n: line(cl.n, 120), a: block(cl.a, 300), t: line(cl.t, 60) },
      it: [], g: num(o.g, 0, 100), pay: block(o.pay, 2000), no: block(o.no, 2000), ins: []
    };
    (Array.isArray(o.it) ? o.it.slice(0, 100) : []).forEach(function (x) {
      if (!x || typeof x !== "object") return;
      var r = { c: line(x.c, 30), d: line(x.d, 200), q: num(x.q, 0, 1000000), p: num(x.p, 0, 10000000000),
                x: num(x.x, 0, 100), v: num(x.v, 0, 100) };
      if (r.d || r.c || r.p) out.it.push(r);
    });
    (Array.isArray(o.ins) ? o.ins.slice(0, 24) : []).forEach(function (x) {
      if (!x || typeof x !== "object") return;
      out.ins.push({ d: ymd(x.d), a: num(x.a, 0, 10000000000) });
    });
    return out;
  }
  // q = a Quote quote, client = its client (or null), from = { f, fe, tok? }
  function snapshot(q, client, from) {
    if (!q || typeof q !== "object") return null;
    from = from || {};
    var c = client || {};
    return norm({
      v: 1, id: q.id, tok: from.tok || (q.share && q.share.tok) || "",
      n: q.num, d: q.date, u: q.dueDate, c: q.currency,
      f: from.f !== undefined ? from.f : (q.share && q.share.f), fe: from.fe !== undefined ? from.fe : (q.share && q.share.fe),
      cl: { n: c.name, a: c.address, t: c.taxId },
      it: (q.items || []).map(function (it) {
        return { c: it.code, d: it.desc, q: it.qty, p: it.price, x: it.disc, v: it.vat };
      }),
      g: q.gDisc, pay: q.payment, no: q.notes,
      ins: (q.instalments || []).map(function (i) { return { d: i.date, a: i.amount }; })
    });
  }

  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }

  function subtle() {
    var c = (typeof crypto !== "undefined" && crypto) || (root && root.crypto);
    return c && c.subtle ? c : null;
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function digest(snap) {
    var c = subtle();
    if (!c) return Promise.reject(new Error("crypto"));
    return c.subtle.digest("SHA-256", new TextEncoder().encode(canon(snap))).then(hex);
  }

  // The same sums as quote.js calcTotals (line discount, then the
  // whole-quote discount, VAT on the discounted net), rounded alike.
  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function totals(s) {
    var sub = 0, vat = 0, g = (s && s.g) || 0, lines = [];
    ((s && s.it) || []).forEach(function (x) {
      var gross = x.q * x.p * (1 - x.x / 100);
      var net = gross * (1 - g / 100);
      sub += gross;
      vat += net * (x.v / 100);
      lines.push(r2(net * (1 + x.v / 100)));
    });
    sub = r2(sub);
    vat = r2(vat);
    var net = r2(sub * (1 - g / 100));
    return { sub: sub, disc: r2(sub - net), net: net, vat: vat, total: r2(net + vat), lines: lines };
  }

  // ---------- bytes ----------
  function b64u(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(s) {
    var b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    var bin = atob(b), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hasZip() { return typeof CompressionStream === "function" && typeof DecompressionStream === "function"; }
  function deflate(bytes) {
    var s = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Response(s).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  function inflate(bytes) {
    var reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    var parts = [], total = 0;
    function step() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), at = 0;
          parts.forEach(function (p) { out.set(p, at); at += p.length; });
          return out;
        }
        total += r.value.length;
        if (total > MAX_JSON) { try { reader.cancel(); } catch (e) {} throw new Error("big"); }
        parts.push(r.value);
        return step();
      });
    }
    return step();
  }

  function encodeOffer(snap) {
    var s = norm(snap);
    if (!s) return Promise.reject(new Error("bad"));
    var raw = new TextEncoder().encode(JSON.stringify(s));
    if (!hasZip()) return Promise.resolve("q0." + b64u(raw));
    return deflate(raw).then(function (z) { return "q1." + b64u(z); });
  }
  function fromBytes(bytes) {
    if (bytes.length > MAX_JSON) return { error: "big" };
    var o;
    try { o = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch (e) { return { error: "bad" }; }
    var s = norm(o);
    return s ? { snap: s } : { error: "bad" };
  }
  function decodeOffer(code) {
    code = String(code || "");
    if (code.length > MAX_CODE + 8) return Promise.resolve({ error: "big" });
    var m = /^q([01])\.([A-Za-z0-9_-]+)$/.exec(code);
    if (!m) return Promise.resolve({ error: "bad" });
    var bytes;
    try { bytes = unb64u(m[2]); } catch (e) { return Promise.resolve({ error: "bad" }); }
    if (m[1] === "0") return Promise.resolve(fromBytes(bytes));
    if (!hasZip()) return Promise.resolve({ error: "zip" });
    return inflate(bytes).then(fromBytes, function (e) { return { error: e && e.message === "big" ? "big" : "bad" }; });
  }
  function offerCodeFromHash(h) {
    h = String(h || "");
    if (h.charAt(0) === "#") h = h.slice(1);
    return /^q[01]\.[A-Za-z0-9_-]+$/.test(h) ? h : "";
  }

  // ---------- the answer ----------
  function normReply(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    if (typeof o.i !== "string" || !ID_RE.test(o.i)) return null;
    if (typeof o.t !== "string" || !TOK_RE.test(o.t)) return null;
    if (typeof o.h !== "string" || !HEX_RE.test(o.h)) return null;
    var n = line(o.n, 80);
    if (!n) return null;
    var at = typeof o.at === "number" && isFinite(o.at) && o.at > 946684800000 && o.at < 4102444800000 ? Math.round(o.at) : 0;
    if (!at) return null;
    var out = { i: o.i, t: o.t, h: o.h, n: n, at: at };
    var m = block(o.m, 500);
    if (m) out.m = m;
    return out;
  }
  function makeReply(r) {
    var x = normReply(r);
    if (!x) return "";
    return "a1." + b64u(new TextEncoder().encode(JSON.stringify(x)));
  }
  // A code or anything that contains one (the whole link, a pasted
  // email with the link inside).
  function readReply(text) {
    text = String(text || "");
    if (text.length > 8000) return null;
    var m = /(?:^|[#&=\s?])(a1\.[A-Za-z0-9_-]{20,4000})/.exec(text) || /^(a1\.[A-Za-z0-9_-]{20,4000})/.exec(text.trim());
    if (!m) return null;
    try {
      var o = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(unb64u(m[1].slice(3))));
      return normReply(o);
    } catch (e) { return null; }
  }
  // "ok" — the answer came from the link sent last and the client saw
  //        exactly what was sent;
  // "tampered" — right token, but what the client saw is not what was
  //        sent (the link was edited);
  // "stale" — the quote was sent again since (another token), or the
  //        answer is for another quote;
  // "none" — this quote was never sent for acceptance.
  function verify(q, reply) {
    if (!q || !q.share || typeof q.share.tok !== "string") return "none";
    if (!reply || reply.i !== q.id || reply.t !== q.share.tok) return "stale";
    return reply.h === q.share.h ? "ok" : "tampered";
  }
  function newToken() {
    var c = subtle() || ((typeof crypto !== "undefined" && crypto && crypto.getRandomValues) ? crypto : null);
    var b = new Uint8Array(16);
    c.getRandomValues(b);
    return b64u(b);
  }

  var api = {
    MAX_CODE: MAX_CODE, norm: norm, snapshot: snapshot, canon: canon, digest: digest, totals: totals,
    encodeOffer: encodeOffer, decodeOffer: decodeOffer, offerCodeFromHash: offerCodeFromHash,
    makeReply: makeReply, readReply: readReply, verify: verify, newToken: newToken
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosQuoteAccept = api;
})(typeof window !== "undefined" ? window : globalThis);
