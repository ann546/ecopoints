function stripNonLetters(value) {
  return value.replace(/[^A-Za-z\s]/g, "");
}

function finalizeName(value) {
  const cleaned = stripNonLetters(value).trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

document.addEventListener("DOMContentLoaded", () => {
  ensureSeedAdmin();

  const tabBtns = document.querySelectorAll(".tab-btn");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const switchLineLogin = document.getElementById("switchLineLogin");
  const switchLineRegister = document.getElementById("switchLineRegister");

  function activateTab(tab) {
    tabBtns.forEach(b => {
      const active = b.dataset.tab === tab;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });

    loginForm.classList.toggle("active", tab === "login");
    registerForm.classList.toggle("active", tab === "register");
    switchLineLogin.hidden = tab !== "login";
    switchLineRegister.hidden = tab !== "register";
  }

  const params = new URLSearchParams(window.location.search);

  if (params.get("tab") === "register") {
    activateTab("register");
  }

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  document.querySelectorAll(".switch-btn").forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.goto));
  });

  bindPasswordToggles();

  const streetCombo = initStreetCombo({
    searchInputId: "regStreetSearch",
    hiddenInputId: "regStreet",
    listId: "regStreetList",
    errorElId: "regStreetError"
  });

  const regPassword = document.getElementById("regPassword");
  const strengthBar = document.getElementById("strengthBar");
  const strengthLabel = document.getElementById("strengthLabel");

  bindStrengthMeter(regPassword, strengthBar, strengthLabel);

 /* =========================
   LOGIN
========================= */

const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginEmailError = document.getElementById("loginEmailError");
const loginPasswordError = document.getElementById("loginPasswordError");
const loginSubmit = document.getElementById("loginSubmit");
const loginNote = document.getElementById("loginNote");
const rememberMe = document.getElementById("rememberMe");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  loginNote.textContent = "";
  loginNote.className = "form-note";

  const email = loginEmail.value.trim().toLowerCase();
  const password = loginPassword.value;

  let ok = true;

  ok = setError(
    loginEmail,
    loginEmailError,
    !email
      ? "Email is required."
      : (!emailPattern.test(email)
        ? "Please enter a valid Gmail address."
        : "")
  ) && ok;

  ok = setError(
    loginPassword,
    loginPasswordError,
    !password ? "Password is required." : ""
  ) && ok;

  if (!ok) return;

  const secsLeft = getLockInfo(email);

  if (secsLeft > 0) {
    loginNote.className = "form-note error";
    loginNote.textContent =
      `Too many attempts. Try again in ${secsLeft}s.`;
    return;
  }

 loginSubmit.disabled = true;
loginSubmit.querySelector(".btn-label").textContent = "Logging in...";

  /* =========================
     CREATE PASSWORD HASH
  ========================= */

  try {
    // No localStorage lookup here any more. Accounts live in MySQL and
    // the server salts and verifies the password itself, so a browser
    // that has never seen this address can still sign in.

  } catch (err) {

    console.error(
      "Password hashing failed:",
      err
    );

    loginNote.className = "form-note error";
    loginNote.textContent =
      "Couldn't verify your password. Please use http://localhost:3000.";

    loginSubmit.disabled = false;
    loginSubmit.querySelector(".btn-label").textContent =
      "Log In";

    return;
  }

  /* =========================
     LOGIN THROUGH MYSQL
  ========================= */

  try {

    const response = await fetch("/api/login", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

        // The server salts and hashes on its own side, so it needs the
        // password itself. Sending a client-side hash here could never
        // match the "salt:hash" value in the database.
        body: JSON.stringify({
          email: email,
          password: password
        })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {

      registerFailedAttempt(email);

      loginNote.className = "form-note error";
      loginNote.textContent =
        data.error || "Invalid login credentials.";

      loginSubmit.disabled = false;
      loginSubmit.querySelector(".btn-label").textContent =
        "Log In";

      return;
    }

    /* =========================
       MYSQL RESIDENT DATA
    ========================= */

    const resident = data.resident;

    clearAttempts(email);

    /* =========================
       CREATE SESSION
    ========================= */

    const session = {
      fname: resident.first_name,
      lname: resident.last_name,
      email: resident.email,
      phone: resident.phone,
      houseNumber: resident.house_number,
      street: resident.street,
      streetClassification:
        resident.street_classification || null,

      role: "resident",

      residentId: resident.resident_id,
      accountId: resident.account_id,
      qrCodeValue: resident.qr_code_value,
      points: resident.ecopoints_balance,

      loggedInAt: new Date().toISOString()
    };

    setSession(
      session,
      rememberMe.checked
    );

    /* =========================
       SUCCESS
    ========================= */

    loginNote.className =
      "form-note success";

    loginNote.textContent =
      "Welcome back! Redirecting...";

    setTimeout(() => {

      window.location.href =
        redirectForRole("resident");

    }, 700);

  } catch (err) {

    console.error(
      "MySQL login failed:",
      err
    );

    loginNote.className =
      "form-note error";

    loginNote.textContent =
      "Cannot connect to the EcoPoints server. Make sure node server.js is running.";

    loginSubmit.disabled = false;

    loginSubmit.querySelector(".btn-label").textContent =
      "Log In";
  }
});

  /* =========================
     REGISTRATION ELEMENTS
     ========================= */

  const regFirstName = document.getElementById("regFirstName");
  const regLastName = document.getElementById("regLastName");
  const regEmail = document.getElementById("regEmail");
  const regPhone = document.getElementById("regPhone");
  const regHouseNumber = document.getElementById("regHouseNumber");
  const regStreet = document.getElementById("regStreet");
  const regStreetSearch = document.getElementById("regStreetSearch");
  const regConfirm = document.getElementById("regConfirm");
  const agreeTerms = document.getElementById("agreeTerms");
  const registerSubmit = document.getElementById("registerSubmit");
  const registerNote = document.getElementById("registerNote");

  const errEls = {
    regFirstName: document.getElementById("regFirstNameError"),
    regLastName: document.getElementById("regLastNameError"),
    regEmail: document.getElementById("regEmailError"),
    regPhone: document.getElementById("regPhoneError"),
    regHouseNumber: document.getElementById("regHouseNumberError"),
    regStreet: document.getElementById("regStreetError"),
    regPassword: document.getElementById("regPasswordError"),
    regConfirm: document.getElementById("regConfirmError"),
    agreeTerms: document.getElementById("agreeTermsError")
  };

  /* =========================
     REGISTRATION INPUT RULES
     ========================= */

  regFirstName.addEventListener("input", () => {
    regFirstName.value = stripNonLetters(regFirstName.value);
  });

  regLastName.addEventListener("input", () => {
    regLastName.value = stripNonLetters(regLastName.value);
  });

  regFirstName.addEventListener("blur", () => {
    regFirstName.value = finalizeName(regFirstName.value);
  });

  regLastName.addEventListener("blur", () => {
    regLastName.value = finalizeName(regLastName.value);
  });

  regPhone.addEventListener("input", () => {
    regPhone.value = regPhone.value.replace(/\D/g, "").slice(0, 11);
  });

  regPhone.addEventListener("keypress", (e) => {
    if (!/[0-9]/.test(e.key)) {
      e.preventDefault();
    }
  });

  regPhone.addEventListener("paste", (e) => {
    e.preventDefault();

    const pasted =
      (e.clipboardData || window.clipboardData).getData("text");

    regPhone.value =
      (regPhone.value + pasted).replace(/\D/g, "").slice(0, 11);
  });

  /* =========================
     REGISTRATION
     ========================= */

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    registerNote.textContent = "";
    registerNote.className = "form-note";

    regFirstName.value = finalizeName(regFirstName.value);
    regLastName.value = finalizeName(regLastName.value);
    regPhone.value = regPhone.value.replace(/\D/g, "").slice(0, 11);

    if (streetCombo) {
      streetCombo.validateOnLeave();
    }

    const fname = regFirstName.value;
    const lname = regLastName.value;
    const email = regEmail.value.trim().toLowerCase();
    const phone = regPhone.value;
    const houseNumber = regHouseNumber.value.trim();
    const street = regStreet.value;

    const streetClassification = street
      ? (CANIOGAN_STREET_INDEX.get(street) || null)
      : null;

    const password = regPassword.value;
    const confirm = regConfirm.value;

    let ok = true;

    ok = setError(
      regFirstName,
      errEls.regFirstName,
      !fname
        ? "First name is required."
        : (!namePattern.test(fname)
          ? "First name must contain letters only."
          : "")
    ) && ok;

    ok = setError(
      regLastName,
      errEls.regLastName,
      !lname
        ? "Last name is required."
        : (!namePattern.test(lname)
          ? "Last name must contain letters only."
          : "")
    ) && ok;

    ok = setError(
      regEmail,
      errEls.regEmail,
      !email
        ? "Email is required."
        : (!emailPattern.test(email)
          ? "Please enter a valid Gmail address."
          : "")
    ) && ok;

    ok = setError(
      regPhone,
      errEls.regPhone,
      !phone
        ? "Mobile number is required."
        : (
          phone.length !== 11
            ? "Mobile number must be exactly 11 digits (e.g. 09123456789)."
            : (!/^\d{11}$/.test(phone)
              ? "Mobile number must contain numbers only."
              : "")
        )
    ) && ok;

    ok = setError(
      regHouseNumber,
      errEls.regHouseNumber,
      !houseNumber ? "House number is required." : ""
    ) && ok;

    ok = setError(
      regStreetSearch,
      errEls.regStreet,
      !street ? "Please select your street from the Caniogan list." : ""
    ) && ok;

    ok = setError(
      regPassword,
      errEls.regPassword,
      passwordScore(password) < 3
        ? "Password must be at least 8 characters and include a number and a symbol."
        : ""
    ) && ok;

    ok = setError(
      regConfirm,
      errEls.regConfirm,
      confirm !== password ? "Passwords do not match." : ""
    ) && ok;

    if (!agreeTerms.checked) {
      errEls.agreeTerms.textContent =
        "You must agree to the Terms and Privacy Policy.";

      ok = false;
    } else {
      errEls.agreeTerms.textContent = "";
    }

    if (!ok) return;

    /* =========================
       CHECK LOCAL DUPLICATE
       ========================= */

    const users = getUsers();

    if (users[email]) {
      setError(
        regEmail,
        errEls.regEmail,
        "This Gmail address is already registered."
      );
      return;
    }

    registerSubmit.disabled = true;
    registerSubmit.querySelector(".btn-label").textContent =
      "Creating account...";

    /* =========================
       CREATE PASSWORD HASH
       ========================= */

    let salt;
    let hash;

    try {
      salt = randomSaltHex();
      hash = await hashPassword(password, salt);
    } catch (err) {
      console.error(
        "hashPassword failed during registration:",
        err
      );

      registerNote.className = "form-note error";

      registerNote.textContent =
        "Couldn't create your account on this connection. Open this page over http://localhost or https:// and try again.";

      registerSubmit.disabled = false;

      registerSubmit.querySelector(".btn-label").textContent =
        "Create Account";

      return;
    }

    /* =========================
       CREATE QR VALUE
       ========================= */

    const qrCodeValue =
      "ECO-" +
      Date.now() +
      "-" +
      Math.floor(Math.random() * 10000);

    /* =========================
       SAVE TO MYSQL DATABASE
       ========================= */

    // Opening this file straight from the folder (file://) makes every
    // request below fail, because a relative "/api/..." URL resolves to
    // the filesystem. Catch that case explicitly so the message is useful.
    if (window.location.protocol === "file:") {
      registerNote.className = "form-note error";
      registerNote.textContent =
        "Open http://localhost:3000 instead of this file. " +
        "The page must be loaded through the server.";
      registerSubmit.disabled = false;
      registerSubmit.querySelector(".btn-label").textContent = "Create Account";
      return;
    }

    try {
      const response = await fetch("/api/residents", {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          first_name: fname,
          last_name: lname,
          email: email,
          // Server-side salting/hashing, so send the password.
          password: password,
          phone: phone,
          house_number: houseNumber,
          street: street,
          street_classification: streetClassification,
          qr_code_value: qrCodeValue
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || "Registration failed."
        );
      }

      console.log(
        "Resident successfully saved to MySQL:",
        data
      );

      /* =========================
         ALSO KEEP LOCALSTORAGE
         =========================
         This keeps your current dashboard/login
         working while we gradually connect the
         other pages to MySQL.
      */

      users[email] = {
        fname,
        lname,
        email,
        phone,
        houseNumber,
        street,
        streetClassification,

        role: "resident",

        salt,
        hash,

        createdAt: new Date().toISOString(),

        points: 250,

        history: [
          {
            date: new Date().toLocaleDateString(
              "en-US",
              {
                month: "long",
                day: "numeric",
                year: "numeric"
              }
            ),

            description: "Welcome Bonus",

            points: 250,

            type: "bonus"
          }
        ],

        welcomeBonusGiven: true,

        residentId: data.resident_id,
        accountId: data.account_id,
        qrCodeValue: data.qr_code_value || data.account_id
      };

      saveUsers(users);

      /* =========================
         CREATE LOGIN SESSION
         ========================= */

      const session = {
        fname,
        lname,
        email,
        phone,
        houseNumber,
        street,
        streetClassification,

        role: "resident",

        residentId: data.resident_id,
        accountId: data.account_id,
        qrCodeValue: data.qr_code_value || data.account_id,

        loggedInAt: new Date().toISOString()
      };

      setSession(session, true);

      /* =========================
         WELCOME BONUS
         ========================= */

      sessionStorage.setItem(
        "welcomeBonus",
        "250"
      );

      /* =========================
         SUCCESS MESSAGE
         ========================= */

      registerNote.className =
        "form-note success";

      registerNote.textContent =
        "Welcome to EcoPoints! You received 250 welcome EcoPoints.";

      setTimeout(() => {
        window.location.href =
          redirectForRole("resident");
      }, 700);

    } catch (err) {

      console.error(
        "Database registration failed:",
        err
      );

      registerNote.className =
        "form-note error";

      // A network-level failure means the request never reached the
      // server, which is a different problem from the server saying no.
      const unreachable =
        err instanceof TypeError ||
        /failed to fetch|networkerror|load failed/i.test(String(err && err.message));

      registerNote.textContent = unreachable
        ? "Cannot reach the EcoPoints server. Open http://localhost:3000 " +
          "and make sure it is running (npm start in the project folder)."
        : err && err.message
          ? err.message
          : "Could not save your account to the database. Please try again.";

      registerSubmit.disabled = false;

      registerSubmit.querySelector(".btn-label").textContent =
        "Create Account";

      return;
    }
  });

  /* =========================
     EXISTING SESSION
     ========================= */

  const existing = getSession();

  if (existing) {
    loginNote.className = "form-note";

    loginNote.textContent =
      `Already logged in as ${existing.fname}. Go to your dashboard from the menu, or log in again below to switch accounts.`;
  }
});