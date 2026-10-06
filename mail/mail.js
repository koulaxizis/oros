// ============================================================
// orOS Mail / Ταχυδρομείο — v0.1.0 (Wave 0 skeleton)
// Sections:
//   1. i18n (inline EN/EL — self-contained iframe app)
//   2. Storage (synced data slice + DEVICE-LOCAL credentials)
//   3. Palette bridge (parent shell palette → iframe CSS vars)
//   4. Rendering (folders · message list · reading pane)
//   5. Accounts manager + setup dialog (Basic auth, IMAP/POP3 + SMTP, TLS)
//   6. Compose (Ctrl+Alt+N — save draft + send queue)
//   7. Toast (app-local, palette vars only)
//   8. Boot
// Verified contracts (shell.js 0.39.x):
//   · apps.json → same-origin iframe app
//   · palette: window.parent.orosAppTheme.accent + getComputedStyle
//   · data: localStorage "oros-mail-data" — carried by the shell
//     proxy slice (radio/television mirror pattern)
//   · credentials: "oros-mail-creds" — DEVICE-LOCAL ONLY. Never
//     synced, never exported by the unencrypted manual backup.
//     HARD RULE: no password field ever enters "oros-mail-data".
//   · dirty: window.parent.orosSync.markDirty() after every write
// ============================================================
(function () {
  "use strict";

  var APP_VERSION = "0.1.0";
  var DATA_KEY  = "oros-mail-data";     // synced (no passwords inside)
  var CREDS_KEY = "oros-mail-creds";    // device-local — NEVER synced
  var LANG = (localStorage.getItem("oros-lang") === "el") ? "el" : "en";
  var FOLDERS = ["inbox", "sent", "drafts", "trash", "archive"];

  // ---------- 1. i18n ----------
  var S = {
    "app.name":        { en: "Mail", el: "Ταχυδρομείο" },
    "folder.inbox":    { en: "Inbox", el: "Εισερχόμενα" },
    "folder.sent":     { en: "Sent", el: "Απεσταλμένα" },
    "folder.drafts":   { en: "Drafts", el: "Πρόχειρα" },
    "folder.trash":    { en: "Trash", el: "Κάδος" },
    "folder.archive":  { en: "Archive", el: "Αρχείο" },
    "queued.line":     { en: "{n} queued for sending", el: "{n} στην ουρά αποστολής" },
    "btn.compose":     { en: "Compose", el: "Σύνθεση" },
    "btn.accounts":    { en: "Accounts", el: "Λογαριασμοί" },
    "btn.saveDraft":   { en: "Save draft", el: "Αποθήκευση πρόχειρου" },
    "btn.send":        { en: "Send", el: "Αποστολή" },
    "btn.cancel":      { en: "Cancel", el: "Άκυρο" },
    "btn.save":        { en: "Save", el: "Αποθήκευση" },
    "btn.delete":      { en: "Delete", el: "Διαγραφή" },
    "btn.edit":        { en: "Edit", el: "Επεξεργασία" },
    "btn.add":         { en: "Add account", el: "Προσθήκη λογαριασμού" },
    "btn.archive":     { en: "Archive", el: "Αρχειοθέτηση" },
    "btn.trash":       { en: "Move to Trash", el: "Στον Κάδο" },
    "setup.title":     { en: "Account setup", el: "Ρύθμιση λογαριασμού" },
    "setup.name":      { en: "Display name", el: "Εμφανιζόμενο όνομα" },
    "setup.email":     { en: "Email address", el: "Διεύθυνση email" },
    "setup.user":      { en: "Username", el: "Όνομα χρήστη" },
    "setup.pass":      { en: "Password", el: "Κωδικός" },
    "setup.proto":     { en: "Protocol", el: "Πρωτόκολλο" },
    "setup.inhost":    { en: "Incoming server (IMAP / POP3)", el: "Διακομιστής λήψης (IMAP / POP3)" },
    "setup.inport":    { en: "Incoming port", el: "Θύρα λήψης" },
    "setup.smtphost":  { en: "Outgoing server (SMTP)", el: "Διακομιστής αποστολής (SMTP)" },
    "setup.smtpport":  { en: "Outgoing port", el: "Θύρα αποστολής" },
    "setup.tls":       { en: "All connections use TLS/SSL — enforced.", el: "Όλες οι συνδέσεις γίνονται με TLS/SSL — υποχρεωτικά." },
    "setup.localpass": { en: "The password is stored on this device only — it never syncs and never exports.", el: "Ο κωδικός αποθηκεύεται μόνο σε αυτή τη συσκευή — δεν συγχρονίζεται και δεν εξάγεται ποτέ." },
    "accounts.title":  { en: "Accounts", el: "Λογαριασμοί" },
    "compose.title":   { en: "New message", el: "Νέο μήνυμα" },
    "compose.to":      { en: "To", el: "Προς" },
    "compose.subject": { en: "Subject", el: "Θέμα" },
    "compose.body":    { en: "Message", el: "Κείμενο" },
    "empty.noaccount": { en: "No account yet — add one to start.", el: "Κανένας λογαριασμός ακόμα — πρόσθεσε έναν για να ξεκινήσεις." },
    "empty.nomessages":{ en: "No messages", el: "Κανένα μήνυμα" },
    "empty.reading":   { en: "Select a message to read it", el: "Επίλεξε ένα μήνυμα για ανάγνωση" },
    "toast.saved":     { en: "Account saved", el: "Ο λογαριασμός αποθηκεύτηκε" },
    "toast.deleted":   { en: "Account deleted", el: "Ο λογαριασμός διαγράφηκε" },
    "toast.draft":      { en: "Draft saved", el: "Το πρόχειρο αποθηκεύτηκε" },
    "toast.queued":    { en: "Queued — the sending engine ships with Wave 1", el: "Στην ουρά — η μηχανή αποστολής έρχεται στο Wave 1" },
    "toast.moved":      { en: "Moved", el: "Μεταφέρθηκε" },
    "toast.noaccount": { en: "Add an account first", el: "Πρόσθεσε πρώτα έναν λογαριασμό" },
    "err.required":    { en: "Fill in all fields", el: "Συμπλήρωσε όλα τα πεδία" }
  };
  function t(k) { var e = S[k]; return e ? (e[LANG] || e.en) : k; }

  // ---------- 2. Storage ----------
  function dataRead() {
    try {
      var raw = JSON.parse(localStorage.getItem(DATA_KEY));
      if (raw && typeof raw === "object" && Array.isArray(raw.accounts)) return raw;
    } catch (e) {}
    return { ver: 1, accounts: [], prefs: { interval: 5 }, sendQueue: [] };
  }
  function dataWrite(d) {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(d)); } catch (e) {}
    markDirty();
  }
  function credsRead() {
    try {
      var c = JSON.parse(localStorage.getItem(CREDS_KEY));
      return (c && typeof c === "object") ? c : {};
    } catch (e) { return {}; }
  }
  function credsSave(accId, pass) {
    var c = credsRead();
    if (pass) c[accId] = pass; else delete c[accId];
    try { localStorage.setItem(CREDS_KEY, JSON.stringify(c)); } catch (e) {}
  }
  function markDirty() {
    try {
      if (window.parent && window.parent.orosSync &&
          typeof window.parent.orosSync.markDirty === "function") {
        window.parent.orosSync.markDirty();
      }
    } catch (e) {}
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function blankAccount() {
    return {
      id: uid(),
      name: "", email: "", proto: "imap",
      inHost: "", inPort: 993,
      smtpHost: "", smtpPort: 587,
      user: "",
      addedAt: Date.now(),
      boxes: { inbox: [], sent: [], drafts: [], trash: [], archive: [] }
    };
  }
  function mkMsg(o) {
    return {
      id: uid(),
      from: o.from || "",
      to: o.to || "",
      subject: o.subject || "",
      body: o.body || "",
      date: o.date || Date.now(),
      unread: o.unread !== false,
      threadId: o.threadId || null
    };
  }

  // ---------- 3. Palette bridge ----------
  var PAL_VARS = ["--accent", "--accent-soft", "--bg", "--surface", "--panel-bg",
                  "--text", "--text-dim", "--border", "--danger", "--shadow"];

  function applyPalette() {
    try {
      var pdoc = window.parent.document;
      var cs = window.parent.getComputedStyle(pdoc.documentElement);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone fallback: mail.css :root */ }
  }
  function watchPalette() {
    try {
      var obs = new MutationObserver(applyPalette);
      obs.observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone — bridge stays static */ }
  }

  // ---------- 4. Rendering ----------
  // current view state
  var cur = { accId: null, folder: "inbox", msgId: null };

  var ICOMPOSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  var IPERSON  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"/></svg>';
  var IEYE     = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var IEYEOFF  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
  var IARCHIVE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';
  var ITRASH   = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    var loc = (LANG === "el") ? "el-GR" : "en-GB";
    var today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString(loc, { day: "2-digit", month: "short" });
  }
  function accountById(d, id) {
    for (var i = 0; i < d.accounts.length; i++) {
      if (d.accounts[i].id === id) return d.accounts[i];
    }
    return null;
  }
  function currentAccount(d) {
    if (cur.accId) {
      var a = accountById(d, cur.accId);
      if (a) return a;
    }
    // first persisted selection sticks; otherwise first account
    if (d.accounts.length) {
      cur.accId = d.accounts[0].id;
      return d.accounts[0];
    }
    return null;
  }

  function buildHeader() {
    var h = document.getElementById("mail-header");

    var title = document.createElement("span");
    title.className = "mh-title";
    title.textContent = t("app.name");

    var spacer = document.createElement("span");
    spacer.className = "mh-spacer";

    var acctSel = document.createElement("select");
    acctSel.id = "mh-acct";
    acctSel.style.display = "none";   // shown only with 2+ accounts
    acctSel.addEventListener("change", function () {
      cur.accId = acctSel.value;
      cur.msgId = null;
      renderAll();
    });

    var compBtn = document.createElement("button");
    compBtn.className = "mh-btn";
    compBtn.innerHTML = ICOMPOSE + "<span>" + esc(t("btn.compose")) + "</span>";
    compBtn.addEventListener("click", function () { openCompose(null); });

    var acctBtn = document.createElement("button");
    acctBtn.className = "mh-btn";
    acctBtn.innerHTML = IPERSON + "<span>" + esc(t("btn.accounts")) + "</span>";
    acctBtn.addEventListener("click", openAccounts);

    h.appendChild(title);
    h.appendChild(spacer);
    h.appendChild(acctSel);
    h.appendChild(compBtn);
    h.appendChild(acctBtn);
  }

    function renderFolders(d) {
    var nav = document.getElementById("mail-folders");
    nav.innerHTML = "";

    var acc = currentAccount(d);
    if (!acc) return;

    FOLDERS.forEach(function (f) {
      var msgs = (acc.boxes[f] || []);
      var unread = msgs.filter(function (m) { return m.unread; }).length;

      var b = document.createElement("button");
      b.className = "mf-item" + ((cur.folder === f) ? " active" : "");
      b.dataset.folder = f;

      var lab = document.createElement("span");
      lab.className = "mf-label";
      lab.textContent = t("folder." + f);

      b.appendChild(lab);

      if (unread > 0) {
        var cnt = document.createElement("span");
        cnt.className = "mf-badge";
        cnt.textContent = String(unread);
        b.appendChild(cnt);
      }

      b.addEventListener("click", function () {
        cur.folder = f;
        cur.msgId = null;
        renderAll();
      });

      nav.appendChild(b);
    });
  }

  function renderList(d) {
    var wrap = document.getElementById("mail-list");
    wrap.innerHTML = "";

    var acc = currentAccount(d);
    if (!acc) return;

    var msgs = (acc.boxes[cur.folder] || []);

    if (!msgs.length) {
      var em = document.createElement("div");
      em.className = "ml-empty";
      em.textContent = t("empty.nomessages");
      wrap.appendChild(em);
      return;
    }

    // newest first
    msgs.slice().sort(function (a, b) { return b.date - a.date; })
      .forEach(function (m) {

      var it = document.createElement("div");
      it.className = "ml-item" +
        (m.unread ? " unread" : "") +
        ((cur.msgId === m.id) ? " selected" : "");

      var top = document.createElement("div");
      top.className = "ml-top";

      var from = document.createElement("span");
      from.className = "ml-from";
      from.textContent = (cur.folder === "sent" || cur.folder === "drafts")
        ? (m.to || "—") : (m.from || "—");

      var date = document.createElement("span");
      date.className = "ml-date";
      date.textContent = fmtDate(m.date);

      top.appendChild(from);
      top.appendChild(date);

      var subj = document.createElement("div");
      subj.className = "ml-subject";
      subj.textContent = m.subject || "(" + t("compose.body") + ")";

      var prev = document.createElement("div");
      prev.className = "ml-preview";
      prev.textContent = (m.body || "").replace(/\s+/g, " ").slice(0, 120);

      it.appendChild(top);
      it.appendChild(subj);
      it.appendChild(prev);

      it.addEventListener("click", function () {
        cur.msgId = m.id;
        if (m.unread) {
          m.unread = false;
          dataWrite(d);
        }
        renderAll();
      });

      wrap.appendChild(it);
    });
  }

  function renderReading(d) {
    var pane = document.getElementById("mail-reading");
    pane.innerHTML = "";

    var acc = currentAccount(d);
    if (!acc) return;

    if (!cur.msgId) {
      var em = document.createElement("div");
      em.className = "mr-empty";
      em.textContent = t("empty.reading");
      pane.appendChild(em);
      return;
    }

    var msg = null;
    var msgs = acc.boxes[cur.folder] || [];
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].id === cur.msgId) { msg = msgs[i]; break; }
    }
    if (!msg) { cur.msgId = null; renderAll(); return; }

    var head = document.createElement("div");
    head.className = "mr-head";

    var lines = document.createElement("div");
    lines.className = "mr-lines";

    var mkLine = function (label, value) {
      var l = document.createElement("div");
      l.className = "mr-line";
      var k = document.createElement("span");
      k.className = "mr-k";
      k.textContent = label;
      var v = document.createElement("span");
      v.className = "mr-v";
      v.textContent = value || "";
      l.appendChild(k);
      l.appendChild(v);
      return l;
    };

        lines.appendChild(mkLine((cur.folder === "sent" || cur.folder === "drafts")
      ? t("compose.to") : "From", (cur.folder === "sent" || cur.folder === "drafts")
      ? msg.to : msg.from));
    lines.appendChild(mkLine(t("compose.subject"), msg.subject));
    var dtLabel = (LANG === "el") ? "Ώρα" : "Time";
    lines.appendChild(mkLine(dtLabel, new Date(msg.date).toLocaleString(
      (LANG === "el") ? "el-GR" : "en-GB")));

    var actions = document.createElement("div");
    actions.className = "mr-actions";

    if (cur.folder === "drafts") {
      var editBtn = document.createElement("button");
      editBtn.className = "mh-btn small";
      editBtn.textContent = t("btn.edit");
      editBtn.addEventListener("click", function () { openCompose(msg); });
      actions.appendChild(editBtn);
    }

    var archBtn = document.createElement("button");
    archBtn.className = "mh-btn small";
    archBtn.innerHTML = IARCHIVE + "<span>" + esc(t("btn.archive")) + "</span>";
    archBtn.addEventListener("click", function () {
      moveTo(d, msg, "archive"); toast(t("toast.moved"));
    });
    actions.appendChild(archBtn);

    var trashBtn = document.createElement("button");
    trashBtn.className = "mh-btn small danger";
    trashBtn.innerHTML = ITRASH + "<span>" + esc(t("btn.trash")) + "</span>";
    trashBtn.addEventListener("click", function () {
      moveTo(d, msg, "trash"); toast(t("toast.moved"));
    });
    actions.appendChild(trashBtn);

    head.appendChild(lines);
    head.appendChild(actions);
    pane.appendChild(head);

    var body = document.createElement("div");
    body.className = "mr-body";
    body.textContent = msg.body || "";
    pane.appendChild(body);
  }

  function moveTo(d, msg, targetFolder) {
    var acc = currentAccount(d);
    if (!acc) return;
    FOLDERS.forEach(function (f) {
      var arr = acc.boxes[f] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === msg.id) { arr.splice(i, 1); break; }
      }
    });
    if (targetFolder !== "trash" && cur.folder === "trash") {
      // deleting from trash drops the message for good — no second trash
      dataWrite(d);
    } else {
      (acc.boxes[targetFolder] = acc.boxes[targetFolder] || []).push(msg);
      dataWrite(d);
    }
    cur.msgId = null;
    renderAll();
  }

  function renderAll() {
    var d = dataRead();
    var hasAccount = (d.accounts.length > 0);
    document.getElementById("mail-empty").style.display =
      hasAccount ? "none" : "flex";
    document.getElementById("mail-layout").style.display =
      hasAccount ? "grid" : "none";

    var sel = document.getElementById("mh-acct");
    if (sel) {
      sel.innerHTML = "";
      if (d.accounts.length >= 2) {
        d.accounts.forEach(function (a) {
          var op = document.createElement("option");
          op.value = a.id;
          op.textContent = a.email || a.name || a.user || "?";
          if (a.id === currentAccount(d).id) op.selected = true;
          sel.appendChild(op);
        });
        sel.style.display = "";
      } else {
        sel.style.display = "none";
      }
    }

    renderFolders(d);
    renderList(d);
    renderReading(d);
    renderQueueBadge(d);
  }

  function renderQueueBadge(d) {
    var title = document.querySelector(".mh-title");
    if (!title) return;
    var old = document.getElementById("mh-queue");
    if (old) old.remove();

    if (d.sendQueue && d.sendQueue.length) {
      var b = document.createElement("span");
      b.id = "mh-queue";
      b.className = "mh-queue";
      b.textContent = t("queued.line").replace("{n}", String(d.sendQueue.length));
      title.parentNode.insertBefore(b, title.nextSibling);
    }
  }

  // ---------- 5. Accounts manager + setup ----------
  function openAccounts() {
    var dlg = document.createElement("dialog");
    dlg.className = "mail-dialog";
    var box = document.createElement("div");
    box.className = "md-box";

    var h = document.createElement("h2");
    h.textContent = t("accounts.title");

    var list = document.createElement("div");
    list.className = "md-accounts";

    var d = dataRead();

    if (!d.accounts.length) {
      var em = document.createElement("div");
      em.className = "md-empty";
      em.textContent = t("empty.noaccount");
      list.appendChild(em);
    }

    d.accounts.forEach(function (a) {
      var row = document.createElement("div");
      row.className = "md-acc-row";

      var info = document.createElement("div");
      info.className = "md-acc-info";
      var nm = document.createElement("div");
      nm.className = "md-acc-name";
      nm.textContent = a.email || a.name || a.user || "?";
      var meta = document.createElement("div");
      meta.className = "md-acc-meta";
      meta.textContent = a.proto.toUpperCase() + " · " +
        (a.inHost || "?") + ":" + a.inPort + " · SMTP " +
        (a.smtpHost || "?") + ":" + a.smtpPort;
      info.appendChild(nm);
      info.appendChild(meta);

      var acts = document.createElement("div");
      acts.className = "md-acc-acts";

      var editBtn = document.createElement("button");
      editBtn.className = "mh-btn small";
      editBtn.textContent = t("btn.edit");
      editBtn.addEventListener("click", function () {
        dlg.close(); openSetup(a);
      });

      var delBtn = document.createElement("button");
      delBtn.className = "mh-btn small danger";
      delBtn.textContent = t("btn.delete");
      delBtn.addEventListener("click", function () {
        var dd = dataRead();
        dd.accounts = dd.accounts.filter(function (x) {
          return x.id !== a.id;
        });
        dataWrite(dd);
        credsSave(a.id, null); // wipe device-local credential too
        if (cur.accId === a.id) { cur.accId = null; cur.msgId = null; }
        toast(t("toast.deleted"));
        renderAll();
        dlg.close(); openAccounts();
      });

      acts.appendChild(editBtn);
      acts.appendChild(delBtn);

      row.appendChild(info);
      row.appendChild(acts);
      list.appendChild(row);
    });

    var addBtn = document.createElement("button");
    addBtn.className = "mh-btn";
    addBtn.textContent = "+ " + t("btn.add");
    addBtn.addEventListener("click", function () {
      dlg.close(); openSetup(null);
    });

    var closeBtn = document.createElement("button");
    closeBtn.className = "mh-btn ghost";
    closeBtn.textContent = t("btn.cancel");
    closeBtn.addEventListener("click", function () { dlg.close(); });

    dlg.addEventListener("close", function () { dlg.remove(); });
    // close on outside click (certified orOS pattern)
    dlg.addEventListener("click", function (ev) {
      if (ev.target === dlg) dlg.close();
    });

    box.appendChild(h);
    box.appendChild(list);
    box.appendChild(addBtn);
    box.appendChild(closeBtn);
    dlg.appendChild(box);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function openSetup(existing) {
    var d = dataRead();
    var acc = existing || blankAccount();

    var dlg = document.createElement("dialog");
    dlg.className = "mail-dialog";
    var box = document.createElement("div");
    box.className = "md-box";

    var h = document.createElement("h2");
    h.textContent = t("setup.title");

    var form = document.createElement("div");
    form.className = "md-form";

    function field(labelTxt, inputEl) {
      var w = document.createElement("div");
      w.className = "md-field";
      var l = document.createElement("label");
      l.textContent = labelTxt;
      w.appendChild(l);
      w.appendChild(inputEl);
      form.appendChild(w);
    }

    var nameI = document.createElement("input");
    nameI.type = "text"; nameI.value = acc.name || ""; nameI.autocomplete = "off";

    var emailI = document.createElement("input");
    emailI.type = "email"; emailI.value = acc.email || ""; emailI.autocomplete = "off";

    var protoI = document.createElement("select");
    ["imap", "pop3"].forEach(function (p) {
      var op = document.createElement("option");
      op.value = p; op.textContent = p.toUpperCase();
      if (acc.proto === p) op.selected = true;
      protoI.appendChild(op);
    });
    protoI.addEventListener("change", function () {
      inPortI.value = (protoI.value === "pop3") ? "995" : "993";
    });

    var inHostI = document.createElement("input");
    inHostI.type = "text"; inHostI.value = acc.inHost || ""; inHostI.autocomplete = "off";

    var inPortI = document.createElement("input");
    inPortI.type = "number"; inPortI.value = acc.inPort || 993; inPortI.min = 1; inPortI.max = 65535;

    var smtpHostI = document.createElement("input");
    smtpHostI.type = "text"; smtpHostI.value = acc.smtpHost || ""; smtpHostI.autocomplete = "off";

    var smtpPortI = document.createElement("input");
    smtpPortI.type = "number"; smtpPortI.value = acc.smtpPort || 587; smtpPortI.min = 1; smtpPortI.max = 65535;

    var userI = document.createElement("input");
    userI.type = "text"; userI.value = acc.user || ""; userI.autocomplete = "off";

    var passWrap = document.createElement("div");
    passWrap.className = "md-pass-row";
    var passI = document.createElement("input");
    passI.type = "password";
    passI.placeholder = existing ? "••••••••" : "";
    passI.autocomplete = "new-password";
    var eyeBtn = document.createElement("button");
    eyeBtn.type = "button";
    eyeBtn.className = "mh-btn small ghost";
    eyeBtn.innerHTML = IEYE;
    eyeBtn.addEventListener("click", function () {
      var show = (passI.type === "password");
      passI.type = show ? "text" : "password";
      eyeBtn.innerHTML = show ? IEYEOFF : IEYE;
      passI.focus();
    });
    passWrap.appendChild(passI);
    passWrap.appendChild(eyeBtn);

    field(t("setup.name"), nameI);
    field(t("setup.email"), emailI);
    field(t("setup.proto"), protoI);
    field(t("setup.inhost"), inHostI);
    field(t("setup.inport"), inPortI);
    field(t("setup.smtphost"), smtpHostI);
    field(t("setup.smtpport"), smtpPortI);
    field(t("setup.user"), userI);
    field(t("setup.pass"), passWrap);

    var tlsNote = document.createElement("div");
    tlsNote.className = "md-note";
    tlsNote.textContent = "🔒 " + t("setup.tls");

    var localNote = document.createElement("div");
    localNote.className = "md-note warn";
    localNote.textContent = "⚠ " + t("setup.localpass");

    var btnRow = document.createElement("div");
    btnRow.className = "md-btn-row";

    var cancelBtn = document.createElement("button");
    cancelBtn.className = "mh-btn ghost";
    cancelBtn.textContent = t("btn.cancel");
    cancelBtn.addEventListener("click", function () { dlg.close(); });

    var saveBtn = document.createElement("button");
    saveBtn.className = "mh-btn";
    saveBtn.textContent = t("btn.save");
    saveBtn.addEventListener("click", function () {
      if (!nameI.value.trim() || !emailI.value.trim() ||
          !inHostI.value.trim() || !smtpHostI.value.trim() ||
          !userI.value.trim()) {
        toast(t("err.required"));
        return;
      }
      acc.name = nameI.value.trim();
      acc.email = emailI.value.trim();
      acc.proto = protoI.value;
      acc.inHost = inHostI.value.trim();
      acc.inPort = parseInt(inPortI.value, 10) || 993;
      acc.smtpHost = smtpHostI.value.trim();
      acc.smtpPort = parseInt(smtpPortI.value, 10) || 587;
      acc.user = userI.value.trim();

      if (passI.value) credsSave(acc.id, passI.value); // device-local only

      var dd = dataRead();
      var found = false;
      for (var i = 0; i < dd.accounts.length; i++) {
        if (dd.accounts[i].id === acc.id) {
          // never touch boxes/password here — only config
          dd.accounts[i] = Object.assign({}, dd.accounts[i], {
            name: acc.name, email: acc.email, proto: acc.proto,
            inHost: acc.inHost, inPort: acc.inPort,
            smtpHost: acc.smtpHost, smtpPort: acc.smtpPort, user: acc.user
          });
          found = true; break;
        }
      }
      if (!found) dd.accounts.push(acc);

      dataWrite(dd);
      cur.accId = acc.id;
      cur.folder = "inbox";
      cur.msgId = null;
      toast(t("toast.saved"));
      renderAll();
      dlg.close();
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);

    dlg.addEventListener("close", function () { dlg.remove(); });
    dlg.addEventListener("click", function (ev) {
      if (ev.target === dlg) dlg.close();
    });

    box.appendChild(h);
    box.appendChild(form);
    box.appendChild(tlsNote);
    box.appendChild(localNote);
    box.appendChild(btnRow);
    dlg.appendChild(box);
    document.body.appendChild(dlg);
    dlg.showModal();
    nameI.focus();
  }

  // ---------- 6. Compose ----------
  function openCompose(draft) {
    var d = dataRead();
    if (!d.accounts.length) { toast(t("toast.noaccount")); openSetup(null); return; }

    var acc = currentAccount(d);
    var msg = draft || null;

    var dlg = document.createElement("dialog");
    dlg.className = "mail-dialog wide";
    var box = document.createElement("div");
    box.className = "md-box";

    var h = document.createElement("h2");
    h.textContent = t("compose.title");

    var form = document.createElement("div");
    form.className = "md-form";

    var toI = document.createElement("input");
    toI.type = "text"; toI.value = msg ? (msg.to || "") : "";
    toI.placeholder = "name@example.com";

    var subjI = document.createElement("input");
    subjI.type = "text"; subjI.value = msg ? (msg.subject || "") : "";

    var bodyA = document.createElement("textarea");
    bodyA.rows = 12;
    bodyA.value = msg ? (msg.body || "") : "";

    var mkF = function (labelTxt, el) {
      var w = document.createElement("div");
      w.className = "md-field";
      var l = document.createElement("label");
      l.textContent = labelTxt;
      w.appendChild(l);
      w.appendChild(el);
      form.appendChild(w);
    };
    mkF(t("compose.to"), toI);
    mkF(t("compose.subject"), subjI);
    mkF(t("compose.body"), bodyA);

    var btnRow = document.createElement("div");
    btnRow.className = "md-btn-row";

    var cancelBtn = document.createElement("button");
    cancelBtn.className = "mh-btn ghost";
    cancelBtn.textContent = t("btn.cancel");
    cancelBtn.addEventListener("click", function () { dlg.close(); });

    var draftBtn = document.createElement("button");
    draftBtn.className = "mh-btn ghost";
    draftBtn.textContent = t("btn.saveDraft");
    draftBtn.addEventListener("click", function () {
      saveComposeDraft(false);
    });

    var sendBtn = document.createElement("button");
    sendBtn.className = "mh-btn";
    sendBtn.textContent = t("btn.send");
    sendBtn.addEventListener("click", function () {
      saveComposeDraft(true);
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(draftBtn);
    btnRow.appendChild(sendBtn);

    dlg.addEventListener("close", function () { dlg.remove(); });
    dlg.addEventListener("keydown", function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        saveComposeDraft(true);
      }
    });

    function saveComposeDraft(asSendQueue) {
      if (!toI.value.trim() && !subjI.value.trim() && !bodyA.value.trim()) {
        dlg.close(); // empty compose — silently discard
        return;
      }
      var dd = dataRead();
      var a = currentAccount(dd);
      if (!a) { dlg.close(); return; }

      if (msg) {
        // update existing draft / queued message in place
        FOLDERS.forEach(function (f) {
          (a.boxes[f] || []).forEach(function (m) {
            if (m.id === msg.id) {
              m.to = toI.value.trim();
              m.subject = subjI.value.trim();
              m.body = bodyA.value;
            }
          });
        });
        dd.sendQueue = (dd.sendQueue || []).filter(function (q) {
          return q.id !== msg.id;
        });
        var m2 = msg;
      } else {
        var m2 = mkMsg({
          from: a.email || a.user,
          to: toI.value.trim(),
          subject: subjI.value.trim(),
          body: bodyA.value,
          unread: false
        });
        m2.threadId = m2.id;
      }

      if (asSendQueue) {
        // move out of drafts into the outgoing queue
        a.boxes.drafts = (a.boxes.drafts || []).filter(function (m) {
          return m.id !== m2.id;
        });
        dd.sendQueue = dd.sendQueue || [];
        dd.sendQueue.push({
          id: m2.id, accId: a.id, from: m2.from, to: m2.to,
          subject: m2.subject, body: m2.body, date: m2.date, tries: 0
        });
        dataWrite(dd);
        toast(t("toast.queued"));
      } else {
        a.boxes.drafts = (a.boxes.drafts || []).filter(function (m) {
          return m.id !== m2.id;
        });
        a.boxes.drafts.push(m2);
        dataWrite(dd);
        toast(t("toast.draft"));
      }
      renderAll();
      dlg.close();
    }

    box.appendChild(h);
    box.appendChild(form);
    box.appendChild(btnRow);
    dlg.appendChild(box);
    document.body.appendChild(dlg);
    dlg.showModal();
    toI.focus();
  }

  // ---------- 7. Toast ----------
  var toastTimer = null;
  function toast(txt) {
    var el = document.getElementById("mail-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "mail-toast";
      el.className = "mail-toast";
      document.body.appendChild(el);
    }
    el.textContent = txt;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 2600);
  }

  // ---------- 8. Boot ----------
  function boot() {
    buildHeader();

    // Compose shortcut: Ctrl+Alt+N (browser-safe — plain Ctrl+N is new window)
    document.addEventListener("keydown", function (ev) {
      if (ev.ctrlKey && ev.altKey && !ev.shiftKey &&
          (ev.key === "n" || ev.key === "N")) {
        ev.preventDefault();
        openCompose(null);
      }
    });

    // re-apply palette when parent notifies (fallback polling disabled —
    // MutationObserver on data-skin/data-theme covers all cases)
    applyPalette();
    watchPalette();

    renderAll();

    console.log("[orOS] mail.js v" + APP_VERSION + " booted" +
      (hasProxySliceSupport() ? " ✓ proxy slice registered" : " ✗ proxy slice not found"));
  }

  function hasProxySliceSupport() {
    try {
      return !!(window.parent.orosSync &&
        typeof window.parent.orosSync.registerSlice === "function");
    } catch (e) { return false; }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();