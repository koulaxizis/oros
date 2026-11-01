/* orOS add-on, Passwords (PW-AF1): which entries fit the page, and
   the values a fill hands to the page. Pure helpers (popup.js and
   tests/extension-pm.test.js) plus fillInPage(), the one function the
   popup injects into the tab with scripting.executeScript after a
   click; it is self-contained (no closure), runs only in the page you
   chose to fill, and returns how many fields it filled.
   Rules (Bible PW-AF1): a login fits a page only when the page's host
   is the saved host or a sub-domain of it, and a login saved for https
   never fills a page on http. Cards, identities and addresses are not
   tied to a site: the person picks one. Nothing is filled without a
   click (or Enter on a focused button).
   readLogin() (PW-AF3) is the other injected function: after a click
   on "Save the login from this page" it reads the password the person
   typed (and the user name before it) from the top frame only. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OrosFill = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function urlOf(s) {
    s = String(s == null ? "" : s).trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
    try { return new URL(s); } catch (e) { return null; }
  }
  function hostOf(u) { return u ? u.hostname.replace(/\.$/, "").toLowerCase() : ""; }

  /* saved: a URL of the entry; page: the tab's URL. */
  function fits(saved, page) {
    var a = urlOf(saved), b = urlOf(page);
    if (!a || !b) return false;
    if (!/^https?:$/.test(b.protocol) || !/^https?:$/.test(a.protocol)) return false;
    if (a.protocol === "https:" && b.protocol !== "https:") return false;
    var sh = hostOf(a), ph = hostOf(b);
    if (!sh || !ph) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(sh) || sh.indexOf(":") >= 0) return sh === ph && a.port === b.port;
    if (sh.indexOf(".") < 0 && sh !== "localhost") return false;   // "com", "gr": never a whole suffix
    return ph === sh || ph.slice(-(sh.length + 1)) === "." + sh;
  }

  function kindOf(e, K) { return K ? K.kindOf(e) : "login"; }

  /* Logins (and 2FA-only entries) that fit the page, best first:
     exact host, then favourites, then title. */
  function matches(entries, page, K) {
    var ph = hostOf(urlOf(page));
    var out = [];
    (entries || []).forEach(function (e) {
      var k = kindOf(e, K);
      if (k !== "login" && k !== "otp") return;
      var best = -1;
      (e.urls || []).forEach(function (u) {
        if (!fits(u, page)) return;
        var score = hostOf(urlOf(u)) === ph ? 2 : 1;
        if (score > best) best = score;
      });
      if (best >= 0) out.push({ e: e, score: best });
    });
    out.sort(function (x, y) {
      return (y.score - x.score) || ((y.e.fav ? 1 : 0) - (x.e.fav ? 1 : 0)) ||
             String(x.e.title || "").toLowerCase().localeCompare(String(y.e.title || "").toLowerCase());
    });
    return out.map(function (x) { return x.e; });
  }

  /* entry (+ the current 2FA code, if any) → what fillInPage gets.
     Only the values of that one entry; never the rest of the vault. */
  function payload(e, K, otpCode) {
    var k = kindOf(e, K), d = K ? K.dataOf(e) : {};
    if (k === "login" || k === "otp") {
      return { kind: "login", user: e.user || "", pw: k === "otp" ? "" : (e.pw || ""), otp: otpCode || "" };
    }
    if (k === "card") {
      var p = K.parseExp(d.exp);
      return { kind: "card", name: d.holder || "", num: String(d.num || "").replace(/\D+/g, ""),
               mm: p ? (p.m < 10 ? "0" : "") + p.m : "", yyyy: p ? String(p.y) : "", cvv: d.cvv || "" };
    }
    if (k === "identity" || k === "address") {
      var first = d.first || "", last = d.last || "";
      if (k === "address" && d.name && !first) {
        var parts = String(d.name).trim().split(/\s+/);
        last = parts.length > 1 ? parts.pop() : "";
        first = parts.join(" ");
      }
      return { kind: "person", first: first, middle: d.middle || "", last: last,
               full: k === "address" ? (d.name || "") : [first, d.middle, last].filter(Boolean).join(" "),
               email: d.email || "", phone: d.phone || "", company: d.company || "", birth: d.birth || "",
               street: d.street || "", line2: [d.line2, d.floor].filter(Boolean).join(", "), city: d.city || "",
               zip: d.zip || "", region: d.region || "", country: d.country || "" };
    }
    return null;
  }

  /* Injected into the page. Fills the visible, enabled fields that
     fit, by the HTML autocomplete tokens first, then by name, id,
     placeholder and label text (EN / EL / DE). Sends input + change
     events through the native value setter, so React / Vue pages see
     the values. Returns the number of fields filled. */
  function fillInPage(p) {
    if (!p || typeof p !== "object") return 0;
    /* the page must still be the one the person chose (no navigation since) */
    if (p.frames) {
      /* the second pass into payment frames (cards only): only frames
         the person confirmed, never the top page again */
      if (p.kind !== "card" || window === window.top || p.frames.indexOf(location.origin) < 0) return 0;
    } else if (p.origin && p.origin !== location.origin) return -1;
    /* label texts are matched lower-case and without accents (labelText) */
    var RX = {
      user: /user|e-?mail|login|account|χρηστη|ονομα\s*χρηστη|benutzer|anmelde/i,
      otp: /one.?time|otp|totp|2fa|mfa|two.?factor|verification|security.?code|auth.?code|κωδικ.*(επαληθευσης|μιας)|bestatigungs|einmal/i,
      ccname: /card.?holder|name.?on.?card|cc.?name|κατοχ|karteninhaber/i,
      ccnum: /card.?num|cc.?num|credit.?card|αριθμ.*καρτας|kartennummer/i,
      ccexp: /exp|valid.?thru|ληξη|ablauf|gultig/i,
      ccmm: /month|mm\b|μηνας|monat/i,
      ccyy: /year|yy|ετος|jahr/i,
      cvv: /cvv|cvc|csc|security.?code|κωδικ.*ασφαλειας|pruf/i,
      first: /first.?name|given|fname|ονομα(?![α-ω])|vorname/i,
      last: /last.?name|surname|family|lname|(?<!ονοματ)επωνυμο|nachname/i,
      full: /full.?name|^name$|ονοματεπωνυμο|vollstandiger/i,
      email: /e-?mail/i,
      phone: /phone|tel|mobile|τηλεφωνο|κινητο|telefon/i,
      company: /company|organi[sz]ation|εταιρ|firma/i,
      street: /address.?(line)?.?1|street|addr1|οδος|διευθυνση|straße|strasse/i,
      line2: /address.?(line)?.?2|addr2|apartment|suite|floor|οροφ|adresszusatz/i,
      city: /city|town|locality|πολη|stadt|\bort\b/i,
      zip: /zip|postal|post.?code|τ\.?\s?κ\.?|ταχυδρομικος|plz|postleitzahl/i,
      region: /state|region|province|county|νομος|περιφερεια|bundesland/i,
      country: /country|χωρα|land(?![a-z])/i
    };
    var AC = {
      user: ["username", "email"], pw: ["current-password"], otp: ["one-time-code"],
      ccname: ["cc-name"], ccnum: ["cc-number"], ccexp: ["cc-exp"], ccmm: ["cc-exp-month"], ccyy: ["cc-exp-year"], cvv: ["cc-csc"],
      first: ["given-name"], middle: ["additional-name"], last: ["family-name"], full: ["name"], email: ["email"],
      phone: ["tel", "tel-national"], company: ["organization"], street: ["address-line1", "street-address"],
      line2: ["address-line2"], city: ["address-level2"], zip: ["postal-code"], region: ["address-level1"],
      country: ["country", "country-name"], bday: ["bday"]
    };
    function visible(el) {
      if (el.disabled || el.readOnly) return false;
      if (el.type === "hidden") return false;
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      var cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity || "1") > 0.05;
    }
    function labelText(el) {
      var t = [el.name, el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label")];
      if (el.labels) for (var i = 0; i < el.labels.length; i++) t.push(el.labels[i].textContent);
      return t.filter(Boolean).join(" ").slice(0, 300).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    }
    var KNOWN = /^(username|email|current-password|new-password|one-time-code|cc-|given-name|additional-name|family-name|name$|tel|organization|street-address|address-|postal-code|country|bday)/;
    function tokens(el) { return String(el.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/); }
    var all = Array.prototype.slice.call(document.querySelectorAll("input, select, textarea")).filter(visible);
    var used = [];
    function pick(key, opts) {
      opts = opts || {};
      var cands = all.filter(function (el) {
        if (used.indexOf(el) >= 0) return false;
        if (opts.types && opts.types.indexOf(el.type) < 0 && !(opts.select && el.tagName === "SELECT")) return false;
        return true;
      });
      var ac = AC[key] || [];
      for (var i = 0; i < cands.length; i++) {
        var tk = tokens(cands[i]);
        if (ac.some(function (a) { return tk.indexOf(a) >= 0; })) return cands[i];
      }
      if (opts.acOnly) return null;
      var rx = RX[key];
      if (!rx) return null;
      for (var j = 0; j < cands.length; j++) {
        /* a field whose autocomplete says it is something else is never guessed */
        if (tokens(cands[j]).some(function (x) { return KNOWN.test(x) && ac.indexOf(x) < 0; })) continue;
        if (rx.test(labelText(cands[j]))) return cands[j];
      }
      return null;
    }
    var proto = { INPUT: HTMLInputElement.prototype, TEXTAREA: HTMLTextAreaElement.prototype, SELECT: HTMLSelectElement.prototype };
    var n = 0;
    function put(el, v) {
      if (!el || v == null || v === "") return;
      used.push(el);
      if (el.tagName === "SELECT") {
        var want = String(v).toLowerCase(), hit = null;
        for (var i = 0; i < el.options.length && !hit; i++) {
          var o = el.options[i];
          if (o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want) hit = o;
        }
        if (!hit && /^\d+$/.test(v)) {
          for (var k = 0; k < el.options.length && !hit; k++) {
            if (/^\d+$/.test(el.options[k].value) && parseInt(el.options[k].value, 10) === parseInt(v, 10)) hit = el.options[k];
          }
        }
        if (!hit) return;
        el.value = hit.value;
      } else {
        try { el.focus({ preventScroll: true }); } catch (e) {}
        var d = Object.getOwnPropertyDescriptor(proto[el.tagName], "value");
        if (d && d.set) d.set.call(el, String(v)); else el.value = String(v);
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      n++;
    }
    var TEXT = ["text", "email", "tel", "search", "number", "", "url"];
    if (p.kind === "login") {
      var pws = all.filter(function (el) { return el.type === "password" && tokens(el).indexOf("new-password") < 0; });
      if (!pws.length) pws = all.filter(function (el) { return el.type === "password"; }).slice(0, 1);
      var pw = pws[0] || null;
      var user = pick("user", { types: ["text", "email", "tel", ""] , acOnly: true });
      if (!user && pw) {
        /* the text field right before the password field */
        var before = all.filter(function (el) { return TEXT.indexOf(el.type) >= 0 && el.tagName === "INPUT" &&
          (el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING); });
        user = pick("user", { types: ["text", "email", "tel", ""] });
        if (!user && before.length) user = before[before.length - 1];
      }
      if (!user && !pw) user = pick("user", { types: ["text", "email", "tel", ""] });
      if (p.user && user) put(user, p.user);
      if (p.pw && pw) put(pw, p.pw);
      if (p.otp) {
        var otp = pick("otp", { types: ["text", "tel", "number", "password", ""], acOnly: true }) ||
                  (!pw ? pick("otp", { types: ["text", "tel", "number", ""] }) : null);
        if (otp) put(otp, p.otp);
      }
      return n;
    }
    if (p.kind === "card") {
      put(pick("ccname", { types: TEXT }), p.name);
      put(pick("ccnum", { types: TEXT.concat(["password"]) }), p.num);
      var exp = pick("ccexp", { types: TEXT, acOnly: true });
      var mm = pick("ccmm", { types: TEXT, select: true, acOnly: true }) , yy = pick("ccyy", { types: TEXT, select: true, acOnly: true });
      if (!exp && !mm) {
        mm = pick("ccmm", { types: TEXT, select: true });
        yy = pick("ccyy", { types: TEXT, select: true });
        if (!mm) exp = pick("ccexp", { types: TEXT });
      }
      if (exp) put(exp, p.mm && p.yyyy ? p.mm + "/" + (exp.maxLength >= 7 ? p.yyyy : p.yyyy.slice(2)) : "");
      if (mm) put(mm, p.mm);
      if (yy) {
        var two = (yy.maxLength > 0 && yy.maxLength <= 2) ||
                  (yy.tagName === "SELECT" && Array.prototype.some.call(yy.options, function (o) { return /^\d{2}$/.test(o.value); }) &&
                   !Array.prototype.some.call(yy.options, function (o) { return /^\d{4}$/.test(o.value); }));
        put(yy, two ? p.yyyy.slice(2) : p.yyyy);
      }
      put(pick("cvv", { types: TEXT.concat(["password"]) }), p.cvv);
      return n;
    }
    if (p.kind === "person") {
      var f = pick("first", { types: TEXT }), l = pick("last", { types: TEXT });
      if (f || l) { put(f, p.first); put(pick("middle", { types: TEXT, acOnly: true }), p.middle); put(l, p.last); }
      else put(pick("full", { types: TEXT }), p.full);
      put(pick("email", { types: TEXT }), p.email);
      put(pick("phone", { types: TEXT }), p.phone);
      put(pick("company", { types: TEXT }), p.company);
      put(pick("street", { types: TEXT.concat(["textarea"]) }), p.street);
      put(pick("line2", { types: TEXT }), p.line2);
      put(pick("city", { types: TEXT }), p.city);
      put(pick("zip", { types: TEXT }), p.zip);
      put(pick("region", { types: TEXT, select: true }), p.region);
      put(pick("country", { types: TEXT, select: true }), p.country);
      put(pick("bday", { types: ["date", "text"], acOnly: true }), p.birth);
      return n;
    }
    return 0;
  }

  /* Injected into the top page before a card fill: the https origins
     of the visible frames from other sites (payment forms such as
     Stripe put the card number there). Only addresses, no content. */
  function framesInPage() {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll("iframe"), function (f) {
      var r = f.getBoundingClientRect();
      if (r.width < 20 || r.height < 10) return;
      var o;
      try { o = new URL(f.src, location.href).origin; } catch (e) { return; }
      if (!/^https:/.test(o) || o === location.origin || out.indexOf(o) >= 0) return;
      out.push(o);
    });
    return out.slice(0, 5);
  }

  /* Injected (PW-AF3): the login typed on this page, or null. A form
     with a new password (sign-up, change) gives the new one; the user
     name is an autocomplete username/email field, else the last filled
     text field before the password. Top frame only. */
  function readLogin() {
    var all = Array.prototype.slice.call(document.querySelectorAll("input"));
    function ac(el) { return String(el.getAttribute("autocomplete") || "").toLowerCase(); }
    var pws = all.filter(function (el) { return el.type === "password" && el.value; });
    if (!pws.length) return null;
    var nw = pws.filter(function (el) { return /new-password/.test(ac(el)); }), pick;
    if (nw.length) pick = nw[0];
    else if (pws.length >= 3) pick = pws[1];                       // current, new, confirm
    else if (pws.length === 2 && pws[0].value === pws[1].value) pick = pws[0];
    else pick = pws[pws.length - 1];
    var TEXT = ["text", "email", "tel", ""];
    var user = all.filter(function (el) { return el.value && el.type !== "password" && /\b(username|email)\b/.test(ac(el)); })[0];
    if (!user) {
      all.forEach(function (el) {
        if (!el.value || TEXT.indexOf(el.type) < 0) return;
        if (el.compareDocumentPosition(pick) & 4) user = el;          // pick follows el
      });
    }
    return { url: location.origin, user: user ? String(user.value).trim().slice(0, 512) : "",
             pw: String(pick.value).slice(0, 4096), title: String(document.title || "").slice(0, 200) };
  }

  return { fits: fits, matches: matches, payload: payload, fillInPage: fillInPage, framesInPage: framesInPage, readLogin: readLogin, hostOf: function (s) { return hostOf(urlOf(s)); } };
});
