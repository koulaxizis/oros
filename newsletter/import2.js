// ============================================================
// orOS Newsletter — import2.js: Substack and Buttondown exports
// Pure logic (no DOM, no storage). Reads what these two services
// export, as DATA only (nothing is run, nothing becomes HTML):
//   - Substack  Settings › Exports › "Create new export" (.zip):
//               email_list.<pub>.csv (email, active_subscription,
//               expiry, plan, email_disabled, created_at [, name]) →
//               subscribers; posts.csv (post_id, post_date,
//               is_published, email_sent_at, title, subtitle, type,
//               audience) + posts/<post_id>.html → past issues.
//               Only published posts; only readers whose e-mail is
//               not disabled and whose subscription is active (see
//               subsSubstack for how "active" is read).
//   - Shopify    Customers › Export (CSV): only customers who accept
//               e-mail marketing (editor wave E4)
//   - Buttondown Subscribers › Export (CSV: email, creation_date,
//               notes, tags, subscriber_type …): only regular,
//               premium and gifted readers (unactivated, unsubscribed,
//               churned, spammy … are left out); Emails › Export
//               (CSV: subject, body, publish_date, status …) or the
//               .zip of Markdown files with a front matter (subject,
//               publish_date, status) → past issues (drafts and
//               scheduled e-mails are left out).
// A file the Newsletter already reads (a plain subscribers CSV, a
// Mailchimp / MailerLite / Brevo export, any other archive) is NOT
// claimed here: read() answers null and the old path runs.
// Subscribers go through core.planImport (the app's consent, dedupe,
// suppression and "never bring back who left" rules, unchanged).
// Issue bodies go through archive.js (the same HTML → Markdown
// reader as every other past-issues import).
//   read(name, bytes|text) → Promise<res|null>
//     res = { source: "substack"|"buttondown", people: [{ email,
//             name, tags[], lang }], pSkip (left / not active), pBad
//             (no valid address), items: [{ key, subj, pre, date, md }],
//             iSkip (drafts / not published), iNoBody }
//   plan(d, listId, res, opts) → { subs: planImport result, issues:
//             [new issue], have (issues already here), full }
//   issueId(it) → the stable id of an item
// Stable ids: subscribers use the app's own subId(list, address);
// a Substack post → "i" + hash53("imp|substack|" + post_id); anything
// else → the archive's own id (subject | date | length), so a file
// imported earlier through "Import past issues…" is not added twice.
// UMD: window.OrosNewsletterImport; module.exports in Node.
// ============================================================
(function (root) {
  "use strict";
  var NODE = typeof module === "object" && module.exports && typeof require === "function";
  var C = root.OrosNewsletterCore || (NODE ? require("./core.js") : null);
  var A = root.OrosNewsletterArchive || (NODE ? require("./archive.js") : null);
  var K = root.OrosImportKit || (NODE ? require("../importkit.js") : null);

  var MAX_FILE = 60 * 1024 * 1024;       // the file as picked
  var MAX_TEXT = 5 * 1024 * 1024;        // characters per entry read
  var MAX_ITEMS = 2000;                  // posts / e-mails looked at
  var MAX_PEOPLE = 40000;                // rows looked at
  var ACCEPT = ".zip,.csv,.md,.markdown,application/zip,text/csv,text/markdown,text/plain";

  function low(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
  function yes(v) { return /^(true|t|1|yes|y)$/.test(low(v)); }
  function no(v) { return /^(false|f|0|no|n)$/.test(low(v)); }
  function base(n) { return String(n || "").split("/").pop(); }
  function junk(n) { return /(^|\/)(__MACOSX|\.)/.test(String(n || "")); }

  // ---------- 1. Subscribers ----------
  function person(email, name, tags) {
    var e = C.normEmail(String(email || ""));
    if (!e) return null;
    return { email: e, name: C.oneLine(String(name || ""), C.LIM.name), tags: (tags || []).map(function (x) { return C.oneLine(String(x), 40); }).filter(Boolean).slice(0, 20), lang: "" };
  }
  // Substack: a reader whose e-mail is disabled has left. The column
  // active_subscription is about the subscription; in some exports it
  // is "false" for every free reader (it tracks the paid plan only):
  // when no free reader is marked active, it is not used for free ones.
  function subsSubstack(recs) {
    var out = { people: [], pSkip: 0, pBad: 0 };
    var isFree = function (r) { var p = low(K.get(r, ["plan"])); return !p || p === "free"; };
    var freeActive = recs.some(function (r) { return isFree(r) && yes(K.get(r, ["active_subscription", "active"])); });
    recs.slice(0, MAX_PEOPLE).forEach(function (r) {
      if (yes(K.get(r, ["email_disabled", "disabled"]))) { out.pSkip++; return; }
      var act = K.get(r, ["active_subscription", "active"]);
      if (no(act) && (freeActive || !isFree(r))) { out.pSkip++; return; }
      var plan = low(K.get(r, ["plan"]));
      var p = person(K.get(r, ["email", "email_address"]), K.get(r, ["name", "full_name"]),
                     plan && plan !== "free" ? [plan] : []);
      if (p) out.people.push(p); else out.pBad++;
    });
    return out;
  }
  // Buttondown: tags as "a, b", "a;b" or "['a', 'b']"
  var BD_KEEP = { regular: 1, premium: 1, gifted: 1 };
  function bdTags(v) {
    var s = String(v || "").trim(), j = /^\[/.test(s) ? K.json(s.replace(/'/g, "\"")) : null;
    var arr = Array.isArray(j) ? j : s.replace(/^\[|\]$/g, "").split(/[,;|]/);
    return arr.map(function (x) { return String(x).replace(/^["'\s]+|["'\s]+$/g, ""); }).filter(Boolean);
  }
  function subsButtondown(recs, fileName) {
    var out = { people: [], pSkip: 0, pBad: 0 };
    var unsubFile = /unsub|churn|removed/i.test(base(fileName));
    recs.slice(0, MAX_PEOPLE).forEach(function (r) {
      var type = low(K.get(r, ["subscriber_type", "type", "status"]));
      if (type ? !BD_KEEP[type] : unsubFile) { out.pSkip++; return; }
      var tags = bdTags(K.get(r, ["tags"]));
      if (type === "premium" || type === "gifted") tags.push(type);
      var p = person(K.get(r, ["email", "email_address"]), "", tags);
      if (p) out.people.push(p); else out.pBad++;
    });
    return out;
  }

  // Shopify customer export (Customers › Export, CSV: Customer ID,
  // First Name, Last Name, Email, Accepts Email Marketing … Tags; older
  // exports say Accepts Marketing): only customers who accept e-mail
  // marketing come in (editor wave E4).
  function subsShopify(recs) {
    var out = { people: [], pSkip: 0, pBad: 0 };
    recs.slice(0, MAX_PEOPLE).forEach(function (r) {
      if (!yes(K.get(r, ["accepts_email_marketing", "accepts_marketing"]))) { out.pSkip++; return; }
      var name = [K.get(r, ["first_name"]), K.get(r, ["last_name"])].map(function (x) { return String(x || "").trim(); }).filter(Boolean).join(" ");
      var p = person(K.get(r, ["email"]), name, String(K.get(r, ["tags"]) || "").split(","));
      if (p) out.people.push(p); else out.pBad++;
    });
    return out;
  }

  // ---------- 2. Past issues ----------
  function withPre(it, pre, key) {
    if (!it) return null;
    it.pre = C.oneLine(String(pre || ""), C.LIM.pre);
    it.key = key || "";
    return it;
  }
  // Substack posts.csv rows + their HTML (by post_id) → items
  function postsSubstack(recs, html) {
    var out = { items: [], iSkip: 0, iNoBody: 0 };
    recs.slice(0, MAX_ITEMS).forEach(function (r) {
      var pid = C.oneLine(String(K.get(r, ["post_id", "id"]) || ""), 200);
      if (!pid || !yes(K.get(r, ["is_published", "published"]))) { out.iSkip++; return; }
      var body = html[pid] !== undefined ? html[pid] : html[pid.split(".")[0]];
      if (body === undefined || !String(body).trim()) { out.iNoBody++; return; }
      var when = K.get(r, ["email_sent_at"]) || K.get(r, ["post_date", "published_at"]);
      var it = withPre(A.item(K.get(r, ["title"]), when, String(body)), K.get(r, ["subtitle"]), "substack|" + pid);
      if (it && it.md) out.items.push(it); else out.iNoBody++;
    });
    return out;
  }
  var BD_SENT = /^(sent|imported|published|about_to_send|in_flight|sending|)$/;
  function emailsButtondownCsv(recs) {
    var out = { items: [], iSkip: 0, iNoBody: 0 };
    recs.slice(0, MAX_ITEMS).forEach(function (r) {
      if (!BD_SENT.test(low(K.get(r, ["status"])))) { out.iSkip++; return; }
      var body = K.get(r, ["body", "content", "markdown", "html"]);
      if (!String(body || "").trim()) { out.iNoBody++; return; }
      var it = withPre(A.item(K.get(r, ["subject", "title"]), K.get(r, ["publish_date", "sent_at", "creation_date"]), String(body)),
                       K.get(r, ["description", "preview_text"]), "");
      if (it) out.items.push(it); else out.iNoBody++;
    });
    return out;
  }
  // One Buttondown Markdown file (front matter subject / publish_date /
  // status) → items, through the archive reader
  function emailButtondownMd(name, text) {
    var fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ""));
    var st = fm ? /^status\s*:\s*["']?([a-z_]*)/im.exec(fm[1]) : null;
    if (st && !BD_SENT.test(low(st[1]))) return { items: [], iSkip: 1, iNoBody: 0 };
    var xs = A.parseFile(name, text).map(function (it) { return withPre(it, "", ""); });
    return { items: xs, iSkip: 0, iNoBody: xs.length ? 0 : 1 };
  }

  // ---------- 3. Detecting ----------
  function heads(text) { return K.csv(String(text || "").slice(0, 20000), { maxRows: 1 }).head; }
  function has(h, names) { return K.col(h, names) !== -1; }
  function kindOfCsv(text) {
    var h = heads(text);
    if (has(h, ["email"]) && has(h, ["email_disabled"]) && has(h, ["active_subscription"])) return "ss-subs";
    if (has(h, ["post_id"]) && has(h, ["is_published"])) return "ss-posts";
    if (has(h, ["email", "email_address"]) && has(h, ["subscriber_type"])) return "bd-subs";
    if (has(h, ["email"]) && has(h, ["accepts_email_marketing", "accepts_marketing"]) && has(h, ["first_name"])) return "sh-subs";
    if (has(h, ["subject"]) && has(h, ["body"]) && (has(h, ["status"]) || has(h, ["email_type"]) || has(h, ["secondary_id"]))) return "bd-emails";
    return "";
  }
  function empty(source) { return { source: source, people: [], pSkip: 0, pBad: 0, items: [], iSkip: 0, iNoBody: 0 }; }
  function add(res, part) {
    ["people", "items"].forEach(function (k) { if (part[k]) res[k] = res[k].concat(part[k]); });
    ["pSkip", "pBad", "iSkip", "iNoBody"].forEach(function (k) { if (part[k]) res[k] += part[k]; });
    return res;
  }
  function fromCsvText(text, name) {
    var kind = kindOfCsv(text);
    if (!kind) return null;
    var recs = K.records(text, { maxRows: Math.max(MAX_PEOPLE, MAX_ITEMS) }).rows;
    if (kind === "ss-subs") return add(empty("substack"), subsSubstack(recs));
    if (kind === "ss-posts") return add(empty("substack"), postsSubstack(recs, {}));
    if (kind === "bd-subs") return add(empty("buttondown"), subsButtondown(recs, name));
    if (kind === "sh-subs") return add(empty("shopify"), subsShopify(recs));
    return add(empty("buttondown"), emailsButtondownCsv(recs));
  }
  function fromZip(bytes) {
    var z;
    try { z = K.unzip(bytes); } catch (e) { return Promise.resolve(null); }
    var names = z.names.filter(function (n) { return !junk(n) && !/\/$/.test(n); });
    var ssList = names.filter(function (n) { return /^email_list[^/]*\.csv$/i.test(base(n)); });
    var ssPosts = names.filter(function (n) { return /^posts\.csv$/i.test(base(n)); })[0];
    var txt = function (n) { return z.text(n, MAX_TEXT).catch(function () { return ""; }); };
    var seq = function (list, fn) {
      return list.reduce(function (p, n) { return p.then(function () { return txt(n).then(function (s) { fn(n, s); }); }); }, Promise.resolve());
    };
    if (ssList.length || ssPosts) {
      var res = empty("substack"), html = {};
      var htmlNames = names.filter(function (n) { return /(^|\/)posts\/[^/]+\.html?$/i.test(n); }).slice(0, MAX_ITEMS);
      return seq(ssList.slice(0, 10), function (n, s) {
        add(res, subsSubstack(K.records(s, { maxRows: MAX_PEOPLE }).rows));
      }).then(function () {
        return seq(htmlNames, function (n, s) { html[base(n).replace(/\.html?$/i, "")] = s; });
      }).then(function () {
        if (!ssPosts) return;
        return txt(ssPosts).then(function (s) { add(res, postsSubstack(K.records(s, { maxRows: MAX_ITEMS }).rows, html)); });
      }).then(function () { return res; });
    }
    // Buttondown: its CSVs, and emails/*.md when there is no emails CSV
    var csvs = names.filter(function (n) { return /\.csv$/i.test(n); }).slice(0, 20);
    var mds = names.filter(function (n) { return /\.(md|markdown)$/i.test(n); }).slice(0, MAX_ITEMS);
    var bd = empty("buttondown"), found = false, emailsCsv = false;
    return seq(csvs, function (n, s) {
      var r = fromCsvText(s, n);
      if (!r || r.source !== "buttondown") return;
      found = true;
      if (r.items.length || r.iSkip || r.iNoBody) emailsCsv = true;
      add(bd, r);
    }).then(function () {
      // Markdown files with Buttondown's front matter (or beside its CSVs)
      var bdMd = found || mds.some(function (n) { return /(^|\/)emails\//i.test(n); });
      if (!bdMd || emailsCsv) return;
      found = found || mds.length > 0;
      return seq(mds, function (n, s) { add(bd, emailButtondownMd(n, s)); });
    }).then(function () { return found ? bd : null; });
  }
  function read(name, bytes) {
    if (bytes == null) return Promise.resolve(null);
    if (typeof bytes !== "string" && bytes.length > MAX_FILE) return Promise.reject(new Error("toobig"));
    if (typeof bytes !== "string" && K.isZip(bytes)) return fromZip(bytes);
    var text = typeof bytes === "string" ? bytes : K.text(bytes);
    if (text.length > MAX_TEXT * 4) return Promise.reject(new Error("toobig"));
    if (/\.(md|markdown)$/i.test(String(name || ""))) return Promise.resolve(null);   // the archive reads it
    return Promise.resolve(fromCsvText(text, name));
  }

  // ---------- 4. What an import would add ----------
  function issueId(it) {
    if (it.key) return "i" + C.hash53("imp|" + it.key);
    return "i" + C.hash53("imp|" + it.subj + "|" + it.date + "|" + it.md.length);   // = archive.toIssues
  }
  // opts: { basis, mode: "archive"|"draft", now, subs (bool), issues
  // (bool), tags[] }. Issues stop at the app's issue limit and storage
  // budget (full: some were left out); none is ever replaced.
  function plan(d, listId, res, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var subs = opts.subs === false ? { add: [], dup: 0, supp: 0, left: 0, over: 0, bad: 0 }
      : C.planImport(d, listId, res.people, { basis: opts.basis || "consent", src: "csv", bad: res.pBad, tags: opts.tags || [], now: now });
    var out = { subs: subs, issues: [], have: 0, full: false };
    if (opts.issues === false) return out;
    var room = C.LIM.archive - C.live(d.issues).length, size = JSON.stringify(d).length, seen = {};
    subs.add.forEach(function (s) { size += JSON.stringify(s).length; });
    res.items.forEach(function (it) {
      var id = issueId(it);
      if (seen[id]) return;
      seen[id] = 1;
      if (C.issue(d, id)) { out.have++; return; }
      var done = it.date || now;
      var x = C.normIssue(opts.mode === "draft"
        ? { id: id, m: now, list: listId, subj: it.subj, pre: it.pre, fmt: "md", md: it.md, st: "draft" }
        : { id: id, m: now, list: listId, subj: it.subj, pre: it.pre, fmt: "md", md: it.md, st: "sent", start: done, done: done, n: 0, imp: 1 });
      var n = JSON.stringify(x).length;
      if (out.issues.length >= room || size + n > C.LIM.dataChars) { out.full = true; return; }
      size += n;
      out.issues.push(x);
    });
    return out;
  }
  // Oldest and newest item dates (ms, 0 when unknown)
  function range(items) {
    var a = 0, b = 0;
    items.forEach(function (it) { if (it.date) { if (!a || it.date < a) a = it.date; if (it.date > b) b = it.date; } });
    return { from: a, to: b };
  }

  var api = { ACCEPT: ACCEPT, MAX_FILE: MAX_FILE, read: read, plan: plan, range: range, issueId: issueId,
              kindOfCsv: kindOfCsv, subsSubstack: subsSubstack, subsButtondown: subsButtondown, subsShopify: subsShopify,
              postsSubstack: postsSubstack, emailsButtondownCsv: emailsButtondownCsv };
  if (NODE) module.exports = api;
  else root.OrosNewsletterImport = api;
})(typeof window !== "undefined" ? window : globalThis);
