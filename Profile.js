let PROFILE_RESIDENT = null;

const editBtn = document.getElementById("editProfileBtn");
const saveBtn = document.getElementById("saveProfileBtn");
const form = document.getElementById("profileForm");
const note = document.getElementById("profileNote");
const inputs = form.querySelectorAll("input, select");

const streetCombo = initStreetCombo({
  searchInputId: "pStreetSearch",
  hiddenInputId: "pStreet",
  listId: "pStreetList",
  errorElId: "pStreetError",
  showAllOnOpen: true
});

function syncProfileTopbar(name) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  document
    .querySelectorAll(".profile-name")
    .forEach((el) => (el.textContent = name));

  document
    .querySelectorAll(".avatar")
    .forEach((el) => (el.textContent = initials));
}

async function fetchProfileResident(session) {
  if (!session || !session.residentId) {
    return null;
  }

  try {
    const response = await fetch(
      `/api/residents/${encodeURIComponent(session.residentId)}`
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to load resident data.");
    }

    return data.resident;
  } catch (error) {
    console.error("Profile MySQL error:", error);

    return null;
  }
}

async function loadProfile() {
  const session = getSession();

  PROFILE_RESIDENT = await fetchProfileResident(session);

  const resident = PROFILE_RESIDENT;

  const fname = resident
    ? resident.first_name
    : session
      ? session.fname
      : "Juan";

  const lname = resident
    ? resident.last_name
    : session
      ? session.lname
      : "Dela Cruz";

  const email = resident
    ? resident.email
    : session
      ? session.email
      : "juan.delacruz@gmail.com";

  const phone = resident
    ? resident.phone
    : session
      ? session.phone
      : "639171234567";

  const house = resident
    ? resident.house_number
    : session
      ? session.houseNumber
      : "123";

  const street = resident
    ? resident.street
    : session
      ? session.street || ""
      : "Mercedes Avenue";

  let memberSince = "Member since March 2026";

  if (resident && resident.created_at) {
    memberSince =
      "Member since " +
      new Date(resident.created_at).toLocaleString("en-US", {
        month: "long",
        year: "numeric"
      });
  } else if (session && session.loggedInAt) {
    memberSince =
      "Member since " +
      new Date(session.loggedInAt).toLocaleString("en-US", {
        month: "long",
        year: "numeric"
      });
  }

  document.getElementById("profileAvatarLg").textContent = (
    (fname || " ")[0] + ((lname || " ")[0] || "")
  ).toUpperCase();

  document.getElementById("profileHeroName").textContent =
    `${fname} ${lname}`;

  document.getElementById("profileHeroId").textContent = resident
    ? resident.account_id
    : getUserId();

  document.getElementById("profileMemberSince").textContent = memberSince;

  document.getElementById("statPts").textContent = resident
    ? Number(resident.ecopoints_balance || 0).toLocaleString()
    : getPoints().toLocaleString();

    document.getElementById("statSubs").textContent = resident
    ? Number(resident.submissions_count || 0).toLocaleString()
    : getHistory().filter((h) => h.type === "earn").length;

  document.getElementById("pFirstName").value = fname;
  document.getElementById("pLastName").value = lname;
  document.getElementById("pEmail").value = email;
  document.getElementById("pPhone").value = phone;
  document.getElementById("pHouse").value = house;

  if (streetCombo) streetCombo.setValue(street);

  syncProfileTopbar(`${fname} ${lname}`.trim());
}

/* The points figure falls back to getPoints() until the resident row
   arrives, so it has to be redrawn once the database has answered. */
document.addEventListener("eco:hydrated", () => {
  const s = getSession();
  if (s) loadProfile(s);
});

function validateProfileValues(values) {
  if (!values.fname) return "First name is required.";

  if (!namePattern.test(values.fname)) {
    return "First name must contain letters only.";
  }

  if (!values.lname) return "Last name is required.";

  if (!namePattern.test(values.lname)) {
    return "Last name must contain letters only.";
  }

  if (!values.email) return "Email is required.";

  if (!emailPattern.test(values.email)) {
    return "Please enter a valid Gmail address.";
  }

    if (!/^\d{11,12}$/.test(values.phone)) {
    return "Mobile number must contain 11 or 12 digits.";
  }

  if (!values.houseNumber) return "House number is required.";

  return "";
}

function syncLocalProfile(session, updated) {
  const oldEmail = String(session.email || "").toLowerCase();
  const newEmail = String(updated.email || "").toLowerCase();

  const merged = { ...session, ...updated };

  const inLocal = (() => {
    try {
      return !!localStorage.getItem(SESSION_KEY);
    } catch {
      return false;
    }
  })();

  if (inLocal) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(merged));
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(merged));
  }

  try {
    const users = JSON.parse(localStorage.getItem(USERS_KEY)) || {};

    if (users[oldEmail]) {
      const record = { ...users[oldEmail], ...updated };

      if (newEmail !== oldEmail) {
        delete users[oldEmail];
      }

      users[newEmail] = record;

      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }
  } catch {}
}

editBtn.addEventListener("click", () => {
  inputs.forEach((el) => (el.disabled = false));
  saveBtn.style.display = "inline-flex";
  editBtn.style.display = "none";
  note.textContent = "";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (streetCombo) streetCombo.validateOnLeave();

  if (!document.getElementById("pStreet").value) {
    document.getElementById("pStreetSearch").classList.add("invalid");

    document.getElementById("pStreetError").textContent =
      "Please select your street from the Caniogan list.";

    return;
  }

  const streetName = document.getElementById("pStreet").value;

  const updated = {
    fname: document.getElementById("pFirstName").value.trim(),
    lname: document.getElementById("pLastName").value.trim(),
    email: document.getElementById("pEmail").value.trim().toLowerCase(),
    phone: document.getElementById("pPhone").value.trim(),
    houseNumber: document.getElementById("pHouse").value.trim(),
    street: streetName,
    streetClassification:
      (typeof CANIOGAN_STREET_INDEX !== "undefined" &&
        CANIOGAN_STREET_INDEX.get(streetName)) ||
      null
  };

  const session = getSession();

  if (session && session.residentId) {
    const message = validateProfileValues(updated);

    if (message) {
      note.className = "form-note error";
      note.textContent = message;
      return;
    }

    saveBtn.disabled = true;

    try {
      const response = await fetch(
        `/api/residents/${encodeURIComponent(session.residentId)}`,
        {
          method: "PUT",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            first_name: updated.fname,
            last_name: updated.lname,
            email: updated.email,
            phone: updated.phone,
            house_number: updated.houseNumber,
            street: updated.street,
            street_classification: updated.streetClassification
          })
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not save your profile.");
      }
    } catch (error) {
      console.error("Profile save error:", error);

      note.className = "form-note error";

      note.textContent =
        error instanceof TypeError
          ? "Cannot connect to the EcoPoints server. Make sure node server.js is running."
          : error.message;

      saveBtn.disabled = false;

      return;
    }

    saveBtn.disabled = false;
  }

  inputs.forEach((el) => (el.disabled = true));
  saveBtn.style.display = "none";
  editBtn.style.display = "inline-flex";

  if (session) {
    syncLocalProfile(session, updated);

    note.className = "form-note success";
    note.textContent = "Profile details saved.";
  } else {
    note.className = "form-note success";
    note.textContent =
      "Profile details saved for this demo session (log in on Registration.html to save permanently).";
  }

  await loadProfile();
});

document.addEventListener("DOMContentLoaded", loadProfile);
