// ============================================================
// orOS Text Tools — worker (v1.1.0)
// Runs a chain of steps off the main thread, so a big text or a
// pattern that never ends cannot freeze the app: the page stops this
// worker after a time limit and starts a fresh one.
//   in:  { id, text, steps, ctx: { other? } }     out: { id, ok, text, notes } | { id, ok: false }
// ============================================================
/* global importScripts, self */
importScripts("core.js");

self.onmessage = function (e) {
  var m = e.data || {};
  try {
    var r = self.TextToolsCore.run(m.text, m.steps, m.ctx && typeof m.ctx.other === "string" ? { other: m.ctx.other } : {});
    self.postMessage({ id: m.id, ok: true, text: r.text, notes: r.notes });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false });
  }
};
