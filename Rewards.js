let REWARDS_BALANCE = 0;
let REWARDS_ACCOUNT_ID = "";
let REWARDS_USES_MYSQL = false;
let REWARDS_LOAD_FAILED = false;

function syncRewardsTopbar() {
  const name = getUserName();

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

async function loadRewardsResident() {
  const session = getSession();

  REWARDS_USES_MYSQL = !!(session && session.residentId);
  REWARDS_LOAD_FAILED = false;

  if (!REWARDS_USES_MYSQL) {
    REWARDS_BALANCE = getPoints();
    REWARDS_ACCOUNT_ID = getUserId();
    return;
  }

  try {
    const response = await fetch(
      `/api/residents/${encodeURIComponent(session.residentId)}`
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to load resident data.");
    }

    REWARDS_BALANCE = Number(data.resident.ecopoints_balance || 0);
    REWARDS_ACCOUNT_ID = data.resident.account_id;
  } catch (error) {
    console.error("Rewards MySQL error:", error);

    REWARDS_LOAD_FAILED = true;
    REWARDS_BALANCE = 0;
    REWARDS_ACCOUNT_ID = session.accountId || "—";

    const msg = document.getElementById("rewardMessage");

    msg.className = "form-note error";
    msg.textContent =
      "Cannot connect to the EcoPoints server. Make sure node server.js is running.";
  }
}

function renderRewards() {
  const balance = REWARDS_BALANCE;

  document.getElementById("rewardsBalance").textContent =
    balance.toLocaleString() + " pts";

  document.getElementById("rewardsUserId").textContent = REWARDS_ACCOUNT_ID;

  const list = document.getElementById("rewardList");

  list.innerHTML = REWARD_CATALOG.map((reward) => {
    const canAfford = !REWARDS_LOAD_FAILED && balance >= reward.cost;
    const pct = Math.min(100, Math.round((balance / reward.cost) * 100));

    return `
        <div class="reward-row">
          <div class="reward-icon"><i class="fa-solid ${reward.icon}"></i></div>
          <div class="reward-info">
            <span class="reward-title">${reward.name}</span>
            <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
            <span class="reward-meta">${reward.cost} pts ${canAfford ? "&middot; You have enough" : "&middot; " + Math.max(reward.cost - balance, 0) + " to go"}</span>
          </div>
          <button class="btn-small" data-id="${reward.id}" ${canAfford ? "" : "disabled"}>${canAfford ? "Redeem" : "Not enough"}</button>
        </div>
      `;
  }).join("");

  list.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => redeem(btn.dataset.id));
  });
}

async function redeem(id) {
  const msg = document.getElementById("rewardMessage");
  const session = getSession();

  if (!REWARDS_USES_MYSQL) {
    const result = redeemReward(id);

    msg.className = "form-note " + (result.success ? "success" : "error");
    msg.textContent = result.message;

    await loadRewardsResident();
    renderRewards();

    if (window.EcoNotifs) EcoNotifs.refresh();

    return;
  }

  document
    .querySelectorAll("#rewardList button[data-id]")
    .forEach((btn) => (btn.disabled = true));

  try {
    const response = await fetch(
      `/api/residents/${encodeURIComponent(session.residentId)}/redeem`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          reward_id: id
        })
      }
    );

    const data = await response.json();

    if (typeof data.balance === "number") {
      REWARDS_BALANCE = data.balance;
    }

    if (!response.ok || !data.success) {
      msg.className = "form-note error";
      msg.textContent = data.error || "Could not process your redemption.";
    } else {
      if (typeof data.balance !== "number") {
        const reward = REWARD_CATALOG.find((r) => r.id === id);

        REWARDS_BALANCE = Math.max(REWARDS_BALANCE - reward.cost, 0);
      }

      msg.className = "form-note success";
      msg.textContent = data.message;
    }
  } catch (error) {
    console.error("Redeem error:", error);

    msg.className = "form-note error";
    msg.textContent =
      "Cannot connect to the EcoPoints server. Make sure node server.js is running.";
  }

  renderRewards();

  if (window.EcoNotifs) EcoNotifs.refresh();
}

document.addEventListener("DOMContentLoaded", async () => {
  syncRewardsTopbar();

  await loadRewardsResident();

  renderRewards();
});

/* The balance shown on each card comes from getPoints() until the resident
   row lands, so redraw once the shared hydration has finished. */
document.addEventListener("eco:hydrated", async () => {
  await loadRewardsResident();
  renderRewards();
});
