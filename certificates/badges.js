// ============================================================
// orOS Certificates — Open Badges 3.0 export (v1.0.0)
// One credential per person, as a VC-JWT (Open Badges 3.0 § "JSON
// Web Token Proof Format"): ES256-signed with the same P-256 key that
// signs the check QR codes; the issuer is that key as a did:jwk, so
// wallets and course platforms can check it with no server of ours.
// Pure apart from WebCrypto, which is passed in (Node tests use theirs).
// Exposes window.CertBadges (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var CONTEXT = ["https://www.w3.org/2018/credentials/v1", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"];
  // certificate kind → Open Badges achievementType
  var TYPE = {
    attend: "Certificate", complete: "CertificateOfCompletion", award: "Award", excel: "Award",
    diploma: "Diploma", particip: "Achievement", train: "Course", thanks: "Achievement",
    volunteer: "CommunityService", kids: "Award"
  };

  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function b64u(bytes) {
    var s = "", i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
      s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63];
    }
    if (bytes.length - i === 1) { var a = bytes[i] << 16; s += B64[a >> 18 & 63] + B64[a >> 12 & 63]; }
    else if (bytes.length - i === 2) { var b = bytes[i] << 16 | bytes[i + 1] << 8; s += B64[b >> 18 & 63] + B64[b >> 12 & 63] + B64[b >> 6 & 63]; }
    return s;
  }
  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, "utf8"));
  }
  function hex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return s;
  }
  // A stable urn:uuid from a hash (version 8, "custom" — RFC 9562).
  function uuidOf(h) {
    var b = Array.prototype.slice.call(h, 0, 16);
    b[6] = (b[6] & 0x0f) | 0x80;
    b[8] = (b[8] & 0x3f) | 0x80;
    var x = hex(b);
    return "urn:uuid:" + x.slice(0, 8) + "-" + x.slice(8, 12) + "-" + x.slice(12, 16) + "-" + x.slice(16, 20) + "-" + x.slice(20);
  }
  function did(k) {
    return "did:jwk:" + b64u(utf8(JSON.stringify({ crv: "P-256", kty: "EC", x: k.x, y: k.y })));
  }
  function iso(ymd, end) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return "";
    return ymd + (end ? "T23:59:59Z" : "T00:00:00Z");
  }

  // credential(f, ids) -> the OpenBadgeCredential object
  //   f: { kind, title, name, description, issuer, idate, d1, d2, email
  //        hash ("sha256$…") + salt, checkUrl }
  //   ids: { did, cred (urn), ach (urn), now (ms) }
  function credential(f, ids) {
    var issued = iso(f.idate) || new Date(ids.now).toISOString().replace(/\.\d{3}Z$/, "Z");
    var subject = {
      type: ["AchievementSubject"],
      identifier: [{ type: "IdentityObject", identityHash: f.name, identityType: "name", hashed: false }],
      achievement: {
        id: ids.ach,
        type: ["Achievement"],
        achievementType: TYPE[f.kind] || "Achievement",
        name: f.title,
        description: f.description || f.title,
        criteria: { narrative: f.description || f.title }
      }
    };
    if (f.emailHash) {
      subject.identifier.push({ type: "IdentityObject", identityHash: f.emailHash, identityType: "emailAddress", hashed: true, salt: f.salt });
    }
    if (iso(f.d1)) subject.activityStartDate = iso(f.d1);
    if (iso(f.d2 || f.d1)) subject.activityEndDate = iso(f.d2 || f.d1, true);
    var c = {
      "@context": CONTEXT.slice(),
      id: ids.cred,
      type: ["VerifiableCredential", "OpenBadgeCredential"],
      issuer: { id: ids.did, type: ["Profile"], name: f.issuer || f.title },
      issuanceDate: issued,
      awardedDate: issued,
      name: f.title,
      credentialSubject: subject
    };
    if (f.checkUrl) c.evidence = [{ id: f.checkUrl, type: ["Evidence"], name: f.checkName || "Check" }];
    return c;
  }

  // The JWT: header + { vc, iss, nbf, jti } signed ES256.
  function jwt(subtle, k, cred) {
    var d = cred.issuer.id;
    var head = { alg: "ES256", typ: "JWT", kid: d + "#0" };
    var nbf = Math.floor(Date.parse(cred.issuanceDate) / 1000);
    var body = { vc: cred, iss: d, nbf: nbf, jti: cred.id };
    var input = b64u(utf8(JSON.stringify(head))) + "." + b64u(utf8(JSON.stringify(body)));
    return subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: k.x, y: k.y, d: k.d, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
      .then(function (pk) { return subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pk, utf8(input)); })
      .then(function (sig) { return input + "." + b64u(new Uint8Array(sig)); });
  }

  // make(subtle, key, f, ids0, rand) -> Promise<{ cred, jwt }>
  //   ids0: { evId, pId, now }; ids are derived from them and the key,
  //   so the same person gets the same credential id every time.
  function make(subtle, k, f, ids0, rand) {
    var dg = function (s) { return subtle.digest("SHA-256", utf8(s)).then(function (h) { return new Uint8Array(h); }); };
    var salt = "";
    var r = typeof rand === "function" ? rand : Math.random;
    for (var i = 0; i < 16; i++) salt += "0123456789abcdef".charAt(Math.floor(r() * 16));
    var em = (f.email || "").trim().toLowerCase();
    return Promise.all([dg("cred|" + k.x + "|" + ids0.pId), dg("ach|" + k.x + "|" + ids0.evId), em ? dg(em + salt) : null]).then(function (h) {
      var ff = {};
      Object.keys(f).forEach(function (x) { ff[x] = f[x]; });
      if (h[2]) { ff.emailHash = "sha256$" + hex(h[2]); ff.salt = salt; }
      var cred = credential(ff, { did: did(k), cred: uuidOf(h[0]), ach: uuidOf(h[1]), now: ids0.now });
      return jwt(subtle, k, cred).then(function (t) { return { cred: cred, jwt: t }; });
    });
  }

  var api = { VERSION: VERSION, CONTEXT: CONTEXT, TYPE: TYPE, did: did, credential: credential, jwt: jwt, make: make, uuidOf: uuidOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CertBadges = api;
})(typeof window !== "undefined" ? window : this);
