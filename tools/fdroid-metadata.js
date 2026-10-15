#!/usr/bin/env node
// Writes the F-Droid repository metadata for the orOS APKs (FDROID-1):
// one metadata/<package>.yml per app plus its English and Greek name,
// summary, description and icon, from android/solo-apps.json and
// solo.js. .github/workflows/fdroid.yml runs it before `fdroid update`.
//   node tools/fdroid-metadata.js <fdroid dir>
// Also writes <fdroid dir>/apks.json: APK file name → package, so the
// workflow can check that every APK it publishes has its metadata.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const S = require(path.join(ROOT, "solo.js"));
const APPS = JSON.parse(fs.readFileSync(path.join(ROOT, "android", "solo-apps.json"), "utf8")).apps;

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
      "Free and open source (MIT), free forever. More: " + WEB
  },
  el: {
    summary: "Μέρος του orOS: χωρίς σύνδεση, χωρίς cookies, χωρίς παρακολούθηση",
    orosSummary: "Χώρος εργασίας χωρίς σύνδεση: σημειώσεις, γραφείο, οικονομικά, υγεία, χάρτες",
    body: (n) => n + ": η εφαρμογή του orOS μόνη της. Δουλεύει χωρίς σύνδεση, χωρίς cookies, χωρίς παρακολούθηση· κρυπτογραφημένος συγχρονισμός μόνο αν τον ανοίξεις.\n\n" +
      "Το περιεχόμενο της εφαρμογής ενημερώνεται μόνο του από το useoros.online. Νέο APK βγαίνει μόνο όταν αλλάζει το κέλυφος Android της εφαρμογής (εικονίδιο, όνομα, λειτουργίες του κινητού).\n\n" +
      "Δωρεάν και ανοιχτού κώδικα (MIT), δωρεάν για πάντα. Περισσότερα: " + WEB,
    oros: "Το orOS είναι ένας χώρος εργασίας χωρίς σύνδεση σε μία εφαρμογή: σημειώσεις, ημερολόγιο, γραφείο, οικονομικά, υγεία, χάρτες, πολυμέσα, παιχνίδια και άλλα. Δουλεύει χωρίς σύνδεση, χωρίς cookies, χωρίς παρακολούθηση· κρυπτογραφημένος συγχρονισμός μόνο αν τον ανοίξεις.\n\n" +
      "Το περιεχόμενο της εφαρμογής ενημερώνεται μόνο του από το useoros.online. Νέο APK βγαίνει μόνο όταν αλλάζει το κέλυφος Android της εφαρμογής (εικονίδιο, όνομα, λειτουργίες του κινητού).\n\n" +
      "Δωρεάν και ανοιχτού κώδικα (MIT), δωρεάν για πάντα. Περισσότερα: " + WEB
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

function texts(a, l) {
  const T = TEXT[l];
  const name = a.id === "oros" ? "orOS" : S.nameOf(a.id, l);
  return {
    name,
    summary: a.id === "oros" ? T.orosSummary : T.summary,
    description: a.id === "oros" ? T.oros : T.body(name)
  };
}

function yml(a) {
  return [
    "Categories:",
    "  - " + (a.id === "gamecenter" ? "Games" : "Office"),
    "License: MIT",
    "AuthorName: orOS",
    "WebSite: " + WEB,
    "SourceCode: " + SOURCE,
    "IssueTracker: " + SOURCE + "/issues",
    "Donate: " + DONATE,
    ""
  ].join("\n");
}

function write(dir) {
  const meta = path.join(dir, "metadata");
  const apks = {};
  for (const a of list()) {
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
      if (l === "en") fs.copyFileSync(a.icon, path.join(d, "icon.png"));
    }
  }
  fs.writeFileSync(path.join(dir, "apks.json"), JSON.stringify(apks, null, 2) + "\n");
  return apks;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: node tools/fdroid-metadata.js <fdroid dir>"); process.exit(2); }
  const apks = write(dir);
  console.log("metadata for " + Object.keys(apks).length + " apps");
}
module.exports = { list, texts, write, TEXT };
