// ============================================================
// orOS — CalDAV / CardDAV client (davkit.js), CalDAV wave 2
// One client for Calendar (VEVENT), To-Do (VTODO) and Contacts
// (vCard) on the person's own server: Nextcloud, Radicale, Baïkal,
// mailbox.org, Fastmail, iCloud (app password) or any other that
// speaks RFC 4791 / 6352. Each person signs in with their own
// account; there is no orOS account and no server of orOS in the way,
// except the optional relay (below).
//
// What it does (no app data is touched here; the apps' sync waves use
// these calls):
//   discovery  RFC 6764: the address typed, then /.well-known/caldav
//              and /.well-known/carddav, current-user-principal,
//              calendar-home-set, addressbook-home-set, the
//              collections in them (name, colour, VEVENT / VTODO,
//              read-only, ctag, sync-token);
//   reading    sync-collection REPORT (RFC 6578) with its token, or a
//              PROPFIND of every ETag when the server has no tokens;
//              calendar-multiget / addressbook-multiget, 50 at a time;
//   writing    PUT with If-None-Match: * (create only) or If-Match:
//              <etag> (replace only that version), DELETE with
//              If-Match. A refusal is 412, never a silent overwrite.
//   probe      before anything is saved, on a scratch item in the
//              person's own collection: create, a second create is
//              refused, a stale If-Match is refused, the right one
//              passes, the ETag changes, the scratch item is removed.
//              A server that ignores the conditions is refused
//              ("cd-conditions"): two devices would overwrite each
//              other in silence.
//
// The relay (opt-in, conf.relay): most DAV servers send no CORS
// headers, so the page cannot reach them. The request then goes to
// the orOS relay's /dav with the server's address in X-Oros-Target
// (relay/dav.js). Unlike orOS sync, calendars and contacts are not
// end-to-end encrypted: they and the app password pass through the
// relay in plain form, never logged or stored there. Settings says so
// next to the switch.
//
// Storage (device-local, never in a synced slice, removed by a
// factory reset with every oros-* key):
//   oros-caldav-conf  { url, user, relay?, principal, calHome, cardHome }
//   oros-caldav-pass  the app password
//   oros-caldav-cols  the collections found at the last check
//
// Errors are Error("cd-…") with a fixed code the UI turns into one
// sentence: cd-url, cd-auth, cd-unreachable, cd-notdav, cd-none,
// cd-readonly, cd-conditions, cd-etag, cd-moved, cd-relay-target,
// cd-too-big, cd-token (a sync token the server no longer knows),
// cd-http (any other refusal; .status holds the status).
//
// Pure parts (Node-tested, tests/davkit.test.js against
// tests/dav-fake.js): normConf, parseXml, multistatus, the client
// with an injected fetch, connect / load / disconnect with an
// injected store. Browser: window.OrosDav. Node: module.exports.
// ============================================================
(function (root) {
  "use strict";

  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev/dav";   // = sync.js DAV_RELAY
  var CONF_KEY = "oros-caldav-conf";
  var PASS_KEY = "oros-caldav-pass";
  var COLS_KEY = "oros-caldav-cols";
  var MULTIGET = 50;
  var MAX_REDIRECTS = 4;
  var MAX_COLS = 100;

  var NS = {
    D: "DAV:",
    C: "urn:ietf:params:xml:ns:caldav",
    R: "urn:ietf:params:xml:ns:carddav",
    CS: "http://calendarserver.org/ns/",
    A: "http://apple.com/ns/ical/"
  };

  function fail(code, status) {
    var e = new Error(code);
    if (status) e.status = status;
    return e;
  }

  // ---------- configuration ----------

  // https only; plain http only for this computer (a local test
  // server). The relay needs a public https server.
  function normConf(form) {
    var u;
    try { u = new URL(String((form && form.url) || "").trim()); } catch (e) { throw fail("cd-url"); }
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw fail("cd-url");
    if (u.username || u.password || u.search || u.hash) throw fail("cd-url");
    var user = String((form && form.user) || "").trim();
    if (!user || user.length > 200) throw fail("cd-url");
    var relay = !!(form && form.relay);
    if (relay && (u.protocol !== "https:" || local)) throw fail("cd-relay-target");
    var conf = { url: u.origin + (u.pathname.replace(/\/+$/, "") || "") + "/", user: user };
    if (relay) conf.relay = true;
    return conf;
  }

  // ---------- XML (a small, namespace-aware reader) ----------
  // Enough for multistatus answers: elements, attributes, text, CDATA,
  // the five entities and numeric ones. No DTD, no external anything;
  // nothing in it is ever executed or rendered as HTML.

  var ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  function unent(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, function (m, k) {
      if (k.charAt(0) === "#") {
        var n = k.charAt(1) === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
      }
      return ENT.hasOwnProperty(k) ? ENT[k] : m;
    });
  }

  function parseAttrs(s) {
    var out = {}, m, re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    while ((m = re.exec(s))) out[m[1]] = unent(m[3] !== undefined ? m[3] : m[4]);
    return out;
  }

  function parseXml(text) {
    text = String(text || "");
    var docRoot = { ns: "", name: "#doc", children: [], text: "" };
    var stack = [{ el: docRoot, nsmap: { xml: "http://www.w3.org/XML/1998/namespace" } }];
    var re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<(\/?)([^\s>\/]+)([^>]*?)(\/?)>|([^<]+)/g;
    var m, count = 0;
    while ((m = re.exec(text))) {
      if (++count > 200000) throw fail("cd-too-big");
      var top = stack[stack.length - 1];
      if (m[1] !== undefined) { top.el.text += m[1]; continue; }
      if (m[6] !== undefined) { top.el.text += unent(m[6]); continue; }
      if (m[3] === undefined) continue;   // comment, PI, DOCTYPE
      if (m[2] === "/") {
        if (stack.length > 1) stack.pop();
        continue;
      }
      var attrs = parseAttrs(m[4] || "");
      var nsmap = Object.create(top.nsmap);
      Object.keys(attrs).forEach(function (a) {
        if (a === "xmlns") nsmap[""] = attrs[a];
        else if (a.indexOf("xmlns:") === 0) nsmap[a.slice(6)] = attrs[a];
      });
      var qn = m[3], i = qn.indexOf(":");
      var prefix = i >= 0 ? qn.slice(0, i) : "";
      var local = i >= 0 ? qn.slice(i + 1) : qn;
      var node = { ns: nsmap[prefix] || "", name: local, attrs: attrs, children: [], text: "" };
      top.el.children.push(node);
      if (!m[5]) stack.push({ el: node, nsmap: nsmap });
      if (stack.length > 64) throw fail("cd-too-big");
    }
    return docRoot;
  }

  function kids(node, ns, name) {
    return (node && node.children || []).filter(function (c) { return c.ns === ns && c.name === name; });
  }
  function kid(node, ns, name) { return kids(node, ns, name)[0] || null; }
  function txt(node) { return node ? node.text.trim() : ""; }

  // A 207 answer → [{ href, status, props: { "<ns>|<name>": node }, missing: {…} }]
  // href is resolved against `base` (a full URL).
  function multistatus(text, base) {
    var doc = parseXml(text);
    var ms = kid(doc, NS.D, "multistatus");
    if (!ms) return [];
    var out = [];
    kids(ms, NS.D, "response").forEach(function (r) {
      var href = txt(kid(r, NS.D, "href"));
      if (!href) return;
      var full;
      try { full = new URL(href, base).href; } catch (e) { return; }
      var item = { href: full, status: statusCode(txt(kid(r, NS.D, "status"))), props: {}, missing: {} };
      kids(r, NS.D, "propstat").forEach(function (ps) {
        var code = statusCode(txt(kid(ps, NS.D, "status")));
        var prop = kid(ps, NS.D, "prop");
        (prop ? prop.children : []).forEach(function (p) {
          var k = p.ns + "|" + p.name;
          if (code >= 200 && code < 300) item.props[k] = p;
          else item.missing[k] = code;
        });
      });
      out.push(item);
    });
    return out;
  }
  function statusCode(line) {
    var m = /\s(\d{3})(\s|$)/.exec(" " + line);
    return m ? +m[1] : 0;
  }
  function prop(item, ns, name) { return item.props[ns + "|" + name] || null; }
  function hrefIn(node, base) {
    var h = txt(kid(node, NS.D, "href"));
    if (!h) return "";
    try { return new URL(h, base).href; } catch (e) { return ""; }
  }

  // Quoted, exactly as the server compares it in If-Match.
  function etagOf(v) {
    if (typeof v !== "string") return "";
    v = v.trim();
    if (!v) return "";
    if (/^W\//.test(v) || v.charAt(0) === '"') return v;
    return '"' + v + '"';
  }

  function xmlEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---------- request bodies ----------
  var XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>';
  var B_PRINCIPAL = XML_HEAD + '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
  var B_HOMES = XML_HEAD + '<d:propfind xmlns:d="DAV:" xmlns:c="' + NS.C + '" xmlns:r="' + NS.R + '"><d:prop>' +
    "<c:calendar-home-set/><r:addressbook-home-set/><d:displayname/></d:prop></d:propfind>";
  var B_COLS = XML_HEAD + '<d:propfind xmlns:d="DAV:" xmlns:c="' + NS.C + '" xmlns:cs="' + NS.CS + '" xmlns:a="' + NS.A + '">' +
    "<d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/>" +
    "<cs:getctag/><d:sync-token/><d:current-user-privilege-set/></d:prop></d:propfind>";
  var B_ETAGS = XML_HEAD + '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>';

  function bSync(token) {
    return XML_HEAD + '<d:sync-collection xmlns:d="DAV:"><d:sync-token>' + xmlEsc(token || "") +
      "</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>";
  }
  function bMultiget(kind, paths) {
    var hrefs = paths.map(function (p) { return "<d:href>" + xmlEsc(p) + "</d:href>"; }).join("");
    if (kind === "card") {
      return XML_HEAD + '<r:addressbook-multiget xmlns:d="DAV:" xmlns:r="' + NS.R + '"><d:prop><d:getetag/>' +
        "<r:address-data/></d:prop>" + hrefs + "</r:addressbook-multiget>";
    }
    return XML_HEAD + '<c:calendar-multiget xmlns:d="DAV:" xmlns:c="' + NS.C + '"><d:prop><d:getetag/>' +
      "<c:calendar-data/></d:prop>" + hrefs + "</c:calendar-multiget>";
  }

  function b64(s) {
    var bytes = new TextEncoder().encode(s), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return (typeof btoa === "function") ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  }

  // ---------- the client ----------
  // conf from normConf (+ what connect found), pass the app password,
  // fetchFn defaults to the global fetch.
  function client(conf, pass, fetchFn) {
    var doFetch = fetchFn || function (u, o) { return fetch(u, o); };
    var auth = "Basic " + b64(conf.user + ":" + pass);

    // One request, redirects followed (also through the relay, which
    // reports them instead of following). → { status, url, headers, text }
    function req(method, url, opts) {
      opts = opts || {};
      var hops = 0;
      function once(target) {
        var h = { "Authorization": auth };
        var extra = opts.headers || {};
        Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
        if (conf.relay) h["X-Oros-Target"] = target;
        return Promise.resolve().then(function () {
          return doFetch(conf.relay ? RELAY : target, {
            method: method, headers: h, body: opts.body, credentials: "omit", cache: "no-store"
          });
        }).then(function (res) {
          if (conf.relay) {
            var moved = res.headers.get("X-Oros-Status");
            if (moved) {
              var loc = res.headers.get("X-Oros-Location");
              if (!loc || ++hops > MAX_REDIRECTS) throw fail("cd-moved");
              var next;
              try { next = new URL(loc, target); } catch (e) { throw fail("cd-moved"); }
              if (next.protocol !== "https:") throw fail("cd-moved");
              return once(next.href);
            }
            var code = res.headers.get("X-Oros-Error");
            if (code === "too-big") throw fail("cd-too-big");
            if (code === "bad-target" || code === "port") throw fail("cd-relay-target");
            if (code) throw fail("cd-unreachable");
          }
          if (res.status === 401) throw fail("cd-auth", 401);
          return res.text().then(function (body) {
            return { status: res.status, url: (!conf.relay && res.url) || target, headers: res.headers, text: body };
          });
        }, function (err) {
          if (err && /^cd-/.test(err.message)) throw err;
          throw fail("cd-unreachable");
        });
      }
      return once(url);
    }

    function propfind(url, depth, body) {
      return req("PROPFIND", url, { headers: { "Depth": String(depth), "Content-Type": "application/xml; charset=utf-8" }, body: body })
        .then(function (r) {
          if (r.status !== 207) throw fail(r.status === 403 ? "cd-auth" : "cd-http", r.status);
          return multistatus(r.text, r.url);
        });
    }

    function report(url, depth, body) {
      return req("REPORT", url, { headers: { "Depth": String(depth), "Content-Type": "application/xml; charset=utf-8" }, body: body });
    }

    // → principal URL, or "" when the address answers DAV without one.
    function principalAt(url) {
      return propfind(url, 0, B_PRINCIPAL).then(function (rs) {
        for (var i = 0; i < rs.length; i++) {
          var p = prop(rs[i], NS.D, "current-user-principal");
          var h = p && hrefIn(p, rs[i].href);
          if (h) return h;
        }
        return "";
      });
    }

    function discover() {
      var origin = new URL(conf.url).origin;
      var tries = [conf.url, origin + "/.well-known/caldav", origin + "/.well-known/carddav"];
      var lastErr = null;
      function next(i) {
        if (i >= tries.length) throw lastErr && lastErr.message !== "cd-http" ? lastErr : fail("cd-notdav");
        return principalAt(tries[i]).then(function (p) {
          if (p) return p;
          return next(i + 1);
        }, function (e) {
          if (e.message === "cd-auth" || e.message === "cd-relay-target" || e.message === "cd-too-big") throw e;
          if (e.message !== "cd-http") lastErr = e;
          return next(i + 1);
        });
      }
      return next(0).then(function (principal) {
        return propfind(principal, 0, B_HOMES).then(function (rs) {
          var it = rs[0] || { props: {}, href: principal };
          var ch = prop(it, NS.C, "calendar-home-set"), ah = prop(it, NS.R, "addressbook-home-set");
          var out = { principal: principal, calHome: ch ? hrefIn(ch, it.href) : "", cardHome: ah ? hrefIn(ah, it.href) : "" };
          if (!out.calHome && !out.cardHome) throw fail("cd-none");
          return out;
        });
      });
    }

    function colOf(it) {
      var rt = prop(it, NS.D, "resourcetype");
      if (!rt) return null;
      var isCal = !!kid(rt, NS.C, "calendar"), isCard = !!kid(rt, NS.R, "addressbook");
      if (!isCal && !isCard) return null;
      var comps = [];
      if (isCal) {
        var set = prop(it, NS.C, "supported-calendar-component-set");
        if (set) kids(set, NS.C, "comp").forEach(function (c) { if (c.attrs && c.attrs.name) comps.push(String(c.attrs.name).toUpperCase()); });
        else comps = ["VEVENT", "VTODO"];   // not said = any (RFC 4791 §5.2.3)
      }
      var privs = prop(it, NS.D, "current-user-privilege-set");
      var readOnly = false;
      if (privs) {
        var names = [];
        kids(privs, NS.D, "privilege").forEach(function (p) { p.children.forEach(function (c) { if (c.ns === NS.D) names.push(c.name); }); });
        readOnly = !names.some(function (n) { return n === "all" || n === "write" || n === "write-content" || n === "bind"; });
      }
      var color = txt(prop(it, NS.A, "calendar-color"));
      if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color)) color = "";
      return {
        url: it.href,
        kind: isCal ? "cal" : "card",
        comps: comps.filter(function (c) { return c === "VEVENT" || c === "VTODO"; }),
        name: txt(prop(it, NS.D, "displayname")).slice(0, 80),
        color: color ? color.slice(0, 7).toLowerCase() : "",
        ctag: txt(prop(it, NS.CS, "getctag")).slice(0, 300),
        syncToken: txt(prop(it, NS.D, "sync-token")).slice(0, 1000),
        readOnly: readOnly
      };
    }

    // Every calendar / address book in the home sets found by discover().
    function collections(found) {
      var homes = [found.calHome, found.cardHome].filter(Boolean)
        .filter(function (h, i, a) { return a.indexOf(h) === i; });
      return Promise.all(homes.map(function (h) { return propfind(h, 1, B_COLS); })).then(function (lists) {
        var seen = {}, out = [];
        lists.forEach(function (rs) {
          rs.forEach(function (it) {
            var c = colOf(it);
            if (!c || seen[c.url]) return;
            if (c.kind === "cal" && !c.comps.length) return;   // journals, free-busy only
            seen[c.url] = 1;
            out.push(c);
          });
        });
        return out.slice(0, MAX_COLS);
      });
    }

    // RFC 6578. token "" = everything. → { token, changed: [{href, etag}], removed: [href] }
    function syncCollection(url, token) {
      return report(url, 1, bSync(token)).then(function (r) {
        if (r.status === 403 || r.status === 409 || (r.status === 400 && token)) throw fail("cd-token", r.status);
        if (r.status !== 207) throw fail("cd-http", r.status);
        var doc = parseXml(r.text), ms = kid(doc, NS.D, "multistatus");
        var out = { token: txt(kid(ms, NS.D, "sync-token")), changed: [], removed: [] };
        multistatus(r.text, r.url).forEach(function (it) {
          if (it.href === new URL(url).href) return;
          if (it.status === 404) { out.removed.push(it.href); return; }
          var e = prop(it, NS.D, "getetag");
          if (e) out.changed.push({ href: it.href, etag: etagOf(txt(e)) });
        });
        return out;
      });
    }

    // Servers without sync tokens: every item's ETag. → [{href, etag}]
    function listEtags(url) {
      var self = new URL(url).href;
      return propfind(url, 1, B_ETAGS).then(function (rs) {
        var out = [];
        rs.forEach(function (it) {
          if (it.href === self) return;
          var rt = prop(it, NS.D, "resourcetype");
          if (rt && kid(rt, NS.D, "collection")) return;
          var e = prop(it, NS.D, "getetag");
          if (e) out.push({ href: it.href, etag: etagOf(txt(e)) });
        });
        return out;
      });
    }

    // → [{ href, etag, data }]; hrefs are full URLs inside `url`.
    function multiget(url, kind, hrefs) {
      var out = [], i = 0;
      function batch() {
        if (i >= hrefs.length) return Promise.resolve(out);
        var part = hrefs.slice(i, i + MULTIGET);
        i += MULTIGET;
        var paths = part.map(function (h) { return new URL(h).pathname; });
        return report(url, 1, bMultiget(kind, paths)).then(function (r) {
          if (r.status !== 207) throw fail("cd-http", r.status);
          multistatus(r.text, r.url).forEach(function (it) {
            var d = prop(it, kind === "card" ? NS.R : NS.C, kind === "card" ? "address-data" : "calendar-data");
            var e = prop(it, NS.D, "getetag");
            if (d && e) out.push({ href: it.href, etag: etagOf(txt(e)), data: d.text });
          });
          return batch();
        });
      }
      return batch();
    }

    // opts: { create: true } → If-None-Match: *; { etag } → If-Match.
    // → { ok, status, etag } ; 412 → ok:false (someone else changed it).
    // A server may send no ETag (it changed the text it stored): the
    // item is read again for the real one.
    function put(url, body, type, opts) {
      opts = opts || {};
      var h = { "Content-Type": type + "; charset=utf-8" };
      if (opts.create) h["If-None-Match"] = "*";
      else if (opts.etag) h["If-Match"] = opts.etag;
      else return Promise.reject(fail("cd-conditions"));   // never an unconditional write
      return req("PUT", url, { headers: h, body: body }).then(function (r) {
        if (r.status === 412) return { ok: false, status: 412, etag: "" };
        if (r.status === 403) throw fail("cd-readonly", 403);
        if (r.status < 200 || r.status >= 300) throw fail("cd-http", r.status);
        var e = etagOf(r.headers.get("ETag") || "");
        if (e && !/^W\//.test(e)) return { ok: true, status: r.status, etag: e };
        return get(url).then(function (g) { return { ok: true, status: r.status, etag: g ? g.etag : "" }; });
      });
    }

    function get(url) {
      return req("GET", url).then(function (r) {
        if (r.status === 404) return null;
        if (r.status < 200 || r.status >= 300) throw fail("cd-http", r.status);
        return { etag: etagOf(r.headers.get("ETag") || ""), data: r.text };
      });
    }

    // → true removed (or already gone), false refused (412: changed there).
    function del(url, etag) {
      if (!etag) return Promise.reject(fail("cd-conditions"));
      return req("DELETE", url, { headers: { "If-Match": etag } }).then(function (r) {
        if (r.status === 412) return false;
        if (r.status === 404 || (r.status >= 200 && r.status < 300)) return true;
        if (r.status === 403) throw fail("cd-readonly", 403);
        throw fail("cd-http", r.status);
      });
    }

    // The scratch-item probe (see the header). col: one writable collection.
    function probe(col) {
      var id = "oros-probe-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var card = col.kind === "card";
      var url = new URL(id + (card ? ".vcf" : ".ics"), col.url.replace(/\/?$/, "/")).href;
      var type = card ? "text/vcard" : "text/calendar";
      var comp = col.comps.indexOf("VEVENT") >= 0 ? "VEVENT" : "VTODO";
      function body(n) {
        if (card) return ["BEGIN:VCARD", "VERSION:3.0", "UID:" + id, "FN:orOS check " + n, "N:check;orOS;;;", "END:VCARD", ""].join("\r\n");
        return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//orOS//davkit//EN", "BEGIN:" + comp, "UID:" + id,
          "DTSTAMP:20260101T000000Z", comp === "VEVENT" ? "DTSTART:20000101T000000Z" : "DUE:20000101T000000Z",
          "SUMMARY:orOS check " + n, "END:" + comp, "END:VCALENDAR", ""].join("\r\n");
      }
      var made = false, etag = "";
      return put(url, body(1), type, { create: true })
        .then(function (r) {
          if (!r.ok) throw fail("cd-conditions");
          made = true;
          etag = r.etag;
          if (!etag) throw fail("cd-etag");
          if (/^W\//.test(etag)) throw fail("cd-conditions");
          return put(url, body(2), type, { create: true });
        })
        .then(function (r) {
          if (r.ok) throw fail("cd-conditions");
          return put(url, body(3), type, { etag: '"oros-probe-wrong"' });
        })
        .then(function (r) {
          if (r.ok) throw fail("cd-conditions");
          return put(url, body(4), type, { etag: etag });
        })
        .then(function (r) {
          if (!r.ok || !r.etag) throw fail(r.ok ? "cd-etag" : "cd-conditions");
          if (r.etag === etag) throw fail("cd-conditions");
          etag = r.etag;
          return del(url, '"oros-probe-wrong"');
        })
        .then(function (gone) {
          if (gone) { made = false; throw fail("cd-conditions"); }
          return del(url, etag);
        })
        .then(function (gone) {
          made = !gone;
          if (!gone) throw fail("cd-conditions");
        })
        .catch(function (e) {
          if (!made) throw e;
          // best effort: leave nothing behind
          return get(url).then(function (g) { return g && g.etag ? del(url, g.etag) : true; })
            .catch(function () {}).then(function () { throw e; });
        });
    }

    return {
      req: req, propfind: propfind, discover: discover, collections: collections,
      syncCollection: syncCollection, listEtags: listEtags, multiget: multiget,
      put: put, get: get, del: del, probe: probe
    };
  }

  // ---------- account (device-local) ----------
  function memStore() {
    var m = {};
    return { getItem: function (k) { return m.hasOwnProperty(k) ? m[k] : null; },
             setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } };
  }
  function defStore() {
    try { return root.localStorage || memStore(); } catch (e) { return memStore(); }
  }

  function cleanCols(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (c) {
      return c && typeof c.url === "string" && /^https?:\/\//.test(c.url) && (c.kind === "cal" || c.kind === "card");
    }).slice(0, MAX_COLS).map(function (c) {
      return {
        url: c.url, kind: c.kind,
        comps: Array.isArray(c.comps) ? c.comps.filter(function (x) { return x === "VEVENT" || x === "VTODO"; }) : [],
        name: typeof c.name === "string" ? c.name.slice(0, 80) : "",
        color: typeof c.color === "string" && /^#[0-9a-f]{6}$/.test(c.color) ? c.color : "",
        readOnly: c.readOnly === true
      };
    });
  }

  // → { conf, pass, cols } or null
  function load(store) {
    store = store || defStore();
    try {
      var c = JSON.parse(store.getItem(CONF_KEY) || "null");
      var p = store.getItem(PASS_KEY);
      if (!c || typeof c.url !== "string" || typeof c.user !== "string" || !p) return null;
      var conf = { url: c.url, user: c.user, principal: String(c.principal || ""),
                   calHome: String(c.calHome || ""), cardHome: String(c.cardHome || "") };
      if (c.relay === true) conf.relay = true;
      var cols = [];
      try { cols = cleanCols(JSON.parse(store.getItem(COLS_KEY) || "[]")); } catch (e) { cols = []; }
      return { conf: conf, pass: p, cols: cols };
    } catch (e) { return null; }
  }

  // Discover, list, probe on the first writable collection, and only
  // then save. → { conf, cols }
  function connect(form, pass, fetchFn, store) {
    store = store || defStore();
    var conf;
    try { conf = normConf(form); } catch (e) { return Promise.reject(e); }
    if (!pass) return Promise.reject(fail("cd-auth"));
    var cl = client(conf, pass, fetchFn);
    return cl.discover().then(function (found) {
      conf.principal = found.principal;
      conf.calHome = found.calHome;
      conf.cardHome = found.cardHome;
      return cl.collections(found);
    }).then(function (cols) {
      if (!cols.length) throw fail("cd-none");
      var target = cols.filter(function (c) { return !c.readOnly && c.kind === "cal"; })[0] ||
                   cols.filter(function (c) { return !c.readOnly; })[0];
      if (!target) throw fail("cd-readonly");
      return cl.probe(target).then(function () { return cols; });
    }).then(function (cols) {
      store.setItem(CONF_KEY, JSON.stringify(conf));
      store.setItem(PASS_KEY, pass);
      store.setItem(COLS_KEY, JSON.stringify(cleanCols(cols)));
      return { conf: conf, cols: cleanCols(cols) };
    });
  }

  // The saved account's collections again (names, new calendars). → cols
  function refresh(fetchFn, store) {
    store = store || defStore();
    var a = load(store);
    if (!a) return Promise.reject(fail("cd-auth"));
    var cl = client(a.conf, a.pass, fetchFn);
    var found = { calHome: a.conf.calHome, cardHome: a.conf.cardHome };
    return cl.collections(found).then(function (cols) {
      var clean = cleanCols(cols);
      store.setItem(COLS_KEY, JSON.stringify(clean));
      return clean;
    });
  }

  function disconnect(store) {
    store = store || defStore();
    store.removeItem(CONF_KEY);
    store.removeItem(PASS_KEY);
    store.removeItem(COLS_KEY);
  }

  var api = {
    v: 1, RELAY: RELAY, CONF_KEY: CONF_KEY, PASS_KEY: PASS_KEY, COLS_KEY: COLS_KEY, NS: NS,
    normConf: normConf, parseXml: parseXml, multistatus: multistatus, etagOf: etagOf,
    client: client, connect: connect, refresh: refresh, load: load, disconnect: disconnect, memStore: memStore
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosDav = api;
})(typeof window !== "undefined" ? window : null);
