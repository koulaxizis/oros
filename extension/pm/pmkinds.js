// ============================================================
// orOS Passwords — entry types (PmKinds, v1.1.0, PW-K1, PW-OTP2)
// Pure logic, no DOM: the app (pmapp.js), the importers and the
// tests (tests/passwords-kinds.test.js) load this same file. Works on
// DECRYPTED entries only, in memory; it stores and logs nothing.
//
// An entry is a login unless it carries a reserved field "oros:k".
// Cards, identities, addresses and secure notes keep their typed
// values as reserved fields "oros:<kind>.<key>" inside the existing
// `fields` list, so an older orOS (Portable, Live USB, a phone not yet
// updated) keeps them untouched in its merges and shows them as
// "More fields". Nothing in the encryption, the slice or the merge
// changes (Bible PASSWORDS v2, decision PW-K1).
// A "2FA only" entry (PW-OTP2) is a login with the marker "otp": the
// issuer is the title, the account the user name, the secret `totp`;
// it has no password. An older orOS shows it as a login.
//   1. Types and their fields
//   2. Read / write an entry's typed values
//   3. Cards: digits, Luhn, network, expiry
//   4. Identities and addresses: dates, countries, address lines
//   5. Labelled fields → types (imports, "Convert")
//   6. Bitwarden items for the export
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module === "object" && module.exports;

  // ---------- 1. Types ----------
  // t: text | num (card number) | exp (MM/YYYY) | date (YYYY-MM-DD)
  //    | country (ISO 3166-1 alpha-2 or free text) | email | tel
  // h: 1 = hidden until Show, copied with the 30 s clipboard clear.
  var KINDS = ["login", "card", "identity", "address", "otp", "note"];
  var PRE = { card: "cc", identity: "id", address: "ad" };
  var SPEC = {
    card: [
      { k: "holder", t: "text" }, { k: "num", t: "num", h: 1 }, { k: "exp", t: "exp" },
      { k: "cvv", t: "text", h: 1 }, { k: "pin", t: "text", h: 1 }, { k: "bank", t: "text" }
    ],
    identity: [
      { k: "honor", t: "text" }, { k: "first", t: "text" }, { k: "middle", t: "text" }, { k: "last", t: "text" },
      { k: "birth", t: "date" }, { k: "email", t: "email" }, { k: "phone", t: "tel" }, { k: "company", t: "text" },
      { k: "idno", t: "text", h: 1 }, { k: "idexp", t: "date" },
      { k: "pass", t: "text", h: 1 }, { k: "passexp", t: "date" },
      { k: "lic", t: "text", h: 1 }, { k: "licexp", t: "date" },
      { k: "tax", t: "text", h: 1 }, { k: "ssn", t: "text", h: 1 }, { k: "ins", t: "text", h: 1 }
    ],
    address: [
      { k: "name", t: "text" }, { k: "street", t: "text" }, { k: "line2", t: "text" }, { k: "floor", t: "text" },
      { k: "city", t: "text" }, { k: "zip", t: "text" }, { k: "region", t: "text" }, { k: "country", t: "country" },
      { k: "phone", t: "tel" }
    ],
    login: [], otp: [], note: []
  };
  // English names: the labels of Bitwarden / KeePass custom fields in
  // exports, read back by fromLabels() (round trip).
  var EN = {
    "cc.holder": "Cardholder name", "cc.num": "Number", "cc.exp": "Expiry date", "cc.cvv": "Security code",
    "cc.pin": "PIN", "cc.bank": "Bank",
    "id.honor": "Title", "id.first": "First name", "id.middle": "Middle name", "id.last": "Last name",
    "id.birth": "Birth date", "id.email": "Email", "id.phone": "Phone", "id.company": "Company",
    "id.idno": "ID card number", "id.idexp": "ID card expiry", "id.pass": "Passport number",
    "id.passexp": "Passport expiry", "id.lic": "License number", "id.licexp": "License expiry",
    "id.tax": "Tax number", "id.ssn": "Social security number", "id.ins": "Insurance number",
    "ad.name": "Recipient", "ad.street": "Address 1", "ad.line2": "Address 2", "ad.floor": "Floor",
    "ad.city": "City", "ad.zip": "Postal code", "ad.region": "State", "ad.country": "Country", "ad.phone": "Phone"
  };
  var FV = 10000, FIELDS_MAX = 50;
  var KIND_FIELD = "oros:k";

  function str(v) {
    if (typeof v === "number") v = String(v);
    if (typeof v !== "string") return "";
    v = v.replace(/\u0000/g, "");
    return v.length > FV ? v.slice(0, FV) : v;
  }
  function one(v) { return str(v).replace(/[\r\n\t]+/g, " ").trim(); }
  function isReserved(n) { return typeof n === "string" && n.slice(0, 5) === "oros:"; }
  function fieldName(kind, key) { return "oros:" + PRE[kind] + "." + key; }
  function specOf(kind) { return SPEC[kind] || []; }
  function isKind(k) { return KINDS.indexOf(k) >= 0; }

  // ---------- 2. Read / write ----------
  function kindOf(e) {
    var f = (e && Array.isArray(e.fields) ? e.fields : []).filter(function (x) { return x && x.n === KIND_FIELD; })[0];
    var k = f ? String(f.v || "").trim() : "";
    return isKind(k) ? k : "login";
  }
  // Typed values of the entry's own type: { key: value } (only set ones).
  function dataOf(e) {
    var kind = kindOf(e), out = {};
    if (!PRE[kind]) return out;
    var pre = "oros:" + PRE[kind] + ".";
    (e.fields || []).forEach(function (f) {
      if (!f || typeof f.n !== "string" || f.n.slice(0, pre.length) !== pre) return;
      var k = f.n.slice(pre.length);
      if (specOf(kind).some(function (s) { return s.k === k; }) && out[k] === undefined && f.v) out[k] = f.v;
    });
    return out;
  }
  // The person's own fields (reserved ones of ANOTHER type stay too, so
  // nothing a newer orOS wrote is ever lost on a save here).
  function userFields(e) {
    var kind = kindOf(e), pre = PRE[kind] ? "oros:" + PRE[kind] + "." : null;
    return (e && e.fields ? e.fields : []).filter(function (f) {
      if (!f) return false;
      if (f.n === KIND_FIELD) return false;
      if (pre && f.n.slice(0, pre.length) === pre && specOf(kind).some(function (s) { return pre + s.k === f.n; })) return false;
      return true;
    });
  }
  // Fields that are shown to the person (no reserved name at all).
  function visibleFields(e) {
    return userFields(e).filter(function (f) { return !isReserved(f.n); });
  }
  function clean(kind, key, v) {
    var s = specOf(kind).filter(function (x) { return x.k === key; })[0];
    if (!s) return "";
    var x = one(v);
    if (s.t === "num") return x.replace(/[\s-]+/g, " ").trim();
    if (s.t === "exp") { var p = parseExp(x); return p ? pad2(p.m) + "/" + p.y : x; }
    if (s.t === "date") { var d = normDate(x); return d || x; }
    if (s.t === "country") { var c = countryCode(x); return c || x; }
    return x;
  }
  // entry + kind + data → fields list: kind marker, typed values in
  // the type's order, then the person's own fields; ≤ 50.
  function withData(e, kind, data, own) {
    if (!isKind(kind)) kind = "login";
    var out = [];
    if (kind !== "login") out.push({ h: 0, n: KIND_FIELD, v: kind });
    specOf(kind).forEach(function (s) {
      var v = clean(kind, s.k, data && data[s.k]);
      if (v) out.push({ h: s.h ? 1 : 0, n: fieldName(kind, s.k), v: v });
    });
    (own || userFields(e)).forEach(function (f) {
      if (!f || f.n === KIND_FIELD) return;
      if (out.length < FIELDS_MAX) out.push({ h: f.h ? 1 : 0, n: str(f.n), v: str(f.v) });
    });
    var x = JSON.parse(JSON.stringify(e || {}));
    x.fields = out.slice(0, FIELDS_MAX);
    if (kind !== "login" && kind !== "card" && kind !== "otp") x.urls = [];
    if (kind === "otp") { x.pw = ""; x.hist = []; }
    else if (kind !== "login") { x.user = ""; x.pw = ""; x.totp = ""; x.hist = []; }
    return x;
  }
  // Does the entry hold anything worth saving?
  function hasContent(e) {
    var kind = kindOf(e);
    if (kind === "login") return !!(e.title || e.user || e.pw);
    if (kind === "note") return !!(e.title || e.notes);
    if (kind === "otp") return !!e.totp;
    return !!(e.title || Object.keys(dataOf(e)).length);
  }

  // ---------- 3. Cards ----------
  function digits(s) { return String(s || "").replace(/\D+/g, ""); }
  function luhn(s) {
    var d = digits(s);
    if (d.length < 12 || d.length > 19) return false;
    var sum = 0, dbl = false;
    for (var i = d.length - 1; i >= 0; i--) {
      var n = d.charCodeAt(i) - 48;
      if (dbl) { n *= 2; if (n > 9) n -= 9; }
      sum += n; dbl = !dbl;
    }
    return sum % 10 === 0;
  }
  // Network from the leading digits (IIN ranges, 2026).
  function brand(s) {
    var d = digits(s);
    if (!d) return "";
    var n2 = +d.slice(0, 2), n4 = +d.slice(0, 4), n6 = +d.slice(0, 6);
    if (/^3[47]/.test(d)) return "amex";
    if (/^3(0[0-5]|095|[689])/.test(d)) return "diners";
    if (d.length >= 4 && n4 >= 3528 && n4 <= 3589) return "jcb";
    if (/^(6011|65|64[4-9])/.test(d) || (d.length >= 6 && n6 >= 622126 && n6 <= 622925)) return "discover";
    if (/^62/.test(d)) return "unionpay";
    if ((n2 >= 51 && n2 <= 55) || (d.length >= 4 && n4 >= 2221 && n4 <= 2720)) return "mastercard";
    if (/^(5018|5020|5038|5893|6304|6759|676[1-3]|50|5[6-9]|6)/.test(d)) return "maestro";
    if (/^4/.test(d)) return "visa";
    return "";
  }
  var BRAND_NAME = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", maestro: "Maestro",
                     diners: "Diners Club", discover: "Discover", jcb: "JCB", unionpay: "UnionPay" };
  function last4(s) { var d = digits(s); return d.length >= 4 ? d.slice(-4) : ""; }
  // "1234 5678 9012 3456" (Amex 4-6-5)
  function groupNum(s) {
    var d = digits(s);
    if (brand(d) === "amex" && d.length === 15) return d.slice(0, 4) + " " + d.slice(4, 10) + " " + d.slice(10);
    return d.replace(/(\d{4})(?=\d)/g, "$1 ");
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  // "08/27", "8/2027", "2027-08", "08-27", "0827" → { m, y } or null
  function parseExp(s) {
    var x = String(s || "").trim(), m, y, r;
    if ((r = x.match(/^(\d{4})[-\/.](\d{1,2})$/))) { y = +r[1]; m = +r[2]; }
    else if ((r = x.match(/^(\d{1,2})\s*[-\/.]\s*(\d{2}|\d{4})$/))) { m = +r[1]; y = +r[2]; }
    else if ((r = x.match(/^(\d{2})(\d{2})$/))) { m = +r[1]; y = +r[2]; }
    else return null;
    if (y < 100) y += 2000;
    if (!(m >= 1 && m <= 12) || y < 1990 || y > 2199) return null;
    return { m: m, y: y };
  }
  function expShort(s) { var p = parseExp(s); return p ? pad2(p.m) + "/" + String(p.y).slice(2) : String(s || ""); }
  // "expired" | "soon" (within 60 days) | "ok" | "" (no date)
  function expStatus(s, nowMs) {
    var p = parseExp(s);
    if (!p) return "";
    var end = Date.UTC(p.m === 12 ? p.y + 1 : p.y, p.m === 12 ? 0 : p.m, 1);   // first day after the month
    return dayStatus(end, nowMs);
  }
  function dayStatus(endMs, nowMs) {
    var now = nowMs == null ? Date.now() : nowMs;
    if (now >= endMs) return "expired";
    return endMs - now <= 60 * 864e5 ? "soon" : "ok";
  }

  // ---------- 4. Identities and addresses ----------
  // "2026-11-01", "1/11/2026", "01.11.2026" (day first) → "YYYY-MM-DD" or "".
  function normDate(s) {
    var x = String(s || "").trim(), r, y, m, d;
    if ((r = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +r[1]; m = +r[2]; d = +r[3]; }
    else if ((r = x.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/))) { d = +r[1]; m = +r[2]; y = +r[3]; }
    else return "";
    var t = Date.UTC(y, m - 1, d), c = new Date(t);
    if (y < 1850 || y > 2199 || c.getUTCMonth() !== m - 1 || c.getUTCDate() !== d) return "";
    return y + "-" + pad2(m) + "-" + pad2(d);
  }
  function dateStatus(s, nowMs) {
    var d = normDate(s);
    if (!d) return "";
    var p = d.split("-");
    return dayStatus(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1), nowMs);
  }
  var COUNTRIES = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS " +
    "BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET " +
    "FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO " +
    "IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH " +
    "MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM " +
    "PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG " +
    "TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" ");
  // A few names exports use instead of codes (EN / EL / DE).
  // i18n-inline-ok: Greek country names that imports may write, matched as data (parser), no UI text
  var COUNTRY_NAMES = {
    "greece": "GR", "ελλάδα": "GR", "ελλαδα": "GR", "hellas": "GR", "griechenland": "GR",
    "cyprus": "CY", "κύπρος": "CY", "κυπρος": "CY", "zypern": "CY",
    "germany": "DE", "deutschland": "DE", "γερμανία": "DE", "γερμανια": "DE",
    "united kingdom": "GB", "uk": "GB", "great britain": "GB", "england": "GB",
    "united states": "US", "usa": "US", "united states of america": "US",
    "france": "FR", "italy": "IT", "spain": "ES", "netherlands": "NL", "austria": "AT", "switzerland": "CH",
    "belgium": "BE", "bulgaria": "BG", "romania": "RO", "albania": "AL", "turkey": "TR", "türkiye": "TR",
    "ireland": "IE", "portugal": "PT", "sweden": "SE", "norway": "NO", "denmark": "DK", "finland": "FI",
    "poland": "PL", "canada": "CA", "australia": "AU"
  };
  function countryCode(s) {
    var x = String(s || "").trim();
    if (/^[A-Za-z]{2}$/.test(x) && COUNTRIES.indexOf(x.toUpperCase()) >= 0) return x.toUpperCase();
    return COUNTRY_NAMES[x.toLowerCase()] || "";
  }
  // Address as lines, for display and "Copy address". nameOf(code)
  // gives a country name in the app language.
  function addressLines(d, nameOf) {
    d = d || {};
    var out = [];
    if (d.name) out.push(d.name);
    if (d.street) out.push(d.street + (d.floor ? ", " + d.floor : ""));
    else if (d.floor) out.push(d.floor);
    if (d.line2) out.push(d.line2);
    var cityLine = [d.zip, d.city].filter(Boolean).join(" ");
    if (cityLine) out.push(cityLine);
    if (d.region) out.push(d.region);
    if (d.country) out.push(nameOf ? (nameOf(d.country) || d.country) : d.country);
    if (d.phone) out.push(d.phone);
    return out;
  }
  function fullName(d) { return [d.first, d.middle, d.last].filter(Boolean).join(" "); }
  // One line under the title in the list.
  function summary(e, nameOf) {
    var kind = kindOf(e), d = dataOf(e);
    if (kind === "card") {
      var b = BRAND_NAME[brand(d.num)] || "";
      return [b, last4(d.num) ? "•••• " + last4(d.num) : "", d.exp ? expShort(d.exp) : ""].filter(Boolean).join(" · ");
    }
    if (kind === "identity") return fullName(d) || d.email || "";
    if (kind === "address") return [d.street, d.city, d.country ? (nameOf ? nameOf(d.country) : d.country) : ""].filter(Boolean).join(", ");
    if (kind === "otp") return e.user || "";
    return "";
  }

  // ---------- 5. Labelled fields → types ----------
  // Labels (lower case, spaces collapsed) the importers and older
  // conversions write; → [kind, key].
  var LABELS = {};
  function lab(kind, key, names) { names.forEach(function (n) { LABELS[kind + "|" + n] = key; }); }
  lab("card", "holder", ["cardholder name", "cardholder", "name on card", "card holder", "cardholdername"]);
  lab("card", "num", ["number", "card number", "cardnumber", "credit card number", "ccnumber"]);
  lab("card", "cvv", ["security code", "cvv", "cvc", "cvv2", "verification number", "verification code", "card security code"]);
  lab("card", "pin", ["pin", "pin code"]);
  lab("card", "exp", ["expiry date", "expiration date", "expiry", "expires", "expiration", "exp date", "valid until", "expirydate"]);
  lab("card", "_m", ["expiry month", "expiration month", "exp month"]);
  lab("card", "_y", ["expiry year", "expiration year", "exp year"]);
  lab("card", "_brand", ["brand", "card type", "type"]);
  lab("card", "bank", ["bank", "issuer", "issuing bank", "bank name"]);
  lab("identity", "honor", ["title"]);
  lab("identity", "first", ["first name", "firstname", "given name"]);
  lab("identity", "middle", ["middle name", "middlename", "initial"]);
  lab("identity", "last", ["last name", "lastname", "surname", "family name"]);
  lab("identity", "_full", ["full name", "fullname", "name"]);
  lab("identity", "birth", ["birth date", "birthdate", "date of birth", "birthday", "dob"]);
  lab("identity", "email", ["email", "e-mail", "email address"]);
  lab("identity", "phone", ["phone", "phone number", "telephone", "mobile", "home phone", "cell phone", "mobile phone", "phonenumber"]);
  lab("identity", "company", ["company", "organization", "organisation", "employer"]);
  lab("identity", "idno", ["id card number", "id number", "identity card", "national id", "id card"]);
  lab("identity", "idexp", ["id card expiry"]);
  lab("identity", "pass", ["passport number", "passport"]);
  lab("identity", "passexp", ["passport expiry"]);
  lab("identity", "lic", ["license number", "licence number", "driver license", "driver's license", "driving license", "driving licence", "license"]);
  lab("identity", "licexp", ["license expiry", "licence expiry"]);
  lab("identity", "tax", ["tax number", "tax id", "tin", "vat number", "afm"]);
  lab("identity", "ssn", ["ssn", "social security number", "amka", "national insurance number"]);
  lab("identity", "ins", ["insurance number", "ama"]);
  lab("address", "street", ["address 1", "address1", "address", "street", "address line 1", "street address"]);
  lab("address", "line2", ["address 2", "address2", "address 3", "address3", "address line 2", "address line 3"]);
  lab("address", "floor", ["floor"]);
  lab("address", "city", ["city", "town"]);
  lab("address", "zip", ["postal code", "postcode", "zip", "zip code", "zipcode", "postalcode"]);
  lab("address", "region", ["state", "region", "province", "county", "state / province"]);
  lab("address", "country", ["country"]);

  function norm(n) { return String(n || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function keyFor(kind, n) { var k = LABELS[kind + "|" + norm(n)]; return k === undefined ? null : k; }

  // A login entry whose custom fields came from a card / identity of
  // another manager (or an older orOS import) → "card" | "identity" |
  // null. Only entries with no user name, password or 2FA qualify.
  function legacyKind(e) {
    if (!e || kindOf(e) !== "login" || e.user || e.pw || e.totp) return null;
    var f = (e.fields || []).filter(function (x) { return x && !isReserved(x.n); });
    var card = f.filter(function (x) { return keyFor("card", x.n); });
    var cardCore = card.some(function (x) { var k = keyFor("card", x.n); return k === "num" || k === "cvv"; });
    if (cardCore && card.length >= 2) return "card";
    var idn = f.filter(function (x) { return keyFor("identity", x.n) || keyFor("address", x.n); });
    var idCore = idn.some(function (x) { var k = keyFor("identity", x.n); return k === "first" || k === "last" || k === "_full" || k === "pass" || k === "ssn"; });
    if (idCore && idn.length >= 2) return "identity";
    return null;
  }

  // entry + kind ("card" | "identity" | "note") → [entries]. An
  // identity with an address becomes an identity and an address
  // (second id = idFor(first id)). Fields that fit no typed value stay
  // the person's own fields. A note keeps its text in `notes`.
  function fromLabels(e, kind, idFor) {
    if (!e || kindOf(e) !== "login") return [e];
    if (kind === "note") {
      if (e.user || e.pw || e.totp || (e.urls && e.urls.length)) return [e];
      return [withData(e, "note", {}, e.fields || [])];
    }
    if (kind !== "card" && kind !== "identity") return [e];
    var data = {}, addr = {}, own = [], extra = {};
    (e.fields || []).forEach(function (f) {
      if (!f) return;
      var k = keyFor(kind, f.n);
      if (k && k.charAt(0) === "_") { if (!extra[k]) { extra[k] = f.v; return; } }
      else if (k && !data[k]) { data[k] = f.v; return; }
      if (kind === "identity") {
        var a = keyFor("address", f.n);
        if (a === "line2" && addr.line2) { addr.line2 += ", " + one(f.v); return; }
        if (a && !addr[a]) { addr[a] = f.v; return; }
      }
      own.push(f);
    });
    if (kind === "card") {
      if (!data.exp && extra._m && extra._y) data.exp = one(extra._m) + "/" + one(extra._y);
      else if (extra._m || extra._y) {
        if (extra._m) own.push({ h: 0, n: "Expiry month", v: extra._m });
        if (extra._y) own.push({ h: 0, n: "Expiry year", v: extra._y });
      }
      if (extra._brand && !brand(data.num)) own.push({ h: 0, n: "Brand", v: extra._brand });
    }
    if (kind === "identity" && extra._full) {
      if (!data.first && !data.last) {
        var parts = one(extra._full).split(" ");
        if (parts.length > 1) { data.last = parts.pop(); data.first = parts.join(" "); } else data.first = parts[0];
      } else own.push({ h: 0, n: "Full name", v: extra._full });
    }
    // An identity that holds only a name (and a phone) next to an
    // address is an address (that is also how an address exports).
    var onlyName = Object.keys(data).every(function (k) { return k === "first" || k === "middle" || k === "last" || k === "phone"; });
    if (kind === "identity" && Object.keys(addr).length && onlyName) {
      addr.name = fullName(data);
      if (data.phone && !addr.phone) addr.phone = data.phone;
      return [withData(e, "address", addr, own)];
    }
    var out = withData(e, kind, data, own);
    var list = [out];
    if (kind === "identity" && Object.keys(addr).length) {
      var a2 = JSON.parse(JSON.stringify(e));
      a2.id = idFor ? idFor(e.id) : e.id;
      a2.notes = ""; a2.tags = (e.tags || []).slice(); a2.fav = 0;
      a2.title = (e.title ? e.title + " · " : "") + "Address";
      addr.name = fullName(data) || "";
      list.push(withData(a2, "address", addr, []));
    }
    return list;
  }

  // ---------- 6. Bitwarden ----------
  function enLabel(kind, key) { return EN[PRE[kind] + "." + key] || key; }
  // entry → { type, card?|identity?|secureNote?, fields[] } (extra
  // typed values go to custom fields under their English names).
  function toBitwardenItem(e) {
    var kind = kindOf(e), d = dataOf(e), extra = [];
    function more(key, hidden) { if (d[key]) extra.push({ name: enLabel(kind, key), value: d[key], type: hidden ? 1 : 0, linkedId: null }); }
    var own = visibleFields(e).map(function (f) { return { name: f.n, value: f.v, type: f.h ? 1 : 0, linkedId: null }; });
    if (kind === "card") {
      var p = parseExp(d.exp);
      more("pin", 1); more("bank", 0);
      if (d.exp && !p) more("exp", 0);
      return { type: 3, fields: extra.concat(own), card: {
        cardholderName: d.holder || null, brand: BRAND_NAME[brand(d.num)] || null, number: d.num ? digits(d.num) : null,
        expMonth: p ? String(p.m) : null, expYear: p ? String(p.y) : null, code: d.cvv || null } };
    }
    if (kind === "identity") {
      ["birth", "idno", "idexp", "passexp", "licexp", "tax", "ins"].forEach(function (k) {
        var s = specOf("identity").filter(function (x) { return x.k === k; })[0];
        more(k, s && s.h);
      });
      return { type: 4, fields: extra.concat(own), identity: idObj({
        title: d.honor, firstName: d.first, middleName: d.middle, lastName: d.last, company: d.company,
        email: d.email, phone: d.phone, ssn: d.ssn, passportNumber: d.pass, licenseNumber: d.lic }) };
    }
    if (kind === "address") {
      more("floor", 0);
      return { type: 4, fields: extra.concat(own), identity: idObj({
        firstName: d.name, address1: d.street, address2: d.line2, city: d.city, state: d.region,
        postalCode: d.zip, country: d.country, phone: d.phone }) };
    }
    if (kind === "note") return { type: 2, fields: own, secureNote: { type: 0 } };
    return null;
  }
  var BW_ID_KEYS = ["title", "firstName", "middleName", "lastName", "address1", "address2", "address3", "city", "state",
                    "postalCode", "country", "company", "email", "phone", "ssn", "username", "passportNumber", "licenseNumber"];
  function idObj(o) { var out = {}; BW_ID_KEYS.forEach(function (k) { out[k] = o[k] || null; }); return out; }

  var PmKinds = {
    version: "1.1.0", KINDS: KINDS, SPEC: SPEC, EN: EN, KIND_FIELD: KIND_FIELD, BRAND_NAME: BRAND_NAME,
    COUNTRIES: COUNTRIES,
    isReserved: isReserved, fieldName: fieldName, specOf: specOf, kindOf: kindOf, dataOf: dataOf,
    userFields: userFields, visibleFields: visibleFields, withData: withData, hasContent: hasContent,
    digits: digits, luhn: luhn, brand: brand, last4: last4, groupNum: groupNum, parseExp: parseExp,
    expShort: expShort, expStatus: expStatus, normDate: normDate, dateStatus: dateStatus,
    countryCode: countryCode, addressLines: addressLines, fullName: fullName, summary: summary,
    legacyKind: legacyKind, fromLabels: fromLabels, toBitwardenItem: toBitwardenItem
  };
  if (NODE) module.exports = PmKinds;
  else root.PmKinds = PmKinds;
})(this);
