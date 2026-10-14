// ============================================================
// orOS Files — dropbox-core.js (whole-Dropbox view, pure helpers)
// ------------------------------------------------------------
// The Files app can show the user's whole Dropbox next to the orOS
// disk. Sync keeps its own App-folder Dropbox app (sync.js); this
// view uses a SECOND Dropbox app with "Full Dropbox" access, asked
// for only when the user presses Connect in Files. Nothing here
// touches the network or the DOM: files/dropbox.js does, with these
// helpers (shared with tests/files-dropbox.test.js).
// ============================================================
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosDropboxCore = api;
})(this, function () {
  "use strict";

  // App key of the "orOS Files" Dropbox app (Full Dropbox, scopes
  // files.metadata.read, files.content.read, files.content.write).
  // Empty until it is registered: each user can then enter the key of
  // a Dropbox app of their own (device-local).
  var APP_KEY = "";

  var AUTH_URL  = "https://www.dropbox.com/oauth2/authorize";
  var TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
  var RPC       = "https://api.dropboxapi.com/2/";
  var CONTENT   = "https://content.dropboxapi.com/2/";

  // orOS sync's own App folder holds this file (sync.js BLOB_PATH).
  var SYNC_MARK = "orOS-data.json";
  var MAX_NAME = 255;
  var BLOCK = 4 * 1024 * 1024;   // Dropbox content_hash block size

  function validKey(k) {
    return typeof k === "string" && /^[a-z0-9]{8,32}$/.test(k);
  }

  // Dropbox-API-Arg is an HTTP header: JSON with every character
  // from 0x7F up escaped (Greek names would break the request).
  function headerArg(o) {
    return JSON.stringify(o).replace(/[\u007f-￿]/g, function (c) {
      return "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function authorizeUrl(o) {
    return AUTH_URL +
      "?response_type=code" +
      "&client_id=" + encodeURIComponent(o.key) +
      "&redirect_uri=" + encodeURIComponent(o.redirect) +
      "&state=" + encodeURIComponent(o.state) +
      "&code_challenge=" + encodeURIComponent(o.challenge) +
      "&code_challenge_method=S256" +
      "&token_access_type=offline";
  }

  // Token answer → { access, refresh, exp } or null.
  function tokenOf(j, now) {
    if (!j || typeof j.access_token !== "string" || !j.access_token) return null;
    var life = Math.max(60, (+j.expires_in || 14400) - 300);
    return {
      access: j.access_token,
      refresh: typeof j.refresh_token === "string" ? j.refresh_token : "",
      exp: now + life * 1000
    };
  }

  function cleanName(s) {
    return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_NAME);
  }

  // "" is the Dropbox root. Returns null for anything that is not a
  // plain absolute path ("." / ".." segments, control characters).
  function normPath(p) {
    if (typeof p !== "string") return null;
    if (p === "" || p === "/") return "";
    if (/[\u0000-\u001f\u007f]/.test(p)) return null;
    if (p.charAt(0) !== "/") p = "/" + p;
    p = p.replace(/\/+$/, "");
    var segs = p.slice(1).split("/");
    for (var i = 0; i < segs.length; i++) {
      if (!segs[i] || segs[i] === "." || segs[i] === "..") return null;
    }
    return p;
  }

  function parentPath(p) {
    var i = p.lastIndexOf("/");
    return i <= 0 ? "" : p.slice(0, i);
  }

  function baseName(p) { return p.slice(p.lastIndexOf("/") + 1); }

  // [{ name, path }] from the root ("" = Dropbox) to p.
  function crumbs(p) {
    var out = [{ name: "", path: "" }];
    if (!p) return out;
    var acc = "";
    p.slice(1).split("/").forEach(function (seg) {
      acc += "/" + seg;
      out.push({ name: seg, path: acc });
    });
    return out;
  }

  // One list_folder / search metadata entry → a row, or null.
  function mapEntry(e) {
    if (!e || typeof e !== "object") return null;
    var tag = e[".tag"];
    if (tag !== "file" && tag !== "folder") return null;
    var path = normPath(e.path_display);
    if (!path) return null;
    var name = cleanName(e.name);
    if (!name || name !== baseName(path)) name = cleanName(baseName(path));
    if (!name) return null;
    var row = {
      name: name,
      path: path,
      lower: typeof e.path_lower === "string" ? e.path_lower : path.toLowerCase(),
      dir: tag === "folder"
    };
    if (!row.dir) {
      row.size = (typeof e.size === "number" && e.size >= 0) ? e.size : 0;
      row.mtime = Date.parse(e.server_modified) || null;
      row.rev = (typeof e.rev === "string" && /^[0-9a-f]{9,}$/.test(e.rev)) ? e.rev : "";
      row.hash = (typeof e.content_hash === "string" && /^[0-9a-f]{64}$/.test(e.content_hash)) ? e.content_hash : "";
      row.dl = e.is_downloadable !== false;
    }
    return row;
  }

  function mapList(arr) {
    var out = [];
    (Array.isArray(arr) ? arr : []).forEach(function (e) {
      var r = mapEntry(e);
      if (r) out.push(r);
    });
    return out;
  }

  // A folder listing that is orOS sync's own encrypted App folder.
  function isSyncFolder(rows) {
    var mark = false, vault = false, backup = false;
    rows.forEach(function (r) {
      if (!r.dir && r.name === SYNC_MARK) mark = true;
      if (r.dir && r.name.toLowerCase() === "vault") vault = true;
      if (!r.dir && /^orOS-backup-.*\.json$/.test(r.name)) backup = true;
    });
    return mark || (vault && backup);
  }

  // Is path (any case) one of the protected roots or inside one?
  function isUnder(path, roots) {
    var l = String(path).toLowerCase();
    for (var i = 0; i < roots.length; i++) {
      var r = String(roots[i]).toLowerCase();
      if (r && (l === r || l.indexOf(r + "/") === 0)) return true;
    }
    return false;
  }

  function sortRows(rows, field, asc, lang) {
    return rows.slice().sort(function (a, b) {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;
      var c = 0;
      if (field === "size") c = (a.size || 0) - (b.size || 0);
      else if (field === "date") c = (a.mtime || 0) - (b.mtime || 0);
      if (!c) c = a.name.toLowerCase().localeCompare(b.name.toLowerCase(), lang === "el" ? "el" : "en");
      return asc === false ? -c : c;
    });
  }

  // HTTP status + Dropbox error body → one word for the UI.
  //   expired  the access token ran out (refresh and retry once)
  //   auth     the connection is gone (connect again)
  //   scope    the Dropbox app lacks a permission
  //   notfound path/not_found
  //   conflict a write lost against a newer version (wave 2)
  //   busy     rate limited
  //   net      anything else
  function errorKind(status, body) {
    var s = body && typeof body.error_summary === "string" ? body.error_summary : "";
    if (status === 401) {
      if (/^missing_scope/.test(s)) return "scope";
      if (/^expired_access_token/.test(s)) return "expired";
      return "auth";
    }
    if (status === 400 && /scope/i.test(s)) return "scope";
    if (status === 403) return "auth";
    if (status === 409) {
      if (/not_found/.test(s)) return "notfound";
      if (/conflict|rev/.test(s)) return "conflict";
      return "net";
    }
    if (status === 429 || status === 503) return "busy";
    return "net";
  }

  // Dropbox content_hash: SHA-256 of the concatenated SHA-256 of
  // every 4 MB block. digest(Uint8Array) → Promise<ArrayBuffer>.
  function contentHash(bytes, digest) {
    var n = Math.ceil(bytes.length / BLOCK);
    var all = new Uint8Array(n * 32);
    var chain = Promise.resolve();
    for (var i = 0; i < n; i++) {
      (function (k) {
        chain = chain.then(function () {
          return digest(bytes.subarray(k * BLOCK, Math.min((k + 1) * BLOCK, bytes.length)));
        }).then(function (h) { all.set(new Uint8Array(h), k * 32); });
      })(i);
    }
    return chain.then(function () { return digest(all); }).then(function (h) {
      var b = new Uint8Array(h), s = "";
      for (var j = 0; j < b.length; j++) s += ("0" + b[j].toString(16)).slice(-2);
      return s;
    });
  }

  return {
    APP_KEY: APP_KEY,
    AUTH_URL: AUTH_URL,
    TOKEN_URL: TOKEN_URL,
    RPC: RPC,
    CONTENT: CONTENT,
    SYNC_MARK: SYNC_MARK,
    validKey: validKey,
    headerArg: headerArg,
    authorizeUrl: authorizeUrl,
    tokenOf: tokenOf,
    cleanName: cleanName,
    normPath: normPath,
    parentPath: parentPath,
    baseName: baseName,
    crumbs: crumbs,
    mapEntry: mapEntry,
    mapList: mapList,
    isSyncFolder: isSyncFolder,
    isUnder: isUnder,
    sortRows: sortRows,
    errorKind: errorKind,
    contentHash: contentHash
  };
});
