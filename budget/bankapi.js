// ============================================================
// orOS Budget — live bank connection, pure part (budget/bankapi.js)
// Wave BK-2 of the bank-connection plan (Chris 2026-11-01 "Ναι σε
// όλα"). Enable Banking (open banking, PSD2) with the person's OWN
// application: read-only account information, never payments.
// No DOM, no storage, no network: window.OrosBudgetBankApi in the
// browser (after bank.js), module.exports in Node
// (tests/budget-bankapi.test.js). The dialogs and the calls are in
// budget/banklive.js; every call goes through the shell's
// orosLinks (links/host.js), which signs it on the device.
//   1. Banks list (GET /aspsps) → what the picker shows
//   2. Consent request (POST /auth) body, its length, the state word
//   3. Session (POST /sessions) → the accounts it opened
//   4. Transactions (GET /accounts/{uid}/transactions) → items for
//      bank.js plan(): same ids, rules, duplicates and tombstones as
//      a statement file
//   5. Links (Budget collection "bnk"): one row per bank account
//      the person connected, the window to fetch, consent days left
//   6. PayPal Business (BK-3): Transaction Search windows and items
// Everything from the bank is data: shown with textContent only.
// ============================================================
(function (root) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var B = NODE ? require("./bank.js") : root.OrosBudgetBank;

  var DAY = 86400000;
  var MAX_CONSENT_DAYS = 180;       // PSD2: a bank asks again after at most 180 days
  var FIRST_DAYS = 89;              // first fetch: most banks give 90 days without a new SCA
  var OVERLAP_DAYS = 7;             // later fetches: a week back (late bookings)
  var REFRESH_MS = 6 * 3600000;     // automatic refresh at most every 6 hours (Chris 20:44)
  var WARN_DAYS = 7;                // "renew" shows a week before the consent ends
  var MAX_PAGES = 20;               // continuation pages per account and refresh
  var REDIRECT = "https://useoros.online/budget/bankback.html";
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var CTY_RE = /^[A-Z]{2}$/;
  // Countries where Enable Banking works (EEA + UK); Greece first.
  var COUNTRIES = ["GR", "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "HU", "IS", "IE", "IT",
                   "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB"];

  function clean(s, n) { return B.clean(s, n); }
  function str(v) { return typeof v === "string" ? v : ""; }
  function ymdOf(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + d.getUTCDate()).slice(-2);
  }
  function msOfYmd(s) { var t = Date.parse(s + "T00:00:00Z"); return isFinite(t) ? t : NaN; }

  // ---------- 1. Banks ----------
  // GET /aspsps answer → [{ name, country, days (max consent), beta }]
  // sorted by name; only banks that offer personal or business access.
  function banks(json, psu) {
    var list = json && Array.isArray(json.aspsps) ? json.aspsps : [];
    var out = [], seen = {};
    list.forEach(function (a) {
      if (!a || typeof a !== "object") return;
      var name = clean(str(a.name), 120), cty = str(a.country);
      if (!name || !CTY_RE.test(cty) || seen[cty + "|" + name]) return;
      if (Array.isArray(a.psu_types) && a.psu_types.length && a.psu_types.indexOf(psu || "personal") < 0) return;
      seen[cty + "|" + name] = 1;
      var sec = typeof a.maximum_consent_validity === "number" && a.maximum_consent_validity > 0 ? a.maximum_consent_validity : MAX_CONSENT_DAYS * 86400;
      out.push({ name: name, country: cty, days: Math.max(1, Math.min(MAX_CONSENT_DAYS, Math.floor(sec / 86400))), beta: a.beta === true });
    });
    return out.sort(function (x, y) { return x.name.localeCompare(y.name); });
  }

  // ---------- 2. Consent ----------
  // A random word that ties the bank's answer to this request.
  function newState(rand) {
    var a = rand || (typeof crypto !== "undefined" && crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(24)) : null);
    if (!a) return "";
    var abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", s = "";
    for (var i = 0; i < a.length; i++) s += abc.charAt(a[i] & 63);
    return s;
  }
  // POST /auth body for one bank (bank = an item of banks()).
  function authBody(bank, state, psu, now) {
    var days = Math.max(1, Math.min(MAX_CONSENT_DAYS, bank.days || MAX_CONSENT_DAYS));
    var vu = new Date((now || Date.now()) + days * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
    return { access: { valid_until: vu }, aspsp: { name: bank.name, country: bank.country }, state: state,
             redirect_url: REDIRECT, psu_type: psu === "business" ? "business" : "personal" };
  }

  // ---------- 3. Session ----------
  // The last four of an account number (never the whole number in data).
  function tail(s) {
    var d = String(s || "").replace(/[^A-Za-z0-9]/g, "");
    return d.length >= 4 ? d.slice(-4) : "";
  }
  // POST /sessions answer → { sid, vu (ms), accts: [{ uid, ih, name, ib, cur }] }
  function session(json) {
    if (!json || typeof json !== "object" || !UUID_RE.test(str(json.session_id))) return null;
    var vu = Date.parse(json.access && json.access.valid_until);
    var accts = [];
    (Array.isArray(json.accounts) ? json.accounts : []).forEach(function (a) {
      if (!a || !UUID_RE.test(str(a.uid))) return;
      var aid = a.account_id && typeof a.account_id === "object" ? a.account_id : {};
      var num = str(aid.iban) || (aid.other && str(aid.other.identification)) || "";
      accts.push({
        uid: a.uid,
        ih: clean(str(a.identification_hash), 120),
        name: clean(str(a.name) || str(a.product) || str(a.details), 40),
        ib: tail(num),
        cur: /^[A-Z]{3}$/.test(str(a.currency)) ? a.currency : ""
      });
    });
    return { sid: json.session_id, vu: isFinite(vu) ? vu : 0, accts: accts };
  }

  // ---------- 4. Transactions ----------
  function cents(v) {
    var s = String(v == null ? "" : v).trim();
    if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(s)) return null;
    var c = B.parseMoney(s, ".");
    return c === null ? null : Math.abs(c);
  }
  function partyName(p) { return p && typeof p === "object" ? clean(str(p.name), 80) : ""; }
  // One page of transactions → items for bank.js plan().
  // Booked only (status BOOK); pending ones come back as err "pending".
  function items(json, startLine) {
    var list = json && Array.isArray(json.transactions) ? json.transactions : [];
    var out = [];
    list.forEach(function (x, i) {
      if (!x || typeof x !== "object") return;
      var amt = x.transaction_amount && typeof x.transaction_amount === "object" ? x.transaction_amount : {};
      var a = cents(amt.amount);
      var debit = str(x.credit_debit_indicator) === "DBIT";
      var who = debit ? partyName(x.creditor) : partyName(x.debtor);
      var rem = Array.isArray(x.remittance_information) ? x.remittance_information.filter(function (r) { return typeof r === "string"; }).join(" ") : str(x.remittance_information);
      rem = clean(rem, 140);
      var code = x.bank_transaction_code && typeof x.bank_transaction_code === "object" ? clean(str(x.bank_transaction_code.description), 60) : "";
      var text = [who, rem && B.fold(rem).indexOf(B.fold(who)) < 0 ? rem : (who ? "" : rem)].filter(Boolean).join(" · ") || clean(str(x.note), 140) || code;
      var d = str(x.booking_date) || str(x.value_date) || str(x.transaction_date);
      d = /^\d{4}-\d{2}-\d{2}$/.test(d.slice(0, 10)) ? B.parseDate(d.slice(0, 10), "ymd") : null;
      var it = {
        line: (startLine || 0) + i + 1, d: d, amt: a === null ? null : (debit ? -a : a), text: clean(text),
        fit: clean(str(x.entry_reference) || str(x.transaction_id), 80),
        cur: /^[A-Z]{3}$/.test(str(amt.currency)) ? amt.currency : ""
      };
      var st = str(x.status);
      if (!d) it.err = "date";
      else if (it.amt === null) it.err = "amount";
      else if (st && st !== "BOOK") it.err = "pending";
      out.push(it);
    });
    return out;
  }
  // A reference the bank repeats inside one fetch keeps only its first
  // row as a FITID (the others fall back to date + amount + text).
  function uniqueFits(list) {
    var seen = {};
    list.forEach(function (it) {
      if (!it.fit) return;
      if (seen[it.fit]) it.fit = "";
      else seen[it.fit] = 1;
    });
    return list;
  }

  // ---------- 5. Links ----------
  // Where the next fetch starts: a week before the last booked day
  // seen, or 89 days back the first time; never in the future.
  function fromDate(link, now) {
    var today = ymdOf(now);
    var first = ymdOf(now - FIRST_DAYS * DAY);
    if (!link || !link.lf) return first;
    var t = msOfYmd(link.lf);
    if (!isFinite(t)) return first;
    var f = ymdOf(t - OVERLAP_DAYS * DAY);
    if (f < first) f = first;
    return f > today ? today : f;
  }
  // The newest booked day among items (for lf), or "".
  function lastBooked(list) {
    var best = "";
    (list || []).forEach(function (it) { if (!it.err && it.d && it.d > best) best = it.d; });
    return best;
  }
  // Days until the consent ends (negative = ended), or null when unknown.
  function daysLeft(link, now) {
    if (!link || !link.vu) return null;
    return Math.floor((link.vu - now) / DAY);
  }
  function needsRenew(link, now) {
    var d = daysLeft(link, now);
    return d !== null && d < WARN_DAYS;
  }
  function due(lastRun, now) { return !lastRun || now - lastRun >= REFRESH_MS; }
  // Rows of a renewed (or repeated) consent: an account already linked
  // (same identification hash, else same bank + last four + currency)
  // keeps its row, Budget account and fetch point; a new one gets a row.
  function matchLink(links, bank, a) {
    var hit = null;
    (links || []).some(function (l) {
      if (l.bk !== bank.name || l.cty !== bank.country) return false;
      if (a.ih && l.ih && a.ih === l.ih) { hit = l; return true; }
      if (!a.ih || !l.ih) {
        if (a.ib && l.ib === a.ib && (l.cu || "") === (a.cur || "")) { hit = l; return true; }
      }
      return false;
    });
    return hit;
  }

  // ---------- 6. PayPal (BK-3) ----------
  // Transaction Search through the person's own REST app (Connected
  // services "paypal"): at most 31 days per request, 500 per page. The
  // items are the same as from PayPal's activity file (bank.js
  // paypalItems): FITID = transaction id, so the file and the live
  // reading land on the same ids and never double.
  var PP_DAYS = 31, PP_PAGE = 500, PP_MAX_PAGES = 10;
  function ppStamp(ms) { return new Date(ms).toISOString().slice(0, 19) + "-0000"; }
  // [from day 00:00 UTC, now - 1 min] cut into windows of ≤ 31 days
  function ppWindows(fromYmd, now) {
    var start = msOfYmd(fromYmd), end = now - 60000, out = [];
    if (!isFinite(start) || start >= end) return out;
    while (start < end && out.length < 12) {
      var e = Math.min(end, start + PP_DAYS * DAY - 1000);
      out.push({ s: ppStamp(start), e: ppStamp(e) });
      start = e + 1000;
    }
    return out;
  }
  function ppPath(w, page) {
    return "/v1/reporting/transactions?start_date=" + w.s + "&end_date=" + w.e +
           "&fields=transaction_info,payer_info,cart_info&page_size=" + PP_PAGE + "&page=" + (page || 1);
  }
  // one page → { list: transaction_details, pages: total_pages }
  function ppPage(json) {
    var list = json && Array.isArray(json.transaction_details) ? json.transaction_details : [];
    var pages = json && typeof json.total_pages === "number" && json.total_pages > 0 ? Math.min(json.total_pages, PP_MAX_PAGES) : 1;
    return { list: list, pages: pages };
  }
  // signed money string → cents (null when not money)
  function signedCents(v) {
    var s = String(v == null ? "" : v).trim();
    if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(s)) return null;
    var c = B.parseMoney(s.replace(/^-/, ""), ".");
    return c === null ? null : (s.charAt(0) === "-" ? -Math.abs(c) : Math.abs(c));
  }
  // PayPal's event codes (T + group + kind): what the activity file
  // tells by its Type column
  function ppKind(code) {
    var m = /^T(\d{2})\d{2}$/.exec(code || "");
    if (!m) return "";
    var g = m[1];
    if (g === "02") return "conv";                                   // currency conversion
    if (g === "13" || g === "15" || g === "21" || g === "98" ||        // authorisations, holds, reserves, display only
        code === "T1105" || code === "T1110" || code === "T1111") return "memo";
    if (g === "03" || g === "04" || g === "06" || g === "07" || g === "17") return "xfer";   // own bank / card in and out
    return "";
  }
  function ppName(p) {
    if (!p || typeof p !== "object") return "";
    var n = p.payer_name && typeof p.payer_name === "object" ? p.payer_name : {};
    return clean(str(n.alternate_full_name) || [str(n.given_name), str(n.surname)].filter(Boolean).join(" ") || str(p.payer_name && p.payer_name.full_name), 80);
  }
  // all transaction_details of a reading → items for plan()
  function ppItems(list, home) {
    var conv = {}, out = [];
    (list || []).forEach(function (x) {
      var ti = x && x.transaction_info;
      if (!ti || ppKind(str(ti.transaction_event_code)) !== "conv") return;
      var ref = str(ti.paypal_reference_id), amt = ti.transaction_amount || {};
      var cc = str(amt.currency_code).toUpperCase(), c = signedCents(amt.value);
      if (!ref || c === null) return;
      (conv[ref] = conv[ref] || {})[cc] = (conv[ref][cc] || 0) + c;
    });
    (list || []).forEach(function (x, i) {
      var ti = x && x.transaction_info;
      if (!ti || typeof ti !== "object") return;
      var kind = ppKind(str(ti.transaction_event_code));
      if (kind === "conv") return;                                      // folded into its payment
      var amt = ti.transaction_amount && typeof ti.transaction_amount === "object" ? ti.transaction_amount : {};
      var gross = signedCents(amt.value), fee = ti.fee_amount ? signedCents(ti.fee_amount.value) : 0;
      var net = gross === null ? null : gross + (fee || 0);
      var id = clean(str(ti.transaction_id), 80), cur = str(amt.currency_code).toUpperCase();
      var item = "";
      var cart = x.cart_info && Array.isArray(x.cart_info.item_details) ? x.cart_info.item_details : [];
      if (cart[0] && typeof cart[0] === "object") item = clean(str(cart[0].item_name), 80);
      var name = ppName(x.payer_info);
      var text = [name, item && B.fold(item) !== B.fold(name) ? item : ""].filter(Boolean).join(" · ") ||
                 clean(str(ti.transaction_subject), 140) || clean(str(ti.transaction_note), 140) || str(ti.transaction_event_code);
      var d = str(ti.transaction_initiation_date).slice(0, 10);
      var it = { line: i + 1, d: /^\d{4}-\d{2}-\d{2}$/.test(d) ? B.parseDate(d, "ymd") : null, amt: net, text: clean(text), fit: id,
                 cur: /^[A-Z]{3}$/.test(cur) ? cur : "" };
      var st = str(ti.transaction_status);
      if (!it.d) it.err = "date";
      else if (it.amt === null) it.err = "amount";
      else if (kind === "memo") it.err = "memo";
      else if (st && st !== "S") it.err = "pending";
      else if (kind === "xfer") it.err = "xfer";
      else if (home && it.cur && it.cur !== home && conv[id] && conv[id][home]) {
        it.amt = conv[id][home];                                         // what left the account in the Budget currency
        it.cur = home;
      }
      out.push(it);
    });
    return out;
  }

  var api = {
    COUNTRIES: COUNTRIES, REDIRECT: REDIRECT, REFRESH_MS: REFRESH_MS, WARN_DAYS: WARN_DAYS, MAX_PAGES: MAX_PAGES,
    banks: banks, newState: newState, authBody: authBody, session: session, tail: tail,
    items: items, uniqueFits: uniqueFits, fromDate: fromDate, lastBooked: lastBooked,
    daysLeft: daysLeft, needsRenew: needsRenew, due: due, matchLink: matchLink, ymdOf: ymdOf,
    PP_PAGE: PP_PAGE, ppStamp: ppStamp, ppWindows: ppWindows, ppPath: ppPath, ppPage: ppPage, ppKind: ppKind, ppItems: ppItems
  };
  if (NODE) module.exports = api;
  else root.OrosBudgetBankApi = api;
})(typeof window !== "undefined" ? window : this);
