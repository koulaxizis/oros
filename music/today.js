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
  // Shares the "music" pack with music.js (same key = same English).
  var TXT = {
    en: { "today.recap": "Your {y} in music is ready", "today.recapText": "{n} plays, your top songs and artists", "today.daily": "Your Daily mix is ready", "today.dailyText": "Songs you love and more, new every day" },
    el: { "today.recap": "Το {y} σου στη μουσική είναι έτοιμο", "today.recapText": "{n} αναπαραγωγές, τα κορυφαία τραγούδια και οι καλλιτέχνες σου", "today.daily": "Η Μίξη της ημέρας είναι έτοιμη", "today.dailyText": "Τραγούδια που αγαπάς και άλλα, καινούρια κάθε μέρα" }
  };
  // orosI18n (../i18n.js, in the shell): the full language code, a pack
  // language included; the music pack is fetched by music/host.js.
  function langOf(ctx) {
    var I = root && root.orosI18n;
    if (I && ctx.lang !== "el") { try { return I.lang(); } catch (e) {} }
    return ctx.lang === "el" ? "el" : "en";
  }
  function words(l) {
    if (l === "en" || l === "el") return TXT[l];
    // rebuilt each time: the pack may come in after the first call
    var I = root && root.orosI18n;
    return I ? I.table(TXT, "music", l) : TXT.en;
  }
  function plays(st, y) { var Y = st && st.y && st.y[String(y)]; return Y && typeof Y.n === "number" && Y.n > 0 ? Y.n : 0; }

  var PROVIDER = {
    id: "music",
    keys: [KEY],
    collect: function (ctx) {
      var st = ctx.readJSON(KEY);
      if (!st || typeof st !== "object") return [];
      var L = words(langOf(ctx)), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ctx.today || "");
      if (!m) return [];
      var y = +m[1], mo = +m[2], d = +m[3];
      var ry = mo === 12 ? y : mo === 1 && d <= 14 ? y - 1 : 0;
      if (ry && plays(st, ry) >= 20) {
        return [{ id: "recap", kind: "info", title: L["today.recap"].replace("{y}", ry), text: L["today.recapText"].replace("{n}", plays(st, ry)), target: { recap: String(ry) } }];
      }
      var last = typeof st.last === "number" ? st.last : 0, now = typeof ctx.now === "number" ? ctx.now : Date.now();
      if (last && now - last < 14 * DAY && plays(st, y) + plays(st, y - 1) >= 10) {
        return [{ id: "daily", kind: "info", title: L["today.daily"], text: L["today.dailyText"], target: { mix: "daily" } }];
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
