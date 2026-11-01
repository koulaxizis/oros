/* orOS add-on: Alt+Shift+O, right-click menu (page, link, selected
   text for the Assistant) and the "oros" address-bar keyword open orOS
   in a new tab next to the current one; nothing is read from or stored
   about the pages you visit beyond the one address or the selected text
   you send. The toolbar button opens popup.html (save the page, and
   Passwords). Passwords here (PW-AF1): keep the add-on's copy of the
   encrypted vault fresh when an orOS tab finishes loading, and lock
   (forget the vault key) when the lock time is reached, and (PW-AF3)
   hand a login the person chose to save to the orOS tab. */
"use strict";

if (typeof OrosExt === "undefined" && typeof importScripts === "function") {
  // Chrome/Edge service worker; Firefox loads the same list from the manifest
  importScripts("core.js", "pm/pmcrypto.js", "pm/pmcore.js", "pm/pmkinds.js", "pmvault.js");
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
if (api.alarms) {
  api.alarms.onAlarm.addListener((a) => { if (a.name === "pm-lock") OrosVault.keyState(); });
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
  // only the add-on's own popup (no tab) may hand a login over
  if (!m || m.t !== "pm-save" || sender.id !== api.runtime.id || sender.tab) return false;
  const it = m.item;
  if (!it || typeof it !== "object" || typeof it.pw !== "string" || !it.pw || typeof it.url !== "string") { reply({ ok: false }); return false; }
  const item = { url: it.url.slice(0, 2048), user: String(it.user || "").slice(0, 512), pw: it.pw.slice(0, 4096), title: String(it.title || "").slice(0, 200) };
  reply({ ok: true });
  deliverSave(item);
  return false;
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
