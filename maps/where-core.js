// ============================================================
// orOS Maps — where-core.js (hiking and cycling, wave H6, v1.0.0)
//
// "Where am I" helpers, pure: the position written the ways a rescue
// service, a paper map or another app may ask for it:
//   - dd(): decimal degrees "37.97154, 23.72647"
//   - dms(): degrees, minutes, seconds "37°58′17.5″N 23°43′35.3″E"
//   - ddm(): degrees and decimal minutes "N 37°58.292′ E 23°43.588′"
//     (GPS units, geocaching)
//   - utm(): UTM zone, band, easting, northing on WGS84 (Krüger series
//     to the 6th order, Karney 2011: well under a millimetre inside a
//     zone), with the Norway / Svalbard zone exceptions.
//   - smsText(): the text for a message to someone who can help (the
//     person sends it themselves; nothing is sent by Maps).
//   - heading(): a compass heading (0 = north, clockwise) from a
//     DeviceOrientation event (webkitCompassHeading on iOS, absolute
//     alpha elsewhere), or null.
//   - cardinal(): the heading as one of 8 directions (index 0-7).
// No DOM, no network: tested in tests/maps-where.test.js.
// ============================================================
(function (root) {
  "use strict";

  function num(x) { return typeof x === "number" && isFinite(x); }
  function okLL(lat, lon) { return num(lat) && num(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180; }
  function fix(x, d) { return (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }

  function dd(lat, lon) {
    if (!okLL(lat, lon)) return "";
    return fix(lat, 5) + ", " + fix(lon, 5);
  }
  function dmsPart(v, pos, neg, wdeg) {
    var h = v < 0 ? neg : pos, a = Math.abs(v);
    var tenths = Math.round(a * 36000);            // tenths of a second
    var d = Math.floor(tenths / 36000), m = Math.floor((tenths % 36000) / 600), s = (tenths % 600) / 10;
    var ds = String(d); while (ds.length < wdeg) ds = "0" + ds;
    return ds + "°" + (m < 10 ? "0" : "") + m + "′" + (s < 10 ? "0" : "") + s.toFixed(1) + "″" + h;
  }
  function dms(lat, lon) {
    if (!okLL(lat, lon)) return "";
    return dmsPart(lat, "N", "S", 2) + " " + dmsPart(lon, "E", "W", 3);
  }
  function ddmPart(v, pos, neg) {
    var h = v < 0 ? neg : pos, a = Math.abs(v);
    var th = Math.round(a * 60000);                // thousandths of a minute
    var d = Math.floor(th / 60000), m = (th % 60000) / 1000;
    return h + " " + d + "°" + (m < 10 ? "0" : "") + m.toFixed(3) + "′";
  }
  function ddm(lat, lon) {
    if (!okLL(lat, lon)) return "";
    return ddmPart(lat, "N", "S") + " " + ddmPart(lon, "E", "W");
  }

  // ---------- UTM (WGS84) ----------
  var A = 6378137, F = 1 / 298.257223563, K0 = 0.9996;
  var N3 = F / (2 - F);
  var AA = A / (1 + N3) * (1 + N3 * N3 / 4 + Math.pow(N3, 4) / 64 + Math.pow(N3, 6) / 256);
  var ALPHA = [
    N3 / 2 - 2 / 3 * N3 * N3 + 5 / 16 * Math.pow(N3, 3) + 41 / 180 * Math.pow(N3, 4) - 127 / 288 * Math.pow(N3, 5) + 7891 / 37800 * Math.pow(N3, 6),
    13 / 48 * N3 * N3 - 3 / 5 * Math.pow(N3, 3) + 557 / 1440 * Math.pow(N3, 4) + 281 / 630 * Math.pow(N3, 5) - 1983433 / 1935360 * Math.pow(N3, 6),
    61 / 240 * Math.pow(N3, 3) - 103 / 140 * Math.pow(N3, 4) + 15061 / 26880 * Math.pow(N3, 5) + 167603 / 181440 * Math.pow(N3, 6),
    49561 / 161280 * Math.pow(N3, 4) - 179 / 168 * Math.pow(N3, 5) + 6601661 / 7257600 * Math.pow(N3, 6),
    34729 / 80640 * Math.pow(N3, 5) - 3418889 / 1995840 * Math.pow(N3, 6),
    212378941 / 319334400 * Math.pow(N3, 6)
  ];
  var BANDS = "CDEFGHJKLMNPQRSTUVWX";
  function zoneOf(lat, lon) {
    var z = Math.floor((lon + 180) / 6) + 1;
    if (lon >= 180) z = 60;
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) z = 32;          // Norway
    if (lat >= 72 && lat < 84) {                                       // Svalbard
      if (lon >= 0 && lon < 9) z = 31;
      else if (lon >= 9 && lon < 21) z = 33;
      else if (lon >= 21 && lon < 33) z = 35;
      else if (lon >= 33 && lon < 42) z = 37;
    }
    return z;
  }
  // → { zone, band, e, n, hemi: "N" | "S", text } or null (UTM covers
  // 80°S to 84°N; beyond it the poles use UPS, not offered here).
  function utm(lat, lon) {
    if (!okLL(lat, lon) || lat < -80 || lat > 84) return null;
    var z = zoneOf(lat, lon), lon0 = (z - 1) * 6 - 180 + 3;
    var r = Math.PI / 180, phi = lat * r, lam = (lon - lon0) * r;
    var e = Math.sqrt(F * (2 - F));
    var tau = Math.tan(phi), sigma = Math.sinh(e * atanh(e * tau / Math.sqrt(1 + tau * tau)));
    var taup = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
    var xip = Math.atan2(taup, Math.cos(lam)), etap = asinh(Math.sin(lam) / Math.sqrt(taup * taup + Math.cos(lam) * Math.cos(lam)));
    var xi = xip, eta = etap;
    for (var j = 1; j <= 6; j++) {
      xi += ALPHA[j - 1] * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap);
      eta += ALPHA[j - 1] * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap);
    }
    var E = 500000 + K0 * AA * eta, N = K0 * AA * xi;
    if (lat < 0) N += 10000000;
    var band = BANDS.charAt(Math.min(19, Math.floor((lat + 80) / 8)));
    var Er = Math.round(E), Nr = Math.round(N);
    return { zone: z, band: band, e: Er, n: Nr, hemi: lat < 0 ? "S" : "N", ex: E, nx: N,
      text: z + band + " " + Er + " " + Nr };
  }
  function atanh(x) { return 0.5 * Math.log((1 + x) / (1 - x)); }
  function asinh(x) { return Math.log(x + Math.sqrt(x * x + 1)); }

  // ---------- the message for someone who can help ----------
  // o: { lat, lon, acc, ele, t (ms), place, words }
  //   words: { at, acc, ele, time } translated labels
  function smsText(o) {
    if (!o || !okLL(o.lat, o.lon)) return "";
    var w = o.words || {};
    var parts = [(w.at || "My position") + ": " + dd(o.lat, o.lon)];
    parts.push(dms(o.lat, o.lon));
    var u = utm(o.lat, o.lon);
    if (u) parts.push("UTM " + u.text);
    var extra = [];
    if (num(o.acc)) extra.push((w.acc || "accuracy") + " ±" + Math.round(o.acc) + " m");
    if (num(o.ele)) extra.push((w.ele || "elevation") + " " + Math.round(o.ele) + " m");
    if (extra.length) parts.push(extra.join(", "));
    if (o.place) parts.push(String(o.place).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 120));
    if (num(o.t)) {
      var d = new Date(o.t);
      parts.push((w.time || "time") + " " + (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes());
    }
    parts.push("https://www.openstreetmap.org/?mlat=" + fix(o.lat, 5) + "&mlon=" + fix(o.lon, 5) + "#map=17/" + fix(o.lat, 5) + "/" + fix(o.lon, 5));
    return parts.join("\n");
  }
  // sms: link with the body (RFC 5724; "?body=" works on Android and iOS)
  function smsHref(text) { return "sms:?body=" + encodeURIComponent(String(text || "")); }

  // ---------- compass ----------
  // ev: a deviceorientation(absolute) event (or a plain object with the
  // same fields); screen: the screen angle (0, 90, 180, 270).
  function heading(ev, screen) {
    if (!ev) return null;
    var h = null;
    if (num(ev.webkitCompassHeading) && ev.webkitCompassHeading >= 0) h = ev.webkitCompassHeading;     // iOS: already clockwise from north
    else if (ev.absolute === true && num(ev.alpha)) h = (360 - ev.alpha + (num(screen) ? screen : 0)) % 360;
    else return null;
    h = ((h % 360) + 360) % 360;
    return Math.round(h * 10) / 10;
  }
  function cardinal(h) { return num(h) ? Math.round(((h % 360) + 360) % 360 / 45) % 8 : -1; }

  var api = { dd: dd, dms: dms, ddm: ddm, utm: utm, zoneOf: zoneOf, smsText: smsText, smsHref: smsHref,
    heading: heading, cardinal: cardinal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsWhere = api;
})(typeof window !== "undefined" ? window : this);
