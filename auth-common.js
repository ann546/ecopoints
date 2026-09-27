const USERS_KEY = "ecoUsers";
const SESSION_KEY = "ecoUser";
const ATTEMPTS_KEY = "ecoLoginAttempts";
const RESET_KEY = "ecoResetTokens";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 2;
const RESET_TOKEN_MINUTES = 15;
const REMEMBER_DAYS = 30;

const ROLE_REDIRECTS = {
  admin: "Main Page.html",
  resident: "Main Page.html",
  collector: "Collector Dashboard.html",
};

const ROLE_PERMISSIONS = {
  admin: [
    "scan-residents",
    "view-residents",
    "verify-waste",
    "compute-ecopoints",
    "process-redemptions",
    "view-collection-history",
    "view-resident-ecopoints",
    "view-schedules",
    "receive-notifications",
    "manage-rewards",
    "manage-resident-accounts",
    "manage-collector-accounts",
    "manage-feed",
    "manage-system-settings",
    "delete-important-records",
  ],
  collector: [
    "scan-residents",
    "view-residents",
    "verify-waste",
    "compute-ecopoints",
    "process-redemptions",
    "view-collection-history",
    "view-resident-ecopoints",
    "view-schedules",
    "receive-notifications",
  ],
  resident: [
    "view-own-records",
    "view-rewards",
    "redeem-rewards",
    "view-own-schedule",
    "receive-notifications",
  ],
};

function hasPermission(permission) {
  const session = getSession();

  if (!session || !session.role) {
    return false;
  }

  return (ROLE_PERMISSIONS[session.role] || []).includes(permission);
}

function requirePermission(permission, redirectTo = "Main Page.html") {
  const session = getSession();

  if (!session) {
    window.location.replace("Registration.html");
    return null;
  }

  if (!hasPermission(permission)) {
    window.location.replace(redirectTo);
    return null;
  }

  return session;
}

function requireRole(allowedRoles, redirectTo = "Main Page.html") {
  const session = getSession();

  if (!session) {
    window.location.replace(redirectTo);
    return null;
  }

  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  if (!roles.includes(session.role)) {
    window.location.replace(redirectTo);
    return null;
  }

  return session;
}

function getUsers() {
  try {
    const users = JSON.parse(localStorage.getItem(USERS_KEY)) || {};

    let removedCollectors = false;

    Object.keys(users).forEach((key) => {
      const user = users[key];

      if (user && user.role === "collector" && !user.createdByAdmin) {
        delete users[key];
        removedCollectors = true;
      }
    });

    if (removedCollectors) {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    const NEW_ADMIN_SEEDS = [
      {
        email: "admin1@eco.admin",
        fname: "Admin",
        lname: "One",
        phone: "639170000201",
        // Default login: admin1@eco.admin / Admin1@2026
        salt: "98de63858e8855e52a24f1a5cb3a0fea",
        hash: "f3e43093654b70ea2c83774cd1345b51dd63631d95a05489aa572fb42500e1d2",
      },
      {
        email: "admin2@eco.admin",
        fname: "Admin",
        lname: "Two",
        phone: "639170000202",
        // Default login: admin2@eco.admin / Admin2@2026
        salt: "90bedca74f36bbe746f2acdda5e7afb7",
        hash: "9e6bcfd6b8fd248a345c124f911d0d9b5ae1736152f497d83f913b432c6a86e1",
      },
    ];

    // The founding admins now use @eco.admin addresses. Carry the old
    // @gmail.com records over (same password, name and phone) and remove them.
    const LEGACY_ADMIN_EMAILS = {
      "admin1@gmail.com": "admin1@eco.admin",
      "admin2@gmail.com": "admin2@eco.admin",
    };

    let seededNewAdmins = false;

    Object.keys(LEGACY_ADMIN_EMAILS).forEach((oldEmail) => {
      const oldUser = users[oldEmail];

      if (!oldUser || oldUser.role !== "admin") {
        return;
      }

      const newEmail = LEGACY_ADMIN_EMAILS[oldEmail];

      if (!users[newEmail]) {
        users[newEmail] = { ...oldUser, email: newEmail };
      }

      delete users[oldEmail];
      seededNewAdmins = true;
    });

    Object.values(users).forEach((user) => {
      if (user && LEGACY_ADMIN_EMAILS[user.createdBy]) {
        user.createdBy = LEGACY_ADMIN_EMAILS[user.createdBy];
        seededNewAdmins = true;
      }
    });

    // One-time repair: earlier versions of this file seeded admin1/admin2
    // with a hardcoded password hash that nobody actually knew (so those
    // accounts were unusable). If a browser already created that exact
    // stale record, swap it for the new known-password seed below. This
    // only matches the specific old hash — an admin who has since changed
    // their password via Change Password will have a different hash and
    // is left untouched.
    const STALE_DEFAULT_HASHES = {
      "admin1@eco.admin": "b5a80a2d896ec8825bfcbc139b49209654e1c4bbf6d25e125457f8139738e3a8",
      "admin2@eco.admin": "bdafea8a83165009458d138c1e5839c878c0c2eb82ba162babed70db71ea9af7",
    };

    Object.keys(STALE_DEFAULT_HASHES).forEach((email) => {
      if (users[email] && users[email].hash === STALE_DEFAULT_HASHES[email]) {
        delete users[email];
        seededNewAdmins = true;
      }
    });

    NEW_ADMIN_SEEDS.forEach((seed) => {
      // Only create the account if it doesn't exist yet. (Previously this
      // also overwrote salt/hash whenever they didn't match the seed, which
      // meant admin1/admin2 could never keep a changed password — the next
      // page load would silently reset it back to the seed's password.)
      if (!users[seed.email]) {
        users[seed.email] = {
          fname: seed.fname,
          lname: seed.lname,
          email: seed.email,
          phone: seed.phone,
          houseNumber: "0",
          street: "Market Avenue",
          role: "admin",
          salt: seed.salt,
          hash: seed.hash,
          createdAt: new Date().toISOString(),
        };

        seededNewAdmins = true;
      }
    });

    if (seededNewAdmins) {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    return users;
  } catch {
    return {};
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getAttempts() {
  try {
    return JSON.parse(localStorage.getItem(ATTEMPTS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveAttempts(a) {
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a));
}

function registerFailedAttempt(email) {
  const attempts = getAttempts();
  const rec = attempts[email] || {
    count: 0,
    lockUntil: 0,
  };

  rec.count += 1;

  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockUntil = Date.now() + LOCK_MINUTES * 60 * 1000;

    rec.count = 0;
  }

  attempts[email] = rec;
  saveAttempts(attempts);
}

function clearAttempts(email) {
  const attempts = getAttempts();

  delete attempts[email];

  saveAttempts(attempts);
}

function getLockInfo(email) {
  const attempts = getAttempts();
  const rec = attempts[email];

  if (rec && rec.lockUntil && Date.now() < rec.lockUntil) {
    return Math.ceil((rec.lockUntil - Date.now()) / 1000);
  }

  return 0;
}

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomSaltHex(bytes = 16) {
  const arr = new Uint8Array(bytes);

  crypto.getRandomValues(arr);

  return bufToHex(arr.buffer);
}

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();

  const data = enc.encode(saltHex + ":" + password);

  const digest = await crypto.subtle.digest("SHA-256", data);

  return bufToHex(digest);
}

const emailPattern = /^[^\s@]+@gmail\.com$/;

const collectorEmailPattern = /^[^\s@]+@eco\.collect$/;

const adminEmailPattern = /^[^\s@]+@eco\.admin$/;

// Staff login accepts @eco.admin and @eco.collect. @gmail.com is still
// accepted only so the older default admin account can log in until removed.
const staffEmailPattern = /^[^\s@]+@(gmail\.com|eco\.collect|eco\.admin)$/;

const phonePattern = /^\d{12}$/;

const namePattern = /^[A-Za-z]+(\s[A-Za-z]+)*$/;

function setError(inputEl, errorEl, message) {
  if (message) {
    inputEl.classList.add("invalid");
    errorEl.textContent = message;
  } else {
    inputEl.classList.remove("invalid");
    errorEl.textContent = "";
  }

  return !message;
}

const strengthMap = [
  {
    label: "Use 8+ characters with a number and a symbol",
    color: "var(--border)",
    width: "0%",
  },
  {
    label: "Weak password",
    color: "#C24A3C",
    width: "20%",
  },
  {
    label: "Weak password",
    color: "#C24A3C",
    width: "35%",
  },
  {
    label: "Fair password",
    color: "#E0A83A",
    width: "55%",
  },
  {
    label: "Good password",
    color: "#A1CB35",
    width: "80%",
  },
  {
    label: "Strong password",
    color: "#56701B",
    width: "100%",
  },
];

function passwordScore(pw) {
  let score = 0;

  if (pw.length >= 8) {
    score++;
  }

  if (pw.length >= 12) {
    score++;
  }

  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) {
    score++;
  }

  if (/\d/.test(pw)) {
    score++;
  }

  if (/[^A-Za-z0-9]/.test(pw)) {
    score++;
  }

  return score;
}

function bindStrengthMeter(inputEl, barEl, labelEl) {
  inputEl.addEventListener("input", () => {
    const score = passwordScore(inputEl.value);

    const meta = strengthMap[Math.min(score, 5)];

    barEl.style.width = inputEl.value ? meta.width : "0%";

    barEl.style.background = meta.color;

    labelEl.textContent = inputEl.value ? meta.label : strengthMap[0].label;
  });
}

function bindPasswordToggles(root = document) {
  root.querySelectorAll(".toggle-pw").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);

      const showing = target.type === "text";

      target.type = showing ? "password" : "text";

      btn.innerHTML = showing
        ? '<i class="fa-solid fa-eye"></i>'
        : '<i class="fa-solid fa-eye-slash"></i>';
    });
  });
}

function setSession(session, remember) {
  const payload = {
    ...session,
    remember: !!remember,
  };

  if (remember) {
    payload.expiresAt = Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000;

    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));

    sessionStorage.removeItem(SESSION_KEY);
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));

    localStorage.removeItem(SESSION_KEY);
  }
}

function getSession() {
  try {
    const local = JSON.parse(localStorage.getItem(SESSION_KEY));

    if (local) {
      if (local.expiresAt && Date.now() > local.expiresAt) {
        localStorage.removeItem(SESSION_KEY);

        return null;
      }

      return local;
    }
  } catch {}

  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));

    if (session) {
      return session;
    }
  } catch {}

  return null;
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);

  sessionStorage.removeItem(SESSION_KEY);
}

function isLoggedIn() {
  return !!getSession();
}

function requireAuth(allowedRoles) {
  const session = getSession();

  if (!session) {
    window.location.href = "Registration.html";

    return null;
  }

  if (
    allowedRoles &&
    allowedRoles.length &&
    !allowedRoles.includes(session.role)
  ) {
    window.location.href = "Main Page.html";

    return null;
  }

  return session;
}

function logout(redirectTo = "Main Page.html") {
  clearSession();

  window.location.href = redirectTo;
}

function getResetTokens() {
  try {
    return JSON.parse(localStorage.getItem(RESET_KEY)) || {};
  } catch {
    return {};
  }
}

function saveResetTokens(tokens) {
  localStorage.setItem(RESET_KEY, JSON.stringify(tokens));
}

function createResetRequest(email) {
  const tokens = getResetTokens();

  const token = randomSaltHex(20);

  tokens[email] = {
    token,
    expiresAt: Date.now() + RESET_TOKEN_MINUTES * 60 * 1000,
  };

  saveResetTokens(tokens);

  return token;
}

function validateResetToken(email, token) {
  const tokens = getResetTokens();

  const rec = tokens[email];

  if (!rec) {
    return false;
  }

  if (rec.token !== token) {
    return false;
  }

  if (Date.now() > rec.expiresAt) {
    return false;
  }

  return true;
}

function consumeResetToken(email) {
  const tokens = getResetTokens();

  delete tokens[email];

  saveResetTokens(tokens);
}

function ensureSeedAdmin() {
  const users = getUsers();

  if (users["admin@gmail.com"]) {
    return;
  }

  randomSaltHex &&
    hashPassword("Admin@123", "seedsalt0000").then((hash) => {
      const fresh = getUsers();

      if (fresh["admin@gmail.com"]) {
        return;
      }

      fresh["admin@gmail.com"] = {
        fname: "Barangay",
        lname: "Admin",
        email: "admin@gmail.com",
        phone: "639170000000",
        houseNumber: "0",
        street: "Market Avenue",
        role: "admin",
        salt: "seedsalt0000",
        hash,
        createdAt: new Date().toISOString(),
      };

      saveUsers(fresh);
    });
}

function redirectForRole(role) {
  return ROLE_REDIRECTS[role] || "Main Page.html";
}