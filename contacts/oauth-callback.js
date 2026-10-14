// orOS Contacts — account sign-in callback (contacts/oauth-callback.html).
// Google answers with #access_token&state (token flow), Microsoft with
// ?code&state (PKCE code flow), either may answer ?error / #error.
// This page only passes the answer on, same origin: BroadcastChannel
// to the open Contacts, plus a localStorage record Contacts reads and
// deletes at once (the channel can be missed). Contacts checks the
// state against its own and does the rest; nothing here talks to the
// network, and the address bar is cleared first.
(function () {
  "use strict";
  var el = (localStorage.getItem("oros-lang") === "el");
  var msg = document.getElementById("msg");
  var q = new URLSearchParams(location.search);
  var h = new URLSearchParams(location.hash.replace(/^#/, ""));
  function get(k) { return h.get(k) || q.get(k) || ""; }
  var cb = {
    token: get("access_token").slice(0, 4096),
    code: get("code").slice(0, 4096),
    error: get("error").slice(0, 64),
    state: get("state").slice(0, 128),
    t: Date.now()
  };
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  if (!cb.state) {
    msg.textContent = el ? "Μη έγκυρη απάντηση σύνδεσης." : "Invalid sign-in answer.";
    return;
  }
  try { localStorage.setItem("oros-contacts-oauth-cb", JSON.stringify(cb)); } catch (e) {}
  try { new BroadcastChannel("oros-contacts-oauth").postMessage(cb); } catch (e) {}
  var ok = !cb.error && (cb.token || cb.code);
  msg.textContent = ok
    ? (el ? "Έτοιμο. Οι Επαφές διαβάζουν τώρα τα στοιχεία σου. Μπορείς να κλείσεις αυτό το παράθυρο." : "Done. Contacts is reading your contacts now. You can close this window.")
    : (el ? "Η σύνδεση ακυρώθηκε. Μπορείς να κλείσεις αυτό το παράθυρο." : "Sign-in cancelled. You can close this window.");
  setTimeout(function () { try { window.close(); } catch (e) {} }, 400);
})();
