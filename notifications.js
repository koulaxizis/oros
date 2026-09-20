// ===== NOTIFICATIONS MODULE — BOOTSTRAP =====
(function () {
  const VERSION = '1.0.0';
  const LOG_PREFIX = '[orOS][notifs]';

  // ——— Configuration constants ———
  const TOAST_POSITIONS = [
    'top-left', 'top', 'top-right',
    'right', 'bottom-right', 'bottom',
    'bottom-left', 'left'
  ];

  // Palette vars ONLY — follows every skin. Hardcoded hex would
  // break on Adwaita/Ubuntu/Mint etc. (scToast doctrine)
  const TOAST_STYLES = {
    oros:   { border: 'var(--accent)', borderRadius: 8,  padding: '12px 16px', bg: 'var(--panel-bg)' },
    dunst:  { border: 'var(--border)', borderRadius: 4,  padding: '10px 14px', bg: 'var(--panel-bg)', fontWeight: 400 },
    plasma: { border: 'var(--accent)', borderRadius: 12, padding: '14px 18px', bg: 'var(--panel-bg)', fontWeight: 600 },
    gnome:  { border: 'var(--accent)', borderRadius: 12, padding: '16px 20px', bg: 'var(--panel-bg)', boxShadow: '0 4px 12px var(--shadow, rgba(0,0,0,0.3))' }
  };

  const SOUNDS = { none: null, bell: 440, ding: 880, chime: 660 }; // Hz frequencies

  // ——— Runtime state ———
  let state = {
    ready: false,
    slice: null,
    intervalId: null,
    lastFireTimestamp: {},     // dedupKey → last firedAt
    pendingToasts: [],         // queue for micro-cache
    audioCtx: null
  };

  // ——— Logger helper ———
  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }
  function err(...args) {
    console.error(LOG_PREFIX, 'ERROR:', ...args);
  }

  // ===== WEB AUDIO PRESETS (zero external deps) =====
  function getAudioContext() {
    if (!state.audioCtx) {
      try {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        log('Web Audio not supported');
        return null;
      }
    }
    return state.audioCtx;
  }

  function playTone(freqHz, type = 'sine', durationSec = 0.3) {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freqHz;
    // FIX: state.settings never existed — the volume lives in the
    // slice. Use getSetting so the persisted volume is honored.
    gain.gain.setValueAtTime(getSetting('soundVolume', 0.7), now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec);
  }

  // ===== SLICE MANAGEMENT (oros-notifs) =====
  function loadSlice() {
    try {
      const raw = localStorage.getItem('oros-notifs');
      state.slice = raw ? JSON.parse(raw) : { ver: 1, settings: defaultSettings(), items: [], meta: { lastSweep: 0 }, appToggles: {} };
      
      // Initialize appToggles for known apps
      const knownApps = ['calendar', 'cycle', 'mood', 'todo', 'habits'];
      knownApps.forEach(app => {
        if (typeof state.slice.appToggles[app] !== 'boolean') {
          state.slice.appToggles[app] = true;
        }
      });

      // Migrate legacy settings
      if (!state.slice.settings) {
        state.slice.settings = defaultSettings();
      }

      saveSliceThrottled();
    } catch (e) {
      err('Failed to load slice, resetting', e);
      state.slice = { ver: 1, settings: defaultSettings(), items: [], meta: { lastSweep: 0 }, appToggles: {} };
      saveSliceThrottled();
    }
  }

  function defaultSettings() {
    return {
      enabled: true,
      position: 'top-right',
      style: 'oros',
      sound: 'none',
      soundVolume: 0.7,
      duration: 5000,
      settingsRev: 1,   // LWW clock for the settings object (merge: max wins)
      quietHours: { enabled: false, from: '22:00', quietHoursStart: 22, to: '08:00', quietHoursEnd: 8 }
    };
  }

  // FLUSH now — used by beforeunload AND notifSliceSet (a
  // setTimeout(0) would never run before the page dies; a pull-fed
  // merge must be on disk before the next tick).
  function saveSliceNow() {
    clearTimeout(state._saveTimer);
    try {
      localStorage.setItem('oros-notifs', JSON.stringify(state.slice));
      state.slice.meta.lastSyncPush = Date.now();
      return true;
    } catch (e) {
      err('Failed to save slice', e);
      return false;
    }
  }

  function saveSliceThrottled(delay = 1000) {
    clearTimeout(state._saveTimer);
    state._saveTimer = setTimeout(saveSliceNow, delay);
  }

  // User-initiated mutation → the sync engine must know. NEVER call
  // from notifSliceSet — pull → set → push would loop (shellSliceSet
  // lesson).
  function noteChange() {
    if (window.orosSync && typeof window.orosSync.markDirty === 'function') {
      window.orosSync.markDirty();
    }
  }

  function getSetting(key, defaultVal) {
    return state.slice?.settings?.[key] ?? defaultVal;
  }

  function setSetting(key, value) {
    if (!state.slice.settings) state.slice.settings = defaultSettings();
    state.slice.settings[key] = value;
    state.slice.settings.settingsRev = (state.slice.settings.settingsRev || 0) + 1;
    noteChange();          // user action → sync engine must know
    saveSliceThrottled(500);
    // Reactivity: re-apply CSS vars immediately
    if (key === 'position' || key === 'style') applyToastStyle();
  }
  
    // ===== SCHEDULER ENGINE — HYBRID PULL-DESIGN =====
  
  function bootSweep() {
    if (!state.ready || !getSetting('enabled', true)) return;
    
    log('Boot sweep starting...');
    const now = Date.now();
    const lastSweep = state.slice.meta.lastSweep || 0;
    
    // Catch-up: fire everything missed since last boot
    const missedItems = state.slice.items.filter(item => {
      if (item.firedAt) return false; // Already fired somewhere
      if (!getAppToggle(item.ns)) return false; // Disabled app
      if (isQuietHour(now)) return false; // Silent period
      
      return true;
    });

    // Fire all missed items
    missedItems.forEach(item => fireToast(item, true));
    
    // Mark as fired in local state
    missedItems.forEach(item => {
      if (!item.firedAt) {
        item.firedAt = now;
      }
    });

    state.slice.meta.lastSweep = now;
    saveSliceThrottled(500);
    updateBadge();
    
    log(`Boot sweep complete: ${missedItems.length} items fired`);
  }

  function scheduledSweep() {
    if (!state.ready || !getSetting('enabled', true)) return;
    
    const now = Date.now();
    const lastSweep = state.slice.meta.lastSweep || 0;
    const cooldown = 60 * 1000; // 60 seconds minimum
    
    if (now - lastSweep < cooldown) return; // Throttle

    // 1. PRUNE EXPIRED ITEMS
    pruneExpiredItems();
    
    // 2. CHECK FOR NEW TRIGGERS FROM REGISTERED SOURCES
    checkRegisteredTriggers();
    
    state.slice.meta.lastSweep = now;
    saveSliceThrottled(500);
    updateBadge();
  }

  function isQuietHour(now) {
    const qh = getSetting('quietHours', {});
    if (!qh.enabled) return false;
    
    const hour = new Date(now).getHours();
    const start = qh.quietHoursStart ?? 22;
    const end = qh.quietHoursEnd ?? 8;
    
    if (start <= end) {
      // Normal range (e.g., 22:00–08:00)
      return hour >= start && hour < end;
    } else {
      // Overnight range (e.g., 22:00–06:00 crosses midnight)
      return hour >= start || hour < end;
    }
  }

  function pruneExpiredItems() {
    const TTL_DAYS = 7;
    const cutoff = Date.now() - (TTL_DAYS * 24 * 60 * 60 * 1000);
    
    const beforeCount = state.slice.items.length;
    state.slice.items = state.slice.items.filter(item => {
      return !item.expiresAt || item.expiresAt > cutoff;
    });
    
    if (state.slice.items.length !== beforeCount) {
      log(`Pruned ${beforeCount - state.slice.items.length} expired items`);
    }
  }

  // Trigger registry for apps to inject reminders
  const triggerRegistry = [];
  
  function registerTrigger(triggerFn) {
    // triggerFn: async function() { return [{ ns, type, title, body, deepLink, ttlDays }] }
    triggerRegistry.push(triggerFn);
  }

  async function checkRegisteredTriggers() {
    const now = Date.now();
    
    for (const triggerFn of triggerRegistry) {
      try {
        const candidates = await triggerFn();
        if (!Array.isArray(candidates)) continue;
        
        for (const cand of candidates) {
          // Validate required fields
          if (!cand.ns || !cand.title || !cand.body) {
            err('Invalid trigger candidate', cand);
            continue;
          }
          
          // Skip if app toggled off
          if (!getAppToggle(cand.ns)) continue;
          
          // Create deterministic ID
          const id = `${cand.ns}_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
          const dedupKey = `${cand.ns}_${cand.type || 'reminder'}_${Math.floor(now / (24*60*60*1000))}`;
          
          // Check deduplication (fire only once per day per logical event)
          if (state.lastFireTimestamp[dedupKey] && (now - state.lastFireTimestamp[dedupKey]) < (23 * 60 * 60 * 1000)) {
            log(`Dedup skipped: ${dedupKey}`);
            continue;
          }
          
          // Create notification item
          const item = {
            id,
            dedupKey,
            ns: cand.ns,
            type: cand.type || 'reminder',
            title: cand.title,
            body: cand.body,
            deepLink: cand.deepLink || null,
            createdAt: now,
            firedAt: now, // Will be set when toast actually fires
            readAt: null,
            expiresAt: cand.ttlDays ? now + (cand.ttlDays * 24 * 60 * 60 * 1000) : null
          };
          
          // Add to inbox
          state.slice.items.unshift(item);
          noteChange();    // new inbox item is data — travels via slice
          
          // Mark as fired for dedup
          state.lastFireTimestamp[dedupKey] = now;
          
          // Fire toast if not in quiet hours
          if (!isQuietHour(now)) {
            fireToast(item, false);
          }
        }
      } catch (e) {
        err('Trigger execution failed', triggerFn.name, e);
      }
    }
  }

  function getAppToggle(appNs) {
    return state.slice?.appToggles?.[appNs] ?? true;
  }
  
  function setAppToggle(appNs, enabled) {
    if (!state.slice.appToggles) state.slice.appToggles = {};
    state.slice.appToggles[appNs] = enabled;
    saveSliceThrottled(500);
  }

  // Visibility change hook for mobile catch-up
  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      // Immediate sweep on wake
      log('Page became visible — immediate sweep');
      setTimeout(() => {
        scheduledSweep(); // Defer slightly to avoid blocking paint
      }, 100);
    }
  }
  
    // ===== TOAST EMITTER — CENTRALIZED =====

  function applyToastStyle() {
    // Set CSS custom vars for toast zone
    const pos = getSetting('position', 'top-right');
    const style = getSetting('style', 'oros');
    
    document.documentElement.style.setProperty('--notif-position', pos);
    document.documentElement.style.setProperty('--notif-style', style);
  }

  function fireToast(item, isCatchUp = false) {
    if (!state.ready) return;
    
    const position = getSetting('position', 'top-right');
    const styleName = getSetting('style', 'oros');
    const style = TOAST_STYLES[styleName] || TOAST_STYLES.oros;
    const soundType = getSetting('sound', 'none');
    const duration = getSetting('duration', 5000);
    
    // Update item's firedAt
    if (!item.firedAt) item.firedAt = Date.now();
    
    // Build toast DOM
    const toast = document.createElement('div');
    toast.className = 'oros-toast';
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    
    // Apply style inline — palette vars via TOAST_STYLES (A1)
    Object.assign(toast.style, {
      position: 'fixed',
      zIndex: 10000,
      maxWidth: '400px',
      backgroundColor: style.bg,
      border: `2px solid ${style.border}`,
      borderRadius: `${style.borderRadius}px`,
      padding: style.padding,
      fontFamily: 'Nunito, sans-serif',
      fontWeight: style.fontWeight,
      color: 'var(--text)',
      cursor: 'pointer',
      opacity: '0',
      transition: 'opacity 0.3s ease',
      boxShadow: '0 4px 12px var(--shadow, rgba(0,0,0,0.3))',
      // Position calculation
      ...getPositionStyles(position)
    });
    
    // Inner content
    toast.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:start;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; margin-bottom:4px; white-space:normal;">${escapeHtml(item.title)}</div>
          <div style="font-size:0.9em; opacity:0.9; white-space:normal;">${escapeHtml(item.body)}</div>
        </div>
        <button class="notif-dismiss" aria-label="${escapeHtml(window.t('notifs.dismiss'))}"
          style="background:none; border:none; color:var(--text); font-size:1.2em; cursor:pointer; padding:0 0 0 12px; line-height:1;">✕</button>
      </div>
    `;
    
    // Click → deep link via the REAL per-app bridges (A7 router)
    toast.addEventListener('click', (e) => {
      if (e.target.classList.contains('notif-dismiss')) return;
      openTarget(item);
      // Mark as read
      markAsRead(item.id);
      toast.remove();
    });
    
    // Dismiss button
    toast.querySelector('.notif-dismiss').addEventListener('click', (e) => {
      e.stopPropagation();
      markAsRead(item.id);
      toast.remove();
    });
    
    // Append to body
    document.body.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
    });
    
    // Auto-remove
    const timerId = setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, duration);
    
    // Sound (if enabled)
    if (soundType !== 'none' && SOUNDS[soundType]) {
      playTone(SOUNDS[soundType], 'sine', 0.2);
    }
    
    // Cleanup timer on removal
    const observer = new MutationObserver(() => {
      if (!toast.parentNode) {
        clearTimeout(timerId);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
    
    log(`Toast fired: ${item.title}`);
  }
  
    // ===== DEEP LINK ROUTER — shell reality =====
  // There is NO generic window.__orosOpenX — each app owns its own
  // bridge (verified bridges: __orosOpenContact / __orosOpenCycle /
  // __orosOpenMood). deepLink format: "ns:type:id" — we route by
  // namespace. Apps without a bridge yet (calendar, Wave 1B+):
  // navigation no-ops gracefully, the badge/inbox still works.
  var DL_BRIDGES = {
    contacts: function (id) { window.__orosOpenContact(id); },
    cycle:    function (id) { window.__orosOpenCycle(id); },
    mood:     function (id) { window.__orosOpenMood(id); }
  };

  function openTarget(item) {
    if (!item || typeof item.deepLink !== 'string') return;
    var parts = item.deepLink.split(':');   // "cycle:entry:e_123"
    var bridge = DL_BRIDGES[parts[0]];
    var payload = parts.length >= 3 ? parts[2] : null;
    if (bridge && payload) bridge(payload);
  }


  function getPositionStyles(position) {
    const map = {
      'top-left': { top: '20px', left: '20px', right: 'auto' },
      'top': { top: '20px', left: '50%', transform: 'translateX(-50%)', right: 'auto' },
      'top-right': { top: '20px', right: '20px', left: 'auto' },
      'right': { top: '50%', right: '20px', transform: 'translateY(-50%)', left: 'auto' },
      'bottom-right': { bottom: '20px', right: '20px', left: 'auto', top: 'auto' },
      'bottom': { bottom: '20px', left: '50%', transform: 'translateX(-50%)', right: 'auto', top: 'auto' },
      'bottom-left': { bottom: '20px', left: '20px', right: 'auto', top: 'auto' },
      'left': { top: '50%', left: '20px', transform: 'translateY(-50%)', right: 'auto' }
    };
    return map[position] || map['top-right'];
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function markAsRead(id) {
    const item = state.slice.items.find(i => i.id === id);
    if (item && !item.readAt) {
      item.readAt = Date.now();
      noteChange();        // read state must travel to the cloud
      saveSliceThrottled(200);
      updateBadge();
    }
  }

  // ===== BADGE LOGIC — TASKBAR INTEGRATION =====

  function updateBadge() {
    const unreadCount = state.slice.items.filter(i => !i.readAt).length;
    
    // Find taskbar bell element
    const bellBtn = document.getElementById('oros-taskbar-bell');
    if (!bellBtn) return;
    
    let badge = bellBtn.querySelector('.notif-badge');
    
    if (unreadCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'notif-badge';
        badge.style.cssText =
          'position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;' +
          'background:var(--accent);color:#fff;border-radius:10px;font-size:10px;' +
          'font-weight:700;display:flex;align-items:center;justify-content:center;' +
          'padding:0 4px;transition:transform 0.2s ease;';
        bellBtn.style.position = 'relative';
        bellBtn.appendChild(badge);
      }
      badge.setAttribute('aria-label',
        window.t('notifs.badge.aria').replace('{n}', String(unreadCount)));
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.style.transform = 'scale(1)';
    } else {
      if (badge) badge.remove();
    }
    
    // Toggle bell active state
    bellBtn.style.opacity = unreadCount > 0 ? '1' : '0.7';
  }

  function openNotificationPanel() {
    // Check if panel already exists
    let panel = document.getElementById('oros-notif-panel');
    if (panel) {
      // Close if already open
      panel.remove();
      updateBadge();
      return;
    }
    
    // Create panel — palette vars only (follows every skin)
    panel = document.createElement('div');
    panel.id = 'oros-notif-panel';
    panel.style.cssText = `
      position: fixed;
      top: 50px;
      right: 20px;
      width: 360px;
      max-height: 500px;
      background: var(--panel-bg);
      color: var(--text);
      border: 1px solid var(--accent);
      border-radius: 8px;
      z-index: 10001;
      overflow-y: auto;
      box-shadow: 0 8px 32px var(--shadow, rgba(0,0,0,0.5));
    `;
    
    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    header.innerHTML = `
      <span style="font-weight:600;">${escapeHtml(window.t('notifs.panel.title'))}</span>
      <button id="notif-clear-all" style="background:none; border:none; color:var(--text-dim); cursor:pointer;">${escapeHtml(window.t('notifs.clear'))}</button>
    `;
    panel.appendChild(header);
    
    // Items container FIRST (clear-all re-render targets THIS,
    // never the panel itself — otherwise the container duplicates)
    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'notif-items';
    itemsContainer.style.cssText = 'max-height: 400px; overflow-y: auto;';
    panel.appendChild(itemsContainer);
    
    // Clear all handler
    header.querySelector('#notif-clear-all').addEventListener('click', () => {
      state.slice.items.forEach(item => { if (!item.readAt) item.readAt = Date.now(); });
      noteChange();        // read state must travel
      saveSliceThrottled(200);
      renderPanelItems(itemsContainer);
      updateBadge();
    });
    
    // Render items
    renderPanelItems(itemsContainer);
    
    // Close on outside click
    const closeOutside = (e) => {
      if (!panel.contains(e.target)) {
        panel.remove();
        document.removeEventListener('click', closeOutside);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOutside), 0);
    
    document.body.appendChild(panel);
  }

  function renderPanelItems(container) {
    // .slice() — sort() mutates; the live slice must stay untouched
    // (pure-read doctrine, same lesson as fdSliceGet)
    const items = state.slice.items.slice().sort((a, b) => b.createdAt - a.createdAt);
    
    if (items.length === 0) {
      container.innerHTML =
        `<div style="padding:20px; text-align:center; color:var(--text-dim);">` +
        escapeHtml(window.t('notifs.empty')) + `</div>`;
      return;
    }
    
    container.innerHTML = '';
    items.forEach(item => {
      const el = document.createElement('div');
      el.style.cssText = `
        padding: 12px 16px;
        border-bottom: 1px solid var(--border);
        cursor: pointer;
        opacity: ${item.readAt ? '0.7' : '1'};
        background: ${item.readAt ? 'transparent' : 'var(--accent-soft, rgba(109,74,255,0.1))'};
      `;
      
      const timeStr = formatDate(item.firedAt || item.createdAt);
      
      el.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span style="font-weight:600;">${escapeHtml(item.title)}</span>
          <span style="color:var(--text-dim); font-size:0.85em;">${timeStr}</span>
        </div>
        <div style="opacity:0.9; font-size:0.95em;">${escapeHtml(item.body)}</div>
        ${!item.readAt ? `<div style="margin-top:8px; font-size:0.8em; color:var(--accent);">● ` +
          escapeHtml(window.t('notifs.unread')) + `</div>` : ''}
      `;
      
      el.addEventListener('click', () => {
        openTarget(item);        // real per-app bridges (A7 router)
        if (!item.readAt) {
          item.readAt = Date.now();
          noteChange();        // read state must travel
          saveSliceThrottled(200);
          renderPanelItems(container);
          updateBadge();
        }
      });
      
      container.appendChild(el);
    });
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);
    var loc = window.orosLang === 'el' ? 'el-GR' : 'en-GB';
    
    if (diffMin < 1) return window.t('notifs.justnow');
    if (diffMin < 60) return window.t('notifs.minago').replace('{n}', String(diffMin));
    if (diffHour < 24) return window.t('notifs.hourago').replace('{n}', String(diffHour));
    if (diffDay < 7) return window.t('notifs.dayago').replace('{n}', String(diffDay));
    
    return d.toLocaleDateString(loc, { day: '2-digit', month: 'short' });
  }
  
    // ===== SYNC SLICE — LWW PER-FIELD MERGE =====
  // Contract (shell.js reality): registerSlice(name, getFn, setFn).
  // Getter must be PURE (fdSliceGet lesson — no side effects).
  // Setter is pull-fed: NO markDirty inside (anti-loop contract).
  function notifSliceGet() {
    return state.slice;
  }

  function notifSliceSet(remote) {
    if (!remote || typeof remote !== 'object' ||
        !Array.isArray(remote.items)) return;

    var local = state.slice;

    // 1. Settings: LWW via settingsRev clock (non-null number wins;
    //    equal/missing → keep local — deterministic, zero surprise).
    var rRev = (typeof remote.settings === 'object' &&
                remote.settings !== null &&
                typeof remote.settings.settingsRev === 'number')
      ? remote.settings.settingsRev : -1;
    var lRev = (typeof local.settings.settingsRev === 'number')
      ? local.settings.settingsRev : -1;
    var settings = (rRev > lRev)
      ? remote.settings
      : (rRev === lRev && rRev > -1 && remote.settings) ? remote.settings
      : local.settings;

    // 2. App toggles: per-app LWW is impossible without per-toggle
    //    clocks — keep it honest: newer settingsRev owner wins WHOLE
    //    object (toggles are part of the settings universe).
    var appToggles = (rRev > lRev && remote.appToggles) ? remote.appToggles
                    : (local.appToggles) ? local.appToggles : {};

    // 3. Items: union by id, LWW per-field on the ONLY merge-sensitive
    //    field (readAt — non-null timestamp always beats null:
    //    "read" can never be undone by a stale unread replica).
    var byId = {};
    var i, it;
    for (i = 0; i < local.items.length; i++) {
      it = local.items[i];
      if (it && typeof it.id === 'string') byId[it.id] = it;
    }
    for (i = 0; i < remote.items.length; i++) {
      it = remote.items[i];
      if (!it || typeof it !== 'object' || typeof it.id !== 'string') continue;
      var mine = byId[it.id];
      if (!mine) { byId[it.id] = it; continue; }
      // Same logical item: merge the mutable fields, local-first for
      // display fields, LWW for readAt.
      var readAt = (typeof it.readAt === 'number' && it.readAt !== null)
        ? ((typeof mine.readAt === 'number' && mine.readAt !== null)
            ? Math.max(it.readAt, mine.readAt)   // both read → latest
            : it.readAt)                          // remote read, local not
        : ((typeof mine.readAt === 'number') ? mine.readAt : null);
      var firedAt = Math.max(
        (typeof mine.firedAt === 'number') ? mine.firedAt : 0,
        (typeof it.firedAt === 'number') ? it.firedAt : 0) || null;
      // Prefer whichever replica carries the richer payload.
      var base = (typeof mine.body === 'string') ? mine : it;
      byId[it.id] = {
        id: base.id, dedupKey: base.dedupKey, ns: base.ns, type: base.type,
        title: base.title, body: base.body, deepLink: base.deepLink,
        createdAt: Math.min(
          (typeof mine.createdAt === 'number') ? mine.createdAt : Infinity,
          (typeof it.createdAt === 'number') ? it.createdAt : Infinity),
        firedAt: firedAt, readAt: readAt, expiresAt: base.expiresAt || null
      };
    }

    var items = [];
    for (var k in byId) {
      if (Object.prototype.hasOwnProperty.call(byId, k)) items.push(byId[k]);
    }
    items.sort(function (a, b) { return b.createdAt - a.createdAt; });
    // Cap: keep the slice lean (matches the 7-day TTL doctrine;
    // a synced past can never balloon the slice).
    if (items.length > 300) items = items.slice(0, 300);

    state.slice = {
      ver: 1,
      settings: settings,
      appToggles: appToggles,
      items: items,
      meta: local.meta   // meta is device-local (never merge it)
    };
    // Pull-fed: save + repaint, deliberately NO noteChange().
    saveSliceNow();
    updateBadge();
    applyToastStyle();
  }
  
    // ===== PUBLIC API (exposed to apps) =====
  
  window.orosNotifs = {
    VERSION,
    
    // Settings
    getSetting,
    setSetting,
    getAppToggle,
    setAppToggle,
    
    // Triggers (for apps to register)
    registerTrigger,
    
    // Manual operations
    fireToast,
    markAsRead,
    openNotificationPanel,
    updateBadge,
    
    // Direct access (for debugging)
    getState: () => state,
    getSlice: () => state.slice
  };

  // ===== INITIALIZATION =====

  function init() {
    // Wait for the sync engine (shell loads sync.js first; verified
    // contract: window.orosSync.registerSlice(name, getFn, setFn))
    if (!window.orosSync || typeof window.orosSync.registerSlice !== 'function') {
      setTimeout(init, 100);
      return;
    }

    // Load slice from localStorage
    loadSlice();

    // Register sync slice — engine encrypts the payload in transit
    // (AES-GCM inside sync.js), the local cache is plaintext
    // same-trust-zone as every other slice.
    window.orosSync.registerSlice('notifs', notifSliceGet, notifSliceSet);

    // Visibility change hook (mobile catch-up)
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Taskbar bell
    ensureTaskbarBell();

    // Boot sweep
    state.ready = true;
    bootSweep();

    // NO setInterval(60000) — shell doctrine: "no idle timers".
    // The 60s sweep piggybacks the shell's 1s clock tick via
    // notifTickThrottled() (added in renderClock by the shell patch).
    // Until that patch is applied, the visibility hook alone keeps
    // sweeps alive (boot + every tab-visible).
    applyToastStyle();
    log(`Module v${VERSION} initialized`);
  }

  // Exposed for the shell's renderClock piggyback (calRemTick
  // precedent): called every 1s, self-throttles to 60s. Cheap:
  // timestamp compare only, the heavy scan sits behind the gate.
  window.orosNotifs.tick = function () {
    var now = Date.now();
    if (now - (state._lastTick || 0) < 60000) return;
    state._lastTick = now;
    scheduledSweep();
  };

  function ensureTaskbarBell() {
    // Check if bell already exists
    if (document.getElementById('oros-taskbar-bell')) {
      updateBadge();
      return;
    }
    
    // VERIFIED shell reality (index.html): the taskbar tray is
    // ".bar-right" — static buttons are #btn-lang, #bar-time,
    // #bar-date. There is NO #oros-taskbar and NO #oros-clock.
    var bar = document.querySelector('.bar-right');
    if (!bar) {
      setTimeout(ensureTaskbarBell, 100);   // shell hasn't painted yet
      return;
    }
    
    // Inline SVG bell (orOS doctrine: no emoji icons, no icon fonts)
    var BELL_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    
    var bellBtn = document.createElement('button');
    bellBtn.id = 'oros-taskbar-bell';
    bellBtn.type = 'button';
    bellBtn.innerHTML = BELL_SVG;
    bellBtn.setAttribute('aria-label', window.t('notifs.title'));
    bellBtn.style.cssText =
      'background:none;border:none;color:var(--text);cursor:pointer;' +
      'position:relative;display:flex;align-items:center;justify-content:center;' +
      'width:34px;height:34px;flex-shrink:0;';
    
    bellBtn.addEventListener('click', function (e) {
      e.stopPropagation();   // never falls through to the outside-close handler
      openNotificationPanel();
    });
    
    // Insert before #btn-lang (JS-injected widgets like the sync dot
    // sit even earlier — final order: sync-dot, bell, lang, time, date)
    var lang = document.getElementById('btn-lang');
    if (lang && lang.parentNode === bar) {
      bar.insertBefore(bellBtn, lang);
    } else {
      bar.appendChild(bellBtn);
    }
    
    updateBadge();
  }

  // Kickoff initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Clean shutdown on page unload — saveSliceThrottled(0) was a
  // setTimeout(0) that never ran before the page died. Flush NOW.
  window.addEventListener('beforeunload', () => {
    saveSliceNow();
  });
})();