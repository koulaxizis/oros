/* ============================================
   orOS Writer — Complete Application v2.4.0
   All bugs fixed, event delegation, full dialog support
   Author: Christos Koulaxizis | orOS Ecosystem
   ============================================ */

(function() {
  'use strict';

  // ===== CONFIGURATION =====
  var CONFIG = {
    APP_NAME: 'orOS Writer',
    VERSION: '2.4.0',
    CHANNEL: 'STABLE',
    STORAGE_PREFIX: 'oros_writer_',
    MAX_HISTORY: 50,
    CUSTOM_TEMPLATES_KEY: 'oros_writer_custom_templates'
  };

  // ===== STATE VARIABLES =====
  var richEditor = null;
  var richWrapper = null;
  var tabBar = null;
  var saveIndicator = null;
  var statsOverlay = null;
  var statsDefaultEl = null;
  var statsGoalEl = null;
  var statsDetailed = null;
  var goalBar = null;
  var goalTargetInput = null;
  var goalUnitSelect = null;
  var goalLockCheckbox = null;
  var goalTimeInput = null;
  var goalProgressDisplay = null;
  var goalInterval = null;
  var goalNotified = false;
  var goalTotalSeconds = 0;
  var goalElapsedSeconds = 0;
  var findBar = null;
  var stylesSelect = null;
  var footnoteArea = null;
  var metadataPanel = null;
  var wordFreqPanel = null;
  var wordFreqList = null;
  var wordFreqSummary = null;
  var commentsPanel = null;
  var tocPanel = null;
  var tocList = null;
  var versionPanel = null;
  var versionList = null;
  var metaTitle = null;
  var metaAuthor = null;
  var metaTags = null;
  var metaCategory = null;
  var metaCreated = null;
  var metaModified = null;
  var exportDropdown = null;
  var findInput = null;
  var replaceInput = null;
  var frResults = null;
  var findFormatFilter = null;

  var initialized = false;
  var typingTimer = null;
  var isTyping = false;
  var smartPasteEnabled = true;
  var smartTypographyEnabled = true;
  var typewriterSoundEnabled = false;
  var focusModeEnabled = false;
    var readingProgressEnabled = true; // Always on — toggle removed
  var currentLang = 'en';
  var toastContainer = null;
  var windowResizeDebounce = null;
  var AUTO_SAVE_INTERVAL_MS = 300000;
  var trackChangesObserver = null;
  var customTemplates = [];
  var clickHandlers = {};
    var PAGE_DIMENSIONS = {
    'a4':         { w: 210, h: 297, unit: 'mm' },
    'letter':     { w: 216, h: 279, unit: 'mm' },
    'legal':      { w: 216, h: 356, unit: 'mm' },
    'a3':         { w: 297, h: 420, unit: 'mm' },
    'a5':         { w: 148, h: 210, unit: 'mm' },
    'b5':         { w: 176, h: 250, unit: 'mm' },
    'full-width': { w: 100, h: 0,  unit: '%'  }
  };

  // ===== TEMPLATE DATA =====
    var TEMPLATES = [
    { id: 'blank', title: 'Blank', icon: 'fa-file-o', desc: 'Empty document', content: '<p><br></p>' },
    {
      id: 'essay',
      title: 'Essay',
      icon: 'fa-file-text-o',
      desc: 'Academic essay structure',
      content: '<h1 style="text-align:center;">[Essay Title]</h1>' +
        '<p style="text-align:center;color:var(--text-muted,#888);font-size:0.9em;">[Author Name] · [Course / Institution] · [Date]</p>' +
        '<p><br></p>' +
        '<h2>Abstract</h2>' +
        '<p>[A brief summary of the essay\'s main argument, key points, and conclusion. Aim for 150–250 words.]</p>' +
        '<p><br></p>' +
        '<h2>1. Introduction</h2>' +
        '<p>[Introduce the topic, provide background context, and state the thesis clearly. Outline the structure of the essay for the reader.]</p>' +
        '<p><br></p>' +
        '<h2>2. Background</h2>' +
        '<p>[Review relevant literature, establish the theoretical framework, and define key terms.]</p>' +
        '<p><br></p>' +
        '<h2>3. Main Argument</h2>' +
        '<p>[Present the primary argument with supporting evidence. Address counterarguments where appropriate.]</p>' +
        '<p><br></p>' +
        '<h3>3.1 [Sub-argument One]</h3>' +
        '<p>[Supporting point with evidence or analysis.]</p>' +
        '<p><br></p>' +
        '<h3>3.2 [Sub-argument Two]</h3>' +
        '<p>[Supporting point with evidence or analysis.]</p>' +
        '<p><br></p>' +
        '<h2>4. Discussion</h2>' +
        '<p>[Interpret the findings, discuss implications, and connect back to the thesis statement.]</p>' +
        '<p><br></p>' +
        '<h2>5. Conclusion</h2>' +
        '<p>[Restate the thesis in light of the evidence presented. Summarize key findings and suggest directions for further research.]</p>' +
        '<p><br></p>' +
        '<p style="color:var(--text-muted,#888);font-size:0.85em;"><strong>Keywords:</strong> [keyword one, keyword two, keyword three]</p>'
    },
    {
      id: 'letter',
      title: 'Formal Letter',
      icon: 'fa-envelope',
      desc: 'Business letter format',
      content: '<p style="text-align:right;">[Your Name]<br>[Street Address]<br>[City, Postal Code]<br>[Email] · [Phone]</p>' +
        '<p><br></p>' +
        '<p style="text-align:right;">[Date]</p>' +
        '<p><br></p>' +
        '<p>[Recipient Name]<br>[Recipient Title]<br>[Company / Organization]<br>[Street Address]<br>[City, Postal Code]</p>' +
        '<p><br></p>' +
        '<p><strong>Subject: [Brief description of the letter\'s purpose]</strong></p>' +
        '<p><br></p>' +
        '<p>Dear [Mr./Ms./Dr. Last Name],</p>' +
        '<p><br></p>' +
        '<p>[Opening paragraph — State the purpose of the letter clearly and concisely.]</p>' +
        '<p><br></p>' +
        '<p>[Body paragraph(s) — Provide supporting details, context, or arguments. Keep each paragraph focused on a single point.]</p>' +
        '<p><br></p>' +
        '<p>[Closing paragraph — Summarize the key message, state any expected action or response, and thank the recipient for their time.]</p>' +
        '<p><br></p>' +
        '<p>Sincerely,</p>' +
        '<p><br></p>' +
        '<p><br></p>' +
        '<p>[Your Name]<br>[Your Title, if applicable]</p>'
    },
    {
      id: 'novel',
      title: 'Novel Chapter',
      icon: 'fa-book',
      desc: 'Chapter structure with scene breaks',
      content: '<h1 style="text-align:center;">Chapter [One]</h1>' +
        '<p style="text-align:center;color:var(--text-muted,#888);font-style:italic;">[Optional chapter epigraph or quotation]</p>' +
        '<p><br></p>' +
        '<p>[Opening paragraph — Set the scene: time, place, atmosphere. Engage the reader with sensory detail or an inciting moment.]</p>' +
        '<p><br></p>' +
        '<p>[Continue the narrative. Develop character voice, advance the plot, and maintain tension or emotional engagement.]</p>' +
        '<p><br></p>' +
        '<p>[Build toward a turning point or revelation within the scene.]</p>' +
        '<p><br></p>' +
        '<p style="text-align:center;color:var(--text-muted,#888);">✦ ✦ ✦</p>' +
        '<p><br></p>' +
        '<p>[New scene — Shift in time, location, or perspective. Continue developing the narrative arc.]</p>' +
        '<p><br></p>' +
        '<p>[Close the chapter with a hook, emotional beat, or cliffhanger that compels the reader forward.]</p>'
    },
    {
      id: 'screenplay',
      title: 'Screenplay',
      icon: 'fa-video-camera',
      desc: 'Film script format',
      content: '<h1>[SCRIPT TITLE]</h1>' +
        '<p style="text-align:center;color:var(--text-muted,#888);">Written by [Author Name]</p>' +
        '<p><br></p>' +
        '<p style="text-transform:uppercase;font-weight:bold;">INT. [LOCATION] — [TIME OF DAY]</p>' +
        '<p><br></p>' +
        '<p>[Action description — Describe what the camera sees. Keep it present tense, visual, and concise. Only describe what can be seen or heard on screen.]</p>' +
        '<p><br></p>' +
        '<p style="text-transform:uppercase;text-align:center;font-weight:bold;">[CHARACTER NAME]</p>' +
        '<p style="margin-left:25%;">[Dialogue — What the character says. Parentheticals like (quietly) go on their own line above the dialogue.]</p>' +
        '<p><br></p>' +
        '<p style="text-transform:uppercase;text-align:center;font-weight:bold;">[SECOND CHARACTER]</p>' +
        '<p style="margin-left:25%;">[Response dialogue.]</p>' +
        '<p><br></p>' +
        '<p>[More action or transition. Use CUT TO: or FADE OUT. to end scenes.]</p>' +
        '<p><br></p>' +
        '<p style="text-transform:uppercase;text-align:right;">CUT TO:</p>' +
        '<p><br></p>' +
        '<p style="text-transform:uppercase;font-weight:bold;">EXT. [NEW LOCATION] — [TIME OF DAY]</p>' +
        '<p><br></p>' +
        '<p>[Continue the scene...]</p>'
    },
    {
      id: 'poem',
      title: 'Poem',
      icon: 'fa-music',
      desc: 'Centered verse with stanzas',
      content: '<h1 style="text-align:center;">[Poem Title]</h1>' +
        '<p style="text-align:center;color:var(--text-muted,#888);font-style:italic;">[for someone, or inspired by something]</p>' +
        '<p><br></p>' +
        '<p style="text-align:center;">[First line of the opening stanza]<br>[Second line]<br>[Third line]<br>[Fourth line]</p>' +
        '<p><br></p>' +
        '<p style="text-align:center;">[First line of the second stanza]<br>[Second line]<br>[Third line]<br>[Fourth line]</p>' +
        '<p><br></p>' +
        '<p style="text-align:center;">[First line of the closing stanza]<br>[Second line]<br>[Third line]<br>[Fourth line — the line that lingers]</p>'
    },
    {
      id: 'meeting',
      title: 'Meeting Notes',
      icon: 'fa-users',
      desc: 'Agenda, notes, and action items',
      content: '<h1>Meeting Notes</h1>' +
        '<p><strong>Date:</strong> [YYYY-MM-DD] · <strong>Time:</strong> [HH:MM]<br>' +
        '<strong>Location:</strong> [Room / Virtual link]<br>' +
        '<strong>Facilitator:</strong> [Name] · <strong>Note-taker:</strong> [Name]</p>' +
        '<p><br></p>' +
        '<h2>Attendees</h2>' +
        '<ul><li>[Name — Role]</li><li>[Name — Role]</li><li>[Name — Role]</li></ul>' +
        '<p><br></p>' +
        '<h2>Agenda</h2>' +
        '<ol>' +
        '<li>[Topic one — presenter, estimated time]</li>' +
        '<li>[Topic two — presenter, estimated time]</li>' +
        '<li>[Topic three — presenter, estimated time]</li>' +
        '<li>Any other business (AOB)</li>' +
        '</ol>' +
        '<p><br></p>' +
        '<h2>Discussion Notes</h2>' +
        '<h3>1. [Topic One]</h3>' +
        '<p>[Key points discussed, decisions made, concerns raised.]</p>' +
        '<p><br></p>' +
        '<h3>2. [Topic Two]</h3>' +
        '<p>[Key points discussed, decisions made, concerns raised.]</p>' +
        '<p><br></p>' +
        '<h3>3. [Topic Three]</h3>' +
        '<p>[Key points discussed, decisions made, concerns raised.]</p>' +
        '<p><br></p>' +
        '<h2>Action Items</h2>' +
        '<table class="custom-table"><thead><tr><th>Task</th><th>Owner</th><th>Due Date</th></tr></thead><tbody>' +
        '<tr><td>[Specific task description]</td><td>[Name]</td><td>[YYYY-MM-DD]</td></tr>' +
        '<tr><td>[Specific task description]</td><td>[Name]</td><td>[YYYY-MM-DD]</td></tr>' +
        '<tr><td>[Specific task description]</td><td>[Name]</td><td>[YYYY-MM-DD]</td></tr>' +
        '</tbody></table>' +
        '<p><br></p>' +
        '<h2>Next Meeting</h2>' +
        '<p><strong>Date:</strong> [YYYY-MM-DD] · <strong>Time:</strong> [HH:MM] · <strong>Location:</strong> [Room / Virtual link]</p>'
    }
  ];
  
    // ===== SPECIAL CHARACTER DATA =====
  var SPECIAL_CHARS = {
    greek: 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψωάέήίόύώϊϋΐΰ'.split(''),
    math: ['\u00B1','\u00D7','\u00F7','\u2260','\u2248','\u2264','\u2265','\u221E','\u222B','\u2211','\u221A','\u2202','\u2207','\u220F','\u2234','\u2235','\u221D','\u2208','\u2209','\u222A','\u2229','\u2282','\u2283','\u2286','\u2287','\u2295','\u2297','\u2299','\u226A','\u226B','\u00AC','\u2227','\u2228','\u2200','\u2203'],
    arrows: ['\u2190','\u2191','\u2192','\u2193','\u2194','\u2195','\u21D0','\u21D1','\u21D2','\u21D3','\u21D4','\u21D5','\u2197','\u2198','\u2199','\u2196','\u261D\uFE0E','\u261C\uFE0E','\u261E\uFE0E','\u261F\uFE0E'],
    currency: ['\u20AC','$','\u00A3','\u00A5','\u20BD','\u00A2','\u20B9','\u20A9','\u20AA','\u20AB','\u20B4','\u20B8','\u20BA','\u20B1','\u0E3F','\u20A1','\u20A8','\u20AE'],
    punctuation: ['\u00AB','\u00BB','\u2039','\u203A','\u201E','\u201C','\u201D','\u2018','\u2019','\u201A','\u201B','\u201F','\u00A1','\u00BF','\u00B7','\u2022','\u25E6','\u00A7','\u00B6','\u2030','\u2020','\u2021'],
    symbols: ['\u00A9','\u00AE','\u2122','\u00B0','\u2116','\u266A','\u266B','\u266C','\u266F','\u266D','\u266E','\u2611\uFE0E','\u2612\uFE0E','\u2610\uFE0E','\u2713','\u2717','\u2605','\u2606','\u261E\uFE0E','\u261C\uFE0E','\u261D\uFE0E','\u261F\uFE0E','\u2690','\u2691','\u2693','\u2694\uFE0E','\u2696\uFE0E','\u2697','\u2699\uFE0E','\u26A0\uFE0E'],
	emoji: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','😮‍💨','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','👍','👎','👊','✊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✌️','🤞','🤟','🤘','👌','🤌','🤏','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤙','💪','🦾','🙏','👀','👁️','👅','👄','🧠','🗣️','👤','👥','🫂','👶','👧','👦','👩','👨','👩‍🦰','👨‍🦰','👩‍🦱','👨‍🦱','👩‍🦳','👨‍🦳','👩‍🦲','👨‍🦲','👵','👴','👲','👳‍♀️','👳‍♂️','🧕','👮‍♀️','👮‍♂️','👷‍♀️','👷‍♂️','💂‍♀️','💂‍♂️','🕵️‍♀️','🕵️‍♂️','👩‍⚕️','👨‍⚕️','👩‍🌾','👨‍🌾','👩‍🍳','👨‍🍳','👩‍🎓','👨‍🎓','👩‍🎤','👨‍🎤','👩‍🏫','👨‍🏫','👩‍🏭','👨‍🏭','👩‍💻','👨‍💻','👩‍💼','👨‍💼','👩‍🔧','👨‍🔧','👩‍🔬','👨‍🔬','👩‍🎨','👨‍🎨','👩‍🚒','👨‍🚒','✍️','📝','💻','⌨️','🖥️','🖨️','🖱️','💾','💿','📀','📷','📸','📹','🎥','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🗑️','🛢️','💸','💵','💴','💶','💷','💰','💳','💎','⚖️','🔧','🔨','⚒️','🛠️','⚙️','🔗','⛓️','🧰','🧲','🔬','🔭','📡','💉','💊','🚪','🛏️','🛋️','🚽','🚿','🛁','🧴','🧷','🧹','🧺','🧻','🧼','🧽','🧯','🛒','🚬','⚰️','⚱️','🗿','⚠️','🚸','⛔','🚫','🚷','🔞','☢️','☣️','⬆️','↗️','➡️','↘️','⬇️','↙️','⬅️','↖️','↕️','↔️','↩️','↪️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','〰️','➕','➖','➗','✖️','💲','💱','™️','©️','®️','〽️','‼️','⁉️','❓','❔','❕','❗','〰️','♻️','✅','🆚','💯','❌','⭕','🛑','🔥','🌟','💥','💫','💦','💨','🕳️','💣','💬','👁️‍🗨️','🗨️','🗯️','💭','💤']
  };

  // ===== TABS MODULE =====
  var tabsModule = {
    STORAGE_TABS: 'oros_writer_tabs',
    STORAGE_ACTIVE: 'oros_writer_active_tab',
    OLD_STORAGE_CONTENT: 'oros_writer_content',
    OLD_STORAGE_METADATA: 'oros_writer_metadata',

    tabBar: null,
    listeners: { switch: [], create: [], close: [] },
    tabs: [],
    activeId: null,
    initialized: false,

    persist: function() {
      try {
        localStorage.setItem(this.STORAGE_TABS, JSON.stringify(this.tabs));
        if (this.activeId) localStorage.setItem(this.STORAGE_ACTIVE, this.activeId);
      } catch(e) { console.warn('Tab persist failed:', e); }
    },

    load: function() {
      try {
        var raw = localStorage.getItem(this.STORAGE_TABS);
        if (raw) {
          this.tabs = JSON.parse(raw);
          for (var i = 0; i < this.tabs.length; i++) {
            if (!this.tabs[i].hasOwnProperty('lastSaved')) this.tabs[i].lastSaved = null;
            if (!this.tabs[i].hasOwnProperty('versions')) this.tabs[i].versions = [];
          }
          this.activeId = localStorage.getItem(this.STORAGE_ACTIVE);
          if (!this.activeId || !this.getActive()) {
            this.activeId = this.tabs.length > 0 ? this.tabs[0].id : null;
          }
          if (this.tabs.length > 0) { this.persist(); return; }
        }
      } catch(e) { console.warn('Tab load failed:', e); this.tabs = []; }

      var oldContent = localStorage.getItem(this.OLD_STORAGE_CONTENT);
      var oldMetadata = {};
      try { var rawMeta = localStorage.getItem(this.OLD_STORAGE_METADATA); if (rawMeta) oldMetadata = JSON.parse(rawMeta); } catch(e2) {}

      var tab = this.createObject(oldContent ? this.deriveTitle(oldContent) : null, oldContent || '', oldMetadata);
      this.tabs.push(tab);
      this.activeId = tab.id;
      this.persist();
    },

    createObject: function(title, content, metadata) {
      return {
        id: 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        title: title || 'Untitled',
        content: content || '',
        metadata: metadata || {},
        lastSaved: null,
        versions: []
      };
    },

    deriveTitle: function(html) {
      if (!html) return 'Untitled';
      var temp = document.createElement('div');
      temp.innerHTML = html;
      var h1 = temp.querySelector('h1');
      if (h1 && h1.textContent.trim()) return h1.textContent.trim().substring(0, 40);
      var h2 = temp.querySelector('h2');
      if (h2 && h2.textContent.trim()) return h2.textContent.trim().substring(0, 40);
      var p = temp.querySelector('p');
      if (p && p.textContent.trim()) return p.textContent.trim().substring(0, 40);
      var text = temp.textContent.trim();
      if (text) return text.substring(0, 40);
      return 'Untitled';
    },

    getAll: function() { return this.tabs; },
    getActiveId: function() { return this.activeId; },
    getActive: function() {
      for (var i = 0; i < this.tabs.length; i++) { if (this.tabs[i].id === this.activeId) return this.tabs[i]; }
      return null;
    },
    getContent: function() { var tab = this.getActive(); return tab ? tab.content : ''; },
    getMetadata: function() { var tab = this.getActive(); return tab ? (tab.metadata || {}) : {}; },
    getTimestamp: function() { var tab = this.getActive(); return tab ? tab.lastSaved : null; },

    setContent: function(html) {
      var tab = this.getActive();
      if (!tab) return;
      tab.content = html;
      // Αν υπάρχει τίτλος από metadata, αυτός υπερισχύει — ΜΗΝ τον Derive από το κείμενο
      var metaTitle = (tab.metadata && tab.metadata.title) ? tab.metadata.title : null;
      var newTitle = metaTitle || this.deriveTitle(html);
      if (newTitle !== tab.title) { tab.title = newTitle; this.persist(); this.render(); } else { this.persist(); }
    },
    setMetadata: function(meta) { var tab = this.getActive(); if (!tab) return; tab.metadata = meta || {}; this.persist(); },
    setTimestamp: function(ts) { var tab = this.getActive(); if (!tab) return; tab.lastSaved = ts; this.persist(); },

    create: function(opts) {
      opts = opts || {};
      var tab = this.createObject(opts.title || null, opts.content || '', opts.metadata || {});
      this.tabs.push(tab);
      this.activeId = tab.id;
      this.persist();
      this.render();
      this.fireEvent('create', tab);
      this.fireEvent('switch', tab);
      return tab;
    },

    close: function(id) {
      var idx = -1;
      for (var i = 0; i < this.tabs.length; i++) { if (this.tabs[i].id === id) { idx = i; break; } }
      if (idx === -1) return;
      var tab = this.tabs[idx];
      if (this.tabs.length <= 1) {
        tab.content = ''; tab.title = 'Untitled'; tab.metadata = {}; tab.lastSaved = null; tab.versions = [];
        this.persist(); this.render(); this.fireEvent('switch', tab); return;
      }
      this.tabs.splice(idx, 1);
      if (this.activeId === id) { var newIdx = Math.min(idx, this.tabs.length - 1); this.activeId = this.tabs[newIdx].id; }
      this.persist(); this.render();

      // ===== AUTOSYNC ON TAB CLOSE =====
      if (window.orosSync) {
        var api = window.orosSync.get();
        if (api && api.dirHandle && api.saveBackup) {
          api.saveBackup().catch(function(){});
        }
      }

      this.fireEvent('close', tab);
      this.fireEvent('switch', this.getActive());
    },

    switchTo: function(id) {
      if (id === this.activeId) return;
      var exists = false;
      for (var i = 0; i < this.tabs.length; i++) { if (this.tabs[i].id === id) { exists = true; break; } }
      if (!exists) return;
      this.activeId = id;
      localStorage.setItem(this.STORAGE_ACTIVE, this.activeId);
      this.render();
      this.fireEvent('switch', this.getActive());
    },

    fireEvent: function(event, data) {
      var callbacks = this.listeners[event] || [];
      for (var i = 0; i < callbacks.length; i++) { try { callbacks[i](data); } catch(e) { console.warn('Tab event error:', e); } }
    },
    on: function(event, callback) { if (!this.listeners[event]) this.listeners[event] = []; this.listeners[event].push(callback); },

    render: function() {
      if (!this.tabBar) { console.warn('render called before tabBar initialized'); return; }
      var lang = localStorage.getItem('oros-language') || 'en';
      var html = '';
      for (var i = 0; i < this.tabs.length; i++) {
        var t = this.tabs[i];
        var isActive = t.id === this.activeId;
        html += '<div class="tab' + (isActive ? ' active' : '') + '" data-tab-id="' + t.id + '">' +
          '<span class="tab-label">' + escapeHtml(t.title) + '</span>' +
          '<button class="tab-close" data-close-id="' + t.id + '" title="' +
          (lang === 'el' ? 'Κλείσιμο' : 'Close') + '"><i class="fa fa-times"></i></button></div>';
      }
      html += '<button class="tab-new" id="btn-new-tab" title="' +
        (lang === 'el' ? 'Νέο Tab' : 'New Tab') + '"><i class="fa fa-plus"></i></button>';
      this.tabBar.innerHTML = html;

      var tabEls = this.tabBar.querySelectorAll('.tab');
      for (var j = 0; j < tabEls.length; j++) {
        (function(el) {
          el.addEventListener('click', function(e) {
            if (e.target.closest('.tab-close')) return;
            if (e.detail === 2) {
              e.preventDefault();
              e.stopPropagation();
              tabsModule.rename(el.getAttribute('data-tab-id'));
              return;
            }
            tabsModule.switchTo(el.getAttribute('data-tab-id'));
          });
        })(tabEls[j]);
      }

      var closeBtns = this.tabBar.querySelectorAll('.tab-close');
      for (var k = 0; k < closeBtns.length; k++) {
        (function(btn) {
          btn.addEventListener('click', function(e) { e.stopPropagation(); tabsModule.close(btn.getAttribute('data-close-id')); });
        })(closeBtns[k]);
      }

      var newBtn = document.getElementById('btn-new-tab');
      if (newBtn) {
        newBtn.addEventListener('click', function() {
          tabsModule.create({ content: '<p><br></p>', metadata: {} });
          setTimeout(function() { if (richEditor) richEditor.focus(); }, 50);
        });
      }
    },

    rename: function(id) {
      var tab = null;
      for (var i = 0; i < this.tabs.length; i++) { if (this.tabs[i].id === id) { tab = this.tabs[i]; break; } }
      if (!tab) return;
      var el = this.tabBar.querySelector('[data-tab-id="' + id + '"] .tab-label');
      if (!el) return;

      var input = document.createElement('input');
      input.type = 'text';
      input.value = tab.title;
      input.className = 'tab-label-input';
      el.parentNode.replaceChild(input, el);
      input.focus();
      input.select();

      function finalize(save) {
        var newTitle = input.value.trim() || 'Untitled';
        if (save) { tab.title = newTitle; tabsModule.persist(); }
        tabsModule.render();
      }

      input.addEventListener('blur', function() { finalize(true); });
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); finalize(false); }
      });
    },

    init: function(containerSelector) {
      if (this.initialized) return;
      this.tabBar = document.querySelector(containerSelector);
      if (!this.tabBar) { console.warn('Tabs module: tabBar not found'); return; }
      this.initialized = true;
      this.load();
      this.render();
    }
  };
  
    // ===== HELPER FUNCTIONS =====
  function bindClick(id, fn) {
    clickHandlers[id] = fn;
  }

  // Delegated click handler — survives DOM re-rendering
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== document) {
      if (el.id && clickHandlers[el.id]) {
        clickHandlers[el.id].call(el, e);
        return;
      }
      el = el.parentNode;
    }
  });

  function getCurrentLang() {
    var saved = localStorage.getItem('oros-language');
    if (saved) return saved;
    return document.documentElement.lang || (navigator.language || 'en').split('-')[0];
  }

  function getTrans(key) {
    var lang = getCurrentLang();
    if (!window.OROS_TRANSLATIONS || !window.OROS_TRANSLATIONS[lang]) {
      if (window.OROS_TRANSLATIONS && window.OROS_TRANSLATIONS['en']) lang = 'en';
      else return key;
    }
    var trans = window.OROS_TRANSLATIONS[lang];
    return trans[key] || (window.OROS_TRANSLATIONS['en'] && window.OROS_TRANSLATIONS['en'][key]) || key;
  }

  function getTabTitle() {
    var tab = tabsModule.getActive();
    return (tab && tab.title) ? tab.title : 'document';
  }

  function cloneObject(obj) {
    var clone = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) { clone[keys[i]] = obj[keys[i]]; }
    return clone;
  }

  function escapeHtml(str) { var div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

  function showToast(message, duration) {
    if (!toastContainer) {
      toastContainer = document.getElementById('zentool-toast');
      if (!toastContainer) {
        toastContainer = document.querySelector('.zentool-toast');
        if (!toastContainer) {
          toastContainer = document.createElement('div');
          toastContainer.className = 'zentool-toast';
          toastContainer.id = 'zentool-toast';
          document.body.appendChild(toastContainer);
        }
      }
    }
    toastContainer.textContent = message;
    toastContainer.classList.add('visible');
    clearTimeout(toastContainer._timer);
    toastContainer._timer = setTimeout(function() { toastContainer.classList.remove('visible'); }, duration || 2500);
  }

  function saveCurrentTabContent() {
    if (tabsModule && tabsModule.getActive() && richEditor) {
      tabsModule.setContent(richEditor.innerHTML);
      tabsModule.setTimestamp(new Date().toISOString());
      updateSaveIndicator('saved');
      updateStats();
      checkPlaceholder();
    }
  }

    function updateSaveIndicator(state) {
    if (!saveIndicator) return;
    var now = new Date();
    var timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    if (state === 'saving') saveIndicator.textContent = 'Saving...';
    else if (state === 'saved') saveIndicator.textContent = 'Saved ' + timeStr;
    else if (state === 'unsaved') saveIndicator.textContent = 'Unsaved changes';
    saveIndicator.style.visibility = 'visible';
  }
  
    
  function updateStats() {
    if (!richEditor) return;
    var text = richEditor.innerText || '';
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    var chars = text.length;
    var charNoSpaces = text.replace(/\s/g, '').length;
    var sentences = (text.match(/[.!?…]+/g) || []).length;
    var paragraphs = richEditor.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li').length;
    var readingTime = words > 0 ? Math.max(1, Math.ceil(words / 200)) : 0;
    var speakingTime = words > 0 ? Math.max(1, Math.ceil(words / 130)) : 0;

    if (statsDefaultEl) {
      statsDefaultEl.innerHTML = words + ' words · ' + readingTime + ' min <span class="stats-up-arrow">\u25B2</span>';
      statsDefaultEl.style.cursor = 'pointer';
    }

    if (statsDetailed) {
      var rows = statsDetailed.querySelectorAll('.stat-row span:last-child');
      if (rows.length >= 7) {
        rows[0].textContent = words;
        rows[1].textContent = chars;
        rows[2].textContent = charNoSpaces;
        rows[3].textContent = sentences;
        rows[4].textContent = paragraphs;
        rows[5].textContent = readingTime + ' min';
        rows[6].textContent = speakingTime + ' min';
      }
    }

    updateReadingProgress();
       updateGoalProgress();
  }

  function setupStatsToggle() {
    if (!statsDefaultEl || !statsDetailed) return;
    statsDefaultEl.addEventListener('click', function(e) {
      e.stopPropagation();
      statsDetailed.classList.toggle('visible');
    });
    document.addEventListener('click', function(e) {
      if (statsDetailed && !e.target.closest('.stats-overlay')) {
        statsDetailed.classList.remove('visible');
      }
    });
  }

  function updateReadingProgress() {
    if (!readingProgressEnabled || !richEditor) return;
    var container = document.querySelector('.reading-progress-bar');
    if (!container) return;
    var totalHeight = richEditor.scrollHeight - richEditor.clientHeight;
    if (totalHeight <= 0) { container.style.width = '0%'; return; }
    var scrollTop = richEditor.scrollTop;
    var pct = Math.min(100, (scrollTop / totalHeight) * 100);
    container.style.width = pct + '%';
  }

  // ===== SETTINGS =====
  function loadSettings() {
    try {
      var raw = localStorage.getItem(CONFIG.STORAGE_PREFIX + 'settings');
      if (!raw) return {};
      var s = JSON.parse(raw);
      smartTypographyEnabled = s.smartTypography !== false;
      typewriterSoundEnabled = s.typewriterSound === true;
            readingProgressEnabled = true;
      return s;
    } catch(e) { return {}; }
  }

  function saveSettings() {
    var s = {
      smartTypography: smartTypographyEnabled,
      typewriterSound: typewriterSoundEnabled,
    };
    var set = function(id, prop) { var el = document.getElementById(id); if (el) s[prop] = el.checked; };
    set('toggle-smart-typography', 'smartTypography');
    set('toggle-typewriter-sound', 'typewriterSound');
    try { localStorage.setItem(CONFIG.STORAGE_PREFIX + 'settings', JSON.stringify(s)); } catch(e) {}
    smartTypographyEnabled = s.smartTypography !== false;
    typewriterSoundEnabled = s.typewriterSound === true;
    readingProgressEnabled = s.readingProgress !== false;
    showToast(getTrans('btn_save') !== 'btn_save' ? getTrans('btn_save') : 'Settings saved');
  }

  function loadSettingsValues() {
    var set = function(id, val) { var el = document.getElementById(id); if (el) el.checked = val; };
    set('toggle-smart-typography', smartTypographyEnabled);
    set('toggle-typewriter-sound', typewriterSoundEnabled);
  }
  
    function setupSettingToggles() {
    var stToggle = document.getElementById('toggle-smart-typography');
    if (stToggle) {
      stToggle.checked = smartTypographyEnabled;
      stToggle.addEventListener('change', function() {
        smartTypographyEnabled = this.checked;
        var s = {};
        try { s = JSON.parse(localStorage.getItem(CONFIG.STORAGE_PREFIX + 'settings') || '{}'); } catch(e) {}
        s.smartTypography = smartTypographyEnabled;
        try { localStorage.setItem(CONFIG.STORAGE_PREFIX + 'settings', JSON.stringify(s)); } catch(e) {}
        showToast(this.checked ? 'Smart Typography ON' : 'Smart Typography OFF');
      });
    }

    var twToggle = document.getElementById('toggle-typewriter-sound');
    if (twToggle) {
      twToggle.checked = typewriterSoundEnabled;
      twToggle.addEventListener('change', function() {
        typewriterSoundEnabled = this.checked;
        var s = {};
        try { s = JSON.parse(localStorage.getItem(CONFIG.STORAGE_PREFIX + 'settings') || '{}'); } catch(e) {}
        s.typewriterSound = typewriterSoundEnabled;
        try { localStorage.setItem(CONFIG.STORAGE_PREFIX + 'settings', JSON.stringify(s)); } catch(e) {}
        showToast(this.checked ? 'Typewriter Sound ON' : 'Typewriter Sound OFF');
      });
    }
  }

  // ===== THEME =====
  function applyTheme() {
    var saved = localStorage.getItem('oros-theme') || 'dark';
    if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
  }

  // ===== LANGUAGE =====
  var activeTranslations = null;

  function loadTranslations() {
    if (window.OROS_TRANSLATIONS && typeof window.OROS_TRANSLATIONS === 'object') {
      activeTranslations = window.OROS_TRANSLATIONS;
      return true;
    }
    var stored = localStorage.getItem('oros-translations');
    if (stored) {
      try { activeTranslations = JSON.parse(stored); return true; } catch(e) { console.warn('Stored translations parse error:', e); }
    }
    return false;
  }

  function applyLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    var translatable = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < translatable.length; i++) {
      var key = translatable[i].getAttribute('data-i18n');
      var val = getTrans(key);
      if (val && val !== key) {
        // Keys containing HTML markup need innerHTML, not textContent
        if (val.indexOf('<') !== -1) {
          translatable[i].innerHTML = val;
        } else {
          translatable[i].textContent = val;
        }
      }
    }
    var placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < placeholders.length; j++) {
      var phKey = placeholders[j].getAttribute('data-i18n-placeholder');
      var phVal = getTrans(phKey);
      if (phVal && phVal !== phKey) { placeholders[j].setAttribute('placeholder', phVal); placeholders[j].setAttribute('data-placeholder', phVal); }
    }
    var tooltips = document.querySelectorAll('[data-i18n-tooltip]');
    for (var t = 0; t < tooltips.length; t++) {
      var ttKey = tooltips[t].getAttribute('data-i18n-tooltip');
      var ttVal = getTrans(ttKey);
      if (ttVal && ttVal !== ttKey) tooltips[t].title = ttVal;
    }
    if (tabsModule && tabsModule.initialized) tabsModule.render();
  }

  // ===== PAGE SETTINGS =====
  function applyPageSize(size) {
    if (!richWrapper) richWrapper = document.querySelector('.rich-wrapper');
    if (!richEditor) richEditor = document.getElementById('rich-editor');
    var validSizes = ['a4', 'letter', 'legal', 'a3', 'a5', 'b5', 'full-width'];
    if (validSizes.indexOf(size) === -1) size = 'a4';
    if (richWrapper) richWrapper.setAttribute('data-page-size', size);
    if (richEditor) richEditor.setAttribute('data-page-size', size);
    syncPageSizeToUI(size);  // <-- ΠΡΟΣΘΕΣΕ ΤΗΝ
  }

  function applyPageMargins() {
    var meta = tabsModule.getMetadata ? tabsModule.getMetadata() : {};
    var top = parseFloat(meta.marginTop) || 2.54;
    var bottom = parseFloat(meta.marginBottom) || 2.54;
    var left = parseFloat(meta.marginLeft) || 2.54;
    var right = parseFloat(meta.marginRight) || 2.54;
    if (richEditor) {
      richEditor.style.paddingTop = top + 'cm';
      richEditor.style.paddingBottom = bottom + 'cm';
      richEditor.style.paddingLeft = left + 'cm';
      richEditor.style.paddingRight = right + 'cm';
    }
    var printStyle = document.getElementById('oros-print-margins');
    if (!printStyle) {
      printStyle = document.createElement('style');
      printStyle.id = 'oros-print-margins';
      document.head.appendChild(printStyle);
    }
    printStyle.textContent = '@media print{@page{margin:' + top + 'cm ' + right + 'cm ' + bottom + 'cm ' + left + 'cm;}}';
  }
  
      function syncPageSizeToUI(size) {
    var select = document.getElementById('page-size-select');
    if (select && select.value !== size) {
      select.value = size;
    }

    // Ενημέρωση διαστάσεων info
    var dims = PAGE_DIMENSIONS[size];
    if (!dims) return;

    var dimInfo = document.getElementById('page-dimensions-info');
    
    // Αν δεν υπάρχει, το φτιάχνουμε
    if (!dimInfo) {
      var panel = document.getElementById('metadata-panel');
      if (panel && panel.querySelector('.panel-body')) {
        dimInfo = document.createElement('div');
        dimInfo.id = 'page-dimensions-info';
        dimInfo.className = 'page-dimensions-info';
        var pageSizeSelect = panel.querySelector('#page-size-select');
        if (pageSizeSelect && pageSizeSelect.parentNode) {
          pageSizeSelect.parentNode.appendChild(dimInfo);
        }
      }
    }
    
    if (dimInfo) {
      var hText = dims.h > 0 ? dims.h + ' ' + dims.unit : 'auto';
      dimInfo.textContent = dims.w + ' ' + dims.unit + ' × ' + hText;
    }
  }
  
      function applyHeaderFooter() {
    var meta = tabsModule.getMetadata ? tabsModule.getMetadata() : {};
    var headerText = meta.headerText || '';
    var footerText = meta.footerText || '';
    var showPageNum = meta.footerPageNum === true;

    // Attributes για print
    if (richEditor) {
      richEditor.setAttribute('data-header-text', headerText);
      richEditor.setAttribute('data-footer-text', footerText);
      richEditor.setAttribute('data-show-page-num', showPageNum ? '1' : '0');
    }

    var editorWrapper = document.querySelector('.rich-wrapper');
    if (!editorWrapper) return;

    // Δημιουργία/Ενημέρωση preview elements
    var headerPreview = editorWrapper.querySelector('.header-preview');
    var footerPreview = editorWrapper.querySelector('.footer-preview');

    if (!headerPreview) {
      headerPreview = document.createElement('div');
      headerPreview.className = 'header-preview';
      editorWrapper.insertBefore(headerPreview, editorWrapper.firstChild);
    }

    if (!footerPreview) {
      footerPreview = document.createElement('div');
      footerPreview.className = 'footer-preview';
      editorWrapper.appendChild(footerPreview);
    }

    // Display header
    if (headerText) {
      headerPreview.textContent = headerText;
      headerPreview.style.display = 'block';
    } else {
      headerPreview.style.display = 'none';
    }

    // Display footer (με page number αν υπάρχει)
    if (footerText || showPageNum) {
      var fc = footerText || '';
      if (showPageNum && fc) fc += ' — ';
      if (showPageNum) fc += (currentLang === 'el' ? 'Σελ. [προεπισκόπηση]' : 'Page [preview]');
      footerPreview.textContent = fc;
      footerPreview.style.display = 'block';
    } else {
      footerPreview.style.display = 'none';
    }

    // Print CSS (πραγματικό header/footer κατά την εκτύπωση)
    var hfStyle = document.getElementById('oros-print-header-footer');
    if (!hfStyle) {
      hfStyle = document.createElement('style');
      hfStyle.id = 'oros-print-header-footer';
      document.head.appendChild(hfStyle);
    }

    var css = '@media print {';
    if (headerText) {
      css += '.rich-editor::before{content:"' + headerText.replace(/"/g, '\\"') + '";display:block;position:fixed;top:0;left:0;right:0;text-align:center;font-size:9pt;color:#666;border-bottom:1px solid #ccc;padding:4px 0;}';
    }
    var footerContent = '';
    if (footerText) footerContent += '"' + footerText.replace(/"/g, '\\"') + '"';
    if (showPageNum) {
      if (footerContent) footerContent += ' — ';
      footerContent += '"Page " counter(page) " of " counter(pages)';
    }
    if (footerContent) {
      css += '.rich-editor::after{content:' + footerContent + ';display:block;position:fixed;bottom:0;left:0;right:0;text-align:center;font-size:9pt;color:#666;border-top:1px solid #ccc;padding:4px 0;}';
    }
    css += '}';
    hfStyle.textContent = css;
	    clampToViewport();
  }

    function applyPageSettings() {
    var fontSize = localStorage.getItem('oros_writer_font_size') || '16';
    if (richEditor) richEditor.style.fontSize = fontSize + 'px';
    var fontFamily = localStorage.getItem('oros_writer_font_family');
    if (fontFamily && richEditor) richEditor.style.fontFamily = fontFamily;
    var lineHeight = localStorage.getItem('oros_writer_line_height') || '1.8';
    if (richEditor) richEditor.style.lineHeight = lineHeight;
    // ΜΗΝ θέτεις inline max-width — ελέγχεται από CSS [data-page-size] selectors
    if (richEditor) richEditor.style.maxWidth = '';
    var meta = tabsModule.getMetadata ? tabsModule.getMetadata() : {};
    applyPageSize(meta.pageSize || 'a4');
    applyPageMargins();
    applyHeaderFooter();
  }

  function savePageSettings() {
    var pageSize = document.getElementById('page-size-select');
    var marginTop = document.getElementById('margin-top');
    var marginBottom = document.getElementById('margin-bottom');
    var marginLeft = document.getElementById('margin-left');
    var marginRight = document.getElementById('margin-right');
    var headerText = document.getElementById('header-text');
    var footerText = document.getElementById('footer-text');
    var footerPageNum = document.getElementById('footer-page-num');

    var meta = tabsModule.getMetadata();
    if (pageSize) meta.pageSize = pageSize.value;
    if (marginTop) meta.marginTop = marginTop.value;
    if (marginBottom) meta.marginBottom = marginBottom.value;
    if (marginLeft) meta.marginLeft = marginLeft.value;
    if (marginRight) meta.marginRight = marginRight.value;
    if (headerText) meta.headerText = headerText.value;
    if (footerText) meta.footerText = footerText.value;
    if (footerPageNum) meta.footerPageNum = footerPageNum.checked;
    meta.modified = new Date().toISOString();
    tabsModule.setMetadata(meta);
    if (metaModified) metaModified.textContent = 'Modified: ' + new Date(meta.modified).toLocaleString(currentLang === 'el' ? 'el-GR' : 'en-US');
    var metaDates = document.getElementById('meta-dates');
    if (metaDates) metaDates.style.display = '';

    // Εφαρμογή άμεσα
    applyPageSize(meta.pageSize || 'a4');
    applyPageMargins();
    applyHeaderFooter();
    showToast('Page settings applied');
  }

    function loadPageSettingsFields() {
    var meta = tabsModule.getMetadata();
    var setVal = function(id, val, fallback) { var el = document.getElementById(id); if (el) el.value = val || fallback; };
    setVal('page-size-select', meta.pageSize, 'a4');
    setVal('margin-top', meta.marginTop, '2.54');
    setVal('margin-bottom', meta.marginBottom, '2.54');
    setVal('margin-left', meta.marginLeft, '2.54');
    setVal('margin-right', meta.marginRight, '2.54');
    setVal('header-text', meta.headerText, '');
    setVal('footer-text', meta.footerText, '');
    var fpn = document.getElementById('footer-page-num');
    if (fpn) fpn.checked = meta.footerPageNum === true;
    applyPageSize(meta.pageSize || 'a4');
    applyPageMargins();
    applyHeaderFooter();
  }

    function clampToViewport() {
    if (!richEditor) return;
    var headerH = 0;
    var footerH = 0;
    var headerEl = document.getElementById('oros-header');
    var footerEl = document.getElementById('oros-footer');
    if (headerEl) headerH = headerEl.offsetHeight || 56;
    if (footerEl) footerH = footerEl.offsetHeight || 56;

    var reserved = headerH + footerH + (40 + 36) + 40;

        // Reserve χώρο για ορατά header/footer preview
    var previews = ['.header-preview', '.footer-preview'];
    for (var i = 0; i < previews.length; i++) {
      var el = document.querySelector(previews[i]);
      if (el && el.style.display !== 'none' && el.offsetHeight > 0) {
        reserved += el.offsetHeight;
      }
    }

    // Reserve χώρο για ορατό footnote area (max-height: 200px στο CSS)
    var fnArea = document.getElementById('footnote-area');
    if (fnArea && fnArea.style.display !== 'none' && fnArea.offsetHeight > 0) {
      reserved += fnArea.offsetHeight;
    }

    if (window.innerWidth <= 768) reserved += 20;

    var availHeight = window.innerHeight - reserved;
    if (availHeight < 200) availHeight = 200;
    richEditor.style.minHeight = availHeight + 'px';
  }

  var typewriterAudioCtx = null;
  function initTypewriterSound() {}
    function playTypewriterSound() {
    if (!typewriterSoundEnabled) return;
    try {
      if (!typewriterAudioCtx) typewriterAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var ctx = typewriterAudioCtx;
      var now = ctx.currentTime;

      // 1. Mechanical clack — filtered noise burst
      var noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.5);
      var noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;

      var noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 1800 + Math.random() * 400;
      noiseFilter.Q.value = 1.2;

      var noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.35, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
      noise.start(now);
      noise.stop(now + 0.04);

      // 2. Key strike — short tonal body
      var osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(280 + Math.random() * 60, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.03);

      var oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.22, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

      osc.connect(oscGain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.035);

      // 3. Subtle carriage plink — delayed faint high tick
      var osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 900 + Math.random() * 200;

      var osc2Gain = ctx.createGain();
      osc2Gain.gain.setValueAtTime(0, now + 0.018);
      osc2Gain.gain.linearRampToValueAtTime(0.06, now + 0.02);
      osc2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      osc2.connect(osc2Gain).connect(ctx.destination);
      osc2.start(now + 0.018);
      osc2.stop(now + 0.045);
    } catch(e) {}
  }

  // ===== AUTOCORRECT =====
    var DEFAULT_AUTOCORRECT = {
    // --- Typos & Contractions ---
    'dont': "don't", 'cant': "can't", 'wont': "won't", 'isnt': "isn't",
    'wasnt': "wasn't", 'havent': "haven't", 'didnt': "didn't",
    'wouldnt': "wouldn't", 'couldnt': "couldn't", 'shouldnt': "shouldn't",
    'im': "I'm", 'ive': "I've", 'ill': "I'll", 'id': "I'd",
    'teh': 'the', 'recieve': 'receive', 'seperate': 'separate',
    'definately': 'definitely', 'occured': 'occurred', 'untill': 'until',
    'thier': 'their', 'freind': 'friend', 'wich': 'which',
    'alot': 'a lot',
    // --- Greek ---
    'den einai': '\u03B4\u03B5\u03BD \u03B5\u03AF\u03BD\u03B1\u03B9', 'miso': '\u03BC\u03B9\u03C3\u03CC', 'duo': '\u03B4\u03CD\u03BF', 'itan': '\u03B7\u03C4\u03B1\u03BD',
    // --- Symbols ---
    '(c)': '\u00A9',
    '(r)': '\u00AE',
    '(tm)': '\u2122',
    '(p)': '\u00B6',
    '(sm)': '\u2120',
    '->': '\u2192',
    '<-': '\u2190',
    '<->': '\u2194',
    '=>': '\u21D2',
    '<=': '\u21D0',
    '+/-': '\u00B1',
    '1/2': '\u00BD',
    '1/4': '\u00BC',
    '3/4': '\u00BE',
    '1/3': '\u2153',
    '2/3': '\u2154',
    '...': '\u2026',
    '--': '\u2013',
    '---': '\u2014',
    '<<': '\u00AB',
    '>>': '\u00BB',
    '(sec)': '\u00A7',
    '(deg)': '\u00B0',
    '(euro)': '\u20AC'
  };
  var autocorrectRules = {};

  function loadAutoCorrections() {
    try {
      var raw = localStorage.getItem(CONFIG.STORAGE_PREFIX + 'autocorrect');
      if (raw) { autocorrectRules = JSON.parse(raw); }
      else { autocorrectRules = cloneObject(DEFAULT_AUTOCORRECT); saveAutoCorrections(); }
    } catch(e) { autocorrectRules = cloneObject(DEFAULT_AUTOCORRECT); }
  }

  function saveAutoCorrections() {
    try { localStorage.setItem(CONFIG.STORAGE_PREFIX + 'autocorrect', JSON.stringify(autocorrectRules)); } catch(e) {}
  }

  function renderAutocorrectRules() {
    var list = document.getElementById('autocorrect-rules-list');
    if (!list) return;
    var keys = Object.keys(autocorrectRules).sort();
    if (keys.length === 0) { list.innerHTML = '<div class="autocorrect-empty">No rules yet. Add one below.</div>'; return; }
    var html = '';
    for (var i = 0; i < keys.length; i++) {
      var trigger = keys[i];
      var replacement = autocorrectRules[trigger];
      var isDefault = DEFAULT_AUTOCORRECT.hasOwnProperty(trigger);
      html += '<div class="autocorrect-rule-row">' +
        '<input type="text" class="ac-trigger" value="' + escapeHtml(trigger) + '" data-original="' + escapeHtml(trigger) + '">' +
        '<span class="ac-arrow">\u2192</span>' +
        '<input type="text" class="ac-replacement" value="' + escapeHtml(replacement) + '" data-trigger="' + escapeHtml(trigger) + '">' +
        '<button class="ac-delete" data-trigger="' + escapeHtml(trigger) + '" title="Remove"><i class="fa fa-times"></i></button>' +
        (isDefault ? '<span class="ac-badge">default</span>' : '') +
        '</div>';
    }
    list.innerHTML = html;

    var delBtns = list.querySelectorAll('.ac-delete');
    for (var d = 0; d < delBtns.length; d++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var trig = btn.getAttribute('data-trigger');
          delete autocorrectRules[trig];
          saveAutoCorrections();
          renderAutocorrectRules();
          showToast('Rule removed');
        });
      })(delBtns[d]);
    }

    var triggerInputs = list.querySelectorAll('.ac-trigger');
    for (var t = 0; t < triggerInputs.length; t++) {
      (function(inp) {
        inp.addEventListener('change', function() {
          var original = inp.getAttribute('data-original');
          var newVal = inp.value.trim().toLowerCase();
          if (!newVal || newVal === original) return;
          var replacement = autocorrectRules[original];
          delete autocorrectRules[original];
          autocorrectRules[newVal] = replacement;
          saveAutoCorrections();
          renderAutocorrectRules();
        });
      })(triggerInputs[t]);
    }

    var replacementInputs = list.querySelectorAll('.ac-replacement');
    for (var r = 0; r < replacementInputs.length; r++) {
      (function(inp) {
        inp.addEventListener('change', function() {
          var trig = inp.getAttribute('data-trigger');
          autocorrectRules[trig] = inp.value;
          saveAutoCorrections();
        });
      })(replacementInputs[r]);
    }
  }

  function addAutocorrectRule() {
    var triggerInput = document.getElementById('ac-new-trigger');
    var replacementInput = document.getElementById('ac-new-replacement');
    if (!triggerInput || !replacementInput) return;
    var trigger = triggerInput.value.trim().toLowerCase();
    var replacement = replacementInput.value.trim();
    if (!trigger) { showToast('Enter a trigger word'); return; }
    if (!replacement) { showToast('Enter a replacement'); return; }
    autocorrectRules[trigger] = replacement;
    saveAutoCorrections();
    triggerInput.value = '';
    replacementInput.value = '';
    renderAutocorrectRules();
    showToast('Rule added');
  }

  function resetAutocorrectRules() {
    autocorrectRules = cloneObject(DEFAULT_AUTOCORRECT);
    saveAutoCorrections();
    renderAutocorrectRules();
    showToast('Rules reset to defaults');
  }

  // ===== CUSTOM TEMPLATES =====
  function loadCustomTemplates() {
    try {
      var raw = localStorage.getItem(CONFIG.CUSTOM_TEMPLATES_KEY);
      if (raw) customTemplates = JSON.parse(raw);
    } catch(e) { customTemplates = []; }
  }

  function saveCustomTemplates() {
    try { localStorage.setItem(CONFIG.CUSTOM_TEMPLATES_KEY, JSON.stringify(customTemplates)); } catch(e) {}
  }  
  
      function renderTemplatesGrid() {
    var grid = document.getElementById('templates-grid');
    if (!grid) return;
    var html = '';
    for (var i = 0; i < TEMPLATES.length; i++) {
      var t = TEMPLATES[i];
      html += '<div class="template-card" data-template-id="' + t.id + '">' +
        '<i class="fa ' + t.icon + ' template-icon"></i>' +
        '<div class="template-info"><strong>' + escapeHtml(t.title) + '</strong>' +
        '<small>' + escapeHtml(t.desc) + '</small></div></div>';
    }
    if (customTemplates.length > 0) {
      html += '<div class="template-section-divider"><span>Custom Templates</span></div>';
      for (var j = 0; j < customTemplates.length; j++) {
        var ct = customTemplates[j];
        html += '<div class="template-card" data-custom-id="' + ct.id + '">' +
          '<i class="fa fa-file-o template-icon"></i>' +
          '<div class="template-info"><strong>' + escapeHtml(ct.title) + '</strong>' +
          '<small>' + escapeHtml(ct.desc || '') + '</small></div>' +
          '<button class="template-edit-btn" data-edit-id="' + ct.id + '" title="Edit"><i class="fa fa-pencil"></i></button>' +
          '<button class="template-delete-btn" data-delete-id="' + ct.id + '" title="Delete"><i class="fa fa-trash"></i></button></div>';
      }
    }
    grid.innerHTML = html;

    var cards = grid.querySelectorAll('.template-card');
    for (var k = 0; k < cards.length; k++) {
      (function(card) {
        card.addEventListener('mouseenter', function() {
          var eb = card.querySelector('.template-edit-btn');
          if (eb) eb.style.opacity = '1';
        });
        card.addEventListener('mouseleave', function() {
          var eb = card.querySelector('.template-edit-btn');
          if (eb) eb.style.opacity = '0';
        });
        card.addEventListener('click', function(e) {
          if (e.target.closest('.template-delete-btn')) return;
          if (e.target.closest('.template-edit-btn')) return;
          var tplId = card.getAttribute('data-template-id');
          var customId = card.getAttribute('data-custom-id');
          var content = '';
          if (tplId) {
            for (var i = 0; i < TEMPLATES.length; i++) { if (TEMPLATES[i].id === tplId) { content = TEMPLATES[i].content; break; } }
          } else if (customId) {
            for (var j = 0; j < customTemplates.length; j++) { if (customTemplates[j].id === customId) { content = customTemplates[j].content; break; } }
          }
          if (!content) return;
          if (richEditor) {
            richEditor.innerHTML = content;
            saveCurrentTabContent();
            updateStats();
          }
          var dlg = document.getElementById('templates-dialog-overlay');
          if (dlg) dlg.style.display = 'none';
          showToast('Template applied');
        });
      })(cards[k]);
    }

    var delBtns = grid.querySelectorAll('.template-delete-btn');
    for (var d = 0; d < delBtns.length; d++) {
      (function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var id = btn.getAttribute('data-delete-id');
          customTemplates = customTemplates.filter(function(ct) { return ct.id !== id; });
          saveCustomTemplates();
          renderTemplatesGrid();
          showToast('Template deleted');
        });
      })(delBtns[d]);
    }

    var editBtns = grid.querySelectorAll('.template-edit-btn');
    for (var e = 0; e < editBtns.length; e++) {
      (function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var id = btn.getAttribute('data-edit-id');
          var tpl = null;
          for (var i = 0; i < customTemplates.length; i++) { if (customTemplates[i].id === id) { tpl = customTemplates[i]; break; } }
          if (!tpl) return;
          var newTitle = prompt('Template title:', tpl.title);
          if (newTitle === null) return;
          var newDesc = prompt('Description:', tpl.desc || '');
          if (newDesc === null) return;
          tpl.title = newTitle.trim() || 'Untitled';
          tpl.desc = newDesc.trim();
          saveCustomTemplates();
          renderTemplatesGrid();
          showToast('Template updated');
        });
      })(editBtns[e]);
    }
  }

  // ===== FIND & REPLACE =====
  var findTypingTimer = null;
  var replaceTypingTimer = null;
  var findHistory = [];
  var findHistoryIndex = -1;

    function setupFindReplace() {
    if (findInput) {
      findInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          findInDocument();
          findNext();
          return;
        }
      });
      findInput.addEventListener('keyup', function(e) {
        if (e.key === 'Enter') return;
        clearTimeout(findTypingTimer);
        findTypingTimer = setTimeout(findInDocument, 300);
      });
    }
    if (replaceInput) {
      replaceInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          replaceMatch();
        }
      });
    }
    bindClick('btn-find-prev', findPrevious);
    bindClick('btn-find-next', findNext);
	    bindClick('btn-find-search', function() {
      findInDocument();
      var matches = richEditor.querySelectorAll('.find-match');
      if (matches.length > 0) {
        for (var r = 0; r < matches.length; r++) matches[r].classList.remove('current');
        matches[0].classList.add('current');
        var range = document.createRange();
        range.selectNodeContents(matches[0]);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        matches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (frResults) frResults.textContent = '1/' + matches.length;
      }
    });
    bindClick('btn-replace', replaceMatch);
    bindClick('btn-replace-all', replaceAll);
    bindClick('btn-close-find', function() {
      if (findBar) findBar.style.display = 'none';
      var fbtn = document.getElementById('btn-find');
      if (fbtn) fbtn.classList.remove('active');
      hideSearchHighlights();
    });
  }

      function findInDocument() {
    hideSearchHighlights();
    if (!findInput || !richEditor) return;
    var term = findInput.value.trim();
    if (!term) { if (frResults) frResults.textContent = '0/0'; return; }

    var rawFilter = findFormatFilter ? findFormatFilter.value : 'all';
    // Ασφάλεια: αν δεν αναγνωρίζεται, treat as 'all'
    var knownFilters = ['all', 'bold', 'italic', 'underline', 'strikethrough'];
    var formatFilter = knownFilters.indexOf(rawFilter) !== -1 ? rawFilter : 'all';

    var count = 0;
    var nodes = [];
    var walker = document.createTreeWalker(richEditor, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) { nodes.push(walker.currentNode); }

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var text = node.textContent;
      var pos = 0;
      while ((pos = text.toLowerCase().indexOf(term.toLowerCase(), pos)) !== -1) {

        if (formatFilter !== 'all') {
          var hasFmt = false;
          var el = node.parentElement;
          while (el && el !== richEditor) {
            var tag = el.tagName;
            var style = el.style;
            if (formatFilter === 'bold' &&
                (tag === 'B' || tag === 'STRONG' ||
                 (style && (style.fontWeight === 'bold' || style.fontWeight === '700')))) {
              hasFmt = true; break;
            } else if (formatFilter === 'italic' &&
                (tag === 'I' || tag === 'EM' ||
                 (style && style.fontStyle === 'italic'))) {
              hasFmt = true; break;
            } else if (formatFilter === 'underline' &&
                (tag === 'U' ||
                 (style && style.textDecoration && style.textDecoration.indexOf('underline') !== -1))) {
              hasFmt = true; break;
            } else if (formatFilter === 'strikethrough' &&
                (tag === 'S' || tag === 'DEL' ||
                 (style && style.textDecoration && style.textDecoration.indexOf('line-through') !== -1))) {
              hasFmt = true; break;
            }
            el = el.parentElement;
          }
          if (!hasFmt) { pos += term.length; continue; }
        }

        var fragment = document.createDocumentFragment();
        var before = document.createTextNode(text.substring(0, pos));
        var highlight = document.createElement('mark');
        highlight.className = 'find-match';
        highlight.textContent = text.substring(pos, pos + term.length);
        var after = document.createTextNode(text.substring(pos + term.length));
        fragment.appendChild(before);
        fragment.appendChild(highlight);
        fragment.appendChild(after);
        node.parentNode.replaceChild(fragment, node);
        count++;
        node = after;
        pos += term.length;
      }
    }

    if (frResults) frResults.textContent = count + '/' + count;
  }

    function hideSearchHighlights() {
    if (!richEditor) return;
    var matches = richEditor.querySelectorAll('.find-match');
    for (var i = 0; i < matches.length; i++) {
      var parent = matches[i].parentNode;
      parent.replaceChild(document.createTextNode(matches[i].textContent), matches[i]);
      parent.normalize();
    }
    if (frResults) frResults.textContent = '0/0';
  }

  function findNext() { findNavigate(1); }
  function findPrevious() { findNavigate(-1); }

    function findNavigate(dir) {
    if (!findInput || !richEditor) return;
    var term = findInput.value.trim();
    if (!term) return;
    var matches = richEditor.querySelectorAll('.find-match');
    if (matches.length === 0) {
      findInDocument();
      matches = richEditor.querySelectorAll('.find-match');
    }
    if (matches.length === 0) return;

    for (var r = 0; r < matches.length; r++) matches[r].classList.remove('current');

    var sel = window.getSelection();
    var anchorNode = sel.anchorNode;
    var currentMatchIdx = 0;

    if (anchorNode) {
      for (var i = 0; i < matches.length; i++) {
        if (matches[i].contains(anchorNode) || matches[i] === anchorNode) {
          currentMatchIdx = i;
          break;
        }
      }
    }

    var nextIdx = dir > 0
      ? (currentMatchIdx + 1) % matches.length
      : (currentMatchIdx - 1 + matches.length) % matches.length;

    var target = matches[nextIdx];
    target.classList.add('current');

    var range = document.createRange();
    range.selectNodeContents(target);
    sel.removeAllRanges();
    sel.addRange(range);
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (frResults) frResults.textContent = (nextIdx + 1) + '/' + matches.length;
  }

  function replaceMatch() {
    var sel = window.getSelection();
    if (sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    var selected = range.toString();
    var replaceWith = replaceInput ? replaceInput.value : '';
    if (!selected) { findNext(); return; }
    range.deleteContents();
    range.insertNode(document.createTextNode(replaceWith));
    findNext();
  }

    function replaceAll() {
    if (!findInput || !richEditor) return;
    var term = findInput.value.trim();
    if (!term) { showToast('Enter find text'); return; }
    var replacement = replaceInput ? replaceInput.value : '';

    var matches = richEditor.querySelectorAll('.find-match');
    var replaced = 0;
    for (var i = 0; i < matches.length; i++) {
      matches[i].textContent = replacement;
      replaced++;
    }

    hideSearchHighlights();
    findInDocument();
    saveCurrentTabContent();
    updateStats();
    showToast(replaced + ' occurrence' + (replaced !== 1 ? 's' : '') + ' replaced');
  }

  function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ===== WORD FREQUENCY =====
  function setupWordFrequency() {
    bindClick('btn-wordfreq', toggleWordFreq);
  }

  function toggleWordFreq() {
    if (!wordFreqPanel) return;
    var isVisible = wordFreqPanel.style.display !== 'none';
    wordFreqPanel.style.display = isVisible ? 'none' : '';
    if (!isVisible) calculateWordFrequency();
  }

    function calculateWordFrequency() {
    if (!richEditor) return;
    var text = richEditor.innerText || '';
    text = text.toLowerCase().replace(/[.,!?;:"'()\[\]{}]/g, '').trim();
    var words = text.split(/\s+/).filter(function(w) { return w && w.length > 2; });
    var freq = {};
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      freq[w] = (freq[w] || 0) + 1;
    }
    var arr = [];
    var keys = Object.keys(freq);
    for (var k = 0; k < keys.length; k++) { arr.push({ word: keys[k], count: freq[keys[k]] }); }
    arr.sort(function(a, b) { return b.count - a.count; });
    arr = arr.slice(0, 50);

    // Σύνοψη σε πλαίσιο
    if (wordFreqSummary) {
      if (arr.length > 0 && words.length > 0) {
        var unique = arr.length;
        var topPct = Math.round((arr[0].count / words.length) * 100);
        wordFreqSummary.innerHTML =
          '<div class="wordfreq-summary-box">' +
          '<span class="wordfreq-summary-icon"><i class="fa fa-language"></i></span>' +
          '<span class="wordfreq-summary-text">' + unique + ' unique words · Top "' + escapeHtml(arr[0].word) + '" ' + topPct + '%</span>' +
          '</div>';
      } else {
        wordFreqSummary.innerHTML = '<div class="wordfreq-summary-box">Type to analyze word frequency</div>';
      }
    }

    // Λίστα με χρυσές μπάρες
    if (wordFreqList) {
      if (arr.length === 0) {
        wordFreqList.innerHTML = '<div class="wordfreq-empty">Type to analyze</div>';
      } else {
        var maxCount = arr[0].count;
        var html = '';
        for (var j = 0; j < arr.length; j++) {
          var pct = Math.round((arr[j].count / maxCount) * 100);
          var isOverused = arr[j].count >= 5 && (arr[j].count / words.length) > 0.03;
          html += '<div class="wordfreq-item' + (isOverused ? ' overused' : '') + '">' +
            '<span class="wf-word">' + escapeHtml(arr[j].word) + '</span>' +
            '<div class="wordfreq-bar"><div class="wordfreq-bar-fill" style="width:' + pct + '%;"></div></div>' +
            '<span class="wordfreq-count">' + arr[j].count + '</span>' +
            '</div>';
        }
        wordFreqList.innerHTML = html;
      }
    }
  }

    // ===== COMMENTS =====
  function setupComments() {
    bindClick('btn-comments', toggleCommentsPanel);
    bindClick('btn-add-comment', addCommentFromPanel);
    loadAndRestoreComments();

    // selectionchange listener
    document.addEventListener('selectionchange', function() {
      if (!commentsPanel || commentsPanel.style.display === 'none') return;
      var sel = window.getSelection();
      if (sel.rangeCount > 0 && richEditor && richEditor.contains(sel.anchorNode)) {
        var range = sel.getRangeAt(0);
        if (!range.collapsed) {
          savedCommentRange = range.cloneRange();
          var addArea = document.getElementById('comment-add-area');
          if (addArea) addArea.style.display = '';
          var ci = document.getElementById('comment-input');
          if (ci) ci.placeholder = '"' + range.toString().substring(0, 40) + (range.toString().length > 40 ? '…' : '') + '"';
        }
      }
    });

    // Click on commented text → highlight card (independent listener)
    if (richEditor) {
      richEditor.addEventListener('click', function(e) {
        var highlight = e.target.closest ? e.target.closest('.comment-highlight') : null;
        if (!highlight && e.target.classList && e.target.classList.contains('comment-highlight')) {
          highlight = e.target;
        }
        if (!highlight) return;

        var cid = highlight.getAttribute('data-comment-id');
        if (!cid || !commentsPanel) return;

        var cards = commentsPanel.querySelectorAll('.comment-item.card-active');
        for (var c = 0; c < cards.length; c++) cards[c].classList.remove('card-active');

        var card = commentsPanel.querySelector('.comment-item[data-comment-id="' + cid + '"]');
        if (card) {
          card.classList.add('card-active');
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (card._cardTimeout) clearTimeout(card._cardTimeout);
          card._cardTimeout = setTimeout(function() { card.classList.remove('card-active'); }, 2500);
        }
      });
    }
  }

    function toggleCommentsPanel() {
    if (!commentsPanel) return;
    
    var btn = document.getElementById('btn-comments');
    var isVisible = commentsPanel.style.display !== 'none' && commentsPanel.style.display !== '';
    
    if (!isVisible) {
      // Open panel
      var sel = window.getSelection();
      if (sel.rangeCount > 0 && richEditor && richEditor.contains(sel.anchorNode)) {
        savedCommentRange = sel.getRangeAt(0).cloneRange();
      } else {
        savedCommentRange = null;
      }
      var addArea = document.getElementById('comment-add-area');
      if (addArea) addArea.style.display = '';
      var ci = document.getElementById('comment-input');
            if (ci) { ci.value = ''; }
      
      commentsPanel.style.display = '';
      if (btn) btn.classList.add('active');
      refreshCommentsList();
    } else {
      // Close panel
      commentsPanel.style.display = 'none';
      if (btn) btn.classList.remove('active');
    }
  }

    function loadAndRestoreComments() {
    if (!richEditor) return;
    var tab = tabsModule.getActive();
    if (!tab || !tab.metadata || !tab.metadata.comments) return;
    var comments = tab.metadata.comments || [];
    for (var i = 0; i < comments.length; i++) {
      var c = comments[i];
      var highlights = richEditor.querySelectorAll('[data-comment-id="' + c.id + '"]');
      for (var j = 0; j < highlights.length; j++) {
        highlights[j].classList.add('comment-highlight');
      }
    }
  }

    function saveComments() {
    if (!richEditor) return [];
    var tab = tabsModule.getActive();
    if (!tab) return [];
    var highlights = richEditor.querySelectorAll('.comment-highlight');
    var comments = [];
    var seenIds = {};
    for (var i = 0; i < highlights.length; i++) {
      var id = highlights[i].getAttribute('data-comment-id');
      if (!id || seenIds[id]) continue;
      seenIds[id] = true;
      var text = highlights[i].getAttribute('data-text') || '';
      var timestamp = highlights[i].getAttribute('data-timestamp') || new Date().toISOString();
      var quoted = highlights[i].getAttribute('data-quoted') || highlights[i].textContent || '';
      comments.push({ id: id, text: text, timestamp: timestamp, quoted: quoted });
    }
    var meta = tabsModule.getMetadata();
    meta.comments = comments;
    tabsModule.setMetadata(meta);
    return comments;
  }

    function refreshCommentsList() {
    if (!commentsPanel) return;
    var list = commentsPanel.querySelector('#comments-list');
    if (!list) return;
    
    var tab = tabsModule.getActive();
    var comments = (tab && tab.metadata && tab.metadata.comments) || [];
    
    if (comments.length === 0) {
      list.innerHTML = '<div class="comments-empty">' + (getTrans('no_comments') !== 'no_comments' ? getTrans('no_comments') : 'No comments yet') + '</div>';
      return;
    }
    
    var html = '';
    for (var i = 0; i < comments.length; i++) {
      var c = comments[i];
      var date = new Date(c.timestamp).toLocaleString(currentLang === 'el' ? 'el-GR' : 'en-US');
      html += '<div class="comment-item" data-comment-id="' + c.id + '">' +
        '<div class="comment-meta">' +
          '<span class="comment-date">' + date + '</span>' +
          '<button class="comment-delete" data-id="' + c.id + '" title="' + (getTrans('delete') !== 'delete' ? getTrans('delete') : 'Delete') + '"><i class="fa fa-trash"></i></button>' +
        '</div>' +
        '<div class="comment-text">' + escapeHtml(c.text) + '</div>' +
        '<div class="comment-quoted" data-id="' + c.id + '">' + (c.quoted ? escapeHtml(c.quoted) : '') + '</div>' +
      '</div>';
    }
    list.innerHTML = html;
    
    // Add click handlers for highlighting + delete
    var deleteBtns = list.querySelectorAll('.comment-delete');
    for (var d = 0; d < deleteBtns.length; d++) {
      (function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var cid = btn.getAttribute('data-id');
          if (confirm('Delete this comment?')) {
            deleteCommentById(cid);
          }
        });
      })(deleteBtns[d]);
    }
    
        // Hover on comment card → highlight text in editor
    var items = list.querySelectorAll('.comment-item');
    for (var ci = 0; ci < items.length; ci++) {
      (function(item) {
        var cid = item.getAttribute('data-comment-id');
        item.addEventListener('mouseenter', function() {
          highlightCommentInTextPersistent(cid);
        });
        item.addEventListener('mouseleave', function() {
          clearCommentHighlight();
        });
      })(items[ci]);
    }
  }

  function highlightCommentInTextPersistent(commentId) {
    clearCommentHighlight();
    if (!richEditor) return;
    var highlights = richEditor.querySelectorAll('[data-comment-id="' + commentId + '"]');
    for (var h = 0; h < highlights.length; h++) {
      highlights[h].classList.add('comment-active');
      highlights[h].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  
    function addCommentFromPanel() {
    var textarea = document.getElementById('comment-input');
    if (!textarea || !textarea.value.trim()) { showToast('Enter comment text'); return; }

    if (!savedCommentRange || savedCommentRange.collapsed) {
      showToast('Select text to comment on first');
      return;
    }

    var selectedText = savedCommentRange.toString().trim();
    if (!selectedText) { showToast('Select text to comment on first'); return; }

    if (richEditor) {
      richEditor.focus();
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedCommentRange);
    }

    createComment(textarea.value.trim(), selectedText);
    textarea.value = '';
    savedCommentRange = null;
    refreshCommentsList();
    showToast('Comment added');
  }

    function createComment(commentText, quotedText) {
    var id = 'comm_' + Date.now();
    var timestamp = new Date().toISOString();
    var highlight = document.createElement('span');
    highlight.className = 'comment-highlight';
    highlight.setAttribute('data-comment-id', id);
    highlight.setAttribute('data-text', commentText);      // ← ΠΡΟΣΘΕΣΕ ΑΥΤΗ ΤΗ ΓΡΑΜΜΗ
    highlight.setAttribute('data-quoted', quotedText);
    highlight.setAttribute('data-timestamp', timestamp);
    highlight.textContent = quotedText;

    var sel = window.getSelection();
    if (sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(highlight);

    var newRange = document.createRange();
    newRange.setStartAfter(highlight);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    var tab = tabsModule.getActive();
    if (!tab) return;
    var meta = tabsModule.getMetadata();
    var comments = meta.comments || [];
    comments.push({
      id: id,
      text: commentText,
      timestamp: timestamp,
      quoted: quotedText
    });
    meta.comments = comments;
    tabsModule.setMetadata(meta);
    saveCurrentTabContent();
  }
  
      // ===== FOOTNOTES =====
  var footnoteCounter = 0;
    var savedFootnoteRange = null;
  var savedCommentRange = null;
  var savedLinkRange = null;      
  var savedImageRange = null;    
  var savedTableRange = null;     

  function setupFootnotes() {
    bindClick('btn-footnote', insertFootnote);
    bindClick('btn-insert-footnote', insertFootnoteFromDialog);
    bindClick('btn-close-footnotes', function() { if (footnoteArea) footnoteArea.style.display = 'none'; });
    setupFootnoteCleanup();
  }
  
   /* ===== COMMENT CLEANUP ON DELETE ===== */
  var commentCleanupObserver = null;
  var commentCleanupTimer = null;

  function setupCommentCleanup() {
    if (!richEditor || commentCleanupObserver) return;
    commentCleanupObserver = new MutationObserver(function() {
      clearTimeout(commentCleanupTimer);
      commentCleanupTimer = setTimeout(checkAndRemoveOrphanComments, 200);
    });
    commentCleanupObserver.observe(richEditor, { childList: true, subtree: true, characterData: true });
  }

  function checkAndRemoveOrphanComments() {
    var tab = tabsModule.getActive();
    if (!tab || !tab.metadata || !tab.metadata.comments) return;
    var comments = tab.metadata.comments;
    var orphaned = [];

    for (var i = 0; i < comments.length; i++) {
      var id = comments[i].id;
      var highlight = richEditor.querySelector('[data-comment-id="' + id + '"]');
      if (!highlight || !highlight.textContent.trim()) {
        orphaned.push(id);
      }
    }

    if (orphaned.length === 0) return;

    for (var o = 0; o < orphaned.length; o++) {
      var els = richEditor.querySelectorAll('[data-comment-id="' + orphaned[o] + '"]');
      for (var e = 0; e < els.length; e++) {
        var parent = els[e].parentNode;
        parent.replaceChild(document.createTextNode(els[e].textContent), els[e]);
        parent.normalize();
      }
    }

    tab.metadata.comments = comments.filter(function(c) {
      return orphaned.indexOf(c.id) === -1;
    });
    tabsModule.setMetadata(tab.metadata);
    saveCurrentTabContent();
    refreshCommentsList();
  }

  function deleteCommentsByIds(commIds) {
    var tab = tabsModule.getActive();
    if (!tab || !tab.metadata || !tab.metadata.comments) return;

    for (var i = 0; i < commIds.length; i++) {
      var els = richEditor.querySelectorAll('[data-comment-id="' + commIds[i] + '"]');
      for (var e = 0; e < els.length; e++) {
        var parent = els[e].parentNode;
        parent.replaceChild(document.createTextNode(els[e].textContent), els[e]);
        parent.normalize();
      }
    }

    tab.metadata.comments = tab.metadata.comments.filter(function(c) {
      return commIds.indexOf(c.id) === -1;
    });
    tabsModule.setMetadata(tab.metadata);
    saveCurrentTabContent();
    refreshCommentsList();
  }

  function deleteCommentById(id) {
    var tab = tabsModule.getActive();
    if (!tab || !tab.metadata || !tab.metadata.comments) return;

    var highlights = richEditor.querySelectorAll('[data-comment-id="' + id + '"]');
    for (var h = 0; h < highlights.length; h++) {
      var parent = highlights[h].parentNode;
      parent.replaceChild(document.createTextNode(highlights[h].textContent), highlights[h]);
      parent.normalize();
    }

    tab.metadata.comments = tab.metadata.comments.filter(function(c) { return c.id !== id; });
    tabsModule.setMetadata(tab.metadata);
    saveCurrentTabContent();
    refreshCommentsList();
    showToast('Comment deleted');
  }

  function highlightCommentInText(commentId) {
    clearCommentHighlight();
    var highlights = richEditor.querySelectorAll('[data-comment-id="' + commentId + '"]');
    for (var h = 0; h < highlights.length; h++) {
      highlights[h].classList.add('comment-flash');
      highlights[h].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(function() {
      var flashes = richEditor.querySelectorAll('.comment-flash');
      for (var f = 0; f < flashes.length; f++) flashes[f].classList.remove('comment-flash');
    }, 1500);
  }

    function clearCommentHighlight() {
    if (!richEditor) return;
    var highlights = richEditor.querySelectorAll('.comment-flash, .comment-active');
    for (var h = 0; h < highlights.length; h++) {
      highlights[h].classList.remove('comment-flash');
      highlights[h].classList.remove('comment-active');
    }
  }

  function insertFootnote() {
    var sel = window.getSelection();
    if (sel.rangeCount > 0 && richEditor && richEditor.contains(sel.anchorNode)) {
      savedFootnoteRange = sel.getRangeAt(0).cloneRange();
    } else {
      savedFootnoteRange = null;
    }

    var dlg = document.getElementById('footnote-dialog-overlay');
    if (dlg) {
      dlg.style.display = 'flex';
      var txtInput = document.getElementById('footnote-text-input');
      if (txtInput) {
        txtInput.value = (savedFootnoteRange && !savedFootnoteRange.collapsed) ? savedFootnoteRange.toString() : '';
        setTimeout(function() { txtInput.focus(); }, 50);
      }
    }
  }

  function insertFootnoteFromDialog() {
    var txtInput = document.getElementById('footnote-text-input');
    var text = txtInput ? txtInput.value.trim() : '';
    if (!text) { showToast('Enter footnote text'); return; }

    var dlg = document.getElementById('footnote-dialog-overlay');
    if (dlg) dlg.style.display = 'none';

    footnoteCounter++;
    var refId = 'fn_ref_' + footnoteCounter;
    var fnId = 'fn_' + footnoteCounter;
    var sup = document.createElement('sup');
    sup.innerHTML = '<a href="#' + fnId + '" id="' + refId + '" class="footnote-ref" data-fn-id="' + fnId + '">[' + footnoteCounter + ']</a>';

    var range;
    if (savedFootnoteRange) {
      range = savedFootnoteRange;
    } else if (richEditor) {
      richEditor.focus();
      var sel = window.getSelection();
      if (sel.rangeCount > 0 && richEditor.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0);
      } else {
        range = document.createRange();
        range.selectNodeContents(richEditor);
        range.collapse(false);
      }
    } else {
      showToast('Click in the editor first');
      return;
    }

    savedFootnoteRange = null;

    try {
      range.deleteContents();
      range.insertNode(sup);

      var newRange = document.createRange();
      newRange.setStartAfter(sup);
      newRange.collapse(true);
      var newSel = window.getSelection();
      newSel.removeAllRanges();
      newSel.addRange(newRange);
    } catch(e) {
      showToast('Could not insert footnote at cursor');
      return;
    }

    var fnArea = document.getElementById('footnote-area');
    if (fnArea) {
      fnArea.style.display = '';
      var fnEntry = document.createElement('div');
      fnEntry.id = fnId;
      fnEntry.className = 'footnote-entry';
      fnEntry.innerHTML = '<a href="#' + refId + '" class="footnote-back" data-ref-id="' + refId + '">[' + footnoteCounter + ']</a> <span class="footnote-text">' + escapeHtml(text) + '</span>';
      fnArea.appendChild(fnEntry);
      setupFootnoteLinkHandler(fnEntry.querySelector('.footnote-back'));
      fnArea.scrollIntoView({ behavior: 'smooth' });
    }

    var tab = tabsModule.getActive();
    if (tab) {
      var meta = tabsModule.getMetadata();
      var footnotes = meta.footnotes || [];
      footnotes.push({ refId: refId, fnId: fnId, number: footnoteCounter, text: text });
      meta.footnotes = footnotes;
      tabsModule.setMetadata(meta);
    }

    if (txtInput) txtInput.value = '';
    renumberFootnotes();
	    clampToViewport();
    showToast('Footnote added');
  }

  function setupFootnoteLinkHandler(link) {
    if (!link) return;
    link.addEventListener('click', function(e) {
      e.preventDefault();
      var refId = link.getAttribute('data-ref-id') || link.getAttribute('href').substring(1);
      var refEl = document.getElementById(refId);
      if (refEl) {
        refEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        refEl.classList.remove('outline-flash');
        void refEl.offsetWidth;
        refEl.classList.add('outline-flash');
        setTimeout(function() { refEl.classList.remove('outline-flash'); }, 1200);
      }
    });
  }

    function _handleFootnoteRefClick(e) {
    var link = e.target.closest ? e.target.closest('.footnote-ref') : null;
    if (!link) return;

    e.preventDefault();
    e.stopPropagation();

    var fnId = link.getAttribute('data-fn-id');
    if (!fnId) return;

    var fnEl = document.getElementById(fnId);
    if (!fnEl) { console.warn('Footnote entry not found:', fnId); return; }

    fnEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    var allHighlights = document.querySelectorAll('.footnote-entry.flash-highlight');
    for (var i = 0; i < allHighlights.length; i++) {
      allHighlights[i].classList.remove('flash-highlight');
    }

    void fnEl.offsetWidth;
    fnEl.classList.add('flash-highlight');
    fnEl.style.cssText += ';background-color: rgba(109,76,255,0.35) !important;transition: background-color 0.3s ease;';

    if (fnEl._flashTimeout) clearTimeout(fnEl._flashTimeout);
    fnEl._flashTimeout = setTimeout(function() {
      fnEl.classList.remove('flash-highlight');
      fnEl.style.backgroundColor = '';
      delete fnEl._flashTimeout;
    }, 1500);
  }

  function bindForwardRefClicks() {
    if (!richEditor) return;
    richEditor.removeEventListener('click', _handleFootnoteRefClick);
    richEditor.addEventListener('click', _handleFootnoteRefClick);
  }

  function restoreFootnotes() {
    var tab = tabsModule.getActive();
    var fnArea = document.getElementById('footnote-area');
    if (!fnArea) return;

    fnArea.innerHTML = '';
    footnoteCounter = 0;

    if (!tab || !tab.metadata || !tab.metadata.footnotes || tab.metadata.footnotes.length === 0) {
      fnArea.style.display = 'none';
      return;
    }

    var footnotes = tab.metadata.footnotes;
    for (var i = 0; i < footnotes.length; i++) {
      var f = footnotes[i];
      var entry = document.createElement('div');
      entry.id = f.fnId;
      entry.className = 'footnote-entry';
      entry.innerHTML = '<a href="#' + f.refId + '" class="footnote-back" data-ref-id="' + f.refId + '">[' + f.number + ']</a> <span class="footnote-text">' + escapeHtml(f.text) + '</span>';
      fnArea.appendChild(entry);
      setupFootnoteLinkHandler(entry.querySelector('.footnote-back'));
      footnoteCounter = Math.max(footnoteCounter, f.number);
    }
    fnArea.style.display = '';

    // Renumber all footnotes sequentially after restore
    renumberFootnotes();
  }

      function renumberFootnotes() {
    if (!richEditor) return;

    var refs = richEditor.querySelectorAll('.footnote-ref');
    if (refs.length === 0) {
      footnoteCounter = 0;
      return;
    }

    var tab = tabsModule.getActive();
    var footnotes = (tab && tab.metadata && tab.metadata.footnotes) || [];
    var fnArea = document.getElementById('footnote-area');

    var entryMap = {};
    if (fnArea) {
      var entries = fnArea.querySelectorAll('.footnote-entry');
      for (var e = 0; e < entries.length; e++) {
        entryMap[entries[e].id] = entries[e];
      }
    }

    var metaMap = {};
    for (var m = 0; m < footnotes.length; m++) {
      metaMap[footnotes[m].fnId] = footnotes[m];
    }

    for (var i = 0; i < refs.length; i++) {
      var newNum = i + 1;
      var newFnId = 'fn_' + newNum;
      var newRefId = 'fn_ref_' + newNum;
      var oldFnId = refs[i].getAttribute('data-fn-id');

      refs[i].href = '#' + newFnId;
      refs[i].id = newRefId;
      refs[i].setAttribute('data-fn-id', newFnId);
      refs[i].innerHTML = '[' + newNum + ']';

      var entry = entryMap[oldFnId];
      if (entry) {
        entry.id = newFnId;
        var backLink = entry.querySelector('.footnote-back');
        if (backLink) {
          var newBackLink = backLink.cloneNode(true);
          newBackLink.href = '#' + newRefId;
          newBackLink.setAttribute('data-ref-id', newRefId);
          newBackLink.innerHTML = '[' + newNum + ']';
          backLink.parentNode.replaceChild(newBackLink, backLink);
          setupFootnoteLinkHandler(newBackLink);
        }
      }

      var metaFn = metaMap[oldFnId];
      if (metaFn) {
        metaFn.refId = newRefId;
        metaFn.fnId = newFnId;
        metaFn.number = newNum;
      }
    }

    footnotes.sort(function(a, b) { return a.number - b.number; });
    if (tab) {
      tab.metadata.footnotes = footnotes;
      tabsModule.setMetadata(tab.metadata);
    }

    // Re-order footnote entries in DOM to match editor order
    if (fnArea) {
      for (var ri = 0; ri < refs.length; ri++) {
        var refFnId = refs[ri].getAttribute('data-fn-id');
        var matchingEntry = fnArea.querySelector('#' + refFnId);
        if (matchingEntry) fnArea.appendChild(matchingEntry);
      }
    }

    footnoteCounter = refs.length;
    bindForwardRefClicks();
    saveCurrentTabContent();
  }

  /* ===== FOOTNOTE CLEANUP ON DELETE ===== */
  var footnoteCleanupObserver = null;

  function setupFootnoteCleanup() {
    if (!richEditor || footnoteCleanupObserver) return;
    footnoteCleanupObserver = new MutationObserver(function(mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var mutation = mutations[m];
        if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
          checkAndRemoveOrphanFootnotes(mutation.removedNodes);
        }
      }
    });
    footnoteCleanupObserver.observe(richEditor, { childList: true, subtree: true });
  }

  function checkAndRemoveOrphanFootnotes(removedNodes) {
    var removedRefs = [];
    for (var i = 0; i < removedNodes.length; i++) {
      var node = removedNodes[i];
      if (node.nodeType === Node.ELEMENT_NODE) {
        var refs = node.querySelectorAll ? node.querySelectorAll('.footnote-ref') : [];
        for (var r = 0; r < refs.length; r++) {
          var fnId = refs[r].getAttribute('data-fn-id');
          if (fnId && removedRefs.indexOf(fnId) === -1) removedRefs.push(fnId);
        }
      }
    }
    if (removedRefs.length > 0) removeFootnotesByIds(removedRefs);
  }

  function removeFootnotesByIds(fnIds) {
    var tab = tabsModule.getActive();
    if (!tab || !tab.metadata || !tab.metadata.footnotes) return;
    tab.metadata.footnotes = tab.metadata.footnotes.filter(function(f) {
      return fnIds.indexOf(f.fnId) === -1;
    });
    restoreFootnotes();
    tabsModule.setMetadata(tab.metadata);
    updateSaveIndicator('saved');
  }
  
  // ===== VERSION HISTORY =====
  var versionHistoryInterval = null;
  var MAX_AUTO_VERSIONS = 8;

  function setupVersionHistory() {
    bindClick('btn-version-history', toggleVersionsPanel);
    bindClick('btn-add-version', addManualSnapshot);
    startVersionSnapshots();
  }

  function toggleVersionsPanel() {
    if (!versionPanel) return;
    var isVisible = versionPanel.style.display !== 'none';
    versionPanel.style.display = isVisible ? 'none' : '';
    var btn = document.getElementById('btn-version-history');
    if (btn) btn.classList.toggle('active', !isVisible);
    if (!isVisible) refreshVersionList();
  }

  function startVersionSnapshots() {
    if (versionHistoryInterval) clearInterval(versionHistoryInterval);
    versionHistoryInterval = setInterval(function() {
      var tab = tabsModule.getActive();
      if (!tab) return;
      var content = richEditor ? richEditor.innerHTML : '';
      var hash = simpleHash(content);
      tab.versions = tab.versions || [];

      var lastVersion = tab.versions[tab.versions.length - 1];
      if (lastVersion && lastVersion.hash === hash) return;

      tab.versions.push({
        hash: hash,
        timestamp: new Date().toISOString(),
        snapshot: content,
        type: 'auto',
        metadata: cloneObject(tab.metadata || {})
      });

      trimAutoVersions(tab);
      tabsModule.persist();
    }, 30000);
  }

  function trimAutoVersions(tab) {
    var autoIndices = [];
    for (var i = 0; i < tab.versions.length; i++) {
      if (tab.versions[i].type === 'auto' || !tab.versions[i].type) {
        autoIndices.push(i);
      }
    }
    while (autoIndices.length > MAX_AUTO_VERSIONS) {
      tab.versions.splice(autoIndices.shift(), 1);
      autoIndices = [];
      for (var j = 0; j < tab.versions.length; j++) {
        if (tab.versions[j].type === 'auto' || !tab.versions[j].type) {
          autoIndices.push(j);
        }
      }
    }
  }

  function addManualSnapshot() {
    var tab = tabsModule.getActive();
    if (!tab || !richEditor) return;
    var content = richEditor.innerHTML;
    tab.versions = tab.versions || [];

    tab.versions.push({
      hash: simpleHash(content),
      timestamp: new Date().toISOString(),
      snapshot: content,
      type: 'manual',
      metadata: cloneObject(tab.metadata || {})
    });
    tabsModule.persist();
    refreshVersionList();
    showToast('Manual snapshot saved');
  }

  function simpleHash(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
    return hash.toString();
  }

  function refreshVersionList() {
    if (!versionList) return;
    var tab = tabsModule.getActive();
    if (!tab || !tab.versions || tab.versions.length === 0) {
      versionList.innerHTML = '<div class="empty-msg">No versions</div>';
      return;
    }
    var versions = tab.versions;
    var html = '';
    for (var i = versions.length - 1; i >= 0; i--) {
      var v = versions[i];
      var date = new Date(v.timestamp).toLocaleString(currentLang === 'el' ? 'el-GR' : 'en-US');
      var isManual = v.type === 'manual';
      var badge = isManual
        ? '<span class="version-badge manual-badge">Manual</span>'
        : '<span class="version-badge auto-badge">Auto</span>';
      var deleteBtn = isManual
        ? '<button class="version-delete" data-index="' + i + '" title="Delete"><i class="fa fa-trash"></i></button>'
        : '';
      html += '<div class="version-item' + (isManual ? ' manual-version' : '') + '" data-index="' + i + '">' +
        '<div class="version-item-row">' +
          '<span class="version-date">' + date + '</span>' +
          badge +
        '</div>' +
        '<div class="version-item-actions">' +
          '<button class="version-restore" data-index="' + i + '">Restore</button>' +
          deleteBtn +
        '</div>' +
      '</div>';
    }
    versionList.innerHTML = html;

    var restoreBtns = versionList.querySelectorAll('.version-restore');
    for (var r = 0; r < restoreBtns.length; r++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var idx = parseInt(btn.getAttribute('data-index'), 10);
          if (isNaN(idx) || !versions[idx]) return;
          if (!confirm('Restore this version? Unsaved changes will be lost.')) return;

          richEditor.innerHTML = versions[idx].snapshot;
          tabsModule.setContent(richEditor.innerHTML);

          if (versions[idx].metadata) {
            tabsModule.setMetadata(cloneObject(versions[idx].metadata));
          }

          restoreFootnotes();
          refreshCommentsList();
          loadMetadataFields();
          updateStats();
          updateSaveIndicator('saved');

          showToast('Version restored');
        });
      })(restoreBtns[r]);
    }

    var deleteBtns = versionList.querySelectorAll('.version-delete');
    for (var d = 0; d < deleteBtns.length; d++) {
      (function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var idx = parseInt(btn.getAttribute('data-index'), 10);
          if (isNaN(idx) || !tab.versions[idx]) return;
          if (!confirm('Delete this manual snapshot?')) return;

          tab.versions.splice(idx, 1);
          tabsModule.persist();
          refreshVersionList();
          showToast('Snapshot deleted');
        });
      })(deleteBtns[d]);
    }
  }

  // ===== ZEN MODE =====
  function setupZenMode() {
    bindClick('btn-zen', toggleZenMode);

    document.addEventListener('click', function(e) {
      var target = e.target.closest ? e.target.closest('#btn-zen') : null;
      if (target) {
        e.stopPropagation();
        e.preventDefault();
        toggleZenMode();
      }
    }, true);

    var zenToggle = document.getElementById('toggle-zen-mode');
    if (zenToggle) {
      zenToggle.addEventListener('change', function() {
        setZenMode(this.checked);
      });
    }
  }

  function toggleZenMode() {
    var isZen = document.body.hasAttribute('data-zen');
    setZenMode(!isZen);
  }

  function setZenMode(enabled) {
    if (enabled) {
      document.body.setAttribute('data-zen', 'true');
      localStorage.setItem('oros_zen_mode', 'true');
    } else {
      document.body.removeAttribute('data-zen');
      localStorage.setItem('oros_zen_mode', 'false');
    }
    var zenToggle = document.getElementById('toggle-zen-mode');
    if (zenToggle) zenToggle.checked = enabled;
    window.dispatchEvent(new CustomEvent('oros-zen-mode-changed', { detail: { enabled: enabled } }));
    showToast(enabled ? 'Zen Mode ON' : 'Zen Mode OFF');
    clampToViewport();
  }

  // ===== GOAL BAR =====
      function setupGoalBar() {
    bindClick('btn-goal', toggleGoalSettings);
    goalTargetInput = document.getElementById('goal-target-input');
    goalUnitSelect = document.getElementById('goal-unit-select');
    goalLockCheckbox = document.getElementById('goal-lock-checkbox');
    goalTimeInput = document.getElementById('goal-time-input');
    goalProgressDisplay = document.getElementById('goal-bar-progress');

    if (goalLockCheckbox) goalLockCheckbox.addEventListener('change', function() {
      var locked = goalLockCheckbox.checked;
      if (goalTargetInput) goalTargetInput.disabled = locked;
      if (goalUnitSelect) goalUnitSelect.disabled = locked;
      if (goalTimeInput) goalTimeInput.disabled = locked;
      saveGoal();
    });

    bindClick('btn-set-goal', saveGoal);
    bindClick('btn-clear-goal', clearGoal);
    bindClick('btn-close-goal', function() {
      if (goalBar) goalBar.style.display = 'none';
      stopGoalTimer();
      var gbtn = document.getElementById('btn-goal');
      if (gbtn) gbtn.classList.remove('active');
    });

    loadGoal();
  }

  function toggleGoalSettings() {
    if (!goalBar) return;
    var isVisible = goalBar.style.display !== 'none';
    goalBar.style.display = isVisible ? 'none' : 'flex';
    var btn = document.getElementById('btn-goal');
    if (btn) btn.classList.toggle('active', !isVisible);
  }
  
    function countWordsFiltered(text) {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).filter(function(w) {
      return /[a-zA-Z0-9\u0370-\u03FF\u1F00-\u1FFF]/.test(w);
    }).length;
  }

  function getCurrentGoalCount() {
    if (!richEditor) return 0;
    var unit = localStorage.getItem('oros_writer_goal_unit') || 'words';
    var text = richEditor.innerText.trim() || '';
    if (unit === 'chars') return text.replace(/\s/g, '').length;
    if (unit === 'paras') {
      var blocks = richEditor.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, div');
      var count = 0;
      for (var i = 0; i < blocks.length; i++) {
        if (blocks[i].textContent.trim()) count++;
      }
      if (count === 0 && text) {
        count = text.split(/\n+/).filter(function(l) { return l.trim(); }).length;
      }
      return count;
    }
    return countWordsFiltered(text);
  }

  function saveGoal() {
    var target = parseInt(goalTargetInput ? goalTargetInput.value : 0, 10) || 0;
    var unit = goalUnitSelect ? goalUnitSelect.value : 'words';
    var timeMin = parseInt(goalTimeInput ? goalTimeInput.value : 0, 10) || 0;

    localStorage.setItem('oros_writer_goal', target);
    localStorage.setItem('oros_writer_goal_unit', unit);
    localStorage.setItem('oros_writer_goal_time', timeMin);
    if (goalLockCheckbox) localStorage.setItem('oros_writer_goal_lock', goalLockCheckbox.checked ? '1' : '0');

    stopGoalTimer();
    goalNotified = false;

    if (target > 0 && timeMin > 0) {
      startGoalTimer(timeMin);
    }

    updateGoalProgress();
    showToast('Goal saved');
  }

      function startGoalTimer(minutes) {
    stopGoalTimer();
    goalTotalSeconds = minutes * 60;
    goalElapsedSeconds = 0;

    goalInterval = setInterval(function() {
      goalElapsedSeconds++;
      updateGoalProgress();

      if (goalElapsedSeconds >= goalTotalSeconds) {
        stopGoalTimer();
        var goal = parseInt(localStorage.getItem('oros_writer_goal'), 10) || 0;
        var unit = localStorage.getItem('oros_writer_goal_unit') || 'words';
        var unitLabel = unit === 'chars' ? 'characters' : (unit === 'paras' ? 'paragraphs' : 'words');
        var current = getCurrentGoalCount();
        if (current < goal) {
          showToast('⏰ Time is up! ' + current + '/' + goal + ' ' + unitLabel);
        } else {
          showToast('🎉 Success! ' + unitLabel.charAt(0).toUpperCase() + unitLabel.slice(1) + ' goal reached');
        }
      }
    }, 1000);
  }

  function stopGoalTimer() {
    if (goalInterval) {
      clearInterval(goalInterval);
      goalInterval = null;
    }
  }

    function clearGoal() {
    stopGoalTimer();
    goalNotified = false;
    localStorage.removeItem('oros_writer_goal');
    localStorage.removeItem('oros_writer_goal_time');
    if (goalTargetInput) goalTargetInput.value = '';
    if (goalTimeInput) goalTimeInput.value = '';
    if (goalProgressDisplay) goalProgressDisplay.textContent = '';
    showToast('Goal cleared');
  }

  function updateGoalProgress() {
    var goal = parseInt(localStorage.getItem('oros_writer_goal'), 10) || 0;
    if (goal <= 0) return;

    var unit = localStorage.getItem('oros_writer_goal_unit') || 'words';
    var current = getCurrentGoalCount();
    var pct = Math.min(100, Math.round((current / goal) * 100));

    var unitLabel = unit === 'chars' ? 'characters' : (unit === 'paras' ? 'paragraphs' : 'words');
    var progressText = current + '/' + goal + ' ' + unitLabel + ' (' + pct + '%)';

    if (goalInterval && goalTotalSeconds > 0) {
      var timeLeft = goalTotalSeconds - goalElapsedSeconds;
      if (timeLeft < 0) timeLeft = 0;
      var mins = Math.floor(timeLeft / 60);
      var secs = timeLeft % 60;
      progressText += ' · ⏱ ' + mins + ':' + secs.toString().padStart(2, '0');
    }

    if (goalProgressDisplay) goalProgressDisplay.textContent = progressText;

    if (current >= goal) {
      if (!goalNotified) {
        showToast('🎉 Success! ' + unitLabel.charAt(0).toUpperCase() + unitLabel.slice(1) + ' goal reached');
        goalNotified = true;
      }
      if (goalInterval) stopGoalTimer();
    } else {
      goalNotified = false;
    }
  }

  function loadGoal() {
    var saved = localStorage.getItem('oros_writer_goal');
    if (saved && goalTargetInput) goalTargetInput.value = saved;
    var savedUnit = localStorage.getItem('oros_writer_goal_unit');
    if (savedUnit && goalUnitSelect) goalUnitSelect.value = savedUnit;
    var savedTime = localStorage.getItem('oros_writer_goal_time');
    if (savedTime && goalTimeInput) goalTimeInput.value = savedTime;
    if (goalLockCheckbox) {
      goalLockCheckbox.checked = localStorage.getItem('oros_writer_goal_lock') === '1';
      if (goalLockCheckbox.checked) {
        if (goalTargetInput) goalTargetInput.disabled = true;
        if (goalUnitSelect) goalUnitSelect.disabled = true;
        if (goalTimeInput) goalTimeInput.disabled = true;
      }
    }
    updateGoalProgress();
  }

  // ===== EXPORT / IMPORT =====
      // ===== EXPORT: TXT =====
  function exportTXT() {
        var meta = getDocumentMetadata();
    var content = getEditorContentText();
    var header = meta.title + '\n' + '='.repeat(Math.min(meta.title.length, 60)) + '\n';
    if (meta.author) header += 'Author: ' + meta.author + '\n';
    if (meta.category) header += 'Category: ' + meta.category + '\n';
    if (meta.tags) header += 'Tags: ' + meta.tags + '\n';
    header += '\n';

    var footnotes = getFootnotesData();
    var fnText = '';
    if (footnotes.length > 0) {
      fnText = '\n\n--- Footnotes ---\n';
      footnotes.forEach(function(fn) {
        fnText += '[' + fn.index + '] ' + fn.text + '\n';
      });
    }

    var full = header + content + fnText;
    downloadBlob(full, sanitizeFilename(meta.title) + '.txt', 'text/plain');
    showToast('Exported TXT');
  }

  // ===== EXPORT: Markdown =====
  function exportMarkdown() {
    var meta = getDocumentMetadata();
    var html = getEditorContentHTML();
    var md = convertHTMLtoMarkdown(html);

        var metaBlock = '---\ntitle: "' + meta.title + '"\nauthor: "' + meta.author + '"\n' +
      (meta.category ? 'category: "' + meta.category + '"\n' : '') +
      (meta.tags ? 'tags: "' + meta.tags + '"\n' : '') +
      'created: "' + meta.created + '"\napp: orOS Writer v' + CONFIG.VERSION + '\n---\n\n';

    downloadBlob(metaBlock + md, sanitizeFilename(meta.title) + '.md', 'text/markdown');
    showToast('Exported Markdown');
  }

  // ===== EXPORT: HTML5 (standalone, fully formatted) =====
  function exportHTML() {
    var meta = getDocumentMetadata();
    var content = getEditorContentHTML();
    var footnotes = getFootnotesData();

    var fnHTML = '';
    if (footnotes.length > 0) {
      fnHTML = '<section class="footnotes"><hr><h3>Footnotes</h3><ol>';
      footnotes.forEach(function(fn) {
        fnHTML += '<li id="fn' + fn.index + '">' + escapeHTML(fn.text) + ' <a href="#fnref' + fn.index + '">↩</a></li>';
      });
      fnHTML += '</ol></section>';
    }

    var html = '<!DOCTYPE html>\n<html lang="' + (currentLang || 'en') + '">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<meta name="generator" content="orOS Writer v' + CONFIG.VERSION + '">\n' +
      '<meta name="author" content="' + escapeHTML(meta.author) + '">\n' +
      '<meta name="description" content="' + escapeHTML(meta.subject || meta.title) + '">\n' +
      '<meta name="keywords" content="' + escapeHTML(meta.tags || '') + '">\n' +
      '<meta name="created" content="' + meta.created + '">\n' +
      '<meta name="modified" content="' + meta.modified + '">\n' +
      '<title>' + escapeHTML(meta.title) + '</title>\n' +
      '<style>\n' + getExportCSS() + '\n</style>\n' +
      '</head>\n<body>\n' +
      '<article class="document">\n' +
      '<h1 class="doc-title">' + escapeHTML(meta.title) + '</h1>\n' +
      '<div class="doc-author">' + escapeHTML(meta.author) +
  (meta.category ? ' · ' + escapeHTML(meta.category) : '') +
  (meta.tags ? ' · ' + escapeHTML(meta.tags) : '') + '</div>' +
      '<div class="doc-content">\n' + content + '\n</div>\n' +
      fnHTML +
      '</article>\n</body>\n</html>';

    downloadBlob(html, sanitizeFilename(meta.title) + '.html', 'text/html');
    showToast('Exported HTML');
  }

  // ===== EXPORT: .orosdoc (ZIP: HTML + CSS + metadata.json) =====
  function exportOROSDOC() {
    var meta = getDocumentMetadata();
    var content = getEditorContentHTML();
    var footnotes = getFootnotesData();

    if (typeof JSZip === 'undefined') {
      showToast('JSZip library not loaded');
      return;
    }

    var zip = new JSZip();

    var metaJSON = JSON.stringify({
      title: meta.title,
      author: meta.author,
      subject: meta.subject,
      keywords: meta.keywords,
	  category: meta.category || '',
        tags: meta.tags || '',
      created: meta.created,
      modified: meta.modified,
      app: 'orOS Writer',
      version: CONFIG.VERSION,
      language: currentLang || 'en',
      footnotes: footnotes,
      type: 'orosdoc'
    }, null, 2);

    var htmlContent = '<!DOCTYPE html>\n<html lang="' + (currentLang || 'en') + '">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<link rel="stylesheet" href="styles.css">\n' +
      '<title>' + escapeHTML(meta.title) + '</title>\n' +
      '</head>\n<body>\n' +
      '<article class="document">\n' +
      '<h1 class="doc-title">' + escapeHTML(meta.title) + '</h1>\n' +
      '<div class="doc-author">' + escapeHTML(meta.author) + '</div>\n' +
      '<div class="doc-content">\n' + content + '\n</div>\n' +
      '</article>\n</body>\n</html>';

    zip.file('index.html', htmlContent);
    zip.file('styles.css', getExportCSS());
    zip.file('metadata.json', metaJSON);
    zip.file('content.html', content);

    // Add footnotes separately if any
    if (footnotes.length > 0) {
      zip.file('footnotes.json', JSON.stringify(footnotes, null, 2));
    }

    zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }).then(function(blob) {
      downloadBlob(blob, sanitizeFilename(meta.title) + '.orosdoc', 'application/octet-stream');
      showToast('Exported .orosdoc');
    }).catch(function(e) {
      showToast('Export failed: ' + e.message);
    });
  }

  // ===== EXPORT: PDF (via html2pdf.js) =====
  function exportPDF() {
    var meta = getDocumentMetadata();
    var content = getEditorContentHTML();
    var footnotes = getFootnotesData();

    var fnHTML = '';
    if (footnotes.length > 0) {
      fnHTML = '<div style="margin-top:40px;border-top:1px solid #ccc;padding-top:16px;"><h3>Footnotes</h3><ol>';
      footnotes.forEach(function(fn) {
        fnHTML += '<li>' + escapeHTML(fn.text) + '</li>';
      });
      fnHTML += '</ol></div>';
    }

    var tempDiv = document.createElement('div');
    tempDiv.style.cssText = 'padding:48px;background:white;color:black;font-family:Georgia,serif;font-size:14px;line-height:1.8;width:210mm;max-width:100%;';
    tempDiv.innerHTML =
      '<h1 style="font-size:24px;font-weight:bold;text-align:center;margin-bottom:8px;">' + escapeHTML(meta.title) + '</h1>' +
      '<p style="text-align:center;color:#666;margin-bottom:32px;">' + escapeHTML(meta.author) +
  (meta.category ? ' · ' + escapeHTML(meta.category) : '') +
  (meta.tags ? ' · ' + escapeHTML(meta.tags) : '') + '</p>' +
      '<div>' + content + '</div>' +
      fnHTML;

    document.body.appendChild(tempDiv);

    var opt = {
      margin: [20, 20, 20, 20],
      filename: sanitizeFilename(meta.title) + '.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    html2pdf().set(opt).from(tempDiv).save().then(function() {
      document.body.removeChild(tempDiv);
      showToast('Exported PDF');
    }).catch(function(e) {
      document.body.removeChild(tempDiv);
      showToast('PDF export failed: ' + e.message);
    });
  }

  // ===== EXPORT: DOCX (native OOXML via JSZip — no external library) =====
  function exportDOCX() {
    if (typeof JSZip === 'undefined') { showToast('JSZip library not loaded'); return; }

    var meta = getDocumentMetadata();
    var content = getEditorContentHTML();
    var footnotes = getFootnotesData();
    var media = [];

    // -- Helper: XML escape --
    function escapeXML(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    }

    // -- Helper: create a single text run --
    function textRun(text, fmt) {
      fmt = fmt || {};
      var rpr = '<w:rPr>';
      if (fmt.mono) rpr += '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>';
      if (fmt.bold) rpr += '<w:b/><w:bCs/>';
      if (fmt.italic) rpr += '<w:i/><w:iCs/>';
      if (fmt.underline) rpr += '<w:u w:val="single"/>';
      if (fmt.strike) rpr += '<w:strike/>';
      if (fmt.sup) rpr += '<w:vertAlign w:val="superscript"/>';
      if (fmt.sub) rpr += '<w:vertAlign w:val="subscript"/>';
      if (fmt.size) rpr += '<w:sz w:val="' + fmt.size + '"/><w:szCs w:val="' + fmt.size + '"/>';
      if (fmt.color) rpr += '<w:color w:val="' + fmt.color + '"/>';
      rpr += '</w:rPr>';
      if (!text) return '';
      return '<w:r>' + rpr + '<w:t xml:space="preserve">' + escapeXML(text) + '</w:t></w:r>';
    }

    // -- Helper: process inline nodes recursively --
    function inlineRuns(node, fmt) {
      fmt = fmt || {};
      var out = '';
      for (var i = 0; i < node.childNodes.length; i++) {
        var c = node.childNodes[i];
        if (c.nodeType === Node.TEXT_NODE) {
          if (c.textContent) out += textRun(c.textContent, fmt);
        } else if (c.nodeType === Node.ELEMENT_NODE) {
          var t = c.tagName.toLowerCase();
          if (t === 'br') { out += '<w:r><w:br/></w:r>'; continue; }
          if (t === 'img') { out += imageRun(c); continue; }
          var nf = {
            bold: fmt.bold || t === 'b' || t === 'strong',
            italic: fmt.italic || t === 'i' || t === 'em',
            underline: fmt.underline || t === 'u',
            strike: fmt.strike || t === 's' || t === 'strike' || t === 'del',
            mono: fmt.mono || t === 'code',
            sub: fmt.sub || t === 'sub',
            sup: fmt.sup || t === 'sup',
            size: fmt.size,
            color: fmt.color
          };
          out += inlineRuns(c, nf);
        }
      }
      return out;
    }

    // -- Helper: create image run from data URI --
    function imageRun(img) {
      var src = img.getAttribute('src') || '';
      var m = src.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!m) return '';
      var idx = media.length + 1;
      var ext = (m[1] === 'jpeg' || m[1] === 'jpg') ? 'jpeg' : m[1];
      media.push({ id: idx, ext: ext, data: m[2] });
      var wPx = parseInt(img.getAttribute('width') || '500', 10);
      var hPx = parseInt(img.getAttribute('height') || '300', 10);
      var wEmu = wPx * 9525;
      var hEmu = hPx * 9525;
      return '<w:r><w:drawing>' +
        '<wp:inline distT="0" distB="0" distL="0" distR="0" ' +
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
        '<wp:extent cx="' + wEmu + '" cy="' + hEmu + '"/>' +
        '<wp:docPr id="' + (idx + 100) + '" name="Image' + idx + '"/>' +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:nvPicPr><pic:cNvPr id="' + (idx + 100) + '" name="Image' + idx + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill>' +
        '<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdImg' + idx + '"/>' +
        '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + wEmu + '" cy="' + hEmu + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:r>';
    }

    // -- Helper: alignment from element style/class --
    function getAlign(el) {
      if (!el || !el.getAttribute) return '';
      var st = el.getAttribute('style') || '';
      var cs = el.className || '';
      if (st.indexOf('text-align') !== -1) {
        var m = st.match(/text-align\s*:\s*(\w+)/);
        if (m) {
          if (m[1] === 'center') return '<w:jc w:val="center"/>';
          if (m[1] === 'right') return '<w:jc w:val="right"/>';
          if (m[1] === 'justify') return '<w:jc w:val="both"/>';
        }
      }
      if (cs.indexOf('ql-align-center') !== -1) return '<w:jc w:val="center"/>';
      if (cs.indexOf('ql-align-right') !== -1) return '<w:jc w:val="right"/>';
      if (cs.indexOf('ql-align-justify') !== -1) return '<w:jc w:val="both"/>';
      return '';
    }

    // -- Helper: indent from element style --
    function getIndent(el) {
      if (!el || !el.style) return '';
      var ml = parseInt(el.style.marginLeft || '0', 10);
      var pl = parseInt(el.style.paddingLeft || '0', 10);
      var total = ml + pl;
      return (total > 0) ? '<w:ind w:left="' + Math.round(total * 15) + '"/>' : '';
    }

    // -- Helper: block element → OOXML --
    function blockToOOXML(el) {
      var tag = el.tagName.toLowerCase();
      var align = getAlign(el);

      // Headings h1–h6
      if (/^h[1-6]$/.test(tag)) {
        var sizes = { h1: 36, h2: 32, h3: 28, h4: 26, h5: 24, h6: 24 };
        return '<w:p><w:pPr>' + align + '</w:pPr>' +
          inlineRuns(el, { bold: true, size: sizes[tag] }) + '</w:p>';
      }

      // Paragraph
      if (tag === 'p') {
        return '<w:p><w:pPr>' + align + getIndent(el) + '</w:pPr>' +
          inlineRuns(el, {}) + '</w:p>';
      }

      // Blockquote
      if (tag === 'blockquote') {
        return '<w:p><w:pPr>' +
          '<w:pBdr><w:left w:val="single" w:sz="18" w:color="C8A96E"/></w:pBdr>' +
          '<w:ind w:left="567"/></w:pPr>' +
          inlineRuns(el, { italic: true }) + '</w:p>';
      }

      // Pre (code block) — each line becomes its own paragraph
      if (tag === 'pre') {
        var lines = el.textContent.split('\n');
        var preXml = '';
        for (var i = 0; i < lines.length; i++) {
          preXml += '<w:p><w:pPr>' +
            '<w:shd w:val="clear" w:color="auto" w:fill="F4F4F4"/>' +
            '<w:spacing w:after="0"/>' +
            '</w:pPr>' + textRun(lines[i] || ' ', { mono: true }) + '</w:p>';
        }
        return preXml;
      }

      // Unordered / ordered lists
      if (tag === 'ul' || tag === 'ol') {
        var listXml = '';
        var items = el.children;
        var numId = tag === 'ul' ? 1 : 2;
        for (var k = 0; k < items.length; k++) {
          if (items[k].tagName.toLowerCase() !== 'li') continue;
          listXml += '<w:p><w:pPr>' +
            '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + numId + '"/></w:numPr>' +
            '</w:pPr>' + inlineRuns(items[k], {}) + '</w:p>';
        }
        return listXml;
      }

      // Table
      if (tag === 'table') return tableToOOXML(el);

      // Horizontal rule
      if (tag === 'hr') {
        return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>';
      }

      // Container divs — recurse children
      if (tag === 'div' || tag === 'article' || tag === 'section') {
        var inner = '';
        for (var d = 0; d < el.childNodes.length; d++) {
          var cd = el.childNodes[d];
          if (cd.nodeType === Node.TEXT_NODE) {
            if (cd.textContent.trim())
              inner += '<w:p><w:pPr></w:pPr>' + textRun(cd.textContent, {}) + '</w:p>';
          } else if (cd.nodeType === Node.ELEMENT_NODE) {
            if ((cd.className || '').indexOf('page-break') !== -1) {
              inner += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
            } else {
              inner += blockToOOXML(cd);
            }
          }
        }
        return inner;
      }

      // Standalone image
      if (tag === 'img') return '<w:p>' + imageRun(el) + '</w:p>';

      // Unknown block — treat as paragraph
      return '<w:p><w:pPr>' + align + '</w:pPr>' + inlineRuns(el, {}) + '</w:p>';
    }

    // -- Helper: table → OOXML --
    function tableToOOXML(table) {
      var rows = table.querySelectorAll('tr');
      if (!rows.length) return '';
      var xml = '<w:tbl><w:tblPr>' +
        '<w:tblW w:w="5000" w:type="pct"/>' +
        '<w:tblBorders>' +
        '<w:top w:val="single" w:sz="4" w:color="999999"/>' +
        '<w:left w:val="single" w:sz="4" w:color="999999"/>' +
        '<w:bottom w:val="single" w:sz="4" w:color="999999"/>' +
        '<w:right w:val="single" w:sz="4" w:color="999999"/>' +
        '<w:insideH w:val="single" w:sz="4" w:color="999999"/>' +
        '<w:insideV w:val="single" w:sz="4" w:color="999999"/>' +
        '</w:tblBorders></w:tblPr>';
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].querySelectorAll('td,th');
        xml += '<w:tr>';
        for (var c = 0; c < cells.length; c++) {
          var isTh = cells[c].tagName.toLowerCase() === 'th';
          var tcPr = '<w:tcPr>';
          if (isTh) tcPr += '<w:shd w:val="clear" w:color="auto" w:fill="C8A96E"/>';
          tcPr += '<w:tcW w:w="2500" w:type="dxa"/></w:tcPr>';
          xml += '<w:tc>' + tcPr +
            '<w:p><w:pPr></w:pPr>' +
            inlineRuns(cells[c], { bold: isTh }) + '</w:p></w:tc>';
        }
        xml += '</w:tr>';
      }
      return xml + '</w:tbl><w:p/>';
    }
	
	    // ===== BUILD BODY XML =====
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;

    var bodyXml = '';

    // — Title (centered, 24pt bold) —
    bodyXml += '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
      textRun(meta.title || 'Untitled', { bold: true, size: 48 }) + '</w:p>';

    // — Meta line: author · category · tags (centered, italic, gray) —
    var metaParts = [];
    if (meta.author) metaParts.push(meta.author);
    if (meta.category) metaParts.push('Category: ' + meta.category);
    if (meta.tags) metaParts.push('Tags: ' + meta.tags);
    if (metaParts.length) {
      bodyXml += '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
        textRun(metaParts.join(' · '), { italic: true, color: '666666' }) + '</w:p>';
    }

    // — Spacer —
    bodyXml += '<w:p/>';

    // — Walk top-level content blocks —
    for (var i = 0; i < tempDiv.childNodes.length; i++) {
      var node = tempDiv.childNodes[i];
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.trim()) {
          bodyXml += '<w:p><w:pPr></w:pPr>' + textRun(node.textContent, {}) + '</w:p>';
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        bodyXml += blockToOOXML(node);
      }
    }

    // — Footnotes (appended as text at end) —
    if (footnotes && footnotes.length > 0) {
      bodyXml += '<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>';
      bodyXml += '<w:p><w:pPr></w:pPr>' + textRun('Footnotes', { bold: true }) + '</w:p>';
      for (var f = 0; f < footnotes.length; f++) {
        bodyXml += '<w:p><w:pPr><w:ind w:left="340"/></w:pPr>' +
          textRun('[' + (f + 1) + '] ' + (footnotes[f].text || ''), {}) + '</w:p>';
      }
    }

    // ===== DOCUMENT.XML =====
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:body>' + bodyXml +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1134" w:bottom="1134" w:left="1134" ' +
      'w:header="709" w:footer="708" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';

    // ===== [CONTENT_TYPES].XML =====
    var contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Default Extension="gif" ContentType="image/gif"/>' +
      '<Override PartName="/word/document.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '</Types>';

    // ===== _RELS/.RELS =====
    var rootRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
      'Target="word/document.xml"/>' +
      '</Relationships>';

    // ===== WORD/_RELS/DOCUMENT.XML.RELS =====
    var docRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
      'Target="styles.xml"/>' +
      '<Relationship Id="rIdNumbering" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" ' +
      'Target="numbering.xml"/>';
    for (var ri = 0; ri < media.length; ri++) {
      docRelsXml += '<Relationship Id="rIdImg' + media[ri].id + '" ' +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
        'Target="media/image' + media[ri].id + '.' + media[ri].ext + '"/>';
    }
    docRelsXml += '</Relationships>';

    // ===== WORD/STYLES.XML =====
    var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
      '<w:sz w:val="24"/><w:szCs w:val="24"/>' +
      '</w:rPr></w:rPrDefault></w:docDefaults>' +
      '</w:styles>';

    // ===== WORD/NUMBERING.XML =====
    var numberingXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:abstractNum w:abstractNumId="0">' +
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
      '<w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
      '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
      '<w:lvlText w:val="\u25E6"/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>' +
      '</w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1">' +
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
      '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
      '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/>' +
      '<w:lvlText w:val="%2."/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>' +
      '</w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
      '</w:numbering>';

    // ===== BUILD ZIP =====
    var zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypesXml);
    zip.file('_rels/.rels', rootRelsXml);
    zip.file('word/document.xml', documentXml);
    zip.file('word/_rels/document.xml.rels', docRelsXml);
    zip.file('word/styles.xml', stylesXml);
    zip.file('word/numbering.xml', numberingXml);

    for (var mi = 0; mi < media.length; mi++) {
      zip.file('word/media/image' + media[mi].id + '.' + media[mi].ext,
        media[mi].data, { base64: true });
    }

    zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }).then(function(blob) {
      downloadBlob(blob, sanitizeFilename(meta.title || 'document') + '.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      showToast('Exported DOCX');
    }).catch(function(err) {
      showToast('DOCX export failed: ' + err.message);
    });
  }

  // ===== HELPER: Get export CSS =====
  function getExportCSS() {
    return '' +
      '* { box-sizing: border-box; }\n' +
      'body { font-family: Georgia, "Times New Roman", serif; font-size: 16px; line-height: 1.8; color: #222; background: #fff; max-width: 800px; margin: 0 auto; padding: 48px 24px; }\n' +
      'article.document { max-width: 800px; margin: 0 auto; }\n' +
      'h1.doc-title { font-size: 28px; font-weight: bold; text-align: center; margin-bottom: 4px; color: #333; }\n' +
      'div.doc-author { text-align: center; color: #666; margin-bottom: 32px; font-size: 14px; }\n' +
      'h1 { font-size: 24px; font-weight: bold; margin: 24px 0 12px; color: #333; }\n' +
      'h2 { font-size: 20px; font-weight: bold; margin: 20px 0 10px; color: #333; }\n' +
      'h3 { font-size: 17px; font-weight: bold; margin: 16px 0 8px; color: #333; }\n' +
      'h4 { font-size: 15px; font-weight: bold; margin: 12px 0 6px; color: #333; }\n' +
      'p { margin: 8px 0; }\n' +
      'ul, ol { margin: 8px 0; padding-left: 32px; }\n' +
      'li { margin: 4px 0; }\n' +
      'blockquote { border-left: 3px solid #c8a96e; padding-left: 16px; margin: 16px 0; font-style: italic; color: #555; }\n' +
      'strong, b { font-weight: bold; }\n' +
      'em, i { font-style: italic; }\n' +
      'u { text-decoration: underline; }\n' +
      'code { font-family: "Courier New", monospace; background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }\n' +
      'pre { background: #f4f4f4; padding: 12px 16px; border-radius: 6px; overflow-x: auto; }\n' +
      'pre code { background: none; padding: 0; }\n' +
      'a { color: #8b6914; text-decoration: underline; }\n' +
      'img { max-width: 100%; height: auto; border-radius: 6px; margin: 8px 0; }\n' +
      'table { border-collapse: collapse; width: 100%; margin: 12px 0; }\n' +
      'td, th { border: 1px solid #ccc; padding: 6px 12px; }\n' +
      'th { background: #c8a96e; color: #fff; font-weight: bold; }\n' +
      'hr { border: none; border-top: 1px solid #ccc; margin: 24px 0; }\n' +
      'mark { background: #fff3cd; padding: 0 2px; border-radius: 2px; }\n' +
      '.footnotes { margin-top: 40px; border-top: 1px solid #ccc; padding-top: 16px; }\n' +
      '.footnotes ol { padding-left: 24px; }\n' +
      '.footnotes li { margin: 4px 0; font-size: 0.9em; color: #555; }\n' +
      '.page-break-marker { page-break-after: always; }\n';
  }

  // ===== HELPER: Escape HTML =====
  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===== HELPER: Load script dynamically =====
  function loadScript(url, callback) {
    var s = document.createElement('script');
    s.src = url;
    s.onload = callback;
    s.onerror = function() { showToast('Failed to load: ' + url); };
    document.head.appendChild(s);
  }

  // ===== HELPER: HTML to Markdown conversion =====
  function convertHTMLtoMarkdown(html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    return nodeToMarkdown(div).trim();
  }

  function nodeToMarkdown(node) {
    var md = '';
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE) {
        md += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        var tag = child.tagName.toLowerCase();
        var inner = nodeToMarkdown(child);
        switch(tag) {
          case 'h1': md += '\n# ' + inner + '\n\n'; break;
          case 'h2': md += '\n## ' + inner + '\n\n'; break;
          case 'h3': md += '\n### ' + inner + '\n\n'; break;
          case 'h4': md += '\n#### ' + inner + '\n\n'; break;
          case 'h5': md += '\n##### ' + inner + '\n\n'; break;
          case 'h6': md += '\n###### ' + inner + '\n\n'; break;
          case 'p': md += inner + '\n\n'; break;
          case 'br': md += '\n'; break;
          case 'strong': case 'b': md += '**' + inner + '**'; break;
          case 'em': case 'i': md += '*' + inner + '*'; break;
          case 'u': md += inner; break;
          case 'code':
            if (child.parentElement && child.parentElement.tagName.toLowerCase() === 'pre') {
              md += inner;
            } else {
              md += '`' + inner + '`';
            }
            break;
          case 'pre':
            md += '\n```\n' + inner + '\n```\n\n'; break;
          case 'blockquote': md += '> ' + inner.replace(/\n/g, '\n> ') + '\n\n'; break;
          case 'ul':
            var ulItems = child.querySelectorAll(':scope > li');
            for (var u = 0; u < ulItems.length; u++) {
              md += '- ' + nodeToMarkdown(ulItems[u]).trim() + '\n';
            }
            md += '\n';
            break;
          case 'ol':
            var olItems = child.querySelectorAll(':scope > li');
            for (var o = 0; o < olItems.length; o++) {
              md += (o + 1) + '. ' + nodeToMarkdown(olItems[o]).trim() + '\n';
            }
            md += '\n';
            break;
          case 'li': md += inner; break;
          case 'a':
            var href = child.getAttribute('href') || '#';
            md += '[' + inner + '](' + href + ')';
            break;
          case 'img':
            var alt = child.getAttribute('alt') || '';
            var src = child.getAttribute('src') || '';
            md += '![' + alt + '](' + src + ')';
            break;
          case 'hr': md += '\n---\n\n'; break;
          case 'table': md += tableToMarkdown(child); break;
          default: md += inner; break;
        }
      }
    }
    return md;
  }

  function tableToMarkdown(table) {
    var rows = table.querySelectorAll('tr');
    if (rows.length === 0) return '';
    var md = '\n';
    var cells0 = rows[0].querySelectorAll('td,th');
    for (var c = 0; c < cells0.length; c++) {
      md += '| ' + (cells0[c].textContent || '').trim() + ' ';
    }
    md += '|\n';
    for (var s = 0; s < cells0.length; s++) md += '|---';
    md += '|\n';
    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r].querySelectorAll('td,th');
      for (var c2 = 0; c2 < cells.length; c2++) {
        md += '| ' + (cells[c2].textContent || '').trim() + ' ';
      }
      md += '|\n';
    }
    md += '\n';
    return md;
  }

  // ===== IMPORT: .orosdoc =====
  function importOROSDOC(file) {
    if (typeof JSZip === 'undefined') {
      showToast('JSZip library not loaded');
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
      JSZip.loadAsync(e.target.result).then(function(zip) {
        var promises = [];
        var files = {};

        var fileList = ['index.html', 'content.html', 'styles.css', 'metadata.json', 'footnotes.json'];
        fileList.forEach(function(fname) {
          if (zip.file(fname)) {
            promises.push(zip.file(fname).async('string').then(function(content) {
              files[fname] = content;
            }));
          }
        });

        Promise.all(promises).then(function() {
          var meta = files['metadata.json'] ? JSON.parse(files['metadata.json']) : {};
          var content = files['content.html'] || '';

          // Extract just the inner HTML from index.html if content.html is missing
          if (!content && files['index.html']) {
            var tempDiv = document.createElement('div');
            tempDiv.innerHTML = files['index.html'];
            var docContent = tempDiv.querySelector('.doc-content');
            content = docContent ? docContent.innerHTML : tempDiv.innerHTML;
          }

          // Φόρτωση περιεχομένου στον editor
          var editor = document.getElementById('rich-editor');
          if (editor) {
            editor.innerHTML = content || '<p><br></p>';
          }

          // Εφαρμογή metadata στο ενεργό tab
          var actTab = tabsModule ? tabsModule.getActive() : null;
          if (actTab) {
            actTab.metadata = actTab.metadata || {};
            if (meta.title) {
              actTab.metadata.title = meta.title;
              actTab.title = meta.title;
            }
            if (meta.pageSize) actTab.metadata.pageSize = meta.pageSize;
            if (meta.marginTop) actTab.metadata.marginTop = meta.marginTop;
            if (meta.marginBottom) actTab.metadata.marginBottom = meta.marginBottom;
            if (meta.marginLeft) actTab.metadata.marginLeft = meta.marginLeft;
            if (meta.marginRight) actTab.metadata.marginRight = meta.marginRight;
            if (meta.headerText !== undefined) actTab.metadata.headerText = meta.headerText;
            if (meta.footerText !== undefined) actTab.metadata.footerText = meta.footerText;
            if (meta.footerPageNum !== undefined) actTab.metadata.footerPageNum = meta.footerPageNum;

            // Restore footnotes από metadata.json (στοιχείο footnotes)
            if (meta.footnotes && Array.isArray(meta.footnotes)) {
              actTab.metadata.footnotes = meta.footnotes;
            }
            // Ή από footnotes.json αν υπάρχει ξεχωριστά
            if (files['footnotes.json']) {
              try {
                var fns = JSON.parse(files['footnotes.json']);
                if (Array.isArray(fns)) actTab.metadata.footnotes = fns;
              } catch(err) {}
            }

            tabsModule.setMetadata(actTab.metadata);
            tabsModule.setContent(editor ? editor.innerHTML : content);

            // Επαναφορά footnotes & comments
            restoreFootnotes();
            loadAndRestoreComments();
            loadPageSettingsFields();
            loadMetadataFields();

            tabsModule.persist();
            tabsModule.render();

            if (meta.title) {
              document.title = meta.title + ' — orOS Writer';
            }
          }

          saveCurrentTabContent();
          updateStats();
          checkPlaceholder();

          showToast('Imported .orosdoc: ' + (meta.title || 'Untitled'));
        });
      }).catch(function(e) {
        showToast('Import failed: ' + e.message);
      });
    };
    reader.readAsArrayBuffer(file);
  }

    function downloadBlob(content, filename, mimeType) {
    var mt = mimeType || 'text/plain;charset=utf-8';
    var blob;
    if (content instanceof Blob) {
      blob = content;
    } else {
      blob = new Blob([content], { type: mt + ';charset=utf-8' });
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }
  
      function getDocumentMetadata() {
    var activeTab = tabsModule ? tabsModule.getActive() : null;
    var meta = {
      title: document.title || 'Untitled',
      author: 'orOS Writer',
      subject: '',
      keywords: '',
      tags: '',
      category: '',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      app: 'orOS Writer',
      version: CONFIG.VERSION
    };

    if (activeTab && activeTab.metadata) {
      if (activeTab.metadata.title) meta.title = activeTab.metadata.title;
      if (activeTab.metadata.author) meta.author = activeTab.metadata.author;
      if (activeTab.metadata.subject) meta.subject = activeTab.metadata.subject;
      if (activeTab.metadata.keywords) meta.keywords = activeTab.metadata.keywords;
      if (activeTab.metadata.tags) meta.tags = activeTab.metadata.tags;
      if (activeTab.metadata.category) meta.category = activeTab.metadata.category;
      if (activeTab.metadata.created) meta.created = activeTab.metadata.created;
    }

    if (activeTab && activeTab.title) {
      meta.title = activeTab.title;
    }

    return meta;
  }

  function sanitizeFilename(name) {
    return (name || 'untitled').replace(/[\\/:*?"<>|]/g, '_').trim().substring(0, 100);
  }

  function getEditorContentHTML() {
    var editor = document.getElementById('rich-editor');
    if (!editor) return '<p>No content</p>';
    return editor.innerHTML;
  }

  function getEditorContentText() {
    var editor = document.getElementById('rich-editor');
    if (!editor) return '';
    return editor.innerText || editor.textContent || '';
  }

  function getFootnotesData() {
    var fnArea = document.getElementById('footnote-area');
    if (!fnArea) return [];
    var entries = fnArea.querySelectorAll('.footnote-entry');
    var result = [];
    for (var i = 0; i < entries.length; i++) {
      var num = entries[i].querySelector('.footnote-number');
      var text = entries[i].querySelector('.footnote-text') || entries[i].querySelector('td:nth-child(2)');
      result.push({
        index: num ? parseInt(num.textContent) || (i + 1) : (i + 1),
        text: text ? text.textContent.trim() : ''
      });
    }
    return result;
  }
  
    // ===== IMPORT: JSON (single document export) =====
  function importJSONFile(file) {
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var data = JSON.parse(ev.target.result);

        // Αν είναι Full Database export, ζήτα επαναφορά
        if (data && data._meta && data._meta.type === 'full-database') {
          if (!confirm('This is a Full Database export. Restore ALL data?\n\nCurrent data will be replaced.')) return;
          Object.keys(data.localStorage).forEach(function(key) {
            localStorage.setItem(key, data.localStorage[key]);
          });
          showToast('Database restored. Reloading…');
          setTimeout(function() { location.reload(); }, 800);
          return;
        }

        if (!data || typeof data.content !== 'string') {
          showToast('Invalid document JSON');
          return;
        }

        var meta = data.metadata || {};
        tabsModule.create({
          content: data.content,
          title: data.title || 'Imported',
          metadata: meta
        });
        setTimeout(function() {
          restoreFootnotes();
          loadAndRestoreComments();
          loadPageSettingsFields();
          loadMetadataFields();
          updateStats();
        }, 50);
        showToast('Imported JSON: ' + (data.title || 'Untitled'));
      } catch(err) {
        showToast('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  }
  
    // ===== EXPORT / IMPORT SETUP =====
  function setupExportImport() {
    var exportBtn = document.getElementById('btn-export');
    exportDropdown = document.getElementById('export-dropdown');

    if (exportBtn && exportDropdown) {
      exportBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        exportDropdown.classList.toggle('active');
      });
    }

    // Close on outside click
    document.addEventListener('click', function(e) {
      if (exportDropdown && exportDropdown.classList.contains('active')) {
        if (!e.target.closest('#export-dropdown-container')) {
          exportDropdown.classList.remove('active');
        }
      }
    });

    var exportItems = document.querySelectorAll('#export-dropdown button[data-format]');
    for (var i = 0; i < exportItems.length; i++) {
      (function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var fmt = btn.getAttribute('data-format');
          if (fmt === 'txt') exportTXT();
          else if (fmt === 'md') exportMarkdown();
          else if (fmt === 'html') exportHTML();
          else if (fmt === 'pdf') exportPDF();
          else if (fmt === 'docx') exportDOCX();
          else if (fmt === 'rtf') exportRTF();
          else if (fmt === 'orosdoc') exportOROSDOC();
          else if (fmt === 'json') exportJSON();
          if (exportDropdown) exportDropdown.classList.remove('active');
        });
      })(exportItems[i]);
    }

    setupFileImport();
  }

  function showImportOptions() {
    var el = document.getElementById('import-dropdown');
    if (el) el.classList.add('active');
  }
  function hideImportOptions() {
    var el = document.getElementById('import-dropdown');
    if (el) el.classList.remove('active');
  }

  // ===== EXPORT: RTF (Unicode) =====
  function exportRTF() {
    var meta = getDocumentMetadata();
    var text = getEditorContentText();

    var header = meta.title + '\n' + '='.repeat(Math.min(meta.title.length, 60)) + '\n';
    if (meta.author) header += meta.author + '\n';
	    if (meta.category) header += 'Category: ' + meta.category + '\n';
    if (meta.tags) header += 'Tags: ' + meta.tags + '\n';
    text = header + '\n' + text;

    var footnotes = getFootnotesData();
    if (footnotes.length > 0) {
      text += '\n\n--- Footnotes ---\n';
      footnotes.forEach(function(fn) { text += '[' + fn.index + '] ' + fn.text + '\n'; });
    }

    var rtfText = '';
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code > 127) rtfText += '\\u' + code + '?';
      else if (text[i] === '\\') rtfText += '\\\\';
      else if (text[i] === '{') rtfText += '\\{';
      else if (text[i] === '}') rtfText += '\\}';
      else if (text[i] === '\n') rtfText += '\\par\n';
      else rtfText += text[i];
    }
    var rtfText = rtfText || '';

    var rtf = '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Georgia Times New Roman;}}\n' +
      '{\\info{\\title ' + meta.title + '}{\\author ' + meta.author + '}}\n' +
      rtfText + '\n}';

    var blob = new Blob([rtf], { type: 'application/rtf;charset=utf-8' });
    downloadBlob(blob, sanitizeFilename(meta.title) + '.rtf', 'application/rtf');
    showToast('Exported RTF (Unicode)');
  }

  // ===== EXPORT: JSON (single document) =====
  function exportJSON() {
    var tab = tabsModule.getActive();
    var exportData = {
      title: tab ? tab.title : 'Untitled',
      content: tab ? tab.content : '',
      metadata: tab ? tab.metadata : {},
      versions: tab ? tab.versions : [],
      footnotes: getFootnotesData(),
      exportedAt: new Date().toISOString(),
      application: 'orOS Writer',
      version: CONFIG.VERSION
    };
    var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, sanitizeFilename(exportData.title) + '.json', 'application/json');
    showToast('Exported JSON');
  }

  function importTxt() {
    showImportOptions();
  }

    function setupFileImport() {
    var fileInput = document.getElementById('file-input-hidden');
    if (!fileInput) return;
        fileInput.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'orosdoc') {
        importOROSDOC(file);
        fileInput.value = '';
        return;
      }
      if (ext === 'json') {
        importJSONFile(file);
        fileInput.value = '';
        return;
      }
      loadFileIntoEditor(file, true);
      fileInput.value = '';
    });
  }
  
    // ===== STYLE SELECTOR =====
  function setupStyleSelector() {
    stylesSelect = document.getElementById('styles-select');
    if (!stylesSelect) return;
    stylesSelect.addEventListener('change', function() {
      var style = this.value;
      if (!style) return;
      var tag = (style === 'normal') ? 'p' : (style === 'quote') ? 'blockquote' : (style === 'code') ? 'pre' : style;
      execCmd('formatBlock', tag);
    });
    if (richEditor) {
      richEditor.addEventListener('keyup', updateStyleSelector);
      richEditor.addEventListener('click', updateStyleSelector);
    }
  }

  function updateStyleSelector() {
    if (!stylesSelect || !richEditor) return;
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node && node !== richEditor && node.nodeType === Node.ELEMENT_NODE) {
      var tag = node.tagName.toLowerCase();
      if (tag === 'p') { stylesSelect.value = 'normal'; return; }
      if (tag === 'blockquote') { stylesSelect.value = 'quote'; return; }
      if (tag === 'pre') { stylesSelect.value = 'code'; return; }
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') { stylesSelect.value = tag; return; }
      node = node.parentElement;
    }
  }

  // ===== KEYBOARD SHORTCUTS =====
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); execCmd('undo'); }
        else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); execCmd('redo'); }
        else if (e.key === 'b') { e.preventDefault(); execCmd('bold'); }
        else if (e.key === 'i') { e.preventDefault(); execCmd('italic'); }
        else if (e.key === 'u') { e.preventDefault(); execCmd('underline'); }
        else if (e.key === 's') { e.preventDefault(); e.stopPropagation(); saveCurrentTabContent(); showToast(getTrans('autosave') || 'Saved'); }
        else if (e.key === 'f' && !e.shiftKey) { e.preventDefault(); if (findBar) { findBar.style.display = findBar.style.display === 'none' ? 'flex' : 'none'; if (findBar.style.display !== 'none' && findInput) findInput.focus(); } }
        else if (e.key === 'f' && e.shiftKey) { e.preventDefault(); insertFootnote(); }
        else if (e.key === 'k') { e.preventDefault(); var btn = document.getElementById('btn-link'); if (btn) btn.click(); }
        else if (e.key === ',') { e.preventDefault(); execCmd('subscript'); }
        else if (e.key === '.') { e.preventDefault(); execCmd('superscript'); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          var pb = document.createElement('div');
          pb.className = 'page-break';
          pb.style.pageBreakAfter = 'always';
          pb.innerHTML = '<hr style="border:none;border-top:1px dashed #ccc;margin:1em 0;">';
          richEditor.focus();
          document.execCommand('insertHTML', false, pb.outerHTML + '<p><br></p>');
        }
        else if (e.key === 'o') {
          e.preventDefault();
          var fi = document.getElementById('file-input-hidden');
          if (fi) fi.click();
        }
        else if (e.key === 'c' && e.shiftKey) {
          e.preventDefault();
          if (commentsPanel) {
            if (commentsPanel.style.display === 'none') {
              commentsPanel.style.display = '';
              var cbtn = document.getElementById('btn-comments');
              if (cbtn) cbtn.classList.add('active');
            }
            refreshCommentsList();
            var addArea = document.getElementById('comment-add-area');
            if (addArea) addArea.style.display = '';
            var ci = document.getElementById('comment-input');
            if (ci) ci.focus();
          }
        }
        else if (e.key === 'g') { e.preventDefault(); toggleGoalSettings(); }
        else if (e.key === 'n') {
          e.preventDefault();
          tabsModule.create({ content: '<p><br></p>', metadata: {} });
          setTimeout(function() { if (richEditor) richEditor.focus(); }, 50);
        }
      }
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'F9') {
        e.preventDefault();
        e.stopPropagation();
        toggleZenMode();
      }
    }, true);

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
		        // ===== EXIT FROM PRE/BLOCKQUOTE VIA ESCAPE =====
      if (richEditor) {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          var escNode = sel.getRangeAt(0).startContainer;
          if (escNode.nodeType === Node.TEXT_NODE) escNode = escNode.parentElement;
          while (escNode && escNode !== richEditor) {
            var escTag = escNode.tagName.toLowerCase();
            if (escTag === 'pre' || escTag === 'blockquote') {
              e.preventDefault();
              e.stopPropagation();
              var exitPara = document.createElement('p');
              exitPara.innerHTML = '<br>';
              escNode.parentNode.insertBefore(exitPara, escNode.nextSibling);
              var exitRange = document.createRange();
              exitRange.setStart(exitPara, 0);
              exitRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(exitRange);
              if (stylesSelect) stylesSelect.value = 'normal';
              showToast(escTag === 'pre' ? 'Exited code block' : 'Exited quote');
              return;
            }
            escNode = escNode.parentElement;
          }
        }
      }
        if (qfmMenu && qfmMenu.classList.contains('visible')) { qfmMenu.classList.remove('visible'); return; }
        var dialogs = ['link-dialog-overlay', 'table-dialog-overlay', 'image-dialog-overlay',
                       'templates-dialog-overlay', 'special-chars-dialog-overlay',
                       'footnote-dialog-overlay', 'help-dialog-overlay'];
        for (var di = 0; di < dialogs.length; di++) {
          var dlg = document.getElementById(dialogs[di]);
          if (dlg && dlg.style.display !== 'none') { dlg.style.display = 'none'; return; }
        }
        var panels = [
  { id: 'comments-panel', btn: 'btn-comments' },
  { id: 'version-history-panel', btn: 'btn-version-history' },
  { id: 'wordfreq-panel', btn: 'btn-wordfreq' },
  { id: 'metadata-panel', btn: 'btn-metadata' },
  { id: 'toc-panel', btn: 'btn-toc' },
  { id: 'find-replace-bar', btn: 'btn-find' },
  { id: 'goal-bar', btn: 'btn-goal' }
];
for (var i = 0; i < panels.length; i++) {
  var p = document.getElementById(panels[i].id);
  if (p && p.style.display !== 'none') {
    p.style.display = 'none';
    var pbtn = document.getElementById(panels[i].btn);
    if (pbtn) pbtn.classList.remove('active');
    return;
  }
}
        var exp = document.getElementById('export-dropdown');
        if (exp && exp.classList.contains('active')) { exp.classList.remove('active'); return; }
        var isZen = document.body.hasAttribute('data-zen');
        if (isZen) { document.body.removeAttribute('data-zen'); localStorage.setItem('oros_zen_mode', 'false'); }
      }
    });
  }

  // ===== COMMAND EXECUTION =====
  function execCmd(command, value) {
    if (!richEditor) return;
    if (command === 'insertImage' && value) {
      var img = document.createElement('img');
      img.src = value;
      richEditor.focus();
      document.execCommand('insertHTML', false, img.outerHTML);
      return;
    }
    richEditor.focus();
    document.execCommand(command, false, value);
  }

  // ===== TOOLBAR BINDINGS =====
  function setupToolbarBindings() {
    bindClick('btn-bold', function() { execCmd('bold'); });
    bindClick('btn-italic', function() { execCmd('italic'); });
    bindClick('btn-underline', function() { execCmd('underline'); });
    bindClick('btn-strikethrough', function() { execCmd('strikethrough'); });
    bindClick('btn-superscript', function() { execCmd('superscript'); });
    bindClick('btn-subscript', function() { execCmd('subscript'); });
    bindClick('btn-align-left', function() { execCmd('justifyLeft'); });
    bindClick('btn-align-center', function() { execCmd('justifyCenter'); });
    bindClick('btn-align-right', function() { execCmd('justifyRight'); });
    bindClick('btn-align-justify', function() { execCmd('justifyFull'); });
    bindClick('btn-numbers', function() { execCmd('insertOrderedList'); });
    bindClick('btn-bullets', function() { execCmd('insertUnorderedList'); });
    bindClick('btn-indent', function() {
      if (!richEditor) return;
      richEditor.focus();
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      var node = sel.getRangeAt(0).startContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      while (node && node !== richEditor) {
        var tag = node.tagName;
        if (/^(P|H1|H2|H3|H4|H5|H6|LI|DIV)$/.test(tag)) {
          var ml = parseInt(node.style.marginLeft || '0', 10);
          node.style.marginLeft = (ml + 40) + 'px';
          break;
        }
        node = node.parentElement;
      }
    });
    bindClick('btn-outdent', function() {
      if (!richEditor) return;
      richEditor.focus();
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      var node = sel.getRangeAt(0).startContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      while (node && node !== richEditor) {
        var tag = node.tagName;
        if (/^(P|H1|H2|H3|H4|H5|H6|LI|DIV)$/.test(tag)) {
          var ml = parseInt(node.style.marginLeft || '0', 10);
          node.style.marginLeft = Math.max(0, ml - 40) + 'px';
          break;
        }
        node = node.parentElement;
      }
    });
        bindClick('btn-link', function() {
      var dlg = document.getElementById('link-dialog-overlay');
      if (!dlg) return;
      
      var sel = window.getSelection();
      var selectedText = '';
      if (sel.rangeCount > 0 && richEditor && richEditor.contains(sel.anchorNode)) {
        selectedText = sel.toString().trim();
        savedLinkRange = sel.getRangeAt(0).cloneRange();
      } else {
        savedLinkRange = null;
      }
      
      dlg.style.display = 'flex';
      var urlInput = document.getElementById('link-url-input');
      var textInput = document.getElementById('link-text-input');
      if (urlInput) urlInput.value = '';
      if (textInput) textInput.value = selectedText;
      setTimeout(function() { if (urlInput) urlInput.focus(); }, 50);
    });
    bindClick('btn-image', function() {
      var dlg = document.getElementById('image-dialog-overlay');
      if (dlg) dlg.style.display = 'flex';
    });
    bindClick('btn-code', function() { execCmd('formatBlock', 'pre'); });
    bindClick('btn-quote', function() { execCmd('formatBlock', 'blockquote'); });
    bindClick('btn-clear', function() {
      if (!confirm('Clear all content?')) return;
      if (richEditor) richEditor.innerHTML = '<p><br></p>';
      saveCurrentTabContent();
      updateStats();
    });
    bindClick('btn-clear-formatting', function() { execCmd('removeFormat'); });
    bindClick('btn-undo', function() { execCmd('undo'); });
    bindClick('btn-redo', function() { execCmd('redo'); });
    bindClick('btn-hr', function() {
      if (!richEditor) return;
      richEditor.focus();
      document.execCommand('insertHorizontalRule');
    });
    bindClick('btn-page-break', function() {
      if (!richEditor) return;
      var pb = document.createElement('div');
      pb.className = 'page-break';
      pb.style.pageBreakAfter = 'always';
      pb.innerHTML = '<hr style="border:none;border-top:1px dashed #ccc;margin:1em 0;">';
      richEditor.focus();
      document.execCommand('insertHTML', false, pb.outerHTML + '<p><br></p>');
    });
    bindClick('btn-open', function() {
      var fi = document.getElementById('file-input-hidden');
      if (fi) fi.click();
    });
    bindClick('btn-templates', function() {
      var dlg = document.getElementById('templates-dialog-overlay');
      if (dlg) { dlg.style.display = 'flex'; renderTemplatesGrid(); }
    });
     bindClick('btn-special-chars', function() {
      var dlg = document.getElementById('special-chars-dialog-overlay');
      if (dlg) dlg.style.display = 'flex';
    });
     bindClick('btn-table', function() {
      var dlg = document.getElementById('table-dialog-overlay');
      if (dlg) dlg.style.display = 'flex';
    });
    bindClick('btn-find', function() {
      if (findBar) {
        findBar.style.display = findBar.style.display === 'none' ? 'flex' : 'none';
        if (findBar.style.display !== 'none' && findInput) findInput.focus();
      }
    });
  }

  
    // ===== DIALOG INSERT HANDLERS =====
  function setupDialogInsertHandlers() {
    // --- LINK ---
    bindClick('btn-insert-link', function() {
      var urlInput = document.getElementById('link-url-input');
      var textInput = document.getElementById('link-text-input');
      var url = urlInput ? urlInput.value.trim() : '';
      var text = textInput ? textInput.value.trim() : '';
      if (!url) { showToast('Enter a URL'); return; }
      if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) url = 'https://' + url;

      var dlg = document.getElementById('link-dialog-overlay');
      if (dlg) dlg.style.display = 'none';

      if (richEditor) {
        richEditor.focus();
        var sel = window.getSelection();
        var range;
        if (savedLinkRange) {
          range = savedLinkRange;
          sel.removeAllRanges();
          sel.addRange(range);
        } else if (sel.rangeCount > 0) {
          range = sel.getRangeAt(0);
        } else {
          range = document.createRange();
          range.selectNodeContents(richEditor);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }

        var link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = text || url;

        range.deleteContents();
        range.insertNode(link);

        var newRange = document.createRange();
        newRange.setStartAfter(link);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }

      if (urlInput) urlInput.value = '';
      if (textInput) textInput.value = '';
      savedLinkRange = null;
      saveCurrentTabContent();
      showToast('Link inserted');
    });

    bindClick('btn-cancel-link', function() {
      var dlg = document.getElementById('link-dialog-overlay');
      if (dlg) dlg.style.display = 'none';
    });

    var btnLink = document.getElementById('btn-link');
    if (btnLink) {
      btnLink.addEventListener('mousedown', function() {
        var sel = window.getSelection();
        if (sel.rangeCount > 0 && richEditor && richEditor.contains(sel.anchorNode)) {
          savedLinkRange = sel.getRangeAt(0).cloneRange();
        }
      });
    }

    // --- TABLE ---
    bindClick('btn-create-table', function() {
      var rowsInput = document.getElementById('table-rows-select');
      var colsInput = document.getElementById('table-cols-select');
      var rows = parseInt(rowsInput ? rowsInput.value : '3', 10) || 3;
      var cols = parseInt(colsInput ? colsInput.value : '3', 10) || 3;
      if (rows < 1) rows = 1; if (rows > 20) rows = 20;
      if (cols < 1) cols = 1; if (cols > 10) cols = 10;

      var dlg = document.getElementById('table-dialog-overlay');
      if (dlg) dlg.style.display = 'none';

      if (!richEditor) return;
      richEditor.focus();

      var sel = window.getSelection();
      var range;
      if (sel.rangeCount > 0 && richEditor.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0);
      } else {
        range = document.createRange();
        range.selectNodeContents(richEditor);
        range.collapse(false);
      }

      var tableHtml = '<table class="custom-table"><thead><tr>';
      for (var c = 0; c < cols; c++) {
        tableHtml += '<th>Header ' + (c + 1) + '</th>';
      }
      tableHtml += '</tr></thead><tbody>';
      for (var r = 0; r < rows; r++) {
        tableHtml += '<tr>';
        for (var c2 = 0; c2 < cols; c2++) {
          tableHtml += '<td>&nbsp;</td>';
        }
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table><p><br></p>';

      var tempDiv = document.createElement('div');
      tempDiv.innerHTML = tableHtml;
      var table = tempDiv.firstChild;

      range.deleteContents();
      range.insertNode(table);

      var firstCell = table.querySelector('td');
      if (firstCell) {
        var cellRange = document.createRange();
        cellRange.selectNodeContents(firstCell);
        cellRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(cellRange);
      }

      saveCurrentTabContent();
      updateStats();
      showToast('Table inserted');
    });
	
    // --- IMAGE ---
    var sourceType = document.getElementById('image-source-type');
    var uploadField = document.getElementById('image-upload-field');
    var urlField = document.getElementById('image-url-field');

    if (sourceType) {
      sourceType.addEventListener('change', function() {
        if (this.value === 'upload') {
          if (uploadField) uploadField.style.display = '';
          if (urlField) urlField.style.display = 'none';
        } else {
          if (uploadField) uploadField.style.display = 'none';
          if (urlField) urlField.style.display = '';
        }
      });
    }

    var btnImg = document.getElementById('btn-image');
    if (btnImg) {
      btnImg.addEventListener('mousedown', function() {
        var sel = window.getSelection();
        if (sel.rangeCount > 0 && richEditor && richEditor.contains(sel.anchorNode)) {
          savedImageRange = sel.getRangeAt(0).cloneRange();
        }
      });
    }

    bindClick('btn-image-confirm', function() {
      var srcType = sourceType ? sourceType.value : 'url';
      var urlInput = document.getElementById('image-url-input');
      var fileInput = document.getElementById('image-file-input');
      var captionInput = document.getElementById('image-caption-input');
      var caption = captionInput ? captionInput.value.trim() : '';

      var dlg = document.getElementById('image-dialog-overlay');
      if (dlg) dlg.style.display = 'none';

      function insertImage(src) {
        if (!richEditor) return;
        richEditor.focus();

        var sel = window.getSelection();
        var range;
        if (savedImageRange) {
          range = savedImageRange;
          sel.removeAllRanges();
          sel.addRange(range);
        } else if (sel.rangeCount > 0) {
          range = sel.getRangeAt(0);
        } else {
          range = document.createRange();
          range.selectNodeContents(richEditor);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }

        var img = document.createElement('img');
        img.src = src;
        img.className = 'editor-image';
        if (caption) img.alt = caption;

        range.deleteContents();
        range.insertNode(img);

        if (caption) {
          var captionEl = document.createElement('p');
          captionEl.style.cssText = 'text-align:center;color:var(--text-muted,#888);font-size:0.85em;font-style:italic;';
          captionEl.textContent = caption;
          range.insertNode(captionEl);
        }

        var newRange = document.createRange();
        newRange.setStartAfter(caption ? img.nextSibling : img);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);

        savedImageRange = null;
        saveCurrentTabContent();
        updateStats();
        showToast('Image inserted');
      }

      if (srcType === 'upload' && fileInput && fileInput.files && fileInput.files[0]) {
        var file = fileInput.files[0];
        var reader = new FileReader();
        reader.onload = function(ev) { insertImage(ev.target.result); };
        reader.readAsDataURL(file);
      } else if (srcType === 'url' && urlInput && urlInput.value.trim()) {
        insertImage(urlInput.value.trim());
      } else {
        showToast('Select an image first');
        if (dlg) dlg.style.display = 'flex';
        return;
      }

      if (urlInput) urlInput.value = '';
      if (fileInput) fileInput.value = '';
      if (captionInput) captionInput.value = '';
    });

    // --- SPECIAL CHARACTERS ---
    setupSpecialCharsGrid();

    var btnImage2 = document.getElementById('btn-image');
    if (btnImage2) {
      btnImage2.addEventListener('click', function() {
        if (sourceType) sourceType.value = 'upload';
        if (uploadField) uploadField.style.display = '';
        if (urlField) urlField.style.display = 'none';
      });
    }
  }

  function setupSpecialCharsGrid() {
    var grid = document.getElementById('special-chars-grid');
    var tabsContainer = document.getElementById('special-chars-tabs');
    if (!grid || !tabsContainer) return;

    var currentCategory = 'greek';

    function renderGrid(cat) {
      currentCategory = cat;
      var chars = SPECIAL_CHARS[cat] || [];
      var html = '';
      for (var i = 0; i < chars.length; i++) {
        html += '<div class="sc-char" data-char="' + escapeHtml(chars[i]) + '">' + chars[i] + '</div>';
      }
      grid.innerHTML = html;

      var charEls = grid.querySelectorAll('.sc-char');
      for (var j = 0; j < charEls.length; j++) {
        (function(el) {
          el.addEventListener('click', function() {
            var ch = el.getAttribute('data-char');
            if (!richEditor || !ch) return;
            richEditor.focus();
            document.execCommand('insertText', false, ch);
            updateStats();
          });
        })(charEls[j]);
      }
    }

    var tabs = tabsContainer.querySelectorAll('.sc-tab');
    for (var t = 0; t < tabs.length; t++) {
      (function(tab) {
        tab.addEventListener('click', function() {
          for (var k = 0; k < tabs.length; k++) tabs[k].classList.remove('active');
          tab.classList.add('active');
          renderGrid(tab.getAttribute('data-cat'));
        });
      })(tabs[t]);
    }

    renderGrid('greek');
  }

  // ===== SMART TYPOGRAPHY =====
  var smartTypoPatterns = [
    { re: /\(c\)$/i,    rep: '\u00A9' },
    { re: /\(tm\)$/i,   rep: '\u2122' },
    { re: /\(r\)$/i,    rep: '\u00AE' },
    { re: /\+\/-$/i,    rep: '\u00B1' },
    { re: /->$/,         rep: '\u2192' },
    { re: /<-$/,         rep: '\u2190' },
    { re: /=>$/,         rep: '\u21D2' },
    { re: /1\/2$/,       rep: '\u00BD' },
    { re: /1\/4$/,       rep: '\u00BC' },
    { re: /3\/4$/,       rep: '\u00BE' },
    { re: /\.\.\.$/,     rep: '\u2026' },
    { re: /---$/,        rep: '\u2014' },
    { re: /--$/,         rep: '\u2013' },
    { re: /=\/=$/,       rep: '\u2261' }
  ];

  function applySmartTypography() {
    if (!smartTypographyEnabled) return;
    try {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      var node = range.startContainer;
      if (!node || node.nodeType !== Node.TEXT_NODE) return;
      var offset = range.startOffset;
      if (offset < 1) return;
      var text = node.textContent;
      var before = text.substring(0, offset);
      var after = text.substring(offset);

      if (before.charAt(offset - 1) === '"') {
        var openQ = (before.substring(0, offset - 1).match(/\u201C/g) || []).length;
        var closeQ = (before.substring(0, offset - 1).match(/\u201D/g) || []).length;
        var rq = openQ > closeQ ? '\u201D' : '\u201C';
        node.textContent = before.substring(0, offset - 1) + rq + after;
        range.setStart(node, offset);
        range.setEnd(node, offset);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }

      if (before.charAt(offset - 1) === "'") {
        var prev = before.charAt(offset - 2);
        var rs = (prev && /\w/.test(prev)) ? '\u2019' : '\u2018';
        node.textContent = before.substring(0, offset - 1) + rs + after;
        range.setStart(node, offset);
        range.setEnd(node, offset);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }

      for (var i = 0; i < smartTypoPatterns.length; i++) {
        var p = smartTypoPatterns[i];
        var m = before.match(p.re);
        if (m) {
          var matchedLen = m[0].length;
          var newBefore = before.substring(0, before.length - matchedLen) + p.rep;
          node.textContent = newBefore + after;
          var newOffset = newBefore.length;
          range.setStart(node, newOffset);
          range.setEnd(node, newOffset);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
      }
    } catch(e) {}
  }

  // ===== AUTO-CORRECT =====
  function applyAutoCorrect() {
    try {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      var node = range.startContainer;
      if (!node || node.nodeType !== Node.TEXT_NODE) return;
      var offset = range.startOffset;
      if (offset < 3) return;
      var text = node.textContent;
      var lastChar = text.charAt(offset - 1);
      if (lastChar !== ' ' && lastChar !== '\u00A0' && lastChar !== '\t') return;

      var beforeSpace = text.substring(0, offset - 1);
      var match = beforeSpace.match(/(\S+)$/);
      if (!match) return;
      var word = match[1];
      var lower = word.toLowerCase();

      if (autocorrectRules[lower]) {
        var replacement = autocorrectRules[lower];
        var wordStart = offset - 1 - word.length;
        node.textContent = text.substring(0, wordStart) + replacement + text.substring(offset - 1);
        var newOffset = wordStart + replacement.length + 1;
        range.setStart(node, newOffset);
        range.setEnd(node, newOffset);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch(e) {}
  }
  
    // ===== PLACEHOLDER CHECK =====
  function checkPlaceholder() {
    if (!richEditor) return;
    var html = richEditor.innerHTML.trim();
    var isEmpty = html === '' || html === '<p><br></p>' || html === '<p></p>' || html === '<br>';
    if (isEmpty) richEditor.classList.add('editor-empty');
    else richEditor.classList.remove('editor-empty');
  }

  // ===== EDITOR INPUT =====
  function setupEditorInput() {
    if (!richEditor) return;
	    richEditor.addEventListener('keydown', function(e) {
      // ===== DOUBLE ENTER EXITS PRE/BLOCKQUOTE =====
      if (e.key === 'Enter' && !e.shiftKey) {
        var sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        var node = sel.getRangeAt(0).startContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        while (node && node !== richEditor) {
          if (node.tagName === 'PRE' || node.tagName === 'BLOCKQUOTE') {
            var range = sel.getRangeAt(0);
            var blockText = node.textContent.trim();
            var lastChild = node.lastChild;
            var isAtEnd = range.endContainer === node ||
                          (node.contains(range.endContainer) &&
                           (range.endContainer === lastChild ||
                            (lastChild && lastChild.nodeType === Node.TEXT_NODE &&
                             range.endOffset >= lastChild.textContent.length)));
            if (isAtEnd && blockText === '') {
              e.preventDefault();
              var exitP = document.createElement('p');
              exitP.innerHTML = '<br>';
              node.parentNode.insertBefore(exitP, node.nextSibling);
              var exitRange = document.createRange();
              exitRange.setStart(exitP, 0);
              exitRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(exitRange);
              if (stylesSelect) stylesSelect.value = 'normal';
              return;
            }
            return;
          }
          node = node.parentElement;
        }
      }
    });
	    richEditor.addEventListener('keydown', function(e) {
      if (!goalLockCheckbox || !goalLockCheckbox.checked) return;
      var goal = parseInt(localStorage.getItem('oros_writer_goal'), 10) || 0;
      if (goal <= 0) return;

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var navKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Escape'];
      if (navKeys.indexOf(e.key) !== -1) return;

      var current = getCurrentGoalCount();
      if (current >= goal) {
        e.preventDefault();
        showToast('🔒 Goal limit reached. Unlock to continue.');
      }
    });

        richEditor.addEventListener('input', function() {
      playTypewriterSound();
      applyAutoCorrect();
      applySmartTypography();
      isTyping = true;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(function() {
        if (isTyping) { saveCurrentTabContent(); isTyping = false; }
      }, 10000);
      updateStats();
      updateReadingProgress();
      checkPlaceholder();
    });

    richEditor.addEventListener('paste', function(e) {
      if (!smartPasteEnabled) return;
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    richEditor.addEventListener('scroll', updateReadingProgress);

    richEditor.addEventListener('focus', function() {
      if (richEditor.innerHTML === '') richEditor.innerHTML = '<p><br></p>';
    });

    tabsModule.on('switch', function(tab) {
      if (!richEditor || !tab) return;
      richEditor.innerHTML = tab.content || '<p><br></p>';
      checkPlaceholder();
      loadPageSettingsFields();
      loadMetadataFields();
      restoreFootnotes();
      loadAndRestoreComments();
      applyPageSize(tab.metadata ? tab.metadata.pageSize || 'a4' : 'a4');
      applyPageMargins();
      applyHeaderFooter();
      updateStats();
      updateSaveIndicator('saved');
	  checkPlaceholder();
    });
  }
  
    // ===== DRAG & DROP FILE OPENING =====
  function setupDragDrop() {
    if (!richEditor) return;

    var dragCounter = 0;
    var dropOverlay = null;

    function createOverlay() {
      if (dropOverlay) return;
      dropOverlay = document.createElement('div');
      dropOverlay.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'background:rgba(109,74,255,0.15);' +
        'border:3px dashed var(--accent-gold,#c8a96e);' +
        'display:flex;align-items:center;justify-content:center;' +
        'z-index:9999;pointer-events:none;' +
        'font-size:1.2rem;color:var(--accent-gold,#c8a96e);' +
        'font-weight:600;backdrop-filter:blur(2px);';
      dropOverlay.innerHTML = '<i class="fa fa-download" style="margin-right:10px;font-size:1.5rem;"></i> Drop file to open';
      document.body.appendChild(dropOverlay);
    }

    function removeOverlay() {
      if (dropOverlay) { dropOverlay.remove(); dropOverlay = null; }
    }

    document.addEventListener('dragenter', function(e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
        dragCounter++;
        createOverlay();
      }
    });

    document.addEventListener('dragleave', function(e) {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; removeOverlay(); }
    });

    document.addEventListener('dragover', function(e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    document.addEventListener('drop', function(e) {
      e.preventDefault();
      dragCounter = 0;
      removeOverlay();

      if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

      for (var i = 0; i < e.dataTransfer.files.length; i++) {
                var file = e.dataTransfer.files[i];
        var fileName = file.name.toLowerCase();
        var ext = fileName.split('.').pop();

        if (ext === 'orosdoc') { importOROSDOC(file); continue; }
        if (ext === 'json') { importJSONFile(file); continue; }

        var valid = ['.txt', '.md', '.markdown', '.rtf', '.html', '.htm', '.docx', '.odt'].some(function(ext) {
          return fileName.endsWith(ext);
        });
        if (!valid) {
          showToast('Unsupported file: ' + file.name);
          continue;
        }

        if (i === 0 && richEditor && richEditor.innerHTML.trim() === '<p><br></p>') {
          loadFileIntoEditor(file, false);
        } else {
          loadFileIntoEditor(file, true);
        }
      }
    });
  }

  // ===== WINDOW RESIZE =====
  function setupWindowResize() {
    window.addEventListener('resize', function() {
      clearTimeout(windowResizeDebounce);
      windowResizeDebounce = setTimeout(function() {
        clampToViewport();
        if (tabsModule.initialized) tabsModule.render();
      }, 200);
    });
  }

    // ===== CLOSE WARNING (sync-aware) =====
  function setupCloseWarning() {
    window.addEventListener('beforeunload', function(e) {
      if (!richEditor) return;
      var hasContent = (richEditor.innerText || '').trim().length > 0;
      if (!hasContent) return;

      // Τελευταία προσπάθεια αποθήκευσης πριν το κλείσιμο
      saveCurrentTabContent();
      if (cloudSync && cloudSync.dirHandle) {
        try { cloudSync.saveBackup().catch(function(){}); } catch(err) {}
      }

      var syncActive = !!(cloudSync && cloudSync.dirHandle);
      var lastSync = localStorage.getItem('oros_writer_last_sync');
      var syncFresh = false;

      if (syncActive && lastSync) {
        var ageMs = Date.now() - new Date(lastSync).getTime();
        syncFresh = ageMs < 2 * 60 * 1000; // sync πριν από λιγότερο από 2 λεπτά
      }

      var message;
      if (syncActive && syncFresh) {
        message = 'Sync is active and up to date. Leave orOS Writer anyway?';
      } else if (syncActive) {
        var syncDate = lastSync ? new Date(lastSync).toLocaleString(currentLang === 'el' ? 'el-GR' : 'en-US') : 'unknown';
        message = 'Sync is enabled, but the last completed backup was: ' + syncDate +
          '.\n\nRecent changes may not be synced yet. Leave anyway?';
        console.warn(message);
      } else {
        message = 'SYNC IS NOT ENABLED. To avoid data loss, either:\n' +
          '1. Enable Cloud Sync (folder-based sync), or\n' +
          '2. Keep a manual local copy via Export → Full Database Export.\n\n' +
          'Your current data exists only in this browser. Leave anyway?';
        console.warn(message);
        showToast('⚠ Sync disabled — enable sync or export a manual backup!');
      }

      e.preventDefault();
      e.returnValue = message; // custom κείμενο: το δείχνουν κάποια browsers
      return message;
    });
  }

  // ===== PWA INSTALL BUTTON =====
  function setupPWAInstallButton() {
    var btn = document.getElementById('btn-install');
    if (!btn) return;
    btn.disabled = true;

    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      window.deferredPrompt = e;
      btn.disabled = false;
      btn.style.display = '';
    });

    btn.addEventListener('click', function() {
      if (window.deferredPrompt) {
        window.deferredPrompt.prompt();
        window.deferredPrompt.userChoice.then(function(choiceResult) {
          if (choiceResult.outcome === 'accepted') {
            showToast('App installed');
          }
          window.deferredPrompt = null;
          btn.disabled = true;
          btn.style.display = 'none';
        }).catch(function() {});
      } else {
        showToast('Install not available in this browser');
      }
    });
  }

  // ===== LINK CLICK HANDLER =====
  function setupLinkClickHandler() {
    if (!richEditor) return;
    richEditor.addEventListener('click', function(e) {
      var link = e.target.closest ? e.target.closest('a') : null;
      if (!link && e.target.tagName === 'A') link = e.target;
      if (link && link.getAttribute('href')) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          window.open(link.href, '_blank');
        }
      }
    });
  }

  // ===== METADATA PANEL =====
  function setupMetadataPanel() {
    bindClick('btn-metadata', toggleMetadataPanel);
    if (metaTitle) metaTitle.addEventListener('blur', saveMetadataField);
    if (metaAuthor) metaAuthor.addEventListener('blur', saveMetadataField);
    if (metaTags) metaTags.addEventListener('blur', saveMetadataField);
    if (metaCategory) metaCategory.addEventListener('blur', saveMetadataField);
    loadMetadataFields();
  }

    function toggleMetadataPanel() {
    if (!metadataPanel) return;
    var isVisible = metadataPanel.style.display !== 'none';
    metadataPanel.style.display = isVisible ? 'none' : '';
    var btn = document.getElementById('btn-metadata');
    if (btn) btn.classList.toggle('active', !isVisible);
    if (!isVisible) {
      loadPageSettingsFields();
      loadMetadataFields();
    }
  }

  function saveMetadataField() {
    var meta = tabsModule.getMetadata();
    if (metaTitle) meta.title = metaTitle.value;
    if (metaAuthor) meta.author = metaAuthor.value;
    if (metaTags) meta.tags = metaTags.value;
    if (metaCategory) meta.category = metaCategory.value;
    meta.modified = new Date().toISOString();
    tabsModule.setMetadata(meta);

    // Ενημέρωση τίτλου καρτέλας
    var tab = tabsModule.getActive();
    if (tab && metaTitle) {
      var newTitle = metaTitle.value.trim() || 'Untitled';
      if (tab.title !== newTitle) {
        tab.title = newTitle;
        tabsModule.persist();
        tabsModule.render();
      }
    }

    // Ενημέρωση <title> browser tab
    document.title = (metaTitle ? metaTitle.value : 'Untitled') + ' — orOS Writer';

    // Εμφάνιση ημερομηνίας τροποποίησης
    var metaDates = document.getElementById('meta-dates');
    if (metaDates) metaDates.style.display = '';
    if (metaModified) metaModified.textContent = 'Modified: ' + new Date(meta.modified).toLocaleString(currentLang === 'el' ? 'el-GR' : 'en-US');

    updateSaveIndicator('saved');
  }

  function loadMetadataFields() {
    var meta = tabsModule.getMetadata();
    if (metaTitle) metaTitle.value = meta.title || '';
    if (metaAuthor) metaAuthor.value = meta.author || '';
    if (metaTags) metaTags.value = meta.tags || '';
    if (metaCategory) metaCategory.value = meta.category || '';
    if (metaCreated) metaCreated.textContent = meta.created || '-';
    if (metadataPanel && metadataPanel.style.display !== 'none') {
      if (metaModified) metaModified.textContent = meta.modified || '-';
    }
  }

  // ===== TABLE OF CONTENTS =====
  function setupTableOfContents() {
    bindClick('btn-toc', toggleTocPanel);

    bindClick('btn-toc-insert', function() {
      if (!richEditor) return;
      var heads = richEditor.querySelectorAll('h1, h2, h3, h4, h5, h6');
      if (heads.length === 0) { showToast('No headings found'); return; }

      var html = '<h2>Table of Contents</h2><ul style="list-style:none;padding-left:0;">';
      for (var i = 0; i < heads.length; i++) {
        var tag = heads[i].tagName.toLowerCase();
        var text = heads[i].textContent.trim() || '(empty)';
        var indent = '';
        if (tag === 'h2') indent = 'padding-left:1.5em;';
        else if (tag === 'h3') indent = 'padding-left:3em;';
        else if (tag === 'h4') indent = 'padding-left:4.5em;';
        else if (tag === 'h5') indent = 'padding-left:6em;';
        else if (tag === 'h6') indent = 'padding-left:7.5em;';
        html += '<li style="' + indent + '"><a href="#toc-' + i + '" class="toc-link" style="color:var(--accent-gold-light);text-decoration:none;">' + escapeHtml(text) + '</a></li>';
        heads[i].id = 'toc-' + i;
      }
      html += '</ul><p><br></p>';

      richEditor.focus();
      var sel = window.getSelection();
      var range;
      if (sel.rangeCount > 0 && richEditor.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0);
      } else {
        range = document.createRange();
        range.selectNodeContents(richEditor);
        range.collapse(true);
      }
      range.deleteContents();

      var tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      var fragment = document.createDocumentFragment();
      while (tempDiv.firstChild) fragment.appendChild(tempDiv.firstChild);
      range.insertNode(fragment);

      var newRange = document.createRange();
      newRange.setStartAfter(fragment.lastChild || richEditor.firstChild);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);

      saveCurrentTabContent();
	  
	  var tocLinks = richEditor.querySelectorAll('.toc-link');
    for (var tl = 0; tl < tocLinks.length; tl++) {
      (function(link) {
        link.addEventListener('click', function(e) {
          e.preventDefault();
          var targetId = link.getAttribute('href').substring(1);
          var target = document.getElementById(targetId);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('outline-flash');
            setTimeout(function() { target.classList.remove('outline-flash'); }, 1200);
          }
        });
      })(tocLinks[tl]);
    }
	
      updateStats();
      showToast('Table of Contents inserted');
    });
  }

  function toggleTocPanel() {
    if (!tocPanel) return;
    var isVisible = tocPanel.style.display !== 'none';
    tocPanel.style.display = isVisible ? 'none' : '';
    var btn = document.getElementById('btn-toc');
    if (btn) btn.classList.toggle('active', !isVisible);
    if (!isVisible && tocList) {
      var heads = richEditor.querySelectorAll('h1, h2, h3, h4, h5, h6');
      var html = '';
      for (var i = 0; i < heads.length; i++) {
        var tag = heads[i].tagName.toLowerCase();
        var text = heads[i].textContent.trim() || '(empty)';
        var indent = '';
        if (tag === 'h2') indent = 'padding-left:1.5em;';
        else if (tag === 'h3') indent = 'padding-left:3em;';
        else if (tag === 'h4') indent = 'padding-left:4.5em;';
        else if (tag === 'h5') indent = 'padding-left:6em;';
        else if (tag === 'h6') indent = 'padding-left:7.5em;';
        html += '<div class="toc-item" data-idx="' + i + '" style="' + indent + 'cursor:pointer;">' + escapeHtml(text) + '</div>';
      }
      tocList.innerHTML = html || '<div class="empty-msg">No headings</div>';
      var items = tocList.querySelectorAll('.toc-item');
      for (var j = 0; j < items.length; j++) {
        (function(item, idx) {
          item.addEventListener('click', function() {
            var heading = richEditor.querySelectorAll('h1, h2, h3, h4, h5, h6')[idx];
            if (heading) {
              heading.scrollIntoView({ behavior: 'smooth', block: 'center' });
              heading.classList.add('outline-flash');
              setTimeout(function() { heading.classList.remove('outline-flash'); }, 1200);
            }
          });
        })(items[j], j);
      }
    }
  }

  // ===== LOREM IPSUM =====
  function setupLoremIpsum() {
    bindClick('btn-lorem', insertLorem);
  }

  function insertLorem() {
    var lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';
    if (!richEditor) return;
    richEditor.focus();
    document.execCommand('insertText', false, lorem);
    updateStats();
  }

  // ===== QUICK FORMAT MENU (Alt + Right-click) =====
  var qfmEnabled = true;
  var qfmMenu = null;
  var savedRange = null;

    function setupQuickFormatMenu() {
    if (qfmMenu) { qfmMenu.remove(); }
    qfmMenu = document.createElement('div');
    qfmMenu.className = 'quick-format-menu';
    qfmMenu.style.cssText =
      'position:fixed;z-index:10000;' +
      'background:var(--bg-panel,#1e1e2e);' +
      'border:1px solid var(--border-color,#333);' +
      'border-radius:6px;padding:4px 0;box-shadow:0 4px 16px rgba(0,0,0,0.4);' +
      'font-size:0.85rem;min-width:160px;';
    document.body.appendChild(qfmMenu);

    var items = [
      { label: 'Bold',          icon: 'fa-bold',          cmd: 'bold' },
      { label: 'Italic',        icon: 'fa-italic',        cmd: 'italic' },
      { label: 'Underline',     icon: 'fa-underline',     cmd: 'underline' },
      { label: 'Strikethrough', icon: 'fa-strikethrough', cmd: 'strikethrough' },
      { sep: true },
      { label: 'Subscript',     icon: 'fa-subscript',     cmd: 'subscript' },
      { label: 'Superscript',   icon: 'fa-superscript',   cmd: 'superscript' },
      { sep: true },
      { label: 'Heading 1',     icon: 'fa-header',        cmd: 'h1' },
      { label: 'Heading 2',     icon: 'fa-header',        cmd: 'h2' },
      { label: 'Normal',        icon: 'fa-font',          cmd: 'normal' },
      { sep: true },
      { label: 'Bullet List',   icon: 'fa-list-ul',       cmd: 'insertUnorderedList' },
      { label: 'Numbered List', icon: 'fa-list-ol',       cmd: 'insertOrderedList' },
      { sep: true },
      { label: 'Insert Link',   icon: 'fa-link',          action: 'link' },
      { label: 'Insert Comment',icon: 'fa-comment-o',    action: 'comment' }
    ];

    items.forEach(function(item) {
      if (item.sep) {
        var sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:var(--border-color,#333);margin:4px 0;';
        qfmMenu.appendChild(sep);
        return;
      }
      var btn = document.createElement('button');
      btn.style.cssText =
        'display:flex;align-items:center;gap:8px;width:100%;' +
        'padding:6px 14px;background:none;border:none;' +
        'color:var(--text-primary,#e0e0e0);cursor:pointer;text-align:left;' +
        'font-size:inherit;font-family:inherit;';
      btn.innerHTML = '<i class="fa ' + item.icon + '" style="width:16px;"></i> ' + item.label;

      btn.addEventListener('mouseenter', function() {
        btn.style.background = 'var(--bg-hover,#2a2a3e)';
      });
      btn.addEventListener('mouseleave', function() {
        btn.style.background = 'none';
      });

      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        qfmMenu.classList.remove('visible');
        if (!richEditor) return;
        richEditor.focus();
        if (item.cmd) {
          if (item.cmd === 'h1' || item.cmd === 'h2' || item.cmd === 'normal') {
            restoreSelection();
            document.execCommand('formatBlock', false,
              item.cmd === 'normal' ? 'p' : item.cmd.toUpperCase());
          } else {
            restoreSelection();
            document.execCommand(item.cmd, false, null);
          }
        } else if (item.action === 'link') {
          var linkBtn = document.getElementById('btn-link');
          if (linkBtn) linkBtn.click();
        } else if (item.action === 'comment') {
          var cmtBtn = document.getElementById('btn-comments');
          if (cmtBtn) cmtBtn.click();
        }
      });

      qfmMenu.appendChild(btn);
    });

    if (richEditor) {
      richEditor.addEventListener('contextmenu', function(e) {
        if (e.altKey) {
          e.preventDefault();
          saveSelection();

          var x = e.clientX;
          var y = e.clientY;
          qfmMenu.style.left = x + 'px';
          qfmMenu.style.top = y + 'px';
          qfmMenu.classList.add('visible');

          setTimeout(function() {
            var rect = qfmMenu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
              qfmMenu.style.left = (window.innerWidth - rect.width - 8) + 'px';
            }
            if (rect.bottom > window.innerHeight) {
              qfmMenu.style.top = (window.innerHeight - rect.height - 8) + 'px';
            }
          }, 0);
        }
      });
    }

    document.addEventListener('click', function(e) {
      if (qfmMenu && qfmMenu.classList.contains('visible')) {
        if (!qfmMenu.contains(e.target)) {
          qfmMenu.classList.remove('visible');
        }
      }
    });
  }
  
  function saveSelection() {
    var sel = window.getSelection();
    if (sel.rangeCount > 0) {
      savedRange = sel.getRangeAt(0);
    }
  }

  function restoreSelection() {
    if (savedRange) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  window.addEventListener('oros-quick-tbar-changed', function() {
    qfmEnabled = localStorage.getItem('oros_quick_tbar_show') !== 'false';
  });

  // ===== HELP BUTTON =====
  document.addEventListener('click', function(e) {
    var target = e.target.closest ? e.target.closest('#btn-help') : null;
    if (target) {
      e.stopPropagation();
      e.preventDefault();
      var dlg = document.getElementById('help-dialog-overlay');
      if (dlg) dlg.style.display = 'flex';
    }
  }, true);

  // ===== CLOUD SYNC MODULE =====
  var cloudSync = {
    DB_NAME: 'oros_writer_sync',
    DB_VERSION: 1,
    STORE_NAME: 'kv',
    DIR_HANDLE_KEY: 'directory_handle',
    LAST_SYNC_KEY: 'last_backup',
    AUTO_INTERVAL_MS: 300000,
    FILE_NAME: 'oros-writer-sync.json',

    idb: null,
    dirHandle: null,
    autoTimer: null,

    // ===== IndexedDB Core =====
    initIDB: function() {
      return new Promise(function(resolve, reject) {
        if (!('indexedDB' in window)) { reject(new Error('No IndexedDB')); return; }
        var req = indexedDB.open(cloudSync.DB_NAME, cloudSync.DB_VERSION);
        req.onupgradeneeded = function(e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(cloudSync.STORE_NAME)) {
            db.createObjectStore(cloudSync.STORE_NAME);
          }
        };
        req.onsuccess = function(e) { cloudSync.idb = e.target.result; resolve(); };
        req.onerror = function(e) { reject(e.target.error); };
      });
    },

    idbPut: function(key, value) {
      return new Promise(function(resolve, reject) {
        if (!cloudSync.idb) { reject(new Error('IDB not ready')); return; }
        var tx = cloudSync.idb.transaction(cloudSync.STORE_NAME, 'readwrite');
        tx.objectStore(cloudSync.STORE_NAME).put(value, key);
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function(e) { reject(e.target.error); };
      });
    },

    idbGet: function(key) {
      return new Promise(function(resolve, reject) {
        if (!cloudSync.idb) { reject(new Error('IDB not ready')); return; }
        var tx = cloudSync.idb.transaction(cloudSync.STORE_NAME, 'readonly');
        var req = tx.objectStore(cloudSync.STORE_NAME).get(key);
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function(e) { reject(e.target.error); };
      });
    },

    idbDel: function(key) {
      return new Promise(function(resolve, reject) {
        if (!cloudSync.idb) { resolve(); return; }
        var tx = cloudSync.idb.transaction(cloudSync.STORE_NAME, 'readwrite');
        tx.objectStore(cloudSync.STORE_NAME).delete(key);
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function(e) { reject(e.target.error); };
      });
    },

    // ===== Database Collection =====
    collectDatabase: function() {
      var data = {
        _meta: {
          app: 'orOS Writer',
          version: CONFIG.VERSION,
          exportedAt: new Date().toISOString(),
          type: 'full-database',
          keyCount: 0
        },
        localStorage: {}
      };
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('oros') === 0) {
          data.localStorage[key] = localStorage.getItem(key);
        }
      }
      data._meta.keyCount = Object.keys(data.localStorage).length;
      return data;
    },

    applyRestoredData: function(data) {
      if (!data || !data._meta || data._meta.type !== 'full-database') return false;
      var keysToRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('oros') === 0) keysToRemove.push(k);
      }
      for (var r = 0; r < keysToRemove.length; r++) localStorage.removeItem(keysToRemove[r]);
      Object.keys(data.localStorage).forEach(function(key) {
        localStorage.setItem(key, data.localStorage[key]);
      });
      return true;
    },

    // ===== File System Access API =====
    isSupported: function() {
      return typeof window.showDirectoryPicker === 'function';
    },

    pickDirectory: function() {
      if (!cloudSync.isSupported()) {
        showToast('File System Access API not available. Using IndexedDB only.');
        return Promise.resolve(null);
      }
      return window.showDirectoryPicker({ mode: 'readwrite' }).then(function(handle) {
        cloudSync.dirHandle = handle;
        return cloudSync.idbPut(cloudSync.DIR_HANDLE_KEY, handle).then(function() {
          return handle;
        });
      });
    },
	
	    reauthorizeDirHandle: function() {
      if (!cloudSync._pendingDirHandle) return Promise.resolve(null);
      return cloudSync._pendingDirHandle.requestPermission({ mode: 'readwrite' }).then(function(rp) {
        if (rp === 'granted') {
          cloudSync.dirHandle = cloudSync._pendingDirHandle;
          cloudSync._pendingDirHandle = null;
          cloudSync.updateStatus('synced', null);
          cloudSync.updateDirDisplay();
          cloudSync.saveBackup();
          showToast('Sync folder reconnected: ' + cloudSync.dirHandle.name);
          return cloudSync.dirHandle;
        }
        showToast('Permission denied');
        return null;
      }).catch(function() { return null; });
    },

       restoreDirHandle: function() {
      return cloudSync.idbGet(cloudSync.DIR_HANDLE_KEY).then(function(handle) {
        if (!handle) return null;
        if (!handle.queryPermission) { cloudSync.dirHandle = handle; return handle; }
        return handle.queryPermission({ mode: 'readwrite' }).then(function(perms) {
          if (perms === 'granted') {
            cloudSync.dirHandle = handle;
            return handle;
          }
          // Permission not granted on reload — store handle for later user-gesture grant
          cloudSync._pendingDirHandle = handle;
          cloudSync.updateStatus('idle', null);
          // Show a reconnect button or notification
          cloudSync.updateDirDisplay();
          if (cloudSync._pendingDirHandle) {
            showToast('Click "Choose Sync Folder" to re-authorize');
          }
          return null;
        });
      }).catch(function() { return null; });
    },

    writeToFile: function(data) {
      if (!cloudSync.dirHandle) return Promise.reject(new Error('No directory handle'));
      return cloudSync.dirHandle.getFileHandle(cloudSync.FILE_NAME, { create: true })
        .then(function(fh) { return fh.createWritable(); })
        .then(function(writable) {
          return writable.write(JSON.stringify(data, null, 2)).then(function() {
            return writable.close();
          });
        });
    },

    readFromFile: function() {
      if (!cloudSync.dirHandle) return Promise.reject(new Error('No directory handle'));
      return cloudSync.dirHandle.getFileHandle(cloudSync.FILE_NAME)
        .then(function(fh) { return fh.getFile(); })
        .then(function(file) { return file.text(); })
        .then(function(text) { return JSON.parse(text); });
    },

    // ===== Backup (File + IndexedDB) =====
    saveBackup: function() {
      var data = cloudSync.collectDatabase();
      var promises = [];

      // Always save to IndexedDB
      promises.push(cloudSync.idbPut(cloudSync.LAST_SYNC_KEY, data));

      // If directory handle, also save to file
      if (cloudSync.dirHandle) {
        promises.push(
          cloudSync.writeToFile(data).then(function() { return true; })
            .catch(function(e) { console.warn('File write failed:', e); return false; })
        );
      }

      return Promise.all(promises).then(function() {
        var now = new Date().toISOString();
        localStorage.setItem('oros_writer_last_sync', now);
        cloudSync.updateStatus(cloudSync.dirHandle ? 'synced' : 'unsupported', now);
        cloudSync.updateDirDisplay();
        return true;
      });
    },

    loadBackup: function() {
      return cloudSync.idbGet(cloudSync.LAST_SYNC_KEY).then(function(idbData) {
        if (!cloudSync.dirHandle) return idbData;
        return cloudSync.readFromFile().then(function(fileData) {
          var fTime = fileData && fileData._meta ? new Date(fileData._meta.exportedAt).getTime() : 0;
          var iTime = idbData && idbData._meta ? new Date(idbData._meta.exportedAt).getTime() : 0;
          return fTime >= iTime ? fileData : idbData;
        }).catch(function() { return idbData; });
      });
    },

    // ===== Auto-Sync =====
    startAutoSync: function() {
      cloudSync.stopAutoSync();
      cloudSync.autoTimer = setInterval(function() {
        cloudSync.saveBackup().catch(function(e) {
          console.warn('Auto-sync failed:', e);
        });
      }, cloudSync.AUTO_INTERVAL_MS);
    },

    stopAutoSync: function() {
      if (cloudSync.autoTimer) { clearInterval(cloudSync.autoTimer); cloudSync.autoTimer = null; }
    },

    // ===== UI =====
    updateStatus: function(status, timestamp) {
      var statusEl = document.getElementById('cloud-sync-status');
      var lastEl = document.getElementById('cloud-sync-last');
      if (statusEl) {
        statusEl.className = 'sync-status sync-' + status;
        var labels = {
          'idle': '● Not configured',
          'synced': '✓ Synced',
          'syncing': '⟳ Syncing…',
          'error': '⚠ Sync error',
          'unsupported': '● IndexedDB only'
        };
        statusEl.textContent = labels[status] || status;
      }
      if (lastEl && timestamp) {
        lastEl.textContent = new Date(timestamp).toLocaleString(currentLang === 'el' ? 'el-GR' : 'en-US');
      } else if (lastEl && !timestamp) {
        var saved = localStorage.getItem('oros_writer_last_sync');
        if (saved) lastEl.textContent = new Date(saved).toLocaleString(currentLang === 'el' ? 'el-GR' : 'en-US');
        else lastEl.textContent = '';
      }
    },

    updateDirDisplay: function() {
      var display = document.getElementById('sync-dir-display');
      var nameEl = document.getElementById('sync-dir-name');
      var connectBtn = document.getElementById('btn-cloud-connect');
      var disconnectBtn = document.getElementById('btn-cloud-disconnect');

      if (cloudSync.dirHandle && display && nameEl) {
        nameEl.textContent = cloudSync.dirHandle.name || 'Unknown folder';
        display.style.display = '';
        if (connectBtn) connectBtn.style.display = 'none';
        if (disconnectBtn) disconnectBtn.style.display = '';
      } else {
        if (display) display.style.display = 'none';
        if (connectBtn) connectBtn.style.display = '';
        if (disconnectBtn) disconnectBtn.style.display = 'none';
      }
    },

    // ===== Remote Check =====
    checkRemoteUpdate: function() {
      if (!cloudSync.dirHandle) return;
      cloudSync.readFromFile().then(function(fileData) {
        if (!fileData || !fileData._meta) return;
        var fileTime = new Date(fileData._meta.exportedAt).getTime();
        var lastSync = localStorage.getItem('oros_writer_last_sync');
        var localTime = lastSync ? new Date(lastSync).getTime() : 0;

        if (fileTime > localTime) {
          var dateStr = new Date(fileTime).toLocaleString(currentLang === 'el' ? 'el-GR' : 'en-US');
          if (confirm('A newer sync file was found from another device (' + dateStr + ').\n\nRestore data from cloud? Your current local data will be replaced.')) {
            cloudSync.applyRestoredData(fileData);
            localStorage.setItem('oros_writer_last_sync', new Date().toISOString());
            showToast('Data restored from cloud. Reloading…');
            setTimeout(function() { location.reload(); }, 800);
          }
        }
      }).catch(function() {});
    },

    // ===== Actions =====
        syncNow: function() {
      if (!cloudSync.dirHandle) {
        showToast('No sync folder connected. Click "Choose Sync Folder" first.');
        return;
      }
      cloudSync.updateStatus('syncing', null);
      cloudSync.saveBackup().then(function() {
        showToast('Sync complete');
      }).catch(function(e) {
        cloudSync.updateStatus('error', null);
        showToast('Sync failed: ' + e.message);
      });
    },

    disconnect: function() {
      cloudSync.dirHandle = null;
      cloudSync.idbDel(cloudSync.DIR_HANDLE_KEY).then(function() {
        cloudSync.updateStatus('idle', null);
        cloudSync.updateDirDisplay();
        showToast('Cloud sync disconnected. IndexedDB backup continues.');
      });
    },

    restoreFromIDB: function() {
      cloudSync.idbGet(cloudSync.LAST_SYNC_KEY).then(function(data) {
        if (!data || !data._meta) { showToast('No IndexedDB backup found'); return; }
        var dateStr = new Date(data._meta.exportedAt).toLocaleString(currentLang === 'el' ? 'el-GR' : 'en-US');
        if (!confirm('Restore from IndexedDB backup (' + dateStr + ')?\n\nThis replaces ALL current data.')) return;
        cloudSync.applyRestoredData(data);
        showToast('Restored from IndexedDB. Reloading…');
        setTimeout(function() { location.reload(); }, 800);
      }).catch(function(e) {
        showToast('Restore failed: ' + e.message);
      });
    },

    restoreFromCloud: function() {
      if (!cloudSync.dirHandle) { showToast('No sync folder connected'); return; }
      cloudSync.readFromFile().then(function(data) {
        if (!data || !data._meta) { showToast('No sync file found in folder'); return; }
        var dateStr = new Date(data._meta.exportedAt).toLocaleString(currentLang === 'el' ? 'el-GR' : 'en-US');
        if (!confirm('Restore from cloud file (' + dateStr + ')?\n\nThis replaces ALL current data.')) return;
        cloudSync.applyRestoredData(data);
        localStorage.setItem('oros_writer_last_sync', new Date().toISOString());
        showToast('Restored from cloud. Reloading…');
        setTimeout(function() { location.reload(); }, 800);
      }).catch(function(e) {
        showToast('No sync file found or read error');
      });
    },

    // ===== Init =====
    init: function() {
      if (!('indexedDB' in window)) {
        cloudSync.updateStatus('error', null);
        return;
      }
      cloudSync.initIDB().then(function() {
        return cloudSync.restoreDirHandle();
      }).then(function(handle) {
        if (handle) {
          cloudSync.updateStatus('synced', localStorage.getItem('oros_writer_last_sync'));
          cloudSync.updateDirDisplay();
          cloudSync.checkRemoteUpdate();
        } else {
          cloudSync.updateStatus(cloudSync.isSupported() ? 'idle' : 'unsupported', null);
          cloudSync.updateDirDisplay();
        }
        // Always start auto-backup (IndexedDB at minimum)
        cloudSync.startAutoSync();
      }).catch(function(e) {
        console.warn('Cloud sync init failed:', e);
        cloudSync.updateStatus('error', null);
      });
    }
  };

  // ===== SETTINGS TAB SWITCHING (universal handler) =====
  document.addEventListener('click', function(e) {
    var btn = e.target.closest ? e.target.closest('.tab-btn') : null;
    if (!btn || !btn.closest('.settings-nav')) return;
    var tabId = btn.getAttribute('data-tab');
    if (!tabId) return;
    var nav = btn.closest('.settings-nav');
    var allBtns = nav.querySelectorAll('.tab-btn');
    for (var i = 0; i < allBtns.length; i++) allBtns[i].classList.remove('active');
    btn.classList.add('active');
    var body = nav.nextElementSibling;
    if (body) {
      var allPanels = body.querySelectorAll('.tab-panel');
      for (var j = 0; j < allPanels.length; j++) allPanels[j].style.display = 'none';
    }
    var panel = document.getElementById(tabId);
    if (panel) panel.style.display = 'flex';
  });

  // ===== INITIALIZATION =====
  function waitForTranslations(callback) {
    var attempts = 0;
    function check() {
      if (loadTranslations()) { callback(); return; }
      attempts++;
      if (attempts >= 50) { callback(); return; }
      setTimeout(check, 100);
    }
    check();
  }

  function startApp() {
    if (initialized) return;
    applyTheme();

    if (localStorage.getItem('oros_zen_mode') === 'true') {
      document.body.setAttribute('data-zen', 'true');
    }
    var zenToggle = document.getElementById('toggle-zen-mode');
    if (zenToggle) zenToggle.checked = localStorage.getItem('oros_zen_mode') === 'true';

    waitForTranslations(function() {
      currentLang = getCurrentLang();
      applyLanguage(currentLang);
      initializeElements();
      loadSettings();
      loadSettingsValues();
      setupSettingToggles();
      loadAutoCorrections();
      loadCustomTemplates();
      loadGoal();

      tabsModule.init('#tab-bar');
      setupStatsToggle();
      setupFindReplace();
      setupWordFrequency();
      setupComments();
      setupFootnotes();
	  setupCommentCleanup();
      setupVersionHistory();
      setupZenMode();
      setupGoalBar();
      setupExportImport();
      setupStyleSelector();
      setupKeyboardShortcuts();
      setupToolbarBindings();
      setupDialogInsertHandlers();
      setupLinkClickHandler();
      setupEditorInput();
	  setupDragDrop();
      setupWindowResize();
      setupCloseWarning();
      setupPWAInstallButton();
      setupMetadataPanel();
      setupTableOfContents();
      setupLoremIpsum();
      setupQuickFormatMenu();
	  setupLaunchQueue();
      applyPageSettings();
	  
	        // ===== CLOUD SYNC =====
      cloudSync.init();
	  
	        // Register Writer's sync with the shared oros-sync framework
      if (window.orosSync) {
        cloudSync.id = 'writer';
        cloudSync.toast = function(msg) { showToast(msg); };
        window.orosSync.register(cloudSync);
      }

      bindClick('btn-cloud-connect', function() {
        if (cloudSync._pendingDirHandle) {
          cloudSync.reauthorizeDirHandle();
          return;
        }
        cloudSync.pickDirectory().then(function(handle) {
          if (handle) {
            showToast('Sync folder: ' + handle.name);
            cloudSync.saveBackup().then(function() {
              cloudSync.updateDirDisplay();
            });
          }
        }).catch(function(e) {
          if (e && e.name !== 'AbortError') {
            showToast('Folder selection failed: ' + (e.message || e.name));
          }
        });
      });

      bindClick('btn-cloud-sync-now', function() { cloudSync.syncNow(); });
      bindClick('btn-cloud-disconnect', function() { cloudSync.disconnect(); });
      bindClick('btn-cloud-restore', function() { cloudSync.restoreFromCloud(); });
      bindClick('btn-idb-restore', function() { cloudSync.restoreFromIDB(); });
	  
            // Event listener για αλλαγή page size
      var pageSizeSelect = document.getElementById('page-size-select');
      if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', function() {
          var meta = tabsModule.getMetadata();
          meta.pageSize = this.value;
          tabsModule.setMetadata(meta);
          applyPageSize(this.value);
          applyPageMargins();
          applyHeaderFooter();
          syncPageSizeToUI(this.value);
        });
      }

      // ===== REAL-TIME HEADER / FOOTER LISTENERS =====
      var headerTextInput = document.getElementById('header-text');
      if (headerTextInput) {
        headerTextInput.addEventListener('input', function() {
          var meta = tabsModule.getMetadata();
          meta.headerText = this.value;
          tabsModule.setMetadata(meta);
          applyHeaderFooter();
        });
      }

      var footerTextInput = document.getElementById('footer-text');
      if (footerTextInput) {
        footerTextInput.addEventListener('input', function() {
          var meta = tabsModule.getMetadata();
          meta.footerText = this.value;
          tabsModule.setMetadata(meta);
          applyHeaderFooter();
        });
      }

      var footerPageNumInput = document.getElementById('footer-page-num');
      if (footerPageNumInput) {
        footerPageNumInput.addEventListener('change', function() {
          var meta = tabsModule.getMetadata();
          meta.footerPageNum = this.checked;
          tabsModule.setMetadata(meta);
          applyHeaderFooter();
        });
      }

      [document.getElementById('margin-top'), document.getElementById('margin-bottom'),
       document.getElementById('margin-left'), document.getElementById('margin-right')].forEach(function(el) {
        if (el) el.addEventListener('change', function() {
          var meta = tabsModule.getMetadata();
          meta.marginTop = document.getElementById('margin-top').value;
          meta.marginBottom = document.getElementById('margin-bottom').value;
          meta.marginLeft = document.getElementById('margin-left').value;
          meta.marginRight = document.getElementById('margin-right').value;
          tabsModule.setMetadata(meta);
          applyPageMargins();
          applyHeaderFooter();
        });
      });

      clampToViewport();

      var tab = tabsModule.getActive();
      if (tab && richEditor) {
        richEditor.innerHTML = tab.content || '<p><br></p>';
        restoreFootnotes();
        loadAndRestoreComments();
        updateStats();
		checkPlaceholder();
      }

      // ===== PANEL & DIALOG CLOSE HANDLERS =====

      bindClick('btn-reset-margins', function() {
        var defaults = { top: '2.54', bottom: '2.54', left: '2.54', right: '2.54' };
        var ids = ['margin-top', 'margin-bottom', 'margin-left', 'margin-right'];
        for (var i = 0; i < ids.length; i++) {
          var el = document.getElementById(ids[i]);
          if (el) el.value = defaults[ids[i].replace('margin-', '')];
        }
        var meta = tabsModule.getMetadata();
        meta.marginTop = '2.54';
        meta.marginBottom = '2.54';
        meta.marginLeft = '2.54';
        meta.marginRight = '2.54';
        tabsModule.setMetadata(meta);
        applyPageMargins();
        showToast('Margins reset to 2.54 cm');
      });
	  
      bindClick('btn-close-wordfreq', function() {
        if (wordFreqPanel) wordFreqPanel.style.display = 'none';
        var wfbtn = document.getElementById('btn-wordfreq');
        if (wfbtn) wfbtn.classList.remove('active');
      });
      bindClick('btn-close-comments', function() {
        if (commentsPanel) commentsPanel.style.display = 'none';
        var cbtn = document.getElementById('btn-comments');
        if (cbtn) cbtn.classList.remove('active');
      });
      bindClick('btn-close-toc', function() {
        if (tocPanel) tocPanel.style.display = 'none';
        var tbtn = document.getElementById('btn-toc');
        if (tbtn) tbtn.classList.remove('active');
      });
      bindClick('btn-close-version', function() {
        if (versionPanel) versionPanel.style.display = 'none';
        var vbtn = document.getElementById('btn-version-history');
        if (vbtn) vbtn.classList.remove('active');
      });
      bindClick('btn-close-metadata', function() {
        if (metadataPanel) metadataPanel.style.display = 'none';
        var mbtn = document.getElementById('btn-metadata');
        if (mbtn) mbtn.classList.remove('active');
      });
	        bindClick('btn-apply-page-settings', function() {
        savePageSettings();
      });
      bindClick('btn-close-goal', function() {
        if (goalBar) goalBar.style.display = 'none';
        var gbtn = document.getElementById('btn-goal');
        if (gbtn) gbtn.classList.remove('active');
      });
      bindClick('btn-close-footnotes', function() { if (footnoteArea) footnoteArea.style.display = 'none'; });

      bindClick('btn-close-templates', function() { var d = document.getElementById('templates-dialog-overlay'); if (d) d.style.display = 'none'; });
      bindClick('btn-cancel-templates', function() { var d = document.getElementById('templates-dialog-overlay'); if (d) d.style.display = 'none'; });
      bindClick('btn-save-as-template', function() {
        var title = getTabTitle() || 'Custom Template';
        var content = richEditor ? richEditor.innerHTML : '<p><br></p>';
        var tpl = { id: 'tpl_' + Date.now(), title: title, desc: 'User template', content: content };
        customTemplates.push(tpl);
        saveCustomTemplates();
        renderTemplatesGrid();
        showToast('Template saved');
      });

      bindClick('btn-import-templates', function() {
        var input = document.getElementById('templates-import-input');
        if (input) input.click();
      });

      bindClick('btn-export-templates', function() {
        if (customTemplates.length === 0) { showToast('No custom templates to export'); return; }
        var blob = new Blob([JSON.stringify(customTemplates, null, 2)], { type: 'application/json' });
        downloadBlob(blob, 'oros-writer-templates.json');
        showToast('Templates exported');
      });

      var tplImportInput = document.getElementById('templates-import-input');
      if (tplImportInput) {
        tplImportInput.addEventListener('change', function(e) {
          var file = e.target.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function(ev) {
            try {
              var imported = JSON.parse(ev.target.result);
              if (Array.isArray(imported)) {
                for (var i = 0; i < imported.length; i++) {
                  if (imported[i].title && imported[i].content) {
                    imported[i].id = 'tpl_' + Date.now() + '_' + i;
                    customTemplates.push(imported[i]);
                  }
                }
                saveCustomTemplates();
                renderTemplatesGrid();
                showToast('Templates imported');
              } else { showToast('Invalid template file'); }
            } catch(err) { showToast('Import failed'); }
          };
          reader.readAsText(file);
          tplImportInput.value = '';
        });
      }

      bindClick('btn-close-special-chars', function() { var d = document.getElementById('special-chars-dialog-overlay'); if (d) d.style.display = 'none'; });
      bindClick('btn-close-special-chars-ok', function() { var d = document.getElementById('special-chars-dialog-overlay'); if (d) d.style.display = 'none'; });

      bindClick('btn-close-help', function() { var d = document.getElementById('help-dialog-overlay'); if (d) d.style.display = 'none'; });
      bindClick('btn-close-help-ok', function() { var d = document.getElementById('help-dialog-overlay'); if (d) d.style.display = 'none'; });
      bindClick('btn-help', function() { var d = document.getElementById('help-dialog-overlay'); if (d) d.style.display = 'flex'; });

      bindClick('btn-close-link-dialog', function() { var d = document.getElementById('link-dialog-overlay'); if (d) d.style.display = 'none'; });

      bindClick('btn-close-table-dialog', function() { var d = document.getElementById('table-dialog-overlay'); if (d) d.style.display = 'none'; });
      bindClick('btn-cancel-table', function() { var d = document.getElementById('table-dialog-overlay'); if (d) d.style.display = 'none'; });

      bindClick('btn-close-image-dialog', function() { var d = document.getElementById('image-dialog-overlay'); if (d) d.style.display = 'none'; });
      bindClick('btn-cancel-image', function() { var d = document.getElementById('image-dialog-overlay'); if (d) d.style.display = 'none'; });

      bindClick('btn-close-footnote-dialog', function() { var d = document.getElementById('footnote-dialog-overlay'); if (d) d.style.display = 'none'; });
      bindClick('btn-cancel-footnote', function() { var d = document.getElementById('footnote-dialog-overlay'); if (d) d.style.display = 'none'; });

      bindClick('btn-set-goal', saveGoal);
      bindClick('btn-clear-goal', clearGoal);

      bindClick('btn-add-autocorrect', addAutocorrectRule);
      bindClick('btn-reset-autocorrect', resetAutocorrectRules);

            bindClick('btn-toc-refresh', function() { if (tocList) toggleTocPanel(); });

      // ===== FULL DATABASE EXPORT — captures ALL oros* localStorage keys =====
      bindClick('btn-export-database', function() {
        var data = {
          _meta: {
            app: 'orOS Writer',
            version: CONFIG.VERSION,
            exportedAt: new Date().toISOString(),
            type: 'full-database',
            keyCount: 0
          },
          localStorage: {}
        };

        // Scan ALL localStorage for oros* prefixed keys (covers oros_ and oros- prefixes)
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && key.indexOf('oros') === 0) {
            data.localStorage[key] = localStorage.getItem(key);
          }
        }
        data._meta.keyCount = Object.keys(data.localStorage).length;

        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        downloadBlob(blob, 'oros-writer-database.json');
        showToast('Full database exported (' + data._meta.keyCount + ' keys)');
      });

      // ===== FULL DATABASE IMPORT — restores ALL oros* localStorage keys =====
      bindClick('btn-import-database', function() {
        var input = document.getElementById('database-import-input');
        if (input) input.click();
      });

      var dbImportInput = document.getElementById('database-import-input');
      if (dbImportInput) {
        dbImportInput.addEventListener('change', function(e) {
          var file = e.target.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function(ev) {
            try {
              var data = JSON.parse(ev.target.result);
              if (!data._meta || data._meta.type !== 'full-database') {
                showToast('Invalid database file');
                return;
              }
              if (!confirm('This will REPLACE ALL current data with the imported database.\n\nAll current tabs, settings, and templates will be overwritten. Continue?')) return;

              // Clear existing oros* keys first
              var keysToRemove = [];
              for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf('oros') === 0) keysToRemove.push(k);
              }
              for (var r = 0; r < keysToRemove.length; r++) {
                localStorage.removeItem(keysToRemove[r]);
              }

              // Restore all keys from backup
              var restored = 0;
              Object.keys(data.localStorage).forEach(function(key) {
                localStorage.setItem(key, data.localStorage[key]);
                restored++;
              });

              showToast('Database restored (' + restored + ' keys). Reloading...');
              setTimeout(function() { location.reload(); }, 800);
            } catch(err) {
              showToast('Import failed: ' + err.message);
            }
          };
          reader.readAsText(file);
          dbImportInput.value = '';
        });
      }

      setTimeout(function() {
        renderAutocorrectRules();
        renderTemplatesGrid();
      }, 200);

      initialized = true;

      window.addEventListener('oros-language-changed', function(e) {
        applyLanguage(e.detail.lang);
        loadGoal();
      });

      window.addEventListener('oros-zen-mode-changed', function(e) {
        if (e.detail.enabled) document.body.setAttribute('data-zen', 'true');
        else document.body.removeAttribute('data-zen');
      });

      var welcomeMsg = getTrans('app_welcome');
      showToast(welcomeMsg === 'app_welcome' ? 'Welcome to orOS Writer!' : welcomeMsg);
    });
  }

      function initializeElements() {
    richEditor = document.getElementById('rich-editor');
    richWrapper = document.querySelector('.rich-wrapper');
    tabBar = document.querySelector('#tab-bar');
    saveIndicator = document.getElementById('save-indicator');
    statsOverlay = document.querySelector('.stats-overlay');
    statsDefaultEl = document.querySelector('.stats-default');
    statsGoalEl = document.querySelector('.stats-goal');
    statsDetailed = document.getElementById('stats-detailed');
    goalBar = document.getElementById('goal-bar') || document.querySelector('.goal-bar');
    findBar = document.getElementById('find-replace-bar') || document.querySelector('.find-replace-bar');
    stylesSelect = document.getElementById('styles-select');
    footnoteArea = document.getElementById('footnote-area');
    metadataPanel = document.getElementById('metadata-panel');
    wordFreqPanel = document.getElementById('wordfreq-panel');
    wordFreqList = document.getElementById('wordfreq-list');
    wordFreqSummary = document.getElementById('wordfreq-summary');
    commentsPanel = document.getElementById('comments-panel');
    tocPanel = document.getElementById('toc-panel');
    tocList = document.getElementById('toc-list');
    versionPanel = document.getElementById('version-history-panel');
    versionList = document.getElementById('version-list');
    metaTitle = document.getElementById('meta-title');
    metaAuthor = document.getElementById('meta-author');
    metaTags = document.getElementById('meta-tags');
    metaCategory = document.getElementById('meta-category');
    metaCreated = document.getElementById('meta-created');
    metaModified = document.getElementById('meta-modified');
    exportDropdown = document.getElementById('export-dropdown');
    findInput = document.getElementById('find-input');
    replaceInput = document.getElementById('replace-input');
    frResults = document.getElementById('fr-results');
    findFormatFilter = document.getElementById('find-format-filter');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }

  // Expose for external access
  window.orosWriter = {
    getTabContent: function() { return tabsModule.getContent(); },
    setTabContent: function(html) { tabsModule.setContent(html); },
    getMetadata: function() { return tabsModule.getMetadata(); },
    setMetadata: function(meta) { tabsModule.setMetadata(meta); },
    createTab: function(opts) { return tabsModule.create(opts); },
    switchTab: function(id) { tabsModule.switchTo(id); },
    closeTab: function(id) { tabsModule.close(id); },
    init: startApp
  };
  
    // ===== FILE HANDLING API (Default App for Documents) =====
  function setupLaunchQueue() {
    if (!('launchQueue' in window) || !window.launchQueue || !window.launchQueue.setConsumer) return;

    window.launchQueue.setConsumer(function(launchParams) {
      if (!launchParams.files || launchParams.files.length === 0) return;

      var filesProcessed = 0;
      var firstFile = null;

      for (var i = 0; i < launchParams.files.length; i++) {
        var fileHandle = launchParams.files[i];

        fileHandle.getFile().then(function(file) {
          if (!firstFile) {
            firstFile = file;
            loadFileIntoEditor(file, true);
          } else {
            loadFileIntoEditor(file, false);
          }
          filesProcessed++;
        }).catch(function(e) {
          console.warn('Failed to open file via launch queue:', e);
        });
      }
    });
  }

    function loadFileIntoEditor(file, asNewTab) {
    var reader = new FileReader();
    reader.onload = function(ev) {
      var content = ev.target.result;
      var fileName = file.name.toLowerCase();
      var html = '';

      if (fileName.endsWith('.html') || fileName.endsWith('.htm')) {
        var parsed = new DOMParser().parseFromString(content, 'text/html');
        var bodyEl = parsed.body || parsed.documentElement;
        var junk = bodyEl.querySelectorAll('script, style, link, meta, noscript');
        for (var s = 0; s < junk.length; s++) {
          if (junk[s].parentNode) junk[s].parentNode.removeChild(junk[s]);
        }
        html = bodyEl.innerHTML || '<p><br></p>';
      } else if (fileName.endsWith('.rtf')) {
        html = (typeof window.parseRTF === 'function')
          ? window.parseRTF(content)
          : '<p>' + escapeHtml(content).replace(/\n/g, '<br>') + '</p>';
      } else if (fileName.endsWith('.docx')) {
        if (window.mammoth) {
          mammoth.convertToHtml({ arrayBuffer: ev.target.result })
            .then(function(result) {
              if (asNewTab) {
                tabsModule.create({ content: result.value || '<p><br></p>',
                  title: file.name.replace(/\.[^.]+$/, ''), metadata: {} });
              } else {
                if (richEditor) richEditor.innerHTML = result.value || '<p><br></p>';
                saveCurrentTabContent();
              }
              showToast(file.name + ' opened');
              updateStats();
            })
            .catch(function() { showToast('Failed to read .docx'); });
          return;
        }
        html = '<p>' + escapeHtml(content) + '</p>';
      } else {
        html = '<p>' + escapeHtml(content).replace(/\n/g, '<br>') + '</p>';
      }

      if (asNewTab) {
        tabsModule.create({
          content: html,
          title: file.name.replace(/\.[^.]+$/, ''),
          metadata: { created: new Date().toISOString() }
        });
      } else {
        if (richEditor) richEditor.innerHTML = html;
        saveCurrentTabContent();
      }
      showToast(file.name + ' opened');
      updateStats();
    };

    if (file.name.toLowerCase().endsWith('.docx') && window.mammoth) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  }

})();