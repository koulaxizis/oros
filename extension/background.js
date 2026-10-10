/* Send to orOS: toolbar button, Alt+Shift+O, right-click menu and the
   "oros" address-bar keyword. Every action opens orOS in a new tab
   next to the current one; nothing is read from or stored about the
   pages you visit beyond the one address you send. */
"use strict";

if (typeof OrosExt === "undefined" && typeof importScripts === "function") {
  importScripts("core.js");     // Chrome/Edge service worker
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
    api.contextMenus.create({ id: "oros-open", title: msg("menuOpen"), contexts: ["action"] });
  });
}
api.runtime.onInstalled.addListener(buildMenus);
if (api.runtime.onStartup) api.runtime.onStartup.addListener(buildMenus);

api.action.onClicked.addListener((tab) => {
  send(tab && tab.url, tab && tab.title, tab);
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "oros-page") {
    send(info.pageUrl || (tab && tab.url), tab && tab.title, tab);
  } else if (info.menuItemId === "oros-link") {
    /* linkText exists in Firefox only; elsewhere orOS falls back to
       the address as the title, which the dialog lets you edit. */
    send(info.linkUrl, info.linkText || "", tab);
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
