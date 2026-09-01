// ============================================
// orOS Habit Tracker — Full Implementation
// Privacy-first habit tracking with streaks & stats
// ============================================

(function() {
  'use strict';

  // ===== CONSTANTS =====
  var STORAGE_KEY = 'oros_habits_data';
  var SETTINGS_KEY = 'oros_habits_settings';

  var HABIT_ICONS = [
    'fa-check', 'fa-star', 'fa-heart', 'fa-fire',
    'fa-book', 'fa-pencil', 'fa-music', 'fa-lightbulb-o',
    'fa-bullseye', 'fa-clock-o', 'fa-sun-o', 'fa-moon-o',
    'fa-trophy', 'fa-leaf', 'fa-bolt', 'fa-rocket',
    'fa-coffee', 'fa-dumbbell', 'fa-water', 'fa-bed',
    'fa-running', 'fa-apple-whole', 'fa-brain', 'fa-spa'
  ];

  var HABIT_COLORS = [
    '#c8a96e', '#e57373', '#81c784', '#64b5f6',
    '#ba68c8', '#4dd0e1', '#ffb74d', '#a1887f',
    '#90a4ae', '#f06292', '#7986cb', '#aed581'
  ];

  var DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // ===== STATE =====
  var habits = [];
  var settings = {
    weekStartMonday: false,
    confirmDelete: true
  };
  var currentView = 'list';
  var currentPeriod = new Date();
  var editingHabitId = null;

  // ===== DOM ELEMENTS =====
  var habitsList = document.getElementById('habits-list');
  var emptyState = document.getElementById('empty-state');
  var listView = document.getElementById('list-view');
  var calendarView = document.getElementById('calendar-view');
  var statsView = document.getElementById('stats-view');
  var calendarContainer = document.getElementById('calendar-container');
  var statsOverall = document.getElementById('stats-overall');
  var statsPerHabit = document.getElementById('stats-per-habit');
  var periodLabel = document.getElementById('period-label');

  // Dialogs
  var habitDialog = document.getElementById('habit-dialog-overlay');
  var habitSettingsDialog = document.getElementById('habit-settings-overlay');
  var helpDialog = document.getElementById('help-dialog-overlay');

  // ===== HELPER FUNCTIONS =====

  function getCurrentLang() {
    return localStorage.getItem('oros-language') || 'en';
  }

  function getTrans(key) {
    var lang = getCurrentLang();
    var t = (window.OROS_TRANSLATIONS && window.OROS_TRANSLATIONS[lang]) || {};
    return t[key] || key;
  }

  function showToast(message) {
    var toast = document.getElementById('zen-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'zen-toast';
      toast.className = 'zentool-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = '';
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() {
      toast.classList.remove('visible');
    }, 3000);
  }

  function dateKey(date) {
    var d = new Date(date);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function todayKey() {
    return dateKey(new Date());
  }

  function isSameDay(date1, date2) {
    return dateKey(date1) === dateKey(date2);
  }

  function addDays(date, days) {
    var d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function getWeekStart(date) {
    var d = new Date(date);
    var day = d.getDay();
    if (settings.weekStartMonday) {
      var diff = day === 0 ? -6 : 1 - day;
    } else {
      var diff = 0 - day;
    }
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function getWeekDays(date) {
    var start = getWeekStart(date);
    var days = [];
    for (var i = 0; i < 7; i++) {
      days.push(addDays(start, i));
    }
    return days;
  }

  function getMonthMatrix(date) {
    var year = date.getFullYear();
    var month = date.getMonth();
    var first = new Date(year, month, 1);
    var startDay = first.getDay();
    if (settings.weekStartMonday) {
      startDay = startDay === 0 ? 6 : startDay - 1;
    }
    var startDate = addDays(first, -startDay);
    var weeks = [];
    for (var w = 0; w < 6; w++) {
      var week = [];
      for (var d = 0; d < 7; d++) {
        week.push(addDays(startDate, w * 7 + d));
      }
      weeks.push(week);
    }
    return weeks;
  }

  function isHabitScheduledOn(habit, date) {
    if (habit.frequency === 'daily') return true;
    if (habit.frequency === 'weekly') return true;
    if (habit.frequency === 'custom') {
      return habit.customDays && habit.customDays.indexOf(date.getDay()) !== -1;
    }
    return true;
  }

  function isHabitCompletedOn(habit, date) {
    var key = dateKey(date);
    return habit.completions && habit.completions.indexOf(key) !== -1;
  }

  function toggleCompletion(habitId, date) {
    for (var i = 0; i < habits.length; i++) {
      if (habits[i].id === habitId) {
        var habit = habits[i];
        if (!habit.completions) habit.completions = [];
        if (!isHabitScheduledOn(habit, date)) return;
        var key = dateKey(date);
        var idx = habit.completions.indexOf(key);
        if (idx === -1) {
          habit.completions.push(key);
        } else {
          habit.completions.splice(idx, 1);
        }
        saveData();
        return;
      }
    }
  }

  // ===== STREAK CALCULATION =====

  function calculateStreak(habit) {
    if (!habit.completions || habit.completions.length === 0) return 0;
    var streak = 0;
    var date = new Date();
    date.setHours(0, 0, 0, 0);

    // If today isn't completed, start from yesterday
    if (!isHabitCompletedOn(habit, date)) {
      date = addDays(date, -1);
    }

    while (true) {
      if (isHabitCompletedOn(habit, date)) {
        streak++;
        date = addDays(date, -1);
      } else if (isHabitScheduledOn(habit, date)) {
        break;
      } else {
        // Not scheduled — skip this day, continue
        date = addDays(date, -1);
      }
      // Safety limit
      if (streak > 3650) break;
    }
    return streak;
  }

  function calculateLongestStreak(habit) {
    if (!habit.completions || habit.completions.length === 0) return 0;
    var sorted = habit.completions.slice().sort();
    var longest = 0;
    var current = 0;
    var prevDate = null;

    for (var i = 0; i < sorted.length; i++) {
      var d = new Date(sorted[i] + 'T00:00:00');
      if (prevDate) {
        var diff = Math.round((d - prevDate) / (1000 * 60 * 60 * 24));
        if (diff === 1) {
          current++;
        } else {
          if (current > longest) longest = current;
          current = 1;
        }
      } else {
        current = 1;
      }
      prevDate = d;
    }
    if (current > longest) longest = current;
    return longest;
  }

  function calculateCompletionRate(habit, days) {
    if (!habit.completions) return 0;
    var count = 0;
    var scheduled = 0;
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    for (var i = 0; i < days; i++) {
      var d = addDays(today, -i);
      if (isHabitScheduledOn(habit, d)) {
        scheduled++;
        if (isHabitCompletedOn(habit, d)) count++;
      }
    }
    return scheduled > 0 ? Math.round((count / scheduled) * 100) : 0;
  }

  // ===== STORAGE =====

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
    } catch(e) {
      console.warn('Failed to save habits:', e);
    }
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        habits = JSON.parse(raw);
      }
    } catch(e) {
      console.warn('Failed to load habits:', e);
      habits = [];
    }

    try {
      var rawSettings = localStorage.getItem(SETTINGS_KEY);
      if (rawSettings) {
        var parsed = JSON.parse(rawSettings);
        if (parsed.weekStartMonday !== undefined) settings.weekStartMonday = parsed.weekStartMonday;
        if (parsed.confirmDelete !== undefined) settings.confirmDelete = parsed.confirmDelete;
      }
    } catch(e) {}
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // ============================================
  // RENDERING — LIST VIEW
  // ============================================

  function renderListView() {
    if (habits.length === 0) {
      emptyState.style.display = 'flex';
      habitsList.querySelectorAll('.habit-row').forEach(function(el) { el.remove(); });
      return;
    }

    emptyState.style.display = 'none';

    // Clear existing rows (except empty state)
    habitsList.querySelectorAll('.habit-row').forEach(function(el) { el.remove(); });

    var weekDays = getWeekDays(currentPeriod);
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var dayLabels = settings.weekStartMonday
      ? ['M', 'T', 'W', 'T', 'F', 'S', 'S']
      : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    for (var i = 0; i < habits.length; i++) {
      var habit = habits[i];
      var streak = calculateStreak(habit);
      var freqLabel = habit.frequency === 'daily' ? getTrans('freq_daily')
        : habit.frequency === 'weekly' ? getTrans('freq_weekly')
        : getTrans('freq_custom');

      var row = document.createElement('div');
      row.className = 'habit-row';

      // Icon
      var iconBox = document.createElement('div');
      iconBox.className = 'habit-icon-box';
      iconBox.style.background = habit.color + '22';
      iconBox.innerHTML = '<i class="fa ' + (habit.icon || 'fa-check') + '" style="color:' + habit.color + '"></i>';
      row.appendChild(iconBox);

      // Info
      var info = document.createElement('div');
      info.className = 'habit-info';
      info.innerHTML =
        '<div class="habit-name">' + escapeHtml(habit.name) + '</div>' +
        '<div class="habit-meta">' +
          '<span class="habit-streak"><i class="fa fa-fire"></i> <span class="habit-streak-value">' + streak + '</span></span>' +
          '<span class="habit-frequency-badge">' + freqLabel + '</span>' +
        '</div>';
      row.appendChild(info);

      // Week dots
      var dotsContainer = document.createElement('div');
      dotsContainer.className = 'habit-week-dots';

      for (var d = 0; d < 7; d++) {
        (function(dayDate, dayIdx) {
          var dot = document.createElement('div');
          dot.className = 'week-dot';
          dot.textContent = dayLabels[dayIdx];

          var scheduled = isHabitScheduledOn(habit, dayDate);
          var completed = isHabitCompletedOn(habit, dayDate);
          var isToday = isSameDay(dayDate, today);

          if (completed) dot.classList.add('completed');
          if (isToday) dot.classList.add('today');
          if (scheduled) dot.classList.add('scheduled');
          if (!scheduled) dot.classList.add('not-scheduled');

          if (scheduled) {
            dot.addEventListener('click', function() {
              toggleCompletion(habit.id, dayDate);
              renderCurrentView();
            });
          }

          dotsContainer.appendChild(dot);
        })(weekDays[d], d);
      }

      row.appendChild(dotsContainer);

      // Settings button
      var actions = document.createElement('div');
      actions.className = 'habit-actions';
      var settingsBtn = document.createElement('button');
      settingsBtn.className = 'action-btn';
      settingsBtn.style.width = '28px';
      settingsBtn.style.height = '28px';
      settingsBtn.style.fontSize = '13px';
      settingsBtn.innerHTML = '<i class="fa fa-cog"></i>';
      settingsBtn.addEventListener('click', function() {
        openHabitSettings(habit.id);
      });
      actions.appendChild(settingsBtn);
      row.appendChild(actions);

      habitsList.appendChild(row);
    }
  }

  // ============================================
  // RENDERING — CALENDAR VIEW
  // ============================================

  function renderCalendarView() {
    var year = currentPeriod.getFullYear();
    var month = currentPeriod.getMonth();
    var monthMatrix = getMonthMatrix(currentPeriod);
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var dayLabels = settings.weekStartMonday
      ? [getTrans('day_mon'), getTrans('day_tue'), getTrans('day_wed'), getTrans('day_thu'), getTrans('day_fri'), getTrans('day_sat'), getTrans('day_sun')]
      : [getTrans('day_sun'), getTrans('day_mon'), getTrans('day_tue'), getTrans('day_wed'), getTrans('day_thu'), getTrans('day_fri'), getTrans('day_sat')];

    var html = '<div class="calendar-header">' +
      '<span class="calendar-title">' + MONTH_NAMES[month] + ' ' + year + '</span>' +
      '</div>';

    html += '<div class="calendar-grid">';

    // Header row
    html += '<div class="cal-cell cal-header"></div>';
    for (var h = 0; h < 7; h++) {
      html += '<div class="cal-cell cal-header">' + dayLabels[h].substring(0, 3) + '</div>';
    }

    // Habit rows
    if (habits.length === 0) {
      html += '<div class="cal-cell" style="grid-column: 1 / -1; padding: 2rem; color: var(--text-muted); font-style: italic;">' + getTrans('habits_empty_title') + '</div>';
    } else {
      for (var hi = 0; hi < habits.length; hi++) {
        var habit = habits[hi];
        html += '<div class="cal-cell cal-habit-name" style="border-left: 3px solid ' + habit.color + '">' +
          '<i class="fa ' + (habit.icon || 'fa-check') + '" style="color:' + habit.color + '"></i>' +
          '<span>' + escapeHtml(habit.name) + '</span></div>';

        // Flatten month matrix
        var flatDays = [];
        for (var w = 0; w < monthMatrix.length; w++) {
          for (var dd = 0; dd < monthMatrix[w].length; dd++) {
            flatDays.push(monthMatrix[w][dd]);
          }
        }

        for (var di = 0; di < flatDays.length; di++) {
          var dayDate = flatDays[di];
          var inMonth = dayDate.getMonth() === month;
          var scheduled = isHabitScheduledOn(habit, dayDate);
          var completed = isHabitCompletedOn(habit, dayDate);
          var isToday = isSameDay(dayDate, today);

          var classes = 'cal-cell cal-day';
          if (!inMonth) classes += ' not-in-month';
          if (completed) classes += ' completed';
          if (!scheduled) classes += ' not-scheduled';
          if (isToday) classes += ' today';

          var inner = '';
          if (dayDate.getDate() === 1 || di % 7 === 0) {
            // Show date number on first week column or first of month
          }
          if (completed) {
            inner = '<i class="fa fa-check cal-check"></i>';
          }

          // Only make clickable if scheduled and in current month
          var onclick = (scheduled && inMonth) ? 'data-habit-id="' + habit.id + '" data-date="' + dateKey(dayDate) + '"' : '';

          html += '<div class="' + classes + '" ' + onclick + '>' + inner + '</div>';
        }
      }
    }

    html += '</div>';

    calendarContainer.innerHTML = html;

    // Attach click handlers
    var dayCells = calendarContainer.querySelectorAll('.cal-day[data-habit-id]');
    dayCells.forEach(function(cell) {
      cell.addEventListener('click', function() {
        var habitId = this.getAttribute('data-habit-id');
        var dateStr = this.getAttribute('data-date');
        toggleCompletion(habitId, new Date(dateStr + 'T00:00:00'));
        renderCurrentView();
      });
    });
  }

  // ============================================
  // RENDERING — STATS VIEW
  // ============================================

  function renderStatsView() {
    var totalCompletions = 0;
    var totalScheduled = 0;
    var longestStreakOverall = 0;
    var activeHabits = habits.length;
    var completedToday = 0;

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate stats for last 30 days
    for (var h = 0; h < habits.length; h++) {
      var habit = habits[h];
      var habitLongest = calculateLongestStreak(habit);
      if (habitLongest > longestStreakOverall) longestStreakOverall = habitLongest;
      totalCompletions += habit.completions ? habit.completions.length : 0;

      // Scheduled in last 30 days
      for (var d = 0; d < 30; d++) {
        var date = addDays(today, -d);
        if (isHabitScheduledOn(habit, date)) {
          totalScheduled++;
          if (isHabitCompletedOn(habit, date)) {
            // counted in completions
          }
        }
      }

      // Completed today
      if (isHabitCompletedOn(habit, today)) completedToday++;
    }

    var overallRate = totalScheduled > 0 ? Math.round((totalCompletions / totalScheduled) * 100) : 0;

    // Overall stats
    var overallHtml = '';
    overallHtml += statCard(completedToday + '/' + activeHabits, getTrans('stats_done_today'));
    overallHtml += statCard(longestStreakOverall, getTrans('stats_longest_streak'));
    overallHtml += statCard(totalCompletions, getTrans('stats_total_completions'));
    overallHtml += statCard(activeHabits, getTrans('stats_active_habits'));
    statsOverall.innerHTML = overallHtml;

    // Per-habit stats
    var perHtml = '';
    for (var i = 0; i < habits.length; i++) {
      var hb = habits[i];
      var currentStreak = calculateStreak(hb);
      var longest = calculateLongestStreak(hb);
      var rate30 = calculateCompletionRate(hb, 30);
      var rate7 = calculateCompletionRate(hb, 7);
      var totalDone = hb.completions ? hb.completions.length : 0;

      perHtml += '<div class="habit-stat-row">' +
        '<div class="habit-icon-box" style="background:' + hb.color + '22">' +
          '<i class="fa ' + (hb.icon || 'fa-check') + '" style="color:' + hb.color + '"></i>' +
        '</div>' +
        '<div class="habit-stat-info">' +
          '<div class="habit-stat-name">' + escapeHtml(hb.name) + '</div>' +
          '<div class="habit-stat-details">' +
            '<span class="habit-stat-item"><i class="fa fa-fire" style="color:var(--accent-gold);font-size:11px"></i> <strong>' + currentStreak + '</strong> ' + getTrans('stats_current_streak') + '</span>' +
            '<span class="habit-stat-item"><strong>' + longest + '</strong> ' + getTrans('stats_best_streak') + '</span>' +
            '<span class="habit-stat-item"><strong>' + totalDone + '</strong> ' + getTrans('stats_total_completions') + '</span>' +
            '<span class="habit-stat-item"><strong>' + rate7 + '%</strong> ' + getTrans('stats_7_day_rate') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="habit-completion-bar"><div class="habit-completion-fill" style="width:' + rate30 + '%"></div></div>' +
        '<span class="habit-completion-pct">' + rate30 + '%</span>' +
      '</div>';
    }

    if (habits.length === 0) {
      perHtml = '<div style="text-align:center;padding:2rem;color:var(--text-muted);font-style:italic;">' + getTrans('habits_empty_title') + '</div>';
    }

    statsPerHabit.innerHTML = perHtml;
  }

  function statCard(value, label) {
    return '<div class="stat-card">' +
      '<div class="stat-card-value">' + value + '</div>' +
      '<div class="stat-card-label">' + label + '</div>' +
    '</div>';
  }

  // ============================================
  // VIEW MANAGEMENT
  // ============================================

  function renderCurrentView() {
    if (currentView === 'list') renderListView();
    else if (currentView === 'calendar') renderCalendarView();
    else if (currentView === 'stats') renderStatsView();
  }

  function switchView(view) {
    currentView = view;
    listView.style.display = view === 'list' ? 'block' : 'none';
    calendarView.style.display = view === 'calendar' ? 'block' : 'none';
    statsView.style.display = view === 'stats' ? 'block' : 'none';

    // Update view toggle buttons
    var viewBtns = document.querySelectorAll('.view-btn');
    viewBtns.forEach(function(btn) {
      btn.classList.toggle('active', btn.getAttribute('data-view') === view);
    });

    // Show/hide period selector
    var periodSelector = document.getElementById('period-selector');
    if (periodSelector) {
      periodSelector.style.display = view === 'stats' ? 'none' : 'inline-flex';
    }

    updatePeriodLabel();
    renderCurrentView();
  }

  function updatePeriodLabel() {
    if (!periodLabel) return;
    var lang = getCurrentLang();
    if (currentView === 'calendar') {
      periodLabel.textContent = MONTH_NAMES[currentPeriod.getMonth()] + ' ' + currentPeriod.getFullYear();
    } else {
      var weekStart = getWeekStart(currentPeriod);
      var weekEnd = addDays(weekStart, 6);
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      var thisWeekStart = getWeekStart(today);

      if (dateKey(weekStart) === dateKey(thisWeekStart)) {
        periodLabel.textContent = lang === 'el' ? 'Αυτή την εβδομάδα' : 'This Week';
      } else {
        var startStr = weekStart.getDate() + ' ' + MONTH_NAMES[weekStart.getMonth()].substring(0, 3);
        var endStr = weekEnd.getDate() + ' ' + MONTH_NAMES[weekEnd.getMonth()].substring(0, 3);
        periodLabel.textContent = startStr + ' - ' + endStr;
      }
    }
  }

  function changePeriod(direction) {
    if (currentView === 'calendar') {
      currentPeriod.setMonth(currentPeriod.getMonth() + direction);
    } else {
      currentPeriod = addDays(currentPeriod, direction * 7);
    }
    updatePeriodLabel();
    renderCurrentView();
  }

  // ============================================
  // HABIT DIALOG (ADD/EDIT)
  // ============================================

  function openHabitDialog() {
    editingHabitId = null;
    document.getElementById('habit-name').value = '';
    document.querySelector('#habit-dialog-overlay h3').textContent = getTrans('dialog_habit_title');

    // Populate icon picker
    var iconPicker = document.getElementById('icon-picker');
    iconPicker.innerHTML = '';
    var selectedIcon = 'fa-check';
    HABIT_ICONS.forEach(function(iconClass) {
      var btn = document.createElement('div');
      btn.className = 'icon-option' + (iconClass === selectedIcon ? ' selected' : '');
      btn.innerHTML = '<i class="fa ' + iconClass + '"></i>';
      btn.setAttribute('data-icon', iconClass);
      btn.addEventListener('click', function() {
        iconPicker.querySelectorAll('.icon-option').forEach(function(el) { el.classList.remove('selected'); });
        this.classList.add('selected');
        selectedIcon = iconClass;
      });
      iconPicker.appendChild(btn);
    });

    // Populate color picker
    var colorPicker = document.getElementById('color-picker');
    colorPicker.innerHTML = '';
    var selectedColor = HABIT_COLORS[0];
    HABIT_COLORS.forEach(function(color) {
      var btn = document.createElement('div');
      btn.className = 'color-option' + (color === selectedColor ? ' selected' : '');
      btn.style.background = color;
      btn.style.color = color;
      btn.setAttribute('data-color', color);
      btn.addEventListener('click', function() {
        colorPicker.querySelectorAll('.color-option').forEach(function(el) { el.classList.remove('selected'); });
        this.classList.add('selected');
        selectedColor = color;
      });
      colorPicker.appendChild(btn);
    });

    // Reset frequency
    document.getElementById('habit-frequency').value = 'daily';
    document.getElementById('custom-days-field').style.display = 'none';

    // Reset custom days
    var dayCheckboxes = document.querySelectorAll('#days-selector input[type="checkbox"]');
    dayCheckboxes.forEach(function(cb) { cb.checked = false; });

    // Store selections in closure for save
    habitDialog._selectedIcon = function() { return selectedIcon; };
    habitDialog._selectedColor = function() { return selectedColor; };

    habitDialog.style.display = 'flex';
    document.getElementById('habit-name').focus();
  }

  function saveHabitFromDialog() {
    var name = document.getElementById('habit-name').value.trim();
    if (!name) return;

    var icon = habitDialog._selectedIcon ? habitDialog._selectedIcon() : 'fa-check';
    var color = habitDialog._selectedColor ? habitDialog._selectedColor() : HABIT_COLORS[0];
    var frequency = document.getElementById('habit-frequency').value;
    var customDays = [];

    if (frequency === 'custom') {
      var dayCheckboxes = document.querySelectorAll('#days-selector input[type="checkbox"]:checked');
      dayCheckboxes.forEach(function(cb) {
        customDays.push(parseInt(cb.value));
      });
      if (customDays.length === 0) customDays = [0, 1, 2, 3, 4, 5, 6]; // Default to all days
    }

    var habit = {
      id: 'habit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: name,
      icon: icon,
      color: color,
      frequency: frequency,
      customDays: customDays,
      completions: [],
      created: new Date().toISOString()
    };

    habits.push(habit);
    saveData();
    habitDialog.style.display = 'none';
    renderCurrentView();
    showToast(getTrans('toast_habit_created') || 'Habit created');
  }

  // ============================================
  // HABIT SETTINGS DIALOG
  // ============================================

  function openHabitSettings(habitId) {
    var habit = null;
    for (var i = 0; i < habits.length; i++) {
      if (habits[i].id === habitId) { habit = habits[i]; break; }
    }
    if (!habit) return;

    editingHabitId = habitId;

    document.getElementById('settings-habit-name').value = habit.name;
    document.getElementById('settings-habit-frequency').value = habit.frequency;

    // Show/hide custom days
    var customDaysField = document.getElementById('settings-custom-days');
    customDaysField.style.display = habit.frequency === 'custom' ? 'block' : 'none';

    // Check custom days
    var dayCheckboxes = document.querySelectorAll('#settings-days-selector input[type="checkbox"]');
    dayCheckboxes.forEach(function(cb) {
      cb.checked = habit.customDays && habit.customDays.indexOf(parseInt(cb.value)) !== -1;
    });

    // Color picker
    var colorPicker = document.getElementById('settings-color-picker');
    colorPicker.innerHTML = '';
    var selectedColor = habit.color;
    HABIT_COLORS.forEach(function(color) {
      var btn = document.createElement('div');
      btn.className = 'color-option' + (color === selectedColor ? ' selected' : '');
      btn.style.background = color;
      btn.style.color = color;
      btn.setAttribute('data-color', color);
      btn.addEventListener('click', function() {
        colorPicker.querySelectorAll('.color-option').forEach(function(el) { el.classList.remove('selected'); });
        this.classList.add('selected');
        selectedColor = color;
      });
      colorPicker.appendChild(btn);
    });

    habitSettingsDialog._selectedColor = function() { return selectedColor; };

    habitSettingsDialog.style.display = 'flex';
  }

  function updateHabitFromSettings() {
    if (!editingHabitId) return;
    var name = document.getElementById('settings-habit-name').value.trim();
    if (!name) return;

    var frequency = document.getElementById('settings-habit-frequency').value;
    var customDays = [];

    if (frequency === 'custom') {
      var dayCheckboxes = document.querySelectorAll('#settings-days-selector input[type="checkbox"]:checked');
      dayCheckboxes.forEach(function(cb) {
        customDays.push(parseInt(cb.value));
      });
      if (customDays.length === 0) customDays = [0, 1, 2, 3, 4, 5, 6];
    }

    var color = habitSettingsDialog._selectedColor ? habitSettingsDialog._selectedColor() : HABIT_COLORS[0];

    for (var i = 0; i < habits.length; i++) {
      if (habits[i].id === editingHabitId) {
        habits[i].name = name;
        habits[i].color = color;
        habits[i].frequency = frequency;
        habits[i].customDays = customDays;
        break;
      }
    }

    saveData();
    habitSettingsDialog.style.display = 'none';
    renderCurrentView();
    showToast(getTrans('toast_habit_updated') || 'Habit updated');
  }

  function deleteHabitFromSettings() {
    if (!editingHabitId) return;

    var doDelete = true;
    if (settings.confirmDelete) {
      var msg = getCurrentLang() === 'el'
        ? 'Σίγουρα; Η συνήθεια και όλα τα δεδομένα θα χαθούν.'
        : 'Are you sure? This habit and all its data will be lost.';
      doDelete = confirm(msg);
    }

    if (doDelete) {
      habits = habits.filter(function(h) { return h.id !== editingHabitId; });
      saveData();
      habitSettingsDialog.style.display = 'none';
      renderCurrentView();
      showToast(getTrans('toast_habit_deleted') || 'Habit deleted');
    }
  }

  // ============================================
  // IMPORT / EXPORT
  // ============================================

  function exportData() {
    if (habits.length === 0) {
      showToast(getTrans('habits_empty_title'));
      return;
    }
    var data = JSON.stringify(habits, null, 2);
    var blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'oros_habits_' + dateKey(new Date()) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(getTrans('toast_downloaded'));
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported)) throw new Error('Invalid format');
        // Validate structure
        for (var i = 0; i < imported.length; i++) {
          if (!imported[i].id || !imported[i].name) throw new Error('Invalid habit');
        }
        habits = imported;
        saveData();
        renderCurrentView();
        showToast(getTrans('notes_imported') || 'Imported');
      } catch(err) {
        showToast(getTrans('notes_import_failed') || 'Failed to import');
      }
    };
    reader.readAsText(file);
  }

  function clearAllData() {
    var msg = getCurrentLang() === 'el'
      ? 'Σίγουρα; Όλες οι συνήθειες θα χαθούν.'
      : 'Are you sure? All habits will be lost.';
    if (confirm(msg)) {
      habits = [];
      saveData();
      renderCurrentView();
      showToast(getTrans('toast_cleared'));
    }
  }

  // ============================================
  // UTILITIES
  // ============================================

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================
  // SETTINGS TOGGLES
  // ============================================

  var weekStartToggle = document.getElementById('toggle-week-start-mon');
  if (weekStartToggle) {
    weekStartToggle.checked = settings.weekStartMonday;
    weekStartToggle.addEventListener('change', function() {
      settings.weekStartMonday = this.checked;
      saveSettings();
      renderCurrentView();
    });
  }

  var confirmDeleteToggle = document.getElementById('toggle-confirm-delete');
  if (confirmDeleteToggle) {
    confirmDeleteToggle.checked = settings.confirmDelete;
    confirmDeleteToggle.addEventListener('change', function() {
      settings.confirmDelete = this.checked;
      saveSettings();
    });
  }

  // ============================================
  // KEYBOARD SHORTCUTS
  // ============================================

  document.addEventListener('keydown', function(e) {
    // Don't trigger when typing in input/textarea
    var activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

    // Don't trigger when ctrl/cmd is held
    if (e.ctrlKey || e.metaKey) return;

    // Don't trigger when any dialog is open
    if (habitDialog.style.display === 'flex' ||
        habitSettingsDialog.style.display === 'flex' ||
        helpDialog.style.display === 'flex') {
      if (e.key === 'Escape') {
        habitDialog.style.display = 'none';
        habitSettingsDialog.style.display = 'none';
        helpDialog.style.display = 'none';
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openHabitDialog();
    } else if (e.key === '?') {
      e.preventDefault();
      helpDialog.style.display = 'flex';
    } else if (e.key === 'Escape') {
      var settingsModal = document.querySelector('.settings-modal');
      if (settingsModal && settingsModal.classList.contains('visible')) {
        settingsModal.classList.remove('visible');
        e.preventDefault();
      }
    }
  });

  // ============================================
  // EVENT LISTENERS
  // ============================================

  // Add habit button
  var btnAddHabit = document.getElementById('btn-add-habit');
  if (btnAddHabit) btnAddHabit.addEventListener('click', openHabitDialog);

  var btnCreateFirst = document.getElementById('btn-create-first');
  if (btnCreateFirst) btnCreateFirst.addEventListener('click', openHabitDialog);

  // Save habit from dialog
  var btnSaveHabit = document.getElementById('btn-save-habit');
  if (btnSaveHabit) btnSaveHabit.addEventListener('click', saveHabitFromDialog);

  var btnCancelHabit = document.getElementById('btn-cancel-habit');
  if (btnCancelHabit) btnCancelHabit.addEventListener('click', function() {
    habitDialog.style.display = 'none';
  });

  var btnCloseHabitDialog = document.getElementById('btn-close-habit-dialog');
  if (btnCloseHabitDialog) btnCloseHabitDialog.addEventListener('click', function() {
    habitDialog.style.display = 'none';
  });

  // Frequency change in add dialog
  var freqSelect = document.getElementById('habit-frequency');
  if (freqSelect) {
    freqSelect.addEventListener('change', function() {
      document.getElementById('custom-days-field').style.display = this.value === 'custom' ? 'block' : 'none';
    });
  }

  // Settings dialog
  var settingsFreqSelect = document.getElementById('settings-habit-frequency');
  if (settingsFreqSelect) {
    settingsFreqSelect.addEventListener('change', function() {
      document.getElementById('settings-custom-days').style.display = this.value === 'custom' ? 'block' : 'none';
    });
  }

  var btnUpdateHabit = document.getElementById('btn-update-habit');
  if (btnUpdateHabit) btnUpdateHabit.addEventListener('click', updateHabitFromSettings);

  var btnDeleteHabit = document.getElementById('btn-delete-habit');
  if (btnDeleteHabit) btnDeleteHabit.addEventListener('click', deleteHabitFromSettings);

  var btnCancelSettings = document.getElementById('btn-cancel-settings');
  if (btnCancelSettings) btnCancelSettings.addEventListener('click', function() {
    habitSettingsDialog.style.display = 'none';
  });

  var btnCloseHabitSettings = document.getElementById('btn-close-habit-settings');
  if (btnCloseHabitSettings) btnCloseHabitSettings.addEventListener('click', function() {
    habitSettingsDialog.style.display = 'none';
  });

  // View toggle
  var viewBtns = document.querySelectorAll('.view-btn');
  viewBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchView(this.getAttribute('data-view'));
    });
  });

  // Period navigation
  var btnPrevPeriod = document.getElementById('btn-prev-period');
  if (btnPrevPeriod) btnPrevPeriod.addEventListener('click', function() { changePeriod(-1); });

  var btnNextPeriod = document.getElementById('btn-next-period');
  if (btnNextPeriod) btnNextPeriod.addEventListener('click', function() { changePeriod(1); });

  // Import / Export
  var btnImport = document.getElementById('btn-import');
  var btnExport = document.getElementById('btn-export');
  var fileInput = document.getElementById('file-input');

  if (btnImport && fileInput) {
    btnImport.addEventListener('click', function() { fileInput.click(); });
    fileInput.addEventListener('change', function() {
      if (this.files && this.files[0]) {
        importData(this.files[0]);
        this.value = '';
      }
    });
  }

  if (btnExport) btnExport.addEventListener('click', exportData);

  // Clear data
  var btnClearData = document.getElementById('btn-clear-data');
  if (btnClearData) btnClearData.addEventListener('click', clearAllData);

  // Help dialog
  var helpBtn = document.getElementById('btn-help');
  if (helpBtn) {
    helpBtn.addEventListener('click', function() {
      helpDialog.style.display = 'flex';
    });
  }

  var btnCloseHelp = document.getElementById('btn-close-help');
  if (btnCloseHelp) btnCloseHelp.addEventListener('click', function() {
    helpDialog.style.display = 'none';
  });

  var btnCloseHelpOk = document.getElementById('btn-close-help-ok');
  if (btnCloseHelpOk) btnCloseHelpOk.addEventListener('click', function() {
    helpDialog.style.display = 'none';
  });

  // Enter key in habit name field saves
  var habitNameInput = document.getElementById('habit-name');
  if (habitNameInput) {
    habitNameInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveHabitFromDialog();
      }
    });
  }

  // Language change re-render
  window.addEventListener('oros-language-changed', function() {
    renderCurrentView();
    updatePeriodLabel();
  });

  // ============================================
  // INITIALIZATION
  // ============================================

  loadData();
  switchView('list');
  updatePeriodLabel();

})();