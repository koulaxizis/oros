// ============================================================
// orOS Fieldwarden — App logic (v1.0.0)
// A turn-based tactics game on a 6 × 6 farm through a growing season:
// three village folk guard the fields until the harvest is in. Every
// invader shows what it will do before it acts; the fields grow a
// stage each turn; the harvest at the end of the season must reach
// the quota. The rules live in fieldwarden/engine.js
// (FieldwardenEngine, tested headless), the tables in
// fieldwarden/data.js; this file is the screen.
//   - Mild (a lower quota, one Rewind a season) or Harsh
//   - every year has a code; the same code and folk are the same year
//   - tap a farmhand (or its card), then a green tile to move or an
//     orange one to use its tool; the first tap on an orange tile shows
//     what will happen, the second does it
//   - Undo and Reset turn are free; End turn lets the invaders act
//   - a long press on any tile or piece shows its text
//   - a short "How to play" on the first year
// Data:
//   - synced slice "fieldwarden" (oros-fieldwarden-data): years, years
//     finished and the most seasons won per difficulty, the most
//     sheaves in a season, and finished years per farmhand, as
//     per-device counter rows (each device only grows its own row;
//     merge = per-row max, a join) + reset stamp br (as Realm, Crypt,
//     Banner and Wayfarers)
//   - days (5.79.00): one Daily season per calendar day, one try;
//     last (5.79.00): the last 10 years of every device, with Replay
//   - device-local (R10): oros-fieldwarden-prefs (difficulty, folk,
//     tour seen, quick, threats), oros-fieldwarden-session (the year in
//     progress), oros-fieldwarden-device (counter row id),
//     oros-fieldwarden-sfx (sound)
// Sections:
//   1. Constants, i18n, helpers
//   2. Synced records: load / save / normalize / merge (R5, R26)
//   3. Device-local prefs + session
//   4. Year flow (new, act, undo, end of turn, harvest)
//   5. Scene (layout, drawing the farm)
//   6. Input (tap, long press, keyboard)
//   7. Panels (status, folk bar)
//   8. Dialogs (new year, info, harvest, market, result, records, tour)
//   9. Toasts
//  10. Sound
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.FieldwardenEngine;

  var STORAGE_KEY = "oros-fieldwarden-data";
  var PREFS_KEY   = "oros-fieldwarden-prefs";
  var SESSION_KEY = "oros-fieldwarden-session";
  var DEVICE_KEY  = "oros-fieldwarden-device";
  var SFX_KEY     = "oros-fieldwarden-sfx";
  var DATA_VER    = 1;
  var DIFFS = E.DIFFS;                 // m Mild, h Harsh
  var FOLK_IDS = E.FOLK_IDS;
  var N = E.N, SIZE = E.SIZE;
  var BIG = 1e9;
  var MAX_SEASONS = E.FARMS.length * E.SEASONS;
  var MAX_SHEAVES = SIZE * E.MAX_STAGE;
  var DK = window.orosDaily || null;   // gamekit/daily.js (the Daily season, the Game Center link)
  var LAST_N = 10;                     // Last years kept
  var MAX_DAY = 100000;
  var MAX_SCORE = MAX_SHEAVES + E.WISH_BONUS;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();

  var STRINGS = {
    en: {
      "app.name": "Fieldwarden",
      "btn.new": "New year (N)", "btn.end": "End turn", "btn.endKey": "End turn (E)", "btn.stats": "Records",
      "btn.undo": "Undo (Z)", "btn.reset": "Reset turn (R)", "btn.rewind": "Rewind the last turn",
      "btn.threatOn": "Threats only (T)", "btn.threatOff": "Show everything (T)",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off", "btn.fastOn": "Quick moves on", "btn.fastOff": "Quick moves off",
      "view.label": "The farm, 6 by 6 tiles. The arrow keys move the cursor, Enter chooses a farmhand or a tile, Tab goes to the next farmhand, Escape cancels, Z undoes, E ends the turn.",
      "st.turn": "Turn {n} of {m}", "st.wx": "Weather now: {a}. Next turn: {b}", "st.crop": "Harvest if nothing more is lost: {n} sheaves. Quota: {q}",
      "st.coins": "{n} coins", "st.shop": "The market",
      "diff.m": "Mild", "diff.h": "Harsh",
      "diff.m.note": "A lower quota, and once a season you can rewind the last turn.",
      "diff.h.note": "A higher quota and more invaders, with +1 Health from the second farm. No rewinds.",
      "folk.shepherd": "Shepherd", "folk.smith": "Smith", "folk.hedger": "Hedger",
      "folk.beekeeper": "Beekeeper", "folk.ferryman": "Ferryman", "folk.scarecrow": "Scarecrow-maker",
      "folk.shepherd.note": "Crook: pulls a piece up to 3 tiles away one tile closer. Animals next to her act last.",
      "folk.smith.note": "Hammer: 2 damage to a piece next to him and a push. Next to the barn he mends it.",
      "folk.hedger.note": "Plants a hedge on bare dirt next to her, or shoves a piece. Her hedges never break.",
      "folk.beekeeper.note": "Swarm: a piece up to 3 tiles away, over anything, flees 2 tiles. Fields next to her grow faster.",
      "folk.ferryman.note": "Pole: pushes a piece next to him and the one behind it. He can stand in the pond.",
      "folk.scarecrow.note": "Turnip: 1 damage and a push, up to 4 tiles away. Crows keep away from fields next to her.",
      "tool.crook": "Crook", "tool.hammer": "Hammer", "tool.hedge": "Hedge", "tool.swarm": "Swarm", "tool.pole": "Pole", "tool.turnip": "Turnip",
      "up.crook2": "The crook pulls 2 tiles", "up.crookFar": "The crook reaches 5 tiles",
      "up.hammer3": "The hammer hits 3", "up.hammerPush": "The hammer pushes 2 tiles",
      "up.shove2": "The shove pushes 2 tiles", "up.shoveHit": "The shove also hits 1",
      "up.swarmStun": "The swarm also stops the invader's act", "up.swarmFar": "The swarm reaches 5 tiles",
      "up.poleHit": "The pole also hits each piece 1", "up.poleFar": "The pole reaches 2 tiles",
      "up.turnip2": "The turnip hits 2", "up.turnipArc": "The turnip flies over anything",
      "inv.wolf": "Wolf", "inv.boar": "Boar", "inv.crow": "Crow", "inv.mole": "Mole", "inv.captain": "Bandit captain",
      "inv.wolf.note": "Goes for the farmhand with the least Health and bites for 1. With no one to bite it tramples a field.",
      "inv.boar.note": "Charges in a straight line until something stops it, trampling every field it crosses; what stops it takes 2.",
      "inv.crow.note": "Flies to the ripest field and eats a stage. The wind blows it a tile.",
      "inv.mole.note": "Digs under the nearest field: two stages lost.",
      "inv.captain.note": "Clubs a farmhand for 2 and pushes them, or the barn. Hurt, he whistles for a wolf each turn.",
      "inv.fox": "Fox", "inv.thief": "Thief", "inv.torch": "Torch-bearer", "inv.loud": "Loudmouth",
      "inv.fox.note": "Quick: runs at the barn and bites it for 1, or at the nearest field once the barn is down.",
      "inv.thief.note": "Goes for the ripest field and takes the whole crop: three stages lost.",
      "inv.torch.note": "Sets fire to the ripest field or a haystack. Fire spreads with the wind.",
      "inv.loud.note": "Stays away from the folk and shouts for a thief, who comes in at the end of the turn. Stop him or push him off.",
      "act.bite": "Bite", "act.eat": "Eat", "act.dig": "Dig", "act.tram": "Trample", "act.club": "Club", "act.charge": "Charge",
      "act.raid": "Raid", "act.steal": "Steal", "act.burn": "Set fire", "act.shout": "Shout",
      "info.shout": "Next: shouts for a thief, who comes in at the end of the turn",
      "tile.d": "Dirt", "tile.m": "Mud", "tile.f": "Field", "tile.h": "Hedge", "tile.H": "Hedge (never breaks)", "tile.p": "Pond",
      "tile.s": "Haystack", "tile.b": "Barn",
      "tile.d.note": "Bare ground. The hedger can plant a hedge here. In the rain it turns to mud: a piece pushed onto mud stops there.",
      "tile.f.note": "Grows a stage each turn up to ripe. A hit sets it back and it stops growing for the season.",
      "tile.h.note": "Blocks the way. A charging boar breaks it in two hits.",
      "tile.p.note": "A ground invader pushed into the pond is washed away. Only the ferryman can stand in it.",
      "tile.s.note": "Blocks the way. It burns: in a drought it catches fire unless a farmhand stands next to it.", "tile.b.note": "Blocks the way. The captain, boars and foxes can damage it.",
      "tile.fire": "On fire", "tile.fire.note": "At the end of the turn the fire burns: a field loses a stage, hay and hedges burn away, a piece on it takes 1. Then it spreads a tile with the wind. A farmhand who steps on it stamps it out; rain puts out every fire.",
      "stage.0": "sown", "stage.1": "sprout", "stage.2": "green", "stage.3": "ripe", "stage.hurt": "hurt, no longer grows",
      "wx.c": "Calm", "wx.r": "Rain: dirt is mud, fires go out", "wx.d": "Drought: haystacks catch fire", "wx.n": "Wind to the north", "wx.e": "Wind to the east", "wx.s": "Wind to the south", "wx.w": "Wind to the west",
      "farm.low": "The Lowland", "farm.orchard": "Orchard Hill", "farm.river": "River Bend",
      "wish.star": "Village wish: keep the starred field unhurt (+{n} coins)",
      "wish.barn": "Village wish: keep the barn whole (+{n} coins)",
      "wish.drive": "Village wish: drive off {k} invaders (+{n} coins)",
      "info.hp": "Health {hp} of {mh}", "info.move": "Move {n}", "info.next": "Next: {a} on {b}", "info.nextField": "Next: {a} on a field",
      "info.nextBarn": "Next: {a} on the barn", "info.charge": "Next: a charge, {d}", "info.idle": "No act this turn", "info.stun": "Stopped: loses its act",
      "info.order": "Acts {n}.", "info.calm": "Next to the shepherd: acts last.", "info.comes": "{k} comes in here at the end of the turn",
      "dir.0": "north", "dir.1": "east", "dir.2": "south", "dir.3": "west",
      "fk.ready": "Ready", "fk.moved": "Moved", "fk.done": "Done", "fk.home": "Gone home",
      "sel.pick": "{k}: a green tile to move, an orange one for the {t}", "sel.noTool": "{k}: done for this turn",
      "sel.again": "Tap again to use the {t}", "sel.none": "Tap a farmhand",
      "ev.hit": "-{n}", "ev.field": "-{n}", "ev.flee": "Off!", "ev.home": "Home", "ev.wash": "Washed away", "ev.mend": "+1",
      "ev.bee": "+1", "ev.enter": "{k} comes in", "ev.block": "Kept out", "ev.plant": "Hedge",
      "ev.fire": "Fire!", "ev.douse": "Out", "ev.burnt": "Burnt", "ev.call": "{k}!", "ev.rainout": "The rain puts out the fires",
      "msg.season": "Season {n} of {m} · {f}. Quota: {q} sheaves.", "msg.turn": "Turn {n}: the invaders show their acts",
      "msg.shop": "The harvest is in. Visit the market, then start the next season.",
      "live.end": "Turn {n}. Harvest so far {h} of {q}.",
      "res.harvest": "Harvest", "res.season": "Season {n} of {m}", "res.sheaves": "{n} sheaves", "res.quota": "Quota",
      "res.wish": "Village wish", "res.wishOk": "Granted", "res.wishNo": "Not this time", "res.coins": "Coins earned",
      "res.miss": "The quota was missed. The year ends here.", "res.toShop": "To the market",
      "res.won": "The year is done!", "res.lost": "A lean year", "res.seasons": "Seasons won", "res.total": "Sheaves in all", "res.best": "Most in a season",
      "res.code": "Year code: {seed}", "res.same": "The same year", "res.new": "New year",
      "mk.title": "The market", "mk.coins": "Your coins: {n}", "mk.hp": "+1 Health (now {n})", "mk.mv": "+1 Move (now {n})", "mk.stats": "Health {h} · Move {m}",
      "mk.price": "{n} coins", "mk.buy": "Buy", "mk.owned": "Learned", "mk.max": "Most",
      "mk.ready": "A field a stage ahead next season", "mk.readyN": "{n} of {m} bought", "mk.next": "Next season", "mk.close": "Later",
      "mk.open": "Market", "mk.note": "Coins come from sheaves above the quota and from village wishes.",
      "new.title": "New year", "new.diff": "Difficulty", "new.folk": "Your three folk", "new.pick": "Choose three", "new.seed": "Year code",
      "new.seedHint": "Empty for a new year", "new.start": "Start", "new.cancel": "Cancel",
      "info.close": "Close",
      "stats.title": "Records", "stats.head": "Years · finished · most seasons won", "stats.folk": "Finished years with", "stats.best": "Most sheaves in a season",
      "stats.reset": "Reset records", "stats.close": "Close", "stats.code": "This year's code: {seed}",
      "btn.daily": "Daily season", "daily.label": "Daily",
      "daily.title": "Daily season #{n}", "daily.won": "{n} sheaves, quota met", "daily.lost": "{n} sheaves, quota missed",
      "daily.folk": "Folk", "daily.farm": "Farm", "daily.score": "Score", "daily.scoreNote": "Sheaves, plus {n} for the village wish",
      "daily.streak": "Streak", "daily.best": "Best streak",
      "daily.oneTry": "The Daily season has one try.", "daily.next": "A new one tomorrow.",
      "daily.free": "New year", "daily.share": "Share", "daily.games": "All games",
      "daily.rules": "Daily season: one season on Harsh with today's folk. Reach the quota; the score is the sheaves plus the wish.",
      "daily.leave": "Leave today's season? It counts as your one try.", "daily.leaveYes": "Leave it", "daily.leaveNo": "Keep playing",
      "daily.giveUp": "Start today's season? The year in progress counts as lost.", "daily.go": "Start the season",
      "stats.daily": "Daily season", "stats.dailyRow": "Played · quota met · streak · best score",
      "share.won": "{n} sheaves, quota met", "share.lost": "{n} sheaves, quota missed",
      "last.title": "Last years", "last.won": "Year done", "last.met": "Quota met", "last.missed": "Quota missed", "last.seasons": "{n} of {m} seasons",
      "last.replay": "Replay", "last.replayLabel": "Replay year {seed}",
      "toast.dailyGone": "The Daily season needs the gamekit file: reload orOS",
      "toast.copied": "Copied: paste it into a chat", "toast.shared": "Shared", "toast.copyFail": "Could not copy",
      "confirm.reset": "Reset the records on every device? The year in progress stays.", "confirm.yes": "Reset", "confirm.no": "Cancel",
      "confirm.new": "Start a new year? The year in progress counts as lost.", "confirm.newYes": "New year",
      "toast.save": "Could not save: the browser storage is full", "toast.reset": "Records reset",
      "toast.rewind": "The last turn is undone ({n} rewinds left)",
      "tour.title": "How to play", "tour.next": "Next", "tour.skip": "Skip", "tour.done": "Play",
      "tour.1": "Guard the fields until the harvest. Every field grows a stage each turn; at the end of the season the sheaves must reach the quota.",
      "tour.2": "Each invader shows its act: an arrow to the tile it will hit and a number for the order. Red tiles are in danger.",
      "tour.3": "Tap a farmhand, then a green tile to move and an orange tile to use the tool. The first tap shows what will happen, the second does it.",
      "tour.4": "An act lands on whatever stands on the tile when it comes. Push an invader away and its act moves with it; push it into another and both lose theirs.",
      "tour.5": "Undo and Reset turn are free. When you are happy, End turn: the invaders act, the fields grow and new invaders come in at the edges."
    },
    el: {
      "app.name": "Αγροφύλακας",
      "btn.new": "Νέα χρονιά (N)", "btn.end": "Τέλος γύρου", "btn.endKey": "Τέλος γύρου (E)", "btn.stats": "Αρχείο",
      "btn.undo": "Αναίρεση (Z)", "btn.reset": "Ο γύρος από την αρχή (R)", "btn.rewind": "Γύρνα πίσω τον τελευταίο γύρο",
      "btn.threatOn": "Μόνο οι απειλές (T)", "btn.threatOff": "Δείξε τα όλα (T)",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός", "btn.fastOn": "Γρήγορες κινήσεις: ναι", "btn.fastOff": "Γρήγορες κινήσεις: όχι",
      "view.label": "Το αγρόκτημα, 6 επί 6 τετράγωνα. Τα βελάκια κινούν τον κέρσορα, το Enter διαλέγει χωρικό ή τετράγωνο, το Tab πάει στον επόμενο χωρικό, το Escape ακυρώνει, το Z αναιρεί, το E τελειώνει τον γύρο.",
      "st.turn": "Γύρος {n} από {m}", "st.wx": "Καιρός τώρα: {a}. Τον επόμενο γύρο: {b}", "st.crop": "Σοδειά αν δεν χαθεί τίποτα άλλο: {n} δεμάτια. Στόχος: {q}",
      "st.coins": "{n} νομίσματα", "st.shop": "Το παζάρι",
      "diff.m": "Ήπια", "diff.h": "Σκληρή",
      "diff.m.note": "Χαμηλότερος στόχος, και μία φορά την εποχή γυρνάς πίσω τον τελευταίο γύρο.",
      "diff.h.note": "Ψηλότερος στόχος και περισσότεροι εισβολείς, με +1 Ζωή από τη δεύτερη φάρμα. Χωρίς γυρίσματα.",
      "folk.shepherd": "Βοσκοπούλα", "folk.smith": "Σιδεράς", "folk.hedger": "Φυτουργός",
      "folk.beekeeper": "Μελισσοκόμα", "folk.ferryman": "Βαρκάρης", "folk.scarecrow": "Σκιαχτροποιός",
      "folk.shepherd.note": "Γκλίτσα: τραβά ένα κομμάτι έως 3 τετράγωνα μακριά ένα τετράγωνο πιο κοντά. Τα ζώα δίπλα της παίζουν τελευταία.",
      "folk.smith.note": "Σφυρί: 2 ζημιά σε κομμάτι δίπλα του και σπρώξιμο. Δίπλα στον αχυρώνα τον επισκευάζει.",
      "folk.hedger.note": "Φυτεύει φράχτη σε γυμνό χώμα δίπλα της ή σπρώχνει ένα κομμάτι. Οι φράχτες της δεν σπάνε.",
      "folk.beekeeper.note": "Σμήνος: ένα κομμάτι έως 3 τετράγωνα μακριά, πάνω από όλα, φεύγει 2 τετράγωνα. Τα χωράφια δίπλα της μεγαλώνουν πιο γρήγορα.",
      "folk.ferryman.note": "Κοντάρι: σπρώχνει ένα κομμάτι δίπλα του και αυτό που είναι πίσω του. Μπορεί να σταθεί στη λιμνούλα.",
      "folk.scarecrow.note": "Γογγύλι: 1 ζημιά και σπρώξιμο, έως 4 τετράγωνα μακριά. Τα κοράκια αφήνουν ήσυχα τα χωράφια δίπλα της.",
      "tool.crook": "Γκλίτσα", "tool.hammer": "Σφυρί", "tool.hedge": "Φράχτης", "tool.swarm": "Σμήνος", "tool.pole": "Κοντάρι", "tool.turnip": "Γογγύλι",
      "up.crook2": "Η γκλίτσα τραβά 2 τετράγωνα", "up.crookFar": "Η γκλίτσα φτάνει 5 τετράγωνα",
      "up.hammer3": "Το σφυρί χτυπά 3", "up.hammerPush": "Το σφυρί σπρώχνει 2 τετράγωνα",
      "up.shove2": "Το σπρώξιμο πάει 2 τετράγωνα", "up.shoveHit": "Το σπρώξιμο χτυπά και 1",
      "up.swarmStun": "Το σμήνος σταματά και την κίνηση του εισβολέα", "up.swarmFar": "Το σμήνος φτάνει 5 τετράγωνα",
      "up.poleHit": "Το κοντάρι χτυπά και 1 το καθένα", "up.poleFar": "Το κοντάρι φτάνει 2 τετράγωνα",
      "up.turnip2": "Το γογγύλι χτυπά 2", "up.turnipArc": "Το γογγύλι περνά πάνω από όλα",
      "inv.wolf": "Λύκος", "inv.boar": "Αγριογούρουνο", "inv.crow": "Κοράκι", "inv.mole": "Τυφλοπόντικας", "inv.captain": "Αρχιληστής",
      "inv.wolf.note": "Πάει στον χωρικό με τη λιγότερη Ζωή και δαγκώνει για 1. Αν δεν έχει ποιον να δαγκώσει, ποδοπατά ένα χωράφι.",
      "inv.boar.note": "Ορμά σε ευθεία ώσπου κάτι να το σταματήσει και ποδοπατά κάθε χωράφι που περνά· ό,τι το σταματά παίρνει 2.",
      "inv.crow.note": "Πετά στο πιο ώριμο χωράφι και τρώει ένα στάδιο. Ο άνεμος το μετακινεί ένα τετράγωνο.",
      "inv.mole.note": "Σκάβει κάτω από το πιο κοντινό χωράφι: χάνονται δύο στάδια.",
      "inv.captain.note": "Χτυπά με το ρόπαλο έναν χωρικό για 2 και τον σπρώχνει, ή τον αχυρώνα. Όταν πληγωθεί, σφυρίζει για έναν λύκο σε κάθε γύρο.",
      "inv.fox": "Αλεπού", "inv.thief": "Κλέφτης", "inv.torch": "Δαυλοφόρος", "inv.loud": "Φωνακλάς",
      "inv.fox.note": "Γρήγορη: τρέχει στον αχυρώνα και τον δαγκώνει για 1, ή στο πιο κοντινό χωράφι όταν ο αχυρώνας πέσει.",
      "inv.thief.note": "Πάει στο πιο ώριμο χωράφι και παίρνει όλη τη σοδειά του: χάνονται τρία στάδια.",
      "inv.torch.note": "Βάζει φωτιά στο πιο ώριμο χωράφι ή σε μια θημωνιά. Η φωτιά απλώνει με τον άνεμο.",
      "inv.loud.note": "Μένει μακριά από τους χωρικούς και φωνάζει έναν κλέφτη, που μπαίνει στο τέλος του γύρου. Σταμάτησέ τον ή σπρώξ' τον έξω.",
      "act.bite": "Δάγκωμα", "act.eat": "Τσίμπημα", "act.dig": "Σκάψιμο", "act.tram": "Ποδοπάτημα", "act.club": "Ρόπαλο", "act.charge": "Ορμή",
      "act.raid": "Επιδρομή", "act.steal": "Κλοπή", "act.burn": "Φωτιά", "act.shout": "Φωνή",
      "info.shout": "Μετά: φωνάζει έναν κλέφτη, που μπαίνει στο τέλος του γύρου",
      "tile.d": "Χώμα", "tile.m": "Λάσπη", "tile.f": "Χωράφι", "tile.h": "Φράχτης", "tile.H": "Φράχτης (δεν σπάει)", "tile.p": "Λιμνούλα",
      "tile.s": "Θημωνιά", "tile.b": "Αχυρώνας",
      "tile.d.note": "Γυμνό χώμα. Η φυτουργός μπορεί να φυτέψει εδώ φράχτη. Στη βροχή γίνεται λάσπη: ένα κομμάτι που σπρώχνεται στη λάσπη σταματά εκεί.",
      "tile.f.note": "Μεγαλώνει ένα στάδιο κάθε γύρο ώσπου να ωριμάσει. Ένα χτύπημα το πάει πίσω και δεν μεγαλώνει άλλο αυτή την εποχή.",
      "tile.h.note": "Κλείνει τον δρόμο. Ένα αγριογούρουνο που ορμά τον σπάει με δύο χτυπήματα.",
      "tile.p.note": "Ένας εισβολέας της στεριάς που σπρώχνεται στη λιμνούλα παρασύρεται από το νερό. Μόνο ο βαρκάρης μπορεί να σταθεί μέσα.",
      "tile.s.note": "Κλείνει τον δρόμο. Καίγεται: στην ξηρασία παίρνει φωτιά, εκτός αν στέκεται δίπλα της ένας χωρικός.", "tile.b.note": "Κλείνει τον δρόμο. Ο αρχιληστής, τα αγριογούρουνα και οι αλεπούδες μπορούν να τον χαλάσουν.",
      "tile.fire": "Καίγεται", "tile.fire.note": "Στο τέλος του γύρου η φωτιά καίει: ένα χωράφι χάνει ένα στάδιο, θημωνιές και φράχτες καίγονται, ένα κομμάτι πάνω της παίρνει 1. Μετά απλώνει ένα τετράγωνο με τον άνεμο. Ένας χωρικός που την πατά τη σβήνει· η βροχή σβήνει κάθε φωτιά.",
      "stage.0": "σπαρμένο", "stage.1": "φύτρο", "stage.2": "πράσινο", "stage.3": "ώριμο", "stage.hurt": "χτυπημένο, δεν μεγαλώνει πια",
      "wx.c": "Νηνεμία", "wx.r": "Βροχή: το χώμα γίνεται λάσπη, οι φωτιές σβήνουν", "wx.d": "Ξηρασία: οι θημωνιές παίρνουν φωτιά", "wx.n": "Άνεμος προς τον βορρά", "wx.e": "Άνεμος προς την ανατολή", "wx.s": "Άνεμος προς τον νότο", "wx.w": "Άνεμος προς τη δύση",
      "farm.low": "Ο Κάμπος", "farm.orchard": "Ο Λόφος με τα περιβόλια", "farm.river": "Η Στροφή του ποταμού",
      "wish.star": "Ευχή του χωριού: να μείνει ανέγγιχτο το χωράφι με το αστέρι (+{n} νομίσματα)",
      "wish.barn": "Ευχή του χωριού: να μείνει ακέραιος ο αχυρώνας (+{n} νομίσματα)",
      "wish.drive": "Ευχή του χωριού: διώξε {k} εισβολείς (+{n} νομίσματα)",
      "info.hp": "Ζωή {hp} από {mh}", "info.move": "Κίνηση {n}", "info.next": "Μετά: {a}, στόχος: {b}", "info.nextField": "Μετά: {a} σε χωράφι",
      "info.nextBarn": "Μετά: {a} στον αχυρώνα", "info.charge": "Μετά: ορμή προς τα {d}", "info.idle": "Καμία κίνηση αυτόν τον γύρο", "info.stun": "Σταμάτησε: χάνει την κίνησή του",
      "info.order": "Παίζει {n}ος.", "info.calm": "Δίπλα στη βοσκοπούλα: παίζει τελευταίο.", "info.comes": "{k}: μπαίνει εδώ στο τέλος του γύρου",
      "dir.0": "βόρεια", "dir.1": "ανατολικά", "dir.2": "νότια", "dir.3": "δυτικά",
      "fk.ready": "Έτοιμος", "fk.moved": "Κινήθηκε", "fk.done": "Τελείωσε", "fk.home": "Πήγε σπίτι",
      "sel.pick": "{k}: πράσινο τετράγωνο για κίνηση, πορτοκαλί για {t}", "sel.noTool": "{k}: τελείωσε γι' αυτόν τον γύρο",
      "sel.again": "Πάτα ξανά για {t}", "sel.none": "Πάτα έναν χωρικό",
      "ev.hit": "-{n}", "ev.field": "-{n}", "ev.flee": "Έφυγε!", "ev.home": "Σπίτι", "ev.wash": "Το πήρε το νερό", "ev.mend": "+1",
      "ev.bee": "+1", "ev.enter": "Μπαίνει: {k}", "ev.block": "Έμεινε έξω", "ev.plant": "Φράχτης",
      "ev.fire": "Φωτιά!", "ev.douse": "Έσβησε", "ev.burnt": "Κάηκε", "ev.call": "{k}!", "ev.rainout": "Η βροχή σβήνει τις φωτιές",
      "msg.season": "Εποχή {n} από {m} · {f}. Στόχος: {q} δεμάτια.", "msg.turn": "Γύρος {n}: οι εισβολείς δείχνουν τι θα κάνουν",
      "msg.shop": "Η σοδειά μαζεύτηκε. Πέρασε από το παζάρι και ξεκίνα την επόμενη εποχή.",
      "live.end": "Γύρος {n}. Σοδειά ως τώρα {h} από {q}.",
      "res.harvest": "Σοδειά", "res.season": "Εποχή {n} από {m}", "res.sheaves": "{n} δεμάτια", "res.quota": "Στόχος",
      "res.wish": "Ευχή του χωριού", "res.wishOk": "Έγινε", "res.wishNo": "Όχι αυτή τη φορά", "res.coins": "Νομίσματα",
      "res.miss": "Ο στόχος δεν πιάστηκε. Η χρονιά τελειώνει εδώ.", "res.toShop": "Στο παζάρι",
      "res.won": "Η χρονιά ολοκληρώθηκε!", "res.lost": "Φτωχή χρονιά", "res.seasons": "Εποχές που πέτυχαν", "res.total": "Δεμάτια συνολικά", "res.best": "Τα περισσότερα σε μια εποχή",
      "res.code": "Κωδικός χρονιάς: {seed}", "res.same": "Η ίδια χρονιά", "res.new": "Νέα χρονιά",
      "mk.title": "Το παζάρι", "mk.coins": "Τα νομίσματά σου: {n}", "mk.hp": "+1 Ζωή (τώρα {n})", "mk.mv": "+1 Κίνηση (τώρα {n})", "mk.stats": "Ζωή {h} · Κίνηση {m}",
      "mk.price": "{n} νομίσματα", "mk.buy": "Αγορά", "mk.owned": "Το έμαθε", "mk.max": "Το μέγιστο",
      "mk.ready": "Ένα χωράφι ένα στάδιο μπροστά την επόμενη εποχή", "mk.readyN": "{n} από {m}", "mk.next": "Επόμενη εποχή", "mk.close": "Αργότερα",
      "mk.open": "Παζάρι", "mk.note": "Τα νομίσματα έρχονται από τα δεμάτια πάνω από τον στόχο και από τις ευχές του χωριού.",
      "new.title": "Νέα χρονιά", "new.diff": "Δυσκολία", "new.folk": "Οι τρεις χωρικοί σου", "new.pick": "Διάλεξε τρεις", "new.seed": "Κωδικός χρονιάς",
      "new.seedHint": "Κενό για νέα χρονιά", "new.start": "Ξεκίνα", "new.cancel": "Άκυρο",
      "info.close": "Κλείσιμο",
      "stats.title": "Αρχείο", "stats.head": "Χρονιές · ολοκληρωμένες · οι περισσότερες εποχές", "stats.folk": "Ολοκληρωμένες χρονιές με", "stats.best": "Τα περισσότερα δεμάτια σε μια εποχή",
      "stats.reset": "Μηδένισε το αρχείο", "stats.close": "Κλείσιμο", "stats.code": "Κωδικός αυτής της χρονιάς: {seed}",
      "btn.daily": "Εποχή της ημέρας", "daily.label": "Ημέρας",
      "daily.title": "Εποχή της ημέρας #{n}", "daily.won": "{n} δεμάτια, ο στόχος πιάστηκε", "daily.lost": "{n} δεμάτια, ο στόχος δεν πιάστηκε",
      "daily.folk": "Χωρικοί", "daily.farm": "Φάρμα", "daily.score": "Πόντοι", "daily.scoreNote": "Τα δεμάτια, και {n} για την ευχή του χωριού",
      "daily.streak": "Σερί", "daily.best": "Καλύτερο σερί",
      "daily.oneTry": "Η εποχή της ημέρας παίζεται μία φορά.", "daily.next": "Νέα αύριο.",
      "daily.free": "Νέα χρονιά", "daily.share": "Κοινοποίηση", "daily.games": "Όλα τα παιχνίδια",
      "daily.rules": "Εποχή της ημέρας: μία εποχή στη Σκληρή με τους σημερινούς χωρικούς. Πιάσε τον στόχο· οι πόντοι είναι τα δεμάτια και η ευχή.",
      "daily.leave": "Να αφήσεις τη σημερινή εποχή; Μετρά ως η μία σου προσπάθεια.", "daily.leaveYes": "Άφησέ την", "daily.leaveNo": "Συνέχισε",
      "daily.giveUp": "Να ξεκινήσει η σημερινή εποχή; Η χρονιά που παίζεις μετρά ως χαμένη.", "daily.go": "Ξεκίνα την εποχή",
      "stats.daily": "Εποχή της ημέρας", "stats.dailyRow": "Παιγμένες · στόχοι · σερί · καλύτεροι πόντοι",
      "share.won": "{n} δεμάτια, ο στόχος πιάστηκε", "share.lost": "{n} δεμάτια, ο στόχος δεν πιάστηκε",
      "last.title": "Τελευταίες χρονιές", "last.won": "Ολοκληρώθηκε", "last.met": "Στόχος", "last.missed": "Χωρίς στόχο", "last.seasons": "{n} από {m} εποχές",
      "last.replay": "Ξανά", "last.replayLabel": "Ξανά η χρονιά {seed}",
      "toast.dailyGone": "Η εποχή της ημέρας θέλει το αρχείο gamekit: φόρτωσε ξανά το orOS",
      "toast.copied": "Αντιγράφηκε: επικόλλησέ το σε μια συνομιλία", "toast.shared": "Κοινοποιήθηκε", "toast.copyFail": "Δεν αντιγράφηκε",
      "confirm.reset": "Να μηδενιστεί το αρχείο σε όλες τις συσκευές; Η χρονιά που παίζεις μένει.", "confirm.yes": "Μηδένισε", "confirm.no": "Άκυρο",
      "confirm.new": "Να ξεκινήσει νέα χρονιά; Αυτή που παίζεις μετρά ως χαμένη.", "confirm.newYes": "Νέα χρονιά",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε", "toast.reset": "Το αρχείο μηδενίστηκε",
      "toast.rewind": "Ο τελευταίος γύρος αναιρέθηκε (μένουν {n})",
      "tour.title": "Πώς παίζεται", "tour.next": "Επόμενο", "tour.skip": "Παράλειψη", "tour.done": "Παίξε",
      "tour.1": "Φύλαξε τα χωράφια ώσπου να μαζευτεί η σοδειά. Κάθε χωράφι μεγαλώνει ένα στάδιο σε κάθε γύρο· στο τέλος της εποχής τα δεμάτια πρέπει να φτάσουν τον στόχο.",
      "tour.2": "Κάθε εισβολέας δείχνει τι θα κάνει: ένα βέλος προς το τετράγωνο που θα χτυπήσει κι έναν αριθμό για τη σειρά. Τα κόκκινα τετράγωνα κινδυνεύουν.",
      "tour.3": "Πάτα έναν χωρικό, μετά ένα πράσινο τετράγωνο για να κινηθεί κι ένα πορτοκαλί για το εργαλείο του. Το πρώτο πάτημα δείχνει τι θα γίνει, το δεύτερο το κάνει.",
      "tour.4": "Ένα χτύπημα πέφτει σε ό,τι στέκεται στο τετράγωνο εκείνη την ώρα. Σπρώξε έναν εισβολέα και το χτύπημά του πάει μαζί του· σπρώξ' τον πάνω σε άλλον και χάνουν και οι δύο τη σειρά τους.",
      "tour.5": "Η αναίρεση και ο γύρος από την αρχή είναι δωρεάν. Όταν είσαι έτοιμος, Τέλος γύρου: οι εισβολείς παίζουν, τα χωράφια μεγαλώνουν και νέοι εισβολείς μπαίνουν από τις άκρες."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "fieldwarden", LANG);

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var str = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        str = str.split("{" + k + "}").join(String(params[k]));
      });
    }
    return str;
  }

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // A new year code: 6 letters and digits, easy to read aloud.
  function newSeed() {
    var abc = "abcdefghjkmnpqrstuvwxyz23456789", buf = new Uint32Array(6), s = "";
    crypto.getRandomValues(buf);
    for (var i = 0; i < 6; i++) s += abc.charAt(buf[i] % abc.length);
    return s;
  }
  function cleanSeed(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("fieldwarden.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Synced records ----------
  // data = { ver, br, rows: { <device id>: { b, s: { "<diff>": [years, finished, most seasons won] },
  //                                           hb: most sheaves in a season,
  //                                           c: { <folk>: finished years } } } }
  // Each device only grows its own row, so a per-row max is a join and
  // nothing is double-counted however the devices meet.
  // days (5.79.00, older data has none): one Daily season per calendar
  // day (day 0 = 1 Jan 2026, gamekit/daily.js), one try:
  // { "<day>": { b, w: 1 quota met | 0, h: score (sheaves + the wish
  //   bonus), t: actions, f: [fields sown, sprout, green, ripe at the
  //   end] } }. The newer epoch wins; equal epochs keep the better result
  // (quota met, then the higher score, then fewer actions, then the
  // larger JSON: a total order, so a join). Never counted in rows.
  // last (5.79.00): the last 10 years of every device,
  // [{ a: end time ms, d: m|h|d (d = Daily), p: [3 folk], n: seasons
  //    won, w: 1 finished (Daily: quota met) | 0, s: year code }].
  // Union by a + s, newest first, the first 10: a join; entries older
  // than the reset stamp br drop.
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {}, days: {}, last: [] }; }
  function normDay(v) {
    if (!v || typeof v !== "object" || !isInt(v.b) || v.b < 0 || (v.w !== 0 && v.w !== 1) ||
        !isInt(v.h) || v.h < 0 || v.h > MAX_SCORE || !isInt(v.t) || v.t < 1 || v.t >= BIG) return null;
    if (!Array.isArray(v.f) || v.f.length !== 4 || !v.f.every(function (x) { return isInt(x) && x >= 0 && x <= SIZE; }) ||
        v.f[0] + v.f[1] + v.f[2] + v.f[3] > SIZE) return null;
    return { b: v.b, w: v.w, h: v.h, t: v.t, f: v.f.slice() };
  }
  function dayKeyOk(k) { return /^\d{1,6}$/.test(k) && +k <= MAX_DAY; }
  function dayBetter(x, y) {
    if (x.w !== y.w) return x.w > y.w;
    if (x.h !== y.h) return x.h > y.h;
    if (x.t !== y.t) return x.t < y.t;
    return cmpStr(JSON.stringify(x), JSON.stringify(y)) > 0;
  }
  function normLast(v) {
    if (!v || typeof v !== "object" || !isInt(v.a) || v.a < 0 || ["m", "h", "d"].indexOf(v.d) < 0 || !E.trioOk(v.p) ||
        !isInt(v.n) || v.n < 0 || v.n > MAX_SEASONS || (v.w !== 0 && v.w !== 1) ||
        typeof v.s !== "string" || !/^[a-z0-9]{1,16}$/.test(v.s)) return null;
    return { a: v.a, d: v.d, p: v.p.slice(), n: v.n, w: v.w, s: v.s };
  }
  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, c = {}, any = false;
    DIFFS.forEach(function (k) {
      var v = row.s && row.s[k];
      if (Array.isArray(v) && v.length === 3 && v.every(function (x) { return isInt(x) && x >= 0 && x < BIG; }) && v[1] <= v[0] && v[2] <= MAX_SEASONS) {
        s[k] = [v[0], v[1], v[2]];
        any = true;
      }
    });
    FOLK_IDS.forEach(function (k) {
      var v = row.c && row.c[k];
      if (isInt(v) && v > 0 && v < BIG) c[k] = v;
    });
    var hb = isInt(row.hb) && row.hb > 0 && row.hb <= MAX_SHEAVES ? row.hb : 0;
    return any ? { b: row.b, s: s, hb: hb, c: c } : null;
  }
  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {}, c = {};
    DIFFS.forEach(function (k) {
      var a = x.s[k], b = y.s[k];
      if (!a && !b) return;
      if (!a) { s[k] = b.slice(); return; }
      if (!b) { s[k] = a.slice(); return; }
      s[k] = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
    });
    FOLK_IDS.forEach(function (k) {
      var v = Math.max(x.c[k] || 0, y.c[k] || 0);
      if (v) c[k] = v;
    });
    return { b: x.b, s: s, hb: Math.max(x.hb, y.hb), c: c };
  }
  function mergeFieldwarden(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) ? a.br : 0, isInt(b.br) ? b.br : 0);
    var rows = {};
    [a.rows || {}, b.rows || {}].forEach(function (m) {
      if (!m || typeof m !== "object") return;
      Object.keys(m).forEach(function (id) {
        if (!/^[a-z0-9]{6,32}$/.test(id)) return;
        var r = normRow(m[id]);
        if (!r || r.b < br) return;
        rows[id] = rows[id] ? joinRows(rows[id], r) : r;
      });
    });
    var sorted = {};
    Object.keys(rows).sort(cmpStr).forEach(function (id) {
      var r = rows[id], s = {}, c = {};
      DIFFS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k].slice(); });
      FOLK_IDS.forEach(function (k) { if (r.c[k]) c[k] = r.c[k]; });
      sorted[id] = { b: r.b, s: s, hb: r.hb, c: c };
    });
    var days = {};
    [a.days, b.days].forEach(function (m) {
      if (!m || typeof m !== "object" || Array.isArray(m)) return;
      Object.keys(m).forEach(function (k) {
        if (!dayKeyOk(k)) return;
        var v = normDay(m[k]);
        if (!v || v.b < br) return;
        var cur = days[+k];
        if (!cur || v.b > cur.b || (v.b === cur.b && dayBetter(v, cur))) days[+k] = v;
      });
    });
    var sd = {};
    Object.keys(days).map(Number).sort(function (x, y) { return x - y; }).forEach(function (k) { sd[k] = days[k]; });
    var seen = {}, last = [];
    [a.last, b.last].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (x) {
        var v = normLast(x);
        if (!v || v.a < br) return;
        var key = v.a + ":" + v.s;
        // the same year twice: keep one, by a fixed order
        if (!seen[key] || cmpStr(JSON.stringify(v), JSON.stringify(seen[key])) > 0) seen[key] = v;
      });
    });
    Object.keys(seen).forEach(function (k) { last.push(seen[k]); });
    last.sort(function (x, y) { return y.a - x.a || cmpStr(x.s, y.s); });
    return { ver: DATA_VER, br: br, rows: sorted, days: sd, last: last.slice(0, LAST_N) };
  }
  // [years, finished, most seasons won] for a difficulty, all devices.
  function totals(diff) {
    var out = [0, 0, 0];
    Object.keys(data.rows).forEach(function (id) {
      var v = data.rows[id].s[diff];
      if (v) { out[0] += v[0]; out[1] += v[1]; out[2] = Math.max(out[2], v[2]); }
    });
    return out;
  }
  function bestHarvest() {
    var n = 0;
    Object.keys(data.rows).forEach(function (id) { n = Math.max(n, data.rows[id].hb); });
    return n;
  }
  function folkWins(k) {
    var n = 0;
    Object.keys(data.rows).forEach(function (id) { n += data.rows[id].c[k] || 0; });
    return n;
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object" && !Array.isArray(parsed.rows)) {
          data = mergeFieldwarden(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.warn("[orOS] fieldwarden: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = defaultData();
  }
  var saveFailShown = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function ensureDeviceId() {
    try { deviceId = localStorage.getItem(DEVICE_KEY); } catch (e) {}
    if (!deviceId || !/^[a-z0-9]{6,32}$/.test(deviceId)) {
      deviceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(DEVICE_KEY, deviceId); } catch (e) {}
    }
  }
  // A year ended: finished (every season) or not.
  function count(diff, won, seasons, trio, best) {
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {}, hb: 0, c: {} };
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)), hb: row.hb || 0, c: JSON.parse(JSON.stringify(row.c || {})) };
    var v = row.s[diff] ? row.s[diff].slice() : [0, 0, 0];
    v[0]++;
    if (won) v[1]++;
    v[2] = Math.max(v[2], clamp(seasons, 0, MAX_SEASONS));
    row.s[diff] = v;
    row.hb = Math.max(row.hb, clamp(best, 0, MAX_SHEAVES));
    if (won) trio.forEach(function (k) { row.c[k] = (row.c[k] || 0) + 1; });
    data.rows[deviceId] = row;
    data = mergeFieldwarden(data, data);
    save();
  }
  // Daily results: seasons played, quota met, the current and best
  // streak of days with the quota met, the best score.
  function dailyStats(todayIdx) {
    var on = {}, n = 0, w = 0, best = 0;
    Object.keys(data.days).forEach(function (k) {
      var v = data.days[k];
      n++;
      best = Math.max(best, v.h);
      if (v.w) { on[k] = true; w++; }
    });
    var s2 = DK ? DK.streaks(on, todayIdx) : { cur: 0, best: 0 };
    return { n: n, w: w, cur: s2.cur, best: s2.best, top: best };
  }
  // One try a day: the first result counts.
  function countDaily(day, won, score, acts, f) {
    if (data.days[day] && data.days[day].b >= data.br) return;
    data.days[day] = { b: data.br, w: won ? 1 : 0, h: clamp(score, 0, MAX_SCORE), t: clamp(acts, 1, BIG - 1), f: f };
    data = mergeFieldwarden(data, data);
    save();
  }
  // A year (or a Daily season) ended: into Last years.
  function logYear(won) {
    var v = normLast({ a: Date.now(), d: game.opts.day !== undefined ? "d" : game.opts.diff, p: game.opts.trio,
      n: clamp(st.won, 0, MAX_SEASONS), w: won ? 1 : 0, s: game.opts.seed });
    if (!v) return;
    data.last = [v].concat(data.last || []);
    data = mergeFieldwarden(data, data);
    save();
  }
  // The fields at the end of a season by stage (sown, sprout, green, ripe).
  function stageCounts(s) {
    var f = [0, 0, 0, 0];
    for (var i = 0; i < SIZE; i++) if (s.t[i] === "f") f[s.g[i]]++;
    return f;
  }

  // ---------- 3. Device-local prefs + session ----------
  var prefs = { diff: "m", trio: ["shepherd", "smith", "hedger"], tour: false, fast: false, threat: false };
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (DIFFS.indexOf(p.diff) >= 0) prefs.diff = p.diff;
        if (E.trioOk(p.trio)) prefs.trio = p.trio.slice();
        prefs.tour = p.tour === true;
        prefs.fast = p.fast === true;
        prefs.threat = p.threat === true;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   g: engine state,
  //   opts: { diff, seed, trio: [3 folk], day (the Daily season only) },
  //   ts: the state at the start of this turn (Reset turn),
  //   pt: the state at the start of the turn before (Rewind, Mild) | null,
  //   counted: bool   the year's end is in the records
  // }
  var game = null;
  var undo = [];          // states before each action of this turn (JSON), not kept on close

  function validSession(s) {
    if (!s || typeof s !== "object" || !E.valid(s.g)) return false;
    var o = s.opts;
    if (!o || DIFFS.indexOf(o.diff) < 0 || o.diff !== s.g.diff || typeof o.seed !== "string" || o.seed !== s.g.seed) return false;
    if (!E.trioOk(o.trio) || o.trio.join() !== s.g.folk.map(function (f) { return f.c; }).join()) return false;
    if (o.day !== undefined && (!isInt(o.day) || o.day < 0 || o.day > MAX_DAY || s.g.one !== 1)) return false;
    if (o.day === undefined && s.g.one !== undefined) return false;
    if (!E.valid(s.ts) || s.ts.seed !== s.g.seed) return false;
    if (s.pt !== null && !(E.valid(s.pt) && s.pt.seed === s.g.seed)) return false;
    return true;
  }
  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(s)) {
        var o = { diff: s.opts.diff, seed: s.opts.seed, trio: s.opts.trio.slice() };
        if (s.opts.day !== undefined) o.day = s.opts.day;
        return { g: s.g, opts: o, ts: s.ts, pt: s.pt, counted: s.counted === true };
      }
    } catch (e) {}
    return null;
  }
  var sessionFailShown = false;
  function saveSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(game));
      sessionFailShown = false;
    } catch (e) {
      if (!sessionFailShown) { sessionFailShown = true; showToast(t("toast.save")); }
    }
  }

  // ---------- 4. Year flow ----------
  var st = null;          // = game.g
  var sel = null;         // { u: folk unit id, arm: tile | -1 } the farmhand chosen, and an armed tool target
  var cursor = 14;        // keyboard cursor tile
  var busyUntil = 0;      // input waits while the end of a turn plays

  function inProgressOf(g) { return !!(g && !g.counted && g.g.over < 0 && g.g.acts > 0); }
  function makeGame(opts) {
    var daily = opts.day !== undefined;
    var g = daily ? E.newDaily(opts.seed) : E.newYear(opts.seed, opts.diff, opts.trio, E.FARMS.length);
    var o = { diff: g.diff, seed: opts.seed, trio: g.folk.map(function (f) { return f.c; }) };
    if (daily) o.day = opts.day;
    return { g: g, opts: o, ts: E.clone(g), pt: null, counted: false };
  }
  function setState(g) {
    game.g = g;
    st = g;
  }
  function endYear(won) {
    game.counted = true;
    if (game.opts.day !== undefined) countDaily(game.opts.day, won, won ? E.dailyScore(st) : (st.res ? E.dailyScore(st) : 0), Math.max(1, st.acts), stageCounts(st.s));
    else count(game.opts.diff, won, st.won, game.opts.trio, st.best);
    logYear(won);
  }
  function startGame(opts) {
    // a year under way and left counts as lost
    if (game && inProgressOf(game)) endYear(false);
    game = makeGame(opts);
    st = game.g;
    undo = [];
    sel = null;
    saveSession();
    seasonMsg();
    if (game.opts.day !== undefined) setMsg(t("daily.rules"));
    renderAll();
    live($("msg").textContent);
    maybeTour();
  }
  function setMsg(text) { $("msg").textContent = text || ""; }
  function farmName() { return t("farm." + E.FARMS[st.farm - 1].id); }
  function seasonNo() { return st.one ? 1 : (st.farm - 1) * E.SEASONS + st.sea; }
  function seasonsAll() { return st.one ? 1 : st.end * E.SEASONS; }
  function seasonMsg() {
    setMsg(st.phase === "shop" ? t("msg.shop") : t("msg.season", { n: seasonNo(), m: seasonsAll(), f: farmName(), q: st.s.q }));
  }
  function nameOf(u) { return u.f === 1 ? t("folk." + u.k) : t("inv." + u.k); }
  function selUnit() {
    if (!sel) return null;
    var u = E.unitById(st.s, sel.u);
    return u && u.f === 1 ? u : null;
  }
  function selMsg() {
    var u = selUnit();
    if (!u) { setMsg(t("sel.none")); return; }
    var tool = t("tool." + E.toolOf(st, u.fi).id);
    if (sel.arm >= 0) setMsg(t("sel.again", { t: tool }));
    else if (u.ac) setMsg(t("sel.noTool", { k: nameOf(u) }));
    else setMsg(t("sel.pick", { k: nameOf(u), t: tool }));
  }
  function choose(id) {
    sel = id === null ? null : { u: id, arm: -1 };
    if (sel) selMsg(); else seasonMsg();
    renderActs();
    draw();
  }
  function playable() { return game && st.over < 0 && st.phase === "play" && !st.s.done && Date.now() >= busyUntil; }
  // A move or a tool use (Undo keeps the state before it).
  function doFolkAct(a) {
    if (!playable()) return false;
    var before = JSON.stringify(st), ev = E.act(st, a);
    if (!ev) return false;
    undo.push(before);
    if (undo.length > 40) undo.shift();
    saveSession();
    ev.forEach(function (e, k) { eventFx(e, k * 40); });
    sfx(a.t === "mv" ? "step" : "tool");
    if (sel) {
      sel.arm = -1;
      var u = selUnit();
      if (!u) sel = null;
    }
    if (sel) selMsg(); else seasonMsg();
    renderAll();
    return true;
  }
  function undoAct() {
    if (!playable() || !undo.length) return;
    setState(JSON.parse(undo.pop()));
    if (sel && !selUnit()) sel = null;
    if (sel) sel.arm = -1;
    saveSession();
    if (sel) selMsg(); else seasonMsg();
    renderAll();
  }
  function resetTurn() {
    if (!playable() || !undo.length) return;
    setState(E.clone(game.ts));
    undo = [];
    sel = null;
    saveSession();
    seasonMsg();
    renderAll();
  }
  function canRewind() { return !!(game && game.pt && playable() && st.s.rw > 0 && game.pt.farm === st.farm && game.pt.sea === st.sea); }
  function rewind() {
    if (!canRewind()) return;
    var left = st.s.rw - 1, g = E.clone(game.pt);
    g.s.rw = left;
    setState(g);
    game.ts = E.clone(g);
    game.pt = null;
    undo = [];
    sel = null;
    saveSession();
    showToast(t("toast.rewind", { n: left }));
    seasonMsg();
    renderAll();
  }
  function endTurn() {
    if (!playable()) return;
    var start = game.ts, ev = E.act(st, { t: "end" });
    if (!ev) return;
    undo = [];
    sel = null;
    game.pt = st.s.done ? null : start;
    game.ts = E.clone(st);
    var step = prefs.fast ? 0 : 110;
    ev.forEach(function (e, k) { eventFx(e, k * step); });
    busyUntil = Date.now() + Math.min(1400, ev.length * step);
    sfx(ev.some(function (e) { return e.k === "hit" && e.f === 1; }) ? "hurt" : "end");
    if (ev.some(function (e) { return e.k === "hit" && e.f === 1; })) shake();
    if (st.over >= 0 && !game.counted) endYear(st.over === 1);
    saveSession();
    if (st.s.done) setTimeout(harvestDialog, Math.max(300, busyUntil - Date.now() + 200));
    else {
      setMsg(t("msg.turn", { n: st.s.turn }));
      live(t("live.end", { n: st.s.turn, h: E.projected(st.s), q: st.s.q }));
    }
    renderAll();
  }
  function shopAct(a) {
    var ev = E.act(st, a);
    if (!ev) return false;
    if (a.t === "next") {
      game.ts = E.clone(st);
      game.pt = null;
      undo = [];
      sel = null;
      seasonMsg();
      sfx("season");
    } else sfx("buy");
    saveSession();
    renderAll();
    return true;
  }
  // Floating texts for the events.
  function eventFx(e, delay) {
    if (e.k === "hit") addFx(e.at, t("ev.hit", { n: e.n }), "bad", delay);
    else if (e.k === "field") addFx(e.at, t("ev.field", { n: e.n }), "bad", delay);
    else if (e.k === "flee" || e.k === "off") addFx(e.at, t("ev.flee"), "good", delay);
    else if (e.k === "wash") addFx(e.at, t("ev.wash"), "good", delay);
    else if (e.k === "home") addFx(e.at, t("ev.home"), "bad", delay);
    else if (e.k === "mend" || e.k === "bee") addFx(e.at, t("ev.mend"), "good", delay);
    else if (e.k === "block") addFx(e.at, t("ev.block"), "good", delay);
    else if (e.k === "plant") addFx(e.at, t("ev.plant"), "good", delay);
    else if (e.k === "fire") addFx(e.at, t("ev.fire"), "bad", delay);
    else if (e.k === "burnt") addFx(e.at, t("ev.burnt"), "bad", delay);
    else if (e.k === "douse") addFx(e.at, t("ev.douse"), "good", delay);
    else if (e.k === "call") addFx(e.at, t("ev.call", { k: t("inv." + e.u) }), "bad", delay);
    else if (e.k === "rainout") live(t("ev.rainout"));
  }

  // ---------- 5. Scene ----------
  var canvas, ctx, W = 0, H = 0, DPR = 1;
  var BX = 0, BY = 0, TS = 40;   // board origin and tile size
  var fx = [];
  var colors = {};

  function resize() {
    var main = $("scene"), r = main.getBoundingClientRect();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(200, Math.floor(r.width));
    H = Math.max(160, Math.floor(r.height));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    var b = Math.min(W - 12, H - 12);
    TS = Math.max(24, Math.floor(b / N));
    BX = Math.floor((W - TS * N) / 2);
    // a tall phone screen: the farm at the top, under the status rows
    BY = H > W + 80 ? 6 : Math.floor((H - TS * N) / 2);
    draw();
  }
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--bg", "--text", "--text-dim", "--accent", "--panel-bg", "--border", "--danger",
     "--fw-ground", "--fw-dirt", "--fw-dirt2", "--fw-mud", "--fw-sprout", "--fw-green", "--fw-gold", "--fw-hedge",
     "--fw-pond", "--fw-hay", "--fw-barn", "--fw-folk", "--fw-foe", "--fw-move", "--fw-aim", "--fw-threat"].forEach(function (v) {
      colors[v.replace(/^--/, "")] = cs.getPropertyValue(v).trim() || "#888";
    });
  }
  function tileXY(i) { return { x: BX + (i % N) * TS, y: BY + Math.floor(i / N) * TS }; }
  function center(i) { var p = tileXY(i); return { x: p.x + TS / 2, y: p.y + TS / 2 }; }
  function tileAt(x, y) {
    var cx = Math.floor((x - BX) / TS), cy = Math.floor((y - BY) / TS);
    return cx < 0 || cy < 0 || cx >= N || cy >= N ? -1 : cy * N + cx;
  }
  function addFx(at, text, kind, delay) {
    fx.push({ at: at, text: text, kind: kind, t0: Date.now() + (delay || 0) });
    if (!fxRunning) { fxRunning = true; requestAnimationFrame(fxLoop); }
  }
  var fxRunning = false;
  function fxLoop() {
    var now = Date.now();
    fx = fx.filter(function (f) { return now - f.t0 < 1000; });
    draw();
    if (fx.length) requestAnimationFrame(fxLoop);
    else fxRunning = false;
  }
  var drawPending = false;
  function draw() {
    if (drawPending || !ctx) return;
    drawPending = true;
    requestAnimationFrame(function () { drawPending = false; paint(); });
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Icons are 24 × 24 SVG paths, drawn with Path2D.
  var P = {
    shepherd: "M9 21V8a4 4 0 0 1 8 0v1M5 21h8",
    smith: "M5 19l8-8M10 6l4-3 6 6-3 4zM4 20l2-2",
    hedger: "M12 21V11M12 11c0-4 3-7 8-7 0 5-3 7-8 7zM12 15c0-3-2-6-7-6 0 4 2 6 7 6z",
    beekeeper: "M8 12a4 4 0 0 1 8 0v3a4 4 0 0 1-8 0zM8 13h8M8 16h8M10 8 8 4M14 8l2-4",
    ferryman: "M5 19 19 5M15 5h4v4M3 21c2 0 2-1.5 4-1.5S9 21 11 21",
    scarecrow: "M12 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM4 9h16M12 7v14M8 21l4-5 4 5",
    wolf: "M4 10l3-6 3 4h4l3-4 3 6v4l-8 6-8-6zM10 12h.01M14 12h.01",
    boar: "M3 13c0-4 4-7 9-7s9 3 9 7-4 6-9 6-9-2-9-6zM17 16l3 3M7 16l-3 3M10 11h.01M14 11h.01",
    crow: "M2 9c4-2 7-1 10 4 3-5 6-6 10-4M12 13l-2 5h4z",
    mole: "M4 16c0-5 4-8 8-8s8 3 8 8zM10 12h.01M14 12h.01M12 16v-2",
    captain: "M5 9l7-6 7 6v2H5zM8 11v5a4 4 0 0 0 8 0v-5M10 14h.01M14 14h.01",
    fox: "M4 5l4 5h8l4-5v7l-8 8-8-8zM10 13h.01M14 13h.01M12 16v1",
    thief: "M6 10h12M8 10V8a4 4 0 0 1 8 0v2M7 14h4M13 14h4M9 19h6",
    torch: "M10 21h4l1-9H9zM12 12c-3 0-4-2-4-4 0-3 4-4 4-6 1 2 4 3 4 6 0 2-1 4-4 4z",
    loud: "M4 10v4h3l6 4V6L7 10zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12",
    raid: "M4 18 12 6l8 12M8 18v-4h8v4",
    steal: "M7 8h10l2 12H5zM9 8a3 3 0 0 1 6 0",
    burn: "M12 21c-4 0-6-3-6-6 0-4 4-6 5-11 2 3 3 5 3 7 1-1 2-2 2-3 2 2 2 4 2 7 0 3-2 6-6 6z",
    shout: "M4 10v4h3l6 4V6L7 10zM17 8l3-2M17 12h4M17 16l3 2",
    bite: "M5 9l2.3 4 2.3-4 2.4 4 2.3-4 2.4 4L19 9M5 15h14",
    eat: "M4 12l9-4v8zM13 10l6-2M13 14l6 2",
    dig: "M12 3v10M8 13h8l-1 6H9zM12 3l-2 2M12 3l2 2",
    tram: "M7 4c2 0 3 2 3 4s-1 4-3 4-3-2-3-4 1-4 3-4zM17 12c2 0 3 2 3 4s-1 4-3 4-3-2-3-4 1-4 3-4z",
    club: "M6 19l8-8M14 11a3 3 0 1 1 4-4 3 3 0 0 1-4 4z",
    charge: "M4 12h14M13 6l6 6-6 6",
    star: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.6 6.7 19.4l1.2-6L3.4 9.3l6-.7z",
    sun: "M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5",
    rain: "M7 15a4 4 0 0 1 0-8 5 5 0 0 1 9.5-1A4 4 0 0 1 17 15zM9 18l-1 3M13 18l-1 3M17 18l-1 3",
    wind: "M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h9"
  };
  var PATHS = {};
  function path(name) {
    if (!PATHS[name]) PATHS[name] = new Path2D(P[name]);
    return PATHS[name];
  }
  function icon(name, x, y, size, color, width) {
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(path(name));
    ctx.restore();
  }
  function arrow(x0, y0, x1, y1, color, w) {
    var a = Math.atan2(y1 - y0, x1 - x0), h = Math.max(6, TS * 0.16);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = w || 2.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - Math.cos(a) * h * 0.6, y1 - Math.sin(a) * h * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - Math.cos(a - 0.45) * h, y1 - Math.sin(a - 0.45) * h);
    ctx.lineTo(x1 - Math.cos(a + 0.45) * h, y1 - Math.sin(a + 0.45) * h);
    ctx.closePath();
    ctx.fill();
  }

  // What the screen shows: the state, or (a tool armed) the state after it.
  function viewState() {
    var u = selUnit();
    if (!u || sel.arm < 0) return null;
    var c = E.clone(st);
    if (!E.act(c, { t: "tool", u: u.id, at: sel.arm })) return null;
    return c;
  }
  function paint() {
    if (!ctx || !st) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = colors["fw-ground"];
    ctx.fillRect(0, 0, W, H);
    var pv = viewState(), s = pv ? pv.s : st.s;
    var i;
    for (i = 0; i < SIZE; i++) paintTile(s, i);
    for (i = 0; i < SIZE; i++) if (E.fireAt(s, i)) paintFire(i);
    paintMarks(s);
    if (!st.s.done) paintNext(s);
    if (!st.s.done) paintIntents(s);
    s.u.forEach(function (u) { paintUnit(s, u); });
    if (pv) paintGhosts(st.s, pv.s);
    if (kbUsed && cursor >= 0) {
      var p = tileXY(cursor);
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      rr(p.x + 2, p.y + 2, TS - 4, TS - 4, 6);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    paintFx();
  }
  function paintTile(s, i) {
    var p = tileXY(i), c = s.t[i], g = 1, x0 = p.x + g, y0 = p.y + g, w = TS - 2 * g;
    var isMud = c === "d" && s.wx[s.turn] === "r" && !s.done;
    ctx.fillStyle = isMud ? colors["fw-mud"] : ((i + Math.floor(i / N)) % 2 ? colors["fw-dirt"] : colors["fw-dirt2"]);
    rr(x0, y0, w, w, 4);
    ctx.fill();
    var cx = p.x + TS / 2, cy = p.y + TS / 2;
    if (isMud) {
      ctx.strokeStyle = colors["fw-dirt"];
      ctx.lineWidth = 1.5;
      for (var k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(x0 + w * 0.2, y0 + w * (0.3 + k * 0.2));
        ctx.quadraticCurveTo(cx, y0 + w * (0.22 + k * 0.2), x0 + w * 0.8, y0 + w * (0.3 + k * 0.2));
        ctx.stroke();
      }
    }
    if (c === "f") paintField(s, i, x0, y0, w);
    else if (c === "h" || c === "H") {
      ctx.fillStyle = colors["fw-hedge"];
      var r = w * (c === "h" && s.x[i] < 2 ? 0.32 : 0.4);
      [[-0.18, 0.05], [0.18, 0.05], [0, -0.15]].forEach(function (o) {
        ctx.beginPath();
        ctx.arc(cx + o[0] * w, cy + o[1] * w, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
      });
      if (c === "H") {
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.5;
        rr(x0 + 3, y0 + 3, w - 6, w - 6, 4);
        ctx.stroke();
      }
    } else if (c === "p") {
      ctx.fillStyle = colors["fw-pond"];
      rr(x0 + w * 0.08, y0 + w * 0.12, w * 0.84, w * 0.76, w * 0.3);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0 + w * 0.3, cy);
      ctx.quadraticCurveTo(x0 + w * 0.4, cy - w * 0.06, x0 + w * 0.5, cy);
      ctx.quadraticCurveTo(x0 + w * 0.6, cy + w * 0.06, x0 + w * 0.7, cy);
      ctx.stroke();
    } else if (c === "s") {
      ctx.fillStyle = colors["fw-hay"];
      ctx.beginPath();
      ctx.moveTo(x0 + w * 0.15, y0 + w * 0.82);
      ctx.quadraticCurveTo(cx, y0 + w * 0.0, x0 + w * 0.85, y0 + w * 0.82);
      ctx.closePath();
      ctx.fill();
    } else if (c === "b") {
      ctx.fillStyle = colors["fw-barn"];
      ctx.beginPath();
      ctx.moveTo(x0 + w * 0.14, y0 + w * 0.45);
      ctx.lineTo(cx, y0 + w * 0.14);
      ctx.lineTo(x0 + w * 0.86, y0 + w * 0.45);
      ctx.lineTo(x0 + w * 0.86, y0 + w * 0.86);
      ctx.lineTo(x0 + w * 0.14, y0 + w * 0.86);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = colors["fw-dirt"];
      ctx.fillRect(cx - w * 0.1, y0 + w * 0.6, w * 0.2, w * 0.26);
      pips(cx, y0 + w * 0.96, s.barn, E.BARN_HP, colors["fw-move"]);
    }
  }
  function paintFire(i) {
    var p = tileXY(i), w = TS - 2, x0 = p.x + 1, y0 = p.y + 1;
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = colors["fw-threat"];
    rr(x0, y0, w, w, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    // a flame in the lower left corner (an act's sign stays readable in the middle)
    ctx.save();
    ctx.translate(x0 + w * 0.02, y0 + w * 0.56);
    ctx.scale(w * 0.42 / 24, w * 0.42 / 24);
    ctx.fillStyle = colors["fw-gold"];
    ctx.fill(path("burn"));
    ctx.strokeStyle = colors["fw-threat"];
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke(path("burn"));
    ctx.restore();
  }
  function paintField(s, i, x0, y0, w) {
    var g = s.g[i], hurt = s.x[i] === 1;
    var col = g === 3 ? colors["fw-gold"] : g === 2 ? colors["fw-green"] : colors["fw-sprout"];
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = Math.max(1.5, w / 22);
    ctx.lineCap = "round";
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var x = x0 + w * (0.22 + c * 0.28), y = y0 + w * (0.3 + r * 0.24);
        if (g === 0) {
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          ctx.arc(x, y + w * 0.04, Math.max(1.2, w / 34), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }
        var h = w * (g === 1 ? 0.08 : g === 2 ? 0.15 : 0.18);
        ctx.beginPath();
        ctx.moveTo(x, y + w * 0.08);
        ctx.lineTo(x, y + w * 0.08 - h);
        ctx.stroke();
        if (g === 3) {
          ctx.beginPath();
          ctx.ellipse(x, y + w * 0.08 - h, w * 0.035, w * 0.06, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (hurt) {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      rr(x0, y0, w, w, 4);
      ctx.fill();
      ctx.strokeStyle = colors.danger;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0 + w * 0.08, y0 + w * 0.08); ctx.lineTo(x0 + w * 0.24, y0 + w * 0.24);
      ctx.moveTo(x0 + w * 0.24, y0 + w * 0.08); ctx.lineTo(x0 + w * 0.08, y0 + w * 0.24);
      ctx.stroke();
    }
    if (s.wish.k === "star" && s.wish.i === i) icon("star", x0 + w * 0.82, y0 + w * 0.17, w * 0.26, colors.accent, 2);
  }
  function pips(cx, y, n, m, col) {
    var r = Math.max(2, TS / 22), gap = r * 2.6, x = cx - (m - 1) * gap / 2;
    for (var k = 0; k < m; k++) {
      ctx.fillStyle = k < n ? col : colors.border;
      ctx.beginPath();
      ctx.arc(x + k * gap, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Moves (green), tool targets (orange), and the tiles in danger (red).
  function paintMarks(s) {
    var u = selUnit(), i, p;
    if (u && playable() && sel.arm < 0) {
      E.moves(st, u.id).forEach(function (m) { tint(m, colors["fw-move"], 0.45); });
      E.targets(st, u.id).forEach(function (m) { tint(m, colors["fw-aim"], 0.4); ring(m, colors["fw-aim"]); });
    }
    if (u && sel.arm >= 0) ring(sel.arm, colors["fw-aim"]);
    if (st.s.done) return;
    for (i = 0; i < s.u.length; i++) {
      var v = s.u[i];
      if (v.f !== 0 || !v.it || v.sn) continue;
      if (v.it.a === "charge") {
        var cp = E.chargePath(s, v, v.it.d);
        cp.path.forEach(function (k) { if (s.t[k] === "f") tint(k, colors["fw-threat"], prefs.threat ? 0.45 : 0.25); });
        if (cp.stop >= 0 && (E.unitAt(s, cp.stop) || s.t[cp.stop] === "b")) tint(cp.stop, colors["fw-threat"], prefs.threat ? 0.5 : 0.3);
      } else {
        p = E.intentTile(s, v);
        if (p >= 0) tint(p, colors["fw-threat"], prefs.threat ? 0.5 : 0.3);
      }
    }
  }
  function tint(i, col, a) {
    var p = tileXY(i);
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    rr(p.x + 1, p.y + 1, TS - 2, TS - 2, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  function ring(i, col) {
    var p = tileXY(i);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    rr(p.x + 2.5, p.y + 2.5, TS - 5, TS - 5, 5);
    ctx.stroke();
  }
  function paintNext(s) {
    s.next.forEach(function (e) {
      if (E.unitAt(s, e.at)) return;
      var c = center(e.at);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = colors["fw-foe"];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, TS * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.6;
      icon(e.k, c.x, c.y, TS * 0.42, colors["fw-foe"], 1.8);
      ctx.globalAlpha = 1;
    });
  }
  function paintIntents(s) {
    if (prefs.threat) return;
    var order = E.actOrder(s);
    order.forEach(function (id, n) {
      var u = E.unitById(s, id), a = center(u.at), b;
      if (u.it.a === "shout") {
        icon("shout", a.x + TS * 0.3, a.y - TS * 0.3, TS * 0.34, colors["fw-threat"], 2.4);
        badge(a, n);
        return;
      }
      if (u.it.a === "charge") {
        var cp = E.chargePath(s, u, u.it.d), end = cp.stop >= 0 ? cp.stop : (cp.path.length ? cp.path[cp.path.length - 1] : -1);
        if (end < 0) return;
        b = center(end);
        if (cp.stop >= 0) { b = { x: (center(cp.path.length ? cp.path[cp.path.length - 1] : u.at).x + b.x) / 2, y: (center(cp.path.length ? cp.path[cp.path.length - 1] : u.at).y + b.y) / 2 }; }
      } else {
        var tg = E.intentTile(s, u);
        if (tg < 0) return;
        var c = center(tg);
        b = { x: (a.x + c.x) / 2 + (c.x - a.x) * 0.25, y: (a.y + c.y) / 2 + (c.y - a.y) * 0.25 };
        icon(u.it.a, c.x, c.y, TS * 0.36, colors["fw-threat"], 2.4);
      }
      arrow(a.x + (b.x - a.x) * 0.35, a.y + (b.y - a.y) * 0.35, b.x, b.y, colors["fw-threat"], 3);
      badge(a, n);
    });
  }
  // The order badge
  function badge(a, n) {
    var bx = a.x - TS * 0.32, by = a.y - TS * 0.32, br = Math.max(7, TS * 0.14);
    ctx.fillStyle = colors["fw-threat"];
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "800 " + Math.round(br * 1.25) + "px Nunito, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n + 1), bx, by + 0.5);
  }
  function paintUnit(s, u) {
    var c = center(u.at), r = TS * 0.34, folk = u.f === 1;
    var col = folk ? colors["fw-folk"] : colors["fw-foe"];
    var done = folk && u.ac && u.mo;
    ctx.globalAlpha = done ? 0.6 : 1;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(c.x, c.y - TS * 0.04, r, 0, Math.PI * 2);
    ctx.fill();
    icon(u.k, c.x, c.y - TS * 0.04, r * 1.3, colors.bg, 2.2);
    ctx.globalAlpha = 1;
    if (sel && sel.u === u.id) {
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y - TS * 0.04, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    pips(c.x, c.y + TS * 0.38, u.hp, u.mh, folk ? colors["fw-move"] : colors["fw-foe"]);
    if (u.sn) {
      ctx.fillStyle = colors.text;
      ctx.font = "800 " + Math.round(TS * 0.22) + "px Nunito, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("z", c.x + r, c.y - r);
    }
  }
  // Where the armed tool sends each piece.
  function paintGhosts(a, b) {
    a.u.forEach(function (u) {
      var v = E.unitById(b, u.id), c0 = center(u.at);
      if (!v) {
        ctx.strokeStyle = colors["fw-aim"];
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(c0.x - TS * 0.2, c0.y - TS * 0.2); ctx.lineTo(c0.x + TS * 0.2, c0.y + TS * 0.2);
        ctx.moveTo(c0.x + TS * 0.2, c0.y - TS * 0.2); ctx.lineTo(c0.x - TS * 0.2, c0.y + TS * 0.2);
        ctx.stroke();
        return;
      }
      if (v.at !== u.at) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = u.f === 1 ? colors["fw-folk"] : colors["fw-foe"];
        ctx.beginPath();
        ctx.arc(c0.x, c0.y - TS * 0.04, TS * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        var c1 = center(v.at);
        arrow(c0.x, c0.y, c1.x, c1.y, colors["fw-aim"], 2.5);
      }
    });
  }
  function paintFx() {
    var now = Date.now();
    fx.forEach(function (f) {
      var age = now - f.t0;
      if (age < 0) return;
      var c = center(f.at), k = age / 1000;
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.fillStyle = f.kind === "good" ? colors["fw-move"] : colors.danger;
      ctx.font = "800 " + Math.round(TS * 0.26) + "px Nunito, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(f.text, c.x, c.y - TS * 0.3 - k * TS * 0.4);
      ctx.globalAlpha = 1;
    });
  }
  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }
  function shake() {
    if (reducedMotion() || prefs.fast) return;
    var m = $("scene");
    m.classList.remove("shake");
    void m.offsetWidth;
    m.classList.add("shake");
  }
  function live(msg) {
    var n = $("live");
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 6. Input ----------
  var kbUsed = false;
  function tap(i) {
    if (i < 0 || !st) return;
    if (st.phase === "shop" || st.over >= 0 || st.s.done) { describe(i); return; }
    if (Date.now() < busyUntil) return;
    var s = st.s, here = E.unitAt(s, i), u = selUnit();
    if (u && sel.arm >= 0) {
      if (i === sel.arm) { doFolkAct({ t: "tool", u: u.id, at: i }); return; }
      sel.arm = -1;
    }
    if (u) {
      if (E.targets(st, u.id).indexOf(i) >= 0) {
        sel.arm = i;
        selMsg();
        sfx("aim");
        draw();
        return;
      }
      if (E.moves(st, u.id).indexOf(i) >= 0) { doFolkAct({ t: "mv", u: u.id, to: i }); return; }
    }
    if (here && here.f === 1) { choose(u && u.id === here.id ? null : here.id); return; }
    if (u) { choose(null); }
    describe(i);
  }
  // A short line about a tile (the full text is a long press away).
  function describe(i) {
    var s = st.s, u = E.unitAt(s, i);
    if (u && u.f === 0) { setMsg(nameOf(u) + " · " + intentText(s, u)); draw(); return; }
    if (u) { setMsg(nameOf(u) + " · " + t("info.hp", { hp: u.hp, mh: u.mh })); draw(); return; }
    var e = s.next.filter(function (x) { return x.at === i; })[0];
    setMsg(e ? t("info.comes", { k: t("inv." + e.k) }) : tileName(s, i));
    draw();
  }
  function tileName(s, i) {
    return tileBase(s, i) + (E.fireAt(s, i) ? " · " + t("tile.fire") : "");
  }
  function tileBase(s, i) {
    var c = s.t[i];
    if (c === "f") return t("tile.f") + " · " + t("stage." + s.g[i]) + (s.x[i] ? " · " + t("stage.hurt") : "");
    if (c === "d" && s.wx[s.turn] === "r" && !s.done) return t("tile.m");
    return t("tile." + c);
  }
  function intentText(s, u) {
    if (u.sn) return t("info.stun");
    if (!u.it) return t("info.idle");
    var a = t("act." + u.it.a);
    if (u.it.a === "shout") return t("info.shout");
    if (u.it.a === "charge") return t("info.charge", { d: t("dir." + u.it.d) });
    var tg = E.intentTile(s, u);
    if (tg < 0) return t("info.idle");
    var v = E.unitAt(s, tg);
    if (v) return t("info.next", { a: a, b: nameOf(v) });
    if (s.t[tg] === "b") return t("info.nextBarn", { a: a });
    if (s.t[tg] === "f") return t("info.nextField", { a: a });
    if (s.t[tg] === "s") return t("info.next", { a: a, b: t("tile.s") });
    return t("info.idle");
  }
  function localXY(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function wireInput() {
    var press = null;
    canvas.addEventListener("pointerdown", function (e) {
      var p = localXY(e);
      kbUsed = false;
      press = { x: p.x, y: p.y, long: false };
      press.timer = setTimeout(function () {
        if (!press) return;
        press.long = true;
        var i = tileAt(press.x, press.y);
        if (i >= 0) infoDialog(i);
      }, 520);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!press) return;
      var p = localXY(e);
      if (Math.abs(p.x - press.x) + Math.abs(p.y - press.y) > 14) { clearTimeout(press.timer); press = null; }
    });
    canvas.addEventListener("pointerup", function () {
      if (!press) return;
      clearTimeout(press.timer);
      var p = press;
      press = null;
      if (!p.long) tap(tileAt(p.x, p.y));
    });
    canvas.addEventListener("pointercancel", function () { if (press) clearTimeout(press.timer); press = null; });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }
  function nextFolk() {
    var list = st.s.u.filter(function (u) { return u.f === 1; });
    if (!list.length) return;
    var k = 0;
    if (sel) for (var j = 0; j < list.length; j++) if (list[j].id === sel.u) k = j + 1;
    var u = list[k % list.length];
    cursor = u.at;
    kbUsed = true;
    choose(u.id);
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("dialog[open]") || e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key;
      if (k === "n" || k === "N") { e.preventDefault(); askNew(); return; }
      if (!st) return;
      if (k === "t" || k === "T") { e.preventDefault(); toggleThreat(); return; }
      if (k === "z" || k === "Z") { e.preventDefault(); undoAct(); return; }
      if (k === "r" || k === "R") { e.preventDefault(); resetTurn(); return; }
      if (k === "e" || k === "E") { e.preventDefault(); endTurn(); return; }
      if (k === "Tab" && st.phase === "play" && !st.s.done) { e.preventDefault(); nextFolk(); return; }
      var d = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 }[k];
      if (d !== undefined) {
        e.preventDefault();
        kbUsed = true;
        var nx = E.step(cursor, d);
        if (nx >= 0) cursor = nx;
        describe(cursor);
        return;
      }
      if (k === "Enter" || k === " ") {
        if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
        e.preventDefault();
        kbUsed = true;
        tap(cursor);
        return;
      }
      if (k === "Escape" && sel) { e.preventDefault(); choose(null); }
    });
  }
  function toggleThreat() {
    prefs.threat = !prefs.threat;
    savePrefs();
    paintThreatBtn();
    draw();
  }

  // ---------- 7. Panels ----------
  function renderAll() {
    renderStatus();
    renderActs();
    renderTools();
    draw();
  }
  function renderStatus() {
    if (!st) return;
    var s = st.s;
    var turn = $("s-turn");
    turn.querySelector(".v").textContent = st.phase === "shop" ? t("st.shop") : s.turn + "/" + E.T;
    turn.title = st.phase === "shop" ? t("st.shop") : t("st.turn", { n: s.turn, m: E.T });
    var wx = $("s-wx"), now = s.wx[s.turn], nx = s.turn < E.T ? s.wx[s.turn + 1] : null;
    wx.querySelector(".ic").innerHTML = wxIcon(now);
    wx.querySelector(".v").textContent = "";
    wx.querySelector(".nx").innerHTML = nx ? "→" + wxIcon(nx) : "";
    wx.querySelector(".nx").style.display = nx ? "flex" : "none";
    wx.title = t("st.wx", { a: t("wx." + now), b: nx ? t("wx." + nx) : "–" });
    wx.setAttribute("aria-label", wx.title);
    var crop = $("s-crop"), h = s.done ? s.h : E.projected(s);
    var v = crop.querySelector(".v");
    v.textContent = h + "/" + s.q;
    v.className = "v " + (h >= s.q ? "ok" : "low");
    crop.title = t("st.crop", { n: h, q: s.q });
    crop.setAttribute("aria-label", crop.title);
    var co = $("s-coins");
    co.hidden = st.one === 1;   // a Daily season has no market
    co.querySelector(".v").textContent = String(st.coins);
    co.title = t("st.coins", { n: st.coins });
    co.setAttribute("aria-label", co.title);
  }
  function wxIcon(w) {
    if (w === "r") return UI_ICONS.rain;
    if (w === "d") return UI_ICONS.drought;
    if (w === "c") return UI_ICONS.sun;
    var rot = { n: -90, e: 0, s: 90, w: 180 }[w];
    return UI_ICONS.wind.replace("<svg ", '<svg style="transform:rotate(' + rot + 'deg)" ');
  }
  function renderTools() {
    var play = !!(st && st.phase === "play" && st.over < 0 && !st.s.done);
    $("end-btn").disabled = !play;
    $("undo-btn").disabled = !play || !undo.length;
    $("reset-btn").disabled = !play || !undo.length;
    var rw = $("rewind-btn");
    rw.hidden = !(st && st.diff === "m");
    rw.disabled = !canRewind();
    var db = $("daily-btn");
    db.hidden = !DK;
    db.classList.toggle("due", !!DK && !data.days[today()]);
    db.classList.toggle("on", !!(game && game.opts.day !== undefined && !game.counted));
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function renderActs() {
    var bar = $("acts");
    bar.innerHTML = "";
    if (!st) return;
    if (st.phase === "shop" && st.over < 0) {
      var mk = el("button", "act");
      mk.type = "button";
      mk.appendChild(el("span", "nm", t("mk.open")));
      mk.appendChild(el("span", "cost", t("st.coins", { n: st.coins })));
      mk.addEventListener("click", shopDialog);
      bar.appendChild(mk);
      var nx = el("button", "act");
      nx.type = "button";
      nx.appendChild(el("span", "nm", t("mk.next")));
      nx.addEventListener("click", function () { shopAct({ t: "next" }); });
      bar.appendChild(nx);
      return;
    }
    st.folk.forEach(function (f, fi) {
      var u = E.folkUnit(st.s, fi);
      var b = el("button", "act" + (u ? "" : " home"));
      b.type = "button";
      b.appendChild(el("span", "nm", t("folk." + f.c)));
      var state = !u ? t("fk.home") : u.ac ? t("fk.done") : u.mo ? t("fk.moved") : t("fk.ready");
      b.appendChild(el("span", "cost", state));
      var pp = el("span", "pips");
      for (var k = 0; k < (u ? u.mh : f.mh); k++) pp.appendChild(el("i", u && k < u.hp ? "" : "off"));
      b.appendChild(pp);
      b.disabled = !u || st.s.done || st.over >= 0;
      b.setAttribute("aria-pressed", sel && u && sel.u === u.id ? "true" : "false");
      b.title = t("folk." + f.c) + " · " + (u ? t("info.hp", { hp: u.hp, mh: u.mh }) : t("fk.home")) + " · " + state;
      b.addEventListener("click", function () {
        if (!u) return;
        cursor = u.at;
        choose(sel && sel.u === u.id ? null : u.id);
      });
      bar.appendChild(b);
    });
  }

  // ---------- 8. Dialogs ----------
  function makeDialog(id, cls) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg" + (cls ? " " + cls : "");
    dlg.addEventListener("click", function (e) { if (e.target === dlg && !dlg.hasAttribute("data-modal")) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }
  function row(k, v) {
    var r = el("div", "dlg-row");
    r.appendChild(el("span", "", k));
    r.appendChild(el("strong", "", v));
    return r;
  }
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function segField(label, values, cur, nameKey, onPick) {
    var wrap = el("div", "dlg-field");
    wrap.appendChild(el("div", "dlg-label", label));
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", label);
    values.forEach(function (v) {
      var b = el("button", "seg-btn" + (v === cur ? " active" : ""), t(nameKey + v));
      b.type = "button";
      b.setAttribute("aria-pressed", v === cur ? "true" : "false");
      b.addEventListener("click", function () {
        [].forEach.call(seg.children, function (x) { x.classList.remove("active"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("active");
        b.setAttribute("aria-pressed", "true");
        onPick(v);
      });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    return wrap;
  }
  function show(dlg, focus) {
    document.body.appendChild(dlg);
    dlg.showModal();
    if (focus) focus.focus();
  }

  function askNew() {
    cancelTourWait();
    if (game && game.opts.day !== undefined && inProgressOf(game)) confirmDialog(t("daily.leave"), function () { leaveDaily(); newDialog(); }, t("daily.leaveYes"), t("daily.leaveNo"));
    else if (game && inProgressOf(game)) confirmDialog(t("confirm.new"), newDialog, t("confirm.newYes"));
    else newDialog();
  }
  function newDialog() {
    var o = { diff: prefs.diff, trio: prefs.trio.slice() };
    var dlg = makeDialog("fw-new");
    dlg.appendChild(el("div", "dlg-title", t("new.title")));
    var dnote = el("div", "dlg-note", t("diff." + o.diff + ".note"));
    dlg.appendChild(segField(t("new.diff"), DIFFS, o.diff, "diff.", function (v) { o.diff = v; dnote.textContent = t("diff." + v + ".note"); }));
    dlg.appendChild(dnote);
    dlg.appendChild(el("div", "dlg-sub", t("new.folk") + " · " + t("new.pick")));
    var grid = el("div", "pc-grid"), start;
    function paintPick() {
      [].forEach.call(grid.children, function (b) { b.setAttribute("aria-pressed", o.trio.indexOf(b.getAttribute("data-k")) >= 0 ? "true" : "false"); });
      if (start) start.disabled = o.trio.length !== 3;
    }
    FOLK_IDS.forEach(function (k) {
      var b = el("button", "pc-btn");
      b.type = "button";
      b.setAttribute("data-k", k);
      b.appendChild(el("span", "nm", t("folk." + k)));
      b.appendChild(el("span", "fx", t("folk." + k + ".note")));
      b.addEventListener("click", function () {
        var at = o.trio.indexOf(k);
        if (at >= 0) o.trio.splice(at, 1);
        else if (o.trio.length < 3) o.trio.push(k);
        paintPick();
      });
      grid.appendChild(b);
    });
    dlg.appendChild(grid);
    var f = el("div", "dlg-field");
    f.appendChild(el("label", "dlg-label", t("new.seed")));
    var inp = el("input", "dlg-input");
    inp.type = "text";
    inp.maxLength = 16;
    inp.placeholder = t("new.seedHint");
    inp.setAttribute("aria-label", t("new.seed"));
    inp.autocomplete = "off";
    inp.spellcheck = false;
    f.appendChild(inp);
    dlg.appendChild(f);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("new.cancel"), "", function () { dlg.close(); }));
    start = button(t("new.start"), "primary", function () {
      if (!E.trioOk(o.trio)) return;
      prefs.diff = o.diff;
      prefs.trio = o.trio.slice();
      savePrefs();
      dlg.close();
      startGame({ diff: o.diff, seed: cleanSeed(inp.value) || newSeed(), trio: o.trio });
    });
    acts.appendChild(start);
    dlg.appendChild(acts);
    paintPick();
    show(dlg, start);
  }
  function infoDialog(i) {
    if (!st) return;
    var s = st.s, u = E.unitAt(s, i), dlg = makeDialog("fw-info");
    if (u) {
      dlg.appendChild(el("div", "dlg-title", nameOf(u)));
      dlg.appendChild(row(t("info.hp", { hp: u.hp, mh: u.mh }), ""));
      if (u.f === 1) {
        var f = st.folk[u.fi], tl = E.toolOf(st, u.fi);
        dlg.appendChild(row(t("info.move", { n: f.mv }), t("tool." + tl.id)));
        dlg.appendChild(el("div", "dlg-msg", t("folk." + u.k + ".note")));
        E.FOLK[u.k].ups.forEach(function (id, n) { if (f.u[n]) dlg.appendChild(el("div", "dlg-note", "✓ " + t("up." + id))); });
      } else {
        dlg.appendChild(el("div", "dlg-msg", t("inv." + u.k + ".note")));
        var order = E.actOrder(s).indexOf(u.id);
        var line = intentText(s, u) + (order >= 0 ? " · " + t("info.order", { n: order + 1 }) : "");
        dlg.appendChild(el("div", "dlg-note", line));
      }
    }
    dlg.appendChild(el("div", u ? "dlg-sub" : "dlg-title", tileName(s, i)));
    var c = s.t[i] === "d" && s.wx[s.turn] === "r" ? "d" : s.t[i];
    dlg.appendChild(el("div", "dlg-note", t("tile." + (c === "H" ? "h" : c) + ".note")));
    if (E.fireAt(s, i)) dlg.appendChild(el("div", "dlg-note", t("tile.fire.note")));
    var e = s.next.filter(function (x) { return x.at === i; })[0];
    if (e) dlg.appendChild(el("div", "dlg-note", t("info.comes", { k: t("inv." + e.k) })));
    var acts = el("div", "dlg-actions");
    var close = button(t("info.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    show(dlg, close);
  }
  function wishText(s) {
    return t("wish." + s.wish.k, { n: E.WISH_BONUS, k: E.DRIVE_N });
  }
  function harvestDialog() {
    if (!st || !st.s.done || !st.res || document.querySelector("dialog[open]")) return;
    var r = st.res, won = r.h >= r.q;
    var dlg = makeDialog("fw-harvest");
    dlg.setAttribute("data-modal", "1");
    dlg.appendChild(el("div", "dlg-title", t("res.harvest") + " · " + t("res.season", { n: seasonNo(), m: seasonsAll() })));
    dlg.appendChild(el("div", "dlg-hero" + (won ? "" : " lost"), t("res.sheaves", { n: r.h })));
    dlg.appendChild(row(t("res.quota"), String(r.q)));
    dlg.appendChild(el("div", "dlg-note", wishText(st.s)));
    var w = el("div", r.w ? "wish-ok" : "wish-no", r.w ? t("res.wishOk") : t("res.wishNo"));
    dlg.appendChild(w);
    if (game.opts.day !== undefined) dlg.appendChild(row(t("daily.score"), String(E.dailyScore(st))));
    else if (won) dlg.appendChild(row(t("res.coins"), "+" + (r.h - r.q + (r.w ? E.WISH_BONUS : 0))));
    else dlg.appendChild(el("div", "dlg-msg", t("res.miss")));
    var acts = el("div", "dlg-actions");
    var go = button(st.over >= 0 ? t("info.close") : t("res.toShop"), "primary", function () {
      dlg.close();
      if (game.opts.day !== undefined) setTimeout(function () { dailyDialog(game.opts.day); }, 0);
      else if (st.over >= 0) setTimeout(resultDialog, 0);
      else setTimeout(shopDialog, 0);
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); });
    sfx(won ? "win" : "end");
    show(dlg, go);
  }
  function shopDialog() {
    if (!st || st.phase !== "shop" || st.over >= 0) return;
    var dlg = makeDialog("fw-shop");
    function build() {
      dlg.innerHTML = "";
      dlg.appendChild(el("div", "dlg-title", t("mk.title")));
      dlg.appendChild(el("div", "coins-line", t("mk.coins", { n: st.coins })));
      dlg.appendChild(el("div", "dlg-note", t("mk.note")));
      var list = el("div", "dlg-scroll");
      st.folk.forEach(function (f, fi) {
        var card = el("div", "hero-card");
        var hd = el("div", "hd");
        hd.appendChild(el("b", "", t("folk." + f.c)));
        hd.appendChild(el("span", "", t("mk.stats", { h: f.mh, m: f.mv })));
        card.appendChild(hd);
        card.appendChild(shopRow(t("mk.hp", { n: f.mh }), t("mk.price", { n: E.COST.hp }), { t: "buy", k: "hp", f: fi }, f.mh >= E.MAX_HP ? t("mk.max") : ""));
        card.appendChild(shopRow(t("mk.mv", { n: f.mv }), t("mk.price", { n: E.COST.mv }), { t: "buy", k: "mv", f: fi }, f.mv >= E.MAX_MV ? t("mk.max") : ""));
        E.FOLK[f.c].ups.forEach(function (id, n) {
          card.appendChild(shopRow(t("up." + id), t("mk.price", { n: E.COST.up }), { t: "buy", k: "up", f: fi, n: n }, f.u[n] ? t("mk.owned") : ""));
        });
        list.appendChild(card);
      });
      list.appendChild(shopRow(t("mk.ready"), t("mk.price", { n: E.COST.ready }) + " · " + t("mk.readyN", { n: st.ready, m: E.MAX_READY }), { t: "buy", k: "ready" }, st.ready >= E.MAX_READY ? t("mk.max") : ""));
      dlg.appendChild(list);
      var acts = el("div", "dlg-actions");
      acts.appendChild(button(t("mk.close"), "", function () { dlg.close(); }));
      var nx = button(t("mk.next"), "primary", function () { dlg.close(); shopAct({ t: "next" }); });
      acts.appendChild(nx);
      dlg.appendChild(acts);
      return nx;
    }
    function shopRow(name, price, a, done) {
      var r = el("div", "sh-row"), tx = el("div", "sh-tx");
      tx.appendChild(el("div", "nm", name));
      tx.appendChild(el("div", "fx", price));
      r.appendChild(tx);
      var b = button(done || t("mk.buy"), done ? "owned" : "", function () {
        if (shopAct(a)) { var f = build(); f.focus(); }
      });
      b.disabled = !!done || !E.shopOk(st, a);
      r.appendChild(b);
      return r;
    }
    var focus = build();
    show(dlg, focus);
  }
  function resultDialog() {
    if (!game || st.over < 0 || document.querySelector("dialog[open]")) return;
    if (game.opts.day !== undefined) { dailyDialog(game.opts.day); return; }
    var dlg = makeDialog("fw-result"), won = st.over === 1;
    dlg.appendChild(el("div", "dlg-title", t("app.name") + " · " + t("diff." + game.opts.diff)));
    dlg.appendChild(el("div", "dlg-hero" + (won ? "" : " lost"), won ? t("res.won") : t("res.lost")));
    dlg.appendChild(row(t("res.seasons"), st.won + "/" + seasonsAll()));
    dlg.appendChild(row(t("res.total"), String(st.total)));
    dlg.appendChild(row(t("res.best"), String(st.best)));
    dlg.appendChild(el("div", "dlg-note", t("res.code", { seed: game.opts.seed })));
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("res.same"), "", function () { dlg.close(); startGame({ diff: game.opts.diff, seed: game.opts.seed, trio: game.opts.trio }); }));
    var again = button(t("res.new"), "primary", function () { dlg.close(); newDialog(); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    show(dlg, again);
  }
  function statsDialog() {
    var dlg = makeDialog("fw-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    DIFFS.forEach(function (m) {
      var v = totals(m);
      if (v[0]) empty = false;
      dlg.appendChild(row(t("diff." + m), v[0] + " · " + v[1] + " · " + v[2]));
    });
    dlg.appendChild(row(t("stats.best"), String(bestHarvest())));
    dlg.appendChild(el("div", "dlg-sub", t("stats.folk")));
    FOLK_IDS.forEach(function (k) { dlg.appendChild(row(t("folk." + k), String(folkWins(k)))); });
    if (DK) {
      var ds = dailyStats(today());
      if (ds.n) empty = false;
      dlg.appendChild(el("div", "dlg-sub", t("stats.daily") + " · " + t("stats.dailyRow")));
      dlg.appendChild(row(t("daily.label"), ds.n ? ds.n + " · " + ds.w + " · " + ds.cur + " · " + ds.top : "–"));
    }
    if ((data.last || []).length) empty = false;
    lastYears(dlg);
    if (game) dlg.appendChild(el("div", "dlg-note", t("stats.code", { seed: game.opts.seed })));
    var acts = el("div", "dlg-actions");
    var reset = button(t("stats.reset"), "danger", function () {
      dlg.close();
      confirmDialog(t("confirm.reset"), resetRecords);
    });
    reset.disabled = empty;
    acts.appendChild(reset);
    var close = button(t("stats.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    show(dlg, close);
  }
  function confirmDialog(msg, onYes, yesLabel, noLabel) {
    var dlg = makeDialog("fw-confirm");
    dlg.appendChild(el("div", "dlg-msg", msg));
    var acts = el("div", "dlg-actions");
    var no = button(noLabel || t("confirm.no"), "", function () { dlg.close(); });
    acts.appendChild(no);
    acts.appendChild(button(yesLabel || t("confirm.yes"), "danger", function () { dlg.close(); setTimeout(onYes, 0); }));
    dlg.appendChild(acts);
    show(dlg, no);
  }
  function lastYears(dlg) {
    var list = data.last || [];
    if (!list.length) return;
    dlg.appendChild(el("div", "dlg-sub", t("last.title")));
    var box = el("div", "lr-list");
    list.forEach(function (v) {
      var r = el("div", "lr-row");
      var what = v.d === "d" ? t(v.w ? "last.met" : "last.missed") : (v.w ? t("last.won") : t("last.seasons", { n: v.n, m: MAX_SEASONS }));
      var tx = el("div", "lr-tx");
      tx.appendChild(el("div", "nm", (v.d === "d" ? t("daily.label") : t("diff." + v.d)) + " · " + what));
      tx.appendChild(el("div", "fx", v.p.map(function (c) { return t("folk." + c); }).join(", ") + " · " +
        (DK ? DK.dateLabel(DK.dayIndex(new Date(v.a)), LANG) + " · " : "") + v.s));
      r.appendChild(tx);
      // a Daily season replays as a whole year on Harsh with its folk
      var b = button(t("last.replay"), "", function () {
        dlg.close();
        var go = function () { startGame({ diff: v.d === "d" ? "h" : v.d, seed: v.s, trio: v.p }); };
        if (game && game.opts.day !== undefined && inProgressOf(game)) confirmDialog(t("daily.leave"), go, t("daily.leaveYes"), t("daily.leaveNo"));
        else if (game && inProgressOf(game)) confirmDialog(t("confirm.new"), go, t("confirm.newYes"));
        else go();
      });
      b.setAttribute("aria-label", t("last.replayLabel", { seed: v.s }));
      r.appendChild(b);
      box.appendChild(r);
    });
    dlg.appendChild(box);
  }

  // ---------- Daily season ----------
  // One season on Harsh: the farm, the season and the three folk come
  // from the seed "fw" + the date, the same for everyone that day; one try.
  function today() { return DK ? DK.today() : 0; }
  function dailyOpts(day) {
    return { seed: cleanSeed(DK.seedOf("fw", day)), day: day };
  }
  // A Daily season left before its end counts as a missed quota.
  function leaveDaily() {
    if (game && game.opts.day !== undefined && inProgressOf(game)) {
      endYear(false);
      saveSession();
      renderAll();
    }
  }
  // The Daily button: today's result when it is played (here or on
  // another device), else today's season (resumed when it is open).
  function openDaily() {
    if (!DK) { showToast(t("toast.dailyGone")); return; }
    var d = today();
    if (data.days[d]) { dailyDialog(d); return; }
    if (game && game.opts.day === d && !game.counted) return;
    var go = function () { startGame(dailyOpts(d)); };
    if (game && inProgressOf(game)) confirmDialog(t("daily.giveUp"), go, t("daily.go"), t("daily.leaveNo"));
    else go();
  }
  function dailyDialog(day) {
    var r = data.days[day];
    if (!r || !DK || document.querySelector("dialog[open]")) return;
    var s2 = dailyStats(today()), info = E.dailyOf(cleanSeed(DK.seedOf("fw", day)));
    var dlg = makeDialog("fw-daily");
    dlg.appendChild(el("div", "dlg-title", t("daily.title", { n: day + 1 }) + " · " + DK.dateLabel(day, LANG)));
    dlg.appendChild(el("div", "dlg-hero" + (r.w ? "" : " lost"), t(r.w ? "daily.won" : "daily.lost", { n: r.h })));
    dlg.appendChild(el("div", "dlg-note", t("daily.scoreNote", { n: E.WISH_BONUS })));
    dlg.appendChild(row(t("daily.farm"), t("farm." + E.FARMS[info.farm - 1].id) + " · " + t("res.season", { n: info.sea, m: E.SEASONS })));
    dlg.appendChild(row(t("daily.folk"), info.trio.map(function (c) { return t("folk." + c); }).join(", ")));
    dlg.appendChild(row(t("daily.streak"), String(s2.cur)));
    dlg.appendChild(row(t("daily.best"), String(s2.best)));
    if (day === today()) dlg.appendChild(el("div", "dlg-note", t("daily.oneTry") + " " + t("daily.next")));
    var acts = el("div", "dlg-actions wrap");
    hubLink(acts, dlg);
    acts.appendChild(button(t("daily.share"), "", function () { shareDaily(day); }));
    var free = button(t("daily.free"), "primary", function () { dlg.close(); newDialog(); });
    acts.appendChild(free);
    dlg.appendChild(acts);
    show(dlg, free);
  }
  // Spoiler-free: one square per field by its stage at the end (ripe,
  // green, the rest), the score and whether the quota was met.
  function shareDaily(day) {
    var r = data.days[day];
    if (!r || !DK) return;
    var sq = "", k;
    for (k = 0; k < r.f[3]; k++) sq += "🟨";
    for (k = 0; k < r.f[2]; k++) sq += "🟩";
    for (k = 0; k < r.f[1] + r.f[0]; k++) sq += "🟫";
    var text = DK.shareText({ game: t("app.name"), label: t("daily.label"), day: day, grid: [sq],
      line: (r.w ? "🌾 " : "🥀 ") + t(r.w ? "share.won" : "share.lost", { n: r.h }) });
    DK.share(text, "orOS " + t("app.name")).then(function (how) {
      if (how === "copied") showToast(t("toast.copied"));
      else if (how === "shared") live(t("toast.shared"));
      else if (how === "failed") showToast(t("toast.copyFail"));
    });
  }
  // "All games" (the Game Center), only when it is installed.
  function hubLink(acts, dlg) {
    if (!DK || !DK.hasHub()) return;
    acts.appendChild(button(t("daily.games"), "", function () { dlg.close(); DK.openHub("fieldwarden"); }));
  }

  function resetRecords() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeFieldwarden(data, data);
    save();
    showToast(t("toast.reset"));
  }

  var TOUR_N = 5;
  var tourTimer = null;
  function cancelTourWait() { if (tourTimer) { clearTimeout(tourTimer); tourTimer = null; } }
  function maybeTour() {
    if (prefs.tour || tourTimer || document.querySelector("dialog[open]")) return;
    tourTimer = setTimeout(function () { tourTimer = null; tourDialog(1); }, 400);
  }
  function tourDialog(n) {
    if (document.querySelector("dialog[open]")) return;
    var dlg = makeDialog("fw-tour");
    dlg.appendChild(el("div", "dlg-title", t("tour.title") + " · " + n + "/" + TOUR_N));
    dlg.appendChild(el("div", "dlg-msg", t("tour." + n)));
    var acts = el("div", "dlg-actions");
    function seen() { prefs.tour = true; savePrefs(); }
    if (n < TOUR_N) acts.appendChild(button(t("tour.skip"), "", function () { seen(); dlg.close(); }));
    var next = button(t(n < TOUR_N ? "tour.next" : "tour.done"), "primary", function () {
      dlg.close();
      if (n < TOUR_N) setTimeout(function () { tourDialog(n + 1); }, 0);
      else seen();
    });
    acts.appendChild(next);
    dlg.appendChild(acts);
    dlg.addEventListener("cancel", seen);
    show(dlg, next);
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "fieldwarden", title: String(text) })) return;
    } catch (e) {}
    localToast(text);
  }
  var toastTimer = null;
  function localToast(text) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3500);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }

  // ---------- 10. Sound ----------
  var audio = null;
  function sfxOn() {
    try { return localStorage.getItem(SFX_KEY) === "1"; } catch (e) { return false; }
  }
  function tone(freq, start, dur, type, vol) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    var t0 = audio.currentTime + start;
    g.gain.setValueAtTime(vol || 0.16, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  var HAPTIC = { tool: "tick", hurt: "bad", end: "tick", buy: "tick", season: "good", win: "good" };
  function sfx(kind) {
    if (window.orosHaptics && HAPTIC[kind]) window.orosHaptics.cue(HAPTIC[kind]);
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (kind === "step") tone(330, 0, 0.05, "triangle", 0.08);
      else if (kind === "aim") tone(587, 0, 0.05, "sine", 0.06);
      else if (kind === "tool") { tone(220, 0, 0.06, "square", 0.07); tone(294, 0.05, 0.08, "triangle", 0.09); }
      else if (kind === "hurt") tone(140, 0, 0.16, "sawtooth", 0.08);
      else if (kind === "end") { tone(262, 0, 0.1, "triangle", 0.08); tone(196, 0.08, 0.14, "triangle", 0.08); }
      else if (kind === "buy") { tone(1047, 0, 0.05, "sine", 0.08); tone(1319, 0.04, 0.07, "sine", 0.07); }
      else if (kind === "season") [392, 523, 659].forEach(function (f, k) { tone(f, k * 0.09, 0.16, "triangle", 0.09); });
      else if (kind === "win") [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Icons (R9: icon buttons ship empty, filled here) ----------
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var UI_ICONS = {
    new:    SVG + '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    fast:   SVG + '<path d="M4 6l7 6-7 6zM13 6l7 6-7 6z"/></svg>',
    threat: SVG + '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></svg>',
    undo:   SVG + '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    reset:  SVG + '<path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/></svg>',
    rewind: SVG + '<path d="M11 6 4 12l7 6zM20 6l-7 6 7 6z"/></svg>',
    stats:  SVG + '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    turn:   SVG + '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    crop:   SVG + '<path d="M12 21V9M12 9c-3 0-5-2-5-5 3 0 5 2 5 5zM12 9c3 0 5-2 5-5-3 0-5 2-5 5zM12 15c-3 0-5-2-5-5 3 0 5 2 5 5zM12 15c3 0 5-2 5-5-3 0-5 2-5 5z"/></svg>',
    coins:  SVG + '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5h4a1.5 1.5 0 0 1 0 3h-3"/></svg>',
    sun:    SVG + '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></svg>',
    rain:   SVG + '<path d="M7 15a4 4 0 0 1 0-8 5 5 0 0 1 9.5-1A4 4 0 0 1 17 15z"/><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/></svg>',
    wind:   SVG + '<path d="M3 12h15M13 6l6 6-6 6"/></svg>',
    drought: SVG + '<circle cx="12" cy="9" r="4"/><path d="M12 1v2M4 9H2M22 9h-2M5.6 2.6 7 4M18.4 2.6 17 4M3 21l4-4 3 3 4-4 3 3 4-4"/></svg>',
    daily:  SVG + '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M12 20v-6M12 14c-2 0-3-1-3-3 2 0 3 1 3 3zM12 16c2 0 3-1 3-3-2 0-3 1-3 3z"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? UI_ICONS.sfxOn : UI_ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
  }
  function paintFastBtn() {
    var b = $("fast-btn");
    b.innerHTML = UI_ICONS.fast;
    b.setAttribute("aria-pressed", prefs.fast ? "true" : "false");
    b.setAttribute("aria-label", t(prefs.fast ? "btn.fastOn" : "btn.fastOff"));
    b.title = t(prefs.fast ? "btn.fastOn" : "btn.fastOff");
  }
  function paintThreatBtn() {
    var b = $("threat-btn");
    b.innerHTML = UI_ICONS.threat;
    b.setAttribute("aria-pressed", prefs.threat ? "true" : "false");
    b.setAttribute("aria-label", t(prefs.threat ? "btn.threatOff" : "btn.threatOn"));
    b.title = t(prefs.threat ? "btn.threatOff" : "btn.threatOn");
  }

  // ---------- 11. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft", "--accent-ink",
                  "--panel-bg", "--border", "--shadow", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
    readColors();
    draw();
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    } catch (e) { /* standalone */ }
  }
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("fieldwarden", sliceGet, sliceSet, STORAGE_KEY, mergeFieldwarden);
  }
  function sliceGet() { return mergeFieldwarden(data, data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeFieldwarden(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    canvas.setAttribute("aria-label", t("view.label"));
    $("end-btn").title = t("btn.endKey");
  }
  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"], ["daily-btn", "daily", "btn.daily"], ["undo-btn", "undo", "btn.undo"],
     ["reset-btn", "reset", "btn.reset"], ["rewind-btn", "rewind", "btn.rewind"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    [["s-turn", "turn"], ["s-crop", "crop"], ["s-coins", "coins"]].forEach(function (x) {
      $(x[0]).querySelector(".ic").innerHTML = UI_ICONS[x[1]];
    });
    paintSfxBtn();
    paintFastBtn();
    paintThreatBtn();
  }
  function wire() {
    $("new-btn").addEventListener("click", askNew);
    $("end-btn").addEventListener("click", endTurn);
    $("undo-btn").addEventListener("click", undoAct);
    $("reset-btn").addEventListener("click", resetTurn);
    $("rewind-btn").addEventListener("click", rewind);
    $("stats-btn").addEventListener("click", statsDialog);
    $("daily-btn").addEventListener("click", openDaily);
    // Deep link from the Game Center: { daily: true } opens today's season.
    window.__orosOpenAt = function (tg) { if (tg && tg.daily) openDaily(); };
    $("threat-btn").addEventListener("click", toggleThreat);
    $("fast-btn").addEventListener("click", function () { prefs.fast = !prefs.fast; savePrefs(); paintFastBtn(); });
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("buy");
    });
    wireInput();
    wireKeyboard();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe($("scene"));
    // Save on the way out (R10 session).
    document.addEventListener("visibilitychange", function () { if (document.hidden && game) saveSession(); });
    window.addEventListener("pagehide", function () { if (game) saveSession(); });
  }

  function boot() {
    canvas = $("view");
    ctx = canvas.getContext("2d");
    load();
    ensureDeviceId();
    loadPrefs();
    applyI18n();
    paintStatic();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    game = loadSession();
    var tg = DK ? DK.takeTarget("fieldwarden") : null;
    var daily = !!(tg && tg.daily && DK);
    if (daily && !data.days[today()] && !(game && game.opts.day === today() && !game.counted)) {
      // today's season straight away, unless a year under way would count as lost
      if (!game || !inProgressOf(game)) { game = makeGame(dailyOpts(today())); daily = false; }
    }
    if (!game) game = makeGame({ diff: prefs.diff, seed: newSeed(), trio: prefs.trio });
    st = game.g;
    saveSession();
    seasonMsg();
    if (game.opts.day !== undefined && !st.acts) setMsg(t("daily.rules"));
    resize();
    renderAll();
    if (daily) setTimeout(openDaily, 300);
    else if (st.over >= 0) setTimeout(st.s.done && st.res ? harvestDialog : resultDialog, 300);
    else if (st.phase === "shop") setTimeout(shopDialog, 300);
    else maybeTour();
  }

  boot();
})();
