// APK download counter for our F-Droid repositories (APPS-DL, Chris 2026-11-19,
// card «Μετρητής Cloudflare»). Deployed as the Worker "apps" at
// https://apps.koulaxizis.workers.dev.
//
// - GET/HEAD /<repo>/<path> for the three repositories in REPOS is passed to
//   GitHub Pages (https://koulaxizis.github.io/<repo>/<path>) unchanged.
//   A full download of /<repo>/repo/<package>_<code>[_<hash>].apk adds 1 to
//   (package, channel). The channel comes from the client's User-Agent only
//   (Koulaxizis Apps, F-Droid, Droid-ify, Obtainium, other). Nothing else is
//   kept: no address, no device, no time per request.
// - A cron reads the public download counts of our GitHub release APKs (the
//   site buttons, and Obtainium where it follows GitHub releases) into a
//   ledger by asset id that never goes down, so re-uploaded assets keep their
//   count.
// - /stats.json gives every package's counts per channel, plus the counts we
//   record by hand (table man, e.g. the old Play Store count), for the sites.
// The asset map (release asset name → package) is ASSETS below, written by
// tools/apps-counter/assets.js; deploy steps in README.md.

const UP = "https://koulaxizis.github.io";
const REPOS = new Set(["oros-fdroid", "null-jsfx-fdroid", "noxpress-fdroid"]);
const PASS = ["range", "if-none-match", "if-modified-since", "if-range"];
const KEEP = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control", "expires"];
const ASSETS = /*ASSETS*/ {};

export function channel(ua) {
  ua = String(ua || "");
  if (/^KoulaxizisApps\/\d+ \(test\)/.test(ua)) return null; // the manager's debug build in CI
  if (/^KoulaxizisApps\//.test(ua)) return "manager";
  if (/obtainium/i.test(ua)) return "obtainium";
  if (/droid-?ify|com\.looker\.droidify/i.test(ua)) return "droidify";
  if (/f-?droid/i.test(ua)) return "fdroid";
  return "other";
}

// "/repo/<pkg>_<code>[_<8 hex>].apk" → pkg, else null.
export function apkPackage(rest) {
  const m = /^repo\/([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)_(\d{1,12})(?:_[0-9a-f]{8})?\.apk$/.exec(rest);
  return m ? m[1] : null;
}

export function safePath(rest) {
  return rest.length < 300 && /^[A-Za-z0-9._\/-]*$/.test(rest) && !/(^|\/)\.\.?(\/|$)/.test(rest) && !rest.includes("//");
}

// A download that starts at the first byte counts once; resumed parts do not.
export function counts(method, status, range) {
  if (method !== "GET") return false;
  if (status === 200) return true;
  return status === 206 && /^bytes=0-/.test(String(range || ""));
}

function cors(r) {
  r.headers.set("Access-Control-Allow-Origin", "*");
  return r;
}

async function stats(env) {
  const cache = caches.default;
  const key = new Request("https://apps.koulaxizis.workers.dev/stats.json");
  const hit = await cache.match(key);
  if (hit) return cors(new Response(hit.body, hit));
  const [dl, gh, man] = await env.DB.batch([
    env.DB.prepare("SELECT pkg, ch, n FROM dl"),
    env.DB.prepare("SELECT pkg, SUM(n) AS n FROM gh_asset GROUP BY pkg"),
    env.DB.prepare("SELECT pkg, ch, n, at FROM man"),
  ]);
  const apps = {};
  const row = (p) => (apps[p] = apps[p] || {});
  for (const r of dl.results) row(r.pkg)[r.ch] = r.n;
  for (const r of gh.results) row(r.pkg).github = r.n;
  for (const r of man.results) row(r.pkg)[r.ch] = { n: r.n, at: r.at };
  const meta = await env.DB.prepare("SELECT v FROM meta WHERE k = 'gh_at'").first();
  const files = {};
  for (const [repo, rels] of Object.entries(ASSETS)) for (const names of Object.values(rels)) for (const [name, pkg] of Object.entries(names)) files[repo + "/" + name] = pkg;
  const body = JSON.stringify({ v: 1, at: new Date().toISOString(), github_at: meta ? meta.v : null, apps, files });
  const res = new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
  await cache.put(key, res.clone());
  return cors(res);
}

async function proxy(req, env, ctx, repo, rest) {
  const h = new Headers({ "user-agent": "koulaxizis-apps-counter" });
  for (const k of PASS) if (req.headers.get(k)) h.set(k, req.headers.get(k));
  const up = await fetch(UP + "/" + repo + "/" + rest, { method: req.method, headers: h, redirect: "manual" });
  const out = new Headers();
  for (const k of KEEP) if (up.headers.get(k)) out.set(k, up.headers.get(k));
  const pkg = apkPackage(rest);
  const ch = channel(req.headers.get("user-agent"));
  if (pkg && ch && counts(req.method, up.status, req.headers.get("range"))) {
    ctx.waitUntil(env.DB.prepare("INSERT INTO dl (pkg, ch, n) VALUES (?1, ?2, 1) ON CONFLICT (pkg, ch) DO UPDATE SET n = n + 1")
      .bind(pkg, ch).run().catch(() => {}));
  }
  return new Response(req.method === "HEAD" ? null : up.body, { status: up.status, headers: out });
}

async function github(env) {
  const writes = [];
  for (const [repo, rels] of Object.entries(ASSETS)) {
    for (const [tag, names] of Object.entries(rels)) {
      // One release by tag, or every release (up to 5 pages of 100).
      for (let page = 1; page <= (tag === "*" ? 5 : 1); page++) {
        const path = tag === "*" ? `/repos/${repo}/releases?per_page=100&page=${page}` : `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
        const r = await fetch("https://api.github.com" + path, { headers: { "user-agent": "koulaxizis-apps-counter", accept: "application/vnd.github+json" } });
        if (!r.ok) break;
        const data = await r.json();
        const rels = Array.isArray(data) ? data : [data];
        for (const rel of rels) {
          for (const a of rel.assets || []) {
            const pkg = names[a.name];
            if (!pkg || !Number.isInteger(a.id) || !Number.isInteger(a.download_count)) continue;
            writes.push(env.DB.prepare("INSERT INTO gh_asset (id, pkg, n) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO UPDATE SET n = MAX(n, excluded.n)")
              .bind(a.id, pkg, a.download_count));
          }
        }
        if (rels.length < 100) break;
      }
    }
  }
  writes.push(env.DB.prepare("INSERT INTO meta (k, v) VALUES ('gh_at', ?1) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(new Date().toISOString()));
  for (let i = 0; i < writes.length; i += 50) await env.DB.batch(writes.slice(i, i + 50));
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204, headers: { "Access-Control-Allow-Methods": "GET, HEAD" } }));
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/stats.json") return stats(env);
    if (url.pathname === "/") return new Response("Koulaxizis Apps download counter: our F-Droid repositories at /oros-fdroid/repo, /null-jsfx-fdroid/repo and /noxpress-fdroid/repo; counts per app at /stats.json. Nothing about you is kept.\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
    const m = /^\/([a-z0-9-]+)\/(.*)$/.exec(url.pathname);
    if (!m || !REPOS.has(m[1]) || !safePath(m[2])) return new Response("Not found", { status: 404 });
    return proxy(req, env, ctx, m[1], m[2]);
  },
  async scheduled(ev, env, ctx) {
    ctx.waitUntil(github(env));
  },
};
