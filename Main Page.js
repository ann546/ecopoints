/* ---------- Main Page JS ---------- */

const menuBtn = document.getElementById("menuBtn");
const navMenu = document.getElementById("navMenu");

menuBtn.addEventListener("click", () => {
  navMenu.classList.toggle("show");
});

navMenu.querySelectorAll("a").forEach(link => {
  link.addEventListener("click", () => navMenu.classList.remove("show"));
});

const ring = document.getElementById("impactRing");
const impactRingPercent = document.getElementById("impactRingPercent");
if (ring) {
  // Monthly Goal = THIS USER'S OWN kg recycled this month (from
  // getHistory(), same source the rest of the impact card now uses)
  // against a personal MONTHLY_GOAL_KG target. Shows 0% until this user
  // has a real recycling-submission entry — that's expected, not a bug,
  // since there's no collector-verification flow creating those yet.
  // Adjust MONTHLY_GOAL_KG to whatever a reasonable per-household target is.
  const MONTHLY_GOAL_KG = 50;
  const circumference = 502;

  let percent = 0;
  if (typeof window.getHistory === "function") {
    const now = new Date();
    let kgThisMonth = 0;
    window.getHistory().forEach(entry => {
      if (!entry || !(entry.points > 0) || entry.type === "bonus") return;
      const entryDate = new Date(entry.date);
      if (isNaN(entryDate.getTime())) return;
      if (entryDate.getFullYear() !== now.getFullYear() || entryDate.getMonth() !== now.getMonth()) return;
      const match = String(entry.description || "").match(/\(([\d.]+)\s*kg\)/i);
      if (match) kgThisMonth += parseFloat(match[1]);
    });
    percent = Math.max(0, Math.min(1, kgThisMonth / MONTHLY_GOAL_KG));
  }

  const offset = circumference - circumference * percent;
  window.requestAnimationFrame(() => {
    setTimeout(() => {
      ring.style.strokeDashoffset = offset;
      if (impactRingPercent) impactRingPercent.textContent = `${Math.round(percent * 100)}%`;
    }, 300);
  });
}

const revealEls = document.querySelectorAll(".reveal");

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

revealEls.forEach(el => revealObserver.observe(el));

const header = document.querySelector("header");
window.addEventListener("scroll", () => {
  if (window.scrollY > 10) {
    header.style.boxShadow = "0 4px 16px rgba(46,63,22,0.08)";
  } else {
    header.style.boxShadow = "none";
  }
});

/* ---------- Guest / Logged-in account state ---------- */
/* getSession()/setSession()/clearSession() now come from auth-common.js,
   which checks both localStorage (remembered sessions) and sessionStorage
   (non-remembered sessions). This file used to define its own getSession()
   that only checked localStorage, so logging out never cleared a
   non-remembered session in sessionStorage — leaving the old account
   "logged in" on the next visit. */

const guestLabel = document.getElementById("guestLabel");
const registerSuggest = document.getElementById("registerSuggest");
const accountMenu = document.getElementById("accountMenu");
const accountFirstName = document.getElementById("accountFirstName");
const accountToggle = document.getElementById("accountToggle");
const accountDropdown = document.getElementById("accountDropdown");
const logoutBtn = document.getElementById("logoutBtn");
const accountPointsValue = document.getElementById("accountPointsValue");
const guestBanner = document.getElementById("guestBanner");
const heroGuestActions = document.getElementById("heroGuestActions");
const heroAccountActions = document.getElementById("heroAccountActions");
const ctaGuestActions = document.getElementById("ctaGuestActions");
const ctaAccountActions = document.getElementById("ctaAccountActions");

/* Reads the live EcoPoints balance for the given session user.
   Prefers window.getPoints() from user-module.js when that script is
   loaded, but falls back to reading the "ecoUsers" record directly —
   so the badge still works even if user-module.js isn't on this page
   (e.g. missing script tag, wrong filename, 404) or hasn't loaded yet.
   Also self-heals accounts whose record predates points tracking. */
function getLiveEcoPoints(user) {
  if (typeof window.getPoints === "function") {
    try {
      const live = window.getPoints();
      if (typeof live === "number") return live;
    } catch (e) {}
  }
  try {
    const key = (user.email || "").toLowerCase();
    const users = JSON.parse(localStorage.getItem("ecoUsers")) || {};
    const record = users[key];
    if (record && typeof record.points === "number") return record.points;
  } catch (e) {}
  return typeof user.points === "number" ? user.points : 0;
}

function renderAuthState() {
  const user = getSession();

  if (user) {
    // Logged-in homepage: hide guest controls, show account menu
    if (guestLabel) guestLabel.style.display = "none";
    if (registerSuggest) registerSuggest.style.display = "none";
    if (accountMenu) accountMenu.style.display = "";
    if (accountFirstName) accountFirstName.textContent = user.fname;
    // Points live on the "ecoUsers" record (kept current by redemptions /
    // future earnings), not on the session itself — read the live balance
    // via user-module.js when it's available, falling back to the
    // session's own points field otherwise.
    if (accountPointsValue) {
      accountPointsValue.textContent = getLiveEcoPoints(user).toLocaleString();
    }
    if (guestBanner) guestBanner.style.display = "none";
    if (heroGuestActions) heroGuestActions.style.display = "none";
    if (heroAccountActions) heroAccountActions.style.display = "";
    if (ctaGuestActions) ctaGuestActions.style.display = "none";
    if (ctaAccountActions) ctaAccountActions.style.display = "";
  } else {
    // Guest homepage: show login/register, hide account features
    if (guestLabel) guestLabel.style.display = "";
    if (registerSuggest) registerSuggest.style.display = "";
    if (accountMenu) accountMenu.style.display = "none";
    if (guestBanner) guestBanner.style.display = "";
    if (heroGuestActions) heroGuestActions.style.display = "";
    if (heroAccountActions) heroAccountActions.style.display = "none";
    if (ctaGuestActions) ctaGuestActions.style.display = "";
    if (ctaAccountActions) ctaAccountActions.style.display = "none";
  }
}

renderAuthState();

/* The badge is drawn straight away, but the real balance only arrives from
   the database a moment later. Without this the header kept showing the
   250 welcome-bonus default for the whole visit. */
document.addEventListener("eco:hydrated", renderAuthState);

/* ---- account dropdown toggle ---- */
if (accountToggle && accountDropdown && accountMenu) {
  accountToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = accountDropdown.classList.toggle("show");
    accountToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  document.addEventListener("click", (e) => {
    if (!accountMenu.contains(e.target)) {
      accountDropdown.classList.remove("show");
      accountToggle.setAttribute("aria-expanded", "false");
    }
  });
}

/* ---- logout: confirm first, then end session only (keep account + saved data) ---- */
const logoutConfirmOverlay = document.getElementById("logoutConfirmOverlay");
const logoutCancelBtn = document.getElementById("logoutCancelBtn");
const logoutConfirmBtn = document.getElementById("logoutConfirmBtn");

function openLogoutConfirm() {
  if (!logoutConfirmOverlay) return;
  // Close the account dropdown first so it isn't left open behind the modal
  if (accountDropdown) accountDropdown.classList.remove("show");
  if (accountToggle) accountToggle.setAttribute("aria-expanded", "false");

  logoutConfirmOverlay.classList.add("show");
  document.body.style.overflow = "hidden";
  // Focus the safe/default action (Cancel) so an accidental Enter press doesn't log the user out
  if (logoutCancelBtn) logoutCancelBtn.focus();
}

function closeLogoutConfirm() {
  if (!logoutConfirmOverlay) return;
  logoutConfirmOverlay.classList.remove("show");
  document.body.style.overflow = "";
}

function performLogout() {
  clearSession(); // clears BOTH localStorage and sessionStorage session copies
  closeLogoutConfirm();
  renderAuthState();
  window.location.href = "Main Page.html";
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openLogoutConfirm();
  });
}

if (logoutCancelBtn) {
  logoutCancelBtn.addEventListener("click", closeLogoutConfirm);
}

if (logoutConfirmBtn) {
  logoutConfirmBtn.addEventListener("click", performLogout);
}

if (logoutConfirmOverlay) {
  // Click on the dimmed backdrop (not the box itself) cancels, same as clicking Cancel
  logoutConfirmOverlay.addEventListener("click", (e) => {
    if (e.target === logoutConfirmOverlay) closeLogoutConfirm();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && logoutConfirmOverlay && logoutConfirmOverlay.classList.contains("show")) {
    closeLogoutConfirm();
  }
});

/* ---------- Toast notifications ---------- */
function showToast(title, sub) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <i class="fa-solid fa-circle-check"></i>
    <span class="toast-text">
      <span class="toast-title">${title}</span>
      ${sub ? `<span class="toast-sub">${sub}</span>` : ""}
    </span>
  `;
  container.appendChild(toast);

  // Remove the element once its fade-out animation finishes (~5.6s total)
  setTimeout(() => toast.remove(), 5700);
}

/* ---------- One-time "free points" welcome notification ----------
   Registration.html should set this flag right before sending a brand-new
   user here, e.g.:

     setSession({ fname, points: 250, ... });     // credit the free points
     sessionStorage.setItem("welcomeBonus", "250"); // flag to show the toast once
     window.location.href = "Main Page.html";

   This page reads the flag once, shows the toast, then clears it so it
   never reappears on refresh or on later visits. */
const welcomeBonus = sessionStorage.getItem("welcomeBonus");
if (welcomeBonus) {
  showToast(
    `You received ${Number(welcomeBonus).toLocaleString()} free EcoPoints! 🎉`,
    "Welcome to EcoPoints — submit your recyclables to start earning even more."
  );
  sessionStorage.removeItem("welcomeBonus");
}

/* ---------- Homepage stats bar ----------
   Fills in "Registered Households", "Recycled This Month", and "Rewards
   Distributed" from real data (getSiteStats() in user-module.js) instead
   of the static placeholder zeros. "Resident Satisfaction" is left as-is
   until a real feedback feature exists to back that number. */
async function renderSiteStats() {
  if (typeof window.getSiteStats !== "function") return;

  // getSiteStats() is async now that the figures come from MySQL.
  const stats = await window.getSiteStats();

  if (!stats) return;

  const householdsEl = document.getElementById("statHouseholds");
  const recycledEl = document.getElementById("statRecycled");
  const rewardsEl = document.getElementById("statRewardsDistributed");

  if (householdsEl) {
    householdsEl.textContent = `${stats.households.toLocaleString()}+`;
  }

  if (recycledEl) {
    const tons = stats.tonsThisMonth;
    const rounded = tons >= 10 ? Math.round(tons) : Math.round(tons * 10) / 10;
    recycledEl.textContent = `${rounded.toLocaleString()} tons`;
  }

  if (rewardsEl) {
    rewardsEl.textContent = `\u20B1${stats.phpDistributed.toLocaleString()}`;
  }
}

document.addEventListener("DOMContentLoaded", renderSiteStats);

/* ---------- Hero "trusted by" line ----------
   Same hardcoded-"0"-in-the-HTML issue as the impact card: "Trusted by 0+
   households" never updated. This is a community-wide trust signal (shown
   to guests too), so it uses getSiteStats() same as the stats bar below. */
async function renderHeroTrust() {
  if (typeof window.getSiteStats !== "function") return;
  const el = document.getElementById("heroTrustHouseholds");
  if (!el) return;

  const stats = await window.getSiteStats();
  if (!stats) return;
  if (typeof stats.households === "number") {
    el.textContent = `Trusted by ${stats.households.toLocaleString()}+ households in the barangay`;
  }
}

document.addEventListener("DOMContentLoaded", renderHeroTrust);

/* ---------- Hero "impact card" ----------
   Shows THIS LOGGED-IN USER'S OWN stats (not community-wide totals) —
   parsed from getHistory() the same way Achievements.html / My
   EcoPoints.html already do. A guest, or any account with no real
   recycling-submission entries yet, will correctly show 0s here; that's
   accurate, not broken, since there's no collector-verification flow
   creating those entries yet (see user-module.js). */
function renderImpactCard() {
  if (typeof window.getHistory !== "function") return;

  const history = window.getHistory();

  const kgEl = document.getElementById("statImpactKg");
  const submissionsEl = document.getElementById("statImpactMembers");
  const rewardsEl = document.getElementById("statImpactRewards");

  // Real recycling submissions = positive-point entries that aren't the
  // one-time Welcome Bonus or an achievement payout (those add points but
  // aren't a recycling drop-off, so they shouldn't inflate this count).
  const submissions = history.filter(entry => entry && entry.points > 0 && entry.type !== "bonus" && entry.type !== "achievement");

  let totalKg = 0;
  submissions.forEach(entry => {
    const match = String(entry.description || "").match(/\(([\d.]+)\s*kg\)/i);
    if (match) totalKg += parseFloat(match[1]);
  });

  if (kgEl) kgEl.textContent = Math.round(totalKg).toLocaleString();
  if (submissionsEl) submissionsEl.textContent = submissions.length.toLocaleString();

  // This user's own redemptions, in real peso value (matched against
  // REWARD_CATALOG the same way getSiteStats() does it community-wide).
  let ownPhpRedeemed = 0;
  if (Array.isArray(window.REWARD_CATALOG)) {
    history.forEach(entry => {
      if (!entry || entry.type !== "redeem") return;
      const reward = window.REWARD_CATALOG.find(r => entry.description === ("Redeemed " + r.name));
      if (reward && reward.phpValue) ownPhpRedeemed += reward.phpValue;
    });
  }
  if (rewardsEl) rewardsEl.textContent = `\u20B1${ownPhpRedeemed.toLocaleString()}`;
}

document.addEventListener("DOMContentLoaded", renderImpactCard);

/* ---------- Hero "recent submission" chip ----------
   Looks for the most recent history entry that's a real earn (positive
   points, not the one-time Welcome Bonus or an achievement payout) — i.e.
   an actual recycling submission once a collector-verification flow
   exists to create those entries. Until then this honestly shows +0, same
   as the impact card's kg Recycled figure, instead of a static fake number. */
function renderRecentSubmissionChip() {
  const chipPtsValue = document.getElementById("chipPtsValue");
  if (!chipPtsValue) return;

  let pts = 0;
  if (typeof window.getHistory === "function") {
    const history = window.getHistory();
    const submission = history.find(entry => entry && entry.points > 0 && entry.type !== "bonus" && entry.type !== "achievement");
    if (submission) pts = submission.points;
  }
  chipPtsValue.textContent = `+${pts.toLocaleString()} pts submitted`;
}

document.addEventListener("DOMContentLoaded", renderRecentSubmissionChip);