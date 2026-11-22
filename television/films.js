// ============================================================
// orOS Television — Films & shows tab (TV-VOD wave 1, the page side)
// Discover (search + filters over Wikimedia Commons and the Internet
// Archive), Continue watching and Watchlist (both synced in the
// TELEVISION slice, vod.js), a details window and playback in
// Television's own player (television.js window.__orosTvHost).
// Pure logic lives in vod.js (window.orosTvVod).
// Network: only when the person opens the tab, searches or plays.
//   Wikidata catalogue: four SPARQL queries (TSV), kept in Cache
//   Storage for 7 days (an older copy is used when a new one fails).
//   Internet Archive search / item, Commons file info: per request.
// Text from a catalogue reaches the page only through textContent;
// links are https and built from fixed hosts.
// ============================================================
(function(){
"use strict";

var V = window.orosTvVod;
var H = window.__orosTvHost;
if(!V || !H) return;

var WD_CACHE = "vod-wd-v1";          // Cache Storage entry (television.js csGet / csPut)
var WD_TTL = 7 * 24 * 3600 * 1000;
var DECADES = [1890, 1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
var SRC_NAME = { wd: "Wikimedia Commons", ia: "Internet Archive" };

var F = {
  built: false,
  view: "discover",          // discover | continue | watch
  q: "", f: {}, open: false, // search, filters, filter panel open
  seq: 0, busy: false, items: [], more: false, page: 1, notes: [],
  wd: null, wdAt: 0, wdBusy: null, wdOld: false,
  timer: null, cur: null     // the item in the details window
};
var el = {};

function t(k, v){
  var s = H.t(k);
  if(v) Object.keys(v).forEach(function(n){ s = s.split("{" + n + "}").join(String(v[n])); });
  return s;
}
function lang(){ return H.lang(); }
function mk(tag, cls, text){
  var e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text != null) e.textContent = text;
  return e;
}
function fold(s){ return V.fold(s); }
var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

/* ===== names of codes ===== */

function regionName(c){
  if(c === "su") return t("vod.c.su");
  try{ return new Intl.DisplayNames([H.loc()], { type: "region" }).of(c.toUpperCase()) || c.toUpperCase(); }catch(e){ return c.toUpperCase(); }
}
function langName(c){
  if(c === "zxx") return t("vod.l.zxx");
  try{ return new Intl.DisplayNames([H.loc()], { type: "language" }).of(c) || c; }catch(e){ return c; }
}
function title(it){ return V.titleIn(it, lang()); }
// What the synced lists keep: the title as this person reads it.
function stored(it){
  var c = {};
  Object.keys(it).forEach(function(k){ c[k] = it[k]; });
  c.t = title(it);
  return c;
}
function metaLine(it){
  var p = [];
  if(it.y) p.push(String(it.y));
  if(it.d) p.push(t("vod.min", { n: it.d }));
  p.push(t("vod.ty." + it.ty));
  return p.join(" · ");
}

/* ===== network ===== */

function NetErr(code){ this.code = code; }
function getText(url, accept, timeout){
  var FF = window.orosFeedsFetch;
  if(H.offline()) return Promise.reject(new NetErr("offline"));
  if(FF && typeof FF.fetchOne === "function"){
    return FF.fetchOne(url, { accept: accept, timeout: timeout || 25000 }).then(function(r){
      if(r.status === 429 || r.status === 503) throw new NetErr("busy");
      if(!r.status || r.status >= 400) throw new NetErr("http");
      return r.text || "";
    }, function(e){ throw new NetErr((e && e.code) === "offline" ? "offline" : "net"); });
  }
  return fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", headers: accept ? { Accept: accept } : {} })
    .then(function(r){
      if(r.status === 429 || r.status === 503) throw new NetErr("busy");
      if(!r.ok) throw new NetErr("http");
      return r.text();
    }, function(){ throw new NetErr("net"); });
}
function getJSON(url){
  return getText(url, "application/json").then(function(s){
    try{ return JSON.parse(s); }catch(e){ throw new NetErr("json"); }
  });
}

// The Wikidata catalogue: the cached copy when it is fresh, else the
// four queries (in parallel); a failed refresh keeps the older copy.
function catalogue(){
  if(F.wd && Date.now() - F.wdAt < WD_TTL) return Promise.resolve(F.wd);
  if(F.wdBusy) return F.wdBusy;
  F.wdBusy = H.csGet(WD_CACHE).then(function(w){
    var items = w && w.data && Array.isArray(w.data.items) ? w.data.items.map(V.item).filter(Boolean) : null;
    if(items && items.length){ F.wd = items; F.wdAt = w.ts; }
    if(F.wd && Date.now() - F.wdAt < WD_TTL) return F.wd;
    var Q = V.WD_QUERIES, keys = ["main", "facets", "dirs", "labels"];
    return Promise.all(keys.map(function(k){
      return getText(V.wdQueryUrl(Q[k]), "text/tab-separated-values", 90000);
    })).then(function(texts){
      var tsv = {};
      keys.forEach(function(k, i){ tsv[k] = texts[i]; });
      var built = V.wdBuild(tsv);
      if(!built.length) throw new NetErr("empty");
      F.wd = built; F.wdAt = Date.now(); F.wdOld = false;
      H.csPut(WD_CACHE, { items: built });
      return built;
    }, function(e){
      if(F.wd){ F.wdOld = true; return F.wd; }
      throw e;
    });
  });
  var p = F.wdBusy;
  p.then(function(){ F.wdBusy = null; }, function(){ F.wdBusy = null; });
  return p;
}

/* ===== the panel (built once) ===== */

function opt(sel, value, text){
  var o = document.createElement("option");
  o.value = value; o.textContent = text;
  sel.appendChild(o);
}
function select(id, capKey){
  var lab = mk("label", "tv-filter");
  var cap = mk("span", "tv-filter-cap", t(capKey));
  var sel = document.createElement("select");
  sel.id = id;
  sel.setAttribute("aria-label", t(capKey));
  lab.appendChild(cap); lab.appendChild(sel);
  return { wrap: lab, sel: sel, cap: cap, key: capKey };
}

function build(box){
  box.innerHTML = "";
  var sub = mk("div", "tvf-sub");
  sub.setAttribute("role", "tablist");
  ["discover", "continue", "watch"].forEach(function(v){
    var b = mk("button", "tvf-chip");
    b.type = "button";
    b.dataset.view = v;
    b.setAttribute("role", "tab");
    b.addEventListener("click", function(){ F.view = v; draw(); });
    sub.appendChild(b);
    el["chip_" + v] = b;
  });
  box.appendChild(sub);

  var bar = mk("div", "tvf-bar");
  var q = document.createElement("input");
  q.type = "search"; q.id = "tvf-q"; q.autocomplete = "off"; q.spellcheck = false;
  q.addEventListener("input", function(){
    clearTimeout(F.timer);
    F.timer = setTimeout(function(){ F.q = q.value.trim(); search(true); }, 450);
  });
  q.addEventListener("keydown", function(e){
    if(e.key === "Enter"){ clearTimeout(F.timer); F.q = q.value.trim(); search(true); }
  });
  var fb = mk("button", "tv-btn ghost tvf-fbtn");
  fb.type = "button";
  fb.setAttribute("aria-expanded", "false");
  fb.addEventListener("click", function(){ F.open = !F.open; drawPanel(); });
  bar.appendChild(q); bar.appendChild(fb);
  box.appendChild(bar);
  el.q = q; el.fbtn = fb; el.bar = bar;

  var panel = mk("div", "tvf-panel");
  panel.hidden = true;
  var S = {
    src: select("tvf-src", "vod.f.src"), ty: select("tvf-ty", "vod.f.ty"), g: select("tvf-g", "vod.f.g"),
    dec: select("tvf-dec", "vod.f.dec"), c: select("tvf-c", "filter.country"), l: select("tvf-l", "filter.lang"),
    len: select("tvf-len", "vod.f.len"), snd: select("tvf-snd", "vod.f.snd"), sort: select("tvf-sort", "vod.f.sort")
  };
  Object.keys(S).forEach(function(k){
    panel.appendChild(S[k].wrap);
    S[k].sel.addEventListener("change", function(){
      var v = S[k].sel.value;
      if(k === "dec") v = v ? +v : "";
      F.f[k] = v;
      if(!v) delete F.f[k];
      F.f = V.normFilter(F.f);
      search(true);
    });
  });
  var allLab = mk("label", "tvf-check");
  var all = document.createElement("input");
  all.type = "checkbox"; all.id = "tvf-all";
  all.addEventListener("change", function(){
    if(all.checked) F.f.all = 1; else delete F.f.all;
    search(true);
  });
  var allTxt = mk("span", "", "");
  allLab.appendChild(all); allLab.appendChild(allTxt);
  panel.appendChild(allLab);
  var clr = mk("button", "tv-btn ghost tvf-clear");
  clr.type = "button";
  clr.addEventListener("click", function(){ F.f = {}; search(true); });
  panel.appendChild(clr);
  box.appendChild(panel);
  el.panel = panel; el.S = S; el.all = all; el.allTxt = allTxt; el.clear = clr;

  el.note = mk("p", "tvf-note"); el.note.hidden = true;
  el.grid = mk("div", "tvf-grid");
  el.empty = mk("p", "tvf-empty"); el.empty.hidden = true;
  var moreRow = mk("div", "tvf-more-row");
  el.more = mk("button", "tv-btn ghost");
  el.more.type = "button"; el.more.hidden = true;
  el.more.addEventListener("click", function(){ search(false); });
  moreRow.appendChild(el.more);
  box.appendChild(el.note); box.appendChild(el.grid); box.appendChild(el.empty); box.appendChild(moreRow);
  F.built = true;
  setupDetails();
}

function fillSelect(s, list, allKey){
  var cur = s.sel.value;
  s.sel.innerHTML = "";
  opt(s.sel, "", t(allKey));
  list.forEach(function(x){ opt(s.sel, x[0], x[1]); });
  s.sel.value = cur;
}

// Labels follow the language; the country / language lists follow the catalogue.
function texts(){
  el.q.placeholder = t("vod.search.ph");
  el.q.setAttribute("aria-label", t("vod.search.ph"));
  ["discover", "continue", "watch"].forEach(function(v){ el["chip_" + v].textContent = t("vod." + v); });
  Object.keys(el.S).forEach(function(k){ el.S[k].cap.textContent = t(el.S[k].key); el.S[k].sel.setAttribute("aria-label", t(el.S[k].key)); });
  fillSelect(el.S.src, [["wd", SRC_NAME.wd], ["ia", SRC_NAME.ia]], "vod.src.all");
  fillSelect(el.S.ty, V.TYPES.map(function(x){ return [x, t("vod.ty." + x)]; }), "vod.ty.all");
  fillSelect(el.S.g, V.GENRES.map(function(x){ return [x, t("vod.g." + x)]; })
    .sort(function(a, b){ return a[1].localeCompare(b[1], H.loc()); }), "vod.g.all");
  fillSelect(el.S.dec, DECADES.map(function(d){ return [String(d), d + "–" + (d + 9)]; }), "vod.dec.all");
  var cs = {}, ls = {};
  (F.wd || []).forEach(function(it){ (it.c || []).forEach(function(c){ cs[c] = 1; }); (it.l || []).forEach(function(l){ ls[l] = 1; }); });
  Object.keys(V.IA_LANG).forEach(function(l){ ls[l] = 1; });
  fillSelect(el.S.c, Object.keys(cs).map(function(c){ return [c, regionName(c)]; })
    .sort(function(a, b){ return a[1].localeCompare(b[1], H.loc()); }), "filter.allCountries");
  fillSelect(el.S.l, Object.keys(ls).map(function(c){ return [c, langName(c)]; })
    .sort(function(a, b){ return a[1].localeCompare(b[1], H.loc()); }), "filter.allLangs");
  fillSelect(el.S.len, [["short", t("vod.len.short")], ["long", t("vod.len.long")]], "vod.len.all");
  fillSelect(el.S.snd, [["silent", t("vod.snd.silent")], ["sound", t("vod.snd.sound")]], "vod.snd.all");
  var srt = el.S.sort;
  srt.sel.innerHTML = "";
  V.SORTS.forEach(function(x){ opt(srt.sel, x === "pop" ? "" : x, t("vod.sort." + x)); });
  el.allTxt.textContent = t("vod.all");
  el.clear.textContent = t("vod.clear");
  el.more.textContent = t("more");
}

function drawPanel(){
  var n = Object.keys(F.f).filter(function(k){ return k !== "sort"; }).length;
  el.fbtn.innerHTML = SVG + '<path d="M3 5h18M6 12h12M10 19h4"/></svg>';
  el.fbtn.appendChild(mk("span", "", " " + t("vod.filters") + (n ? " (" + n + ")" : "")));
  el.fbtn.setAttribute("aria-expanded", F.open ? "true" : "false");
  el.panel.hidden = !F.open;
  Object.keys(el.S).forEach(function(k){
    var v = F.f[k];
    el.S[k].sel.value = v == null ? "" : String(v);
  });
  el.all.checked = !!F.f.all;
  el.all.closest("label").hidden = F.f.src === "wd";
}

/* ===== drawing ===== */

function render(box){
  if(!F.built || !box.contains(el.grid)) build(box);
  texts();
  draw();
}

function draw(){
  ["discover", "continue", "watch"].forEach(function(v){
    var b = el["chip_" + v];
    b.classList.toggle("on", F.view === v);
    b.setAttribute("aria-selected", F.view === v ? "true" : "false");
  });
  var data = H.data() || {};
  var nc = V.continueList(data).length, nw = V.watchList(data).length;
  el.chip_continue.textContent = t("vod.continue") + (nc ? " (" + nc + ")" : "");
  el.chip_watch.textContent = t("vod.watch") + (nw ? " (" + nw + ")" : "");
  var disc = F.view === "discover";
  el.bar.hidden = !disc;
  if(disc) drawPanel(); else el.panel.hidden = true;
  if(disc){
    if(!F.items.length && !F.busy && !F.notes.length) search(true);
    else drawResults();
  }else{
    var list = F.view === "continue" ? V.continueList(data) : V.watchList(data);
    el.note.hidden = true;
    el.more.hidden = true;
    cards(list);
    el.empty.textContent = t(F.view === "continue" ? "vod.noContinue" : "vod.noWatch");
    el.empty.hidden = list.length > 0;
  }
}

function cards(list){
  el.grid.innerHTML = "";
  var data = H.data() || {};
  list.forEach(function(it){ el.grid.appendChild(card(it, data)); });
}

function card(it, data){
  var b = mk("button", "tvf-card");
  b.type = "button";
  var fig = mk("div", "tvf-thumb");
  if(it.im){
    var img = document.createElement("img");
    img.loading = "lazy"; img.decoding = "async"; img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.setAttribute("data-drop-on-error", "");
    img.src = it.im;
    fig.appendChild(img);
  }
  fig.appendChild(mk("span", "tvf-src", it.s === "wd" ? "Commons" : "Archive"));
  if(!it.ok) fig.appendChild(mk("span", "tvf-flag", t("vod.unchecked")));
  var rp = V.resumeOf(data, it.k);
  if(rp && rp.d){
    var bar = mk("span", "tvf-prog");
    var fill = mk("span", "");
    fill.style.width = Math.min(100, Math.round(rp.p / rp.d * 100)) + "%";
    bar.appendChild(fill);
    fig.appendChild(bar);
  }
  b.appendChild(fig);
  b.appendChild(mk("span", "tvf-title", title(it)));
  var sub = it.st ? (it.st[lang()] || it.st.en || "") : "";
  b.appendChild(mk("span", "tvf-meta", (sub ? sub + " · " : "") + metaLine(it)));
  b.setAttribute("aria-label", title(it) + ", " + metaLine(it));
  b.addEventListener("click", function(){ openDetails(it); });
  return b;
}

function drawResults(){
  cards(F.items);
  var notes = F.notes.slice();
  if(F.busy) notes.unshift(F.wd ? t("vod.searching") : t("vod.loading"));
  el.note.textContent = notes.join(" ");
  el.note.hidden = !notes.length;
  el.more.hidden = !F.more || F.busy;
  el.empty.textContent = t("vod.none");
  el.empty.hidden = F.busy || F.items.length > 0 || notes.length > 0;
}

/* ===== search ===== */

function srcErr(src, e){
  if(e && e.code === "offline") return t("vod.offline");
  return t(e && e.code === "busy" ? "vod.busy" : "vod.err", { src: SRC_NAME[src] });
}

// reset: a new search from page 1; otherwise the next page of every source.
function search(reset){
  if(reset){ F.page = 1; F.items = []; F.more = false; F.notes = []; el.grid.innerHTML = ""; }
  else F.page++;
  var seq = ++F.seq, page = F.page, f = V.normFilter(F.f), q = F.q;
  var srcs = f.src ? [f.src] : ["wd", "ia"];
  var notes = [];
  if(srcs.indexOf("ia") >= 0 && !V.filterSupport("ia", f)){
    srcs = srcs.filter(function(s){ return s !== "ia"; });
    if(reset) notes.push(t("vod.noIaCountry"));
  }
  if(H.offline()){
    F.busy = false; F.notes = [t("vod.offline")];
    drawPanel(); drawResults();
    return;
  }
  F.busy = true;
  F.notes = notes;
  drawPanel(); drawResults();
  var jobs = srcs.map(function(s){
    if(s === "wd"){
      return catalogue().then(function(items){
        if(seq === F.seq && page === 1) texts();     // the country / language lists
        return V.wdFilter(items, { q: q, f: f, page: page, lang: lang() });
      }).then(null, function(e){ notes.push(srcErr("wd", e)); return null; });
    }
    return getJSON(V.iaSearchUrl({ q: q, f: f, page: page, now: Date.now() })).then(function(j){
      return V.iaParseSearch(j, { f: f, page: page, now: Date.now() });
    }).then(null, function(e){ notes.push(srcErr("ia", e)); return null; });
  });
  Promise.all(jobs).then(function(res){
    if(seq !== F.seq) return;
    // Alternate the sources so neither buries the other.
    var lists = res.filter(Boolean).map(function(r){ return r.items; });
    var mixed = [], seen = {};
    F.items.forEach(function(it){ seen[it.k] = 1; });
    for(var i = 0; lists.some(function(l){ return i < l.length; }); i++){
      lists.forEach(function(l){ var it = l[i]; if(it && !seen[it.k]){ seen[it.k] = 1; mixed.push(it); } });
    }
    F.items = F.items.concat(mixed);
    F.more = res.some(function(r){ return r && r.more; });
    if(F.wdOld && srcs.indexOf("wd") >= 0) notes.push(t("vod.cat.old", { date: new Date(F.wdAt).toLocaleDateString(H.loc()) }));
    F.notes = notes;
    F.busy = false;
    drawResults();
  });
}

/* ===== details + playback ===== */

function setupDetails(){
  var d = document.getElementById("tv-film");
  if(!d) return;
  el.dlg = d;
  var close = document.getElementById("tvf-close");
  close.innerHTML = SVG + '<path d="M6 6l12 12M18 6L6 18"/></svg>';
  close.addEventListener("click", function(){ d.close(); });
  d.addEventListener("click", function(e){ if(e.target === d) d.close(); });
  document.getElementById("tvf-play").addEventListener("click", function(){ play(F.cur, null, false); });
  document.getElementById("tvf-restart").addEventListener("click", function(){ play(F.cur, 0, true); });
  document.getElementById("tvf-wl").addEventListener("click", function(){
    if(!F.cur) return;
    H.toggleWatch(stored(F.cur));
    detailButtons();
  });
  document.getElementById("tvf-drop").addEventListener("click", function(){
    if(!F.cur) return;
    H.dropResume(F.cur.k);
    detailButtons();
  });
}

function $(id){ return document.getElementById(id); }

function status(text){
  var s = $("tvf-status");
  s.textContent = text || "";
  s.hidden = !text;
}

function detailButtons(){
  var it = F.cur;
  if(!it) return;
  var data = H.data() || {};
  var rp = V.resumeOf(data, it.k);
  var on = V.watchOn(data, it.k);
  var wl = $("tvf-wl");
  wl.textContent = on ? "✓ " + t("vod.wl.on") : "+ " + t("vod.wl.add");
  wl.setAttribute("aria-pressed", on ? "true" : "false");
  var at = rp ? (rp.n ? t("vod.part", { n: rp.n + 1 }) + " · " : "") + H.clock(rp.p) : "";
  $("tvf-play").textContent = rp ? t("vod.resume", { time: at }) : t("vod.play");
  $("tvf-restart").textContent = t("vod.restart");
  $("tvf-restart").hidden = !rp;
  $("tvf-drop").textContent = t("vod.cont.drop");
  $("tvf-drop").hidden = !rp;
  draw();
}

function pageOf(it){
  if(it.s === "ia") return "https://archive.org/details/" + encodeURIComponent(it.k.slice(3));
  return "https://www.wikidata.org/wiki/" + it.k.slice(3);
}

function whyText(it){
  if(it.why === "age") return t("vod.why.age", { y: it.y });
  if(it.why === "prelinger") return t("vod.why.prelinger");
  if(it.why === "listed") return t("vod.why.listed");
  return t("vod.why.commons");
}

// Item details: the Internet Archive item is read for its parts and
// description; a Commons film lists its files as parts.
function openDetails(it){
  if(!el.dlg || !it) return;
  F.cur = it; F.parts = null;
  $("tvf-title").textContent = title(it);
  var sub = it.st ? (it.st[lang()] || it.st.en || "") : "";
  $("tvf-meta").textContent = (sub ? t("vod.ofSeries", { name: sub }) + " · " : "") + metaLine(it);
  var dir = $("tvf-dir");
  dir.textContent = it.dir ? t("vod.dir", { name: it.dir }) : "";
  dir.hidden = !it.dir;
  var tags = [];
  (it.g || []).forEach(function(g){ tags.push(t("vod.g." + g)); });
  (it.c || []).forEach(function(c){ tags.push(regionName(c)); });
  (it.l || []).forEach(function(l){ tags.push(langName(l)); });
  if(it.snd) tags.push(t("vod.snd." + it.snd));
  $("tvf-tags").textContent = tags.join(" · ");
  $("tvf-tags").hidden = !tags.length;
  var img = $("tvf-img");
  if(it.im){ img.src = it.im; img.hidden = false; } else { img.removeAttribute("src"); img.hidden = true; }
  $("tvf-desc").hidden = true;
  $("tvf-why").textContent = whyText(it);
  $("tvf-why").classList.toggle("warn", !it.ok);
  var src = $("tvf-src");
  src.href = pageOf(it);
  src.textContent = t("vod.source");
  src.hidden = false;
  $("tvf-parts-wrap").hidden = true;
  status("");
  $("tvf-play").disabled = false;
  detailButtons();
  if(!el.dlg.open) el.dlg.showModal();
  if(it.s === "ia") loadIaItem(it);
  else if(it.v && it.v.length > 1) showParts(it, it.v.map(function(f, i){ return { name: t("vod.part", { n: i + 1 }), file: f }; }));
  else if(!it.v){
    // From Continue / Watchlist: the catalogue knows the files.
    catalogue().then(function(items){
      if(F.cur !== it) return;
      var full = items.filter(function(x){ return x.k === it.k; })[0];
      if(full){ F.cur = full; if(full.v && full.v.length > 1) showParts(full, full.v.map(function(f, i){ return { name: t("vod.part", { n: i + 1 }), file: f }; })); }
    }, function(){});
  }
}

function loadIaItem(it){
  status(t("vod.opening"));
  getJSON(V.iaMetaUrl(it.k.slice(3))).then(function(j){
    if(F.cur !== it) return;
    var m = V.iaParseMeta(j, it.k.slice(3));
    if(!m || m.closed){ status(t("vod.err.closed")); $("tvf-play").disabled = true; return; }
    status("");
    F.parts = m.parts;
    if(m.desc){ $("tvf-desc").textContent = m.desc; $("tvf-desc").hidden = false; }
    if(m.parts.length > 1) showParts(it, m.parts);
  }, function(e){
    if(F.cur !== it) return;
    status(srcErr("ia", e));
  });
}

function showParts(it, parts){
  var box = $("tvf-parts");
  box.innerHTML = "";
  $("tvf-parts-h").textContent = t(it.ty === "series" ? "vod.episodes" : "vod.parts");
  parts.forEach(function(p, i){
    var b = mk("button", "tvf-part");
    b.type = "button";
    b.textContent = (i + 1) + ". " + p.name + (p.min ? " · " + t("vod.min", { n: p.min }) : "");
    b.addEventListener("click", function(){ play(it, i, true); });
    box.appendChild(b);
  });
  $("tvf-parts-wrap").hidden = false;
}

function canPlay(mime){
  var v = document.getElementById("tvp-video") || document.createElement("video");
  return v.canPlayType(mime) || "";
}

// part: null = where it stopped (or the first part); fresh: from 0:00;
// auto: the next part after the last one ended (the details window may
// show another item by then, so its buttons are left alone).
function play(it, part, fresh, auto){
  if(!it) return;
  if(auto) F.cur = it;
  var data = H.data() || {};
  var rp = fresh ? null : V.resumeOf(data, it.k);
  var n = part != null ? part : rp && rp.n ? rp.n : 0;
  var at = rp && (rp.n || 0) === n ? rp.p : 0;
  $("tvf-play").disabled = true;
  status(t("vod.opening"));
  resolve(it, n).then(function(r){
    $("tvf-play").disabled = false;
    if(F.cur !== it) return;
    status("");
    var parts = r.parts;
    var meta = metaLine(it);
    H.playVod({
      it: stored(it), url: r.url, page: r.page || pageOf(it),
      title: title(it) + (parts > 1 ? " · " + (r.name || t("vod.part", { n: n + 1 })) : ""),
      meta: meta, labels: r.lic ? t("vod.lic", { lic: r.lic }) : "",
      part: n, parts: parts, at: at,
      onEnd: n + 1 < parts ? function(){ play(it, n + 1, true, true); } : null
    });
    if(el.dlg.open) el.dlg.close();
  }, function(e){
    $("tvf-play").disabled = false;
    if(F.cur !== it) return;
    status(e && e.code === "closed" ? t("vod.err.closed") : e && e.code === "format" ? t("vod.err.format")
      : e && e.code === "offline" ? t("vod.offline") : t("vod.err.net"));
  });
}

// -> Promise<{ url, page, parts, name, lic }>
function resolve(it, n){
  if(it.s === "ia"){
    var got = F.parts && F.cur === it ? Promise.resolve({ parts: F.parts })
      : getJSON(V.iaMetaUrl(it.k.slice(3))).then(function(j){ return V.iaParseMeta(j, it.k.slice(3)); });
    return got.then(function(m){
      if(!m || !m.parts || !m.parts.length) throw new NetErr("closed");
      F.parts = m.parts;
      var ok = m.parts.filter(function(p){ return !p.ogg || canPlay("video/ogg"); });
      var p = m.parts[n] && (!m.parts[n].ogg || canPlay("video/ogg")) ? m.parts[n] : ok[0];
      if(!p) throw new NetErr("format");
      return { url: p.url, page: pageOf(it), parts: m.parts.length, name: p.name };
    });
  }
  var files = it.v && it.v.length ? Promise.resolve(it.v) : catalogue().then(function(items){
    var full = items.filter(function(x){ return x.k === it.k; })[0];
    if(!full || !full.v) throw new NetErr("closed");
    return full.v;
  });
  return files.then(function(v){
    var file = v[Math.min(n, v.length - 1)];
    return getJSON(V.commonsInfoUrl(file)).then(function(j){
      var pages = j && j.query && j.query.pages;
      var p0 = Array.isArray(pages) ? pages[0] : null;
      if(p0 && p0.missing) throw new NetErr("closed");
      var pick = V.commonsPick(j, canPlay);
      if(!pick) throw new NetErr("format");
      return { url: pick.url, page: pick.page || V.filePath(file), parts: v.length, lic: pick.lic };
    });
  });
}

window.orosTvFilms = {
  render: render,
  // The player closed or the synced lists changed: counts and progress.
  refresh: function(){ if(F.built && !document.getElementById("tv-films").hidden) draw(); }
};
})();
