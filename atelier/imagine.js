// ============================================================
// orOS Atelier — imagine.js: Image from text (v1.0.0)
// A picture made from a description, by the image AI chosen in the
// Assistant (Settings › Pictures; assistant/imgai.js): Pollinations
// (free, the default), Hugging Face, OpenAI, Stability AI or Stable
// Diffusion WebUI / Forge on the user's own computer. Only the
// description goes to that service, straight from this device; the
// key is the Assistant's own (read, never written, by AT.ai.readKey).
// A picture is added to the page, or replaces the selected photo.
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, t = AT.t, el = AT.el, ED = AT.ed, M = AT.M, A = AT.A;
  var IA = window.OrosImageAI;
  if (!IA) return;

  var STR = {
    en: {
      "im.title": "Image from text", "im.hint": "Describe a picture and AI makes it for you.",
      "im.ph": "e.g. a cosy bakery window at sunrise with fresh bread",
      "im.style": "Style", "im.st.": "As written", "im.st.photo": "Photo", "im.st.illus": "Illustration",
      "im.st.paint": "Watercolour", "im.st.three": "3D", "im.st.sketch": "Sketch", "im.st.pixel": "Pixel art",
      "im.shape": "Shape", "im.sh.page": "Like the page", "im.sh.square": "Square", "im.sh.wide": "Landscape", "im.sh.tall": "Portrait",
      "im.count": "How many", "im.go": "Make pictures", "im.making": "Making pictures with {name}…",
      "im.sent": "Only your description goes to {name}, straight from this device.",
      "im.local": "Made on your own computer: nothing leaves your network.",
      "im.add": "Add to the page", "im.replace": "Replace the photo", "im.added": "Picture added",
      "im.using": "Pictures: {name}", "im.noKey": "{name} needs a key. Add it in the Assistant (Settings › Pictures).",
      "im.err.key": "{name} refused the key. Check it in the Assistant (Settings › Pictures).",
      "im.err.limit": "{name}: no credit left, or too many pictures for now. Try again later.",
      "im.err.net": "Couldn't reach {name}. Check the internet (or that WebUI is running).",
      "im.err.http": "{name} answered with an error: {why}", "im.err.bad": "{name} did not send a picture. Try again.",
      "im.err.unsupported": "{name} can't do this.", "im.empty": "Describe the picture first."
    },
    el: {
      "im.title": "Εικόνα από κείμενο", "im.hint": "Περιέγραψε μια εικόνα και το AI τη φτιάχνει για σένα.",
      "im.ph": "π.χ. η βιτρίνα ενός ζεστού φούρνου την αυγή με φρέσκο ψωμί",
      "im.style": "Ύφος", "im.st.": "Όπως το έγραψα", "im.st.photo": "Φωτογραφία", "im.st.illus": "Εικονογράφηση",
      "im.st.paint": "Ακουαρέλα", "im.st.three": "3D", "im.st.sketch": "Σκίτσο", "im.st.pixel": "Pixel art",
      "im.shape": "Σχήμα", "im.sh.page": "Σαν τη σελίδα", "im.sh.square": "Τετράγωνο", "im.sh.wide": "Οριζόντιο", "im.sh.tall": "Κάθετο",
      "im.count": "Πόσες", "im.go": "Φτιάξε εικόνες", "im.making": "Φτιάχνω εικόνες με το {name}…",
      "im.sent": "Μόνο η περιγραφή σου πηγαίνει στο {name}, απευθείας από αυτή τη συσκευή.",
      "im.local": "Γίνεται στον δικό σου υπολογιστή: τίποτα δεν βγαίνει από το δίκτυό σου.",
      "im.add": "Προσθήκη στη σελίδα", "im.replace": "Αντικατάσταση φωτογραφίας", "im.added": "Η εικόνα προστέθηκε",
      "im.using": "Εικόνες: {name}", "im.noKey": "Το {name} θέλει κλειδί. Πρόσθεσέ το στον Βοηθό (Ρυθμίσεις › Εικόνες).",
      "im.err.key": "Το {name} δεν δέχτηκε το κλειδί. Έλεγξέ το στον Βοηθό (Ρυθμίσεις › Εικόνες).",
      "im.err.limit": "{name}: δεν έμεινε πίστωση ή ζητήθηκαν πολλές εικόνες. Δοκίμασε αργότερα.",
      "im.err.net": "Δεν βρέθηκε το {name}. Έλεγξε τη σύνδεση (ή ότι τρέχει το WebUI).",
      "im.err.http": "Το {name} απάντησε με σφάλμα: {why}", "im.err.bad": "Το {name} δεν έστειλε εικόνα. Δοκίμασε ξανά.",
      "im.err.unsupported": "Το {name} δεν το κάνει αυτό.", "im.empty": "Περιέγραψε πρώτα την εικόνα."
    }
  };
  Object.keys(STR).forEach(function (l) {
    AT.STRINGS[l] = AT.STRINGS[l] || {};
    Object.keys(STR[l]).forEach(function (k) { AT.STRINGS[l][k] = STR[l][k]; });
  });

  // → { cf, name } (the free default when nothing is chosen)
  function choice() {
    var cf = IA.use(IA.readPref());
    return { cf: cf, name: cf.p.name };
  }
  function errText(e, name) {
    var code = e && e.code;
    if (!/^(key|limit|net|http|bad|unsupported)$/.test(code || "")) code = "http";
    var why = (e && e.status ? "HTTP " + e.status : "") + (e && e.msg ? (e.status ? " · " : "") + e.msg : "") || String(e && e.message || e).slice(0, 120);
    return t("im.err." + code, { name: name, why: why });
  }
  function sizeOf(shape) {
    var s = AT.doc ? AT.doc.setup : { w: 1, h: 1 };
    return shape === "square" ? [1, 1] : shape === "wide" ? [3, 2] : shape === "tall" ? [2, 3] : [s.w, s.h];
  }
  function photoSel() {
    var sel = ED.selItems ? ED.selItems() : [];
    return sel.length === 1 && sel[0].ax.k === "photo" && !sel[0].ax.vid ? sel[0] : null;
  }

  // Ask for n pictures: one request where the service makes several,
  // else one request each (one after the other). onPic(blob) per picture.
  function make(cf, key, opts, signal, onPic) {
    var many = cf.p.n >= opts.n, left = many ? 1 : opts.n, got = 0;
    function one() {
      var req = IA.buildGenerate(cf, key, { prompt: opts.prompt, w: opts.w, h: opts.h, n: many ? opts.n : 1 });
      return IA.run(req, signal).then(function (list) {
        list.forEach(function (b) { got++; onPic(b); });
        left--;
        return left > 0 ? one() : got;
      });
    }
    return one();
  }

  function addPicture(blob, replaceId) {
    var nm = "ai-picture." + (/png/.test(blob.type) ? "png" : /webp/.test(blob.type) ? "webp" : "jpg");
    return A.importFile(new File([blob], nm, { type: blob.type || "image/png" })).then(function (r) {
      AT.noteUpload(r.id);
      if (replaceId && ED.find(replaceId)) {
        AT.editItems([replaceId], function (it) {
          it.a = r.id; it.nm = nm; it.iw = r.w; it.ih = r.h;
          it.fit = "fill"; it.ix = 0; it.iy = 0; it.isc = 1;
          delete it.ax.cr;
        });
      } else AT.io.placePhoto({ id: r.id, w: r.w, h: r.h, name: nm });
      AT.toast(t("im.added"), t("btn.undo"), AT.undo);
    });
  }

  var draft = { prompt: "", style: "", shape: "page", n: 2 };
  function open(prompt) {
    if (typeof prompt === "string" && prompt.trim()) draft.prompt = prompt.trim();
    var ch = choice(), cf = ch.cf, ctl = null, urls = [];
    var replaceId = (photoSel() || {}).id || "";
    var dlg = AT.$("dlg");
    AT.openDialog(t("im.title"), function (body, close) {
      var ta = el("textarea", "inp ai-ta"); ta.rows = 3; ta.maxLength = IA.MAX_PROMPT; ta.placeholder = t("im.ph"); ta.value = draft.prompt;
      ta.setAttribute("aria-label", t("im.title"));
      ta.addEventListener("input", function () { draft.prompt = ta.value; });
      body.appendChild(ta);
      var row = el("div", "im-opts");
      function pick(label, ids, pre, val, set) {
        var f = el("label", "fld");
        f.appendChild(el("span", "fld-lbl", label));
        var s = el("select", "inp");
        ids.forEach(function (id) { var o = el("option", "", t(pre + id)); o.value = id; s.appendChild(o); });
        s.value = val;
        s.addEventListener("change", function () { set(s.value); });
        f.appendChild(s); row.appendChild(f);
        return s;
      }
      pick(t("im.style"), IA.STYLE_IDS, "im.st.", draft.style, function (v) { draft.style = v; });
      pick(t("im.shape"), ["page", "square", "wide", "tall"], "im.sh.", draft.shape, function (v) { draft.shape = v; });
      var cnt = el("label", "fld");
      cnt.appendChild(el("span", "fld-lbl", t("im.count")));
      var cs = el("select", "inp");
      [1, 2, 3, 4].forEach(function (n) { var o = el("option", "", String(n)); o.value = String(n); cs.appendChild(o); });
      cs.value = String(draft.n);
      cs.addEventListener("change", function () { draft.n = +cs.value; });
      cnt.appendChild(cs); row.appendChild(cnt);
      body.appendChild(row);
      body.appendChild(el("p", "hint ai-note", cf.p.local ? t("im.local") : t("im.sent", { name: ch.name })));
      var stat = el("p", "hint");
      stat.setAttribute("role", "status");
      body.appendChild(stat);
      var grid = el("div", "im-grid");
      body.appendChild(grid);
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.close")); c.type = "button";
      var go = el("button", "btn primary", t("im.go")); go.type = "button";
      c.addEventListener("click", function () { if (ctl) ctl.abort(); close(); });
      act.appendChild(c); act.appendChild(go);
      body.appendChild(act);

      function card(blob) {
        var u = URL.createObjectURL(blob);
        urls.push(u);
        var cd = el("div", "im-card");
        var img = el("img", ""); img.src = u; img.alt = draft.prompt.slice(0, 120);
        cd.appendChild(img);
        var bar = el("div", "im-bar");
        function b(label, cls, rep) {
          var x = el("button", "btn small" + (cls ? " " + cls : ""), label); x.type = "button";
          x.addEventListener("click", function () {
            x.disabled = true;
            addPicture(blob, rep ? replaceId : "").then(function () { close(); }, function (e) {
              stat.textContent = e && e.message === "nofs" ? t("img.nofs") : t("img.fail");
              x.disabled = false;
            });
          });
          bar.appendChild(x);
        }
        b(t("im.add"), "primary", false);
        if (replaceId) b(t("im.replace"), "", true);
        cd.appendChild(bar);
        grid.insertBefore(cd, grid.firstChild);
      }

      go.addEventListener("click", function () {
        var p = draft.prompt.trim();
        if (!p) { stat.textContent = t("im.empty"); ta.focus(); return; }
        go.disabled = true;
        var my = ctl = new AbortController();
        stat.textContent = t("im.making", { name: ch.name });
        var wh = sizeOf(draft.shape);
        (cf.p.keyId ? AT.ai.readKey(cf.p.keyId) : Promise.resolve("")).then(function (key) {
          if (cf.p.key === "yes" && !key) throw { code: "nokey" };
          return make(cf, key, { prompt: IA.styled(p, draft.style), w: wh[0], h: wh[1], n: draft.n }, my.signal, function (blob) {
            if (ctl === my) card(blob);
          });
        }).then(function () {
          if (ctl === my) stat.textContent = "";
        }, function (e) {
          if (ctl !== my || my.signal.aborted) return;
          stat.textContent = e && e.code === "nokey" ? t("im.noKey", { name: ch.name }) : errText(e, ch.name);
        }).then(function () { if (ctl === my) { ctl = null; go.disabled = false; } });
      });
      ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go.click(); } });
      setTimeout(function () { ta.focus(); }, 0);
    }, true);
    dlg.addEventListener("close", function () {
      if (ctl) ctl.abort();
      setTimeout(function () { urls.forEach(function (u) { URL.revokeObjectURL(u); }); }, 1000);
    }, { once: true });
  }

  // The AI tab section (called by ai.js).
  function section(host) {
    var s = el("div", "pn-sec");
    s.appendChild(el("div", "pn-h", t("im.title")));
    s.appendChild(el("p", "hint", t("im.hint")));
    var ta = el("textarea", "inp ai-ta"); ta.rows = 2; ta.maxLength = IA.MAX_PROMPT; ta.placeholder = t("im.ph"); ta.value = draft.prompt;
    ta.setAttribute("aria-label", t("im.title"));
    ta.addEventListener("input", function () { draft.prompt = ta.value; });
    s.appendChild(ta);
    var b = el("button", "btn primary block", t("im.go")); b.type = "button";
    b.addEventListener("click", function () { open(); });
    s.appendChild(b);
    s.appendChild(el("p", "hint", t("im.using", { name: choice().name })));
    host.appendChild(s);
  }

  AT.imagine = { open: open, section: section, make: make, choice: choice };
})();
