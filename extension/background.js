/* orOS add-on: Alt+Shift+O, right-click menu (page, link, selected
   text for the Assistant) and the "oros" address-bar keyword open orOS
   in a new tab next to the current one; nothing is read from or stored
   about the pages you visit beyond the one address or the selected text
   you send. The toolbar button opens popup.html (save the page, and
   Passwords). Passwords here (PW-AF1): keep the add-on's copy of the
   encrypted vault fresh when an orOS tab finishes loading, and lock
   (forget the vault key) when the lock time is reached, re-read open
   orOS tabs every few minutes and, when the popup asks, open orOS in
   a background tab so its sync brings the newest vault, and (PW-AF3)
   hand a login the person chose to save to the orOS tab, and (PW-AF7)
   serve the suggestions inside page forms (inline.js, inline.html). */
"use strict";

if (typeof OrosExt === "undefined" && typeof importScripts === "function") {
  // Chrome/Edge service worker; Firefox loads the same list from the manifest
  importScripts("core.js", "pm/pmcrypto.js", "pm/pmcore.js", "pm/pmkinds.js", "pmvault.js", "pmfill.js");
}

const api = typeof browser !== "undefined" ? browser : chrome;
const msg = (k) => api.i18n.getMessage(k) || k;

async function getBase() {
  try {
    const got = await api.storage.sync.get({ base: OrosExt.DEFAULT_BASE });
    return OrosExt.normBase(got.base) || OrosExt.DEFAULT_BASE;
  } catch (e) {
    return OrosExt.DEFAULT_BASE;
  }
}

function openNext(url, tab) {
  const props = { url: url };
  if (tab && typeof tab.index === "number") props.index = tab.index + 1;
  if (tab && typeof tab.id === "number" && tab.id >= 0) props.openerTabId = tab.id;
  return api.tabs.create(props).catch(() => api.tabs.create({ url: url }));
}

/* A browser page (settings, new tab, PDF viewer…) cannot be saved:
   a short "×" on the button says so, instead of opening orOS empty. */
function refuse(tab) {
  const tabId = tab && typeof tab.id === "number" ? tab.id : undefined;
  try {
    api.action.setBadgeBackgroundColor({ color: "#b3261e", tabId: tabId });
    api.action.setBadgeText({ text: "×", tabId: tabId });
    setTimeout(() => api.action.setBadgeText({ text: "", tabId: tabId }), 2500);
  } catch (e) { /* no badge on this browser */ }
}

async function send(url, title, tab) {
  if (!OrosExt.isSavable(url)) { refuse(tab); return; }
  openNext(OrosExt.shareUrl(await getBase(), url, title || ""), tab);
}

function buildMenus() {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({ id: "oros-page", title: msg("menuPage"), contexts: ["page"] });
    api.contextMenus.create({ id: "oros-link", title: msg("menuLink"), contexts: ["link"] });
    api.contextMenus.create({ id: "oros-ask", title: msg("menuAsk"), contexts: ["selection"] });
    api.contextMenus.create({ id: "oros-open", title: msg("menuOpen"), contexts: ["action"] });
  });
}
api.runtime.onInstalled.addListener(buildMenus);
if (api.runtime.onStartup) api.runtime.onStartup.addListener(buildMenus);

if (api.commands) {
  api.commands.onCommand.addListener(async (cmd, tab) => {
    if (cmd !== "send-page") return;
    if (!tab) { const t = await api.tabs.query({ active: true, currentWindow: true }); tab = t && t[0]; }
    send(tab && tab.url, tab && tab.title, tab);
  });
}

/* Passwords: a finished orOS tab refreshes the encrypted copy (only
   with the host permission for the orOS address; otherwise nothing). */
api.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete" || !tab || !tab.url) return;
  const base = await getBase();
  if (!OrosVault.isOrosTab(tab, base)) return;
  let origin;
  try { origin = new URL(base).origin + "/*"; } catch (e) { return; }
  const ok = await api.permissions.contains({ origins: [origin] }).catch(() => false);
  if (ok) OrosVault.refreshFromTab(tabId);
});
/* orOS stays open for days without loading again: switching to an orOS
   tab and a 10-minute alarm also re-read every open orOS tab. */
async function orosOrigin() {
  try { return new URL(await getBase()).origin + "/*"; } catch (e) { return null; }
}
async function refreshOpen() {
  const origin = await orosOrigin();
  if (!origin || !(await api.permissions.contains({ origins: [origin] }).catch(() => false))) return false;
  return OrosVault.refreshAll(await getBase());
}
api.tabs.onActivated.addListener(async (info) => {
  const tab = await api.tabs.get(info.tabId).catch(() => null);
  if (tab && OrosVault.isOrosTab(tab, await getBase())) refreshOpen();
});
if (api.alarms) {
  api.alarms.onAlarm.addListener((a) => {
    if (a.name === "pm-lock") OrosVault.keyState();
    else if (a.name === "pm-refresh") refreshOpen();
  });
  Promise.resolve(api.alarms.get("pm-refresh")).then((a) => {
    if (!a) api.alarms.create("pm-refresh", { delayInMinutes: 1, periodInMinutes: 10 });
  }, () => {});
}

/* A new add-on version (PW-AF5): once a day the add-on reads
   extension/manifest.json from the orOS address (the host it already
   has access to; nothing is sent but the request itself). A newer
   version puts "↑" on the toolbar button, and the popup shows
   "Version … is out" with a link to the download page. An add-on
   installed by hand cannot replace itself. */
async function checkAddonVersion() {
  let base;
  try { base = new URL(await getBase()); } catch (e) { return; }
  let v = "";
  try {
    const r = await fetch(new URL("extension/manifest.json", base).href, { cache: "no-store", credentials: "omit" });
    if (r.ok) v = String((await r.json()).version || "");
  } catch (e) { return; }   // offline: ask again tomorrow
  const mine = api.runtime.getManifest().version;
  const isNew = OrosExt.newerVersion(v, mine);
  await api.storage.local.set({ addonNew: isNew ? v : "" }).catch(() => {});
  showAddonBadge(isNew);
}
function showAddonBadge(on) {
  try {
    if (on) { api.action.setBadgeBackgroundColor({ color: "#d4af37" }); api.action.setBadgeText({ text: "↑" }); }
    else api.action.setBadgeText({ text: "" });
  } catch (e) { /* no badge on this browser */ }
}
api.storage.local.get("addonNew").then((g) => {
  showAddonBadge(!!(g && g.addonNew && OrosExt.newerVersion(g.addonNew, api.runtime.getManifest().version)));
}, () => {});
if (api.alarms) {
  Promise.resolve(api.alarms.get("addon-check")).then((a) => {
    if (!a) api.alarms.create("addon-check", { delayInMinutes: 2, periodInMinutes: 24 * 60 });
  }, () => {});
  api.alarms.onAlarm.addListener((a) => { if (a.name === "addon-check") checkAddonVersion(); });
}

/* The popup found the copy old and no orOS tab open: orOS opens in a
   background tab (from its offline copy, like any visit), its sync
   pulls the newest vault from the cloud, the add-on reads the slice and
   closes the tab. The sync dot tells when the round is over: "synced"
   or "err" after a round; "off" (no sync) or "locked" (sync passphrase
   not remembered) ends it after a few seconds; at most 60 s. */
function syncStateInPage(k, ek) {
  const d = document.getElementById("sync-dot");
  let raw = null, erased = null;
  try { raw = localStorage.getItem(k); } catch (e) { raw = null; }
  try { erased = localStorage.getItem(ek); } catch (e) { erased = null; }   // SOS-1 S2
  return { s: d ? String(d.getAttribute("data-state") || "") : "", raw: raw, erased: erased };
}
let updating = null;
async function updateViaTab() {
  const base = await getBase();
  const origin = await orosOrigin();
  if (!origin || !(await api.permissions.contains({ origins: [origin] }).catch(() => false))) return { ok: false };
  const open = await api.tabs.query({ url: origin }).catch(() => []);
  if (open && open.length) return { ok: await OrosVault.refreshAll(base) };
  const t = await api.tabs.create({ url: base, active: false }).catch(() => null);
  if (!t) return { ok: false };
  let raw = null, erased = null, idle = 0;
  const end = Date.now() + 60000;
  try {
    while (Date.now() < end) {
      await wait(1000);
      let st = null;
      try {
        const r = await api.scripting.executeScript({ target: { tabId: t.id }, func: syncStateInPage, args: [OrosVault.SLICE_KEY, OrosVault.ERASED_KEY] });
        st = r && r[0] ? r[0].result : null;
      } catch (e) { st = null; /* still loading */ }
      if (!st) continue;
      raw = st.raw;
      erased = typeof st.erased === "string" ? st.erased : null;
      if (st.s === "synced" || st.s === "err") break;
      if (st.s === "syncing") { idle = 0; continue; }
      if (++idle >= (st.s === "off" || st.s === "locked" ? 4 : 15)) break;
    }
  } finally {
    await api.tabs.remove(t.id).catch(() => {});
  }
  return { ok: raw || erased ? await OrosVault.absorbTab(raw, erased) : false };
}

/* Passwords PW-AF3: a login from the popup's "Save the login from
   this page" goes to the orOS tab (one is opened when none is), which
   shows it in the Passwords editor; nothing is saved there without the
   person pressing Save. It is posted from the add-on's own isolated
   world into the orOS page (shell.js answers "oros-pw-saved"), never
   put in a URL or stored here. */
function postSave(item, n) {
  return new Promise(function (resolve) {
    if (document.readyState === "loading") { resolve(null); return; }
    var done = false;
    function on(ev) {
      var d = ev.data;
      if (ev.source !== window || !d || d.type !== "oros-pw-saved" || d.n !== n) return;
      done = true;
      window.removeEventListener("message", on);
      resolve(!!d.ok);
    }
    window.addEventListener("message", on);
    window.postMessage({ type: "oros-pw-save", n: n, item: item }, location.origin);
    setTimeout(function () { if (!done) { window.removeEventListener("message", on); resolve(null); } }, 800);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function deliverSave(item) {
  const base = await getBase();
  let b;
  try { b = new URL(base); } catch (e) { return false; }
  if (!(await api.permissions.contains({ origins: [b.origin + "/*"] }).catch(() => false))) return false;
  const tabs = await api.tabs.query({ url: b.origin + "/*" }).catch(() => []);
  const shellPath = (p) => p === b.pathname || p === b.pathname.replace(/\/?$/, "/") + "index.html";
  let t = (tabs || []).find((x) => { try { return shellPath(new URL(x.url).pathname); } catch (e) { return false; } });
  if (t) {
    await api.tabs.update(t.id, { active: true }).catch(() => {});
    if (api.windows && typeof t.windowId === "number") api.windows.update(t.windowId, { focused: true }).catch(() => {});
  } else {
    t = await api.tabs.create({ url: base }).catch(() => null);
    if (!t) return false;
  }
  const n = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, "0")).join("");
  for (let i = 0; i < 40; i++) {
    try {
      const r = await api.scripting.executeScript({ target: { tabId: t.id }, func: postSave, args: [item, n] });
      const v = r && r[0] ? r[0].result : null;
      if (v === true || v === false) return v;
    } catch (e) { /* still loading */ }
    await wait(750);
  }
  return false;
}
api.runtime.onMessage.addListener((m, sender, reply) => {
  if (m && m.t === "pm-update" && sender.id === api.runtime.id && !sender.tab) {
    if (!updating) updating = updateViaTab().catch(() => ({ ok: false })).finally(() => { updating = null; });
    updating.then(reply);
    return true;
  }
  // only the add-on's own popup (no tab) may hand a login over
  if (!m || m.t !== "pm-save" || sender.id !== api.runtime.id || sender.tab) return false;
  const it = m.item;
  if (!it || typeof it !== "object" || typeof it.pw !== "string" || !it.pw || typeof it.url !== "string") { reply({ ok: false }); return false; }
  const item = { url: it.url.slice(0, 2048), user: String(it.user || "").slice(0, 512), pw: it.pw.slice(0, 4096), title: String(it.title || "").slice(0, 200) };
  reply({ ok: true });
  deliverSave(item);
  return false;
});

/* ---------- Passwords PW-AF7: suggestions inside page forms ----------
   With the add-on allowed on all https sites (one click in its window or
   options) and the option on (default), inline.js is registered on
   https pages, top frame only. A click into a login, card or address
   field asks "ii-open"; the answer is only whether to show the list, a
   token and a row count. The list page (inline.html, the add-on's own
   origin) gets the names with the token; a pick fills the top frame of
   that tab with fillInPage() after inline.js confirms the list was
   really on screen. Logins only where OrosFill.fits the tab's address
   at the moment of the fill; never on the orOS address; tokens live in
   storage.session (not readable by content scripts) for 10 minutes. */
const ALL_SITES = "https://*/*";
const II_ID = "oros-inline";
const II_TTL = 10 * 60000;

async function inlineWanted() {
  const g = await api.storage.sync.get({ pmInline: true }).catch(() => ({ pmInline: true }));
  if (g.pmInline === false) return false;
  return api.permissions.contains({ origins: [ALL_SITES] }).catch(() => false);
}
let syncingInline = null;
async function syncInline(injectOpen) {
  const want = await inlineWanted();
  let have = [];
  try { have = await api.scripting.getRegisteredContentScripts({ ids: [II_ID] }); } catch (e) { have = []; }
  if (want && !have.length) {
    try {
      await api.scripting.registerContentScripts([{ id: II_ID, matches: [ALL_SITES], js: ["inline.js"], runAt: "document_idle", allFrames: false, persistAcrossSessions: true }]);
    } catch (e) { return; }
    if (injectOpen) {
      // pages already open get it too (inline.js runs once per page)
      const tabs = await api.tabs.query({ url: ALL_SITES }).catch(() => []);
      for (const t of tabs || []) {
        if (!t.discarded) api.scripting.executeScript({ target: { tabId: t.id }, files: ["inline.js"] }).catch(() => {});
      }
    }
  } else if (!want && have.length) {
    await api.scripting.unregisterContentScripts({ ids: [II_ID] }).catch(() => {});
  }
}
function syncInlineSoon(injectOpen) {
  syncingInline = (syncingInline || Promise.resolve()).then(() => syncInline(injectOpen)).catch(() => {});
  return syncingInline;
}
api.runtime.onInstalled.addListener(() => syncInlineSoon(true));
if (api.runtime.onStartup) api.runtime.onStartup.addListener(() => syncInlineSoon(false));
if (api.permissions.onAdded) api.permissions.onAdded.addListener(() => syncInlineSoon(true));
if (api.permissions.onRemoved) api.permissions.onRemoved.addListener(() => syncInlineSoon(false));
api.storage.onChanged.addListener((ch, area) => { if (area === "sync" && ch.pmInline) syncInlineSoon(true); });

const randHex = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
async function tokens() {
  const g = await api.storage.session.get("iiTok").catch(() => ({}));
  const all = (g && g.iiTok) || {};
  const now = Date.now();
  Object.keys(all).forEach((k) => { if (!(all[k].at > now - II_TTL)) delete all[k]; });
  return all;
}
async function tokenOf(id) { const all = await tokens(); return Object.prototype.hasOwnProperty.call(all, id) ? all[id] : null; }
async function saveToken(id, v) { const all = await tokens(); if (v) all[id] = v; else delete all[id]; await api.storage.session.set({ iiTok: all }).catch(() => {}); }

/* the entries the list may show for a kind on this page, best first */
function inlineEntries(entries, kind, url) {
  if (kind === "login") return OrosFill.matches(entries, url, PmKinds);
  const want = kind === "card" ? ["card"] : kind === "person" ? ["identity", "address"] : [];
  return (entries || []).filter((e) => want.indexOf(PmKinds.kindOf(e)) >= 0)
    .sort((a, b) => ((b.fav ? 1 : 0) - (a.fav ? 1 : 0)) || String(a.title || "").localeCompare(String(b.title || "")));
}
function inlineRow(e) {
  const k = PmKinds.kindOf(e);
  const sub = k === "login" || k === "otp"
    ? [e.user, k === "otp" ? msg("pmCodeOnly") : (e.totp ? msg("pm2fa") : "")].filter(Boolean).join(" · ")
    : [msg("pmKind_" + k), PmKinds.summary(e)].filter(Boolean).join(" · ");
  return { id: String(e.id), title: String(e.title || "").slice(0, 200), sub: sub.slice(0, 200), fav: !!e.fav };
}
async function isOrosPage(url) {
  try { return new URL(url).origin === new URL(await getBase()).origin; } catch (e) { return true; }
}
const inlinePage = () => api.runtime.getURL("inline.html");
function fromInlinePage(sender) {
  return sender.id === api.runtime.id && sender.tab && typeof sender.url === "string" && sender.url.indexOf(inlinePage()) === 0;
}
function fromContentTop(sender) {
  return sender.id === api.runtime.id && sender.tab && sender.frameId === 0 && typeof sender.url === "string" && /^https:/.test(sender.url);
}

async function inlineOpen(m, sender) {
  const kind = m && m.kind;
  if (["login", "card", "person"].indexOf(kind) < 0 || !(await inlineWanted()) || (await isOrosPage(sender.url))) return { show: false };
  const copy = await OrosVault.getCopy();
  if (!copy || copy.future || !PmVault.primaryKid(copy.slice)) return { show: false };
  const data = await OrosVault.open().catch(() => null);
  let rows = 0;
  if (data) {
    rows = inlineEntries(data.entries, kind, sender.url).length;
    if (!rows) return { show: false };
  }
  const id = randHex();
  await saveToken(id, { tab: sender.tab.id, origin: new URL(sender.url).origin, kind: kind, at: Date.now() });
  return { show: true, token: id, locked: !data, rows: Math.min(rows, 4) };
}

async function inlineList(m, sender) {
  const tk = await tokenOf(m.token);
  if (!tk || tk.tab !== sender.tab.id) return { ok: false };
  const tab = await api.tabs.get(tk.tab).catch(() => null);
  if (!tab || !tab.url || (() => { try { return new URL(tab.url).origin !== tk.origin; } catch (e) { return true; } })()) return { ok: false };
  const data = await OrosVault.open().catch(() => null);
  if (!data) return { ok: true, locked: true };
  return { ok: true, rows: inlineEntries(data.entries, tk.kind, tab.url).slice(0, 20).map(inlineRow) };
}

async function inlineFill(m, sender) {
  const tk = await tokenOf(m.token);
  if (!tk || tk.tab !== sender.tab.id || typeof m.id !== "string") return { ok: false };
  // inline.js must confirm the list was really on screen (clickjacking guard)
  let seen = null;
  try { seen = await api.tabs.sendMessage(tk.tab, { t: "ii-check", token: m.token }, { frameId: 0 }); } catch (e) { seen = null; }
  if (!seen || seen.ok !== true) return { ok: false, why: "hidden" };
  const tab = await api.tabs.get(tk.tab).catch(() => null);
  if (!tab || !tab.url) return { ok: false };
  let origin;
  try { origin = new URL(tab.url).origin; } catch (e) { return { ok: false }; }
  if (origin !== tk.origin || (await isOrosPage(tab.url))) return { ok: false };
  const data = await OrosVault.open().catch(() => null);
  if (!data) return { ok: false, why: "locked" };
  const e = inlineEntries(data.entries, tk.kind, tab.url).find((x) => String(x.id) === m.id);
  if (!e) return { ok: false };
  let code = "";
  if (e.totp && ["login", "otp"].indexOf(PmKinds.kindOf(e)) >= 0) {
    const o = PmCore.parseOtp(e.totp);
    if (!o.error) code = (await PmCore.totp(o)).code;
  }
  const p = OrosFill.payload(e, PmKinds, code);
  if (!p) return { ok: false };
  p.origin = tk.origin;
  let n = 0;
  try {
    const res = await api.scripting.executeScript({ target: { tabId: tk.tab, frameIds: [0] }, func: OrosFill.fillInPage, args: [p] });
    n = res && res[0] ? res[0].result : 0;
  } catch (x) { n = 0; }
  await saveToken(m.token, null);
  api.tabs.sendMessage(tk.tab, { t: "ii-done", token: m.token, refocus: false }, { frameId: 0 }).catch(() => {});
  return { ok: n > 0 };
}

async function inlineUnlock(m, sender) {
  const tk = await tokenOf(m.token);
  if (!tk || tk.tab !== sender.tab.id) return { ok: false };
  try {
    if (api.windows && typeof sender.tab.windowId === "number") await api.windows.update(sender.tab.windowId, { focused: true }).catch(() => {});
    await api.action.openPopup();
  } catch (e) { return { ok: false }; }
  await saveToken(m.token, null);
  api.tabs.sendMessage(tk.tab, { t: "ii-done", token: m.token, refocus: false }, { frameId: 0 }).catch(() => {});
  return { ok: true };
}

api.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || typeof m.t !== "string" || m.t.indexOf("ii-") !== 0) return false;
  let job = null;
  if (m.t === "ii-open" && fromContentTop(sender)) job = inlineOpen(m, sender);
  else if (m.t === "ii-close" && fromContentTop(sender) && typeof m.token === "string") job = saveToken(m.token, null).then(() => ({ ok: true }));
  else if (typeof m.token === "string" && fromInlinePage(sender)) {
    if (m.t === "ii-list") job = inlineList(m, sender);
    else if (m.t === "ii-fill") job = inlineFill(m, sender);
    else if (m.t === "ii-unlock") job = inlineUnlock(m, sender);
    else if (m.t === "ii-done") {
      job = tokenOf(m.token).then((tk) => {
        if (tk && tk.tab === sender.tab.id) api.tabs.sendMessage(tk.tab, { t: "ii-done", token: m.token, refocus: !!m.refocus }, { frameId: 0 }).catch(() => {});
        return { ok: true };
      });
    }
  }
  if (!job) return false;
  job.then(reply, () => reply({ ok: false }));
  return true;
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "oros-page") {
    send(info.pageUrl || (tab && tab.url), tab && tab.title, tab);
  } else if (info.menuItemId === "oros-link") {
    /* linkText exists in Firefox only; elsewhere orOS falls back to
       the address as the title, which the dialog lets you edit. */
    send(info.linkUrl, info.linkText || "", tab);
  } else if (info.menuItemId === "oros-ask") {
    /* The selected text goes in the fragment only (OrosExt.askUrl). */
    openNext(OrosExt.askUrl(await getBase(), info.selectionText || ""), tab);
  } else if (info.menuItemId === "oros-open") {
    openNext(await getBase(), tab);
  }
});

if (api.omnibox) {
  api.omnibox.setDefaultSuggestion({ description: msg("omniboxHint") });
  api.omnibox.onInputEntered.addListener(async (text, disposition) => {
    const url = OrosExt.searchUrl(await getBase(), text);
    if (disposition === "currentTab") api.tabs.update({ url: url });
    else api.tabs.create({ url: url, active: disposition !== "newBackgroundTab" });
  });
}
