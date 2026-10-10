// ============================================================
// orOS Chore Wheel — core.js (shared logic, v1.1.0)
// One file holds who-does-what, so the app, the shell's daily
// reminder and the Calendar feed can never disagree:
//   - the Chore Wheel app (chores/index.html)
//   - the shell (index.html → choresCheckTick, works while the app
//     is closed)
//   - the Calendar "Chores" feed (calendar/index.html loads it too)
// Pure functions, no DOM, no network. Days are whole UTC day
// numbers ("dn") from a local calendar date, so DST never moves a
// chore.
//
// API (window.OrosChoresCore):
//   constants: DATA_VER, MAX_MEMBERS, MAX_TASKS, NAME_LEN, TASK_LEN,
//     COLORS, FREQS, MODES, SETS, SET_IDS, ID_RE, KEY_RE
//   dates: ymdToDn, dnToYmd, localDn, dow, monday, monthIdx, monthStartOf
//   occurrences: occAt(task, n), occsIn(task, from, to), prevOcc(task, n)
//   data: normText, normIcon, normYmd, normMember, normTask, mergeChores(A, B, nowMs)
//   who: orderedMembers, memberById, taskById, isAway, pool, stateOf,
//     makeCtx(data), assignee(ctx, task, occ), dayRows(ctx, n),
//     statsFor(ctx, from, to, today), streakOf(ctx, id, today)
//   shell + Calendar: readPrefs(raw) → { me, rh },
//     summary(data, n, me) → { names[], late }, feedRows(data, n, me)
// Data (synced slice "chores", key oros-chores-data): see section 3.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER    = 1;
  var MAX_MEMBERS = 12;
  var MAX_TASKS   = 40;
  var NAME_LEN    = 30;
  var TASK_LEN    = 50;
  var ICON_LEN    = 16;
  var KEEP_MONTHS = 13;      // events older than this many months are pruned
  var BAL_DAYS    = 28;      // balanced mode looks at the last 4 weeks
  var OVERDUE_DAYS = 7;      // an unfinished chore stays "late" this long
  var COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf", "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];
  var FREQS = ["d", "n", "wd", "w", "mo"];
  var MODES = ["rr", "bal", "spin"];

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // ---------- 1. Dates + occurrences ----------
  // Days are counted as whole UTC day numbers ("dn") from a local
  // calendar date, so DST never shifts a chore.
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function ymdToDn(s) {
    var m = typeof s === "string" ? YMD_RE.exec(s) : null;
    if (!m) return NaN;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN;
    return Math.round(dt.getTime() / 864e5);
  }
  function dnToYmd(n) {
    var d = new Date(n * 864e5);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function localDn(date) {
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5);
  }
  function dow(n) { return ((n + 3) % 7 + 7) % 7; }          // 0 = Monday (day 0 was a Thursday)
  function monday(n) { return n - dow(n); }
  function monthIdx(n) { var d = new Date(n * 864e5); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
  function monthStartOf(idx) { return Math.round(Date.UTC(Math.floor(idx / 12), idx % 12, 1) / 864e5); }

  // Weekdays in [s, n) that are in `days`.
  function countDays(s, n, days) {
    if (n <= s) return 0;
    var full = Math.floor((n - s) / 7), c = full * days.length;
    for (var i = s + full * 7; i < n; i++) if (days.indexOf(dow(i)) >= 0) c++;
    return c;
  }

  // The occurrence of `task` whose window holds day n, or null.
  // { a: first day, b: last day, k: index from the start, key }
  function occAt(task, n) {
    var s = ymdToDn(task.start), f = task.freq, a, b, k;
    if (isNaN(s)) return null;
    if (f.k === "d") {
      if (n < s) return null;
      a = n; b = n; k = n - s;
    } else if (f.k === "n") {
      if (n < s) return null;
      k = Math.floor((n - s) / f.n); a = s + k * f.n; b = a + f.n - 1;
    } else if (f.k === "wd") {
      if (n < s || f.d.indexOf(dow(n)) < 0) return null;
      a = n; b = n; k = countDays(s, n, f.d);
    } else if (f.k === "w") {
      a = monday(n);
      if (a < monday(s)) return null;
      b = a + 6; k = (a - monday(s)) / 7;
    } else if (f.k === "mo") {
      var mi = monthIdx(n), ms = monthIdx(s);
      if (mi < ms) return null;
      a = monthStartOf(mi); b = monthStartOf(mi + 1) - 1; k = mi - ms;
    } else return null;
    return { a: a, b: b, k: k, key: task.id + "|" + dnToYmd(a) };
  }
  // Occurrences that START in [from, to].
  function occsIn(task, from, to) {
    var out = [];
    for (var n = from; n <= to; n++) {
      var o = occAt(task, n);
      if (o && o.a === n) out.push(o);
    }
    return out;
  }
  // The last occurrence that ended before day n (looks back ≤ 62 days).
  function prevOcc(task, n) {
    var cur = occAt(task, n), d = cur ? cur.a - 1 : n - 1;
    for (var i = 0; i < 62; i++, d--) {
      var o = occAt(task, d);
      if (o) return o;
    }
    return null;
  }

  // ---------- 2. Data model: normalize, merge ----------
  // member = { id, m, name, color 0–7, icon, away: null | [ymd, ymd], order, om }
  //          m stamps the content, om the place in the order: moving a
  //          member on one phone never undoes an edit made on another
  // task   = { id, m, name, icon, freq: {k, n?, d?}, weight 1–3, mode, who[], start, off }
  //          off = where the chore starts on the wheel (set once at creation,
  //          so chores made together spread over the members)
  // done   = { "<taskId>|<ymd>": [state 0 undone | 1 done | 2 skipped, by, m] }
  // set    = { "<taskId>|<ymd>": [memberId | "" (back to the turn), m] }  hand-over or spin
  // data   = { ver, members[] by id, tasks[] by id, done{}, set{}, tombs{id: deletedAt} }
  var ID_RE  = /^[a-z0-9]{6,40}$/;
  var KEY_RE = /^([a-z0-9]{6,40})\|(\d{4}-\d{2}-\d{2})$/;

  function normText(s, max) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function normIcon(s) {
    return typeof s === "string" && s.length <= ICON_LEN && !/[\u0000-\u001f\u007f<>&"']/.test(s) ? s : "";
  }
  function normYmd(s) { return isNaN(ymdToDn(s)) ? null : s; }

  function normMember(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    var name = normText(x.name, NAME_LEN);
    if (!name) return null;
    var away = null;
    if (Array.isArray(x.away) && x.away.length === 2) {
      var a = normYmd(x.away[0]), b = normYmd(x.away[1]);
      if (a && b && a <= b) away = [a, b];
    }
    return {
      id: x.id, m: x.m, name: name,
      color: isInt(x.color) && x.color >= 0 && x.color < COLORS.length ? x.color : 0,
      icon: normIcon(x.icon),
      away: away,
      order: isInt(x.order) && x.order >= 0 && x.order <= 9999 ? x.order : 0,
      om: isInt(x.om) && x.om >= 0 ? x.om : 0
    };
  }

  function normFreq(f) {
    if (!f || typeof f !== "object" || FREQS.indexOf(f.k) < 0) return null;
    if (f.k === "n") return isInt(f.n) && f.n >= 2 && f.n <= 30 ? { k: "n", n: f.n } : null;
    if (f.k === "wd") {
      var d = [];
      (Array.isArray(f.d) ? f.d : []).forEach(function (v) {
        if (isInt(v) && v >= 0 && v <= 6 && d.indexOf(v) < 0) d.push(v);
      });
      d.sort(function (a, b) { return a - b; });
      return d.length ? { k: "wd", d: d } : null;
    }
    return { k: f.k };
  }

  function normTask(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    var name = normText(x.name, TASK_LEN), freq = normFreq(x.freq), start = normYmd(x.start);
    if (!name || !freq || !start) return null;
    var who = [];
    (Array.isArray(x.who) ? x.who : []).forEach(function (id) {
      if (typeof id === "string" && ID_RE.test(id) && who.indexOf(id) < 0) who.push(id);
    });
    who.sort(cmpStr);
    return {
      id: x.id, m: x.m, name: name, icon: normIcon(x.icon), freq: freq,
      weight: isInt(x.weight) && x.weight >= 1 && x.weight <= 3 ? x.weight : 1,
      mode: MODES.indexOf(x.mode) >= 0 ? x.mode : "rr",
      who: who.slice(0, MAX_MEMBERS), start: start,
      off: isInt(x.off) && x.off >= 0 && x.off <= 999 ? x.off : 0
    };
  }

  function normDone(v) {
    if (!Array.isArray(v) || v.length !== 3) return null;
    var st = v[0], by = v[1], m = v[2];
    if (!isInt(st) || st < 0 || st > 2 || typeof by !== "string" || (by && !ID_RE.test(by)) ||
        !isInt(m) || m < 0) return null;
    if (st === 1 && !by) return null;
    return [st, by, m];
  }
  function normSet(v) {
    if (!Array.isArray(v) || v.length !== 2) return null;
    if (typeof v[0] !== "string" || (v[0] && !ID_RE.test(v[0])) || !isInt(v[1]) || v[1] < 0) return null;
    return [v[0], v[1]];
  }

  // Events whose day is before this are dropped (whole months, so all
  // devices agree on the cut for a whole month).
  function pruneBeforeYmd(nowMs) {
    var d = new Date(nowMs);
    var idx = d.getFullYear() * 12 + d.getMonth() - KEEP_MONTHS;
    return dnToYmd(monthStartOf(idx));
  }

  function newer(x, y, mi) {           // LWW: higher stamp, equal stamp → larger canonical JSON
    if (!y) return true;
    if (x[mi] !== y[mi]) return x[mi] > y[mi];
    return JSON.stringify(x) > JSON.stringify(y);
  }

  // Symmetric and canonical (R5, R26): entities LWW by m (equal m:
  // larger canonical JSON), tombstones max-merged, delete wins ties,
  // a newer edit resurrects (R17); events LWW per key.
  function mergeChores(A, B, nowMs) {
    var a = A || {}, b = B || {};
    var cut = pruneBeforeYmd(isInt(nowMs) ? nowMs : Date.now());
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    function ents(field, norm, join) {
      var best = {};
      [a[field], b[field]].forEach(function (list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (raw) {
          var x = norm(raw);
          if (!x) return;
          best[x.id] = best[x.id] ? join(best[x.id], x) : x;
        });
      });
      var out = [];
      Object.keys(best).sort(cmpStr).forEach(function (id) {
        var x = best[id];
        if (id in tombs && tombs[id] >= Math.max(x.m, x.om || 0)) return;
        out.push(x);
      });
      return out;
    }
    function lww(x, y) {
      return y.m > x.m || (y.m === x.m && JSON.stringify(y) > JSON.stringify(x)) ? y : x;
    }
    // members: content by m, order by om (each side its own LWW)
    function joinMember(x, y) {
      var c = lww(contentOf(x), contentOf(y));
      var o = (y.om > x.om || (y.om === x.om && y.order > x.order)) ? y : x;
      return { id: x.id, m: c.m, name: c.name, color: c.color, icon: c.icon, away: c.away, order: o.order, om: o.om };
    }
    function contentOf(x) { return { id: x.id, m: x.m, name: x.name, color: x.color, icon: x.icon, away: x.away }; }
    function events(field, norm, mi) {
      var best = {};
      [a[field], b[field]].forEach(function (map) {
        if (!map || typeof map !== "object" || Array.isArray(map)) return;
        Object.keys(map).forEach(function (k) {
          var km = KEY_RE.exec(k);
          if (!km || isNaN(ymdToDn(km[2])) || km[2] < cut) return;
          var v = norm(map[k]);
          if (v && newer(v, best[k], mi)) best[k] = v;
        });
      });
      var out = {};
      Object.keys(best).sort(cmpStr).forEach(function (k) { out[k] = best[k]; });
      return out;
    }
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return {
      ver: DATA_VER,
      members: ents("members", normMember, joinMember),
      tasks: ents("tasks", normTask, lww),
      done: events("done", normDone, 2),
      set: events("set", normSet, 1),
      tombs: sortedTombs
    };
  }

  // Ready sets: templates, copied into plain chores when applied.
  var SET_IDS = ["kitchen", "clean", "pet", "home"];
  var SETS = {
    kitchen: [
      { icon: "🍽️", en: "Dishes", el: "Πιάτα", freq: { k: "d" }, weight: 1 },
      { icon: "🧽", en: "Wipe the counters", el: "Πάγκοι και τραπέζι", freq: { k: "d" }, weight: 1 },
      { icon: "🗑️", en: "Take out the trash", el: "Σκουπίδια", freq: { k: "n", n: 2 }, weight: 1 },
      { icon: "🧊", en: "Clean the fridge", el: "Καθάρισμα ψυγείου", freq: { k: "mo" }, weight: 2 }
    ],
    clean: [
      { icon: "🧹", en: "Vacuum", el: "Σκούπα", freq: { k: "w" }, weight: 2 },
      { icon: "🪣", en: "Mop the floors", el: "Σφουγγάρισμα", freq: { k: "w" }, weight: 2 },
      { icon: "🛁", en: "Bathroom", el: "Μπάνιο", freq: { k: "w" }, weight: 3 },
      { icon: "🪶", en: "Dusting", el: "Ξεσκόνισμα", freq: { k: "w" }, weight: 1 },
      { icon: "🛏️", en: "Change the sheets", el: "Αλλαγή σεντονιών", freq: { k: "w" }, weight: 2 },
      { icon: "🧺", en: "Laundry", el: "Πλυντήριο ρούχων", freq: { k: "wd", d: [0, 3] }, weight: 2 }
    ],
    pet: [
      { icon: "🐾", en: "Feed the pet", el: "Φαγητό στο κατοικίδιο", freq: { k: "d" }, weight: 1 },
      { icon: "🦮", en: "Walk the dog", el: "Βόλτα τον σκύλο", freq: { k: "d" }, weight: 2 },
      { icon: "🧹", en: "Clean the litter or cage", el: "Άμμος ή κλουβί", freq: { k: "n", n: 3 }, weight: 2 }
    ],
    home: [
      { icon: "🛒", en: "Groceries", el: "Ψώνια", freq: { k: "w" }, weight: 2 },
      { icon: "🪴", en: "Water the plants", el: "Πότισμα", freq: { k: "n", n: 3 }, weight: 1 },
      { icon: "♻️", en: "Recycling", el: "Ανακύκλωση", freq: { k: "w" }, weight: 1 },
      { icon: "🪟", en: "Windows", el: "Τζάμια", freq: { k: "mo" }, weight: 3 }
    ]
  };

  // ---------- 3. Assignment + stats ----------
  function orderedMembers(st) {
    return st.members.slice().sort(function (x, y) { return x.order - y.order || cmpStr(x.id, y.id); });
  }
  function memberById(st, id) {
    for (var i = 0; i < st.members.length; i++) if (st.members[i].id === id) return st.members[i];
    return null;
  }
  function taskById(st, id) {
    for (var i = 0; i < st.tasks.length; i++) if (st.tasks[i].id === id) return st.tasks[i];
    return null;
  }
  function isAway(mb, n) {
    return !!mb.away && n >= ymdToDn(mb.away[0]) && n <= ymdToDn(mb.away[1]);
  }
  // The members who take part, in wheel order (all when none is picked
  // or every picked one is gone).
  function pool(st, task) {
    var L = orderedMembers(st);
    if (!task.who.length) return L;
    var P = L.filter(function (mb) { return task.who.indexOf(mb.id) >= 0; });
    return P.length ? P : L;
  }
  function stateOf(st, key) { var d = st.done[key]; return d ? d[0] : 0; }

  // A context caches the balanced-mode loads for one render.
  function makeCtx(st) {
    var pts = [];
    Object.keys(st.done).forEach(function (k) {
      var d = st.done[k];
      if (d[0] !== 1) return;
      var km = KEY_RE.exec(k), tk = taskById(st, km[1]);
      pts.push({ n: ymdToDn(km[2]), by: d[1], w: tk ? tk.weight : 1 });
    });
    return { st: st, pts: pts, bal: {} };
  }

  // Who has the chore for occurrence o: a hand-over or spin result
  // first, then the mode. null = nobody yet (spin not done).
  function assignee(ctx, task, o) {
    var st = ctx.st, s = st.set[o.key];
    if (s && s[0] && memberById(st, s[0])) return s[0];
    var L = pool(st, task);
    if (!L.length) return null;
    if (task.mode === "rr") {
      var i0 = (o.k + task.off) % L.length;
      for (var j = 0; j < L.length; j++) {
        var mb = L[(i0 + j) % L.length];
        if (!isAway(mb, o.a)) return mb.id;
      }
      return L[i0].id;
    }
    if (task.mode === "bal") return balFor(ctx, o.a)[task.id] || null;
    return null;
  }

  // Balanced chores that start on day a, in id order: each goes to
  // the free member with the fewest points over the 4 weeks before a
  // (plus what this day already handed out); ties follow the turn.
  function balFor(ctx, a) {
    if (ctx.bal[a]) return ctx.bal[a];
    var st = ctx.st, load = {}, res = {};
    st.members.forEach(function (mb) { load[mb.id] = 0; });
    ctx.pts.forEach(function (p) {
      if (p.n >= a - BAL_DAYS && p.n < a && p.by in load) load[p.by] += p.w;
    });
    st.tasks.forEach(function (tk) {
      if (tk.mode !== "bal") return;
      var o = occAt(tk, a);
      if (!o || o.a !== a) return;
      var s = st.set[o.key], who = null;
      if (s && s[0] && memberById(st, s[0])) who = s[0];
      else {
        var L = pool(st, tk), free = L.filter(function (mb) { return !isAway(mb, a); });
        if (!free.length) free = L;
        var best = null, i0 = (o.k + tk.off) % free.length;
        for (var j = 0; j < free.length; j++) {
          var mb = free[(i0 + j) % free.length];
          if (best === null || load[mb.id] < load[best]) best = mb.id;
        }
        who = best;
      }
      if (who) { res[tk.id] = who; load[who] = (load[who] || 0) + tk.weight; }
    });
    ctx.bal[a] = res;
    return res;
  }

  // Rows for one day: chores whose window holds day n, plus the last
  // unfinished one of each chore if it ended ≤ 7 days ago (late).
  function dayRows(ctx, n) {
    var rows = [];
    ctx.st.tasks.forEach(function (tk) {
      var o = occAt(tk, n);
      if (o) rows.push(row(ctx, tk, o, false));
      var p = prevOcc(tk, n);
      if (p && p.b < n && p.b >= n - OVERDUE_DAYS && stateOf(ctx.st, p.key) === 0) rows.push(row(ctx, tk, p, true));
    });
    return rows;
  }
  function row(ctx, tk, o, late) {
    var d = ctx.st.done[o.key];
    return { task: tk, o: o, late: late, who: assignee(ctx, tk, o), state: d ? d[0] : 0, by: d ? d[1] : "" };
  }

  // Points, done and missed per member for days [from, to]; missed
  // counts only windows that ended before `today`.
  function statsFor(ctx, from, to, today) {
    var st = ctx.st, res = {};
    st.members.forEach(function (mb) { res[mb.id] = { pts: 0, done: 0, missed: 0 }; });
    ctx.pts.forEach(function (p) {
      if (p.n >= from && p.n <= to && res[p.by]) { res[p.by].pts += p.w; res[p.by].done++; }
    });
    var last = Math.min(to, today - 1);
    st.tasks.forEach(function (tk) {
      occsIn(tk, from, last).forEach(function (o) {
        if (o.b >= today || stateOf(st, o.key) !== 0) return;
        var who = assignee(ctx, tk, o);
        if (who && res[who]) res[who].missed++;
      });
    });
    return res;
  }

  // Days in a row, back from yesterday, on which none of the member's
  // chores was left undone; today counts once nothing due today is open.
  function streakOf(ctx, memberId, today) {
    var st = ctx.st, first = Infinity, missed = {}, todayOpen = false;
    st.tasks.forEach(function (tk) {
      var s = ymdToDn(tk.start);
      if (s < first) first = s;
      occsIn(tk, today - 400, today).forEach(function (o) {
        if (o.b > today || stateOf(st, o.key) !== 0 || assignee(ctx, tk, o) !== memberId) return;
        if (o.b < today) missed[o.b] = true;
        else todayOpen = true;
      });
    });
    if (first === Infinity || first > today) return 0;
    var n = 0;
    for (var d = today - 1; d >= Math.max(first, today - 365); d--) {
      if (missed[d]) break;
      n++;
    }
    return n + (todayOpen ? 0 : 1);
  }

  // ---------- 4. Shell reminder + Calendar feed ----------
  // Device-local prefs (oros-chores-prefs, R10): who I am here and the
  // reminder hour (0–23, -1 = off, default 9).
  function readPrefs(raw) {
    var p = raw && typeof raw === "object" ? raw : {};
    return {
      me: typeof p.me === "string" && ID_RE.test(p.me) ? p.me : "",
      rh: isInt(p.rh) && p.rh >= -1 && p.rh <= 23 ? p.rh : 9
    };
  }

  // My open chores on day n: names of today's ones + how many are late.
  function summary(data, n, me) {
    var out = { names: [], late: 0 };
    if (!me || !memberById(data, me)) return out;
    dayRows(makeCtx(data), n).forEach(function (r) {
      if (r.who !== me || r.state !== 0) return;
      if (r.late) out.late++;
      else out.names.push(r.task.name);
    });
    return out;
  }

  // Chores that START on day n (a weekly one on its Monday, a monthly
  // one on the 1st), only mine when `me` is a member here.
  function feedRows(data, n, me) {
    var ctx = makeCtx(data), mine = !!(me && memberById(data, me)), out = [];
    data.tasks.forEach(function (tk) {
      var o = occAt(tk, n);
      if (!o || o.a !== n) return;
      var who = assignee(ctx, tk, o);
      if (mine && who !== me) return;
      var mb = memberById(data, who);
      out.push({ key: o.key, task: tk, who: who, name: mb ? mb.name : "", state: stateOf(data, o.key) });
    });
    out.sort(function (x, y) { return cmpStr(x.task.name, y.task.name) || cmpStr(x.key, y.key); });
    return out;
  }

  var api = {
    DATA_VER: DATA_VER, MAX_MEMBERS: MAX_MEMBERS, MAX_TASKS: MAX_TASKS, NAME_LEN: NAME_LEN,
    TASK_LEN: TASK_LEN, COLORS: COLORS, FREQS: FREQS, MODES: MODES, SETS: SETS, SET_IDS: SET_IDS,
    ID_RE: ID_RE, KEY_RE: KEY_RE,
    cmpStr: cmpStr, isInt: isInt,
    ymdToDn: ymdToDn, dnToYmd: dnToYmd, localDn: localDn, dow: dow, monday: monday,
    monthIdx: monthIdx, monthStartOf: monthStartOf,
    occAt: occAt, occsIn: occsIn, prevOcc: prevOcc,
    normText: normText, normIcon: normIcon, normYmd: normYmd, normMember: normMember, normTask: normTask,
    mergeChores: mergeChores, pruneBeforeYmd: pruneBeforeYmd,
    orderedMembers: orderedMembers, memberById: memberById, taskById: taskById, isAway: isAway,
    pool: pool, stateOf: stateOf, makeCtx: makeCtx, assignee: assignee, dayRows: dayRows, row: row,
    statsFor: statsFor, streakOf: streakOf,
    readPrefs: readPrefs, summary: summary, feedRows: feedRows
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosChoresCore = api;
})(typeof window !== "undefined" ? window : this);
