# Glarolykoi for Android

`net.glarolykoi.android` (permanent id): the Glarolykoi shop and news,
glarolykoi.net, in our own small WebView app. It replaces the Appilix
build `net.glarolykoi.app`, which was signed with Appilix's key and
carried Firebase, Google Analytics, the advertising ID and Google
sign-in. Android cannot update one into the other (different key and
id), so people install this app once and remove the old one.
Plan and decisions: Bible Part IX, "Glarolykoi Android app".

Free, MIT, no ads, no account with anyone, no tracking.

## Rules

- **GL-NOGOOGLE** No Google, Firebase or AndroidX library and no
  permission beyond `INTERNET` and `ACCESS_NETWORK_STATE`; the
  advertising ID is removed from the manifest. WebView Safe Browsing
  lookups and WebView metrics are off. CI checks every APK. (The page
  itself still runs in the phone's Android System WebView.)
- **GL-LINK** (`Links.java`, tested in `LinksTest`) glarolykoi.net and
  Viva.com checkout stay in the app; redirects and loads the person did
  not tap stay too (3-D Secure, the way back from a payment); a link
  the person taps to another site opens in their browser; `http:`
  pages never load inside; `tel:`, `mailto:`, `viber:`, `intent:` and
  similar go to the app that handles them (an `intent:` link can never
  start one of our own screens or pass file grants); `file:`,
  `content:`, `javascript:`, `data:` are blocked.
- **GL-SHARE** (`Bridge.java`) the page's only bridge: `navigator.share`
  on glarolykoi.net pages opens the share sheet. Frames from other
  sites cannot use it; at most once a second; text capped at 2,000
  characters. Nothing is read or returned to the page.
- **GL-OFF** without a network the app shows pages already seen from
  the WebView cache; a page that cannot load shows a "No connection"
  screen with Try again.
- **GL-DL** downloads (e-books, PDFs) go to Downloads through the
  system DownloadManager on Android 10+, with the shop's cookies only
  for glarolykoi.net files; on Android 7-9 the browser downloads them.
- File fields on the site (forms) open the system file picker.
- The user agent ends in `GlarolykoiApp/<version>`, so the site can tell
  the app apart (for the notice in the old app, wave G3).
- Signing only from the environment (GitHub secrets
  `GLAROLYKOI_KEYSTORE_*`); a keystore is never committed.
- EN and EL for every string (`values`, `values-el`).

## Build

GitHub Actions (`.github/workflows/glarolykoi-android.yml`) builds it on
every change: open the run, download the `glarolykoi-android` artifact.
Locally (Android SDK, JDK 17, Gradle 8.11+):

```
gradle -p glarolykoi-android testDebugUnitTest assembleDebug
```

The debug build has its own id (`.debug`) and installs next to the real app.
