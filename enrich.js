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

  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis-25b.workers.dev";   // = mail.js
  var GRAVATAR_API = "https://api.gravatar.com/v3/profiles/";
  var MAX_PAGES = 4;          // pages read per record
  var MAX_LINKS = 12;         // link suggestions per record
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
  function tokens(s) {
    return String(s || "").split(/[\s,.'"’()\-_|@/]+/).map(skeleton).filter(function (t) { return t.length >= 2; });
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
      has: { photo: !!has.photo, birthday: !!has.birthday, job: !!has.job, org: !!has.org, address: !!has.address, name: !!has.name },
      kind: rec.kind === "person" || rec.kind === "org" ? rec.kind : ""
    };
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
      if (c.kind === "social" && c.net !== "fediverse") return Promise.resolve();   // network APIs come in wave 2
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
    return chain.then(function () { return propose(recIn, findings); });
  }

  var api = {
    DEFAULT_RELAY: DEFAULT_RELAY, normPhone: normPhone, samePhone: samePhone, normUrl: normUrl, classify: classify,
    isNoise: isNoise, skeleton: skeleton, nameAgree: nameAgree, parsePage: parsePage, fromGravatar: fromGravatar,
    fromPage: fromPage, grade: grade, propose: propose, lookup: lookup, getImage: getImage, sha256: sha256,
    validBirthday: validBirthday
  };
  root.OrosEnrich = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
