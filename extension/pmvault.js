/* orOS add-on, Passwords (PW-AF1): the add-on's own copy of the
   vault and its own unlock. Loaded by popup.html and background.js
   after pm/pmcrypto.js, pm/pmcore.js and pm/pmkinds.js, which are
   byte-for-byte copies of orOS's passwords/ files (the tests check it).
   - The copy: the "oros-passwords-vault" sync slice, read from an
     orOS tab you have open (scripting, host permission for the orOS
     address only). It is ciphertext plus a public header, the same
     thing orOS syncs; it lives in storage.local and is merged, never
     replaced, so an older tab cannot drop newer blobs.
   - The key: the master password opens the vault key (Argon2id or
     PBKDF2, exactly as in orOS); only that 32-byte key is kept, in
     storage.session (memory only, gone when the browser closes, not
     readable by pages or content scripts), with a lock time that every
     use moves forward. The master password is never stored.
   - Entries are decrypted only for one popup or one fill, in memory. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.OrosVault = factory(root);
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  var api = typeof browser !== "undefined" ? browser : chrome;
  var PV = root.PmVault, PC = root.PmCore;
  var COPY = "pmCopy", KEY = "pmKey";
  var SLICE_KEY = "oros-passwords-vault";
  var LOCK_CHOICES = [1, 5, 15, 30, 60];

  function lockMinutes() {
    return api.storage.sync.get({ pmLockMin: 15 }).then(function (g) {
      return LOCK_CHOICES.indexOf(g.pmLockMin) >= 0 ? g.pmLockMin : 15;
    }, function () { return 15; });
  }

  /* ---------- the copy ---------- */
  function getCopy() {
    return api.storage.local.get(COPY).then(function (g) {
      var c = g && g[COPY];
      if (!c || typeof c !== "object" || typeof c.slice !== "string") return null;
      var s;
      try { s = PV.normSlice(JSON.parse(c.slice)); } catch (e) { return null; }
      return { slice: s, at: c.at || 0, future: PV.isFuture(JSON.parse(c.slice)) };
    });
  }
  /* raw: the slice text from the orOS tab (or null). Merged into the
     copy; returns true when a vault is there. */
  function absorbText(raw) {
    if (typeof raw !== "string" || !raw || raw.length > 32 * 1024 * 1024) return getCopy().then(function (c) { return !!(c && PV.primaryKid(c.slice)); });
    var incoming;
    try { incoming = JSON.parse(raw); } catch (e) { return Promise.resolve(false); }
    if (PV.isFuture(incoming)) {
      return api.storage.local.set({ pmCopy: { slice: raw, at: Date.now() } }).then(function () { return false; });
    }
    return getCopy().then(function (c) {
      var next = c && !c.future ? PV.mergeSlice(c.slice, PV.normSlice(incoming)) : PV.normSlice(incoming);
      return api.storage.local.set({ pmCopy: { slice: JSON.stringify(next), at: Date.now() } }).then(function () {
        return !!PV.primaryKid(next);
      });
    });
  }
  /* Read the slice from one orOS tab. Needs the host permission for
     that tab's origin; refused → false. */
  function refreshFromTab(tabId) {
    return api.scripting.executeScript({
      target: { tabId: tabId },
      func: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      args: [SLICE_KEY]
    }).then(function (res) {
      var raw = res && res[0] ? res[0].result : null;
      return absorbText(raw);
    }, function () { return false; });
  }
  function isOrosTab(tab, base) {
    if (!tab || !tab.url || !base) return false;
    try { return new URL(tab.url).origin === new URL(base).origin; } catch (e) { return false; }
  }
  /* Every open orOS tab of this browser (the copy is merged). */
  function refreshAll(base) {
    var pattern;
    try { pattern = new URL(base).origin + "/*"; } catch (e) { return Promise.resolve(false); }
    return api.tabs.query({ url: pattern }).then(function (tabs) {
      var p = Promise.resolve(false);
      (tabs || []).forEach(function (t) { p = p.then(function (ok) { return refreshFromTab(t.id).then(function (x) { return ok || x; }); }); });
      return p;
    }, function () { return false; });
  }
  function forget() { return api.storage.local.remove(COPY).then(lock); }

  /* ---------- the key ---------- */
  function lock() { return api.storage.session.remove(KEY).then(function () {}, function () {}); }
  function keyState() {
    return api.storage.session.get(KEY).then(function (g) {
      var k = g && g[KEY];
      if (!k || typeof k.vk !== "string" || typeof k.kid !== "string") return null;
      if (!(k.until > Date.now())) return lock().then(function () { return null; });
      return k;
    }, function () { return null; });
  }
  function touch(k) {
    return lockMinutes().then(function (m) {
      var until = Date.now() + m * 60000;
      var next = { kid: k.kid, vk: k.vk, until: until };
      if (api.alarms) api.alarms.create("pm-lock", { when: until + 500 });
      return api.storage.session.set({ pmKey: next }).then(function () { return next; });
    });
  }
  /* → resolves on success; rejects "no-copy", "future", "no-vault",
     "wrong-password", "no-argon2", "no-wasm". */
  function unlock(password, argonSrc) {
    return getCopy().then(function (c) {
      if (!c) throw new Error("no-copy");
      if (c.future) throw new Error("future");
      var kid = PV.primaryKid(c.slice);
      if (!kid) throw new Error("no-vault");
      var vault = c.slice.vaults[kid];
      var pre = vault.kdf && vault.kdf.alg === "argon2id" ? PV.loadArgon2(argonSrc) : Promise.resolve();
      return pre.then(function () { return PV.openVK(vault, kid, { password: password }); }).then(function (vk) {
        var k = { kid: kid, vk: PV.b64(vk) };
        PV.wipe(vk);
        return touch(k);
      });
    });
  }

  /* ---------- entries ---------- */
  /* → { entries, at } of the unlocked vault, or null when locked. */
  function open() {
    return keyState().then(function (k) {
      if (!k) return null;
      return Promise.all([getCopy(), touch(k)]).then(function (x) {
        var c = x[0];
        if (!c || c.future || !c.slice.vaults[k.kid]) return lock().then(function () { return null; });
        var vk = PV.unb64(k.vk);
        return PV.sessionFromVK(new Uint8Array(vk), k.kid).then(function (s) {
          var V = c.slice.vaults[k.kid], snap = PC.emptySnap();
          var p = Promise.resolve();
          Object.keys(V.blobs).forEach(function (id) {
            p = p.then(function () {
              return PV.openBlob(s, id, V.blobs[id]).then(function (o) { snap = PC.mergeSnap(snap, PC.normSnap(o)); }, function () {});
            });
          });
          return p.then(function () { return { entries: PC.normSnap(snap).e, at: c.at }; });
        });
      });
    });
  }

  return {
    SLICE_KEY: SLICE_KEY, LOCK_CHOICES: LOCK_CHOICES,
    getCopy: getCopy, absorbText: absorbText, refreshFromTab: refreshFromTab, refreshAll: refreshAll, isOrosTab: isOrosTab,
    forget: forget, lock: lock, keyState: keyState, unlock: unlock, open: open, lockMinutes: lockMinutes
  };
});
