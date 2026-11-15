// ============================================================
// orOS Studio — Publish as podcast, the dialog (v1.0.0, wave P1)
// Export › Publish as podcast: the show (title, author, description,
// language, category, cover, the site address), this project as one of
// its episodes, the episode file (the mix as MP3 with its tags and
// chapters, on the orOS disk under /internal/Studio/Podcasts/<show>/),
// the list of episodes, and the site as a ZIP (feed.xml, the episodes,
// the chapters, the cover and a small page) for any static host.
// The rules are in podcast.js (window.StudioPodcast); this file only
// talks to the page. studio.js creates it with a host:
//   StudioPodcastUI(host) → { open(), markers(), addMarkerHere(), close() }
// host: t, lang, data(), proj(), setProject(fields, opts), putShow(s),
//   removeShow(id), newId(kind), playhead(), seek(t), renderMix(r, rate),
//   mixRange() → { a, b } | null, mixProblem() → "" | toast key,
//   fs(), dialog(), saveFile(blob, name, mime, desc, ext) → Promise<bool>,
//   toast(text), showDlg(id), hideDlg(id), radioChips(...), shellOpen(app, target),
//   encoder (StudioEncode)
// Text goes onto the page with textContent only.
// ============================================================
(function (root) {
  "use strict";

  function StudioPodcastUI(H) {
    var P = root.StudioPodcast, E = H.encoder, t = H.t;
    var $ = function (id) { return document.getElementById(id); };
    var cur = "";                 // the show in the form ("" = a new one)
    var busy = false;
    var epPrefs = { kbps: 96, ch: 1 };
    var LANGS = ["el", "en", "de", "fr", "it", "es", "pt", "nl", "sv", "pl", "tr", "bg", "ro", "sq", "sr", "ru", "uk", "ar", "he", "ja", "zh"];
    var LANG3 = { el: "ell", en: "eng", de: "deu", fr: "fra", it: "ita", es: "spa", pt: "por", nl: "nld", sv: "swe", pl: "pol",
      tr: "tur", bg: "bul", ro: "ron", sq: "sqi", sr: "srp", ru: "rus", uk: "ukr", ar: "ara", he: "heb", ja: "jpn", zh: "zho" };

    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    }
    function opt(sel, value, label) { var o = el("option", "", label); o.value = value; sel.appendChild(o); return o; }
    function status(id, text) { $(id).textContent = text || ""; }
    function dat() { return H.data(); }
    function show() { return cur ? P.findShow(dat(), cur) : null; }
    function proj() { return H.proj(); }
    function curEp() { var p = proj(); return p && p.sh === cur && cur ? P.normEp(p.ep) : null; }
    function langName(code) {
      try { return new Intl.DisplayNames([H.lang], { type: "language" }).of(code) || code; } catch (e) { return code; }
    }
    function fmtDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
    function dayMs(v) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
      return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], 8, 0, 0) : 0;
    }
    function mb(bytes) { return (Math.round(bytes / 100000) / 10).toLocaleString(H.lang) + " MB"; }

    // ---------- the form: show ----------
    function fillSelects() {
      var lang = $("pod-lang");
      if (!lang.options.length) LANGS.forEach(function (c) { opt(lang, c, langName(c) + " (" + c + ")"); });
      var cat = $("pod-cat");
      if (!cat.options.length) {
        opt(cat, "", t("pod.catNone"));
        Object.keys(P.CATS).forEach(function (c) {
          opt(cat, c, t("pod.cat." + c) !== "pod.cat." + c ? t("pod.cat." + c) : c);
          P.CATS[c].forEach(function (s) { opt(cat, c + "|" + s, "  " + (t("pod.cat." + c) !== "pod.cat." + c ? t("pod.cat." + c) : c) + " › " + s); });
        });
      }
      var ty = $("pod-type");
      if (!ty.options.length) P.TYPES.forEach(function (v) { opt(ty, v, t("pod.type." + v)); });
      var et = $("pod-ep-type");
      if (!et.options.length) P.EP_TYPES.forEach(function (v) { opt(et, v, t("pod.epType." + v)); });
    }
    function renderShowPick() {
      var sel = $("pod-show"), list = P.shows(dat());
      sel.innerHTML = "";
      list.forEach(function (s) { opt(sel, s.id, s.title || t("pod.untitledShow")); });
      opt(sel, "", t("pod.newShow"));
      if (cur && !list.some(function (s) { return s.id === cur; })) cur = "";
      sel.value = cur;
    }
    function fillShow() {
      var s = show() || P.normShow({ id: "hnewshow00", m: 0, lang: LANGS.indexOf(H.lang) >= 0 ? H.lang : "en" });
      $("pod-title").value = s.title;
      $("pod-author").value = s.author;
      $("pod-desc").value = s.desc;
      $("pod-lang").value = s.lang;
      if ($("pod-lang").value !== s.lang) { opt($("pod-lang"), s.lang, s.lang); $("pod-lang").value = s.lang; }
      $("pod-cat").value = s.cat ? (s.sub ? s.cat + "|" + s.sub : s.cat) : "";
      $("pod-explicit").checked = s.explicit;
      $("pod-type").value = s.type;
      $("pod-url").value = s.url;
      $("pod-email").value = s.email;
      $("pod-fund").value = s.fund;
      $("pod-del").hidden = !cur;
      $("pod-cover-sec").hidden = !cur;
      status("pod-show-err", "");
      renderCover(s);
    }
    var coverUrl = "";
    function renderCover(s) {
      var img = $("pod-cover-img");
      if (coverUrl) { URL.revokeObjectURL(coverUrl); coverUrl = ""; }
      img.hidden = true;
      $("pod-cover-none").hidden = !!(s && s.cover);
      var fs = H.fs();
      if (!s || !s.cover || !fs) return;
      Promise.resolve(fs.readBlob(s.cover)).then(function (b) {
        if (!b || show() !== null && show().cover !== s.cover) return;
        coverUrl = URL.createObjectURL(b);
        img.src = coverUrl; img.hidden = false;
      }, function () { $("pod-cover-none").hidden = false; });
    }
    function readShowForm() {
      var cat = $("pod-cat").value.split("|");
      return {
        title: $("pod-title").value, author: $("pod-author").value, desc: $("pod-desc").value,
        lang: $("pod-lang").value, cat: cat[0] || "", sub: cat[1] || "",
        explicit: $("pod-explicit").checked, type: $("pod-type").value,
        url: $("pod-url").value, email: $("pod-email").value, fund: $("pod-fund").value
      };
    }
    function saveShow() {
      var f = readShowForm(), old = show();
      if (!P.normShow(Object.assign({ id: "hcheck0000", m: 0 }, f)).title) { status("pod-show-err", t("pod.err.title")); $("pod-title").focus(); return null; }
      var url = P.siteUrl(f.url);
      if (f.url.trim() && !url) { status("pod-show-err", t("pod.err.url")); $("pod-url").focus(); return null; }
      if (f.email.trim() && !P.normShow(Object.assign({ id: "hcheck0000", m: 0 }, f)).email) { status("pod-show-err", t("pod.err.email")); $("pod-email").focus(); return null; }
      if (f.fund.trim() && !P.normShow(Object.assign({ id: "hcheck0000", m: 0 }, f)).fund) { status("pod-show-err", t("pod.err.fund")); $("pod-fund").focus(); return null; }
      var s = P.normShow(Object.assign({}, old || {}, f, { id: old ? old.id : H.newId("h"), m: 0 }));
      // the feed's identity is made once, from the first site address, and kept
      if (!s.guid && s.url) s.guid = P.feedGuid(P.feedUrl(s));
      H.putShow(s);
      cur = s.id;
      status("pod-show-err", "");
      H.toast(t("pod.saved"));
      render();
      return s;
    }
    function deleteShow() {
      var s = show();
      if (!s) return;
      var eps = P.episodes(dat(), s.id);
      ask(t("pod.delAsk", { name: s.title || t("pod.untitledShow"), n: eps.length }), t("pod.del"), function () {
        // the projects stay; they only leave the show
        P.episodes(dat(), s.id).forEach(function (e) { H.setProject({ sh: undefined, ep: undefined }, { pid: e.p.id }); });
        H.removeShow(s.id);
        cur = "";
        render();
      });
    }
    // a themed yes/no over the podcast dialog (R14); yes runs fn
    var askFn = null;
    function ask(text, yesLabel, fn) {
      askFn = fn;
      $("pod-ask-text").textContent = text;
      $("pod-ask-yes").textContent = yesLabel || t("btn.ok");
      H.showDlg("pod-ask");
      $("pod-ask-no").focus();
    }

    // ---------- the cover: a square JPEG of 1400–3000 px, no metadata ----------
    function pickCover() {
      var s = show(), dlg = H.dialog(), fs = H.fs();
      if (!s || !fs) { H.toast(t("pod.err.noDisk")); return; }
      var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile("image/jpeg,image/png,image/webp") : H.pickLocal("image/*");
      Promise.resolve(pick).then(function (file) {
        if (!file) return;
        status("pod-show-err", t("pod.coverBusy"));
        return squareJpeg(file).then(function (blob) {
          var path = P.coverPath(s.id, "jpg");
          return Promise.resolve(fs.mkdir(P.showDir(s.id))).then(function () { return fs.writeBlob(path, blob); }).then(function () {
            H.putShow(Object.assign({}, s, { cover: path }));
            status("pod-show-err", "");
            render();
          });
        });
      }).catch(function (e) {
        status("pod-show-err", e && e.message === "small" ? t("pod.err.coverSmall") : t("pod.err.cover"));
      });
    }
    // centre square, 1400–3000 px, redrawn (drops EXIF: places, cameras)
    function squareJpeg(file) {
      if (typeof createImageBitmap !== "function") return Promise.reject(new Error("img"));
      return createImageBitmap(file).then(function (bmp) {
        var side = Math.min(bmp.width, bmp.height);
        if (side < 1400) { if (bmp.close) bmp.close(); throw new Error("small"); }
        var out = Math.min(3000, side), c = document.createElement("canvas");
        c.width = c.height = out;
        var g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, out, out);
        g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
        if (bmp.close) bmp.close();
        return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error("img")); }, "image/jpeg", 0.9); });
      });
    }
    // Atelier: a new 3000 × 3000 design holding the cover (or a plain square)
    function coverInAtelier() {
      var s = show(), fs = H.fs();
      if (!s || !fs || !root.crypto || !root.crypto.subtle) { H.toast(t("pod.err.noDisk")); return; }
      var blobP = s.cover ? Promise.resolve(fs.readBlob(s.cover)) : new Promise(function (res) {
        var c = document.createElement("canvas"); c.width = c.height = 3000;
        var g = c.getContext("2d"); g.fillStyle = "#1d1d22"; g.fillRect(0, 0, 3000, 3000);
        c.toBlob(res, "image/png");
      });
      blobP.then(function (blob) {
        return blob.arrayBuffer().then(function (buf) { return root.crypto.subtle.digest("SHA-256", buf); }).then(function (h) {
          var hex = Array.prototype.map.call(new Uint8Array(h), function (v) { return (v < 16 ? "0" : "") + v.toString(16); }).join("");
          var path = "/internal/Assets/" + hex + (blob.type === "image/png" ? ".png" : ".jpg");
          return Promise.resolve(fs.mkdir("/internal/Assets")).then(function () { return fs.writeBlob(path, blob); }).then(function () {
            H.hideDlg("pod-dlg");
            H.toast(t("pod.atelierHint"));
            H.shellOpen("atelier", { newPicture: { path: path, w: 3000, h: 3000, name: s.title || t("pod.untitledShow") } });
          });
        });
      }).catch(function () { H.toast(t("pod.err.cover")); });
    }

    // ---------- the form: this project as an episode ----------
    function fillEp() {
      var p = proj(), s = show();
      var sec = $("pod-ep-sec");
      sec.hidden = !s || !p;
      if (!s || !p) return;
      var ep = curEp(), here = !!ep;
      $("pod-ep-join").hidden = here;
      $("pod-ep-form").hidden = !here;
      if (!here) {
        $("pod-ep-other").textContent = p.sh && p.sh !== s.id ? t("pod.epOther", { name: (P.findShow(dat(), p.sh) || {}).title || t("pod.untitledShow") }) : "";
        return;
      }
      $("pod-ep-n").value = ep.n || "";
      $("pod-ep-se").value = ep.se || "";
      $("pod-ep-type").value = ep.type;
      $("pod-ep-title").value = ep.title;
      $("pod-ep-title").placeholder = p.name || "";
      $("pod-ep-desc").value = ep.desc;
      $("pod-ep-date").value = ep.date ? fmtDate(ep.date) : "";
      $("pod-ep-explicit").checked = ep.explicit;
      epPrefs = { kbps: ep.kbps, ch: ep.ch };
      renderEpChips();
      var mk = P.normMarkers(p.mk), r = H.mixRange();
      var chs = P.chapters(mk, r ? r.b - r.a : 0, t("pod.intro"));
      $("pod-ep-ch").textContent = chs.length ? t("pod.chapters", { n: chs.length }) : t("pod.noChapters");
      var e = { p: p, ep: ep, mk: mk };
      $("pod-ep-file").textContent = ep.file ? t("pod.fileReady", { d: P.fmtDur(ep.dur), s: mb(ep.bytes) }) + (P.stale(e) ? " " + t("pod.stale") : "") : t("pod.fileNone");
      $("pod-ep-go").textContent = ep.file ? t("pod.remake") : t("pod.make");
      status("pod-ep-err", "");
    }
    function renderEpChips() {
      H.radioChips($("pod-ep-ch-pick"), [1, 2], epPrefs.ch, function (v) { return t(v === 1 ? "pod.mono" : "pod.stereo"); }, function (v) { epPrefs.ch = v; renderEpChips(); });
      H.radioChips($("pod-ep-kbps"), P.KBPS, epPrefs.kbps, function (v) { return t("kbps", { n: v }); }, function (v) { epPrefs.kbps = v; renderEpChips(); });
      $("pod-ep-size").textContent = t("pod.sizeHint", { s: mb(epPrefs.kbps * 1000 / 8 * 3600) });
    }
    function readEp() {
      var ep = curEp() || P.normEp({}), num = function (id, max) { var v = parseInt($(id).value, 10); return isFinite(v) && v > 0 ? Math.min(max, v) : 0; };
      return Object.assign({}, ep, {
        n: num("pod-ep-n", P.LIM.epNo), se: num("pod-ep-se", P.LIM.season), type: $("pod-ep-type").value,
        title: $("pod-ep-title").value, desc: $("pod-ep-desc").value, date: dayMs($("pod-ep-date").value) || ep.date,
        explicit: $("pod-ep-explicit").checked, kbps: epPrefs.kbps, ch: epPrefs.ch
      });
    }
    function saveEp(quiet) {
      if (!curEp()) return;
      H.setProject({ ep: P.normEp(readEp()) });
      if (!quiet) H.toast(t("pod.saved"));
      render();
    }
    function joinShow() {
      var s = show(), p = proj();
      if (!s || !p) return;
      var n = P.nextEpNo(dat(), s.id);
      H.setProject({ sh: s.id, ep: P.normEp({ n: n, type: "full", title: p.name || "", date: 0, kbps: 96, ch: 1 }) });
      render();
    }
    function leaveShow() {
      var ep = curEp();
      if (!ep) return;
      var go = function () { H.setProject({ sh: undefined, ep: undefined }); render(); };
      if (ep.file) ask(t("pod.leaveAsk"), t("pod.epLeave"), go); else go();
    }
    // the mix → MP3 with its tags and chapters → the orOS disk
    function makeFile() {
      var s = show(), p = proj(), fs = H.fs();
      if (busy || !s || !p) return;
      if (!fs || typeof fs.mkdir !== "function") { status("pod-ep-err", t("pod.err.noDisk")); return; }
      var problem = H.mixProblem();
      if (problem) { status("pod-ep-err", t(problem)); return; }
      var r = H.mixRange(), ep = P.normEp(readEp());
      if (r.b - r.a > P.LIM.dur) { status("pod-ep-err", t("pod.err.long")); return; }
      var eps = P.episodes(dat(), s.id), taken = {};
      eps.forEach(function (e) { if (e.p.id !== p.id && e.ep.slug) taken[e.ep.slug] = 1; });
      if (!ep.slug) ep.slug = P.epSlug(ep, ep.title || p.name, taken);
      if (!ep.guid) ep.guid = P.epGuid(s.id, p.id);
      if (!ep.date) ep.date = Date.now();
      var path = P.epPath(s.id, ep.slug), mk = P.normMarkers(p.mk);
      busy = true; setBusy();
      status("pod-ep-err", t("export.busy"));
      var rate = 44100;
      H.renderMix(r, rate).then(function (chans) {
        var dur = chans[0].length / rate;
        var pcm = ep.ch === 1 ? [mono(chans)] : chans;
        return coverBytes(s).then(function (cover) {
          var e = { p: p, ep: ep, mk: mk };
          var tags = P.id3Tags(s, e, { dur: dur, intro: t("pod.intro"), untitled: t("pod.untitledEp"), cover: cover, lang3: LANG3[s.lang.slice(0, 2)] || "", tool: "orOS Studio" });
          var opts = E.id3v24 ? { title: tags.title, tags: tags } : { title: tags.title };
          var enc = new E.Mp3Encoder(pcm, rate, ep.kbps, opts);
          return new Promise(function (res, rej) {
            var step = function () {
              try {
                if (enc.step(60)) { res(enc.bytes()); return; }
              } catch (err) { rej(err); return; }
              status("pod-ep-err", t("export.encoding", { n: Math.floor(enc.progress() * 100) }));
              setTimeout(step, 0);
            };
            setTimeout(step, 0);
          }).then(function (bytes) {
            var blob = new Blob([bytes], { type: "audio/mpeg" });
            return Promise.resolve(fs.mkdir(P.DIR)).then(function () { return fs.mkdir(P.showDir(s.id)); })
              .then(function () { return fs.writeBlob(path, blob); })
              .then(function () {
                if (ep.file && ep.file !== path && fs.rm) Promise.resolve(fs.rm(ep.file)).catch(function () {});
                H.setProject({ ep: P.normEp(Object.assign({}, ep, { file: path, bytes: blob.size, dur: dur, mh: P.markerHash(mk) })) }, { pid: p.id });
              });
          });
        });
      }).then(function () {
        busy = false; setBusy();
        H.toast(t("pod.fileMade"));
        render();
      }, function () {
        busy = false; setBusy();
        status("pod-ep-err", t("toast.exportFail"));
      });
    }
    function mono(chans) {
      if (chans.length < 2) return chans[0];
      var a = chans[0], b = chans[1], out = new Float32Array(a.length);
      for (var i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) * 0.5;
      return out;
    }
    function coverBytes(s) {
      var fs = H.fs();
      if (!s.cover || !fs) return Promise.resolve(null);
      return Promise.resolve(fs.readBlob(s.cover)).then(function (b) {
        return b && b.size <= 2 * 1024 * 1024 ? b.arrayBuffer().then(function (buf) { return { mime: "image/jpeg", bytes: new Uint8Array(buf) }; }) : null;
      }, function () { return null; });
    }

    // ---------- the episodes of the show ----------
    function renderEps() {
      var s = show(), ul = $("pod-eps");
      ul.innerHTML = "";
      $("pod-eps-sec").hidden = !s;
      if (!s) return;
      var eps = P.episodes(dat(), s.id);
      $("pod-eps-none").hidden = eps.length > 0;
      eps.forEach(function (e) {
        var li = el("li", "pod-ep" + (proj() && e.p.id === proj().id ? " cur" : ""));
        var kind = e.ep.type !== "full" ? t("pod.epType." + e.ep.type) : e.ep.n ? "#" + e.ep.n : "";
        li.appendChild(el("span", "pod-ep-t", (kind ? kind + " · " : "") + (e.ep.title || e.p.name || t("pod.untitledEp"))));
        var state = !e.ep.file ? t("pod.draft") : P.stale(e) ? t("pod.staleShort") : fmtDate(e.ep.date) + " · " + P.fmtDur(e.ep.dur);
        li.appendChild(el("span", "hint small", state));
        ul.appendChild(li);
      });
    }

    // ---------- the site: what is missing, the ZIP ----------
    function renderSite() {
      var s = show();
      $("pod-site-sec").hidden = !s;
      if (!s) return;
      var eps = P.episodes(dat(), s.id), miss = P.problems(s, eps);
      var list = $("pod-miss");
      list.innerHTML = "";
      miss.forEach(function (k) { list.appendChild(el("li", "", t("pod.miss." + k))); });
      list.hidden = !miss.length;
      $("pod-zip").disabled = busy || miss.length > 0;
      var feed = P.feedUrl(s);
      $("pod-feed").textContent = feed || t("pod.noFeed");
      $("pod-feed-copy").disabled = !feed;
      $("pod-subscribe").hidden = !feed || !podcastsHost();
      renderGh();
    }
    function podcastsHost() {
      try { var w = root.parent; return w && w !== root && typeof w.__orosOpenPodcastsAdd === "function" ? w : null; } catch (e) { return null; }
    }
    function copyFeed() {
      var s = show(), feed = s && P.feedUrl(s);
      if (!feed) return;
      var done = function () { H.toast(t("pod.copied")); };
      try { navigator.clipboard.writeText(feed).then(done, function () { H.toast(feed); }); } catch (e) { H.toast(feed); }
    }
    function subscribe() {
      var s = show(), w = podcastsHost();
      if (!s || !w) return;
      H.hideDlg("pod-dlg");
      w.__orosOpenPodcastsAdd(P.feedUrl(s));
    }
    // a Blob, also one made in the shell's window (orosFS reads there)
    function isBlob(x) { return !!x && typeof x.slice === "function" && typeof x.size === "number" && typeof x.arrayBuffer === "function"; }
    // read a Blob a piece at a time → its CRC-32
    function blobCrc(blob) {
      var CH = 4 * 1024 * 1024, off = 0, crc;
      var next = function () {
        if (off >= blob.size) return Promise.resolve(crc === undefined ? 0 : crc);
        return blob.slice(off, off + CH).arrayBuffer().then(function (buf) {
          crc = P.crc32(new Uint8Array(buf), crc); off += CH;
          return next();
        });
      };
      return next();
    }
    function makeZip() {
      var s = show(), fs = H.fs();
      if (busy || !s || !fs) return;
      var eps = P.episodes(dat(), s.id).filter(function (e) { return !!e.ep.file; });
      var stale = eps.filter(P.stale);
      if (stale.length) return ask(t("pod.staleAsk", { n: stale.length }), t("pod.zip"), function () { zipNow(s, fs, eps); });
      zipNow(s, fs, eps);
    }
    // everything the site holds: [{ name, data (Uint8Array or Blob) }]
    // keep: <item>s of the published feed this device does not have (P2)
    function siteItems(s, fs, eps, now, keep) {
      var f = P.files(s, eps);
      var words = {
        feed: t("pod.page.feed"), support: t("pod.page.support"), episode: t("pod.page.episode"), season: t("pod.page.season"),
        trailer: t("pod.epType.trailer"), bonus: t("pod.epType.bonus"), untitled: t("pod.untitledEp"), credit: t("pod.page.credit")
      };
      var items = [
        { name: f.feed, data: P.textBytes(P.feedXml(s, eps, { now: now, untitled: t("pod.untitledEp"), fundLabel: t("pod.page.support"), keep: keep || [] })) },
        { name: f.page, data: P.textBytes(P.pageHtml(s, eps, words)) },
        { name: f.style, data: P.textBytes(P.PAGE_CSS) }
      ];
      eps.forEach(function (e, i) {
        var fe = f.eps[i];
        if (fe.chapters) items.push({ name: fe.chapters, data: P.textBytes(P.chaptersJson(P.chapters(e.mk, e.ep.dur, t("pod.intro")), t("pod.chapter"))) });
      });
      var blobs = [{ name: f.cover, path: s.cover }].concat(eps.map(function (e, i) { return { name: f.eps[i].audio, path: e.ep.file }; }));
      var missing = [];
      return Promise.all(blobs.map(function (b) {
        return Promise.resolve(fs.readBlob(b.path)).then(function (blob) {
          if (!blob) throw new Error("gone");
          return { name: b.name, data: blob };
        }, function () { missing.push(b.name); return null; });
      })).then(function (got) {
        if (missing.length) { var e = new Error("missing"); e.list = missing; throw e; }
        return items.concat(got);
      });
    }
    function siteFail(e) {
      if (e && e.message === "missing") return t("pod.err.missing", { list: (e.list || []).join(", ") });
      if (e && e.message === "zip-big") return t("pod.err.big");
      if (e && /^gh-/.test(e.code || "")) return t("pod.gh.err." + e.code.slice(3));
      return t("toast.exportFail");
    }
    // the published feed (if any): its episodes this device does not have are kept
    // strict: a feed that cannot be read stops the publish (GitHub); the ZIP
    // goes on without it (a site not online yet, or no CORS on that host)
    function publishedKeep(s, eps, read, strict) {
      return Promise.resolve().then(read).then(function (xml) { return P.keepItems(xml || "", P.guidsOf(eps)); }, function (e) {
        if (strict) throw e;
        return [];
      });
    }
    function fetchFeed(s) {
      var url = P.feedUrl(s);
      if (!url || typeof fetch !== "function") return Promise.resolve("");
      return fetch(url, { cache: "no-store", credentials: "omit" }).then(function (r) { return r.ok ? r.text() : ""; }, function () { return ""; });
    }
    function zipNow(s, fs, eps) {
      if (busy) return;
      var now = Date.now(), items;
      busy = true; setBusy();
      status("pod-site-err", t("pod.zipBusy"));
      publishedKeep(s, eps, function () { return fetchFeed(s); }).then(function (keep) {
        return siteItems(s, fs, eps, now, keep);
      }).then(function (got) {
        items = got;
        var crcs = [];
        var seq = items.reduce(function (pr, it) {
          return pr.then(function () {
            return isBlob(it.data) ? blobCrc(it.data) : P.crc32(it.data);
          }).then(function (c) { crcs.push(c); });
        }, Promise.resolve());
        return seq.then(function () {
          var parts = P.zipParts(items.map(function (it, i) {
            return { name: it.name, size: isBlob(it.data) ? it.data.size : it.data.length, crc: crcs[i] };
          }), new Date(now));
          var zip = new Blob(parts.map(function (x) { return typeof x === "number" ? items[x].data : x; }), { type: "application/zip" });
          return H.saveFile(zip, P.slug(s.title, "podcast") + "-site.zip", "application/zip", "ZIP", ".zip");
        });
      }).then(function (ok) {
        busy = false; setBusy();
        status("pod-site-err", ok ? t("pod.zipDone", { url: s.url }) : "");
      }, function (e) {
        busy = false; setBusy();
        status("pod-site-err", siteFail(e));
      });
    }

    // ---------- GitHub Pages (P2): the person's own repository and token ----------
    // device-only: { token, repos: { showId: "owner/repo" } }; never synced
    var GH_KEY = "oros-studio-gh";
    function ghConf() {
      try {
        var c = JSON.parse(root.localStorage.getItem(GH_KEY) || "null");
        if (c && typeof c === "object") return { token: typeof c.token === "string" ? c.token : "", repos: c.repos && typeof c.repos === "object" ? c.repos : {} };
      } catch (e) { /* private window */ }
      return { token: "", repos: {} };
    }
    function ghSave(c) {
      try {
        if (!c.token && !Object.keys(c.repos).length) root.localStorage.removeItem(GH_KEY);
        else root.localStorage.setItem(GH_KEY, JSON.stringify(c));
        return true;
      } catch (e) { return false; }
    }
    function renderGh() {
      var s = show(), G = root.StudioGhPages;
      $("pod-gh-sec").hidden = !s || !G;
      if (!s || !G) return;
      var c = ghConf(), repo = G.parseRepo(c.repos[s.id] || "");
      if (document.activeElement !== $("pod-gh-repo")) $("pod-gh-repo").value = repo ? G.repoName(repo) : "";
      $("pod-gh-token-set").hidden = !c.token;
      $("pod-gh-token-row").hidden = !!c.token;
      $("pod-gh-forget").hidden = !c.token;
      var miss = P.problems(s, P.episodes(dat(), s.id)).filter(function (k) { return k !== "url"; });
      var r = G.parseRepo($("pod-gh-repo").value);
      $("pod-gh-go").disabled = busy || miss.length > 0;
      var where = r ? G.pagesUrl(r) : "";
      $("pod-gh-where").textContent = where && s.url && s.url !== where ? t("pod.gh.other", { url: s.url, pages: where }) : "";
    }
    function ghStep(k, i, n) {
      status("pod-gh-err", k === "file" ? t("pod.gh.step.file", { i: i, n: n }) : t("pod.gh.step." + k));
    }
    function sha1Hex(bytes) {
      var G = root.StudioGhPages;
      try {
        if (root.crypto && root.crypto.subtle) return root.crypto.subtle.digest("SHA-1", bytes).then(function (d) { return G.hex(new Uint8Array(d)); });
      } catch (e) { /* fall through */ }
      return G.hex(P.sha1(bytes));
    }
    function bytesOf(d) { return isBlob(d) ? d.arrayBuffer().then(function (b) { return new Uint8Array(b); }) : d; }
    function publishGh() {
      var s = show(), fs = H.fs(), G = root.StudioGhPages;
      if (busy || !s || !fs || !G) return;
      var repo = G.parseRepo($("pod-gh-repo").value);
      if (!repo) { status("pod-gh-err", t("pod.gh.err.repo")); $("pod-gh-repo").focus(); return; }
      var c = ghConf(), typed = $("pod-gh-token").value.trim();
      if (!c.token) {
        if (!G.tokenOk(typed)) { status("pod-gh-err", t("pod.gh.err.token")); $("pod-gh-token").focus(); return; }
        c.token = typed;
      }
      c.repos[s.id] = G.repoName(repo);
      if (!ghSave(c)) { status("pod-gh-err", t("pod.gh.err.store")); return; }
      $("pod-gh-token").value = "";
      // no site address yet: GitHub Pages' own, which also makes the feed's guid
      if (!s.url) {
        s = P.normShow(Object.assign({}, s, { url: G.pagesUrl(repo), m: 0 }));
        if (!s.guid) s.guid = P.feedGuid(P.feedUrl(s));
        H.putShow(s);
        fillShow();
      }
      var eps = P.episodes(dat(), s.id).filter(function (e) { return !!e.ep.file; });
      var stale = eps.filter(P.stale);
      var go = function () { ghNow(s, fs, eps, repo, c.token); };
      if (stale.length) ask(t("pod.staleAsk", { n: stale.length }), t("pod.gh.go"), go); else go();
    }
    function ghNow(s, fs, eps, repo, token) {
      if (busy) return;
      var G = root.StudioGhPages, now = Date.now();
      var deps = { fetch: function (u, i) { return root.fetch(u, i); }, token: token, sha1: sha1Hex, bytes: bytesOf };
      busy = true; setBusy();
      ghStep("feed");
      publishedKeep(s, eps, function () { return G.readFile(deps, repo, "feed.xml"); }, true).then(function (keep) {
        return siteItems(s, fs, eps, now, keep);
      }).then(function (items) {
        return G.publish(deps, repo, items.map(function (it) { return { path: it.name, data: it.data }; }), { onStep: ghStep, message: "orOS Studio: " + s.title });
      }).then(function (res) {
        busy = false; setBusy();
        var url = res.pages || s.url;
        var msg = res.changed ? t("pod.gh.done", { url: url }) : t("pod.gh.same", { url: url });
        if (res.pagesManual) msg += " " + t("pod.gh.pagesOff", { repo: G.repoName(repo) });
        if (res.pages && res.pages !== s.url) msg += " " + t("pod.gh.other", { url: s.url, pages: res.pages });
        status("pod-gh-err", msg);
      }, function (e) {
        busy = false; setBusy();
        if (e && e.code === "gh-auth") { var c = ghConf(); c.token = ""; ghSave(c); renderGh(); }
        status("pod-gh-err", siteFail(e));
      });
    }
    function forgetToken() {
      var c = ghConf();
      c.token = "";
      ghSave(c);
      status("pod-gh-err", t("pod.gh.forgot"));
      renderGh();
    }

    // ---------- markers ----------
    function addMarkerHere() {
      var p = proj();
      if (!p) return;
      var mk = P.normMarkers(p.mk);
      if (mk.length >= P.LIM.markers) { H.toast(t("mk.max", { n: P.LIM.markers })); return; }
      var at = H.playhead();
      H.setProject({ mk: P.addMarker(mk, at, H.newId("k"), t("mk.default", { n: mk.length + 1 })) });
      H.toast(t("mk.added", { time: H.fmtTime(at) }));
      if ($("mk-dlg").open) renderMarkers();
    }
    function renderMarkers() {
      var p = proj(), ul = $("mk-list");
      ul.innerHTML = "";
      var mk = p ? P.normMarkers(p.mk) : [];
      $("mk-none").hidden = mk.length > 0;
      mk.forEach(function (m) {
        var li = el("li", "mk-row");
        var go = el("button", "chip mk-time", H.fmtTime(m.t));
        go.type = "button";
        go.setAttribute("aria-label", t("mk.go", { time: H.fmtTime(m.t) }));
        go.addEventListener("click", function () { H.seek(m.t); });
        var name = el("input");
        name.type = "text"; name.maxLength = P.LIM.mark; name.value = m.n;
        name.setAttribute("aria-label", t("mk.name"));
        name.addEventListener("change", function () { H.setProject({ mk: P.setMarker(P.normMarkers(proj().mk), m.id, { n: name.value }) }); });
        var here = el("button", "chip", t("mk.here"));
        here.type = "button";
        here.addEventListener("click", function () { H.setProject({ mk: P.setMarker(P.normMarkers(proj().mk), m.id, { t: H.playhead() }) }); renderMarkers(); });
        var del = el("button", "chip danger", t("mk.del"));
        del.type = "button";
        del.setAttribute("aria-label", t("mk.delName", { name: m.n || H.fmtTime(m.t) }));
        del.addEventListener("click", function () { H.setProject({ mk: P.removeMarker(P.normMarkers(proj().mk), m.id) }); renderMarkers(); });
        li.appendChild(go); li.appendChild(name); li.appendChild(here); li.appendChild(del);
        ul.appendChild(li);
      });
    }
    function markers() { if (!proj()) return; renderMarkers(); H.showDlg("mk-dlg"); }

    // ---------- the whole dialog ----------
    function setBusy() {
      ["pod-ep-go", "pod-zip", "pod-gh-go", "pod-save", "pod-del", "pod-cover-pick", "pod-cover-atelier"].forEach(function (id) { if ($(id)) $(id).disabled = busy; });
      renderSite();
    }
    function render() {
      fillSelects();
      renderShowPick();
      fillShow();
      fillEp();
      renderEps();
      renderSite();
    }
    function open() {
      var p = proj();
      if (p && p.sh && P.findShow(dat(), p.sh)) cur = p.sh;
      else if (!cur) { var list = P.shows(dat()); cur = list.length ? list[0].id : ""; }
      render();
      H.showDlg("pod-dlg");
    }

    var wired = false;
    function wire() {
      if (wired) return;
      wired = true;
      $("pod-close").addEventListener("click", function () { H.hideDlg("pod-dlg"); });
      $("pod-show").addEventListener("change", function () { cur = $("pod-show").value; render(); });
      $("pod-save").addEventListener("click", saveShow);
      $("pod-del").addEventListener("click", deleteShow);
      $("pod-cover-pick").addEventListener("click", pickCover);
      $("pod-cover-atelier").addEventListener("click", coverInAtelier);
      $("pod-ep-add").addEventListener("click", joinShow);
      $("pod-ep-leave").addEventListener("click", leaveShow);
      $("pod-ep-save").addEventListener("click", function () { saveEp(false); });
      $("pod-ep-go").addEventListener("click", function () { saveEp(true); makeFile(); });
      $("pod-ep-mk").addEventListener("click", markers);
      $("pod-feed-copy").addEventListener("click", copyFeed);
      $("pod-subscribe").addEventListener("click", subscribe);
      $("pod-zip").addEventListener("click", makeZip);
      $("pod-gh-go").addEventListener("click", publishGh);
      $("pod-gh-forget").addEventListener("click", forgetToken);
      $("pod-gh-repo").addEventListener("input", renderGh);
      $("mk-add").addEventListener("click", addMarkerHere);
      $("pod-ask-no").addEventListener("click", function () { askFn = null; H.hideDlg("pod-ask"); });
      $("pod-ask-yes").addEventListener("click", function () { var fn = askFn; askFn = null; H.hideDlg("pod-ask"); if (fn) fn(); });
      $("pod-ask").addEventListener("close", function () { askFn = null; });
      $("mk-close").addEventListener("click", function () { H.hideDlg("mk-dlg"); if ($("pod-dlg").open) fillEp(); });
    }
    wire();
    return {
      open: open, markers: markers, addMarkerHere: addMarkerHere,
      // after a sync: the lists only, so what is being typed in the forms stays
      refresh: function () {
        if ($("pod-dlg").open && !busy) { renderShowPick(); renderEps(); renderSite(); }
        if ($("mk-dlg").open && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("#mk-list"))) renderMarkers();
      },
      busy: function () { return busy; }
    };
  }

  root.StudioPodcastUI = StudioPodcastUI;
})(typeof window !== "undefined" ? window : this);
