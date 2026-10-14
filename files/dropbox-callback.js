// orOS Files — Dropbox sign-in callback (files/dropbox-callback.html).
// Dropbox redirects here with ?code&state (or ?error). This page only
// passes them on, same origin: BroadcastChannel to an open Files, and
// localStorage "oros-files-dbx-cb" for a Files that opens later
// (redirect mode). Files checks the state against its own PKCE record
// and does the token exchange; nothing here talks to the network.
(function () {
  "use strict";
  var el = (localStorage.getItem("oros-lang") === "el");
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
    msg.textContent = el ? "Μη έγκυρη απάντηση από το Dropbox." : "Invalid answer from Dropbox.";
    return;
  }
  // Read the mode BEFORE posting: an open Files deletes the record at once.
  var mode = "popup";
  try { mode = (JSON.parse(localStorage.getItem("oros-files-dbx-pkce") || "{}") || {}).mode || "popup"; } catch (e) {}
  try { localStorage.setItem("oros-files-dbx-cb", JSON.stringify(cb)); } catch (e) {}
  try { new BroadcastChannel("oros-files-dbx").postMessage(cb); } catch (e) {}

  var ok = !cb.error && cb.code;
  if (mode !== "redirect") {
    msg.textContent = ok
      ? (el ? "Έτοιμο. Μπορείς να κλείσεις αυτό το παράθυρο." : "Done. You can close this window.")
      : (el ? "Η σύνδεση ακυρώθηκε. Μπορείς να κλείσεις αυτό το παράθυρο." : "Sign-in cancelled. You can close this window.");
    setTimeout(function () { try { window.close(); } catch (e) {} }, 400);
  } else {
    msg.textContent = el ? "Επιστροφή στα Αρχεία…" : "Back to Files…";
    location.replace("../?open=files");
  }
})();
