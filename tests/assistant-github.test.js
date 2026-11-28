// AS-GH (Assistant wave 6; AH-5, AH-PNoxpress-1, AH-PWaymark-3, Chris
// 2026-11-28): github_read reads GitHub through the Connected services
// account, read only. Run: node --test tests/assistant-github.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../assistant/core.js");
const L = require("../links/core.js");
const R = require("../assistant/routines.js");

test("every request github_read makes passes the app's allowlist, and only GETs", () => {
  for (const what of C.GH_WHAT) {
    const r = C.ghReq({ repo: "koulaxizis/noxpress", what, path: ".github/workflows/build.yml", ref: "release/1.2", state: "closed", status: "failure", count: 99 });
    assert.ok(r.req, what);
    assert.equal(r.req.m, "GET");
    assert.equal(L.checkReq("github", r.req), "", what + " " + r.req.path);
  }
  assert.equal(C.ghReq({ repo: "koulaxizis/noxpress", what: "releases", count: 99 }).req.path, "/repos/koulaxizis/noxpress/releases?per_page=30");
  assert.equal(C.ghReq({ repo: "https://github.com/koulaxizis/noxpress/", what: "file", path: "/updates.json", ref: "main" }).req.path,
    "/repos/koulaxizis/noxpress/contents/updates.json?ref=main");
});

test("github_read refuses bad repos, paths and refs before asking", () => {
  assert.ok(C.ghReq({ repo: "noxpress", what: "releases" }).err);
  assert.ok(C.ghReq({ repo: "a/b", what: "merge" }).err);
  assert.ok(C.ghReq({ repo: "a/b", what: "file", path: "x/../y" }).err);
  assert.ok(C.ghReq({ repo: "a/b", what: "file", path: "" }).err);
  assert.ok(C.ghReq({ repo: "a/b", what: "file", path: "x", ref: "../main" }).err);
  assert.ok(C.ghReq({ repo: "a/../b", what: "releases" }).err);
});

test("answers are shaped short: releases with files, text files decoded, no e-mail addresses", () => {
  const rel = C.ghShape("releases", [{ tag_name: "v1.2.0", name: "1.2.0", draft: false, prerelease: false, published_at: "2026-11-01T10:00:00Z", html_url: "https://github.com/a/b/releases/v1.2.0",
    body: "x".repeat(5000), author: { login: "chris", email: "a@b.c" }, assets: [{ name: "noxpress.zip", size: 1234, download_count: 7, updated_at: "2026-11-01T10:00:00Z", uploader: { email: "a@b.c" } }] }]);
  assert.equal(rel[0].tag, "v1.2.0");
  assert.equal(rel[0].notes.length, 2000);
  assert.deepEqual(rel[0].files, [{ name: "noxpress.zip", size: 1234, downloads: 7, updated: "2026-11-01T10:00:00Z" }]);
  assert.doesNotMatch(JSON.stringify(rel), /a@b\.c/);
  const f = C.ghShape("file", { type: "file", path: "updates.json", size: 14, sha: "0123456789abcdef", encoding: "base64", content: Buffer.from('{"v":"1.2.0"}').toString("base64").replace(/(.{8})/g, "$1\n") });
  assert.equal(f.text, '{"v":"1.2.0"}');
  assert.equal(f.sha, "0123456789ab");
  assert.ok(C.ghShape("file", [{ type: "dir" }]).error);
  assert.ok(C.ghShape("file", { type: "file", path: "x.png", encoding: "base64", content: Buffer.from([0xff, 0xfe, 0x00]).toString("base64") }).error);
  const runs = C.ghShape("runs", { workflow_runs: [{ name: "CI", display_title: "fix", status: "completed", conclusion: "failure", head_branch: "main", event: "push", head_sha: "abcdef0123", created_at: "t", html_url: "u", actor: { email: "a@b.c" } }] });
  assert.deepEqual(runs[0], { workflow: "CI", title: "fix", status: "completed", conclusion: "failure", branch: "main", event: "push", commit: "abcdef0", started: "t", updated: "", url: "u" });
  const iss = C.ghShape("issues", [{ number: 1, title: "a", state: "open", user: { login: "x" }, labels: [{ name: "bug" }] }, { number: 2, title: "pr", pull_request: {} }]);
  assert.deepEqual(iss.map((x) => x.number), [1]);
});

test("offered only with a GitHub account; a routine needs its own switch; routines may call it", () => {
  const as = fs.readFileSync(path.join(__dirname, "../assistant/assistant.js"), "utf8");
  assert.match(as, /var ghOn = !builtin && ghAccts\(\)\.length > 0 && \(!ro \|\| !!\(rtCtx && rtCtx\.r\.gh\)\);/);
  assert.match(as, /github: ghOn \}\);/);
  assert.match(as, /web_search: 1, read_page: 1, github_read: 1,/);
  assert.match(as, /lk\.list\("github"\)/);
  assert.equal(C.toolsFor({ github: true }).map((x) => x.name).join(), "github_read");
  assert.equal(C.toolsFor({}).some((x) => x.name === "github_read"), false);
  assert.equal(R.normRoutine({ id: "rabc1234", name: "x", text: "y", gh: 1 }).gh, 1);
  assert.equal(R.normRoutine({ id: "rabc1234", name: "x", text: "y", gh: true }).gh, 0);
  assert.match(R.runPrompt(R.normRoutine({ id: "rabc1234", name: "x", text: "y", gh: 1 }), {}), /github_read/);
  assert.doesNotMatch(R.runPrompt(R.normRoutine({ id: "rabc1234", name: "x", text: "y" }), {}), /github_read/);
});
