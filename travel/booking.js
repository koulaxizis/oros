// ============================================================
// orOS Travel — booking.js (reservations from e-mails, v1.0.0)
// Booking e-mails (airlines, hotels, rail, car hire, event tickets)
// often carry schema.org Reservation data for Gmail / Outlook: JSON-LD
// (<script type="application/ld+json">) or microdata (itemscope /
// itemtype / itemprop). This file turns that data into itinerary
// entries. Pure: no network, never writes, never runs anything from
// the e-mail.
//   - jsonLdBlocks(html): the JSON-LD texts of an HTML string, by a
//     plain scan (used when no DOM is at hand, e.g. tests);
//   - fromDocument(doc): JSON-LD + microdata of an INERT document
//     (DOMParser "text/html": no scripts run, nothing loads);
//   - microdata(root): microdata items of a DOM subtree (any object
//     with tagName / getAttribute / hasAttribute / children /
//     textContent, so Node tests use small fakes);
//   - nodes(values): every Reservation object in parsed JSON
//     (arrays, @graph, nested), ≤ 60;
//   - reservations(nodes, lang): itinerary entries, one per flight
//     leg / trip: { kind, title, from, to, day, t1, day2, t2, place,
//     ref, num, prov, cost, ccur, note, cancelled, key };
//   - parseHtml(html, lang, DOMParserCtor?) and parseText(text, lang)
//     tie it together.
// Dates and times are the ones written in the data (the local time on
// the ticket): "2026-10-12T08:15:00+03:00" → 2026-10-12, 08:15. No
// time-zone conversion, the same rule as the rest of Travel.
// API: window.OrosTravelBooking (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var MAX_HTML = 2 * 1024 * 1024;       // characters looked at
  var MAX_NODES = 60;                   // reservations per e-mail
  var MAX_DEPTH = 12;
  var MAX_ELEMS = 30000;                // microdata walk
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})/;
  var DT_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/;
  var CUR_RE = /^[A-Z]{3}$/;

  var STR = {
    en: { seat: "Seat {v}", gate: "Gate {v}", term: "Terminal {v}", plat: "Platform {v}", coach: "Coach {v}",
          pax: "Passenger: {v}", party: "Party of {v}", tel: "Tel. {v}", drop: "Return at: {v}",
          board: "Boarding {v}", ticket: "Ticket {v}", taxi: "Taxi", car: "Car hire", res: "Booking" },
    el: { seat: "Θέση {v}", gate: "Πύλη {v}", term: "Τερματικός {v}", plat: "Αποβάθρα {v}", coach: "Βαγόνι {v}",
          pax: "Επιβάτης: {v}", party: "Άτομα: {v}", tel: "Τηλ. {v}", drop: "Επιστροφή στο: {v}",
          board: "Επιβίβαση {v}", ticket: "Εισιτήριο {v}", taxi: "Ταξί", car: "Ενοικίαση αυτοκινήτου", res: "Κράτηση" }
  };
  function s(lang, k, v) { return (STR[lang === "el" ? "el" : "en"][k]).replace("{v}", v); }

  // ---------- small value helpers ----------
  function clean(v, max) {
    if (typeof v === "number" && isFinite(v)) v = String(v);
    if (typeof v !== "string") return "";
    return v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max || 200);
  }
  function first(v) { return Array.isArray(v) ? v[0] : v; }
  function obj(v) { v = first(v); return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  // "http://schema.org/FlightReservation" → "FlightReservation"
  function typeName(o) {
    if (!o || typeof o !== "object") return "";
    var t = o["@type"] !== undefined ? o["@type"] : o.type;
    var list = Array.isArray(t) ? t : [t];
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] !== "string") continue;
      var n = list[i].replace(/^https?:\/\/(www\.)?schema\.org\//i, "").replace(/^schema:/i, "").trim();
      if (n) return n;
    }
    return "";
  }
  // A text value: a string, a number, or an object's name / value.
  function txt(v, max) {
    v = first(v);
    if (v && typeof v === "object") {
      if (v["@value"] !== undefined) return clean(v["@value"], max);
      return clean(v.name, max);
    }
    return clean(v, max);
  }
  function isYmd(v) {
    var m = typeof v === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return false;
    var d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
  }
  // "2026-10-12T08:15:00+03:00" → { day: "2026-10-12", time: "08:15" }
  function dt(v) {
    var x = txt(v, 60), m = DT_RE.exec(x);
    if (!m || !isYmd(m[1])) return { day: "", time: "" };
    var time = "";
    if (m[2] !== undefined && +m[2] < 24 && +m[3] < 60) time = m[2] + ":" + m[3];
    return { day: m[1], time: time };
  }
  function address(a) {
    a = first(a);
    if (!a) return "";
    if (typeof a === "string") return clean(a, 150);
    if (typeof a !== "object") return "";
    var parts = [txt(a.streetAddress, 100), [txt(a.postalCode, 20), txt(a.addressLocality, 60)].filter(Boolean).join(" "),
                 txt(a.addressCountry, 60)].filter(Boolean);
    return clean(parts.join(", "), 150);
  }
  // A place: the name and the address, without repeating one in the other.
  function placeText(p) {
    p = obj(p);
    if (!p) return txt(arguments[0], 150);
    var n = txt(p.name, 100), a = address(p.address);
    if (n && a && a.toLowerCase().indexOf(n.toLowerCase()) < 0) return clean(n + ", " + a, 150);
    return n || a;
  }
  function stopText(p) {
    var o = obj(p);
    if (!o) return txt(p, 60);
    return clean(txt(o.iataCode, 10) || txt(o.name, 60) || address(o.address), 60);
  }
  // "1.234,50" / "1,234.50" / "123.4" / 99 → cents, or 0
  function cents(v) {
    v = first(v);
    if (v && typeof v === "object") v = v.price !== undefined ? v.price : v["@value"];
    if (typeof v === "number") return isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v * 100) : 0;
    if (typeof v !== "string") return 0;
    var x = v.replace(/[^\d.,]/g, "");
    if (!x) return 0;
    var c = x.lastIndexOf(","), d = x.lastIndexOf(".");
    if (c >= 0 && d >= 0) x = c > d ? x.replace(/\./g, "").replace(",", ".") : x.replace(/,/g, "");
    else if (c >= 0) x = /^\d{1,3}(,\d{3})+$/.test(x) ? x.replace(/,/g, "") : x.replace(/,/g, ".");
    var n = parseFloat(x);
    return isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) : 0;
  }
  function currency(r) {
    var c = txt(r.priceCurrency, 3);
    if (!c) { var ps = obj(r.totalPrice) || obj(r.price); if (ps) c = txt(ps.priceCurrency, 3); }
    c = c.toUpperCase();
    return CUR_RE.test(c) ? c : "";
  }

  // ---------- finding reservations ----------
  function isRes(o) { return /Reservation$/.test(typeName(o)); }
  function nodes(values) {
    var out = [];
    function walk(v, depth) {
      if (out.length >= MAX_NODES || depth > MAX_DEPTH || !v || typeof v !== "object") return;
      if (Array.isArray(v)) { v.forEach(function (x) { walk(x, depth + 1); }); return; }
      if (isRes(v)) { out.push(v); return; }
      if (Array.isArray(v["@graph"])) walk(v["@graph"], depth + 1);
      // an Order (or anything else) that holds reservations
      ["acceptedOffer", "orderedItem", "itemOffered", "reservation", "subReservation", "mainEntity", "about"].forEach(function (k) {
        if (v[k]) walk(v[k], depth + 1);
      });
    }
    walk(values, 0);
    return out;
  }

  function jsonLdBlocks(html) {
    var out = [], src = String(html || "").slice(0, MAX_HTML);
    var re = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi, m;
    while ((m = re.exec(src)) && out.length < 40) out.push(m[1]);
    return out;
  }
  function parseJson(text) {
    var t = String(text || "").replace(/^\s*<!--/, "").replace(/-->\s*$/, "").trim();
    if (!t || t.length > MAX_HTML) return null;
    try { return JSON.parse(t); } catch (e) {}
    // Mail clients sometimes leave HTML entities in the block.
    try {
      return JSON.parse(t.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    } catch (e) { return null; }
  }

  // ---------- microdata ----------
  function attr(el, n) {
    try { var v = el.getAttribute(n); return typeof v === "string" ? v : null; } catch (e) { return null; }
  }
  function has(el, n) { try { return !!el.hasAttribute(n); } catch (e) { return false; } }
  function kids(el) {
    var c = el && el.children;
    return c ? Array.prototype.slice.call(c) : [];
  }
  function tag(el) { return String(el.tagName || "").toLowerCase(); }
  function propValue(el) {
    var t = tag(el), v = null;
    if (t === "meta") v = attr(el, "content");
    else if (t === "a" || t === "link" || t === "area") v = attr(el, "href");
    else if (t === "img" || t === "source" || t === "audio" || t === "video" || t === "iframe" || t === "embed") v = attr(el, "src");
    else if (t === "time") v = attr(el, "datetime");
    else if (t === "data" || t === "meter") v = attr(el, "value");
    if (v === null) v = el.textContent;
    return clean(v, 400);
  }
  function microdata(rootEl) {
    var out = [], seen = 0;
    function item(el, depth) {
      var o = { "@type": clean(attr(el, "itemtype") || "", 200).split(" ")[0] };
      function props(node) {
        kids(node).forEach(function (c) {
          if (++seen > MAX_ELEMS) return;
          var ip = has(c, "itemprop") ? clean(attr(c, "itemprop"), 200) : "";
          if (ip) {
            var val = has(c, "itemscope") ? (depth < MAX_DEPTH ? item(c, depth + 1) : null) : propValue(c);
            if (val !== null) ip.split(" ").forEach(function (name) {
              if (!name) return;
              if (o[name] === undefined) o[name] = val;
              else if (Array.isArray(o[name])) o[name].push(val);
              else o[name] = [o[name], val];
            });
            if (!has(c, "itemscope")) props(c);      // itemprops may nest inside a plain property element
          } else if (!has(c, "itemscope")) props(c);
        });
      }
      props(el);
      return o;
    }
    function scan(el) {
      if (!el || ++seen > MAX_ELEMS || out.length >= MAX_NODES) return;
      if (has(el, "itemscope") && !has(el, "itemprop")) out.push(item(el, 0));
      kids(el).forEach(scan);
    }
    scan(rootEl);
    return out;
  }

  function fromDocument(doc) {
    var values = [];
    if (!doc) return values;
    try {
      var scripts = Array.prototype.filter.call(doc.querySelectorAll("script[type]"), function (sc) {
        return /^\s*application\/ld\+json\s*$/i.test(sc.getAttribute("type") || "");
      });
      scripts.slice(0, 40).forEach(function (sc) {
        var j = parseJson(sc.textContent);
        if (j !== null) values.push(j);
      });
    } catch (e) {}
    try { values = values.concat(microdata(doc.body || doc.documentElement)); } catch (e) {}
    return values;
  }

  // ---------- reservation → entry ----------
  function base(r) {
    var e = { kind: "other", title: "", from: "", to: "", day: "", t1: "", day2: "", t2: "", place: "",
              ref: clean(txt(r.reservationNumber, 60) || txt(r.confirmationNumber, 60), 60),
              num: "", prov: "", cost: cents(r.totalPrice !== undefined ? r.totalPrice : r.price), ccur: currency(r),
              note: [], cancelled: /Cancel/i.test(txt(r.reservationStatus, 80)) };
    if (!e.cost) e.ccur = "";
    var p = obj(r.provider) || obj(r.broker);
    if (p) e.prov = txt(p.name, 60);
    return e;
  }
  function addPax(e, r, lang) {
    var u = obj(r.underName);
    var n = u ? txt(u.name, 80) || [txt(u.givenName, 40), txt(u.familyName, 40)].filter(Boolean).join(" ") : txt(r.underName, 80);
    if (n) e.note.push(s(lang, "pax", n));
  }
  function seatOf(r) {
    var tk = obj(r.reservedTicket), seat = "", coach = "", token = "";
    if (tk) {
      var ts = obj(tk.ticketedSeat);
      if (ts) { seat = txt(ts.seatNumber, 20); coach = txt(ts.seatSection, 20); }
      token = txt(tk.ticketNumber, 40) || "";
    }
    if (!seat) seat = txt(r.airplaneSeat, 20) || (tk ? txt(tk.airplaneSeat, 20) : "");
    return { seat: seat, coach: coach, ticket: token };
  }
  function move(e, trip, depKey, arrKey, kind, lang) {
    e.kind = kind;
    e.from = stopText(trip[depKey]);
    e.to = stopText(trip[arrKey]);
    var a = dt(trip.departureTime), b = dt(trip.arrivalTime);
    e.day = a.day; e.t1 = a.time;
    if (b.day && b.day !== a.day) e.day2 = b.day;
    e.t2 = b.time;
  }
  function one(r, trip, lang) {
    var type = typeName(r), e = base(r), rf = trip || obj(r.reservationFor) || {}, x;
    if (type === "FlightReservation") {
      move(e, rf, "departureAirport", "arrivalAirport", "flight", lang);
      var al = obj(rf.airline) || obj(rf.provider);
      var fnum = txt(rf.flightNumber, 12);
      var code = al ? txt(al.iataCode, 4) : "";
      e.num = clean(fnum && code && fnum.toUpperCase().indexOf(code.toUpperCase()) !== 0 ? code + " " + fnum : fnum, 20);
      if (al && txt(al.name, 60)) e.prov = txt(al.name, 60);
      x = seatOf(r);
      if (x.seat) e.note.push(s(lang, "seat", x.seat));
      if (txt(rf.departureTerminal, 10)) e.note.push(s(lang, "term", txt(rf.departureTerminal, 10)));
      if (txt(rf.departureGate, 10)) e.note.push(s(lang, "gate", txt(rf.departureGate, 10)));
      var bt = dt(rf.boardingTime || r.boardingTime);
      if (bt.time) e.note.push(s(lang, "board", bt.time));
      addPax(e, r, lang);
    } else if (type === "TrainReservation" || type === "BusReservation" || type === "BoatReservation") {
      var k = type === "TrainReservation" ? ["departureStation", "arrivalStation", "train", "trainNumber", "trainName"]
        : type === "BusReservation" ? ["departureBusStop", "arrivalBusStop", "bus", "busNumber", "busName"]
        : ["departureBoatTerminal", "arrivalBoatTerminal", "ferry", "", ""];
      move(e, rf, k[0], k[1], k[2], lang);
      if (k[3]) e.num = txt(rf[k[3]], 20);
      if (!e.prov) e.prov = txt(rf.provider, 60) || (k[4] ? txt(rf[k[4]], 60) : "");
      x = seatOf(r);
      if (x.coach) e.note.push(s(lang, "coach", x.coach));
      if (x.seat) e.note.push(s(lang, "seat", x.seat));
      if (txt(rf.departurePlatform, 10)) e.note.push(s(lang, "plat", txt(rf.departurePlatform, 10)));
      addPax(e, r, lang);
    } else if (type === "LodgingReservation") {
      e.kind = "stay";
      e.title = txt(rf.name, 100);
      e.place = placeText(rf);
      var ci = dt(r.checkinTime || r.checkinDate), co = dt(r.checkoutTime || r.checkoutDate);
      e.day = ci.day; e.t1 = ci.time; e.day2 = co.day; e.t2 = co.time;
      if (txt(rf.telephone, 30)) e.note.push(s(lang, "tel", txt(rf.telephone, 30)));
      addPax(e, r, lang);
    } else if (type === "RentalCarReservation") {
      e.kind = "rental";
      var company = obj(rf.rentalCompany) || obj(r.provider);
      if (company) e.prov = txt(company.name, 60);
      var car = [txt(rf.brand, 30), txt(rf.model, 30) || txt(rf.name, 60)].filter(Boolean).join(" ");
      e.title = clean([e.prov || s(lang, "car", ""), car].filter(Boolean).join(" · "), 100);
      e.place = placeText(r.pickupLocation);
      var pu = dt(r.pickupTime), dr = dt(r.dropoffTime);
      e.day = pu.day; e.t1 = pu.time; e.day2 = dr.day; e.t2 = dr.time;
      var back = placeText(r.dropoffLocation);
      if (back && back !== e.place) e.note.push(s(lang, "drop", back));
      addPax(e, r, lang);
    } else if (type === "TaxiReservation") {
      e.kind = "car";
      e.title = s(lang, "taxi", "").trim();
      e.from = clean(placeText(r.pickupLocation), 60);
      var tp = dt(r.pickupTime);
      e.day = tp.day; e.t1 = tp.time;
    } else if (type === "FoodEstablishmentReservation") {
      e.kind = "food";
      e.title = txt(rf.name, 100);
      e.place = placeText(rf);
      var st = dt(r.startTime || r.startDate);
      e.day = st.day; e.t1 = st.time;
      var ps = txt(r.partySize, 4);
      if (ps) e.note.push(s(lang, "party", ps));
    } else if (type === "EventReservation") {
      e.kind = "ticket";
      e.title = txt(rf.name, 100);
      e.place = placeText(rf.location);
      var es = dt(rf.startDate), ee = dt(rf.endDate);
      e.day = es.day; e.t1 = es.time;
      if (ee.day && ee.day !== es.day) e.day2 = ee.day;
      e.t2 = ee.time;
      x = seatOf(r);
      if (x.seat) e.note.push(s(lang, "seat", x.seat));
      if (x.ticket) e.note.push(s(lang, "ticket", x.ticket));
      addPax(e, r, lang);
    } else {
      e.title = txt(rf.name, 100) || s(lang, "res", "").trim();
      e.place = placeText(rf.location) || address(rf.address);
      var gs = dt(r.startTime || rf.startDate || r.startDate);
      e.day = gs.day; e.t1 = gs.time;
    }
    e.note = clean(e.note.join(" · "), 1000);
    e.key = [e.kind, e.ref.toLowerCase(), e.day, e.t1, e.num.replace(/\s+/g, "").toLowerCase(), e.from.toLowerCase()].join("|");
    return e;
  }
  // One entry per flight leg / trip (reservationFor may be a list).
  function reservations(list, lang) {
    var out = [], keys = {};
    (Array.isArray(list) ? list : []).forEach(function (r) {
      if (!r || typeof r !== "object" || out.length >= MAX_NODES) return;
      var legs = Array.isArray(r.reservationFor) ? r.reservationFor.filter(function (x) { return x && typeof x === "object"; }) : [null];
      legs.slice(0, 12).forEach(function (leg) {
        var e = one(r, leg, lang);
        if (!e.title && !e.from && !e.to && !e.place && !e.day) return;   // nothing usable
        if (keys[e.key]) return;                                          // the same booking twice (JSON-LD + microdata)
        keys[e.key] = 1;
        out.push(e);
      });
    });
    return out;
  }

  function parseText(text, lang) {
    var values = [];
    jsonLdBlocks(text).forEach(function (b) { var j = parseJson(b); if (j !== null) values.push(j); });
    // A bare JSON-LD object pasted on its own
    if (!values.length && /^\s*[[{]/.test(String(text || ""))) { var j = parseJson(text); if (j !== null) values.push(j); }
    return reservations(nodes(values), lang);
  }
  // DOMParser documents are inert: their scripts never run and nothing
  // they reference is fetched. Only text is read from them.
  function parseHtml(html, lang, Parser) {
    html = String(html || "").slice(0, MAX_HTML);
    var P = Parser || (typeof DOMParser !== "undefined" ? DOMParser : null);
    if (!P) return parseText(html, lang);
    var doc = null;
    try { doc = new P().parseFromString(html, "text/html"); } catch (e) { doc = null; }
    if (!doc) return parseText(html, lang);
    return reservations(nodes(fromDocument(doc)), lang);
  }

  var api = {
    jsonLdBlocks: jsonLdBlocks, parseJson: parseJson, microdata: microdata, fromDocument: fromDocument,
    nodes: nodes, reservations: reservations, parseText: parseText, parseHtml: parseHtml,
    cents: cents, dt: dt, typeName: typeName
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosTravelBooking = api;
})(typeof window !== "undefined" ? window : this);
