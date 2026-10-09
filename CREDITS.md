# orOS credits and third-party notices

orOS is built on the work of many people who share what they make, most of
them without knowing orOS exists. This file lists every third-party piece
orOS ships or calls, with its licence and where it comes from. The same list
is shown in the app (Info, `Ctrl+Alt+Shift+I` → "Credits & licences").

**orOS:** Designed with <3 by [Christos Koulaxizis](https://koulaxizis.gr).
Assisted by [Lumo](https://lumo.proton.me/). Audited by [Claude](https://claude.ai/).

Keeping it complete: a pull request that adds a library, font, data set,
sound, icon set or online service updates this file, the `CREDIT_GROUPS`
list in `shell.js` and the "Credits register" in `OROS_BIBLE.md`.

## Libraries (bundled in `vendor/`, run on the device)

| Library | Version | Copyright | Licence | Used by |
|---|---|---|---|---|
| [Leaflet](https://leafletjs.com/) | 1.9.4 | © 2010-2023 Volodymyr Agafonkin, © 2010-2011 CloudMade | [BSD-2-Clause](https://github.com/Leaflet/Leaflet/blob/main/LICENSE) | Maps |
| [jsPDF](https://github.com/parallax/jsPDF) | 2.5.2 | © 2010-2021 James Hall, yWorks GmbH and contributors (bundled parts carry their own notices in the file) | [MIT](https://github.com/parallax/jsPDF/blob/master/LICENSE) | PDF export: Mood, Cycle, Quote, Writer, Netizen ID, Spreadsheet, Budget |
| [SheetJS Community Edition](https://sheetjs.com/) (`xlsx.full.min.js`) | 0.20.3 | © 2013-present SheetJS LLC | [Apache-2.0](https://git.sheetjs.com/sheetjs/sheetjs/src/branch/github/LICENSE) | Spreadsheet, Budget |
| [hls.js](https://github.com/video-dev/hls.js) (light build) | 1.7.3 | © 2017 Dailymotion and contributors | [Apache-2.0](https://github.com/video-dev/hls.js/blob/master/LICENSE) | Television |

Used only by the test suite (`tests/`, never shipped to users):
[jsQR](https://github.com/cozmo/jsQR) by Cosmo Wolfe, Apache-2.0
(`tests/vendor/jsQR.LICENSE`), as an independent decoder for the QR encoder
tests. The tests run on [Node.js](https://nodejs.org/) and
[GitHub Actions](https://github.com/features/actions).

## Fonts

| Font | Copyright | Licence | Used for |
|---|---|---|---|
| [Nunito](https://github.com/googlefonts/nunito) (`fonts/`) | © 2014 The Nunito Project Authors (Vernon Adams, Jacques Le Bailly) | [SIL OFL 1.1](fonts/OFL.txt) | The whole interface |
| [Noto Sans](https://notofonts.github.io/) (`vendor/NotoSans-Regular.ttf`) | © 2022 The Noto Project Authors | [SIL OFL 1.1](vendor/NotoSans-OFL.txt) | Greek text in exported PDFs |
| [Noto Sans, Noto Serif, Noto Sans Mono](https://notofonts.github.io/) (`vendor/noto/`, subset: Latin, Greek, punctuation) | © 2022 The Noto Project Authors | [SIL OFL 1.1](vendor/noto/OFL.txt) | Layout documents on screen and in PDF |

## Icons

Some interface icons (search, refresh, map pin, cloud, heart, in the shell,
Weather and Quote) reuse path data from [Feather Icons](https://feathericons.com/),
© Cole Bemis, [MIT](https://github.com/feathericons/feather/blob/main/LICENSE).
The app icons and all other artwork are drawn for orOS.

## Word lists and data

| Data | Source / authors | Licence | Used by |
|---|---|---|---|
| EFF Diceware word lists (`passwords/words-eff.js`) | [Electronic Frontier Foundation](https://www.eff.org/dice) | [CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/) | Passwords (passphrases) |
| 10k most common passwords (`passwords/common.js`) | [SecLists](https://github.com/danielmiessler/SecLists), © 2018 Daniel Miessler | MIT | Passwords (weak-password check) |
| English words (`wordle/words-en.js`) | [SCOWL](http://wordlist.aspell.net/), © 2000-2016 Kevin Atkinson, via the npm package `wordlist-english` | SCOWL licence (permissive, notice kept in the file) | Wordle |
| Greek words (`wordle/words-el.js`) | Hunspell el_GR 0.9, Steve Stavropoulos and contributors ([elspell](https://elspell.math.upatras.gr/)), via [`dictionary-el`](https://github.com/wooorm/dictionaries) | MPL 1.1 | Λεξούλα (Greek Wordle) |
| Greek word frequencies (`wordle/words-el.js`) | [FrequencyWords](https://github.com/hermitdave/FrequencyWords) 2018, Hermit Dave, from OpenSubtitles | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Λεξούλα (choosing everyday answers) |
| Copyright terms per country (`pubdomain/rules.js`) | Each country's statute; the official source is linked on every row | Facts from public law | Public Domain Calculator |

`passwords/THIRD-PARTY.txt` carries the full MIT notice for SecLists. The
generators for the word lists are kept outside the repo (project files).

Everything else in orOS (code, app icons, sounds, wallpapers, pet artwork,
prompts, minimalism content, name lists, QR encoder) is written for orOS.
Sounds in Sound Mixer, Simon and the games are synthesised in the browser;
there are no recorded audio files. Emoji come from the device's own font.

## Online services (called only when the feature is used)

| Service | Operator | Terms / data licence | Used by |
|---|---|---|---|
| [Open-Meteo](https://open-meteo.com/) (forecast, geocoding, air quality) | Open-Meteo.com | Data [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), free for non-commercial use; attribution shown in the Weather app | Weather app, taskbar weather |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles | OpenStreetMap Foundation; data by OpenStreetMap contributors | Data [ODbL](https://opendatacommons.org/licenses/odbl/); [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) | Maps (standard layer) |
| OSM France humanitarian tiles | OpenStreetMap France, [Humanitarian OpenStreetMap Team](https://www.hotosm.org/) | Data ODbL | Maps (humanitarian layer) |
| Esri World Imagery | Esri; imagery Maxar, Earthstar Geographics | Esri terms of use; attribution shown on the map | Maps (satellite layer) |
| [Photon](https://photon.komoot.io/) | komoot | Software Apache-2.0, data ODbL; fair use | Maps (search) |
| [OSRM](https://project-osrm.org/) demo server | Project OSRM | Software BSD-2-Clause; demo server, fair use | Maps (car routes) |
| [FOSSGIS routing](https://routing.openstreetmap.de/) | FOSSGIS e.V. | Data ODbL; fair use | Maps (bike and walking routes) |
| [Radio Browser](https://www.radio-browser.info/) | Alex Segler and the community | Free community API | Radio (station directory) |
| [iptv-org](https://github.com/iptv-org/iptv) | iptv-org contributors | [Unlicense](https://github.com/iptv-org/iptv/blob/master/LICENSE) (public domain) | Television (channel directory) |
| [Wikidata](https://www.wikidata.org/) | Wikidata editors, Wikimedia Foundation | Data [CC0](https://creativecommons.org/publicdomain/zero/1.0/) | Public Domain Calculator |
| [Dropbox](https://www.dropbox.com/) | Dropbox, Inc. | The user's own account; data end-to-end encrypted by orOS | Optional sync |
| [GitHub Pages](https://pages.github.com/) | GitHub, Inc. | Hosting | Serves useoros.online |

Radio and TV streams belong to their broadcasters; orOS only plays the
public addresses listed in the two directories above.
