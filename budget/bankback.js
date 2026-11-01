// orOS Budget — the bank's answer (budget/bankback.html, wave BK-2):
// the redirect address of the person's Enable Banking application.
// After the bank's own sign-in the provider sends the person here with
// ?code&state (or ?error&state). This page only passes the answer on,
// same origin: BroadcastChannel to the open Budget, plus one
// localStorage record Budget reads and deletes at once (the channel can
// be missed). Budget checks the state against its own request and does
// the rest; nothing here talks to the network, and the address bar is
// cleared first. Opened in its own window it closes itself; opened in
// the orOS window (pop-ups blocked) it goes back to Budget.
(function () {
  "use strict";
  var LANG = window.orosI18n ? window.orosI18n.lang() : (localStorage.getItem("oros-lang") === "el" ? "el" : "en");
  var T = {
    en: {
      "bankcb.title": "Bank · orOS Budget",
      "bankcb.invalid": "Invalid answer from the bank.",
      "bankcb.done": "Done. Budget is connecting your account now. You can close this window.",
      "bankcb.cancelled": "The bank connection was cancelled. You can close this window.",
      "bankcb.back": "Back to Budget"
    },
    el: {
      "bankcb.title": "Τράπεζα · orOS",
      "bankcb.invalid": "Μη έγκυρη απάντηση από την τράπεζα.",
      "bankcb.done": "Έτοιμο. Η εφαρμογή συνδέει τώρα τον λογαριασμό σου. Μπορείς να κλείσεις αυτό το παράθυρο.",
      "bankcb.cancelled": "Η σύνδεση με την τράπεζα ακυρώθηκε. Μπορείς να κλείσεις αυτό το παράθυρο.",
      "bankcb.back": "Πίσω στην εφαρμογή"
    }
  };
  if (window.orosI18n) window.orosI18n.table(T, "budget", LANG);
  function t(k) { return (T[LANG] || T.en)[k] || T.en[k]; }
  var msg = document.getElementById("msg"), back = document.getElementById("back");
  document.title = t("bankcb.title");
  document.documentElement.lang = LANG;
  var q = new URLSearchParams(location.search);
  function get(k) { return String(q.get(k) || ""); }
  var cb = {
    code: get("code").slice(0, 512),
    error: get("error").slice(0, 64),
    state: get("state").slice(0, 64),
    t: Date.now()
  };
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(cb.state) || (cb.code && !/^[A-Za-z0-9._~-]{1,512}$/.test(cb.code))) {
    msg.textContent = t("bankcb.invalid");
    return;
  }
  try { localStorage.setItem("oros-budget-bankcb", JSON.stringify(cb)); } catch (e) {}
  try { new BroadcastChannel("oros-budget-bank").postMessage(cb); } catch (e) {}
  var ok = !cb.error && cb.code;
  msg.textContent = ok ? t("bankcb.done") : t("bankcb.cancelled");
  back.textContent = t("bankcb.back");
  back.hidden = false;
  if (window.name === "oros-bank" || window.opener) setTimeout(function () { try { window.close(); } catch (e) {} }, 500);
  else setTimeout(function () { location.replace("../?open=budget"); }, 900);
})();
