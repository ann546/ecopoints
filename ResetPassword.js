document.addEventListener("DOMContentLoaded", () => {
  const resetForm = document.getElementById("resetForm");
  const invalidTokenState = document.getElementById("invalidTokenState");
  const resetEmailLabel = document.getElementById("resetEmailLabel");

  const params = new URLSearchParams(window.location.search);
  const email = (params.get("email") || "").trim().toLowerCase();
  const token = params.get("token") || "";

  if (!email || !token) {
    invalidTokenState.hidden = false;
    return;
  }

  resetForm.hidden = false;
  resetEmailLabel.textContent = email;

  bindPasswordToggles();

  const newPassword = document.getElementById("newPassword");
  const confirmPassword = document.getElementById("confirmPassword");
  const newPasswordError = document.getElementById("newPasswordError");
  const confirmPasswordError = document.getElementById("confirmPasswordError");
  const strengthBar = document.getElementById("strengthBar");
  const strengthLabel = document.getElementById("strengthLabel");
  const resetSubmit = document.getElementById("resetSubmit");
  const resetNote = document.getElementById("resetNote");

  bindStrengthMeter(newPassword, strengthBar, strengthLabel);

  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    resetNote.textContent = "";
    resetNote.className = "form-note";

    const password = newPassword.value;
    const confirm = confirmPassword.value;

    let ok = true;
    ok = setError(newPassword, newPasswordError, passwordScore(password) < 3 ? "Password must be at least 8 characters and include a number and a symbol." : "") && ok;
    ok = setError(confirmPassword, confirmPasswordError, confirm !== password ? "Passwords do not match." : "") && ok;
    if (!ok) return;

    resetSubmit.disabled = true;
    resetSubmit.querySelector(".btn-label").textContent = "Updating...";

    // The token lives in MySQL now (password_reset_tokens), so the
    // server validates it and rewrites the account's password_hash.
    try {
      const response = await fetch("/api/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          token: token,
          new_password: password,
        }),
      });

      const data = await response.json();

      if (data.offline) {
        resetNote.className = "form-note error";
        resetNote.textContent =
          "Cannot reach the EcoPoints server. Start it with: npm start";
        resetSubmit.disabled = false;
        resetSubmit.querySelector(".btn-label").textContent = "Update Password";
        return;
      }

      if (!response.ok || !data.success) {
        resetNote.className = "form-note error";
        resetNote.textContent = data.error || "Could not update your password.";

        // A dead token can never recover, so send them back to request
        // a new link rather than letting them retry this one.
        if (response.status === 400) {
          invalidTokenState.hidden = false;
          resetForm.hidden = true;
        }

        resetSubmit.disabled = false;
        resetSubmit.querySelector(".btn-label").textContent = "Update Password";
        return;
      }

      clearSession();

      resetNote.className = "form-note success";
      resetNote.textContent = "Password updated! Redirecting to Log In...";
      setTimeout(() => { window.location.href = "Registration.html"; }, 900);
    } catch (err) {
      resetNote.className = "form-note error";
      resetNote.textContent = "Something went wrong. Please try again.";
      resetSubmit.disabled = false;
      resetSubmit.querySelector(".btn-label").textContent = "Update Password";
    }
  });
});
