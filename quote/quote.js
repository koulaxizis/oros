// ============================================================
// orOS Quote — App logic (v0.1.0)
// -------------------------------------------------------------
// Πρώτη έκδοση: sync-first native ήπιος μεταφοράς της beta
// "Offer" εφαρμογής (clean-room rewrite — τα beta αρχεία
// χρησιμοποιήθηκαν μόνο ως λειτουργική αναφορά).
//
// ΑΡΧΙΤΕΚΤΟΝΙΚΗ (ίδια φιλοσοφία με kanban v0.6.0):
//   state = {
//     ver: 1, om: <σειρά λιστών>, deleted: { id: ts },
//     activeQuoteId: <string>,          // DEVICE-LOCAL — δεν ταξιδεύει
//     quotes:   [ offer ],               // whole-offer LWW, items μέσα
//     clients:  [ client ],
//     templates:[ template ]
//   }
//   - Ύφεση ενός tombstone map για ΟΛΟΥΣ τους τύπους οντοτήτων
//   - Computed totals: ΠΟΤΕ δεν αποθηκεύονται (pure functions) —
//     κανένα sync merge δεν μπορεί να δημιουργήσει αριθμητική
//     αντίφαση. Μόνο inputs (qty, price, disc, vat) αποθηκεύονται.
//   - Αρίθμηση OFF-YYYY-NNN: recovery-based scan στο max —
//     κανένας synced counter.
//
// Ενότητες:
//   1. Σταθερές, i18n, helpers
//   2. Μοντέλο δεδομένων, αποθήκευση, migration
//   3. Merge engine (cross-device)
//   4. Υπολογισμοί (pure functions)
//   5. Editor (create tab)
//   6. Line items + δόσεις UI
//   7. Clients (dropdown + dialog)
//   8. Templates
//   9. Λίστα προσφορών (list tab) + φίλτρα
//  10. Export (PDF via jsPDF + NotoSans, print fallback) + send
//  11. Toast
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-quote-data";
  var DATA_VER = 1;
  var TOMB_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;   // 30 ημέρες

  // ⚠️ PATH ASSUMPTION — επιβεβαίωση από τον χρήστη απαιτείται
  var VENDOR_JSPDF_PATH = "../vendor/jspdf.umd.min.js";
  var VENDOR_FONT_PATH  = "../vendor/NotoSans-Regular.ttf";

  var STATUSES = ["draft", "sent", "accepted", "rejected", "expired"];

  // ---------- 1. Σταθερές, i18n, helpers ----------
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "tab.create":            "Create",
      "tab.list":              "Quotes",
      "search.ph":             "Search…",
      "search.clear":          "Clear search",
      "filter.status":         "Filter by status",
      "filter.empty":          "No statuses selected.",
      "status.draft":         "Draft",
      "status.sent":          "Sent",
      "status.accepted":      "Accepted",
      "status.rejected":      "Rejected",
      "status.expired":       "Expired",
      "client.new":            "New client",
      "client.select":         "Select client",
      "client.none":          "No client",
      "client.edit":          "Client Details",
      "client.name":          "Name",
      "client.email":         "Email",
      "client.phone":         "Phone",
      "client.address":       "Address",
      "client.tax_id":        "Tax ID / VAT",
      "client.delete":        "Delete",
      "client.none_listed":   "No clients yet — create one below.",
      "offer.number":         "Quote #",
      "offer.regenerate":     "Regenerate number",
      "offer.date":           "Date",
      "offer.due_date":       "Due",
      "offer.status":         "Status",
      "offer.currency":       "Currency",
      "offer.notes":          "Notes",
      "items.title":          "Line Items",
      "items.add":            "Add item",
      "items.desc":           "Description",
      "items.code":           "Code/SKU",
      "items.qty":            "Qty",
      "items.unit_price":     "Unit Price",
      "items.disc":           "Disc %",
      "items.vat":            "VAT %",
      "items.notes":          "Notes",
      "items.del":            "Remove",
      "items.empty":          "No items — add your first line item.",
      "totals.subtotal":      "Subtotal",
      "totals.discount":      "Discount (%)",
      "totals.vat":           "VAT",
      "totals.total":         "Total",
      "inst.title":           "Instalments",
      "inst.count":           "Count",
      "inst.generate":        "Generate",
      "inst.date":            "Date",
      "inst.amount":          "Amount",
      "inst.sum":            "Sum:",
      "inst.mismatch":        "does not match total",
      "inst.match":          "matches total",
      "payment.title":        "Payment Terms",
      "payment.bank":         "Bank Transfer",
      "payment.paypal":       "PayPal",
      "payment.iris":         "IRIS",
      "payment.cash":         "Cash",
      "actions.save":         "Save",
      "actions.save_template":"Save as Template",
      "actions.duplicate":   "Duplicate",
      "actions.delete":       "Delete",
      "actions.export_pdf":   "Export PDF",
      "actions.send":         "Send via email",
      "send.subject":         "Quote",
      "list.empty_title":     "No quotes yet",
      "list.empty_hint":      "Create your first quote in the Create tab.",
      "list.no_match":        "No quotes match the current search/filters.",
      "list.open":            "Open",
      "templates.manage":     "Template Library",
      "templates.use":        "Use",
      "templates.empty":      "No templates saved yet.",
      "templates.close":      "Close",
      "save":                 "Save",
      "close":                "Close",
      "toast.saved":          "Quote saved",
      "toast.deleted":        "Quote deleted",
      "toast.duplicated":     "Duplicated — save to persist",
      "toast.template_saved": "Template saved",
      "toast.template_used":  "Template loaded",
      "toast.client_saved":   "Client saved",
      "toast.client_deleted": "Client deleted",
      "toast.exported":       "Export ready",
      "confirm.delete":       "Delete this quote?",
      "confirm.client_del":   "Delete this client?",
      "template.name_ph":     "Template name",
      "pdf.header_client":    "Quote for",
      "pdf.page":             "Page 1",
	  "app.title_short":      "Quote",
      "paypresets.edit":      "Edit payment presets",
      "paypresets.hint":      "Click a preset to insert its text into the offer. Click the pencil to customize.",
      "paypresets.title":     "Payment Presets",
      "toast.paypresets_saved": "Payment presets saved",
      "toast.sync_replaced":   "This quote was deleted on another device"
    },
    el: {
      "tab.create":            "Δημιουργία",
      "tab.list":              "Προσφορές",
      "search.ph":             "Αναζήτηση…",
      "search.clear":          "Καθαρισμός αναζήτησης",
      "filter.status":         "Φίλτρο κατά κατάσταση",
      "filter.empty":          "Δεν έχουν επιλεγεί καταστάσεις.",
      "status.draft":         "Πρόχειρη",
      "status.sent":          "Απεστάλη",
      "status.accepted":      "Αποδεκτή",
      "status.rejected":      "Απορρίφθηκε",
      "status.expired":       "Έληξε",
      "client.new":            "Νέος πελάτης",
      "client.select":         "Επιλογή πελάτη",
      "client.none":          "Χωρίς πελάτη",
      "client.edit":          "Στοιχεία πελάτη",
      "client.name":          "Όνομα",
      "client.email":         "Email",
      "client.phone":         "Τηλέφωνο",
      "client.address":       "Διεύθυνση",
      "client.tax_id":        "ΑΦΜ / ΦΠΑ",
      "client.delete":        "Διαγραφή",
      "client.none_listed":   "Δεν υπάρχουν πελάτες — δημιουργία παρακάτω.",
      "offer.number":         "Αρ. Προσφοράς",
      "offer.regenerate":     "Ανανέωση αριθμού",
      "offer.date":           "Ημερομηνία",
      "offer.due_date":       "Προθεσμία",
      "offer.status":         "Κατάσταση",
      "offer.currency":       "Νόμισμα",
      "offer.notes":          "Σημειώσεις",
      "items.title":          "Στοιχεία",
      "items.add":            "Προσθήκη",
      "items.desc":           "Περιγραφή",
      "items.code":           "Κωδικός/SKU",
      "items.qty":            "Ποσότητα",
      "items.unit_price":     "Τιμή Μονάδας",
      "items.disc":           "Έκδ %",
      "items.vat":            "ΦΠΑ %",
      "items.notes":          "Σημείωση",
      "items.del":            "Αφαίρεση",
      "items.empty":          "Δεν υπάρχουν στοιχεία — πρόσθεσε την πρώτη γραμμή.",
      "totals.subtotal":      "Υποσύνολο",
      "totals.discount":      "Έκπτωση (%)",
      "totals.vat":           "ΦΠΑ",
      "totals.total":         "Σύνολο",
      "inst.title":           "Δόσεις",
      "inst.count":           "Πλήθος",
      "inst.generate":        "Δημιουργία",
      "inst.date":            "Ημερομηνία",
      "inst.amount":          "Ποσό",
      "inst.sum":            "Σύνολο δόσεων:",
      "inst.mismatch":        "δεν αντιστοιχεί στο σύνολο",
      "inst.match":          "αντιστοιχεί στο σύνολο",
      "payment.title":        "Όροι Πληρωμής",
      "payment.bank":         "Τραπεζική μεταφορά",
      "payment.paypal":       "PayPal",
      "payment.iris":         "IRIS",
      "payment.cash":         "Μετρητά",
      "actions.save":         "Αποθήκευση",
      "actions.save_template":"Αποθήκευση ως Πρότυπο",
      "actions.duplicate":    "Αντιγραφή",
      "actions.delete":       "Διαγραφή",
      "actions.export_pdf":   "Εξαγωγή PDF",
      "actions.send":         "Αποστολή μέσω email",
      "send.subject":         "Προσφορά",
      "list.empty_title":     "Δεν υπάρχουν προσφορές",
      "list.empty_hint":      "Δημιούργησε την πρώτη σου προσφορά στη καρτέλα Δημιουργία.",
      "list.no_match":        "Καμία προσφορά δεν ταιριάζει με την αναζήτηση/φίλτρα.",
      "list.open":            "Άνοιγμα",
      "templates.manage":     "Βιβλιοθήκη Προτύπων",
      "templates.use":        "Χρήση",
      "templates.empty":      "Δεν υπάρχουν αποθηκευμένα πρότυπα.",
      "templates.close":      "Κλείσιμο",
      "save":                 "Αποθήκευση",
      "close":                "Κλείσιμο",
      "toast.saved":          "Η προσφορά αποθηκεύτηκε",
      "toast.deleted":        "Η προσφορά διαγράφηκε",
      "toast.duplicated":     "Αντιγράφηκε — αποθήκευσε για οριστικοποίηση",
      "toast.template_saved": "Το πρότυπο αποθηκεύτηκε",
      "toast.template_used":  "Το πρότυπο φορτώθηκε",
      "toast.client_saved":   "Ο πελάτης αποθηκεύτηκε",
      "toast.client_deleted": "Ο πελάτης διαγράφηκε",
      "toast.exported":       "Έτοιμο για εξαγωγή",
      "confirm.delete":       "Διαγραφή αυτής της προσφοράς;",
      "confirm.client_del":   "Διαγραφή αυτού του πελάτη;",
      "template.name_ph":     "Όνομα προτύπου",
      "pdf.header_client":    "Προσφορά για",
      "pdf.page":             "Σελίδα 1",
	  "app.title_short":      "Προσφορά",
      "paypresets.edit":      "Επεξεργασία presets πληρωμής",
      "paypresets.hint":      "Πάτησε ένα preset για να εισαχθεί το κείμενό του στην προσφορά. Με το μολύβι το προσαρμόζεις.",
      "paypresets.title":     "Presets Πληρωμής",
      "toast.paypresets_saved": "Τα presets πληρωμής αποθηκεύτηκαν",
      "toast.sync_replaced":   "Αυτή η προσφορά διαγράφηκε σε άλλη συσκευή"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key] :
      (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- 2. Μοντέλο δεδομένων, αποθήκευση, migration ----------
  var state = null;
  var renderQueued = false;
  var cur = null;          // τρέχουσα προσφορά στο editor (draft ή reference σε state.quotes)
  var curIsDraft = true;   // true → δεν έχει μπει ακόμα στο state.quotes

  function touch(ent) { if (ent) ent.mtime = Date.now(); }

  // Decimal parsing: δέχεται "1.234,50", "1,234.50", "1234.5", "1.5"
  function parseNum(s) {
    if (typeof s === "number") return isFinite(s) ? s : 0;
    var v = String(s == null ? "" : s).trim();
    if (!v) return 0;
    v = v.replace(/\s+/g, "");
    if (v.indexOf(",") !== -1 && v.indexOf(".") !== -1) {
      // και τα δύο separators: το τελευταίο είναι decimal
      v = v.lastIndexOf(",") > v.lastIndexOf(".")
        ? v.replace(/\./g, "").replace(",", ".")
        : v.replace(/,/g, "");
    } else if (v.indexOf(",") !== -1) {
      v = v.replace(",", ".");
    }
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function money(n, currency) {
    var sym = currency === "USD" ? "$" : "€";
    var s = Math.abs(n).toFixed(2);
    if (LANG === "el") s = s.replace(".", ",");
    return (n < 0 ? "-" : "") + sym + " " + s;
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var p = iso.split("-");
    if (p.length !== 3) return iso;
    return LANG === "el" ? p[2] + "/" + p[1] + "/" + p[0]
                         : p[1] + "/" + p[2] + "/" + p[0];
  }

  function newItemObj() {
    return { id: uid(), code: "", desc: "", qty: 1, price: 0,
             disc: 0, vat: 24, note: "" };
  }

  function newQuoteObj() {
    var today = new Date();
    var m = today.getMonth() + 1, d = today.getDate();
    return {
      id: uid(),
      num: nextNumber(),
      clientId: null,
      status: "draft",
      date: today.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d,
      dueDate: "",
      currency: "EUR",
      items: [],
      gDisc: 0,
      payment: "",
      notes: "",
      instalments: [],
      mtime: 0,
      pos: 0
    };
  }

  // Recovery-based αρίθμηση: scan στο max του OFF-YYYY-NNN τρέχοντος έτους.
  // Κανένας synced counter — δύο συσκευές offline παράγουν το ίδιο Ν,
  // το debate το κερδίζει όποιο save-αρεται πρώτο (αποδεκτό, όπως ο
  // manual αριθμός σε χειρόγραφη προσφορά).
  function nextNumber() {
    var year = new Date().getFullYear();
    var re = /^OFF-(\d{4})-(\d+)$/;
    var max = 0;
    (state && state.quotes || []).forEach(function (q) {
      var m = re.exec(q.num || "");
      if (m && parseInt(m[1], 10) === year) {
        var n = parseInt(m[2], 10);
        if (n > max) max = n;
      }
    });
    return "OFF-" + year + "-" + ("000" + (max + 1)).slice(-3);
  }

  function newClientObj(name) {
    return { id: uid(), name: name || "", email: "", phone: "",
             address: "", taxId: "", mtime: 0, pos: state ? state.clients.length : 0 };
  }
  
    // --- Synced payment presets (per-user, LWW, deterministic ids) ---
  var PAY_METHODS = ["bank", "paypal", "iris", "cash"];
  var PM_DEFAULTS = {
    en: {
      bank:  "Bank transfer\nIBAN: \nBeneficiary: ",
      paypal: "PayPal: ",
      iris:  "IRIS payments: ",
      cash:  "Cash on delivery"
    },
    el: {
      bank:  "Τραπεζική μεταφορά\nIBAN: \nΔικαιούχος: ",
      paypal: "PayPal: ",
      iris:  "Πληρωμές μέσω IRIS: ",
      cash:  "Μετρητά κατά την παράδοση"
    }
  };

  function seedPayMethods() {
    // Deterministic ids: δύο συσκευές που κάνουν ταυτόχρονα seed
    // παράγουν τις ΙΔΙΕΣ οντότητες → το union merge δεν διπλασιάζει.
    var texts = PM_DEFAULTS[LANG] || PM_DEFAULTS.en;
    state.payMethods = PAY_METHODS.map(function (m, i) {
      return { id: "pm-" + m, method: m, text: texts[m] || "",
               mtime: 0, pos: i };
    });
  }

  function payMethodBy(method) {
    for (var i = 0; i < (state.payMethods || []).length; i++)
      if (state.payMethods[i].method === method) return state.payMethods[i];
    return null;
  }

  function migrate(data) {
    if (!data || typeof data !== "object") return null;
    if (!Array.isArray(data.quotes) || !Array.isArray(data.clients) ||
        !Array.isArray(data.templates)) return null;
    if (typeof data.om !== "number") data.om = 0;
    if (!data.deleted || typeof data.deleted !== "object") data.deleted = {};
	
	    if (!Array.isArray(data.payMethods) || data.payMethods.length === 0) {
      var texts = PM_DEFAULTS[LANG] || PM_DEFAULTS.en;
      data.payMethods = PAY_METHODS.map(function (m, i) {
        return { id: "pm-" + m, method: m, text: texts[m] || "",
                 mtime: 0, pos: i };
      });
    }
    data.payMethods.forEach(function (pm) {
      if (!pm.id) pm.id = "pm-" + (pm.method || "x");
      if (PAY_METHODS.indexOf(pm.method) === -1) pm.method = "bank";
      if (typeof pm.text !== "string") pm.text = "";
      if (typeof pm.mtime !== "number") pm.mtime = 0;
      if (typeof pm.pos !== "number") pm.pos = 0;
    });

    var fixOffer = function (q) {
      if (!q.id) q.id = uid();
      if (typeof q.num !== "string") q.num = "";
      if (typeof q.status !== "string" || STATUSES.indexOf(q.status) === -1) q.status = "draft";
      if (typeof q.date !== "string") q.date = "";
      if (typeof q.dueDate !== "string") q.dueDate = "";
      if (q.currency !== "USD") q.currency = "EUR";
      if (!Array.isArray(q.items)) q.items = [];
      q.items.forEach(function (it) {
        if (!it.id) it.id = uid();
        if (typeof it.code !== "string") it.code = "";
        if (typeof it.desc !== "string") it.desc = "";
        if (typeof it.qty !== "number") it.qty = parseNum(it.qty) || 1;
        if (typeof it.price !== "number") it.price = parseNum(it.price);
        if (typeof it.disc !== "number") it.disc = parseNum(it.disc);
        if (typeof it.vat !== "number") it.vat = parseNum(it.vat);
        if (typeof it.note !== "string") it.note = "";
      });
      if (typeof q.gDisc !== "number") q.gDisc = parseNum(q.gDisc);
      if (typeof q.payment !== "string") q.payment = "";
      if (typeof q.notes !== "string") q.notes = "";
      if (!Array.isArray(q.instalments)) q.instalments = [];
      q.instalments.forEach(function (ins) {
        if (!ins.id) ins.id = uid();
        if (typeof ins.date !== "string") ins.date = "";
        if (typeof ins.amount !== "number") ins.amount = parseNum(ins.amount);
      });
      if (typeof q.mtime !== "number") q.mtime = 0;
      if (typeof q.pos !== "number") q.pos = 0;
    };
    var fixClient = function (c) {
      if (!c.id) c.id = uid();
      ["name", "email", "phone", "address", "taxId"].forEach(function (f) {
        if (typeof c[f] !== "string") c[f] = "";
      });
      if (typeof c.mtime !== "number") c.mtime = 0;
      if (typeof c.pos !== "number") c.pos = 0;
    };
    var fixTemplate = function (tp) {
      if (!tp.id) tp.id = uid();
      if (typeof tp.name !== "string") tp.name = "";
      fixOffer.call(null, tp);        // items/gDisc/payment/notes/currency: ίδια morφή
      tp.mtime = typeof tp.mtime === "number" ? tp.mtime : 0;
    };

    data.quotes.forEach(fixOffer);
    data.clients.forEach(fixClient);
    data.templates.forEach(fixTemplate);
    data.ver = DATA_VER;
    return data;
  }

  function pruneTombstones() {
    if (!state || !state.deleted) return;
    var cutoff = Date.now() - TOMB_LIFETIME_MS;
    Object.keys(state.deleted).forEach(function (id) {
      if (state.deleted[id] < cutoff) delete state.deleted[id];
    });
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = migrate(JSON.parse(raw));
        if (data) {
          state = data;
          pruneTombstones();
          return;
        }
      }
    } catch (e) { /* corrupted → fresh start */ }
        state = { ver: DATA_VER, om: Date.now(), deleted: {},
              activeQuoteId: null, quotes: [], clients: [], templates: [],
              payMethods: [] };
    seedPayMethods();
    save();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota exceeded */ }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      renderAll();
    });
  }

  function quoteById(id) {
    for (var i = 0; i < state.quotes.length; i++)
      if (state.quotes[i].id === id) return state.quotes[i];
    return null;
  }
  function clientById(id) {
    for (var i = 0; i < state.clients.length; i++)
      if (state.clients[i].id === id) return state.clients[i];
    return null;
  }

  // ---------- 3. Merge engine (cross-device) ----------
  // Συμβόλιο: mergeQuoteStates(local, remote) → merged state | null.
  // Ίδιοι κανόνες με kanban v0.6.0, αλλά FLAT: τρεις λίστες
  // (quotes/clients/templates), ένα κοινό tombstone map.
  // Deterministic + symmetric: merge(A,B) === merge(B,A).

  function mergeEntityMaps(aDel, bDel) {
    var out = {};
    var a = aDel || {}, b = bDel || {};
    Object.keys(a).forEach(function (id) { out[id] = a[id]; });
    Object.keys(b).forEach(function (id) {
      out[id] = Math.max(out[id] || 0, b[id]);
    });
    return out;
  }

  function entAlive(ent, tomb) {
    var ts = tomb[ent.id];
    return ts === undefined || (ent.mtime || 0) > ts;
  }

  function newerEntity(a, b) {
    if ((a.mtime || 0) !== (b.mtime || 0)) {
      return (a.mtime || 0) > (b.mtime || 0) ? a : b;
    }
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  function unionEntities(aArr, bArr, tomb) {
    var map = {};
    (aArr || []).forEach(function (e) { map[e.id] = e; });
    (bArr || []).forEach(function (e) {
      map[e.id] = map[e.id] ? newerEntity(map[e.id], e) : e;
    });
    var out = [];
    Object.keys(map).forEach(function (id) {
      if (entAlive(map[id], tomb)) out.push(map[id]);
    });
    return out;
  }

  function orderEntities(entities, refArr) {
    var idx = {};
    (refArr || []).forEach(function (e, i) { idx[e.id] = i; });
    entities.sort(function (x, y) {
      var ix = idx[x.id] !== undefined ? idx[x.id] : Infinity;
      var iy = idx[y.id] !== undefined ? idx[y.id] : Infinity;
      if (ix !== iy) return ix - iy;
      if ((x.mtime || 0) !== (y.mtime || 0)) return (x.mtime || 0) - (y.mtime || 0);
      return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
    });
    entities.forEach(function (e, i) { e.pos = i; });
    return entities;
  }

  function pickRef(aArr, bArr, aOm, bOm) {
    if ((aOm || 0) !== (bOm || 0)) return (aOm || 0) > (bOm || 0) ? aArr : bArr;
    var ka = JSON.stringify((aArr || []).map(function (e) { return e.id; }));
    var kb = JSON.stringify((bArr || []).map(function (e) { return e.id; }));
    return ka >= kb ? aArr : bArr;
  }

  function mergeQuoteStates(A, B) {
    var a = A || {}, b = B || {};

    var tomb = mergeEntityMaps(a.deleted, b.deleted);
    var cutoff = Date.now() - TOMB_LIFETIME_MS;
    Object.keys(tomb).forEach(function (id) {
      if (tomb[id] < cutoff) delete tomb[id];
    });

    var quotes   = unionEntities(a.quotes, b.quotes, tomb);
    var clients  = unionEntities(a.clients, b.clients, tomb);
    var templates = unionEntities(a.templates, b.templates, tomb);
	var payMethods = unionEntities(a.payMethods, b.payMethods, tomb);

    return {
      ver: DATA_VER,
      om: Math.max(a.om || 0, b.om || 0),
      deleted: tomb,
      // activeQuoteId ΔΕΝ θέτουμε — device-local
      quotes: orderEntities(quotes, pickRef(a.quotes, b.quotes, a.om, b.om)),
      clients: orderEntities(clients, pickRef(a.clients, b.clients, a.om, b.om)),
      templates: orderEntities(templates, pickRef(a.templates, b.templates, a.om, b.om)),
      payMethods: orderEntities(payMethods, pickRef(a.payMethods, b.payMethods, a.om, b.om))
    };
  }

  // ---------- 4. Υπολογισμοί (pure — ΠΟΤΕ δεν αποθηκεύονται) ----------
  // itemNet = qty × price × (1 − itemDisc%) × (1 − globalDisc%)
  // Η global έκπτωση εφαρμόζεται pro-rata σε ΚΑΘΕ γραμμή, ώστε το
  // per-item VAT να υπολογίζεται πάνω στο σωστό (εκπτωτικό) ποσό.
  function itemNet(it, gDisc) {
    var gross = (it.qty || 0) * (it.price || 0);
    var d = 1 - (it.disc || 0) / 100;
    var g = 1 - (gDisc || 0) / 100;
    return gross * d * g;
  }

  function calcTotals(offer) {
    var subtotal = 0, vat = 0;
    var g = offer.gDisc || 0;
    (offer.items || []).forEach(function (it) {
      var gross = (it.qty || 0) * (it.price || 0) *
                  (1 - (it.disc || 0) / 100);
      subtotal += gross;
      vat += itemNet(it, g) * ((it.vat || 0) / 100);
    });
    subtotal = round2(subtotal);
    vat = round2(vat);
    var net = round2(subtotal * (1 - g / 100));
    return {
      subtotal: subtotal,
      discAmount: round2(subtotal - net),
      vat: vat,
      net: net,
      total: round2(net + vat)
    };
  }

  // Rounding-safe ισότιμη κατανομή: η πρώτη δόση σηκώνει το remainder.
  function splitEvenly(total, n) {
    var out = [];
    var base = round2(Math.floor(total * 100 / n) / 100);
    var assigned = round2(base * n);
    var rem = round2(total - assigned);
    for (var i = 0; i < n; i++) out.push(i === 0 ? round2(base + rem) : base);
    return out;
  }

  // ---------- 5. Editor (create tab) ----------
  var activeTab = "create";

  function newDraft() {
    cur = newQuoteObj();
    cur.items.push(newItemObj());      // μία κενή γραμμή για αρχή
    curIsDraft = true;
    loadOfferIntoEditor();
  }

  function openQuote(id) {
    var q = quoteById(id);
    if (!q) return;
    cur = q;
    curIsDraft = false;
    state.activeQuoteId = id;          // device-local
    loadOfferIntoEditor();
    switchTab("create");
  }

  function loadOfferIntoEditor() {
    if (!cur) return;
    $("q-number").value = cur.num;
    $("q-date").value = cur.date || "";
    $("q-due").value = cur.dueDate || "";
    $("q-status").value = cur.status;
    $("q-currency").value = cur.currency;
    $("global-discount").value = cur.gDisc || 0;
    $("global-vat").value =
      (cur.items && cur.items.length ? cur.items[0].vat : 24);
    $("q-payment").value = cur.payment || "";
    $("q-notes").value = cur.notes || "";
    renderClientDisplay();
    renderItems();
    renderInstalments();
    recalcTotals();
  }

  // Field-level commit: τα edits σε ΥΠΑΡΧΟΥΣΑ προσφορά live-αποθηκεύονται
  // (kanban pattern). Στο draft μόνο ενημερώνουν τη μνήμη — το Save
  // τη μετατρέπει σε οντότητα.
  function editCommitted() {
    if (!curIsDraft) { touch(cur); save(); }
    scheduleRender();
  }

  function renderClientDisplay() {
    var c = cur && cur.clientId ? clientById(cur.clientId) : null;
    $("client-name-display").textContent = c ? c.name : t("client.none");
  }
  
    // --- Payment presets: render + εισαγωγή + επεξεργασία ---
  function renderPaymentPresets() {
    var host = $("payment-presets");
    if (!host) return;
    host.innerHTML = "";
    (state.payMethods || []).forEach(function (pm) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "preset-btn" + (pm.text.trim() ? "" : " empty");
      b.textContent = t("payment." + pm.method);
      b.title = pm.text.trim() ? t("payment." + pm.method) : t("paypresets.edit");
      b.addEventListener("click", function () {
        if (!pm.text.trim()) { openPayPresetsDialog(pm.method); return; }
        var field = $("q-payment");
        field.value = field.value ? field.value + "\n" + pm.text : pm.text;
        cur.payment = field.value;
        editCommitted();
      });
      host.appendChild(b);
    });
  }

  // Επεξεργασία: inputs γράφουν σε temp buffer· στο close εφαρμόζονται
  // ΜΟΝΟ οι αλλαγμένες τιμές (zero-edit close → κανένα mtime stamp).
  var payEditBuffer = null;

  function openPayPresetsDialog(focusMethod) {
    var host = $("paypresets-list");
    host.innerHTML = "";
    payEditBuffer = {};                     // { method: newText }

    (state.payMethods || []).forEach(function (pm) {
      var lb = document.createElement("label");
      lb.textContent = t("payment." + pm.method);
      host.appendChild(lb);

      var ta = document.createElement("textarea");
      ta.rows = 2;
      ta.value = pm.text;
      ta.autocomplete = "off";
      ta.addEventListener("input", function () {
        payEditBuffer[pm.method] = ta.value;
      });
      host.appendChild(ta);

      if (focusMethod && pm.method === focusMethod) {
        setTimeout(function () { ta.focus(); }, 50);
      }
    });

    $("dlg-paypresets").showModal();
  }

  $("dlg-paypresets").addEventListener("close", function () {
    if (!payEditBuffer) return;
    var changed = false;
    Object.keys(payEditBuffer).forEach(function (method) {
      var pm = payMethodBy(method);
      if (!pm || pm.text === payEditBuffer[method]) return;
      pm.text = payEditBuffer[method];
      touch(pm);                            // LWW — μόνο το αλλαγμένο preset
      changed = true;
    });
    var bufferHadFocus = Object.keys(payEditBuffer).length > 0;
    payEditBuffer = null;

    if (changed) {
      state.om = Date.now();
      save(); renderPaymentPresets();
      showToast(t("toast.paypresets_saved"), false);
    }
    // Διόρθωση: αν δεν άλλαξε τίποτα, δεν γράφουμε καθόλου —
    // κανένα needless mtime stamp (κανένα κλείδωμα LWW).
    void bufferHadFocus;
  });

  function recalcTotals() {
    var tt = calcTotals(cur || { items: [], gDisc: 0 });
    $("subtotal-val").textContent = money(tt.subtotal, cur ? cur.currency : "EUR");
    var vatEl = $("vat-val");
    if (vatEl) vatEl.textContent = money(tt.vat, cur ? cur.currency : "EUR");
    $("grand-total-val").textContent = money(tt.total, cur ? cur.currency : "EUR");
    updateInstalmentSum();
  }

  // ---------- 6. Line items + δόσεις UI ----------
  // Οι γραμμές ΔΕΝ ξανα-χτίζονται σε κάθε input (θα χανόταν το focus):
  // δημιουργούνται on-demand και mutούν το state άμεσα (kanban pattern).

  function renderItems() {
    var host = $("items-container");
    host.innerHTML = "";
    if (!cur.items.length) {
      var e = document.createElement("div");
      e.className = "items-empty";
      e.textContent = t("items.empty");
      host.appendChild(e);
      return;
    }
    cur.items.forEach(function (it) {
      host.appendChild(makeItemRow(it));
    });
  }

  function makeItemRow(it) {
    var row = document.createElement("div");
    row.className = "item-row";
    row.dataset.itemId = it.id;

    var mk = function (cls, ph, val, onInput, type, extra) {
      var inp = document.createElement("input");
      inp.type = type || "text";
      inp.className = cls;
      if (ph) inp.placeholder = ph;
      if (val != null) inp.value = val;
      inp.autocomplete = "off";
      if (extra) for (var k in extra) inp.setAttribute(k, extra[k]);
      inp.addEventListener("input", function () { onInput(inp); });
      row.appendChild(inp);
      return inp;
    };

    // code | desc | qty | price | disc% | vat% | ✕
    mk("i-code", t("items.code"), it.code,
       function (i) { it.code = i.value; editCommitted(); });
    mk("i-desc", t("items.desc"), it.desc,
       function (i) { it.desc = i.value; editCommitted(); }, "text",
       { "data-i18n-ph": "items.desc" });

    mk("i-qty", t("items.qty"), it.qty, function (i) {
      it.qty = parseNum(i.value); recalcTotals(); editCommitted();
    }, "number", { step: "any", min: "0", inputmode: "decimal" });

    mk("i-price", t("items.unit_price"), it.price, function (i) {
      it.price = parseNum(i.value); recalcTotals(); editCommitted();
    }, "number", { step: "any", min: "0", inputmode: "decimal" });

    mk("i-disc", t("items.disc"), it.disc, function (i) {
      it.disc = parseNum(i.value); recalcTotals(); editCommitted();
    }, "number", { step: "any", min: "0", max: "100", inputmode: "decimal" });

    mk("i-vat", t("items.vat"), it.vat, function (i) {
      it.vat = parseNum(i.value); recalcTotals(); editCommitted();
    }, "number", { step: "any", min: "0", max: "100", inputmode: "decimal" });

    var del = document.createElement("button");
    del.type = "button";
    del.className = "i-del";
    del.title = t("items.del");
    del.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    del.addEventListener("click", function () {
      cur.items = cur.items.filter(function (x) { return x !== it; });
      renderItems(); recalcTotals(); editCommitted();
    });
    row.appendChild(del);

    return row;
  }

  function addItem() {
    cur.items.push(newItemObj());
    renderItems();
    var rows = $("items-container").querySelectorAll(".item-row");
    var last = rows[rows.length - 1];
    if (last) last.querySelector(".i-desc").focus();
    editCommitted();
  }

  // --- Δόσεις: δυναμικό section (δεν ήταν στο static HTML) ---
  function buildInstalmentSection() {
    var host = document.createElement("div");
    host.className = "instalments-section";
    host.id = "instalments-section";
    host.innerHTML =
      '<label data-i18n="inst.title">' + esc(t("inst.title")) + '</label>' +
      '<div class="inst-gen-row">' +
      '<span data-i18n="inst.count">' + esc(t("inst.count")) + '</span>' +
      '<input id="inst-count" type="number" min="1" max="24" step="1" value="2">' +
      '<button type="button" id="inst-generate" data-i18n="inst.generate">' +
        esc(t("inst.generate")) + '</button>' +
      '</div>' +
      '<div id="inst-list"></div>' +
      '<div id="inst-sum" class="inst-sum"></div>';

    var pay = document.querySelector(".payment-section");
    if (pay) pay.parentNode.insertBefore(host, pay);
    else document.getElementById("tab-create").appendChild(host);

    $("inst-generate").addEventListener("click", function () {
      var n = parseInt($("inst-count").value, 10);
      if (!(n > 0)) return;
      var tt = calcTotals(cur);
      var parts = splitEvenly(tt.total, n);
      cur.instalments = parts.map(function (amt, i) {
        return { id: uid(), date: "", amount: amt };
      });
      renderInstalments(); editCommitted();
    });
  }

  function renderInstalments() {
    var host = $("inst-list");
    if (!host) return;
    host.innerHTML = "";
    (cur.instalments || []).forEach(function (ins) {
      var row = document.createElement("div");
      row.className = "inst-row";

      var dt = document.createElement("input");
      dt.type = "date";
      dt.className = "in-date";
      dt.value = ins.date || "";
      dt.addEventListener("input", function () {
        ins.date = dt.value; editCommitted();
      });
      row.appendChild(dt);

      var am = document.createElement("input");
      am.type = "number";
      am.className = "in-amt";
      am.step = "any"; am.min = "0"; am.inputMode = "decimal";
      am.placeholder = t("inst.amount");
      am.value = ins.amount;
      am.addEventListener("input", function () {
        ins.amount = parseNum(am.value); updateInstalmentSum(); editCommitted();
      });
      row.appendChild(am);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "i-del";
      del.title = t("items.del");
      del.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      del.addEventListener("click", function () {
        cur.instalments = cur.instalments.filter(function (x) { return x !== ins; });
        renderInstalments(); updateInstalmentSum(); editCommitted();
      });
      row.appendChild(del);

      host.appendChild(row);
    });
    updateInstalmentSum();
  }

  function updateInstalmentSum() {
    var el = $("inst-sum");
    if (!el || !cur) return;
    var sum = 0;
    (cur.instalments || []).forEach(function (i) { sum += (i.amount || 0); });
    var tt = calcTotals(cur);
    var ok = Math.abs(round2(sum) - tt.total) < 0.005 && cur.instalments.length > 0;
    el.textContent = t("inst.sum") + " " + money(round2(sum), cur.currency) +
      (cur.instalments.length === 0 ? "" :
        (ok ? " — " + t("inst.match") : " — " + t("inst.mismatch")));
    el.className = "inst-sum" + (cur.instalments.length && !ok ? " mismatch" : "");
  }

  // ---------- 7. Clients (dropdown + dialog) ----------
  var clientDropdownOpen = false;
  var editingClientId = null;
  var clientSnapshot = null;      // zero-edit close fingerprint

  function clientFingerprint(c) {
    return JSON.stringify([c.name, c.email, c.phone, c.address, c.taxId]);
  }

  function toggleClientDropdown() {
    if (clientDropdownOpen) { closeClientDropdown(); return; }
    var host = document.querySelector(".offer-client");
    if (!host) return;
    var pop = $("client-dropdown");
    if (!pop) return;

    pop.innerHTML = "";

    if (!state.clients.length) {
      var e = document.createElement("div");
      e.className = "cl-empty";
      e.textContent = t("client.none_listed");
      pop.appendChild(e);
    }

    state.clients.forEach(function (c) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "dropdown-item" +
        (cur && cur.clientId === c.id ? " active" : "");
      var nm = document.createElement("span");
      nm.className = "dropdown-name";
      nm.textContent = c.name;
      item.appendChild(nm);
      var meta = document.createElement("span");
      meta.className = "dropdown-meta";
      meta.textContent = c.email || c.phone || "";
      item.appendChild(meta);
      item.addEventListener("click", function () {
        cur.clientId = c.id;
        closeClientDropdown();
        renderClientDisplay(); editCommitted();
      });
      pop.appendChild(item);
    });

    var sep = document.createElement("hr");
    sep.className = "dropdown-sep";
    pop.appendChild(sep);

    var addNew = document.createElement("button");
    addNew.type = "button";
    addNew.className = "dropdown-item";
    addNew.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> ' +
      esc(t("client.new"));
    addNew.addEventListener("click", function () {
      closeClientDropdown();
      openClientDialog(null);
    });
    pop.appendChild(addNew);

    pop.hidden = false;
    clientDropdownOpen = true;
    setTimeout(function () {
      document.addEventListener("click", clientOutsideHandler);
    }, 0);
  }

  function closeClientDropdown() {
    var pop = $("client-dropdown");
    if (pop) pop.hidden = true;
    clientDropdownOpen = false;
    document.removeEventListener("click", clientOutsideHandler);
  }

  function clientOutsideHandler(e) {
    var host = document.querySelector(".offer-client");
    if (host && !host.contains(e.target)) closeClientDropdown();
  }

  function openClientDialog(clientId) {
    var c = clientId ? clientById(clientId) : null;
    editingClientId = clientId;
    $("c-name").value = c ? c.name : "";
    $("c-email").value = c ? c.email : "";
    $("c-phone").value = c ? c.phone : "";
    $("c-address").value = c ? c.address : "";
    $("c-taxid").value = c ? c.taxId : "";
    $("client-delete").hidden = !c;
    clientSnapshot = c ? clientFingerprint(c) : null;
    $("dlg-client").showModal();
    setTimeout(function () { $("c-name").focus(); }, 50);
  }

  // Commit ΜΟΝΟ μέσω submit (κουμπί Save). Esc / κλείσιμο χωρίς
  // submit = Απόρριψη. Zero-edit submit ΔΕΝ stampάρει mtime
  // (identical fingerprint — κανένα κλείδωμα LWW).
  $("client-form").addEventListener("submit", function () {
    var name = $("c-name").value.trim();
    if (!name) return;                    // belt+braces (το required το καλύπτει)

    if (editingClientId) {
      var c = clientById(editingClientId);
      if (!c) return;
      c.name = name;
      c.email = $("c-email").value.trim();
      c.phone = $("c-phone").value.trim();
      c.address = $("c-address").value;
      c.taxId = $("c-taxid").value.trim();
      if (clientSnapshot !== null &&
          clientFingerprint(c) === clientSnapshot) return;   // zero-edit: no-op
      touch(c);
    } else {
      // ΝΕΟΣ πελάτης — το κενό που έλειπε: push στο state + ανάθεση
      var nc = newClientObj(name);
      nc.email = $("c-email").value.trim();
      nc.phone = $("c-phone").value.trim();
      nc.address = $("c-address").value;
      nc.taxId = $("c-taxid").value.trim();
      touch(nc);
      state.clients.push(nc);
      if (cur) cur.clientId = nc.id;       // άμεση σύνδεση με τον editor
    }
    state.om = Date.now();
    save(); scheduleRender();
    renderClientDisplay();
    showToast(t("toast.client_saved"), false);
    // το method="dialog" κλείνει το παράθυρο μόνο του — κανένα .close() εδώ
  });

  $("dlg-client").addEventListener("close", function () {
    editingClientId = null;                // reset — το close ΔΕΝ κάνει commit
    clientSnapshot = null;
  });

  function deleteClientFromDialog() {
    if (!editingClientId) return;
    if (!confirm(t("confirm.client_del"))) return;
    var id = editingClientId;
    state.deleted[id] = Date.now();
    state.clients = state.clients.filter(function (c) { return c.id !== id; });
    state.om = Date.now();
    // Οι προσφορές κρατούν το clientId — εμφανίζουν "—" (όχι cascade:
    // το ιστορικό προσφορών ΔΕΝ χάνει ποτέ τον προσwormισμό του)
    if (cur && cur.clientId === id) renderClientDisplay();
    save(); scheduleRender();
    showToast(t("toast.client_deleted"), false);
    $("dlg-client").close();
  }

  // ---------- 8. Templates ----------
  function saveCurrentAsTemplate() {
    var cl = cur.clientId ? clientById(cur.clientId) : null;  // guard: νεκρό ref
    var name = prompt(t("template.name_ph"), (cl ? cl.name + " — " : ""));
    if (!name || !name.trim()) return;
    var tp = {
      id: uid(),
      name: name.trim(),
      items: JSON.parse(JSON.stringify(cur.items || [])),
      gDisc: cur.gDisc || 0,
      payment: cur.payment || "",
      notes: cur.notes || "",
      currency: cur.currency || "EUR",
      instalments: JSON.parse(JSON.stringify(cur.instalments || [])),
      mtime: 0,
      pos: state.templates.length
    };
    tp.items.forEach(function (it) { it.id = uid(); });
    tp.instalments.forEach(function (ins) { ins.id = uid(); });
    touch(tp);
    state.templates.push(tp);
    state.om = Date.now();
    save();
    showToast(t("toast.template_saved"), false);
  }

  function openTemplateLibrary() {
    renderTemplateGrid();
    $("dlg-templates").showModal();
  }

  function renderTemplateGrid() {
    var grid = $("template-grid");
    grid.innerHTML = "";
    if (!state.templates.length) {
      var e = document.createElement("div");
      e.className = "tpl-empty";
      e.textContent = t("templates.empty");
      grid.appendChild(e);
      return;
    }
    state.templates.forEach(function (tp) {
      var row = document.createElement("div");
      row.className = "tpl-row";

      var info = document.createElement("div");
      info.className = "tpl-info";
      var nm = document.createElement("div");
      nm.className = "tpl-name";
      nm.textContent = tp.name;
      info.appendChild(nm);
      var meta = document.createElement("div");
      meta.className = "tpl-meta";
      var tt = calcTotals({ items: tp.items, gDisc: tp.gDisc });
      meta.textContent = tp.items.length + " " + t("items.title") +
                          " · " + money(tt.total, tp.currency);
      info.appendChild(meta);
      row.appendChild(info);

      var use = document.createElement("button");
      use.type = "button";
      use.className = "tpl-use";
      use.textContent = t("templates.use");
      use.addEventListener("click", function () {
        applyTemplate(tp);
        $("dlg-templates").close();
      });
      row.appendChild(use);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "tpl-del";
      del.title = t("items.del");
      del.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      del.addEventListener("click", function () {
        if (!confirm(t("confirm.delete"))) return;
        state.deleted[tp.id] = Date.now();
        state.templates = state.templates.filter(function (x) { return x !== tp; });
        state.om = Date.now();
        save(); renderTemplateGrid();
      });
      row.appendChild(del);

      grid.appendChild(row);
    });
  }

  function applyTemplate(tp) {
    // Template → ΝΕΟ draft (ποτέ overwrite υπάρχουσας)
    cur = newQuoteObj();
    cur.currency = tp.currency || "EUR";
    cur.items = JSON.parse(JSON.stringify(tp.items || []));
    cur.items.forEach(function (it) { it.id = uid(); });
    cur.gDisc = tp.gDisc || 0;
    cur.payment = tp.payment || "";
    cur.notes = tp.notes || "";
    cur.instalments = JSON.parse(JSON.stringify(tp.instalments || []));
    cur.instalments.forEach(function (ins) { ins.id = uid(); });
    curIsDraft = true;
    loadOfferIntoEditor();
    switchTab("create");
    showToast(t("toast.template_used"), false);
  }

  // ---------- 9. Λίστα προσφορών (list tab) ----------
  var searchQuery = "";
  var activeFilters = [];

  function quoteMatchesView(q) {
    if (activeFilters.length && activeFilters.indexOf(q.status) === -1) return false;
    if (searchQuery) {
      var hay = [q.num, q.notes, q.payment];
      (q.items || []).forEach(function (it) {
        hay.push(it.desc || "", it.code || "");
      });
      var c = clientById(q.clientId);
      if (c) hay.push(c.name, c.email);
      var s = hay.join(" ").toLowerCase();
      return s.indexOf(searchQuery) !== -1;
    }
    return true;
  }

  function renderQuoteList() {
    var host = $("quote-list-container");
    if (!host) return;
    host.innerHTML = "";

    var list = state.quotes.filter(quoteMatchesView);

    if (state.quotes.length === 0) {
      $("list-empty").hidden = false;
      return;
    }
    $("list-empty").hidden = true;

    if (list.length === 0) {
      var nm = document.createElement("div");
      nm.className = "list-no-match";
      nm.textContent = t("list.no_match");
      host.appendChild(nm);
      return;
    }

    // Νεότερες πρώτα (mtime DESC) — η pos-follows-om σειρά είναι για
    // το merge· η λίστα λειτουργεί καλύτερα chronological
    list.sort(function (a, b) { return (b.mtime || 0) - (a.mtime || 0); });

    list.forEach(function (q) {
      host.appendChild(makeQuoteRow(q));
    });
  }

  function makeQuoteRow(q) {
    var c = q.clientId ? clientById(q.clientId) : null;
    var tt = calcTotals(q);

    var row = document.createElement("button");
    row.type = "button";
    row.className = "q-row st-" + q.status;

    var num = document.createElement("span");
    num.className = "q-num";
    num.textContent = q.num || "—";
    row.appendChild(num);

    var who = document.createElement("span");
    who.className = "q-client";
    who.textContent = c ? c.name : t("client.none");
    row.appendChild(who);

    var date = document.createElement("span");
    date.className = "q-date";
    date.textContent = fmtDate(q.date);
    row.appendChild(date);

    var tot = document.createElement("span");
    tot.className = "q-total";
    tot.textContent = money(tt.total, q.currency);
    row.appendChild(tot);

    var st = document.createElement("span");
    st.className = "q-status";
    st.textContent = t("status." + q.status);
    row.appendChild(st);

    row.addEventListener("click", function () { openQuote(q.id); });
    return row;
  }

  // --- Status filter popover (kanban filter pattern) ---
  function renderStatusPop() {
    var pop = $("status-pop");
    pop.innerHTML = "";
    STATUSES.forEach(function (st) {
      var item = document.createElement("div");
      item.className = "fl-item";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = activeFilters.indexOf(st) !== -1;
      cb.addEventListener("change", function () {
        var at = activeFilters.indexOf(st);
        if (cb.checked && at === -1) activeFilters.push(st);
        if (!cb.checked && at !== -1) activeFilters.splice(at, 1);
        updateFilterBtn();
        scheduleRender();
      });
      item.appendChild(cb);

      var name = document.createElement("span");
      name.className = "fl-name";
      name.textContent = t("status." + st);
      item.appendChild(name);

      pop.appendChild(item);
    });
  }

  function updateFilterBtn() {
    var btn = $("status-filter");
    var badge = $("filter-count");
    if (!btn || !badge) return;
    if (activeFilters.length > 0) {
      btn.classList.add("has-filters");
      badge.textContent = String(activeFilters.length);
      badge.hidden = false;
    } else {
      btn.classList.remove("has-filters");
      badge.hidden = true;
    }
  }

  // ---------- 10. Export (PDF / print) + send ----------
  var fontLoadAttempted = false;
  var notoFontBase64 = null;

  function fetchFontBase64(cb) {
    if (notoFontBase64 !== null || fontLoadAttempted) { cb(notoFontBase64); return; }
    fontLoadAttempted = true;
    fetch(VENDOR_FONT_PATH).then(function (r) {
      if (!r.ok) throw 0;
      return r.arrayBuffer();
    }).then(function (buf) {
      var bytes = new Uint8Array(buf);
      var bin = "";
      for (var i = 0; i < bytes.length; i += 8192)
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      notoFontBase64 = btoa(bin);
      cb(notoFontBase64);
    }).catch(function () {
      cb(null);
    });
  }

  function exportPdf() {
    if (!cur) return;
    var JsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!JsPDF) { printFallback(); return; }
    fetchFontBase64(function (b64) { buildPdf(JsPDF, b64); });
  }

  function buildPdf(JsPDF, b64) {
    var doc = new JsPDF({ unit: "mm", format: "a4" });
    var greekOK = false;
    if (b64) {
      try {
        doc.addFileToVFS("NotoSans-Regular.ttf", b64);
        doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
        doc.setFont("NotoSans");
        greekOK = true;
      } catch (e) { greekOK = false; }
    }
    // Χωρίς ελληνική γραμματοσειρά: print fallback (τα ελληνικά
    // θα ήταν garbled — προτιμούμε σωστό αποτέλεσμα σε 2 βήματα)
    if (!greekOK && LANG === "el") { printFallback(); return; }

    var c = cur.clientId ? clientById(cur.clientId) : null;
    var tt = calcTotals(cur);
    var M = 16, W = 210, y = M;

    // Header
    doc.setFontSize(18);
    doc.text(t("app.title_short") || "Quote", M, y); y += 7;
    doc.setFontSize(10);
    doc.text("# " + (cur.num || ""), M, y); y += 5;
    if (c) {
      doc.text(t("pdf.header_client") + ":", M, y); y += 5;
      doc.text(c.name, M, y); y += 4;
      if (c.address) { doc.text(c.address.split("\n")[0], M, y); y += 4; }
      if (c.taxId) { doc.text(c.taxId, M, y); y += 4; }
    }
    y += 2;
    doc.text(t("offer.date") + ": " + fmtDate(cur.date) +
      "   " + t("offer.due_date") + ": " + (cur.dueDate ? fmtDate(cur.dueDate) : "—"), M, y);
    y += 8;

    // Items table — απλές στήλες, monospace-friendly
    var cols = [M, M + 30, M + 95, M + 125, M + 150, M + 165];
    doc.setFont(undefined, "bold");
    doc.text(t("items.code"), cols[0], y);
    doc.text(t("items.desc"), cols[1], y);
    doc.text(t("items.qty"), cols[2], y);
    doc.text(t("items.unit_price"), cols[3], y);
    doc.text(t("items.disc"), cols[4], y);
    doc.text(t("totals.total"), cols[5], y);
    doc.setFont(undefined, "normal");
    y += 2;
    doc.setDrawColor(160);
    doc.line(M, y, W - M, y);
    y += 5;

    cur.items.forEach(function (it) {
      if (y > 270) { doc.addPage(); y = M; }
      doc.text(String(it.code || ""), cols[0], y);
      doc.text(String(it.desc || "").slice(0, 42), cols[1], y);
      doc.text(String(it.qty || 0), cols[2], y);
      doc.text(String(it.price || 0), cols[3], y);
      doc.text(String(it.disc || 0) + "%", cols[4], y);
      doc.text(money(itemNet(it, cur.gDisc) * (1 + (it.vat || 0) / 100), cur.currency), W - M, y, { align: "right" });
      y += 5.5;
    });

    y += 3;
    doc.line(M, y, W - M, y);
    y += 6;

    doc.text(t("totals.subtotal") + ": " + money(tt.subtotal, cur.currency), W - M - 60, y); y += 5;
    if (tt.discAmount) {
      doc.text(t("totals.discount") + ": -" + money(tt.discAmount, cur.currency), W - M - 60, y); y += 5;
    }
    doc.text(t("totals.vat") + ": " + money(tt.vat, cur.currency), W - M - 60, y); y += 5;
    doc.setFont(undefined, "bold");
    doc.text(t("totals.total") + ": " + money(tt.total, cur.currency), W - M - 60, y);
    doc.setFont(undefined, "normal");
    y += 10;

    // Instalments
    if (cur.instalments && cur.instalments.length) {
      doc.setFont(undefined, "bold");
      doc.text(t("inst.title"), M, y); y += 5;
      doc.setFont(undefined, "normal");
      cur.instalments.forEach(function (ins) {
        doc.text(fmtDate(ins.date) + "  —  " + money(ins.amount, cur.currency), M, y);
        y += 5;
      });
      y += 4;
    }

    // Payment + notes
    if (cur.payment) {
      doc.setFont(undefined, "bold");
      doc.text(t("payment.title"), M, y); y += 5;
      doc.setFont(undefined, "normal");
      doc.text(doc.splitTextToSize(cur.payment, W - 2 * M), M, y); y += 8;
    }
    if (cur.notes) {
      doc.setFont(undefined, "bold");
      doc.text(t("offer.notes"), M, y); y += 5;
      doc.setFont(undefined, "normal");
      doc.text(doc.splitTextToSize(cur.notes, W - 2 * M), M, y);
    }

    // orOS branding footer — πάντα στην τελευταία σελίδα
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text("Made with orOS | useoros.online", W / 2, 287, { align: "center" });
    doc.setTextColor(0);

    doc.save((cur.num || "quote") + ".pdf");
    showToast(t("toast.exported"), false);
  }

  function printFallback() {
    var c = cur.clientId ? clientById(cur.clientId) : null;
    var tt = calcTotals(cur);
    var rows = cur.items.map(function (it) {
      return "<tr><td>" + esc(it.code || "") + "</td><td>" + esc(it.desc || "") +
        "</td><td>" + esc(it.qty || 0) + "</td><td>" + esc(it.price || 0) +
        "</td><td>" + esc(it.disc || 0) + "%</td><td>" +
        esc(money(itemNet(it, cur.gDisc) * (1 + (it.vat || 0) / 100), cur.currency)) +
        "</td></tr>";
    }).join("");

    var fr = document.createElement("iframe");
    fr.style.cssText = "position:fixed;width:0;height:0;border:0;";
    document.body.appendChild(fr);
    fr.contentDocument.write(
      '<html><head><meta charset="utf-8"><style>' +
      "body{font-family:sans-serif;margin:24px;color:#111}" +
      "table{width:100%;border-collapse:collapse;font-size:12px}" +
      "td,th{border-bottom:1px solid #999;padding:4px 6px;text-align:left}" +
      "h1{font-size:20px} .tot{text-align:right;margin-top:12px}" +
      "</style></head><body>" +
      "<h1>" + esc(t("app.title_short") || "Quote") + " #" + esc(cur.num || "") + "</h1>" +
      (c ? "<p>" + esc(c.name) +
        (c.taxId ? " · " + esc(c.taxId) : "") +
        (c.address ? "<br>" + esc(c.address.replace(/\n/g, ", ")) : "") + "</p>" : "") +
      "<p>" + esc(t("offer.date")) + ": " + esc(fmtDate(cur.date)) +
      " · " + esc(t("offer.due_date")) + ": " + esc(fmtDate(cur.dueDate) || "—") + "</p>" +
      "<table><thead><tr><th>" + esc(t("items.code")) + "</th><th>" + esc(t("items.desc")) +
      "</th><th>" + esc(t("items.qty")) + "</th><th>" + esc(t("items.unit_price")) +
      "</th><th>" + esc(t("items.disc")) + "</th><th>" + esc(t("totals.total")) +
      "</th></tr></thead><tbody>" + rows + "</tbody></table>" +
      '<div class="tot"><p>' + esc(t("totals.subtotal")) + ": " + esc(money(tt.subtotal, cur.currency)) + "</p>" +
      "<p>" + esc(t("totals.vat")) + ": " + esc(money(tt.vat, cur.currency)) + "</p>" +
      "<p><strong>" + esc(t("totals.total")) + ": " + esc(money(tt.total, cur.currency)) + "</strong></p></div>" +
      (cur.payment ? "<p><strong>" + esc(t("payment.title")) + ":</strong><br>" + esc(cur.payment) + "</p>" : "") +
      (cur.notes ? "<p><strong>" + esc(t("offer.notes")) + ":</strong><br>" + esc(cur.notes) + "</p>" : "") +
      '<div style="margin-top:24px;padding-top:8px;border-top:1px solid #ccc;font-size:11px;color:#777;text-align:center;">Made with orOS | useoros.online</div>' +
      "</body></html>");
    fr.contentDocument.close();
    setTimeout(function () {
      fr.contentWindow.focus();
      fr.contentWindow.print();
      setTimeout(function () { fr.remove(); }, 1000);
    }, 150);
  }

  function sendEmail() {
    if (!cur) return;
    var c = cur.clientId ? clientById(cur.clientId) : null;
    var tt = calcTotals(cur);
    var subject = t("send.subject") + " " + (cur.num || "");
    var body =
      (c ? c.name + ",\n\n" : "") +
      t("send.subject") + " " + (cur.num || "") + " — " +
      t("offer.due_date") + ": " + (cur.dueDate ? fmtDate(cur.dueDate) : "—") + "\n" +
      t("totals.total") + ": " + money(tt.total, cur.currency) + "\n\n" +
      (cur.payment || "");
    var href = "mailto:" + (c && c.email ? c.email : "") +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);
    window.open(href, "_self");
  }

  // ---------- 11. Toast ----------
  var toastTimer = null;

  function showToast(text) {
    var el = $("toast");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3500);
  }

  // ---------- 12. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone — fallback palette */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function registerSync() {
    var api = (window.parent && window.parent.orosSync) || window.orosSync;

    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };

    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("quote", sliceGet, sliceSet,
                      "oros-quote-data", mergeQuoteStates);
  }

  function sliceGet() {
    var out = JSON.parse(JSON.stringify(state));
    delete out.activeQuoteId;   // device-local — δεν ταξιδεύει ποτέ στο cloud
    return out;
  }

  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data) return;

    window.__orosSyncApi._suppress = true;
    try {
      // Device-local: κρατάμε το activeQuoteId αν η προσφορά έζησε
      if (!data.activeQuoteId) data.activeQuoteId = state.activeQuoteId;
      if (data.activeQuoteId &&
          !quoteByIdIn(data.quotes, data.activeQuoteId)) {
        data.activeQuoteId = data.quotes.length > 0 ? data.quotes[0].id : null;
      }
      state = data;
      pruneTombstones();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }

    // Αν ο χρήστης είχε ανοιχτή μια αποθηκευμένη προσφορά, φρεσκάρουμε
    // τον editor με τη merged εκδοχή της (χωρίς tab switch).
    if (!curIsDraft && cur) {
      var live = quoteById(cur.id);
      if (live) {
        cur = live;
        loadOfferIntoEditor();
      } else {
        // Η ανοιχτή προσφορά διαγράφηκε σε άλλη συσκευή — ο editor
        // δεν κρατά stale reference (θα έγραφε σε οντότητα εκτός state)
        newDraft();
        showToast(t("toast.sync_replaced"), false);
      }
    }
    scheduleRender();
  }

  function quoteByIdIn(arr, id) {
    for (var i = 0; i < (arr || []).length; i++)
      if (arr[i].id === id) return arr[i];
    return null;
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    var n = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < n.length; i++)
      n[i].textContent = t(n[i].getAttribute("data-i18n"));
    var ti = document.querySelectorAll("[data-i18n-title]");
    for (var j = 0; j < ti.length; j++) {
      ti[j].setAttribute("title", t(ti[j].getAttribute("data-i18n-title")));
      ti[j].setAttribute("aria-label", ti[j].getAttribute("title"));
    }
    var ph = document.querySelectorAll("[data-i18n-ph]");
    for (var k = 0; k < ph.length; k++)
      ph[k].setAttribute("placeholder", t(ph[k].getAttribute("data-i18n-ph")));
  }

  function switchTab(tab) {
    activeTab = tab;
    var tabs = document.querySelectorAll("#quote-tabs .tab");
    for (var i = 0; i < tabs.length; i++)
      tabs[i].classList.toggle("active", tabs[i].dataset.tab === tab);
    $("tab-create").classList.toggle("active", tab === "create");
    $("tab-list").classList.toggle("active", tab === "list");

    // Header tools ανά tab
    var isList = tab === "list";
    $("search-wrap").hidden = !isList;
    $("filters").hidden = !isList;
    $("client-new").hidden = isList;
    $("export-btn").hidden = isList;
    $("send-btn").hidden = isList;

    if (isList) { renderQuoteList(); updateFilterBtn(); }
  }

  function renderAll() {
    renderPaymentPresets();   // φρεσκάρει τα κουμπιά μετά από sync merge
    if (activeTab === "list") { renderQuoteList(); updateFilterBtn(); }
  }

  function commitSave() {
    // Draft → οντότητα. Μετά: live editing (kanban pattern).
    if (curIsDraft) {
      cur.pos = state.quotes.length;
      state.quotes.push(cur);
      state.om = Date.now();
      curIsDraft = false;
      state.activeQuoteId = cur.id;
    }
    touch(cur);
    state.om = Date.now();
    save();
    showToast(t("toast.saved"), false);
  }

  function duplicateCurrent() {
    var copy = JSON.parse(JSON.stringify(cur));
    copy.id = uid();
    copy.num = nextNumber();
    copy.status = "draft";
    copy.mtime = 0;
    copy.pos = state.quotes.length;
    copy.items.forEach(function (it) { it.id = uid(); });
    copy.instalments.forEach(function (ins) { ins.id = uid(); });
    state.quotes.push(copy);
    state.om = Date.now();
    touch(copy);
    state.activeQuoteId = copy.id;
    cur = copy;
    curIsDraft = false;
    save();
    loadOfferIntoEditor();
    renderQuoteList();
    showToast(t("toast.duplicated"), false);
  }

  function deleteCurrent() {
    if (curIsDraft) { newDraft(); return; }   // draft: απλός καθαρισμός
    if (!confirm(t("confirm.delete"))) return;
    state.deleted[cur.id] = Date.now();
    state.quotes = state.quotes.filter(function (q) { return q !== cur; });
    state.om = Date.now();
    state.activeQuoteId = null;
    save();
    newDraft();
    renderQuoteList();
    showToast(t("toast.deleted"), false);
  }

  function wire() {
    // --- Tabs ---
    document.querySelectorAll("#quote-tabs .tab").forEach(function (b) {
      b.addEventListener("click", function () { switchTab(b.dataset.tab); });
    });

    // --- Search (list tab) ---
    $("search").addEventListener("input", function () {
      searchQuery = this.value.trim().toLowerCase();
      $("search-clear").hidden = !searchQuery;
      scheduleRender();
    });
    $("search-clear").addEventListener("click", function () {
      $("search").value = "";
      searchQuery = "";
      $("search-clear").hidden = true;
      scheduleRender();
      $("search").focus();
    });

    // --- Status filter popover ---
    $("status-filter").addEventListener("click", function (e) {
      e.stopPropagation();
      var pop = $("status-pop");
      pop.hidden = !pop.hidden;
      if (!pop.hidden) renderStatusPop();
    });
    document.addEventListener("click", function (e) {
      var pop = $("status-pop");
      if (pop && !pop.hidden && !e.target.closest("#filters")) pop.hidden = true;
    });

    // --- Editor: meta fields ---
    $("q-date").addEventListener("input", function () {
      cur.date = this.value; editCommitted();
    });
    $("q-due").addEventListener("input", function () {
      cur.dueDate = this.value; editCommitted();
    });
    $("q-status").addEventListener("change", function () {
      cur.status = this.value; editCommitted();
    });
    $("q-currency").addEventListener("change", function () {
      cur.currency = this.value;
      recalcTotals(); editCommitted();
    });
    $("regenerate-num").addEventListener("click", function () {
      cur.num = nextNumber();
      $("q-number").value = cur.num;
      editCommitted();
    });
    $("global-discount").addEventListener("input", function () {
      cur.gDisc = parseNum(this.value);
      recalcTotals(); editCommitted();
    });
    $("global-vat").addEventListener("input", function () {
      // Bulk: εφαρμόζεται σε όλες τις γραμμές
      var v = parseNum(this.value);
      cur.items.forEach(function (it) { it.vat = v; });
      renderItems(); recalcTotals(); editCommitted();
    });
    $("q-payment").addEventListener("input", function () {
      cur.payment = this.value; editCommitted();
    });
    $("q-notes").addEventListener("input", function () {
      cur.notes = this.value; editCommitted();
    });

    // Payment presets (synced, δodynamic render — βλ. renderPaymentPresets)
    $("paypresets-edit").addEventListener("click", function () {
      openPayPresetsDialog(null);
    });
    $("paypresets-close").addEventListener("click", function () {
      $("dlg-paypresets").close();
    });

    // --- Items ---
    $("item-add").addEventListener("click", addItem);

    // --- Client selector ---
    $("client-selector").addEventListener("click", toggleClientDropdown);
    $("client-select-new").addEventListener("click", function () {
      closeClientDropdown();
      openClientDialog(null);
    });
    $("client-new").addEventListener("click", function () {
      openClientDialog(null);
    });
    $("client-delete").addEventListener("click", deleteClientFromDialog);

    // --- Editor actions ---
    $("save-quote").addEventListener("click", commitSave);
    $("save-template").addEventListener("click", saveCurrentAsTemplate);
	$("open-templates").addEventListener("click", openTemplateLibrary);
    $("duplicate-quote").addEventListener("click", duplicateCurrent);
    $("delete-quote").addEventListener("click", deleteCurrent);
    $("export-btn").addEventListener("click", exportPdf);
    $("send-btn").addEventListener("click", sendEmail);

    // --- Templates dialog ---
    $("templates-close").addEventListener("click", function () {
      $("dlg-templates").close();
    });

    // --- Keyboard: Alt+N = νέα προσφορά (browser-safe combo) ---
    document.addEventListener("keydown", function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey &&
          (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        newDraft();
        switchTab("create");
      }
    });
  }

  function boot() {
    document.documentElement.setAttribute("lang", LANG);
    applyI18n();
    load();
    buildInstalmentSection();   // ΠΡΙΝ από οποιοδήποτε loadOfferIntoEditor
    wire();
    renderPaymentPresets();   // πρώτο render των preset κουμπιών
    registerSync();
    inheritPalette();
    watchPalette();

    // Επαναφορά: τελευταία ανοιχτή προσφορά ή φρέσκο draft
    if (state.activeQuoteId && quoteById(state.activeQuoteId)) {
      openQuote(state.activeQuoteId);
    } else {
      newDraft();
    }
    switchTab("create");
    scheduleRender();
  }

  boot();
})();