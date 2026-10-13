// ============================================================
// orOS Connected services — email marketing (links/mail.js, pure)
// MailerLite, Mailchimp and Brevo ↔ a Newsletter list (integrations
// wave 3). No DOM, no storage, no network: Newsletter calls these to
// build the requests it hands to parent.orosLinks.call and to read the
// answers; tests/linksmail.test.js drives them in node.
//
//   groupsReq(p, page)            → request listing the platform's
//                                   groups / audiences / lists
//   readGroups(p, data, page)     → { items: [{ id, name, n }], next }
//   membersReq(p, grp, part, at)  → request for one page of members
//                                   (part: one of PARTS[p]; at: the
//                                   cursor or offset, "" / 0 first)
//   readMembers(p, grp, part, data, at)
//                                 → { people: [{ email, name, lang, st }], next }
//                                   st: "on" | "off" | "bounce" | "spam"
//   plan(local, remote, opts)     → what a sync changes (see below)
//   pushReqs(p, grp, people)      → requests adding new subscribers
//   unsubReqs(p, grp, emails)     → requests unsubscribing addresses
//
// The rules a sync keeps, whatever is asked:
//   - someone who left on either side is never brought back on the
//     other: an unsubscribe travels both ways, a subscribe only adds
//     addresses the other side doesn't have at all
//   - Mailchimp adds with update_existing false, MailerLite never sends
//     "resubscribe": the platforms themselves refuse to re-add a person
//     who left, even if the two sides disagree
//   - only confirmed subscribers ("on") go to the platform
// ============================================================
(function (root) {
  "use strict";

  var PAGE = { mlite: 500, mchimp: 500, brevo: 500 };
  var CHUNK = { mlite: 50, mchimp: 250, brevo: 250 };      // subscribers per write request
  var UNSUB_CHUNK = { mlite: 50, mchimp: 250, brevo: 150 };
  // Which member lists a full read walks through, in this order.
  var PARTS = {
    mlite: ["active", "unsubscribed", "bounced", "junk"],
    mchimp: ["subscribed", "unsubscribed", "cleaned"],
    brevo: ["all"]
  };
  var ML_ST = { active: "on", unsubscribed: "off", bounced: "bounce", junk: "spam" };
  var MC_ST = { subscribed: "on", unsubscribed: "off", cleaned: "bounce" };
  var MC_LISTS_F = "lists.id,lists.name,lists.stats.member_count,total_items";
  var MC_MEMBERS_F = "members.email_address,members.status,members.merge_fields,members.language,total_items";
  var MAX_PEOPLE = 50000;                                  // a read stops past this many
  var EMAIL_RE = /^[^\s@<>"',;:\\\/()\[\]]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,63}$/;

  function normEmail(v) {
    if (typeof v !== "string") return "";
    v = v.trim().toLowerCase();
    return v.length <= 254 && EMAIL_RE.test(v) ? v : "";
  }
  function oneLine(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function idOk(p, id) {
    if (typeof id !== "string") return false;
    if (p === "mlite") return /^[0-9]{1,20}$/.test(id);
    if (p === "mchimp") return /^[a-z0-9]{1,20}$/.test(id);
    if (p === "brevo") return /^[0-9]{1,12}$/.test(id);
    return false;
  }

  // ---------- groups ----------
  function groupsReq(p, page) {
    page = page || 0;
    if (p === "mlite") return { m: "GET", path: "/groups?limit=100&page=" + (page + 1) };
    if (p === "mchimp") return { m: "GET", path: "/lists?count=100&offset=" + page * 100 + "&fields=" + MC_LISTS_F };
    if (p === "brevo") return { m: "GET", path: "/contacts/lists?limit=50&offset=" + page * 50 };
    return null;
  }
  function readGroups(p, data, page) {
    var items = [], next = -1;
    page = page || 0;
    var add = function (id, name, n) {
      id = String(id === undefined || id === null ? "" : id);
      if (!idOk(p, id)) return;
      items.push({ id: id, name: oneLine(name, 120) || id, n: typeof n === "number" && isFinite(n) && n >= 0 ? Math.floor(n) : 0 });
    };
    if (!data || typeof data !== "object") return { items: items, next: -1 };
    if (p === "mlite") {
      arr(data.data).forEach(function (g) { if (g) add(g.id, g.name, g.active_count); });
      var meta = data.meta || {};
      if (typeof meta.last_page === "number" && page + 1 < meta.last_page) next = page + 1;
    } else if (p === "mchimp") {
      arr(data.lists).forEach(function (g) { if (g) add(g.id, g.name, g.stats && g.stats.member_count); });
      if (typeof data.total_items === "number" && (page + 1) * 100 < data.total_items) next = page + 1;
    } else if (p === "brevo") {
      arr(data.lists).forEach(function (g) { if (g) add(g.id, g.name, typeof g.uniqueSubscribers === "number" ? g.uniqueSubscribers : g.totalSubscribers); });
      if (typeof data.count === "number" && (page + 1) * 50 < data.count) next = page + 1;
    }
    if (page >= 20) next = -1;                              // ≤ 2000 groups is plenty
    return { items: items, next: next };
  }

  // ---------- members ----------
  function membersReq(p, grp, part, at) {
    if (!idOk(p, grp) || PARTS[p].indexOf(part) < 0) return null;
    var n = PAGE[p];
    if (p === "mlite") {
      var cur = typeof at === "string" && /^[A-Za-z0-9._=-]{1,600}$/.test(at) ? "&cursor=" + at : "";
      return { m: "GET", path: "/groups/" + grp + "/subscribers?filter[status]=" + part + "&limit=" + n + cur };
    }
    var off = typeof at === "number" && at > 0 ? Math.floor(at) : 0;
    if (p === "mchimp") return { m: "GET", path: "/lists/" + grp + "/members?count=" + n + "&offset=" + off + "&status=" + part + "&fields=" + MC_MEMBERS_F };
    return { m: "GET", path: "/contacts/lists/" + grp + "/contacts?limit=" + n + "&offset=" + off };
  }
  // next: the cursor / offset of the next page, or null at the end
  function readMembers(p, grp, part, data, at) {
    var people = [], next = null;
    if (!data || typeof data !== "object") return { people: people, next: null };
    var add = function (email, name, lang, st) {
      email = normEmail(email);
      if (!email || !st) return;
      people.push({ email: email, name: oneLine(name, 120), lang: lang === "el" || lang === "en" ? lang : "", st: st });
    };
    if (p === "mlite") {
      arr(data.data).forEach(function (s) {
        if (!s) return;
        var f = s.fields || {};
        add(s.email, [f.name, f.last_name].filter(function (x) { return typeof x === "string" && x; }).join(" "), "", ML_ST[s.status] || ML_ST[part]);
      });
      var c = data.meta && data.meta.next_cursor;
      next = typeof c === "string" && /^[A-Za-z0-9._=-]{1,600}$/.test(c) && c !== at ? c : null;
    } else if (p === "mchimp") {
      arr(data.members).forEach(function (s) {
        if (!s) return;
        var mf = s.merge_fields || {};
        add(s.email_address, [mf.FNAME, mf.LNAME].filter(function (x) { return typeof x === "string" && x; }).join(" "),
            typeof s.language === "string" ? s.language.slice(0, 2) : "", MC_ST[s.status]);
      });
      var o = (at || 0) + PAGE.mchimp;
      next = typeof data.total_items === "number" && o < data.total_items && arr(data.members).length ? o : null;
    } else if (p === "brevo") {
      var gid = Number(grp);
      arr(data.contacts).forEach(function (s) {
        if (!s) return;
        var a = s.attributes || {};
        var left = s.emailBlacklisted === true || arr(s.listUnsubscribed).indexOf(gid) >= 0;
        add(s.email, [a.FIRSTNAME, a.LASTNAME].filter(function (x) { return typeof x === "string" && x; }).join(" "), "", left ? "off" : "on");
      });
      var ob = (at || 0) + PAGE.brevo;
      next = typeof data.count === "number" && ob < data.count && arr(data.contacts).length ? ob : null;
    }
    return { people: people, next: next };
  }

  // ---------- the plan ----------
  // local:  [{ id, email, name, lang, st }] the list's subscribers here
  //         (st = Newsletter status: on | pend | off | bounce | spam)
  // remote: [{ email, name, lang, st }] everyone readMembers found
  // opts:   { pull, push, supp(email) → true when deleted for good here }
  // → { offHere: [{ id, st }], offThere: [email], add: [people],
  //     send: [people] }
  //   offHere   left on the platform: they leave here too
  //   offThere  left here (or deleted for good here): unsubscribed there
  //   add       (pull) on the platform, not here at all
  //   send      (push) confirmed here, not on the platform at all
  var LEFT = { off: 1, bounce: 1, spam: 1 };
  function plan(local, remote, opts) {
    opts = opts || {};
    var supp = typeof opts.supp === "function" ? opts.supp : function () { return false; };
    var here = Object.create(null), there = Object.create(null);
    arr(local).forEach(function (s) { var e = normEmail(s && s.email); if (e) here[e] = s; });
    arr(remote).forEach(function (r) {
      var e = normEmail(r && r.email);
      if (!e) return;
      var cur = there[e];
      // the same address in two parts: "left" wins over "on"
      if (!cur || (LEFT[r.st] && !LEFT[cur.st])) there[e] = r;
    });
    var out = { offHere: [], offThere: [], add: [], send: [] };
    Object.keys(there).sort().forEach(function (e) {
      var r = there[e], s = here[e];
      if (LEFT[r.st]) {
        if (s && (s.st === "on" || s.st === "pend")) out.offHere.push({ id: s.id, st: r.st });
        return;
      }
      if (r.st !== "on") return;
      if (supp(e) || (s && LEFT[s.st])) { out.offThere.push(e); return; }
      if (!s && opts.pull) out.add.push({ email: e, name: r.name || "", lang: r.lang || "", tags: [] });
    });
    if (opts.push) {
      Object.keys(here).sort().forEach(function (e) {
        var s = here[e];
        if (s.st === "on" && !there[e] && !supp(e)) out.send.push({ email: e, name: oneLine(s.name, 120), lang: s.lang === "el" || s.lang === "en" ? s.lang : "" });
      });
    }
    return out;
  }

  // ---------- writes ----------
  function chunks(list, n) {
    var out = [];
    for (var i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
  }
  function pushReqs(p, grp, people) {
    if (!idOk(p, grp)) return [];
    var ok = arr(people).filter(function (x) { return x && normEmail(x.email); });
    return chunks(ok, CHUNK[p]).map(function (part) {
      if (p === "mlite") {
        return { m: "POST", path: "/batch", body: { requests: part.map(function (x) {
          var b = { email: normEmail(x.email), groups: [grp] };
          if (x.name) b.fields = { name: oneLine(x.name, 120) };
          return { method: "POST", path: "api/subscribers", body: b };
        }) } };
      }
      if (p === "mchimp") {
        return { m: "POST", path: "/lists/" + grp, body: { members: part.map(function (x) {
          var b = { email_address: normEmail(x.email), status: "subscribed" };
          if (x.name) b.merge_fields = { FNAME: oneLine(x.name, 120) };
          if (x.lang) b.language = x.lang;
          return b;
        }), update_existing: false } };
      }
      return { m: "POST", path: "/contacts/import", body: { jsonBody: part.map(function (x) {
        var b = { email: normEmail(x.email) };
        if (x.name) b.attributes = { FIRSTNAME: oneLine(x.name, 120) };
        return b;
      }), listIds: [Number(grp)], updateExistingContacts: false, emptyContactsAttributes: false } };
    });
  }
  function unsubReqs(p, grp, emails) {
    if (!idOk(p, grp)) return [];
    var ok = arr(emails).map(normEmail).filter(Boolean);
    return chunks(ok, UNSUB_CHUNK[p]).map(function (part) {
      if (p === "mlite") {
        return { m: "POST", path: "/batch", body: { requests: part.map(function (e) {
          return { method: "POST", path: "api/subscribers", body: { email: e, status: "unsubscribed" } };
        }) } };
      }
      if (p === "mchimp") {
        return { m: "POST", path: "/lists/" + grp, body: { members: part.map(function (e) {
          return { email_address: e, status: "unsubscribed" };
        }), update_existing: true } };
      }
      return { m: "POST", path: "/contacts/lists/" + grp + "/contacts/remove", body: { emails: part } };
    });
  }
  // How many of a write answer's addresses the platform took (best effort)
  // → { ok, failed }
  function readWrite(p, n, res) {
    if (!res || res.err || !res.status) return { ok: 0, failed: n };
    if (res.status < 200 || res.status >= 300) return { ok: 0, failed: n };
    var d = res.data || {};
    if (p === "mlite" && typeof d.failed === "number") return { ok: Math.max(0, n - d.failed), failed: Math.min(n, d.failed) };
    if (p === "mchimp" && Array.isArray(d.errors)) {
      // "already a member" is no failure: they are there
      var bad = d.errors.filter(function (x) { return !(x && /already a list member/i.test(String(x.error || ""))); }).length;
      return { ok: Math.max(0, n - bad), failed: Math.min(n, bad) };
    }
    return { ok: n, failed: 0 };
  }

  var api = {
    PARTS: PARTS, PAGE: PAGE, CHUNK: CHUNK, MAX_PEOPLE: MAX_PEOPLE,
    PLATFORMS: ["mlite", "mchimp", "brevo"],
    idOk: idOk, normEmail: normEmail,
    groupsReq: groupsReq, readGroups: readGroups, membersReq: membersReq, readMembers: readMembers,
    plan: plan, pushReqs: pushReqs, unsubReqs: unsubReqs, readWrite: readWrite
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksMail = api;
})(typeof window !== "undefined" ? window : this);
