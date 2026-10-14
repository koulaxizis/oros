// ============================================================
// orOS Certificates — core.js (pure, v1.0.0)
// Certificates of attendance, completion, merit, diplomas and the
// like, issued in bulk from a list of people.
//   - data model + strict normalizers + the canonical merge
//   - kinds (ready texts, EN + EL) and looks (styles)
//   - fields: {name}, {title}, {dates}… filled per person; a part in
//     [[ ]] shows only when every field in it has a value
//   - serial numbers: given once, in list order, never reused
//   - list import: pasted text, CSV / TSV, rows from a spreadsheet,
//     Contacts (all or one label), CRM customers (all or one tag)
//   - the register as CSV, file names
// Data (synced slice "certificates", key oros-certificates-data):
//   { ver: 1, evs: [event…], ppl: [person…] (both sorted by id),
//     tombs: { id: deletedAt }, keys? [key…] (since 1.1.0) }
// event (one certificate design + the details of what it is for):
//   { id "e…", m, t, kind, lang en|el, sty, acc, acc2, font serif|sans,
//     size a4|letter, orient l|p, d1, d2, idate (YYYY-MM-DD or ""),
//     place, hours, issuer, txt { sub, head, pre, nm, body, foot, no },
//     sigs [{ n, r, a?, w?, h? }] ≤ 3, logo { a, w, h } | null,
//     seal { a, w, h } | null, medal 0|1, showNo 0|1, pre, next,
//     qr 0|1 (a signed check QR code, since 1.1.0),
//     onlyAt 0|1 (certificates only for people marked present, since 1.2.0) }
// person: { id "p…", m, e (event id), n, n2, em, g, x, no (0 = none),
//   iss (YYYY-MM-DD when numbered), rv 0|1 (revoked), at 0|1 (came,
//   since 1.2.0), o (list order) }
// key (signs the check QR codes, see sign.js): { id "k…", m, made,
//   x, y, d } (JWK parts of an ECDSA P-256 key), ≤ 20, newest made signs
// Merge: LWW per entity by m (equal m: the larger canonical JSON),
// tombstones max-merged, a tombstone wins ties, a newer edit
// resurrects; people of an event that is gone go with it (R5, R17,
// R26). Pictures live on the orOS disk (designkit/assets.js, R30):
// only their ids are stored here.
// Exposes window.CertCore (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.2.0";
  var DATA_VER = 1;
  var DATA_KEY = "oros-certificates-data";
  var PREFS_KEY = "oros-certificates-prefs";

  var LIM = {
    events: 200, people: 5000, perEvent: 2000, sigs: 3,
    title: 200, text: 1200, name: 120, email: 160, grade: 80, extra: 200,
    place: 120, hours: 12, issuer: 160, pre: 20, sigName: 80, sigRole: 80, keys: 20
  };

  var EV_RE = /^e[0-9a-z]{6,24}$/;
  var P_RE = /^p[0-9a-z]{6,24}$/;
  var K_RE = /^k[0-9a-z]{6,24}$/;
  var B64U32_RE = /^[A-Za-z0-9_-]{43}$/;
  var ASSET_RE = /^[0-9a-f]{64}\.(jpg|png)$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var HEX_RE = /^#[0-9a-f]{6}$/;

  var KINDS = ["attend", "complete", "award", "excel", "diploma", "particip", "train", "thanks", "volunteer", "kids"];
  var STYLES = ["classic", "modern", "elegant", "bold", "minimal", "kids"];
  var TXT_KEYS = ["sub", "head", "pre", "nm", "body", "foot", "no"];
  var TOKENS = ["name", "name2", "grade", "extra", "title", "dates", "date", "place", "hours", "issuer", "serial"];

  var STYLE_DEF = {
    classic: { acc: "#8a6d3b", acc2: "#1f3a5f", font: "serif", medal: 1 },
    modern:  { acc: "#1f6feb", acc2: "#7cc4ff", font: "sans",  medal: 0 },
    elegant: { acc: "#b08d57", acc2: "#3d3d3d", font: "serif", medal: 1 },
    bold:    { acc: "#0e4d64", acc2: "#f4a259", font: "sans",  medal: 0 },
    minimal: { acc: "#222222", acc2: "#9a9a9a", font: "sans",  medal: 0 },
    kids:    { acc: "#e8505b", acc2: "#14a3a3", font: "sans",  medal: 1 }
  };
  var KIND_STYLE = {
    attend: "classic", complete: "modern", award: "elegant", excel: "elegant", diploma: "classic",
    particip: "modern", train: "minimal", thanks: "bold", volunteer: "bold", kids: "kids"
  };

  // Ready texts. Greek texts use the name as written (nominative), so
  // no ending has to be guessed; {name2} (another form of the name,
  // e.g. accusative) is there for people who write their own text.
  var COMMON = {
    en: { sub: "{issuer}", nm: "{name}", foot: "[[{place}, ]]{date}", no: "[[Certificate no. {serial}]]" },
    el: { sub: "{issuer}", nm: "{name}", foot: "[[{place}, ]]{date}", no: "[[Αρ. βεβαίωσης {serial}]]" }
  };
  var TEXTS = {
    en: {
      attend: { head: "CERTIFICATE OF ATTENDANCE", pre: "This is to certify that",
        body: "attended the seminar “{title}”[[ ({hours} hours)]][[, held on {dates}]][[ in {place}]]." },
      complete: { head: "CERTIFICATE OF COMPLETION", pre: "This is to certify that",
        body: "has successfully completed the programme “{title}”[[ ({hours} hours)]][[ with grade {grade}]]." },
      award: { head: "CERTIFICATE OF MERIT", pre: "This certificate is awarded to",
        body: "for outstanding performance[[ in the programme “{title}”]][[ ({grade})]]." },
      excel: { head: "AWARD OF EXCELLENCE", pre: "Presented to",
        body: "in recognition of excellent achievement[[ in the programme “{title}”]][[: {grade}]]." },
      diploma: { head: "DIPLOMA", pre: "This is to certify that",
        body: "has fulfilled all the requirements of the programme “{title}”[[ with grade {grade}]] and is awarded this diploma." },
      particip: { head: "CERTIFICATE OF PARTICIPATION", pre: "This is to certify that",
        body: "took part in the event “{title}”[[ on {dates}]][[ in {place}]]." },
      train: { head: "TRAINING CERTIFICATE", pre: "This is to certify that",
        body: "completed the training programme “{title}”[[ ({hours} training hours)]][[ on {dates}]][[ in {place}]]." },
      thanks: { head: "CERTIFICATE OF APPRECIATION", pre: "With sincere thanks to",
        body: "for the valuable contribution[[ to “{title}”]]." },
      volunteer: { head: "VOLUNTEER CERTIFICATE", pre: "This is to certify that",
        body: "offered voluntary service[[ to “{title}”]][[ for {hours} hours]][[ on {dates}]]." },
      kids: { head: "SUPER STAR AWARD", pre: "This award goes to",
        body: "for a wonderful effort[[ in {title}]]!" }
    },
    el: {
      attend: { head: "ΒΕΒΑΙΩΣΗ ΠΑΡΑΚΟΛΟΥΘΗΣΗΣ", pre: "Βεβαιώνεται ότι ο/η",
        body: "παρακολούθησε το σεμινάριο «{title}»[[ διάρκειας {hours} ωρών]][[, που πραγματοποιήθηκε στις {dates}]][[ ({place})]]." },
      complete: { head: "ΠΙΣΤΟΠΟΙΗΤΙΚΟ ΟΛΟΚΛΗΡΩΣΗΣ", pre: "Πιστοποιείται ότι ο/η",
        body: "ολοκλήρωσε με επιτυχία το πρόγραμμα «{title}»[[ διάρκειας {hours} ωρών]][[ με βαθμό {grade}]]." },
      award: { head: "ΕΠΑΙΝΟΣ", pre: "Έπαινο λαμβάνει ο/η",
        body: "για την εξαιρετική επίδοση[[ στο πρόγραμμα «{title}»]][[ ({grade})]]." },
      excel: { head: "ΒΡΑΒΕΙΟ ΑΡΙΣΤΕΙΑΣ", pre: "Το βραβείο αριστείας λαμβάνει ο/η",
        body: "σε αναγνώριση της άριστης επίδοσης[[ στο πρόγραμμα «{title}»]][[: {grade}]]." },
      diploma: { head: "ΔΙΠΛΩΜΑ", pre: "Πιστοποιείται ότι ο/η",
        body: "ολοκλήρωσε όλες τις απαιτήσεις του προγράμματος «{title}»[[ με βαθμό {grade}]] και λαμβάνει το παρόν δίπλωμα." },
      particip: { head: "ΒΕΒΑΙΩΣΗ ΣΥΜΜΕΤΟΧΗΣ", pre: "Βεβαιώνεται ότι ο/η",
        body: "συμμετείχε στην εκδήλωση «{title}»[[ στις {dates}]][[ ({place})]]." },
      train: { head: "ΒΕΒΑΙΩΣΗ ΚΑΤΑΡΤΙΣΗΣ", pre: "Βεβαιώνεται ότι ο/η",
        body: "ολοκλήρωσε το πρόγραμμα κατάρτισης «{title}»[[ ({hours} ώρες κατάρτισης)]][[ στις {dates}]][[ ({place})]]." },
      thanks: { head: "ΕΥΧΑΡΙΣΤΗΡΙΟ", pre: "Με θερμές ευχαριστίες",
        body: "για την πολύτιμη συμβολή σας[[ στο «{title}»]]." },
      volunteer: { head: "ΒΕΒΑΙΩΣΗ ΕΘΕΛΟΝΤΙΚΗΣ ΠΡΟΣΦΟΡΑΣ", pre: "Βεβαιώνεται ότι ο/η",
        body: "προσέφερε εθελοντική εργασία[[ στο «{title}»]][[ για {hours} ώρες]][[ στις {dates}]]." },
      kids: { head: "ΒΡΑΒΕΙΟ ΣΟΥΠΕΡ ΑΣΤΕΡΙ", pre: "Το βραβείο κερδίζει ο/η",
        body: "για την υπέροχη προσπάθεια[[ στο «{title}»]]!" }
    }
  };
  var SIG_ROLE = {
    en: { attend: "Instructor", train: "Instructor", kids: "Teacher", other: "Director" },
    el: { attend: "Εισηγητής/τρια", train: "Εκπαιδευτής/τρια", kids: "Δάσκαλος/α", other: "Διευθυντής/ρια" }
  };

  var MONTHS = {
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    el: ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"]
  };

  // ---------- Small helpers ----------
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function stamp(v) { return isInt(v) && v > 0 ? v : 0; }
  function bit(v, def) { return v === 1 || v === true ? 1 : v === 0 || v === false ? 0 : def; }
  function oneOf(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
  // One line: no control characters, spaces folded.
  function line(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  // Text that may have line breaks (at most 6 lines).
  function text(v, max) {
    if (typeof v !== "string") return "";
    var s = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, " ");
    s = s.split("\n").slice(0, 6).map(function (l) { return l.replace(/[ \t]+/g, " ").trim(); }).join("\n");
    return s.slice(0, max);
  }
  function ymd(v) {
    if (typeof v !== "string") return "";
    var m = YMD_RE.exec(v);
    if (!m) return "";
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCMonth() === mo - 1 ? v : "";
  }
  function hex(v, def) { return typeof v === "string" && HEX_RE.test(v.toLowerCase()) ? v.toLowerCase() : def; }
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function newId(prefix, rand) {
    var r = typeof rand === "function" ? rand : Math.random, s = prefix === "p" || prefix === "k" ? prefix : "e";
    for (var i = 0; i < 12; i++) s += "0123456789abcdefghijklmnopqrstuvwxyz".charAt(Math.floor(r() * 36));
    return s;
  }
  function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }

  // ---------- Normalizers ----------
  function normImg(x) {
    if (!x || typeof x !== "object" || typeof x.a !== "string" || !ASSET_RE.test(x.a)) return null;
    var w = isInt(x.w) && x.w > 0 && x.w <= 20000 ? x.w : 0, h = isInt(x.h) && x.h > 0 && x.h <= 20000 ? x.h : 0;
    if (!w || !h) return null;
    return { a: x.a, w: w, h: h };
  }
  function normSig(x) {
    if (!x || typeof x !== "object") return null;
    var o = { n: line(x.n, LIM.sigName), r: line(x.r, LIM.sigRole) };
    var im = normImg(x);
    if (im) { o.a = im.a; o.w = im.w; o.h = im.h; }
    return o;
  }
  function normEvent(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !EV_RE.test(x.id) || !stamp(x.m)) return null;
    var kind = oneOf(x.kind, KINDS, "attend"), lang = oneOf(x.lang, ["en", "el"], "en");
    var sty = oneOf(x.sty, STYLES, KIND_STYLE[kind]), sd = STYLE_DEF[sty];
    var o = {
      id: x.id, m: x.m, t: line(x.t, LIM.title), kind: kind, lang: lang, sty: sty,
      acc: hex(x.acc, sd.acc), acc2: hex(x.acc2, sd.acc2), font: oneOf(x.font, ["serif", "sans"], sd.font),
      size: oneOf(x.size, ["a4", "letter"], "a4"), orient: oneOf(x.orient, ["l", "p"], "l"),
      d1: ymd(x.d1), d2: ymd(x.d2), idate: ymd(x.idate),
      place: line(x.place, LIM.place), hours: line(x.hours, LIM.hours), issuer: line(x.issuer, LIM.issuer),
      txt: {}, sigs: [], logo: normImg(x.logo), seal: normImg(x.seal),
      medal: bit(x.medal, sd.medal), showNo: bit(x.showNo, 1), qr: bit(x.qr, 0), onlyAt: bit(x.onlyAt, 0),
      pre: line(x.pre, LIM.pre), next: isInt(x.next) && x.next >= 1 && x.next <= 999999 ? x.next : 1
    };
    var tx = x.txt && typeof x.txt === "object" ? x.txt : {};
    TXT_KEYS.forEach(function (k) { o.txt[k] = text(tx[k], LIM.text); });
    (Array.isArray(x.sigs) ? x.sigs : []).slice(0, LIM.sigs).forEach(function (s) {
      var n = normSig(s);
      if (n) o.sigs.push(n);
    });
    return o;
  }
  function normPerson(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !P_RE.test(x.id) || !stamp(x.m)) return null;
    if (typeof x.e !== "string" || !EV_RE.test(x.e)) return null;
    var n = line(x.n, LIM.name);
    if (!n) return null;
    var o = { id: x.id, m: x.m, e: x.e, n: n };
    var n2 = line(x.n2, LIM.name); if (n2) o.n2 = n2;
    var em = line(x.em, LIM.email); if (em) o.em = em;
    var g = line(x.g, LIM.grade); if (g) o.g = g;
    var xx = line(x.x, LIM.extra); if (xx) o.x = xx;
    if (isInt(x.no) && x.no >= 1 && x.no <= 999999) { o.no = x.no; var iss = ymd(x.iss); if (iss) o.iss = iss; }
    if (bit(x.rv, 0)) o.rv = 1;
    if (bit(x.at, 0)) o.at = 1;
    o.o = typeof x.o === "number" && isFinite(x.o) && x.o >= 0 ? Math.floor(x.o) : 0;
    return o;
  }

  // A signing key for the check QR codes (wave 2, 1.99.00): the JWK
  // parts of an ECDSA P-256 key. Kept in the synced data (encrypted by
  // orOS sync), so every device signs with the same key.
  function normKey(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !K_RE.test(x.id) || !stamp(x.m)) return null;
    if (!B64U32_RE.test(x.x) || !B64U32_RE.test(x.y) || !B64U32_RE.test(x.d) || !stamp(x.made)) return null;
    return { id: x.id, m: x.m, made: x.made, x: x.x, y: x.y, d: x.d };
  }

  // ---------- Merge ----------
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  // merge(A, B) with B optional: also the normalizer.
  function merge(A, B) {
    var a = A && typeof A === "object" ? A : {}, b = B && typeof B === "object" ? B : {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (k) {
        if (!(EV_RE.test(k) || P_RE.test(k) || K_RE.test(k)) || !stamp(tm[k])) return;
        if (!(k in tombs) || tm[k] > tombs[k]) tombs[k] = tm[k];
      });
    });
    function pick(lists, norm) {
      var best = {};
      lists.forEach(function (list) {
        (Array.isArray(list) ? list : []).forEach(function (x) {
          var n = norm(x);
          if (n) best[n.id] = newer(best[n.id], n);
        });
      });
      var out = [];
      Object.keys(best).sort(cmpStr).forEach(function (k) {
        if (k in tombs && tombs[k] >= best[k].m) return;
        out.push(best[k]);
      });
      return out;
    }
    var evs = pick([a.evs, b.evs], normEvent);
    var alive = {};
    evs.forEach(function (e) { alive[e.id] = 1; });
    var ppl = pick([a.ppl, b.ppl], normPerson).filter(function (p) { return alive[p.e]; });
    var keys = pick([a.keys, b.keys], normKey).slice(-LIM.keys);
    var t = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (k) { t[k] = tombs[k]; });
    var out = { ver: DATA_VER, evs: evs, ppl: ppl, tombs: t };
    if (keys.length) out.keys = keys;
    return out;
  }
  function empty() { return { ver: DATA_VER, evs: [], ppl: [], tombs: {} }; }
  // The key that signs new check codes: the newest one made. Older
  // keys stay, so certificates they signed still show their fingerprint.
  function activeKey(data) {
    var best = null;
    (data.keys || []).forEach(function (k) {
      if (!best || k.made > best.made || (k.made === best.made && k.id > best.id)) best = k;
    });
    return best;
  }
  function putKey(data, k, now) {
    var n = normKey({ id: k.id, m: now, made: k.made || now, x: k.x, y: k.y, d: k.d });
    if (!n) return { data: data, ok: false };
    var keys = (data.keys || []).filter(function (x) { return x.id !== n.id; }).concat([n]);
    return { data: merge({ ver: DATA_VER, evs: data.evs, ppl: data.ppl, tombs: data.tombs, keys: keys }, null), ok: true };
  }
  // The fields a check code carries for one person.
  function checkFields(ev, p) {
    var map = fields(ev, p || {});
    return {
      no: p && p.no ? serial(ev, p.no) : "", n: p ? p.n || "" : "", t: ev.t, dates: map.dates,
      issuer: ev.issuer, idate: (p && p.iss) || ev.idate, place: ev.place, hours: ev.hours,
      g: p ? p.g || "" : "", lang: ev.lang
    };
  }
  function parse(raw) {
    if (typeof raw !== "string" || !raw) return empty();
    try { return merge(JSON.parse(raw), null); } catch (e) { return empty(); }
  }
  function eventById(data, id) {
    for (var i = 0; i < data.evs.length; i++) if (data.evs[i].id === id) return data.evs[i];
    return null;
  }
  function personById(data, id) {
    for (var i = 0; i < data.ppl.length; i++) if (data.ppl[i].id === id) return data.ppl[i];
    return null;
  }
  // The people of an event in list order.
  function eventPeople(data, evId) {
    return data.ppl.filter(function (p) { return p.e === evId; }).sort(function (a, b) {
      return a.o !== b.o ? a.o - b.o : cmpStr(a.id, b.id);
    });
  }
  function countPeople(data, evId) {
    var n = 0;
    data.ppl.forEach(function (p) { if (p.e === evId) n++; });
    return n;
  }
  // Events, newest first.
  function eventList(data) {
    return data.evs.slice().sort(function (a, b) { return b.m - a.m || cmpStr(a.id, b.id); });
  }

  // ---------- Kinds, styles, new events ----------
  function kindTexts(lang, kind) {
    var c = COMMON[lang] || COMMON.en, k = (TEXTS[lang] || TEXTS.en)[kind] || TEXTS.en.attend;
    return { sub: c.sub, head: k.head, pre: k.pre, nm: c.nm, body: k.body, foot: c.foot, no: c.no };
  }
  function sigRole(lang, kind) {
    var r = SIG_ROLE[lang] || SIG_ROLE.en;
    return r[kind] || r.other;
  }
  function blankEvent(id, now, lang, kind, today) {
    lang = lang === "el" ? "el" : "en";
    kind = oneOf(kind, KINDS, "attend");
    var sty = KIND_STYLE[kind], sd = STYLE_DEF[sty];
    var day = ymd(today) || "";
    var year = day ? day.slice(0, 4) : String(new Date(now).getFullYear());
    return normEvent({
      id: id, m: now, t: "", kind: kind, lang: lang, sty: sty, acc: sd.acc, acc2: sd.acc2, font: sd.font,
      size: "a4", orient: "l", d1: day, d2: "", idate: day, place: "", hours: "", issuer: "",
      txt: kindTexts(lang, kind), sigs: [{ n: "", r: sigRole(lang, kind) }], logo: null, seal: null,
      medal: sd.medal, showNo: 1, pre: "CERT-" + year + "-", next: 1
    });
  }
  // Another kind: its ready texts (in the event's language).
  function applyKind(ev, kind) {
    var e = copy(ev);
    e.kind = oneOf(kind, KINDS, e.kind);
    e.txt = kindTexts(e.lang, e.kind);
    return e;
  }
  function applyLang(ev, lang) {
    var e = copy(ev);
    e.lang = lang === "el" ? "el" : "en";
    e.txt = kindTexts(e.lang, e.kind);
    e.sigs.forEach(function (s) {
      ["en", "el"].forEach(function (l) {
        Object.keys(SIG_ROLE[l]).forEach(function (k) { if (s.r === SIG_ROLE[l][k]) s.r = sigRole(e.lang, k === "other" ? e.kind : k); });
      });
    });
    return e;
  }
  // Another look: its colours, font and medal.
  function applyStyle(ev, sty) {
    var e = copy(ev), sd = STYLE_DEF[oneOf(sty, STYLES, e.sty)];
    e.sty = oneOf(sty, STYLES, e.sty);
    e.acc = sd.acc; e.acc2 = sd.acc2; e.font = sd.font; e.medal = sd.medal;
    return e;
  }
  // The texts differ from the kind's ready ones.
  function textsEdited(ev) {
    var k = kindTexts(ev.lang, ev.kind);
    return TXT_KEYS.some(function (key) { return (ev.txt[key] || "") !== k[key]; });
  }

  // ---------- Edits ----------
  function sortById(list) { return list.sort(function (a, b) { return cmpStr(a.id, b.id); }); }
  function putEvent(data, ev, now) {
    var e = copy(ev);
    e.m = Math.max(now, (eventById(data, e.id) || { m: 0 }).m + 1);
    var n = normEvent(e);
    if (!n) return { ok: false, why: "bad" };
    var exists = !!eventById(data, n.id);
    if (!exists && data.evs.length >= LIM.events) return { ok: false, why: "full" };
    var d = copy(data);
    d.evs = sortById(d.evs.filter(function (x) { return x.id !== n.id; }).concat([n]));
    delete d.tombs[n.id];
    return { ok: true, data: d, ev: n };
  }
  function removeEvent(data, id, now) {
    var d = copy(data);
    if (!eventById(d, id)) return d;
    d.tombs[id] = Math.max(now, eventById(d, id).m);
    d.ppl.forEach(function (p) { if (p.e === id) d.tombs[p.id] = Math.max(now, p.m); });
    return merge(d, null);
  }
  // Batch put of whole person records (already edited by the caller).
  function putPeople(data, list, now) {
    var d = copy(data), byId = {};
    d.ppl.forEach(function (p, i) { byId[p.id] = i; });
    var added = 0, over = 0, out = [];
    list.forEach(function (x) {
      var p = copy(x);
      var old = byId[p.id] !== undefined ? d.ppl[byId[p.id]] : null;
      p.m = Math.max(now, old ? old.m + 1 : 0);
      var n = normPerson(p);
      if (!n || !eventById(d, n.e)) return;
      if (old) { d.ppl[byId[n.id]] = n; out.push(n); return; }
      if (d.ppl.length >= LIM.people || countPeople(d, n.e) >= LIM.perEvent) { over++; return; }
      byId[n.id] = d.ppl.length;
      d.ppl.push(n);
      delete d.tombs[n.id];
      added++;
      out.push(n);
    });
    sortById(d.ppl);
    return { data: d, added: added, over: over, people: out };
  }
  function removePeople(data, ids, now) {
    var d = copy(data), set = {};
    ids.forEach(function (id) { set[id] = 1; });
    d.ppl.forEach(function (p) { if (set[p.id]) d.tombs[p.id] = Math.max(now, p.m); });
    return merge(d, null);
  }
  // New people from imported rows: same name + email as someone
  // already on the list → skipped (dup).
  function importPeople(data, evId, rows, now, rand) {
    var have = {};
    eventPeople(data, evId).forEach(function (p) { have[fold(p.n) + "|" + fold(p.em || "")] = 1; });
    var order = 0;
    data.ppl.forEach(function (p) { if (p.e === evId && p.o >= order) order = p.o + 1; });
    order = Math.max(order, now * 10);
    var list = [], dup = 0;
    rows.forEach(function (r) {
      var n = line(r.n, LIM.name);
      if (!n) return;
      var key = fold(n) + "|" + fold(r.em || "");
      if (have[key]) { dup++; return; }
      have[key] = 1;
      list.push({ id: newId("p", rand), m: now, e: evId, n: n, n2: r.n2, em: r.em, g: r.g, x: r.x, o: order++ });
    });
    var res = putPeople(data, list, now);
    return { data: res.data, added: res.added, dup: dup, over: res.over };
  }

  // ---------- Attendance (wave 3) ----------
  // Mark people present (at = 1) or not; ids = null → everyone of the event.
  function setAttended(data, evId, ids, on, now) {
    var want = null;
    if (Array.isArray(ids)) { want = {}; ids.forEach(function (id) { want[id] = 1; }); }
    var list = eventPeople(data, evId).filter(function (p) {
      return (!want || want[p.id]) && !!p.at !== !!on;
    }).map(function (p) { var c = copy(p); if (on) c.at = 1; else delete c.at; return c; });
    if (!list.length) return { data: data, n: 0 };
    var r = putPeople(data, list, now);
    return { data: r.data, n: r.people.length };
  }
  function countAttended(data, evId) {
    var n = 0;
    data.ppl.forEach(function (p) { if (p.e === evId && p.at) n++; });
    return n;
  }
  // The days of an event (d1..d2, at most 7) for the sign-in sheet;
  // one day when only d1 (or nothing) is set.
  function eventDays(ev) {
    var a = ymd(ev.d1), b = ymd(ev.d2) || a;
    if (!a) return [""];
    var out = [], d = new Date(a + "T12:00:00Z"), end = new Date(b + "T12:00:00Z");
    if (!(end >= d)) return [a];
    while (d <= end && out.length < 7) {
      out.push(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() + 864e5);
    }
    return out;
  }

  // ---------- Numbers ----------
  function serial(ev, no) { return no ? (ev.pre || "") + pad(no, 4) : ""; }
  function maxNo(data, evId) {
    var m = 0;
    data.ppl.forEach(function (p) { if (p.e === evId && p.no > m) m = p.no; });
    return m;
  }
  // Numbers for the people (ids, or everyone) who have none yet, in
  // list order, from max(next, highest number + 1). The event keeps
  // the next free number.
  function issue(data, evId, ids, now, today) {
    var ev = eventById(data, evId);
    if (!ev) return { data: data, n: 0 };
    var want = null;
    if (Array.isArray(ids)) { want = {}; ids.forEach(function (id) { want[id] = 1; }); }
    var next = Math.max(ev.next, maxNo(data, evId) + 1), list = [];
    eventPeople(data, evId).forEach(function (p) {
      if (p.no || (want && !want[p.id]) || next > 999999) return;
      var c = copy(p);
      c.no = next++;
      c.iss = ymd(today) || "";
      list.push(c);
    });
    if (!list.length) return { data: data, n: 0 };
    var r = putPeople(data, list, now);
    var e = copy(eventById(r.data, evId));
    e.next = Math.min(999999, next);
    var pe = putEvent(r.data, e, now);
    return { data: pe.ok ? pe.data : r.data, n: list.length };
  }
  // Numbers that two people of the event share (two devices issued
  // at the same time): [no…] ascending.
  function dupNumbers(data, evId) {
    var seen = {}, dups = {};
    data.ppl.forEach(function (p) {
      if (p.e !== evId || !p.no) return;
      if (seen[p.no]) dups[p.no] = 1;
      seen[p.no] = 1;
    });
    return Object.keys(dups).map(Number).sort(function (a, b) { return a - b; });
  }
  // A fresh number for one person (the later of a shared pair).
  function renumber(data, evId, personId, now, today) {
    var p = personById(data, personId);
    if (!p || p.e !== evId) return { data: data, n: 0 };
    var c = copy(p);
    delete c.no; delete c.iss;
    var r = putPeople(data, [c], now);
    return issue(r.data, evId, [personId], now + 1, today);
  }

  // ---------- Dates ----------
  function partsOf(v) { var m = YMD_RE.exec(v || ""); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  function fmtDate(v, lang) {
    var p = partsOf(ymd(v));
    if (!p) return "";
    var mo = (MONTHS[lang] || MONTHS.en)[p.m - 1];
    return p.d + " " + mo + " " + p.y;
  }
  function fmtRange(d1, d2, lang) {
    var a = partsOf(ymd(d1)), b = partsOf(ymd(d2));
    if (!a && !b) return "";
    if (!a || !b || (a.y === b.y && a.m === b.m && a.d === b.d)) return fmtDate(a ? d1 : d2, lang);
    if (d2 < d1) { var t = a; a = b; b = t; }
    var M = MONTHS[lang] || MONTHS.en;
    if (a.y === b.y && a.m === b.m) return a.d + "–" + b.d + " " + M[a.m - 1] + " " + a.y;
    if (a.y === b.y) return a.d + " " + M[a.m - 1] + " – " + b.d + " " + M[b.m - 1] + " " + a.y;
    return fmtDate(a.y + "-" + pad(a.m, 2) + "-" + pad(a.d, 2), lang) + " – " + fmtDate(b.y + "-" + pad(b.m, 2) + "-" + pad(b.d, 2), lang);
  }

  // ---------- Fields ----------
  // The values of the fields for one person (or a sample person).
  function fields(ev, p) {
    p = p || {};
    var lang = ev.lang;
    return {
      name: p.n || "", name2: p.n2 || p.n || "", grade: p.g || "", extra: p.x || "",
      title: ev.t || "", dates: fmtRange(ev.d1, ev.d2, lang), date: fmtDate(ev.idate, lang),
      place: ev.place || "", hours: ev.hours || "", issuer: ev.issuer || "",
      serial: p.no ? serial(ev, p.no) : ""
    };
  }
  function tokenRe() { return /\{([a-z0-9]+)\}/g; }
  // Fill a text: a [[ part ]] shows only when every known field in it
  // has a value; known fields are replaced, anything else stays as typed.
  function fill(s, map) {
    s = String(s || "");
    function has(k) { return Object.prototype.hasOwnProperty.call(map, k); }
    s = s.replace(/\[\[([\s\S]*?)\]\]/g, function (m, inner) {
      var ok = true;
      inner.replace(tokenRe(), function (t, k) { if (has(k) && !String(map[k] || "").trim()) ok = false; return t; });
      return ok ? inner : "";
    });
    return s.replace(tokenRe(), function (t, k) { return has(k) ? String(map[k] || "") : t; });
  }
  // The fields a text uses (known ones only).
  function usedFields(s) {
    var out = {};
    String(s || "").replace(tokenRe(), function (t, k) { if (TOKENS.indexOf(k) >= 0) out[k] = 1; return t; });
    return Object.keys(out);
  }
  // Fields the design uses that are empty for this event (by the
  // event's own details; per-person fields are counted separately).
  function missing(ev, people) {
    var used = {};
    TXT_KEYS.forEach(function (k) {
      if (k === "no" && !ev.showNo) return;
      // a field inside [[ ]] is optional
      var plain = String(ev.txt[k] || "").replace(/\[\[[\s\S]*?\]\]/g, "");
      usedFields(plain).forEach(function (f) { used[f] = 1; });
    });
    var f = fields(ev, null), out = [];
    ["title", "dates", "date", "place", "hours", "issuer"].forEach(function (k) { if (used[k] && !f[k]) out.push(k); });
    var list = people || [];
    if (used.grade && list.some(function (p) { return !p.g; })) out.push("grade");
    if (used.extra && list.some(function (p) { return !p.x; })) out.push("extra");
    if (used.serial && list.some(function (p) { return !p.no; })) out.push("serial");
    return out;
  }

  // ---------- Tables (paste, CSV, spreadsheet rows) ----------
  function parseTable(text) {
    text = String(text || "").replace(/^\uFEFF/, "");
    // The separator is judged on the first lines, not only the first:
    // a list of names with no header may have its emails further down.
    var head = text.split(/\r?\n/).slice(0, 20);
    var c = { ",": 1, ";": 1, "\t": 1 };
    head.forEach(function (ln) {
      [",", ";", "\t"].forEach(function (k) { c[k] = Math.max(c[k], ln.split(k).length); });
    });
    var sep = c["\t"] > 1 && c["\t"] >= c[","] && c["\t"] >= c[";"] ? "\t" : c[";"] > c[","] ? ";" : ",";
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
        continue;
      }
      if (ch === '"' && cell === "") { q = true; continue; }
      if (ch === sep) { row.push(cell); cell = ""; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
        if (rows.length > LIM.perEvent + 1) break;
        continue;
      }
      cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map(function (r) { return r.map(function (x) { return String(x).trim(); }); })
      .filter(function (r) { return r.some(function (x) { return x; }); });
  }
  // Header names (EN + EL, folded) → field keys.
  var HEAD = {
    n: ["name", "full name", "fullname", "participant", "student", "ονοματεπωνυμο", "ονοματεπωνυμο συμμετεχοντα", "συμμετεχων", "συμμετεχουσα", "μαθητης", "μαθητρια"],
    first: ["first name", "firstname", "given name", "given", "first", "ονομα"],
    last: ["last name", "lastname", "surname", "family name", "family", "last", "επωνυμο"],
    n2: ["name 2", "name2", "other form", "accusative", "name (accusative)", "αιτιατικη", "ονομα σε αιτιατικη", "ονοματεπωνυμο σε αιτιατικη", "γενικη"],
    em: ["email", "e-mail", "mail", "email address", "ηλ. ταχυδρομειο", "ηλεκτρονικο ταχυδρομειο"],
    g: ["grade", "score", "mark", "distinction", "result", "βαθμος", "βαθμολογια", "διακριση", "αποτελεσμα"],
    x: ["note", "notes", "extra", "comment", "σημειωση", "σημειωσεις", "σχολιο", "επιπλεον"]
  };
  function headKey(h) {
    var f = fold(h).replace(/[*:]+$/, "").trim();
    var keys = Object.keys(HEAD);
    for (var i = 0; i < keys.length; i++) if (HEAD[keys[i]].indexOf(f) >= 0) return keys[i];
    return "";
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // rows (arrays of cells) → { people: [{ n, n2, em, g, x }], cols, header }
  function rowsToPeople(rows) {
    rows = (rows || []).filter(function (r) { return Array.isArray(r) && r.some(function (c) { return String(c == null ? "" : c).trim(); }); })
      .map(function (r) { return r.map(function (c) { return c == null ? "" : String(c); }); });
    if (!rows.length) return { people: [], cols: [], header: false };
    var map = {};
    rows[0].forEach(function (h, i) { var k = headKey(h); if (k && map[k] === undefined) map[k] = i; });
    // "Όνομα" alone is the whole name; next to "Επώνυμο" it is the first name
    if (map.first !== undefined && map.last === undefined && map.n === undefined) { map.n = map.first; delete map.first; }
    var header = map.n !== undefined || map.first !== undefined || map.last !== undefined;
    var body = rows;
    if (header) body = rows.slice(1);
    else {
      // no header: name first; a cell that looks like an email is the email
      map = { n: 0 };
      var w = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      for (var c = 1; c < w; c++) {
        if (rows.every(function (r) { return !r[c] || EMAIL_RE.test(r[c].trim()); })) { if (map.em === undefined) map.em = c; }
        else if (map.g === undefined) map.g = c;
      }
    }
    var cell = function (r, k, max) { return map[k] === undefined ? "" : line(r[map[k]] || "", max); };
    var people = [];
    body.forEach(function (r) {
      var n = cell(r, "n", LIM.name);
      if (!n) n = line([cell(r, "first", LIM.name), cell(r, "last", LIM.name)].filter(Boolean).join(" "), LIM.name);
      if (!n || people.length >= LIM.perEvent) return;
      var em = cell(r, "em", LIM.email);
      people.push({ n: n, n2: cell(r, "n2", LIM.name), em: EMAIL_RE.test(em) ? em : "", g: cell(r, "g", LIM.grade), x: cell(r, "x", LIM.extra) });
    });
    var cols = Object.keys(map).filter(function (k) { return k !== "first" && k !== "last"; });
    if (map.first !== undefined || map.last !== undefined) cols.push("n");
    cols = cols.filter(function (k, i) { return cols.indexOf(k) === i; }).sort();
    return { people: people, cols: cols, header: header };
  }

  // ---------- Other orOS apps (read only) ----------
  // Contacts: { labels:[{id,name}], contacts:[…], deleted:[{id}] }
  function contactLabels(o) {
    if (!o || !Array.isArray(o.labels)) return [];
    return o.labels.filter(function (l) { return l && typeof l.id === "string" && typeof l.name === "string" && l.name.trim(); })
      .map(function (l) { return { id: l.id, name: line(l.name, 60) }; });
  }
  function contactsPeople(o, labelId) {
    if (!o || !Array.isArray(o.contacts)) return [];
    var gone = {};
    (Array.isArray(o.deleted) ? o.deleted : []).forEach(function (x) { if (x && x.id) gone[x.id] = 1; });
    var out = [];
    o.contacts.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || gone[c.id] || c.del) return;
      if (labelId && !(Array.isArray(c.labelIds) && c.labelIds.indexOf(labelId) >= 0)) return;
      var s = function (v) { return typeof v === "string" ? v : ""; };
      var n = line([s(c.given), s(c.middle), s(c.family)].filter(Boolean).join(" "), LIM.name) || line(s(c.nickname), LIM.name);
      if (!n) return;
      var em = Array.isArray(c.emails) ? c.emails.filter(function (e) { return e && typeof e.v === "string" && EMAIL_RE.test(e.v.trim()); })[0] : null;
      out.push({ n: n, em: em ? line(em.v, LIM.email) : "", ref: c.id });
    });
    return out.sort(function (a, b) { return a.n.localeCompare(b.n); });
  }
  // CRM: { cust:[{id,m,name,kind,email,tags,…}], tags:[{id,name}], tombs }
  function crmTags(o) {
    if (!o || !Array.isArray(o.tags)) return [];
    var tm = o.tombs && typeof o.tombs === "object" ? o.tombs : {};
    return o.tags.filter(function (t) { return t && typeof t.id === "string" && typeof t.name === "string" && !(tm[t.id] >= t.m); })
      .map(function (t) { return { id: t.id, name: line(t.name, 60) }; });
  }
  function crmPeople(o, tagId) {
    if (!o || !Array.isArray(o.cust)) return [];
    var tm = o.tombs && typeof o.tombs === "object" ? o.tombs : {};
    var out = [];
    o.cust.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || (tm[c.id] && tm[c.id] >= c.m)) return;
      if (tagId && !(Array.isArray(c.tags) && c.tags.indexOf(tagId) >= 0)) return;
      var n = line(c.name, LIM.name);
      if (!n) return;
      var em = line(c.email, LIM.email);
      out.push({ n: n, em: EMAIL_RE.test(em) ? em : "", ref: c.id, co: c.kind !== "person" });
    });
    return out.sort(function (a, b) { return a.n.localeCompare(b.n); });
  }

  // ---------- Register (CSV) ----------
  function csvCell(v) {
    var s = String(v == null ? "" : v);
    // a cell a spreadsheet would run as a formula starts with '
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function registerCsv(data, evId, lang) {
    var ev = eventById(data, evId);
    if (!ev) return "";
    var H = lang === "el"
      ? ["Αριθμός", "Ονοματεπώνυμο", "Άλλη μορφή ονόματος", "Email", "Βαθμός", "Επιπλέον", "Ημερομηνία αρίθμησης", "Ανακλήθηκε"]
      : ["Number", "Name", "Other form of the name", "Email", "Grade", "Extra", "Numbered on", "Revoked"];
    var yes = lang === "el" ? "ναι" : "yes";
    var out = [H.map(csvCell).join(",")];
    eventPeople(data, evId).forEach(function (p) {
      out.push([serial(ev, p.no), p.n, p.n2 || "", p.em || "", p.g || "", p.x || "", p.iss || "", p.rv ? yes : ""].map(csvCell).join(","));
    });
    return "\uFEFF" + out.join("\r\n") + "\r\n";
  }
  // A file name from a label: letters, digits, - and _ (Greek kept).
  function fileStem(s, fallback) {
    var n = String(s || "").normalize("NFC").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "").slice(0, 60);
    return n || fallback || "certificate";
  }
  // Unique names inside one ZIP: "Name.pdf", "Name-2.pdf"…
  function uniqueNames(names) {
    var seen = {};
    return names.map(function (n) {
      var key = n.toLowerCase(), base = n.replace(/\.[^.]+$/, ""), ext = (n.match(/\.[^.]+$/) || [""])[0], k = 1;
      while (seen[key]) { k++; n = base + "-" + k + ext; key = n.toLowerCase(); }
      seen[key] = 1;
      return n;
    });
  }

  // ---------- Prefs (this device only) ----------
  function normPrefs(p) {
    p = p && typeof p === "object" ? p : {};
    return {
      cur: typeof p.cur === "string" && EV_RE.test(p.cur) ? p.cur : "",
      tab: oneOf(p.tab, ["design", "people", "issue"], "design")
    };
  }

  var api = {
    VERSION: VERSION, DATA_VER: DATA_VER, DATA_KEY: DATA_KEY, PREFS_KEY: PREFS_KEY, LIM: LIM,
    KINDS: KINDS, STYLES: STYLES, STYLE_DEF: STYLE_DEF, KIND_STYLE: KIND_STYLE, TXT_KEYS: TXT_KEYS, TOKENS: TOKENS,
    EV_RE: EV_RE, P_RE: P_RE, ASSET_RE: ASSET_RE,
    normEvent: normEvent, normPerson: normPerson, normImg: normImg, normKey: normKey, merge: merge, empty: empty, parse: parse,
    activeKey: activeKey, putKey: putKey, checkFields: checkFields, K_RE: K_RE,
    setAttended: setAttended, countAttended: countAttended, eventDays: eventDays,
    eventById: eventById, personById: personById, eventPeople: eventPeople, countPeople: countPeople, eventList: eventList,
    kindTexts: kindTexts, sigRole: sigRole, blankEvent: blankEvent, applyKind: applyKind, applyLang: applyLang,
    applyStyle: applyStyle, textsEdited: textsEdited,
    putEvent: putEvent, removeEvent: removeEvent, putPeople: putPeople, removePeople: removePeople, importPeople: importPeople,
    serial: serial, maxNo: maxNo, issue: issue, dupNumbers: dupNumbers, renumber: renumber,
    fmtDate: fmtDate, fmtRange: fmtRange, fields: fields, fill: fill, usedFields: usedFields, missing: missing,
    parseTable: parseTable, rowsToPeople: rowsToPeople, contactLabels: contactLabels, contactsPeople: contactsPeople,
    crmTags: crmTags, crmPeople: crmPeople, registerCsv: registerCsv, fileStem: fileStem, uniqueNames: uniqueNames,
    normPrefs: normPrefs, newId: newId, fold: fold, line: line, text: text, ymd: ymd
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CertCore = api;
})(typeof window !== "undefined" ? window : this);
