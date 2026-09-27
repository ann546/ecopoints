const REWARDS_PATH = "/api/rewards";
const RESIDENTS_PATH = "/api/residents";

// Offline fallback catalog only. The live list - name, cost, stock and
// icon - comes from the rewards table through GET /api/rewards.
const REWARD_INVENTORY = [
  {
    id: "rice5",
    name: "5kg Rice Pack",
    icon: "fa-bowl-rice",
    cost: 1200,
    stock: 10,
  },
  {
    id: "grocery",
    name: "Grocery Pack",
    icon: "fa-basket-shopping",
    cost: 3000,
    stock: 10,
  },
  {
    id: "ecobag",
    name: "Eco Bag",
    icon: "fa-bag-shopping",
    cost: 600,
    stock: 10,
  },
  {
    id: "loadcard",
    name: "Mobile Load ₱50",
    icon: "fa-mobile-screen",
    cost: 800,
    stock: 10,
  },
  {
    id: "canned",
    name: "Canned Goods Pack",
    icon: "fa-box",
    cost: 900,
    stock: 10,
  },
  {
    id: "detergent",
    name: "Laundry Detergent",
    icon: "fa-soap",
    cost: 700,
    stock: 10,
  },
];

const residentDirectoryKey = "ecoUsers";

let selectedResident = null;
let pendingReward = null;

const residentCountTag = document.getElementById("residentCountTag");

const residentSearch = document.getElementById("residentSearch");

const residentTableBody = document.getElementById("residentTableBody");

const residentSelection = document.getElementById("residentSelection");

const selectedResidentPanel = document.getElementById("selectedResidentPanel");

const selectedAvatar = document.getElementById("selectedAvatar");

const selectedResidentName = document.getElementById("selectedResidentName");

const selectedResidentId = document.getElementById("selectedResidentId");

const changeResident = document.getElementById("changeResident");

const noResidentState = document.getElementById("noResidentState");

const rewardArea = document.getElementById("rewardArea");

const currentBalance = document.getElementById("currentBalance");

const balanceResident = document.getElementById("balanceResident");

const rewardList = document.getElementById("rewardList");

const redemptionMessage = document.getElementById("redemptionMessage");

const redemptionHistory = document.getElementById("redemptionHistory");

const confirmOverlay = document.getElementById("confirmOverlay");

const confirmResident = document.getElementById("confirmResident");

const confirmReward = document.getElementById("confirmReward");

const confirmCost = document.getElementById("confirmCost");

const confirmBalance = document.getElementById("confirmBalance");

const confirmRemaining = document.getElementById("confirmRemaining");

const confirmStock = document.getElementById("confirmStock");

const cancelConfirm = document.getElementById("cancelConfirm");

const confirmRedemption = document.getElementById("confirmRedemption");

const redemptionSuccess = document.getElementById("redemptionSuccess");

const successMessage = document.getElementById("successMessage");

const successTransaction = document.getElementById("successTransaction");

const newRedemptionBtn = document.getElementById("newRedemptionBtn");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getInitials(name) {
  const parts = String(name || "Resident")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "R";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getResidentsForRedemption() {
  if (typeof getResidents !== "function") {
    return [];
  }

  return getResidents().filter(
    (resident) =>
      resident &&
      resident.id &&
      !["ECO-2026-0043"].includes(String(resident.id).toUpperCase()),
  );
}

/* ============================================================
   REWARD CATALOG  (MySQL: rewards table)
   ============================================================ */

let rewardCatalog = [];

function toReward(row) {
  return {
    reward_id: row.reward_id,
    id: row.id || row.slug || "",
    name: row.name || row.reward_name || "Reward",
    icon: row.icon || "fa-gift",
    cost: Number(row.cost ?? row.points_cost ?? 0),
    phpValue: Number(row.phpValue ?? row.php_value ?? 0),
    stock: Number(row.stock || 0),
    inStock: row.inStock !== false && Number(row.stock || 0) > 0,
  };
}

async function loadRewards() {
  if (!window.EcoApi) {
    return rewardCatalog;
  }

  let res = null;

  try {
    res = await window.EcoApi.get(REWARDS_PATH);
  } catch {
    res = null;
  }

  if (res && res.success && Array.isArray(res.rewards) && res.rewards.length) {
    rewardCatalog = res.rewards.map(toReward);
  }

  return rewardCatalog;
}

// user-module.js already replaces window.REWARD_CATALOG during
// hydration, so that is the second source; REWARD_INVENTORY is only
// reached when the server cannot be reached at all.
function getRewardInventory() {
  if (rewardCatalog.length) {
    return rewardCatalog;
  }

  if (Array.isArray(window.REWARD_CATALOG) && window.REWARD_CATALOG.length) {
    return window.REWARD_CATALOG;
  }

  return REWARD_INVENTORY;
}

function getRewardStock() {
  const stock = {};

  getRewardInventory().forEach((reward) => {
    stock[reward.id] = Number(reward.stock) || 0;
  });

  return stock;
}

function getRewardStockValue(reward) {
  const live = getRewardInventory().find((item) => item.id === reward.id);
  const value = Number(live ? live.stock : NaN);

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

/* ============================================================
   REDEMPTION RECORDS  (MySQL: resident_reward_redemptions)
   ============================================================ */

let cachedRedemptions = [];
let redemptionsOffline = false;

function getTransactions() {
  return cachedRedemptions;
}

function getRedemptionTransactions() {
  return cachedRedemptions.filter(
    (transaction) =>
      transaction &&
      (transaction.referenceType === "rewardRedemption" ||
        transaction.type === "redemption"),
  );
}

function toRedemptionRecord(row, resident) {
  return {
    id: "ECO-RED-" + row.redemption_id,
    redemptionId: row.redemption_id,
    type: "redemption",
    referenceType: "rewardRedemption",
    residentId: resident ? resident.id || "" : "",
    residentName: resident ? resident.name || "Resident" : "",
    rewardId: row.reward_name,
    rewardName: row.reward_name,
    points: -Number(row.points_cost || 0),
    requiredEcoPoints: Number(row.points_cost || 0),
    pointsUsed: Number(row.points_cost || 0),
    status: row.redemption_status || "pending",
    claimedAt: row.claimed_at,
    description: "Redeemed " + row.reward_name,
    createdAt: row.redeemed_at,
  };
}

// Redemptions are stored per resident, so the records panel follows the
// resident selected on the left. Returns false when the server could
// not be reached so the caller can show a note instead of an empty list.
async function refreshRedemptions(resident) {
  cachedRedemptions = [];
  redemptionsOffline = false;

  const residentPk = resident
    ? (resident.residentId ?? resident.resident_id)
    : null;

  if (!residentPk || !window.EcoApi) {
    return true;
  }

  let res = null;

  try {
    res = await window.EcoApi.get(
      `${RESIDENTS_PATH}/${residentPk}/redemptions`,
    );
  } catch {
    res = null;
  }

  if (!res || res.offline || !res.success) {
    redemptionsOffline = true;

    return false;
  }

  cachedRedemptions = (res.redemptions || []).map((row) =>
    toRedemptionRecord(row, resident),
  );

  return true;
}

/* ============================================================
   RESIDENT DIRECTORY + RENDERING
   ============================================================ */

// The directory itself is hydrated by api-client.js / collector-module.js.
// If it came back empty *and* the server reported offline, say so instead
// of implying there are simply no accounts.
function isDirectoryOffline() {
  return (
    !getResidentsForRedemption().length &&
    typeof window.EcoUser === "object" &&
    window.EcoUser !== null &&
    typeof window.EcoUser.isOffline === "function" &&
    window.EcoUser.isOffline()
  );
}

function renderResidentTable() {
  if (!residentTableBody) {
    return;
  }

  const searchTerm = String(residentSearch?.value || "")
    .trim()
    .toLowerCase();

  const residents = getResidentsForRedemption().filter((resident) => {
    if (!searchTerm) {
      return true;
    }

    return (
      String(resident.name || "")
        .toLowerCase()
        .includes(searchTerm) ||
      String(resident.id || "")
        .toLowerCase()
        .includes(searchTerm)
    );
  });

  const totalResidents = getResidentsForRedemption().length;

  const offline = isDirectoryOffline();

  residentCountTag.textContent = offline
    ? "Server offline"
    : `${totalResidents} resident${totalResidents === 1 ? "" : "s"}`;

  if (!residents.length) {
    residentTableBody.innerHTML = `
            <tr>
                <td
                    colspan="4"
                    style="text-align:center;padding:28px;color:var(--muted);"
                >
                    ${
                      offline
                        ? 'Start the EcoPoints server with "npm start", then refresh this page.'
                        : searchTerm
                          ? "No residents match your search."
                          : "No resident accounts available."
                    }
                </td>
            </tr>
        `;

    return;
  }

  residentTableBody.innerHTML = residents
    .map(
      (resident) => `
            <tr>
                <td>
                    <strong>
                        ${escapeHtml(resident.name)}
                    </strong>
                    <br>
                    <span
                        style="font-size:10px;color:var(--muted);"
                    >
                        ${escapeHtml(resident.id)}
                    </span>
                </td>

                <td>
                    ${escapeHtml(resident.purok || "Unassigned")}
                </td>

                <td class="resident-points">
                    ${Number(resident.points || 0).toLocaleString()} pts
                </td>

                <td>
                    <button
                        type="button"
                        class="table-row-btn"
                        data-resident-id="${escapeHtml(resident.id)}"
                    >
                        Select
                    </button>
                </td>
            </tr>
        `,
    )
    .join("");

  residentTableBody.querySelectorAll("[data-resident-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const resident = getResidentsForRedemption().find(
        (item) => String(item.id) === String(button.dataset.residentId),
      );

      if (resident) {
        selectResident(resident);
      }
    });
  });
}

async function selectResident(resident) {
  selectedResident = resident;

  selectedAvatar.textContent = getInitials(resident.name);

  selectedResidentName.textContent = resident.name;

  selectedResidentId.textContent = resident.id;

  residentSelection.hidden = true;
  selectedResidentPanel.hidden = false;

  noResidentState.hidden = true;
  rewardArea.hidden = false;

  updateResidentBalance();
  renderRewardList();
  clearMessage();

  await refreshRedemptions(resident);

  renderRedemptionHistory();
}

function clearResidentSelection() {
  selectedResident = null;
  pendingReward = null;
  cachedRedemptions = [];

  residentSelection.hidden = false;
  selectedResidentPanel.hidden = true;

  noResidentState.hidden = false;
  rewardArea.hidden = true;

  if (residentSearch) {
    residentSearch.value = "";
  }

  renderResidentTable();
  renderRedemptionHistory();
  clearMessage();
}

function updateResidentBalance() {
  if (!selectedResident) {
    return;
  }

  const freshResident = findResidentById(selectedResident.id);

  if (freshResident) {
    selectedResident = freshResident;
  }

  const points = Number(selectedResident.points || 0);

  currentBalance.textContent = `${points.toLocaleString()} pts`;

  balanceResident.textContent = selectedResident.name;
}

function renderRewardList() {
  if (!selectedResident) {
    return;
  }

  updateResidentBalance();

  const balance = Number(selectedResident.points || 0);

  const stock = getRewardStock();

  rewardList.innerHTML = getRewardInventory()
    .map((reward) => {
      const availableStock = Number(stock[reward.id] ?? reward.stock);

      const hasEnoughPoints = balance >= reward.cost;

      const hasStock = availableStock > 0;

      const canRedeem = hasEnoughPoints && hasStock;

      let statusText = "";

      if (!hasStock) {
        statusText = "Out of stock";
      } else if (!hasEnoughPoints) {
        statusText = `${(reward.cost - balance).toLocaleString()} pts needed`;
      } else {
        statusText = "Resident can redeem";
      }

      return `
                <div class="reward-card">

                    <div class="reward-icon">
                        <i class="fa-solid ${reward.icon}"></i>
                    </div>

                    <div>
                        <span class="reward-name">
                            ${escapeHtml(reward.name)}
                        </span>

                        <div class="reward-details">

                            <span class="reward-cost">
                                ${reward.cost.toLocaleString()} EcoPoints
                            </span>

                            <span
                                class="reward-stock ${hasStock ? "" : "out"}"
                            >
                                Stock: ${availableStock}
                            </span>

                            <span>
                                ${statusText}
                            </span>

                        </div>

                    </div>

                    <div class="reward-action">

                        <button
                            type="button"
                            class="btn-small"
                            data-reward-id="${escapeHtml(reward.id)}"
                            ${canRedeem ? "" : "disabled"}
                        >
                            ${
                              canRedeem
                                ? "Process"
                                : hasStock
                                  ? "Not enough"
                                  : "Out of stock"
                            }
                        </button>

                    </div>

                </div>
            `;
    })
    .join("");

  rewardList.querySelectorAll("[data-reward-id]").forEach((button) => {
    button.addEventListener("click", () => {
      prepareRedemption(button.dataset.rewardId);
    });
  });
}

function prepareRedemption(rewardId) {
  if (!selectedResident) {
    showMessage("Select a resident first.", "error");

    return;
  }

  const reward = getRewardInventory().find(
    (item) => String(item.id) === String(rewardId),
  );

  if (!reward) {
    showMessage("Reward not found.", "error");

    return;
  }

  const freshResident = findResidentById(selectedResident.id);

  if (!freshResident) {
    showMessage("The resident account could not be found.", "error");

    return;
  }

  selectedResident = freshResident;

  const balance = Number(selectedResident.points || 0);

  const stock = getRewardStockValue(reward);

  if (balance < reward.cost) {
    showMessage(
      `Resident needs ${(reward.cost - balance).toLocaleString()} more EcoPoints.`,
      "error",
    );

    return;
  }

  if (stock <= 0) {
    showMessage(`${reward.name} is currently out of stock.`, "error");

    return;
  }

  pendingReward = reward;

  confirmResident.textContent = selectedResident.name;

  confirmReward.textContent = reward.name;

  confirmCost.textContent = `${reward.cost.toLocaleString()} pts`;

  confirmBalance.textContent = `${balance.toLocaleString()} pts`;

  confirmRemaining.textContent = `${(
    balance - reward.cost
  ).toLocaleString()} pts`;

  confirmStock.textContent = `${stock} available`;

  confirmOverlay.classList.add("show");
}

function closeConfirmation() {
  pendingReward = null;

  confirmOverlay.classList.remove("show");
}

function applyResidentBalance(accountId, balance) {
  const row = findResidentById(accountId);

  if (row && Number.isFinite(Number(balance))) {
    row.points = Number(balance);
  }
}

// Stock lives in the rewards table, so the decrement the old page did
// against localStorage is now a real write. Failures are ignored -
// the redemption itself already succeeded.
async function decrementRewardStock(reward, currentStock) {
  const rewardId = reward.reward_id;

  if (!rewardId || !window.EcoApi) {
    return;
  }

  try {
    await window.EcoApi.patch(`${REWARDS_PATH}/${rewardId}`, {
      stock: Math.max(0, Number(currentStock) - 1),
    });
  } catch {
    /* nothing to do here */
  }
}

async function confirmRedemptionTransaction() {
  if (!selectedResident || !pendingReward) {
    closeConfirmation();
    return;
  }

  const freshResident = findResidentById(selectedResident.id);

  if (!freshResident) {
    closeConfirmation();

    showMessage("The resident account could not be found.", "error");

    return;
  }

  selectedResident = freshResident;

  const reward = getRewardInventory().find(
    (item) => String(item.id) === String(pendingReward.id),
  );

  if (!reward) {
    closeConfirmation();

    showMessage("The selected reward is no longer available.", "error");

    return;
  }

  const residentPk = selectedResident.residentId ?? selectedResident.resident_id;

  if (!residentPk) {
    closeConfirmation();

    showMessage(
      "This resident account is not linked to the database yet.",
      "error",
    );

    return;
  }

  const balance = Number(selectedResident.points || 0);

  const stock = getRewardStockValue(reward);

  if (balance < reward.cost) {
    closeConfirmation();

    showMessage("The resident no longer has enough EcoPoints.", "error");

    renderRewardList();

    return;
  }

  if (stock <= 0) {
    closeConfirmation();

    showMessage("This reward is now out of stock.", "error");

    renderRewardList();

    return;
  }

  const resident = selectedResident;
  const rewardName = reward.name;
  const cost = Number(reward.cost);

  closeConfirmation();

  if (confirmRedemption) {
    confirmRedemption.disabled = true;
  }

  let res = null;

  try {
    res = await window.EcoApi.post(`${RESIDENTS_PATH}/${residentPk}/redeem`, {
      reward_id: reward.id,
    });
  } catch {
    res = null;
  }

  if (confirmRedemption) {
    confirmRedemption.disabled = false;
  }

  if (!res || res.offline || !res.success) {
    showMessage(
      res && res.offline
        ? 'Server offline - the redemption was not saved. Start it with "npm start" and try again.'
        : (res && res.error) ||
            "The redemption could not be processed.",
      "error",
    );

    renderRewardList();

    return;
  }

  applyResidentBalance(resident.id, res.balance ?? balance - cost);

  await decrementRewardStock(reward, stock);
  await loadRewards();
  await refreshRedemptions(resident);

  updateResidentBalance();
  renderRewardList();
  renderRedemptionHistory();

  const latest = getRedemptionTransactions()[0];
  const transactionId = latest
    ? latest.id
    : `ECO-RED-${Date.now().toString(36).toUpperCase()}`;

  successMessage.innerHTML = `${escapeHtml(resident.name)} redeemed <strong>${escapeHtml(rewardName)}</strong> for <strong>${cost.toLocaleString()} EcoPoints</strong>.`;

  successTransaction.textContent = `Transaction: ${transactionId}`;

  redemptionSuccess.classList.add("show");

  redemptionSuccess.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function renderRedemptionHistory() {
  if (!redemptionHistory) {
    return;
  }

  const records = getRedemptionTransactions();

  if (!records.length) {
    const hint = selectedResident
      ? redemptionsOffline
        ? "Could not load redemptions from the server. Start it with &quot;npm start&quot;."
        : "This resident has not redeemed a reward yet."
      : "Select a resident to view their reward redemptions.";

    redemptionHistory.innerHTML = `
            <div class="redemption-empty">
                <i class="fa-solid fa-receipt"></i>
                <strong>No redemption records yet.</strong>
                <p>${hint}</p>
            </div>
        `;

    return;
  }

  redemptionHistory.innerHTML = records
    .map(
      (record) => `
            <div class="redemption-record">

                <div class="redemption-record-icon">
                    <i class="fa-solid fa-gift"></i>
                </div>

                <div>
                    <span class="redemption-record-name">
                        ${escapeHtml(record.rewardName || "Reward")}
                        ·
                        ${escapeHtml(record.residentName || "Resident")}
                    </span>

                    <span class="redemption-record-meta">
                        ${escapeHtml(record.residentId || "")}
                        ·
                        ${formatDateTime(record.createdAt)}
                        ·
                        Transaction:
                        ${escapeHtml(record.id)}
                    </span>
                </div>

                <span class="redemption-record-points">
                    −${Number(
                      Math.abs(record.points || 0),
                    ).toLocaleString()} pts
                </span>

            </div>
        `,
    )
    .join("");
}

function formatDateTime(value) {
  if (!value) {
    return "Unknown date";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function showMessage(message, type) {
  redemptionMessage.textContent = message;

  redemptionMessage.className = `form-note ${type || ""}`;
}

function clearMessage() {
  redemptionMessage.textContent = "";
  redemptionMessage.className = "form-note";
}

function resetAfterSuccess() {
  redemptionSuccess.classList.remove("show");

  clearResidentSelection();

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

async function initializeRedemptionPage() {
  await loadRewards();

  renderResidentTable();
  renderRedemptionHistory();

  if (residentSearch) {
    residentSearch.addEventListener("input", renderResidentTable);
  }

  if (changeResident) {
    changeResident.addEventListener("click", (event) => {
      event.preventDefault();
      clearResidentSelection();
    });
  }

  if (cancelConfirm) {
    cancelConfirm.addEventListener("click", closeConfirmation);
  }

  if (confirmRedemption) {
    confirmRedemption.addEventListener("click", confirmRedemptionTransaction);
  }

  if (confirmOverlay) {
    confirmOverlay.addEventListener("click", (event) => {
      if (event.target === confirmOverlay) {
        closeConfirmation();
      }
    });
  }

  if (newRedemptionBtn) {
    newRedemptionBtn.addEventListener("click", resetAfterSuccess);
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== residentDirectoryKey) {
      return;
    }

    renderResidentTable();

    if (selectedResident) {
      const fresh = findResidentById(selectedResident.id);

      if (fresh) {
        selectedResident = fresh;

        updateResidentBalance();
        renderRewardList();
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", initializeRedemptionPage);
