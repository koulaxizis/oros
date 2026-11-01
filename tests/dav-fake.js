// A fake CalDAV / CardDAV server for tests/davkit.test.js (and the
// Calendar / Contacts / To-Do sync waves after it). In memory; one
// user "u" / "p". Answers like Nextcloud / Radicale do where it
// matters: multistatus with the DAV:, caldav, carddav namespaces,
// strong ETags that change on every write, If-Match / If-None-Match,
// sync-collection with tokens (RFC 6578), calendar-multiget /
// addressbook-multiget, /.well-known redirects.
//
//   const S = fakeDav(opts); S.fetch(url, init) → a Response-like
//   object (status, url, headers, text()); S.items, S.log.
//   opts: { base: "https://dav.test", relay: url of the relay to act
//   as, ignoreConditions, weakEtag, noPutEtag, noSyncToken,
//   readOnly: true (every collection), noWellKnown, rootNoPrincipal }
"use strict";

function fakeDav(opts) {
  opts = opts || {};
  const base = opts.base || "https://dav.test";
  const AUTH = "Basic " + Buffer.from("u:p").toString("base64");
  const PRINCIPAL = "/dav/principals/u/";
  const CAL_HOME = "/dav/calendars/u/";
  const CARD_HOME = "/dav/addressbooks/u/";
  const cols = {
    "/dav/calendars/u/personal/": { kind: "cal", name: "Personal", color: "#3366ccff", comps: ["VEVENT", "VTODO"] },
    "/dav/calendars/u/tasks/": { kind: "cal", name: "Tasks", color: "", comps: ["VTODO"] },
    "/dav/calendars/u/journal/": { kind: "cal", name: "Journal", color: "", comps: ["VJOURNAL"] },
    "/dav/addressbooks/u/contacts/": { kind: "card", name: "Contacts", color: "", comps: [] }
  };
  const items = {};          // path → { data, etag, n }
  const changes = [];        // { col, path, n, gone }
  let n = 0, etagN = 0;
  const log = [];

  function res(status, body, headers, url) {
    const h = new Headers(headers || {});
    return { status, ok: status >= 200 && status < 300, url: url || "", headers: h,
             text: () => Promise.resolve(body || "") };
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function colOf(path) { return Object.keys(cols).find((c) => path.indexOf(c) === 0 && path !== c) || null; }
  function newEtag() { const e = '"e' + (++etagN) + '"'; return opts.weakEtag ? "W/" + e : e; }
  function token() { return "http://dav.test/sync/" + n; }
  function ms(inner, tok) {
    return '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" ' +
      'xmlns:r="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">' +
      inner + (tok ? "<d:sync-token>" + esc(tok) + "</d:sync-token>" : "") + "</d:multistatus>";
  }
  function resp(href, props) {
    return "<d:response><d:href>" + esc(href) + "</d:href><d:propstat><d:prop>" + props +
      "</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>";
  }

  function handle(method, url, headers, body) {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    log.push(method + " " + path);
    if (path === "/.well-known/caldav" || path === "/.well-known/carddav") {
      if (opts.noWellKnown) return res(404);
      return { redirect: base + "/dav/" };
    }
    if (headers.get("Authorization") !== AUTH) return res(401);
    if (method === "PROPFIND") {
      const depth = headers.get("Depth");
      if (path === "/dav/" || path === "/") {
        if (opts.rootNoPrincipal || path === "/") return res(207, ms(resp(path, "<d:resourcetype><d:collection/></d:resourcetype>")));
        return res(207, ms(resp(path, "<d:current-user-principal><d:href>" + PRINCIPAL + "</d:href></d:current-user-principal>")));
      }
      if (path === PRINCIPAL) {
        if (/current-user-principal/.test(body)) {
          return res(207, ms(resp(path, "<d:current-user-principal><d:href>" + PRINCIPAL + "</d:href></d:current-user-principal>")));
        }
        return res(207, ms(resp(path, "<c:calendar-home-set><d:href>" + CAL_HOME + "</d:href></c:calendar-home-set>" +
          "<r:addressbook-home-set><d:href>" + CARD_HOME + "</d:href></r:addressbook-home-set><d:displayname>U</d:displayname>")));
      }
      if (path === CAL_HOME || path === CARD_HOME) {
        let out = resp(path, "<d:resourcetype><d:collection/></d:resourcetype>");
        if (depth === "1") {
          Object.keys(cols).filter((c) => c.indexOf(path) === 0).forEach((c) => {
            const k = cols[c];
            const rt = "<d:resourcetype><d:collection/>" + (k.kind === "cal" ? "<c:calendar/>" : "<r:addressbook/>") + "</d:resourcetype>";
            const comps = k.kind === "cal" ? "<c:supported-calendar-component-set>" +
              k.comps.map((x) => '<c:comp name="' + x + '"/>').join("") + "</c:supported-calendar-component-set>" : "";
            const priv = "<d:current-user-privilege-set><d:privilege><d:read/></d:privilege>" +
              (opts.readOnly ? "" : "<d:privilege><d:write/></d:privilege>") + "</d:current-user-privilege-set>";
            out += resp(c, rt + "<d:displayname>" + esc(k.name) + "</d:displayname>" +
              (k.color ? "<a:calendar-color>" + k.color + "</a:calendar-color>" : "") + comps +
              "<cs:getctag>" + n + "</cs:getctag>" + (opts.noSyncToken ? "" : "<d:sync-token>" + token() + "</d:sync-token>") + priv);
          });
        }
        return res(207, ms(out));
      }
      if (cols[path]) {
        let out = resp(path, "<d:resourcetype><d:collection/></d:resourcetype>");
        if (depth === "1") {
          Object.keys(items).filter((p) => colOf(p) === path).sort().forEach((p) => {
            out += resp(p, "<d:getetag>" + esc(items[p].etag) + "</d:getetag><d:resourcetype/>");
          });
        }
        return res(207, ms(out));
      }
      return res(404);
    }
    if (method === "REPORT") {
      if (!cols[path]) return res(404);
      if (/sync-collection/.test(body)) {
        if (opts.noSyncToken) return res(403);
        const m = /<d:sync-token>([^<]*)<\/d:sync-token>/.exec(body);
        const from = m && m[1] ? m[1].replace(/&amp;/g, "&") : "";
        let since = 0;
        if (from) {
          const t = /\/sync\/(\d+)$/.exec(from);
          if (!t || +t[1] > n) return res(403, '<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>');
          since = +t[1];
        }
        const last = {};
        changes.filter((c) => c.col === path && c.n > since).forEach((c) => { last[c.path] = c; });
        let out = "";
        Object.keys(last).sort().forEach((p) => {
          if (last[p].gone || !items[p]) {
            if (from) out += "<d:response><d:href>" + esc(p) + "</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>";
          } else {
            out += resp(p, "<d:getetag>" + esc(items[p].etag) + "</d:getetag>");
          }
        });
        return res(207, ms(out, token()));
      }
      if (/multiget/.test(body)) {
        const card = /addressbook-multiget/.test(body);
        let out = "";
        const re = /<d:href>([^<]*)<\/d:href>/g;
        let m;
        while ((m = re.exec(body))) {
          const p = decodeURIComponent(m[1].replace(/&amp;/g, "&"));
          if (!items[p]) { out += "<d:response><d:href>" + esc(p) + "</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>"; continue; }
          out += resp(p, "<d:getetag>" + esc(items[p].etag) + "</d:getetag>" +
            (card ? "<r:address-data>" : "<c:calendar-data>") + esc(items[p].data) + (card ? "</r:address-data>" : "</c:calendar-data>"));
        }
        return res(207, ms(out));
      }
      return res(400);
    }
    const col = colOf(path);
    if (method === "GET") {
      if (!items[path]) return res(404);
      return res(200, items[path].data, { ETag: items[path].etag });
    }
    if (method === "PUT") {
      if (!col) return res(409);
      if (opts.readOnly) return res(403);
      const cur = items[path];
      if (!opts.ignoreConditions) {
        if (headers.get("If-None-Match") === "*" && cur) return res(412);
        const im = headers.get("If-Match");
        if (im && (!cur || cur.etag !== im)) return res(412);
      }
      const etag = newEtag();
      n++;
      items[path] = { data: body, etag };
      changes.push({ col, path, n, gone: false });
      return res(cur ? 204 : 201, "", opts.noPutEtag ? {} : { ETag: etag });
    }
    if (method === "DELETE") {
      const cur = items[path];
      if (!cur) return res(404);
      if (!opts.ignoreConditions) {
        const im = headers.get("If-Match");
        if (im && cur.etag !== im) return res(412);
      }
      n++;
      delete items[path];
      changes.push({ col, path, n, gone: true });
      return res(204);
    }
    return res(405);
  }

  // Direct: redirects are followed (as a browser does), res.url = the
  // final address. Through the relay: reported, never followed.
  async function doFetch(url, init) {
    init = init || {};
    const headers = new Headers(init.headers || {});
    const body = init.body == null ? "" : String(init.body);
    if (opts.relay && url === opts.relay) {
      const target = headers.get("X-Oros-Target");
      const r = handle(init.method || "GET", target, headers, body);
      if (r.redirect) return res(200, "", { "X-Oros-Status": "301", "X-Oros-Location": r.redirect });
      return r;
    }
    let target = url;
    for (let i = 0; i < 5; i++) {
      const r = handle(init.method || "GET", target, headers, body);
      if (!r.redirect) { r.url = target; return r; }
      target = r.redirect;
    }
    throw new TypeError("redirect loop");
  }

  return {
    fetch: doFetch, items, log, cols,
    put(path, data) { const col = colOf(path); n++; items[path] = { data, etag: newEtag() }; changes.push({ col, path, n, gone: false }); },
    remove(path) { const col = colOf(path); n++; delete items[path]; changes.push({ col, path, n, gone: true }); },
    base
  };
}

module.exports = { fakeDav };
