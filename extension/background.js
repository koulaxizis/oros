/* orOS add-on: Alt+Shift+O, right-click menu (page, link, selected
   text for the Assistant) and the "oros" address-bar keyword open orOS
   in a new tab next to the current one; nothing is read from or stored
   about the pages you visit beyond the one address or the selected text
   you send. The toolbar button opens popup.html (save the page, and
   Passwords). Passwords here (PW-AF1): keep the add-on's copy of the
   encrypted vault fresh when an orOS tab finishes loading, and lock
   (forget the vault key) when the lock time is reached. */
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
