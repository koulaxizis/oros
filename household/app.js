// ============================================================
// orOS Household — the app inside the shell frame (BR-HH)
// Households, their people, invites (link + QR), join requests and
// what is shared. The work itself is done by the shell engine
// (household/engine.js, window.parent.orosHousehold); this page only
// shows its state and calls it. Nothing here is stored by the app.
// Boot (OROS_BIBLE.md Part VI): applyI18n → wire → inheritPalette →
// watchPalette → render → take a pending invite / deep link.
// Rules: R8 (shell APIs from window.parent, guarded), every name and
// title from other people goes in through textContent only.
// ============================================================
(function () {
  "use strict";

  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    console.log("household/app.js v" + (m ? m[1] : "?") + " boot");
  })();

  var APP_ID = "household";
  var LOCAL_KEY = "oros-household-local";        // device-local: { active }
  var INVITE_KEY = "oros-household-invite";      // left by share/ (an opened invite link)
  var C = window.OrosHouseCore;

  // ---------- 1. Language ----------
  var STR = {
    en: {
      "app.name": "Household",
      "noEngine": "Open orOS to use households.",
      "first.title": "Share with the people you live with",
      "first.text": "Make a household, invite your family or flatmates with a link, then share a shopping list or any list from To-Do. Everyone sees changes in seconds and edits from their own orOS.",
      "first.new": "Create a household", "first.join": "I have an invite",
      "first.private": "Everything is encrypted on your devices. The orOS server keeps only scrambled data it cannot read, and no account is needed.",
      "add": "New household or invite",
      "sec.reqs": "Asking to join", "sec.members": "People", "sec.invites": "Open invites", "sec.shared": "Shared here", "sec.removed": "Removed lately",
      "docs.none": "Nothing shared yet. In To-Do, open a list's settings (the pencil on its tab), pick this household under “Household” and tap “Share”.",
      "arch.hint": "Lists someone stopped sharing stay here for 30 days.",
      "push.on": "Tell me about changes when orOS is closed",
      "push.hint": "On this device, for every household: a couple of minutes after someone else changes something, at most every 15 minutes. Only “something changed” travels, encrypted for this device.",
      "push.need": "First turn on Settings › Notifications › “Notifications with orOS closed” on this device.",
      "arch.restore": "Share again", "arch.drop": "Forget",
      "leave.btn": "Leave this household", "del.btn": "Delete the household",
      "gone.forget": "Remove from this device",
      "gone.removed": "You are no longer in this household. Its lists stay on this device as your own copies.",
      "gone.deleted": "This household was deleted, or orOS cannot reach it any more.",
      "st.ok": "Up to date", "st.sync": "Updating…", "st.offline": "Offline: changes wait on this device and go out later.",
      "st.err": "Could not update ({e}).", "st.big": "A shared list is too big to send. Remove some items.",
      "new.title": "New household", "new.name": "Name of the household", "new.namePh": "Home", "new.me": "Your name, as the others will see it",
      "new.go": "Create", "btn.cancel": "Cancel", "btn.save": "Save", "btn.done": "Done", "btn.close": "Close",
      "join.title": "Join a household", "join.link": "Invite link", "join.pw": "Password of the invite", "join.go": "Ask to join",
      "join.hint": "A member of the household lets you in. Until then nothing is shared with you.",
      "pend.wait": "Waiting for a member of the household to let you in…", "pend.refused": "Your request to join was not accepted.",
      "pend.gone": "The invite expired before a member let you in. Ask for a new one.", "pend.cancel": "Cancel", "pend.ok": "OK",
      "pend.as": "You asked as {name}.",
      "inv.btn": "+ Invite", "inv.title": "Invite someone", "inv.days": "The link works for", "inv.uses": "For",
      "inv.pw": "Password (optional, tell it in person)", "inv.go": "Make the link",
      "inv.hint": "Whoever opens the link asks to join; you or another member accepts the request.",
      "inv.d1": "1 day", "inv.d2": "2 days", "inv.d7": "7 days", "inv.d30": "30 days",
      "inv.u1": "One person", "inv.u20": "Several people (up to 20)",
      "inv.copy": "Copy link", "inv.share": "Share…", "inv.copied": "Link copied", "inv.copyFail": "Could not copy: select the link and copy it",
      "inv.exp": "Works until {d}.", "inv.until": "until {d}", "inv.pwTag": "with a password", "inv.withdraw": "Withdraw", "inv.show": "Show",
      "inv.shareText": "Join my household in orOS",
      "req.wants": "{name} wants to join", "req.ok": "Let in", "req.no": "Refuse",
      "mem.you": "you", "mem.admin": "admin", "mem.edit": "Edit", "mem.makeAdmin": "Make admin", "mem.remove": "Remove",
      "me.title": "You in this household", "me.name": "Name", "me.color": "Colour",
      "ren.title": "Rename the household", "rename": "Rename",
      "doc.todo": "List in To-Do", "doc.open": "Open", "doc.by": "shared by {name}",
      "ask.leave": "Leave “{name}”? Its shared lists stay on this device as your own copies; the others keep theirs.",
      "ask.leaveYes": "Leave",
      "ask.del": "Delete “{name}” for everyone? The others keep a copy of the shared lists, but the household and its link end.",
      "ask.delYes": "Delete",
      "ask.remove": "Remove {name} from the household? orOS gives the others a new key, so {name} sees no new changes.",
      "ask.removeYes": "Remove",
      "ask.admin": "Make {name} an admin? Admins can remove people and delete the household.", "ask.adminYes": "Make admin",
      "err.name": "Write a name.", "err.code": "This is not an orOS invite link.", "err.locked": "This invite has a password: write it.",
      "err.password": "Wrong password.", "err.expired": "This invite has expired or was used up. Ask for a new one.",
      "err.already": "You are already in this household.", "err.toomany": "You are in 6 households already, the most orOS allows.",
      "err.full": "This household has 12 people already, the most orOS allows.",
      "err.lastadmin": "Nobody else is an admin. Make someone else an admin first, or delete the household.",
      "err.net": "Could not reach the orOS server. Check your connection and try again.",
      "err.other": "That did not work ({e}).",
      "joined": "You are in “{name}” now", "created": "Household created"
    },
    el: {
      "app.name": "Νοικοκυριό",
      "noEngine": "Άνοιξε το orOS για να χρησιμοποιήσεις τα νοικοκυριά.",
      "first.title": "Μοιράσου με όσους μένεις μαζί",
      "first.text": "Φτιάξε ένα νοικοκυριό, κάλεσε την οικογένεια ή τους συγκατοίκους σου με έναν σύνδεσμο και μοιράσου μια λίστα για ψώνια ή όποια λίστα θέλεις από τις Εργασίες. Όλοι βλέπουν τις αλλαγές σε δευτερόλεπτα και τις κάνουν από το δικό τους orOS.",
      "first.new": "Νέο νοικοκυριό", "first.join": "Έχω πρόσκληση",
      "first.private": "Όλα κρυπτογραφούνται στις συσκευές σου. Ο server του orOS κρατά μόνο ακατάληπτα δεδομένα που δεν μπορεί να διαβάσει, και δεν χρειάζεται λογαριασμός.",
      "add": "Νέο νοικοκυριό ή πρόσκληση",
      "sec.reqs": "Ζητούν να μπουν", "sec.members": "Άτομα", "sec.invites": "Ανοιχτές προσκλήσεις", "sec.shared": "Κοινά εδώ", "sec.removed": "Αφαιρέθηκαν πρόσφατα",
      "docs.none": "Τίποτα κοινό ακόμα. Στις Εργασίες άνοιξε τις ρυθμίσεις μιας λίστας (το μολύβι στην καρτέλα της), διάλεξε αυτό το νοικοκυριό στο «Νοικοκυριό» και πάτησε «Κοινή χρήση».",
      "arch.hint": "Οι λίστες που κάποιος έπαψε να μοιράζεται μένουν εδώ 30 μέρες.",
      "push.on": "Ειδοποίησέ με για αλλαγές όταν το orOS είναι κλειστό",
      "push.hint": "Σε αυτή τη συσκευή, για κάθε νοικοκυριό: λίγα λεπτά αφού κάποιος άλλος αλλάξει κάτι, το πολύ κάθε 15 λεπτά. Ταξιδεύει μόνο το «κάτι άλλαξε», κρυπτογραφημένο για αυτή τη συσκευή.",
      "push.need": "Άνοιξε πρώτα τις «Ειδοποιήσεις με κλειστό orOS» στις Ρυθμίσεις › Ειδοποιήσεις, σε αυτή τη συσκευή.",
      "arch.restore": "Κοινή ξανά", "arch.drop": "Διαγραφή",
      "leave.btn": "Αποχώρηση από το νοικοκυριό", "del.btn": "Διαγραφή του νοικοκυριού",
      "gone.forget": "Αφαίρεση από αυτή τη συσκευή",
      "gone.removed": "Δεν είσαι πια σε αυτό το νοικοκυριό. Οι λίστες του μένουν σε αυτή τη συσκευή ως δικά σου αντίγραφα.",
      "gone.deleted": "Το νοικοκυριό διαγράφηκε ή το orOS δεν μπορεί πια να το βρει.",
      "st.ok": "Ενημερωμένο", "st.sync": "Ενημέρωση…", "st.offline": "Εκτός σύνδεσης: οι αλλαγές περιμένουν σε αυτή τη συσκευή και φεύγουν αργότερα.",
      "st.err": "Η ενημέρωση δεν έγινε ({e}).", "st.big": "Μια κοινή λίστα είναι πολύ μεγάλη για να σταλεί. Βγάλε μερικά στοιχεία.",
      "new.title": "Νέο νοικοκυριό", "new.name": "Όνομα του νοικοκυριού", "new.namePh": "Σπίτι", "new.me": "Το όνομά σου, όπως θα το βλέπουν οι άλλοι",
      "new.go": "Δημιουργία", "btn.cancel": "Άκυρο", "btn.save": "Αποθήκευση", "btn.done": "Τέλος", "btn.close": "Κλείσιμο",
      "join.title": "Μπες σε νοικοκυριό", "join.link": "Σύνδεσμος πρόσκλησης", "join.pw": "Κωδικός της πρόσκλησης", "join.go": "Ζήτα να μπεις",
      "join.hint": "Ένα μέλος του νοικοκυριού σε αφήνει να μπεις. Μέχρι τότε δεν μοιράζεται τίποτα μαζί σου.",
      "pend.wait": "Περιμένεις να σε αφήσει να μπεις ένα μέλος του νοικοκυριού…", "pend.refused": "Το αίτημά σου δεν έγινε δεκτό.",
      "pend.gone": "Η πρόσκληση έληξε πριν σε αφήσει να μπεις κάποιο μέλος. Ζήτα καινούργια.", "pend.cancel": "Ακύρωση", "pend.ok": "Εντάξει",
      "pend.as": "Ζήτησες να μπεις ως {name}.",
      "inv.btn": "+ Πρόσκληση", "inv.title": "Κάλεσε κάποιον", "inv.days": "Ο σύνδεσμος ισχύει για", "inv.uses": "Για",
      "inv.pw": "Κωδικός (προαιρετικά, πες τον από κοντά)", "inv.go": "Φτιάξε τον σύνδεσμο",
      "inv.hint": "Όποιος ανοίξει τον σύνδεσμο ζητά να μπει· το αίτημα το δέχεσαι εσύ ή άλλο μέλος.",
      "inv.d1": "1 μέρα", "inv.d2": "2 μέρες", "inv.d7": "7 μέρες", "inv.d30": "30 μέρες",
      "inv.u1": "Ένα άτομο", "inv.u20": "Πολλά άτομα (έως 20)",
      "inv.copy": "Αντιγραφή συνδέσμου", "inv.share": "Κοινοποίηση…", "inv.copied": "Ο σύνδεσμος αντιγράφηκε", "inv.copyFail": "Η αντιγραφή δεν έγινε: επίλεξε τον σύνδεσμο και αντίγραψέ τον",
      "inv.exp": "Ισχύει έως {d}", "inv.until": "έως {d}", "inv.pwTag": "με κωδικό", "inv.withdraw": "Ανάκληση", "inv.show": "Εμφάνιση",
      "inv.shareText": "Μπες στο νοικοκυριό μου στο orOS",
      "req.wants": "{name}: ζητά να μπει", "req.ok": "Αποδοχή", "req.no": "Άρνηση",
      "mem.you": "εσύ", "mem.admin": "διαχειριστής", "mem.edit": "Επεξεργασία", "mem.makeAdmin": "Ορισμός ως διαχειριστή", "mem.remove": "Αφαίρεση",
      "me.title": "Εσύ σε αυτό το νοικοκυριό", "me.name": "Όνομα", "me.color": "Χρώμα",
      "ren.title": "Μετονομασία του νοικοκυριού", "rename": "Μετονομασία",
      "doc.todo": "Λίστα στις Εργασίες", "doc.open": "Άνοιγμα", "doc.by": "τη μοιράστηκε: {name}",
      "ask.leave": "Αποχώρηση από το «{name}»; Οι κοινές λίστες μένουν σε αυτή τη συσκευή ως δικά σου αντίγραφα· οι άλλοι κρατούν τις δικές τους.",
      "ask.leaveYes": "Αποχώρηση",
      "ask.del": "Διαγραφή του «{name}» για όλους; Οι άλλοι κρατούν αντίγραφο των κοινών λιστών, αλλά το νοικοκυριό και ο σύνδεσμός του τελειώνουν.",
      "ask.delYes": "Διαγραφή",
      "ask.remove": "Αφαίρεση: {name}; Το orOS δίνει στους υπόλοιπους νέο κλειδί, οπότε δεν θα βλέπει νέες αλλαγές.",
      "ask.removeYes": "Αφαίρεση",
      "ask.admin": "Ορισμός ως διαχειριστή: {name}; Οι διαχειριστές αφαιρούν άτομα και διαγράφουν το νοικοκυριό.", "ask.adminYes": "Ορισμός ως διαχειριστή",
      "err.name": "Γράψε ένα όνομα.", "err.code": "Αυτός δεν είναι σύνδεσμος πρόσκλησης του orOS.", "err.locked": "Η πρόσκληση έχει κωδικό: γράψ’ τον.",
      "err.password": "Λάθος κωδικός.", "err.expired": "Η πρόσκληση έληξε ή χρησιμοποιήθηκε. Ζήτα καινούργια.",
      "err.already": "Είσαι ήδη σε αυτό το νοικοκυριό.", "err.toomany": "Είσαι ήδη σε 6 νοικοκυριά, όσα επιτρέπει το orOS.",
      "err.full": "Το νοικοκυριό έχει ήδη 12 άτομα, όσα επιτρέπει το orOS.",
      "err.lastadmin": "Δεν υπάρχει άλλος διαχειριστής εκτός από εσένα. Όρισε πρώτα κάποιον άλλον ή διάγραψε το νοικοκυριό.",
      "err.net": "Δεν βρέθηκε ο server του orOS. Έλεγξε τη σύνδεση και δοκίμασε ξανά.",
      "err.other": "Δεν έγινε ({e}).",
      "joined": "Είσαι πλέον στο «{name}»", "created": "Το νοικοκυριό δημιουργήθηκε"
    }
  };
  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try { return (localStorage.getItem("oros-lang") || "en") === "el" ? "el" : "en"; } catch (e) { return "en"; }
  }
  var LANG = appLang();
  if (window.orosI18n) window.orosI18n.table(STR, APP_ID, LANG);
  var LOCALE = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");
  var TBL = STR[LANG] || STR.en;
  function t(k, vars) {
    var s = TBL[k] || STR.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) { n.placeholder = t(n.getAttribute("data-i18n-ph")); });
    document.title = t("app.name") + " · orOS";
  }

  // ---------- 2. Shell, palette, helpers ----------
  function engine() {
    try { var p = window.parent; return p && p !== window && p.orosHousehold ? p.orosHousehold : null; } catch (e) { return null; }
  }
  var H = engine();
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover", "--accent-soft", "--panel-bg", "--border", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function btn(text, cls, fn) {
    var b = el("button", cls || "chip sm", text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  var ICON = {
    plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    pen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
    list: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/></svg>'
  };
  function setIcon(b, svg, label) {
    b.innerHTML = svg;          // fixed markup only
    b.setAttribute("aria-label", label);
    b.title = label;
  }
  var toastTimer = 0;
  function toast(text) {
    var n = $("toast");
    n.textContent = text;
    n.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.hidden = true; }, 3200);
  }
  function errText(e) {
    var c = e && (e.code || e.message) || "";
    if (STR.en["err." + c]) return t("err." + c);
    if (/fetch|network|Failed/i.test(c)) return t("err.net");
    return t("err.other", { e: String(c).slice(0, 60) });
  }
  function fmtDate(ms) {
    try { return new Date(ms).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return new Date(ms).toISOString().slice(0, 16).replace("T", " "); }
  }
  function avatar(m) {
    var a = el("span", "avatar", C.initials(m.name));
    a.style.background = m.color;
    a.setAttribute("aria-hidden", "true");
    return a;
  }
  var local = { active: "" };
  try { var lj = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); if (lj && typeof lj.active === "string") local.active = lj.active; } catch (e) {}
  function saveLocal() { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch (e) {} }

  // A confirm dialog with its own yes label.
  var askFn = null;
  function ask(text, yes, fn) {
    $("ask-text").textContent = text;
    $("ask-yes").textContent = yes;
    askFn = fn;
    $("ask-dlg").showModal();
  }
  function run(p, done) {
    return Promise.resolve(p).then(function (x) { if (done) done(x); render(); }, function (e) { toast(errText(e)); render(); });
  }

  // ---------- 3. Render ----------
  function current(list) {
    var hit = list.filter(function (h) { return h.box === local.active; })[0];
    return hit || list[0] || null;
  }
  function render() {
    if (!H) { $("no-engine").hidden = false; $("first").hidden = true; $("home").hidden = true; return; }
    var list = H.list(), pend = H.pending();
    renderTabs(list);
    renderPending(pend);
    var hh = current(list);
    $("first").hidden = !!(hh || pend.length);
    $("home").hidden = !hh;
    if (!hh) return;
    if (local.active !== hh.box) { local.active = hh.box; saveLocal(); }
    $("hh-name").textContent = hh.name || "?";
    renderStatus(hh);
    var out = hh.status === "removed" || hh.status === "gone";
    $("gone-card").hidden = !out;
    $("gone-text").textContent = hh.status === "removed" ? t("gone.removed") : t("gone.deleted");
    $("inv-btn").hidden = out;
    $("hh-rename").hidden = out;
    $("leave-btn").hidden = out;
    $("del-btn").hidden = out || !hh.admin;
    renderRequests(hh);
    renderMembers(hh, out);
    renderInvites(hh, out);
    renderDocs(hh);
    renderArchive(hh);
    renderPush();
  }
  // Wakes with orOS closed (engine.js orosHouseholdPush), per device.
  function pushApi() {
    try { var p = window.parent.orosHouseholdPush; return p && typeof p.state === "function" ? p : null; } catch (e) { return null; }
  }
  function renderPush() {
    var P = pushApi(), st = P ? P.state() : null;
    $("push-card").hidden = !st || !st.can;
    if (!st || !st.can) return;
    $("push-on").checked = st.on;
    $("push-hint").textContent = st.on && !st.push ? t("push.need") : t("push.hint");
  }
  function renderTabs(list) {
    var box = $("hh-tabs");
    box.textContent = "";
    if (list.length < 2) return;
    var cur = current(list);
    list.forEach(function (h) {
      var b = el("button", "tab", h.name || "?");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(cur && h.box === cur.box));
      if (h.reqs) b.appendChild(el("span", "dot", String(h.reqs)));
      b.addEventListener("click", function () { local.active = h.box; saveLocal(); render(); });
      box.appendChild(b);
    });
  }
  function renderPending(pend) {
    var s = $("pend");
    s.textContent = "";
    s.hidden = !pend.length;
    pend.forEach(function (p) {
      var c = el("div", "card " + (p.state === "wait" ? "accent" : "warn"));
      c.appendChild(el("p", "", t("pend." + p.state)));
      c.appendChild(el("p", "hint small", t("pend.as", { name: p.name })));
      var row = el("div", "row end");
      row.appendChild(btn(p.state === "wait" ? t("pend.cancel") : t("pend.ok"), "chip sm", function () { H.dismissJoin(p.box); render(); }));
      c.appendChild(row);
      s.appendChild(c);
    });
  }
  var syncing = false;
  function renderStatus(hh) {
    var s = "";
    if (syncing) s = t("st.sync");
    else if (hh.err === "too-large") s = t("st.big");
    else if (hh.status === "ok") s = t("st.ok");
    else if (hh.status === "offline") s = /fetch|network|Failed|http-5|nostore/i.test(hh.err) ? t("st.offline") : t("st.err", { e: hh.err });
    $("hh-status").textContent = s;
  }
  function renderRequests(hh) {
    $("req-card").hidden = !hh.reqs;
    var ul = $("req-list");
    if (!hh.reqs) { ul.textContent = ""; return; }
    H.requests(hh.box).then(function (rq) {
      ul.textContent = "";
      rq.forEach(function (r) {
        var li = el("li", "row-item");
        li.appendChild(el("span", "grow", t("req.wants", { name: r.name })));
        li.appendChild(btn(t("req.no"), "chip sm", function () { run(H.refuse(hh.box, r.rid)); }));
        li.appendChild(btn(t("req.ok"), "chip sm pri", function () { run(H.accept(hh.box, r.rid)); }));
        ul.appendChild(li);
      });
      $("req-card").hidden = !rq.length;
    }, function () {});
  }
  function renderMembers(hh, out) {
    var ul = $("mem-list");
    ul.textContent = "";
    hh.members.forEach(function (m) {
      var li = el("li", "row-item");
      li.appendChild(avatar(m));
      var who = el("span", "grow");
      who.appendChild(el("span", "name", m.name));
      if (m.id === hh.me) who.appendChild(el("span", "tag", t("mem.you")));
      if (m.admin) who.appendChild(el("span", "tag", t("mem.admin")));
      li.appendChild(who);
      if (!out && m.id === hh.me) li.appendChild(btn(t("mem.edit"), "chip sm", function () { openMe(hh, m); }));
      if (!out && hh.admin && m.id !== hh.me) {
        if (!m.admin) li.appendChild(btn(t("mem.makeAdmin"), "chip sm", function () {
          ask(t("ask.admin", { name: m.name }), t("ask.adminYes"), function () { run(H.makeAdmin(hh.box, m.id)); });
        }));
        li.appendChild(btn(t("mem.remove"), "chip sm", function () {
          ask(t("ask.remove", { name: m.name }), t("ask.removeYes"), function () { run(H.removeMember(hh.box, m.id)); });
        }));
      }
      ul.appendChild(li);
    });
  }
  function renderInvites(hh, out) {
    var now = Date.now();
    var open = out ? [] : hh.invites.filter(function (i) { return i.exp > now; });
    $("inv-open").hidden = !open.length;
    var ul = $("inv-list");
    ul.textContent = "";
    open.forEach(function (i) {
      var li = el("li", "row-item");
      var txt = t("inv.until", { d: fmtDate(i.exp) }) + " · " + t(i.n > 1 ? "inv.u20" : "inv.u1") + (i.pw ? " · " + t("inv.pwTag") : "");
      li.appendChild(el("span", "grow small", txt));
      if (i.link) li.appendChild(btn(t("inv.show"), "chip sm", function () { showInvite(i.link, i.exp); }));
      li.appendChild(btn(t("inv.withdraw"), "chip sm", function () { run(H.withdraw(hh.box, i.ih)); }));
      ul.appendChild(li);
    });
  }
  function renderDocs(hh) {
    var ul = $("doc-list");
    ul.textContent = "";
    $("doc-none").hidden = !!hh.docs.length;
    hh.docs.forEach(function (d) {
      var li = el("li", "row-item");
      var ic = el("span", "doc-ic");
      ic.innerHTML = ICON.list;          // fixed markup only
      li.appendChild(ic);
      var txt = el("span", "grow");
      txt.appendChild(el("span", "name", d.title || "?"));
      var by = H.member(hh.box, d.by);
      txt.appendChild(el("span", "hint small block", (d.kind === "todo" ? t("doc.todo") : d.kind) + (by ? " · " + t("doc.by", { name: by.name }) : "")));
      li.appendChild(txt);
      if (d.kind === "todo") li.appendChild(btn(t("doc.open"), "chip sm", function () { openDoc(d); }));
      ul.appendChild(li);
    });
  }
  function renderArchive(hh) {
    var list = H.archived().filter(function (a) { return a.box === hh.box && !a.take; });
    $("arch-box").hidden = !list.length;
    var ul = $("arch-list");
    ul.textContent = "";
    list.forEach(function (a) {
      var li = el("li", "row-item");
      li.appendChild(el("span", "grow", a.title || "?"));
      li.appendChild(btn(t("arch.drop"), "chip sm", function () { run(H.dropArchived(a.box, a.id)); }));
      li.appendChild(btn(t("arch.restore"), "chip sm", function () { run(H.restore(a.box, a.id)); }));
      ul.appendChild(li);
    });
  }
  function openDoc(d) {
    try {
      var p = window.parent;
      if (d.kind === "todo" && p && typeof p.__orosOpenAt === "function") p.__orosOpenAt("todo", { list: "tdh-" + d.id });
    } catch (e) {}
  }

  // ---------- 4. Dialogs ----------
  function myName() {
    var list = H ? H.list() : [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i].members.filter(function (x) { return x.id === list[i].me; })[0];
      if (m) return m.name;
    }
    try {
      var p = JSON.parse(localStorage.getItem("oros-profile") || "null");
      if (p && typeof p.name === "string") return p.name.slice(0, 40);
    } catch (e) {}
    return "";
  }
  function openNew() {
    $("new-name").value = "";
    $("new-me").value = myName();
    $("new-msg").textContent = "";
    $("new-dlg").showModal();
    $("new-name").focus();
  }
  function submitNew(ev) {
    ev.preventDefault();
    var name = $("new-name").value, me = $("new-me").value;
    if (!C.line(name, 60) || !C.line(me, 40)) { $("new-msg").textContent = t("err.name"); return; }
    $("new-go").disabled = true;
    H.create(name, me).then(function (box) {
      $("new-go").disabled = false;
      $("new-dlg").close();
      local.active = box; saveLocal();
      toast(t("created"));
      render();
    }, function (e) { $("new-go").disabled = false; $("new-msg").textContent = errText(e); });
  }
  function openJoin(code) {
    $("join-link").value = code || "";
    $("join-pw").value = "";
    $("join-me").value = myName();
    $("join-msg").textContent = "";
    checkJoinPw();
    $("join-dlg").showModal();
    (code ? $("join-me") : $("join-link")).focus();
  }
  function checkJoinPw() {
    var p = window.OrosHouseParse ? window.OrosHouseParse($("join-link").value) : null;
    $("join-pw-row").hidden = !(p && p.locked);
  }
  function submitJoin(ev) {
    ev.preventDefault();
    if (!C.line($("join-me").value, 40)) { $("join-msg").textContent = t("err.name"); return; }
    $("join-go").disabled = true;
    H.join($("join-link").value, $("join-me").value, $("join-pw").value).then(function () {
      $("join-go").disabled = false;
      $("join-dlg").close();
      render();
    }, function (e) {
      $("join-go").disabled = false;
      if (e && e.code === "locked") $("join-pw-row").hidden = false;
      $("join-msg").textContent = errText(e);
    });
  }
  function fillSelect(sel, opts, val) {
    sel.textContent = "";
    opts.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = String(o[0]);
      if (o[0] === val) op.selected = true;
      sel.appendChild(op);
    });
  }
  function openInvite() {
    fillSelect($("inv-days"), [[1, t("inv.d1")], [2, t("inv.d2")], [7, t("inv.d7")], [30, t("inv.d30")]], 2);
    fillSelect($("inv-uses"), [[1, t("inv.u1")], [20, t("inv.u20")]], 1);
    $("inv-pw").value = "";
    $("inv-msg").textContent = "";
    $("inv-form").hidden = false;
    $("inv-out").hidden = true;
    $("inv-dlg").showModal();
  }
  function submitInvite(ev) {
    ev.preventDefault();
    var hh = current(H.list());
    if (!hh) return;
    $("inv-go").disabled = true;
    H.invite(hh.box, { days: +$("inv-days").value, uses: +$("inv-uses").value, password: $("inv-pw").value }).then(function (r) {
      $("inv-go").disabled = false;
      showInvite(r.link, r.exp);
      render();
    }, function (e) { $("inv-go").disabled = false; $("inv-msg").textContent = errText(e); });
  }
  function showInvite(link, exp) {
    if (!$("inv-dlg").open) $("inv-dlg").showModal();
    $("inv-form").hidden = true;
    $("inv-out").hidden = false;
    $("inv-link").value = link;
    $("inv-exp").textContent = t("inv.exp", { d: fmtDate(exp) });
    $("inv-share").hidden = !(navigator.share);
    drawQr(link);
  }
  function drawQr(text) {
    var cv = $("inv-qr"), ctx = cv.getContext("2d");
    var q;
    try { q = window.orosQR.encode(text, { ecl: "M" }); } catch (e) { cv.hidden = true; return; }
    cv.hidden = false;
    var n = q.size + 8, px = Math.floor(cv.width / n), off = Math.floor((cv.width - px * n) / 2) + 4 * px;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#000";
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.modules[y][x]) ctx.fillRect(off + x * px, off + y * px, px, px);
  }
  function copyLink() {
    var v = $("inv-link").value;
    var ok = function () { toast(t("inv.copied")); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(ok, function () { toast(t("inv.copyFail")); });
    else { $("inv-link").select(); try { document.execCommand("copy"); ok(); } catch (e) { toast(t("inv.copyFail")); } }
  }
  function shareLink() {
    try { navigator.share({ title: t("app.name"), text: t("inv.shareText"), url: $("inv-link").value }).catch(function () {}); } catch (e) {}
  }
  var meDraft = null;
  function openMe(hh, m) {
    meDraft = { box: hh.box, color: m.ci };
    $("me-name").value = m.name;
    var box = $("me-colors");
    box.textContent = "";
    C.COLORS.forEach(function (c, i) {
      var b = el("button", "swatch");
      b.type = "button";
      b.style.background = c;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", t("me.color") + " " + (i + 1));
      b.setAttribute("aria-checked", String(i === meDraft.color));
      b.addEventListener("click", function () {
        meDraft.color = i;
        [].forEach.call(box.children, function (x, j) { x.setAttribute("aria-checked", String(j === i)); });
      });
      box.appendChild(b);
    });
    $("me-dlg").showModal();
  }
  function submitMe(ev) {
    ev.preventDefault();
    if (!meDraft) return;
    var d = meDraft;
    $("me-dlg").close();
    run(H.setMe(d.box, { name: $("me-name").value, color: d.color }));
  }

  // ---------- 5. Wire ----------
  function wire() {
    $("push-on").addEventListener("change", function () {
      var P = pushApi();
      if (!P) return;
      Promise.resolve(P.set($("push-on").checked)).then(renderPush, renderPush);
      renderPush();
    });
    setIcon($("add-btn"), ICON.plus, t("add"));
    setIcon($("hh-rename"), ICON.pen, t("rename"));
    $("add-btn").addEventListener("click", function () {
      if (!H) return;
      if (!H.list().length) { openNew(); return; }
      ask(t("add"), t("first.new"), openNew);
      $("ask-no").textContent = t("first.join");
      $("ask-no").dataset.join = "1";
      $("ask-yes").className = "chip pri";
    });
    $("first-new").addEventListener("click", openNew);
    $("first-join").addEventListener("click", function () { openJoin(""); });
    $("new-form").addEventListener("submit", submitNew);
    $("new-cancel").addEventListener("click", function () { $("new-dlg").close(); });
    $("join-form").addEventListener("submit", submitJoin);
    $("join-cancel").addEventListener("click", function () { $("join-dlg").close(); });
    $("join-link").addEventListener("input", checkJoinPw);
    $("inv-btn").addEventListener("click", openInvite);
    $("inv-form").addEventListener("submit", submitInvite);
    $("inv-cancel").addEventListener("click", function () { $("inv-dlg").close(); });
    $("inv-done").addEventListener("click", function () { $("inv-dlg").close(); });
    $("inv-copy").addEventListener("click", copyLink);
    $("inv-share").addEventListener("click", shareLink);
    $("me-form").addEventListener("submit", submitMe);
    $("me-cancel").addEventListener("click", function () { $("me-dlg").close(); });
    $("hh-rename").addEventListener("click", function () {
      var hh = current(H.list());
      if (!hh) return;
      $("ren-name").value = hh.name;
      $("ren-dlg").showModal();
    });
    $("ren-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var hh = current(H.list());
      $("ren-dlg").close();
      if (hh) run(H.rename(hh.box, $("ren-name").value));
    });
    $("ren-cancel").addEventListener("click", function () { $("ren-dlg").close(); });
    $("leave-btn").addEventListener("click", function () {
      var hh = current(H.list());
      if (hh) ask(t("ask.leave", { name: hh.name }), t("ask.leaveYes"), function () { run(H.leave(hh.box)); });
    });
    $("del-btn").addEventListener("click", function () {
      var hh = current(H.list());
      if (hh) ask(t("ask.del", { name: hh.name }), t("ask.delYes"), function () { run(H.remove(hh.box)); });
    });
    $("gone-forget").addEventListener("click", function () {
      var hh = current(H.list());
      if (hh) { H.forget(hh.box); render(); }
    });
    $("ask-yes").addEventListener("click", function () { var f = askFn; askFn = null; $("ask-dlg").close(); if (f) f(); });
    $("ask-no").addEventListener("click", function () {
      var join = $("ask-no").dataset.join === "1";
      askFn = null;
      $("ask-dlg").close();
      if (join) openJoin("");
    });
    $("ask-dlg").addEventListener("close", function () {
      $("ask-no").textContent = t("btn.cancel");
      delete $("ask-no").dataset.join;
      $("ask-yes").className = "chip danger-btn";
    });
    // A click on the backdrop closes a dialog (R32).
    [].forEach.call(document.querySelectorAll("dialog"), function (d) {
      d.addEventListener("click", function (ev) { if (ev.target === d) d.close(); });
    });
    // Contract Β: Ctrl+Alt+Shift belongs to the shell.
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null; try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  }

  // ---------- 6. Live state ----------
  var lastPending = "";
  function refresh() {
    if (!H) return;
    syncing = true;
    render();
    H.syncAll().then(function () { syncing = false; render(); }, function () { syncing = false; render(); });
  }
  function watch() {
    if (!H) return;
    var stop = H.on(function (ev) {
      if (ev.type === "list") {
        // a join answered while this page was open
        var now = H.list().map(function (h) { return h.box; }).join(",");
        if (lastPending && now.length > lastPending.length) {
          var newest = H.list().filter(function (h) { return lastPending.indexOf(h.box) < 0; })[0];
          if (newest) { local.active = newest.box; saveLocal(); toast(t("joined", { name: newest.name })); }
        }
        lastPending = now;
      }
      render();
    });
    lastPending = H.list().map(function (h) { return h.box; }).join(",");
    window.addEventListener("pagehide", stop);
    // a join waiting for its answer: ask every 15 s while this page is open
    setInterval(function () {
      if (!document.hidden && H.pending().some(function (p) { return p.state === "wait"; })) H.checkJoins();
    }, 15000);
  }

  // ---------- 7. Deep link: { box } | { join: code } ----------
  function openTarget(target) {
    if (!target || typeof target !== "object" || !H) return;
    if (typeof target.box === "string" && H.list().some(function (h) { return h.box === target.box; })) {
      local.active = target.box; saveLocal(); render();
    }
    if (typeof target.join === "string") openJoin(target.join.slice(0, 300));
  }
  window.__orosOpenAt = function (target) {
    if (document.querySelector("dialog[open]")) return;
    openTarget(target);
  };
  function takePending() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget(APP_ID);
        if (pending) openTarget(pending);
      }
    } catch (e) { /* standalone */ }
    // an invite link opened on this device (share/ leaves it here, an hour at most)
    try {
      var raw = localStorage.getItem(INVITE_KEY);
      if (raw) {
        localStorage.removeItem(INVITE_KEY);
        var inv = JSON.parse(raw);
        if (inv && typeof inv.code === "string" && Date.now() - (+inv.at || 0) < 3600000) openJoin(inv.code.slice(0, 300));
      }
    } catch (e) {}
  }

  // ---------- 8. Boot ----------
  function boot() {
    window.OrosHouseParse = function (s) {
      var m = /(?:^|[#\/\s])h([12])\.[A-Za-z0-9_-]{22}\./.exec(String(s || ""));
      return m ? { locked: m[1] === "2" } : null;
    };
    applyI18n();
    wire();
    inheritPalette();
    watchPalette();
    // The shell may open this page (an invite link) a moment before its
    // engine is there: wait for it a few seconds before saying so.
    var tries = 0;
    (function start() {
      if (!H && window.parent !== window && tries++ < 40) {
        H = engine();
        if (!H) { setTimeout(start, 250); return; }
      }
      if (H) {
        H.ready().then(function () { render(); refresh(); takePending(); });
        watch();
      }
      render();
    })();
  }
  boot();
})();
