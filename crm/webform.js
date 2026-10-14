// ============================================================
// orOS CRM — web form (crm/webform.js, window.OrosCrmWebForm)
// A contact form the user pastes into their own website. A visitor's
// message goes to the orOS relay (POST /crm/f/<k>, relay/crmform.js),
// which keeps it only encrypted for this form, at most 30 days, until
// CRM picks it up with the relay's "crmf" op (pull, then ack = delete)
// and opens it on the device. Each message becomes a lead with source
// "Web form" and a "Message" history entry; an e-mail CRM already has
// (a customer's or one of its people's) only gets the history entry.
// Data: the synced record data.wf (crm/core.js normWf): k, sec and the
// RSA private key, like Newsletter's list forms (they only guard
// messages that become this CRM's own data, so they travel with it;
// another device can show the HTML and take over the collecting).
// wf.dev = the device that collects. Device-local "oros-crm-wf"
// { dev, last }: this device's id and its last check (never synced).
// Pure part (Node-tested, tests/crm-webform.test.js): snippet, apply,
// cleanLead, validBack. The rest needs a browser.
// ============================================================
(function (root) {
  "use strict";

  var DEV_KEY = "oros-crm-wf";
  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis-25b.workers.dev";   // = mail.js, newsletter/engine.js
  var CALL_TIMEOUT = 45000;
  var AUTO_EVERY = 10 * 60 * 1000;    // a check on opening CRM, at most this often
  var MAX_PAGES = 10;                 // pulls per check (100 messages each)
  var DAY_MS = 86400000;

  // ---------- pure ----------
  var FORM_WORDS = {
    en: { name: "Name", email: "Email", phone: "Phone", company: "Company", message: "Message", send: "Send" },
    el: { name: "Όνομα", email: "Email", phone: "Τηλέφωνο", company: "Εταιρεία", message: "Μήνυμα", send: "Αποστολή" }
  };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; });
  }
  function validBack(v) {
    var s = String(v || "").trim();
    return s === "" || (s.length <= 300 && /^https:\/\/[^\s<>"'@]+$/i.test(s));
  }
  // The HTML for the user's site: a plain form, no script, the hidden
  // honeypot field, the form's language for the relay's page.
  function snippet(wf, relay, lang) {
    if (!wf || wf.off || !wf.k) return "";
    var L = lang === "el" ? "el" : "en", w = FORM_WORDS[L];
    var row = function (label, input) { return "  <p><label>" + esc(label) + "<br>" + input + "</label></p>\n"; };
    return "<form method=\"post\" action=\"" + esc(relay + "/crm/f/" + wf.k) + "\" accept-charset=\"utf-8\">\n" +
      row(w.name, "<input type=\"text\" name=\"name\" maxlength=\"200\" autocomplete=\"name\">") +
      row(w.email, "<input type=\"email\" name=\"email\" required maxlength=\"200\" autocomplete=\"email\">") +
      row(w.phone, "<input type=\"tel\" name=\"phone\" maxlength=\"200\" autocomplete=\"tel\">") +
      row(w.company, "<input type=\"text\" name=\"company\" maxlength=\"200\" autocomplete=\"organization\">") +
      row(w.message, "<textarea name=\"message\" maxlength=\"2000\" rows=\"5\"></textarea>") +
      "  <input type=\"hidden\" name=\"lang\" value=\"" + L + "\">\n" +
      "  <div style=\"position:absolute;left:-5000px\" aria-hidden=\"true\"><input type=\"text\" name=\"website\" tabindex=\"-1\" autocomplete=\"off\"></div>\n" +
      "  <button type=\"submit\">" + esc(w.send) + "</button>\n" +
      "</form>";
  }
  // One opened message { e, n?, p?, c?, m?, l, t } → clean fields, or
  // null when the e-mail is not one.
  function cleanLead(Core, o, now) {
    if (!o || typeof o !== "object") return null;
    var ml = Core.mailLog({ email: o.e });
    if (!ml) return null;
    var at = typeof o.t === "number" && o.t > 0 && o.t <= now + DAY_MS && Math.floor(o.t) === o.t ? o.t : now;
    return { email: ml.email, name: Core.cleanText(o.n, 120), phone: Core.cleanText(o.p, 40),
             company: Core.cleanText(o.c, 120), msg: Core.cleanText(o.m, 2000, true), at: at };
  }
  // Messages → rows in `data` (changed in place; the caller commits).
  // o: { now, stamp(prev) → m, src, words: { name, phone, company, noMsg }, emailOf? }
  // → { added, merged, same, over, bad, ids: [new row ids] }
  function apply(Core, data, leads, o) {
    var r = { added: 0, merged: 0, same: 0, over: 0, bad: 0, ids: [] };
    (leads || []).forEach(function (raw) {
      var x = cleanLead(Core, raw, o.now);
      if (!x) { r.bad++; return; }
      var c = Core.custByEmail(data, x.email, o.emailOf), extra = [];
      if (c) {
        // what the visitor gave that the customer's record may not show
        var known = [c.name].concat((c.people || []).map(function (p) { return p.n; })).map(Core.fold);
        if (x.name && known.indexOf(Core.fold(x.name)) < 0) extra.push(o.words.name + ": " + x.name);
        if (x.phone) extra.push(o.words.phone + ": " + x.phone);
        if (x.company && Core.fold(x.company) !== Core.fold(c.name)) extra.push(o.words.company + ": " + x.company);
      }
      var text = Core.cleanText([x.msg || o.words.noMsg].concat(extra.length ? ["", extra.join("\n")] : []).join("\n"), 2000, true);
      // the same message twice (a pull repeated after a failed ack) is skipped
      if (c && data.acts.some(function (a) { return a.cust === c.id && a.at === x.at && a.text === text; })) { r.same++; return; }
      if (data.acts.length >= Core.LIMITS.acts || (!c && data.cust.length >= Core.LIMITS.cust)) { r.over++; return; }
      if (!c) {
        var who = x.name || x.email;
        var nc = x.company
          ? { kind: "co", name: x.company, people: [{ c: "", n: who, email: x.email, phone: x.phone }] }
          : { kind: "person", name: who, email: x.email, phone: x.phone };
        nc.id = Core.newId(o.now);
        nc.m = o.stamp(null);
        nc.st = "lead";
        nc.src = o.src;
        nc.ct = x.at;
        c = Core.normCust(nc);
        if (!c) { r.bad++; return; }
        data.cust.push(c);
        r.ids.push(c.id);
        r.added++;
      } else r.merged++;
      var act = Core.normAct({ id: Core.newId(o.now), m: o.stamp(null), cust: c.id, k: "msg", at: x.at, text: text, who: x.name });
      if (act) { data.acts.push(act); r.ids.push(act.id); }
    });
    return r;
  }
  // Mail's relay address (Mail › Settings), else orOS's own.
  function relayOf(mailData) {
    var u = mailData && mailData.relay && typeof mailData.relay.url === "string" ? mailData.relay.url.trim().replace(/\/+$/, "") : "";
    return /^https:\/\/[^\s]+$/.test(u) ? u : DEFAULT_RELAY;
  }

  var API = { snippet: snippet, apply: apply, cleanLead: cleanLead, validBack: validBack, relayOf: relayOf,
              FORM_WORDS: FORM_WORDS, AUTO_EVERY: AUTO_EVERY };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }
  if (!root || !root.document) return;

  // ---------- browser ----------
  var C = root.OrosCrmCore;
  var A = null;                                   // the app's helpers (init)
  var S = {
    en: {
      btn: "Web form", title: "Web form",
      intro: "A contact form for your own website. When someone fills it in, the message waits, encrypted, at the orOS relay until CRM picks it up. Then it becomes a lead here, or a new history entry of the customer who already has that e-mail.",
      privacy: "Only your CRM can read the messages: the relay keeps them encrypted with a key made on this device. A message that isn't picked up within 30 days is deleted.",
      back: "Thank-you page (optional)",
      backHint: "An https address on your site to show after sending. Without it, visitors see a short thank-you page.",
      backBad: "Use an https:// address, or leave it empty.",
      create: "Create the form", working: "Please wait…",
      code: "HTML for your site", lang: "Form language", "lang.en": "English", "lang.el": "Greek",
      codeHint: "Paste it into a page of your website and style it as you like. It has no script. Keep the hidden field: it stops spam robots.",
      copy: "Copy", copied: "Copied", save: "Save", saved: "Saved",
      check: "Check for new leads", last: "Last checked: {t}", never: "Not checked yet on this device.",
      here: "This device collects the messages. CRM also checks when you open it, at most every 10 minutes.",
      elsewhere: "Another device collects the messages.", collectHere: "Collect on this device",
      off: "Turn the form off",
      offAsk: "Turn the web form off? The form on your site stops working and messages still waiting at the relay are deleted.",
      offDone: "Web form turned off",
      none: "No new leads.", got: "New leads: {a} · added to customers you already have: {m}",
      over: "{n} didn't fit (CRM's limits).",
      src: "Web form", noMsg: "Sent the web form without a message.",
      "w.name": "Name", "w.phone": "Phone", "w.company": "Company",
      "err.offline": "You're offline.",
      "err.network": "Couldn't reach the orOS relay. Try again later.",
      "err.nostore": "The orOS relay doesn't take web forms right now. Try again later.",
      "err.gone": "The relay no longer knows this form. Turn it off and create a new one.",
      "err.full": "The browser storage is full: nothing was saved. The messages stay at the relay.",
      "err.crypto": "This browser can't make the encryption keys.",
      "err.other": "Something went wrong. Try again later.",
      close: "Close"
    },
    el: {
      btn: "Φόρμα ιστότοπου", title: "Φόρμα ιστότοπου",
      intro: "Μια φόρμα επικοινωνίας για τον δικό σου ιστότοπο. Όταν κάποιος τη συμπληρώσει, το μήνυμα περιμένει κρυπτογραφημένο στο relay του orOS μέχρι να το παραλάβει το CRM. Τότε γίνεται νέος υποψήφιος πελάτης εδώ ή νέα εγγραφή στο ιστορικό του πελάτη που έχει ήδη αυτό το email.",
      privacy: "Μόνο το δικό σου CRM μπορεί να διαβάσει τα μηνύματα: το relay τα κρατά κρυπτογραφημένα με κλειδί που φτιάχτηκε σε αυτή τη συσκευή. Ένα μήνυμα που δεν παραλαμβάνεται μέσα σε 30 μέρες διαγράφεται.",
      back: "Σελίδα ευχαριστίας (προαιρετικά)",
      backHint: "Μια διεύθυνση https στον ιστότοπό σου, που εμφανίζεται μετά την αποστολή. Χωρίς αυτήν, ο επισκέπτης βλέπει μια σύντομη σελίδα ευχαριστίας.",
      backBad: "Γράψε μια διεύθυνση https:// ή άφησέ το κενό.",
      create: "Δημιουργία φόρμας", working: "Μια στιγμή…",
      code: "HTML για τον ιστότοπό σου", lang: "Γλώσσα φόρμας", "lang.en": "Αγγλικά", "lang.el": "Ελληνικά",
      codeHint: "Επικόλλησέ το σε μια σελίδα του ιστότοπού σου και μορφοποίησέ το όπως θέλεις. Δεν έχει script. Κράτησε το κρυφό πεδίο: σταματά τα ρομπότ spam.",
      copy: "Αντιγραφή", copied: "Αντιγράφηκε", save: "Αποθήκευση", saved: "Αποθηκεύτηκε",
      check: "Έλεγχος για νέους υποψήφιους", last: "Τελευταίος έλεγχος: {t}", never: "Δεν έχει γίνει έλεγχος σε αυτή τη συσκευή.",
      here: "Αυτή η συσκευή παραλαμβάνει τα μηνύματα. Το CRM ελέγχει και όταν το ανοίγεις, το πολύ κάθε 10 λεπτά.",
      elsewhere: "Τα μηνύματα τα παραλαμβάνει άλλη συσκευή.", collectHere: "Παραλαβή σε αυτή τη συσκευή",
      off: "Απενεργοποίηση φόρμας",
      offAsk: "Απενεργοποίηση της φόρμας; Η φόρμα στον ιστότοπό σου σταματά να λειτουργεί και όσα μηνύματα περιμένουν στο relay διαγράφονται.",
      offDone: "Η φόρμα απενεργοποιήθηκε",
      none: "Κανένας νέος υποψήφιος.", got: "Νέοι υποψήφιοι: {a} · σε πελάτες που ήδη έχεις: {m}",
      over: "{n} δεν χώρεσαν (όρια του CRM).",
      src: "Φόρμα ιστότοπου", noMsg: "Έστειλε τη φόρμα χωρίς μήνυμα.",
      "w.name": "Όνομα", "w.phone": "Τηλέφωνο", "w.company": "Εταιρεία",
      "err.offline": "Είσαι εκτός σύνδεσης.",
      "err.network": "Δεν ήταν δυνατή η σύνδεση με το relay του orOS. Δοκίμασε αργότερα.",
      "err.nostore": "Το relay του orOS δεν δέχεται φόρμες αυτή τη στιγμή. Δοκίμασε αργότερα.",
      "err.gone": "Το relay δεν γνωρίζει πια αυτή τη φόρμα. Απενεργοποίησέ τη και φτιάξε νέα.",
      "err.full": "Ο χώρος του browser γέμισε: δεν αποθηκεύτηκε τίποτα. Τα μηνύματα μένουν στο relay.",
      "err.crypto": "Αυτός ο browser δεν μπορεί να φτιάξει τα κλειδιά κρυπτογράφησης.",
      "err.other": "Κάτι πήγε στραβά. Δοκίμασε αργότερα.",
      close: "Κλείσιμο"
    }
  };
  function t(k, params) {
    var tab = S[A && A.lang === "el" ? "el" : "en"];
    var s = tab[k] !== undefined ? tab[k] : (S.en[k] !== undefined ? S.en[k] : k);
    return s.replace(/\{(\w+)\}/g, function (m, n) { return params && params[n] !== undefined ? String(params[n]) : m; });
  }
  function errText(e) {
    var c = e && e.code;
    if (c === "timeout" || c === "relay") c = "network";
    if (c === "auth") c = "gone";
    return t(["offline", "network", "nostore", "gone", "full", "crypto"].indexOf(c) >= 0 ? "err." + c : "err.other");
  }

  // ---------- device state ----------
  function rnd(n, abc) {
    var b = crypto.getRandomValues(new Uint8Array(n)), out = "";
    for (var i = 0; i < n; i++) out += abc.charAt(b[i] % abc.length);
    return out;
  }
  function devState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(DEV_KEY) || "null"); } catch (e) {}
    if (!s || typeof s !== "object") s = {};
    if (typeof s.dev !== "string" || !/^[a-z0-9]{6,20}$/.test(s.dev)) {
      s.dev = rnd(10, "abcdefghijklmnopqrstuvwxyz0123456789");
      saveDev(s);
    }
    if (typeof s.last !== "number") s.last = 0;
    return s;
  }
  function saveDev(s) { try { localStorage.setItem(DEV_KEY, JSON.stringify({ dev: s.dev, last: s.last || 0 })); } catch (e) {} }

  // ---------- relay ----------
  function relayUrl() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem("oros-mail-data") || "null"); } catch (e) {}
    return relayOf(d);
  }
  function relay(body) {
    if (!navigator.onLine) return Promise.reject({ code: "offline" });
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, CALL_TIMEOUT);
    return fetch(relayUrl() + "/v1", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: ctl.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
    }).then(function (r) {
      return r.json()["catch"](function () { return null; });
    }, function () {
      throw { code: ctl.signal.aborted ? "timeout" : "network" };
    }).then(function (j) {
      clearTimeout(timer);
      if (!j || typeof j !== "object") throw { code: "relay" };
      if (!j.ok) throw { code: (j.error && j.error.code) || "relay" };
      return j.data;
    }, function (e) { clearTimeout(timer); throw e; });
  }
  function pubOf(wf) { return { kty: "RSA", alg: "RSA-OAEP-256", n: wf.priv.n, e: wf.priv.e }; }
  function unb64(s) {
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  // One sealed message (relay/newsletter.js seal) → its object.
  function openSealed(priv, v) {
    return Promise.resolve().then(function () {
      var o = JSON.parse(atob(v));
      return crypto.subtle.decrypt({ name: "RSA-OAEP" }, priv, unb64(o.w)).then(function (raw) {
        return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
      }).then(function (key) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, key, unb64(o.c));
      }).then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
    });
  }

  // ---------- actions ----------
  function cur() { var w = A.data().wf; return w && !w.off ? w : null; }
  function saveWf(wf) {
    var d = A.data();
    wf.m = A.stamp(d.wf || null);
    var n = C.normWf(wf);
    if (!n) return false;
    d.wf = n;
    return A.commit();
  }
  // A new form (keys made here), or the thank-you page of the current one.
  function create(back) {
    var w = cur(), dev = devState().dev;
    var made = w ? Promise.resolve({ k: w.k, sec: w.sec, priv: w.priv }) :
      Promise.resolve().then(function () {
        return crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
                                         true, ["encrypt", "decrypt"]);
      }).then(function (kp) {
        return crypto.subtle.exportKey("jwk", kp.privateKey);
      }).then(function (priv) {
        return { k: rnd(16, "abcdefghijklmnopqrstuvwxyz0123456789"),
                 sec: rnd(32, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"), priv: priv };
      }, function () { throw { code: "crypto" }; });
    return made.then(function (f) {
      var wf = { k: f.k, sec: f.sec, priv: f.priv, back: String(back || "").trim(), dev: (w && w.dev) || dev, at: (w && w.at) || Date.now() };
      if (!C.normWf(Object.assign({ m: 1 }, wf))) throw { code: "crypto" };
      return relay({ op: "crmf", act: "reg", k: wf.k, sec: wf.sec, pub: pubOf(C.normWf(Object.assign({ m: 1 }, wf))), back: wf.back }).then(function () {
        if (!saveWf(wf)) throw { code: "full" };
      });
    });
  }
  function collectHere() {
    var w = cur();
    if (!w) return false;
    return saveWf(Object.assign({}, w, { dev: devState().dev }));
  }
  function turnOff() {
    var w = cur();
    if (!w) return Promise.resolve();
    return relay({ op: "crmf", act: "drop", k: w.k, sec: w.sec })["catch"](function (e) {
      if (!(e && (e.code === "gone" || e.code === "auth"))) throw e;   // already gone at the relay
    }).then(function () {
      if (!saveWf({ off: 1 })) throw { code: "full" };
    });
  }
  // Fetch, open, add, then delete at the relay (only once saved here).
  var busy = null;
  function check() {
    if (busy) return busy;
    var w = cur(), st = devState();
    if (!w) return Promise.resolve(null);
    if (w.dev && w.dev !== st.dev) return Promise.reject({ code: "elsewhere" });
    var tally = { added: 0, merged: 0, same: 0, over: 0, bad: 0 };
    busy = crypto.subtle.importKey("jwk", w.priv, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]).then(function (priv) {
      function page(n) {
        return relay({ op: "crmf", act: "pull", k: w.k, sec: w.sec, after: 0 }).then(function (res) {
          var rows = res && Array.isArray(res.rows) ? res.rows : [];
          if (!rows.length) return;
          var opened = [];
          return rows.reduce(function (p, r) {
            return p.then(function () {
              return openSealed(priv, r.v).then(function (o) { opened.push(o); }, function () { tally.bad++; });
            });
          }, Promise.resolve()).then(function () {
            var d = A.data();
            var r = apply(C, d, opened, { now: Date.now(), stamp: A.stamp, src: t("src"), emailOf: A.emailOf,
                                          words: { name: t("w.name"), phone: t("w.phone"), company: t("w.company"), noMsg: t("noMsg") } });
            ["added", "merged", "same", "over", "bad"].forEach(function (k) { tally[k] += r[k]; });
            if (r.ids.length && !A.commit()) throw { code: "full" };
            return relay({ op: "crmf", act: "ack", k: w.k, sec: w.sec, upto: rows[rows.length - 1].id });
          }).then(function () { if (res.more && n < MAX_PAGES) return page(n + 1); });
        });
      }
      return page(1);
    }, function () { throw { code: "crypto" }; }).then(function () {
      st.last = Date.now();
      saveDev(st);
      return tally;
    });
    busy.then(function () { busy = null; }, function () { busy = null; });
    return busy;
  }
  function tallyText(r) {
    if (!r || !(r.added || r.merged)) return t("none") + (r && r.over ? " " + t("over", { n: r.over }) : "");
    return t("got", { a: r.added, m: r.merged }) + (r.over ? " " + t("over", { n: r.over }) : "");
  }
  // On opening CRM (and coming back to it): quietly, at most every 10 minutes.
  function auto() {
    var w = cur();
    if (!w || !navigator.onLine) return;
    var st = devState();
    if (w.dev && w.dev !== st.dev) return;
    if (Date.now() - st.last < AUTO_EVERY) return;
    check().then(function (r) {
      if (r && (r.added || r.merged)) A.showToast(tallyText(r));
    }, function () {});
  }

  // ---------- dialog ----------
  function el(tag, cls, text) { return A.el(tag, cls, text); }
  function open() {
    var dlg = A.makeDialog("crm-webform", true);
    var body = el("div");
    dlg.appendChild(el("h2", "dlg-title", t("title")));
    dlg.appendChild(body);
    var acts = el("div", "dlg-actions");
    acts.appendChild(A.button(t("close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    var snipLang = A.lang === "el" ? "el" : "en";

    function msgLine(cls) { var p = el("p", "hint wf-msg" + (cls ? " " + cls : "")); p.setAttribute("role", "status"); return p; }
    function busyBtn(b, p) {
      var label = b.textContent;
      b.disabled = true;
      b.textContent = t("working");
      return p.then(function (x) { b.disabled = false; b.textContent = label; return x; },
                    function (e) { b.disabled = false; b.textContent = label; throw e; });
    }
    function backField(value) {
      var i = A.field(body, t("back"), A.inp("url", value || "", 300, "https://"), el("p", "hint", t("backHint")));
      i.setAttribute("inputmode", "url");
      return i;
    }
    function draw() {
      body.innerHTML = "";
      var w = cur(), st = devState();
      body.appendChild(el("p", "dlg-sub", t("intro")));
      body.appendChild(el("p", "hint", t("privacy")));
      if (!w) {
        var back0 = backField("");
        var msg0 = msgLine();
        var mk = A.button(t("create"), "primary", function () {
          msg0.textContent = "";
          if (!validBack(back0.value)) { msg0.textContent = t("backBad"); msg0.classList.add("warn"); return; }
          busyBtn(mk, create(back0.value)).then(draw, function (e) { msg0.textContent = errText(e); msg0.classList.add("warn"); });
        });
        var row0 = el("div", "dlg-actions");
        row0.appendChild(mk);
        body.appendChild(row0);
        body.appendChild(msg0);
        return;
      }
      // the HTML
      var ls = A.seg([["en", t("lang.en")], ["el", t("lang.el")]], snipLang, function (v) { snipLang = v; code.value = snippet(w, relayUrl(), v); });
      A.field(body, t("lang"), ls);
      var code = A.field(body, t("code"), el("textarea", "wf-code"), el("p", "hint", t("codeHint")));
      code.readOnly = true;
      code.spellcheck = false;
      code.setAttribute("dir", "ltr");
      code.value = snippet(w, relayUrl(), snipLang);
      var cp = A.button(t("copy"), "", function () {
        var done = function () { cp.textContent = t("copied"); setTimeout(function () { cp.textContent = t("copy"); }, 1500); };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(code.value).then(done, function () { code.select(); }); return; }
        } catch (e) {}
        code.select();
      });
      var row1 = el("div", "dlg-actions");
      row1.appendChild(cp);
      body.appendChild(row1);
      // the thank-you page
      var back = backField(w.back || "");
      var msg1 = msgLine();
      var sv = A.button(t("save"), "", function () {
        msg1.textContent = ""; msg1.classList.remove("warn");
        if (!validBack(back.value)) { msg1.textContent = t("backBad"); msg1.classList.add("warn"); return; }
        busyBtn(sv, create(back.value)).then(function () { msg1.textContent = t("saved"); },
          function (e) { msg1.textContent = errText(e); msg1.classList.add("warn"); });
      });
      var row2 = el("div", "dlg-actions");
      row2.appendChild(sv);
      body.appendChild(row2);
      body.appendChild(msg1);
      // collecting
      var mine = !w.dev || w.dev === st.dev;
      body.appendChild(el("p", "dlg-sub", mine ? t("here") : t("elsewhere")));
      var msg2 = msgLine();
      var row3 = el("div", "dlg-actions");
      if (mine) {
        var ck = A.button(t("check"), "primary", function () {
          msg2.textContent = ""; msg2.classList.remove("warn");
          busyBtn(ck, check()).then(function (r) { msg2.textContent = tallyText(r); lastP.textContent = t("last", { t: A.fmtMs(devState().last) }); },
            function (e) { msg2.textContent = errText(e); msg2.classList.add("warn"); });
        });
        row3.appendChild(ck);
      } else {
        row3.appendChild(A.button(t("collectHere"), "primary", function () { if (collectHere()) draw(); }));
      }
      body.appendChild(row3);
      var lastP = el("p", "hint", st.last ? t("last", { t: A.fmtMs(st.last) }) : t("never"));
      body.appendChild(lastP);
      body.appendChild(msg2);
      // off
      var row4 = el("div", "dlg-actions");
      var offB = A.button(t("off"), "danger", function () {
        A.confirmDialog(t("offAsk"), t("off"), true, function () {
          msg2.textContent = "";
          busyBtn(offB, turnOff()).then(function () { A.showToast(t("offDone")); draw(); },
            function (e) { msg2.textContent = errText(e); msg2.classList.add("warn"); });
        });
      });
      row4.appendChild(offB);
      body.appendChild(row4);
    }
    draw();
    A.showDialog(dlg);
  }

  function init(helpers) { A = helpers; }
  root.OrosCrmWebForm = Object.assign(API, {
    init: init, open: open, auto: auto, check: check, label: function () { return t("btn"); },
    relayUrl: relayUrl, openSealed: openSealed
  });
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
