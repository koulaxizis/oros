# Send to orOS (browser add-on)

One add-on for Chrome, Edge, Brave and Firefox (Manifest V3, plain JS,
no build). It keeps no data and talks to no server: every action opens
orOS in a new tab, and orOS asks before it saves anything.

- **Toolbar button / Alt+Shift+O:** save the current page to Bookmarks.
- **Right-click a page or a link:** "Save page / link to orOS".
- **Right-click the button:** "Open orOS".
- **Address bar:** `oros` + space + words → orOS menu search with those words.
- **Options:** the orOS address (default `https://useoros.online/`;
  `https://` anywhere, `http://` only for localhost).

How it talks to orOS: `/?share-url=…&share-title=…` (Bookmarks add
dialog, see `shareFromHref` in `shell.js`) and `/?search=…`
(`searchFromLaunchParam`). The same URLs serve the bookmarklet and
Android's Share → orOS.

Permissions: `activeTab` (address and title of the tab you click on,
only at that moment), `contextMenus`, `storage` (the orOS address).
No host permissions, no content scripts.

## Try it locally

- Chrome/Edge/Brave: `chrome://extensions` → Developer mode → Load
  unpacked → this folder.
- Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary
  Add-on → `manifest.json`.

## Package

From this folder:

    zip -qr -X ../send-to-oros-<version>.zip manifest.json core.js background.js options.html options.css options.js _locales icons

The same zip goes to all three stores. Raise `version` in
`manifest.json` for every upload.

- Chrome Web Store: developer account (one-time US$5), upload the zip,
  privacy: "does not collect or use data", privacy policy URL
  `https://useoros.online/extension/PRIVACY.md`.
- Microsoft Edge Add-ons (Partner Center, free): same zip.
- Firefox (addons.mozilla.org, free): same zip; the Gecko id is
  `send-to-oros@useoros.online`. `web-ext lint` passes (one expected
  warning: Firefox ignores `background.service_worker` and uses
  `background.scripts`).

Safari is out of scope (needs Xcode and a paid Apple account).

Tests: `tests/extension.test.js` (core helpers, manifest, locales).
