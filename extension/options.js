"use strict";
const api = typeof browser !== "undefined" ? browser : chrome;
const msg = (k, subs) => api.i18n.getMessage(k, subs) || "";

document.querySelectorAll("[data-i18n]").forEach((el) => {
  const s = msg(el.getAttribute("data-i18n"));
  if (s) el.textContent = s;
});
document.documentElement.lang = api.i18n.getUILanguage().slice(0, 2);

const input = document.getElementById("base");
const status = document.getElementById("status");

function say(text, bad) {
  status.textContent = text;
  status.classList.toggle("bad", !!bad);
}

api.storage.sync.get({ base: OrosExt.DEFAULT_BASE }).then((got) => {
  input.value = OrosExt.normBase(got.base) || OrosExt.DEFAULT_BASE;
});

document.getElementById("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const base = OrosExt.normBase(input.value);
  if (!base) { say(msg("optBad"), true); input.focus(); return; }
  input.value = base;
  api.storage.sync.set({ base: base }).then(() => say(msg("optSaved")));
});

document.getElementById("reset").addEventListener("click", () => {
  input.value = OrosExt.DEFAULT_BASE;
  api.storage.sync.set({ base: OrosExt.DEFAULT_BASE }).then(() => say(msg("optSaved")));
});

/* Passwords (PW-AF1): lock time and removing the vault copy. */
const sel = document.getElementById("lockMin");
OrosVault.LOCK_CHOICES.forEach((m) => {
  const o = document.createElement("option");
  o.value = String(m); o.textContent = msg("optLockMin", [String(m)]);
  sel.appendChild(o);
});
OrosVault.lockMinutes().then((m) => { sel.value = String(m); });
sel.addEventListener("change", () => {
  api.storage.sync.set({ pmLockMin: parseInt(sel.value, 10) }).then(() => say(msg("optSaved")));
});
document.getElementById("forget").addEventListener("click", () => {
  OrosVault.forget().then(() => { document.getElementById("pmStatus").textContent = msg("optForgot"); });
});
