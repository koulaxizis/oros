// ============================================================
// orOS Meal Planner — pantry.js (pure logic, wave 3)
// What is at home (data.pa, see core.js normPantryItem) against what
// the recipes and the week need:
//   - matching a pantry item to an ingredient (same key, or one name
//     inside the other when the nutrition table does not tell them
//     apart: "feta" ↔ "Feta Dodoni", but "milk" ≠ "coconut milk")
//   - amounts in other units (g ↔ kg ↔ oz, ml ↔ l ↔ spoons, and
//     between weight, volume and pieces through the food's density
//     and piece weight from nutrition.js)
//   - is there enough for a shopping line; what can I cook; what a
//     "Cooked" takes from the pantry; best-before days
//   - the shell's best-before notice (§1 needs nothing else: the shell
//     loads this file alone and reads the raw blob)
// No DOM, no storage, no network. Node tests load it after core.js
// and nutrition.js (it finds them on its global when called).
// API: window.OrosMealsPantry (end of file).
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Days + the shell's notice (self-contained) ----------
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function ymdUTC(s) {
    var m = typeof s === "string" && s.match(YMD_RE);
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]), d = new Date(t);
    return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null;
  }
  // Whole days from today to bb (0 = today, 1 = tomorrow, -1 = yesterday).
  function daysLeft(bb, today) {
    var a = ymdUTC(today), b = ymdUTC(bb);
    return a === null || b === null ? null : Math.round((b - a) / 86400000);
  }
  // Device-local reminder hour (oros-meals-prefs.nt): -1 = off (default).
  function notifyHour(prefs) {
    var h = prefs && typeof prefs === "object" ? prefs.nt : -1;
    return typeof h === "number" && h >= 0 && h <= 23 && Math.floor(h) === h ? h : -1;
  }
  // From the raw synced blob (the app may be closed): live pantry items
  // whose best-before day is today or tomorrow, soonest first.
  // → [{ id, n, d }] (d 0 today, 1 tomorrow)
  function expiryNotice(raw, today) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.pa)) return [];
    var tombs = raw.tombs && typeof raw.tombs === "object" ? raw.tombs : {}, best = {};
    raw.pa.forEach(function (x) {
      if (!x || typeof x !== "object" || typeof x.id !== "string" || !/^pa-[a-z0-9]{4,36}$/.test(x.id)) return;
      if (typeof x.m !== "number" || typeof x.n !== "string") return;
      if (best[x.id] && best[x.id].m >= x.m) return;
      best[x.id] = x;
    });
    var out = [];
    Object.keys(best).forEach(function (id) {
      var x = best[id];
      if (typeof tombs[id] === "number" && tombs[id] >= x.m) return;
      var n = x.n.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
      var d = daysLeft(x.bb, today);
      if (n && (d === 0 || d === 1)) out.push({ id: id, n: n, d: d });
    });
    out.sort(function (a, b) { return a.d - b.d || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0) || (a.id < b.id ? -1 : 1); });
    return out;
  }

  // ---------- 2. Matching ----------
  function C() { return root.OrosMealsCore; }
  function N() { return root.OrosMealsNutrition || null; }
  function rowOf(name) { var n = N(); return n ? n.findBuiltIn(name) : null; }
  // Pantry items that are this ingredient: the same key first, then
  // one name's words all inside the other's, when the table does not
  // put them on different rows.
  function matches(items, name) {
    var k = C().keyOf(name);
    if (!k) return [];
    var exact = [], loose = [], ws = k.split(" "), row = null, rowDone = false;
    (items || []).forEach(function (it) {
      var ik = C().keyOf(it.n);
      if (!ik) return;
      if (ik === k) { exact.push(it); return; }
      var iw = ik.split(" ");
      var short = iw.length <= ws.length ? iw : ws, long = iw.length <= ws.length ? ws : iw;
      if (!short.every(function (w) { return long.indexOf(w) >= 0; })) return;
      if (!rowDone) { row = rowOf(name); rowDone = true; }
      var ir = rowOf(it.n);
      if (row && ir && row.id !== ir.id) return;
      loose.push(it);
    });
    return exact.concat(loose);
  }

  // ---------- 3. Amounts ----------
  function fam(u) {
    var U = C().UNITS[u];
    if (!U || !U.fam) return "";
    return U.fam === "spoon" ? "vol" : U.fam;
  }
  function inBase(q, u) {          // g for mass, ml for volume and spoons
    var U = C().UNITS[u];
    return U.fam === "spoon" ? q * U.f * 5 : q * U.f;
  }
  // q of unit u in unit toU (row: the food's table row, for density
  // and piece weight). null when it cannot be told.
  function convert(q, u, toU, row) {
    if (q === null || q === undefined) return null;
    u = u || "pc"; toU = toU || "pc";
    if (u === toU) return q;
    var fa = fam(u), fb = fam(toU);
    if (fa && fa === fb) return inBase(q, u) / inBase(1, toU);
    var n = N();
    if (!n) return null;
    var g = n.grams(q, u, row), g1 = n.grams(1, toU, row);
    return g === null || !g1 ? null : g / g1;
  }
  function round3(v) { return Math.round(v * 1000) / 1000; }
  // How a list of needed amounts [{ q, u }] stands against the pantry.
  // → { st: "full" | "part" | "none", unk: amount not comparable, items }
  function coverParts(items, name, parts) {
    var ms = matches(items, name);
    if (!ms.length) return { st: "none", items: [] };
    if (!parts.length || ms.some(function (it) { return it.q === null; })) return { st: "full", unk: true, items: ms };
    var row = rowOf(name), n = N();
    if (n) {
      var needG = 0, haveG = 0, ok = true;
      parts.forEach(function (p) { var g = n.grams(p.q, p.u || "pc", row); if (g === null) ok = false; else needG += g; });
      ms.forEach(function (it) { var g = n.grams(it.q, it.u || "pc", row); if (g === null) ok = false; else haveG += g; });
      if (ok) return { st: haveG >= needG * 0.999 ? "full" : (haveG > 0 ? "part" : "none"), items: ms };
    }
    var all = true, any = false;
    parts.forEach(function (p) {
      var h = 0, got = false;
      ms.forEach(function (it) { var c = convert(it.q, it.u, p.u, row); if (c !== null) { h += c; got = true; } });
      if (got && h > 0) any = true;
      if (!got || h < p.q * 0.999) all = false;
    });
    if (all) return { st: "full", items: ms };
    return { st: "part", unk: !any, items: ms };
  }
  function coverIng(items, ing, factor) {
    var parts = ing.q === null ? [] : [{ q: ing.q * (factor || 1), u: ing.u || "pc" }];
    return coverParts(items, ing.n, parts);
  }
  // A shopping line (core.buildShop item with .am) → its parts.
  function shopParts(am) {
    if (!am) return [];
    var out = [];
    if (am.mass) out.push({ q: am.mass, u: "g" });
    if (am.vol) out.push({ q: am.vol, u: "ml" });
    if (am.spoon) out.push({ q: am.spoon, u: "tsp" });
    Object.keys(am.u || {}).sort().forEach(function (u) { out.push({ q: am.u[u], u: u }); });
    return out;
  }
  function coverShop(items, shopItem) {
    if (shopItem.manual) return { st: "none", items: [] };
    return coverParts(items, shopItem.name, shopParts(shopItem.am));
  }
  // "500 g + 1 l" for the items of a match.
  function haveText(list, lang) {
    var c = C(), some = lang === "el" ? "υπάρχει" : "some";
    return list.map(function (it) { return it.q === null ? some : c.fmtIngQty(niceAmount(it.q, it.u), lang, 1, ""); }).join(" + ");
  }
  // A shopping line as a pantry draft: one kind of amount → that
  // amount (g → kg from 1000 up, ml → l); several or none → no amount.
  function fromShop(shopItem) {
    var parts = shopParts(shopItem.am), d = { n: shopItem.name, q: null, u: "" };
    if (parts.length !== 1) return d;
    var p = parts[0];
    if (p.u === "g") { d.q = p.q >= 1000 ? round3(p.q / 1000) : round3(p.q); d.u = p.q >= 1000 ? "kg" : "g"; }
    else if (p.u === "ml") { d.q = p.q >= 1000 ? round3(p.q / 1000) : round3(p.q); d.u = p.q >= 1000 ? "l" : "ml"; }
    else if (p.u === "tsp") { d.q = round3(p.q * 5); d.u = "ml"; }
    else { d.q = round3(p.q); d.u = p.u === "pc" ? "pc" : p.u; }
    return d;
  }
  // A pantry amount to show: below 1 kg / 1 l in g / ml ("970 ml",
  // not "1 l" for 0.97 l).
  function niceAmount(q, u) {
    if (q === null || q === undefined) return { q: null, u: u };
    if (u === "kg" && q < 1) return { q: round3(q * 1000), u: "g" };
    if (u === "l" && q < 1) return { q: round3(q * 1000), u: "ml" };
    return { q: q, u: u };
  }
  // Where a new item probably goes.
  function guessLoc(name) {
    var a = C().lookup(name).aisle, f = C().fold(String(name || ""));
    if (a === "frozen") return "freezer";
    if (a === "dairy" || a === "meat" || a === "fish") return "fridge";
    if (/\b(fresh|φρεσκ)/.test(f) && a === "produce") return "fridge";
    return "cupboard";
  }
  // Add an amount to an existing item when the units allow it.
  // → the new quantity in the item's unit, or null.
  function addInto(item, q, u) {
    if (item.q === null || q === null) return null;
    var c = convert(q, u, item.u || "pc", rowOf(item.n));
    return c === null ? null : round3(item.q + c);
  }

  // ---------- 4. What can I cook ----------
  // recipes: list; items: pantry; staple(key) → true for "always in
  // the house"; today: for the "use soon" order.
  // → [{ r, total, have, missing: [ing], low: [ing], soon }] best first,
  //   only recipes with at least one pantry item (staples alone don't count).
  function cookable(recipes, items, staple, today) {
    var out = [];
    (recipes || []).forEach(function (r) {
      var total = 0, have = 0, own = 0, missing = [], low = [], soon = null, seen = {};
      r.ig.forEach(function (ing) {
        var k = C().keyOf(ing.n);
        if (!k || seen[k]) return;
        seen[k] = 1;
        total++;
        if (staple && staple(k)) { have++; return; }
        var c = coverIng(items, ing, 1);
        if (c.st === "none") { missing.push(ing); return; }
        have++; own++;
        if (c.st === "part") low.push(ing);
        c.items.forEach(function (it) {
          var d = it.bb ? daysLeft(it.bb, today) : null;
          if (d !== null && (soon === null || d < soon)) soon = d;
        });
      });
      if (!own) return;
      out.push({ r: r, total: total, have: have, missing: missing, low: low, soon: soon });
    });
    out.sort(function (a, b) {
      var sa = a.soon === null ? 9999 : Math.max(a.soon, -1), sb = b.soon === null ? 9999 : Math.max(b.soon, -1);
      var ua = sa <= 3 ? sa : 99, ub = sb <= 3 ? sb : 99;     // use-soon items first among equals
      return (a.missing.length - b.missing.length) || (b.have / b.total - a.have / a.total) ||
             (a.low.length - b.low.length) || (ua - ub) ||
             (a.r.t < b.r.t ? -1 : a.r.t > b.r.t ? 1 : 0) || (a.r.id < b.r.id ? -1 : 1);
    });
    return out;
  }

  // ---------- 5. "Cooked": what to take ----------
  // → [{ ing, st, takes: [{ id, take, left }], short }]
  //   st "take": amounts known; "some": the recipe or the item gives no
  //   amount (offer "used up" instead); "none": not in the pantry.
  //   Items are used soonest best-before first.
  function cookPlan(rec, factor, items, today) {
    var out = [], seen = {};
    rec.ig.forEach(function (ing) {
      var k = C().keyOf(ing.n);
      if (!k || seen[k]) return;
      seen[k] = 1;
      var ms = matches(items, ing.n).slice().sort(function (a, b) {
        var da = a.bb ? daysLeft(a.bb, today) : 99999, db = b.bb ? daysLeft(b.bb, today) : 99999;
        return da - db || (a.id < b.id ? -1 : 1);
      });
      if (!ms.length) { out.push({ ing: ing, st: "none", takes: [], short: 0 }); return; }
      if (ing.q === null) { out.push({ ing: ing, st: "some", takes: [{ id: ms[0].id, take: null, left: null }], short: 0 }); return; }
      var need = ing.q * (factor || 1), row = rowOf(ing.n), takes = [];
      for (var i = 0; i < ms.length && need > 1e-9; i++) {
        var it = ms[i];
        if (it.q === null) continue;
        var inItem = convert(need, ing.u || "pc", it.u || "pc", row);
        if (inItem === null) continue;
        var take = Math.min(it.q, inItem);
        takes.push({ id: it.id, take: round3(take), left: round3(it.q - take) });
        need -= need * (take / inItem);
      }
      if (!takes.length) { out.push({ ing: ing, st: "some", takes: [{ id: ms[0].id, take: null, left: null }], short: 0 }); return; }
      out.push({ ing: ing, st: "take", takes: takes, short: need > 1e-6 ? round3(need) : 0 });
    });
    return out;
  }

  // ---------- 6. Lists ----------
  // Items with a best-before within `days` (or past), soonest first.
  function expiring(items, today, days) {
    return (items || []).filter(function (it) {
      var d = it.bb ? daysLeft(it.bb, today) : null;
      return d !== null && d <= days;
    }).sort(function (a, b) { return a.bb < b.bb ? -1 : a.bb > b.bb ? 1 : (a.n < b.n ? -1 : 1); });
  }
  function findByCode(items, code) {
    for (var i = 0; i < (items || []).length; i++) if (items[i].bc && items[i].bc === code) return items[i];
    return null;
  }

  root.OrosMealsPantry = {
    daysLeft: daysLeft, notifyHour: notifyHour, expiryNotice: expiryNotice,
    matches: matches, convert: convert, coverParts: coverParts, coverIng: coverIng, coverShop: coverShop,
    shopParts: shopParts, haveText: haveText, niceAmount: niceAmount, fromShop: fromShop, guessLoc: guessLoc, addInto: addInto,
    cookable: cookable, cookPlan: cookPlan, expiring: expiring, findByCode: findByCode
  };
})(typeof window !== "undefined" ? window : this);
