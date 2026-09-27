const HISTORY_PATH = "/api/collection-history";

const HISTORY_LIMIT = 200;

const statCollections = document.getElementById("statCollections");

const statIssued = document.getElementById("statIssued");

const statIssuedCount = document.getElementById("statIssuedCount");

const statWeight = document.getElementById("statWeight");

const statResidents = document.getElementById("statResidents");

const statResidentNote = document.getElementById("statResidentNote");

const historyCount = document.getElementById("historyCount");

const historySearch = document.getElementById("historySearch");

const wasteFilter = document.getElementById("wasteFilter");

const verificationFilter = document.getElementById("verificationFilter");

const historyTableBody = document.getElementById("historyTableBody");

const globalSearch = document.getElementById("globalSearch");

const historyModal = document.getElementById("historyModal");

const historyModalBody = document.getElementById("historyModalBody");

const historyModalClose = document.getElementById("historyModalClose");

let completedRecords = [];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateTime(value) {
  if (!value) {
    return "Not recorded";
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

function formatWeight(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function titleCase(value) {
  const text = String(value ?? "").trim();

  if (!text) {
    return "Not recorded";
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getRegisteredResidents() {
  return getResidents().filter((resident) => resident && resident.id);
}

// Maps one row of GET /api/collection-history onto the property names the
// render code below already uses. The SQL view already joins each
// collection to its resident and collector, so no local join is needed.
function toHistoryRecord(row) {
  const verified = String(row.verificationStatus || "").trim();

  return {
    id: String(row.id ?? row.collection_id ?? ""),

    date: row.collected_at,

    residentId: row.accountId || "",

    residentName: row.residentName || "Unnamed resident",

    purok: row.street || "Unassigned",

    wasteType: row.wasteType || "Not provided",

    weight: Number(row.weightKg || 0),

    collectorId: row.collectorCode || "",

    collectorName: row.collectorName || "Not recorded",

    verificationStatus: verified
      ? titleCase(verified)
      : row.verifiedAt
        ? "Verified"
        : "Not recorded",

    ecoPoints: Number(row.pointsEarned || 0),

    condition: "Not recorded",

    submittedAt: row.collected_at,

    verifiedAt: row.verifiedAt,

    completedAt: row.collected_at,

    transactionId: "",

    verificationNotes: row.collectorNote || "",
  };
}

function showHistoryNote(message) {
  historyCount.textContent = message;

  historyTableBody.innerHTML = `
            <tr>
                <td
                    colspan="8"
                    class="history-empty"
                >
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <strong>
                        ${escapeHtml(message)}
                    </strong>
                    <span>
                        Start the EcoPoints server with "npm start", then refresh
                        this page.
                    </span>
                </td>
            </tr>
        `;
}

function populateWasteFilter() {
  const current = wasteFilter.value;

  const types = [
    ...new Set(
      completedRecords.map((record) => record.wasteType).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

  wasteFilter.innerHTML =
    `
        <option value="all">
            All waste types
        </option>
        ` +
    types
      .map(
        (type) =>
          `
                    <option value="${escapeHtml(type)}">
                        ${escapeHtml(type)}
                    </option>
                    `,
      )
      .join("");

  if (types.includes(current)) {
    wasteFilter.value = current;
  }
}

function getFilteredRecords() {
  const term = String(historySearch.value || "")
    .trim()
    .toLowerCase();

  const wasteType = wasteFilter.value;

  const verificationStatus = verificationFilter.value;

  return completedRecords.filter((record) => {
    const searchable = [
      record.residentName,
      record.residentId,
      record.wasteType,
      record.collectorName,
      record.collectorId,
      record.id,
    ]
      .join(" ")
      .toLowerCase();

    const matchesSearch = !term || searchable.includes(term);

    const matchesWaste = wasteType === "all" || record.wasteType === wasteType;

    const matchesVerification =
      verificationStatus === "all" ||
      String(record.verificationStatus || "").toLowerCase() ===
        verificationStatus;

    return matchesSearch && matchesWaste && matchesVerification;
  });
}

function renderStats() {
  const totalWeight = completedRecords.reduce(
    (sum, record) => sum + record.weight,
    0,
  );

  const totalPoints = completedRecords.reduce(
    (sum, record) => sum + record.ecoPoints,
    0,
  );

  const residentIds = new Set(
    completedRecords.map((record) => String(record.residentId).toUpperCase()),
  );

  const transactions = completedRecords.filter((record) => record.ecoPoints > 0);

  const registeredResidents = getRegisteredResidents().length;

  statCollections.textContent = completedRecords.length.toLocaleString();

  statIssued.textContent = totalPoints.toLocaleString();

  statIssuedCount.textContent = `${transactions.length.toLocaleString()} transaction${
    transactions.length === 1 ? "" : "s"
  }`;

  statWeight.textContent = formatWeight(totalWeight);

  statResidents.textContent = residentIds.size.toLocaleString();

  statResidentNote.textContent = `of ${registeredResidents.toLocaleString()} registered`;
}

function renderHistory() {
  const rows = getFilteredRecords();

  historyCount.textContent = `${rows.length.toLocaleString()} record${
    rows.length === 1 ? "" : "s"
  }`;

  if (!rows.length) {
    historyTableBody.innerHTML = `
            <tr>
                <td
                    colspan="8"
                    class="history-empty"
                >
                    <i class="fa-solid fa-clock-rotate-left"></i>
                    <strong>
                        No collection records yet
                    </strong>
                    <span>
                        ${
                          completedRecords.length
                            ? "No records match the selected search or filter."
                            : "Completed resident collections will appear here."
                        }
                    </span>
                </td>
            </tr>
        `;

    return;
  }

  historyTableBody.innerHTML = rows
    .map(
      (record) => `
                    <tr>

                        <td>
                            ${escapeHtml(formatDateTime(record.date))}
                        </td>

                        <td>
                            <span class="history-resident">
                                ${escapeHtml(record.residentName)}
                            </span>

                            <span class="history-id">
                                ${escapeHtml(record.residentId)}
                            </span>
                        </td>

                        <td>
                            ${escapeHtml(record.wasteType)}
                        </td>

                        <td>
                            ${escapeHtml(formatWeight(record.weight))}
                            kg
                        </td>

                        <td>

                            <span class="history-resident">
                                ${escapeHtml(record.collectorName)}
                            </span>

                            ${
                              record.collectorId
                                ? `
                                        <span class="history-id">
                                            ${escapeHtml(record.collectorId)}
                                        </span>
                                    `
                                : ""
                            }

                        </td>

                        <td>
                            <span class="history-status">
                                ${escapeHtml(record.verificationStatus)}
                            </span>
                        </td>

                        <td class="history-points">
                            +${record.ecoPoints.toLocaleString()}
                            pts
                        </td>

                        <td>
                            <button
                                type="button"
                                class="history-view-btn"
                                data-view="${escapeHtml(record.id)}"
                            >
                                View details
                            </button>
                        </td>

                    </tr>
                `,
    )
    .join("");

  historyTableBody.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => openDetails(button.dataset.view));
  });
}

function detail(label, value, full = false) {
  return `
        <div class="history-detail${full ? " full" : ""}">

            <span class="history-detail-label">
                ${escapeHtml(label)}
            </span>

            <span class="history-detail-value">
                ${escapeHtml(value || "Not recorded")}
            </span>

        </div>
    `;
}

function openDetails(recordId) {
  const record = completedRecords.find(
    (item) => String(item.id) === String(recordId),
  );

  if (!record) {
    return;
  }

  document.getElementById("historyModalTitle").textContent =
    `${record.wasteType} Collection`;

  historyModalBody.innerHTML = `
        <div class="history-detail-grid">

            ${detail(
              "Collection date",
              formatDateTime(record.completedAt || record.date),
            )}

            ${detail(
              "Resident",
              `${record.residentName} (${record.residentId})`,
            )}

            ${detail("Area / Purok", record.purok)}

            ${detail("Waste type", record.wasteType)}

            ${detail("Verified weight", `${formatWeight(record.weight)} kg`)}

            ${detail(
              "Collector",
              record.collectorId
                ? `${record.collectorName} (${record.collectorId})`
                : record.collectorName,
            )}

            ${detail("Verification status", record.verificationStatus)}

            ${detail(
              "EcoPoints issued",
              `+${record.ecoPoints.toLocaleString()} pts`,
            )}

            ${detail("Submitted", formatDateTime(record.submittedAt))}

            ${detail("Verified", formatDateTime(record.verifiedAt))}

            ${detail("Transaction ID", record.transactionId)}

            ${detail("Condition", record.condition)}

            ${detail("Verification notes", record.verificationNotes, true)}

        </div>

        <div class="history-modal-actions">

            <button
                type="button"
                class="btn btn-outline"
                id="detailsCloseButton"
            >
                Close
            </button>

        </div>
    `;

  historyModal.hidden = false;

  document
    .getElementById("detailsCloseButton")
    .addEventListener("click", closeDetails);
}

function closeDetails() {
  historyModal.hidden = true;
}

// Loads the whole history page from MySQL, then renders. The endpoint
// reads a SQL VIEW, so the table is always current and the local
// browser store is no longer involved.
async function refresh() {
  const res = await EcoApi.get(
    `${HISTORY_PATH}?status=all&waste_type=all&search=&limit=${HISTORY_LIMIT}`,
  );

  if (!res || res.offline || !res.success) {
    showHistoryNote(
      res && res.offline
        ? "Server offline"
        : "Couldn't load collection history",
    );

    return;
  }

  completedRecords = (res.history || [])
    .filter((row) => row && row.id)
    .map(toHistoryRecord)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  populateWasteFilter();
  renderStats();
  renderHistory();
}

historySearch.addEventListener("input", renderHistory);

wasteFilter.addEventListener("change", renderHistory);

verificationFilter.addEventListener("change", renderHistory);

globalSearch.addEventListener("input", () => {
  historySearch.value = globalSearch.value;

  renderHistory();
});

historyModalClose.addEventListener("click", closeDetails);

historyModal.addEventListener("click", (event) => {
  if (event.target === historyModal) {
    closeDetails();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !historyModal.hidden) {
    closeDetails();
  }
});

window.addEventListener("storage", (event) => {
  if (event.key === "ecoUser") {
    refresh();
  }
});

document.addEventListener("DOMContentLoaded", refresh);
