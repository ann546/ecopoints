const PROFILE_SESSION_KEY = "ecoUser";

const profileForm = document.getElementById("profileForm");
const passwordForm = document.getElementById("passwordForm");
const logoutBtn = document.getElementById("logoutBtn");

const profileNote = document.getElementById("profileNote");
const passwordNote = document.getElementById("passwordNote");

const firstName = document.getElementById("firstName");
const lastName = document.getElementById("lastName");
const email = document.getElementById("email");
const phone = document.getElementById("phone");

const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");

const firstNameError = document.getElementById("firstNameError");
const lastNameError = document.getElementById("lastNameError");
const phoneError = document.getElementById("phoneError");

const currentPasswordError = document.getElementById("currentPasswordError");
const newPasswordError = document.getElementById("newPasswordError");
const confirmPasswordError = document.getElementById("confirmPasswordError");

const passwordStrengthBar = document.getElementById("passwordStrengthBar");
const passwordStrengthLabel = document.getElementById("passwordStrengthLabel");

function readSession() {
  if (window.EcoApi) {
    return window.EcoApi.session();
  }

  if (typeof getSession === "function") {
    return getSession();
  }

  return null;
}

function writeSession(session) {
  const remember = !!session.remember;

  if (typeof setSession === "function") {
    setSession(session, remember);
    return;
  }

  const cleanSession = {
    ...session,
  };

  if (remember) {
    localStorage.setItem(PROFILE_SESSION_KEY, JSON.stringify(cleanSession));

    sessionStorage.removeItem(PROFILE_SESSION_KEY);
  } else {
    sessionStorage.setItem(PROFILE_SESSION_KEY, JSON.stringify(cleanSession));

    localStorage.removeItem(PROFILE_SESSION_KEY);
  }
}

// The signed-in collector, as stored in MySQL. Fetched from
// /api/collectors and refreshed after every save.
let currentCollector = null;

function getCollectorSession() {
  const session = readSession();

  if (!session || session.role !== "collector") {
    window.location.replace("Collector Login.html");

    return null;
  }

  const collectorId = window.EcoApi ? window.EcoApi.collectorId() : null;

  if (!collectorId) {
    window.location.replace("Collector Login.html");

    return null;
  }

  return { session, collectorId };
}

// The database speaks first_name / last_name, so map them onto the
// short field names the DOM helpers below already use.
function mapCollector(row) {
  return {
    ...row,
    fname: row.first_name || "",
    lname: row.last_name || "",
    position: row.position || "Collector",
  };
}

// Shown until the database answers, so the page is never blank.
function collectorFromSession(session) {
  return {
    collector_id: null,
    collector_code: "",
    first_name: session.fname || "",
    last_name: session.lname || "",
    email: session.email || "",
    phone: session.phone || "",
    position: "Collector",
    account_status: "Active",
    group_number: session.groupNumber || null,
    group_name: "",
  };
}

async function fetchCollector(collectorId) {
  const res = await window.EcoApi.get("/api/collectors");

  if (!res || res.offline || !res.success) {
    return { offline: true };
  }

  const row = (res.collectors || []).find(
    (item) => Number(item.collector_id) === Number(collectorId),
  );

  if (!row) {
    return { offline: false, collector: null };
  }

  return { offline: false, collector: row };
}

async function resolveGroupName(groupNumber) {
  if (!groupNumber) {
    return "";
  }

  const res = await window.EcoApi.get("/api/collector-groups");

  if (!res || !res.success) {
    return "";
  }

  const group = (res.groups || []).find(
    (item) => Number(item.group_number) === Number(groupNumber),
  );

  return group && group.group_name ? group.group_name : "";
}

function getAssignedArea(collector) {
  if (collector.group_name) {
    return `Group ${collector.group_number} \u00b7 ${collector.group_name}`;
  }

  return collector.group_number ? `Group ${collector.group_number}` : "Not assigned";
}

function getAccountStatus(collector) {
  return String(collector.account_status || "Active");
}

function setFieldError(input, errorElement, message) {
  input.classList.toggle("invalid", !!message);

  errorElement.textContent = message || "";
}

function clearNotes() {
  profileNote.textContent = "";
  profileNote.className = "form-note";

  passwordNote.textContent = "";
  passwordNote.className = "form-note";
}

function getInitials(collector) {
  const first = String(collector.fname || "E").trim();

  const last = String(collector.lname || "C").trim();

  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

function renderProfile(collector) {
  if (!collector) {
    return;
  }

  const assignedArea = getAssignedArea(collector);

  const status = getAccountStatus(collector);

  const initials = getInitials(collector);

  const name =
    `${collector.fname || ""} ${collector.lname || ""}`.trim() || "EcoPoints Collector";

  firstName.value = collector.fname || "";

  lastName.value = collector.lname || "";

  email.value = collector.email || "";

  phone.value = collector.phone || "";

  document.getElementById("profileName").textContent = name;

  document.getElementById("profileRole").textContent = collector.position;

  document.getElementById("collectorId").textContent =
    collector.collector_code || collector.collector_id || "Not assigned";

  document.getElementById("assignedArea").textContent = assignedArea;

  document.getElementById("accountStatus").textContent = status;

  document.getElementById("profileAvatar").textContent = initials;

  document.getElementById("topbarAvatar").textContent = initials;

  document.getElementById("topbarName").textContent = name;

  const badge = document.getElementById("accountStatusBadge");

  badge.textContent = status;

  badge.classList.toggle("active", status.toLowerCase() === "active");

  badge.classList.toggle("inactive", status.toLowerCase() !== "active");
}

async function loadProfile() {
  const data = getCollectorSession();

  if (!data) {
    return;
  }

  const { session, collectorId } = data;

  // Paint from the session right away so the page is never blank.
  renderProfile(mapCollector(collectorFromSession(session)));

  const result = await fetchCollector(collectorId);

  if (result.offline) {
    currentCollector = null;

    profileNote.className = "form-note error";
    profileNote.textContent =
      "Cannot reach the EcoPoints server. Start it with: npm start";

    return;
  }

  if (!result.collector) {
    currentCollector = null;

    profileNote.className = "form-note error";
    profileNote.textContent = "Your collector account was not found.";

    return;
  }

  currentCollector = mapCollector(result.collector);

  currentCollector.group_name = await resolveGroupName(currentCollector.group_number);

  renderProfile(currentCollector);
}

function updateSessionFromUser(collector, oldSession) {
  writeSession({
    ...oldSession,
    fname: collector.fname,
    lname: collector.lname,
    email: collector.email,
    phone: collector.phone,
    houseNumber: "",
    street: "",
    role: "collector",
    collectorId: collector.collector_id,
    loggedInAt: oldSession.loggedInAt || new Date().toISOString(),
  });
}

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  clearNotes();

  const data = getCollectorSession();

  if (!data) {
    return;
  }

  const { collectorId, session } = data;

  const collector = currentCollector || mapCollector(collectorFromSession(session));

  const fname = firstName.value.trim();

  const lname = lastName.value.trim();

  const phoneValue = phone.value.replace(/\D/g, "");

  let valid = true;

  if (!fname) {
    setFieldError(firstName, firstNameError, "First name is required.");

    valid = false;
  } else if (typeof namePattern !== "undefined" && !namePattern.test(fname)) {
    setFieldError(
      firstName,
      firstNameError,
      "First name must contain letters only.",
    );

    valid = false;
  } else {
    setFieldError(firstName, firstNameError, "");
  }

  if (!lname) {
    setFieldError(lastName, lastNameError, "Last name is required.");

    valid = false;
  } else if (typeof namePattern !== "undefined" && !namePattern.test(lname)) {
    setFieldError(
      lastName,
      lastNameError,
      "Last name must contain letters only.",
    );

    valid = false;
  } else {
    setFieldError(lastName, lastNameError, "");
  }

  if (!phoneValue) {
    setFieldError(phone, phoneError, "Contact number is required.");

    valid = false;
  } else if (phoneValue.length < 11 || phoneValue.length > 12) {
    setFieldError(
      phone,
      phoneError,
      "Contact number must contain 11 or 12 digits.",
    );

    valid = false;
  } else {
    setFieldError(phone, phoneError, "");
  }

  if (!valid) {
    return;
  }

  const res = await window.EcoApi.put(`/api/collectors/${collectorId}`, {
    first_name: fname,
    last_name: lname,
    phone: phoneValue,
    group_number: collector.group_number || null,
  });

  if (!res || res.offline || !res.success) {
    profileNote.className = "form-note error";

    profileNote.textContent =
      (res && res.error) ||
      "Cannot reach the EcoPoints server. Start it with: npm start";

    return;
  }

  // Keep the topbar and the signed-in session in step with the new name.
  updateSessionFromUser(
    { ...collector, fname, lname, phone: phoneValue, collector_id: collectorId },
    session,
  );

  // Re-read from the database so the card shows what was really stored.
  await loadProfile();

  profileNote.className = "form-note success";

  profileNote.textContent = "Profile information updated successfully.";
});

newPassword.addEventListener("input", () => {
  if (typeof passwordScore !== "function") {
    return;
  }

  const score = passwordScore(newPassword.value);

  const strength = [
    ["Use 8+ characters with a number and a symbol", "0%"],
    ["Weak password", "20%"],
    ["Weak password", "35%"],
    ["Fair password", "55%"],
    ["Good password", "80%"],
    ["Strong password", "100%"],
  ][Math.min(score, 5)];

  passwordStrengthBar.style.width = newPassword.value ? strength[1] : "0%";

  passwordStrengthLabel.textContent = newPassword.value
    ? strength[0]
    : "Use 8+ characters with a number and a symbol";
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  passwordNote.textContent = "";

  passwordNote.className = "form-note";

  const data = getCollectorSession();

  if (!data) {
    return;
  }

  const { collectorId } = data;

  let valid = true;

  setFieldError(currentPassword, currentPasswordError, "");

  setFieldError(newPassword, newPasswordError, "");

  setFieldError(confirmPassword, confirmPasswordError, "");

  if (!currentPassword.value) {
    setFieldError(
      currentPassword,
      currentPasswordError,
      "Current password is required.",
    );

    valid = false;
  }

  if (!newPassword.value) {
    setFieldError(newPassword, newPasswordError, "New password is required.");

    valid = false;
  } else if (
    typeof passwordScore === "function" &&
    passwordScore(newPassword.value) < 3
  ) {
    setFieldError(
      newPassword,
      newPasswordError,
      "Password must be at least 8 characters and include a number and a symbol.",
    );

    valid = false;
  }

  if (!confirmPassword.value) {
    setFieldError(
      confirmPassword,
      confirmPasswordError,
      "Please confirm your new password.",
    );

    valid = false;
  } else if (confirmPassword.value !== newPassword.value) {
    setFieldError(
      confirmPassword,
      confirmPasswordError,
      "Passwords do not match.",
    );

    valid = false;
  }

  if (!valid) {
    return;
  }

  // The hash now lives in MySQL, so the server verifies the current
  // password and rewrites it.
  const res = await window.EcoApi.post("/api/change-password", {
    role: "collector",
    user_id: collectorId,
    current_password: currentPassword.value,
    new_password: newPassword.value,
  });

  if (!res || res.offline || !res.success) {
    if (res && res.status === 401) {
      setFieldError(
        currentPassword,
        currentPasswordError,
        res.error || "Current password is incorrect.",
      );

      return;
    }

    passwordNote.className = "form-note error";

    passwordNote.textContent =
      (res && res.error) ||
      "Cannot reach the EcoPoints server. Start it with: npm start";

    return;
  }

  passwordForm.reset();

  passwordStrengthBar.style.width = "0%";

  passwordStrengthLabel.textContent =
    "Use 8+ characters with a number and a symbol";

  passwordNote.className = "form-note success";

  passwordNote.textContent = "Password changed successfully.";
});

document.querySelectorAll(".toggle-pw").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.target);

    if (!target) {
      return;
    }

    const showing = target.type === "text";

    target.type = showing ? "password" : "text";

    button.innerHTML = showing
      ? '<i class="fa-solid fa-eye"></i>'
      : '<i class="fa-solid fa-eye-slash"></i>';
  });
});

phone.addEventListener("input", () => {
  phone.value = phone.value.replace(/\D/g, "").slice(0, 12);
});

logoutBtn.addEventListener("click", () => {
  if (!confirm("Are you sure you want to log out?")) {
    return;
  }

  if (typeof logout === "function") {
    logout("Collector Login.html");

    return;
  }

  localStorage.removeItem(PROFILE_SESSION_KEY);

  sessionStorage.removeItem(PROFILE_SESSION_KEY);

  window.location.href = "Collector Login.html";
});

document.addEventListener("DOMContentLoaded", loadProfile);
/* ---------- My attendance ----------
   Reads the absence history for the signed-in collector so the record is
   on their own profile rather than only on the admin's board. */

function escapeAttendance(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function prettyAttendanceDate(value) {
  const raw = String(value || "").slice(0, 10);
  if (!raw) return "-";

  const parts = raw.split("-");
  if (parts.length !== 3) return raw;

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const month = months[Number(parts[1]) - 1] || parts[1];
  return month + " " + Number(parts[2]) + ", " + parts[0];
}

async function loadAttendance() {
  const summary = document.getElementById("attendanceSummary");
  const list = document.getElementById("attendanceList");
  if (!summary || !list) return;

  const collectorId = window.EcoApi ? window.EcoApi.collectorId() : null;
  if (!collectorId) {
    summary.textContent = "Sign in as a collector to see your attendance.";
    return;
  }

  try {
    const res = await window.EcoApi.get(
      "/api/collector-absences/history?collector_id=" + collectorId
    );

    if (!res || !res.success) throw new Error(res && res.error);

    const rows = res.absences || [];

    if (!rows.length) {
      summary.textContent =
        "No absences recorded. You have been present for every collection day so far.";
      list.innerHTML = "";
      return;
    }

    const withCover = rows.filter(function (r) { return r.substitute_email; }).length;

    summary.innerHTML =
      '<span class="attendance-stat"><strong>' + rows.length + "</strong> " +
      (rows.length === 1 ? "day" : "days") + " absent</span>" +
      '<span class="attendance-stat"><strong>' + withCover + "</strong> " +
      (withCover === 1 ? "day" : "days") + " covered</span>";

    list.innerHTML = rows
      .map(function (r) {
        const cover = r.substitute_email
          ? escapeAttendance(String(r.substitute_email).split("@")[0]) + " covered"
          : '<em class="attendance-none">no substitute</em>';

        return (
          '<div class="attendance-row">' +
          '<span class="attendance-date">' +
          escapeAttendance(prettyAttendanceDate(r.absence_date)) +
          "</span>" +
          '<span class="attendance-group">' +
          escapeAttendance(r.group_name || "Group " + r.group_number) +
          "</span>" +
          '<span class="attendance-cover">' + cover + "</span>" +
          "</div>"
        );
      })
      .join("");
  } catch (error) {
    summary.textContent = "Could not load your attendance history.";
    list.innerHTML = "";
    console.error("Collector Profile: attendance failed", error);
  }
}

document.addEventListener("DOMContentLoaded", loadAttendance);
document.addEventListener("eco:hydrated", loadAttendance);
