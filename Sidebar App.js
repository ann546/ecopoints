const COLLECTOR_PAGES = new Set([
  "Collector Dashboard.html",
  "QR Code Scanner.html",
  "Collector Collection Schedule.html",
  "Waste Verification.html",
  "Collection History.html",
  "Resident EcoPoints Records.html",
  "Points Redemption.html",
  "Collector Notifications.html",
  "Collector Profile.html",
]);

function getCurrentPageName() {
  return decodeURIComponent(window.location.pathname.split("/").pop() || "");
}

function readCurrentSession() {
  try {
    const localSession = EcoSession();

    if (localSession) {
      if (localSession.expiresAt && Date.now() > localSession.expiresAt) {
        localStorage.removeItem("ecoUser");
        return null;
      }

      return localSession;
    }
  } catch {}

  try {
    const sessionSession = JSON.parse(sessionStorage.getItem("ecoUser"));

    return sessionSession || null;
  } catch {
    return null;
  }
}

function guardCollectorPage() {
  const pageName = getCurrentPageName();

  if (!COLLECTOR_PAGES.has(pageName)) {
    return;
  }

  const session = readCurrentSession();

  if (!session) {
    window.location.replace("Collector Login.html");
    return;
  }

  if (session.role !== "collector") {
    window.location.replace("Main Page.html");
  }
}

guardCollectorPage();

function renderCollectorSidebar() {
  const pageName = getCurrentPageName();
  const sidebar = document.getElementById("sidebar");

  if (!sidebar || !COLLECTOR_PAGES.has(pageName)) {
    return;
  }

  const sideNav = sidebar.querySelector(".side-nav");

  if (!sideNav) {
    return;
  }

  const sections = [
    {
      title: "",
      items: [
        {
          file: "Collector Dashboard.html",
          label: "Dashboard",
          icon: "fa-grid-2",
        },
      ],
    },
    {
      title: "COLLECTION",
      items: [
        {
          file: "QR Code Scanner.html",
          label: "QR Code Scanner",
          icon: "fa-qrcode",
        },
        {
          file: "Collector Collection Schedule.html",
          label: "Collection Schedule",
          icon: "fa-calendar-days",
        },
        {
          file: "Collection History.html",
          label: "Collection History",
          icon: "fa-clock-rotate-left",
        },
      ],
    },
    {
      title: "ECOPOINTS",
      items: [
        {
          file: "Resident EcoPoints Records.html",
          label: "Resident EcoPoints Records",
          icon: "fa-address-book",
        },
      ],
    },
    {
      title: "ACCOUNT",
      items: [
        {
          file: "Collector Notifications.html",
          label: "Notifications",
          icon: "fa-bell",
        },
        {
          file: "Collector Profile.html",
          label: "Profile",
          icon: "fa-user",
        },
        {
          file: "#",
          label: "Settings",
          icon: "fa-gear",
          restricted: true,
        },
      ],
    },
  ];

  let html = "";

  sections.forEach((section) => {
    if (section.title) {
      html += `
                <div class="nav-section-title">
                    ${section.title}
                </div>
            `;
    }

    section.items.forEach((item) => {
      const active = item.file === pageName;

      if (item.restricted) {
        html += `
                    <a href="#"
                       class="nav-item restricted-nav-item"
                       data-label="${item.label}">
                        <i class="fa-solid ${item.icon}"></i>
                        <span>${item.label}</span>
                    </a>
                `;

        return;
      }

      html += `
                <a href="${item.file}"
                   class="nav-item${active ? " active" : ""}"
                   data-label="${item.label}">
                    <i class="fa-solid ${item.icon}"></i>
                    <span>${item.label}</span>
                    ${
                      item.file === "Collector Notifications.html"
                        ? '<span class="nav-badge" data-collector-badge style="display:none;">0</span>'
                        : ""
                    }
                </a>
            `;
    });
  });

  sideNav.innerHTML = html;

  const existingLogout = sidebar.querySelector(".logout");

  if (existingLogout) {
    existingLogout.remove();
  }

  const logoutItem = document.createElement("a");

  logoutItem.href = "Collector Login.html";
  logoutItem.className = "nav-item logout";
  logoutItem.dataset.label = "Logout";

  logoutItem.innerHTML = `
        <i class="fa-solid fa-right-from-bracket"></i>
        <span>Logout</span>
    `;

  sidebar.appendChild(logoutItem);

  const restrictedSettings = sideNav.querySelector(".restricted-nav-item");

  if (restrictedSettings) {
    restrictedSettings.addEventListener("click", (event) => {
      event.preventDefault();

      alert("Settings are managed by the Admin.");
    });
  }

  logoutItem.addEventListener("click", (event) => {
    event.preventDefault();

    if (!confirm("Are you sure you want to log out?")) {
      return;
    }

    localStorage.removeItem("ecoUser");
    sessionStorage.removeItem("ecoUser");

    window.location.href = "Collector Login.html";
  });

}


renderCollectorSidebar();

function syncTopbarIdentity() {
  const avatarEls = document.querySelectorAll(".profile-btn .avatar");

  const nameEls = document.querySelectorAll(".profile-name");

  const session = readCurrentSession();

  if (session && session.fname && session.lname) {
    const initials =
      `${session.fname[0] || ""}${session.lname[0] || ""}`.toUpperCase();

    const name = `${session.fname} ${session.lname}`;

    avatarEls.forEach((element) => {
      element.textContent = initials;
    });

    nameEls.forEach((element) => {
      element.textContent = name;
    });

    return;
  }

  if (typeof getUserName === "function") {
    const fallbackName = getUserName();

    const parts = fallbackName.trim().split(" ").filter(Boolean);

    const initials = (
      (parts[0] || "")[0] + (parts[parts.length - 1] || "")[0]
    ).toUpperCase();

    avatarEls.forEach((element) => {
      element.textContent = initials;
    });

    nameEls.forEach((element) => {
      element.textContent = fallbackName;
    });
  }
}

syncTopbarIdentity();

const sidebar = document.getElementById("sidebar");

const sidebarOverlay = document.getElementById("sidebarOverlay");

const menuToggle = document.getElementById("menuToggle");

function openSidebar() {
  if (sidebar) {
    sidebar.classList.add("show");
  }

  if (sidebarOverlay) {
    sidebarOverlay.classList.add("show");
  }
}

function closeSidebar() {
  if (sidebar) {
    sidebar.classList.remove("show");
  }

  if (sidebarOverlay) {
    sidebarOverlay.classList.remove("show");
  }
}

if (menuToggle) {
  menuToggle.addEventListener("click", openSidebar);
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", closeSidebar);
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", closeSidebar);
});

const profileBtn = document.getElementById("profileBtn");

const profileDropdown = document.getElementById("profileDropdown");

if (profileBtn && profileDropdown) {
  profileBtn.addEventListener("click", (event) => {
    event.stopPropagation();

    profileDropdown.classList.toggle("show");
  });

  document.addEventListener("click", (event) => {
    if (
      !profileDropdown.contains(event.target) &&
      event.target !== profileBtn
    ) {
      profileDropdown.classList.remove("show");
    }
  });
}

const bellBtn = document.getElementById("bellBtn");

if (bellBtn) {
  if (COLLECTOR_PAGES.has(getCurrentPageName())) {
    bellBtn.addEventListener("click", () => {
      const list = document.querySelector(".notification-list");

      if (list) {
        list.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      } else {
        window.location.href = "Collector Notifications.html";
      }
    });
  } else if (!window.EcoNotifs) {
    // Resident pages: Notification Center.js opens the bell dropdown.
    // If that script isn't on the page, fall back to the resident
    // Notifications page (this used to send residents to the collector page).
    bellBtn.addEventListener("click", () => {
      window.location.href = "Notifications.html";
    });
  }
}

/* ---------- Collector unread indicator ----------
   Residents already see a count beside Notifications; collectors only had
   an inert dot, so an assigned substitute duty looked the same as an
   ordinary day. This mirrors the resident behaviour: a number in the
   sidebar and on the header bell. */

function paintCollectorBadge(unread) {
  const label = unread > 99 ? "99+" : String(unread);

  document.querySelectorAll("[data-collector-badge]").forEach((badge) => {
    badge.textContent = label;
    badge.style.display = unread > 0 ? "" : "none";
  });

  // The generated sidebar is rebuilt on every page load, but a page can
  // still be holding the hardcoded markup.
  document
    .querySelectorAll(
      '.nav-item[data-label="Notifications"] .nav-badge, a[href="Collector Notifications.html"] .nav-badge',
    )
    .forEach((badge) => {
      badge.textContent = label;
      badge.style.display = unread > 0 ? "" : "none";
    });

  if (!bellBtn) return;

  let pill = bellBtn.querySelector(".eco-bell-count");

  if (!pill) {
    pill = document.createElement("span");
    pill.className = "eco-bell-count";
    bellBtn.appendChild(pill);
  }

  pill.textContent = label;
  pill.style.display = unread > 0 ? "" : "none";

  // A number replaces the plain dot, so tell the stylesheet about it.
  if (unread > 0) {
    bellBtn.classList.add("has-count");
  } else {
    bellBtn.classList.remove("has-count");
  }

  bellBtn.setAttribute(
    "aria-label",
    unread > 0 ? "Notifications, " + unread + " unread" : "Notifications",
  );
}

async function refreshCollectorBadge() {
  if (!COLLECTOR_PAGES.has(getCurrentPageName())) return;

  const collectorId = window.EcoApi ? window.EcoApi.collectorId() : null;
  if (!collectorId) return;

  try {
    const res = await window.EcoApi.get(
      "/api/notifications?role=collector&recipient_id=" + collectorId,
    );

    if (!res || !res.success || !Array.isArray(res.notifications)) return;

    paintCollectorBadge(res.notifications.filter((n) => !n.read).length);
  } catch {
    // An unreachable server just leaves the badge hidden.
  }
}

if (COLLECTOR_PAGES.has(getCurrentPageName())) {
  // This file is the last script on the page, so DOMContentLoaded has
  // usually already fired by the time it runs. Run once straight away as
  // well as on the hydration events the bridge dispatches.
  refreshCollectorBadge();

  document.addEventListener("DOMContentLoaded", refreshCollectorBadge);
  document.addEventListener("eco:hydrated", refreshCollectorBadge);
  document.addEventListener("eco:bridge-synced", refreshCollectorBadge);
}


function bindProfileDropdownLogout() {
  const pageName = getCurrentPageName();

  if (!COLLECTOR_PAGES.has(pageName)) {
    return;
  }

  document.querySelectorAll(".profile-dropdown a").forEach((link) => {
    const hrefIsRegistration = link.getAttribute("href") === "Registration.html";
    const looksLikeLogout = /logout/i.test(link.textContent || "");

    if (!hrefIsRegistration && !looksLikeLogout) {
      return;
    }

    link.addEventListener("click", (event) => {
      event.preventDefault();

      if (!confirm("Are you sure you want to log out?")) {
        return;
      }

      localStorage.removeItem("ecoUser");
      sessionStorage.removeItem("ecoUser");

      window.location.href = "Collector Login.html";
    });
  });
}

bindProfileDropdownLogout();

/* ---------- Resident-page logout confirmation ----------
   Collector pages already get a confirm-before-logout prompt from
   renderCollectorSidebar() (dynamically built sidebar) and
   bindProfileDropdownLogout() above. Resident pages use a static
   sidebar logout link and their own static profile dropdown, so
   neither of those functions touch them (both bail out early via
   COLLECTOR_PAGES.has(pageName)). This adds the same "Are you sure
   you want to log out?" confirmation for every resident page that
   loads Sidebar App.js, covering both the sidebar's ".nav-item.logout"
   link and any "Logout" link inside a ".profile-dropdown". */
function bindResidentLogoutConfirmation() {
  const pageName = getCurrentPageName();

  if (COLLECTOR_PAGES.has(pageName)) {
    return;
  }

  const logoutLinks = document.querySelectorAll(
    "a.nav-item.logout, .profile-dropdown a",
  );

  logoutLinks.forEach((link) => {
    const hrefIsRegistration = link.getAttribute("href") === "Registration.html";
    const looksLikeLogout =
      link.classList.contains("logout") || /logout/i.test(link.textContent || "");

    if (!hrefIsRegistration && !looksLikeLogout) {
      return;
    }

    if (link.dataset.logoutConfirmBound) {
      return;
    }

    link.dataset.logoutConfirmBound = "1";

    link.addEventListener("click", (event) => {
      event.preventDefault();

      if (!confirm("Are you sure you want to log out?")) {
        return;
      }

      localStorage.removeItem("ecoUser");
      sessionStorage.removeItem("ecoUser");

      window.location.href = "Registration.html";
    });
  });
}

bindResidentLogoutConfirmation();