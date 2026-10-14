// ============================================================
// orOS Garage — logbook.js (printable vehicle logbook, v1.0.0)
// The whole history of one vehicle as one page, for a buyer, a
// garage or your own records: the vehicle, a summary, every
// service, renewals in force, tyres, and (optional) fuel fills and
// other costs. Printed (or saved as PDF) through the browser, or
// saved as one self-contained HTML file.
// Pure functions, no DOM, no network. Every text that comes from
// the data is escaped here; the caller passes ready formatters.
//
// API (window.OrosGarageLogbook, module.exports under Node):
//   build(data, vid, opts) → report | null
//     opts { fuel: bool (fuel / charging fills), costs: bool (other
//     costs), money: bool (show amounts), today: "YYYY-MM-DD" }
//   html(report, f) → string (the body of the page, escaped)
//   page(report, f) → string (a whole HTML document with its CSS)
//     f = { t(key, params) → text, money(cents), km(n), day(ymd),
//           qty(q thousandths, e), per100(v) → text, item(id),
//           cat(id), ren(row), fuel(id), type(id), season(id) }
//   esc(s) → s with & < > " ' escaped
// ============================================================
(function (root) {
  "use strict";

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function byDate(a, b) { return cmpStr(a.d, b.d) || ((a.km || 0) - (b.km || 0)) || cmpStr(a.id, b.id); }

  function build(data, vid, opts) {
    var o = opts || {};
    var v = null;
    ((data && data.vehicles) || []).forEach(function (x) { if (x.id === vid) v = x; });
    if (!v) return null;
    function rows(k) { return ((data && data[k]) || []).filter(function (x) { return x.v === vid; }).slice().sort(byDate); }
    var service = rows("service"), fuel = rows("fuel"), costs = rows("costs"), odo = rows("odo");
    var lo = null, hi = null, first = null, last = null;
    [service, fuel, costs, odo].forEach(function (list) {
      list.forEach(function (x) {
        if (typeof x.km === "number") { lo = lo === null ? x.km : Math.min(lo, x.km); hi = hi === null ? x.km : Math.max(hi, x.km); }
        if (!first || x.d < first) first = x.d;
        if (!last || x.d > last) last = x.d;
      });
    });
    var sum = { service: 0, fuel: 0, other: 0 };
    service.forEach(function (x) { sum.service += x.c || 0; });
    fuel.forEach(function (x) { sum.fuel += x.c || 0; });
    costs.forEach(function (x) { sum.other += x.c || 0; });
    // full-to-full average per energy (the same rule as core.consumption)
    var cons = {};
    ["f", "e"].forEach(function (e) {
      var list = fuel.filter(function (x) { return x.e === e; })
        .sort(function (x, y) { return (x.km - y.km) || cmpStr(x.d, y.d) || cmpStr(x.id, y.id); });
      var prev = null, acc = 0, dist = 0, q = 0;
      list.forEach(function (x) {
        if (x.mis) { prev = x.full ? x : null; acc = 0; return; }
        if (prev === null) { if (x.full) { prev = x; acc = 0; } return; }
        acc += x.q;
        if (!x.full) return;
        if (x.km > prev.km) { dist += x.km - prev.km; q += acc; }
        prev = x;
        acc = 0;
      });
      if (dist > 0) cons[e] = q / 10 / dist;
    });
    var renewals = ((data && data.renewals) || []).filter(function (x) { return x.v === vid; })
      .slice().sort(function (a, b) { return cmpStr(a.exp, b.exp) || cmpStr(a.id, b.id); });
    var tyres = ((data && data.tyres) || []).filter(function (x) { return x.v === vid; })
      .slice().sort(function (a, b) { return (b.on - a.on) || cmpStr(a.label, b.label); });
    return {
      v: v, today: o.today || "", first: first, last: last, kmLo: lo, kmHi: hi,
      service: service, fuel: o.fuel ? fuel : [], costs: o.costs ? costs : [],
      nFuel: fuel.length, nCosts: costs.length,
      renewals: renewals, tyres: tyres, cons: cons,
      sum: sum, money: !!o.money, withFuel: !!o.fuel, withCosts: !!o.costs
    };
  }

  function table(head, body, cls) {
    var h = "<table" + (cls ? " class=\"" + cls + "\"" : "") + "><thead><tr>";
    head.forEach(function (x) { h += "<th>" + esc(x) + "</th>"; });
    h += "</tr></thead><tbody>";
    body.forEach(function (r) {
      h += "<tr>";
      r.forEach(function (c) { h += "<td>" + esc(c) + "</td>"; });
      h += "</tr>";
    });
    return h + "</tbody></table>";
  }
  function dl(pairs) {
    var h = "<dl>";
    pairs.forEach(function (p) { if (p[1] !== "" && p[1] !== null && p[1] !== undefined) h += "<dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd>"; });
    return h + "</dl>";
  }

  function html(r, f) {
    var t = f.t, v = r.v, M = r.money;
    var h = "<header class=\"lb-head\"><h1>" + esc(t("lb.title")) + "</h1>";
    h += "<p class=\"lb-name\">" + esc(v.name) + "</p></header>";
    h += "<h2>" + esc(t("lb.vehicle")) + "</h2>";
    h += dl([
      [t("ed.type"), f.type(v.type)],
      [t("ed.make"), v.make], [t("ed.model"), v.model], [t("ed.year"), v.year ? String(v.year) : ""],
      [t("ed.plate"), v.plate], [t("ed.fuelType"), v.fuel !== "none" ? f.fuel(v.fuel) : ""],
      [t("lb.kmNow"), r.kmHi !== null ? f.km(r.kmHi) + " km" : ""]
    ]);
    h += "<h2>" + esc(t("lb.summary")) + "</h2>";
    var sum = [
      [t("lb.period"), r.first ? f.day(r.first) + " – " + f.day(r.last) : ""],
      [t("lb.kmLogged"), r.kmLo !== null && r.kmHi > r.kmLo ? f.km(r.kmHi - r.kmLo) + " km" : ""],
      [t("lb.nService"), String(r.service.length)],
      [t("lb.nFuel"), r.nFuel ? String(r.nFuel) : ""]
    ];
    if (r.cons.f) sum.push([t("lb.avg"), f.per100(r.cons.f, "f")]);
    if (r.cons.e) sum.push([t("lb.avgE"), f.per100(r.cons.e, "e")]);
    if (M) {
      sum.push([t("lb.sumService"), f.money(r.sum.service)]);
      if (r.nFuel) sum.push([t("lb.sumFuel"), f.money(r.sum.fuel)]);
      if (r.nCosts) sum.push([t("lb.sumOther"), f.money(r.sum.other)]);
    }
    h += dl(sum);

    h += "<h2>" + esc(t("lb.service")) + "</h2>";
    if (r.service.length) {
      var sh = [t("f.date"), "km", t("f.items"), t("f.shop")];
      if (M) sh.push(t("lb.cost"));
      sh.push(t("f.notes"));
      h += table(sh, r.service.map(function (x) {
        var row = [f.day(x.d), x.km !== null && x.km !== undefined ? f.km(x.km) : "", x.items.map(f.item).join(", "), x.shop || ""];
        if (M) row.push(x.c ? f.money(x.c) : "");
        row.push(x.n || "");
        return row;
      }), "lb-svc");
    } else h += "<p class=\"lb-none\">" + esc(t("lb.none")) + "</p>";

    if (r.renewals.length) {
      h += "<h2>" + esc(t("sec.renewals")) + "</h2>";
      h += table([t("ed.kind"), t("ed.exp"), t("ed.prov")], r.renewals.map(function (x) {
        return [f.ren(x), f.day(x.exp), x.prov || ""];
      }));
    }
    if (r.tyres.length) {
      h += "<h2>" + esc(t("sec.tyres")) + "</h2>";
      h += table([t("ed.label"), t("ed.season"), t("ed.size"), t("ed.brand"), "DOT", t("lb.mounted")], r.tyres.map(function (x) {
        return [x.label, f.season(x.season), x.size || "", x.brand || "", x.dot || "", x.on ? "✓" : ""];
      }));
    }
    if (r.withFuel && r.fuel.length) {
      h += "<h2>" + esc(t("lb.fuel")) + "</h2>";
      var fh = [t("f.date"), "km", t("lb.qty")];
      if (M) { fh.push(t("lb.price")); fh.push(t("lb.cost")); }
      fh.push(t("f.station"));
      h += table(fh, r.fuel.map(function (x) {
        var row = [f.day(x.d), f.km(x.km), f.qty(x.q, x.e) + (x.full ? "" : " · " + t("log.partial"))];
        if (M) { row.push(x.c && x.q ? f.money(Math.round(x.c * 1000 / x.q)) : ""); row.push(x.c ? f.money(x.c) : ""); }
        row.push(x.st || "");
        return row;
      }), "lb-fuel");
    }
    if (r.withCosts && r.costs.length) {
      h += "<h2>" + esc(t("lb.costs")) + "</h2>";
      var ch = [t("f.date"), t("f.cat"), "km"];
      if (M) ch.push(t("lb.cost"));
      ch.push(t("f.notes"));
      h += table(ch, r.costs.map(function (x) {
        var row = [f.day(x.d), f.cat(x.cat), x.km !== null && x.km !== undefined ? f.km(x.km) : ""];
        if (M) row.push(f.money(x.c));
        row.push(x.n || "");
        return row;
      }));
    }
    h += "<p class=\"lb-foot\">" + esc(t("lb.made", { d: r.today ? f.day(r.today) : "" })) + "</p>";
    return h;
  }

  var CSS =
    "body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#111;background:#fff;margin:0;padding:24px;line-height:1.4}" +
    ".lb{max-width:900px;margin:0 auto}" +
    "h1{font-size:22pt;margin:0}.lb-name{font-size:14pt;margin:2px 0 0;color:#333}" +
    "h2{font-size:12pt;margin:18px 0 6px;border-bottom:1px solid #999;padding-bottom:2px;break-after:avoid}" +
    "dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;margin:0;font-size:10.5pt}dt{color:#555}dd{margin:0}" +
    "table{width:100%;border-collapse:collapse;font-size:9.5pt}th,td{text-align:left;padding:3px 6px;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere}" +
    "th{color:#444;font-weight:700;border-bottom:1px solid #999}tr{break-inside:avoid}" +
    ".lb-none{color:#666;font-size:10pt}.lb-foot{margin-top:18px;font-size:8.5pt;color:#666}" +
    "@media print{body{padding:0}@page{margin:14mm}}";

  function page(r, f) {
    return "<!DOCTYPE html>\n<html lang=\"" + esc(f.lang || "en") + "\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
      "<title>" + esc(f.t("lb.title") + " · " + r.v.name) + "</title><style>" + CSS + "</style></head>" +
      "<body><main class=\"lb\">" + html(r, f) + "</main></body></html>\n";
  }

  var API = { build: build, html: html, page: page, esc: esc, CSS: CSS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosGarageLogbook = API;
})(typeof window !== "undefined" ? window : null);
