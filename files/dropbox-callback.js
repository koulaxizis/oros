// orOS Files — Dropbox sign-in callback (files/dropbox-callback.html).
// Dropbox redirects here with ?code&state (or ?error). This page only
// passes them on, same origin: BroadcastChannel to an open Files, and
// localStorage "oros-files-dbx-cb" for a Files that opens later
// (redirect mode). Files checks the state against its own PKCE record
// and does the token exchange; nothing here talks to the network.
(function () {
  "use strict";
  var LANG = window.orosI18n ? window.orosI18n.lang() : (localStorage.getItem("oros-lang") === "el" ? "el" : "en");
  var T = {
    en: {
      "dbxcb.invalid": "Invalid answer from Dropbox.",
      "dbxcb.done": "Done. You can close this window.",
      "dbxcb.cancelled": "Sign-in cancelled. You can close this window.",
      "dbxcb.back": "Back to Files…"
    },
    el: {
      "dbxcb.invalid": "Μη έγκυρη απάντηση από το Dropbox.",
      "dbxcb.done": "Έτοιμο. Μπορείς να κλείσεις αυτό το παράθυρο.",
      "dbxcb.cancelled": "Η σύνδεση ακυρώθηκε. Μπορείς να κλείσεις αυτό το παράθυρο.",
      "dbxcb.back": "Επιστροφή στα Αρχεία…"
    }
  };
  if (window.orosI18n) window.orosI18n.table(T, "files", LANG);
  function t(k) { return (T[LANG] || T.en)[k] || T.en[k]; }
  var msg = document.getElementById("msg");
  var q = new URLSearchParams(location.search);
  var cb = {
    code: (q.get("code") || "").slice(0, 512),
    error: (q.get("error") || "").slice(0, 64),
    state: (q.get("state") || "").slice(0, 128),
    t: Date.now()
  };
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  if (!cb.state) {
    msg.textContent = t("dbxcb.invalid");
    return;
  }
  // Read the mode BEFORE posting: an open Files deletes the record at once.
  var mode = "popup";
  try { mode = (JSON.parse(localStorage.getItem("oros-files-dbx-pkce") || "{}") || {}).mode || "popup"; } catch (e) {}
  try { localStorage.setItem("oros-files-dbx-cb", JSON.stringify(cb)); } catch (e) {}
  try { new BroadcastChannel("oros-files-dbx").postMessage(cb); } catch (e) {}

  var ok = !cb.error && cb.code;
  if (mode !== "redirect") {
    msg.textContent = ok ? t("dbxcb.done") : t("dbxcb.cancelled");
    setTimeout(function () { try { window.close(); } catch (e) {} }, 400);
  } else {
    msg.textContent = t("dbxcb.back");
    location.replace("../?open=files");
  }
})();
