document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");

  bindPasswordToggles();

  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const loginEmailError = document.getElementById("loginEmailError");
  const loginPasswordError = document.getElementById("loginPasswordError");
  const loginSubmit = document.getElementById("loginSubmit");
  const loginNote = document.getElementById("loginNote");
  const rememberMe = document.getElementById("rememberMe");
  const loginHeading = document.getElementById("loginHeading");
  const loginSub = document.getElementById("loginSub");
  const tabBtns = document.querySelectorAll(".tab-btn");

  const ROLE_COPY = {
    collector: {
      heading: "Collector Log In",
      sub: "Log in with your collector account to open your dashboard.",
    },
    admin: {
      heading: "Admin Log In",
      sub: "Log in with your admin account to open the Admin Dashboard.",
    },
  };

  const ROLE_DASHBOARD = {
    collector: "Collector Dashboard.html",
    admin: "Admin Dashboard.html",
  };

  let selectedRole = "collector";

  function activateRoleTab(role) {
    selectedRole = role;

    tabBtns.forEach((btn) => {
      const active = btn.dataset.role === role;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    loginEmail.placeholder = role === "admin" ? "name@eco.admin" : "name@eco.collect";
    loginHeading.textContent = ROLE_COPY[role].heading;
    loginSub.textContent = ROLE_COPY[role].sub;
    loginNote.textContent = "";
    loginNote.className = "form-note";
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => activateRoleTab(btn.dataset.role));
  });

  const params = new URLSearchParams(window.location.search);
  const roleParam = params.get("role");
  if (roleParam === "admin" || roleParam === "collector") {
    activateRoleTab(roleParam);
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginNote.textContent = "";
    loginNote.className = "form-note";

    const email = loginEmail.value.trim().toLowerCase();
    const password = loginPassword.value;

    let ok = true;
    ok = setError(loginEmail, loginEmailError, !email ? "Email is required." : (!staffEmailPattern.test(email) ? "Please enter a valid staff email address." : "")) && ok;
    ok = setError(loginPassword, loginPasswordError, !password ? "Password is required." : "") && ok;
    if (!ok) return;

    // No client-side lockout here on purpose. It was per-browser, fired
    // after 5 tries, and locked out even a correct password - so a
    // legitimate user fumbling the form locked themselves out and the
    // extra retries kept it locked. Real rate limiting belongs on the
    // server, not in localStorage.

    loginSubmit.disabled = true;
    loginSubmit.querySelector(".btn-label").textContent = "Logging in...";

     try {
      const response = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          password: password,
          role: selectedRole
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        registerFailedAttempt(email);
        loginNote.className = "form-note error";
        loginNote.textContent = data.error || "Invalid login credentials.";
        loginSubmit.disabled = false;
        loginSubmit.querySelector(".btn-label").textContent = "Log In";
        return;
      }

      clearAttempts(email);

      const staff = data.staff;
      const session = {
        fname: staff.first_name,
        lname: staff.last_name,
        email: staff.email,
        phone: staff.phone || "",
        houseNumber: "",
        street: "",
        role: staff.role,
        collectorId: staff.collector_id || null,
        adminId: staff.admin_id || null,
        collectorCode: staff.collector_code || null,
        groupNumber: staff.group_number || null,
        loggedInAt: new Date().toISOString()
      };
      setSession(session, rememberMe.checked);

      loginNote.className = "form-note success";
      loginNote.textContent = "Welcome back! Redirecting...";
      setTimeout(() => {
        window.location.href =
          ROLE_DASHBOARD[session.role] || redirectForRole(session.role);
      }, 700);
    } catch (err) {
      console.error("Staff login failed:", err);
      loginNote.className = "form-note error";
      loginNote.textContent =
        "Could not reach the server. Open this page via http://localhost:3000";
      loginSubmit.disabled = false;
      loginSubmit.querySelector(".btn-label").textContent = "Log In";
    }
  });

  const existing = getSession();
  if (existing && (existing.role === "collector" || existing.role === "admin")) {
    activateRoleTab(existing.role);
    loginNote.className = "form-note";
    loginNote.textContent = `Already logged in as ${existing.fname} (${existing.role}). Go to your dashboard from the menu, or log in again below to switch accounts.`;
  }
});