(function () {
  const GROUPS_KEY = "ecoCollectorGroups";
  const ABSENCES_KEY = "ecoCollectorAbsences";

  const COLLECTION_DAYS = [
    "Monday",
    "Tuesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];

  const COLLECTION_HOURS = "8:00 AM \u2013 5:00 PM";

  const OFFLINE_NOTE =
    "Cannot reach the EcoPoints server. Start it with: npm start";

  // The collector's own collections come from MySQL. There are no resident
  // loadScheduleData() fills these before the first render; every render
  // function below then works synchronously off the cache.
  let requestRows = [];
  let queueRows = [];
  let offline = false;

  function readStorage(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));

      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function normalizeDate(value) {
    if (!value) {
      return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value).slice(0, 10);
    }

    return dateKey(date);
  }

  function getSession() {
    const session = window.EcoApi ? window.EcoApi.session() : null;

    return session && session.role === "collector" ? session : null;
  }

  async function loadScheduleData() {
    const collectorId = window.EcoApi ? window.EcoApi.collectorId() : null;

    if (!collectorId) {
      requestRows = [];
      queueRows = [];
      offline = true;

      return;
    }

    // Residents no longer submit waste, so there are no collection requests
      // to read. The schedule is built from the group's street split.
      const queue = await window.EcoApi.get(
        `/api/waste-collections?collector_id=${collectorId}&status=all&limit=200`,
      );

    requestRows = [];

    queueRows = queue && queue.success ? queue.collections || [] : [];

    offline = !queue || !queue.success;
  }

  function getAllStreets() {
    if (typeof CANIOGAN_STREETS === "undefined") {
      return [];
    }

    const names = [];

    CANIOGAN_STREETS.forEach((group) => {
      group.streets.forEach((street) => names.push(street.name));
    });

    return names;
  }

  function getGroups() {
    const groups = readStorage(GROUPS_KEY, []);

    if (!Array.isArray(groups)) {
      return [];
    }

    return groups.filter(
      (group) =>
        group && Array.isArray(group.members) && Array.isArray(group.streets),
    );
  }

  function buildScheduleMap(groups, allStreets) {
    const map = new Map();

    groups.forEach((group) => {
      const ordered = group.streets
        .filter((name) => allStreets.includes(name))
        .sort((a, b) => allStreets.indexOf(a) - allStreets.indexOf(b));

      const base = Math.floor(ordered.length / COLLECTION_DAYS.length);
      const remainder = ordered.length % COLLECTION_DAYS.length;

      let cursor = 0;

      COLLECTION_DAYS.forEach((day, index) => {
        const chunkSize = base + (index < remainder ? 1 : 0);

        ordered.slice(cursor, cursor + chunkSize).forEach((name) => {
          map.set(name, { day, groupId: group.id });
        });

        cursor += chunkSize;
      });
    });

    return map;
  }

  function findAssignment(groups, email) {
    if (!email) {
      return null;
    }

    for (const group of groups) {
      const slot = group.members.findIndex(
        (member) =>
          member &&
          member.email &&
          String(member.email).toLowerCase() === email,
      );

      if (slot !== -1) {
        return {
          group,
          role: group.members[slot].role || (slot === 0 ? "Driver" : "Collector"),
        };
      }
    }

    return null;
  }

  function findCoveredGroup(groups, email) {
    if (!email) {
      return null;
    }

    const all = readStorage(ABSENCES_KEY, {});
    const today = (all && all[dateKey(new Date())]) || {};

    for (const group of groups) {
      const slots = today[group.id] || {};

      const covering = Object.values(slots).some(
        (substitute) =>
          substitute && String(substitute).toLowerCase() === email,
      );

      if (covering) {
        return group;
      }
    }

    return null;
  }

  // A request counts as done when the database says it is completed, or
  // when that resident already has a verified collection on record.
  function getVerifiedAccounts() {
    return new Set(
      queueRows
        .filter(
          (item) =>
            item &&
            String(item.verificationStatus || "").toLowerCase() === "verified",
        )
        .map((item) => String(item.accountId || ""))
        .filter(Boolean),
    );
  }

  function buildRequestIndex() {
    const verifiedAccounts = getVerifiedAccounts();
    const index = new Map();

    requestRows.forEach((request) => {
      if (!request) {
        return;
      }

      const status = String(
        request.status || request.request_status || "",
      ).toLowerCase();

      if (status === "cancelled") {
        return;
      }

      const date = normalizeDate(request.requestedDate);
      const area = String(request.street || "").trim();

      if (!date || !area) {
        return;
      }

      const key = `${date}|${area}`;

      if (!index.has(key)) {
        index.set(key, { total: 0, completed: 0 });
      }

      const entry = index.get(key);

      const accountId = String(request.accountId || "");

      entry.total += 1;

      if (status === "completed" || verifiedAccounts.has(accountId)) {
        entry.completed += 1;
      }
    });

    return index;
  }

  const state = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    selected: dateKey(new Date()),
  };

  function buildContext() {
    const session = getSession();

    const email =
      session && session.email
        ? String(session.email).trim().toLowerCase()
        : "";

    const groups = getGroups();
    const allStreets = getAllStreets();

    return {
      allStreets,
      scheduleMap: buildScheduleMap(groups, allStreets),
      assignment: findAssignment(groups, email),
      covering: findCoveredGroup(groups, email),
      requestIndex: buildRequestIndex(),
      collectorName: session
        ? `${session.fname || ""} ${session.lname || ""}`.trim() || "Collector"
        : "Collector",
      todayKey: dateKey(new Date()),
    };
  }

  function entriesForDate(context, date) {
    const key = dateKey(date);
    const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
    const dayGroups = [];

    if (context.assignment) {
      dayGroups.push({
        group: context.assignment.group,
        role: context.assignment.role,
        covering: false,
      });
    }

    if (
      context.covering &&
      key === context.todayKey &&
      (!context.assignment || context.assignment.group.id !== context.covering.id)
    ) {
      dayGroups.push({
        group: context.covering,
        role: "Substitute",
        covering: true,
      });
    }

    const entries = [];

    dayGroups.forEach((entry) => {
      const streets = context.allStreets.filter((name) => {
        const scheduled = context.scheduleMap.get(name);

        return (
          scheduled &&
          scheduled.groupId === entry.group.id &&
          scheduled.day === dayName
        );
      });

      if (!streets.length) {
        return;
      }

      let total = 0;
      let completed = 0;

      streets.forEach((street) => {
        const counts = context.requestIndex.get(`${key}|${street}`);

        if (counts) {
          total += counts.total;
          completed += counts.completed;
        }
      });

      entries.push({
        route: entry.covering ? `${entry.group.name} (covering)` : entry.group.name,
        role: entry.role,
        streets,
        total,
        completed,
        pending: total - completed,
      });
    });

    return entries;
  }

  function renderStats(monthEntries) {
    let total = 0;
    let completed = 0;
    let pending = 0;
    let days = 0;

    const areas = new Set();

    monthEntries.forEach((entries) => {
      if (entries.length) {
        days += 1;
      }

      entries.forEach((entry) => {
        total += entry.total;
        completed += entry.completed;
        pending += entry.pending;
        entry.streets.forEach((street) => areas.add(street));
      });
    });

    document.getElementById("totalRequests").textContent = total;
    document.getElementById("completedRequests").textContent = completed;
    document.getElementById("pendingRequests").textContent = pending;
    document.getElementById("scheduledAreas").textContent = areas.size;
    document.getElementById("scheduleCount").textContent = `${days} collection day${days === 1 ? "" : "s"}`;
  }

  function renderCell(context, date, entries) {
    const key = dateKey(date);
    const isToday = key === context.todayKey;
    const isSelected = key === state.selected;
    const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
    const collectionDay = COLLECTION_DAYS.includes(dayName);

    const classes = ["cal-cell"];

    if (isToday) classes.push("today");
    if (isSelected) classes.push("selected");
    if (!collectionDay) classes.push("off");

    const streets = entries.reduce((list, entry) => list.concat(entry.streets), []);
    const total = entries.reduce((sum, entry) => sum + entry.total, 0);
    const pending = entries.reduce((sum, entry) => sum + entry.pending, 0);

    const visible = streets.slice(0, 2);
    const extra = streets.length - visible.length;

    const chips = visible
      .map((name) => `<span class="cal-chip">${escapeHtml(name)}</span>`)
      .join("");

    const body = !collectionDay
      ? '<span class="cal-off">No collection</span>'
      : streets.length
        ? `
          <span class="cal-count">${streets.length} street${streets.length === 1 ? "" : "s"}</span>
          <div class="cal-chips">${chips}${extra > 0 ? `<span class="cal-more">+${extra} more</span>` : ""}</div>
          ${
            total > 0
              ? `<span class="cal-req${pending === 0 ? " done" : ""}">${total} request${total === 1 ? "" : "s"}</span>`
              : ""
          }
        `
        : "";

    return `
      <button type="button" class="${classes.join(" ")}" data-date="${key}">
        <span class="cal-date-row">
          <span class="cal-date">${date.getDate()}</span>
          ${isToday ? '<span class="cal-today-pill">Today</span>' : ""}
        </span>
        ${body}
      </button>
    `;
  }

  function renderDetail(context) {
    const detail = document.getElementById("dayDetail");

    if (offline) {
      detail.innerHTML = `<div class="schedule-empty-note">${escapeHtml(
        OFFLINE_NOTE,
      )} Request counts could not be loaded.</div>`;
      return;
    }

    if (!state.selected) {
      detail.innerHTML = '<div class="schedule-empty-note">Select a date to see its collection details.</div>';
      return;
    }

    const date = new Date(`${state.selected}T00:00:00`);
    const entries = entriesForDate(context, date);

    const title = date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    if (!entries.length) {
      detail.innerHTML = `
        <div class="day-detail-head"><h3>${escapeHtml(title)}</h3></div>
        <div class="schedule-empty-note">No collection is scheduled for your group on this day.</div>
      `;
      return;
    }

    detail.innerHTML = `
      <div class="day-detail-head">
        <h3>${escapeHtml(title)}</h3>
        <span class="day-detail-hours">${escapeHtml(COLLECTION_HOURS)}</span>
      </div>
      ${entries
        .map(
          (entry) => `
            <div class="day-detail-group">
              <div class="day-detail-route">
                ${escapeHtml(entry.route)} &middot; ${escapeHtml(context.collectorName)} (${escapeHtml(entry.role)})
              </div>
              <div class="day-detail-stats">
                
                <div class="day-detail-stat"><span>Completed</span><strong>${entry.completed}</strong></div>
                <div class="day-detail-stat"><span>Pending</span><strong>${entry.pending}</strong></div>
              </div>
              <div class="day-detail-label">${entry.streets.length} street${entry.streets.length === 1 ? "" : "s"} &middot; Barangay Caniogan</div>
              <div class="day-detail-streets">
                ${entry.streets.map((name) => `<span class="cal-chip">${escapeHtml(name)}</span>`).join("")}
              </div>
            </div>
          `,
        )
        .join("")}
    `;
  }

  function render() {
    const wrap = document.getElementById("calendarWrap");
    const grid = document.getElementById("calendarGrid");
    const emptyState = document.getElementById("emptyState");
    const emptyTitle = document.getElementById("emptyTitle");
    const emptyMessage = document.getElementById("emptyMessage");

    const context = buildContext();

    document.getElementById("calTitle").textContent = new Date(
      state.year,
      state.month,
      1,
    ).toLocaleDateString("en-US", { month: "long", year: "numeric" });

    if (!context.assignment && !context.covering) {
      wrap.hidden = true;
      emptyState.hidden = false;
      emptyTitle.textContent = offline
        ? "Server offline."
        : "No collector group assigned yet.";
      emptyMessage.textContent = offline
        ? OFFLINE_NOTE
        : "The Admin assigns collectors to groups. Once you are assigned, your schedule appears here.";
      renderStats([]);
      return;
    }

    wrap.hidden = false;
    emptyState.hidden = true;

    const first = new Date(state.year, state.month, 1);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    const weeks = Math.ceil((offset + daysInMonth) / 7);

    const monthEntries = [];
    let html = "";

    for (let i = 0; i < weeks * 7; i++) {
      const date = new Date(state.year, state.month, 1 - offset + i);

      if (date.getMonth() !== state.month) {
        html += `<div class="cal-cell outside"><span class="cal-date">${date.getDate()}</span></div>`;
        continue;
      }

      const entries = entriesForDate(context, date);

      monthEntries.push(entries);
      html += renderCell(context, date, entries);
    }

    grid.innerHTML = html;

    grid.querySelectorAll("[data-date]").forEach((cell) => {
      cell.addEventListener("click", () => {
        state.selected = cell.dataset.date;
        render();
      });
    });

    renderStats(monthEntries);
    renderDetail(context);
  }

  function goToMonth(year, month) {
    const target = new Date(year, month, 1);

    state.year = target.getFullYear();
    state.month = target.getMonth();

    const today = new Date();

    state.selected =
      today.getFullYear() === state.year && today.getMonth() === state.month
        ? dateKey(today)
        : dateKey(target);

    render();
  }

  function setupEvents() {
    document.getElementById("calPrev").addEventListener("click", () => {
      goToMonth(state.year, state.month - 1);
    });

    document.getElementById("calNext").addEventListener("click", () => {
      goToMonth(state.year, state.month + 1);
    });

    document.getElementById("calToday").addEventListener("click", () => {
      const today = new Date();

      document.getElementById("dateFilter").value = "";
      goToMonth(today.getFullYear(), today.getMonth());
    });

    document.getElementById("dateFilter").addEventListener("change", (event) => {
      const value = event.target.value;

      if (!value) {
        return;
      }

      const date = new Date(`${value}T00:00:00`);

      if (Number.isNaN(date.getTime())) {
        return;
      }

      state.year = date.getFullYear();
      state.month = date.getMonth();
      state.selected = value;
      render();
    });

    window.addEventListener("storage", (event) => {
      if (event.key && event.key !== GROUPS_KEY && event.key !== ABSENCES_KEY) {
        return;
      }

      render();
    });
  }

  async function init() {
    setupEvents();

    await loadScheduleData();

    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();