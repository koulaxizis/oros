// Writes assets.json: GitHub release asset name → package, per repository and
// release tag ("*" = every release), for the counter's cron (worker.js ASSETS).
// orOS from tools/fdroid-metadata.js list(); NULL JSFX and Noxpress by hand.
// Usage: node tools/apps-counter/assets.js
const fs = require("fs");
const path = require("path");
const { list } = require("../fdroid-metadata.js");
const oros = {};
const mgr = {};
for (const a of list()) (a.apk === "koulaxizis-apps.apk" ? mgr : oros)[a.apk] = a.pkg;
const out = {
  "koulaxizis/oros": { "android-apks": oros, "koulaxizis-apps": mgr },
  "koulaxizis/null-jsfx": { "*": {
    "NULL-JSFX-Remote-DAWs-Android.apk": "tech.nulljsfx.remote.daws",
    "NULL-JSFX-Remote-Mixers-Android.apk": "tech.nulljsfx.remote.mixers",
  } },
  "koulaxizis/noxpress": { "*": {
    "site-bridge.apk": "tech.noxpress.sitebridge",
    "live-operator.apk": "tech.noxpress.liveoperator",
  } },
};
fs.writeFileSync(path.join(__dirname, "assets.json"), JSON.stringify(out, null, 2) + "\n");
console.log(Object.keys(oros).length + Object.keys(mgr).length + 4 + " assets");
