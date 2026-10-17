// ============================================================
// orOS Music — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads the listening stats "oros-music-stats" (written by
// music/host.js once per counted play), never writes. One top line:
// in December and the first two weeks of January "Your <year> in
// music" (the recap), otherwise "Daily mix" when music was played in
// the last two weeks. Nothing in Music is due, so it never makes a
// day busy. Opens Music at { recap: "YYYY" } or { mix: "daily" }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-music-stats", DAY = 86400000;
  var TXT = {
    en: { recap: "Your {y} in music is ready", recapText: "{n} plays, your top songs and artists", daily: "Your Daily mix is ready", dailyText: "Songs you love and more, new every day" },
    el: { recap: "Το {y} σου στη μουσική είναι έτοιμο", recapText: "{n} αναπαραγωγές, τα κορυφαία τραγούδια και οι καλλιτέχνες σου", daily: "Η Μίξη της ημέρας είναι έτοιμη", dailyText: "Τραγούδια που αγαπάς και άλλα, καινούρια κάθε μέρα" }
  };
  function plays(st, y) { var Y = st && st.y && st.y[String(y)]; return Y && typeof Y.n === "number" && Y.n > 0 ? Y.n : 0; }

  var PROVIDER = {
    id: "music",
    keys: [KEY],
    collect: function (ctx) {
      var st = ctx.readJSON(KEY);
      if (!st || typeof st !== "object") return [];
      var L = TXT[ctx.lang === "el" ? "el" : "en"], m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ctx.today || "");
      if (!m) return [];
      var y = +m[1], mo = +m[2], d = +m[3];
      var ry = mo === 12 ? y : mo === 1 && d <= 14 ? y - 1 : 0;
      if (ry && plays(st, ry) >= 20) {
        return [{ id: "recap", kind: "info", title: L.recap.replace("{y}", ry), text: L.recapText.replace("{n}", plays(st, ry)), target: { recap: String(ry) } }];
      }
      var last = typeof st.last === "number" ? st.last : 0, now = typeof ctx.now === "number" ? ctx.now : Date.now();
      if (last && now - last < 14 * DAY && plays(st, y) + plays(st, y - 1) >= 10) {
        return [{ id: "daily", kind: "info", title: L.daily, text: L.dailyText, target: { mix: "daily" } }];
      }
      return [];
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
