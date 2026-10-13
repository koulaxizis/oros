// ============================================================
// orOS Maps — heat-worker.js (personal heatmap, wave 4, v1.0.0)
// Parses GPX files and draws the heatmap off the main thread, so a
// phone with years of tracks stays smooth. Logic: heat-core.js.
//   in:  { op: "add", id, text, start }      a GPX file's text
//        { op: "addPrev", id, prev, start }  index preview line (file not here yet)
//        { op: "remove", id }
//        { op: "render", seq, ids, view }    → { op: "render", seq, gw, gh, cell, rgba, max, drawn }
//        { op: "ground", seq, ids }          → { op: "ground", seq, months, total, squares }
//   out: { op: "added", id, ok }
// ============================================================
/* global importScripts, self */
importScripts("tracks-core.js", "heat-core.js");

var T = self.OrosMapsTracks, HC = self.OrosMapsHeat;
var engine = new HC.Engine();
function simp(s) { return T.simplifySeg(s, 3); }
function prevSegs(prev) {
  var pts = T.decode(prev || ""), segs = [], cur = [];
  pts.forEach(function (p, i) {
    if (i && T.distM(pts[i - 1][0], pts[i - 1][1], p[0], p[1]) > 2000) { if (cur.length) segs.push(cur); cur = []; }
    cur.push([p[0], p[1], null, null]);
  });
  if (cur.length) segs.push(cur);
  return { segs: segs };
}

self.onmessage = function (e) {
  var m = e.data || {};
  try {
    if (m.op === "add") {
      var tr = T.parseAny(String(m.text || ""), "x.gpx");
      if (tr && tr.segs.length) engine.add(m.id, HC.pack(tr, simp), m.start);
      self.postMessage({ op: "added", id: m.id, ok: !!(tr && tr.segs.length) });
    } else if (m.op === "addPrev") {
      engine.add(m.id, HC.pack(prevSegs(m.prev), null), m.start);
      self.postMessage({ op: "added", id: m.id, ok: true });
    } else if (m.op === "remove") {
      engine.remove(m.id);
    } else if (m.op === "render") {
      var r = engine.render(m.ids, m.view);
      self.postMessage({ op: "render", seq: m.seq, gw: r.gw, gh: r.gh, cell: r.cell, rgba: r.rgba, max: r.max, drawn: r.drawn }, [r.rgba.buffer]);
    } else if (m.op === "ground") {
      var g = engine.newGround(m.ids);
      self.postMessage({ op: "ground", seq: m.seq, months: g.months, total: g.total, squares: g.squares });
    }
  } catch (err) {
    self.postMessage({ op: m.op === "add" || m.op === "addPrev" ? "added" : m.op, seq: m.seq, id: m.id, ok: false, error: true });
  }
};
