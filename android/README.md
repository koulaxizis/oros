# orOS Android app

The Android package of orOS (`online.useoros.twa`): the installed web app
in a Trusted Web Activity, plus native code that shows orOS Contacts and
Calendar in the phone's own Contacts, dialer and Calendar
(BR-PHONE in `OROS_BIBLE.md`). It replaces the PWABuilder package and
uses the same package name and signing key, so it installs as an update.

## Build

GitHub Actions (`.github/workflows/android.yml`) builds it on every
change: open the run, download the `oros-android` artifact.

- `app-oros-debug.apk`: own id (`.debug`), opens with an address bar and has
  no phone bridge (a debug key cannot pass `assetlinks.json`). Proves the
  build only.
- `app-oros-release.apk` / `app-oros-release.aab`: signed when the repository has
  the secrets `OROS_KEYSTORE_BASE64`, `OROS_KEYSTORE_PASSWORD`,
  `OROS_KEY_ALIAS`, `OROS_KEY_PASSWORD` (the PWABuilder signing key).
  The APK is for installing on a phone, the AAB for Google Play.

Locally (Android SDK, JDK 17, Gradle 8.11+):

```
node android/tools/gen.js        # manifest + resources from manifest.webmanifest
gradle -p android assembleDebug
```

orOS Drive on the phone (DRIVE-A) joins the orOS flavour only when
`app/libs/orosdrive.aar` (its Go core) exists; without it the app builds
without the Drive screen (F-Droid, a plain checkout). android.yml builds it
from the koulaxizis/oros-drive commit it pins; locally (Go 1.24, Android NDK):

```
cd ../oros-drive
go install golang.org/x/mobile/cmd/gomobile golang.org/x/mobile/cmd/gobind
gomobile bind -target=android/arm64,android/arm,android/amd64 -androidapi 24 -javapkg online.useoros.drive \
  -o ../oros/android/app/libs/orosdrive.aar ./mobile
```

## Passwords autofill (PW-AF2)

The orOS app is also an Android autofill service (`OrosAutofillService`,
chosen in Android Settings › Passwords › Autofill service). orOS
Passwords hands it two lists sealed with this phone's Keystore keys
(`AfVault`, over the phone bridge, v8); a suggestion is filled only
after the fingerprint, face or screen lock (`AfAuthActivity`). Rules
(`AfMatch`) follow the browser add-on's `extension/pmfill.js`. Single
apps leave the service out. Bible Part IV "Phone autofill".
Saving (PW-AF3): with autofill on, forms with a password field carry
a `SaveInfo`; a login the person saves is sealed with a third Keystore
key (`oros-af-save`, AES-GCM), kept at most a day and handed to the
page over the bridge (`af-save`), which shows it in the Passwords
editor; nothing is stored in the vault without Save there.

## Single apps (wave 7)

The same project also builds every orOS single app (SOLO-1) as its
own package, listed in `android/solo-apps.json` (app id →
package). Each is a product flavour: `oros` is the orOS app itself
(`online.useoros.twa`, unchanged), the others start at
`https://useoros.online/<id>/solo.html`, carry that app's name, icon,
shortcuts, share target and file types, and only catch links under
`/<id>/`. They leave out the phone bridge (no orOS account, no
Contacts, Calendar or Health Connect permissions, no reminders or
orOS widgets); the code is compiled in but never reached.

Each single app has its own home-screen widget (`SoloWidget`): its
icon (opens the app) and up to three of its icon shortcuts from
`solo.js` (EN/EL labels), each opening `/<id>/solo.html?do=<word>`.
No data is kept in the widget.

`node android/tools/gen.js` writes each overlay to `app/solo-gen/<id>/`
(git-ignored) from `/<id>/manifest.webmanifest` and `icons/solo/`.
Gradle tasks are per flavour (`assembleOrosRelease`,
`bundleNotesRelease`, …); CI uploads `oros-android` (orOS) and
`oros-single-apps` (one folder per app). Every package needs its
statement in `.well-known/assetlinks.json` (upload key, plus Play's
App signing key once the app is on Play).

To add an app: a line in `solo-apps.json` (the app must be in
`solo.js` APPS), its statement in `assetlinks.json`, a Play listing.

## Google Play

Play re-signs the app with its own key: add the "App signing key
certificate" SHA-256 from Play Console to `.well-known/assetlinks.json`
next to the upload key, or the app opens with an address bar and the
phone bridge stays off.
