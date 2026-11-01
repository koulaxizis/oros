# orOS browser add-on

One add-on for Chrome, Edge, Brave and Firefox (Manifest V3, plain JS,
no build step). Version 2 ("orOS", formerly "Send to orOS") adds
Passwords: fill logins, 2FA codes, cards, identities and addresses
from your orOS vault (Bible PW-AF1).

- **Toolbar button / Ctrl+Shift+L:** the add-on window. Passwords for
  this site, cards and addresses, and "Save this page to orOS".
- **Alt+Shift+O:** save the current page to Bookmarks.
- **Right-click a page or a link:** "Save page / link to orOS".
- **Right-click selected text:** "Ask the orOS Assistant about …": orOS
  opens its Assistant with the text in the message box (nothing is sent
  until you press Send there).
- **Address bar:** `oros` + space + words → orOS menu search with those words.
- **Options:** the orOS address (default `https://useoros.online/`;
  `https://` anywhere, `http://` only for localhost), the Passwords
  lock time (1, 5, 15, 30 or 60 minutes) and "Forget the vault copy".

How it talks to orOS: `/?share-url=…&share-title=…` (Bookmarks add
dialog, see `shareFromHref` in `shell.js`), `/?search=…`
(`searchFromLaunchParam`) and `/#quick-ask=…` (the Assistant,
`quickmenu.js`; the text is in the fragment, so it never reaches a
server). The same URLs serve the bookmarklet and
Android's Share → orOS.

## Passwords

- **The copy.** When an orOS tab is open, the add-on reads the
  `oros-passwords-vault` slice from it (the same ciphertext orOS
  syncs) and keeps it in `storage.local`, merged, never replaced
  (`pmvault.js`). It needs the host permission for the orOS address
  (asked once, "Allow access to orOS").
- **Unlock.** The master password opens the vault key with the same
  code as orOS (`pm/` is a byte-for-byte copy of `passwords/pmcrypto.js`,
  `pmcore.js`, `pmkinds.js` and hash-wasm's Argon2id; run
  `node .github/scripts/ext-pm.js` after changing them, the tests check
  it). Only the 32-byte key is kept, in `storage.session` (memory,
  gone when the browser closes), with a lock time that every use moves
  forward. The master password is never stored.
- **Fill.** Only on a click in the add-on window, in the top frame of
  the tab (the toolbar click grants `activeTab` for it), only if the page is still on the origin it was opened
  for, and only entries whose site fits (`pmfill.js` `fits`: the same
  host or a sub-domain of it, https entries never on http, IP addresses
  need the same port, no look-alikes). The page receives only the
  chosen entry's values: never a card PIN, never document numbers,
  never notes. A card whose number sits in a payment frame of another
  site (Stripe, a bank): the popup names that site, and only after
  "Fill in the payment frame" and the browser's own permission prompt
  for it fills the card in those frames (`framesInPage`, second pass
  with `allFrames`, each frame re-checks that its origin was confirmed).
- **Save a login (PW-AF3).** "Save the login from this page" (a click)
  reads the typed password and user name from the top frame of that
  tab (`pmfill.js` `readLogin`: a new-password field first; current,
  new, confirm → the new one), shows "Send the login for … to
  Passwords in orOS?" and on a yes hands it to `background.js`, which
  focuses an orOS tab (or opens one) and posts it from the add-on's
  isolated world into that page; the orOS shell answers
  `oros-pw-saved`. orOS shows it in the Passwords editor and stores it
  only when the person presses Save there. Nothing is kept here.
- **Not yet:** logins inside a frame, passkeys.

Permissions: `activeTab` and `scripting` (fill the tab you clicked
on, only then), `storage`, `alarms` (the lock time), `contextMenus`,
host access to `https://useoros.online/*` (read the vault copy);
optional, asked when needed: other https sites, `localhost`.
No content scripts, no network requests of its own.

## Install

Until the store listings exist, the zip from the GitHub release
`browser-addon` (`https://github.com/koulaxizis/oros/releases/download/browser-addon/oros-addon.zip`,
built by `.github/workflows/addon.yml` from `main`) is the download;
the download page links to it.

- Chrome/Edge/Brave: unzip into a folder you keep, `chrome://extensions`
  (`edge://extensions`, `brave://extensions`) → Developer mode → Load
  unpacked → that folder. To update: unzip the new zip over it and press
  the reload arrow.
- Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary
  Add-on → `manifest.json` from the unzipped folder (it stays until
  Firefox closes; a permanent install needs the signed version from
  addons.mozilla.org).

## Package for the stores

    zip -qr -X ../oros-addon.zip . -x README.md

The same zip goes to all three stores. Raise `version` in
`manifest.json` for every upload.

- Chrome Web Store: developer account (one-time US$5), upload the zip,
  privacy: "does not collect or use data", privacy policy URL
  `https://useoros.online/extension/PRIVACY.md`.
- Microsoft Edge Add-ons (Partner Center, free): same zip.
- Firefox (addons.mozilla.org, free): same zip; the Gecko id is
  `send-to-oros@useoros.online` and never changes. `web-ext lint`
  passes (one expected warning: Firefox ignores
  `background.service_worker` and uses `background.scripts`).

Safari is out of scope (needs Xcode and a paid Apple account).

Tests: `tests/extension.test.js` (core helpers, manifest, locales) and
`tests/extension-pm.test.js` (vault copy, unlock, site matching, fill
payload).
