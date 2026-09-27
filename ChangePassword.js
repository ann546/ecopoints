document.addEventListener("DOMContentLoaded", () => {
  const session = requireAuth();
  if (!session) return;

  document.getElementById("changeUserLabel").textContent = `${session.fname} ${session.lname} (${session.email})`;
  document.getElementById("logoutBtn").addEventListener("click", () => logout());

  bindPasswordToggles();

  const changeForm = document.getElementById("changeForm");
  const currentPassword = document.getElementById("currentPassword");
  const newPassword = document.getElementById("newPassword");
  const confirmPassword = document.getElementById("confirmPassword");
  const currentPasswordError = document.getElementById("currentPasswordError");
  const newPasswordError = document.getElementById("newPasswordError");
  const confirmPasswordError = document.getElementById("confirmPasswordError");
  const strengthBar = document.getElementById("strengthBar");
  const strengthLabel = document.getElementById("strengthLabel");
  const changeSubmit = document.getElementById("changeSubmit");
  const changeNote = document.getElementById("changeNote");

  bindStrengthMeter(newPassword, strengthBar, strengthLabel);

  changeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    changeNote.textContent = "";
    changeNote.className = "form-note";

    const current = currentPassword.value;
    const next = newPassword.value;
    const confirm = confirmPassword.value;

    let ok = true;
    ok = setError(currentPassword, currentPasswordError, !current ? "Current password is required." : "") && ok;
    ok = setError(newPassword, newPasswordError, passwordScore(next) < 3 ? "Password must be at least 8 characters and include a number and a symbol." : "") && ok;
    ok = setError(confirmPassword, confirmPasswordError, confirm !== next ? "Passwords do not match." : "") && ok;
    if (!ok) return;

    changeSubmit.disabled = true;
    changeSubmit.querySelector(".btn-label").textContent = "Updating...";

    // Accounts live in MySQL now, so the password is verified and
    // rewritten on the server rather than in localStorage.
    const role = session.role;
    const userId =
      role === "collector" ? session.collectorId
      : role === "admin" ? session.adminId
      : session.residentId;

    const resetButton = () => {
      changeSubmit.disabled = false;
      changeSubmit.querySelector(".btn-label").textContent = "Update Password";
    };

    if (!role || !userId) {
      changeNote.className = "form-note error";
      changeNote.textContent = "Could not identify your account. Please log in again.";
      resetButton();
      return;
    }

    try {
      const response = await fetch("/api/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: role,
          user_id: userId,
          current_password: current,
          new_password: next,
        }),
      });

      const data = await response.json();

      if (data.offline) {
        changeNote.className = "form-note error";
        changeNote.textContent =
          "Cannot reach the EcoPoints server. Start it with: npm start";
        resetButton();
        return;
      }

      if (!response.ok || !data.success) {
        // A wrong current password belongs on the field, not the form.
        if (response.status === 401) {
          setError(
            currentPassword,
            currentPasswordError,
            data.error || "Current password is incorrect.",
          );
        } else {
          changeNote.className = "form-note error";
          changeNote.textContent = data.error || "Could not update your password.";
        }

        resetButton();
        return;
      }

      changeNote.className = "form-note success";
      changeNote.textContent = data.message || "Password updated successfully.";
      changeForm.reset();
      document.querySelectorAll("#changeForm .toggle-pw i").forEach(i => i.className = "fa-solid fa-eye");
      document.querySelectorAll("#changeForm input[type=text]").forEach(el => el.type = "password");
      strengthBar.style.width = "0%";
      strengthLabel.textContent = "Use 8+ characters with a number and a symbol";

      resetButton();
    } catch (err) {
      changeNote.className = "form-note error";
      changeNote.textContent = "Something went wrong. Please try again.";
      resetButton();
    }
  });
});
