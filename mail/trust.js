// ============================================================
// orOS Mail — sender and link checks (v1.0.0)
// Pure functions, no network: everything here reads what is already
// in the message.
//
// sender(headers, from, ctx) → { level: "ok" | "warn" | "none", why: [code], domain, claimed }
//   headers: parsed header map (mime.js parseHeaders: lower-case name →
//   [values], top first); from: { name, addr }; ctx: { hosts: [names
//   of this account's servers] }.
//   Reads the TOPMOST Authentication-Results (RFC 8601), the one the
//   receiving server adds. Failures are always believed (a forger has
//   no reason to fake them). A pass is believed only when that
//   header's authserv-id belongs to the receiving server: the same
//   organisation as the "by" host of the topmost Received, or as one
//   of this account's servers. Otherwise a sender could write their
//   own "dmarc=pass" and get the badge.
//   why codes: "dmarc", "dkim", "spf" (failed checks), "name" (the
//   display name holds a different address than the real sender;
//   claimed = that address's domain).
//
// link(text, href) → null | { code, host, shown }
//   code: "mismatch" (the text names another site than the link opens),
//   "lookalike" (a known name spelt with look-alike characters, e.g.
//   paypa1), "puny" (international look-alike letters, xn--), "ip"
//   (a bare IP address), "userinfo" (https://bank.gr@evil.example).
// ============================================================
(function (root) {
  "use strict";

  // ---------- domains ----------
  // "Organisation" domain: the last two labels, three for the usual
  // second-level registries (example.com.gr, example.co.uk).
  var SLD = { co: 1, com: 1, org: 1, net: 1, gov: 1, edu: 1, ac: 1, ltd: 1, plc: 1, me: 1, nom: 1, sch: 1 };
  function orgDomain(host) {
    var h = String(host || "").toLowerCase().replace(/\.$/, "");
    if (!h || /^\[|^\d+(\.\d+){3}$/.test(h)) return h;
    var p = h.split(".");
    if (p.length < 3) return h;
    var n = p[p.length - 1].length === 2 && SLD[p[p.length - 2]] ? 3 : 2;
    return p.slice(-n).join(".");
  }
  // Providers whose mail servers live under another name.
  var SAME = { "gmail.com": "google.com", "googlemail.com": "google.com", "hotmail.com": "outlook.com",
               "live.com": "outlook.com", "icloud.com": "apple.com", "me.com": "apple.com",
               "ymail.com": "yahoo.com", "yahoodns.net": "yahoo.com" };
  function owner(host) { var o = orgDomain(host); return SAME[o] || o; }
  function domainOf(addr) {
    var i = String(addr || "").lastIndexOf("@");
    return i < 0 ? "" : String(addr).slice(i + 1).toLowerCase().replace(/[>\s]+$/, "");
  }

  // ---------- Authentication-Results ----------
  // "mx.example.net; spf=pass smtp.mailfrom=a.gr; dkim=pass header.d=a.gr; dmarc=pass header.from=a.gr"
  function parseAuth(v) {
    v = String(v || "").replace(/\([^()]*\)/g, " ");          // comments
    var parts = v.split(";");
    var out = { id: parts[0].trim().split(/\s+/)[0].toLowerCase(), res: [] };
    parts.slice(1).forEach(function (p) {
      var m = /^\s*([a-z0-9-]+)\s*=\s*([a-z]+)/i.exec(p);
      if (!m) return;
      var r = { method: m[1].toLowerCase(), result: m[2].toLowerCase(), props: {} };
      p.replace(/([a-z]+\.[a-z0-9-]+)\s*=\s*("?)([^\s";]+)\2/gi, function (_, k, q, val) {
        r.props[k.toLowerCase()] = val.toLowerCase();
      });
      out.res.push(r);
    });
    return out;
  }

  function sender(headers, from, ctx) {
    headers = headers || {};
    from = from || {};
    ctx = ctx || {};
    var why = [];
    var fromDom = domainOf(from.addr);
    // A display name that carries an address of another domain:
    // "service@paypal.com" <x@evil.example>
    var named = /[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i.exec(String(from.name || ""));
    var claimed = "";
    if (named && fromDom && owner(named[1]) !== owner(fromDom)) { why.push("name"); claimed = named[1].toLowerCase(); }

    var ar = (headers["authentication-results"] || [])[0];
    if (!ar || !fromDom) return { level: why.length ? "warn" : "none", why: why, domain: fromDom, claimed: claimed };
    var a = parseAuth(ar);
    var org = owner(fromDom);
    function aligned(d) { return !!d && owner(String(d).replace(/^.*@/, "")) === org; }
    var get = function (m) { return a.res.filter(function (r) { return r.method === m; }); };
    var dmarc = get("dmarc")[0], dkims = get("dkim"), spf = get("spf")[0];
    // DMARC speaks about the header.from it names: only count it for this sender
    if (dmarc && dmarc.props["header.from"] && !aligned(dmarc.props["header.from"])) dmarc = null;
    var pass = false;
    if (dmarc && dmarc.result === "pass") pass = true;
    if (dkims.some(function (r) { return r.result === "pass" && aligned(r.props["header.d"] || r.props["header.i"]); })) pass = true;
    if (spf && spf.result === "pass" && aligned(spf.props["smtp.mailfrom"] || spf.props["smtp.helo"])) pass = true;
    // Failures count only when they speak about this sender's domain
    // (or name none), so a forwarded or relayed message is not blamed.
    function mine(d) { return !d || aligned(d); }
    if (dmarc && dmarc.result === "fail") why.push("dmarc");
    else if (!pass) {
      var dk = dkims.filter(function (r) { return mine(r.props["header.d"] || r.props["header.i"]); });
      if (dk.length && dk.every(function (r) { return r.result === "fail"; })) why.push("dkim");
      if (spf && (spf.result === "fail" || spf.result === "softfail") && mine(spf.props["smtp.mailfrom"])) why.push("spf");
    }
    if (why.length) return { level: "warn", why: why, domain: fromDom, claimed: claimed };
    if (!pass) return { level: "none", why: why, domain: fromDom, claimed: claimed };
    // Is the header the receiving server's own?
    var trusted = {};
    var rcv = (headers.received || [])[0];
    var by = rcv && /\bby\s+([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i.exec(rcv);
    if (by) trusted[owner(by[1])] = 1;
    (ctx.hosts || []).forEach(function (h) { if (h) trusted[owner(h)] = 1; });
    return { level: trusted[owner(a.id)] ? "ok" : "none", why: why, domain: fromDom, claimed: claimed };
  }

  // ---------- links ----------
  var BRANDS = ["paypal", "google", "gmail", "microsoft", "outlook", "office", "office365", "live", "apple",
    "icloud", "amazon", "facebook", "instagram", "netflix", "spotify", "dhl", "fedex", "ups", "ebay", "linkedin",
    "whatsapp", "viber", "skype", "dropbox", "docusign", "adobe", "binance", "coinbase", "revolut", "papaki",
    "pmail", "eurobank", "piraeusbank", "alpha", "alphabank", "nbg", "winbank", "cosmote", "vodafone", "nova",
    "aade", "gsis", "elta", "acs", "skroutz", "efood", "wolt", "booking", "airbnb"];
  var BRAND = {};
  BRANDS.forEach(function (b) { BRAND[b] = 1; });
  function unleet(s) {
    return s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e")
            .replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/8/g, "b").replace(/\|/g, "l");
  }
  function hostOf(u) {
    var m = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#]*)/i.exec(String(u || "").trim());
    if (!m) return null;
    var auth = m[1];
    var at = auth.lastIndexOf("@");
    var host = (at >= 0 ? auth.slice(at + 1) : auth).replace(/:\d*$/, "").toLowerCase().replace(/\.$/, "");
    return { host: host, userinfo: at >= 0 };
  }
  var LOOKS_LIKE_URL = /^(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[\/?#:]\S*)?$/i;

  function link(text, href) {
    var h = hostOf(href);
    if (!h || !h.host) return null;
    var host = h.host;
    if (h.userinfo) return { code: "userinfo", host: host, shown: "" };
    if (/^\d+(\.\d+){3}$/.test(host) || /^\[[0-9a-f:.]+\]$/.test(host)) return { code: "ip", host: host, shown: "" };
    if (/(^|\.)xn--/.test(host)) return { code: "puny", host: host, shown: "" };
    var label = orgDomain(host).split(".")[0];
    var plain = unleet(label);
    if (plain !== label && BRAND[plain]) return { code: "lookalike", host: host, shown: "" };
    var t = String(text || "").trim().replace(/\s+/g, "");
    var m = LOOKS_LIKE_URL.exec(t);
    if (m) {
      var shown = m[1].toLowerCase();
      if (owner(shown) !== owner(host)) return { code: "mismatch", host: host, shown: shown };
    }
    return null;
  }

  var api = { v: 1, sender: sender, link: link, orgDomain: orgDomain, parseAuth: parseAuth };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.orosMailTrust = api;
})(typeof window !== "undefined" ? window : globalThis);
