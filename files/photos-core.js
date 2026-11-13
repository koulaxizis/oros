// ============================================================
// orOS Files — photos-core.js (v1.0.0): pure helpers of the Photos
// view, no DOM, no disk. Exposes window.OrosPhotosCore (browser) or
// module.exports (tests/files-photos.test.js).
//
//   kindOf(name)                → "image" | "video" | null
//   readExif(bytes)             → { date, offset, make, model,
//                                   orientation, w, h, lat, lon } | null
//                                 JPEG (APP1), PNG (eXIf), WebP (EXIF)
//                                 and bare TIFF; the first 128 KB of a
//                                 file are enough (HEAD_BYTES)
//   mp4Scan(bytes, base)        → { created, duration, lat, lon } |
//                                 { next } (read again from that
//                                 absolute offset) | null
//   dateFromName(name)          → wall-clock ms | 0
//   wallFromEpoch(ms, tzMin)    → wall-clock ms (Date#getTimezoneOffset)
//   pickDate(info)              → { t, src: exif|video|name|file }
//   timeline(items)             → months › days, newest first
//   indexable(path, opts)       → whether the view lists this path
//   dirWanted(dir, opts)        → whether a walk enters this folder
//   dHash(gray) · hamming(a, b) → near-duplicate fingerprints
//   validGps(lat, lon)
//   cluster(pts, cell) · geoBounds(recs) → the map's groups (P3)
//
// "Wall clock" = the time a camera shows, kept as the UTC fields of a
// Date (Date.UTC(y, m, d, h, mi, s)): EXIF has no time zone, so photos
// group by the day they were taken where they were taken. Read it
// back with getUTC*().
//
// Every reader is bounded: offsets are checked against the buffer,
// at most 512 entries per IFD, strings at most 128 bytes, at most 64
// MP4 boxes per level. A damaged or hostile file gives null, never
// a throw and never a loop.
// ============================================================
(function (root) {
  "use strict";

  var HEAD_BYTES = 128 * 1024;
  var IMAGE = /\.(jpe?g|jfif|png|webp|gif|avif|bmp|heic|heif|tiff?|dng|cr2|cr3|nef|arw|orf|rw2|raf)$/i;
  var VIDEO = /\.(mp4|m4v|mov|webm|3gp|mkv)$/i;
  var DAY = 86400000;
  var MAC_EPOCH = 2082844800;   // seconds from 1904-01-01 to 1970-01-01

  // Folders of other apps: their pictures are covers, receipts,
  // scans and assets, not photos. Changeable per device in the view.
  var SKIP = ["Documents", "Docs", "Invoices", "Newsletter", "Assets", "Layout",
    "Atelier", "Studio", "Music", "Books", "Flashcards", "Publishing", "CRM",
    "Budget", "Stock", "Garage", "Health", "Diary", "Mail", "Assistant",
    "Kanban", "Wiki", "Whiteboard", "Rescue", "Code", "PDF", "Converted",
    "Storage", "Maps", "Radio", "Notes"];

  function kindOf(name) {
    var n = String(name || "");
    if (IMAGE.test(n)) return "image";
    if (VIDEO.test(n)) return "video";
    return null;
  }

  // ---------- dates ----------
  function wall(y, mo, d, h, mi, s) {
    if (!(y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 &&
          h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 60)) return 0;
    var t = Date.UTC(y, mo - 1, d, h, mi, Math.min(s, 59));
    var c = new Date(t);
    return c.getUTCDate() === d && c.getUTCMonth() === mo - 1 ? t : 0;   // 31 Feb
  }

  // "2026:11:12 14:30:15" (EXIF) → wall ms, 0 for blanks / zeros.
  function exifDate(s) {
    var m = /^(\d{4})[:\-](\d\d)[:\-](\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(String(s || ""));
    return m ? wall(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]) : 0;
  }

  // Names phones and apps give: IMG_20261112_143015.jpg,
  // PXL_20261112_143015123.jpg, VID_20261112_143015.mp4,
  // Screenshot_20261112-143015.png, 2026-11-12 14.30.15.jpg,
  // signal-2026-11-12-143015.jpg; date only: IMG-20261112-WA0001.jpg.
  function dateFromName(name) {
    var n = String(name || "");
    var m = /(?:^|[^\d])((?:19|20)\d\d)[\-_.]?(\d\d)[\-_.]?(\d\d)[ _\-T.]+(\d\d)[\-_.:]?(\d\d)[\-_.:]?(\d\d)/.exec(n);
    if (m) {
      var t = wall(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
      if (t) return t;
    }
    m = /(?:^|[^\d])((?:19|20)\d\d)[\-_]?(\d\d)[\-_]?(\d\d)(?:[^\d]|$)/.exec(n);
    if (m) return wall(+m[1], +m[2], +m[3], 12, 0, 0);
    return 0;
  }

  function wallFromEpoch(ms, tzMin) {
    if (typeof ms !== "number" || !isFinite(ms) || ms <= 0) return 0;
    return ms - (tzMin || 0) * 60000;
  }

  // info: { exif, video, name, mtime, tz } → the best date and where
  // it came from (the viewer says which).
  function pickDate(info) {
    info = info || {};
    var e = info.exif && info.exif.date ? exifDate(info.exif.date) : 0;
    if (e) return { t: e, src: "exif" };
    if (info.video && info.video.created > 0) {
      return { t: wallFromEpoch(info.video.created, info.tz), src: "video" };
    }
    var n = dateFromName(info.name);
    if (n) return { t: n, src: "name" };
    return { t: wallFromEpoch(info.mtime || 0, info.tz), src: "file" };
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(t) { var d = new Date(t); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function monthKey(t) { return dayKey(t).slice(0, 7); }

  // items: [{ path, t }] → [{ key: "2026-11", count, days: [{ key:
  // "2026-11-12", items }] }], newest first; same time → by path, so
  // every device shows the same order.
  function timeline(items) {
    var list = (items || []).filter(function (x) { return x && typeof x.path === "string"; });
    list.sort(function (a, b) {
      return (b.t || 0) - (a.t || 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    });
    var months = [], mo = null, dy = null;
    list.forEach(function (x) {
      var mk = x.t ? monthKey(x.t) : "0000-00", dk = x.t ? dayKey(x.t) : "0000-00-00";
      if (!mo || mo.key !== mk) { mo = { key: mk, count: 0, days: [] }; months.push(mo); dy = null; }
      if (!dy || dy.key !== dk) { dy = { key: dk, items: [] }; mo.days.push(dy); }
      dy.items.push(x); mo.count++;
    });
    return months;
  }

  // ---------- which paths ----------
  // opts: { skip: [top-level folder names], extra: [paths always
  // listed even under a skipped folder] }. Never the Trash or a hidden
  // segment (".trash", ".docs", ".thumbs"…), never /internal/Documents
  // (the Documents view owns it).
  function indexable(path, opts) {
    var p = String(path || "");
    if (p.indexOf("/internal/") !== 0 || !kindOf(p)) return false;
    var segs = p.slice(10).split("/");
    for (var i = 0; i < segs.length; i++) {
      if (!segs[i] || segs[i].charAt(0) === ".") return false;
    }
    if (segs[0] === "Documents") return false;
    opts = opts || {};
    var extra = opts.extra || [];
    for (var k = 0; k < extra.length; k++) {
      var x = String(extra[k]).replace(/\/+$/, "");
      if (x && (p === x || p.indexOf(x + "/") === 0)) return true;
    }
    var skip = opts.skip || SKIP;
    return segs.length < 2 || skip.indexOf(segs[0]) === -1;
  }

  // Whether a walk of the disk goes into this folder (indexable()'s
  // rules for folders): a skipped folder is still entered when one of
  // the person's extra folders lies inside it.
  function dirWanted(dir, opts) {
    var d = String(dir || "").replace(/\/+$/, "");
    if (d === "/internal") return true;
    if (d.indexOf("/internal/") !== 0) return false;
    var segs = d.slice(10).split("/");
    for (var i = 0; i < segs.length; i++) {
      if (!segs[i] || segs[i].charAt(0) === ".") return false;
    }
    if (segs[0] === "Documents") return false;
    opts = opts || {};
    var extra = opts.extra || [];
    for (var k = 0; k < extra.length; k++) {
      var x = String(extra[k]).replace(/\/+$/, "");
      if (x && (d === x || d.indexOf(x + "/") === 0 || x.indexOf(d + "/") === 0)) return true;
    }
    return (opts.skip || SKIP).indexOf(segs[0]) === -1;
  }

  // ---------- EXIF ----------
  function tiff(b, t, end) {
    if (t < 0 || t + 8 > end) return null;
    var le = b[t] === 0x49 && b[t + 1] === 0x49;
    if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return null;
    function u16(o) { return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; }
    function u32(o) {
      return le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216
                : b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
    }
    if (u16(t + 2) !== 42) return null;
    var SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

    // One IFD → { tag: { type, count, at } } (at = absolute offset of
    // the value), or null when it does not fit.
    function ifd(off) {
      var o = t + off;
      if (off < 8 || o + 2 > end) return null;
      var n = u16(o), out = {};
      if (n > 512) return null;
      for (var k = 0; k < n; k++) {
        var e = o + 2 + k * 12;
        if (e + 12 > end) break;
        var type = u16(e + 2), count = u32(e + 4), sz = SIZE[type];
        if (!sz || count > 65536) continue;
        var bytes = sz * count;
        var at = bytes <= 4 ? e + 8 : t + u32(e + 8);
        if (at < t || at + bytes > end) continue;
        out[u16(e)] = { type: type, count: count, at: at };
      }
      return out;
    }
    function str(v) {
      if (!v || v.type !== 2) return "";
      var s = "", n = Math.min(v.count, 128);
      for (var i = 0; i < n; i++) {
        var c = b[v.at + i];
        if (c === 0) break;
        s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : "";
      }
      return s.trim();
    }
    function num(v) {
      if (!v) return 0;
      if (v.type === 3) return u16(v.at);
      if (v.type === 4) return u32(v.at);
      if (v.type === 1) return b[v.at];
      return 0;
    }
    function rat(at) { var d = u32(at + 4); return d ? u32(at) / d : NaN; }
    function dms(v) {
      if (!v || v.type !== 5 || v.count < 3) return NaN;
      return rat(v.at) + rat(v.at + 8) / 60 + rat(v.at + 16) / 3600;
    }

    var i0 = ifd(u32(t + 4));
    if (!i0) return null;
    var res = { date: "", offset: "", make: str(i0[0x010f]), model: str(i0[0x0110]),
                orientation: 1, w: 0, h: 0, lat: null, lon: null };
    var or = num(i0[0x0112]);
    if (or >= 1 && or <= 8) res.orientation = or;
    var ex = i0[0x8769] ? ifd(num(i0[0x8769])) : null;
    if (ex) {
      res.date = str(ex[0x9003]) || str(ex[0x9004]);
      res.offset = str(ex[0x9011]);
      res.w = num(ex[0xa002]); res.h = num(ex[0xa003]);
    }
    if (!exifDate(res.date)) res.date = exifDate(str(i0[0x0132])) ? str(i0[0x0132]) : "";
    var gp = i0[0x8825] ? ifd(num(i0[0x8825])) : null;
    if (gp) {
      var lat = dms(gp[2]), lon = dms(gp[4]);
      if (str(gp[1]).toUpperCase() === "S") lat = -lat;
      if (str(gp[3]).toUpperCase() === "W") lon = -lon;
      if (validGps(lat, lon)) { res.lat = round6(lat); res.lon = round6(lon); }
    }
    return res;
  }

  function round6(x) { return Math.round(x * 1e6) / 1e6; }
  function validGps(lat, lon) {
    return typeof lat === "number" && typeof lon === "number" && isFinite(lat) && isFinite(lon) &&
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  }

  function isExifHeader(b, i) {
    return b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 &&
      b[i + 4] === 0 && b[i + 5] === 0;
  }
  function be32(b, o) { return b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]); }
  function le32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
  function tag4(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }

  function readExif(bytes) {
    var b = bytes;
    if (!b || typeof b.length !== "number" || b.length < 12) return null;
    try {
      // JPEG: markers up to the image data.
      if (b[0] === 0xff && b[1] === 0xd8) {
        var i = 2, guard = 0;
        while (i + 4 <= b.length && guard++ < 256) {
          if (b[i] !== 0xff) return null;
          var mk = b[i + 1];
          if (mk === 0xff) { i++; continue; }
          if (mk === 0xda || mk === 0xd9) return null;
          var len = (b[i + 2] << 8) | b[i + 3];
          if (len < 2) return null;
          if (mk === 0xe1 && i + 10 <= b.length && isExifHeader(b, i + 4)) {
            return tiff(b, i + 10, Math.min(b.length, i + 2 + len));
          }
          i += 2 + len;
        }
        return null;
      }
      // PNG: eXIf chunk (bare TIFF).
      if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
        var p = 8, n = 0;
        while (p + 12 <= b.length && n++ < 256) {
          var cl = be32(b, p), ct = tag4(b, p + 4);
          if (ct === "eXIf") return tiff(b, p + 8, Math.min(b.length, p + 8 + cl));
          if (ct === "IDAT" || ct === "IEND") return null;
          p += 12 + cl;
        }
        return null;
      }
      // WebP: RIFF › EXIF chunk (TIFF, sometimes after "Exif\0\0").
      if (tag4(b, 0) === "RIFF" && tag4(b, 8) === "WEBP") {
        var q = 12, m = 0;
        while (q + 8 <= b.length && m++ < 256) {
          var st = tag4(b, q), sl = le32(b, q + 4);
          if (st === "EXIF") {
            var s0 = q + 8;
            if (isExifHeader(b, s0)) s0 += 6;
            return tiff(b, s0, Math.min(b.length, q + 8 + sl));
          }
          q += 8 + sl + (sl & 1);
        }
        return null;
      }
      // Bare TIFF (and the TIFF-based RAW formats).
      if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return tiff(b, 0, b.length);
    } catch (e) { /* hostile file: no metadata */ }
    return null;
  }

  // ---------- MP4 / MOV ----------
  // ISO 6709 "+37.9838+023.7275/" or "+37.9838+023.7275+012.0/".
  function iso6709(s) {
    var m = /^([+\-]\d{1,2}(?:\.\d+)?)([+\-]\d{1,3}(?:\.\d+)?)/.exec(String(s || ""));
    if (!m) return null;
    var lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    return validGps(lat, lon) ? { lat: round6(lat), lon: round6(lon) } : null;
  }

  // Box headers inside [from, to) of b → [{ type, at, body, end }].
  // A box that runs past the buffer is listed with its real end.
  function boxes(b, from, to) {
    var out = [], o = from;
    while (o + 8 <= to && out.length < 64) {
      var size = be32(b, o), type = tag4(b, o + 4), body = o + 8;
      if (size === 1) {
        if (o + 16 > to) break;
        size = be32(b, o + 8) * 4294967296 + be32(b, o + 12);
        body = o + 16;
      } else if (size === 0) {
        size = Infinity;   // to the end of the file
      }
      if (size < body - o) break;
      out.push({ type: type, at: o, body: body, end: o + size });
      if (size === Infinity) break;
      o += size;
    }
    return out;
  }

  function parseMoov(b, from, to) {
    var res = { created: 0, duration: 0, lat: null, lon: null };
    boxes(b, from, to).forEach(function (bx) {
      var end = Math.min(bx.end, to);
      if (bx.type === "mvhd" && bx.body + 32 <= end) {
        var v = b[bx.body], secs, scale, dur;
        if (v === 1 && bx.body + 40 <= end) {
          secs = be32(b, bx.body + 4) * 4294967296 + be32(b, bx.body + 8);
          scale = be32(b, bx.body + 20);
          dur = be32(b, bx.body + 24) * 4294967296 + be32(b, bx.body + 28);
        } else {
          secs = be32(b, bx.body + 4);
          scale = be32(b, bx.body + 12);
          dur = be32(b, bx.body + 16);
        }
        // 0 = not set; before 1971 = a camera without a clock.
        if (secs > MAC_EPOCH + 365 * 86400 && secs < MAC_EPOCH + 4102444800) res.created = (secs - MAC_EPOCH) * 1000;
        if (scale > 0 && dur > 0 && dur !== 0xffffffff) res.duration = Math.round(dur / scale * 1000);
      } else if (bx.type === "udta") {
        boxes(b, bx.body, end).forEach(function (u) {
          if (u.type !== "©xyz") return;
          var ue = Math.min(u.end, end);
          if (u.body + 4 > ue) return;
          var n = Math.min((b[u.body] << 8) | b[u.body + 1], ue - u.body - 4, 64), s = "";
          for (var i = 0; i < n; i++) s += String.fromCharCode(b[u.body + 4 + i]);
          var g = iso6709(s);
          if (g) { res.lat = g.lat; res.lon = g.lon; }
        });
      }
    });
    return res;
  }

  // bytes = a piece of the file starting at absolute offset base (0
  // for the head). Finds the top-level moov: parsed when the whole box
  // is in the piece; { next } = where to read from (its start, or the
  // next top-level box after a big mdat); null = not an MP4 / no moov.
  function mp4Scan(bytes, base) {
    var b = bytes;
    base = base || 0;
    if (!b || typeof b.length !== "number" || b.length < 8) return null;
    try {
      if (base === 0 && tag4(b, 4) !== "ftyp" && tag4(b, 4) !== "moov" &&
          tag4(b, 4) !== "wide" && tag4(b, 4) !== "mdat" && tag4(b, 4) !== "free") return null;
      var list = boxes(b, 0, b.length);
      for (var i = 0; i < list.length; i++) {
        var bx = list[i];
        if (bx.type === "moov") {
          if (bx.end <= b.length) return parseMoov(b, bx.body, bx.end);
          return bx.at === 0 ? null : { next: base + bx.at, len: bx.end - bx.at };
        }
      }
      var last = list[list.length - 1];
      if (last && last.end > b.length && last.end !== Infinity) return { next: base + last.end };
    } catch (e) { /* damaged */ }
    return null;
  }

  // ---------- near duplicates ----------
  // gray: 72 numbers, a 9 × 8 grayscale picture (row by row) → a
  // 64-bit difference hash as 16 hex digits.
  function dHash(gray) {
    if (!gray || gray.length < 72) return "";
    var hex = "";
    for (var r = 0; r < 8; r++) {
      var byte = 0;
      for (var c = 0; c < 8; c++) {
        byte = (byte << 1) | (gray[r * 9 + c] > gray[r * 9 + c + 1] ? 1 : 0);
      }
      hex += (byte < 16 ? "0" : "") + byte.toString(16);
    }
    return hex;
  }
  function hamming(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== 16 || b.length !== 16) return 64;
    var d = 0;
    for (var i = 0; i < 16; i++) {
      var x = parseInt(a.charAt(i), 16) ^ parseInt(b.charAt(i), 16);
      while (x) { d += x & 1; x >>= 1; }
    }
    return d;
  }

  // ---------- map (P3) ----------
  // pts: [{ x, y, t, k }] in screen pixels (Leaflet project at the
  // map's zoom). Groups the points of each cell × cell square; a group
  // is drawn at its newest point and lists its points newest first
  // (ties by k). Same input, same groups, in a stable order.
  function cluster(pts, cell) {
    cell = cell > 0 ? cell : 64;
    var cells = {}, keys = [];
    (pts || []).forEach(function (p) {
      if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
      var key = Math.floor(p.x / cell) + ":" + Math.floor(p.y / cell);
      if (!cells[key]) { cells[key] = []; keys.push(key); }
      cells[key].push(p);
    });
    function newest(a, b) { return (b.t || 0) - (a.t || 0) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0); }
    var out = keys.map(function (key) {
      var items = cells[key].sort(newest);
      return { key: key, x: items[0].x, y: items[0].y, items: items };
    });
    out.sort(function (a, b) { return newest(a.items[0], b.items[0]); });
    return out;
  }
  // [[south, west], [north, east]] around the records with a place, or null.
  function geoBounds(recs) {
    var s = 90, w = 180, n = -90, e = -180, any = false;
    (recs || []).forEach(function (r) {
      if (!r || !validGps(r.lat, r.lon)) return;
      any = true;
      if (r.lat < s) s = r.lat;
      if (r.lat > n) n = r.lat;
      if (r.lon < w) w = r.lon;
      if (r.lon > e) e = r.lon;
    });
    return any ? [[s, w], [n, e]] : null;
  }

  var api = {
    cluster: cluster, geoBounds: geoBounds,
    HEAD_BYTES: HEAD_BYTES, SKIP: SKIP.slice(), DAY: DAY,
    kindOf: kindOf, readExif: readExif, exifDate: exifDate, mp4Scan: mp4Scan,
    iso6709: iso6709, dateFromName: dateFromName, wallFromEpoch: wallFromEpoch,
    pickDate: pickDate, dayKey: dayKey, monthKey: monthKey, timeline: timeline,
    indexable: indexable, dirWanted: dirWanted, dHash: dHash, hamming: hamming, validGps: validGps
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosPhotosCore = api;
})(typeof window !== "undefined" ? window : this);
