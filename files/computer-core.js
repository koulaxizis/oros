// ============================================================
// orOS Files — computer-core.js ("This computer": pure helpers + client)
// ------------------------------------------------------------
// On orOS USB (the live stick and orOS installed on a disk) the orOS
// launcher serves an API under /__oros/fs/ that reaches the computer's
// own files: "/home/..." (the home folder) and "/disks/<name>/..." (a
// disk opened under /media/oros). Only the orOS page may call it (a
// cookie the launcher sets on orOS's pages, same-origin headers and
// X-Oros-FS: 1). Everywhere else (useoros.online, orOS Portable,
// installers) the API is absent and none of this shows.
//
// Files shows these places under "/computer" (/computer/home/...,
// /computer/disks/<name>/...). They are never part of the orOS disk:
// orosFS, Vault and sync never see them. Copies to and from the orOS
// disk go through Files (computer.js).
//
// Contract (oros-portable launcher/computerfs.go, README "Computer
// files"): GET roots | list?path= | stat?path= | raw?path= (Range) |
// trash | disks; PUT raw?path=[&replace=1][&ifmtime=ms]; POST op
// {op: mkdir|rename|copy|move|trash|restore|purge|mount|unmount, path,
// to, root, id, dev}. Errors: {error: code, message}.
// ============================================================
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosComputerCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PREFIX = "/computer";
  var API = "/__oros/fs/";

  // The usual home folders, in the order shown. On the disk they keep
  // their English names (oros-usb makes them at every start); Files
  // shows them translated.
  var HOME_FOLDERS = ["Documents", "Downloads", "Pictures", "Music", "Videos", "Desktop"];

  function isComputerPath(p) {
    return typeof p === "string" && (p === PREFIX || p.indexOf(PREFIX + "/") === 0);
  }

  // Files path → API path ("/computer/home/a" → "/home/a"). null when
  // the path is not a clean computer path.
  function toApi(p) {
    if (!isComputerPath(p)) return null;
    var rest = p.slice(PREFIX.length) || "/";
    if (rest.length > 1 && rest.charAt(rest.length - 1) === "/") return null;
    var segs = rest.split("/").slice(1);
    for (var i = 0; i < segs.length; i++) {
      if (rest !== "/" && (segs[i] === "" || segs[i] === "." || segs[i] === "..")) return null;
      if (segs[i].indexOf("\u0000") !== -1) return null;
    }
    return rest;
  }

  function fromApi(p) {
    if (typeof p !== "string" || p.charAt(0) !== "/") return null;
    return p === "/" ? PREFIX : PREFIX + p;
  }

  function parentOf(p) {
    var i = p.lastIndexOf("/");
    return i > 0 ? p.slice(0, i) : p;
  }
  function baseName(p) { return p.slice(p.lastIndexOf("/") + 1); }
  function join(dir, name) { return dir + "/" + name; }

  // The top of a computer path: "/computer/home" or "/computer/disks/X".
  function placeOf(p) {
    var a = toApi(p);
    if (!a) return null;
    var segs = a.split("/");
    if (segs[1] === "home") return PREFIX + "/home";
    if (segs[1] === "disks" && segs[2]) return PREFIX + "/disks/" + segs[2];
    return null;
  }

  // The string key of a home folder's name ("c.f.Documents"), or null
  // for any other name. computer.js keeps the translations.
  function folderKey(name) {
    return HOME_FOLDERS.indexOf(name) !== -1 ? "c.f." + name : null;
  }

  // Breadcrumbs: [{ name, path }] from "This computer" down. Home folders
  // go through label(name) (the translation); a disk shows its name.
  function crumbs(p, label, rootName, homeName) {
    var out = [{ name: rootName, path: PREFIX }];
    var a = toApi(p);
    if (!a || a === "/") return out;
    var segs = a.split("/").slice(1);
    var path = PREFIX;
    for (var i = 0; i < segs.length; i++) {
      path += "/" + segs[i];
      if (i === 0 && segs[0] === "home") { out.push({ name: homeName, path: path }); continue; }
      if (i === 0 && segs[0] === "disks") continue;             // "/disks" alone is not a place
      var name = segs[i];
      if (i === 1 && segs[0] === "home" && label) name = label(name);
      out.push({ name: name, path: path });
    }
    return out;
  }

  // A name that is not in `taken`: "a.txt" → "a (2).txt".
  function uniqueName(name, taken) {
    var set = {};
    (taken || []).forEach(function (n) { set[n.toLowerCase()] = true; });
    if (!set[name.toLowerCase()]) return name;
    var dot = name.lastIndexOf(".");
    var stem = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : "";
    for (var i = 2; i < 10000; i++) {
      var n = stem + " (" + i + ")" + ext;
      if (!set[n.toLowerCase()]) return n;
    }
    return stem + " (" + Date.now() + ")" + ext;
  }

  // A name a person may give: no slashes, not hidden, not empty.
  function validName(name) {
    if (typeof name !== "string") return false;
    var n = name.trim();
    return !!n && n === name && n.charAt(0) !== "." && !/[\/\\\u0000]/.test(n) && n.length <= 255;
  }

  // Sort: folders first, then by name in the locale.
  function sortEntries(list, loc) {
    return list.slice().sort(function (a, b) {
      if (!!a.dir !== !!b.dir) return a.dir ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), loc || undefined, { numeric: true });
    });
  }

  // Error answer → a Files string key.
  function errKey(code) {
    switch (code) {
      case "exists": return "c.e.exists";
      case "readonly": return "c.e.readonly";
      case "full": return "c.e.full";
      case "denied": return "c.e.denied";
      case "notfound": return "c.e.notfound";
      case "changed": return "c.e.changed";
      case "busy": return "c.e.busy";
      case "inside": return "c.e.inside";
      case "verify": return "c.e.verify";
      case "notempty": return "c.e.notempty";
      case "offline": return "c.e.offline";
    }
    return "c.e.io";
  }

  // Disks the person can open: the volumes oros-system lists, with
  // their Files path when mounted.
  function diskRows(volumes, mounted) {
    var byName = {};
    (mounted || []).forEach(function (m) { byName[baseName(m.path)] = m; });
    return (volumes || []).map(function (v) {
      var mountName = v.mount ? baseName(v.mount) : "";
      var m = mountName ? byName[mountName] : null;
      return {
        dev: v.path,
        name: v.label || v.model || String(v.path || "").replace("/dev/", ""),
        model: v.model || "",
        usb: !!v.usb,
        size: v.size || 0,
        fstype: v.fstype || "",
        path: m ? fromApi(m.path) : null,
        free: m ? m.free : 0,
        readonly: !!(v.readonly || (m && m.readonly))
      };
    });
  }

  // ---------- client ----------

  function CallError(code, message, status) {
    this.code = code;
    this.message = message || code;
    this.status = status || 0;
  }

  // client(fetchFn): every call sends the same-origin credentials and
  // the header the launcher asks for. fetchFn defaults to window.fetch.
  function client(fetchFn) {
    var F = fetchFn || (typeof fetch === "function" ? fetch.bind(null) : null);
    function call(method, name, query, body, extraHeaders) {
      if (!F) return Promise.reject(new CallError("offline"));
      var url = API + name + (query ? "?" + query : "");
      var headers = { "X-Oros-FS": "1" };
      if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k]; });
      var init = { method: method, headers: headers, credentials: "same-origin", cache: "no-store" };
      if (body !== undefined) init.body = body;
      return F(url, init).then(function (r) {
        var ct = (r.headers && r.headers.get && r.headers.get("Content-Type")) || "";
        var parse = ct.indexOf("application/json") === 0 ? r.json() : Promise.resolve(null);
        return parse.then(function (j) {
          if (!r.ok) throw new CallError((j && j.error) || "io", j && j.message, r.status);
          return j;
        }, function () {
          if (!r.ok) throw new CallError("io", "", r.status);
          return null;
        });
      }, function (e) {
        if (e instanceof CallError) throw e;
        throw new CallError("offline", String(e && e.message || e));
      });
    }
    function q(p) { return "path=" + encodeURIComponent(p); }
    function api(p) {
      var a = toApi(p);
      if (a === null) throw new CallError("badpath");
      return a;
    }
    function guard(fn) {
      return function () {
        try { return fn.apply(null, arguments); } catch (e) { return Promise.reject(e); }
      };
    }
    return {
      roots: function () { return call("GET", "roots"); },
      list: guard(function (p) {
        return call("GET", "list", q(api(p))).then(function (l) {
          return (l || []).map(function (e) {
            return { name: e.name, path: fromApi(e.path), dir: !!e.dir, size: e.size || 0, mtime: e.mtime || 0 };
          });
        });
      }),
      stat: guard(function (p) {
        return call("GET", "stat", q(api(p))).then(function (e) {
          return { name: e.name, path: fromApi(e.path), dir: !!e.dir, size: e.size || 0, mtime: e.mtime || 0 };
        });
      }),
      // The URL of a file, for <img>, <video>, <audio> and downloads.
      rawUrl: function (p) { var a = toApi(p); return a ? API + "raw?" + q(a) : ""; },
      read: guard(function (p) {
        var url = API + "raw?" + q(api(p));
        if (!F) return Promise.reject(new CallError("offline"));
        return F(url, { credentials: "same-origin", cache: "no-store" }).then(function (r) {
          if (!r.ok) {
            return r.json().then(function (j) { throw new CallError((j && j.error) || "io", j && j.message, r.status); },
              function (e) { if (e instanceof CallError) throw e; throw new CallError("io", "", r.status); });
          }
          var m = Number(r.headers.get("X-Oros-MTime")) || 0;
          return r.blob().then(function (b) { return { blob: b, mtime: m }; });
        });
      }),
      // Writes a Blob. opts: { replace, ifmtime }.
      write: guard(function (p, blob, opts) {
        var s = q(api(p));
        if (opts && opts.replace) s += "&replace=1";
        if (opts && opts.ifmtime) s += "&ifmtime=" + Math.floor(opts.ifmtime);
        return call("PUT", "raw", s, blob, { "Content-Type": "application/octet-stream" });
      }),
      op: guard(function (o) {
        var b = {};
        Object.keys(o).forEach(function (k) {
          b[k] = (k === "path" || k === "to") ? api(o[k]) : (k === "root" ? toApi(o[k]) || o[k] : o[k]);
        });
        return call("POST", "op", "", JSON.stringify(b), { "Content-Type": "application/json" });
      }),
      trash: function () {
        return call("GET", "trash").then(function (l) {
          return (l || []).map(function (it) {
            return { root: fromApi(it.root), id: it.id, name: it.name, from: it.from ? fromApi(it.from) : "",
                     at: it.at, dir: !!it.dir, size: it.size || 0, mtime: it.mtime || 0 };
          });
        });
      },
      disks: function () { return call("GET", "disks"); }
    };
  }

  // Is the API there? One cheap call; never throws.
  function probe(c) {
    return c.roots().then(function (r) { return !!(r && r.home); }, function () { return false; });
  }

  return {
    PREFIX: PREFIX,
    API: API,
    HOME_FOLDERS: HOME_FOLDERS,
    isComputerPath: isComputerPath,
    toApi: toApi,
    fromApi: fromApi,
    parentOf: parentOf,
    baseName: baseName,
    join: join,
    placeOf: placeOf,
    folderKey: folderKey,
    crumbs: crumbs,
    uniqueName: uniqueName,
    validName: validName,
    sortEntries: sortEntries,
    errKey: errKey,
    diskRows: diskRows,
    client: client,
    probe: probe,
    CallError: CallError
  };
});
