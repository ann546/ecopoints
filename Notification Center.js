/* ---------- Notification Center.js ----------
   One shared notification system for every resident page.

   What it does:
   - Builds each resident's feed from their real data: points history,
     waste collections
     (ecoWasteQueue). Nothing here is fake or hardcoded.
   - Remembers read and cleared notifications per account, so two
     residents on the same browser never share a read state.
   - Keeps the sidebar badge, the bell counter and the tab title in sync
     on every page, and refreshes itself when data changes (including
     changes made by a collector in another tab).
   - Adds a bell dropdown and small pop-up toasts for new activity.

   Load it right after user-module.js on any resident page:
     <script src="user-module.js"></script>
     <script src="Notification Center.js"></script>

   Pages can use window.EcoNotifs to show the feed:
     EcoNotifs.mountList(element, { limit, compact, group, dismissable })
*/

(function () {
  "use strict";

  const STATE_PREFIX = "ecoNotifState:";
  const POLL_MS = 4000;
  const TOAST_MS = 5200;

  const CATEGORIES = {
    points: { label: "Points" },
    collection: { label: "Collection" },
    rewards: { label: "Rewards" },
  };

  const subscribers = [];
  let enabled = false;
  let uid = "";
  let lastSig = null;
  let baseTitle = document.title;
  let popEl = null;
  let popList = null;
  let bellEl = null;

  /* ---------- Small helpers ---------- */

  function readJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function readSession() {
    const stores = [localStorage, sessionStorage];

    for (let i = 0; i < stores.length; i++) {
      try {
        const session = JSON.parse(stores[i].getItem("ecoUser"));
        if (session) return session;
      } catch (e) {}
    }

    return null;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function hashStr(str) {
    let h = 0;

    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) | 0;
    }

    return Math.abs(h).toString(36);
  }

  function parseWhen(value) {
    if (value == null || value === "") {
      return { ts: 0, dateOnly: true, raw: "" };
    }

    const ts = typeof value === "number" ? value : Date.parse(value);

    if (isNaN(ts)) {
      return { ts: 0, dateOnly: true, raw: String(value) };
    }

    const hasTime = typeof value === "number" || /\d{1,2}:\d{2}/.test(String(value));

    return { ts: ts, dateOnly: !hasTime, raw: String(value) };
  }

  function fmtDay(value) {
    if (!value) return "";

    const text = String(value);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(text + "T00:00:00") : new Date(text);

    if (isNaN(date.getTime())) return text;

    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function fmtClock(value) {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));

    if (!match) return String(value || "");

    let hour = Number(match[1]);
    const suffix = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;

    return hour + ":" + match[2] + " " + suffix;
  }

  function dayDiff(ts) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const d = new Date(ts);
    const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    return Math.round((today - that) / 86400000);
  }

  function groupOf(n) {
    if (!n.ts) return "Earlier";

    const diff = dayDiff(n.ts);

    if (diff <= 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7) return "This week";

    return "Earlier";
  }

  function timeLabel(n) {
    if (!n.ts) return n.raw || "";

    const diff = dayDiff(n.ts);
    const clock = n.dateOnly
      ? ""
      : new Date(n.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    if (!n.dateOnly && diff <= 0) {
      const ms = Date.now() - n.ts;

      if (ms < 60000) return "Just now";
      if (ms < 3600000) return Math.floor(ms / 60000) + " min ago";

      return Math.floor(ms / 3600000) + " hr ago";
    }

    if (diff <= 0) return "Today";
    if (diff === 1) return "Yesterday" + (clock ? " \u00b7 " + clock : "");

    const dateText = new Date(n.ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    return dateText + (clock ? " \u00b7 " + clock : "");
  }

  /* ---------- Per-account read / cleared state ---------- */

  function stateKey() {
    return STATE_PREFIX + uid;
  }

  function loadState() {
    const st = readJSON(stateKey(), null);
    const state = st && typeof st === "object" ? st : {};

    state.read = state.read && typeof state.read === "object" ? state.read : {};
    state.dismissed = state.dismissed && typeof state.dismissed === "object" ? state.dismissed : {};
    state.known = state.known && typeof state.known === "object" ? state.known : null;

    return state;
  }

  function saveState(state) {
    try {
      localStorage.setItem(stateKey(), JSON.stringify(state));
    } catch (e) {}
  }

  /* ---------- Server-side notifications ----------
     Rows the API writes to the notifications table. Cached in memory
     and merged into the feed; read state is written back through the
     API so it follows the account to another device. */

  let serverRows = [];

  function serverRole() {
    const session = readSession();
    return session && session.role ? session.role : null;
  }

  function serverId() {
    if (!window.EcoApi) return null;
    const role = serverRole();
    if (role === "collector") return window.EcoApi.collectorId();
    if (role === "admin") return window.EcoApi.adminId();
    return window.EcoApi.residentId();
  }

  function loadServerNotifications() {
    const role = serverRole();
    const id = serverId();

    if (!role || !window.EcoApi) {
      serverRows = [];
      return Promise.resolve([]);
    }

    const path_ =
      "/api/notifications?role=" +
      encodeURIComponent(role) +
      (id ? "&recipient_id=" + id : "");

    return window.EcoApi.get(path_).then((res) => {
      serverRows = res && res.success && res.notifications ? res.notifications : [];
      return serverRows;
    }).catch(() => {
      serverRows = [];
      return [];
    });
  }

  // Category names used by the API mapped onto the feed's own categories.
  const SERVER_CATEGORY = {
    points: "points",
    verification: "collection",
    achievement: "rewards",
    redemption: "rewards",
    schedule: "collection",
    general: "general",
  };

  const SERVER_ICON = {
    points: "fa-coins",
    verification: "fa-clipboard-check",
    achievement: "fa-trophy",
    redemption: "fa-gift",
    schedule: "fa-calendar-days",
    general: "fa-bell",
  };

  /* ---------- Build the feed from real data ---------- */

  function buildFeed() {
    if (!enabled) return [];

    const out = [];

    function add(e) {
      const when = parseWhen(e.when);

      out.push({
        id: e.id,
        cat: e.cat,
        tone: e.tone,
        icon: e.icon,
        title: e.title,
        body: e.body || "",
        href: e.href || "",
        ts: when.ts,
        dateOnly: when.dateOnly,
        raw: when.raw,
        order: out.length,
      });
    }

    /* Points history: bonuses, verified collections, redemptions */
    const history = typeof window.getHistory === "function" ? window.getHistory() : [];
    const seen = {};

    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];

      if (!h) continue;

      const pts = Number(h.points) || 0;
      const desc = String(h.description || "");
      const base = "h" + hashStr((h.date || "") + "|" + desc + "|" + pts);

      seen[base] = (seen[base] || 0) + 1;

      const id = base + "-" + seen[base];
      const when = h.createdAt || h.date;

      if (h.type === "bonus") {
        add({
          id: id,
          cat: "points",
          tone: "good",
          icon: "fa-star",
          title: desc || "Bonus points",
          body: "+" + pts.toLocaleString() + " EcoPoints added to your balance.",
          when: when,
          href: "My EcoPoints.html",
        });
      } else if (h.type === "redeem" || pts < 0) {
        add({
          id: id,
          cat: "rewards",
          tone: "reward",
          icon: "fa-gift",
          title: desc || "Reward redeemed",
          body:
            Math.abs(pts).toLocaleString() +
            " EcoPoints used. Coordinate pickup with your barangay office.",
          when: when,
          href: "Rewards.html",
        });
      } else if (pts > 0) {
        add({
          id: id,
          cat: "points",
          tone: "good",
          icon: "fa-recycle",
          title: "+" + pts.toLocaleString() + " EcoPoints earned",
          body: desc,
          when: when,
          href: "My EcoPoints.html",
        });
      }
    }


    /* Waste submissions checked by a collector */
    const queue = readJSON("ecoWasteQueue", []);

    (Array.isArray(queue) ? queue : []).forEach((q) => {
      if (!q || String(q.residentId || "").toUpperCase() !== uid.toUpperCase()) return;

      const type = q.wasteType || "Waste";
      const qid = String(q.id);

      if (q.verifiedAt) {
        const weight = Number(q.verifiedWeightKg);

        add({
          id: "q:" + qid + ":verified",
          cat: "collection",
          tone: "good",
          icon: "fa-clipboard-check",
          title: type + " verified",
          body:
            "A collector confirmed " +
            (weight ? weight + " kg" : "your submission") +
            (q.condition ? " (" + q.condition + ")" : "") +
            ". Your EcoPoints are being computed.",
          when: q.verifiedAt,
          href: "My EcoPoints.html",
        });
      }

      if (q.rejectedAt) {
        add({
          id: "q:" + qid + ":rejected",
          cat: "collection",
          tone: "warn",
          icon: "fa-triangle-exclamation",
          title: type + " submission rejected",
          body: q.rejectionReason ? "Reason: " + q.rejectionReason : "It did not pass verification.",
          when: q.rejectedAt,
          href: "Waste Submission.html",
        });
      }
    });

    /* Rows from the notifications table, oldest first so the
       sort below orders them by time. */
    serverRows.forEach((n) => {
      add({
        id: "n:" + n.id,
        cat: SERVER_CATEGORY[n.category] || "general",
        tone: "info",
        icon: SERVER_ICON[n.category] || "fa-bell",
        title: n.title,
        body: n.message,
        href: n.link || "",
        when: n.ts || n.date,
      });
    });

    out.sort((a, b) => b.ts - a.ts || b.order - a.order);

    return out;
  }

  function getFeed() {
    if (!enabled) return [];

    const st = loadState();

    return buildFeed()
      .filter((n) => !st.dismissed[n.id])
      .map((n) => {
        n.read = !!st.read[n.id];
        return n;
      });
  }

  function counts(feed) {
    const list = feed || getFeed();
    const weekAgo = Date.now() - 7 * 86400000;

    return {
      all: list.length,
      unread: list.filter((n) => !n.read).length,
      points: list.filter((n) => n.cat === "points").length,
      collection: list.filter((n) => n.cat === "collection").length,
      rewards: list.filter((n) => n.cat === "rewards").length,
      week: list.filter((n) => n.ts >= weekAgo).length,
    };
  }

  /* ---------- Actions ---------- */

  function markRead(id) {
    if (!enabled) return;

    const st = loadState();

    if (st.read[id]) return;

    st.read[id] = 1;
    saveState(st);

    // Server-backed rows keep their read state in MySQL so it follows
    // the account to another device.
    if (String(id).indexOf("n:") === 0 && window.EcoApi) {
      window.EcoApi.patch("/api/notifications/" + String(id).slice(2) + "/read", {}).catch(function () {});
    }

    tick(true);
  }

  function markAllRead() {
    if (!enabled) return;

    const feed = getFeed();
    const st = loadState();

    feed.forEach((n) => {
      st.read[n.id] = 1;
    });

    saveState(st);

    const role = serverRole();
    const sid = serverId();

    if (role && window.EcoApi) {
      window.EcoApi.post("/api/notifications/read-all", {
        role: role,
        recipient_id: sid,
      }).catch(function () {});
    }

    tick(true);
  }

  function dismiss(id) {
    if (!enabled) return;

    const st = loadState();

    st.dismissed[id] = 1;
    st.read[id] = 1;
    saveState(st);
    tick(true);
  }

  function dismissAll() {
    if (!enabled) return;

    const feed = getFeed();
    const st = loadState();

    feed.forEach((n) => {
      st.dismissed[n.id] = 1;
      st.read[n.id] = 1;
    });

    saveState(st);
    tick(true);
  }

  function nextReward() {
    const catalog = (window.REWARD_CATALOG || []).slice().sort((a, b) => a.cost - b.cost);
    const balance = typeof window.getPoints === "function" ? Number(window.getPoints()) || 0 : 0;
    const next = catalog.filter((r) => balance < r.cost)[0] || null;

    return {
      balance: balance,
      next: next,
      remaining: next ? next.cost - balance : 0,
      pct: next ? Math.min(100, Math.round((balance / next.cost) * 100)) : 100,
      affordable: catalog.filter((r) => balance >= r.cost).length,
      total: catalog.length,
    };
  }

  /* ---------- Rendering ---------- */

  function itemHTML(n, opts, animIndex) {
    const style = animIndex >= 0 ? ' style="--i:' + Math.min(animIndex, 12) + '"' : "";
    const anim = animIndex >= 0 ? " eco-n-in" : "";
    const go =
      opts.showLink && n.href
        ? '<a class="eco-n-go" href="' + esc(n.href) + '">View <i class="fa-solid fa-arrow-right"></i></a>'
        : "";
    const x = opts.dismissable
      ? '<button type="button" class="eco-n-x" data-dismiss aria-label="Dismiss notification"><i class="fa-solid fa-xmark"></i></button>'
      : "";

    return (
      '<div class="eco-n' +
      (n.read ? "" : " unread") +
      " cat-" +
      n.cat +
      " tone-" +
      n.tone +
      anim +
      '" data-id="' +
      esc(n.id) +
      '" role="button" tabindex="0"' +
      style +
      ">" +
      '<div class="eco-n-icon"><i class="fa-solid ' +
      esc(n.icon) +
      '"></i></div>' +
      '<div class="eco-n-main">' +
      '<span class="eco-n-title">' +
      esc(n.title) +
      "</span>" +
      (n.body ? '<span class="eco-n-body">' + esc(n.body) + "</span>" : "") +
      '<span class="eco-n-meta"><span class="eco-n-cat">' +
      esc(CATEGORIES[n.cat].label) +
      "</span> \u00b7 " +
      esc(timeLabel(n)) +
      go +
      "</span>" +
      "</div>" +
      x +
      '<span class="eco-n-dot" aria-hidden="true"></span>' +
      "</div>"
    );
  }

  function emptyHTML(hasAny, opts) {
    if (hasAny) {
      return (
        '<div class="eco-empty"><i class="fa-solid fa-magnifying-glass"></i>' +
        "<strong>Nothing matches</strong><span>Try another filter or search word.</span></div>"
      );
    }

    return (
      '<div class="eco-empty"><i class="fa-regular fa-bell-slash"></i>' +
      "<strong>You're all caught up</strong>" +
      "<span>" +
      esc(opts.emptyText || "Bring recyclables on your collection day to see your activity here.") +
      "</span></div>"
    );
  }

  /* Draws the feed into `host` and keeps it up to date. */
  function mountList(host, options) {
    const opts = options || {};
    let filter = opts.filter || "all";
    let query = String(opts.search || "").toLowerCase();

    if (!host) return { setFilter() {}, setSearch() {} };

    function visible(feed) {
      return feed.filter((n) => {
        if (filter === "unread" && n.read) return false;
        if (filter !== "all" && filter !== "unread" && n.cat !== filter) return false;
        if (query && (n.title + " " + n.body).toLowerCase().indexOf(query) === -1) return false;

        return true;
      });
    }

    function render(feed, animate) {
      let list = visible(feed);

      if (opts.limit) list = list.slice(0, opts.limit);

      if (!list.length) {
        host.innerHTML = emptyHTML(feed.length > 0, opts);
        return;
      }

      let html = "";
      let lastGroup = null;

      list.forEach((n, index) => {
        if (opts.group) {
          const group = groupOf(n);

          if (group !== lastGroup) {
            html += '<div class="eco-group-label">' + group + "</div>";
            lastGroup = group;
          }
        }

        html += itemHTML(n, opts, animate ? index : -1);
      });

      host.innerHTML = '<div class="eco-list' + (opts.compact ? " compact" : "") + '">' + html + "</div>";
    }

    function activate(row, e) {
      const id = row.getAttribute("data-id");

      if (e && e.target.closest("[data-dismiss]")) {
        e.stopPropagation();
        row.classList.add("out");
        setTimeout(() => dismiss(id), 220);
        return;
      }

      if (e && e.target.closest("a")) {
        markRead(id);
        return;
      }

      markRead(id);

      if (opts.navigate) {
        const n = getFeed().filter((item) => item.id === id)[0];

        if (n && n.href) window.location.href = n.href;
      }
    }

    host.addEventListener("click", (e) => {
      const row = e.target.closest(".eco-n");

      if (row) activate(row, e);
    });

    host.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;

      const row = e.target.closest && e.target.closest(".eco-n");

      if (row && e.target === row) {
        e.preventDefault();
        activate(row, null);
      }
    });

    subscribers.push((feed) => render(feed, false));
    render(getFeed(), true);

    return {
      setFilter(value) {
        filter = value || "all";
        render(getFeed(), true);
      },
      setSearch(value) {
        query = String(value || "").toLowerCase();
        render(getFeed(), true);
      },
    };
  }

  /* ---------- Bell, badge, toasts ---------- */

  function updateChrome(feed) {
    const unread = feed.filter((n) => !n.read).length;

    document
      .querySelectorAll('.nav-item[data-label="Notifications"] .nav-badge, a[href="Notifications.html"] .nav-badge')
      .forEach((badge) => {
        if (unread > 0) {
          badge.textContent = unread > 99 ? "99+" : String(unread);
          badge.style.display = "";
        } else {
          badge.style.display = "none";
        }
      });

    if (bellEl) {
      let pill = bellEl.querySelector(".eco-bell-count");

      if (!pill) {
        pill = document.createElement("span");
        pill.className = "eco-bell-count";
        bellEl.appendChild(pill);
      }

      pill.textContent = unread > 99 ? "99+" : String(unread);
      pill.style.display = unread > 0 ? "" : "none";

      // A number replaces the plain dot the markup ships with, so tell the
      // stylesheet about it.
      if (unread > 0) {
        bellEl.classList.add("has-count");
      } else {
        bellEl.classList.remove("has-count");
      }

      bellEl.setAttribute("aria-label", unread > 0 ? "Notifications, " + unread + " unread" : "Notifications");
    }

    document.title = (unread > 0 ? "(" + unread + ") " : "") + baseTitle;

    if (popEl) {
      const sub = popEl.querySelector(".eco-pop-sub");
      const all = popEl.querySelector('[data-act="markall"]');

      if (sub) sub.textContent = unread > 0 ? unread + " unread" : "All caught up";
      if (all) all.disabled = unread === 0;
    }
  }

  function ringBell() {
    if (!bellEl) return;

    bellEl.classList.remove("eco-ring");
    void bellEl.offsetWidth;
    bellEl.classList.add("eco-ring");
  }

  function toastHost() {
    let host = document.getElementById("ecoToasts");

    if (!host) {
      host = document.createElement("div");
      host.id = "ecoToasts";
      host.className = "eco-toasts";
      host.setAttribute("aria-live", "polite");
      document.body.appendChild(host);
    }

    return host;
  }

  function showToast(n) {
    const toast = document.createElement("div");

    toast.className = "eco-toast eco-n cat-" + n.cat + " tone-" + n.tone;
    toast.innerHTML =
      '<div class="eco-n-icon"><i class="fa-solid ' +
      esc(n.icon) +
      '"></i></div>' +
      '<div class="eco-n-main"><span class="eco-n-title">' +
      esc(n.title) +
      "</span>" +
      (n.body ? '<span class="eco-n-body">' + esc(n.body) + "</span>" : "") +
      "</div>" +
      '<button type="button" class="eco-n-x eco-toast-x" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
      '<i class="eco-toast-bar"></i>';

    function remove() {
      toast.classList.add("out");
      setTimeout(() => toast.remove(), 260);
    }

    toast.addEventListener("click", (e) => {
      if (e.target.closest(".eco-toast-x")) {
        remove();
        return;
      }

      if (!/Notifications\.html$/i.test(window.location.pathname)) {
        window.location.href = "Notifications.html";
      } else {
        remove();
      }
    });

    toastHost().appendChild(toast);
    setTimeout(remove, TOAST_MS);
  }

  function detectNew(feed) {
    if (document.visibilityState === "hidden") return;

    const st = loadState();
    const ids = {};

    feed.forEach((n) => {
      ids[n.id] = 1;
    });

    if (!st.known) {
      st.known = ids;
      saveState(st);
      return;
    }

    const fresh = feed.filter((n) => !st.known[n.id] && !n.read);

    Object.keys(ids).forEach((key) => {
      st.known[key] = 1;
    });

    saveState(st);

    if (!fresh.length) return;

    ringBell();

    if (fresh.length <= 2) {
      fresh.forEach(showToast);
    } else {
      showToast({
        cat: "points",
        tone: "info",
        icon: "fa-bell",
        title: fresh.length + " new notifications",
        body: "Latest: " + fresh[0].title,
      });
    }
  }

  /* ---------- Refresh loop ---------- */

  function tick(force) {
    if (!enabled) return;

    const feed = getFeed();
    const points = typeof window.getPoints === "function" ? window.getPoints() : 0;
    const sig = points + "#" + feed.map((n) => n.id + (n.read ? 1 : 0)).join("|");
    const changed = sig !== lastSig;

    if (!force && !changed) return;

    lastSig = sig;

    detectNew(feed);
    updateChrome(feed);

    subscribers.slice().forEach((fn) => {
      try {
        fn(feed);
      } catch (e) {}
    });
  }

  /* ---------- Bell dropdown ---------- */

  function placePop() {
    const rect = bellEl.getBoundingClientRect();

    popEl.style.top = rect.bottom + 10 + "px";

    if (window.innerWidth <= 600) {
      popEl.style.left = "12px";
      popEl.style.right = "12px";
      popEl.style.width = "auto";
    } else {
      popEl.style.left = "auto";
      popEl.style.width = "390px";
      popEl.style.right = Math.max(12, window.innerWidth - rect.right - 8) + "px";
    }
  }

  function openPop() {
    placePop();
    popEl.classList.add("open");

    if (popList) popList.setFilter("all");

    bellEl.setAttribute("aria-expanded", "true");
  }

  function closePop() {
    popEl.classList.remove("open");
    bellEl.setAttribute("aria-expanded", "false");
  }

  function initBell() {
    bellEl = document.getElementById("bellBtn");

    if (!bellEl) return;

    document.documentElement.classList.add("eco-notif-on");

    popEl = document.createElement("div");
    popEl.className = "eco-pop";
    popEl.setAttribute("role", "dialog");
    popEl.setAttribute("aria-label", "Notifications");
    popEl.innerHTML =
      '<div class="eco-pop-head">' +
      '<div><strong>Notifications</strong><span class="eco-pop-sub"></span></div>' +
      '<button type="button" class="eco-pop-link" data-act="markall"><i class="fa-solid fa-check-double"></i> Mark all read</button>' +
      "</div>" +
      '<div class="eco-pop-body"></div>' +
      '<a class="eco-pop-foot" href="Notifications.html">See all notifications <i class="fa-solid fa-arrow-right"></i></a>';

    document.body.appendChild(popEl);

    popList = mountList(popEl.querySelector(".eco-pop-body"), {
      limit: 6,
      compact: true,
      navigate: true,
      emptyText: "New activity will show up here.",
    });

    popEl.querySelector('[data-act="markall"]').addEventListener("click", markAllRead);

    bellEl.setAttribute("aria-haspopup", "dialog");
    bellEl.setAttribute("aria-expanded", "false");

    bellEl.addEventListener("click", (e) => {
      e.stopPropagation();

      if (popEl.classList.contains("open")) {
        closePop();
      } else {
        openPop();
      }
    });

    document.addEventListener("click", (e) => {
      if (popEl.classList.contains("open") && !popEl.contains(e.target) && !bellEl.contains(e.target)) {
        closePop();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePop();
    });

    window.addEventListener("resize", () => {
      if (popEl.classList.contains("open")) placePop();
    });
  }

  /* ---------- Styles ---------- */

  const CSS = `
  html.eco-notif-on .bell-btn .dot{display:none}
  .eco-bell-count{position:absolute;top:1px;right:-1px;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:var(--orange,#FF9D4D);color:#fff;font:800 10px/15px var(--font-body,inherit);text-align:center;border:2px solid var(--white,#fff);box-sizing:border-box;box-shadow:0 2px 6px rgba(255,157,77,.5)}
  .bell-btn.eco-ring i{animation:ecoRing 1.1s ease both;transform-origin:50% 0}
  @keyframes ecoRing{0%,100%{transform:rotate(0)}12%{transform:rotate(16deg)}24%{transform:rotate(-14deg)}36%{transform:rotate(10deg)}48%{transform:rotate(-7deg)}60%{transform:rotate(3deg)}}

  .eco-pop{position:fixed;top:64px;right:16px;width:390px;max-width:calc(100vw - 24px);background:var(--white,#fff);border:1px solid var(--border,#eaeaea);border-radius:18px;box-shadow:0 18px 50px rgba(46,63,22,.2);z-index:500;display:none;overflow:hidden}
  .eco-pop.open{display:block;animation:ecoPop .2s ease both;transform-origin:top right}
  @keyframes ecoPop{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:none}}
  .eco-pop-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px 12px;border-bottom:1px solid var(--border,#eaeaea)}
  .eco-pop-head strong{display:block;font-family:var(--font-heading,serif);font-size:17px;color:var(--dark-green,#2E3F16)}
  .eco-pop-sub{display:block;font-size:12px;font-weight:700;color:var(--muted,#7a7a7a);margin-top:1px}
  .eco-pop-link{border:0;background:none;color:var(--primary-green,#769826);font:800 12.5px var(--font-body,inherit);cursor:pointer;padding:6px 8px;border-radius:8px}
  .eco-pop-link:hover:not(:disabled){background:rgba(118,152,38,.1)}
  .eco-pop-link:disabled{opacity:.4;cursor:default}
  .eco-pop-body{max-height:min(420px,60vh);overflow-y:auto;padding:8px}
  .eco-pop-foot{display:flex;align-items:center;justify-content:center;gap:8px;padding:13px;border-top:1px solid var(--border,#eaeaea);background:var(--light-gray,#f5f5f5);color:var(--primary-green,#769826);font-weight:800;font-size:13px}
  .eco-pop-foot:hover{background:rgba(118,152,38,.1)}

  .eco-list{display:flex;flex-direction:column;gap:4px}
  .eco-group-label{display:flex;align-items:center;gap:12px;margin:14px 4px 6px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#7a7a7a)}
  .eco-group-label:first-child{margin-top:2px}
  .eco-group-label::after{content:"";flex:1;height:1px;background:var(--border,#eaeaea)}

  .eco-n{position:relative;display:flex;align-items:flex-start;gap:14px;padding:14px 16px 14px 14px;border-radius:16px;cursor:pointer;transition:background .2s ease,transform .2s ease,opacity .22s ease,box-shadow .2s ease;text-align:left}
  .eco-n:hover{background:var(--light-gray,#f5f5f5);transform:translateX(3px)}
  .eco-n:focus-visible{outline:3px solid var(--orange,#FF9D4D);outline-offset:1px}
  .eco-n.unread{background:rgba(118,152,38,.08)}
  .eco-n.unread:hover{background:rgba(118,152,38,.14)}
  .eco-n.unread::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:0 3px 3px 0;background:var(--primary-green,#769826)}
  .eco-n.out{opacity:0;transform:translateX(30px)}
  .eco-n-in{animation:ecoIn .42s cubic-bezier(.2,.8,.3,1) both;animation-delay:calc(var(--i,0) * 45ms)}
  @keyframes ecoIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

  .eco-n-icon{width:44px;height:44px;flex:0 0 44px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:17px;color:#fff;background:linear-gradient(135deg,var(--light-green,#A1CB35),var(--primary-green,#769826));box-shadow:0 6px 14px rgba(118,152,38,.28)}
  .cat-collection .eco-n-icon{background:linear-gradient(135deg,#6f8f2a,var(--dark-green,#2E3F16));box-shadow:0 6px 14px rgba(46,63,22,.28)}
  .cat-rewards .eco-n-icon{background:linear-gradient(135deg,#ffb877,var(--orange,#FF9D4D));box-shadow:0 6px 14px rgba(255,157,77,.34)}
  .tone-warn .eco-n-icon{background:linear-gradient(135deg,#f39a8f,var(--danger,#E15C4E));box-shadow:0 6px 14px rgba(225,92,78,.3)}

  .eco-n-main{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
  .eco-n-title{font-weight:800;font-size:14px;color:var(--dark-text,#333);line-height:1.35}
  .eco-n.unread .eco-n-title{color:var(--dark-green,#2E3F16)}
  .eco-n-body{font-size:13px;color:var(--muted,#7a7a7a);line-height:1.5}
  .eco-n-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px;font-size:11.5px;font-weight:700;color:#9a9a9a;margin-top:2px}
  .eco-n-cat{color:var(--primary-green,#769826);text-transform:uppercase;letter-spacing:.05em;font-size:10.5px}
  .eco-n-go{margin-left:auto;display:inline-flex;align-items:center;gap:5px;color:var(--primary-green,#769826);font-weight:800;font-size:12px;opacity:0;transition:opacity .2s ease}
  .eco-n:hover .eco-n-go,.eco-n:focus-within .eco-n-go{opacity:1}
  .eco-n-dot{width:9px;height:9px;flex:0 0 9px;border-radius:50%;background:var(--orange,#FF9D4D);box-shadow:0 0 0 4px rgba(255,157,77,.2);margin-top:6px;visibility:hidden}
  .eco-n.unread .eco-n-dot{visibility:visible}

  .eco-n-x{position:absolute;top:8px;right:8px;width:26px;height:26px;border:0;border-radius:50%;background:transparent;color:#a0a0a0;font-size:12px;cursor:pointer;opacity:0;transition:opacity .2s ease,background .2s ease,color .2s ease}
  .eco-n:hover .eco-n-x,.eco-n-x:focus-visible{opacity:1}
  .eco-n-x:hover{background:rgba(225,92,78,.12);color:var(--danger,#E15C4E)}
  @media (hover:none){.eco-n-x{opacity:1}.eco-n-go{opacity:1}}
  .eco-n-x ~ .eco-n-dot{margin-right:24px}

  .eco-list.compact .eco-n{padding:11px 12px}
  .eco-list.compact .eco-n-icon{width:38px;height:38px;flex-basis:38px;font-size:15px;border-radius:12px}
  .eco-list.compact .eco-n-body{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12.5px}
  .eco-list.compact .eco-n-go{display:none}

  .eco-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:44px 20px;color:var(--muted,#7a7a7a)}
  .eco-empty i{font-size:34px;color:var(--primary-green,#769826);opacity:.55;margin-bottom:6px}
  .eco-empty strong{color:var(--dark-text,#333);font-size:15px}
  .eco-empty span{font-size:13px;max-width:300px;line-height:1.5}

  .eco-links{display:flex;align-items:center;gap:16px}

  .eco-toasts{position:fixed;top:78px;right:20px;width:360px;max-width:calc(100vw - 24px);display:flex;flex-direction:column;gap:10px;z-index:600;pointer-events:none}
  .eco-toast{pointer-events:auto;background:var(--white,#fff);border:1px solid var(--border,#eaeaea);box-shadow:0 14px 40px rgba(46,63,22,.22);overflow:hidden;animation:ecoToastIn .4s cubic-bezier(.2,.9,.3,1.2) both}
  .eco-toast.eco-n:hover{background:var(--white,#fff)}
  .eco-toast .eco-n-x{opacity:1}
  .eco-toast.out{opacity:0;transform:translateX(40px)}
  .eco-toast-bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg,var(--light-green,#A1CB35),var(--primary-green,#769826));transform-origin:left;animation:ecoBar ${TOAST_MS}ms linear forwards}
  @keyframes ecoToastIn{from{opacity:0;transform:translateX(60px) scale(.96)}to{opacity:1;transform:none}}
  @keyframes ecoBar{from{transform:scaleX(1)}to{transform:scaleX(0)}}

  @media (max-width:600px){.eco-toasts{right:12px;left:12px;width:auto}}
  @media (prefers-reduced-motion:reduce){.eco-n-in,.eco-toast,.eco-pop.open,.bell-btn.eco-ring i,.eco-toast-bar{animation:none}.eco-n{transition:none}}
  `;

  function injectStyles() {
    if (document.getElementById("ecoNotifStyles")) return;

    const style = document.createElement("style");

    style.id = "ecoNotifStyles";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ---------- Start up ---------- */

  const session = readSession();

  enabled =
    !!session &&
    (!session.role || session.role === "resident") &&
    typeof window.getUserId === "function";

  if (enabled) {
    uid = String(window.getUserId());
  }

  // Exposed so api-client.js can await the first load alongside the
  // other hydration steps, instead of the bell repainting later.
  window.EcoNotifsLoad = loadServerNotifications;

  window.EcoNotifs = {
    enabled: enabled,
    getFeed: getFeed,
    counts: counts,
    unreadCount: () => getFeed().filter((n) => !n.read).length,
    markRead: markRead,
    markAllRead: markAllRead,
    dismiss: dismiss,
    dismissAll: dismissAll,
    mountList: mountList,
    nextReward: nextReward,
    refresh: () => tick(true),
    subscribe(fn) {
      subscribers.push(fn);

      if (enabled) fn(getFeed());

      return () => {
        const at = subscribers.indexOf(fn);

        if (at > -1) subscribers.splice(at, 1);
      };
    },
  };

  window.getUnreadNotifCount = window.EcoNotifs.unreadCount;

  function start() {
    injectStyles();

    if (!enabled) return;

    baseTitle = document.title;

    initBell();
    tick(true);

    setInterval(() => tick(false), POLL_MS);
    setInterval(() => tick(true), 60000);

    window.addEventListener("storage", (e) => {
      if (!e.key || /^eco/i.test(e.key)) tick(true);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") tick(true);
    });

    if (counts().unread > 0) setTimeout(ringBell, 700);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
