// ============================================================
// orOS Mail — PGP/MIME (RFC 3156) and inline OpenPGP, the MIME side
// (v1.0.0). Pure, no crypto: pgp.js does the signing / encrypting
// with OpenPGP.js; this file builds and takes apart the MIME around it.
// Strings are "binary strings" (one char = one byte), as in mime.js
// and compose.js.
//
// Sending (compose.js content() gives the inner part { head, body }):
//   entity(part) → the bytes that are signed / encrypted
//   signed(part, sigArmored, micalg?) → { head, body }
//     multipart/signed; protocol="application/pgp-signature"
//   encrypted(armored) → { head, body }
//     multipart/encrypted; protocol="application/pgp-encrypted"
//   The result goes to compose.js build() as o.part.
// Reading:
//   find(bin) → null
//     | { kind: "encrypted", armored }
//     | { kind: "signed", entity, sig, micalg }
//     The PGP/MIME structure at the top of the message, or as the
//     first part of a multipart/mixed (a list footer added after it).
//   inline(text) → null
//     | { kind: "inline-enc", armored, before, after }
//     | { kind: "inline-signed", armored, before, after }
//   isKey(text) → bool   an armored public key block
//   crlf(s) → s with CRLF line ends
// ============================================================
(function (root) {
  "use strict";
  var CRLF = "\r\n";

  function crlf(s) { return String(s || "").replace(/\r\n|\r|\n/g, CRLF); }
  function randomHex() {
    var a = new Uint8Array(12);
    (root.crypto || require("crypto").webcrypto).getRandomValues(a);
    return Array.from(a, function (x) { return (x + 256).toString(16).slice(1); }).join("");
  }
  function boundary() { return "=_orOS_pgp_" + randomHex(); }

  function entity(part) {
    return crlf(part.head).replace(/\r\n$/, "") + CRLF + CRLF + crlf(part.body).replace(/\r\n$/, "");
  }
  function wrap(type, params, parts) {
    var bd = boundary();
    var body = "This is an OpenPGP/MIME " + (type === "signed" ? "signed" : "encrypted") + " message (RFC 4880 and 3156)" + CRLF;
    parts.forEach(function (p) { body += "--" + bd + CRLF + p + CRLF; });
    body += "--" + bd + "--";
    return { head: "Content-Type: multipart/" + type + "; boundary=\"" + bd + "\";" + CRLF + " " + params + CRLF, body: body };
  }
  // the signed entity goes in byte for byte: the receiver hashes
  // exactly what lies between "--boundary CRLF" and "CRLF --boundary"
  function signed(part, sig, micalg) {
    var alg = /^pgp-[a-z0-9-]{2,20}$/.test(String(micalg || "")) ? micalg : "pgp-sha256";
    return wrap("signed", "micalg=\"" + alg + "\"; protocol=\"application/pgp-signature\"", [
      entity(part),
      "Content-Type: application/pgp-signature; name=\"signature.asc\"" + CRLF +
      "Content-Description: OpenPGP digital signature" + CRLF +
      "Content-Disposition: attachment; filename=\"signature.asc\"" + CRLF + CRLF + crlf(sig).replace(/\r\n$/, "")
    ]);
  }
  function encrypted(armored) {
    return wrap("encrypted", "protocol=\"application/pgp-encrypted\"", [
      "Content-Type: application/pgp-encrypted" + CRLF +
      "Content-Description: PGP/MIME version identification" + CRLF + CRLF + "Version: 1",
      "Content-Type: application/octet-stream; name=\"encrypted.asc\"" + CRLF +
      "Content-Description: OpenPGP encrypted message" + CRLF +
      "Content-Disposition: inline; filename=\"encrypted.asc\"" + CRLF + CRLF + crlf(armored).replace(/\r\n$/, "")
    ]);
  }

  // ---------- reading ----------
  function splitHead(bin) {
    var m = /\r?\n\r?\n/.exec(bin);
    if (!m) return { head: bin, body: "" };
    return { head: bin.slice(0, m.index), body: bin.slice(m.index + m[0].length) };
  }
  function header(head, name) {
    var re = new RegExp("^" + name + "[ \\t]*:([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)", "im");
    var m = re.exec(head);
    return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : "";
  }
  function ctype(head) {
    var v = header(head, "Content-Type") || "text/plain";
    var type = v.split(";")[0].trim().toLowerCase();
    function param(k) {
      var m = new RegExp(";\\s*" + k + "\\s*=\\s*(?:\"([^\"]*)\"|([^;\\s]+))", "i").exec(v);
      return m ? (m[1] !== undefined ? m[1] : m[2]) : "";
    }
    return { type: type, boundary: param("boundary"), protocol: param("protocol").toLowerCase(), micalg: param("micalg").toLowerCase() };
  }
  // the raw parts of a multipart body, each exactly as sent
  function rawParts(body, bd) {
    var delim = "--" + bd;
    var out = [];
    var lines = body.split(/(\r?\n)/);   // keep the line ends
    var cur = null, buf = "";
    for (var i = 0; i < lines.length; i += 2) {
      var line = lines[i], nl = lines[i + 1] || "";
      var t = line.replace(/[ \t]+$/, "");
      if (t === delim || t === delim + "--") {
        if (cur !== null) out.push(buf.replace(/\r?\n$/, ""));
        if (t === delim + "--") return out;
        cur = 1;
        buf = "";
        continue;
      }
      if (cur !== null) buf += line + nl;
    }
    return out;   // no closing delimiter: what was seen
  }
  function decodeBody(head, body) {
    var cte = header(head, "Content-Transfer-Encoding").toLowerCase();
    if (cte === "base64") {
      try {
        var s = body.replace(/[^A-Za-z0-9+\/=]/g, "");
        return typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("latin1");
      } catch (e) { return ""; }
    }
    if (cte === "quoted-printable") {
      return body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
    }
    return body;
  }
  function findIn(bin, depth) {
    var hb = splitHead(String(bin || ""));
    var ct = ctype(hb.head);
    if (!ct.boundary || ct.type.indexOf("multipart/") !== 0) return null;
    var parts = rawParts(hb.body, ct.boundary);
    if (ct.type === "multipart/encrypted" && ct.protocol === "application/pgp-encrypted" && parts.length >= 2) {
      var p2 = splitHead(parts[1]);
      var arm = decodeBody(p2.head, p2.body);
      if (/-----BEGIN PGP MESSAGE-----/.test(arm)) return { kind: "encrypted", armored: arm };
      return null;
    }
    if (ct.type === "multipart/signed" && ct.protocol === "application/pgp-signature" && parts.length >= 2) {
      var s2 = splitHead(parts[1]);
      var sig = decodeBody(s2.head, s2.body);
      if (!/-----BEGIN PGP SIGNATURE-----/.test(sig)) return null;
      return { kind: "signed", entity: parts[0], sig: sig, micalg: ct.micalg };
    }
    if (ct.type === "multipart/mixed" && depth < 1 && parts.length) return findIn(parts[0], depth + 1);
    return null;
  }
  function find(bin) { return findIn(bin, 0); }

  var BLOCKS = [
    ["inline-enc", /-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----/],
    ["inline-signed", /-----BEGIN PGP SIGNED MESSAGE-----[\s\S]*?-----BEGIN PGP SIGNATURE-----[\s\S]*?-----END PGP SIGNATURE-----/]
  ];
  function inline(text) {
    text = String(text || "");
    if (text.length > 4 * 1024 * 1024) return null;
    for (var i = 0; i < BLOCKS.length; i++) {
      var m = BLOCKS[i][1].exec(text);
      // the armor starts a line (not quoted with "> ")
      if (m && (m.index === 0 || text.charAt(m.index - 1) === "\n")) {
        return { kind: BLOCKS[i][0], armored: m[0], before: text.slice(0, m.index), after: text.slice(m.index + m[0].length) };
      }
    }
    return null;
  }
  function isKey(text) { return /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]+-----END PGP PUBLIC KEY BLOCK-----/.test(String(text || "")); }

  var api = { crlf: crlf, entity: entity, signed: signed, encrypted: encrypted, find: find, inline: inline, isKey: isKey };
  root.orosMailPgpMime = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
