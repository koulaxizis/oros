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

  const TOAST_STYLES = {
    oros: { border: '#6d4aff', borderRadius: 8, padding: '12px 16px', bg: 'rgba(18,18,20,0.95)' },
    dunst: { border: '#fff', borderRadius: 4, padding: '10px 14px', bg: 'rgba(15,15,17,0.98)', fontWeight: 400 },
    plasma: { border: '#6d4aff', borderRadius: 12, padding: '14px 18px', bg: 'rgba(20,20,22,0.97)', fontWeight: 600 },
    gnome: { border: '#6d4aff', borderRadius: 12, padding: '16px 20px', bg: 'rgba(18,18,20,0.95)', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }
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
    gain.gain.setValueAtTime(state.settings?.soundVolume ?? 0.7, now);
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
      quietHours: { enabled: false, from: '22:00', quietHoursStart: 22, to: '08:00', quietHoursEnd: 8 }
    };
  }

  function saveSliceThrottled(delay = 1000) {
    clearTimeout(state._saveTimer);
    state._saveTimer = setTimeout(() => {
      try {
        localStorage.setItem('oros-notifs', JSON.stringify(state.slice));
        state.meta.lastSyncPush = Date.now();
      } catch (e) {
        err('Failed to save slice', e);
      }
    }, delay);
  }

  function getSetting(key, defaultVal) {
    return state.slice?.settings?.[key] ?? defaultVal;
  }

  function setSetting(key, value) {
    if (!state.slice.settings) state.slice.settings = defaultSettings();
    state.slice.settings[key] = value;
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
    
    // Apply style inline (CSS classes would be better but we're keeping it simple)
    Object.assign(toast.style, {
      position: 'fixed',
      zIndex: 10000,
      maxWidth: '400px',
      backgroundColor: style.bg,
      border: `2px solid ${style.border}`,
      borderRadius: `${style.borderRadius}px`,
      padding: style.padding,
      fontFamily: 'Nunito, sans-serif',
      color: '#fff',
      cursor: 'pointer',
      opacity: '0',
      transition: 'opacity 0.3s ease',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
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
        <button class="notif-dismiss" aria-label="Dismiss" 
          style="background:none; border:none; color:#fff; font-size:1.2em; cursor:pointer; padding:0 0 0 12px; line-height:1;">✕</button>
      </div>
    `;
    
    // Click → deep link
    toast.addEventListener('click', (e) => {
      if (e.target.classList.contains('notif-dismiss')) return;
      if (item.deepLink) {
        window.__orosOpenX?.(item.deepLink);
      }
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
      saveSliceThrottled(200);
      updateBadge();
    }
  }

  // ===== BADGE LOGIC — TASKBAR INTEGRATION =====

  function updateBadge() {
    const unreadCount = state.slice.items.filter(i => !i.readAt).length;
    
    // Find taskbar bell element (created by shell.js)
    const bellBtn = document.getElementById('oros-taskbar-bell');
    if (!bellBtn) return;
    
    let badge = bellBtn.querySelector('.notif-badge');
    
    if (unreadCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'notif-badge';
        badge.setAttribute('aria-label', `${unreadCount} unread notifications`);
        badge.style.cssText = `
          position: absolute;
          top: -4px;
          right: -4px;
          min-width: 16px;
          height: 16px;
          background: #6d4aff;
          color: #fff;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 4px;
          transition: transform 0.2s ease;
        `;
        bellBtn.style.position = 'relative';
        bellBtn.appendChild(badge);
      }
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
    
    // Create panel
    panel = document.createElement('div');
    panel.id = 'oros-notif-panel';
    panel.style.cssText = `
      position: fixed;
      top: 50px;
      right: 20px;
      width: 360px;
      max-height: 500px;
      background: rgba(18,18,20,0.98);
      border: 1px solid #6d4aff;
      border-radius: 8px;
      z-index: 10001;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `;
    
    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 12px 16px;
      border-bottom: 1px solid #333;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    header.innerHTML = `
      <span style="font-weight:600;">Notifications</span>
      <button id="notif-clear-all" style="background:none; border:none; color:#888; cursor:pointer;">Clear all</button>
    `;
    panel.appendChild(header);
    
    // Clear all handler
    header.querySelector('#notif-clear-all').addEventListener('click', () => {
      state.slice.items.forEach(item => { if (!item.readAt) item.readAt = Date.now(); });
      saveSliceThrottled(200);
      renderPanelItems(panel);
      updateBadge();
    });
    
    // Items container
    const itemsContainer = document.createElement('div');
    itemsContainer.style.cssText = 'max-height: 400px; overflow-y: auto;';
    panel.appendChild(itemsContainer);
    
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
    const items = state.slice.items.sort((a, b) => b.createdAt - a.createdAt);
    const unreadCount = items.filter(i => !i.readAt).length;
    
    if (items.length === 0) {
      container.innerHTML = `<div style="padding:20px; text-align:center; color:#666;">No notifications</div>`;
      return;
    }
    
    container.innerHTML = '';
    items.forEach(item => {
      const el = document.createElement('div');
      el.style.cssText = `
        padding: 12px 16px;
        border-bottom: 1px solid #222;
        cursor: pointer;
        opacity: ${item.readAt ? '0.7' : '1'};
        background: ${item.readAt ? 'transparent' : 'rgba(109,74,255,0.1)'};
      `;
      
      const timeStr = formatDate(item.firedAt || item.createdAt);
      
      el.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span style="font-weight:600;">${escapeHtml(item.title)}</span>
          <span style="color:#666; font-size:0.85em;">${timeStr}</span>
        </div>
        <div style="opacity:0.9; font-size:0.95em;">${escapeHtml(item.body)}</div>
        ${!item.readAt ? '<div style="margin-top:8px; font-size:0.8em; color:#6d4aff;">● Unread</div>' : ''}
      `;
      
      el.addEventListener('click', () => {
        if (item.deepLink) {
          window.__orosOpenX?.(item.deepLink);
        }
        if (!item.readAt) {
          item.readAt = Date.now();
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
    
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    
    return d.toLocaleDateString();
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
    
    // Find taskbar container (assumes shell creates #oros-taskbar)
    const taskbar = document.getElementById('oros-taskbar');
    if (!taskbar) {
      // Try again in 100ms
      setTimeout(ensureTaskbarBell, 100);
      return;
    }
    
    // Create bell button
    const bellBtn = document.createElement('button');
    bellBtn.id = 'oros-taskbar-bell';
    bellBtn.className = 'taskbar-btn';
    bellBtn.setAttribute('aria-label', 'Notifications');
    bellBtn.innerHTML = '🔔';
    bellBtn.style.cssText = `
      background: none;
      border: none;
      color: #fff;
      font-size: 1.2em;
      cursor: pointer;
      padding: 8px 12px;
      position: relative;
    `;
    
    bellBtn.addEventListener('click', () => {
      openNotificationPanel();
    });
    
    // Insert bell before the clock (assuming clock has ID #oros-clock)
    const clock = document.getElementById('oros-clock');
    if (clock && clock.parentNode) {
      clock.parentNode.insertBefore(bellBtn, clock);
    } else {
      taskbar.appendChild(bellBtn);
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