// ============================================================
// orOS Atelier — magicdesign.js: Design from a description and
// Magic animate (v1.0.0)
//   - Design from a description: "an Instagram post for a bakery
//     opening in Thessaloniki" → three ready designs. Atelier picks
//     three fitting templates (by the words: kind of design, subject);
//     the text AI chosen in the Assistant writes their words and
//     colours, like "Ideas for this page". The brand kit's colours and
//     fonts win when there are some; a matching photo from Openverse
//     can go behind the design. Tap one to open it as a new design.
//   - Magic animate: one tap gives every page entrances, durations
//     and transitions, by rules (no AI, no network): the headline
//     rises, other texts fade in, small pictures and icons pop, big
//     background shapes stay still; pages with more words show longer.
//     One undoable step.
// The rules are pure (unit-tested); the rest needs a browser.
// ============================================================
(function (root) {
  "use strict";

  // ---------- Pure: which templates fit a description ----------
  // words (folded: no accents, lower case, ς → σ) → template category
  // (English, Greek and German words: parser data, not UI text)
  var CAT_WORDS = {
    social: ["instagram", "insta", "facebook", "post", "αναρτηση", "ποστ", "social", "linkedin", "beitrag"],
    story: ["story", "stories", "reel", "tiktok", "στορι", "ιστορια"],
    video: ["youtube", "thumbnail", "μικρογραφια", "βιντεο", "video", "vorschaubild"],
    pres: ["presentation", "slides", "slide", "deck", "παρουσιαση", "διαφανειε", "prasentation", "folien"],
    poster: ["poster", "αφισα", "afisa", "plakat"],
    flyer: ["flyer", "leaflet", "φυλλαδιο", "φλαιερ", "handzettel"],
    biz: ["business card", "card", "καρτα", "επαγγελματικη", "visitenkarte"],
    invite: ["invitation", "invite", "wedding", "birthday", "baptism", "προσκληση", "γαμο", "γενεθλια", "βαφτιση", "παρτι", "party",
      "einladung", "hochzeit", "geburtstag", "taufe", "feier"],
    cv: ["cv", "resume", "βιογραφικο", "lebenslauf"],
    cert: ["certificate", "diploma", "award", "βεβαιωση", "διπλωμα", "πιστοποιητικο", "επαινο", "urkunde", "zertifikat"],
    menu: ["menu", "μενου", "καταλογο", "τιμοκαταλογο", "speisekarte", "preisliste"],
    data: ["chart", "graph", "table", "infographic", "γραφημα", "πινακα", "πινακας", "diagramm", "tabelle", "infografik"],
    brand: ["logo", "banner", "header", "λογοτυπο", "μπανερ", "σημα", "kopfzeile"]
  };
  // a platform's name → its presets (presets.js ids)
  var PLATFORM = { instagram: /^(ig-|story)/, insta: /^(ig-|story)/, facebook: /^fb-/, youtube: /^yt-/, linkedin: /^li-/ };
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ");
  }
  function wordsOf(s) { return fold(s).split(/[^a-z0-9α-ω]+/).filter(function (w) { return w.length > 1; }); }
  // → category ids the description names, most specific first
  function guessCats(desc) {
    var f = " " + fold(desc).replace(/[^a-z0-9α-ω]+/g, " ") + " ", out = [];
    Object.keys(CAT_WORDS).forEach(function (cat) {
      var hit = CAT_WORDS[cat].some(function (w) { return f.indexOf(" " + w) >= 0; });
      if (hit) out.push(cat);
    });
    // "card" alone is a business card only when nothing better fits
    if (out.length > 1 && out.indexOf("biz") >= 0 && f.indexOf(" business card") < 0 && f.indexOf(" επαγγελματικ") < 0) out.splice(out.indexOf("biz"), 1);
    return out;
  }
  // n templates for a description: the named kind first (its best
  // matches by name and tags), then the closest others; never the
  // same template twice. list: the template library.
  function pickTemplates(desc, list, n) {
    n = n || 3;
    var cats = guessCats(desc), words = wordsOf(desc);
    var scored = list.map(function (tpl, i) {
      // names and tags in every language the template has (en, el, a pack language)
      var langs = tpl.tags ? Object.keys(tpl.tags) : ["en", "el"];
      var hay = fold(langs.map(function (l) { return (tpl[l] || "") + " " + (tpl.tags ? tpl.tags[l] || "" : ""); }).concat([tpl.preset]).join(" "));
      var s = 0;
      if (cats.length && cats.indexOf(tpl.cat) >= 0) s += 10 - cats.indexOf(tpl.cat);
      // a named platform: its own sizes first
      Object.keys(PLATFORM).forEach(function (w) { if (words.indexOf(w) >= 0 && PLATFORM[w].test(tpl.preset || "")) s += 3; });
      words.forEach(function (w) { if (w.length > 2 && hay.indexOf(w) >= 0) s += 2; });
      // nothing named: everyday social posts first
      if (!cats.length && tpl.cat === "social") s += 1;
      return { tpl: tpl, s: s, i: i };
    });
    scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    var out = [], seen = {};
    // the named kind: up to n; vary them (take the best, then others)
    scored.forEach(function (x) { if (out.length < n && !seen[x.tpl.id] && x.s > 0) { seen[x.tpl.id] = 1; out.push(x.tpl); } });
    scored.forEach(function (x) { if (out.length < n && !seen[x.tpl.id]) { seen[x.tpl.id] = 1; out.push(x.tpl); } });
    return out;
  }
  // the words for a stock photo, from the AI's answer ("photo")
  function photoWords(j) {
    var p = j && typeof j.photo === "string" ? j.photo : "";
    p = p.replace(/[^\p{L}\p{N} \-]/gu, " ").replace(/\s+/g, " ").trim();
    return p.split(" ").slice(0, 5).join(" ").slice(0, 60);
  }

  // ---------- Pure: Magic animate ----------
  // doc: { setup, items }; pages: [{ id }] in order. → { an: { itemId:
  // "rise" | "fade" | "pop" | "wipe" | "" }, pages: { pageId: { dur,
  // ptr } } } ("" = no entrance)
  function animPlan(doc, pages) {
    var W = doc.setup.w, H = doc.setup.h, area = W * H;
    var land = W > H * 1.2, many = pages.length > 1;
    var out = { an: {}, pages: {} };
    pages.forEach(function (p, pi) {
      var items = (doc.items || []).filter(function (it) { return it.pg === p.id && it.ax && !it.ax.bg && !it.hide; });
      var texts = items.filter(function (it) { return it.ax.k === "text" && String(it.ax.tx || "").trim(); });
      texts.sort(function (a, b) { return (b.ax.size || 0) - (a.ax.size || 0) || a.y - b.y; });
      var head = texts.length ? texts[0].id : "";
      var words = 0;
      items.forEach(function (it) {
        var k = it.ax.k, a = it.w * it.h / area, an = "";
        if (k === "text") {
          var tx = String(it.ax.tx || "").trim();
          words += tx ? tx.split(/\s+/).length : 0;
          an = it.id === head ? "rise" : tx.length <= 16 ? "pop" : "fade";
        } else if (k === "photo") an = it.ax.vid ? "" : a >= 0.6 ? "" : "fade";
        else if (k === "icon") an = "pop";
        else if (k === "chart" || k === "table") an = "wipe";
        else if (k === "shape") an = a < 0.06 ? "pop" : "";
        out.an[it.id] = an;
      });
      out.pages[p.id] = {
        dur: Math.max(4, Math.min(12, Math.round(3 + words / 4))),
        ptr: pi === 0 ? "" : many && land ? "push" : "fade"
      };
    });
    return out;
  }

  var pure = { CAT_WORDS: CAT_WORDS, fold: fold, guessCats: guessCats, pickTemplates: pickTemplates, photoWords: photoWords, animPlan: animPlan };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }

  // ---------- Runtime ----------
  var AT = root.AT, t = AT.t, el = AT.el, A = AT.A, M = AT.M, AX = AT.AX, ED = AT.ed;
  var AIT = root.AtelierAIText, Anim = root.AtelierAnim;
  var MEDIA = root.orosDK && root.orosDK.media;

  var STR = {
    en: {
      "md.title": "Design from a description", "md.ph": "Describe what you want to make, e.g. an Instagram post for a bakery opening in Thessaloniki",
      "md.go": "Design it", "md.hint": "Three ready designs: Atelier picks fitting templates and the AI you set up in the Assistant writes the words and colours.",
      "md.brand": "Use my brand kit (colours and fonts)", "md.photo": "Add a matching photo behind it (Openverse)",
      "md.making": "Designing with {name}… ({n} of {all})", "md.open": "Open this design", "md.none": "Nothing came back. Try again or describe it differently.",
      "md.sent": "Only your description and the templates' words go to {name}, straight from this device.",
      "md.opened": "A new design was made from the description.",
      "ma.title": "Magic animate", "ma.hint": "One tap animates every page: the headline rises, texts fade in, small pictures pop, and each page shows long enough to read. No AI, nothing sent.",
      "ma.go": "Animate all pages", "ma.done": "Every page is animated. Play to see it.", "ma.clear": "Remove all animations", "ma.cleared": "Animations removed"
    },
    el: {
      "md.title": "Σχέδιο από περιγραφή", "md.ph": "Περιέγραψε τι θέλεις να φτιάξεις, π.χ. ανάρτηση Instagram για τα εγκαίνια ενός φούρνου στη Θεσσαλονίκη",
      "md.go": "Σχεδίασέ το", "md.hint": "Τρία έτοιμα σχέδια: το Ατελιέ διαλέγει κατάλληλα πρότυπα και το AI που ρύθμισες στον Βοηθό γράφει τα κείμενα και τα χρώματα.",
      "md.brand": "Με το brand kit μου (χρώματα και γραμματοσειρές)", "md.photo": "Και μια ταιριαστή φωτογραφία από πίσω (Openverse)",
      "md.making": "Σχεδιάζω με το {name}… ({n} από {all})", "md.open": "Άνοιγμα αυτού του σχεδίου", "md.none": "Δεν ήρθε τίποτα. Δοκίμασε ξανά ή περιέγραψέ το αλλιώς.",
      "md.sent": "Μόνο η περιγραφή σου και τα κείμενα των προτύπων πηγαίνουν στο {name}, απευθείας από αυτή τη συσκευή.",
      "md.opened": "Φτιάχτηκε νέο σχέδιο από την περιγραφή.",
      "ma.title": "Μαγική κίνηση", "ma.hint": "Με ένα πάτημα κινείται κάθε σελίδα: ο τίτλος αναδύεται, τα κείμενα εμφανίζονται, οι μικρές εικόνες αναπηδούν και κάθε σελίδα μένει όσο χρειάζεται για να διαβαστεί. Χωρίς AI, δεν στέλνεται τίποτα.",
      "ma.go": "Κίνηση σε όλες τις σελίδες", "ma.done": "Κάθε σελίδα έχει κίνηση. Πάτα Αναπαραγωγή να το δεις.", "ma.clear": "Αφαίρεση όλων των κινήσεων", "ma.cleared": "Οι κινήσεις αφαιρέθηκαν"
    }
  };
  // into Atelier's strings; a pack language gets its lines (core.js AT.addStrings)
  AT.addStrings(STR);

  function now() { return Date.now(); }

  // ---------- Design from a description ----------
  // The words for every text box of a design (all pages, biggest type
  // first per page, at most 12) → slots
  function slotsAll(d) {
    var out = [];
    M.pagesInOrder(d).forEach(function (p) { AIT.slotsOf(d, p.id).forEach(function (s) { if (out.length < 12) out.push(s); }); });
    return out;
  }
  function brandOf() {
    var B = AT.brand ? AT.brand.get() : null;
    if (!B) return null;
    var colors = B.colors.map(function (x) { return x.c; });
    var has = colors.length >= 2 || B.fonts.h || B.fonts.t;
    return has ? { colors: colors.length >= 2 ? colors : [], fonts: B.fonts } : null;
  }
  // one idea (texts, colours) into the design d
  function fill(d, slots, idea, brand) {
    slots.forEach(function (s, i) {
      var it = M.find(d.items, s.id);
      if (!it || it.ax.k !== "text") return;
      it.ax.tx = idea.texts[i];
      if (brand) {
        var f = brand.fonts[i === 0 ? "h" : s.role === "subheading" ? "s" : "t"] || brand.fonts.t || brand.fonts.h;
        if (f) { it.ax.font = f.f; if (f.b) it.ax.b = 1; }
      }
      var n = M.normItem(it);
      if (n) it.h = AX.textHeight(n);
    });
    var pal = brand && brand.colors.length ? brand.colors : idea.colors;
    if (pal.length >= 2) M.pagesInOrder(d).forEach(function (p) { AIT.recolor(d, p.id, pal); });
  }
  // a photo from Openverse for the words, in the asset store, once per
  // run → Promise<{ r: { id, w, h }, cr } | null> (never fails)
  function getPhoto(words) {
    if (!MEDIA || !words || !navigator.onLine) return Promise.resolve(null);
    var env = { fetch: root.fetch.bind(root), now: now, cache: { get: function () { return Promise.resolve(null); }, put: function () { return Promise.resolve(); } }, keys: AT.prefs.keys || {} };
    return MEDIA.search("openverse", "photo", words, { page: 1, restricted: false, lang: "en" }, env).then(function (res) {
      var it = res && res.items && res.items.filter(function (x) { return x.w >= 600 || !x.w; })[0];
      if (!it) return null;
      return MEDIA.fetchMedia(it, env).then(null, function () { return it.thumb ? MEDIA.fetchMedia(it, env, it.thumb) : null; }).then(function (blob) {
        if (!blob) return null;
        return A.importFile(new File([blob], (it.title || "photo").slice(0, 60) + ".jpg", { type: blob.type })).then(function (r) {
          AT.noteUpload(r.id);
          return { r: r, cr: MEDIA.normCredit(it) };
        });
      });
    }).catch(function () { return null; });
  }
  // the photo behind every page: dim (the words stay readable), just
  // above the background, with its credit
  function putPhoto(d, ph) {
    M.pagesInOrder(d).forEach(function (p) {
      var bg = AX.background(d, p.id);
      var low = d.items.filter(function (x) { return x.pg === p.id && x !== bg; }).reduce(function (m, x) { return Math.min(m, x.z); }, Infinity);
      var z = bg ? (isFinite(low) ? (bg.z + low) / 2 : bg.z + 1) : (isFinite(low) ? low - 1 : 1);
      AX.addItem(d, p.id, { k: "photo", a: ph.r.id, iw: ph.r.w, ih: ph.r.h, nm: "", x: 0, y: 0, w: d.setup.w, h: d.setup.h, fit: "fill", op: 22, cr: ph.cr, z: z }, now());
    });
  }

  var mdDraft = { text: "", brand: true, photo: true };
  function design(prompt) {
    if (typeof prompt === "string" && prompt.trim()) mdDraft.text = prompt.trim();
    AT.ai.need(function (cf) {
      var dlg = AT.$("dlg"), ctl = null, made = [];
      var brand0 = brandOf();
      AT.openDialog(t("md.title"), function (body, close) {
        var ta = el("textarea", "inp ai-ta"); ta.rows = 3; ta.maxLength = 1000; ta.placeholder = t("md.ph"); ta.value = mdDraft.text;
        ta.setAttribute("aria-label", t("md.title"));
        ta.addEventListener("input", function () { mdDraft.text = ta.value; });
        body.appendChild(ta);
        body.appendChild(el("p", "hint", t("md.hint")));
        function check(label, key, show) {
          if (!show) return;
          var l = el("label", "chk"), cb = el("input"); cb.type = "checkbox"; cb.checked = mdDraft[key];
          cb.addEventListener("change", function () { mdDraft[key] = cb.checked; });
          l.appendChild(cb); l.appendChild(el("span", "", label)); body.appendChild(l);
        }
        check(t("md.brand"), "brand", !!brand0);
        check(t("md.photo"), "photo", !!MEDIA);
        body.appendChild(el("p", "hint ai-note", cf.p.device ? t("ai.here") : t("md.sent", { name: cf.name })));
        var stat = el("p", "hint ai-stat"); stat.setAttribute("role", "status");
        body.appendChild(stat);
        var grid = el("div", "md-grid");
        body.appendChild(grid);
        var act = el("div", "dlg-actions");
        var c = el("button", "btn", t("btn.close")); c.type = "button";
        var go = el("button", "btn primary", t("md.go")); go.type = "button";
        c.addEventListener("click", close);
        act.appendChild(c); act.appendChild(go);
        body.appendChild(act);

        function card(d) {
          var b = el("button", "md-card"); b.type = "button";
          var th = el("span", "tpl-thumb wait");
          th.style.setProperty("--ratio", String(d.setup.h / d.setup.w));
          b.appendChild(th);
          b.appendChild(el("span", "tpl-name", d.name));
          b.title = t("md.open");
          b.setAttribute("aria-label", t("md.open") + ": " + d.name);
          b.addEventListener("click", function () {
            close();
            AT.addDoc(d);
            AT.toast(t("md.opened"));
          });
          grid.appendChild(b);
          var assets = d.items.filter(function (x) { return x.ax.k === "photo" && x.a; }).map(function (x) { return x.a; });
          var T = AT.T;
          Promise.all([T.load(AT.draw.fontKeys(d)).catch(function () {})].concat(assets.map(function (a) { return A.load(a).catch(function () {}); }))).then(function () {
            var url = AT.thumbOf(d, 220, "md:" + d.id + ":" + now());
            if (url) { th.classList.remove("wait"); var img = el("img"); img.src = url; img.alt = ""; th.appendChild(img); }
          });
        }

        go.addEventListener("click", function () {
          var desc = ta.value.trim();
          if (!desc) { ta.focus(); return; }
          if (ctl) ctl.abort();
          var my = ctl = new AbortController();
          grid.textContent = ""; made = [];
          go.disabled = true;
          var brand = mdDraft.brand ? brand0 : null;
          var tpls = pickTemplates(desc, AT.TEMPLATES.list, 3), photo = null;
          var steps = tpls.reduce(function (p, tpl, i) {
            return p.then(function () {
              if (my.signal.aborted) return;
              stat.textContent = t("md.making", { name: cf.name, n: i + 1, all: tpls.length });
              var d = AX.fromTemplate(tpl, AT.LANG, now());
              var slots = slotsAll(d);
              if (!slots.length) { made.push(d); card(d); return; }
              var q = AIT.ideas(desc, slots, { colors: !(brand && brand.colors.length), lang: AT.LANG });
              var sys = q.system + (i === 0 && mdDraft.photo ? ' Also add, at the top level of the JSON, "photo": 2 to 4 English words to search a stock photo for this design.' : "");
              return AT.ai.ask(cf, sys, q.user, my.signal, null).then(function (txt) {
                if (my.signal.aborted) return;
                if (i === 0 && mdDraft.photo) photo = getPhoto(photoWords(AIT.firstJson(txt)));
                var idea = AIT.parseIdeas(txt, slots)[0];
                if (!idea) return;
                fill(d, slots, idea, brand);
                d.name = (idea.name || d.name).slice(0, 60);
                return (photo || Promise.resolve(null)).then(function (ph) {
                  if (my.signal.aborted) return;
                  if (ph) putPhoto(d, ph);
                  made.push(M.normDoc(d));
                  card(made[made.length - 1]);
                });
              });
            });
          }, Promise.resolve());
          steps.then(function () {
            if (ctl !== my) return;
            stat.textContent = made.length ? "" : t("md.none");
          }, function (e) {
            if (ctl !== my || my.signal.aborted) return;
            stat.textContent = AT.ai.errText(e, cf);
          }).then(function () { if (ctl === my) { ctl = null; go.disabled = false; } });
        });
        ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go.click(); } });
        setTimeout(function () { ta.focus(); }, 0);
        if (mdDraft.text && prompt) setTimeout(function () { go.click(); }, 0);
      }, true);
      dlg.addEventListener("close", function () { if (ctl) ctl.abort(); }, { once: true });
    });
  }

  // the home bar: describe → Design it
  function homeBar() {
    var host = document.getElementById("home-magic");
    if (!host || host.firstChild) return;
    var f = el("form", "md-bar");
    var inp = el("input", "inp"); inp.type = "text"; inp.maxLength = 1000; inp.placeholder = t("md.ph");
    inp.setAttribute("aria-label", t("md.title"));
    var b = el("button", "btn primary", t("md.go")); b.type = "submit";
    f.appendChild(inp); f.appendChild(b);
    f.addEventListener("submit", function (e) { e.preventDefault(); design(inp.value); });
    host.appendChild(f);
    host.hidden = false;
  }
  homeBar();
  AT.on("boot", homeBar);

  // ---------- Magic animate ----------
  function animateAll() {
    var doc = AT.doc;
    if (!doc) return;
    var plan = animPlan(doc, M.pagesInOrder(doc));
    var ok = AT.op(function (d, nw) {
      d.items.forEach(function (it) {
        if (!it.ax) return;
        var before = JSON.stringify(it.ax);
        if (Object.prototype.hasOwnProperty.call(plan.an, it.id)) {
          if (plan.an[it.id] && !(plan.an[it.id] === "type" && it.ax.k !== "text")) it.ax.an = plan.an[it.id]; else delete it.ax.an;
        }
        if (it.ax.bg && it.ax.k === "shape" && plan.pages[it.pg]) {
          var P = plan.pages[it.pg];
          if (P.dur === Anim.DUR_DEF) delete it.ax.dur; else it.ax.dur = P.dur;
          if (!P.ptr || P.ptr === Anim.PTR_DEF) delete it.ax.ptr; else it.ax.ptr = P.ptr;
          // the plan's transition replaces a morph (wave C2)
          if (it.ext && it.ext.mph) {
            delete it.ext.mph;
            if (!Object.keys(it.ext).length) delete it.ext;
            M.touch(it, nw);
          }
        }
        if (JSON.stringify(it.ax) !== before) M.touch(it, nw);
      });
    });
    if (ok) AT.toast(t("ma.done"), t("btn.undo"), AT.undo);
    AT.renderDrawer();
  }
  function clearAll() {
    var ok = AT.op(function (d, nw) {
      d.items.forEach(function (it) {
        if (it.ax && it.ax.an) { delete it.ax.an; M.touch(it, nw); }
      });
    });
    if (ok) AT.toast(t("ma.cleared"), t("btn.undo"), AT.undo);
    AT.renderDrawer();
  }
  // the top of the Animate panel (motion.js)
  function section(body) {
    var s = el("div", "pn-sec");
    s.appendChild(el("div", "pn-h", t("ma.title")));
    s.appendChild(el("p", "hint", t("ma.hint")));
    var b = el("button", "btn primary block", t("ma.go")); b.type = "button";
    b.addEventListener("click", animateAll);
    s.appendChild(b);
    if (AT.doc && AT.doc.items.some(function (it) { return it.ax && it.ax.an; })) {
      var c = el("button", "btn small block", t("ma.clear")); c.type = "button";
      c.addEventListener("click", clearAll);
      s.appendChild(c);
    }
    body.appendChild(s);
  }

  AT.magicDesign = { design: design, animateAll: animateAll, section: section, pure: pure };
})(typeof window !== "undefined" ? window : this);
