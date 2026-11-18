// ============================================================
// orOS Studio — GitHub Pages publishing (v1.0.0, wave P2 of
// "Publish as podcast"). Puts the show's site into the person's own
// GitHub repository with their own fine-grained token, straight from
// the browser to api.github.com (no relay; the relay never hosts audio).
// Loaded by podcastui.js (window.StudioGhPages) and the tests.
//
// Rules (Bible STUDIO-POD P2):
// - The token stays on this device (localStorage), never in sync, a
//   file, a log or an error text. Only "Authorization: Bearer" carries it.
// - One commit per publish through the Git Data API: blobs → tree →
//   commit → move the branch without force. A branch moved meanwhile
//   (422) re-reads it and tries once more; nothing is ever forced.
// - Nothing is deleted: files only get added or replaced, so episodes
//   another device published stay online.
// - A file whose git blob hash matches what the repo has is not sent
//   again (episodes are large).
// - Pages is turned on when it is off (needs the token's Pages: write);
//   if that is refused the person is told to turn it on by hand.
// ============================================================
(function (root) {
  "use strict";

  var API = "https://api.github.com";
  var OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  var REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
  var PATH_RE = /^[A-Za-z0-9._-]{1,80}(\/[A-Za-z0-9._-]{1,80}){0,3}$/;
  var TOKEN_RE = /^(github_pat_[A-Za-z0-9_]{20,255}|gh[pousr]_[A-Za-z0-9]{20,255})$/;
  var MAX_FILE = 75 * 1024 * 1024;   // base64 of it stays under GitHub's 100 MB blob limit
  var NEW_TOKEN = "https://github.com/settings/personal-access-tokens/new";

  // "owner/repo", or a github.com address of the repository
  function parseRepo(s) {
    s = String(s || "").trim().replace(/\/+$/, "").replace(/\.git$/, "");
    var m = /^(?:https:\/\/github\.com\/)?([^\/\s]+)\/([^\/\s]+)$/.exec(s);
    if (!m || !OWNER_RE.test(m[1]) || !REPO_RE.test(m[2]) || m[2] === "." || m[2] === "..") return null;
    return { owner: m[1], repo: m[2] };
  }
  function repoName(r) { return r ? r.owner + "/" + r.repo : ""; }
  function tokenOk(t) { return typeof t === "string" && TOKEN_RE.test(t.trim()); }
  // where GitHub Pages serves a repository (without a custom domain)
  function pagesUrl(r) {
    if (!r) return "";
    var o = r.owner.toLowerCase();
    return r.repo.toLowerCase() === o + ".github.io" ? "https://" + o + ".github.io/" : "https://" + o + ".github.io/" + r.repo + "/";
  }

  // the git blob id of some bytes: sha1("blob <n>\0" + bytes)
  function blobHeader(n) {
    var s = "blob " + n, out = new Uint8Array(s.length + 1);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function hex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return out;
  }
  function b64(bytes) {
    var CH = 0x8000, s = "";
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
  }

  // an error the person can act on; never carries the token
  function fail(code, status) { var e = new Error(code); e.code = code; e.status = status || 0; return e; }

  // deps: { fetch, token, sha1(Uint8Array) → Promise<hex> | hex,
  //         bytes(data) → Promise<Uint8Array> (data: Uint8Array or Blob) }
  function client(deps) {
    var token = String(deps.token || "").trim();
    function call(method, path, body) {
      var init = { method: method, headers: { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store" };
      if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
      return Promise.resolve().then(function () { return deps.fetch(API + path, init); }).then(function (r) {
        var st = r.status;
        return r.text().then(function (txt) {
          var j = null;
          try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
          return { status: st, ok: st >= 200 && st < 300, json: j };
        });
      }, function () { throw fail("gh-net"); });
    }
    function must(res, what) {
      if (res.ok) return res.json;
      if (res.status === 401) throw fail("gh-auth", 401);
      if (res.status === 403 && res.json && /rate limit/i.test(String(res.json.message || ""))) throw fail("gh-rate", 403);
      if (res.status === 403) throw fail("gh-perm", 403);
      if (res.status === 404) throw fail(what === "repo" ? "gh-repo" : "gh-perm", 404);
      if (res.status === 413) throw fail("gh-big", 413);
      throw fail("gh-http", res.status);
    }
    var enc = function (s) { return s.split("/").map(encodeURIComponent).join("/"); };
    return { call: call, must: must, enc: enc };
  }

  // files: [{ path, data }] (data: Uint8Array or Blob), all at the root of the repo
  // opts: { message, onStep(step, i, n) }
  // → Promise<{ commit, changed, branch, pages: url|"" , pagesManual }>
  function publish(deps, repo, files, opts) {
    opts = opts || {};
    var c = client(deps), R = "/repos/" + c.enc(repo.owner) + "/" + c.enc(repo.repo);
    var step = function (k, i, n) { if (opts.onStep) try { opts.onStep(k, i || 0, n || 0); } catch (e) { /* the UI only */ } };
    var bad = files.filter(function (f) { return !PATH_RE.test(f.path) || /(^|\/)\.\.?(\/|$)/.test(f.path); });
    if (bad.length) return Promise.reject(fail("gh-name"));
    var size = function (d) { return d && typeof d.size === "number" ? d.size : d.length; };
    if (files.some(function (f) { return size(f.data) > MAX_FILE; })) return Promise.reject(fail("gh-big"));
    var branch, info;

    function head() {
      return c.call("GET", R + "/git/ref/heads/" + c.enc(branch)).then(function (res) {
        if (res.status === 404 || res.status === 409) return null;   // an empty repository has no branch yet
        var j = c.must(res);
        return j && j.object && typeof j.object.sha === "string" ? j.object.sha : null;
      });
    }
    // an empty repository: its first commit through the contents API
    function init() {
      return c.call("PUT", R + "/contents/.nojekyll", { message: "orOS Studio: start the podcast site", content: "", branch: branch }).then(function (res) {
        c.must(res);
        return head();
      }).then(function (sha) { if (!sha) throw fail("gh-http"); return sha; });
    }
    function existing(commitSha) {
      return c.call("GET", R + "/git/commits/" + commitSha).then(function (res) {
        var cm = c.must(res);
        return c.call("GET", R + "/git/trees/" + cm.tree.sha + "?recursive=1").then(function (r2) {
          var t = c.must(r2), map = {};
          (t && Array.isArray(t.tree) ? t.tree : []).forEach(function (x) { if (x && x.type === "blob") map[x.path] = x.sha; });
          return { tree: cm.tree.sha, have: map };
        });
      });
    }
    function attempt(retry) {
      var parent, base, entries = [];
      return head().then(function (sha) { return sha || init(); }).then(function (sha) {
        parent = sha;
        return existing(parent);
      }).then(function (ex) {
        base = ex.tree;
        var all = files.slice();
        if (!ex.have[".nojekyll"] && !all.some(function (f) { return f.path === ".nojekyll"; })) all.push({ path: ".nojekyll", data: new Uint8Array(0) });
        var i = 0;
        return all.reduce(function (pr, f) {
          return pr.then(function () {
            step("file", ++i, all.length);
            return Promise.resolve(deps.bytes(f.data)).then(function (bytes) {
              var h = blobHeader(bytes.length), whole = new Uint8Array(h.length + bytes.length);
              whole.set(h, 0); whole.set(bytes, h.length);
              return Promise.resolve(deps.sha1(whole)).then(function (id) {
                if (ex.have[f.path] === id) return;
                return c.call("POST", R + "/git/blobs", { content: b64(bytes), encoding: "base64" }).then(function (res) {
                  var b = c.must(res);
                  entries.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
                });
              });
            });
          });
        }, Promise.resolve());
      }).then(function () {
        if (!entries.length) return { commit: parent, changed: 0 };
        step("commit");
        return c.call("POST", R + "/git/trees", { base_tree: base, tree: entries }).then(function (res) {
          var tr = c.must(res);
          return c.call("POST", R + "/git/commits", { message: opts.message || "orOS Studio: publish the podcast", tree: tr.sha, parents: [parent] });
        }).then(function (res) {
          var cm = c.must(res);
          return c.call("PATCH", R + "/git/refs/heads/" + c.enc(branch), { sha: cm.sha, force: false }).then(function (r2) {
            if (r2.status === 422 && !retry) return attempt(true);   // the branch moved meanwhile: read it again, once
            if (r2.status === 422) throw fail("gh-moved", 422);
            c.must(r2);
            return { commit: cm.sha, changed: entries.length };
          });
        });
      });
    }
    function pages() {
      step("pages");
      return c.call("GET", R + "/pages").then(function (res) {
        if (res.ok) return { url: res.json && typeof res.json.html_url === "string" ? res.json.html_url : "", manual: false };
        if (res.status !== 404) return { url: "", manual: true };
        return c.call("POST", R + "/pages", { build_type: "legacy", source: { branch: branch, path: "/" } }).then(function (r2) {
          if (r2.ok) return { url: r2.json && typeof r2.json.html_url === "string" ? r2.json.html_url : "", manual: false };
          return { url: "", manual: true };
        });
      }, function () { return { url: "", manual: true }; });
    }

    step("repo");
    return c.call("GET", R).then(function (res) {
      info = c.must(res, "repo");
      branch = typeof info.default_branch === "string" && info.default_branch ? info.default_branch : "main";
      return attempt(false);
    }).then(function (done) {
      return pages().then(function (pg) {
        var url = /^https:\/\//.test(pg.url) ? pg.url.replace(/\/?$/, "/") : "";
        return { commit: done.commit, changed: done.changed, branch: branch, pages: url, pagesManual: pg.manual };
      });
    });
  }

  // the published feed, read through the API (fresh, no Pages cache); "" when there is none
  function readFile(deps, repo, path) {
    var c = client(deps), R = "/repos/" + c.enc(repo.owner) + "/" + c.enc(repo.repo);
    return c.call("GET", R + "/contents/" + c.enc(path)).then(function (res) {
      if (res.status === 404) return "";
      var j = c.must(res, "repo");
      if (!j || j.encoding !== "base64" || typeof j.content !== "string") return "";
      var bin = typeof atob === "function" ? atob(j.content.replace(/\s/g, "")) : Buffer.from(j.content, "base64").toString("binary");
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    });
  }

  var api = {
    API: API, NEW_TOKEN: NEW_TOKEN, MAX_FILE: MAX_FILE,
    parseRepo: parseRepo, repoName: repoName, tokenOk: tokenOk, pagesUrl: pagesUrl,
    blobHeader: blobHeader, hex: hex, b64: b64, publish: publish, readFile: readFile
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioGhPages = api;
})(typeof window !== "undefined" ? window : this);
