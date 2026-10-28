// ============================================================
// orOS Layout — House style dialogs (v1.0.0, LY-HS)
// More › "House style…": in an ordinary document, learn a house style
// from earlier books (the documents picked from the list) into a new
// house style document; in a house style document, its rules sheet:
// the roles' paragraph styles, the rules (from the works, the Greek
// set, your own) turned on or off, and your own rules added in plain
// words, optionally with what they set. The learning and the rules are
// in layout/house.js (LY_HOUSE).
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, t = LY.t, el = LY.el;
  var H = window.LY_HOUSE;
  var MAX_OWN = 400;
  // what an own rule may set: [id, role, set]
  var OWN_ACTS = [
    ["", "", null],
    ["titlePage", "title", { brk: "page" }],
    ["titleOdd", "title", { brk: "odd" }],
    ["kwn", "title", { kwn: 1 }],
    ["firstFlush", "first", { fi: 0 }],
    ["hyphOff", "body", { hyph: 0 }]
  ];

  function roleNames() {
    var n = {};
    H.ROLES.forEach(function (r) { n[r] = t("hs.role." + r); });
    return n;
  }
  function ruleText(r) {
    if (r.t) return r.t;
    var p = {};
    Object.keys(r.p || {}).forEach(function (k) { p[k] = LY.BASE === "el" && typeof r.p[k] === "number" ? String(r.p[k]).replace(".", ",") : r.p[k]; });
    return t("hr." + r.code, p);
  }

  function open() {
    if (!LY.doc) return;
    if (H.houseOf(LY.doc)) sheetDlg();
    else learnDlg();
  }

  // ---------- Learn ----------
  function learnDlg() {
    var docs = LY.data().docs.filter(function (d) { return !H.houseOf(d) && !M.needsNewer(d); });
    var pick = {};
    if (LY.doc && !H.houseOf(LY.doc)) pick[LY.doc.id] = 1;
    LY.openDialog(t("hs.learn"), function (body, close) {
      body.appendChild(el("p", "hint", t("hs.learnHint")));
      var name = el("input", "inp");
      name.type = "text"; name.maxLength = 120; name.value = t("hs.defName");
      body.appendChild(LY.ui.field(t("hs.name"), name));
      var list = el("div", "hs-works");
      docs.forEach(function (d) {
        list.appendChild(LY.ui.check(LY.docTitle(d) + " · " + t(d.pages.length === 1 ? "home.pages1" : "home.pages", { n: d.pages.length }), pick[d.id], function (v) {
          if (v) pick[d.id] = 1; else delete pick[d.id];
          go.disabled = !Object.keys(pick).length;
        }));
      });
      body.appendChild(list);
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.cancel"), close));
      var go = LY.ui.btn(t("hs.go"), function () {
        var works = docs.filter(function (d) { return pick[d.id]; });
        close();
        learn(works, name.value.trim() || t("hs.defName"));
      }, "primary");
      go.disabled = !Object.keys(pick).length;
      act.appendChild(go);
      body.appendChild(act);
    });
  }
  function learn(works, name) {
    LY.flushStory && LY.flushStory();
    var res = null;
    try { res = H.learn(works, { now: LY.now(), name: name, names: roleNames() }); } catch (e) { res = null; }
    if (!res) { LY.toast(t("hs.none")); return; }
    LY.addDoc(res.doc);
    reportDlg(res.report);
  }
  function reportDlg(rep) {
    var h = H.houseOf(LY.doc);
    LY.openDialog(t("hs.done"), function (body, close) {
      var p = function (txt, cls) { body.appendChild(el("p", cls || "", txt)); };
      p(t("hs.repWorks", { n: rep.works }));
      p(t("hs.repPages", { f: rep.front, b: rep.back }));
      var ro = h.roles, names = [];
      H.ROLES.forEach(function (r) {
        var s = ro[r] && M.find(LY.doc.pstyles, ro[r]);
        if (s) names.push(t("hs.role." + r) + ": " + LY.label(s.name));
      });
      p(t("hs.repRoles", { list: names.join(" · ") }));
      p(t("hs.repRules", { n: h.rules.filter(function (r) { return r.src === "works"; }).length }), "hint");
      if (rep.skipped) p(t("hs.repSkipped", { n: rep.skipped }), "hint");
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.ok"), close));
      act.appendChild(LY.ui.btn(t("hs.sheet"), function () { close(); sheetDlg(); }, "primary"));
      body.appendChild(act);
    });
  }

  // ---------- The rules sheet ----------
  function sheetDlg() {
    var doc = LY.doc, h = JSON.parse(JSON.stringify(H.houseOf(doc))), gone = [];
    var opts = [["", t("hs.noStyle")]].concat(doc.pstyles.map(function (s) { return [s.id, LY.label(s.name) || s.id]; }));
    LY.openDialog(t("hs.sheet"), function (body, close) {
      body.appendChild(el("p", "hint", t("hs.sheetHint", { n: h.from })));
      body.appendChild(el("h3", "pn-h", t("hs.roles")));
      H.ROLES.forEach(function (r) {
        body.appendChild(LY.ui.field(t("hs.role." + r), LY.ui.select(opts, h.roles[r] || "", function (v) {
          if (v) h.roles[r] = v; else delete h.roles[r];
        })));
      });
      var list = el("div", "hs-rules");
      function draw() {
        list.innerHTML = "";
        ["works", "greek", "own"].forEach(function (src) {
          var rs = h.rules.filter(function (r) { return r.src === src; });
          if (!rs.length) return;
          list.appendChild(el("h3", "pn-h", t("hs.src." + src)));
          rs.forEach(function (r) {
            var row = el("div", "hs-rule");
            if (r.a && r.a.k === "info") row.appendChild(el("p", "hint", ruleText(r)));
            else row.appendChild(LY.ui.check(ruleText(r), r.on, function (v) { r.on = v ? 1 : 0; }));
            if (src === "own") {
              var del = LY.ui.btn(t("hs.del"), function () {
                h.rules = h.rules.filter(function (x) { return x !== r; });
                r.on = 0;
                gone.push(r);
                draw();
              });
              row.appendChild(del);
            }
            list.appendChild(row);
          });
        });
      }
      draw();
      body.appendChild(list);
      // an own rule, in plain words
      body.appendChild(el("h3", "pn-h", t("hs.add")));
      var txt = el("input", "inp");
      txt.type = "text"; txt.maxLength = MAX_OWN; txt.placeholder = t("hs.addPh");
      body.appendChild(txt);
      var actSel = OWN_ACTS[0][0];
      body.appendChild(LY.ui.field(t("hs.addDoes"), LY.ui.select(OWN_ACTS.map(function (a) { return [a[0], t("hs.does." + (a[0] || "none"))]; }), "", function (v) { actSel = v; })));
      body.appendChild(LY.ui.btn(t("hs.addBtn"), function () {
        var words = txt.value.trim();
        if (!words) return;
        var a = OWN_ACTS.filter(function (x) { return x[0] === actSel; })[0];
        var n = 1;
        h.rules.forEach(function (r) { var k = parseInt(String(r.id).slice(1), 10); if (k >= n) n = k + 1; });
        h.rules.push({ id: "r" + n, src: "own", on: 1, t: words.slice(0, MAX_OWN), a: a && a[2] ? { k: "style", role: a[1], set: a[2] } : { k: "check" } });
        txt.value = "";
        draw();
      }));
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.cancel"), close));
      act.appendChild(LY.ui.btn(t("hs.save"), function () {
        close();
        save(h, gone);
      }, "primary"));
      body.appendChild(act);
    }, true);
  }
  // gone: own rules deleted in the sheet, applied once as off so their
  // settings come back out of the styles
  function save(h, gone) {
    var n = 0;
    LY.op(function (doc, now) {
      var before = JSON.stringify(doc.setup.ext.house);
      doc.setup.ext.house = { v: h.v, from: h.from, roles: h.roles, rules: h.rules.concat(gone) };
      n = H.apply(doc, now);
      doc.setup.ext.house = h;
      doc.setup.ext.wmap = H.wmapOf(h.roles);
      if (JSON.stringify(h) === before && !n) return false;
      doc.m = now;
    });
    LY.toast(t("hs.saved", { n: n }));
  }

  LY.house = { open: open };
})();
