// ============================================================
// orOS — enrich.js: "Update from online sources" (shared core)
// ------------------------------------------------------------
// Contacts, CRM and Newsletter ask the same question: what does the
// public web say about this person or business? This file answers it
// with SUGGESTIONS only. The app shows them for review (enrichui.js)
// and writes nothing the person did not tick.
//
// Rules (plan /mnt/project-files/contacts-enrich/plan.md, Chris
// 2026-10-15):
//   - start only from what the record already holds: its own e-mail,
//     its own website / link page, its phone number. Never a search
//     by name alone, never a face search.
//   - open networks (GitHub, Bluesky, Mastodon) are read through
//     their public APIs, only from a profile link the record holds or
//     a finding points at (wave 2).
//   - businesses (org records) are looked up in OpenStreetMap by name
//     + the place the record holds, or by its phone; Wikidata items
//     are found by the record's own website or profile ids, never by
//     a name (wave 3).
//   - a search by name happens only on the user's own SearXNG server
//     (set in the Assistant), for a few records at a time, and every
//     result is "check"; the closed networks get search links the
//     person opens themselves (DuckDuckGo, never Google) (wave 4).
//   - closed networks (Facebook, Instagram, LinkedIn, X, TikTok…)
//     are never read: their terms forbid it. Their links are kept
//     as links, nothing more.
//   - every suggestion says where it came from and how sure it is:
//       "sure"   keyed by something only this record has (its own
//                e-mail, a page that shows its own phone or e-mail,
//                a verified account) or seen in two sources
//       "likely" the record's own page, nothing contradicts it
//       "check"  the name found does not agree with the record
//     "check" suggestions start unticked.
//   - a shared e-mail (two records hold it) is not used as a key.
//
// Pure helpers (Node tests):
//   normPhone(s) → digits for comparing ("" if too short)
//   samePhone(a, b) → bool (country code tolerant)
//   normUrl(s) → "https://host/path" or ""
//   classify(url) → { kind: "social"|"links"|"site", net, label, fetch }
//   skeleton(s) → consonant skeleton (Greek and Latin spellings meet)
//   nameAgree(recordNames[], foundName) → 1 agree | 0 unknown | -1 no
//   parsePage(html, baseUrl) → { title, image, links, relMe, phones,
//     emails, people: [ld person/org] }
//   fromGravatar(json) → finding
//   fromPage(parsed, url, ctx) → finding
//   propose(rec, findings) → [suggestion]
// Network (browser; injectable for tests):
//   lookup(rec, opts) → Promise<[suggestion]>
// rec = { names: [string], emails: [string], phones: [string],
//         sites: [string], has: { photo, birthday, job, org, address,
//         name }, kind: "person"|"org"|"" }
// suggestion = { k: "photo"|"link"|"phone"|"email"|"birthday"|"job"|
//   "org"|"address"|"name", v: value, label?, conf, src: [names] }
//   birthday v = { day: "MM-DD", year: n|null }
// Nothing here touches the DOM or storage, and nothing read from a
// page is ever run or inserted as HTML: values are plain strings.
// UMD: window.OrosEnrich in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = mail.js
  var GRAVATAR_API = "https://api.gravatar.com/v3/profiles/";
  var MAX_PAGES = 4;          // pages read per record
  var MAX_LINKS = 12;         // link suggestions per record
  var MAX_PROFILES = 3;       // GitHub / Bluesky / Mastodon profiles per record
  var CONF_RANK = { check: 0, likely: 1, sure: 2 };

  // ---------- small helpers ----------
  function str(v, n) {
    return String(v == null ? "" : v).replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 300);
  }
  function uniq(list) {
    var seen = {}, out = [];
    list.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }
  function decodeEntities(s) {
    return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39|nbsp);/gi, function (m, e) {
      var l = e.toLowerCase();
      if (l === "amp") return "&";
      if (l === "lt") return "<";
      if (l === "gt") return ">";
      if (l === "quot") return "\"";
      if (l === "apos" || l === "#39") return "'";
      if (l === "nbsp") return " ";
      var code = l.charAt(1) === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    });
  }

  // ---------- phones ----------
  // Digits only; "00" becomes the "+" it stands for. Comparing keeps
  // the last 10 digits so "+30 697…" and "697…" meet.
  function normPhone(s) {
    var d = String(s || "").replace(/^\s*00/, "+").replace(/[^\d]/g, "");
    return d.length >= 7 ? d : "";
  }
  function samePhone(a, b) {
    var x = normPhone(a), y = normPhone(b);
    if (!x || !y) return false;
    var n = Math.min(10, x.length, y.length);
    return n >= 7 && x.slice(-n) === y.slice(-n);
  }

  // ---------- URLs ----------
  function normUrl(s) {
    var v = str(s, 500);
    if (!v) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = "https://" + v.replace(/^\/+/, "");
    var u;
    try { u = new URL(v); } catch (e) { return ""; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (u.username || u.password || !/\./.test(u.hostname)) return "";
    u.hash = "";
    var out = u.protocol + "//" + u.hostname.toLowerCase().replace(/^www\./, "") + (u.port ? ":" + u.port : "") + u.pathname.replace(/\/+$/, "") + u.search;
    return out.slice(0, 300);
  }
  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch (e) { return ""; }
  }
  function pathOf(url) {
    try { return new URL(url).pathname; } catch (e) { return "/"; }
  }

  // Networks: closed ones are links only (fetch: false). Link pages
  // are read like any website.
  var NETS = [
    { re: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/, net: "facebook", label: "Facebook", closed: 1 },
    { re: /(^|\.)instagram\.com$/, net: "instagram", label: "Instagram", closed: 1 },
    { re: /(^|\.)(linkedin\.com|lnkd\.in)$/, net: "linkedin", label: "LinkedIn", closed: 1 },
    { re: /(^|\.)(twitter\.com|x\.com)$/, net: "x", label: "X", closed: 1 },
    { re: /(^|\.)tiktok\.com$/, net: "tiktok", label: "TikTok", closed: 1 },
    { re: /(^|\.)threads\.(net|com)$/, net: "threads", label: "Threads", closed: 1 },
    { re: /(^|\.)pinterest\.[a-z.]+$/, net: "pinterest", label: "Pinterest", closed: 1 },
    { re: /(^|\.)snapchat\.com$/, net: "snapchat", label: "Snapchat", closed: 1 },
    { re: /(^|\.)(youtube\.com|youtu\.be)$/, net: "youtube", label: "YouTube", closed: 1 },
    { re: /(^|\.)(t\.me|telegram\.me)$/, net: "telegram", label: "Telegram", closed: 1 },
    { re: /(^|\.)(wa\.me|whatsapp\.com)$/, net: "whatsapp", label: "WhatsApp", closed: 1 },
    { re: /(^|\.)(viber\.com|vb\.me)$/, net: "viber", label: "Viber", closed: 1 },
    { re: /(^|\.)github\.com$/, net: "github", label: "GitHub" },
    { re: /(^|\.)bsky\.app$/, net: "bluesky", label: "Bluesky" },
    { re: /(^|\.)(soundcloud\.com)$/, net: "soundcloud", label: "SoundCloud", closed: 1 },
    { re: /(^|\.)(open\.spotify\.com)$/, net: "spotify", label: "Spotify", closed: 1 },
    { re: /(^|\.)bandcamp\.com$/, net: "bandcamp", label: "Bandcamp" },
    { re: /(^|\.)twitch\.tv$/, net: "twitch", label: "Twitch", closed: 1 },
    { re: /(^|\.)behance\.net$/, net: "behance", label: "Behance", closed: 1 },
    { re: /(^|\.)dribbble\.com$/, net: "dribbble", label: "Dribbble", closed: 1 },
    { re: /(^|\.)medium\.com$/, net: "medium", label: "Medium" },
    { re: /(^|\.)substack\.com$/, net: "substack", label: "Substack" },
    { re: /(^|\.)(etsy\.com)$/, net: "etsy", label: "Etsy", closed: 1 },
    { re: /(^|\.)(gravatar\.com)$/, net: "gravatar", label: "Gravatar", closed: 1 },
    { re: /(^|\.)(google\.[a-z.]+|goo\.gl|g\.page)$/, net: "google", label: "Google", closed: 1 }
  ];
  var LINK_PAGES = /(^|\.)(linktr\.ee|bio\.link|beacons\.ai|lnk\.bio|carrd\.co|about\.me|taplink\.cc|solo\.to|campsite\.bio|linkin\.bio|hoo\.be|msha\.ke|flow\.page|linkpop\.com|tap\.bio|allmylinks\.com|direct\.me|linkr\.bio|bento\.me|koji\.to|stan\.store|contactin\.bio|biolinky\.co|withkoji\.com|lynk\.id)$/;

  function classify(url) {
    var h = hostOf(url);
    if (!h) return null;
    for (var i = 0; i < NETS.length; i++) {
      if (NETS[i].re.test(h)) return { kind: "social", net: NETS[i].net, label: NETS[i].label, fetch: !NETS[i].closed };
    }
    if (LINK_PAGES.test(h)) return { kind: "links", net: "links", label: h, fetch: true };
    // a fediverse profile (Mastodon and friends): /@name on any host
    if (/^\/@[A-Za-z0-9_.-]+\/?$/.test(pathOf(url))) return { kind: "social", net: "fediverse", label: "Mastodon", fetch: true };
    return { kind: "site", net: "site", label: h, fetch: true };
  }
  // A link that says nothing about a person: shares, logins, app
  // stores, the page builder's own pages.
  function isNoise(url) {
    var h = hostOf(url), p = pathOf(url);
    if (!h) return true;
    if (/(^|\.)(apple\.com|play\.google\.com|w3\.org|schema\.org|cloudflare\.com|wordpress\.org|wix\.com|squarespace\.com|shopify\.com|cookiebot\.com|gstatic\.com|googleapis\.com|googletagmanager\.com|doubleclick\.net|jsdelivr\.net|unpkg\.com)$/.test(h)) return true;
    if (/\/(sharer|share|intent|login|signup|signin|register|privacy|terms|policy|cookies?)\b/i.test(p)) return true;
    if (/\.(css|js|png|jpe?g|gif|svg|webp|ico|woff2?|pdf|zip|xml|json)$/i.test(p)) return true;
    if (LINK_PAGES.test(h) && (p === "/" || p === "")) return true;   // the builder's own home page
    var c = classify(url);
    if (c && c.kind === "social" && (p === "/" || p === "")) return true;   // a bare network home page
    return false;
  }

  // ---------- names ----------
  // i18n-inline-ok: Greek-to-Latin letter map for name matching (data, no UI text)
  var GR = { "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th", "ι": "i", "κ": "k",
             "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s", "ς": "s", "τ": "t",
             "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o" };
  // Consonant skeleton: "Χρήστος" and "Christos" both give "krsts",
  // "Κουλαξίζης" and "Koulaxizis" both "klkszs".
  function skeleton(s) {
    var f = String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    var out = "";
    for (var i = 0; i < f.length; i++) { var ch = f.charAt(i); out += GR[ch] !== undefined ? GR[ch] : ch; }
    out = out.replace(/[^a-z]/g, "")
      .replace(/ph/g, "f").replace(/th/g, "t").replace(/h/g, "")
      .replace(/x/g, "ks").replace(/q/g, "k").replace(/c/g, "k").replace(/w/g, "v").replace(/b/g, "v")
      .replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1");
    return out;
  }
  // Whole Latin form with vowels, for name parts whose skeleton is too
  // short to mean anything ("Άννα" → "ana", "Παππά" → "papa").
  function latinForm(s) {
    var f = String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    var out = "";
    for (var i = 0; i < f.length; i++) { var ch = f.charAt(i); out += GR[ch] !== undefined ? GR[ch] : ch; }
    return out.replace(/[^a-z]/g, "").replace(/h/g, "").replace(/ou/g, "u").replace(/[eiy]/g, "i")
      .replace(/c/g, "k").replace(/w/g, "v").replace(/b/g, "v").replace(/(.)\1+/g, "$1");
  }
  function tokens(s) {
    return String(s || "").split(/[\s,.'"’()\-_|@/]+/).map(function (w) {
      var k = skeleton(w);
      if (k.length >= 2) return k;
      var l = latinForm(w);
      return l.length >= 3 ? "~" + l : "";
    }).filter(Boolean);
  }
  function tokMatch(a, b) {
    if (a === b) return true;
    var n = Math.min(a.length, b.length);
    return n >= 3 && a.slice(0, n) === b.slice(0, n);
  }
  // 1: the name found shares a real name part with the record;
  // -1: it clearly names someone else; 0: nothing to compare.
  function nameAgree(names, found) {
    var ft = tokens(found);
    if (!ft.length) return 0;
    var rt = [];
    (names || []).forEach(function (n) { rt = rt.concat(tokens(n)); });
    if (!rt.length) return 0;
    for (var i = 0; i < ft.length; i++) {
      for (var j = 0; j < rt.length; j++) if (tokMatch(ft[i], rt[j])) return 1;
    }
    return -1;
  }

  // ---------- reading a page ----------
  function attrs(tag) {
    var out = {}, re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g, m;
    var body = tag.replace(/^<\s*[a-zA-Z0-9]+/, "").replace(/\/?>$/, "");
    while ((m = re.exec(body))) {
      var v = m[3] != null ? m[3] : (m[4] != null ? m[4] : (m[5] != null ? m[5] : ""));
      out[m[1].toLowerCase()] = decodeEntities(v);
    }
    return out;
  }
  function absUrl(href, base) {
    try { return new URL(href, base).href; } catch (e) { return ""; }
  }
  function ymd(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
    if (m) return { day: m[2] + "-" + m[3], year: +m[1] >= 1850 && +m[1] <= 2200 ? +m[1] : null };
    m = /^--(\d{2})-(\d{2})$/.exec(String(v || ""));
    if (m) return { day: m[1] + "-" + m[2], year: null };
    return null;
  }
  function validBirthday(b) {
    if (!b || !/^\d{2}-\d{2}$/.test(b.day)) return null;
    var mm = +b.day.slice(0, 2), dd = +b.day.slice(3);
    if (mm < 1 || mm > 12 || dd < 1 || dd > new Date(2000, mm, 0).getDate()) return null;
    return b;
  }
  function addrText(a) {
    if (!a) return "";
    if (typeof a === "string") return str(a, 200);
    if (Array.isArray(a)) return addrText(a[0]);
    if (typeof a !== "object") return "";
    var country = a.addressCountry && typeof a.addressCountry === "object" ? a.addressCountry.name : a.addressCountry;
    return str([a.streetAddress, [a.postalCode, a.addressLocality].filter(Boolean).join(" "), a.addressRegion, country]
      .map(function (x) { return str(x, 100); }).filter(Boolean).join(", "), 200);
  }
  function ldFlat(node, out, depth) {
    if (!node || typeof node !== "object" || depth > 6 || out.length > 40) return;
    if (Array.isArray(node)) { node.forEach(function (n) { ldFlat(n, out, depth + 1); }); return; }
    if (node["@graph"]) ldFlat(node["@graph"], out, depth + 1);
    var ty = [].concat(node["@type"] || []).join(" ");
    if (/\b(Person|Organization|Corporation|LocalBusiness|Store|Restaurant|ProfessionalService|MedicalBusiness|LegalService|Dentist|Physician|[A-Za-z]+Business|[A-Za-z]+Store)\b/.test(ty)) {
      var person = /\bPerson\b/.test(ty);
      var img = node.image || node.logo;
      if (img && typeof img === "object") img = Array.isArray(img) ? (typeof img[0] === "string" ? img[0] : img[0] && img[0].url) : img.url;
      var same = [].concat(node.sameAs || []).filter(function (s) { return typeof s === "string"; });
      out.push({
        person: person, name: str(node.name, 120), tel: [].concat(node.telephone || []).map(function (x) { return str(x, 40); }),
        email: [].concat(node.email || []).map(function (x) { return str(String(x).replace(/^mailto:/i, ""), 120); }),
        address: addrText(node.address), birth: person ? ymd(node.birthDate) : null,
        job: person ? str(node.jobTitle, 80) : "",
        org: person && node.worksFor ? str(typeof node.worksFor === "string" ? node.worksFor : [].concat(node.worksFor)[0] && [].concat(node.worksFor)[0].name, 80) : "",
        image: typeof img === "string" ? img : "", same: same, url: typeof node.url === "string" ? node.url : ""
      });
    }
    ["mainEntity", "author", "founder", "publisher", "about"].forEach(function (k) { if (node[k] && typeof node[k] === "object") ldFlat(node[k], out, depth + 1); });
  }
  function parsePage(html, baseUrl) {
    var src = String(html || "").slice(0, 2000000);
    var out = { title: "", image: "", links: [], relMe: [], phones: [], emails: [], people: [] };
    var m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src);
    if (m) out.title = str(decodeEntities(m[1]), 160);
    var metaRe = /<meta\b[^>]*>/gi, linkRe = /<(a|link)\b[^>]*>/gi, x;
    var og = {};
    while ((x = metaRe.exec(src))) {
      var a = attrs(x[0]);
      var key = (a.property || a.name || "").toLowerCase();
      if (key && a.content && !og[key]) og[key] = a.content;
    }
    if (og["og:title"]) out.title = str(og["og:title"], 160);
    var img = og["og:image"] || og["og:image:url"] || og["twitter:image"] || og["twitter:image:src"];
    if (img) out.image = absUrl(img, baseUrl);
    while ((x = linkRe.exec(src))) {
      var at = attrs(x[0]);
      if (!at.href) continue;
      var href = at.href.trim(), rel = (at.rel || "").toLowerCase().split(/\s+/);
      if (/^tel:/i.test(href)) { var ph = normPhone(decodeURIComponent(href.slice(4))); if (ph) out.phones.push(href.slice(4).replace(/%20/g, " ").trim().slice(0, 40)); continue; }
      if (/^mailto:/i.test(href)) {
        var mail = decodeURIComponent(href.slice(7).split("?")[0]).trim().toLowerCase();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) out.emails.push(mail.slice(0, 120));
        continue;
      }
      if (x[1].toLowerCase() === "link" && rel.indexOf("me") < 0) continue;
      var abs = normUrl(absUrl(href, baseUrl));
      if (!abs) continue;
      if (rel.indexOf("me") >= 0) out.relMe.push(abs);
      out.links.push(abs);
      // wa.me/<number> is a phone number in plain sight
      var wa = /^https?:\/\/(?:api\.)?wa\.me\/(\d{7,15})/.exec(abs) || /^https?:\/\/(?:api\.)?whatsapp\.com\/send\?phone=(\d{7,15})/.exec(abs);
      if (wa) out.phones.push("+" + wa[1]);
    }
    var ldRe = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
    while ((x = ldRe.exec(src))) {
      var j = null;
      try { j = JSON.parse(x[1].trim()); } catch (e) { j = null; }
      if (j) ldFlat(j, out.people, 0);
    }
    out.people.forEach(function (p) {
      if (p.image) p.image = absUrl(p.image, baseUrl);
      p.same = p.same.map(normUrl).filter(Boolean);
    });
    var own = hostOf(baseUrl);
    out.links = uniq(out.links.filter(function (u) { return hostOf(u) !== own && !isNoise(u); })).slice(0, 60);
    out.relMe = uniq(out.relMe);
    out.phones = uniq(out.phones).slice(0, 10);
    out.emails = uniq(out.emails).slice(0, 10);
    return out;
  }

  // ---------- findings ----------
  // finding = { src, base: conf, name, photo, links: [{url, verified}],
  //   phones, emails, birthday, job, org, address, personal }
  function fromGravatar(j) {
    if (!j || typeof j !== "object" || j.error) return null;
    var f = { src: "Gravatar", name: str(j.display_name, 120), photo: "", links: [], phones: [], emails: [],
              birthday: null, job: str(j.job_title, 80), org: str(j.company, 80), address: "", personal: true };
    if (typeof j.avatar_url === "string" && /^https:\/\//.test(j.avatar_url) && !j.is_default_avatar) {
      f.photo = j.avatar_url.replace(/\?.*$/, "") + "?s=256&d=404";
    }
    (Array.isArray(j.verified_accounts) ? j.verified_accounts : []).forEach(function (a) {
      if (!a || a.is_hidden) return;
      var u = normUrl(a.url);
      if (u) f.links.push({ url: u, verified: true });
    });
    (Array.isArray(j.links) ? j.links : []).forEach(function (l) {
      var u = l && normUrl(l.url);
      if (u) f.links.push({ url: u, verified: false });
    });
    var ci = j.contact_info && typeof j.contact_info === "object" ? j.contact_info : {};
    ["cell_phone", "home_phone", "work_phone"].forEach(function (k) { if (normPhone(ci[k])) f.phones.push(str(ci[k], 40)); });
    if (typeof ci.email === "string" && /@/.test(ci.email)) f.emails.push(ci.email.trim().toLowerCase().slice(0, 120));
    if (j.birth_date) f.birthday = ymd(j.birth_date);
    else if (j.birth_day && j.birth_month) {
      var mm = ("0" + (j.birth_month | 0)).slice(-2), dd = ("0" + (j.birth_day | 0)).slice(-2);
      f.birthday = { day: mm + "-" + dd, year: j.birth_year ? j.birth_year | 0 : null };
    }
    return f;
  }
  // A page the record links to (or a link page a sure source points
  // at). ctx = { label, via, rec }.
  function fromPage(p, url, ctx) {
    var cls = classify(url) || { kind: "site" };
    var people = p.people || [];
    var me = people.filter(function (x) { return x.person; })[0] || null;
    var org = people.filter(function (x) { return !x.person; })[0] || null;
    var main = me || org;
    var personal = cls.kind === "links" || cls.net === "fediverse" || !!me;
    var f = { src: ctx && ctx.label || hostOf(url), name: main ? main.name : "", photo: "", links: [], phones: [], emails: [],
              birthday: me ? validBirthday(me.birth) : null, job: me ? me.job : "", org: me ? me.org : (org && ctx && ctx.rec && ctx.rec.kind === "org" ? org.name : ""),
              address: main ? main.address : "", personal: personal, page: url, title: p.title };
    if (!f.name && personal) f.name = p.title;
    var img = (main && main.image) || p.image;
    if (img && /^https:\/\//.test(img)) f.photo = img;
    p.relMe.forEach(function (u) { f.links.push({ url: u, verified: true }); });
    if (main) main.same.forEach(function (u) { f.links.push({ url: u, verified: false }); });
    // On a link page every outgoing link is the person's; on a normal
    // site only links to profiles on known networks are.
    p.links.forEach(function (u) {
      var c = classify(u);
      if (cls.kind === "links" || (c && c.kind !== "site")) f.links.push({ url: u, verified: false });
    });
    f.phones = uniq(p.phones.concat(main ? main.tel : []).filter(normPhone));
    f.emails = uniq(p.emails.concat(main ? main.email : []).map(function (e) { return e.toLowerCase(); }).filter(function (e) { return /@/.test(e); }));
    return f;
  }

  // Confidence of one finding for this record.
  function grade(rec, f) {
    var conf = f.base || "likely";
    var agree = nameAgree(rec.names, f.name);
    // the page shows the record's own phone or e-mail: it is theirs
    var hit = f.phones.some(function (p) { return rec.phones.some(function (q) { return samePhone(p, q); }); }) ||
      f.emails.some(function (e) { return rec.emails.indexOf(e) >= 0; });
    if (hit || agree === 1) conf = f.base === "check" ? "likely" : "sure";
    if (agree === -1 && !hit) conf = "check";
    return { conf: conf, agree: agree, hit: hit };
  }

  // Merge every finding into suggestions; nothing the record already
  // holds is suggested again. Two sources for the same value make it
  // "sure".
  function propose(rec, findings) {
    rec = normRec(rec);
    var bag = {}, order = [];
    function add(k, key, v, conf, src, label) {
      var id = k + "|" + key;
      var s = bag[id];
      if (!s) { s = bag[id] = { k: k, v: v, conf: conf, src: [] }; if (label) s.label = label; order.push(id); }
      else if (CONF_RANK[conf] > CONF_RANK[s.conf]) s.conf = conf;
      if (s.src.indexOf(src) < 0) s.src.push(src);
      if (s.src.length >= 2 && s.conf === "likely") s.conf = "sure";
    }
    var haveSites = rec.sites.map(normUrl);
    findings.forEach(function (f) {
      if (!f) return;
      var g = grade(rec, f), conf = g.conf, src = f.src;
      if (f.photo && !rec.has.photo && (f.personal || rec.kind === "org")) add("photo", f.photo, f.photo, conf, src);
      f.links.forEach(function (l) {
        if (haveSites.indexOf(l.url) >= 0) return;
        var c = classify(l.url);
        if (!c || isNoise(l.url)) return;
        var lc = l.verified && conf !== "check" ? "sure" : conf;
        add("link", l.url, l.url, lc, src, c.kind === "social" ? c.label : "");
      });
      f.phones.forEach(function (p) {
        if (rec.phones.some(function (q) { return samePhone(p, q); })) return;
        add("phone", normPhone(p).slice(-10), p, conf, src);
      });
      f.emails.forEach(function (e) {
        if (rec.emails.indexOf(e) >= 0) return;
        add("email", e, e, conf, src);
      });
      var b = validBirthday(f.birthday);
      if (b && !rec.has.birthday) add("birthday", b.day + "/" + (b.year || ""), b, conf, src);
      if (f.job && !rec.has.job) add("job", f.job.toLowerCase(), f.job, conf, src);
      if (f.org && !rec.has.org) add("org", f.org.toLowerCase(), f.org, conf, src);
      if (f.address && !rec.has.address) add("address", f.address.toLowerCase(), f.address, conf, src);
      if (f.name && !rec.has.name && (g.hit || f.via)) add("name", f.name.toLowerCase(), f.name, conf, src);
    });
    var out = order.map(function (id) { return bag[id]; });
    // one photo is enough: the surest, first found
    var photos = out.filter(function (s) { return s.k === "photo"; })
      .sort(function (a, b) { return CONF_RANK[b.conf] - CONF_RANK[a.conf]; });
    var links = out.filter(function (s) { return s.k === "link"; }).slice(0, MAX_LINKS);
    return out.filter(function (s) {
      if (s.k === "photo") return s === photos[0];
      if (s.k === "link") return links.indexOf(s) >= 0;
      return true;
    });
  }

  function normRec(rec) {
    rec = rec || {};
    var has = rec.has || {};
    return {
      names: (rec.names || []).map(function (n) { return str(n, 120); }).filter(Boolean),
      emails: uniq((rec.emails || []).map(function (e) { return String(e || "").trim().toLowerCase(); }).filter(function (e) { return /@/.test(e); })),
      shared: rec.shared || {},
      phones: (rec.phones || []).filter(normPhone),
      sites: uniq((rec.sites || []).map(normUrl).filter(Boolean)),
      place: str(rec.place, 160),
      has: { photo: !!has.photo, birthday: !!has.birthday, job: !!has.job, org: !!has.org, address: !!has.address, name: !!has.name },
      kind: rec.kind === "person" || rec.kind === "org" ? rec.kind : ""
    };
  }

  // ---------- open networks (public APIs, no sign-in) ----------
  var GH_RESERVED = /^(orgs|features|topics|collections|sponsors|marketplace|explore|settings|login|join|about|pricing|enterprise|security|apps|search|notifications|pulls|issues|trending|events|site|contact)$/i;
  // A profile link → its public API address, or null.
  function profileApi(url) {
    var c = classify(url);
    if (!c || c.kind !== "social") return null;
    var u;
    try { u = new URL(url); } catch (e) { return null; }
    var parts = u.pathname.split("/").filter(Boolean);
    if (c.net === "github" && parts.length === 1 && /^[A-Za-z0-9-]{1,39}$/.test(parts[0]) && !GH_RESERVED.test(parts[0])) {
      return { net: "github", api: "https://api.github.com/users/" + parts[0], label: "GitHub" };
    }
    if (c.net === "bluesky" && parts[0] === "profile" && parts[1] && /^[A-Za-z0-9.:-]{3,253}$/.test(parts[1])) {
      return { net: "bluesky", api: "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=" + encodeURIComponent(parts[1]), label: "Bluesky" };
    }
    if (c.net === "fediverse" && parts.length === 1 && /^@[A-Za-z0-9_.-]{1,64}$/.test(parts[0])) {
      return { net: "fediverse", api: u.protocol + "//" + u.host + "/api/v1/accounts/lookup?acct=" + encodeURIComponent(parts[0].slice(1)), label: "Mastodon" };
    }
    return null;
  }
  // Links written in plain text (a bio).
  function textLinks(s) {
    var out = [], re = /\bhttps?:\/\/[^\s<>"')\]]+/gi, m;
    while ((m = re.exec(String(s || "")))) { var u = normUrl(m[0].replace(/[.,;:!?]+$/, "")); if (u) out.push(u); }
    return out;
  }
  function blank(src) {
    return { src: src, name: "", photo: "", links: [], phones: [], emails: [], birthday: null, job: "", org: "", address: "", personal: true };
  }
  function fromGitHub(j) {
    if (!j || typeof j !== "object" || typeof j.login !== "string") return null;
    var f = blank("GitHub");
    f.name = str(j.name, 120);
    if (j.blog) { var b = normUrl(j.blog); if (b) f.links.push({ url: b, verified: false }); }
    if (j.twitter_username && /^[A-Za-z0-9_]{1,15}$/.test(j.twitter_username)) f.links.push({ url: "https://x.com/" + j.twitter_username, verified: false });
    textLinks(j.bio).forEach(function (u) { f.links.push({ url: u, verified: false }); });
    if (typeof j.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(j.email)) f.emails.push(j.email.trim().toLowerCase().slice(0, 120));
    if (j.company) f.org = str(String(j.company).replace(/^@/, ""), 80);
    return f;
  }
  function fromBluesky(j) {
    if (!j || typeof j !== "object" || typeof j.handle !== "string") return null;
    var f = blank("Bluesky");
    f.name = str(j.displayName, 120);
    textLinks(j.description).forEach(function (u) { f.links.push({ url: u, verified: false }); });
    // a handle that is a domain was proven by its owner (DNS / well-known)
    if (!/\.bsky\.social$/i.test(j.handle) && /\./.test(j.handle) && j.handle !== "handle.invalid") {
      var d = normUrl("https://" + j.handle);
      if (d) f.links.push({ url: d, verified: true });
    }
    return f;
  }
  function fromMastodon(j, base) {
    if (!j || typeof j !== "object" || typeof j.acct !== "string") return null;
    var f = blank("Mastodon");
    f.name = str(String(j.display_name || "").replace(/:[a-z0-9_]+:/gi, ""), 120);
    var note = parsePage(String(j.note || ""), base || "https://invalid.example/");
    note.links.forEach(function (u) { f.links.push({ url: u, verified: false }); });
    (Array.isArray(j.fields) ? j.fields : []).slice(0, 8).forEach(function (fl) {
      if (!fl || typeof fl.value !== "string") return;
      var p = parsePage(fl.value, base || "https://invalid.example/");
      var urls = p.links.length ? p.links : textLinks(fl.value.replace(/<[^>]*>/g, " "));
      urls.forEach(function (u) { f.links.push({ url: u, verified: !!fl.verified_at }); });
      p.emails.forEach(function (e) { f.emails.push(e); });
      p.phones.forEach(function (x) { f.phones.push(x); });
    });
    return f;
  }
  function profile(it, opts) {
    return getText(it.a.api, opts).then(function (r) {
      if (!r || r.status !== 200) return null;
      var j = null;
      try { j = JSON.parse(r.text); } catch (e) { return null; }
      var f = it.a.net === "github" ? fromGitHub(j) : (it.a.net === "bluesky" ? fromBluesky(j) : fromMastodon(j, it.url));
      if (f) f.base = it.base;
      return f;
    }, function () { return null; });
  }

  // ---------- businesses: OpenStreetMap (Photon + Overpass) ----------
  var PHOTON = "https://photon.komoot.io/api/";
  var OVERPASS = "https://overpass-api.de/api/interpreter";
  // OSM tags → a finding (phone, website, e-mail, address, links).
  function fromOsm(tags) {
    if (!tags || typeof tags !== "object") return null;
    var f = blank("OpenStreetMap");
    f.personal = false;
    f.name = str(tags.name, 120);
    ["phone", "contact:phone", "contact:mobile", "mobile"].forEach(function (k) {
      String(tags[k] || "").split(";").forEach(function (p) { if (normPhone(p)) f.phones.push(str(p, 40)); });
    });
    ["email", "contact:email"].forEach(function (k) {
      var e = String(tags[k] || "").trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) f.emails.push(e.slice(0, 120));
    });
    ["website", "contact:website", "url"].forEach(function (k) {
      var u = normUrl(tags[k]);
      if (u) f.links.push({ url: u, verified: false });
    });
    var SOC = { "contact:facebook": "https://facebook.com/", "contact:instagram": "https://instagram.com/",
                "contact:twitter": "https://x.com/", "contact:tiktok": "https://tiktok.com/@", "contact:youtube": "https://youtube.com/" };
    Object.keys(SOC).forEach(function (k) {
      var v = String(tags[k] || "").trim();
      if (!v) return;
      var u = /^https?:\/\//i.test(v) ? normUrl(v) : (/^[A-Za-z0-9_.@-]{1,80}$/.test(v) ? normUrl(SOC[k] + v.replace(/^@/, "")) : "");
      if (u) f.links.push({ url: u, verified: false });
    });
    var street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
    var town = [tags["addr:postcode"], tags["addr:city"]].filter(Boolean).join(" ");
    f.address = str([street, town].filter(Boolean).join(", "), 200);
    return f;
  }
  // Overpass regex for a phone number written with any spacing.
  function phoneRegex(p) {
    var d = normPhone(p).slice(-10);
    return d.length >= 8 ? d.split("").join("[^0-9]*") : "";
  }
  function overpass(q, opts) {
    return getText(OVERPASS + "?data=" + encodeURIComponent(q), opts).then(function (r) {
      if (!r || r.status !== 200) return [];
      try { var j = JSON.parse(r.text); return Array.isArray(j.elements) ? j.elements.slice(0, 10) : []; } catch (e) { return []; }
    }, function () { return []; });
  }
  // Photon finds the business by name (+ the place the record holds),
  // Overpass brings its tags. A candidate stays only when it shares the
  // record's phone ("sure") or agrees on the name ("likely"); with no
  // place and no shared phone it is "check". deep: when nothing came
  // back by name, look the record's phone up in OSM (Greek numbers).
  function business(rec, opts) {
    var name = rec.names[0];
    if (!name || (!rec.place && !rec.phones.length)) return Promise.resolve([]);
    var q = PHOTON + "?limit=5&q=" + encodeURIComponent((name + (rec.place ? ", " + rec.place : "")).slice(0, 200));
    return getText(q, opts).then(function (r) {
      var feats = [];
      try { feats = r && r.status === 200 ? (JSON.parse(r.text).features || []) : []; } catch (e) { feats = []; }
      var ids = { N: [], W: [], R: [] };
      feats.forEach(function (ft) {
        var p = ft && ft.properties;
        if (p && ids[p.osm_type] && /^\d+$/.test(String(p.osm_id)) && nameAgree(rec.names, p.name) === 1) ids[p.osm_type].push(p.osm_id);
      });
      var parts = [];
      if (ids.N.length) parts.push("node(id:" + ids.N.join(",") + ");");
      if (ids.W.length) parts.push("way(id:" + ids.W.join(",") + ");");
      if (ids.R.length) parts.push("rel(id:" + ids.R.join(",") + ");");
      if (!parts.length) return [];
      return overpass("[out:json][timeout:15];(" + parts.join("") + ");out tags;", opts);
    }, function () { return []; }).then(function (els) {
      if (els.length || !opts.deep || !rec.phones.length) return els;
      var p = rec.phones.filter(function (x) { var d = normPhone(x); return /^(30)?[26]\d{9}$/.test(d) || /^30/.test(d); })[0];
      var re = p && phoneRegex(p);
      if (!re) return [];
      return overpass("[out:json][timeout:20];area[\"ISO3166-1\"=\"GR\"][admin_level=2]->.a;(nwr(area.a)[\"phone\"~\"" + re + "\"];nwr(area.a)[\"contact:phone\"~\"" + re + "\"];);out tags 3;", opts);
    }).then(function (els) {
      var out = [];
      els.forEach(function (el) {
        var f = fromOsm(el && el.tags);
        if (!f) return;
        var shares = f.phones.some(function (p) { return rec.phones.some(function (q) { return samePhone(p, q); }); });
        var agree = nameAgree(rec.names, f.name) === 1;
        if (!shares && !agree) return;
        f.base = shares ? "sure" : (rec.place ? "likely" : "check");
        out.push(f);
      });
      return out.slice(0, 2);
    });
  }

  // ---------- Wikidata: items that name the record's own links ----------
  var WD_SPARQL = "https://query.wikidata.org/sparql";
  // Property → how a profile link spells its id there.
  var WD_IDS = [
    { p: "P2037", net: "github", re: /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})$/, url: "https://github.com/" },
    { p: "P2003", net: "instagram", re: /^https:\/\/instagram\.com\/([A-Za-z0-9_.]{1,30})$/, url: "https://instagram.com/" },
    { p: "P2002", net: "x", re: /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})$/, url: "https://x.com/" },
    { p: "P2013", net: "facebook", re: /^https:\/\/facebook\.com\/([A-Za-z0-9.]{1,80})$/, url: "https://facebook.com/" },
    { p: "P6634", net: "linkedin", re: /^https:\/\/linkedin\.com\/in\/([A-Za-z0-9_-]{1,100})$/, url: "https://linkedin.com/in/" },
    { p: "P4264", net: "linkedin", re: /^https:\/\/linkedin\.com\/company\/([A-Za-z0-9_-]{1,100})$/, url: "https://linkedin.com/company/" },
    { p: "P7085", net: "tiktok", re: /^https:\/\/tiktok\.com\/@([A-Za-z0-9_.]{1,40})$/, url: "https://tiktok.com/@" },
    { p: "P12361", net: "bluesky", re: /^https:\/\/bsky\.app\/profile\/([A-Za-z0-9.-]{3,253})$/, url: "https://bsky.app/profile/" }
  ];
  function wdKeys(urls) {
    var webs = [], ids = [];
    urls.forEach(function (u) {
      var c = classify(u);
      if (!c) return;
      if (c.kind === "site") {
        var h = hostOf(u), path = pathOf(u).replace(/\/+$/, "");
        if (!/^[a-z0-9.-]+$/.test(h) || !/^[A-Za-z0-9\/._~-]*$/.test(path)) return;
        ["https://", "http://"].forEach(function (pr) {
          ["", "www."].forEach(function (w) { [path, path + "/"].forEach(function (pa) { webs.push("<" + pr + w + h + pa + ">"); }); });
        });
        return;
      }
      WD_IDS.forEach(function (d) {
        var m = d.re.exec(u);
        if (m) ids.push({ p: d.p, v: m[1] });
      });
    });
    return { webs: uniq(webs).slice(0, 48), ids: ids.slice(0, 12) };
  }
  function wdQuery(keys) {
    var u = [];
    if (keys.webs.length) u.push("{ VALUES ?w { " + keys.webs.join(" ") + " } ?item wdt:P856 ?w . }");
    keys.ids.forEach(function (k) { u.push("{ ?item wdt:" + k.p + " \"" + k.v + "\" . }"); });
    if (!u.length) return "";
    var opt = WD_IDS.map(function (d) { return "OPTIONAL { ?item wdt:" + d.p + " ?" + d.p + " . }"; }).join(" ");
    return "SELECT ?item ?itemLabel ?birth ?web ?human " + WD_IDS.map(function (d) { return "?" + d.p; }).join(" ") +
      " WHERE { " + u.join(" UNION ") + " OPTIONAL { ?item wdt:P569 ?birth . } OPTIONAL { ?item wdt:P856 ?web . } " + opt +
      " BIND(EXISTS { ?item wdt:P31 wd:Q5 } AS ?human) SERVICE wikibase:label { bd:serviceParam wikibase:language \"el,en\". } } LIMIT 40";
  }
  // SPARQL JSON → one finding per item.
  function fromWikidata(j) {
    var rows = j && j.results && Array.isArray(j.results.bindings) ? j.results.bindings : [];
    var items = {}, order = [];
    function v(r, k) { return r[k] && typeof r[k].value === "string" ? r[k].value : ""; }
    rows.forEach(function (r) {
      var id = v(r, "item");
      if (!/^http:\/\/www\.wikidata\.org\/entity\/Q\d+$/.test(id)) return;
      var f = items[id];
      if (!f) { f = items[id] = blank("Wikidata"); f.personal = v(r, "human") === "true"; f.name = str(v(r, "itemLabel"), 120); order.push(id); }
      var web = normUrl(v(r, "web"));
      if (web) f.links.push({ url: web, verified: false });
      WD_IDS.forEach(function (d) {
        var x = v(r, d.p);
        if (x && /^[A-Za-z0-9_.@-]{1,253}$/.test(x)) { var u = normUrl(d.url + x); if (u) f.links.push({ url: u, verified: false }); }
      });
      if (f.personal && !f.birthday) { var b = ymd(v(r, "birth")); if (b && v(r, "birth").charAt(0) !== "-") f.birthday = validBirthday(b); }
    });
    return order.map(function (id) {
      var f = items[id];
      var seen = {};
      f.links = f.links.filter(function (l) { if (seen[l.url]) return false; seen[l.url] = 1; return true; });
      if (/^Q\d+$/.test(f.name)) f.name = "";
      return f;
    });
  }
  function wikidata(urls, base, opts) {
    var q = wdQuery(wdKeys(urls));
    if (!q) return Promise.resolve([]);
    return getText(WD_SPARQL + "?format=json&query=" + encodeURIComponent(q), opts).then(function (r) {
      if (!r || r.status !== 200) return [];
      var j = null;
      try { j = JSON.parse(r.text); } catch (e) { return []; }
      var list = fromWikidata(j);
      // more than one item answers: none of them is sure
      list.forEach(function (f) { f.base = list.length > 1 ? "check" : base; });
      return list.slice(0, 3);
    }, function () { return []; });
  }

  // ---------- wave 4: search engines ----------
  // Links the person opens in their own browser to search by hand: the
  // closed networks are searched only this way. DuckDuckGo, not Google.
  var SEARCH_SITES = [
    { label: "Web", site: "" }, { label: "LinkedIn", site: "linkedin.com" }, { label: "Facebook", site: "facebook.com" },
    { label: "Instagram", site: "instagram.com" }, { label: "X", site: "x.com" }, { label: "TikTok", site: "tiktok.com" }
  ];
  function searchLinks(recIn) {
    var rec = normRec(recIn);
    var name = rec.names[0];
    if (!name) return [];
    var q = "\"" + name.replace(/"/g, "") + "\"" + (rec.names[1] && rec.kind !== "org" ? " " + rec.names[1] : "");
    return SEARCH_SITES.map(function (x) {
      return { label: x.label, url: "https://duckduckgo.com/?q=" + encodeURIComponent((q + (x.site ? " site:" + x.site : "")).slice(0, 300)) };
    });
  }
  // The user's own SearXNG server, when the Assistant is set to use one.
  function searxBase() {
    try {
      var a = JSON.parse(root.localStorage.getItem("oros-assistant-data") || "null");
      var b = a && a.set && a.set.wsBase;
      if (typeof b === "string" && /^https:\/\/[^\s"<>]+$/.test(b)) return b.replace(/\/+$/, "");
    } catch (e) {}
    return "";
  }
  // A name search on the user's SearXNG: every result is only "check";
  // a result page that shows the record's own phone or e-mail rises.
  function webSearch(rec, opts) {
    var base = opts.searx != null ? opts.searx : searxBase();
    var name = rec.names[0];
    if (!base || !name) return Promise.resolve([]);
    var q = "\"" + name.replace(/"/g, "") + "\"" + (rec.place ? " " + rec.place.split(",").pop().trim() : "");
    return getText(base + "/search?format=json&q=" + encodeURIComponent(q.slice(0, 200)), opts).then(function (r) {
      var res = [];
      try { res = r && r.status === 200 ? (JSON.parse(r.text).results || []) : []; } catch (e) { res = []; }
      var f = blank("SearXNG");
      f.base = "check";
      f.personal = false;
      var pages = [];
      res.slice(0, 10).forEach(function (x) {
        var u = x && normUrl(x.url);
        if (!u || isNoise(u)) return;
        f.links.push({ url: u, verified: false });
        var c = classify(u);
        if (c && c.fetch && c.kind !== "social" && pages.length < 2) pages.push(u);
      });
      var out = f.links.length ? [f] : [];
      return pages.reduce(function (p, u) {
        return p.then(function () { return page(u, "check", opts, rec, hostOf(u)); }).then(function (pf) {
          if (pf && grade(rec, pf).hit) out.push(pf);
        });
      }, Promise.resolve()).then(function () { return out; });
    }, function () { return []; });
  }

  // ---------- network ----------
  function sha256(s) {
    var c = root.crypto && root.crypto.subtle;
    if (!c) return Promise.reject(new Error("crypto"));
    return c.digest("SHA-256", new TextEncoder().encode(s)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
    });
  }
  function relayAddr() {
    try {
      var m = JSON.parse(root.localStorage.getItem("oros-mail-data") || "null");
      var u = m && m.relay && m.relay.url;
      if (typeof u === "string" && /^https:\/\/[^\s]+$/.test(u)) return u.replace(/\/+$/, "");
    } catch (e) {}
    return DEFAULT_RELAY;
  }
  // GET text: straight from the browser, else through the relay's
  // "web" op (feeds/fetch.js, the Reader's shared network layer).
  function getText(url, opts) {
    var F = root.orosFeedsFetch;
    if (opts && opts.getText) return opts.getText(url);
    if (!F) return Promise.reject(new Error("nofetch"));
    return F.fetchOne(url, { relay: relayAddr, accept: "text/html, application/json;q=0.9, */*;q=0.5", timeout: 12000 })
      .then(function (r) { return { status: r.status, url: r.finalUrl || url, type: r.type || "", text: r.text || "" }; });
  }
  // Picture bytes → Blob (direct, else relay). Images only, ≤ 3 MB.
  function getImage(url, opts) {
    var F = root.orosFeedsFetch;
    if (opts && opts.getImage) return opts.getImage(url);
    if (!F) return Promise.reject(new Error("nofetch"));
    return F.fetchOne(url, { relay: relayAddr, accept: "image/*", timeout: 12000 }).then(function (r) {
      if (r.status !== 200 || !r.bytes || !/^image\/(jpeg|png|webp|gif)/i.test(r.type) || r.bytes.length > 3 * 1024 * 1024) return null;
      return new Blob([r.bytes], { type: r.type.split(";")[0] });
    });
  }

  function gravatar(mail, opts) {
    return (opts && opts.sha256 || sha256)(mail).then(function (h) {
      return getText(GRAVATAR_API + h, opts);
    }).then(function (r) {
      if (!r || r.status !== 200) return null;
      var j = null;
      try { j = JSON.parse(r.text); } catch (e) { return null; }
      var f = fromGravatar(j);
      if (f) { f.base = "sure"; f.via = mail; }   // keyed by the record's own address
      return f;
    }, function () { return null; });
  }
  function page(url, base, opts, rec, label) {
    return getText(url, opts).then(function (r) {
      if (!r || r.status !== 200 || !/html|xml|^$/i.test(r.type) || !r.text) return null;
      var f = fromPage(parsePage(r.text, r.url || url), r.url || url, { label: label || hostOf(url), rec: rec });
      f.base = base;
      return f;
    }, function () { return null; });
  }

  // Everything for one record. opts: { getText, getImage, sha256,
  // onStep } (tests inject the network).
  function lookup(recIn, opts) {
    opts = opts || {};
    var rec = normRec(recIn);
    var findings = [], read = {};
    var mails = rec.emails.filter(function (e) { return !rec.shared[e]; }).slice(0, 3);
    var chain = Promise.resolve();
    mails.forEach(function (m) {
      chain = chain.then(function () { return gravatar(m, opts); }).then(function (f) { if (f) findings.push(f); });
    });
    // the record's own pages (never a closed network)
    function readPage(url, base, label) {
      var c = classify(url);
      if (!c || !c.fetch || read[url] || Object.keys(read).length >= MAX_PAGES) return Promise.resolve();
      if (c.kind === "social") return Promise.resolve();   // open networks go through their APIs below
      read[url] = 1;
      return page(url, base, opts, rec, label).then(function (f) { if (f) findings.push(f); });
    }
    chain = chain.then(function () {
      return rec.sites.reduce(function (p, u) { return p.then(function () { return readPage(u, "likely"); }); }, Promise.resolve());
    });
    // one hop: a link page that a sure finding points at
    chain = chain.then(function () {
      var next = [];
      findings.forEach(function (f) {
        var g = grade(rec, f);
        if (g.conf !== "sure") return;
        f.links.forEach(function (l) {
          var c = classify(l.url);
          if (c && (c.kind === "links" || (c.kind === "site" && l.verified))) next.push(l.url);
        });
      });
      return uniq(next).reduce(function (p, u) { return p.then(function () { return readPage(u, "likely"); }); }, Promise.resolve());
    });
    // open networks (GitHub, Bluesky, Mastodon) through their public
    // APIs: the record's own profile links, or ones a finding that is
    // not "check" points at (a verified link stays "sure")
    chain = chain.then(function () {
      var todo = [], seen = {};
      function want(url, base) {
        var a = profileApi(url);
        if (!a || seen[a.api] || todo.length >= MAX_PROFILES) return;
        seen[a.api] = 1;
        todo.push({ a: a, base: base, url: url });
      }
      rec.sites.forEach(function (u) { want(u, "likely"); });
      findings.forEach(function (f) {
        var g = grade(rec, f);
        if (g.conf === "check") return;
        f.links.forEach(function (l) { want(l.url, l.verified ? "sure" : "likely"); });
      });
      return todo.reduce(function (p, it) {
        return p.then(function () { return profile(it, opts); }).then(function (f) { if (f) findings.push(f); });
      }, Promise.resolve());
    });
    // businesses in OpenStreetMap (an org record, by name + place or phone)
    chain = chain.then(function () {
      if (rec.kind !== "org") return;
      return business(rec, opts).then(function (list) { findings = findings.concat(list); });
    });
    // Wikidata items that name the record's own website or profiles
    chain = chain.then(function () {
      var mine = rec.sites.slice(), more = [];
      findings.forEach(function (f) {
        if (grade(rec, f).conf === "check") return;
        f.links.forEach(function (l) { more.push(l.url); });
      });
      more = uniq(more).filter(function (u) { return mine.indexOf(u) < 0; });
      return wikidata(mine, "sure", opts).then(function (a) {
        findings = findings.concat(a);
        if (a.length || !more.length) return;
        return wikidata(more, "likely", opts).then(function (b2) { findings = findings.concat(b2); });
      });
    });
    // a name search on the user's own SearXNG (only for a few records)
    chain = chain.then(function () {
      if (!opts.deep) return;
      return webSearch(rec, opts).then(function (list) { findings = findings.concat(list); });
    });
    return chain.then(function () { return propose(recIn, findings); });
  }

  var api = {
    DEFAULT_RELAY: DEFAULT_RELAY, normPhone: normPhone, samePhone: samePhone, normUrl: normUrl, classify: classify,
    isNoise: isNoise, skeleton: skeleton, nameAgree: nameAgree, parsePage: parsePage, fromGravatar: fromGravatar,
    fromPage: fromPage, grade: grade, profileApi: profileApi, fromGitHub: fromGitHub, fromBluesky: fromBluesky,
    fromMastodon: fromMastodon, fromOsm: fromOsm, phoneRegex: phoneRegex, wdKeys: wdKeys, wdQuery: wdQuery,
    fromWikidata: fromWikidata, searchLinks: searchLinks, searxBase: searxBase, propose: propose, lookup: lookup, getImage: getImage, sha256: sha256,
    validBirthday: validBirthday
  };
  root.OrosEnrich = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
