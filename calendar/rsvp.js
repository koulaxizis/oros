// ============================================================
// orOS Calendar — the public RSVP page (calendar/rsvp.html, CAL-EV E2)
// Opens https://useoros.online/calendar/rsvp.html#<k>.<key>[~<ticket>[~<name>]]
// (calendar/guests.js rsvpLink): fetches the event from the relay
// (relay/forms.js GET /fm/<k>, the Forms routes), opens it with the key
// from the #fragment (never sent anywhere), and sends one answer sealed
// in this browser for the organiser's key (forms/pub.js send).
//   one guest's link (with the ticket code): Coming / Maybe / Not coming,
//     plus-ones, a note; "Coming" shows the ticket QR (E3) to keep.
//   open sign-up link: name (+ email, phone), plus-ones, a note.
// The relay sees only "yes" and the seats of a yes (places, Chris Q5),
// and answers { wait } when they don't fit: "you are on the waiting list".
// Everything from the invitation is shown as text (textContent only).
// ============================================================
(function () {
  "use strict";
  var P = window.OrosFormsPub, G = window.OrosCalGuests;
  var SENT_KEY = "oros-rsvp-sent";

  var STRINGS = {
    en: {
      "r.banner": "This invitation was made by someone who uses orOS, not by orOS. Never enter passwords, PINs or card numbers here.",
      "r.sub": "Invitation", "r.loading": "Opening the invitation…",
      "r.privacy": "Your answer is encrypted in this browser. Only the person who invited you can read it.",
      "r.what": "What is orOS?", "r.report": "Report this page",
      "r.reportAsk": "Is this page trying to get passwords, card numbers or money, or is it abusive? Reporting is anonymous. A page several people report is closed.",
      "r.reportGo": "Report", "r.reported": "Thank you. The report was sent.",
      "r.noLink": "This link is incomplete. Ask the person who sent it for the whole link.",
      "r.gone": "This invitation isn't available any more.",
      "r.bad": "This invitation can't be opened. The link may be incomplete or changed.",
      "r.off": "The invitation can't be reached right now. Please try again later.",
      "r.busy": "Too many answers from here. Please wait and try again later.",
      "r.closed": "This invitation doesn't take answers any more.",
      "r.big": "The answer is too long.", "r.retry": "Try again",
      "r.hello": "Hi {name},", "r.ask": "Will you come?",
      "r.yes": "Coming", "r.maybe": "Maybe", "r.no": "Not coming",
      "r.plus": "People coming with you", "r.note": "A note (optional)",
      "r.name": "Your name", "r.mail": "Email (optional)", "r.phone": "Phone (optional)",
      "r.signup": "Sign up", "r.send": "Send my answer",
      "r.sending": "Sending…", "r.needName": "Please write your name.", "r.needPick": "Please choose an answer.",
      "r.onlyPersonal": "Answers go only through personal invitations. Ask the organiser for yours.",
      "r.full": "The places are full: if you say you're coming, you go on the waiting list.",
      "r.left": "{n} places left",
      "r.yourTime": "Shown in your time zone.",
      "r.map": "Map",
      "r.done.y": "See you there!", "r.done.m": "Thanks! Your “maybe” was sent.", "r.done.n": "Thanks for letting them know.",
      "r.done.signup": "You're signed up. See you there!",
      "r.done.w": "The places are full: you are on the waiting list. The organiser will tell you if a place frees up.",
      "r.before": "You answered “{s}” from this browser. You can change it.",
      "r.change": "Change my answer",
      "r.ics": "Add to my calendar (.ics)",
      "r.tix": "Your ticket", "r.tixHint": "Show this code at the door. Save it or take a screenshot.",
      "r.tixSave": "Save the ticket", "r.tixFile": "ticket"
    },
    el: {
      "r.banner": "Αυτή την πρόσκληση τη δημιούργησε κάποιος που χρησιμοποιεί το orOS, όχι το orOS. Μη γράφετε ποτέ εδώ κωδικούς, PIN ή αριθμούς καρτών.",
      "r.sub": "Πρόσκληση", "r.loading": "Άνοιγμα της πρόσκλησης…",
      "r.privacy": "Η απάντησή σας κρυπτογραφείται σε αυτόν τον browser. Μόνο όποιος σας προσκάλεσε μπορεί να τη διαβάσει.",
      "r.what": "Τι είναι το orOS;", "r.report": "Αναφορά της σελίδας",
      "r.reportAsk": "Προσπαθεί αυτή η σελίδα να πάρει κωδικούς, αριθμούς καρτών ή χρήματα, ή είναι καταχρηστική; Η αναφορά είναι ανώνυμη. Μια σελίδα που αναφέρουν αρκετοί κλείνει.",
      "r.reportGo": "Αναφορά", "r.reported": "Ευχαριστούμε. Η αναφορά στάλθηκε.",
      "r.noLink": "Ο σύνδεσμος είναι ελλιπής. Ζητήστε ολόκληρο τον σύνδεσμο από όποιον σας τον έστειλε.",
      "r.gone": "Αυτή η πρόσκληση δεν είναι πια διαθέσιμη.",
      "r.bad": "Η πρόσκληση δεν μπορεί να ανοίξει. Ο σύνδεσμος ίσως είναι ελλιπής ή αλλαγμένος.",
      "r.off": "Η πρόσκληση δεν είναι προσβάσιμη αυτή τη στιγμή. Δοκιμάστε ξανά αργότερα.",
      "r.busy": "Πάρα πολλές απαντήσεις από εδώ. Περιμένετε και δοκιμάστε ξανά αργότερα.",
      "r.closed": "Αυτή η πρόσκληση δεν δέχεται πια απαντήσεις.",
      "r.big": "Η απάντηση είναι πολύ μεγάλη.", "r.retry": "Δοκιμάστε ξανά",
      "r.hello": "Γεια σας, {name},", "r.ask": "Θα έρθετε;",
      "r.yes": "Έρχομαι", "r.maybe": "Ίσως", "r.no": "Δεν έρχομαι",
      "r.plus": "Άτομα που έρχονται μαζί σας", "r.note": "Σημείωση (προαιρετικά)",
      "r.name": "Το όνομά σας", "r.mail": "Email (προαιρετικά)", "r.phone": "Τηλέφωνο (προαιρετικά)",
      "r.signup": "Εγγραφή", "r.send": "Αποστολή απάντησης",
      "r.sending": "Αποστολή…", "r.needName": "Γράψτε το όνομά σας.", "r.needPick": "Διαλέξτε μια απάντηση.",
      "r.onlyPersonal": "Απαντήσεις γίνονται μόνο με προσωπική πρόσκληση. Ζητήστε τη δική σας από τον διοργανωτή.",
      "r.full": "Οι θέσεις γέμισαν: αν πείτε ότι έρχεστε, μπαίνετε στη λίστα αναμονής.",
      "r.left": "Απομένουν {n} θέσεις",
      "r.yourTime": "Στη δική σας ζώνη ώρας.",
      "r.map": "Χάρτης",
      "r.done.y": "Τα λέμε εκεί!", "r.done.m": "Ευχαριστούμε! Το «ίσως» σας στάλθηκε.", "r.done.n": "Ευχαριστούμε που ενημερώσατε.",
      "r.done.signup": "Η εγγραφή σας έγινε. Τα λέμε εκεί!",
      "r.done.w": "Οι θέσεις γέμισαν: είστε στη λίστα αναμονής. Ο διοργανωτής θα σας ενημερώσει αν ελευθερωθεί θέση.",
      "r.before": "Απαντήσατε «{s}» από αυτόν τον browser. Μπορείτε να την αλλάξετε.",
      "r.change": "Αλλαγή απάντησης",
      "r.ics": "Προσθήκη στο ημερολόγιό μου (.ics)",
      "r.tix": "Το εισιτήριό σας", "r.tixHint": "Δείξτε αυτόν τον κωδικό στην είσοδο. Αποθηκεύστε τον ή κρατήστε ένα στιγμιότυπο.",
      "r.tixSave": "Αποθήκευση εισιτηρίου", "r.tixFile": "eisitirio"
    },
    de: {
      "r.banner": "Diese Einladung hat jemand erstellt, der orOS nutzt, nicht orOS selbst. Gib hier nie Passwörter, PINs oder Kartennummern ein.",
      "r.sub": "Einladung", "r.loading": "Einladung wird geöffnet…",
      "r.privacy": "Deine Antwort wird in diesem Browser verschlüsselt. Nur wer dich eingeladen hat, kann sie lesen.",
      "r.what": "Was ist orOS?", "r.report": "Diese Seite melden",
      "r.reportAsk": "Versucht diese Seite, Passwörter, Kartennummern oder Geld zu bekommen, oder ist sie missbräuchlich? Die Meldung ist anonym. Eine Seite, die mehrere melden, wird geschlossen.",
      "r.reportGo": "Melden", "r.reported": "Danke. Die Meldung wurde gesendet.",
      "r.noLink": "Dieser Link ist unvollständig. Bitte frag die Person, die ihn geschickt hat, nach dem ganzen Link.",
      "r.gone": "Diese Einladung gibt es nicht mehr.",
      "r.bad": "Diese Einladung lässt sich nicht öffnen. Der Link ist vielleicht unvollständig oder verändert.",
      "r.off": "Die Einladung ist gerade nicht erreichbar. Bitte versuch es später noch einmal.",
      "r.busy": "Zu viele Antworten von hier. Bitte warte und versuch es später noch einmal.",
      "r.closed": "Diese Einladung nimmt keine Antworten mehr an.",
      "r.big": "Die Antwort ist zu lang.", "r.retry": "Noch einmal",
      "r.hello": "Hallo {name},", "r.ask": "Kommst du?",
      "r.yes": "Ich komme", "r.maybe": "Vielleicht", "r.no": "Ich komme nicht",
      "r.plus": "Personen, die mit dir kommen", "r.note": "Eine Notiz (optional)",
      "r.name": "Dein Name", "r.mail": "E-Mail (optional)", "r.phone": "Telefon (optional)",
      "r.signup": "Anmelden", "r.send": "Antwort senden",
      "r.sending": "Wird gesendet…", "r.needName": "Bitte schreib deinen Namen.", "r.needPick": "Bitte wähle eine Antwort.",
      "r.onlyPersonal": "Antworten gehen nur über persönliche Einladungen. Frag die Veranstalterin oder den Veranstalter nach deiner.",
      "r.full": "Die Plätze sind voll: Wenn du zusagst, kommst du auf die Warteliste.",
      "r.left": "Noch {n} Plätze frei",
      "r.yourTime": "In deiner Zeitzone.",
      "r.map": "Karte",
      "r.done.y": "Bis dann!", "r.done.m": "Danke! Dein „Vielleicht“ wurde gesendet.", "r.done.n": "Danke für die Rückmeldung.",
      "r.done.signup": "Du bist angemeldet. Bis dann!",
      "r.done.w": "Die Plätze sind voll: Du stehst auf der Warteliste. Du erfährst es, wenn ein Platz frei wird.",
      "r.before": "Du hast in diesem Browser „{s}“ geantwortet. Du kannst es ändern.",
      "r.change": "Antwort ändern",
      "r.ics": "In meinen Kalender (.ics)",
      "r.tix": "Dein Ticket", "r.tixHint": "Zeig diesen Code am Eingang. Speichere ihn oder mach einen Screenshot.",
      "r.tixSave": "Ticket speichern", "r.tixFile": "ticket"
    }
  };
  function browserLang() {
    try { var s = localStorage.getItem("oros-lang"); if (s === "el" || s === "en" || s === "de") return s; } catch (e) {}
    var n = String(navigator.language || "");
    return /^el\b/i.test(n) ? "el" : (/^de\b/i.test(n) ? "de" : "en");
  }
  var LANG = "en";
  function setLang(l) {
    LANG = STRINGS[l] ? l : "en";
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
  }
  function t(k, v) {
    var s = STRINGS[LANG][k] !== undefined ? STRINGS[LANG][k] : (STRINGS.en[k] !== undefined ? STRINGS.en[k] : k);
    if (v) Object.keys(v).forEach(function (n) { s = s.split("{" + n + "}").join(String(v[n])); });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function button(cls, text, fn) {
    var b = el("button", cls, text);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function stateMsg(key, retry) {
    var c = $("card");
    c.textContent = "";
    var p = el("p", key === "r.loading" ? "dim" : "err", t(key));
    p.id = "state";
    c.appendChild(p);
    if (retry) c.appendChild(button("btn", t("r.retry"), retry));
  }
  var ERR = { gone: "r.gone", bad: "r.bad", busy: "r.busy", closed: "r.closed", big: "r.big", full: "r.busy", off: "r.off", network: "r.off", timeout: "r.off", origin: "r.off" };

  // ---------- what this browser sent (to show "you answered …") ----------
  function sentMap() {
    try { var m = JSON.parse(localStorage.getItem(SENT_KEY) || "null"); return m && typeof m === "object" && !Array.isArray(m) ? m : {}; } catch (e) { return {}; }
  }
  function sentKey() { return link.k + (link.code ? "~" + link.code : ""); }
  function remember(s) {
    var m = sentMap(), keys = Object.keys(m);
    if (keys.length > 200) delete m[keys[0]];
    m[sentKey()] = { s: s, at: Date.now() };
    try { localStorage.setItem(SENT_KEY, JSON.stringify(m)); } catch (e) {}
  }

  // ---------- the event ----------
  function whenText(ev) {
    if (typeof ev.s !== "number") return "";
    var loc = LANG === "el" ? "el-GR" : (LANG === "de" ? "de-DE" : "en-GB");
    try {
      if (ev.ad) {
        var df = new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
        var last = typeof ev.e === "number" && ev.e - ev.s > 86400000 ? ev.e - 86400000 : ev.s;
        return last > ev.s ? df.format(new Date(ev.s)) + " – " + df.format(new Date(last)) : df.format(new Date(ev.s));
      }
      var f = new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
      var tf = new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit" });
      var a = new Date(ev.s), b = typeof ev.e === "number" && ev.e > ev.s ? new Date(ev.e) : null;
      if (!b) return f.format(a);
      return a.toDateString() === b.toDateString() ? f.format(a) + " – " + tf.format(b) : f.format(a) + " – " + f.format(b);
    } catch (e) { return new Date(ev.s).toString(); }
  }
  function head(obj) {
    var ev = obj.ev || {}, c = el("div", "card");
    if (link.name) c.appendChild(el("p", "hello", t("r.hello", { name: link.name })));
    c.appendChild(el("h1", "", ev.t || ""));
    var w = whenText(ev);
    if (w) {
      var line = el("p", "line");
      line.appendChild(el("span", "ic", "🗓"));
      var span = el("span", "", w);
      line.appendChild(span);
      c.appendChild(line);
      if (!ev.ad) c.appendChild(el("p", "dim", t("r.yourTime")));
    }
    if (ev.loc) {
      var pl = el("p", "line");
      pl.appendChild(el("span", "ic", "📍"));
      var sp = el("span", "", ev.loc + " ");
      var a = el("a", "", t("r.map"));
      a.href = "https://www.openstreetmap.org/search?query=" + encodeURIComponent(ev.loc);
      a.rel = "noopener noreferrer";
      a.target = "_blank";
      sp.appendChild(a);
      pl.appendChild(sp);
      c.appendChild(pl);
    }
    if (ev.d) c.appendChild(el("p", "notes", ev.d));
    return c;
  }

  // ---------- the answer ----------
  var link = null, got = null, pick = null;
  function draw() {
    var c = $("card"), obj = got.obj;
    c.textContent = "";
    c.appendChild(head(obj));
    var box = el("form", "box");
    box.noValidate = true;
    c.appendChild(box);
    if (!got.open) { box.appendChild(el("p", "err", t("r.closed"))); return; }
    if (!link.code && obj.op !== 1) { box.appendChild(el("p", "note", t("r.onlyPersonal"))); return; }
    var before = sentMap()[sentKey()];
    if (before && STRINGS.en["r." + (before.s === "y" ? "yes" : before.s === "m" ? "maybe" : "no")]) {
      box.appendChild(el("p", "note", t("r.before", { s: t("r." + (before.s === "y" ? "yes" : before.s === "m" ? "maybe" : "no")) })));
    }
    if (typeof got.cap === "number" && got.cap > 0) {
      var left = Math.max(0, got.cap - (got.taken | 0));
      box.appendChild(el("p", left ? "dim" : "note", left ? t("r.left", { n: left }) : t("r.full")));
    }
    var nameIn = null, mailIn = null, phoneIn = null;
    if (link.code) {
      box.appendChild(el("h2", "", t("r.ask")));
      var row = el("div", "choices");
      ["y", "m", "n"].forEach(function (s) {
        var b = button("choice", t(s === "y" ? "r.yes" : s === "m" ? "r.maybe" : "r.no"), function () {
          pick = s;
          [].forEach.call(row.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          plusWrap.hidden = s === "n";
        });
        b.setAttribute("aria-pressed", pick === s ? "true" : "false");
        row.appendChild(b);
      });
      box.appendChild(row);
    } else {
      pick = "y";
      nameIn = field(box, "r.name", "input", { autocomplete: "name", maxlength: 80 });
      mailIn = field(box, "r.mail", "input", { type: "email", autocomplete: "email", maxlength: 200 });
      phoneIn = field(box, "r.phone", "input", { type: "tel", autocomplete: "tel", maxlength: 40 });
    }
    var ms = typeof obj.ms === "number" && obj.ms >= 1 ? Math.min(21, Math.floor(obj.ms)) : 4;
    var plusWrap = el("div", "");
    var plusIn = null;
    if (ms > 1) {
      plusIn = field(plusWrap, "r.plus", "select", {});
      for (var i = 0; i < ms; i++) { var o = el("option", "", String(i)); o.value = String(i); plusIn.appendChild(o); }
    }
    plusWrap.hidden = pick === "n";
    box.appendChild(plusWrap);
    var noteIn = field(box, "r.note", "textarea", { maxlength: 200, rows: 3 });
    var err = el("p", "err");
    err.hidden = true;
    box.appendChild(err);
    var go = el("button", "btn primary", t(link.code ? "r.send" : "r.signup"));
    go.type = "submit";
    box.appendChild(go);
    box.addEventListener("submit", function (e) {
      e.preventDefault();
      err.hidden = true;
      if (!pick) { err.textContent = t("r.needPick"); err.hidden = false; return; }
      var k = plusIn && pick !== "n" ? parseInt(plusIn.value, 10) || 0 : 0;
      var pay = { rsvp: 1, s: pick, k: k, l: LANG };
      var note = noteIn.value.trim();
      if (note) pay.x = note.slice(0, 200);
      if (link.code) pay.t = link.code;
      else {
        var n = nameIn.value.trim();
        if (!n) { err.textContent = t("r.needName"); err.hidden = false; nameIn.focus(); return; }
        pay.n = n.slice(0, 80);
        if (mailIn.value.trim()) pay.m = mailIn.value.trim().slice(0, 200);
        if (phoneIn.value.trim()) pay.p = phoneIn.value.trim().slice(0, 40);
      }
      var opts = { yes: pick === "y" ? 1 : 0, hp: $("hp-in").value };
      if (pick === "y") opts.seats = 1 + k;
      go.disabled = true;
      go.textContent = t("r.sending");
      P.send(link.k, obj.pub, pay, opts).then(function (r) {
        remember(pick);
        done(r.wait ? "w" : pick);
      }, function (x) {
        go.disabled = false;
        go.textContent = t(link.code ? "r.send" : "r.signup");
        err.textContent = t(ERR[x && x.code] || "r.off");
        err.hidden = false;
      });
    });
  }
  function field(host, key, tag, attrs) {
    var lab = el("label", "fld");
    lab.appendChild(document.createTextNode(t(key)));
    var inp = el(tag, "");
    Object.keys(attrs).forEach(function (a) { inp.setAttribute(a, attrs[a]); });
    lab.appendChild(inp);
    host.appendChild(lab);
    return inp;
  }
  function done(s) {
    var c = $("card"), obj = got.obj;
    c.textContent = "";
    c.appendChild(head(obj));
    var box = el("div", "box");
    c.appendChild(box);
    var msg = s === "w" ? "r.done.w" : (s === "y" ? (link.code ? "r.done.y" : "r.done.signup") : (s === "m" ? "r.done.m" : "r.done.n"));
    box.appendChild(el("p", "res " + (s === "w" ? "warn" : "ok"), t(msg)));
    var row = el("div", "row");
    if (s === "y" || s === "m" || s === "w") {
      var ics = el("a", "btn", t("r.ics"));
      ics.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(G.icsText(obj, link.k, Date.now()));
      ics.download = ((obj.ev && obj.ev.t) || "event").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 60) + ".ics";
      row.appendChild(ics);
    }
    if (link.code) row.appendChild(button("btn", t("r.change"), function () { pick = s === "w" ? "y" : s; draw(); }));
    box.appendChild(row);
    if (s === "y" && link.code) ticket(box);
  }
  // The ticket (E3): the same code the organiser's door checks offline.
  function ticket(host) {
    var tb = el("div", "box");
    tb.appendChild(el("h2", "", t("r.tix")));
    var img = el("img", "");
    img.id = "tix-qr";
    img.alt = t("r.tix");
    tb.appendChild(img);
    tb.appendChild(el("p", "tix-code", link.code));
    tb.appendChild(el("p", "dim", t("r.tixHint")));
    var save = el("a", "btn", t("r.tixSave"));
    tb.appendChild(save);
    host.appendChild(tb);
    loadQr().then(function (Q) {
      var q = Q.encode(link.code, { ecl: "M" }), m = 4, n = q.size + m * 2, sc = 8;
      var cv = document.createElement("canvas");
      cv.width = cv.height = n * sc;
      var g = cv.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = "#000";
      for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.modules[y][x]) g.fillRect((x + m) * sc, (y + m) * sc, sc, sc);
      var url = cv.toDataURL("image/png");
      img.src = url;
      save.href = url;
      save.download = t("r.tixFile") + ".png";
    }, function () { img.hidden = true; save.hidden = true; });
  }
  var qrP = null;
  function loadQr() {
    if (window.orosQR) return Promise.resolve(window.orosQR);
    if (!qrP) qrP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "../qr/qr-encode.js";
      s.onload = function () { window.orosQR ? res(window.orosQR) : rej(new Error("qr")); };
      s.onerror = function () { qrP = null; rej(new Error("qr")); };
      document.head.appendChild(s);
    });
    return qrP;
  }

  // ---------- start ----------
  function start() {
    stateMsg("r.loading");
    P.fetchDef(link.k, link.key).then(function (r) {
      var o = r.obj;
      if (!o || o.cal !== 1 || !o.pub || typeof o.pub.n !== "string" || !o.ev || typeof o.ev.t !== "string") throw { code: "bad" };
      got = r;
      if (!STRINGS[browserLang()] && (o.l === "el" || o.l === "de")) setLang(o.l);
      draw();
    }).catch(function (e) {
      var code = e && e.code;
      stateMsg(ERR[code] || "r.off", code === "off" || code === "network" || code === "timeout" || code === "busy" ? start : null);
    });
  }
  setLang(browserLang());
  (function () {
    var b = el("p", "frm-banner", t("r.banner"));
    b.setAttribute("role", "note");
    $("warn").appendChild(b);
  })();
  link = G.parseRsvp(location.hash);
  if (!link) stateMsg("r.noLink");
  else start();

  // ---------- reporting ----------
  $("report-btn").addEventListener("click", function () { $("report").hidden = !$("report").hidden; });
  $("report-go").addEventListener("click", function () {
    var go = $("report-go");
    go.disabled = true;
    var fin = function () { $("report").textContent = ""; $("report").appendChild(el("p", "", t("r.reported"))); };
    if (link) P.report(link.k).then(fin, fin); else fin();
  });
  if (/[?&]standalone\b/.test(location.search)) window.__rsvpLink = function () { return link; };
})();
