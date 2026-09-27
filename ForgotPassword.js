/* ---------- ForgotPassword.js ----------
   Step 1 of the password reset flow: look the address up and issue a
   reset token.

   The token is stored in MySQL (password_reset_tokens) rather than the
   browser, so the link works on any device. This prototype has no mail
   server, so the link is shown on the page for the user to copy. */

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("forgotForm");
  const emailInput = document.getElementById("forgotEmail");
  const emailError = document.getElementById("forgotEmailError");
  const submit = document.getElementById("forgotSubmit");
  const note = document.getElementById("forgotNote");
  const linkBox = document.getElementById("resetLinkBox");
  const linkText = document.getElementById("resetLinkText");
  const copyBtn = document.getElementById("copyLinkBtn");
  const continueBtn = document.getElementById("continueResetBtn");

  if (!form || !emailInput) return;

  // Accept a Gmail address for residents or a staff address for
  // collectors/admins.
  const isValidEmail = /^[^\s@]+@(gmail\.com|eco\.collect|eco\.admin)$/;

  emailInput.addEventListener("input", () => {
    emailInput.classList.remove("invalid");
    emailError.textContent = "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
      setError(emailInput, emailError, "Email is required.");
      return;
    }

    if (!isValidEmail.test(email)) {
      setError(
        emailInput,
        emailError,
        "Enter a valid Gmail, @eco.collect or @eco.admin address.",
      );
      return;
    }

    setError(emailInput, emailError, "");

    note.textContent = "";
    note.className = "form-note";
    submit.disabled = true;
    submit.querySelector(".btn-label").textContent = "Checking...";
    linkBox.hidden = true;

    try {
      const res = await fetch("/api/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (data.offline) {
        note.className = "form-note error";
        note.textContent =
          "Cannot reach the EcoPoints server. Start it with: npm start";
        return;
      }

      if (!res.ok || !data.success) {
        note.className = "form-note error";
        note.textContent = data.error || "Could not create a reset link.";
        return;
      }

      note.className = "form-note success";
      note.textContent = data.message;

      // No token means the address isn't registered. The message above
      // stays deliberately vague, so simply don't reveal a link.
      if (!data.token) return;

      const link =
        `${window.location.origin}/ResetPassword.html` +
        `?email=${encodeURIComponent(data.email)}` +
        `&token=${encodeURIComponent(data.token)}`;

      linkText.value = link;
      continueBtn.href = link;
      linkBox.hidden = false;
    } catch (err) {
      note.className = "form-note error";
      note.textContent = "Something went wrong. Please try again.";
    } finally {
      submit.disabled = false;
      submit.querySelector(".btn-label").textContent = "Send Reset Link";
    }
  });

  if (copyBtn && linkText) {
    copyBtn.addEventListener("click", async () => {
      const link = linkText.value;
      if (!link) return;

      try {
        await navigator.clipboard.writeText(link);
        copyBtn.textContent = "Copied!";
      } catch {
        // Clipboard can be blocked; selecting the text still lets the
        // user copy it by hand.
        linkText.focus();
        linkText.select();
        copyBtn.textContent = "Selected";
      }

      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1800);
    });
  }
});
