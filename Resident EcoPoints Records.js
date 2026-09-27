const RESIDENTS_PATH = "/api/residents";

const RESIDENTS_LIMIT = 200;

const COLLECTIONS_PATH = "/api/waste-collections";

const COLLECTIONS_LIMIT = 200;

const ACTIVE_SCAN_KEY = "ecoActiveScan";

let selectedResident = null;

let residentDirectory = [];

let residentCollections = [];

let residentTransactions = [];

// Set when the directory could not be loaded, so the table keeps the
// "server offline" note instead of claiming there are no residents.
let directoryError = "";

const residentCountTag = document.getElementById("residentCountTag");

const selResidentMini = document.getElementById("selResidentMini");

const selAvatar = document.getElementById("selAvatar");

const selName = document.getElementById("selName");

const selId = document.getElementById("selId");

const changeResidentLink = document.getElementById("changeResidentLink");

const residentSearchArea = document.getElementById("residentSearchArea");

const residentSearch = document.getElementById("residentSearch");

const residentTableBody = document.getElementById("residentTableBody");

const noResidentState = document.getElementById("noResidentState");

const recordArea = document.getElementById("recordArea");

const recBalance = document.getElementById("recBalance");

const recPurok = document.getElementById("recPurok");

const recEarned = document.getElementById("recEarned");

const recEarnedCount = document.getElementById("recEarnedCount");

const recUsed = document.getElementById("recUsed");

const recUsedCount = document.getElementById("recUsedCount");

const recWasteCount = document.getElementById("recWasteCount");

const recWasteNote = document.getElementById("recWasteNote");

const submittedCountTag = document.getElementById("submittedCountTag");

const verifiedCountTag = document.getElementById("verifiedCountTag");

const rejectedCountTag = document.getElementById("rejectedCountTag");

const redemptionCountTag = document.getElementById("redemptionCountTag");

const collectionCountTag = document.getElementById("collectionCountTag");

const transactionCountTag = document.getElementById("transactionCountTag");

const submittedTableBody = document.getElementById("submittedTableBody");

const verifiedTableBody = document.getElementById("verifiedTableBody");

const rejectedTableBody = document.getElementById("rejectedTableBody");

const redemptionTableBody = document.getElementById("redemptionTableBody");

const collectionTableBody = document.getElementById("collectionTableBody");

const transactionTableBody = document.getElementById("transactionTableBody");

const transactionFilter = document.getElementById("transactionFilter");

const globalSearch = document.getElementById("globalSearch");

function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));

    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

// Maps one row of GET /api/residents onto the property names the
// rendering code below already uses.
function toDirectoryEntry(row) {
  return {
    residentId: row.resident_id,
    id: String(row.account_id || ""),
    name: row.name || `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    purok: row.street || "Unassigned",
    points: Number(row.ecopoints_balance || 0),
    memberSince: row.created_at || "",
    email: row.email || "",
    submissions: Number(row.submissions_count || 0),
    collections: Number(row.collections_count || 0),
  };
}

// Maps one row of GET /api/waste-collections onto the property names the
// record tables already use (the old ecoWasteQueue shape).
function toCollectionEntry(row) {
  const status = String(row.verificationStatus || "pending").toLowerCase();

  return {
    id: String(row.collection_id ?? row.id ?? ""),
    residentId: row.resident_id,
    accountId: row.accountId || "",
    residentName: row.residentName || "",
    status,
    verificationStatus: status,
    wasteType: row.wasteType || "Not provided",
    weightKg: Number(row.weightKg || 0),
    pointsIssued: Number(row.pointsEarned || 0),
    collectorName: row.collectorName || "Not recorded",
    collectorNote: row.collectorNote || "",
    rejectionReason:
      status === "rejected" ? row.collectorNote || "No reason provided" : "",
    createdAt: row.collectedAt,
    submittedAt: row.collectedAt,
    collectedAt: row.collectedAt,
    completedAt: row.collectedAt,
    verifiedAt: row.verifiedAt,
    rejectedAt: status === "rejected" ? row.verifiedAt || row.collectedAt : "",
    updatedAt: row.verifiedAt || row.collectedAt,
  };
}

// Points history rows (resident_points_history) and reward redemptions
// share one shape so the transaction tables can render them together.
function toPointsEntry(row) {
  const points = Number(row.points || 0);

  return {
    id: `history-${row.history_id}`,
    type: points < 0 ? "redemption" : "earn",
    description: row.description || "Transaction",
    points,
    createdAt: row.created_at,
  };
}

function toRedemptionEntry(row) {
  const cost = Number(row.points_cost || 0);

  return {
    id: `redemption-${row.redemption_id}`,
    type: "redemption",
    description: row.reward_name || "Reward",
    rewardName: row.reward_name || "Reward",
    points: -cost,
    requiredEcoPoints: cost,
    remainingBalance: null,
    redemptionStatus: row.redemption_status || "",
    createdAt: row.redeemed_at,
  };
}

function getRegisteredResidents() {
  return residentDirectory;
}

function getResidentById(id) {
  return (
    getRegisteredResidents().find(
      (resident) => String(resident.id) === String(id),
    ) || null
  );
}

function residentMatches(record, resident) {
  if (!record || !resident) {
    return false;
  }

  if (record.residentId != null && resident.residentId != null) {
    return Number(record.residentId) === Number(resident.residentId);
  }

  if (record.accountId) {
    return (
      String(record.accountId).toUpperCase() === String(resident.id).toUpperCase()
    );
  }

  const recordName = String(record.residentName || record.name || "")
    .trim()
    .toLowerCase();

  const residentName = String(resident.name || "")
    .trim()
    .toLowerCase();

  return recordName && residentName && recordName === residentName;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value) {
  if (!value) {
    return "—";
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

function statusClass(status) {
  const value = String(status || "pending").toLowerCase();

  if (value === "verified") {
    return "status-verified";
  }

  if (value === "rejected") {
    return "status-rejected";
  }

  if (value === "completed") {
    return "status-completed";
  }

  if (value === "cancelled") {
    return "status-cancelled";
  }

  return "status-pending";
}

function statusBadge(status) {
  const value = String(status || "pending").toLowerCase();

  const label = value.charAt(0).toUpperCase() + value.slice(1);

  return `
        <span class="status-pill ${statusClass(value)}">
            ${escapeHtml(label)}
        </span>
    `;
}

function emptyRow(tbody, colspan, message = "No activity records yet.") {
  tbody.innerHTML = `
        <tr>
            <td
                colspan="${colspan}"
                style="text-align:center;padding:24px;color:var(--muted);"
            >
                ${escapeHtml(message)}
            </td>
        </tr>
    `;
}

function renderResidentTable() {
  if (directoryError) {
    return;
  }

  const term = String(residentSearch.value || "")
    .trim()
    .toLowerCase();

  const allResidents = getRegisteredResidents();

  const residents = allResidents.filter(
    (resident) =>
      !term ||
      resident.name.toLowerCase().includes(term) ||
      resident.id.toLowerCase().includes(term),
  );

  residentCountTag.textContent = `${allResidents.length} resident${
    allResidents.length === 1 ? "" : "s"
  }`;

  if (!residents.length) {
    emptyRow(
      residentTableBody,
      4,
      term ? "No residents match your search." : "No registered residents yet.",
    );

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
                                style="color:var(--muted);font-size:10px;"
                            >
                                ${escapeHtml(resident.id)}
                            </span>
                        </td>

                        <td>
                            ${escapeHtml(resident.purok)}
                        </td>

                        <td class="points-positive">
                            ${resident.points.toLocaleString()}
                            pts
                        </td>

                        <td>
                            <button
                                class="table-row-btn"
                                type="button"
                                data-select="${escapeHtml(resident.id)}"
                            >
                                View Record
                            </button>
                        </td>

                    </tr>
                `,
    )
    .join("");

  residentTableBody.querySelectorAll("[data-select]").forEach((button) => {
    button.addEventListener("click", () => {
      const resident = getResidentById(button.dataset.select);

      if (resident) {
        selectResident(resident);
      }
    });
  });
}

// Pulls the selected resident's points history and reward redemptions so
// the record tables are backed by the database, not the browser.
async function loadResidentTransactions(resident) {
  residentTransactions = [];

  if (!resident.residentId) {
    return false;
  }

  const res = await EcoApi.get(
    `${RESIDENTS_PATH}/${resident.residentId}/ecopoints`,
  );

  if (!res || res.offline || !res.success) {
    return false;
  }

  residentTransactions = [
    ...(res.history || []).map(toPointsEntry),
    ...(res.redemptions || []).map(toRedemptionEntry),
  ].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
  );

  return true;
}

async function selectResident(resident) {
  selectedResident = resident;

  selAvatar.textContent = getInitials(resident.name);

  selName.textContent = resident.name;

  selId.textContent = resident.id;

  selResidentMini.hidden = false;

  residentSearchArea.hidden = true;

  noResidentState.hidden = true;

  recordArea.hidden = false;

  const loaded = await loadResidentTransactions(resident);

  // A second click may have selected somebody else while we waited.
  if (selectedResident !== resident) {
    return;
  }

  renderRecord(loaded ? "" : loadFailureNote());
}

function clearSelection() {
  selectedResident = null;

  residentTransactions = [];

  selResidentMini.hidden = true;

  residentSearchArea.hidden = false;

  noResidentState.hidden = false;

  recordArea.hidden = true;

  residentSearch.value = "";

  renderResidentTable();
}

function getResidentCollections() {
  return residentCollections.filter((record) =>
    residentMatches(record, selectedResident),
  );
}

function getAllResidentTransactions() {
  return [...residentTransactions].sort(
    (a, b) =>
      new Date(b.createdAt || b.date || 0) -
      new Date(a.createdAt || a.date || 0),
  );
}

// `note` replaces the "Member since" line when the resident's points
// history could not be loaded, so the panel explains itself instead of
// showing an empty record.
function renderRecord(note = "") {
  if (!selectedResident) {
    return;
  }

  const freshResident = getResidentById(selectedResident.id);

  if (freshResident) {
    selectedResident = freshResident;
  }

  const queue = getResidentCollections();

  const allTransactions = getAllResidentTransactions();

  const earnTransactions = allTransactions.filter(
    (transaction) => Number(transaction.points || 0) > 0,
  );

  const redemptionTransactions = allTransactions.filter(
    (transaction) =>
      Number(transaction.points || 0) < 0 ||
      transaction.type === "redemption" ||
      transaction.type === "redeem",
  );

  const verified = queue.filter((record) => {
    const status = String(record.status || "").toLowerCase();

    return (
      status === "verified" || status === "completed" || record.pointsIssued
    );
  });

  recBalance.textContent = `${Number(
    selectedResident.points || 0,
  ).toLocaleString()} pts`;

  recPurok.textContent = note
    ? note
    : `${selectedResident.purok} · Member since ${formatDate(
        selectedResident.memberSince,
      )}`;

  recEarned.textContent = earnTransactions
    .reduce(
      (sum, transaction) => sum + Math.max(0, Number(transaction.points || 0)),
      0,
    )
    .toLocaleString();

  recEarnedCount.textContent = `${earnTransactions.length} record${
    earnTransactions.length === 1 ? "" : "s"
  }`;

  recUsed.textContent = redemptionTransactions
    .reduce(
      (sum, transaction) =>
        sum + Math.abs(Math.min(0, Number(transaction.points || 0))),
      0,
    )
    .toLocaleString();

  recUsedCount.textContent = `${redemptionTransactions.length} redemption${
    redemptionTransactions.length === 1 ? "" : "s"
  }`;

  recWasteCount.textContent = queue.length.toLocaleString();

  recWasteNote.textContent = `${verified.length} verified`;

  renderSubmitted(queue);
  renderVerified(queue);
  renderRejected(queue);
  renderRedemptions(allTransactions);
  renderCollections(queue);
  renderTransactions();
}

function renderSubmitted(queue) {
  const records = [...queue].sort(
    (a, b) =>
      new Date(b.submittedAt || b.createdAt || 0) -
      new Date(a.submittedAt || a.createdAt || 0),
  );

  submittedCountTag.textContent = `${records.length} record${
    records.length === 1 ? "" : "s"
  }`;

  if (!records.length) {
    emptyRow(submittedTableBody, 4);

    return;
  }

  submittedTableBody.innerHTML = records
    .map(
      (record) => `
                    <tr>

                        <td>
                            ${formatDateTime(
                              record.submittedAt || record.createdAt,
                            )}
                        </td>

                        <td>
                            <strong>
                                ${escapeHtml(
                                  record.wasteType || "Not provided",
                                )}
                            </strong>
                        </td>

                        <td>
                            ${escapeHtml(
                              record.weightKg ?? record.weight ?? "—",
                            )}
                            kg
                        </td>

                        <td>
                            ${statusBadge(record.status || "pending")}
                        </td>

                    </tr>
                `,
    )
    .join("");
}

function renderVerified(queue) {
  const records = queue
    .filter((record) => {
      const status = String(record.status || "").toLowerCase();

      return (
        status === "verified" || status === "completed" || record.pointsIssued
      );
    })
    .sort(
      (a, b) =>
        new Date(b.verifiedAt || b.completedAt || b.updatedAt || 0) -
        new Date(a.verifiedAt || a.completedAt || a.updatedAt || 0),
    );

  verifiedCountTag.textContent = `${records.length} record${
    records.length === 1 ? "" : "s"
  }`;

  if (!records.length) {
    emptyRow(verifiedTableBody, 4);

    return;
  }

  verifiedTableBody.innerHTML = records
    .map((record) => {
      const points = Number(record.pointsIssued || 0);

      const weight = Number(
        record.verifiedWeightKg ?? record.verifiedWeight ?? record.weightKg ?? 0,
      );

      return `
                    <tr>

                        <td>
                            ${formatDateTime(
                              record.verifiedAt ||
                                record.completedAt ||
                                record.updatedAt,
                            )}
                        </td>

                        <td>
                            <strong>
                                ${escapeHtml(
                                  record.wasteType || "Not provided",
                                )}
                            </strong>
                        </td>

                        <td>
                            ${weight.toLocaleString()}
                            kg
                        </td>

                        <td class="points-positive">
                            +${points.toLocaleString()}
                            pts
                        </td>

                    </tr>
                `;
    })
    .join("");
}

function renderRejected(queue) {
  const records = queue
    .filter(
      (record) => String(record.status || "").toLowerCase() === "rejected",
    )
    .sort(
      (a, b) =>
        new Date(b.rejectedAt || b.updatedAt || 0) -
        new Date(a.rejectedAt || a.updatedAt || 0),
    );

  rejectedCountTag.textContent = `${records.length} record${
    records.length === 1 ? "" : "s"
  }`;

  if (!records.length) {
    emptyRow(rejectedTableBody, 4);

    return;
  }

  rejectedTableBody.innerHTML = records
    .map(
      (record) => `
                    <tr>

                        <td>
                            ${formatDateTime(
                              record.rejectedAt || record.updatedAt,
                            )}
                        </td>

                        <td>
                            <strong>
                                ${escapeHtml(
                                  record.wasteType || "Not provided",
                                )}
                            </strong>
                        </td>

                        <td>
                            ${escapeHtml(
                              record.weightKg ?? record.weight ?? "—",
                            )}
                            kg
                        </td>

                        <td>
                            ${escapeHtml(
                              record.rejectionReason || "No reason provided",
                            )}
                        </td>

                    </tr>
                `,
    )
    .join("");
}

function renderRedemptions(allTransactions) {
  const records = allTransactions
    .filter(
      (transaction) =>
        transaction.referenceType === "rewardRedemption" ||
        transaction.type === "redemption" ||
        transaction.type === "redeem" ||
        (Number(transaction.points || 0) < 0 &&
          /redeem/i.test(String(transaction.description || ""))),
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt || b.date || 0) -
        new Date(a.createdAt || a.date || 0),
    );

  redemptionCountTag.textContent = `${records.length} record${
    records.length === 1 ? "" : "s"
  }`;

  if (!records.length) {
    emptyRow(redemptionTableBody, 4);

    return;
  }

  redemptionTableBody.innerHTML = records
    .map(
      (record) => `
                    <tr>

                        <td>
                            ${formatDateTime(record.createdAt || record.date)}
                        </td>

                        <td>
                            <strong>
                                ${escapeHtml(
                                  record.rewardName ||
                                    record.description ||
                                    "Reward",
                                )}
                            </strong>
                        </td>

                        <td class="points-negative">
                            −${Math.abs(
                              Number(
                                record.requiredEcoPoints ?? record.points ?? 0,
                              ),
                            ).toLocaleString()}
                            pts
                        </td>

                        <td>
                            ${
                              record.remainingBalance == null
                                ? "—"
                                : `${Number(
                                    record.remainingBalance,
                                  ).toLocaleString()} pts`
                            }
                        </td>

                    </tr>
                `,
    )
    .join("");
}

function renderCollections(queue) {
  const records = queue
    .filter((record) => {
      const status = String(record.status || "").toLowerCase();

      return (
        status === "completed" ||
        record.collectedAt ||
        record.collectionCompletedAt
      );
    })
    .sort(
      (a, b) =>
        new Date(b.completedAt || b.collectedAt || b.updatedAt || 0) -
        new Date(a.completedAt || a.collectedAt || a.updatedAt || 0),
    );

  collectionCountTag.textContent = `${records.length} record${
    records.length === 1 ? "" : "s"
  }`;

  if (!records.length) {
    emptyRow(collectionTableBody, 4);

    return;
  }

  collectionTableBody.innerHTML = records
    .map(
      (record) => `
                    <tr>

                        <td>
                            ${formatDateTime(
                              record.completedAt ||
                                record.collectedAt ||
                                record.updatedAt,
                            )}
                        </td>

                        <td>
                            <strong>
                                ${escapeHtml(
                                  record.wasteType || "Not provided",
                                )}
                            </strong>
                        </td>

                        <td>
                            ${Number(
                              record.verifiedWeightKg ??
                                record.verifiedWeight ??
                                record.weightKg ??
                                record.weight ??
                                0,
                            ).toLocaleString()}
                            kg
                        </td>

                        <td>
                            ${statusBadge(record.status || "completed")}
                        </td>

                    </tr>
                `,
    )
    .join("");
}

function renderTransactions() {
  const filter = transactionFilter.value;

  let records = getAllResidentTransactions();

  if (filter === "earn") {
    records = records.filter(
      (transaction) => Number(transaction.points || 0) > 0,
    );
  }

  if (filter === "redemption") {
    records = records.filter(
      (transaction) =>
        Number(transaction.points || 0) < 0 ||
        transaction.type === "redemption" ||
        transaction.type === "redeem",
    );
  }

  transactionCountTag.textContent = `${records.length} record${
    records.length === 1 ? "" : "s"
  }`;

  if (!records.length) {
    emptyRow(transactionTableBody, 4);

    return;
  }

  transactionTableBody.innerHTML = records
    .map((transaction) => {
      const points = Number(transaction.points || 0);

      const isUsed =
        points < 0 ||
        transaction.type === "redemption" ||
        transaction.type === "redeem";

      const type = isUsed ? "Used" : "Earned";

      const badgeClass = isUsed ? "status-rejected" : "status-verified";

      return `
                        <tr>

                            <td>
                                ${formatDateTime(
                                  transaction.createdAt || transaction.date,
                                )}
                            </td>

                            <td>
                                <span
                                    class="status-pill ${badgeClass}"
                                >
                                    ${type}
                                </span>
                            </td>

                            <td>
                                ${escapeHtml(
                                  transaction.description ||
                                    transaction.rewardName ||
                                    "Transaction",
                                )}
                            </td>

                            <td
                                class="${
                                  isUsed ? "points-negative" : "points-positive"
                                }"
                            >
                                ${isUsed ? "−" : "+"}${Math.abs(
                                  points,
                                ).toLocaleString()}
                                pts
                            </td>

                        </tr>
                    `;
    })
    .join("");
}

async function initFromActiveScan() {
  const active = readJSON(ACTIVE_SCAN_KEY, null);

  if (!active || !active.id) {
    return;
  }

  const resident = getResidentById(active.id);

  if (resident) {
    await selectResident(resident);
  }
}

function loadFailureNote() {
  return "Couldn't load this resident's record from the server. Start it with \"npm start\", then select the resident again.";
}

function showDirectoryNote(message) {
  directoryError = message;

  residentCountTag.textContent = message;

  emptyRow(residentTableBody, 4, message);

  noResidentState.querySelector("span").textContent = message;
}

async function loadResidents() {
  const res = await EcoApi.get(
    `${RESIDENTS_PATH}?status=active&search=&limit=${RESIDENTS_LIMIT}`,
  );

  if (!res || res.offline || !res.success) {
    showDirectoryNote(
      res && res.offline
        ? "Server offline"
        : "Couldn't load residents",
    );

    return;
  }

  residentDirectory = (res.residents || [])
    .filter((row) => row && row.account_id)
    .map(toDirectoryEntry)
    .sort((a, b) => a.name.localeCompare(b.name));

  directoryError = "";

  renderResidentTable();
}

async function loadCollections() {
  const res = await EcoApi.get(
    `${COLLECTIONS_PATH}?status=all&limit=${COLLECTIONS_LIMIT}`,
  );

  if (!res || res.offline || !res.success) {
    residentCollections = [];

    return;
  }

  residentCollections = (res.collections || [])
    .filter((row) => row && (row.collection_id ?? row.id))
    .map(toCollectionEntry);
}

async function init() {
  const [residentsRes, collectionsRes] = await Promise.all([
    loadResidents(),
    loadCollections(),
  ]);

  if (!residentsRes) {
    return;
  }

  await initFromActiveScan();

  if (!collectionsRes && selectedResident) {
    renderRecord(
      "Waste records are unavailable right now. Start the server with \"npm start\" to load them.",
    );
  }
}

residentSearch.addEventListener("input", renderResidentTable);

transactionFilter.addEventListener("change", renderTransactions);

changeResidentLink.addEventListener("click", (event) => {
  event.preventDefault();
  clearSelection();
});

globalSearch.addEventListener("input", () => {
  residentSearch.value = globalSearch.value;

  renderResidentTable();
});

document.addEventListener("DOMContentLoaded", init);
