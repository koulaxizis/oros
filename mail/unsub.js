// ============================================================
// orOS Mail — List-Unsubscribe (RFC 2369, RFC 8058, RFC 6068) (v1.0.0)
// Pure: reads a message's List-Unsubscribe header into what Mail can
// offer.
//   parse(headers) → null | { mailto: { to, subject, body } | null,
//                             web: "https://…" | null, oneClick }
//     headers: mime.js parseHeaders() map (lower-case keys, unfolded)
//     mailto: the first mailto: URI with a valid address
//     web:    the first http(s) URI (shown to the person, then opened
//             in a new tab; a browser cannot make the RFC 8058
//             one-click POST to another site, so oneClick is only
//             reported, never acted on)
//   mailto(uri) → { to, subject, body } | null   (RFC 6068)
// ============================================================
(function (root) {
  "use strict";
  var ADDR = /^[^\s@<>()",;:\\\[\]]+@[^\s@<>()",;:\\\[\]]+\.[^\s@<>()",;:\\\[\]]+$/;
  var MAX_URI = 2000;

  function pctAddr(s) {
    try { return decodeURIComponent(String(s)); } catch (e) { return null; }
  }
  function mailto(uri) {
    uri = String(uri || "").trim();
    if (!/^mailto:/i.test(uri) || uri.length > MAX_URI) return null;
    var rest = uri.slice(7), q = rest.indexOf("?");
    var addrs = (q >= 0 ? rest.slice(0, q) : rest).split(",");
    var subject = "", body = "";
    if (q >= 0) {
      rest.slice(q + 1).split("&").forEach(function (kv) {
        var i = kv.indexOf("=");
        if (i <= 0) return;
        var k = kv.slice(0, i).toLowerCase(), v = kv.slice(i + 1);
        if (k === "to") addrs = addrs.concat(v.split(","));
        // "+" is a plus in mailto: (RFC 6068 §5); only %20 is a space
        else if (k === "subject" && !subject) subject = pctAddr(v) || "";
        else if (k === "body" && !body) body = pctAddr(v) || "";
      });
    }
    var to = "";
    for (var i = 0; i < addrs.length && !to; i++) {
      var a = pctAddr(addrs[i]);
      if (a && a.length <= 254 && ADDR.test(a.trim())) to = a.trim();
    }
    if (!to) return null;
    return { to: to,
             subject: subject.replace(/[\r\n\t]+/g, " ").trim().slice(0, 300),
             body: body.replace(/\r\n?/g, "\n").slice(0, 2000) };
  }

  function uris(v) {
    var out = [], re = /<([^<>]*)>/g, m;
    while ((m = re.exec(String(v || ""))) !== null) {
      var u = m[1].replace(/\s+/g, "");
      if (u) out.push(u);
    }
    return out;
  }
  function webOk(u) {
    if (u.length > MAX_URI || !/^https?:\/\/[^\s\/?#@]+/i.test(u)) return false;
    try {
      var x = new URL(u);
      return (x.protocol === "https:" || x.protocol === "http:") && !!x.hostname && !x.username && !x.password;
    } catch (e) { return false; }
  }

  function parse(headers) {
    var h = headers || {};
    var vals = h["list-unsubscribe"];
    if (!Array.isArray(vals) || !vals.length) return null;
    var mt = null, web = null;
    uris(vals.join(",")).forEach(function (u) {
      if (!mt && /^mailto:/i.test(u)) mt = mailto(u);
      else if (!web && /^https?:/i.test(u) && webOk(u)) web = u;
    });
    if (!mt && !web) return null;
    var post = (h["list-unsubscribe-post"] || []).join(" ");
    return { mailto: mt, web: web, oneClick: !!web && /List-Unsubscribe\s*=\s*One-Click/i.test(post) };
  }

  var api = { parse: parse, mailto: mailto };
  root.orosMailUnsub = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
