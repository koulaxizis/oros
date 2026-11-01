/* orOS add-on popup (toolbar button, Ctrl+Shift+L): "Save this page
   to orOS" plus Passwords (PW-AF1): unlock the add-on's copy of the
   vault, list the logins that fit this site and the cards, addresses
   and identities, and fill one into the page on a click. Everything
   goes on the page with textContent only. */
"use strict";
const api = typeof browser !== "undefined" ? browser : chrome;
const msg = (k, subs) => api.i18n.getMessage(k, subs) || k;
const V = OrosVault, F = OrosFill, K = PmKinds, PC = PmCore;
const $ = (id) => document.getElementById(id);

document.querySelectorAll("[data-i18n]").forEach((el) => { const s = api.i18n.getMessage(el.getAttribute("data-i18n")); if (s) el.textContent = s; });
document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = msg(el.getAttribute("data-i18n-ph")); });
document.documentElement.lang = api.i18n.getUILanguage().slice(0, 2);

let tab = null, base = OrosExt.DEFAULT_BASE, data = null;

function say(text, bad) { $("msg").textContent = text || ""; $("msg").classList.toggle("bad", !!bad); }
function show(id) { ["need", "unlock", "open"].forEach((x) => { $(x).hidden = x !== id; }); }
function originPattern() { try { return new URL(base).origin + "/*"; } catch (e) { return "https://useoros.online/*"; } }

async function getBase() {
  try { const g = await api.storage.sync.get({ base: OrosExt.DEFAULT_BASE }); return OrosExt.normBase(g.base) || OrosExt.DEFAULT_BASE; }
  catch (e) { return OrosExt.DEFAULT_BASE; }
}

$("send").addEventListener("click", () => {
  if (!tab || !OrosExt.isSavable(tab.url)) { say(msg("popCannotSave"), true); return; }
  const props = { url: OrosExt.shareUrl(base, tab.url, tab.title || "") };
  if (typeof tab.index === "number") props.index = tab.index + 1;
  api.tabs.create(props).then(() => window.close());
});
$("openOros").addEventListener("click", () => { api.tabs.create({ url: base }).then(() => window.close()); });
$("grant").addEventListener("click", () => {
  api.permissions.request({ origins: [originPattern()] }).then((ok) => { if (ok) start(); });
});
$("lock").addEventListener("click", () => { data = null; V.lock().then(() => { say(msg("pmLocked")); showUnlock(); }); });
$("q").addEventListener("input", render);

function showUnlock() {
  show("unlock");
  setTimeout(() => $("pw").focus(), 0);
}

$("unlock").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const pw = $("pw").value;
  if (!pw) { $("pw").focus(); return; }
  $("go").disabled = true;
  say(msg("pmBusy"));
  V.unlock(pw, "pm/argon2.umd.min.js").then(() => {
    $("pw").value = "";
    return V.open();
  }).then((d) => {
    $("go").disabled = false;
    if (!d) { showUnlock(); return; }
    data = d; say(""); show("open"); render();
  }).catch((e) => {
    $("go").disabled = false;
    const code = e && e.message;
    say(msg(code === "wrong-password" ? "pmWrong" : code === "future" ? "pmFuture" : "pmErr"), true);
    $("pw").select();
  });
});

function fmtAt(ms) {
  if (!ms) return "";
  try { return new Date(ms).toLocaleString(api.i18n.getUILanguage(), { dateStyle: "short", timeStyle: "short" }); }
  catch (e) { return new Date(ms).toISOString(); }
}

function row(e, sub, onFill) {
  const li = document.createElement("li");
  const txt = document.createElement("div");
  txt.className = "txt";
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = (e.fav ? "★ " : "") + (e.title || sub || "—");
  txt.appendChild(t);
  if (sub) { const s = document.createElement("span"); s.className = "s"; s.textContent = sub; txt.appendChild(s); }
  li.appendChild(txt);
  const b = document.createElement("button");
  b.type = "button"; b.className = "fill"; b.textContent = msg("pmFill");
  b.setAttribute("aria-label", msg("pmFill") + " " + (e.title || sub || ""));
  b.addEventListener("click", onFill);
  li.appendChild(b);
  return li;
}

function render() {
  if (!data) return;
  const q = $("q").value.trim();
  const pageOk = tab && /^https?:/.test(tab.url || "");
  const site = pageOk ? F.matches(data.entries, tab.url, K).filter((e) => PC.matches(e, q)) : [];
  const ul = $("site"); ul.textContent = "";
  site.forEach((e) => {
    const k = K.kindOf(e);
    const sub = [e.user, k === "otp" ? msg("pmCodeOnly") : (e.totp ? msg("pm2fa") : "")].filter(Boolean).join(" · ");
    ul.appendChild(row(e, sub, () => fill(e)));
  });
  if (!site.length) {
    const li = document.createElement("li"); li.className = "none";
    li.textContent = pageOk ? msg("pmNoneSite", [F.hostOf(tab.url)]) : msg("pmNoPage");
    ul.appendChild(li);
  }
  const more = data.entries.filter((e) => ["card", "identity", "address"].indexOf(K.kindOf(e)) >= 0 && PC.matches(e, q))
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  const mu = $("more"); mu.textContent = "";
  more.forEach((e) => {
    const k = K.kindOf(e);
    mu.appendChild(row(e, [msg("pmKind_" + k), K.summary(e)].filter(Boolean).join(" · "), () => fill(e)));
  });
  $("moreH").hidden = !more.length;
  $("at").textContent = data.at ? msg("pmAt", [fmtAt(data.at)]) : "";
  const first = document.querySelector("button.fill");
  if (first && document.activeElement !== $("q")) first.focus();
}

async function fill(e) {
  if (!tab || !/^https?:/.test(tab.url || "")) { say(msg("pmNoPage"), true); return; }
  let code = "";
  if (e.totp && ["login", "otp"].indexOf(K.kindOf(e)) >= 0) {
    const o = PC.parseOtp(e.totp);
    if (!o.error) code = (await PC.totp(o)).code;
  }
  const p = F.payload(e, K, code);
  if (!p) return;
  p.origin = new URL(tab.url).origin;
  let n = 0, frames = [];
  try {
    const res = await api.scripting.executeScript({ target: { tabId: tab.id }, func: F.fillInPage, args: [p] });
    n = res && res[0] ? res[0].result : 0;
    if (p.kind === "card" && n >= 0 && n < 2) {
      const fr = await api.scripting.executeScript({ target: { tabId: tab.id }, func: F.framesInPage });
      frames = fr && fr[0] && Array.isArray(fr[0].result) ? fr[0].result : [];
    }
  } catch (x) { n = -2; }
  if (frames.length) { askFrames(p, frames, n); return; }
  if (n > 0) { window.close(); return; }
  say(msg(n === -1 ? "pmMoved" : n === -2 ? "pmNoAccess" : "pmNoFields"), true);
}

/* A card whose number sits in a payment frame of another site
   (Stripe, a bank): say where it goes and fill there only after a
   click, with the browser's own permission prompt for those sites. */
function askFrames(p, frames, n) {
  const hosts = frames.map((o) => new URL(o).host).join(", ");
  say(msg("pmFrameAsk", [hosts]));
  const box = $("frames");
  box.hidden = false;
  $("frameYes").onclick = () => {
    api.permissions.request({ origins: frames.map((o) => o + "/*") }).then(async (ok) => {
      if (!ok) { say(msg("pmNoAccess"), true); return; }
      let m = 0;
      try {
        const res = await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: F.fillInPage,
          args: [Object.assign({}, p, { frames: frames })] });
        (res || []).forEach((r) => { if (r && r.result > 0) m += r.result; });
      } catch (x) { m = 0; }
      if (m > 0) { window.close(); return; }
      say(msg("pmNoFields"), true);
    }, () => say(msg("pmNoAccess"), true));
  };
  $("frameNo").onclick = () => { box.hidden = true; if (n > 0) window.close(); else say(msg("pmNoFields"), true); };
  $("frameYes").focus();
}

/* PW-AF3: the login typed on this page goes to Passwords in orOS
   (background.js hands it to the orOS tab); orOS opens it in the
   editor and saves it only when the person presses Save there. */
$("saveLogin").addEventListener("click", async () => {
  $("saveAsk").hidden = true;
  if (!tab || !/^https?:/.test(tab.url || "")) { say(msg("pmNoPage"), true); return; }
  const ok = await api.permissions.contains({ origins: [originPattern()] }).catch(() => false)
    || await api.permissions.request({ origins: [originPattern()] }).catch(() => false);
  if (!ok) { say(msg("pmNoAccess"), true); return; }
  let item = null;
  try {
    const res = await api.scripting.executeScript({ target: { tabId: tab.id }, func: F.readLogin });
    item = res && res[0] ? res[0].result : null;
  } catch (x) { say(msg("pmNoAccess"), true); return; }
  if (!item || !item.pw) { say(msg("pmSaveNone"), true); return; }
  say(msg("pmSaveAsk", [new URL(item.url).host, item.user || "—"]));
  $("saveAsk").hidden = false;
  $("saveYes").onclick = () => {
    api.runtime.sendMessage({ t: "pm-save", item: item }).then((r) => {
      item = null;
      if (r && r.ok) window.close(); else say(msg("pmSaveFail"), true);
    }, () => say(msg("pmSaveFail"), true));
  };
  $("saveNo").onclick = () => { item = null; $("saveAsk").hidden = true; say(""); };
  $("saveYes").focus();
});

async function start() {
  say("");
  base = await getBase();
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  tab = tabs && tabs[0] ? tabs[0] : null;
  const perm = await api.permissions.contains({ origins: [originPattern()] }).catch(() => false);
  if (perm) await V.refreshAll(base);
  const copy = await V.getCopy();
  if (!copy || (!copy.future && !PmVault.primaryKid(copy.slice))) {
    $("grant").hidden = perm;
    say(msg(perm ? "pmNoCopy" : "pmNeedPerm", [new URL(base).host]));
    show("need");
    return;
  }
  if (copy.future) { say(msg("pmFuture"), true); show("need"); $("grant").hidden = true; return; }
  data = await V.open();
  if (!data) { showUnlock(); return; }
  show("open");
  render();
}
start();
