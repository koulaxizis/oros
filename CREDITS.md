# orOS credits and third-party notices

orOS is built on the work of many people who share what they make, most of
them without knowing orOS exists. This file lists every third-party piece
orOS ships or calls, with its licence and where it comes from. The same list
is shown in the app (Info, `Ctrl+Alt+Shift+I` → "Credits & licences").

**orOS:** Designed with <3 by [Christos Koulaxizis](https://koulaxizis.gr).
Assisted by [Lumo](https://lumo.proton.me/). Audited by [Claude](https://claude.ai/).
orOS itself is released under the [MIT License](LICENSE); the third-party
pieces below keep their own licences.

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
| [PDF.js](https://mozilla.github.io/pdf.js/) (legacy build, `vendor/pdfjs/`) | 5.4.394 | © Mozilla Foundation and contributors | [Apache-2.0](vendor/pdfjs/LICENSE) | Layout: opening PDF files |
| [Mediabunny](https://mediabunny.dev/) (`vendor/mediabunny.min.js`) | 1.60.0 | © Vanilagy and contributors | [MPL-2.0](vendor/mediabunny.LICENSE) | Montage: reading video, sound and picture files and writing MP4/WebM |
| [ONNX Runtime Web](https://onnxruntime.ai/) (WebAssembly build, `vendor/ort/`) | 1.22.0 | © Microsoft Corporation | [MIT](vendor/ort/LICENSE) | Atelier: removing a picture's background on the device (downloaded on first use, not precached) |
| [U²-Net](https://github.com/xuebinqin/U-2-Net) model u2netp (`vendor/u2netp/u2netp.onnx`, ONNX export from [rembg](https://github.com/danielgatis/rembg)) | — | © 2020 Xuebin Qin and contributors | [Apache-2.0](vendor/u2netp/LICENSE) | Atelier: the background removal model |
| [NULL JSFX](https://nulljsfx.tech) (web build in `studio/nullfx/`, from [null-jsfx](https://github.com/koulaxizis/null-jsfx) `web/`) | 2026-10 | © 2026 Christos Koulaxizis | [MIT](studio/nullfx/LICENSE.md) | Studio: the effects and their interfaces |

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
Atelier's offline icon library (`atelier/library/icons.js`) holds 365 outline
icons from [Tabler Icons](https://tabler.io/icons) 3.49.0, © 2020-2026 Paweł Kuna,
MIT (notice in the file). The app icons and all other artwork are drawn for orOS.

## Word lists and data

| Data | Source / authors | Licence | Used by |
|---|---|---|---|
| EFF Diceware word lists (`passwords/words-eff.js`) | [Electronic Frontier Foundation](https://www.eff.org/dice) | [CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/) | Passwords (passphrases) |
| 10k most common passwords (`passwords/common.js`) | [SecLists](https://github.com/danielmiessler/SecLists), © 2018 Daniel Miessler | MIT | Passwords (weak-password check) |
| English words (`wordle/words-en.js`) | [SCOWL](http://wordlist.aspell.net/), © 2000-2016 Kevin Atkinson, via the npm package `wordlist-english` | SCOWL licence (permissive, notice kept in the file) | Wordle, Hangman (`hangman/words-en.js`), Word Search and Crossword (`wordsearch/words-en.js`) |
| Greek words (`wordle/words-el.js`) | Hunspell el_GR 0.9, Steve Stavropoulos and contributors ([elspell](https://elspell.math.upatras.gr/)), via [`dictionary-el`](https://github.com/wooorm/dictionaries) | MPL 1.1 | Λεξούλα (Greek Wordle), Hangman (`hangman/words-el.js`), Κρυπτόλεξο and Σταυρόλεξο (`wordsearch/words-el.js`) |
| Word frequencies, English and Greek (`wordle/words-el.js`, `hangman/words-*.js`, `wordsearch/words-*.js`) | [FrequencyWords](https://github.com/hermitdave/FrequencyWords) 2018, Hermit Dave, from OpenSubtitles | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Λεξούλα, Hangman, Word Search and Crossword (EN and EL: choosing everyday words) |
| Copyright terms per country (`pubdomain/rules.js`) | Each country's statute; the official source is linked on every row | Facts from public law | Public Domain Calculator |
| Bright stars and names (`sky/stars.js`) | [Yale Bright Star Catalogue](http://tdc-www.harvard.edu/catalogs/bsc5.html), 5th ed., D. Hoffleit and W. H. Warren Jr. | Public domain | Moon & Sky |
| Constellation figures (`sky/stars.js`) | [d3-celestial](https://github.com/ofrohn/d3-celestial), © 2015 Olaf Frohn | [BSD-3-Clause](sky/LICENSE-d3-celestial.txt) | Moon & Sky |
| Astronomy formulas (`sky/core.js`) | Jean Meeus, *Astronomical Algorithms* (2nd ed.); E. M. Standish, JPL "Approximate Positions of the Planets" | Methods (no code or data copied beyond published coefficients) | Moon & Sky |
| Place presets and fields (`maps/presets-data.js`, generated) | [id-tagging-schema](https://github.com/openstreetmap/id-tagging-schema) 7.3.0, © OpenStreetMap iD contributors | ISC (notice kept in the file) | Maps (place editing: kinds, fields, Greek names) |

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
| [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles | OpenStreetMap Foundation; data by OpenStreetMap contributors | Data [ODbL](https://opendatacommons.org/licenses/odbl/); [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) | Maps (standard layer; public GPS traces layer from gps.tile.openstreetmap.org) |
| OSM France humanitarian tiles | OpenStreetMap France, [Humanitarian OpenStreetMap Team](https://www.hotosm.org/) | Data ODbL | Maps (humanitarian layer) |
| Esri World Imagery | Esri; imagery Maxar, Earthstar Geographics | Esri terms of use; attribution shown on the map | Maps (satellite layer) |
| [OpenTopoMap](https://opentopomap.org/) | OpenTopoMap; data by OpenStreetMap contributors, elevation SRTM | Map style [CC-BY-SA](https://creativecommons.org/licenses/by-sa/3.0/), data ODbL; attribution shown on the map | Maps (Topo layer with contour lines) |
| [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) on AWS (Terrarium) | Mapzen and others; sources include SRTM, GMTED2010, ETOPO1, USGS NED, EU-DEM ([attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)) | Open data, attribution per source | Maps (elevation profile in Plan a track) |
| [Wikipedia](https://www.wikipedia.org/) (MediaWiki geosearch API) | Wikimedia Foundation; articles by Wikipedia contributors | Text [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); API free, no key | Maps (Discover › Wikipedia: titles, descriptions, thumbnails, links to the articles) |
| [Panoramax](https://panoramax.fr/) | Panoramax (IGN, OpenStreetMap France and contributors); photos by their authors | Photos under each picture's licence (shown in the popup, usually CC BY-SA 4.0); API free, no key | Maps (Discover › Photos: open street-level photos) |
| [Photon](https://photon.komoot.io/) | komoot | Software Apache-2.0, data ODbL; fair use | Maps (search) |
| [OSRM](https://project-osrm.org/) demo server | Project OSRM | Software BSD-2-Clause; demo server, fair use | Maps (car routes) |
| [FOSSGIS routing](https://routing.openstreetmap.de/) | FOSSGIS e.V. | Data ODbL; fair use | Maps (bike and walking routes) |
| [Transitous](https://transitous.org/) ([sources](https://transitous.org/sources/)) | The Transitous community, on [MOTIS](https://github.com/motis-project/motis); timetables by each operator | Free for non-commercial open-source apps; each feed under its own open licence (Athens OASA and STASY, data.gov.gr, CC BY 4.0); map data ODbL | Maps (public transport: connections, departures, stops, live vehicles) |
| [OpenStreetMap API](https://wiki.openstreetmap.org/wiki/API_v0.6) | OpenStreetMap Foundation; data by OpenStreetMap contributors | Data ODbL; [API usage policy](https://operations.osmfoundation.org/policies/api/) | Maps (notes, sign-in, place edits, GPS trace uploads) |
| [Overpass API](https://overpass-api.de/) (overpass-api.de) | Roland Olbricht and the Overpass community; data by OpenStreetMap contributors | Software AGPL-3.0 (server only), data ODbL; fair use | Maps (places around you, for editing; quests; speed limits on the road ahead while driving) |
| [Radio Browser](https://www.radio-browser.info/) | Alex Segler and the community | Free community API | Radio (station directory) |
| [Apple Podcasts search](https://performance-partners.apple.com/search-api) | Apple Inc. | Public search API, called only when you search | Podcasts (show search) |
| [fyyd](https://fyyd.de/) | fyyd.de | Public API, called only when you search | Podcasts (show search) |
| [iptv-org](https://github.com/iptv-org/iptv) | iptv-org contributors | [Unlicense](https://github.com/iptv-org/iptv/blob/master/LICENSE) (public domain) | Television (channel directory) |
| [Wikidata](https://www.wikidata.org/) | Wikidata editors, Wikimedia Foundation | Data [CC0](https://creativecommons.org/publicdomain/zero/1.0/) | Public Domain Calculator |
| [Openverse](https://openverse.org/) | WordPress.org; each work by its creator | Per item (Creative Commons or public domain); Atelier keeps the licence and credit of every item | Atelier (photos, illustrations, sounds) |
| [Wikimedia Commons](https://commons.wikimedia.org/) | Commons contributors, Wikimedia Foundation | Per item (free licences) | Atelier (photos, drawings, sounds, video) |
| [Iconify](https://iconify.design/) | Vjacheslav Trushkin; each icon set by its authors | Per icon set (MIT, Apache, CC BY, OFL, …) | Atelier (icons, clipart) |
| [Fontsource](https://fontsource.org/) | Fontsource; each font by its designers | Per font (mostly OFL / Apache) | Atelier (font catalogue and files) |
| [Pixabay](https://pixabay.com/) | Pixabay creators | Pixabay Content License; only with the user's own API key | Atelier (optional) |
| [Pexels](https://www.pexels.com/) | Pexels creators | Pexels License; only with the user's own API key | Atelier (optional) |
| [Open Library](https://openlibrary.org/) | Internet Archive | Data [CC0](https://creativecommons.org/publicdomain/zero/1.0/); called only when you tap Find details online | Media Shelf (books) |
| [MusicBrainz](https://musicbrainz.org/) | MetaBrainz Foundation | Core data [CC0](https://creativecommons.org/publicdomain/zero/1.0/); called only when you tap Find details online | Media Shelf (albums) |
| AI providers you choose: [Anthropic](https://www.anthropic.com/) (Claude), [OpenAI](https://openai.com/), [Google](https://ai.google.dev/) (Gemini API), [Mistral AI](https://mistral.ai/), [OpenRouter](https://openrouter.ai/), or a local server ([Ollama](https://ollama.com/), [LM Studio](https://lmstudio.ai/)) | Each provider | Each provider's terms; only with the user's own key, called straight from the browser; no code from them is shipped | Assistant |
| [Frankfurter](https://frankfurter.dev/) | Hakan Ensari (open source, MIT); rates published by the [European Central Bank](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) | Free API, no key; ECB euro reference rates (information only); called only when Currency is opened (at most every 6 hours) or Update rates is tapped | Unit Converter (exchange rates) |
| [Wiktionary](https://en.wiktionary.org/) | Wiktionary editors, Wikimedia Foundation | Text [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); called only after a one-time opt-in on each device, only the word is sent | Library (word look-up) |
| [Cloudflare Workers](https://workers.cloudflare.com/) | Cloudflare, Inc. | Runs the orOS relay (`relay/`, stateless, no logs); anyone can deploy their own | Mail; Connected services (only when a shop can't be reached from the browser) |
| [WooCommerce REST API](https://woocommerce.github.io/woocommerce-rest-api-docs/) | Automattic; the shop is the user's own | The user's own shop and keys; called only from the Stock shop panel and Settings → Connected services | Stock (shop), Settings |
| MailerLite, Mailchimp Marketing and Brevo APIs ([MailerLite](https://developers.mailerlite.com/), [Mailchimp](https://mailchimp.com/developer/), [Brevo](https://developers.brevo.com/)) | MailerLite; Intuit Mailchimp; Brevo (Sendinblue). The accounts are the user's own | The user's own accounts and keys; called only from Newsletter › Email platforms and Settings → Connected services (Mailchimp always through the orOS relay) | Newsletter, Settings |
| HubSpot CRM API and Pipedrive API ([HubSpot](https://developers.hubspot.com/docs/api/crm/understanding-the-crm), [Pipedrive](https://developers.pipedrive.com/docs/api/v1)) | HubSpot, Inc.; Pipedrive OÜ. The accounts are the user's own | The user's own accounts and keys; read only, from CRM › Settings › Import from HubSpot or Pipedrive and Settings → Connected services (HubSpot always through the orOS relay) | CRM, Settings |
| Stripe API ([Stripe](https://docs.stripe.com/api/balance_transactions)) | Stripe, Inc. The account is the user's own | The user's own account and restricted key; read only (balance transactions), from Budget › Import from Stripe and Settings → Connected services, always through the orOS relay | Budget, Settings |
| Invoice Ninja API ([Invoice Ninja](https://api-docs.invoicing.co/)) | Invoice Ninja LLC. The account or install is the user's own | The user's own account (invoicing.co or a self-hosted install) and API token; read only (clients, payments), from CRM › Settings › Import, Budget › Import from Stripe or Invoice Ninja and Settings → Connected services | CRM, Budget, Settings |
| Odoo JSON-2 API ([Odoo](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html)) | Odoo S.A. The database is the user's own | The user's own Odoo (Odoo Online or a self-hosted 19+) and API key; read only (search_read of contacts and opportunities), from CRM › Settings › Import and Settings → Connected services | CRM, Settings |
| Todoist API v1 ([Todoist](https://developer.todoist.com/api/v1/)) | Doist Inc. The account is the user's own | The user's own account and API token; read only (projects, open tasks), from To-Do › List settings › Import from Todoist and Settings → Connected services | To-Do, Settings |
| Trello REST API ([Trello](https://developer.atlassian.com/cloud/trello/rest/)) | Atlassian. The account is the user's own | The user's own account, API key and token; read only (open boards with their lists, cards, labels and checklists), from Kanban › Import from other apps and Settings → Connected services | Kanban, Settings |
| GitHub REST API ([GitHub](https://docs.github.com/en/rest/issues/issues)) | GitHub, Inc. The account is the user's own | The user's own account and personal access token; read only (repository list, issues, the open issues assigned to you), from Kanban › Import from other apps, To-Do › Import from Todoist or GitHub and Settings → Connected services | Kanban, To-Do, Settings |
| Raindrop.io REST API ([Raindrop.io](https://developer.raindrop.io/)) | Raindrop.io. The account is the user's own | The user's own account and test token; read only (collections, bookmarks), from Bookmarks › Import from Raindrop.io and Settings → Connected services | Bookmarks, Settings |
| Notion API ([Notion](https://developers.notion.com/reference/intro)) | Notion Labs, Inc. The workspace is the user's own | The user's own internal integration and its secret; read only (the pages shared with it and their blocks, the databases shared with it and their rows), from Notes › Import from Notion, Spreadsheet › Notion, Kanban › Import from other apps and Settings → Connected services, always through the orOS relay | Notes, Spreadsheet, Kanban, Settings |
| [timologisi.online provider API](https://www.timologisi.online/) | Novus Conceptus; the account is the user's own | The user's own account and key; called only from Invoices → myDATA (AADE) and Settings → Connected services | Invoices, Settings |
| [Dropbox](https://www.dropbox.com/) | Dropbox, Inc. | The user's own account; data end-to-end encrypted by orOS | Optional sync |
| [GitHub Pages](https://pages.github.com/) | GitHub, Inc. | Hosting | Serves useoros.online |

Radio and TV streams belong to their broadcasters; orOS only plays the
public addresses listed in the two directories above.
