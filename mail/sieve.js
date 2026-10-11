// ============================================================
// orOS Mail — rules and out-of-office reply as a Sieve script
// (RFC 5228; fileinto, imap4flags RFC 5232, vacation RFC 5230,
// date RFC 5260 + relational RFC 5231). The relay uploads it with
// ManageSieve (relay/sieve.js) to servers that offer it, so the rules
// and the reply work with orOS closed. Pure, no DOM.
//
//   normAway(v) → { on, subject, text, days, start, end, m } | null
//   build({ rules, away, ext, folder }) → { script, skipped, dates }
//     rules  — this account's rules (rules.js shape), on ones only
//     away   — normAway() result or null
//     ext    — the server's Sieve extensions (lower case)
//     folder — raw IMAP folder name → its UTF-8 name (Sieve wants UTF-8)
//     skipped: rules the server cannot run (missing extension)
//     dates: false when the away dates were left out (no "date" support)
//   runs(rule, ext) → true when the server can run this rule (then the
//     device leaves it to the server, notify.js keeps the same test)
//   normExt(list) → the extensions above that the server offers
//   Same meaning as on the device (rules.js plan): every matching
//   "read" / "star" rule sets its flag; the first matching move wins.
// Exposes window.orosMailSieve or module.exports.
// ============================================================
(function (root) {
  "use strict";
  var HEADERS = { from: ["from"], to: ["to", "cc"], subject: ["subject"], any: ["from", "to", "cc", "subject"] };
  var MAX_TEXT = 4000, MAX_SUBJ = 200;
  var KNOWN = ["comparator-i;unicode-casemap", "date", "fileinto", "imap4flags", "relational", "vacation"];

  function normExt(v) {
    var have = {};
    (Array.isArray(v) ? v : []).forEach(function (e) { if (typeof e === "string") have[e.toLowerCase()] = 1; });
    return KNOWN.filter(function (k) { return have[k]; });
  }
  function runs(r, ext) {
    if (!r || !Array.isArray(ext)) return false;
    return ext.indexOf(r.act === "move" ? "fileinto" : "imap4flags") >= 0;
  }

  function str(s) { return "\"" + String(s).replace(/[\\"]/g, "\\$&") + "\""; }
  function list(a) { return a.length === 1 ? str(a[0]) : "[" + a.map(str).join(", ") + "]"; }
  function ymd(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ""; }
  function isInt(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n; }

  function normAway(v) {
    if (!v || typeof v !== "object") return null;
    var text = typeof v.text === "string" ? v.text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trim().slice(0, MAX_TEXT) : "";
    var subject = typeof v.subject === "string" ? v.subject.replace(/\s+/g, " ").trim().slice(0, MAX_SUBJ) : "";
    var days = isInt(v.days) && v.days >= 1 && v.days <= 30 ? v.days : 1;
    var start = ymd(v.start), end = ymd(v.end);
    if (start && end && end < start) end = "";
    return { on: v.on === true && !!text, subject: subject, text: text, days: days, start: start, end: end,
             m: isInt(v.m) && v.m >= 0 ? v.m : 0 };
  }

  function words(has) {
    return String(has || "").split(",").map(function (w) { return w.trim(); }).filter(Boolean);
  }

  function build(o) {
    var ext = {};
    (o.ext || []).forEach(function (e) { ext[String(e).toLowerCase()] = 1; });
    var folder = typeof o.folder === "function" ? o.folder : function (f) { return f; };
    var need = {}, body = [], skipped = 0, dates = true;
    var cmp = ext["comparator-i;unicode-casemap"] ? ":comparator \"i;unicode-casemap\" " : "";
    if (cmp) need["comparator-i;unicode-casemap"] = 1;
    function test(r) {
      return "header " + cmp + ":contains " + list(HEADERS[r.field] || HEADERS.any) + " " + list(words(r.has));
    }
    var away = o.away && o.away.on ? o.away : null;
    if (away && ext.vacation) {
      need.vacation = 1;
      var cond = [];
      if (away.start || away.end) {
        if (ext.date && ext.relational) {
          need.date = need.relational = 1;
          if (away.start) cond.push("currentdate :value \"ge\" \"date\" " + str(away.start));
          if (away.end) cond.push("currentdate :value \"le\" \"date\" " + str(away.end));
        } else dates = false;
      }
      var vac = "vacation :days " + away.days + (away.subject ? " :subject " + str(away.subject) : "") +
                " " + str(away.text.replace(/\n/g, "\r\n")) + ";";
      body.push("# Out of office");
      if (cond.length) body.push("if " + (cond.length > 1 ? "allof (" + cond.join(", ") + ")" : cond[0]) + " {", "  " + vac, "}");
      else body.push(vac);
    }
    var rules = (o.rules || []).filter(function (r) { return r && r.on !== false && words(r.has).length; });
    // flags first: they ride along with the move (or the Inbox copy)
    rules.forEach(function (r) {
      if (r.act !== "read" && r.act !== "star") return;
      if (!ext.imap4flags) { skipped++; return; }
      need.imap4flags = 1;
      body.push("if " + test(r) + " {", "  addflag " + str(r.act === "read" ? "\\Seen" : "\\Flagged") + ";", "}");
    });
    rules.forEach(function (r) {
      if (r.act !== "move") return;
      if (!ext.fileinto || !r.to) { skipped++; return; }
      need.fileinto = 1;
      body.push("if " + test(r) + " {", "  fileinto " + str(folder(r.to)) + ";", "  stop;", "}");
    });
    var head = ["# orOS Mail: rules and out-of-office reply.",
                "# Made by orOS. Changes made here are replaced when you save in orOS."];
    var req = Object.keys(need).sort();
    if (req.length) head.push("require " + list(req) + ";");
    return { script: head.concat(body).join("\r\n") + "\r\n", skipped: skipped, dates: dates, empty: !body.length };
  }

  var api = { v: 1, normAway: normAway, normExt: normExt, runs: runs, build: build };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.orosMailSieve = api;
})(typeof window !== "undefined" ? window : globalThis);
