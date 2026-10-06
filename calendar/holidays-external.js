// ===== HOLIDAYS EXTERNAL FETCHER MODULE =====
// orOS Calendar — External Holidays Integration (Opt-In Only)
// Version: 1.0.0
// Author: Christos Koulaxizis
// License: MIT

(function() {
  'use strict';

  const EXTERNAL_HOLIDAYS = Object.freeze({
    CACHE_KEY: 'oros-calendar-external-holidays',
    ENABLED_KEY: 'oros-calendar-holidays-enabled',
    TTL_MS: 7 * 24 * 60 * 60 * 1000, // 7 ημέρες
    SOURCES: {
      NAGER_DATE: 'https://date.nager.at/api/v3/PublicHolidays/{year}/GR',
      NAMEDAYS: 'https://greek-namedays.herokuapp.com/api/{year}',
      WORLD_DAYS: 'https://holidays.oros.online/worlddays.json?v='
    }
  });

  class ExternalHolidayFetcher {
    constructor() {
      this.enabled = localStorage.getItem(EXTERNAL_HOLIDAYS.ENABLED_KEY) === 'true';
      this.cache = null;
      this.events = [];
    }

    /**
     * Initialize the module
     */
    async init() {
      if (!this.enabled) {
        console.log('[orOS] External holidays: disabled by user');
        return;
      }

      // Load cached data
      this.cache = this.loadCache();
      
      if (this.cache && !this.isExpired(this.cache.timestamp)) {
        console.log('[orOS] External holidays: using cached data');
        this.events = this.cache.data;
        this.emitReady();
        return;
      }

      // Fetch fresh data
      console.log('[orOS] External holidays: fetching from sources...');
      await this.fetchAndStore();
      this.emitReady();
    }

    /**
     * Load cached data from localStorage
     */
    loadCache() {
      try {
        const raw = localStorage.getItem(EXTERNAL_HOLIDAYS.CACHE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (err) {
        console.warn('[orOS] Failed to parse holidays cache:', err);
        return null;
      }
    }

    /**
     * Save data to cache
     */
    saveCache(data) {
      try {
        const cached = {
          timestamp: Date.now(),
          data: data
        };
        localStorage.setItem(EXTERNAL_HOLIDAYS.CACHE_KEY, JSON.stringify(cached));
        console.log('[orOS] External holidays: cache saved');
      } catch (err) {
        console.error('[orOS] Failed to save holidays cache:', err);
      }
    }

    /**
     * Check if cache is expired
     */
    isExpired(timestamp) {
      return (Date.now() - timestamp) > EXTERNAL_HOLIDAYS.TTL_MS;
    }

    /**
     * Clear cache
     */
    clearCache() {
      localStorage.removeItem(EXTERNAL_HOLIDAYS.CACHE_KEY);
      this.cache = null;
      this.events = [];
      console.log('[orOS] External holidays: cache cleared');
    }

    /**
     * Toggle enabled state
     */
    toggle(state) {
      this.enabled = !!state;
      localStorage.setItem(EXTERNAL_HOLIDAYS.ENABLED_KEY, this.enabled ? 'true' : 'false');
      
      if (this.enabled) {
        this.init();
        return 'enabled';
      } else {
        this.clearCache();
        this.events = [];
        this.emitCleared();
        return 'disabled';
      }
    }

    /**
     * Force refresh (re-fetch regardless of cache age)
     */
    async forceRefresh() {
      if (!this.enabled) return false;
      this.clearCache();
      await this.fetchAndStore();
      this.emitReady();
      return true;
    }

    /**
     * Get current year
     */
    getYear() {
      return new Date().getFullYear();
    }

    /**
     * Fetch all external data sources
     */
    async fetchAndStore() {
      try {
        const year = this.getYear();
        
        const [grHolidays, namedays, worldDays] = await Promise.allSettled([
          fetch(EXTERNAL_HOLIDAYS.SOURCES.NAGER_DATE.replace('{year}', year))
            .then(r => r.ok ? r.json() : []),
          fetch(EXTERNAL_HOLIDAYS.SOURCES.NAMEDAYS.replace('{year}', year))
            .then(r => r.ok ? r.json() : []),
          fetch(EXTERNAL_HOLIDAYS.SOURCES.WORLD_DAYS + APP_VERSION)
            .then(r => r.ok ? r.json() : [])
        ]);

        const allEvents = [];

        // Process Greek public holidays
        if (grHolidays.status === 'fulfilled' && Array.isArray(grHolidays.value)) {
          grHolidays.value.forEach(h => {
            allEvents.push({
              date: h.date,
              label: h.name,
              type: 'national',
              source: 'nager.date',
              localName: h.localName || h.name,
              fixed: !h.movable
            });
          });
        }

        // Process Greek namedays
        if (namedays.status === 'fulfilled' && Array.isArray(namedays.value)) {
          namedays.value.forEach(entry => {
            // Entry format: { date: 'YYYY-MM-DD', names: ['Name1', 'Name2', ...] }
            if (entry.date && Array.isArray(entry.names)) {
              entry.names.forEach(name => {
                allEvents.push({
                  date: entry.date,
                  label: name.trim(),
                  type: 'nameday',
                  source: 'namedays-api',
                  fullLabel: `${name} (ονομαστική)`
                });
              });
            }
          });
        }

        // Process world days (custom curated list)
        if (worldDays.status === 'fulfilled' && Array.isArray(worldDays.value)) {
          worldDays.value.forEach(day => {
            allEvents.push({
              date: day.date,
              label: day.name,
              type: 'worldday',
              source: 'oras-worlddays',
              description: day.description || '',
              emoji: day.emoji || ''
            });
          });
        }

        // Sort by date
        allEvents.sort((a, b) => a.date.localeCompare(b.date));

        this.events = allEvents;
        this.saveCache(allEvents);
        
        console.log(`[orOS] External holidays: ${allEvents.length} events fetched`);
      } catch (err) {
        console.error('[orOS] External holidays: fetch failed:', err);
      }
    }

    /**
     * Get merged events for current year
     */
    getEvents(options = {}) {
      const { 
        startDate = null, 
        endDate = null,
        types = null 
      } = options;

      let filtered = [...this.events];

      // Filter by type if specified
      if (types && Array.isArray(types) && types.length > 0) {
        filtered = filtered.filter(e => types.includes(e.type));
      }

      // Filter by date range if specified
      if (startDate) {
        filtered = filtered.filter(e => e.date >= startDate);
      }
      if (endDate) {
        filtered = filtered.filter(e => e.date <= endDate);
      }

      return filtered;
    }

    /**
     * Get events for a specific date
     */
    getEventsForDate(dateStr) {
      return this.events.filter(e => e.date === dateStr);
    }

    /**
     * Emit event when ready
     */
    emitReady() {
      window.dispatchEvent(new CustomEvent('orOS:holidays:ready', {
        detail: { count: this.events.length, enabled: this.enabled }
      }));
    }

    /**
     * Emit event when cleared
     */
    emitCleared() {
      window.dispatchEvent(new CustomEvent('orOS:holidays:cleared'));
    }

    /**
     * Get status for UI
     */
    getStatus() {
      const cached = this.loadCache();
      return {
        enabled: this.enabled,
        hasData: this.events.length > 0,
        eventCount: this.events.length,
        lastUpdated: cached ? new Date(cached.timestamp) : null,
        expiresAt: cached ? new Date(cached.timestamp + EXTERNAL_HOLIDAYS.TTL_MS) : null,
        isExpired: cached ? this.isExpired(cached.timestamp) : true
      };
    }
  }

  // Export to global scope
  window.orosExternalHolidays = new ExternalHolidayFetcher();

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.orosExternalHolidays.init());
  } else {
    window.orosExternalHolidays.init();
  }

})();