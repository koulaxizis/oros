// orOS Pad — runs a regular expression away from the page (wave D2).
// pad/devui.js posts { id, pattern, flags, text, replace } and stops
// this worker when it takes longer than a second, so a pattern that
// never ends cannot freeze Pad. It only reads what it is sent.
importScripts("devtools.js");
self.onmessage = function (e) {
  var d = e.data || {};
  var r = self.PadDev.regexRun(d.pattern, d.flags, d.text, d.replace, 10000);
  r.id = d.id;
  self.postMessage(r);
};
