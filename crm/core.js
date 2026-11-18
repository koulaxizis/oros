// ============================================================
// orOS CRM — core.js (shared logic, v1.11.0)
// One file holds the model, the merge and every derived number,
// so the app, the universal search provider, the shell reminder,
// the Calendar feed, the Today provider, Contacts and (later)
// Invoices can never disagree. Pure functions, no DOM, no network, no clock: callers
// pass "now" / "today".
//
// API (window.OrosCrmCore, module.exports under Node):
//   DATA_VER, ID_RE, STAGES, OPEN_STAGES, STAGE_PROB, ACT_KINDS,
//   CUST_ST, CURRENCIES, LIMITS
//   newId(nowMs), isYmd, ymdOf(ms), addDays(ymd, n), dayDiff(a, b)
//   cleanText(s, max, multiline), fold(s)
//   validAfm(s) → true | false (Greek ΑΦΜ check digit)
//   parseMoney(str) → cents | null · moneyStr(cents, cur, lang)
//   norm(raw) → canonical data (invalid rows dropped)
//   normCust / normDeal / normAct / normFup / normTag / normPrefs
//   merge(A, B) → canonical data (symmetric, idempotent)
//   empty() → fresh data
//   byId(list, id)
//   custName(c), lastContact(data, custId) → ms | 0
//   stages(data) → [{ id, name, prob, open, own }] (board order)
//   stageOf(data, deal) → the stage the deal shows in
//   dealProb(d, data?), openDeals(data, custId?)
//   pipeline(data) → { stage: { n, val, wval } }
//   agenda(data, today, horizon) → { late, today, soon } (open fups)
//   dueNow(data, today, hhmm) → open fups due by now (reminders)
//   forgotten(data, nowMs, days) → [cust] (lead / active, no contact)
//   dashboard(data, nowMs, today) → numbers for the Dashboard tab
//   customersForBilling(data) → [{ id, name, afm, doy, job, addr,
//     country, email, phone }] (BR-CRM-INV, read by Invoices)
//   invoicePrefill(cust, deal?, cur) → the { new } of BR-CRM-INV 1
//   quotePrefill(cust, deal?, cur) → BR-Q1 payload, or null when a
//     deal's value has no valid ISO currency code
//   csvRows(data, lang) → rows · csvCell(v)
//   mailLog(x) → BR-CRM-MAIL payload cleaned { email, name, subject,
//     text, at } | null · custByEmail(data, email, emailOf?) → cust | null
//   parseCsv(text) → { sep, rows } (",", ";" or tab, quoted cells)
//   csvImport(data, text, nowMs) → { add: [cust], tags: [tag], dup,
//     noName, over, cols: [field] } | null (no name column)
//   backup(data) / restore(data, file) → merged data | null
//   reminders(data, today, hhmm, seen) → { fresh: [{ key, fup }], next }
//   reminderText(data, fup, today, lang) → { title, body }
//   calendarOn(data, ymd, today) → [{ k: fup|late|done|close, fup|deal }]
//   custsForContact(data, contactId) → [cust]
//   normWf(x) → the web form record | null (crm/webform.js)
//   partners (1.5, BR-CRM-LINK): ROLES, LINK_KINDS, rolesOf(c),
//     normPt, ptOf(data, custId), rolesOf(data, c), hasRole(data, c, r),
//     lnOf(data, c), rolesRow(data, custId, roles) → pt row to save,
//     normRoles(v), normLinks(v), pubKey(name),
//     linksOf(data, c, kind?) → [{ key, k, v }], linkOwner(data, key) →
//     cust | null, linkMove(data, custId, key) → [pt rows to save]
//   pt?: [{ id = customer id, m, roles?: ["cust"|"sup"|"shop"|"auth"|
//     "assoc"] (absent = a customer only), ln?: ["sup:<id>"|"wh:<id>"|
//     "tsc:<id>"|"inv:<id>"|"pub:<folded name>"] }] links to records of
//     Stock, Timesheet, Invoices and Publishing. CRM writes only its
//     own data: the other apps are read, never changed.
//   Contracts (partner card W4): normCtr, ctrRemindDay(c) → the
//     reminder day, contractsOf(data, custId, today), ctrState(c, today)
//     → "on" | "soon" | "ended"; ctr?: [{ id, m, cust, t, from?, to?,
//     rem, val?, note, file?, fup? }] (see normCtr).
//   balance(data, c, I, inv, today) → { in, out: { CUR: { open, overdue } } }
//     what a partner owes you / you owe them in Invoices (W5)
//   Revenue Splitter beneficiaries (1.7, partner card W6): normRsl,
//     rsOf(data, c) → { a, n: [name] } | null, rsRow(custId, a,
//     names) → the rsl row to save; rsl?: [{ id = customer id, m, a?:
//     Connected services account (a WooCommerce shop), n?: [the
//     beneficiary's exact name in the shop's Revenue Splitter] }]. Its
//     own list, like ctr, so a 1.6 device can't strip it (normLinks
//     would drop an unknown "rs:" key from pt.ln). A row without n is
//     kept: an unlink must not come back from another device's copy
//     (the same holds for an emptied pt row since 1.7).
//   Linked items (1.9, partner card "Files and notes"): ITEM_KINDS,
//     normIx, itemsOf(data, c) → [{ k, r, t }], itemTarget(it) →
//     { app, target } for __orosOpenAt, itemsRow(data, custId, items)
//     → the ix row to save; ix?: [{ id = customer id, m, it?: [{ k:
//     "kb" (a Kanban card, r = "board/col/card") | "nt" (a Notes page,
//     r = page id) | "ly" (a Layout document) | "at" (an Atelier
//     design), r = doc id, t: the title when it was linked }] }]. Its
//     own list like rsl; an emptied row stays (an unlink must not come
//     back from another device's copy). The other apps are never
//     changed.
//   Rights (1.11, RIGHTS): RT_RIGHTS, RT_STATUS, normRt, rtOf(data,
//     ctrId), rtRow(data, ctrId, args) → { row } | { err } (the Gate's
//     words, see rtRow), rtStatus(data, r, k), rightsBoard(data, today,
//     titles) → the three flags of the Contracts tab's Rights view;
//     rt?: [{ id = contract id, m, tpl?, grant?, cov?, r?, ter?, ext?,
//     so?, cd?, cc?, ccp?, rev?, src?, chk?, note? }] (see normRt). Its
//     own list like cx; a row whose contract is gone leaves with it.
// Data (synced slice "crm", key oros-crm-data):
//   { ver: 1, cust, deals, acts, fups, tags, stg: [row…] each
//     sorted by id, pt?: partners (1.5), ctr?: contracts (1.6), rsl?: Revenue Splitter links (1.7), prefs: { pm, cur, forget }, wf?: web form,
//     cs?: Contacts sync rows (1.8), tombs: { id: deletedAt } }
// Nothing derived is stored (last contact, totals, "late"): two
// devices can never disagree on it.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER = 1;
  var ID_RE = /^[a-z0-9]{6,40}$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  var CREF_RE = /^[A-Za-z0-9_.:-]{1,80}$/;   // a Contacts id (theirs, not ours)
  var DAY_MS = 86400000;
  var TOMB_DAYS = 365;
  var VAL_MAX = 99999999999;          // cents: just under a billion
  var LIMITS = { cust: 2000, deals: 5000, acts: 20000, fups: 10000, tags: 50, stg: 20, people: 20, custTags: 10, openStages: 8, links: 30, pt: 2000, ctr: 5000, cx: 5000, rt: 5000, rsl: 2000, rsNames: 5, cs: 2000, csOld: 5, ix: 2000, items: 50 };
  var STAGES = ["new", "contact", "proposal", "nego", "won", "lost"];
  var OPEN_STAGES = ["new", "contact", "proposal", "nego"];      // the built-in open stages
  var STAGE_PROB = { "new": 10, contact: 25, proposal: 50, nego: 75, won: 100, lost: 0 };
  var STAGE_POS = { "new": 10, contact: 20, proposal: 30, nego: 40 };
  var ACT_KINDS = ["call", "mail", "meet", "msg", "note"];
  var CUST_ST = ["lead", "active", "past"];
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "CAD", "AUD", "JPY"];
  var LIST_KEYS = ["cust", "deals", "acts", "fups", "tags", "stg", "pt", "ctr", "cx", "rt", "rsl", "cs", "ix"];

  // ---------- Small helpers ----------
  function isInt(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n; }
  function cmpStr(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function canon(v) { return JSON.stringify(v); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function newId(nowMs) {
    var t = (isInt(nowMs) ? nowMs : Date.now()).toString(36);
    var r = "";
    while (r.length < 8) r += Math.floor(Math.random() * 36).toString(36);
    return t + r;
  }

  function isYmd(s) {
    var m = typeof s === "string" && YMD_RE.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }
  function ymdOf(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function dayNum(ymd) {
    var m = YMD_RE.exec(ymd);
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
  }
  function addDays(ymd, n) {
    var d = new Date((dayNum(ymd) + n) * DAY_MS);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function dayDiff(a, b) { return dayNum(b) - dayNum(a); }   // b − a in days

  // Plain text only. Control characters (and U+2028/2029) go; a
  // single-line field folds every run of whitespace into one space.
  function cleanText(s, max, multiline) {
    if (typeof s !== "string") return "";
    var t = s.replace(/\r\n?/g, "\n");
    if (multiline) {
      t = t.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u2028\u2029]/g, "")
           .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    } else {
      t = t.replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    }
    return t.length > max ? t.slice(0, max).trim() : t;
  }

  // Case, accents and final sigma folded: "Παπαδόπουλος" ~ "παπαδοπουλοσ".
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/ς/g, "σ");
  }

  // Greek ΑΦΜ: 9 digits, the last is (Σ d[i]·2^(8−i) mod 11) mod 10.
  function validAfm(s) {
    var v = String(s || "").replace(/\s+/g, "").replace(/^(EL|GR)/i, "");
    if (!/^\d{9}$/.test(v) || v === "000000000") return false;
    var sum = 0;
    for (var i = 0; i < 8; i++) sum += (+v.charAt(i)) * Math.pow(2, 8 - i);
    return (sum % 11) % 10 === +v.charAt(8);
  }

  // "1.234,56" / "1,234.56" / "1234.5" / "1 234" → cents. The last
  // "," or "." followed by 1–2 digits is the decimal mark.
  function parseMoney(str) {
    var s = String(str == null ? "" : str).replace(/[\s€$£]/g, "");
    if (!s) return null;
    if (!/^\d[\d.,]*$/.test(s)) return null;
    var m = /^(.*)[.,](\d{1,2})$/.exec(s);
    var whole = m ? m[1] : s, frac = m ? m[2] : "";
    whole = whole.replace(/[.,]/g, "");
    if (!/^\d+$/.test(whole)) return null;
    var c = Number(whole) * 100 + (frac ? Number(frac.length === 1 ? frac + "0" : frac) : 0);
    return isInt(c) && c <= VAL_MAX ? c : null;
  }
  // orosI18n (../i18n.js, browser only): the locale of any language code,
  // and the "crm" pack over a { en, el } table for a pack language.
  function i18n() { return root && root.orosI18n ? root.orosI18n : null; }
  function localeOf(lang) {
    var I = i18n();
    return I ? I.locale(lang) : (lang === "el" ? "el-GR" : "en-GB");
  }
  function words(tbl, lang) {
    var I = i18n();
    if (I && lang && !tbl[lang]) I.table(tbl, "crm", lang);
    return tbl[lang] || tbl.en;
  }

  function moneyStr(cents, cur, lang) {
    var v = (isInt(cents) ? cents : 0) / 100;
    var c = CURRENCIES.indexOf(cur) >= 0 ? cur : "EUR";
    try {
      return new Intl.NumberFormat(localeOf(lang),
        { style: "currency", currency: c, maximumFractionDigits: v % 1 ? 2 : 0 }).format(v);
    } catch (e) { return v.toFixed(2) + " " + c; }
  }

  // ---------- Normalizers (strict: an invalid row is dropped) ----------
  function str(o, k, max, multi) { return cleanText(o[k], max, multi); }
  function put(out, k, v) { if (v !== "" && v !== 0 && v !== null && v !== undefined) out[k] = v; }
  function stamp(x) { return isInt(x.m) && x.m > 0 ? x.m : 0; }

  function normCust(x) {
    if (!x || typeof x !== "object" || !ID_RE.test(x.id) || !stamp(x)) return null;
    var name = str(x, "name", 120);
    if (!name) return null;
    var o = { id: x.id, m: x.m, name: name, kind: x.kind === "person" ? "person" : "co",
              st: CUST_ST.indexOf(x.st) >= 0 ? x.st : "lead" };
    put(o, "alias", str(x, "alias", 80));
    put(o, "afm", cleanText(x.afm, 20).replace(/\s+/g, ""));
    put(o, "doy", str(x, "doy", 60));
    put(o, "job", str(x, "job", 80));
    put(o, "addr", str(x, "addr", 200));
    put(o, "country", str(x, "country", 60));
    put(o, "phone", str(x, "phone", 40));
    put(o, "email", str(x, "email", 120));
    put(o, "web", str(x, "web", 300));
    put(o, "src", str(x, "src", 60));
    put(o, "note", str(x, "note", 2000, true));
    if (x.star === 1 || x.star === true) o.star = 1;
    if (isInt(x.ct) && x.ct > 0) o.ct = x.ct;
    var tags = [];
    if (Array.isArray(x.tags)) x.tags.forEach(function (t) {
      if (typeof t === "string" && ID_RE.test(t) && tags.indexOf(t) < 0 && tags.length < LIMITS.custTags) tags.push(t);
    });
    tags.sort(cmpStr);
    if (tags.length) o.tags = tags;
    var people = [];
    if (Array.isArray(x.people)) x.people.forEach(function (p) {
      if (!p || typeof p !== "object" || people.length >= LIMITS.people) return;
      var c = typeof p.c === "string" && CREF_RE.test(p.c) ? p.c : "";
      var n = cleanText(p.n, 80);
      if (!c && !n) return;
      var q = { c: c, n: n };
      put(q, "role", cleanText(p.role, 60));
      if (!c) {                         // not in Contacts: own phone / email
        put(q, "phone", cleanText(p.phone, 40));
        put(q, "email", cleanText(p.email, 120));
      }
      people.push(q);
    });
    if (people.length) o.people = people;   // order is the user's
    return o;
  }

  // ---------- Partners (1.5, BR-CRM-LINK) ----------
  // A record can be more than a customer: a supplier, a shop that
  // sells on consignment, an author / contributor, an associate, and
  // it can be linked to rows of other apps by their ids (Publishing
  // people have no id: their folded name). Both live in a top-level
  // list pt, one row per customer (its id IS the customer id, so the
  // customer's tombstone hides it): { id, m, roles?, ln? }. A separate
  // list, like Stock's cons, so a 1.4 device that edits the customer
  // can't strip them: it drops pt on its own merge, and the union of
  // the next merge brings it back. Written only when it has rows, so
  // data without partners keeps its bytes. roles is stored only when
  // it is not "customer only".
  var ROLES = ["cust", "sup", "shop", "auth", "assoc"];
  var LINK_KINDS = ["sup", "wh", "tsc", "inv", "pub"];
  var LINK_ID_RE = /^(sup|wh|tsc|inv):[A-Za-z0-9_-]{1,60}$/;
  function normRoles(v) {
    if (!Array.isArray(v)) return null;
    var out = ROLES.filter(function (r) { return v.indexOf(r) >= 0; });
    if (!out.length || (out.length === 1 && out[0] === "cust")) return null;
    return out;
  }
  function pubKey(name) {
    var f = fold(cleanText(name, 120)).replace(/\s+/g, " ").trim().slice(0, 80).trim();
    return f ? "pub:" + f : "";
  }
  function normLink(s) {
    if (typeof s !== "string") return "";
    if (LINK_ID_RE.test(s)) return s;
    if (s.slice(0, 4) === "pub:") return pubKey(s.slice(4));
    return "";
  }
  function normLinks(v) {
    var out = [];
    if (Array.isArray(v)) v.forEach(function (s) {
      var k = normLink(s);
      if (k && out.indexOf(k) < 0 && out.length < LIMITS.links) out.push(k);
    });
    return out.sort(cmpStr);
  }
  function normPt(x) {
    if (!x || typeof x !== "object" || !ID_RE.test(x.id) || !stamp(x)) return null;
    var o = { id: x.id, m: x.m };
    var roles = normRoles(x.roles);
    if (roles) o.roles = roles;
    var ln = normLinks(x.ln);
    if (ln.length) o.ln = ln;
    return o;
  }
  // Revenue Splitter (W6): names are the shop's exact strings (its
  // splits match them exactly), so only trimmed and capped, never folded.
  var ACCT_RE = /^[a-z0-9]{1,40}$/;
  function rsNames(v) {
    var out = [];
    if (Array.isArray(v)) v.forEach(function (n) {
      var x = cleanText(n, 120);
      if (x && out.indexOf(x) < 0 && out.length < LIMITS.rsNames) out.push(x);
    });
    return out.sort(cmpStr);
  }
  function normRsl(x) {
    if (!x || typeof x !== "object" || !ID_RE.test(x.id) || !stamp(x)) return null;
    var o = { id: x.id, m: x.m };
    var n = rsNames(x.n);
    if (n.length) {
      if (typeof x.a === "string" && ACCT_RE.test(x.a)) o.a = x.a;
      o.n = n;
    }
    return o;
  }
  function rsOf(data, c) {
    var r = c && data ? byId(data.rsl, c.id) : null;
    return r && r.n ? { a: r.a || "", n: r.n.slice() } : null;
  }
  function rsRow(custId, a, names) {
    var o = { id: custId, m: 0 };
    var n = rsNames(names);
    if (n.length) {
      if (typeof a === "string" && ACCT_RE.test(a)) o.a = a;
      o.n = n;
    }
    return o;
  }
  // Linked items (1.9): Kanban cards, Notes pages, Layout documents
  // and Atelier designs on a partner's card
  var ITEM_KINDS = ["kb", "nt", "ly", "at"];
  var ITEM_APP = { kb: "kanban", nt: "notes", ly: "layout", at: "atelier" };
  function itemRef(k, r) {
    if (typeof r !== "string") return "";
    var parts = r.split("/");
    if (parts.length !== (k === "kb" ? 3 : 1)) return "";
    for (var i = 0; i < parts.length; i++) if (!CREF_RE.test(parts[i])) return "";
    return r;
  }
  function normItems(v) {
    var out = [], seen = {};
    if (Array.isArray(v)) v.forEach(function (x) {
      if (!x || typeof x !== "object" || ITEM_KINDS.indexOf(x.k) < 0) return;
      var r = itemRef(x.k, x.r);
      if (!r) return;
      var key = x.k + ":" + (x.k === "kb" ? r.split("/")[0] + "/" + r.split("/")[2] : r);
      if (seen[key] || out.length >= LIMITS.items) return;
      seen[key] = 1;
      var o = { k: x.k, r: r };
      put(o, "t", cleanText(x.t, 200));
      out.push(o);
    });
    return out.sort(function (a, b) { return cmpStr(a.k + ":" + a.r, b.k + ":" + b.r); });
  }
  function normIx(x) {
    if (!x || typeof x !== "object" || !ID_RE.test(x.id) || !stamp(x)) return null;
    var o = { id: x.id, m: x.m };
    var it = normItems(x.it);
    if (it.length) o.it = it;
    return o;
  }
  function itemsOf(data, c) {
    var r = c && data ? byId(data.ix, c.id) : null;
    return r && r.it ? r.it.map(function (x) { return { k: x.k, r: x.r, t: x.t || "" }; }) : [];
  }
  // the same item whatever column a Kanban card is in now
  function itemKey(it) { return it.k + ":" + (it.k === "kb" ? it.r.split("/")[0] + "/" + it.r.split("/")[2] : it.r); }
  function itemTarget(it) {
    if (!it || !ITEM_APP[it.k] || !itemRef(it.k, it.r)) return null;
    if (it.k === "kb") { var p = it.r.split("/"); return { app: "kanban", target: { board: p[0], col: p[1], card: p[2] } }; }
    if (it.k === "nt") return { app: "notes", target: { page: it.r } };
    return { app: ITEM_APP[it.k], target: { doc: it.r } };
  }
  function itemsRow(data, custId, items) {
    var prev = data ? byId(data.ix, custId) : null;
    var o = { id: custId, m: prev ? prev.m : 0 };
    var it = normItems(items);
    if (it.length) o.it = it;
    return o;
  }
  function ptOf(data, custId) { return (data && byId(data.pt, custId)) || null; }
  function rolesOf(data, c) { var p = c && ptOf(data, c.id); return p && p.roles ? p.roles : ["cust"]; }
  function hasRole(data, c, r) { return rolesOf(data, c).indexOf(r) >= 0; }
  function lnOf(data, c) { var p = c && ptOf(data, c.id); return (p && p.ln) || []; }
  // The pt row to save for new roles (the links stay)
  function rolesRow(data, custId, roles) {
    var r = own(ptOf(data, custId) || { id: custId });
    var rl = normRoles(roles);
    if (rl) r.roles = rl; else delete r.roles;
    return r;
  }
  function linksOf(data, c, kind) {
    return lnOf(data, c).map(function (key) {
      var i = key.indexOf(":");
      return { key: key, k: key.slice(0, i), v: key.slice(i + 1) };
    }).filter(function (x) { return !kind || x.k === kind; });
  }
  // One record of another app belongs to one partner. Two devices may
  // link it to two partners at once: the first by id answers.
  function linkOwner(data, key) {
    key = normLink(key);
    if (!key || !data) return null;
    var pts = (data.pt || []).slice().sort(function (a, b) { return cmpStr(a.id, b.id); });
    for (var i = 0; i < pts.length; i++) {
      if ((pts[i].ln || []).indexOf(key) >= 0) { var c = byId(data.cust, pts[i].id); if (c) return c; }
    }
    return null;
  }
  // Link key to custId (custId "" = unlink it everywhere): the pt rows
  // that change, as copies for the caller to save.
  function linkMove(data, custId, key) {
    key = normLink(key);
    var out = [];
    if (!key || !data) return out;
    var ids = (data.pt || []).map(function (p) { return p.id; });
    if (custId && ids.indexOf(custId) < 0 && byId(data.cust, custId)) ids.push(custId);
    ids.forEach(function (id) {
      var r = own(ptOf(data, id) || { id: id });
      var ln = (r.ln || []).slice(), i = ln.indexOf(key);
      if (id === custId) {
        if (i >= 0 || ln.length >= LIMITS.links) return;
        ln.push(key);
      } else {
        if (i < 0) return;
        ln.splice(i, 1);
      }
      if (ln.length) r.ln = ln.sort(cmpStr); else delete r.ln;
      out.push(r);
    });
    return out;
  }

  function normDeal(x) {
    if (!x || typeof x !== "object" || !ID_RE.test(x.id) || !stamp(x) || !ID_RE.test(x.cust)) return null;
    var title = str(x, "title", 120);
    if (!title) return null;
    var o = { id: x.id, m: x.m, cust: x.cust, title: title,
              val: isInt(x.val) && x.val >= 0 && x.val <= VAL_MAX ? x.val : 0,
              stage: STAGES.indexOf(x.stage) >= 0 || ID_RE.test(x.stage) ? x.stage : "new" };
    if (isInt(x.prob) && x.prob >= 0 && x.prob <= 100) o.prob = x.prob;
    if (isYmd(x.close)) o.close = x.close;
    if (isYmd(x.cd) && (o.stage === "won" || o.stage === "lost")) o.cd = x.cd;
    put(o, "why", str(x, "why", 200));
    put(o, "note", str(x, "note", 2000, true));
    if (isInt(x.ct) && x.ct > 0) o.ct = x.ct;
    return o;
  }

  function normAct(x) {
    if (!x || typeof x !== "object" || !ID_RE.test(x.id) || !stamp(x) || !ID_RE.test(x.cust)) return null;
    if (!isInt(x.at) || x.at <= 0) return null;
    var o = { id: x.id, m: x.m, cust: x.cust, k: ACT_KINDS.indexOf(x.k) >= 0 ? x.k : "note", at: x.at,
              text: str(x, "text", 2000, true) };
    if (typeof x.deal === "string" && ID_RE.test(x.deal)) o.deal = x.deal;
    put(o, "who", str(x, "who", 80));
    return o;
  }

  function normFup(x) {
    if (!x || typeof x !== "object" || !ID_RE.test(x.id) || !stamp(x) || !ID_RE.test(x.cust)) return null;
    if (!isYmd(x.d)) return null;
    var text = str(x, "text", 300);
    if (!text) return null;
    var o = { id: x.id, m: x.m, cust: x.cust, d: x.d, text: text };
    if (typeof x.t === "string" && HM_RE.test(x.t)) o.t = x.t;
    if (typeof x.deal === "string" && ID_RE.test(x.deal)) o.deal = x.deal;
    if (isYmd(x.done)) o.done = x.done;
    return o;
  }

  function normTag(x) {
    if (!x || typeof x !== "object" || !ID_RE.test(x.id) || !stamp(x)) return null;
    var name = str(x, "name", 30);
    if (!name) return null;
    return { id: x.id, m: x.m, name: name, col: isInt(x.col) && x.col >= 0 && x.col < 8 ? x.col : 0 };
  }

  function normPrefs(x) {
    var p = x && typeof x === "object" ? x : {};
    return {
      pm: isInt(p.pm) && p.pm >= 0 ? p.pm : 0,
      cur: CURRENCIES.indexOf(p.cur) >= 0 ? p.cur : "EUR",
      forget: isInt(p.forget) && p.forget >= 7 && p.forget <= 365 ? p.forget : 30
    };
  }

  // Pipeline stages (phase 2): a record per built-in open stage the
  // user changed (id "new" | "contact" | "proposal" | "nego": name ""
  // = the built-in label, off = hidden) and one per own stage (id like
  // any row, name required). prob = the default probability, pos =
  // the order among the open stages (built-ins 10 / 20 / 30 / 40).
  // Won and Lost stay fixed: the dashboard counts on them.
  function normStg(x) {
    if (!x || typeof x !== "object" || !stamp(x)) return null;
    var bi = OPEN_STAGES.indexOf(x.id) >= 0;
    if (!bi && !ID_RE.test(x.id)) return null;
    var name = str(x, "name", 30);
    if (!bi && !name) return null;
    var o = { id: x.id, m: x.m };
    put(o, "name", name);
    if (isInt(x.prob) && x.prob >= 0 && x.prob <= 100) o.prob = x.prob;
    if (isInt(x.pos) && x.pos >= 0 && x.pos <= 1000000) o.pos = x.pos;
    if (bi && (x.off === 1 || x.off === true)) o.off = 1;
    return o;
  }

  // Contracts (partner card W4, 1.6): a top-level list like pt, written
  // only when it has rows (an older CRM drops it on its own merge and
  // the next union brings it back). { id, m, cust, t (title), from?,
  // to? (the day it ends), rem (days before to for the reminder),
  // val? (cents), note, file? (/internal/ path on the orOS disk),
  // fup? (the follow-up that reminds of the end: an ordinary fup, so
  // Today, the agenda, Calendar and notifications need nothing new) }
  var FILE_RE = /^\/internal\/[^\u0000-\u001f]{1,300}$/;
  function normCtr(x) {
    if (!x || typeof x !== "object" || !ID_RE.test(x.id) || !stamp(x) || !ID_RE.test(x.cust)) return null;
    var title = str(x, "t", 120);
    if (!title) return null;
    var o = { id: x.id, m: x.m, cust: x.cust, t: title };
    if (isYmd(x.from)) o.from = x.from;
    if (isYmd(x.to)) o.to = x.to;
    o.rem = isInt(x.rem) && x.rem >= 0 && x.rem <= 365 ? x.rem : 30;
    if (isInt(x.val) && x.val > 0 && x.val <= VAL_MAX) o.val = x.val;
    put(o, "note", str(x, "note", 2000, true));
    if (typeof x.file === "string" && FILE_RE.test(x.file) && x.file.indexOf("/../") < 0) o.file = x.file;
    if (typeof x.fup === "string" && ID_RE.test(x.fup)) o.fup = x.fup;
    return o;
  }
  // The day the end is to be remembered ("" without an end day).
  function ctrRemindDay(c) { return c && c.to ? addDays(c.to, -(c.rem || 0)) : ""; }
  // One partner's contracts: the running ones by end day, then the
  // ones without an end, then the ended ones (newest first).
  function contractsOf(data, custId, today) {
    return (data.ctr || []).filter(function (c) { return c.cust === custId; }).sort(function (a, b) {
      var ea = a.to && a.to < today ? 2 : (a.to ? 0 : 1), eb = b.to && b.to < today ? 2 : (b.to ? 0 : 1);
      if (ea !== eb) return ea - eb;
      if (ea === 2) return cmpStr(b.to, a.to) || cmpStr(a.id, b.id);
      return cmpStr(a.to || "", b.to || "") || cmpStr(a.t, b.t) || cmpStr(a.id, b.id);
    });
  }
  // A contract's state (1.10): "term" (ended by agreement, x = its cx
  // row) | "ended" (the end day has passed) | "soon" (within SOON_DAYS
  // of the end) | "on". The reminder day (rem) is only for the follow-up.
  var SOON_DAYS = 90;
  function ctrState(c, today, x) {
    if (x && x.end) return "term";
    if (c.to && c.to < today) return "ended";
    if (c.to && dayDiff(today, c.to) <= SOON_DAYS) return "soon";
    return "on";
  }

  // ---------- Contract follow-through (1.10, CTR-ALL) ----------
  // cx?: [{ id = contract id, m, ti?: the Publishing title id, fmt?:
  //   "p" (print) | "e" (digital), end?: the day it was ended by
  //   agreement, h?: [{ d, k, v?, p?, n? }] what was done: k "renew"
  //   (v = the new end, p = the old one) | "post" (decision put off to
  //   v) | "end" | "reopen" | "note" | "mail" | "call" | "task" }].
  // Its own list like rsl, so a device before 1.10 can't strip it from
  // the ctr rows (normCtr drops fields it does not know); a row whose
  // contract is gone leaves with it.
  var CX_KINDS = ["renew", "post", "end", "reopen", "note", "mail", "call", "task"];
  var TI_RE = /^[A-Za-z0-9_-]{1,40}$/;
  var CX_HIST = 50;
  function normHist(v) {
    var out = [];
    if (Array.isArray(v)) v.forEach(function (e) {
      if (!e || typeof e !== "object" || !isYmd(e.d) || CX_KINDS.indexOf(e.k) < 0) return;
      var o = { d: e.d, k: e.k };
      if (isYmd(e.v)) o.v = e.v;
      if (isYmd(e.p)) o.p = e.p;
      put(o, "n", cleanText(e.n, 300));
      out.push(o);
    });
    out.sort(function (a, b) { return cmpStr(a.d, b.d) || cmpStr(canon(a), canon(b)); });
    return out.slice(-CX_HIST);
  }
  function normCx(x) {
    if (!x || typeof x !== "object" || !ID_RE.test(x.id) || !stamp(x)) return null;
    var o = { id: x.id, m: x.m };
    if (typeof x.ti === "string" && TI_RE.test(x.ti)) o.ti = x.ti;
    if (x.fmt === "p" || x.fmt === "e") o.fmt = x.fmt;
    if (isYmd(x.end)) o.end = x.end;
    var h = normHist(x.h);
    if (h.length) o.h = h;
    return o;
  }
  function cxOf(data, ctrId) { return (data && byId(data.cx, ctrId)) || null; }
  // The cx row to save: the stored one (or a new one) with the patch
  // (a key set to "" or null leaves) and, when given, one more history
  // entry. m is set by the caller's write.
  function cxRow(data, ctrId, patch, entry) {
    var o = own(cxOf(data, ctrId) || { id: ctrId, m: 0 });
    Object.keys(patch || {}).forEach(function (k) {
      if (k === "id" || k === "m" || k === "h") return;
      if (patch[k] === "" || patch[k] === null || patch[k] === undefined) delete o[k]; else o[k] = patch[k];
    });
    if (entry) { o.h = normHist((o.h || []).concat([entry])); if (!o.h.length) delete o.h; }
    return normCx(Object.assign({}, o, { m: o.m || 1 })) ? o : null;
  }
  // "«Title» (Print)" → the format and the book's own name
  var FMT_WORDS = { p: ["εντυπο", "εντυπη", "print", "printed", "paperback", "hardback"], e: ["ψηφιακο", "ψηφιακη", "ebook", "e-book", "digital", "audiobook"] };
  function ctrFmt(data, c) {
    var x = cxOf(data, c.id);
    if (x && x.fmt) return x.fmt;
    var m = /\(([^()]*)\)\s*$/.exec(fold(c.t));
    if (!m) return "";
    var w = m[1].trim();
    if (FMT_WORDS.p.indexOf(w) >= 0) return "p";
    if (FMT_WORDS.e.indexOf(w) >= 0) return "e";
    return "";
  }
  function ctrBook(c) {
    return cleanText(String(c.t || "").replace(/\s*\([^()]*\)\s*$/, "").replace(/[«»"“”„]/g, ""), 120);
  }
  // Add whole years to a day (29 Feb → 28 Feb when the year has none)
  function addYears(ymd, n) {
    if (!isYmd(ymd) || !isInt(n)) return "";
    var y = +ymd.slice(0, 4) + n, md = ymd.slice(4);
    var out = y + md;
    return isYmd(out) ? out : y + "-02-28";
  }
  // The open follow-up a contract's end is remembered by: a fixed id
  // per contract, so two devices that add it at once add the same row.
  function ctrFupId(ctrId) { return ("r" + ctrId).slice(0, 40); }
  // The last "put off" day still to come ("" when none)
  function ctrSnooze(x, today) {
    var d = "";
    ((x && x.h) || []).forEach(function (e) { if (e.k === "post" && e.v && e.v > today && e.v > d) d = e.v; });
    return d;
  }
  // The day the follow-up is due: the reminder day, or a later "put
  // off" day; never in the past while the contract runs. "" = none.
  function ctrFupDay(c, x, today) {
    if (x && x.end) return "";
    var snz = ctrSnooze(x, today);
    if (snz) return snz;
    if (!c.to || c.to < today) return "";
    var d = ctrRemindDay(c);
    return d < today ? today : d;
  }
  // Everything the other apps show about one contract
  function ctrInfo(data, c, today) {
    var x = cxOf(data, c.id), st = ctrState(c, today, x), snz = ctrSnooze(x, today);
    var cu = byId(data.cust, c.cust);
    return {
      ctr: c, x: x, st: st, fmt: ctrFmt(data, c), book: ctrBook(c), cust: cu, who: cu ? custName(cu) : "",
      days: c.to ? dayDiff(today, c.to) : null, snooze: snz, perp: rtPerp(data, c),
      needs: (st === "soon" || st === "ended") && !snz && !rtPerp(data, c),
      hist: x && x.h ? x.h.slice() : []
    };
  }
  // Every contract, those that need a decision first (by end day),
  // then the running ones, then the ended by agreement.
  var ST_ORDER = { ended: 0, soon: 0, on: 1, term: 2 };
  function ctrAll(data, today, filter) {
    var custs = {};
    data.cust.forEach(function (c) { custs[c.id] = 1; });
    return (data.ctr || []).filter(function (c) { return custs[c.cust]; }).map(function (c) { return ctrInfo(data, c, today); })
      .filter(function (r) {
        if (filter === "needs") return r.needs;
        if (filter === "soon") return r.st === "soon";
        if (filter === "ended") return r.st === "ended";
        if (filter === "term") return r.st === "term";
        return true;
      })
      .sort(function (a, b) {
        var oa = a.needs ? -1 : ST_ORDER[a.st], ob = b.needs ? -1 : ST_ORDER[b.st];
        return oa - ob || cmpStr(a.ctr.to || "9999", b.ctr.to || "9999") || cmpStr(fold(a.ctr.t), fold(b.ctr.t)) || cmpStr(a.ctr.id, b.ctr.id);
      });
  }
  // Counts for the Dashboard: running (on + soon), need a decision (and
  // of those, ended / ending soon), ended, ended by agreement, and the next end day still
  // ahead (today included) of a contract that is not ended by agreement.
  function ctrDash(data, today) {
    var all = ctrAll(data, today), s = { n: all.length, on: 0, needs: 0, needEnded: 0, needSoon: 0, ended: 0, term: 0, next: null };
    all.forEach(function (r) {
      if (r.st === "on" || r.st === "soon") s.on++;
      if (r.st === "ended") s.ended++;
      if (r.st === "term") s.term++;
      if (r.needs) { s.needs++; if (r.st === "ended") s.needEnded++; else s.needSoon++; }
      if (r.st !== "term" && r.ctr.to && r.ctr.to >= today && (!s.next || r.ctr.to < s.next.ctr.to)) s.next = r;
    });
    return s;
  }
  // Publishing titles ({ id, t, ppl: [{ n }] }) → the title a contract
  // is about: its own link, else the one title with the same name
  // (folded; by the partner's Publishing name when several have it).
  function ctrTitle(data, c, titles) {
    var x = cxOf(data, c.id), list = Array.isArray(titles) ? titles : [];
    if (x && x.ti) { for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === x.ti) return list[i]; return null; }
    var b = fold(ctrBook(c)).replace(/\s+/g, " ").trim();
    if (!b) return null;
    var hits = list.filter(function (tt) { return tt && fold(tt.t).replace(/[«»"“”„]/g, "").replace(/\s+/g, " ").trim() === b; });
    if (hits.length === 1) return hits[0];
    var cu = byId(data.cust, c.cust), names = cu ? linksOf(data, cu, "pub").map(function (l) { return l.v; }) : [];
    if (cu) names.push(pubKey(cu.name));
    hits = hits.filter(function (tt) { return (tt.ppl || []).some(function (p) { return names.indexOf(pubKey(p.n)) >= 0; }); });
    return hits.length === 1 ? hits[0] : null;
  }
  // One title's contracts (Publishing, Kanban): [ctrInfo], print first
  function fmtRank(f) { return f === "p" ? 0 : (f === "e" ? 1 : 2); }
  function ctrForTitle(data, title, titles, today) {
    if (!title) return [];
    return (data.ctr || []).filter(function (c) {
      var hit = ctrTitle(data, c, titles);
      return hit && hit.id === title.id && byId(data.cust, c.cust);
    }).map(function (c) { return ctrInfo(data, c, today); }).sort(function (a, b) {
      return fmtRank(a.fmt) - fmtRank(b.fmt) || cmpStr(a.ctr.to || "9999", b.ctr.to || "9999") || cmpStr(a.ctr.id, b.ctr.id);
    });
  }
  // ---------- Rights per contract (1.11, RIGHTS) ----------
  // rt?: [{ id = contract id, m,
  //   tpl?: "A" | "B" | "C" | "D" (the contract's template),
  //   grant?: "all" (every economic right) | "excl" (an exclusive
  //     licence) | "free" (free digital posting only),
  //   cov?: ["p"] | ["e"] | ["p", "e"] the formats the contract covers
  //     (print, digital); absent = the contract's own format (ctrFmt),
  //   r?: { <right>: { s: RT_STATUS, sh?: "10%" | "50/50" … } } one
  //     entry per right in RT_RIGHTS; absent = what the grant implies,
  //   ter?: "gr" (Greece) | "none" (not set by the contract),
  //   ext?: "agree" (extension by mutual agreement) | "none",
  //   so?: months the stock may still be sold after the end (1-36),
  //   cd?: days within which sales stop after the end (1-365),
  //   cc?: true (released under CC BY-NC-SA), ccp?: true (for ever),
  //   rev?: true (rights return when out of print and not reprinted),
  //   src?: "pdf" | "oral" | "lost" (where the terms come from),
  //   chk?: the day the terms were last checked, note? }].
  // Its own list like cx, so a device before 1.11 can't strip it from
  // the ctr rows; ended by agreement stays cx.end (no second field).
  var RT_RIGHTS = ["print", "ebook", "audio", "transl", "adapt", "merch", "free", "promo"];
  var RT_STATUS = ["granted", "consent", "free", "none"];
  var RT_TPL = ["A", "B", "C", "D"], RT_GRANT = ["all", "excl", "free"], RT_SRC = ["pdf", "oral", "lost"];
  var SHARE_RE = /^[0-9][0-9.,/% ]{0,15}$/;
  function rtCov(v) {
    if (!Array.isArray(v)) return null;
    var o = [];
    if (v.indexOf("p") >= 0) o.push("p");
    if (v.indexOf("e") >= 0) o.push("e");
    return o.length ? o : null;
  }
  function normRt(x) {
    if (!x || typeof x !== "object" || !ID_RE.test(x.id) || !stamp(x)) return null;
    var o = { id: x.id, m: x.m };
    if (RT_TPL.indexOf(x.tpl) >= 0) o.tpl = x.tpl;
    if (RT_GRANT.indexOf(x.grant) >= 0) o.grant = x.grant;
    var cov = rtCov(x.cov);
    if (cov) o.cov = cov;
    if (x.r && typeof x.r === "object" && !Array.isArray(x.r)) {
      var r = {};
      RT_RIGHTS.forEach(function (k) {
        var e = x.r[k];
        if (!e || typeof e !== "object" || RT_STATUS.indexOf(e.s) < 0) return;
        var one = { s: e.s };
        var sh = cleanText(e.sh, 16);
        if (sh && SHARE_RE.test(sh)) one.sh = sh;
        r[k] = one;
      });
      if (Object.keys(r).length) o.r = r;
    }
    if (x.ter === "gr" || x.ter === "none") o.ter = x.ter;
    if (x.ext === "agree" || x.ext === "none") o.ext = x.ext;
    if (isInt(x.so) && x.so >= 1 && x.so <= 36) o.so = x.so;
    if (isInt(x.cd) && x.cd >= 1 && x.cd <= 365) o.cd = x.cd;
    if (x.cc === true) o.cc = true;
    if (x.ccp === true) o.ccp = true;
    if (x.rev === true) o.rev = true;
    if (RT_SRC.indexOf(x.src) >= 0) o.src = x.src;
    if (isYmd(x.chk)) o.chk = x.chk;
    put(o, "note", str(x, "note", 500, true));
    return o;
  }
  function rtOf(data, ctrId) { return (data && byId(data.rt, ctrId)) || null; }
  // What one right is for a contract: its own entry, else what the
  // grant implies (print and e-book, where the contract covers that
  // format, for every economic right or an exclusive licence; only
  // free posting for "free"); "" = not known.
  function rtStatus(data, c, k) {
    var x = rtOf(data, c.id);
    if (!x) return "";
    if (x.r && x.r[k]) return x.r[k].s;
    if (x.grant === "free") return k === "free" || k === "ebook" ? "free" : "none";
    if ((x.grant === "all" || x.grant === "excl") && (k === "print" || k === "ebook")) {
      return rtCovers(data, c).indexOf(k === "print" ? "p" : "e") >= 0 ? "granted" : "none";
    }
    return "";
  }
  // The formats a contract covers: its own cov, else its format
  function rtCovers(data, c) {
    var x = rtOf(data, c.id);
    if (x && x.cov) return x.cov.slice();
    var f = ctrFmt(data, c);
    return f ? [f] : [];
  }
  // The Gate's words (orOS Gate change_item "rights" on a contract) →
  // the rt row to save: the stored one with the given keys changed (a
  // key set to null leaves; rights merge right by right, a right set
  // to null leaves). → { row } | { err }. m is set by the caller.
  // each Gate word → the field(s) it sets (null clears them)
  var RT_ARGS = { template: "tpl", grant: "grant", covers: "cov", per_right: "r", territory: "ter", extend: "ext", sell_off_months: "so",
                  cease_days: "cd", cc: "cc", cc_perpetual: "ccp", reversion_oop: "rev", source: "src", checked: "chk", note: "note" };
  var RT_WORDS = {
    grant: { all_economic: "all", exclusive_licence: "excl", free_posting_only: "free" },
    covers: { print: "p", digital: "e" },
    per_right: { print: "print", ebook: "ebook", audio: "audio", translation: "transl", adaptation: "adapt", merch: "merch", free_posting: "free", excerpts: "promo" },
    status: { granted: "granted", consent: "consent", free_only: "free", not_mentioned: "none" },
    territory: { greece: "gr", not_set: "none" }, extend: { by_agreement: "agree", not_mentioned: "none" }
  };
  function rtWord(map, v, what) {
    if (typeof v === "string" && Object.prototype.hasOwnProperty.call(map, v)) return map[v];
    return { err: what + " must be one of: " + Object.keys(map).join(", ") + "." };
  }
  function rtRow(data, ctrId, args) {
    if (!args || typeof args !== "object" || Array.isArray(args)) return { err: "rights must be an object." };
    if (!byId(data.ctr, ctrId)) return { err: "That contract is no longer in CRM." };
    var bad = Object.keys(args).filter(function (k) { return !RT_ARGS[k]; });
    if (bad.length) return { err: "rights has no " + bad.join(", ") + ". Its keys: " + Object.keys(RT_ARGS).join(", ") + "." };
    var o = own(rtOf(data, ctrId) || { id: ctrId, m: 0 });
    o.r = own(o.r);
    var err = "";
    function set(k, v) { if (v === null || v === undefined) delete o[k]; else o[k] = v; }
    function word(map, v, what) { var w = rtWord(map, v, what); if (typeof w === "object") { err = err || w.err; return undefined; } return w; }
    Object.keys(args).forEach(function (k) {
      var v = args[k];
      if (err) return;
      if (v === null) { if (k === "per_right") o.r = {}; else delete o[RT_ARGS[k]]; return; }
      if (k === "template") { if (RT_TPL.indexOf(v) < 0) err = "template must be A, B, C or D."; else set("tpl", v); }
      else if (k === "grant") set("grant", word(RT_WORDS.grant, v, "grant"));
      else if (k === "covers") {
        if (!Array.isArray(v) || !v.length) { err = "covers must be a list: print and/or digital."; return; }
        var cv = v.map(function (w) { return word(RT_WORDS.covers, w, "covers"); });
        if (!err) set("cov", rtCov(cv));
      } else if (k === "per_right") {
        if (!v || typeof v !== "object" || Array.isArray(v)) { err = "per_right must be an object { print: { status, share } … }."; return; }
        Object.keys(v).forEach(function (rk) {
          if (err) return;
          var key = word(RT_WORDS.per_right, rk, "a right in per_right");
          if (err) return;
          var e = v[rk];
          if (e === null) { delete o.r[key]; return; }
          if (typeof e === "string") e = { status: e };
          if (!e || typeof e !== "object") { err = "per_right." + rk + " must be { status, share }."; return; }
          var st = word(RT_WORDS.status, e.status, "per_right." + rk + ".status");
          if (err) return;
          var one = { s: st };
          if (e.share !== undefined && e.share !== null && e.share !== "") {
            var sh = cleanText(e.share, 16);
            if (!SHARE_RE.test(sh)) { err = "per_right." + rk + ".share must be like 10%, 50/50 or 70/30."; return; }
            one.sh = sh;
          }
          o.r[key] = one;
        });
      } else if (k === "territory") set("ter", word(RT_WORDS.territory, v, "territory"));
      else if (k === "extend") set("ext", word(RT_WORDS.extend, v, "extend"));
      else if (k === "sell_off_months") { if (!isInt(v) || v < 0 || v > 36) err = "sell_off_months must be a whole number 0-36 (0 = none)."; else set("so", v || null); }
      else if (k === "cease_days") { if (!isInt(v) || v < 0 || v > 365) err = "cease_days must be a whole number 0-365 (0 = none)."; else set("cd", v || null); }
      else if (k === "cc" || k === "cc_perpetual" || k === "reversion_oop") {
        if (typeof v !== "boolean") err = k + " must be true or false.";
        else set({ cc: "cc", cc_perpetual: "ccp", reversion_oop: "rev" }[k], v || null);
      } else if (k === "source") { if (RT_SRC.indexOf(v) < 0) err = "source must be pdf, oral or lost."; else set("src", v); }
      else if (k === "checked") { if (!isYmd(v)) err = "checked must be a day YYYY-MM-DD."; else set("chk", v); }
      else if (k === "note") { if (typeof v !== "string") err = "note must be text."; else set("note", cleanText(v, 500, true) || null); }
    });
    if (err) return { err: err };
    if (!Object.keys(o.r).length) delete o.r;
    var row = normRt(Object.assign({}, o, { m: o.m || 1 }));
    if (!row) return { err: "Those rights can't be kept." };
    row.m = o.m;
    return { row: row };
  }
  // A digital-only contract released under a perpetual CC licence
  // (Chris 2026-11-18: digital editions run for ever under their
  // licence, the contract's end does not apply to them): its end needs
  // no decision and its digital formats stay allowed.
  function rtPerp(data, c) {
    var x = rtOf(data, c.id);
    if (!x || !x.cc || !x.ccp) return false;
    var cov = rtCovers(data, c);
    return cov.length === 1 && cov[0] === "e";
  }
  // Publishing formats → print / digital / audio
  var PUB_KIND = { pb: "p", hb: "p", eb: "e", ab: "a" };
  // May a contract sell format f (p | e | a) on this day, paid or free?
  // A running contract that covers it, or (print only) one in its
  // sell-off months after the end.
  function rtAllows(data, r, f, paid, today) {
    var c = r.ctr, x = rtOf(data, c.id), cov = rtCovers(data, c);
    var on = r.st === "on" || r.st === "soon";
    // a digital edition under a perpetual CC licence outlives the contract (not an ended-by-agreement one)
    if (!on && f !== "p" && r.st === "ended" && x && x.cc && x.ccp) on = true;
    if (!on && f === "p" && r.st === "ended" && x && x.so && c.to && today <= addMonths(c.to, x.so)) on = true;
    if (!on) return false;
    if (f === "a") {
      var sa = rtStatus(data, c, "audio");
      return sa === "granted" || (!paid && (sa === "free" || sa === "consent"));
    }
    if (cov.indexOf(f) < 0) return false;
    var s = rtStatus(data, c, f === "p" ? "print" : "ebook");
    if (s === "") s = "granted";   // terms not filled in yet: its format is enough
    return s === "granted" || (!paid && (s === "free" || s === "consent"));
  }
  function addMonths(ymd, n) {
    var y = +ymd.slice(0, 4), mo = +ymd.slice(5, 7) - 1 + n, d = +ymd.slice(8, 10);
    y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return y + "-" + (mo < 9 ? "0" : "") + (mo + 1) + "-" + (Math.min(d, last) < 10 ? "0" : "") + Math.min(d, last);
  }
  // The Rights view (Contracts tab): every Publishing title with a
  // contract, and the three flags. titles = Publishing's titles ({ id,
  // t, ppl, fmts: [{ k, price, wp? }] }); a format "in the shop" is one
  // linked to a shop product (wp), "paid" when its price is above 0.
  // → { titles: [{ ti, t, list: [ctrInfo], best: { right: status } }],
  //     sold: [{ ti, t, f, price, ctr? }] (in the shop with no running
  //       right; ctr = the contract that last covered it),
  //     freeCc: [same] (free, no running right, released under CC),
  //     unreleased: [{ ti, t, f: "e" | "a", ctr }] (a running right,
  //       no such format in Publishing),
  //     renew: [{ info: ctrInfo, so, ext }] (ending within SOON_DAYS),
  //     unlinked: n (contracts with no Publishing title),
  //     unfilled: n (contracts without rights recorded) }
  var RT_RANK = { granted: 0, consent: 1, free: 2, none: 3, "": 4 };
  function rightsBoard(data, today, titles) {
    var list = Array.isArray(titles) ? titles : [], groups = {}, order = [];
    var out = { titles: [], sold: [], freeCc: [], unreleased: [], renew: [], unlinked: 0, unfilled: 0 };
    (data.ctr || []).forEach(function (c) {
      if (!byId(data.cust, c.cust)) return;
      var info = ctrInfo(data, c, today);
      var xr = rtOf(data, c.id);
      if (!xr || Object.keys(xr).length <= 2) out.unfilled++;   // none, or emptied by an Undo
      if (info.st === "soon" && !info.perp) { var x = rtOf(data, c.id); out.renew.push({ info: info, so: x && x.so ? x.so : 0, ext: x && x.ext ? x.ext : "" }); }
      var tt = ctrTitle(data, c, list);
      if (!tt) { out.unlinked++; return; }
      if (!groups[tt.id]) { groups[tt.id] = { tt: tt, list: [] }; order.push(tt.id); }
      groups[tt.id].list.push(info);
    });
    out.renew.sort(function (a, b) { return cmpStr(a.info.ctr.to, b.info.ctr.to) || cmpStr(a.info.ctr.id, b.info.ctr.id); });
    order.forEach(function (id) {
      var g = groups[id], tt = g.tt, name = cleanText(tt.t, 200);
      g.list.sort(function (a, b) { return fmtRank(a.fmt) - fmtRank(b.fmt) || cmpStr(a.ctr.to || "9999", b.ctr.to || "9999") || cmpStr(a.ctr.id, b.ctr.id); });
      var best = {};
      RT_RIGHTS.forEach(function (k) {
        var b = "";
        g.list.forEach(function (r) {
          if (r.st !== "on" && r.st !== "soon") return;
          var s = rtStatus(data, r.ctr, k);
          if (RT_RANK[s] < RT_RANK[b]) b = s;
        });
        best[k] = b;
      });
      out.titles.push({ ti: id, t: name, list: g.list, best: best });
      var fmts = Array.isArray(tt.fmts) ? tt.fmts : [], kinds = {};
      fmts.forEach(function (fm) {
        var f = fm && PUB_KIND[fm.k];
        if (!f) return;
        kinds[f] = 1;
        if (!fm.wp) return;
        var price = typeof fm.price === "number" && fm.price > 0 ? fm.price : 0;
        if (g.list.some(function (r) { return rtAllows(data, r, f, price > 0, today); })) return;
        // the contract it was last sold under: the one that covers it, else the title's latest
        var last = null;
        g.list.forEach(function (r) {
          var fits = f === "a" ? !!rtStatus(data, r.ctr, "audio") : rtCovers(data, r.ctr).indexOf(f) >= 0;
          if (fits && (!last || cmpStr(r.ctr.to || "", last.ctr.to || "") > 0)) last = r;
        });
        var cc = g.list.some(function (r) { var x = rtOf(data, r.ctr.id); return x && x.cc; });
        var row = { ti: id, t: name, f: f, price: price, wp: fm.wp.id || 0, ctr: last ? last.ctr.id : "" };
        if (!price && cc) out.freeCc.push(row); else out.sold.push(row);
      });
      ["e", "a"].forEach(function (f) {
        if (kinds[f]) return;
        var hit = null;
        g.list.forEach(function (r) {
          if (hit || (r.st !== "on" && r.st !== "soon")) return;
          var s = rtStatus(data, r.ctr, f === "e" ? "ebook" : "audio");
          if (s === "granted" && (f === "a" || rtCovers(data, r.ctr).indexOf("e") >= 0)) hit = r;
        });
        if (hit) out.unreleased.push({ ti: id, t: name, f: f, ctr: hit.ctr.id });
      });
    });
    function byT(a, b) { return cmpStr(fold(a.t), fold(b.t)) || cmpStr(a.ti, b.ti) || cmpStr(a.f || "", b.f || ""); }
    out.titles.sort(byT); out.sold.sort(byT); out.freeCc.sort(byT); out.unreleased.sort(byT);
    return out;
  }
  // Contracts whose follow-up is missing (made by the Assistant or
  // orOS Gate before 1.10, or done/removed while the contract still
  // runs): [{ ctr, fup: id, d }] for the app to write.
  function ctrHeal(data, today) {
    var out = [];
    (data.ctr || []).forEach(function (c) {
      if (!byId(data.cust, c.cust) || rtPerp(data, c)) return;
      var x = cxOf(data, c.id), d = ctrFupDay(c, x, today);
      if (!d) return;
      var f = c.fup ? byId(data.fups, c.fup) : null;
      if (f && !f.done) return;
      if (f && f.done && !ctrSnooze(x, today)) return;   // done for this end: a new end makes a new one
      var id = ctrFupId(c.id);
      if (f && f.id === id) id = ctrFupId(c.id + "b");
      var own2 = byId(data.fups, id);
      if (own2 && !own2.done) return;
      out.push({ ctr: c, fup: id, d: d });
    });
    return out;
  }
  // Calendar: the contracts that end on ymd (not the ended by agreement)
  function ctrEndsOn(data, ymd) {
    return (data.ctr || []).filter(function (c) {
      var x = cxOf(data, c.id);
      return c.to === ymd && !(x && x.end) && byId(data.cust, c.cust);
    }).sort(function (a, b) { return cmpStr(fold(a.t), fold(b.t)) || cmpStr(a.id, b.id); });
  }
  // Revenue Splitter 1.14 (POST /rs/contracts): every contract with an
  // end, under the partner's Revenue Splitter name (its first linked
  // one, else the partner's name). No note, value or file ever leaves.
  var PORTAL_STATE = { on: "on", soon: "soon", ended: "ended", term: "ended_by_agreement" };
  // RS-CTR (Revenue Splitter 1.14 hand-off): only contracts of partners
  // linked to a beneficiary (ben = that exact name, never the CRM name,
  // which the shop would skip as unknown_beneficiary), with a start day
  // (the shop refuses "" as bad_date), open-ended ones too (to = "",
  // the site shows «Αορίστου»). With shopId: only the partners linked
  // to that shop (a link without a shop counts for firstShopId).
  // → { body: { v, sent, contracts }, left: [{ id, t, cust, why:
  // "nolink" | "nofrom" }] }; portalPayload(data, today) = all shops' body.
  function portalPlan(data, today, shopId, firstShopId) {
    var list = [], left = [];
    ctrAll(data, today).forEach(function (r) {
      if (!r.cust) return;
      var rs = rsOf(data, r.cust);
      if (!rs || !rs.n.length) { left.push({ id: r.ctr.id, t: r.ctr.t, cust: r.cust.id, why: "nolink" }); return; }
      if (shopId && (rs.a || firstShopId || "") !== shopId) return;
      if (!r.ctr.from) { left.push({ id: r.ctr.id, t: r.ctr.t, cust: r.cust.id, why: "nofrom" }); return; }
      if (list.length >= 2000) return;
      var title = cleanText(String(r.book || r.ctr.t).replace(/[<>]+/g, " "), 200) || cleanText(String(r.ctr.t).replace(/[<>]+/g, " "), 200) || r.ctr.id;
      list.push({ id: r.ctr.id, ben: rs.n[0], title: title,
                fmt: r.fmt === "p" ? "print" : (r.fmt === "e" ? "ebook" : ""), from: r.ctr.from, to: r.ctr.to || "",
                state: PORTAL_STATE[r.st], renewed: r.hist.filter(function (e) { return e.k === "renew" && e.p; }).map(function (e) { return e.p; }).slice(-50),
                // Revenue Splitter 1.14.2: the day of each renewal, the end before it, the new end
                renewals: r.hist.filter(function (e) { return e.k === "renew" && YMD_RE.test(e.d || "") && YMD_RE.test(e.p || "") && YMD_RE.test(e.v || ""); })
                  .map(function (e) { return { on: e.d, prev_to: e.p, to: e.v }; }).slice(-50) });
    });
    list.sort(function (a, b) { return cmpStr(a.id, b.id); });
    left.sort(function (a, b) { return cmpStr(a.id, b.id); });
    return { body: { v: 1, sent: today, contracts: list }, left: left };
  }
  function portalPayload(data, today) { return portalPlan(data, today).body; }
  // Contract settings (1.10): cset { m, lbl?, kb? }: lbl = the Calendar
  // label the end days show under (absent = CRM's own feed chip), kb =
  // the Kanban board a contract card goes to (absent = the open one).
  // One record, last writer wins.
  function normCset(x) {
    if (!x || typeof x !== "object" || !stamp(x)) return null;
    var o = { m: x.m };
    if (typeof x.lbl === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(x.lbl)) o.lbl = x.lbl;
    put(o, "kb", cleanText(x.kb, 60));
    // RS-PROD (Author Portal production stage): the Kanban board's name,
    // the person's column → phase map over the built-in one (crm/prod.js,
    // folded names, 0 = no phase of its own), and the cards chosen to go
    put(o, "pb", cleanText(x.pb, 60));
    if (x.pm && typeof x.pm === "object" && !Array.isArray(x.pm)) {
      var pm = {}, n = 0;
      Object.keys(x.pm).sort().forEach(function (k) {
        var v = x.pm[k];
        if (n >= 300 || typeof k !== "string" || !k || k.length > 80 || /[\u0000-\u001f]/.test(k)) return;
        if (typeof v !== "number" || Math.floor(v) !== v || v < 0 || v > 7) return;
        pm[k] = v;
        n++;
      });
      if (n) o.pm = pm;
    }
    if (Array.isArray(x.pc)) {
      var seen = {}, pc = x.pc.filter(function (id) {
        if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || seen[id]) return false;
        seen[id] = 1;
        return true;
      }).sort().slice(0, 1000);
      if (pc.length) o.pc = pc;
    }
    return o;
  }

  // What a partner owes you and what you owe them in Invoices (partner
  // card W5: search, Contacts, the Assistant): the Overview's numbers
  // without royalties. I = OrosInvoicesCore, inv = its data (I.parse).
  // → { in: { CUR: { open, overdue } }, out: { CUR: { open, overdue } } }
  function balance(data, c, I, inv, today) {
    var out = { "in": {}, out: {} };
    if (!c || !I || !inv || typeof I.byCrm !== "function") return out;
    function take(tt, side) {
      Object.keys(tt || {}).forEach(function (cur) {
        if (tt[cur].open > 0) side[cur] = { open: tt[cur].open, overdue: tt[cur].overdue || 0 };
      });
    }
    take(I.byCrm(inv, c.id, today, linksOf(data, c, "inv").map(function (x) { return x.v; })).totals, out["in"]);
    if (typeof I.billsByCrm === "function") take(I.billsByCrm(inv, c.id, today, c.afm || "").totals, out.out);
    return out;
  }

  // ---------- Contacts sync rows (1.8, CT-CRM) ----------
  // One row per customer that has a linked contact (its id IS the
  // customer id). For a person: the contact it is synced with (c),
  // when that pair started (t) and, per mapped field, the value and
  // stamp CRM last agreed on (f). For a company: its name (n) and
  // earlier names (o), so a contact whose company was renamed follows.
  // Its own list, like pt: a 1.7 device drops it on its own merge and
  // the union of the next merge brings it back.
  var CS_FIELDS = { name: 120, phone: 40, email: 120, web: 300, job: 80, addr: 200, country: 60 };
  function normCs(x) {
    if (!x || typeof x !== "object" || !ID_RE.test(x.id) || !stamp(x)) return null;
    var o = { id: x.id, m: x.m };
    if (typeof x.c === "string" && CREF_RE.test(x.c) && isInt(x.t) && x.t > 0) {
      o.c = x.c;
      o.t = x.t;
      var f = {}, any = false;
      if (x.f && typeof x.f === "object") Object.keys(CS_FIELDS).forEach(function (k) {
        var r = x.f[k];
        if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== "string" || !isInt(r[1]) || r[1] < -1) return;
        f[k] = [cleanText(r[0], CS_FIELDS[k]), r[1]];
        any = true;
      });
      if (any) o.f = f;
    }
    var n = cleanText(x.n, 120);
    if (n) {
      o.n = n;
      var old = [];
      if (Array.isArray(x.o)) x.o.forEach(function (v) {
        var s = cleanText(v, 120);
        if (s && s !== n && old.indexOf(s) < 0) old.push(s);
      });
      old.sort(cmpStr);
      if (old.length) o.o = old.slice(0, LIMITS.csOld);
    }
    return o;
  }
  // Two copies of one row → one, field by field (symmetric).
  function csJoin(a, b) {
    if (!a) return b;
    if (!b) return a;
    var hi = b.m > a.m || (b.m === a.m && canon(b) > canon(a)) ? b : a, lo = hi === a ? b : a;
    var o = { id: hi.id, m: hi.m };
    if (hi.c) {
      o.c = hi.c;
      o.t = lo.c === hi.c ? Math.min(lo.t, hi.t) : hi.t;
      var f = {};
      Object.keys(CS_FIELDS).forEach(function (k) {
        var x = hi.f && hi.f[k], y = lo.c === hi.c && lo.f ? lo.f[k] : null;
        var w = !x ? y : (!y ? x : (y[1] > x[1] || (y[1] === x[1] && canon(y) > canon(x)) ? y : x));
        if (w) f[k] = w.slice();
      });
      if (Object.keys(f).length) o.f = f;
    }
    var n = hi.n || lo.n;
    if (n) {
      o.n = n;
      var old = [];
      [hi.n, lo.n].concat(hi.o || [], lo.o || []).forEach(function (s) {
        if (s && s !== n && old.indexOf(s) < 0) old.push(s);
      });
      old.sort(cmpStr);
      if (old.length) o.o = old.slice(0, LIMITS.csOld);
    }
    return o;
  }

  var LISTS = { cust: normCust, deals: normDeal, acts: normAct, fups: normFup, tags: normTag, stg: normStg, pt: normPt, ctr: normCtr, cx: normCx, rt: normRt, rsl: normRsl, cs: normCs, ix: normIx };

  // The web form (crm/webform.js, relay /crm/f/<k>): one record, last
  // writer wins by m. { m, k, sec, priv (RSA-OAEP-256 private JWK),
  // back?, dev?, at? } while it is on; { m, off: 1 } once turned off (so
  // "off" also reaches the other devices). The keys guard only the
  // messages that become this CRM's own data, so they sync with it
  // (as Newsletter's list forms do). dev = the device that collects.
  // Absent until a form is made: older data keeps its bytes.
  var JWK_PARTS = ["n", "e", "d", "p", "q", "dp", "dq", "qi"];
  function normWf(x) {
    if (!x || typeof x !== "object" || !stamp(x)) return null;
    if (x.off === 1 || x.off === true) return { m: x.m, off: 1 };
    if (typeof x.k !== "string" || !/^[a-z0-9]{16}$/.test(x.k)) return null;
    if (typeof x.sec !== "string" || !/^[A-Za-z0-9]{32}$/.test(x.sec)) return null;
    var j = x.priv;
    if (!j || typeof j !== "object" || j.kty !== "RSA") return null;
    var priv = { kty: "RSA", alg: "RSA-OAEP-256" };
    for (var i = 0; i < JWK_PARTS.length; i++) {
      var v = j[JWK_PARTS[i]];
      if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,700}$/.test(v)) return null;
      priv[JWK_PARTS[i]] = v;
    }
    var o = { m: x.m, k: x.k, sec: x.sec, priv: priv };
    var back = typeof x.back === "string" ? x.back.trim() : "";
    if (back.length <= 300 && /^https:\/\/[^\s<>"'@]+$/i.test(back)) o.back = back;
    if (typeof x.dev === "string" && /^[a-z0-9]{6,20}$/.test(x.dev)) o.dev = x.dev;
    if (isInt(x.at) && x.at > 0) o.at = x.at;
    return o;
  }

  function empty() {
    return { ver: DATA_VER, cust: [], deals: [], acts: [], fups: [], tags: [], stg: [], prefs: normPrefs(null), tombs: {} };
  }

  // ---------- Merge (R5 symmetric, R17 tombstones, R26 canonical) ----------
  // Per list: newer m wins; equal m → larger canonical JSON. A tomb at
  // or after a row's m hides it (delete wins ties; a newer edit
  // resurrects). Deals, history and follow-ups of a customer that is
  // not alive drop. Tombs older than TOMB_DAYS before the newest stamp
  // in the data leave (no clock: both devices prune the same way).
  function lww(best, x) {
    var cur = best[x.id];
    if (!cur || x.m > cur.m || (x.m === cur.m && canon(x) > canon(cur))) best[x.id] = x;
  }
  function own(o) {
    var r = {};
    if (o && typeof o === "object") Object.keys(o).forEach(function (k) { r[k] = o[k]; });
    return r;
  }
  function merge(A, B) {
    var a = own(A), b = own(B);
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] <= 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var newest = 0;
    Object.keys(tombs).forEach(function (id) { if (tombs[id] > newest) newest = tombs[id]; });
    var best = {};
    LIST_KEYS.forEach(function (k) {
      best[k] = {};
      [a[k], b[k]].forEach(function (list) {
        if (Array.isArray(list)) list.forEach(function (raw) {
          var x = LISTS[k](raw);
          if (!x) return;
          if (k === "cs") best.cs[x.id] = csJoin(best.cs[x.id], x);
          else lww(best[k], x);
        });
      });
      Object.keys(best[k]).forEach(function (id) { if (best[k][id].m > newest) newest = best[k][id].m; });
    });
    var pa = normPrefs(a.prefs), pb = normPrefs(b.prefs);
    if (pa.pm > newest) newest = pa.pm;
    if (pb.pm > newest) newest = pb.pm;
    var wa = normWf(a.wf), wb = normWf(b.wf);
    var wf = !wa ? wb : (!wb ? wa : (wb.m > wa.m || (wb.m === wa.m && canon(wb) > canon(wa)) ? wb : wa));
    if (wf && wf.m > newest) newest = wf.m;
    var sa = normCset(a.cset), sb = normCset(b.cset);
    var cset = !sa ? sb : (!sb ? sa : (sb.m > sa.m || (sb.m === sa.m && canon(sb) > canon(sa)) ? sb : sa));
    if (cset && cset.m > newest) newest = cset.m;

    var out = { ver: DATA_VER };
    var aliveCust = {}, aliveCtr = {};
    LIST_KEYS.forEach(function (k) {
      var list = [];
      Object.keys(best[k]).sort(cmpStr).forEach(function (id) {
        var x = best[k][id];
        if (id in tombs && tombs[id] >= x.m) return;
        // an emptied pt, rsl or ix row stays: dropping it would let another
        // device's older copy bring the link back
        if (k === "cx" || k === "rt" ? !aliveCtr[x.id] : (k === "pt" || k === "rsl" || k === "cs" || k === "ix" ? !aliveCust[x.id] : (k !== "cust" && k !== "tags" && k !== "stg" && !aliveCust[x.cust]))) return;
        if (list.length >= LIMITS[k]) return;
        list.push(x);
      });
      if ((k !== "pt" && k !== "ctr" && k !== "cx" && k !== "rt" && k !== "rsl" && k !== "cs" && k !== "ix") || list.length) out[k] = list;
      if (k === "cust") list.forEach(function (c) { aliveCust[c.id] = true; });
      if (k === "ctr") list.forEach(function (c) { aliveCtr[c.id] = true; });
    });
    out.prefs = pb.pm > pa.pm || (pb.pm === pa.pm && canon(pb) > canon(pa)) ? pb : pa;
    if (wf) out.wf = wf;
    if (cset) out.cset = cset;
    var sorted = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) {
      if (newest - tombs[id] > TOMB_DAYS * DAY_MS) return;
      sorted[id] = tombs[id];
    });
    out.tombs = sorted;
    return out;
  }
  function norm(raw) { return merge(raw, null); }

  // ---------- Lookups ----------
  function byId(list, id) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function custName(c) { return c ? (c.alias ? c.name + " (" + c.alias + ")" : c.name) : ""; }

  function lastContact(data, custId) {
    var best = 0;
    data.acts.forEach(function (a) { if (a.cust === custId && a.at > best) best = a.at; });
    return best;
  }
  function lastContactMap(data) {
    var m = {};
    data.acts.forEach(function (a) { if (!m[a.cust] || a.at > m[a.cust]) m[a.cust] = a.at; });
    return m;
  }

  // ---------- Stages ----------
  // The board, in order: the open stages (built-ins not hidden + own,
  // by pos, then id), then Won, Lost. Each { id, name ("" → the
  // built-in label), prob, open, own }.
  function stages(data) {
    var rec = {};
    (data.stg || []).forEach(function (r) { rec[r.id] = r; });
    var open = [];
    OPEN_STAGES.forEach(function (id) {
      var r = rec[id] || {};
      if (r.off) return;
      open.push({ id: id, name: r.name || "", prob: isInt(r.prob) ? r.prob : STAGE_PROB[id],
                  pos: isInt(r.pos) ? r.pos : STAGE_POS[id], open: true, own: false });
    });
    (data.stg || []).forEach(function (r) {
      if (OPEN_STAGES.indexOf(r.id) >= 0) return;
      open.push({ id: r.id, name: r.name, prob: isInt(r.prob) ? r.prob : 50,
                  pos: isInt(r.pos) ? r.pos : 1000, open: true, own: true });
    });
    open.sort(function (a, b) { return a.pos - b.pos || cmpStr(a.id, b.id); });
    open = open.slice(0, LIMITS.openStages);
    if (!open.length) open.push({ id: "new", name: "", prob: STAGE_PROB["new"], pos: 10, open: true, own: false });
    return open.concat([{ id: "won", name: "", prob: 100, pos: 0, open: false, own: false },
                        { id: "lost", name: "", prob: 0, pos: 0, open: false, own: false }]);
  }
  // The stage a deal shows in: its own, or (a stage deleted or hidden
  // on another device) the first open stage. Nothing is rewritten.
  function stageOf(data, d, list) {
    var st = list || stages(data);
    for (var i = 0; i < st.length; i++) if (st[i].id === d.stage) return st[i];
    return st[0];
  }
  function dealProb(d, data) {
    if (isInt(d.prob)) return d.prob;
    if (data) return stageOf(data, d).prob;
    return STAGE_PROB[d.stage] !== undefined ? STAGE_PROB[d.stage] : 50;
  }
  function isOpen(d) { return d.stage !== "won" && d.stage !== "lost"; }
  function openDeals(data, custId) {
    return data.deals.filter(function (d) { return isOpen(d) && (!custId || d.cust === custId); });
  }

  function pipeline(data) {
    var out = {}, st = stages(data);
    st.forEach(function (s) { out[s.id] = { n: 0, val: 0, wval: 0 }; });
    data.deals.forEach(function (d) {
      var s = stageOf(data, d, st), r = out[s.id];
      d = isInt(d.prob) ? d : Object.assign({}, d, { prob: s.prob });
      r.n++;
      r.val += d.val;
      r.wval += Math.round(d.val * dealProb(d) / 100);
    });
    return out;
  }

  // Open follow-ups: late (before today), today, soon (next `horizon`
  // days). Sorted by day, then time (untimed first), then id.
  function fupCmp(a, b) {
    return cmpStr(a.d, b.d) || cmpStr(a.t || "", b.t || "") || cmpStr(a.id, b.id);
  }
  function agenda(data, today, horizon) {
    var h = isInt(horizon) ? horizon : 7;
    var end = addDays(today, h);
    var out = { late: [], today: [], soon: [] };
    data.fups.forEach(function (f) {
      if (f.done) return;
      if (f.d < today) out.late.push(f);
      else if (f.d === today) out.today.push(f);
      else if (f.d <= end) out.soon.push(f);
    });
    out.late.sort(fupCmp); out.today.sort(fupCmp); out.soon.sort(fupCmp);
    return out;
  }
  // Reminders: open follow-ups of earlier days, today's untimed ones,
  // and today's timed ones whose time has come.
  function dueNow(data, today, hhmm) {
    return data.fups.filter(function (f) {
      if (f.done) return false;
      if (f.d < today) return true;
      if (f.d > today) return false;
      return !f.t || f.t <= hhmm;
    }).sort(fupCmp);
  }

  function forgotten(data, nowMs, days) {
    var lim = nowMs - (isInt(days) ? days : data.prefs.forget) * DAY_MS;
    var last = lastContactMap(data);
    return data.cust.filter(function (c) {
      if (c.st === "past") return false;
      var t = last[c.id] || c.ct || 0;
      return t > 0 && t < lim;
    }).sort(function (a, b) { return (last[a.id] || a.ct || 0) - (last[b.id] || b.ct || 0) || cmpStr(a.id, b.id); });
  }

  function dashboard(data, nowMs, today) {
    var month = today.slice(0, 7), year = today.slice(0, 4);
    var p = pipeline(data);
    var openVal = 0, openW = 0, openN = 0;
    stages(data).forEach(function (s) { if (s.open) { openVal += p[s.id].val; openW += p[s.id].wval; openN += p[s.id].n; } });
    var wonM = 0, wonY = 0, wonYn = 0, lostYn = 0;
    data.deals.forEach(function (d) {
      if (!d.cd) return;
      if (d.stage === "won") {
        if (d.cd.slice(0, 7) === month) wonM += d.val;
        if (d.cd.slice(0, 4) === year) { wonY += d.val; wonYn++; }
      } else if (d.cd.slice(0, 4) === year) lostYn++;
    });
    var ag = agenda(data, today, 7);
    var monthStart = today.slice(0, 8) + "01";
    var newLeads = data.cust.filter(function (c) {
      return c.st === "lead" && c.ct && ymdOf(c.ct) >= monthStart;
    }).length;
    return {
      openN: openN, openVal: openVal, openW: openW,
      wonMonth: wonM, wonYear: wonY,
      winRate: wonYn + lostYn ? Math.round(wonYn * 100 / (wonYn + lostYn)) : null,
      late: ag.late.length, today: ag.today.length,
      forgotten: forgotten(data, nowMs).length,
      newLeads: newLeads,
      cust: data.cust.length,
      byStatus: CUST_ST.reduce(function (o, s) {
        o[s] = data.cust.filter(function (c) { return c.st === s; }).length;
        return o;
      }, {})
    };
  }

  // ---------- Bridges ----------
  // BR-CRM-INV: what Invoices' "Import from CRM" reads.
  function customersForBilling(data) {
    return data.cust.map(function (c) {
      return { id: c.id, name: c.name, afm: c.afm || "", doy: c.doy || "", job: c.job || "",
               addr: c.addr || "", country: c.country || "", email: c.email || "", phone: c.phone || "" };
    }).sort(function (a, b) { return a.name.localeCompare(b.name) || cmpStr(a.id, b.id); });
  }

  // BR-CRM-MAIL: Mail's "Log in CRM" under a message calls
  // __orosOpenAt("crm", { log: { email, name?, subject?, text?, at? } }).
  // Only a prefill: the log entry is saved by the user.
  var EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/;
  function mailLog(x) {
    if (!x || typeof x !== "object") return null;
    var email = cleanText(x.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) return null;
    return { email: email, name: cleanText(x.name, 120), subject: cleanText(x.subject, 200),
             text: cleanText(x.text, 1800, true), at: isInt(x.at) && x.at > 0 ? x.at : 0 };
  }
  // Assistant entry card: __orosOpenAt("crm", { asNew: { name?,
  // company?, email?, phone?, afm? | vat?, address?, note?, from? } })
  // → the New customer form's prefill, or null (no name, no company).
  // A company makes a company customer named after it; the person's
  // name then rides along as "who" (the form puts it in the notes).
  function asNewCust(x) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    var name = cleanText(x.name, 120), co = cleanText(x.company, 120);
    if (!name && !co) return null;
    var n = { kind: co ? "co" : "person", name: co || name, who: co && name && fold(name) !== fold(co) ? name : "" };
    var email = cleanText(x.email, 120);
    if (EMAIL_RE.test(email)) n.email = email;
    var phone = cleanText(x.phone, 40);
    if (/\d/.test(phone)) n.phone = phone;
    var afm = cleanText(typeof x.afm === "string" ? x.afm : x.vat, 20).replace(/\s+/g, "").toUpperCase();
    if (/^[A-Z0-9.\-]+$/.test(afm)) n.afm = afm;
    var addr = cleanText(x.address, 200);
    if (addr) n.addr = addr;
    var note = cleanText(x.note, 2000, true);
    if (note) n.note = note;
    return n;
  }
  // The customer an address belongs to: its own email, then a person's
  // (emailOf(person) gives a Contacts-linked person's live address).
  function custByEmail(data, email, emailOf) {
    var e = String(email || "").trim().toLowerCase(), i, j;
    if (!e) return null;
    var same = function (v) { return String(v || "").trim().toLowerCase() === e; };
    for (i = 0; i < data.cust.length; i++) if (same(data.cust[i].email)) return data.cust[i];
    for (i = 0; i < data.cust.length; i++) {
      var pp = data.cust[i].people || [];
      for (j = 0; j < pp.length; j++) if (same(emailOf ? emailOf(pp[j]) : pp[j].email)) return data.cust[i];
    }
    return null;
  }

  // BR-EV-2: an Automations "Log it in CRM" step opens
  // __orosOpenAt("crm", { autoLog: { text, k?, who?, from? } }) → the
  // New history entry form prefilled (saved only by the person), or
  // null. autoLogCust picks its customer: the name in who (unique),
  // else the customer an address in the text belongs to, else the one
  // customer whose name (3+ letters) the text names, longest first.
  function autoLog(x) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    var text = cleanText(x.text, 2000, true);
    if (!text) return null;
    return { text: text, k: ACT_KINDS.indexOf(x.k) >= 0 ? x.k : "note", who: cleanText(x.who, 120) };
  }
  function autoLogCust(data, n, emailOf) {
    if (!n || !data || !Array.isArray(data.cust) || !data.cust.length) return null;
    var hits = function (want) {
      var f = fold(want).trim(), found = data.cust.filter(function (c) { return fold(c.name).trim() === f; });
      return found.length === 1 ? found[0] : null;
    };
    if (n.who) { var w = hits(n.who); if (w) return w; }
    var m = /[^\s@<>"(),;:]{1,64}@[^\s@<>"(),;:]{1,190}\.[a-z]{2,}/i.exec(n.text);
    if (m) { var e = custByEmail(data, m[0].toLowerCase(), emailOf); if (e) return e; }
    var txt = fold(n.text), best = null, tie = false;
    data.cust.forEach(function (c) {
      var nm = fold(c.name).trim();
      if (nm.length < 3 || txt.indexOf(nm) < 0) return;
      if (!best || nm.length > fold(best.name).trim().length) { best = c; tie = false; }
      else if (nm.length === fold(best.name).trim().length) tie = true;
    });
    return best && !tie ? best : null;
  }

  // What CRM hands Invoices (BR-CRM-INV 1) and Quote (BR-Q1). Both
  // apps only prefill a draft; nothing is saved before their Save.
  // Prices go in currency units (cents / 100). A deal is one line:
  // its title, quantity 1, its value.
  function invoicePrefill(c, d, cur) {
    var n = { crm: c.id, name: c.name, cur: cur };
    ["afm", "doy", "job", "addr", "country", "email", "phone"].forEach(function (k) { if (c[k]) n[k] = c[k]; });
    if (d) {
      n.items = [{ d: d.title, q: 1, p: (d.val || 0) / 100 }];
      n.ref = { app: "crm", id: d.id };
    }
    return n;
  }
  function quotePrefill(c, d, cur) {
    var known = typeof cur === "string" && /^[A-Z]{3}$/.test(cur);   // Quote takes any ISO code (wave 46)
    if (d && !known) return null;
    var p = { client: c.name, items: [d ? { d: d.title, q: 1, p: (d.val || 0) / 100 } : { d: "", q: 1, p: 0 }] };
    if (known) p.cur = cur;
    return p;
  }

  // ---------- CSV (customers) ----------
  // Leading = + - @ get a quote mark so a spreadsheet never runs a
  // cell as a formula.
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // The export's columns, in order; "csv.<col>" is the header text.
  var CSV_COLS = ["name", "alias", "kind", "st", "afm", "doy", "job", "addr", "country",
                  "phone", "email", "web", "src", "tags", "people", "deals", "open", "last", "note"];
  var CSV_HEAD = {
    en: { "csv.name": "Name", "csv.alias": "Trade name", "csv.kind": "Type", "csv.st": "Status", "csv.afm": "VAT ID",
          "csv.doy": "Tax office", "csv.job": "Profession", "csv.addr": "Address", "csv.country": "Country",
          "csv.phone": "Phone", "csv.email": "Email", "csv.web": "Website", "csv.src": "Source", "csv.tags": "Tags",
          "csv.people": "People", "csv.deals": "Open deals", "csv.open": "Open value", "csv.last": "Last contact", "csv.note": "Notes" },
    el: { "csv.name": "Επωνυμία", "csv.alias": "Διακριτικός τίτλος", "csv.kind": "Είδος", "csv.st": "Κατάσταση", "csv.afm": "ΑΦΜ",
          "csv.doy": "ΔΟΥ", "csv.job": "Επάγγελμα", "csv.addr": "Διεύθυνση", "csv.country": "Χώρα",
          "csv.phone": "Τηλέφωνο", "csv.email": "Email", "csv.web": "Ιστότοπος", "csv.src": "Πηγή", "csv.tags": "Ετικέτες",
          "csv.people": "Άνθρωποι", "csv.deals": "Ανοιχτές ευκαιρίες", "csv.open": "Ανοιχτή αξία", "csv.last": "Τελευταία επαφή", "csv.note": "Σημειώσεις" }
  };
  var CSV_WORDS = {
    en: { "csv.co": "Company", "csv.person": "Person", "csv.lead": "Lead", "csv.active": "Active", "csv.past": "Past" },
    el: { "csv.co": "Εταιρεία", "csv.person": "Ιδιώτης", "csv.lead": "Υποψήφιος", "csv.active": "Ενεργός", "csv.past": "Παλιός" }
  };
  // The export's own headers and words in every language loaded here
  // (English, Greek, a pack language): an exported file reads back.
  function csvOwn() {
    var I = i18n();
    if (I) { words(CSV_HEAD, I.lang()); words(CSV_WORDS, I.lang()); }
    var head = {}, w = { person: {}, lead: {}, past: {} };
    Object.keys(CSV_HEAD).forEach(function (l) {
      CSV_COLS.forEach(function (c) { var k = csvKey(CSV_HEAD[l]["csv." + c]); if (k && !head[k]) head[k] = c; });
    });
    Object.keys(CSV_WORDS).forEach(function (l) {
      Object.keys(w).forEach(function (x) { w[x][csvKey(CSV_WORDS[l]["csv." + x])] = 1; });
    });
    return { head: head, w: w };
  }
  // Reading a customer file: this app's own export (EN / EL), and the
  // usual words of Excel lists, HubSpot (companies and contacts) and
  // Greek accounting programs. Headers are matched folded, without
  // "(…)", dots and extra spaces.
  function parseCsv(text) {
    var s = String(text || "").replace(/^\ufeff/, "");
    var first = s.split(/\r?\n/)[0] || "", cnt = { ",": 0, ";": 0, "\t": 0 }, inQ = false;
    for (var k = 0; k < first.length; k++) {
      var ch0 = first[k];
      if (ch0 === '"') inQ = !inQ;
      else if (!inQ && cnt.hasOwnProperty(ch0)) cnt[ch0]++;
    }
    var sep = cnt[";"] > cnt[","] && cnt[";"] >= cnt["\t"] ? ";" : (cnt["\t"] > cnt[","] ? "\t" : ",");
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"' && cell === "") q = true;
      else if (ch === sep) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && s[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some(function (c) { return c.trim() !== ""; })) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(function (c) { return c.trim() !== ""; })) rows.push(row);
    return { sep: sep, rows: rows };
  }
  var CSV_IN = {
    name: ["name", "trade name", "company", "company name", "customer", "customer name", "client", "account name", "organization",
           "επωνυμια", "επωνυμια πελατη", "πελατησ", "ονομα πελατη", "εταιρεια", "ονοματεπωνυμο"],
    alias: ["alias", "διακριτικοσ τιτλοσ", "διακριτικοσ"],
    first: ["first name", "firstname", "given name", "ονομα"],
    last: ["last name", "lastname", "surname", "family name", "επωνυμο"],
    kind: ["type", "kind", "ειδοσ", "τυποσ"],
    st: ["status", "lifecycle stage", "κατασταση"],
    afm: ["vat id", "vat", "vat number", "tax id", "tin", "afm", "αφμ", "α.φ.μ"],
    doy: ["tax office", "δου", "δ.ο.υ"],
    job: ["profession", "industry", "occupation", "επαγγελμα", "δραστηριοτητα"],
    addr: ["address", "street address", "street", "address 1", "διευθυνση", "οδοσ"],
    city: ["city", "town", "πολη", "περιοχη"],
    zip: ["zip", "postal code", "postcode", "zip code", "τκ", "τ.κ", "ταχυδρομικοσ κωδικασ"],
    country: ["country", "country/region", "χωρα"],
    phone: ["phone", "phone number", "telephone", "tel", "mobile", "mobile phone number", "τηλεφωνο", "τηλ", "κινητο"],
    email: ["email", "e-mail", "email address", "mail"],
    web: ["website", "website url", "web", "url", "company domain name", "ιστοτοποσ", "ιστοσελιδα"],
    src: ["source", "lead source", "original source", "πηγη"],
    tags: ["tags", "labels", "ετικετεσ"],
    note: ["notes", "note", "description", "comments", "σημειωσεισ", "σχολια", "παρατηρησεισ"]
  };
  function csvKey(h) {
    return fold(h).replace(/\([^)]*\)/g, " ").replace(/[.:*]/g, "").replace(/\s+/g, " ").trim();
  }
  function csvStatus(v, own) {
    var f = csvKey(v);
    if (!f) return "";
    if (own && own.w.lead[f]) return "lead";
    if (own && own.w.past[f]) return "past";
    if (/^(lead|subscriber|marketing ?qualified ?lead|sales ?qualified ?lead|opportunity|prospect|υποψηφιοσ|υποψηφια)$/.test(f)) return "lead";
    if (/^(past|former|inactive|lost|other|παλιοσ|παλια|ανενεργοσ)$/.test(f)) return "past";
    return "active";
  }
  function csvImport(data, text, nowMs) {
    var rows = parseCsv(text).rows;
    if (!rows.length) return null;
    var col = {}, own = csvOwn();
    rows[0].forEach(function (h, i) {
      var k = csvKey(h);
      Object.keys(CSV_IN).forEach(function (f) {
        if (col[f] === undefined && (CSV_IN[f].indexOf(k) >= 0 || own.head[k] === f)) col[f] = i;
      });
    });
    if (col.name === undefined && col.first === undefined && col.last === undefined) return null;
    var seenAfm = {}, seenName = {};
    data.cust.forEach(function (c) { if (c.afm) seenAfm[c.afm] = 1; seenName[fold(cleanText(c.name, 120))] = 1; });
    var tagByName = {}, newTags = [], tagCount = data.tags.length;
    data.tags.forEach(function (t) { tagByName[fold(t.name)] = t.id; });
    var out = { add: [], tags: newTags, dup: 0, noName: 0, over: 0, cols: Object.keys(col).sort() };
    var room = LIMITS.cust - data.cust.length, n = 0;
    var cell = function (r, f) { return col[f] === undefined ? "" : cleanText(r[col[f]], 2000); };
    rows.slice(1).forEach(function (r) {
      var person = "";
      if (col.first !== undefined || col.last !== undefined) person = [cell(r, "first"), cell(r, "last")].filter(Boolean).join(" ");
      var name = cleanText(cell(r, "name") || person, 120);
      if (!name) { out.noName++; return; }
      var afm = cell(r, "afm").replace(/\s+/g, "").replace(/^el/i, "");
      if ((afm && seenAfm[afm]) || seenName[fold(name)]) { out.dup++; return; }
      if (out.add.length >= room) { out.over++; return; }
      var kv = csvKey(cell(r, "kind"));
      var kind = /^(person|individual|ιδιωτησ|φυσικο προσωπο)$/.test(kv) || own.w.person[kv] || (!cell(r, "name") && person) ? "person" : "co";
      var c = { id: newId(nowMs + n++), m: nowMs, ct: nowMs, name: name, kind: kind, st: csvStatus(cell(r, "st"), own) || "active" };
      if (afm) c.afm = afm;
      ["alias", "doy", "job", "country", "phone", "email", "web", "src"].forEach(function (f) { var v = cell(r, f); if (v) c[f] = v; });
      if (col.note !== undefined) c.note = cleanText(r[col.note], 2000, true);
      var addr = [cell(r, "addr"), [cell(r, "zip"), cell(r, "city")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      if (addr) c.addr = addr;
      // a contact list with a company column: the person is its first "People" line
      // (HubSpot contacts: the email and phone are that person's too)
      if (person && cell(r, "name") && fold(person) !== fold(name)) {
        var pp = { c: "", n: person };
        if (c.phone) pp.phone = c.phone;
        if (c.email) pp.email = c.email;
        c.people = [pp];
      }
      var tags = [];
      cell(r, "tags").split(/[,;|]/).forEach(function (w) {
        w = cleanText(w, 30);
        if (!w) return;
        var id = tagByName[fold(w)];
        if (!id && tagCount < LIMITS.tags) {
          id = newId(nowMs + n++);
          tagByName[fold(w)] = id;
          newTags.push({ id: id, m: nowMs, name: w, col: (tagCount++) % 8 });
        }
        if (id && tags.indexOf(id) < 0 && tags.length < LIMITS.custTags) tags.push(id);
      });
      if (tags.length) c.tags = tags;
      var nc = normCust(c);
      if (!nc) { out.noName++; return; }
      if (nc.afm) seenAfm[nc.afm] = 1;
      seenName[fold(nc.name)] = 1;
      out.add.push(nc);
    });
    // only the tags a kept customer uses
    var used = {};
    out.add.forEach(function (c) { (c.tags || []).forEach(function (id) { used[id] = 1; }); });
    out.tags = newTags.filter(function (t) { return used[t.id]; }).map(normTag).filter(Boolean);
    return out;
  }

  function csvRows(data, lang) {
    var W = words(CSV_WORDS, lang), H = words(CSV_HEAD, lang);
    var tagName = {};
    data.tags.forEach(function (t) { tagName[t.id] = t.name; });
    var last = lastContactMap(data);
    var rows = [CSV_COLS.map(function (c) { return H["csv." + c]; })];
    data.cust.slice().sort(function (a, b) { return a.name.localeCompare(b.name) || cmpStr(a.id, b.id); })
      .forEach(function (c) {
        var od = openDeals(data, c.id), ov = 0;
        od.forEach(function (d) { ov += d.val; });
        rows.push([c.name, c.alias || "", W["csv." + c.kind], W["csv." + c.st], c.afm || "", c.doy || "", c.job || "",
          c.addr || "", c.country || "", c.phone || "", c.email || "", c.web || "", c.src || "",
          (c.tags || []).map(function (id) { return tagName[id]; }).filter(Boolean).join(", "),
          (c.people || []).map(function (p) { return p.n + (p.role ? " (" + p.role + ")" : ""); }).join(", "),
          od.length, (ov / 100).toFixed(2), last[c.id] ? ymdOf(last[c.id]) : "", c.note || ""]);
      });
    return rows;
  }

  // ---------- Backup ----------
  function backup(data) {
    return { app: "crm", ver: DATA_VER, data: norm(data) };
  }
  // A backup merges INTO the data (never replaces). Accepts the backup
  // wrapper or a bare data object. Null when the file is not ours.
  function restore(data, file) {
    if (!file || typeof file !== "object") return null;
    var d = file.app === "crm" && file.data && typeof file.data === "object" ? file.data : file;
    if (!Array.isArray(d.cust)) return null;
    return merge(data, d);
  }

  // ---------- Other apps read this (shell, Today, Calendar, Contacts) ----------
  // Reminders (shell crmCheckTick, works with the app closed): what is
  // due now and not yet announced on this device. `seen` is the
  // device-local map { "<id>|<day><time>": 1 }; `next` keeps only the
  // keys still due, so it never grows. A follow-up moved to another
  // day or time is a new key and rings again.
  function reminders(data, today, hhmm, seen) {
    var s = seen && typeof seen === "object" ? seen : {};
    var fresh = [], next = {};
    dueNow(data, today, hhmm).forEach(function (f) {
      var k = f.id + "|" + f.d + (f.t || "");
      next[k] = 1;
      if (s[k] !== 1) fresh.push({ key: k, fup: f });
    });
    return { fresh: fresh, next: next };
  }
  var REM_WORDS = {
    en: { "rem.title": "Follow-up: {name}", "rem.unknown": "Unknown customer", "rem.today": "today", "rem.yday": "yesterday", "rem.late": "{n} days late" },
    el: { "rem.title": "Follow-up: {name}", "rem.unknown": "Άγνωστος πελάτης", "rem.today": "σήμερα", "rem.yday": "χθες", "rem.late": "καθυστερεί {n} μέρες" }
  };
  function reminderText(data, f, today, lang) {
    var w = words(REM_WORDS, lang);
    var c = byId(data.cust, f.cust);
    var n = dayDiff(f.d, today);
    var when = n <= 0 ? w["rem.today"] : (n === 1 ? w["rem.yday"] : w["rem.late"].replace("{n}", n));
    return { title: w["rem.title"].replace("{name}", c ? c.name : w["rem.unknown"]),
             body: f.text + " · " + when + (f.t ? " " + f.t : "") };
  }

  // Calendar feed: an open follow-up on its day (late ones show on
  // today, never on the past days), a done one on the day it was done,
  // an open deal on its expected close day (today and later).
  function calendarOn(data, ymd, today) {
    var out = [];
    data.fups.forEach(function (f) {
      if (f.done) { if (f.done === ymd) out.push({ k: "done", fup: f }); return; }
      if (ymd === today ? f.d <= today : (ymd > today && f.d === ymd)) out.push({ k: f.d < today ? "late" : "fup", fup: f });
    });
    data.deals.forEach(function (d) {
      if (isOpen(d) && d.close === ymd && ymd >= today) out.push({ k: "close", deal: d });
    });
    return out.sort(function (a, b) {
      var x = a.fup || a.deal, y = b.fup || b.deal;
      return cmpStr(x.t || "", y.t || "") || cmpStr(x.id, y.id);
    });
  }

  // Contacts: the living customers that list this contact as a person.
  function custsForContact(data, contactId) {
    if (typeof contactId !== "string" || !contactId) return [];
    return data.cust.filter(function (c) {
      return (c.people || []).some(function (p) { return p.c === contactId; });
    }).sort(function (a, b) { return cmpStr(fold(a.name), fold(b.name)) || cmpStr(a.id, b.id); });
  }

  var API = {
    DATA_VER: DATA_VER, ID_RE: ID_RE, STAGES: STAGES, OPEN_STAGES: OPEN_STAGES, STAGE_PROB: STAGE_PROB,
    ACT_KINDS: ACT_KINDS, CUST_ST: CUST_ST, CURRENCIES: CURRENCIES, LIMITS: LIMITS, HM_RE: HM_RE,
    newId: newId, isYmd: isYmd, ymdOf: ymdOf, addDays: addDays, dayDiff: dayDiff,
    cleanText: cleanText, fold: fold, asNewCust: asNewCust, validAfm: validAfm, parseMoney: parseMoney, moneyStr: moneyStr,
    normCust: normCust, normDeal: normDeal, normAct: normAct, normFup: normFup, normTag: normTag,
    normPrefs: normPrefs, normWf: normWf, norm: norm, merge: merge, empty: empty,
    byId: byId, custName: custName, lastContact: lastContact, lastContactMap: lastContactMap,
    stages: stages, stageOf: stageOf, normStg: normStg,
    dealProb: dealProb, isOpen: isOpen, openDeals: openDeals, pipeline: pipeline,
    agenda: agenda, dueNow: dueNow, forgotten: forgotten, dashboard: dashboard,
    customersForBilling: customersForBilling, invoicePrefill: invoicePrefill, quotePrefill: quotePrefill, csvCell: csvCell, csvRows: csvRows, parseCsv: parseCsv, csvImport: csvImport, mailLog: mailLog, custByEmail: custByEmail, autoLog: autoLog, autoLogCust: autoLogCust,
    backup: backup, restore: restore,
    reminders: reminders, reminderText: reminderText, calendarOn: calendarOn, custsForContact: custsForContact,
    ROLES: ROLES, LINK_KINDS: LINK_KINDS, normRoles: normRoles, normLinks: normLinks, pubKey: pubKey,
    ITEM_KINDS: ITEM_KINDS, ITEM_APP: ITEM_APP, normIx: normIx, normItems: normItems, itemsOf: itemsOf, itemKey: itemKey, itemTarget: itemTarget, itemsRow: itemsRow,
    normRsl: normRsl, CS_FIELDS: CS_FIELDS, normCs: normCs, csJoin: csJoin, rsOf: rsOf, rsRow: rsRow, normCtr: normCtr, ctrRemindDay: ctrRemindDay, contractsOf: contractsOf, ctrState: ctrState, balance: balance,
    SOON_DAYS: SOON_DAYS, CX_KINDS: CX_KINDS, normCx: normCx, normCset: normCset, cxOf: cxOf, cxRow: cxRow, ctrFmt: ctrFmt, ctrBook: ctrBook, addYears: addYears,
    ctrFupId: ctrFupId, ctrSnooze: ctrSnooze, ctrFupDay: ctrFupDay, ctrInfo: ctrInfo, ctrAll: ctrAll, ctrDash: ctrDash, ctrTitle: ctrTitle, ctrForTitle: ctrForTitle,
    RT_RIGHTS: RT_RIGHTS, RT_STATUS: RT_STATUS, normRt: normRt, rtPerp: rtPerp, rtOf: rtOf, rtRow: rtRow, rtStatus: rtStatus, rtCovers: rtCovers, rightsBoard: rightsBoard,
    ctrHeal: ctrHeal, ctrEndsOn: ctrEndsOn, portalPayload: portalPayload, portalPlan: portalPlan,
    normPt: normPt, ptOf: ptOf, rolesOf: rolesOf, hasRole: hasRole, lnOf: lnOf, rolesRow: rolesRow,
    linksOf: linksOf, linkOwner: linkOwner, linkMove: linkMove
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCrmCore = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
