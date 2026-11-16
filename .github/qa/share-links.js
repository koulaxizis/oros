// orOS quality gate: "Send to someone" links in Chromium AND Firefox
// (BR-SHARE-CUT, 2026-11-16). CI only, like smoke.js.
//
// A song link opened on a friend's phone in Firefox for Android showed
// "This link is damaged or incomplete" while it opened for the sender,
// so the receiving page (share/) is checked in both engines:
//   • a song link made in the page (CompressionStream) opens;
//   • the same song made the way the relay makes it (zlib deflate-raw,
//     what a short link /p/s.<id> forwards to) opens;
//   • both open again with DecompressionStream taken away (the plain-JS
//     inflate in share/kinds.js);
//   • a link with punctuation, a space or a line break after or inside
//     it opens; a link cut short shows the "cut short" message, never
//     the general "damaged" one.
//
// Usage: node .github/qa/share-links.js [--out file] [--browsers chromium,firefox]
"use strict";

const fs = require("fs");
const zlib = require("zlib");
const QA = require("./smoke.js");

const SONG = {
  t: "Μια μέρα θα φύγω", a: "Some Artist", s: "jm", al: "An album name here", y: "2021", d: 241,
  u: "https://prod-1.storage.jamendo.com/?trackid=1234567&format=mp31&from=abcdefghijklmn%3D%3D%7Cxyz",
  pg: "https://www.jamendo.com/track/1234567/mia-mera",
  art: "https://usercontent.jamendo.com?type=album&id=123456&width=300&trackid=1234567",
  k: "jm:1234567", li: "by-nc-sa 3.0",
  cr: "\"Μια μέρα θα φύγω\" by Some Artist, licensed under CC BY-NC-SA 3.0 (jamendo.com)"
};
function b64u(buf) { return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

async function main() {
  const argv = process.argv;
  const out = argv.indexOf("--out") > 0 ? argv[argv.indexOf("--out") + 1] : null;
  const names = (argv.indexOf("--browsers") > 0 ? argv[argv.indexOf("--browsers") + 1] : "chromium,firefox").split(",");
  const pw = QA.loadPlaywright();
  const srv = await QA.serve();
  const base = "http://127.0.0.1:" + srv.address().port + "/share/";
  const fails = [], notes = [];
  const ok = (cond, what) => { (cond ? notes : fails).push(what); console.log((cond ? "ok   " : "FAIL ") + what); };

  for (const name of names) {
    const browser = await pw[name].launch(name === "chromium" ? QA.launchOptions() : {});
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, serviceWorkers: "block", locale: "en-US" });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort());
    const errs = [];
    async function open(hash, noStreams) {
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errs.push(String(e.message || e).split("\n")[0]));
      if (noStreams) await page.addInitScript(() => { delete window.DecompressionStream; delete window.CompressionStream; });
      await page.goto(base + "#" + hash, { waitUntil: "load" });
      await page.waitForFunction(() => {
        const s = document.querySelector("#card .state");
        return !s || !/Opening/.test(s.textContent);
      }, null, { timeout: 10000 }).catch(() => {});
      const r = await page.evaluate(() => ({
        h1: (document.querySelector("#card h1") || {}).textContent || "",
        state: (document.querySelector("#card .state") || {}).textContent || "",
        hint: Array.from(document.querySelectorAll("#card .hint")).map((n) => n.textContent).join(" | ")
      }));
      await page.close();
      return r;
    }
    const first = await ctx.newPage();
    await first.goto(base, { waitUntil: "load" });
    const made = await first.evaluate((song) => {
      const K = window.OrosShareKinds;
      const env = K.pack("track", song);
      return K.encode(env).then((code) => ({ code, json: JSON.stringify(env) }));
    }, SONG);
    await first.close();
    const relayCode = "1." + b64u(zlib.deflateRawSync(Buffer.from(made.json)));
    const opens = (r) => r.h1 === SONG.t;

    for (const [label, code] of [["page-made", made.code], ["relay-made", relayCode]]) {
      ok(opens(await open(code)), name + ": " + label + " song link opens");
      ok(opens(await open(code, true)), name + ": " + label + " song link opens without DecompressionStream");
    }
    for (const [label, h] of [
      ["full stop after", made.code + "."],
      ["space after", made.code + "%20"],
      ["line break inside", made.code.slice(0, 100) + "%0A" + made.code.slice(100)],
      ["closing quote after", made.code + "%E2%80%9D"]
    ]) ok(opens(await open(h)), name + ": link with " + label + " opens");
    for (const n of [made.code.length - 1, made.code.length - 30, 120]) {
      const r = await open(made.code.slice(0, n));
      ok(/cut short/.test(r.state) && /characters arrived/.test(r.hint), name + ": link cut to " + n + " says cut short (" + r.state.slice(0, 40) + ")");
      const r2 = await open(made.code.slice(0, n), true);
      ok(/cut short/.test(r2.state), name + ": link cut to " + n + " says cut short without DecompressionStream");
    }
    ok(!errs.length, name + ": no page errors" + (errs.length ? " (" + errs.join("; ") + ")" : ""));
    await browser.close();
  }
  srv.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fails, notes }, null, 2));
  console.log(fails.length ? "\n" + fails.length + " failed" : "\nall " + notes.length + " passed");
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
