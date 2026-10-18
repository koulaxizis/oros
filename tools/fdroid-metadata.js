#!/usr/bin/env node
// Writes the F-Droid repository metadata for the orOS APKs (FDROID-1):
// one metadata/<package>.yml per app plus its English and Greek name,
// summary, description, icon, feature graphic and phone screenshots,
// from android/solo-apps.json, solo.js and tools/fdroid/<id>/
// (texts.json, feature.jpg, <lang>-<n>.jpg). Also writes site/index.html,
// the repository's front page with the add link, QR code and app list.
// .github/workflows/fdroid.yml runs it before `fdroid update`.
//   node tools/fdroid-metadata.js <fdroid dir>
// Also writes <fdroid dir>/apks.json: APK file name → package, so the
// workflow can check that every APK it publishes has its metadata.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const S = require(path.join(ROOT, "solo.js"));
const APPS = JSON.parse(fs.readFileSync(path.join(ROOT, "android", "solo-apps.json"), "utf8")).apps;
const STORE = path.join(__dirname, "fdroid");

const WEB = "https://useoros.online/";
const SOURCE = "https://github.com/koulaxizis/oros";
const DONATE = "https://ko-fi.com/koulaxizis";

const TEXT = {
  en: {
    summary: "Part of orOS: works offline, no cookies, no tracking",
    orosSummary: "Your offline-first workspace: notes, office, money, health, maps and more",
    body: (n) => n + ": the orOS app on its own. Works offline, no cookies, no tracking; encrypted sync only if you turn it on.\n\n" +
      "The app's content updates by itself from useoros.online. A new APK is only published when the app's Android shell changes (icon, name, phone features).\n\n" +
      "Free and open source (MIT), free forever. More: " + WEB,
    oros: "orOS is an offline-first workspace in one app: notes, calendar, office, money, health, maps, media, games and more. Works offline, no cookies, no tracking; encrypted sync only if you turn it on.\n\n" +
      "The app's content updates by itself from useoros.online. A new APK is only published when the app's Android shell changes (icon, name, phone features).\n\n" +
      "Free and open source (MIT), free forever. More: " + WEB,
    // The repository page (site()) shows these under the English text
    siteTitle: "The orOS F-Droid repository",
    siteHowto: "On your phone, tap the button or scan the QR code with F-Droid or Droid-ify. Then install any orOS app you like; updates come by themselves."
  },
  el: {
    summary: "Μέρος του orOS: χωρίς σύνδεση, χωρίς cookies, χωρίς παρακολούθηση",
    orosSummary: "Χώρος εργασίας χωρίς σύνδεση: σημειώσεις, γραφείο, οικονομικά, υγεία, χάρτες",
    body: (n) => n + ": η εφαρμογή του orOS μόνη της. Δουλεύει χωρίς σύνδεση, χωρίς cookies, χωρίς παρακολούθηση· κρυπτογραφημένος συγχρονισμός μόνο αν τον ανοίξεις.\n\n" +
      "Το περιεχόμενο της εφαρμογής ενημερώνεται μόνο του από το useoros.online. Νέο APK βγαίνει μόνο όταν αλλάζει το κέλυφος Android της εφαρμογής (εικονίδιο, όνομα, λειτουργίες του κινητού).\n\n" +
      "Δωρεάν και ανοιχτού κώδικα (MIT), δωρεάν για πάντα. Περισσότερα: " + WEB,
    oros: "Το orOS είναι ένας χώρος εργασίας χωρίς σύνδεση σε μία εφαρμογή: σημειώσεις, ημερολόγιο, γραφείο, οικονομικά, υγεία, χάρτες, πολυμέσα, παιχνίδια και άλλα. Δουλεύει χωρίς σύνδεση, χωρίς cookies, χωρίς παρακολούθηση· κρυπτογραφημένος συγχρονισμός μόνο αν τον ανοίξεις.\n\n" +
      "Το περιεχόμενο της εφαρμογής ενημερώνεται μόνο του από το useoros.online. Νέο APK βγαίνει μόνο όταν αλλάζει το κέλυφος Android της εφαρμογής (εικονίδιο, όνομα, λειτουργίες του κινητού).\n\n" +
      "Δωρεάν και ανοιχτού κώδικα (MIT), δωρεάν για πάντα. Περισσότερα: " + WEB,
    siteTitle: "Το αποθετήριο F-Droid του orOS",
    siteHowto: "Στο κινητό πάτα το κουμπί ή σκάναρε τον κωδικό QR από το F-Droid ή το Droid-ify. Μετά εγκατέστησε όποια εφαρμογή του orOS θέλεις· οι ενημερώσεις έρχονται μόνες τους."
  }
};
const LOCALE = { en: "en-US", el: "el" };

// Every APK the android workflow publishes: oros.apk and oros-<id>.apk
function list() {
  const out = [{ id: "oros", pkg: "online.useoros.twa", apk: "oros.apk", icon: path.join(ROOT, "icons", "icon-512.png") }];
  for (const [id, pkg] of Object.entries(APPS)) {
    out.push({ id, pkg, apk: "oros-" + id + ".apk", icon: path.join(ROOT, "icons", "solo", id + "-512.png") });
  }
  return out;
}

// Hand-written store texts and pictures per app (tools/fdroid/<id>/)
function store(id) {
  try { return JSON.parse(fs.readFileSync(path.join(STORE, id, "texts.json"), "utf8")); } catch (e) { return null; }
}
// Phone screenshots, in order: tools/fdroid/<id>/<lang>-<n>.jpg|png
function shots(id, l) {
  let names = [];
  try { names = fs.readdirSync(path.join(STORE, id)); } catch (e) { return []; }
  const re = new RegExp("^" + l + "-(\\d+)\\.(jpg|png)$");
  return names.filter((f) => re.test(f))
    .sort((x, y) => Number(x.match(re)[1]) - Number(y.match(re)[1]))
    .map((f) => path.join(STORE, id, f));
}
function feature(id) {
  const f = path.join(STORE, id, "feature.jpg");
  return fs.existsSync(f) ? f : "";
}

function texts(a, l) {
  const T = TEXT[l];
  const name = a.id === "oros" ? "orOS" : S.nameOf(a.id, l);
  const own = store(a.id);
  if (own && own[l] && own[l].summary && own[l].description) {
    return { name, summary: own[l].summary, description: own[l].description };
  }
  return {
    name,
    summary: a.id === "oros" ? T.orosSummary : T.summary,
    description: a.id === "oros" ? T.oros : T.body(name)
  };
}

function category(a) {
  const own = store(a.id);
  return (own && own.category) || (a.id === "gamecenter" ? "Games" : "Office");
}

function yml(a) {
  return [
    "Categories:",
    "  - " + category(a),
    "License: MIT",
    "AuthorName: orOS",
    "AuthorWebSite: " + WEB,
    "WebSite: " + WEB + (a.id === "oros" ? "" : a.id + "/"),
    "SourceCode: " + SOURCE,
    "IssueTracker: " + SOURCE + "/issues",
    "Translation: " + SOURCE,
    "Donate: " + DONATE,
    ""
  ].join("\n");
}

function esc(t) {
  return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
}

// The repository's front page (koulaxizis.github.io/oros-fdroid/):
// how to add it, the QR code fdroid makes (repo/index.png), and the apps.
function site(apps, repo, fp) {
  const add = "https://fdroid.link/#" + repo + "?fingerprint=" + fp;
  const row = (a) => {
    const en = texts(a, "en"), el = texts(a, "el");
    return '<li><img src="icons/' + a.pkg + '.png" alt="" width="48" height="48" loading="lazy"><div><b>' + esc(en.name) + "</b>" +
      (el.name !== en.name ? ' <span class="el">' + esc(el.name) + "</span>" : "") + "<br><small>" + esc(en.summary) + "</small></div></li>";
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>orOS F-Droid repository</title>
<meta name="description" content="The orOS Android apps for F-Droid, Droid-ify and Obtainium. Free and open source (MIT), free forever.">
<link rel="icon" href="icons/online.useoros.twa.png">
<style>
:root { color-scheme: light dark; --bg: #f6f6f4; --card: #fff; --ink: #1d1d1d; --muted: #666; --line: #e3e3e0; --accent: #1f6feb; --on-accent: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #141414; --card: #1e1e1e; --ink: #eee; --muted: #a8a8a8; --line: #333; --accent: #6ea8fe; --on-accent: #0b1a33; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
header { display: flex; gap: 16px; align-items: center; }
header img { border-radius: 16px; }
h1 { margin: 0; font-size: 1.6rem; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-top: 18px; }
.add { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; }
.add ol { margin: 0; padding-left: 1.2em; flex: 1 1 280px; }
.qr { background: #fff; padding: 8px; border-radius: 10px; }
.btn { display: inline-block; margin-top: 10px; background: var(--accent); color: var(--on-accent); text-decoration: none; padding: 10px 16px; border-radius: 10px; font-weight: 600; }
code { word-break: break-all; font-size: .85em; color: var(--muted); }
ul.apps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
ul.apps li { display: flex; gap: 10px; align-items: center; }
ul.apps img { border-radius: 12px; flex: none; }
.el, small, .muted { color: var(--muted); }
a { color: var(--accent); }
</style>
</head>
<body>
<main>
<header><img src="icons/online.useoros.twa.png" alt="" width="64" height="64"><div><h1>orOS F-Droid repository</h1>
<div class="muted">${TEXT.el.siteTitle} · ${apps.length} apps · free and open source (MIT), free forever</div></div></header>
<section class="card add">
<img class="qr" src="repo/index.png" alt="QR code of the repository" width="180" height="180">
<ol>
<li>Install <a href="https://f-droid.org/">F-Droid</a>, <a href="https://droid-ify.com/">Droid-ify</a> or <a href="https://obtainium.imranr.dev/">Obtainium</a>.</li>
<li>On your phone, tap the button below, or scan the QR code with the app.</li>
<li>Install any orOS app; updates then come by themselves.</li>
</ol>
<div style="flex-basis:100%">
<a class="btn" href="${esc(add)}">Add the orOS repository</a>
<p class="muted">${TEXT.el.siteHowto}</p>
<p>Address: <code>${esc(repo)}</code><br>Fingerprint (SHA-256): <code>${esc(fp)}</code></p>
</div>
</section>
<section class="card">
<ul class="apps">
${apps.map(row).join("\n")}
</ul>
</section>
<p class="muted">More about orOS: <a href="${WEB}">useoros.online</a> · source: <a href="${SOURCE}">github.com/koulaxizis/oros</a> · support: <a href="${DONATE}">Ko-fi</a></p>
</main>
</body>
</html>
`;
}

function write(dir, opts) {
  opts = opts || {};
  const meta = path.join(dir, "metadata");
  const apks = {};
  const all = list();
  for (const a of all) {
    apks[a.apk] = a.pkg;
    fs.mkdirSync(meta, { recursive: true });
    fs.writeFileSync(path.join(meta, a.pkg + ".yml"), yml(a));
    for (const l of Object.keys(TEXT)) {
      const d = path.join(meta, a.pkg, LOCALE[l]);
      fs.mkdirSync(d, { recursive: true });
      const t = texts(a, l);
      fs.writeFileSync(path.join(d, "name.txt"), t.name + "\n");
      fs.writeFileSync(path.join(d, "summary.txt"), t.summary + "\n");
      fs.writeFileSync(path.join(d, "description.txt"), t.description + "\n");
      if (l === "en") {
        fs.copyFileSync(a.icon, path.join(d, "icon.png"));
        const g = feature(a.id);
        if (g) fs.copyFileSync(g, path.join(d, "featureGraphic.jpg"));
      }
      const sh = shots(a.id, l);
      if (sh.length) {
        const sd = path.join(d, "phoneScreenshots");
        fs.mkdirSync(sd, { recursive: true });
        sh.forEach((f, i) => fs.copyFileSync(f, path.join(sd, (i + 1) + path.extname(f))));
      }
    }
  }
  fs.writeFileSync(path.join(dir, "apks.json"), JSON.stringify(apks, null, 2) + "\n");
  // The address and key fingerprint orOS itself uses (solo.js repoLink)
  const m = String(S.repoLink()).match(/^fdroidrepos:\/\/([^?]+)\?fingerprint=([0-9A-F]{64})$/);
  const repo = opts.repo || (m && "https://" + m[1]), fp = opts.fp || (m && m[2]);
  if (repo && fp) {
    fs.mkdirSync(path.join(dir, "site", "icons"), { recursive: true });
    for (const a of all) fs.copyFileSync(a.icon.replace(/-512\.png$/, "-192.png"), path.join(dir, "site", "icons", a.pkg + ".png"));
    fs.writeFileSync(path.join(dir, "site", "index.html"), site(all, repo, fp));
  }
  return apks;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: node tools/fdroid-metadata.js <fdroid dir>"); process.exit(2); }
  const apks = write(dir);
  console.log("metadata for " + Object.keys(apks).length + " apps");
}
module.exports = { list, texts, category, shots, feature, site, write, TEXT };
