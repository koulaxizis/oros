// ============================================================
// orOS CRM — core.js (shared logic, v1.4.0)
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
// Data (synced slice "crm", key oros-crm-data):
//   { ver: 1, cust, deals, acts, fups, tags, stg: [row…] each
//     sorted by id, prefs: { pm, cur, forget }, tombs: { id: deletedAt } }
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
  var LIMITS = { cust: 2000, deals: 5000, acts: 20000, fups: 10000, tags: 50, stg: 20, people: 20, custTags: 10, openStages: 8 };
  var STAGES = ["new", "contact", "proposal", "nego", "won", "lost"];
  var OPEN_STAGES = ["new", "contact", "proposal", "nego"];      // the built-in open stages
  var STAGE_PROB = { "new": 10, contact: 25, proposal: 50, nego: 75, won: 100, lost: 0 };
  var STAGE_POS = { "new": 10, contact: 20, proposal: 30, nego: 40 };
  var ACT_KINDS = ["call", "mail", "meet", "msg", "note"];
  var CUST_ST = ["lead", "active", "past"];
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "CAD", "AUD", "JPY"];
  var LIST_KEYS = ["cust", "deals", "acts", "fups", "tags", "stg"];

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
  function moneyStr(cents, cur, lang) {
    var v = (isInt(cents) ? cents : 0) / 100;
    var c = CURRENCIES.indexOf(cur) >= 0 ? cur : "EUR";
    try {
      return new Intl.NumberFormat(lang === "el" ? "el-GR" : "en-GB",
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

  var LISTS = { cust: normCust, deals: normDeal, acts: normAct, fups: normFup, tags: normTag, stg: normStg };

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
          lww(best[k], x);
        });
      });
      Object.keys(best[k]).forEach(function (id) { if (best[k][id].m > newest) newest = best[k][id].m; });
    });
    var pa = normPrefs(a.prefs), pb = normPrefs(b.prefs);
    if (pa.pm > newest) newest = pa.pm;
    if (pb.pm > newest) newest = pb.pm;

    var out = { ver: DATA_VER };
    var aliveCust = {};
    LIST_KEYS.forEach(function (k) {
      var list = [];
      Object.keys(best[k]).sort(cmpStr).forEach(function (id) {
        var x = best[k][id];
        if (id in tombs && tombs[id] >= x.m) return;
        if (k !== "cust" && k !== "tags" && k !== "stg" && !aliveCust[x.cust]) return;
        if (list.length >= LIMITS[k]) return;
        list.push(x);
      });
      out[k] = list;
      if (k === "cust") list.forEach(function (c) { aliveCust[c.id] = true; });
    });
    out.prefs = pb.pm > pa.pm || (pb.pm === pa.pm && canon(pb) > canon(pa)) ? pb : pa;
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
  var CSV_HEAD = {
    en: ["Name", "Trade name", "Type", "Status", "VAT ID", "Tax office", "Profession", "Address", "Country",
         "Phone", "Email", "Website", "Source", "Tags", "People", "Open deals", "Open value", "Last contact", "Notes"],
    el: ["Επωνυμία", "Διακριτικός τίτλος", "Είδος", "Κατάσταση", "ΑΦΜ", "ΔΟΥ", "Επάγγελμα", "Διεύθυνση", "Χώρα",
         "Τηλέφωνο", "Email", "Ιστότοπος", "Πηγή", "Ετικέτες", "Άνθρωποι", "Ανοιχτές ευκαιρίες", "Ανοιχτή αξία", "Τελευταία επαφή", "Σημειώσεις"]
  };
  var CSV_WORDS = {
    en: { co: "Company", person: "Person", lead: "Lead", active: "Active", past: "Past" },
    el: { co: "Εταιρεία", person: "Ιδιώτης", lead: "Υποψήφιος", active: "Ενεργός", past: "Παλιός" }
  };
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
  function csvStatus(v) {
    var f = csvKey(v);
    if (!f) return "";
    if (/^(lead|subscriber|marketing ?qualified ?lead|sales ?qualified ?lead|opportunity|prospect|υποψηφιοσ|υποψηφια)$/.test(f)) return "lead";
    if (/^(past|former|inactive|lost|other|παλιοσ|παλια|ανενεργοσ)$/.test(f)) return "past";
    return "active";
  }
  function csvImport(data, text, nowMs) {
    var rows = parseCsv(text).rows;
    if (!rows.length) return null;
    var col = {};
    rows[0].forEach(function (h, i) {
      var k = csvKey(h);
      Object.keys(CSV_IN).forEach(function (f) {
        if (col[f] === undefined && CSV_IN[f].indexOf(k) >= 0) col[f] = i;
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
      var kind = /^(person|individual|ιδιωτησ|φυσικο προσωπο)$/.test(kv) || (!cell(r, "name") && person) ? "person" : "co";
      var c = { id: newId(nowMs + n++), m: nowMs, ct: nowMs, name: name, kind: kind, st: csvStatus(cell(r, "st")) || "active" };
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
    var L = lang === "el" ? "el" : "en", W = CSV_WORDS[L];
    var tagName = {};
    data.tags.forEach(function (t) { tagName[t.id] = t.name; });
    var last = lastContactMap(data);
    var rows = [CSV_HEAD[L]];
    data.cust.slice().sort(function (a, b) { return a.name.localeCompare(b.name) || cmpStr(a.id, b.id); })
      .forEach(function (c) {
        var od = openDeals(data, c.id), ov = 0;
        od.forEach(function (d) { ov += d.val; });
        rows.push([c.name, c.alias || "", W[c.kind], W[c.st], c.afm || "", c.doy || "", c.job || "",
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
    en: { title: "Follow-up: {name}", unknown: "Unknown customer", today: "today", yday: "yesterday", late: "{n} days late" },
    el: { title: "Follow-up: {name}", unknown: "Άγνωστος πελάτης", today: "σήμερα", yday: "χθες", late: "καθυστερεί {n} μέρες" }
  };
  function reminderText(data, f, today, lang) {
    var w = REM_WORDS[lang === "el" ? "el" : "en"];
    var c = byId(data.cust, f.cust);
    var n = dayDiff(f.d, today);
    var when = n <= 0 ? w.today : (n === 1 ? w.yday : w.late.replace("{n}", n));
    return { title: w.title.replace("{name}", c ? c.name : w.unknown),
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
    normPrefs: normPrefs, norm: norm, merge: merge, empty: empty,
    byId: byId, custName: custName, lastContact: lastContact, lastContactMap: lastContactMap,
    stages: stages, stageOf: stageOf, normStg: normStg,
    dealProb: dealProb, isOpen: isOpen, openDeals: openDeals, pipeline: pipeline,
    agenda: agenda, dueNow: dueNow, forgotten: forgotten, dashboard: dashboard,
    customersForBilling: customersForBilling, invoicePrefill: invoicePrefill, quotePrefill: quotePrefill, csvCell: csvCell, csvRows: csvRows, parseCsv: parseCsv, csvImport: csvImport, mailLog: mailLog, custByEmail: custByEmail,
    backup: backup, restore: restore,
    reminders: reminders, reminderText: reminderText, calendarOn: calendarOn, custsForContact: custsForContact
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCrmCore = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
