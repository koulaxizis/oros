// ============================================================
// orOS Text Tools — worker (v1.2.0)
// Runs a chain of steps off the main thread, so a big text or a
// pattern that never ends cannot freeze the app: the page stops this
// worker after a time limit and starts a fresh one.
//   in:  { id, text, steps, ctx: { other?, words? } }     out: { id, ok, text, notes } | { id, ok: false }
// 1.2.0: the "case" group runs on the Case Converter engine
// (textcase/core.js, loaded first); words = My words (strings).
// ============================================================
/* global importScripts, self */
var ENGINES = ["../textcase/core.js", "core.js"];   // core.js last: it looks the others up
importScripts.apply(self, ENGINES);

function ctxOf(c) {
  var out = {};
  if (!c || typeof c !== "object") return out;
  if (typeof c.other === "string") out.other = c.other;
  if (Array.isArray(c.words)) out.words = c.words.filter(function (w) { return typeof w === "string"; });
  return out;
}

self.onmessage = function (e) {
  var m = e.data || {};
  try {
    var r = self.TextToolsCore.run(m.text, m.steps, ctxOf(m.ctx));
    self.postMessage({ id: m.id, ok: true, text: r.text, notes: r.notes });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false });
  }
};
