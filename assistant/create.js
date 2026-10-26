// ============================================================
// orOS Assistant — new records and links (AS-ADD)
// ------------------------------------------------------------
// Pure logic, no DOM, no storage: the create_items and link_contact
// tools of the Assistant. assistant.js reads the app's stored JSON,
// asks this file what would be made (plan → one row per new record,
// each with a tick, on a card the user confirms), then asks it again
// for the new JSON (apply) and writes it. Unit-tested in node
// (tests/assistant-create.test.js).
//
// Rules (OROS_BIBLE.md "Assistant", AS-ADD):
//   - Nothing is written without the user's own press of "Add" (or
//     "Link") on the card, whatever the app's permission says.
//   - New records only: create_items never touches a record that is
//     already there. A new record that looks like one already there
//     (same e-mail, same phone, same tax number, or same name) is
//     shown with "already in …" and starts unticked; the model hears
//     only that record's ref, so it can change it with change_item.
//   - The write follows the app's own sync contract:
//       contacts  a new contact in contacts.js sanitizeContact shape,
//                 every field stamped once (merge.js restamp(null, c):
//                 c.fm = { field: mtime }), no tombstone left for it
//       crm       a new customer in crm/core.js normCust shape, m =
//                 the stamp, after any tombstone of the id; rows
//                 sorted by id. People linked from Contacts are
//                 cust.people [{ c: contact id, n: name, role? }],
//                 the same row CRM's own "From Contacts" writes, and
//                 Contacts finds the customer by it (custsForContact).
//     Stamps are max(now, old + 1), as in edits.js.
//   - Limits are the apps' own: a contact's note holds CT_NOTE
//     characters (a longer one is refused, never cut: an older device
//     would cut it and upload the cut copy), a CRM note 2000, a
//     customer 20 people, CRM 2000 customers.
//   - Undo takes back only what this card made, and only while each
//     record still looks as it was made (CRM: and has no deals,
//     history, follow-ups or contracts yet); all or nothing.
// Exposed as window.OrosAssistCreate (module.exports in node).
// i18n-inline-ok: Greek letter folding, Greek seed label and country names for matching (data, no UI text)
// ============================================================
(function (root) {
  "use strict";

  var APPS = {
    contacts: { key: "oros-contacts-data" },
    crm:      { key: "oros-crm-data" }
  };
  var APP_IDS = ["contacts", "crm"];
  var MAX_ITEMS = 100;
  var MAX_LINKS = 50;
  var CT_NOTE = 500;          // contacts.js sanitizeContact
  var CRM_NOTE = 2000;        // crm/core.js normCust
  var CRM_PEOPLE = 20;        // crm/core.js LIMITS.people
  var CRM_CUST = 2000;        // crm/core.js LIMITS.cust
  var CRM_ST = ["lead", "active", "past"];
  var PHONE_TYPES = ["mobile", "home", "work", "main", "other"];
  var EMAIL_TYPES = ["home", "work", "other"];
  var WEB_TYPES = ["home", "work", "blog", "other"];
  var ADDR_TYPES = ["home", "work", "other"];
  // contacts.js / merge.js field lists (CT-PF)
  var CT_FIELDS = ["given", "middle", "family", "nickname", "org", "jobTitle",
    "phones", "emails", "addresses", "websites", "im", "events", "relations",
    "labelIds", "starred", "note", "avatar"];
  var CRM_KEYS = ["id", "m", "name", "kind", "st", "alias", "afm", "doy", "job", "addr", "country", "phone", "email",
                  "web", "src", "note", "star", "ct", "tags", "people"];
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var WEB = /^(https?:\/\/)?[^\s\/.]+(\.[^\s\/.]+)+(\/\S*)?$/i;
  var CRM_ID = /^[a-z0-9]{6,40}$/;
  var CREF = /^[A-Za-z0-9_.:-]{1,80}$/;
  var CTRL = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g;

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function line(v, max) { return typeof v === "string" ? v.replace(CTRL, " ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
  function para(v) { return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(CTRL, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : ""; }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function bad(msg) { return { ok: false, err: msg }; }
  function stampAfter(now, prev) { return Math.max(Math.floor(now) || 0, (typeof prev === "number" && isFinite(prev) ? prev : 0) + 1); }
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }
  function digits(s) { return String(s || "").replace(/\D+/g, ""); }
  // "+30 69…" and "69…" are the same number (edits.js ctSamePhone)
  function samePhone(a, b) {
    var x = digits(a), y = digits(b);
    if (!x || !y) return false;
    if (x === y) return true;
    var lo = x.length < y.length ? x : y, hi = lo === x ? y : x;
    return lo.length >= 8 && hi.slice(-lo.length) === lo;
  }
  function realDate(s) {
    var m = typeof s === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim()) : null;
    if (!m) return "";
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : "";
  }
  // Greek ΑΦΜ check digit (crm/core.js validAfm)
  function afmOk(v) {
    v = String(v || "").replace(/^(EL|GR)/i, "");
    if (!/^\d{9}$/.test(v) || v === "000000000") return false;
    var sum = 0;
    for (var i = 0; i < 8; i++) sum += (+v.charAt(i)) * Math.pow(2, 8 - i);
    return (sum % 11) % 10 === +v.charAt(8);
  }
  function strList(v, max, each) {
    var a = Array.isArray(v) ? v : (typeof v === "string" && v ? [v] : []);
    var out = [];
    a.forEach(function (x) { var s = line(x, each); if (s && out.length < max && out.indexOf(s) < 0) out.push(s); });
    return out;
  }
  function addrOf(v, where) {
    if (v === undefined || v === null || v === "") return { a: null };
    var ad = typeof v === "string" ? { street: v } : v;
    if (!isObj(ad)) return { err: where + "address must be an object { street, city, zip, region, country, type } or one line." };
    var o = {};
    [["street", 120], ["city", 60], ["zip", 20], ["region", 60], ["country", 60]].forEach(function (f) { o[f[0]] = line(ad[f[0]], f[1]); });
    if (!o.street && !o.city && !o.zip && !o.region && !o.country) return { a: null };
    if (has(ad, "type") && ad.type !== "" && ADDR_TYPES.indexOf(ad.type) < 0) return { err: where + "address type must be home, work or other." };
    o.type = ad.type || "home";
    return { a: o };
  }
  function addrLine(a) {
    if (!isObj(a)) return "";
    var place = [a.zip, a.city].filter(Boolean).join(" ");
    return [a.street, place, a.region, a.country].filter(Boolean).join(", ");
  }

  // ---------- 1. The tool's arguments ----------
  // create_items { app, items: [ {…} ] } → { ok, app, items: [norm] } |
  // { ok: false, err }. A bad entry is named by its index; nothing of
  // it is guessed.
  function normContact(x, where) {
    var name = line(x.name, 180) || line(x.title, 180), org = line(x.org, 80);
    if (!name && !org) return { err: where + "a contact needs a name or an org." };
    var w = name.split(" ").filter(Boolean), g = "", f = "";
    if (w.length === 1) g = w[0];
    else if (w.length > 1) { f = w.pop(); g = w.join(" "); }
    if (g.length > 60 || f.length > 60) return { err: where + "that name is too long for Contacts (60 characters per part)." };
    var o = { given: g, family: f, org: org, nickname: line(x.nickname, 60), jobTitle: line(x.job_title, 80) };
    var ph = strList(x.phones !== undefined ? x.phones : x.phone, 10, 40);
    var bp = ph.filter(function (p) { return !/\d/.test(p); });
    if (bp.length) return { err: where + "phone " + bp[0] + " has no digits." };
    o.phones = ph.map(function (v) { return { v: v, type: "mobile" }; });
    var em = strList(x.emails !== undefined ? x.emails : x.email, 10, 120);
    var be = em.filter(function (e) { return !EMAIL.test(e); });
    if (be.length) return { err: where + be[0] + " is not an e-mail address." };
    o.emails = em.map(function (v) { return { v: v, type: "home" }; });
    var wb = strList(x.websites !== undefined ? x.websites : x.website, 10, 300);
    var bw = wb.filter(function (u) { return !WEB.test(u); });
    if (bw.length) return { err: where + bw[0] + " is not a web address." };
    o.websites = wb.map(function (v) { return { v: v, type: "home" }; });
    var ad = addrOf(x.address, where);
    if (ad.err) return { err: ad.err };
    o.addresses = ad.a ? [ad.a] : [];
    o.events = [];
    if (x.birthday !== undefined && x.birthday !== null && x.birthday !== "") {
      var b = String(x.birthday).trim(), bm = /^(?:--)?(\d{2})-(\d{2})$/.exec(b);
      if (realDate(b)) {
        var y = +b.slice(0, 4);
        if (y < 1850 || y > 2200) return { err: where + "a birthday year must be between 1850 and 2200." };
        o.events.push({ day: b.slice(5), year: y, type: "birthday", label: "" });
      } else if (bm && realDate("2000-" + bm[1] + "-" + bm[2])) o.events.push({ day: bm[1] + "-" + bm[2], year: null, type: "birthday", label: "" });
      else return { err: where + "birthday must be YYYY-MM-DD or MM-DD." };
    }
    var nt = para(x.note);
    if (nt.length > CT_NOTE) return { err: where + "the note is " + nt.length + " characters; Contacts keeps " + CT_NOTE + ". Shorten it." };
    o.note = nt;
    o.labels = strList(x.labels, 20, 40);
    return { o: o };
  }
  function normCustomer(x, where) {
    var name = line(x.name, 120) || line(x.title, 120);
    if (!name) return { err: where + "a customer needs a name (the person's or the company's)." };
    var kind = x.kind === "person" ? "person" : x.kind === undefined || x.kind === null || x.kind === "" || x.kind === "company" ? "" : "?";
    if (kind === "?") return { err: where + "kind must be person or company." };
    var st = x.status === undefined || x.status === null || x.status === "" ? "lead" : String(x.status);
    if (CRM_ST.indexOf(st) < 0) return { err: where + "status must be lead, active or past." };
    var o = { name: name, kind: kind || "co", st: st, alias: line(x.nickname, 80), job: line(x.job_title, 80),
              doy: line(x.tax_office, 60), country: "", src: "" };
    if (x.tax_id !== undefined && x.tax_id !== null && x.tax_id !== "") {
      var tx = line(String(x.tax_id), 20).replace(/\s+/g, "").toUpperCase();
      if (!/^[A-Z0-9.\-]+$/.test(tx)) return { err: where + "tax_id must be letters and digits, e.g. 123456789 or EL123456789." };
      o.afm = tx;
    } else o.afm = "";
    var ph = line(x.phone, 40);
    if (ph && !/\d/.test(ph)) return { err: where + "phone " + ph + " has no digits." };
    o.phone = ph;
    var em = line(x.email, 120);
    if (em && !EMAIL.test(em)) return { err: where + em + " is not an e-mail address." };
    o.email = em;
    var wb = line(x.website, 300);
    if (wb && !WEB.test(wb)) return { err: where + wb + " is not a web address." };
    o.web = wb;
    var ad = addrOf(x.address, where);
    if (ad.err) return { err: ad.err };
    o.addr = ad.a ? [ad.a.street, [ad.a.zip, ad.a.city].filter(Boolean).join(" "), ad.a.region].filter(Boolean).join(", ").slice(0, 200) : "";
    o.country = ad.a ? ad.a.country : "";
    if (!o.country && typeof x.country === "string") o.country = line(x.country, 60);
    var gr = !o.country || /^(gr|greece|ελλάδα|ελλαδα|hellas)$/i.test(o.country);
    if (o.afm && gr && /^((EL|GR)?)\d{9}$/i.test(o.afm) && !afmOk(o.afm)) return { err: where + "tax_id " + o.afm + " fails the Greek check digit: read it again." };
    var nt = para(x.note);
    if (nt.length > CRM_NOTE) return { err: where + "the note is " + nt.length + " characters; CRM keeps " + CRM_NOTE + ". Shorten it." };
    o.note = nt;
    // contact: a Contacts ref (search_data, or create_items' result);
    // assistant.js turns it into person { c, n } before plan().
    var cr = x.contact === undefined || x.contact === null ? "" : String(x.contact).replace(/^oros:/, "").trim();
    if (cr && !/^r\d{1,5}$/.test(cr)) return { err: where + "contact must be the ref of a contact (e.g. r4) from search_data or create_items." };
    o.contact = cr;
    o.role = line(x.role, 60);
    return { o: o };
  }
  function normItems(args) {
    if (!isObj(args)) return bad("The arguments must be an object.");
    var app = String(args.app || "");
    if (!has(APPS, app)) return bad("app must be one of: " + APP_IDS.join(", ") + ".");
    var list = Array.isArray(args.items) ? args.items : [];
    if (!list.length) return bad("items is empty.");
    if (list.length > MAX_ITEMS) return bad("At most " + MAX_ITEMS + " items at a time.");
    var out = [], keys = {};
    for (var i = 0; i < list.length; i++) {
      var where = "items[" + i + "]: ";
      if (!isObj(list[i])) return bad(where + "each item must be an object.");
      var r = app === "contacts" ? normContact(list[i], where) : normCustomer(list[i], where);
      if (r.err) return bad(r.err);
      var k = app === "contacts"
        ? fold([r.o.given, r.o.family].join(" ") || r.o.org) + "|" + (r.o.emails[0] ? r.o.emails[0].v.toLowerCase() : "")
        : fold(r.o.name) + "|" + r.o.email.toLowerCase();
      if (has(keys, k)) return bad("items[" + keys[k] + "] and items[" + i + "] are the same; give each one once with all of its details.");
      keys[k] = i;
      out.push(r.o);
    }
    return { ok: true, app: app, items: out };
  }

  // ---------- 2. Contacts ----------
  function ctStr(v) { return typeof v === "string" ? v.trim() : ""; }
  function ctName(c) {
    var n = [ctStr(c.given), ctStr(c.middle), ctStr(c.family)].filter(Boolean).join(" ");
    return n || ctStr(c.nickname) || ctStr(c.org);
  }
  function ctTomb(d, id) {
    var t = -1;
    (Array.isArray(d.deleted) ? d.deleted : []).forEach(function (x) { if (isObj(x) && x.id === id && typeof x.mtime === "number" && x.mtime > t) t = x.mtime; });
    return t;
  }
  function ctAlive(d) {
    return (isObj(d) && Array.isArray(d.contacts) ? d.contacts : []).filter(function (c) {
      if (!isObj(c) || typeof c.id !== "string") return false;
      var t = ctTomb(d, c.id);
      return !(t >= 0 && !((c.mtime || 0) > t));
    });
  }
  function ctVals(arr) { return (Array.isArray(arr) ? arr : []).map(function (x) { return isObj(x) ? ctStr(x.v) : ""; }).filter(Boolean); }
  // Untouched seed labels are stored in the device's language: either
  // language's name finds them (edits.js CAL_SEEDS).
  var SEEDS = {
    "lbl-personal": ["Personal", "Προσωπικό"], "lbl-work": ["Work", "Εργασία"], "lbl-family": ["Family", "Οικογένεια"]
  };
  function ctLabelId(d, name) {
    var f = fold(name), hit = "";
    (Array.isArray(d.labels) ? d.labels : []).forEach(function (l) {
      if (hit || !isObj(l) || typeof l.id !== "string" || typeof l.name !== "string") return;
      var names = [l.name];
      if (l.mtime === 0 && has(SEEDS, l.id)) names = names.concat(SEEDS[l.id]);
      if (names.some(function (n) { return fold(n) === f; })) hit = l.id;
    });
    return hit;
  }
  function ctLabelNames(d) {
    return (Array.isArray(d.labels) ? d.labels : []).filter(function (l) { return isObj(l) && typeof l.name === "string"; }).map(function (l) { return l.name; });
  }
  // The existing contact a new one would repeat: a shared e-mail, a
  // shared phone, else the same name (accents and case ignored).
  function ctDup(alive, o) {
    var em = o.emails.map(function (x) { return x.v.toLowerCase(); }), ph = o.phones.map(function (x) { return x.v; });
    var nm = fold([o.given, o.family].filter(Boolean).join(" "));
    var byName = null;
    for (var i = 0; i < alive.length; i++) {
      var c = alive[i];
      if (ctVals(c.emails).some(function (v) { return em.indexOf(v.toLowerCase()) >= 0; })) return c;
      if (ctVals(c.phones).some(function (v) { return ph.some(function (p) { return samePhone(p, v); }); })) return c;
      if (!byName && nm && fold([ctStr(c.given), ctStr(c.middle), ctStr(c.family)].filter(Boolean).join(" ")) === nm) byName = c;
      if (!byName && !nm && o.org && !ctName({ given: c.given, middle: c.middle, family: c.family }) && fold(c.org) === fold(o.org)) byName = c;
    }
    return byName;
  }
  function ctFields(o, d) {
    var f = [];
    if (o.org) f.push(["org", o.org]);
    if (o.jobTitle) f.push(["job", o.jobTitle]);
    if (o.nickname) f.push(["nickname", o.nickname]);
    if (o.phones.length) f.push(["phone", o.phones.map(function (x) { return x.v; }).join(", ")]);
    if (o.emails.length) f.push(["email", o.emails.map(function (x) { return x.v; }).join(", ")]);
    if (o.addresses.length) f.push(["address", addrLine(o.addresses[0])]);
    if (o.websites.length) f.push(["website", o.websites.map(function (x) { return x.v; }).join(", ")]);
    if (o.events.length) f.push(["birthday", (o.events[0].year ? o.events[0].year : "-") + "-" + o.events[0].day]);
    if (o.labels.length) f.push(["labels", o.labels.join(", ")]);
    if (o.note) f.push(["note", o.note]);
    return f;
  }
  function ctPlan(d, items) {
    var alive = ctAlive(d), rows = [];
    for (var i = 0; i < items.length; i++) {
      var o = items[i];
      var miss = o.labels.filter(function (n) { return !ctLabelId(d, n); });
      if (miss.length) {
        var have = ctLabelNames(d);
        return bad("items[" + i + "]: Contacts has no label " + miss.join(", ") + (have.length ? " (labels: " + have.join(", ") + ")" : "") + ". The user makes new labels in Contacts.");
      }
      var dup = ctDup(alive, o);
      rows.push({ title: [o.given, o.family].filter(Boolean).join(" ") || o.org, fields: ctFields(o, d),
                  dup: dup ? { id: dup.id, title: ctName(dup) } : null });
    }
    return { ok: true, rows: rows };
  }
  function ctUid(now, taken) {
    var id;
    do { id = Math.floor(now).toString(36) + Math.random().toString(36).slice(2, 7); } while (taken[id]);
    taken[id] = 1;
    return id;
  }
  function ctMake(d, o, id, s) {
    var lids = o.labels.map(function (n) { return ctLabelId(d, n); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).sort();
    var c = {
      id: id, given: o.given, middle: "", family: o.family, nickname: o.nickname, org: o.org, jobTitle: o.jobTitle,
      phones: clone(o.phones), emails: clone(o.emails), addresses: clone(o.addresses), websites: clone(o.websites),
      im: [], events: clone(o.events), relations: [], labelIds: lids, starred: false, note: o.note, avatar: null, mtime: s
    };
    var fm = {};
    CT_FIELDS.forEach(function (f) { fm[f] = s; });   // merge.js restamp(null, c)
    c.fm = fm;
    return c;
  }
  function ctApply(d, items, now, skip) {
    if (!isObj(d)) d = { ver: 1, labels: [], contacts: [], deleted: [] };
    if (!Array.isArray(d.contacts)) d.contacts = [];
    var taken = {}, made = [], snap = {};
    d.contacts.forEach(function (c) { if (isObj(c) && typeof c.id === "string") taken[c.id] = 1; });
    (Array.isArray(d.deleted) ? d.deleted : []).forEach(function (x) { if (isObj(x) && typeof x.id === "string") taken[x.id] = 1; });
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var id = ctUid(now, taken);
      var c = ctMake(d, o, id, stampAfter(now, 0));
      d.contacts.push(c);
      made.push({ i: i, id: id, title: ctName(c) });
      snap[id] = JSON.stringify(c);
    });
    return { ok: true, data: d, made: made, undo: { app: "contacts", t: "new", snap: snap } };
  }
  function ctUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.contacts)) return bad("Contacts has no contacts.");
    var ids = Object.keys(u.snap || {});
    for (var i = 0; i < ids.length; i++) {
      var c = d.contacts.filter(function (x) { return isObj(x) && x.id === ids[i]; })[0];
      if (!c) continue;    // gone already
      if (JSON.stringify(c) !== u.snap[ids[i]]) return bad("A new contact was changed since; nothing was undone.");
    }
    if (!Array.isArray(d.deleted)) d.deleted = [];
    ids.forEach(function (id) {
      var at = -1;
      d.contacts.forEach(function (x, k) { if (isObj(x) && x.id === id) at = k; });
      if (at < 0) return;
      var c = d.contacts[at];
      d.contacts.splice(at, 1);
      d.deleted = d.deleted.filter(function (x) { return !(isObj(x) && x.id === id); });
      d.deleted.push({ id: id, mtime: stampAfter(now, c.mtime || 0) });
    });
    return { ok: true, data: d };
  }

  // ---------- 3. CRM ----------
  function crmTombs(d) { return isObj(d.tombs) ? d.tombs : {}; }
  function crmAlive(d) {
    var tombs = crmTombs(d);
    return (isObj(d) && Array.isArray(d.cust) ? d.cust : []).filter(function (c) {
      return isObj(c) && typeof c.id === "string" && !(typeof tombs[c.id] === "number" && tombs[c.id] >= (c.m || 0));
    });
  }
  function crmDup(alive, o) {
    var byName = null, nm = fold(o.name), em = o.email.toLowerCase(), afm = o.afm.replace(/^(EL|GR)/, "");
    for (var i = 0; i < alive.length; i++) {
      var c = alive[i];
      if (em && typeof c.email === "string" && c.email.toLowerCase() === em) return c;
      if (afm && typeof c.afm === "string" && c.afm.replace(/^(EL|GR)/i, "") === afm) return c;
      if (!byName && fold(c.name) === nm) byName = c;
    }
    return byName;
  }
  function crmFields(o) {
    var f = [["kind", o.kind === "person" ? "person" : "company"], ["status", o.st]];
    if (o.alias) f.push(["nickname", o.alias]);
    if (o.job) f.push(["job", o.job]);
    if (o.afm) f.push(["vat", o.afm]);
    if (o.doy) f.push(["taxoffice", o.doy]);
    if (o.phone) f.push(["phone", o.phone]);
    if (o.email) f.push(["email", o.email]);
    if (o.addr || o.country) f.push(["address", [o.addr, o.country].filter(Boolean).join(", ")]);
    if (o.web) f.push(["website", o.web]);
    if (o.person) f.push(["people", o.person.n + (o.person.role ? " (" + o.person.role + ")" : "")]);
    if (o.note) f.push(["note", o.note]);
    return f;
  }
  function crmPlan(d, items) {
    var alive = crmAlive(d || {}), rows = [];
    var room = CRM_CUST - (isObj(d) && Array.isArray(d.cust) ? d.cust.length : 0);
    if (items.length > room) return bad("CRM holds " + CRM_CUST + " customers; only " + Math.max(0, room) + " more fit.");
    for (var i = 0; i < items.length; i++) {
      var o = items[i];
      if (o.contact && !o.person) return bad("items[" + i + "]: contact " + o.contact + " is not a contact this conversation found.");
      var dup = crmDup(alive, o);
      rows.push({ title: o.name, fields: crmFields(o), dup: dup ? { id: dup.id, title: String(dup.name || "") } : null });
    }
    return { ok: true, rows: rows };
  }
  function crmOrder(c) {
    var o = {};
    CRM_KEYS.forEach(function (k) { if (has(c, k) && c[k] !== "" && c[k] !== null && c[k] !== undefined) o[k] = c[k]; });
    Object.keys(c).forEach(function (k) { if (!has(o, k) && CRM_KEYS.indexOf(k) < 0) o[k] = c[k]; });
    return o;
  }
  function crmNewId(now, taken) {
    var id;
    do {
      var r = "";
      while (r.length < 8) r += Math.floor(Math.random() * 36).toString(36);
      id = Math.floor(now).toString(36) + r;                // crm/core.js newId
    } while (taken[id]);
    taken[id] = 1;
    return id;
  }
  function crmEmpty() {
    return { ver: 1, cust: [], deals: [], acts: [], fups: [], tags: [], stg: [], prefs: {}, tombs: {} };
  }
  function crmApply(d, items, now, skip) {
    if (!isObj(d)) d = crmEmpty();
    if (!Array.isArray(d.cust)) d.cust = [];
    var taken = {}, made = [], snap = {}, tombs = crmTombs(d);
    d.cust.forEach(function (c) { if (isObj(c) && typeof c.id === "string") taken[c.id] = 1; });
    Object.keys(tombs).forEach(function (id) { taken[id] = 1; });
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var id = crmNewId(now, taken);
      var c = { id: id, m: stampAfter(now, 0), name: o.name, kind: o.kind, st: o.st, alias: o.alias, afm: o.afm, doy: o.doy,
                job: o.job, addr: o.addr, country: o.country, phone: o.phone, email: o.email, web: o.web, note: o.note };
      if (o.person) {
        var p = { c: o.person.c, n: o.person.n };
        if (o.person.role) p.role = o.person.role;
        c.people = [p];
      }
      c = crmOrder(c);
      d.cust.push(c);
      made.push({ i: i, id: id, title: c.name });
      snap[id] = JSON.stringify(c);
    });
    d.cust.sort(function (a, b) { return cmpStr(isObj(a) ? String(a.id) : "", isObj(b) ? String(b.id) : ""); });
    return { ok: true, data: d, made: made, undo: { app: "crm", t: "new", snap: snap } };
  }
  function crmUsed(d, id) {
    return ["deals", "acts", "fups", "ctr"].some(function (k) {
      return (Array.isArray(d[k]) ? d[k] : []).some(function (x) { return isObj(x) && x.cust === id; });
    });
  }
  function crmUndoNew(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.cust)) return bad("CRM has no customers.");
    var ids = Object.keys(u.snap || {});
    for (var i = 0; i < ids.length; i++) {
      var c = d.cust.filter(function (x) { return isObj(x) && x.id === ids[i]; })[0];
      if (!c) continue;
      if (JSON.stringify(c) !== u.snap[ids[i]]) return bad("A new customer was changed since; nothing was undone.");
      if (crmUsed(d, ids[i])) return bad("A new customer has deals, history or follow-ups now; delete it in CRM instead.");
    }
    if (!isObj(d.tombs)) d.tombs = {};
    ids.forEach(function (id) {
      var at = -1;
      d.cust.forEach(function (x, k) { if (isObj(x) && x.id === id) at = k; });
      if (at < 0) return;
      var c = d.cust[at];
      d.cust.splice(at, 1);
      d.tombs[id] = stampAfter(now, c.m || 0);
    });
    return { ok: true, data: d };
  }

  // ---------- 4. Links: a CRM customer ↔ a contact ----------
  // links: [{ cust: CRM id, c: contact id, role? }] → the customer's
  // people list gets { c, n } (the contact's name now); a person kept
  // by name only with the same name becomes that link (role kept).
  function crmFindAlive(d, id) {
    var tombs = crmTombs(d || {});
    var list = isObj(d) && Array.isArray(d.cust) ? d.cust : [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (isObj(c) && c.id === id) return typeof tombs[id] === "number" && tombs[id] >= (c.m || 0) ? null : { c: c, i: i };
    }
    return null;
  }
  function peopleLine(list) {
    return (Array.isArray(list) ? list : []).map(function (p) { return isObj(p) ? String(p.n || "") + (p.role ? " (" + p.role + ")" : "") : ""; }).filter(Boolean).join(", ");
  }
  // contactsData is read only (the contact's name).
  function linkOne(d, contactsData, L, now) {
    if (!isObj(L) || typeof L.cust !== "string" || !CRM_ID.test(L.cust) || typeof L.c !== "string" || !CREF.test(L.c)) return bad("bad link");
    var h = crmFindAlive(d, L.cust);
    if (!h) return bad("That customer is no longer in CRM.");
    var ct = ctAlive(contactsData).filter(function (x) { return x.id === L.c; })[0];
    if (!ct) return bad("That contact is no longer in Contacts.");
    var name = ctName(ct).slice(0, 80), role = line(L.role, 60);
    var c = clone(h.c), people = Array.isArray(c.people) ? c.people.filter(isObj) : [];
    var before = peopleLine(people);
    if (people.some(function (p) { return p.c === L.c; })) return { ok: true, same: true, title: String(c.name || ""), name: name };
    var at = -1;
    people.forEach(function (p, i) { if (at < 0 && !p.c && fold(p.n) === fold(name)) at = i; });
    if (at >= 0) {
      var q = { c: L.c, n: name };
      if (people[at].role || role) q.role = role || people[at].role;
      people[at] = q;
    } else {
      if (people.length >= CRM_PEOPLE) return bad(String(c.name || "") + " already has " + CRM_PEOPLE + " people, CRM's limit.");
      var r = { c: L.c, n: name };
      if (role) r.role = role;
      people.push(r);
    }
    c.people = people;
    c.m = stampAfter(now, Math.max(h.c.m || 0, typeof crmTombs(d)[c.id] === "number" ? crmTombs(d)[c.id] : 0));
    var prev = h.c;
    c = crmOrder(c);
    d.cust[h.i] = c;
    return { ok: true, title: String(c.name || ""), name: name, rows: [{ f: "people", b: before, a: peopleLine(people) }],
             undo: { prev: clone(prev), next: clone(c) } };
  }
  // → { ok, rows: [{ title, rows, same? }] } (nothing is written)
  function planLinks(crmData, contactsData, links) {
    var d = clone(crmData) || crmEmpty(), out = [];
    for (var i = 0; i < links.length; i++) {
      var r = linkOne(d, contactsData, links[i], 1);
      if (!r.ok) return bad("links[" + i + "]: " + r.err);
      out.push(r.same ? { title: r.title, same: true, name: r.name } : { title: r.title, rows: r.rows, name: r.name });
    }
    return { ok: true, rows: out };
  }
  // skip[i] = the user unticked link i. → { ok, data, undo, done: [i] }
  function applyLinks(crmData, contactsData, links, now, skip) {
    var d = clone(crmData) || crmEmpty(), undos = [], done = [];
    for (var i = 0; i < links.length; i++) {
      if (skip && skip[i]) continue;
      var r = linkOne(d, contactsData, links[i], now);
      if (!r.ok) return bad(r.err);
      if (r.same) continue;
      undos.push(r.undo);
      done.push(i);
    }
    return { ok: true, data: d, done: done, undo: { app: "crm", t: "link", list: undos } };
  }
  function undoLinks(d, u, now) {
    var list = Array.isArray(u.list) ? u.list : [];
    for (var i = 0; i < list.length; i++) {
      var h = crmFindAlive(d, list[i].next && list[i].next.id);
      if (!h) return bad("That customer is no longer in CRM.");
      if (JSON.stringify(h.c) !== JSON.stringify(list[i].next)) return bad("The customer changed since; nothing was undone.");
    }
    for (var j = list.length - 1; j >= 0; j--) {
      var hh = crmFindAlive(d, list[j].next.id), c = clone(list[j].prev);
      c.m = stampAfter(now, hh.c.m);
      d.cust[hh.i] = crmOrder(c);
    }
    return { ok: true, data: d };
  }

  // ---------- 5. Plan, apply, undo ----------
  // items = normItems().items; for crm, each item's contact ref already
  // turned into person { c, n, role? } by the caller.
  function plan(appId, data, items) {
    if (!has(APPS, appId)) return bad("New items can be made only in: " + APP_IDS.join(", ") + ".");
    return appId === "contacts" ? ctPlan(isObj(data) ? data : {}, items) : crmPlan(isObj(data) ? data : null, items);
  }
  // skip[i] = the user unticked item i. → { ok, data, made: [{ i, id,
  // title }], undo }
  function apply(appId, data, items, now, skip) {
    if (!has(APPS, appId)) return bad("unknown app");
    var p = plan(appId, data, items);
    if (!p.ok) return p;
    var d = clone(data);
    return appId === "contacts" ? ctApply(d, items, now, skip) : crmApply(d, items, now, skip);
  }
  function undo(appId, data, u, now) {
    if (!has(APPS, appId) || !isObj(u) || u.app !== appId) return bad("bad undo");
    var d = clone(data) || {};
    if (u.t === "new") return appId === "contacts" ? ctUndo(d, u, now) : crmUndoNew(d, u, now);
    if (u.t === "link" && appId === "crm") return undoLinks(d, u, now);
    return bad("bad undo");
  }
  // The search target of a record this file made (assistant.js keeps
  // it as a ref, as search_data would).
  function targetOf(appId, id) { return appId === "crm" ? { cust: id } : id; }
  function storageKey(appId) { return has(APPS, appId) ? APPS[appId].key : ""; }

  var api = {
    APP_IDS: APP_IDS, MAX_ITEMS: MAX_ITEMS, MAX_LINKS: MAX_LINKS, CT_NOTE: CT_NOTE,
    normItems: normItems, plan: plan, apply: apply, undo: undo,
    planLinks: planLinks, applyLinks: applyLinks,
    targetOf: targetOf, storageKey: storageKey, contactName: ctName
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosAssistCreate = api;
})(typeof window !== "undefined" ? window : this);
