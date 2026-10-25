// ============================================================
// orOS Publishing — Today provider (v1.0.0, publisher wave P13)
// Loaded by the shell (today/host.js) through apps.json "today",
// after core.js and feed.js. Read-only: reads oros-publish-data,
// never writes. The rules are publish/core.js; feed.js gives the same
// rows and labels as the Calendar. Rows:
//   - planned posts not posted yet, on their day and hour (a missed
//     one shows under Overdue; opens the post);
//   - open release-plan steps up to the horizon (late ones overdue;
//     opens the title) and the release days in the horizon (events);
//   - review copies to follow up (3 weeks with no review), today;
//   - one info line while manuscripts wait for an answer too long
//     (opens the Submissions tab).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-publish-data";
  var S = {
    en: { "td.rc": "Follow up the review copy: {n}", "td.subs": "Manuscripts waiting for an answer: {n}" },
    el: { "td.rc": "Υπενθύμιση για αντίτυπο κριτικής: {n}", "td.subs": "Χειρόγραφα που περιμένουν απάντηση: {n}" }
  };
  function tr(lang, k, p) {
    // A pack language: English + the publish pack, when one is loaded.
    if (lang && !S[lang] && root.orosI18n) root.orosI18n.table(S, "publish", lang);
    var s = (S[lang] || S.en)[k] || S.en[k];
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }

  var PROVIDER = {
    id: "publish",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosPublishCore, F = root.OrosPublishFeed, raw = ctx.readJSON(KEY);
      if (!C || !F || !raw || typeof raw !== "object") return [];
      var data = C.normalize(raw), out = [], last = ctx.addDays(ctx.today, ctx.horizon);
      var names = {};
      (data.titles || []).forEach(function (t) { names[t.id] = t.t; });
      var days = F.byDay(data);
      Object.keys(days).sort().forEach(function (day) {
        if (day > last) return;
        days[day].forEach(function (r) {
          if (r.k === "rel") {
            if (day < ctx.today) return;            // a release is an event of its day
            out.push({ id: "rel-" + r.title, due: day, title: F.label(r, ctx.lang), kind: "event", target: { title: r.title } });
          } else if (r.post) {
            out.push({ id: "post-" + r.post, due: day, time: r.n || null, title: F.label(r, ctx.lang),
                       text: names[r.title] || "", kind: "task", target: { post: r.post } });
          } else {
            out.push({ id: "step-" + r.step, due: day, title: F.label(r, ctx.lang), kind: "task", target: { title: r.title } });
          }
        });
      });
      C.rcDue(data, ctx.today).forEach(function (x) {
        out.push({ id: "rc-" + x.rc.id, due: null, title: tr(ctx.lang, "td.rc", { n: x.rc.n || x.rc.out }),
                   text: x.title.t, kind: "task", target: { title: x.title.id } });
      });
      var late = C.subsLate(data, ctx.today, (data.set && data.set.subDays) || 90);
      if (late.length) out.push({ id: "subs", due: null, title: tr(ctx.lang, "td.subs", { n: late.length }), kind: "info", target: { view: "subs" } });
      return out;
    }
    // no open(): Today falls back to __orosOpenAt("publish", target)
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
