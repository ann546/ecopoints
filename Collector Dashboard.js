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

const FULL_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const COLLECTION_HOURS = "8:00 AM \u2013 5:00 PM";

const OFFLINE_NOTE =
  "Cannot reach the EcoPoints server. Start it with: npm start";

const collectorWelcomeHeading = document.getElementById("collectorWelcomeHeading");

const els = {

  pending: document.querySelector("[data-pending-count]"),
  pendingTrend: document.querySelector("[data-pending-trend]"),

  collected: document.querySelector("[data-kg-today]"),
  collectedTrend: document.querySelector("[data-collected-trend]"),

  points: document.querySelector("[data-points-issued-today]"),
  pointsTrend: document.querySelector("[data-points-trend]"),

  recentScans: document.getElementById("recentScansList"),

  route: document.getElementById("todayRouteList"),
  routeTag: document.getElementById("routeStatusTag"),

  week: document.getElementById("weeklySchedule"),
  weekTag: document.getElementById("weeklyScheduleTag"),

  chart: document.getElementById("collectionChart"),
};

function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));

    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function localDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(d.getTime())) {
    return "";
  }

  const y = d.getFullYear();

  const m = String(d.getMonth() + 1).padStart(2, "0");

  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function formatTime(iso) {
  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) {
    return "Time unavailable";
  }

  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWeight(value) {
  const n = Number(value) || 0;

  return `${n.toFixed(1).replace(/\.0$/, "")} kg`;
}

// Collections and scans come from MySQL. loadDashboardData() fills these
// caches, so the synchronous render helpers below keep working.
let queueCache = [];


// The API hands back camelCase collection rows. The old queue records
// used pointsIssued / completedAt, so they are mapped here and every
// render function below stays as it was.
function mapCollection(record) {
  const verification = String(record.verificationStatus || "pending").toLowerCase();

  return {
    ...record,
    status: verification === "verified" ? "completed" : verification,
    completedAt: record.collectedAt,
    weightKg: Number(record.weightKg || 0),
    pointsIssued: Number(record.pointsEarned || 0),
  };
}


async function loadDashboardData() {
    const collectorId = window.EcoApi ? window.EcoApi.collectorId() : null;

    if (!collectorId) {
      queueCache = [];

      return { online: false, message: "Sign in as a collector to load your data." };
    }

    const collections = await window.EcoApi.get(
      `/api/waste-collections?collector_id=${collectorId}&status=all&limit=200`,
    );

    queueCache =
      collections && collections.success
        ? (collections.collections || []).map(mapCollection)
        : [];

    const online = !!(collections && collections.success);

    return { online: online, message: online ? "" : OFFLINE_NOTE };
}

function getQueue() {
  return queueCache;
}


  // A collection counts as recorded the moment the scanner saves it, which is
  // what mapCollection stores as completedAt. This used to require
  // status === "completed", and that only happens once an admin verifies
  // the drop-off, so "Waste Collected Today" and "EcoPoints Issued Today"
  // sat at zero however much had actually been collected.
  function getCompletedRecords(queue) {
    return queue.filter((record) => record && record.completedAt);
  }

function renderStats() {
  const today = localDateKey();

  const queue = getQueue();
  const completed = getCompletedRecords(queue);

  const pending = queue.filter((record) => record.status === "pending");

  const completedToday = completed.filter(
    (record) => localDateKey(record.completedAt) === today,
  );

  const kgToday = completedToday.reduce(
    (sum, record) => sum + (Number(record.weightKg) || 0),
    0,
  );

  const pointsToday = completedToday.reduce(
    (sum, record) => sum + (Number(record.pointsIssued) || 0),
    0,
  );

  if (els.pending) els.pending.textContent = pending.length.toLocaleString();
  if (els.collected) els.collected.textContent = formatWeight(kgToday);
  if (els.points) els.points.textContent = pointsToday.toLocaleString();

  if (els.pendingTrend) {
    els.pendingTrend.textContent = pending.length
      ? "Needs your review"
      : "No records yet";
  }

  if (els.collectedTrend) {
    els.collectedTrend.textContent = completedToday.length
      ? `${completedToday.length} collection${completedToday.length === 1 ? "" : "s"} recorded today`
      : "No activity yet";
  }

  if (els.pointsTrend) {
    els.pointsTrend.textContent = completedToday.length
      ? `${completedToday.length} transaction${completedToday.length === 1 ? "" : "s"} issued today`
      : "No activity yet";
  }
}

function iconForMaterial(material) {
  return (
    {
      Paper: "fa-file-lines",

      Plastic: "fa-bottle-water",

      Metal: "fa-recycle",

      Glass: "fa-wine-bottle",

      "E-Waste": "fa-plug",

      Mixed: "fa-boxes-stacked",
    }[material] || "fa-recycle"
  );
}

// Fed by the collections table, which the scanner really writes. This used
// to read collector_qr_scans, a table nothing ever inserted into, so the
// panel said "No activity yet" forever.
function renderRecentScans() {
  const recent = getCompletedRecords(getQueue())
    .sort((x, y) => new Date(y.completedAt) - new Date(x.completedAt))
    .slice(0, 8);

  if (!recent.length) {
    els.recentScans.innerHTML =
      '<div class="empty-note">No collections recorded yet.</div>';

    return;
  }

  els.recentScans.innerHTML = recent
    .map(
      (record) => `

        <div class="submission-row">

            <div class="submission-icon">
                <i class="fa-solid fa-recycle"></i>
            </div>

            <div class="submission-info">

                <span class="submission-title">
                    ${escapeHTML(record.residentName || "Resident")}
                </span>

                <span class="submission-meta">
                    ${escapeHTML(record.accountId || "")}
                    &middot;
                    ${escapeHTML(record.wasteType || "Waste")}
                    &middot;
                    ${formatWeight(Number(record.weightKg) || 0)}
                </span>

            </div>

            <span class="badge badge-verified">
                +${Number(record.pointsIssued) || 0} pts
            </span>

        </div>

    `
    )
    .join("");
}

function getWeekStart(date) {
  const d = new Date(date);

  d.setHours(0, 0, 0, 0);

  const day = d.getDay();

  const diff = day === 0 ? -6 : 1 - day;

  d.setDate(d.getDate() + diff);

  return d;
}

function renderWeeklyCollection() {
  if (!els.chart || typeof Chart === "undefined") {
    return;
  }

  const completed = getCompletedRecords(getQueue());

  const start = getWeekStart(new Date());

  const labels = [];

  const values = [];

  for (let i = 0; i < 7; i++) {
    const day = new Date(start);

    day.setDate(start.getDate() + i);

    labels.push(
      day.toLocaleDateString("en-US", {
        weekday: "short",
      }),
    );

    const key = localDateKey(day);

    const collected = completed
      .filter((record) => localDateKey(record.completedAt) === key)
      .reduce((sum, record) => sum + (Number(record.weightKg) || 0), 0);

    values.push(collected);
  }

  const chart = Chart.getChart(els.chart);

  if (chart) {
    chart.destroy();
  }

  new Chart(els.chart, {
    type: "bar",

    data: {
      labels,

      datasets: [
        {
          label: "Waste Collected (kg)",

          data: values,

          backgroundColor: "#A1CB35",

          hoverBackgroundColor: "#769826",

          borderRadius: 8,

          maxBarThickness: 36,
        },
      ],
    },

    options: {
      responsive: true,

      plugins: {
        legend: {
          display: false,
        },

        tooltip: {
          callbacks: {
            label: (context) => `${Number(context.raw).toFixed(1)} kg`,
          },
        },
      },

      scales: {
        x: {
          grid: {
            display: false,
          },
        },

        y: {
          grid: {
            color: "#EFEFEF",
          },

          beginAtZero: true,
        },
      },
    },
  });
}

function getCollectorEmail() {
  const session = window.EcoApi ? window.EcoApi.session() : null;

  return session && session.email
    ? String(session.email).trim().toLowerCase()
    : "";
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

function getStoredGroups() {
  const groups = readJSON(GROUPS_KEY, []);

  if (!Array.isArray(groups)) {
    return [];
  }

  return groups.filter(
    (group) => group && Array.isArray(group.members) && Array.isArray(group.streets),
  );
}

function buildStreetScheduleMap(groups, allStreets) {
  const map = new Map();

  groups.forEach((group) => {
    const ordered = group.streets
      .filter((name) => allStreets.includes(name))
      .sort((a, b) => allStreets.indexOf(a) - allStreets.indexOf(b));

    const dayCount = COLLECTION_DAYS.length;
    const base = Math.floor(ordered.length / dayCount);
    const remainder = ordered.length % dayCount;

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
        member && member.email && String(member.email).toLowerCase() === email,
    );

    if (slot !== -1) {
      return {
        group,
        slot,
        role: group.members[slot].role || (slot === 0 ? "Driver" : "Collector"),
      };
    }
  }

  return null;
}

function getTodayAbsences() {
  const all = readJSON(ABSENCES_KEY, {});

  return (all && all[localDateKey()]) || {};
}

function findCoveredGroup(groups, email) {
  if (!email) {
    return null;
  }

  const today = getTodayAbsences();

  for (const group of groups) {
    const slots = today[group.id] || {};

    const covering = Object.values(slots).some(
      (substitute) => substitute && String(substitute).toLowerCase() === email,
    );

    if (covering) {
      return group;
    }
  }

  return null;
}

function getScheduleContext() {
  const email = getCollectorEmail();
  const groups = getStoredGroups();
  const allStreets = getAllStreets();
  const assignment = findAssignment(groups, email);
  const covering = findCoveredGroup(groups, email);

  let absent = false;

  if (assignment) {
    const slots = getTodayAbsences()[assignment.group.id] || {};

    absent = slots[assignment.slot] !== undefined;
  }

  return {
    allStreets,
    scheduleMap: buildStreetScheduleMap(groups, allStreets),
    assignment,
    covering,
    absent,
  };
}

function streetsForDay(context, groupId, day) {
  return context.allStreets.filter((name) => {
    const entry = context.scheduleMap.get(name);

    return entry && entry.groupId === groupId && entry.day === day;
  });
}

function streetTypeLabel(name) {
  if (
    typeof CANIOGAN_STREET_INDEX === "undefined" ||
    typeof classificationLabel !== "function"
  ) {
    return "";
  }

  return classificationLabel(CANIOGAN_STREET_INDEX.get(name));
}

function getTodayRouteState() {
  const context = getScheduleContext();

  const todayName = new Date().toLocaleDateString("en-US", {
    weekday: "long",
  });

  if (!context.assignment && !context.covering) {
    return {
      stops: [],
      tag: "No assigned group",
      message: "You haven't been assigned to a collector group yet.",
    };
  }

  if (context.absent && !context.covering) {
    return {
      stops: [],
      tag: "Marked absent today",
      message: "You are marked absent today.",
    };
  }

  const group = context.covering || context.assignment.group;

  const streets = streetsForDay(context, group.id, todayName);

  if (!streets.length) {
    return {
      stops: [],
      tag: "No collection today",
      message: `No streets are scheduled for ${group.name} today.`,
    };
  }

  const stops = streets.map((name) => {
    const type = streetTypeLabel(name);

    return {
      area: name,
      materials: type ? `${group.name} \u00b7 ${type}` : group.name,
      time: COLLECTION_HOURS,
    };
  });

  return {
    stops,
    tag: `${context.covering ? "Covering " + group.name + " \u00b7 " : ""}${stops.length} assigned stop${stops.length === 1 ? "" : "s"}`,
    message: "",
  };
}

function renderTodayRoute() {
  const state = getTodayRouteState();

  const route = state.stops;

  els.routeTag.textContent = state.tag;

  if (!route.length) {
    els.route.innerHTML = `<div class="schedule-empty-note">${escapeHTML(state.message)}</div>`;

    return;
  }

  els.route.innerHTML = route
    .map(
      (stop, index) => `

        <div class="schedule-row${index === 0 ? " next" : ""}">

            <div class="schedule-day">

                <span class="day-name">
                    ${index === 0 ? "Next" : "Stop"}
                </span>

                <span class="day-num">
                    ${index + 1}
                </span>

            </div>

            <div class="schedule-info">

                <span class="schedule-title">
                    ${escapeHTML(stop.area)}
                </span>

                <span class="schedule-meta">

                    ${escapeHTML(stop.materials)}

                    ${stop.time ? ` &middot; ${escapeHTML(stop.time)}` : ""}

                </span>

            </div>

            ${
              index === 0 ? '<span class="badge badge-next">Next up</span>' : ""
            }

        </div>

    `,
    )
    .join("");
}

function renderWeeklySchedule() {
  if (!els.week) {
    return;
  }

  const context = getScheduleContext();

  const group = context.assignment
    ? context.assignment.group
    : context.covering;

  if (!group) {
    els.weekTag.textContent = "No assigned group";

    els.week.innerHTML =
      '<div class="schedule-empty-note">You haven\'t been assigned to a collector group yet. The Admin assigns collectors to groups.</div>';

    return;
  }

  els.weekTag.textContent = context.assignment
    ? `${group.name} \u00b7 ${context.assignment.role}`
    : `Covering ${group.name} today`;

  const start = getWeekStart(new Date());

  const todayKey = localDateKey();

  els.week.innerHTML = FULL_WEEK.map((dayName, index) => {
    const date = new Date(start);

    date.setDate(start.getDate() + index);

    const isToday = localDateKey(date) === todayKey;

    const dateLabel = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    const collectionDay = COLLECTION_DAYS.includes(dayName);

    const streets = collectionDay
      ? streetsForDay(context, group.id, dayName)
      : [];

    const countLabel = collectionDay
      ? `${streets.length} street${streets.length === 1 ? "" : "s"}`
      : "Off";

    const body = !collectionDay
      ? '<span class="week-day-note">No collection scheduled</span>'
      : streets.length
        ? `<div class="week-street-chips">${streets
            .map(
              (name) =>
                `<span class="week-street-chip">${escapeHTML(name)}</span>`,
            )
            .join("")}</div>`
        : '<span class="week-day-note">No streets scheduled</span>';

    return `

        <div class="week-day-card${isToday ? " today" : ""}${collectionDay ? "" : " off"}">

            <div class="week-day-head">

                <div class="week-day-title">

                    <span class="week-day-name">
                        ${escapeHTML(dayName.slice(0, 3))}
                        ${isToday ? '<span class="week-today-pill">Today</span>' : ""}
                    </span>

                    <span class="week-day-date">
                        ${escapeHTML(dateLabel)}
                    </span>

                </div>

                <span class="week-day-count">
                    ${escapeHTML(countLabel)}
                </span>

            </div>

            ${
              collectionDay
                ? `<span class="week-day-hours">${escapeHTML(COLLECTION_HOURS)}</span>`
                : ""
            }

            <div class="week-day-body">
                ${body}
            </div>

        </div>

    `;
  }).join("");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")

    .replace(/</g, "&lt;")

    .replace(/>/g, "&gt;")

    .replace(/"/g, "&quot;")

    .replace(/'/g, "&#039;");
}

function renderCollectorWelcome() {
  if (!collectorWelcomeHeading) return;

  const session = window.EcoApi ? window.EcoApi.session() : null;

  const name = session && (session.fname || session.lname)
    ? `${session.fname || ""} ${session.lname || ""}`.trim()
    : typeof getUserName === "function"
      ? getUserName()
      : "Collector";

  collectorWelcomeHeading.textContent = `Welcome back, ${name || "Collector"}`;
}

async function renderDashboard() {
  const status = await loadDashboardData();

  renderCollectorWelcome();

  renderStats();

  if (status.online) {
    renderRecentScans();

    renderWeeklyCollection();
  } else {
    els.recentScans.innerHTML = `<div class="empty-note">${escapeHTML(status.message)}</div>`;
  }

  renderTodayRoute();

  renderWeeklySchedule();

  if (!status.online) {
    els.routeTag.textContent = "Server offline";
  }
}

document.addEventListener("DOMContentLoaded", renderDashboard);

window.addEventListener("storage", renderDashboard);

setInterval(renderDashboard, 30000);