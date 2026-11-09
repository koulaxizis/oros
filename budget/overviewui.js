// ============================================================
// orOS Budget — Overview tab (budget/overviewui.js)
// The first screen: the month at a glance, as cards the person can
// hide and reorder (set.ov, synced on every device):
//   safe  what is safe to spend a day until the month ends
//   pace  expenses added up day by day, next to last month and the
//         average of the three months before (and the overall limit)
//   acc   net worth and each account's balance
//   lim   the limits closest to their end, as rings
//   up    recurring entries in the next 7 days
//   goal  savings goals
//   top   the biggest expense categories, with the change against
//         last month
// Numbers come from budget/overview.js (pure). Everything the app
// owns (data, writes, dialogs, chart helpers) comes in through
// init(api). Every user text goes in with textContent.
// ============================================================
(function (root) {
  "use strict";
  var O = root.OrosBudgetOverview;
  var P = root.OrosBudgetPlan;
  var A = null;

  var S = {
    en: {
      "ov.safe": "Safe to spend", "ov.perDay": "{a} a day", "ov.days": "for {n} days, to the end of the month", "ov.day1": "for today, the last day of the month",
      "ov.leftLim": "{a} left under your monthly limit", "ov.leftInc": "{a} left of what came in",
      "ov.overLim": "{a} over your monthly limit", "ov.overInc": "{a} more going out than coming in",
      "ov.toCome": "Recurring still to come: {i} in, {o} out",
      "ov.noLim": "Without a monthly limit, this is what came in minus what went out. Set one under Limits › All expenses.",
      "ov.ended": "How the month ended", "ov.saved": "Saved {p}% of what came in", "ov.overspent": "{a} more went out than came in",
      "ov.noInc": "No income this month",
      "ov.ahead": "Coming this month", "ov.plan": "Recurring: {i} in, {o} out",
      "ov.pace": "Spending pace", "ov.thisM": "This month", "ov.lastM": "Last month", "ov.avg": "Average of {n} months",
      "ov.limit": "Limit", "ov.less": "{a} less than last month by this day", "ov.more": "{a} more than last month by this day",
      "ov.same": "The same as last month by this day", "ov.paceNone": "No expenses yet in this month or the one before.",
      "ov.dayTip": "Day {d}: {a}", "ov.dayTipPrev": "last month {a}", "ov.dayTipAvg": "average {a}",
      "ov.day": "Day", "ov.ahead.pace": "This month has not started yet.",
      "ov.bkBal": "Bank {a} ({d})", "ov.bkBoth": "Bank {a} · available {v} ({d})", "ov.bkAvail": "Bank: available {v} ({d})", "ov.bkDebt": "Card debt {a} · available {v} ({d})", "ov.bkDebt1": "Card debt {a} ({d})", "ov.bkNoLim": "Available {v} ({d}). Type the credit limit below to see the debt.", "ov.bkSame": "same", "ov.bkMatch": "Match", "ov.bkMatchHint": "Writes a balance correction on that day so that Budget shows the bank's balance (not income or an expense)",
      "ov.bkMatched": "Starting balance changed by {a}",
      "ov.cyStmt": "Statement {d}: {a}",
      "ov.ivPaid": "paid {a}", "ov.pi": "Passive income {m} a month, {p} % of your expenses (12 months)", "ov.piNoOut": "Passive income {m} a month (12 months)", "ov.asOn": "valued {a} on {d}", "ov.asRate": "{r} % a year", "ov.ivPx": "{q} {s} at {p} ({w})", "ov.ivOz": "oz", "ov.ivG": "g", "ov.ivOld": "last saved price",
      "ov.ivLoading": "Getting the price…", "ov.ivNoPrice": "No price: CoinGecko can't be reached. Type a price in the account.", "ov.ivType": "Type a price in the account to see its value.", "ov.cyNone": "Statement {d}: nothing to pay", "ov.cyPaid": "paid {a}", "ov.cyAll": "paid in full",
      "ov.cyLeft": "{a} by {d}", "ov.cyDays": "{n} days left", "ov.cyToday": "due today", "ov.cyTomorrow": "due tomorrow", "ov.cyLate": "{a} not paid by {d}",
      "ov.cyEst": "Interest if not paid in full: about {a}", "ov.cyFee": "Add interest", "ov.cyFeeTip": "Add the interest or fees on your card statement as an expense: {a}", "ov.bkUnmapped": "Your banks' balances show here once each bank fills a Budget account (Banks › Fills).", "ov.bkBanks": "Banks",
      "ov.acc": "Accounts", "ov.nw": "Net worth", "ov.accNone": "Add your cash, cards and bank accounts to see their balances here.",
      "ov.accAdd": "Accounts", "ov.accTip": "Show the entries of {a}",
      "ov.flowAll": "All accounts, {m}", "ov.flowAria": "in {i}, out {o}, difference {d}", "ov.noAcc": "Without an account",
      "ov.naTip": "Tap to see them and put them in order", "ov.naDupsS": "{n} look like duplicates",
      "ov.naWhat": "{m}: entries that are in none of your accounts. They count in the month's totals, but in no balance.",
      "ov.naDups": "Already in an account ({n})", "ov.naDupsHint": "Same day, same amount and the same text as an entry in an account, usually a bank reading that came in twice. Removing them keeps the one in the account; a category, note or receipt only the copy had moves to it.",
      "ov.naIn": "also in {a}", "ov.naDrop": "Remove {n} duplicates",
      "ov.naRest": "Only here ({n})", "ov.naRestHint": "Pick the account they were paid from or into. To put them in different accounts, open them in Entries.",
      "ov.naPick": "Pick an account", "ov.naTo": "Put them in", "ov.naMove": "Move {n} to this account",
      "ov.naList": "See them in Entries", "ov.naNone": "Nothing without an account this month.", "ov.naMore": "and {n} more (all in Entries)",
      "ov.flowHint": "Balance today, then the month's income, expenses and their difference. Transfers between your accounts are not counted.",
      "ov.lim": "Limits", "ov.limNone": "Give a category a monthly limit to see here how much of it is left.",
      "ov.limSet": "Set limits", "ov.limLeft": "{a} left", "ov.limOver": "{a} over", "ov.limAll": "All expenses",
      "ov.up": "Next 7 days", "ov.upNone": "No recurring entries in the next 7 days.", "ov.today": "Today", "ov.tomorrow": "Tomorrow",
      "ov.upSum": "In {i} · out {o}",
      "ov.goal": "Savings goals", "ov.goalNone": "A trip, a new laptop, a safety net: set a target and see how close you are.",
      "ov.goalNew": "New goal", "ov.accEdit": "Rename or change {a}", "ov.accNew": "New account", "ov.bkNow": "Update from banks", "ov.bkBusy": "Updating…", "ov.bkLast": "Last update {d}", "ov.bkNever": "Not updated on this device yet", "ov.bkWeb": "Banks update only at useoros.online", "ov.loan": "Loans and debts",
      "ov.area": "Areas", "ov.areaNone": "Without an area", "ov.areaYear": "Year so far, after shared costs ({m})",
      "ov.areaShared": "Shared costs ({n}): {a}", "ov.ayNet": "{a}", "ov.ayShare": "{a} shared",
      "ov.ayAria": "{n}: {a}, minus {s} of the shared costs, = {r}", "ov.ayLeft": "{a} of the shared costs go to no area (the shares add up to less than 100%).",
      "ov.whole": "All together, {m}", "ov.wBus": "Business (after the shared costs)", "ov.wPer": "Personal", "ov.wNone": "Without an area",
      "ov.wTot": "Total", "ov.wFlow": "In {i} · out {o}", "ov.wDraw": "Taken out for personal use: {a}", "ov.wBack": "Put back into the business: {a}",
      "ov.wHint": "Transfers between your accounts only move money; they count in no total.",
      "ov.top": "Where the money went", "ov.topNone": "No expenses this month.", "ov.new": "new",
      "ov.up%": "{p}% more than last month", "ov.down%": "{p}% less than last month", "ov.new.aria": "Nothing in this category last month",
      "ov.edit": "Edit the overview", "ov.editHint": "Pick the cards to show and their order. It applies on all your devices.",
      "ov.upBtn": "Move up: {c}", "ov.downBtn": "Move down: {c}", "ov.reset": "Default order", "ov.saveDone": "Overview saved",
      "ov.gCash": "Money", "ov.gCard": "Cards", "ov.gInv": "Investments and things of value",
      "ov.have": "I have {a}", "ov.owe": "I owe {a}",
      "ov.stFlow": "this month +{i} · −{o}", "ov.stDue": "{a} by {d} · in {n} days", "ov.stChk": "Checked {d}", "ov.stBank": "Bank says {a}", "ov.stDebt": "Debt {a} · available {v}", "ov.stDebt1": "Debt {a}", "ov.stNoLim": "Available {v} · add the limit to see the debt",
      "ov.sheetTip": "{a}: entries, update the balance, transfer, edit",
      "ov.shEntries": "Entries", "ov.shNew": "New entry", "ov.shUpd": "Update balance", "ov.shXfer": "Transfer", "ov.shEdit": "Edit",
      "ov.shAuto": "Match the bank by itself", "ov.shAutoHint": "When the bank's balance differs, Budget writes a balance correction so the two agree, and says so (with Undo).",
      "ov.open": "More",
      "ov.lessAll": "{a} less than the month before", "ov.moreAll": "{a} more than the month before", "ov.sameAll": "The same as the month before"
    },
    el: {
      "ov.safe": "Μπορείς να ξοδέψεις", "ov.perDay": "{a} τη μέρα", "ov.days": "για {n} μέρες, ως το τέλος του μήνα", "ov.day1": "για σήμερα, την τελευταία μέρα του μήνα",
      "ov.leftLim": "Μένουν {a} ως το μηνιαίο όριο", "ov.leftInc": "Μένουν {a} από όσα μπήκαν",
      "ov.overLim": "{a} πάνω από το μηνιαίο όριο", "ov.overInc": "Βγαίνουν {a} περισσότερα από όσα μπαίνουν",
      "ov.toCome": "Πάγια που έρχονται: {i} έσοδα, {o} έξοδα",
      "ov.noLim": "Χωρίς μηνιαίο όριο, αυτό είναι όσα μπήκαν μείον όσα βγήκαν. Βάλε ένα στα Όρια › Όλα τα έξοδα.",
      "ov.ended": "Πώς έκλεισε ο μήνας", "ov.saved": "Έμεινε το {p}% όσων μπήκαν", "ov.overspent": "Βγήκαν {a} περισσότερα από όσα μπήκαν",
      "ov.noInc": "Κανένα έσοδο αυτόν τον μήνα",
      "ov.ahead": "Τι έρχεται αυτόν τον μήνα", "ov.plan": "Πάγια: {i} έσοδα, {o} έξοδα",
      "ov.pace": "Ρυθμός εξόδων", "ov.thisM": "Αυτός ο μήνας", "ov.lastM": "Προηγούμενος μήνας", "ov.avg": "Μέσος όρος {n} μηνών",
      "ov.limit": "Όριο", "ov.less": "{a} λιγότερα από τον προηγούμενο μήνα ως σήμερα", "ov.more": "{a} περισσότερα από τον προηγούμενο μήνα ως σήμερα",
      "ov.same": "Όσα και τον προηγούμενο μήνα ως σήμερα", "ov.paceNone": "Κανένα έξοδο ακόμη σε αυτόν ή στον προηγούμενο μήνα.",
      "ov.dayTip": "{d} του μήνα: {a}", "ov.dayTipPrev": "προηγούμενος {a}", "ov.dayTipAvg": "μέσος όρος {a}",
      "ov.day": "Μέρα", "ov.ahead.pace": "Αυτός ο μήνας δεν έχει αρχίσει ακόμη.",
      "ov.bkBal": "Τράπεζα {a} ({d})", "ov.bkBoth": "Τράπεζα {a} · διαθέσιμο {v} ({d})", "ov.bkAvail": "Τράπεζα: διαθέσιμο {v} ({d})", "ov.bkDebt": "Χρέος κάρτας {a} · διαθέσιμο {v} ({d})", "ov.bkDebt1": "Χρέος κάρτας {a} ({d})", "ov.bkNoLim": "Διαθέσιμο {v} ({d}). Γράψε από κάτω το πιστωτικό όριο για να φανεί το χρέος.", "ov.bkSame": "ίδιο", "ov.bkMatch": "Ταίριαξε", "ov.bkMatchHint": "Γράφει διόρθωση υπολοίπου εκείνη τη μέρα ώστε η εφαρμογή να δείχνει το υπόλοιπο της τράπεζας (όχι έσοδο ή έξοδο)",
      "ov.bkMatched": "Το αρχικό υπόλοιπο άλλαξε κατά {a}",
      "ov.cyStmt": "Κλείσιμο {d}: {a}",
      "ov.ivPaid": "πληρώθηκαν {a}", "ov.pi": "Παθητικό εισόδημα {m} τον μήνα, {p} % των εξόδων σου (12 μήνες)", "ov.piNoOut": "Παθητικό εισόδημα {m} τον μήνα (12 μήνες)", "ov.asOn": "αξία {a} στις {d}", "ov.asRate": "{r} % τον χρόνο", "ov.ivPx": "{q} {s} προς {p} ({w})", "ov.ivOz": "oz", "ov.ivG": "γρ.", "ov.ivOld": "τελευταία αποθηκευμένη τιμή",
      "ov.ivLoading": "Παίρνω την τιμή…", "ov.ivNoPrice": "Χωρίς τιμή: το CoinGecko δεν απαντά. Γράψε μια τιμή στον λογαριασμό.", "ov.ivType": "Γράψε μια τιμή στον λογαριασμό για να δεις την αξία του.", "ov.cyNone": "Κλείσιμο {d}: τίποτα για πληρωμή", "ov.cyPaid": "πληρώθηκαν {a}", "ov.cyAll": "εξοφλήθηκε",
      "ov.cyLeft": "{a} ως {d}", "ov.cyDays": "μένουν {n} ημέρες", "ov.cyToday": "λήγει σήμερα", "ov.cyTomorrow": "λήγει αύριο", "ov.cyLate": "{a} απλήρωτα από {d}",
      "ov.cyEst": "Τόκος αν δεν εξοφληθεί: περίπου {a}", "ov.cyFee": "Πρόσθεσε τόκους", "ov.cyFeeTip": "Πρόσθεσε ως έξοδο τους τόκους ή τις χρεώσεις του λογαριασμού της κάρτας: {a}", "ov.bkUnmapped": "Τα υπόλοιπα των τραπεζών σου φαίνονται εδώ μόλις κάθε τράπεζα γεμίζει έναν λογαριασμό της εφαρμογής (Τράπεζες › Γεμίζει).", "ov.bkBanks": "Τράπεζες",
      "ov.acc": "Λογαριασμοί", "ov.nw": "Καθαρή θέση", "ov.accNone": "Πρόσθεσε μετρητά, κάρτες και τραπεζικούς λογαριασμούς για να βλέπεις εδώ τα υπόλοιπά τους.",
      "ov.accAdd": "Λογαριασμοί", "ov.accTip": "Οι κινήσεις του {a}",
      "ov.flowAll": "Όλοι οι λογαριασμοί, {m}", "ov.flowAria": "έσοδα {i}, έξοδα {o}, διαφορά {d}", "ov.noAcc": "Χωρίς λογαριασμό",
      "ov.naTip": "Πάτα για να τις δεις και να τις τακτοποιήσεις", "ov.naDupsS": "{n} μοιάζουν διπλές",
      "ov.naWhat": "{m}: κινήσεις που δεν ανήκουν σε κανέναν λογαριασμό σου. Μετράνε στα σύνολα του μήνα, αλλά σε κανένα υπόλοιπο.",
      "ov.naDups": "Υπάρχουν ήδη σε λογαριασμό ({n})", "ov.naDupsHint": "Ίδια μέρα, ίδιο ποσό και ίδιο κείμενο με κίνηση σε λογαριασμό, συνήθως ανάγνωση τράπεζας που μπήκε δύο φορές. Το σβήσιμο κρατάει αυτή του λογαριασμού· κατηγορία, σημείωση ή απόδειξη που είχε μόνο το αντίγραφο περνάει σε εκείνη.",
      "ov.naIn": "και στο {a}", "ov.naDrop": "Σβήσε {n} διπλές",
      "ov.naRest": "Μόνο εδώ ({n})", "ov.naRestHint": "Διάλεξε τον λογαριασμό από τον οποίο πληρώθηκαν ή στον οποίο μπήκαν. Για διαφορετικούς λογαριασμούς, άνοιξέ τες στις Κινήσεις.",
      "ov.naPick": "Διάλεξε λογαριασμό", "ov.naTo": "Βάλ' τες στον", "ov.naMove": "Μετάφερε {n} σε αυτόν τον λογαριασμό",
      "ov.naList": "Δες τες στις Κινήσεις", "ov.naNone": "Τίποτα χωρίς λογαριασμό αυτόν τον μήνα.", "ov.naMore": "και {n} ακόμα (όλες στις Κινήσεις)",
      "ov.flowHint": "Υπόλοιπο σήμερα, μετά τα έσοδα, τα έξοδα και η διαφορά τους στον μήνα. Οι μεταφορές ανάμεσα στους λογαριασμούς σου δεν μετράνε.",
      "ov.lim": "Όρια", "ov.limNone": "Δώσε σε μια κατηγορία μηνιαίο όριο για να βλέπεις εδώ πόσα μένουν.",
      "ov.limSet": "Ορισμός ορίων", "ov.limLeft": "μένουν {a}", "ov.limOver": "{a} πάνω", "ov.limAll": "Όλα τα έξοδα",
      "ov.up": "Επόμενες 7 μέρες", "ov.upNone": "Κανένα πάγιο τις επόμενες 7 μέρες.", "ov.today": "Σήμερα", "ov.tomorrow": "Αύριο",
      "ov.upSum": "Έσοδα {i} · έξοδα {o}",
      "ov.goal": "Στόχοι αποταμίευσης", "ov.goalNone": "Ένα ταξίδι, ένας νέος υπολογιστής, ένα αποθεματικό: βάλε στόχο και δες πόσο κοντά είσαι.",
      "ov.goalNew": "Νέος στόχος", "ov.accEdit": "Όνομα και ρυθμίσεις: {a}", "ov.accNew": "Νέος λογαριασμός", "ov.bkNow": "Ενημέρωση από τράπεζες", "ov.bkBusy": "Ενημέρωση…", "ov.bkLast": "Τελευταία ενημέρωση {d}", "ov.bkNever": "Δεν έχει γίνει ακόμα ενημέρωση σε αυτή τη συσκευή", "ov.bkWeb": "Οι τράπεζες ενημερώνονται μόνο στο useoros.online", "ov.loan": "Δάνεια και χρέη",
      "ov.area": "Τομείς", "ov.areaNone": "Χωρίς τομέα", "ov.areaYear": "Η χρονιά ως τώρα, μετά τα κοινά ({m})",
      "ov.areaShared": "Κοινά έξοδα ({n}): {a}", "ov.ayNet": "{a}", "ov.ayShare": "{a} κοινά",
      "ov.ayAria": "{n}: {a}, μείον {s} από τα κοινά, = {r}", "ov.whole": "Όλα μαζί, {m}", "ov.wBus": "Επιχείρηση (μετά τα κοινά)", "ov.wPer": "Προσωπικά", "ov.wNone": "Χωρίς τομέα",
      "ov.wTot": "Σύνολο", "ov.wFlow": "Μπήκαν {i} · βγήκαν {o}", "ov.wDraw": "Αναλήψεις για προσωπικά: {a}", "ov.wBack": "Βάλατε πίσω στην επιχείρηση: {a}",
      "ov.wHint": "Οι μεταφορές ανάμεσα στους λογαριασμούς σου μόνο μετακινούν χρήματα και δεν μετράνε σε κανένα σύνολο.",
      "ov.ayLeft": "{a} από τα κοινά δεν πάνε σε κανέναν τομέα (τα μερίδια βγαίνουν κάτω από 100%).",
      "ov.top": "Πού πήγαν τα χρήματα", "ov.topNone": "Κανένα έξοδο αυτόν τον μήνα.", "ov.new": "νέα",
      "ov.up%": "{p}% περισσότερα από τον προηγούμενο μήνα", "ov.down%": "{p}% λιγότερα από τον προηγούμενο μήνα", "ov.new.aria": "Τίποτα σε αυτή την κατηγορία τον προηγούμενο μήνα",
      "ov.edit": "Προσαρμογή σύνοψης", "ov.editHint": "Διάλεξε ποιες κάρτες φαίνονται και με ποια σειρά. Ισχύει σε όλες τις συσκευές σου.",
      "ov.upBtn": "Πάνω: {c}", "ov.downBtn": "Κάτω: {c}", "ov.reset": "Αρχική σειρά", "ov.saveDone": "Η σύνοψη αποθηκεύτηκε",
      "ov.gCash": "Χρήματα", "ov.gCard": "Κάρτες", "ov.gInv": "Επενδύσεις και περιουσία",
      "ov.have": "Έχω {a}", "ov.owe": "Χρωστάω {a}",
      "ov.stFlow": "αυτόν τον μήνα +{i} · −{o}", "ov.stDue": "{a} ως {d} · σε {n} μέρες", "ov.stChk": "Ελέγχθηκε {d}", "ov.stBank": "Η τράπεζα λέει {a}", "ov.stDebt": "Χρέος {a} · διαθέσιμο {v}", "ov.stDebt1": "Χρέος {a}", "ov.stNoLim": "Διαθέσιμο {v} · βάλε το όριο για το χρέος",
      "ov.sheetTip": "{a}: κινήσεις, ενημέρωση υπολοίπου, μεταφορά, επεξεργασία",
      "ov.shEntries": "Κινήσεις", "ov.shNew": "Νέα κίνηση", "ov.shUpd": "Ενημέρωση υπολοίπου", "ov.shXfer": "Μεταφορά", "ov.shEdit": "Επεξεργασία",
      "ov.shAuto": "Ταίριασμα με την τράπεζα αυτόματα", "ov.shAutoHint": "Όταν το υπόλοιπο της τράπεζας διαφέρει, η εφαρμογή γράφει διόρθωση υπολοίπου ώστε να συμφωνούν, και το λέει (με Αναίρεση).",
      "ov.open": "Περισσότερα",
      "ov.lessAll": "{a} λιγότερα από τον προηγούμενο μήνα", "ov.moreAll": "{a} περισσότερα από τον προηγούμενο μήνα", "ov.sameAll": "Όσα και τον προηγούμενο μήνα"
    }
  };
  // orosI18n (../i18n.js): S[<pack language>] from the pack "budget".
  if (root.orosI18n) root.orosI18n.table(S, "budget", root.orosI18n.lang());

  function t(k, p) {
    var tab = S[A.lang] || S.en;
    var s = tab[k] !== undefined ? tab[k] : (S.en[k] !== undefined ? S.en[k] : k);
    if (p) Object.keys(p).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function el(tag, cls, text) { return A.el(tag, cls, text); }
  function D() { return A.data(); }
  function TXV() { return A.viewTx ? A.viewTx() : D().tx; }   // AR-VIEW: the area switch
  function lastDayOf(mk) { return mk + "-" + (O.daysIn(mk) < 10 ? "0" : "") + O.daysIn(mk); }

  var TITLE = { safe: "ov.safe", pace: "ov.pace", acc: "ov.acc", lim: "ov.lim", up: "ov.up", goal: "ov.goal", loan: "ov.loan", top: "ov.top", area: "ov.area" };
  var BUILD = { safe: cardSafe, pace: cardPace, acc: cardAcc, lim: cardLim, up: cardUp, goal: cardGoal, loan: cardLoan, top: cardTop, area: cardArea };

  function render(box) {
    A.hideTip();
    box.innerHTML = "";
    var grid = el("div", "ov-grid");
    box.appendChild(grid);
    O.cardList(D().set.ov).forEach(function (c) {
      if (!c.on || !BUILD[c.id] || (c.id === "loan" && !A.loansCard) || (c.id === "area" && !(A.areas && A.areas().length))) return;
      var card = el("section", "card ov-card ovc-" + c.id);
      card.setAttribute("aria-labelledby", "ov-h-" + c.id);
      grid.appendChild(card);
      BUILD[c.id](card);
    });
    var edit = el("button", "txt-btn ov-edit", t("ov.edit"));
    edit.type = "button";
    edit.addEventListener("click", editDialog);
    box.appendChild(edit);
  }

  // A card's heading, with an optional link to the tab behind it.
  function head(card, id, title, linkText, onLink) {
    var h = el("div", "ov-head");
    var h2 = el("h2", "", title);
    h2.id = "ov-h-" + id;
    h.appendChild(h2);
    if (linkText) {
      var b = el("button", "mini", linkText);
      b.type = "button";
      b.addEventListener("click", onLink);
      h.appendChild(b);
    }
    card.appendChild(h);
  }
  function hint(card, text, btnText, onBtn) {
    card.appendChild(el("p", "hint", text));
    if (btnText) {
      var b = el("button", "mini ov-cta", btnText);
      b.type = "button";
      b.addEventListener("click", onBtn);
      card.appendChild(b);
    }
  }

  // ---------- safe to spend ----------
  function cardSafe(card) {
    var mk = A.viewMk(), today = A.today(), tt = A.totals(mk);
    var from = mk === today.slice(0, 7) ? P.addDays(today, 1) : mk + "-01";
    var rest = mk < today.slice(0, 7) ? [] : O.upcoming(D(), from, lastDayOf(mk));
    var s = O.safe(tt, A.limitOf("all"), rest, mk, today);
    if (s.when === "past") {
      head(card, "safe", t("ov.ended"));
      var bal = tt.inc - tt.out;
      card.appendChild(el("div", "ov-big" + (bal < 0 ? " neg" : ""), A.money(bal)));
      card.appendChild(el("p", "ov-sub", !tt.inc ? t("ov.noInc") : bal >= 0 ? t("ov.saved", { p: Math.round(bal * 100 / tt.inc) })
                                                                               : t("ov.overspent", { a: A.money(-bal) })));
      return;
    }
    if (s.when === "ahead") {
      head(card, "safe", t("ov.ahead"));
      var net = s.upIn - s.upOut;
      card.appendChild(el("div", "ov-big" + (net < 0 ? " neg" : ""), A.money(net)));
      card.appendChild(el("p", "ov-sub", t("ov.plan", { i: A.money(s.upIn), o: A.money(s.upOut) })));
      return;
    }
    head(card, "safe", t("ov.safe"));
    var big = el("div", "ov-big" + (s.left < 0 ? " neg" : ""), s.left < 0 ? A.money(0) : t("ov.perDay", { a: A.money(s.perDay) }));
    card.appendChild(big);
    card.appendChild(el("p", "ov-sub", s.days > 1 ? t("ov.days", { n: s.days }) : t("ov.day1")));
    var line = s.left >= 0 ? t(s.mode === "limit" ? "ov.leftLim" : "ov.leftInc", { a: A.money(s.left) })
                           : t(s.mode === "limit" ? "ov.overLim" : "ov.overInc", { a: A.money(-s.left) });
    card.appendChild(el("p", "ov-line" + (s.left < 0 ? " neg" : ""), line));
    if (s.upIn || s.upOut) card.appendChild(el("p", "hint", t("ov.toCome", { i: A.money(s.upIn), o: A.money(s.upOut) })));
    if (s.mode === "income") card.appendChild(el("p", "hint", t("ov.noLim")));
  }

  // ---------- spending pace ----------
  function cardPace(card) {
    head(card, "pace", t("ov.pace"));
    var mk = A.viewMk(), pc = O.pace(TXV(), mk, A.today()), limit = A.limitOf("all");
    if (!pc.upto) { card.appendChild(el("p", "hint", t("ov.ahead.pace"))); return; }
    var lastCur = pc.cur[pc.cur.length - 1] || 0;
    if (!lastCur && !pc.prev[pc.days - 1]) { card.appendChild(el("p", "hint", t("ov.paceNone"))); return; }
    // How this month compares with the last one on the same day
    var i = pc.upto - 1, diff = lastCur - pc.prev[i];
    var sfx = pc.upto === pc.days ? "All" : "";   // a whole month: against the whole month before
    var msg = diff < 0 ? t("ov.less" + sfx, { a: A.money(-diff) }) : diff > 0 ? t("ov.more" + sfx, { a: A.money(diff) }) : t("ov.same" + sfx);
    card.appendChild(el("p", "ov-line" + (diff > 0 ? " neg" : " good"), msg));
    var legend = el("div", "legend wrap");
    function lg(cls, text) {
      var s = el("span", "lg");
      var k = el("span", "ov-key " + cls);
      k.setAttribute("aria-hidden", "true");
      s.appendChild(k);
      s.appendChild(el("span", "", text));
      legend.appendChild(s);
    }
    lg("k-cur", t("ov.thisM"));
    lg("k-prev", t("ov.lastM"));
    if (pc.avgN) lg("k-avg", t("ov.avg", { n: pc.avgN }));
    if (limit) lg("k-lim", t("ov.limit"));
    card.appendChild(legend);
    var box = el("div", "ov-chart");
    card.appendChild(box);
    var W = A.chartWidth(box), H = 190, L = 50, Rm = 8, T = 10, B = 22;
    var max = Math.max.apply(null, [1, lastCur, pc.prev[pc.days - 1] || 0, limit || 0].concat(pc.avg.length ? [pc.avg[pc.days - 1]] : []));
    var step = A.niceStep(max / 4), topV = Math.max(step, Math.ceil(max / step) * step);
    var pw = W - L - Rm, ph = H - T - B;
    var x = function (d) { return L + (pc.days > 1 ? d * pw / (pc.days - 1) : 0); };
    var y = function (v) { return T + ph - v / topV * ph; };
    var svg = A.sv("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "class": "chart pace", role: "img",
                            "aria-label": t("ov.pace") + ", " + A.monthLabel(mk) + ": " + msg });
    for (var v = 0; v <= topV + 0.5; v += step) {
      svg.appendChild(A.sv("line", { x1: L, x2: W - Rm, y1: y(v), y2: y(v), "class": v === 0 ? "base" : "grid" }));
      svg.appendChild(A.svText(L - 6, y(v) + 4, A.moneyShort(v), "ax", "end"));
    }
    [1, 8, 15, 22, pc.days].forEach(function (d) {
      svg.appendChild(A.svText(x(d - 1), H - 6, String(d), "ax", "middle"));
    });
    function path(arr, cls) {
      if (!arr.length) return;
      var d = arr.map(function (val, j) { return (j ? "L" : "M") + x(j).toFixed(1) + "," + y(val).toFixed(1); }).join(" ");
      svg.appendChild(A.sv("path", { d: d, "class": "line " + cls }));
    }
    if (limit) {
      svg.appendChild(A.sv("line", { x1: L, x2: W - Rm, y1: y(limit), y2: y(limit), "class": "ov-lim" }));
      svg.appendChild(A.sv("line", { x1: x(0), x2: x(pc.days - 1), y1: y(0), y2: y(limit), "class": "ov-ideal" }));
    }
    path(pc.avg, "ov-avg");
    path(pc.prev, "ov-prev");
    path(pc.cur, "ov-cur");
    svg.appendChild(A.sv("circle", { cx: x(i), cy: y(lastCur), r: 4, "class": "dot ov-dot" }));
    var colW = pc.days > 1 ? pw / (pc.days - 1) : pw;
    for (var d = 0; d < pc.days; d++) {
      var parts = [t("ov.dayTip", { d: d + 1, a: d < pc.upto ? A.money(pc.cur[d]) : "–" }), t("ov.dayTipPrev", { a: A.money(pc.prev[d]) })];
      if (pc.avg.length) parts.push(t("ov.dayTipAvg", { a: A.money(pc.avg[d]) }));
      var target = A.sv("rect", { x: Math.max(L, x(d) - colW / 2), y: T, width: colW, height: ph, fill: "transparent" });
      A.hit(target, parts.join(" · "), null);
      target.removeAttribute("tabindex");   // 31 stops are too many for the keyboard: the table below has them all
      svg.appendChild(target);
    }
    box.appendChild(svg);
    var rows = [];
    for (var r = 0; r < pc.days; r++) {
      var row = [String(r + 1), r < pc.upto ? A.money(pc.cur[r]) : "–", A.money(pc.prev[r])];
      if (pc.avg.length) row.push(A.money(pc.avg[r]));
      rows.push(row);
    }
    var cols = [t("ov.day"), t("ov.thisM"), t("ov.lastM")];
    if (pc.avg.length) cols.push(t("ov.avg", { n: pc.avgN }));
    card.appendChild(A.tableTwin(cols, rows));
  }

  // ---------- accounts ----------
  // Each account: its balance today and what came in, went out and the
  // difference in the month you are looking at; on top the total of all.
  function flowLine(f) {
    var net = f.inc - f.out;
    var line = el("span", "ov-flow");
    line.appendChild(el("span", "in", "+" + A.money(f.inc)));
    line.appendChild(el("span", "", "−" + A.money(f.out)));
    line.appendChild(el("span", net < 0 ? "neg" : "pos", "= " + (net < 0 ? "−" : "+") + A.money(Math.abs(net))));
    return line;
  }
  function flowAria(f) {
    return t("ov.flowAria", { i: A.money(f.inc), o: A.money(f.out), d: A.money(f.inc - f.out) });
  }
  // BK-7: under an account, the balance of each bank that fills it (as
  // read on the last update, BK-5) and Match when Budget differs on that
  // day; nothing changes without the button (Undo).
  function bankLines(li, a, bnk) {
    if (!li || !A.accBalAt) return;
    bnk.forEach(function (r) {
      if (r.ac !== a.id || !r.bc || r.bc !== (a.cur || A.cur())) return;
      var hasB = typeof r.bb === "number", hasA = typeof r.ba === "number";
      if (!hasB && !hasA) return;
      var line = el("div", "ov-bkline");
      // BK-8: a card shows its debt and what is left to spend; CD-1:
      // the debt by that name, and what is missing when it is unknown
      var card = isCardRow(r);
      var txt = card && hasB ? (hasA ? t("ov.bkDebt", { a: A.money(-r.bb, r.bc), v: A.money(r.ba, r.bc), d: A.dateShort(r.bd) }) : t("ov.bkDebt1", { a: A.money(-r.bb, r.bc), d: A.dateShort(r.bd) }))
              : card ? t("ov.bkNoLim", { v: A.money(r.ba, r.bc), d: A.dateShort(r.bd) })
              : !hasB ? t("ov.bkAvail", { v: A.money(r.ba, r.bc), d: A.dateShort(r.bd) })
              : hasA ? t("ov.bkBoth", { a: A.money(r.bb, r.bc), v: A.money(r.ba, r.bc), d: A.dateShort(r.bd) })
              : t("ov.bkBal", { a: A.money(r.bb, r.bc), d: A.dateShort(r.bd) });
      line.appendChild(el("span", "", txt));
      if (!hasB) { li.appendChild(line); return; }
      var mine = A.accBalAt(a.id, r.bd);
      if (mine === r.bb) line.appendChild(el("span", "ov-bk-ok", " · " + t("ov.bkSame")));
      else if (mine !== null && A.correct) {
        var diff = r.bb - mine;
        var b = el("button", "mini", t("ov.bkMatch"));
        b.type = "button";
        b.title = t("ov.bkMatchHint");
        b.setAttribute("aria-label", t("ov.bkMatch") + ": " + a.n + ", " + t("ov.bkBal", { a: A.money(r.bb, r.bc), d: A.dateShort(r.bd) }));
        b.addEventListener("click", function () { A.correct(a.id, diff, t("ov.bkMatched", { a: A.money(diff, r.bc) }), r.bd); });
        line.appendChild(b);
      }
      li.appendChild(line);
    });
  }
  // CD-1: is a bank row a credit card (the person's answer, the bank's
  // kind of account, its name)
  function isCardRow(r) { return !!(A.isCardRow && A.isCardRow(r)); }
  // CC-1: a credit card's cycle under its account: the last statement,
  // what was paid, what is left by the due date, the interest estimate.
  function cycleLines(li, a) {
    if (!li || !A.cardCycle) return;
    var c = A.cardCycle(a.id);
    if (!c) return;
    var cu = a.cur || A.cur();
    var line = el("div", "ov-bkline ov-cy" + (c.state === "late" ? " late" : ""));
    var parts;
    if (c.state === "none") parts = [t("ov.cyNone", { d: A.dateShort(c.s) })];
    else {
      parts = [t("ov.cyStmt", { d: A.dateShort(c.s), a: A.money(c.stmt, cu) })];
      if (c.paid && c.left) parts.push(t("ov.cyPaid", { a: A.money(c.paid, cu) }));
      if (c.state === "paid") parts.push(t("ov.cyAll"));
      else if (c.state === "late") parts.push(t("ov.cyLate", { a: A.money(c.left, cu), d: A.dateShort(c.due) }));
      else parts.push(t("ov.cyLeft", { a: A.money(c.left, cu), d: A.dateShort(c.due) }) + " (" + (c.days > 1 ? t("ov.cyDays", { n: c.days }) : c.days === 1 ? t("ov.cyTomorrow") : t("ov.cyToday")) + ")");
    }
    line.appendChild(el("span", "", parts.join(" · ")));
    li.appendChild(line);
    if (c.est || A.addCardFee) {
      var l2 = el("div", "ov-bkline ov-cy");
      if (c.est) l2.appendChild(el("span", "", t("ov.cyEst", { a: A.money(c.est, cu) })));
      if (A.addCardFee) {
        var b = el("button", "mini", t("ov.cyFee"));
        b.type = "button";
        b.setAttribute("aria-label", t("ov.cyFeeTip", { a: a.n }));
        b.addEventListener("click", function () { A.addCardFee(a.id, c.est); });
        l2.appendChild(b);
      }
      li.appendChild(l2);
    }
  }
  // INV-1: under an investment account, what was paid, the gain or
  // loss, and the price it was valued at (live, or typed on a day).
  function investLines(li, a, iv, paid) {
    if (!li || !iv) return;
    var cu = a.cur || A.cur(), line = el("div", "ov-bkline ov-iv");
    if (!iv.val) {
      line.appendChild(el("span", "", iv.live ? (iv.failed ? t("ov.ivNoPrice") : t("ov.ivLoading")) : t("ov.ivType")));
      li.appendChild(line);
      return;
    }
    if (iv.c.k === "p") {                       // AS-1: a home, car, valuable
      var pp = [t("ov.asOn", { a: A.money(iv.c.p, cu), d: A.dateShort(iv.c.d) })];
      if (iv.c.r) pp.push(t("ov.asRate", { r: (iv.c.r > 0 ? "+" : "") + String(iv.c.r / 100).replace(".", A.lang === "el" ? "," : ".") }));
      if (iv.c.s) pp.unshift(iv.c.s);
      line.appendChild(el("span", "", pp.join(" · ")));
      li.appendChild(line);
      return;
    }
    var gain = iv.val.v - paid, parts = [t("ov.ivPaid", { a: A.money(paid, cu) })];
    var pct = paid > 0 ? Math.round(gain / paid * 1000) / 10 : null;
    parts.push((gain >= 0 ? "+" : "") + A.money(gain, cu) + (pct !== null ? " (" + (pct >= 0 ? "+" : "") + String(pct).replace(".", A.lang === "el" ? "," : ".") + " %)" : ""));
    line.appendChild(el("span", "", parts.join(" · ")));
    li.appendChild(line);
    var l2 = el("div", "ov-bkline ov-iv");
    var unit = iv.c.k === "m" ? (iv.c.u === "g" ? t("ov.ivG") : t("ov.ivOz")) : "";
    var when = iv.val.src === "live" ? (A.whenShort ? A.whenShort(iv.val.t) : "") + (iv.failed ? " · " + t("ov.ivOld") : "") : iv.val.d ? A.dateShort(iv.val.d) : "";
    l2.appendChild(el("span", "", t("ov.ivPx", { q: iv.c.q.toLocaleString(A.lang === "el" ? "el-GR" : "en-GB", { maximumFractionDigits: 12 }) + (unit ? " " + unit : ""),
      s: iv.c.s, p: A.money(iv.val.px, cu), w: when }) + (iv.val.src === "live" ? " · CoinGecko" : "")));
    li.appendChild(l2);
  }
  // AC-1: an account's value in the main currency (null: no rate).
  function mainVal(a, v) {
    if (typeof v !== "number") return null;
    var c = a.cur || A.cur();
    if (c === A.cur()) return v;
    var r = A.fx ? A.fx(v, c, A.cur()) : null;
    return typeof r === "number" ? r : null;
  }
  // The one line under an account on the Overview, by what matters most:
  // a card payment due, an investment's gain, the bank saying another
  // balance, the month's money in and out, when it was last checked.
  function statusOf(a, iv, paid, f, mk, bnk) {
    var cu = a.cur || A.cur();
    var c = A.cardCycle ? A.cardCycle(a.id) : null;
    if (c && (c.state === "open" || c.state === "late") && c.left) {
      if (c.state === "late") return { text: t("ov.cyLate", { a: A.money(c.left, cu), d: A.dateShort(c.due) }), cls: "over" };
      var dm = c.due.slice(8, 10) + "/" + c.due.slice(5, 7);
      return { text: c.days > 1 ? t("ov.stDue", { a: A.money(c.left, cu), d: dm, n: c.days }) : t("ov.cyLeft", { a: A.money(c.left, cu), d: dm }) + " · " + (c.days === 1 ? t("ov.cyTomorrow") : t("ov.cyToday")),
               cls: c.days <= 3 ? "warn" : "" };
    }
    if (iv) {
      if (!iv.val) return { text: iv.live ? (iv.failed ? t("ov.ivNoPrice") : t("ov.ivLoading")) : t("ov.ivType"), cls: "" };
      if (iv.c.k === "p") return { text: iv.c.r ? t("ov.asRate", { r: (iv.c.r > 0 ? "+" : "") + String(iv.c.r / 100).replace(".", A.lang === "el" ? "," : ".") }) : t("ov.asOn", { a: A.money(iv.c.p, cu), d: A.dateShort(iv.c.d) }), cls: "" };
      var gain = iv.val.v - paid, pct = paid > 0 ? Math.round(gain / paid * 1000) / 10 : null;
      return { text: (gain >= 0 ? "+" : "\u2212") + A.money(Math.abs(gain), cu) + (pct !== null ? " (" + (pct >= 0 ? "+" : "\u2212") + String(Math.abs(pct)).replace(".", A.lang === "el" ? "," : ".") + " %)" : ""),
               cls: gain >= 0 ? "good" : "over" };
    }
    // CD-1: a card a bank fills: its debt and what is left to spend,
    // always, so the debt is found where the card is
    for (var j = 0; j < bnk.length; j++) {
      var cr = bnk[j];
      if (cr.ac !== a.id || cr.bc !== cu || !isCardRow(cr)) continue;
      if (typeof cr.bb === "number") {
        var off = A.accBalAt ? A.accBalAt(a.id, cr.bd) : null;
        return { text: typeof cr.ba === "number" ? t("ov.stDebt", { a: A.money(-cr.bb, cu), v: A.money(cr.ba, cu) }) : t("ov.stDebt1", { a: A.money(-cr.bb, cu) }),
                 cls: off !== null && off !== cr.bb ? "warn" : "" };
      }
      if (typeof cr.ba === "number") return { text: t("ov.stNoLim", { v: A.money(cr.ba, cu) }), cls: "warn" };
    }
    for (var i = 0; i < bnk.length; i++) {
      var r = bnk[i];
      if (r.ac !== a.id || r.bc !== cu || typeof r.bb !== "number" || !A.accBalAt) continue;
      var mine = A.accBalAt(a.id, r.bd);
      if (mine !== null && mine !== r.bb) return { text: t("ov.stBank", { a: A.money(r.bb, cu) }) + " (" + A.dateShort(r.bd) + ")", cls: "warn" };
    }
    if (f.inc || f.out) return { text: t("ov.stFlow", { m: A.monthLabel(mk), i: A.money(f.inc), o: A.money(f.out) }), cls: "" };
    if (a.chk) return { text: t("ov.stChk", { d: A.dateShort(a.chk) }), cls: "" };
    return null;
  }
  // NA-1 (Chris 2026-11-04, "Τι εννοεί Without an account;"): the
  // month's entries without an account. Twins of entries in an account
  // (bank.js noAccount: same day, kind, amount and FITID or text) can
  // go in one tap, the rest go into an account in one tap, and Entries
  // shows them one by one.
  function noAccSheet(mk) {
    var res = A.noAccount(mk);
    var dlg = A.makeDialog("bd-na-sheet", t("ov.noAcc"));
    dlg.classList.add("sheet");
    dlg.appendChild(el("p", "hint", t("ov.naWhat", { m: A.monthLabel(mk) })));
    function row(x, extra) {
      var li = el("li", "na-row");
      var m = el("span", "na-m");
      m.appendChild(el("span", "na-n", (x.n || x.ot || A.catName(x.c) || "\u2014")));
      m.appendChild(el("span", "na-s", A.dateShort(x.d) + (extra ? " · " + extra : "")));
      li.appendChild(m);
      li.appendChild(el("span", "na-v" + (x.k === "o" ? " neg" : ""), (x.k === "o" ? "\u2212" : "+") + A.money(x.a)));
      return li;
    }
    function list(items, fn) {
      var ul = el("ul", "na-list");
      items.slice(0, 40).forEach(function (it) { ul.appendChild(fn(it)); });
      if (items.length > 40) ul.appendChild(el("li", "hint", t("ov.naMore", { n: items.length - 40 })));
      return ul;
    }
    var done = function () { if (dlg.open) dlg.close(); };
    if (res.dups.length) {
      dlg.appendChild(el("h3", "na-h", t("ov.naDups", { n: res.dups.length })));
      dlg.appendChild(el("p", "hint", t("ov.naDupsHint")));
      dlg.appendChild(list(res.dups, function (p) { return row(p.x, t("ov.naIn", { a: A.accName(p.twin.ac) })); }));
      var ra = el("div", "dlg-actions");
      ra.appendChild(A.button(t("ov.naDrop", { n: res.dups.length }), "primary", function () {
        A.fixNoAcc(res.dups.map(function (p) { return { id: p.x.id, twin: p.twin.id }; }), null);
        done();
      }));
      dlg.appendChild(ra);
    }
    if (res.rest.length) {
      dlg.appendChild(el("h3", "na-h", t("ov.naRest", { n: res.rest.length })));
      dlg.appendChild(el("p", "hint", t("ov.naRestHint")));
      dlg.appendChild(list(res.rest, function (x) { return row(x, x.c ? A.catName(x.c) : ""); }));
      var sel = A.accSelect("");
      sel.firstChild.textContent = t("ov.naPick");
      dlg.appendChild(A.field(t("ov.naTo"), sel, "bd-na-acc"));
      var ma = el("div", "dlg-actions");
      var mv = A.button(t("ov.naMove", { n: res.rest.length }), "", function () {
        if (!sel.value) return;
        var mv0 = {};
        res.rest.forEach(function (x) { mv0[x.id] = sel.value; });
        A.fixNoAcc(null, mv0);
        done();
      });
      mv.disabled = true;
      sel.addEventListener("change", function () { mv.disabled = !sel.value; });
      ma.appendChild(mv);
      dlg.appendChild(ma);
    }
    if (!res.dups.length && !res.rest.length) dlg.appendChild(el("p", "", t("ov.naNone")));
    var close = el("div", "dlg-actions");
    if (A.showFilter) close.appendChild(A.button(t("ov.naList"), "", function () { done(); A.showFilter("a:"); }));
    close.appendChild(A.button(A.tt("dlg.close"), "", done));
    dlg.appendChild(close);
    A.showDialog(dlg);
  }
  // AC-1: an account's sheet: its balance, every detail line (bank and
  // Match, card cycle, investment), and big buttons for what people do
  // with an account. On phones it rises from the bottom.
  function accSheet(id) {
    var a = A.accs().filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    var dlg = A.makeDialog("bd-acc-sheet", a.n);
    dlg.classList.add("sheet");
    var bal = A.balNow(), iv = A.investInfo ? A.investInfo(a) : null, shown = iv && iv.val ? iv.val.v : bal[a.id];
    var big = el("div", "ov-big sh-big" + (shown < 0 ? " neg" : ""), A.money(shown, a.cur));
    dlg.appendChild(big);
    var det = el("div", "sh-det");
    var bnk = (D().bnk || []).filter(function (r) { return r && r.src !== "pp"; });
    bankLines(det, a, bnk);
    // CD-1: "This is a credit card" and its limit, right here
    if (A.bankCardRows) bnk.forEach(function (r) {
      if (r.ac === a.id) A.bankCardRows(det, r, function () { if (!dlg.open) return; dlg.close(); accSheet(a.id); });
    });
    cycleLines(det, a);
    investLines(det, a, iv, bal[a.id]);
    var mk = A.viewMk(), f = O.perAccount(TXV(), mk, [a.id]).by[a.id] || { inc: 0, out: 0 };
    if (f.inc || f.out) {
      var fl = el("div", "ov-bkline");
      fl.appendChild(el("span", "", t("ov.stFlow", { m: A.monthLabel(mk), i: A.money(f.inc), o: A.money(f.out) })));
      det.appendChild(fl);
    }
    if (a.chk) det.appendChild(el("div", "ov-bkline", t("ov.stChk", { d: A.dateShort(a.chk) })));
    if (det.childNodes.length) dlg.appendChild(det);
    // any button in a detail line (Match, Add interest) also closes the sheet
    det.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("button")) setTimeout(function () { dlg.close(); }, 0); });
    var grid = el("div", "sh-acts");
    function act(label, ic, fn, cls) {
      var b = el("button", "sh-act" + (cls ? " " + cls : ""));
      b.type = "button";
      if (ic && A.icon(ic)) { var s0 = el("span", "sh-ic"); s0.innerHTML = A.icon(ic); b.appendChild(s0); }
      b.appendChild(el("span", "", label));
      b.addEventListener("click", function () { dlg.close(); fn(); });
      grid.appendChild(b);
    }
    if (A.newTxIn) act(t("ov.shNew"), "plus", function () { A.newTxIn(a.id); }, "primary");
    act(t("ov.shEntries"), "lst", function () { A.showFilter("a:" + a.id); });
    if (A.updateBalance && !(a.ivk)) act(t("ov.shUpd"), "scale", function () { A.updateBalance(a.id); });
    if (A.xferFrom && A.accs().length > 1) act(t("ov.shXfer"), "xfer", function () { A.xferFrom(a.id); });
    if (A.accDialog) act(t("ov.shEdit"), "edit", function () { A.accDialog(a.id); });
    dlg.appendChild(grid);
    // auto-match: only for an account a bank fills, in its currency
    if (A.setAutoMatch && bnk.some(function (r) { return r.ac === a.id && r.bc === (a.cur || A.cur()); })) {
      var lab = el("label", "sh-auto");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!a.am;
      cb.addEventListener("change", function () { var on = cb.checked; dlg.close(); A.setAutoMatch(a.id, on); });
      lab.appendChild(cb);
      var tx = el("span");
      tx.appendChild(el("span", "sh-auto-t", t("ov.shAuto")));
      tx.appendChild(el("span", "hint", t("ov.shAutoHint")));
      lab.appendChild(tx);
      dlg.appendChild(lab);
    }
    var close = el("div", "dlg-actions");
    close.appendChild(A.button(A.tt("dlg.close"), "", function () { dlg.close(); }));
    dlg.appendChild(close);
    A.showDialog(dlg);
  }
  function cardAcc(card) {
    var list = A.accs();
    head(card, "acc", t("ov.acc"), list.length ? t("ov.open") : null, A.accountsDialog);
    if (!list.length) { hint(card, t("ov.accNone"), t("ov.accAdd"), A.accountsDialog); return; }
    var mk = A.viewMk(), tt = A.totals(mk);
    var flows = O.perAccount(TXV(), mk, list.map(function (a) { return a.id; }));
    var nw = P.netWorth(D(), A.today(), A.cur(), A.fx, A.investValue);
    var top = el("div", "ov-nw");
    top.appendChild(el("span", "ov-k", t("ov.nw")));
    top.appendChild(el("span", "ov-big" + (nw.tot < 0 ? " neg" : ""), A.money(nw.tot)));
    var all = { inc: tt.inc, out: tt.out };
    var tl = el("span", "ov-k ov-mk", t("ov.flowAll", { m: A.monthLabel(mk) }));
    top.appendChild(tl);
    var fl = flowLine(all);
    fl.setAttribute("aria-label", t("ov.flowAll", { m: A.monthLabel(mk) }) + ": " + flowAria(all));
    top.appendChild(fl);
    card.appendChild(top);
    var ps = A.passiveStats ? A.passiveStats() : null;     // PI-1
    if (ps) card.appendChild(el("p", "hint ov-pi", ps.pct === null ? t("ov.piNoOut", { m: A.money(ps.avg) }) : t("ov.pi", { m: A.money(ps.avg), p: ps.pct })));
    var bal = A.balNow();
    var bnk = (D().bnk || []).filter(function (r) { return r && r.src !== "pp"; });
    // AC-1: what I have and owe, then the accounts in groups, each one a
    // row with its balance and one line of status; a tap opens its sheet.
    var ho = O.haveOwe(list.map(function (a) { return nw.bal[a.id] === undefined ? null : mainVal(a, nw.bal[a.id]); }));
    if (ho.owe) {
      var hoL = el("div", "ov-ho");
      hoL.appendChild(el("span", "ov-ho-h", t("ov.have", { a: A.money(ho.have) })));
      hoL.appendChild(el("span", "ov-ho-o", t("ov.owe", { a: A.money(ho.owe) })));
      top.appendChild(hoL);
    }
    var groups = {};
    list.forEach(function (a) { var g = O.accGroup(a, bnk); (groups[g] = groups[g] || []).push(a); });
    var gIds = O.GROUPS.filter(function (g) { return groups[g]; });
    gIds.forEach(function (g) {
      if (gIds.length > 1) {
        var gh = el("div", "ov-gh");
        gh.appendChild(el("span", "", t(g === "cash" ? "ov.gCash" : g === "card" ? "ov.gCard" : "ov.gInv")));
        var gt = 0, gMiss = false;
        groups[g].forEach(function (a) { var v = mainVal(a, nw.bal[a.id]); if (v === null) gMiss = true; else gt += v; });
        if (!gMiss) gh.appendChild(el("span", "ov-gh-v" + (gt < 0 ? " neg" : ""), A.money(gt)));
        card.appendChild(gh);
      }
      var ul = el("ul", "ov-rows ov-accs");
      groups[g].forEach(function (a) {
        var iv = A.investInfo ? A.investInfo(a) : null, shown = iv && iv.val ? iv.val.v : bal[a.id];
        var li = el("li");
        var b = el("button", "ov-row ov-acc");
        b.type = "button";
        b.appendChild(A.swatch(a.col));
        var mid = el("span", "ov-acc-m");
        mid.appendChild(el("span", "ov-acc-n", a.n));
        var st = statusOf(a, iv, bal[a.id], flows.by[a.id] || { inc: 0, out: 0 }, mk, bnk);
        if (st) mid.appendChild(el("span", "ov-acc-s" + (st.cls ? " " + st.cls : ""), st.text));
        b.appendChild(mid);
        var bv = A.money(shown, a.cur);
        b.appendChild(el("span", "ov-v ov-acc-v" + (shown < 0 ? " neg" : ""), bv));
        b.setAttribute("aria-label", a.n + ", " + bv + (st ? ", " + st.text : "") + ". " + t("ov.sheetTip", { a: a.n }));
        b.addEventListener("click", function () { accSheet(a.id); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      card.appendChild(ul);
    });
    if (flows.none.inc || flows.none.out) {
      // NA-1: a tap shows these entries, the duplicates and a way out
      var nl = el("ul", "ov-rows ov-accs"), nli = el("li"), nb0 = el(A.noAccount ? "button" : "div", "ov-row ov-acc");
      nb0.appendChild(A.swatch(8));
      var nm = el("span", "ov-acc-m"), nd = A.noAccount ? A.noAccount(mk) : null;
      nm.appendChild(el("span", "ov-acc-n", t("ov.noAcc")));
      var nst = t("ov.stFlow", { m: A.monthLabel(mk), i: A.money(flows.none.inc), o: A.money(flows.none.out) });
      if (nd && nd.dups.length) nst = t("ov.naDupsS", { n: nd.dups.length }) + " · " + nst;
      nm.appendChild(el("span", "ov-acc-s" + (nd && nd.dups.length ? " warn" : ""), nst));
      nb0.appendChild(nm);
      if (A.noAccount) {
        nb0.type = "button";
        nb0.setAttribute("aria-label", t("ov.noAcc") + ", " + nst + ". " + t("ov.naTip"));
        nb0.addEventListener("click", function () { noAccSheet(mk); });
      }
      nli.appendChild(nb0);
      nl.appendChild(nli);
      card.appendChild(nl);
    }
    // banks linked, none filling an account: say where that is set
    if (bnk.length && !bnk.some(function (r) { return r.ac; }) && A.banksOpen) {
      var um = el("p", "hint ov-bk-um", t("ov.bkUnmapped") + " ");
      var go = el("button", "link-btn", t("ov.bkBanks"));
      go.type = "button";
      go.addEventListener("click", A.banksOpen);
      um.appendChild(go);
      card.appendChild(um);
    }
    // New account (a wallet, cash) and, with banks linked, an update now.
    var acts = el("div", "ov-acts");
    var bk = A.bankState ? A.bankState() : null;
    if (bk && bk.linked) {
      var ub = el("button", "mini", bk.busy ? t("ov.bkBusy") : t("ov.bkNow"));
      ub.type = "button";
      ub.disabled = bk.busy || !bk.reach;
      ub.addEventListener("click", function () {
        ub.disabled = true;
        ub.textContent = t("ov.bkBusy");
        A.bankRefresh();
      });
      acts.appendChild(ub);
      acts.appendChild(el("span", "hint ov-bk-when", !bk.reach ? t("ov.bkWeb") : bk.last ? t("ov.bkLast", { d: A.whenShort(bk.last) }) : t("ov.bkNever")));
    }
    if (A.accDialog) {
      var nb = el("button", "mini", t("ov.accNew"));
      nb.type = "button";
      nb.addEventListener("click", function () { A.accDialog(null); });
      acts.appendChild(nb);
    }
    if (acts.childNodes.length) card.appendChild(acts);
  }

  // ---------- limits ----------
  function ring(pct, st) {
    var R = 20, C = 2 * Math.PI * R;
    var svg = A.sv("svg", { viewBox: "0 0 48 48", width: 48, height: 48, "class": "ov-ring " + st, "aria-hidden": "true" });
    svg.appendChild(A.sv("circle", { cx: 24, cy: 24, r: R, "class": "ov-ring-bg" }));
    var f = Math.max(0, Math.min(1, pct / 100));
    if (f > 0) svg.appendChild(A.sv("circle", { cx: 24, cy: 24, r: R, "class": "ov-ring-fg",
      "stroke-dasharray": (C * f).toFixed(2) + " " + C.toFixed(2), transform: "rotate(-90 24 24)" }));
    svg.appendChild(A.svText(24, 28, Math.min(pct, 999) + "%", "ov-ring-t", "middle"));
    return svg;
  }
  function cardLim(card) {
    head(card, "lim", t("ov.lim"), t("ov.open"), function () { A.setTab("limits"); });
    var tt = A.totals(A.viewMk()), items = [];
    var all = A.limitOf("all");
    A.cats().forEach(function (c) {
      if (c.k !== "o") return;
      var l = A.limitOf(c.id);
      if (l) items.push({ name: c.name, col: c.col, spent: tt.byCat["o:" + c.id] || 0, limit: l });
    });
    A.budgets().forEach(function (b) { items.push(b); });   // flexible budgets running today (C3)
    items.sort(function (x, y) { return y.spent * x.limit - x.spent * y.limit || x.name.localeCompare(y.name); });
    items = items.slice(0, all ? 3 : 4);
    if (all) items.unshift({ name: t("ov.limAll"), col: null, spent: tt.out, limit: all });
    if (!items.length) { hint(card, t("ov.limNone"), t("ov.limSet"), function () { A.setTab("limits"); }); return; }
    var grid = el("div", "ov-rings");
    items.forEach(function (it) {
      var pct = Math.round(it.spent * 100 / it.limit), st = A.limitState(it.spent, it.limit);
      var b = el("button", "ov-ring-b");
      b.type = "button";
      var left = it.limit - it.spent;
      var sub = left >= 0 ? t("ov.limLeft", { a: A.money(left) }) : t("ov.limOver", { a: A.money(-left) });
      b.setAttribute("aria-label", it.name + ": " + pct + "%, " + sub);
      b.appendChild(ring(pct, st));
      var txt = el("span", "ov-ring-l");
      txt.appendChild(el("span", "ov-n", it.name));
      txt.appendChild(el("span", "ov-s " + st, sub));
      b.appendChild(txt);
      b.addEventListener("click", function () { A.setTab("limits"); });
      grid.appendChild(b);
    });
    card.appendChild(grid);
  }

  // ---------- next 7 days ----------
  function cardUp(card) {
    head(card, "up", t("ov.up"), t("ov.open"), function () { A.setTab("rec"); });
    var today = A.today(), tomorrow = P.addDays(today, 1);
    var list = O.upcoming(D(), today, P.addDays(today, 6));
    if (!list.length) { hint(card, t("ov.upNone")); return; }
    var inc = 0, out = 0;
    var ul = el("ul", "ov-rows");
    list.forEach(function (o) {
      if (o.k === "i") inc += o.a; else out += o.a;
      var li = el("li");
      var b = el("button", "ov-row");
      b.type = "button";
      var when = o.d === today ? t("ov.today") : o.d === tomorrow ? t("ov.tomorrow") : A.dayLabel(o.d);
      var name = o.n || A.catName(o.c);
      b.setAttribute("aria-label", when + ", " + name + ", " + (o.k === "i" ? "+" : "−") + A.money(o.a));
      b.appendChild(A.swatch(A.catCol(o.c)));
      var mid = el("span", "ov-n");
      mid.appendChild(el("span", "ov-when", when));
      mid.appendChild(el("span", "", name));
      b.appendChild(mid);
      b.appendChild(el("span", "ov-v" + (o.k === "i" ? " in" : ""), (o.k === "i" ? "+" : "−") + A.money(o.a)));
      b.addEventListener("click", function () { A.setTab("rec"); A.recDialog(o.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    card.appendChild(ul);
    card.appendChild(el("p", "hint ov-foot", t("ov.upSum", { i: A.money(inc), o: A.money(out) })));
  }

  // ---------- loans and debts (budget/loansui.js) ----------
  function cardLoan(card) {
    head(card, "loan", t("ov.loan"), t("ov.open"), function () { A.setTab("plan"); });
    A.loansCard(card);
  }

  // ---------- savings goals ----------
  function goalSaved(g) {
    if (!g.ac) return g.sv;
    var nw = A.accBalanceMain(g.ac);
    return nw === null ? g.sv : nw;
  }
  function cardGoal(card) {
    var goals = D().goal || [];
    head(card, "goal", t("ov.goal"), goals.length ? t("ov.open") : null, function () { A.setTab("plan"); });
    if (!goals.length) { hint(card, t("ov.goalNone"), A.goalDialog ? t("ov.goalNew") : null, function () { A.goalDialog(null); }); return; }
    var list = goals.slice().sort(function (a, b) {
      var x = a.d || "9999", y = b.d || "9999";
      return x < y ? -1 : x > y ? 1 : a.n.localeCompare(b.n);
    }).slice(0, 4);
    list.forEach(function (g) {
      var st = P.goalStatus(g, goalSaved(g), A.today());
      var b = el("button", "ov-goal");
      b.type = "button";
      b.addEventListener("click", function () { A.setTab("plan"); });
      var top = el("span", "ov-goal-top");
      top.appendChild(A.swatch(g.col));
      top.appendChild(el("span", "ov-n", g.n));
      top.appendChild(el("span", "ov-v", st.pct + "%"));
      b.appendChild(top);
      var bar = el("span", "bar " + (st.late ? "over" : "ok"));
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(st.pct));
      bar.setAttribute("aria-label", g.n + ": " + st.pct + "%");
      var f = el("span");
      f.style.width = st.pct + "%";
      f.style.background = "var(--c" + g.col + ")";
      bar.appendChild(f);
      b.appendChild(bar);
      b.appendChild(el("span", "ov-s", A.money(st.saved) + " / " + A.money(g.t)));
      card.appendChild(b);
    });
  }

  // ---------- where the money went ----------
  // PL-2: the month's income, expenses and difference per area; the
  // entries without one are a tap away (Entries › Without an area).
  function cardArea(card) {
    var list = A.areas();
    head(card, "area", t("ov.area"), t("ov.open"), A.areasDialog);
    var mk = A.viewMk(), f = O.perArea(D().tx, mk, list.map(function (a) { return a.id; }));
    card.appendChild(el("p", "ov-k ov-mk", t("ov.flowAll", { m: A.monthLabel(mk) })));
    var ul = el("ul", "ov-rows ov-accs");
    function row(name, col, fl, filter) {
      var li = el("li");
      var b = el("button", "ov-row ov-acc");
      b.type = "button";
      if (col !== null) b.appendChild(A.swatch(col));
      var mid = el("span", "ov-acc-m");
      mid.appendChild(el("span", "ov-acc-n", name));
      var line = flowLine(fl);
      mid.appendChild(line);
      b.appendChild(mid);
      b.setAttribute("aria-label", name + ": " + flowAria(fl));
      b.addEventListener("click", function () { A.showFilter(filter); });
      li.appendChild(b);
      ul.appendChild(li);
    }
    list.forEach(function (a) { row(a.n, a.col, f.by[a.id], "r:" + a.id); });
    if (f.none.inc || f.none.out) row(t("ov.areaNone"), null, f.none, "r:");
    card.appendChild(ul);
    yearAfterShared(card, list, mk);
    wholePicture(card, list, mk);
  }
  // AR-VIEW: business, personal and the total for the year so far (only
  // when an area is marked personal).
  function wholePicture(card, list, mk) {
    if (!list.some(function (a) { return a.ps === 1; })) return;
    var W = O.wholeYear(D().tx, D().xfer, D().acc, mk, list);
    var sm = (A.monthLabel(W.from) || "").split(" ")[0], em = A.monthLabel(W.to) || "";
    card.appendChild(el("p", "ov-k ov-mk", t("ov.whole", { m: sm + "–" + em })));
    function signed(v) { return (v < 0 ? "−" : "+") + A.money(Math.abs(v)); }
    var ul = el("ul", "ov-rows ov-ay ov-whole");
    function row(name, f, res, cls) {
      var li = el("li", "ov-ay-row" + (cls ? " " + cls : ""));
      var mid = el("span", "ov-acc-m");
      mid.appendChild(el("span", "ov-acc-n", name));
      var line = el("span", "ov-flow");
      if (f) line.appendChild(el("span", "", t("ov.wFlow", { i: A.money(f.inc), o: A.money(f.out) })));
      line.appendChild(el("span", res < 0 ? "neg" : "pos", "= " + signed(res)));
      mid.appendChild(line);
      li.appendChild(mid);
      li.setAttribute("aria-label", name + ": " + signed(res));
      ul.appendChild(li);
    }
    row(t("ov.wBus"), W.business, W.business.after);
    row(t("ov.wPer"), W.personal, W.personal.net);
    if (W.none.inc || W.none.out) row(t("ov.wNone"), W.none, W.none.net);
    row(t("ov.wTot"), null, W.total, "ov-w-tot");
    card.appendChild(ul);
    if (W.draws) card.appendChild(el("p", "hint", t("ov.wDraw", { a: A.money(W.draws) })));
    if (W.back) card.appendChild(el("p", "hint", t("ov.wBack", { a: A.money(W.back) })));
    if (W.draws || W.back) card.appendChild(el("p", "hint", t("ov.wHint")));
  }
  // AR-INV: the year so far per area, after its share of the shared
  // costs (only when an area holds them and some area has a share).
  function yearAfterShared(card, list, mk) {
    var Y = O.areaYear(D().tx, mk, list);
    if (!Y.shared || !Y.rows.some(function (r) { return r.share; })) return;
    var name = {}, per = {};
    list.forEach(function (a) { name[a.id] = a.n; if (a.ps === 1) per[a.id] = 1; });
    Y.rows = Y.rows.filter(function (r) { return !per[r.id]; });   // AR-VIEW: personal areas are in the whole picture
    var sm = (A.monthLabel(Y.from) || "").split(" ")[0], em = A.monthLabel(Y.to) || "";
    card.appendChild(el("p", "ov-k ov-mk", t("ov.areaYear", { m: sm + "–" + em })));
    card.appendChild(el("p", "hint ov-ay-cost", t("ov.areaShared", { n: name[Y.shared.id] || "", a: (Y.shared.cost < 0 ? "−" : "") + A.money(Math.abs(Y.shared.cost)) })));
    var ul = el("ul", "ov-rows ov-ay");
    function signed(v) { return (v < 0 ? "−" : "+") + A.money(Math.abs(v)); }
    Y.rows.forEach(function (r) {
      var li = el("li", "ov-ay-row");
      var mid = el("span", "ov-acc-m");
      mid.appendChild(el("span", "ov-acc-n", name[r.id] || ""));
      var line = el("span", "ov-flow");
      line.appendChild(el("span", "", t("ov.ayNet", { a: signed(r.net) })));
      if (r.share) line.appendChild(el("span", "", t("ov.ayShare", { a: "−" + A.money(Math.abs(r.share)) })));
      line.appendChild(el("span", r.after < 0 ? "neg" : "pos", "= " + signed(r.after)));
      mid.appendChild(line);
      li.appendChild(mid);
      li.setAttribute("aria-label", t("ov.ayAria", { n: name[r.id] || "", a: signed(r.net), s: A.money(Math.abs(r.share)), r: signed(r.after) }));
      ul.appendChild(li);
    });
    card.appendChild(ul);
    if (Y.left) card.appendChild(el("p", "hint", t("ov.ayLeft", { a: A.money(Math.abs(Y.left)) })));
  }
  function cardTop(card) {
    var mk = A.viewMk();
    head(card, "top", t("ov.top"), t("ov.open"), function () { A.setTab("charts"); });
    var list = O.topCats(A.rolledTx ? A.rolledTx() : D().tx, mk, 5);
    if (!list.length) { hint(card, t("ov.topNone")); return; }
    var ul = el("ul", "ov-rows");
    list.forEach(function (r) {
      var name = A.catName(r.c);
      var li = el("li");
      var b = el("button", "ov-row ov-toprow");
      b.type = "button";
      var chg = r.pct === null ? t("ov.new.aria") : r.pct >= 0 ? t("ov.up%", { p: r.pct }) : t("ov.down%", { p: -r.pct });
      b.setAttribute("aria-label", name + ", " + A.money(r.a) + ", " + chg);
      var line = el("span", "ov-top-l");
      line.appendChild(A.swatch(A.catCol(r.c)));
      line.appendChild(el("span", "ov-n", name));
      var chip = el("span", "ov-chip " + (r.pct === null ? "new" : r.pct > 0 ? "up" : r.pct < 0 ? "down" : "flat"),
                    r.pct === null ? t("ov.new") : (r.pct > 0 ? "▲ " : r.pct < 0 ? "▼ " : "") + Math.abs(r.pct) + "%");
      chip.title = chg;
      line.appendChild(chip);
      line.appendChild(el("span", "ov-v", A.money(r.a)));
      b.appendChild(line);
      var bar = el("span", "rank-bar");
      var f = el("span");
      f.style.width = (r.a * 100 / list[0].a) + "%";
      f.style.background = "var(--c" + A.catCol(r.c) + ")";
      bar.appendChild(f);
      b.appendChild(bar);
      b.addEventListener("click", function () { A.showFilter("c:" + r.c); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    card.appendChild(ul);
  }

  // ---------- edit: which cards, in what order ----------
  function editDialog() {
    var list = O.cardList(D().set.ov);
    var dlg = A.makeDialog("bd-ov", t("ov.edit"));
    dlg.appendChild(el("p", "hint", t("ov.editHint")));
    var ul = el("ul", "ov-edit-list");
    dlg.appendChild(ul);
    function draw(focusId, focusDir) {
      ul.innerHTML = "";
      list.forEach(function (c, i) {
        if (!c.known) return;   // a newer Budget's card: kept, not shown here
        var li = el("li");
        var id = "ov-cb-" + c.id;
        var cb = el("input");
        cb.type = "checkbox";
        cb.id = id;
        cb.checked = c.on;
        cb.addEventListener("change", function () { c.on = cb.checked; });
        var lab = el("label", "", t(TITLE[c.id]));
        lab.setAttribute("for", id);
        li.appendChild(cb);
        li.appendChild(lab);
        [["up", -1, "ov.upBtn", "▲"], ["down", 1, "ov.downBtn", "▼"]].forEach(function (d) {
          var b = el("button", "mini ov-mv", d[3]);
          b.type = "button";
          b.setAttribute("aria-label", t(d[2], { c: t(TITLE[c.id]) }));
          var j = i + d[1];
          b.disabled = j < 0 || j >= list.length;
          b.addEventListener("click", function () {
            var tmp = list[j]; list[j] = list[i]; list[i] = tmp;
            draw(c.id, d[0]);
          });
          li.appendChild(b);
          if (focusId === c.id && focusDir === d[0]) setTimeout(function () { (b.disabled ? cb : b).focus(); }, 0);
        });
        ul.appendChild(li);
      });
    }
    draw();
    var row = el("div", "dlg-actions");
    row.appendChild(A.button(t("ov.reset"), "", function () { list = O.cardList(""); draw(); }));
    row.appendChild(A.button(A.tt("dlg.cancel"), "", function () { dlg.close(); }));
    row.appendChild(A.button(A.tt("dlg.save"), "primary", function () {
      var v = O.cardString(list), set = D().set;
      if (v === O.cardString(O.cardList(""))) v = "";
      if ((set.ov || "") !== v) {
        if (v) set.ov = v; else delete set.ov;
        set.m = A.stamp(set.m);
        A.commit();
        A.renderAll();
        A.showToast(t("ov.saveDone"));
      }
      dlg.close();
    }));
    dlg.appendChild(row);
    A.showDialog(dlg);
  }

  root.OrosBudgetOverviewUI = {
    init: function (api) { A = api; },
    render: function (box) { if (A) render(box); },
    t: function (k, p) { return A ? t(k, p) : k; }
  };
})(typeof window !== "undefined" ? window : this);
