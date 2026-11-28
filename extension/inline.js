/* orOS add-on, Passwords: suggestions inside page forms (PW-AF7).
   Registered by background.js on https pages (top frame only) once the
   person allowed the add-on on all sites; never on the orOS address.
   It runs in the add-on's isolated world and holds no vault data: on a
   click (or Tab / ArrowDown) into a login, card or address field it
   asks background.js whether there is anything to offer, and if so
   shows the add-on's own page (inline.html, another origin the page
   cannot read) in a closed shadow root on the browser's top layer.
   The entries, their names and the values never pass through here:
   the list lives in inline.html, and a pick is filled by background.js
   with the same fillInPage() as the toolbar window, after this script
   confirms the list was really visible (clickjacking guard, below).
   classify() is exported for tests/extension-inline.test.js. */
(function () {
  "use strict";

  var NO_TYPES = ["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "file", "range", "color",
                  "date", "datetime-local", "month", "week", "time", "search"];
  var TEXT = ["text", "email", "tel", "number", "", "url", "password"];
  var AC_LOGIN = ["username", "current-password", "one-time-code"];
  var AC_PERSON = ["given-name", "additional-name", "family-name", "name", "street-address", "address-line1", "address-line2",
                   "address-level1", "address-level2", "postal-code", "country", "country-name", "organization"];
  /* label words (lower case, accents removed), the same words as pmfill.js */
  var RX = {
    user: /user|e-?mail|login|account|χρηστη|benutzer|anmelde/,
    otp: /one.?time|otp|totp|2fa|mfa|two.?factor|verification|auth.?code|κωδικ.*(επαληθευσης|μιας)|bestatigungs|einmal/,
    card: /card.?holder|name.?on.?card|cc.?(name|num|exp|csc)|card.?num|credit.?card|cvv|cvc|κατοχ|αριθμ.*καρτας|karteninhaber|kartennummer/,
    person: /first.?name|given|fname|last.?name|surname|family.?name|lname|full.?name|street|addr(ess)?.?(line)?.?[12]?\b|zip|postal|post.?code|\bcity\b|town|ονομα|επωνυμο|οδος|διευθυνση|ταχυδρομικος|πολη|vorname|nachname|strasse|straße|postleitzahl|\bplz\b|stadt/
  };

  /* f: {tag, type, ac (autocomplete, lower case), words (name, id,
     placeholder, aria-label, label texts; lower case, no accents),
     pwBefore / pwAfter (a visible current-password field follows /
     comes before it in the same form), readOnly, disabled}
     → "login" | "card" | "person" | "" */
  function classify(f) {
    if (!f || f.tag !== "INPUT" || f.disabled || f.readOnly) return "";
    var type = String(f.type || "").toLowerCase();
    if (NO_TYPES.indexOf(type) >= 0 || TEXT.indexOf(type) < 0) return "";
    var tk = String(f.ac || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (tk.indexOf("new-password") >= 0) return "";          // sign-up or change: nothing to offer
    if (tk.some(function (t) { return AC_LOGIN.indexOf(t) >= 0; })) return "login";
    if (tk.some(function (t) { return t.indexOf("cc-") === 0; })) return "card";
    if (tk.some(function (t) { return AC_PERSON.indexOf(t) >= 0; })) return "person";
    if (type === "password") return "login";
    var w = String(f.words || "");
    if (RX.card.test(w)) return "card";
    if (f.pwAfter && RX.user.test(w)) return "login";
    if (f.pwAfter && (type === "email" || type === "text" || type === "tel" || type === "")) return "login";
    if (RX.otp.test(w)) return "login";
    if (/user|login|χρηστη|benutzer|anmelde/.test(w)) return "login";   // a two-step sign-in ("Όνομα χρήστη" before "όνομα")
    if (RX.person.test(w)) return "person";
    return "";
  }

  if (typeof module === "object" && module.exports) { module.exports = { classify: classify }; return; }
  if (window.__orosInline) return;
  window.__orosInline = true;
  if (window !== window.top) return;

  var api = typeof browser !== "undefined" ? browser : chrome;

  function words(el) {
    var t = [el.name, el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label")];
    try { if (el.labels) for (var i = 0; i < el.labels.length; i++) t.push(el.labels[i].textContent); } catch (e) {}
    return t.filter(Boolean).join(" ").slice(0, 300).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function shown(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }
  function describe(el) {
    var scope = el.form || document;
    var pws = Array.prototype.filter.call(scope.querySelectorAll("input[type=password]"), function (p) {
      return p !== el && shown(p) && !/new-password/i.test(p.getAttribute("autocomplete") || "");
    });
    return {
      tag: el.tagName, type: el.type, ac: el.getAttribute("autocomplete") || "", words: words(el),
      readOnly: el.readOnly, disabled: el.disabled,
      pwAfter: pws.some(function (p) { return el.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING; })
    };
  }
  function fieldOf(ev) {
    var path = ev.composedPath ? ev.composedPath() : [ev.target];
    var el = path && path[0];
    return el && el.tagName === "INPUT" ? el : null;
  }

  /* ---------- the menu ---------- */
  var host = null, root = null, pop = null, frame = null;
  var state = null;   // { token, field, kind, shownAt, rows }
  var asking = false;
  var WIDTH_MIN = 260, WIDTH_MAX = 360, ROW = 46, HEAD = 30, LOCKED = 104;
  var canPopover = typeof HTMLElement.prototype.showPopover === "function";

  function build() {
    if (host && host.isConnected) return;
    host = document.createElement("oros-fill");
    root = host.attachShadow({ mode: "closed" });
    var st = document.createElement("style");
    st.textContent =
      ":host{all:initial!important;position:static!important;display:block!important;opacity:1!important;" +
      "visibility:visible!important;filter:none!important;transform:none!important}" +
      ".m{all:initial;position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;" +
      "z-index:2147483647;opacity:1;filter:none;transform:none;display:none}" +
      ".m.on{display:block}" +
      "iframe{all:initial;display:block;border:0;border-radius:10px;box-shadow:0 6px 24px #0005;color-scheme:normal;background:transparent}";
    root.appendChild(st);
    pop = document.createElement("div");
    pop.className = "m";
    if (canPopover) pop.setAttribute("popover", "manual");
    root.appendChild(pop);
    document.documentElement.appendChild(host);
  }

  function place() {
    if (!state || !pop) return;
    var r = state.field.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.width < 2) { close(false); return; }
    var w = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, Math.round(r.width)));
    var h = state.h;
    var left = Math.max(4, Math.min(Math.round(r.left), innerWidth - w - 4));
    var top = Math.round(r.bottom + 4);
    if (top + h > innerHeight - 4 && r.top - h - 4 > 4) top = Math.round(r.top - h - 4);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    frame.style.width = w + "px";
    frame.style.height = h + "px";
  }

  function close(refocus) {
    var s = state;
    state = null;
    if (pop) {
      if (canPopover) { try { pop.hidePopover(); } catch (e) {} }
      pop.classList.remove("on");
      pop.textContent = "";
    }
    frame = null;
    if (s) {
      api.runtime.sendMessage({ t: "ii-close", token: s.token }).catch(function () {});
      if (refocus && s.field.isConnected) { try { s.field.focus({ preventScroll: true }); } catch (e) {} }
    }
  }

  function open(field) {
    if (asking || (state && state.field === field)) return;
    var kind = classify(describe(field));
    if (!kind) return;
    close(false);
    asking = true;
    api.runtime.sendMessage({ t: "ii-open", kind: kind }).then(function (r) {
      asking = false;
      if (!r || !r.show || typeof r.token !== "string" || document.activeElement !== field) return;
      build();
      frame = document.createElement("iframe");
      frame.setAttribute("title", "orOS");
      frame.setAttribute("tabindex", "-1");
      frame.src = api.runtime.getURL("inline.html") + "#" + r.token;
      pop.textContent = "";
      pop.appendChild(frame);
      state = { token: r.token, field: field, kind: kind, shownAt: Date.now(),
                h: r.locked ? LOCKED : HEAD + ROW * Math.max(1, Math.min(4, r.rows | 0)) + 8 };
      pop.classList.add("on");
      if (canPopover) { try { pop.showPopover(); } catch (e) {} }
      place();
    }, function () { asking = false; });
  }

  /* Clickjacking guard: before background.js fills, the list must have
     been on screen for 500 ms, on the top layer, in a visible tab, and
     neither it nor the page root may be faded, filtered or moved away.
     The menu page adds its own IntersectionObserver v2 check where the
     browser has one (anything drawn over it). */
  function looksReal(token) {
    if (!state || state.token !== token || !frame || !host || !host.isConnected) return false;
    if (Date.now() - state.shownAt < 500) return false;
    if (document.visibilityState !== "visible") return false;
    if (host.parentNode !== document.documentElement) return false;
    if (canPopover) { try { if (!pop.matches(":popover-open")) return false; } catch (e) { return false; } }
    var chain = [pop, host, document.documentElement, document.body];
    for (var i = 0; i < chain.length; i++) {
      var el = chain[i];
      if (!el) continue;
      var cs = getComputedStyle(el);
      if (parseFloat(cs.opacity) < 1 || cs.visibility !== "visible" || (cs.filter && cs.filter !== "none")) return false;
      if (el !== pop && el !== host && cs.transform && cs.transform !== "none") return false;
    }
    var fr = frame.getBoundingClientRect();
    if (fr.width < 100 || fr.height < 30) return false;
    var x = fr.left + fr.width / 2, y = fr.top + Math.min(fr.height / 2, 20);
    var top = document.elementFromPoint(x, y);
    return top === host;
  }

  api.runtime.onMessage.addListener(function (m, sender, reply) {
    if (!m || sender.id !== api.runtime.id || sender.tab) return false;
    if (m.t === "ii-check") { reply({ ok: looksReal(m.token) }); return false; }
    if (m.t === "ii-done" && state && state.token === m.token) close(!!m.refocus);
    return false;
  });

  /* Open only on the person's own action: a click into the field,
     Tab into it, or ArrowDown in it. */
  var lastTab = 0;
  document.addEventListener("keydown", function (ev) {
    if (!ev.isTrusted) return;
    if (ev.key === "Tab") lastTab = Date.now();
    var f = fieldOf(ev);
    if (!f) return;
    if (ev.key === "Escape" && state && state.field === f) { close(false); return; }
    if (ev.key === "ArrowDown" && !ev.altKey) {
      if (state && state.field === f && frame) { ev.preventDefault(); try { frame.focus(); } catch (e) {} }
      else open(f);
    }
  }, true);
  document.addEventListener("focusin", function (ev) {
    if (!ev.isTrusted || Date.now() - lastTab > 400) return;
    var f = fieldOf(ev);
    if (f && !f.value) open(f);
  }, true);
  document.addEventListener("click", function (ev) {
    if (!ev.isTrusted) return;
    var f = fieldOf(ev);
    if (f) open(f);
  }, true);
  document.addEventListener("mousedown", function (ev) {
    if (!state || !ev.isTrusted) return;
    var p = ev.composedPath ? ev.composedPath() : [ev.target];
    if (p.indexOf(host) >= 0 || p.indexOf(state.field) >= 0) return;
    close(false);
  }, true);
  document.addEventListener("input", function (ev) {
    if (state && ev.isTrusted && fieldOf(ev) === state.field) close(false);
  }, true);
  document.addEventListener("focusout", function () {
    setTimeout(function () {
      if (!state) return;
      var a = document.activeElement;
      if (a === host || a === state.field) return;
      close(false);
    }, 0);
  }, true);
  addEventListener("scroll", function () { if (state) place(); }, true);
  addEventListener("resize", function () { if (state) place(); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState !== "visible") close(false); });
  addEventListener("pagehide", function () { close(false); });
})();
