const READ_KEY = "ecoCollectorNotificationRead";

const OFFLINE_NOTE =
  "Cannot reach the EcoPoints server. Start it with: npm start";

const notificationList = document.getElementById("notificationList");
const notificationCount = document.getElementById("notificationCount");
const unreadCount = document.getElementById("unreadCount");
const markAllRead = document.getElementById("markAllRead");
const notificationSearch = document.getElementById("notificationSearch");
const filterButtons = document.querySelectorAll(".filter-btn");
const emptyState = document.getElementById("emptyState");
const emptyMessage = document.getElementById("emptyMessage");

let currentFilter = "all";
let notifications = [];
let offline = false;

// Notifications now live in MySQL. loadNotificationData() pulls the four
// feeds once per render, and buildNotifications() shapes them into the
// same list the page has always shown.
let apiNotifications = [];
let adminNotifications = [];
let apiRequests = [];
let apiQueue = [];

const NOTIFICATION_ICONS = {
  schedule: "fa-calendar-days",
  achievement: "fa-trophy",
  points: "fa-star",
  verification: "fa-clipboard-check",
  reward_redemption: "fa-gift",
  general: "fa-bell",
};

const NOTIFICATION_LABELS = {
  schedule: "Collection schedule update",
  achievement: "Achievement unlocked",
  points: "EcoPoints update",
  verification: "Waste verification",
  reward_redemption: "Reward redemption",
  general: "EcoPoints update",
};

function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getCollector() {
  const session = window.EcoApi ? window.EcoApi.session() : null;

  if (!session) {
    return {
      id: null,
      name: "EcoPoints Collector",
    };
  }

  const name =
    `${session.fname || ""} ${session.lname || ""}`.trim() ||
    session.name ||
    "EcoPoints Collector";

  return {
    id: window.EcoApi ? window.EcoApi.collectorId() : null,
    name,
  };
}

function formatDateTime(value) {
  if (!value) {
    return "Time not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRequestedSchedule(date, time) {
  if (!date && !time) {
    return "Schedule not provided";
  }

  let output = "";

  if (date) {
    const parsed = new Date(`${date}T00:00:00`);

    output += Number.isNaN(parsed.getTime())
      ? date
      : parsed.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
  }

  if (time) {
    const parts = String(time).split(":");

    const parsed = new Date(
      2000,
      0,
      1,
      Number(parts[0]),
      Number(parts[1] || 0),
    );

    const formattedTime = parsed.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

    output += output ? ` at ${formattedTime}` : formattedTime;
  }

  return output || "Schedule not provided";
}

function formatWeight(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "";
  }

  return `${number.toFixed(1).replace(/\.0$/, "")} kg`;
}

// Notifications the collector reads are tracked in MySQL. Only the
// derived rows (requests, submissions) have no server row, so their read
// state is remembered locally.
function getReadIds() {
  const value = readJSON(READ_KEY, []);

  return Array.isArray(value) ? value : [];
}

function setReadIds(ids) {
  localStorage.setItem(READ_KEY, JSON.stringify([...new Set(ids)]));
}

function addNotification(list, notification) {
  if (!notification || !notification.id || !notification.timestamp) {
    return;
  }

  list.push(notification);
}

function mapServerNotification(n) {
  return {
    id: `server:${n.id}`,
    serverId: n.id,
    type: n.category || "general",
    icon: NOTIFICATION_ICONS[n.category] || NOTIFICATION_ICONS.general,
    label: NOTIFICATION_LABELS[n.category] || NOTIFICATION_LABELS.general,
    title: n.title || "EcoPoints update",
    description: n.message || "",
    read: !!n.read,
    timestamp: n.ts || n.date,
    sourceId: n.id,
  };
}

// The admin-wide feed stands in for the old ecoRedemptionNotifications
// key: reward notices are called out on their own, everything else reads
// as a site-wide announcement.
function mapAdminNotification(n) {
  const isReward = /reward|redemption|claimed/i.test(
    `${n.category || ""} ${n.title || ""} ${n.message || ""}`,
  );

  return {
    id: `admin:${n.id}`,
    type: isReward ? "reward-redemption" : "admin-announcement",
    icon: isReward ? "fa-gift" : "fa-bullhorn",
    label: isReward ? "Reward redemption" : "Important Admin announcement",
    title: n.title || "Admin announcement",
    description: n.message || "Please review the latest announcement.",
    read: !!n.read,
    timestamp: n.ts || n.date,
    sourceId: n.id,
  };
}

async function loadNotificationData() {
  const collectorId = window.EcoApi ? window.EcoApi.collectorId() : null;

  if (!collectorId) {
    apiNotifications = [];
    adminNotifications = [];
    apiRequests = [];
    apiQueue = [];
    offline = true;

    return;
  }

  const [feed, admin, requests, queue] = await Promise.all([
    window.EcoApi.get(
      `/api/notifications?role=collector&recipient_id=${collectorId}`,
    ),

    window.EcoApi.get("/api/notifications?role=admin"),

    window.EcoApi.get(
      `/api/waste-collections?collector_id=${collectorId}&status=all&limit=200`,
    ),
  ]);

  apiNotifications = feed && feed.success ? feed.notifications || [] : [];

  adminNotifications = admin && admin.success ? admin.notifications || [] : [];

  // Residents no longer submit waste, so there are no collection requests.
  apiRequests = [];

  apiQueue = queue && queue.success ? queue.collections || [] : [];

  offline = [feed, admin, queue].some((res) => !res || !res.success);
}

function buildNotifications() {
  const list = [];
  const collector = getCollector();

  apiNotifications.forEach((item) => {
    addNotification(list, mapServerNotification(item));
  });

  adminNotifications.forEach((item) => {
    addNotification(list, mapAdminNotification(item));
  });

  apiRequests.forEach((request) => {
    const residentName = request.residentName || "Registered resident";

    const timestamp = request.created_at || request.requestedDate;

    const schedule = formatRequestedSchedule(
      request.requestedDate,
      request.requestedTime,
    );

    addNotification(list, {
      id: `collection-request:${request.id}:${timestamp}`,

      type: "collection-request",

      icon: "fa-truck-ramp-box",

      label: "New collection request",

      title: `New collection request from ${residentName}`,

      description: `${request.wasteType || "Waste"}${
        request.estimatedWeightKg
          ? ` \u00b7 ${formatWeight(request.estimatedWeightKg)}`
          : ""
      } \u00b7 ${schedule}`,

      timestamp,

      sourceId: request.id,
    });

    // handled_by is whoever last actioned the request in MySQL.
    if (collector.id && Number(request.handled_by || 0) === Number(collector.id)) {
      addNotification(list, {
        id: `collection-handled:${request.id}:${request.handled_at}`,

        type: "collection-handled",

        icon: "fa-calendar-check",

        label: "Collection request updated",

        title: `You handled the collection request for ${residentName}`,

        description: `${
          request.status || "updated"
        } \u00b7 ${schedule} \u00b7 ${request.street || "Area not provided"}.`,

        timestamp: request.handled_at,

        sourceId: request.id,
      });
    }
  });

  apiQueue.forEach((record) => {
    const residentName = record.residentName || "Registered resident";

    const timestamp = record.collectedAt;

    const weight = record.weightKg;

    const status = String(record.verificationStatus || "pending").toLowerCase();

    addNotification(list, {
      id: `waste-submission:${record.id}:${timestamp}`,

      type: "waste-submission",

      icon: "fa-trash-arrow-up",

      label: "New waste submission",

      title: `New waste submission from ${residentName}`,

      description: `${record.wasteType || "Waste"}${
        weight != null ? ` \u00b7 ${formatWeight(weight)}` : ""
      } submitted for collection.`,

      timestamp,

      sourceId: record.id,
    });

    if (status === "pending") {
      addNotification(list, {
        id: `verification-request:${record.id}:${timestamp}`,

        type: "verification-request",

        icon: "fa-clipboard-check",

        label: "New verification request",

        title: "Verification request waiting for review",

        description: `${residentName} submitted ${record.wasteType || "waste"}${
          weight != null ? ` \u00b7 ${formatWeight(weight)}` : ""
        }.`,

        timestamp,

        sourceId: record.id,
      });
    }
  });

  const unique = new Map();

  list.forEach((item) => {
    if (!unique.has(item.id)) {
      unique.set(item.id, item);
    }
  });

  return Array.from(unique.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

// Server-backed rows carry their own read flag; the derived rows do not.
function isNotificationRead(notification, readIds) {
  if (notification.serverId) {
    return notification.read;
  }

  return readIds.includes(notification.id);
}

function updateProfile() {
  const collector = getCollector();

  const name = collector.name || "EcoPoints Collector";

  const parts = name.split(/\s+/).filter(Boolean);

  const initials = (
    (parts[0] || "E")[0] + (parts[parts.length - 1] || "C")[0]
  ).toUpperCase();

  document.querySelectorAll(".profile-name").forEach((element) => {
    element.textContent = name;
  });

  document.querySelectorAll(".avatar").forEach((element) => {
    element.textContent = initials;
  });
}

function render() {
  notifications = buildNotifications();

  const readIds = getReadIds();

  const term = notificationSearch.value.trim().toLowerCase();

  const filtered = notifications.filter((notification) => {
    const searchable = [
      notification.label,
      notification.title,
      notification.description,
    ]
      .join(" ")
      .toLowerCase();

    const matchesSearch = !term || searchable.includes(term);

    const matchesFilter =
      currentFilter === "all" ||
      (currentFilter === "unread" && !isNotificationRead(notification, readIds));

    return matchesSearch && matchesFilter;
  });

  const unread = notifications.filter(
    (notification) => !isNotificationRead(notification, readIds),
  ).length;

  notificationCount.textContent = notifications.length.toLocaleString();

  unreadCount.textContent = unread.toLocaleString();

  if (!filtered.length) {
    notificationList.innerHTML = "";

    emptyState.hidden = false;

    emptyMessage.textContent = offline
      ? OFFLINE_NOTE
      : notifications.length && currentFilter === "unread"
        ? "You are all caught up."
        : "No new notifications.";

    return;
  }

  emptyState.hidden = true;

  notificationList.innerHTML = filtered
    .map((notification) => {
      const isRead = isNotificationRead(notification, readIds);

      return `
                <button
                    class="notification-row${isRead ? "" : " unread"}"
                    type="button"
                    data-id="${escapeHTML(notification.id)}"
                >
                    <span class="notif-icon">
                        <i class="fa-solid ${escapeHTML(notification.icon)}"></i>
                    </span>

                    <span class="notif-info">

                        <span class="notif-title">
                            ${escapeHTML(notification.title)}
                        </span>

                        <span class="notification-type">
                            ${escapeHTML(notification.label)}
                        </span>

                        <span class="notif-time">
                            ${escapeHTML(notification.description)}
                            &middot;
                            ${escapeHTML(formatDateTime(notification.timestamp))}
                        </span>

                    </span>

                    ${
                      isRead
                        ? ""
                        : '<span class="unread-dot" aria-label="Unread"></span>'
                    }

                </button>
            `;
    })
    .join("");

  notificationList.querySelectorAll(".notification-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.id;

      markNotificationRead(notifications.find((item) => item.id === id));
    });
  });
}

async function markNotificationRead(notification) {
  if (!notification || isNotificationRead(notification, getReadIds())) {
    return;
  }

  if (notification.serverId) {
    const res = await window.EcoApi.patch(
      `/api/notifications/${notification.serverId}/read`,
    );

    if (!res || res.offline || !res.success) {
      return;
    }
  } else {
    setReadIds([...getReadIds(), notification.id]);
  }

  await loadNotificationData();

  render();
}

async function loadAndRender() {
  await loadNotificationData();

  render();
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    filterButtons.forEach((item) => item.classList.remove("active"));

    button.classList.add("active");

    currentFilter = button.dataset.filter;

    render();
  });
});

notificationSearch.addEventListener("input", render);

markAllRead.addEventListener("click", async (event) => {
  event.preventDefault();

  const res = await window.EcoApi.post("/api/notifications/read-all", {
    role: "collector",
    recipient_id: window.EcoApi.collectorId(),
  });

  if (!res || res.offline || !res.success) {
    emptyState.hidden = false;

    emptyMessage.textContent = OFFLINE_NOTE;

    return;
  }

  // The derived rows have no server counterpart, so they are cleared here.
  setReadIds([
    ...getReadIds(),
    ...notifications.filter((item) => !item.serverId).map((item) => item.id),
  ]);

  await loadNotificationData();

  render();
});

window.addEventListener("storage", (event) => {
  if (event.key && event.key !== READ_KEY && event.key !== "ecoUser") {
    return;
  }

  render();
});

document.addEventListener("DOMContentLoaded", async () => {
  updateProfile();

  await loadAndRender();
});
