const COLLECTIONS_PATH = "/api/waste-collections";

// ecoActiveScan and ecoPendingComputation stay in localStorage on
// purpose: they are transient hand-off state shared with the QR scanner
// and the computation step, not persisted records.
const ACTIVE_SCAN_KEY = "ecoActiveScan";
const PENDING_COMPUTATION_KEY = "ecoPendingComputation";

let queueCache = [];
let requestCache = [];
let collectionsOffline = false;

// MySQL DATE/TIME columns arrive either as plain strings or as Date
// objects depending on the driver settings, so normalise both.
function toDateKey(value) {
  if (!value) return "";

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }

  return String(value).slice(0, 10);
}

function toTimeKey(value) {
  if (!value) return "";

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return [
      String(value.getHours()).padStart(2, "0"),
      String(value.getMinutes()).padStart(2, "0"),
    ].join(":");
  }

  return String(value).slice(0, 5);
}

function dateStamp(value) {
  const match = toDateKey(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return null;

  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

// Maps one row of GET /api/waste-collections onto the property names the
// queue table and the review form already use (the old ecoWasteQueue
// shape).
function toQueueRecord(row) {
  const status = getRecordStatus({ status: row.verificationStatus });

  return {
    id: String(row.collection_id ?? row.id ?? ""),
    collectionId: Number(row.collection_id ?? row.id) || null,
    residentPk: row.resident_id,
    residentId: row.accountId || "",
    residentName: row.residentName || "Resident",
    area: row.street || "",
    purok: row.street || "",
    wasteType: row.wasteType || "",
    weightKg: row.weightKg == null ? "" : Number(row.weightKg),
    pointsEarned: Number(row.pointsEarned || 0),
    status,
    verificationStatus: status,
    collectorNote: row.collectorNote || "",
    verificationNotes: row.collectorNote || "",
    submittedAt: row.collectedAt || "",
    createdAt: row.collectedAt || "",
    collectedAt: row.collectedAt || "",
    verifiedAt: row.verifiedAt || "",
    updatedAt: row.verifiedAt || row.collectedAt || "",
    // No column links a waste collection back to a collection request,
    // so this is resolved at display time (see findLinkedRequest).
    collectionRequestId: "",
    requestId: "",
  };
}

// Residents no longer submit waste, so a collection is never linked to a
// request. Kept as a stub so the display helpers below have something to
// call.
function toRequestSummary() {
  return null;
}

function loadQueue() {
  return queueCache;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateTime(value) {
  if (!value) return "Not provided";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRequestedDate(value) {
  if (!value) return "Not provided";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getRecordStatus(record) {
  const status = String(record.status || "pending").toLowerCase();

  if (status === "verified") return "verified";
  if (status === "rejected") return "rejected";
  return "pending";
}

function statusBadge(status) {
  if (status === "verified") {
    return `<span class="badge badge-verified">Verified</span>`;
  }

  if (status === "rejected") {
    return `<span class="badge badge-rejected">Rejected</span>`;
  }

  return `<span class="badge badge-pending">Pending</span>`;
}

function getResidentInitials(name) {
  const parts = String(name || "Resident")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "R";

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function linkedRequestCandidates() {
  return [];
}

function findLinkedRequest() {
  return null;
}

function exactLinkedRequest() {
  return null;
}

function getCollectionRequest(record) {
  return findLinkedRequest(record);
}

function getCollectionRequestLabel(record) {
  const request = getCollectionRequest(record);

  if (request) {
    return request.id;
  }

  return (
    record.collectionRequestId || record.requestId || "No collection request"
  );
}

const residentMini = document.getElementById("residentMini");
const miniAvatar = document.getElementById("miniAvatar");
const miniName = document.getElementById("miniName");
const miniId = document.getElementById("miniId");

const noResidentState = document.getElementById("noResidentState");
const verifyForm = document.getElementById("verifyForm");

const submissionDateTime = document.getElementById("submissionDateTime");
const collectionRequestInfo = document.getElementById("collectionRequestInfo");
const requestedDateInfo = document.getElementById("requestedDateInfo");
const requestedTimeInfo = document.getElementById("requestedTimeInfo");

const wasteTypeSelect = document.getElementById("wasteType");
const submittedWeightInput = document.getElementById("submittedWeight");
const wasteWeightInput = document.getElementById("wasteWeight");
const wasteConditionSelect = document.getElementById("wasteCondition");
const rejectionReasonField = document.getElementById("rejectionReasonField");
const rejectionReasonInput = document.getElementById("rejectionReason");
const verifyNotesInput = document.getElementById("verifyNotes");
const verifyNote = document.getElementById("verifyNote");

const approveBtn = document.getElementById("approveBtn");
const rejectBtn = document.getElementById("rejectBtn");

const queueSearch = document.getElementById("queueSearch");
const queueFilter = document.getElementById("queueFilter");
const queueWasteFilter = document.getElementById("queueWasteFilter");
const queueAreaFilter = document.getElementById("queueAreaFilter");
const queueDateFilter = document.getElementById("queueDateFilter");
const queueTableBody = document.getElementById("queueTableBody");
const queueCountTag = document.getElementById("queueCountTag");
const queueEmptyState = document.getElementById("queueEmptyState");

let activeResident = null;
let selectedQueueId = null;
let selectedRecord = null;

function setActiveResident(resident) {
  activeResident = resident;

  if (!resident) {
    residentMini.hidden = true;
    noResidentState.hidden = false;
    verifyForm.hidden = true;
    selectedRecord = null;
    return;
  }

  miniAvatar.textContent = getResidentInitials(resident.name);
  miniName.textContent = resident.name;
  miniId.textContent = resident.id || "No resident ID";

  residentMini.hidden = false;
  noResidentState.hidden = true;
  verifyForm.hidden = false;
  verifyNote.textContent = "";
  verifyNote.className = "form-note";
}

function showNote(message, type) {
  verifyNote.textContent = message;
  verifyNote.className = "form-note" + (type ? ` ${type}` : "");
}

function showQueueNote(message) {
  queueCountTag.textContent = message;

  queueTableBody.innerHTML = "";

  queueEmptyState.hidden = false;
  queueEmptyState.querySelector("span").textContent = message;
  queueEmptyState.querySelector("p").textContent =
    'Start the EcoPoints server with "npm start", then refresh this page.';
}

function loadHandoffFromScanner() {
  let scan = null;

  try {
    scan = JSON.parse(localStorage.getItem(ACTIVE_SCAN_KEY));
  } catch {
    scan = null;
  }

  if (!scan || !scan.id || !scan.name) return;

  const queue = loadQueue();

  const pendingRecord = queue.find(
    (record) =>
      String(record.residentId || "") === String(scan.id) &&
      getRecordStatus(record) === "pending",
  );

  if (pendingRecord) {
    selectQueueRow(pendingRecord.id);
    return;
  }

  setActiveResident({
    id: scan.id,
    name: scan.name,
  });

  showNote(
    "This resident has no pending waste submission. Scanning a QR code does not create a submission.",
    "error",
  );
}

function populateQueueFilters(queue) {
  const currentWaste = queueWasteFilter.value;
  const currentArea = queueAreaFilter.value;

  const wastes = [
    ...new Set(
      queue
        .map((record) => String(record.wasteType || "").trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const areas = [
    ...new Set(
      queue
        .map((record) => String(record.area || record.purok || "").trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

  queueWasteFilter.innerHTML =
    `<option value="all">All waste types</option>` +
    wastes
      .map(
        (value) =>
          `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
      )
      .join("");

  queueAreaFilter.innerHTML =
    `<option value="all">All collection areas</option>` +
    areas
      .map(
        (value) =>
          `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
      )
      .join("");

  if (wastes.includes(currentWaste)) {
    queueWasteFilter.value = currentWaste;
  }

  if (areas.includes(currentArea)) {
    queueAreaFilter.value = currentArea;
  }
}

function renderQueue() {
  const queue = loadQueue();

  populateQueueFilters(queue);

  if (collectionsOffline) {
    showQueueNote("Server offline");

    return;
  }

  const searchTerm = queueSearch.value.trim().toLowerCase();
  const statusFilter = queueFilter.value;
  const wasteFilterValue = queueWasteFilter.value;
  const areaFilterValue = queueAreaFilter.value;
  const dateFilterValue = queueDateFilter.value;

  const pendingCount = queue.filter(
    (record) => getRecordStatus(record) === "pending",
  ).length;

  queueCountTag.textContent = `${pendingCount} pending`;

  const rows = queue.filter((record) => {
    const residentName = String(record.residentName || "Resident");
    const wasteType = String(record.wasteType || "");
    const recordStatus = getRecordStatus(record);

    const matchesSearch =
      !searchTerm ||
      `${residentName} ${wasteType} ${record.residentId || ""} ${record.id || ""} ${record.area || ""} ${record.purok || ""}`
        .toLowerCase()
        .includes(searchTerm);

    const matchesStatus =
      statusFilter === "all" || recordStatus === statusFilter;

    const matchesWaste =
      wasteFilterValue === "all" || wasteType === wasteFilterValue;

    const recordArea = String(record.area || record.purok || "");

    const matchesArea =
      areaFilterValue === "all" || recordArea === areaFilterValue;

    const recordDate = String(
      record.submittedAt || record.createdAt || record.date || "",
    ).slice(0, 10);

    const matchesDate = !dateFilterValue || recordDate === dateFilterValue;

    return (
      matchesSearch &&
      matchesStatus &&
      matchesWaste &&
      matchesArea &&
      matchesDate
    );
  });

  queueTableBody.innerHTML = "";

  if (rows.length === 0) {
    queueEmptyState.hidden = false;
    queueEmptyState.querySelector("span").textContent =
      "No pending waste submissions.";
    queueEmptyState.querySelector("p").textContent =
      "Actual resident waste submissions will appear here after they are submitted.";
    return;
  }

  queueEmptyState.hidden = true;

  rows.forEach((record) => {
    const status = getRecordStatus(record);
    const submittedAt = formatDateTime(record.submittedAt || record.createdAt);

    const weight = record.weightKg ?? record.weight ?? "Not provided";

    const row = document.createElement("tr");

    row.innerHTML = `
            <td>
                <div class="resident-mini">
                    <span class="avatar">${escapeHtml(
                      getResidentInitials(record.residentName),
                    )}</span>
                    <div class="resident-mini-info">
                        <span class="resident-mini-name">${escapeHtml(
                          record.residentName || "Resident",
                        )}</span>
                        <span class="resident-mini-id">${escapeHtml(
                          record.residentId || "No resident ID",
                        )}</span>
                    </div>
                </div>
            </td>
            <td>
                <strong>${escapeHtml(
                  record.wasteType || "Not specified",
                )}</strong>
                <div class="verification-table-note">
                    ${escapeHtml(
                      record.area || record.purok || "Area not provided",
                    )}
                </div>
            </td>
            <td>${escapeHtml(submittedAt)}</td>
            <td>${escapeHtml(weight)} kg</td>
            <td class="verification-status-cell">
                ${statusBadge(status)}
            </td>
            <td>
                <button
                    class="table-row-btn"
                    data-review="${escapeHtml(record.id)}"
                >
                    ${status === "pending" ? "Review" : "View"}
                </button>
            </td>
        `;

    queueTableBody.appendChild(row);
  });

  queueTableBody.querySelectorAll("[data-review]").forEach((button) => {
    button.addEventListener("click", () =>
      selectQueueRow(button.dataset.review),
    );
  });
}

function populateReviewForm(record) {
  const request = getCollectionRequest(record);

  wasteTypeSelect.value = record.wasteType || "Paper";

  const submittedWeight = record.weightKg ?? record.weight ?? "";

  submittedWeightInput.value =
    submittedWeight === "" ? "Not provided" : `${submittedWeight} kg`;

  wasteWeightInput.value = submittedWeight;

  wasteConditionSelect.value = record.condition || "Clean & Sorted";

  verifyNotesInput.value = record.verificationNotes || record.notes || "";

  rejectionReasonInput.value = record.rejectionReason || "";

  submissionDateTime.textContent = formatDateTime(
    record.submittedAt || record.createdAt,
  );

  collectionRequestInfo.textContent = getCollectionRequestLabel(record);

  requestedDateInfo.textContent = formatRequestedDate(
    record.requestedDate || (request && request.requestedDate),
  );

  requestedTimeInfo.textContent =
    record.requestedTime ||
    (request && request.requestedTime) ||
    "Not provided";

  rejectionReasonField.classList.remove("visible");
}

function selectQueueRow(queueId) {
  const queue = loadQueue();

  const record = queue.find((item) => String(item.id) === String(queueId));

  if (!record) return;

  selectedQueueId = record.id;
  selectedRecord = record;

  setActiveResident({
    id: record.residentId,
    name: record.residentName || "Resident",
  });

  populateReviewForm(record);

  verifyForm.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

/* ============================================================
   API LOADERS
   ============================================================ */

async function loadCollections() {
  if (!window.EcoApi) {
    collectionsOffline = true;

    renderQueue();

    return;
  }


  const res = await window.EcoApi.get(
    "/api/waste-collections?status=all&limit=300",
  );

  if (!res || res.offline || !res.success) {
    queueCache = [];
    collectionsOffline = true;

    renderQueue();

    return;
  }

  queueCache = (res.collections || [])
    .filter((row) => row && (row.collection_id ?? row.id))
    .map(toQueueRecord);

  collectionsOffline = false;

  renderQueue();
}

// Residents no longer submit waste, so there is nothing to link a
// collection to. An empty cache makes findLinkedRequest() return null,
// which the row renderer already handles.
async function loadCollectionRequests() {
  requestCache = [];
}

function verificationAdminId() {
  if (!window.EcoApi) return null;

  return window.EcoApi.adminId() || window.EcoApi.collectorId() || null;
}

// Nothing to cancel: there are no resident requests behind a collection.
async function cancelLinkedRequest() {
  return;
}

function applyVerification(recordId, status) {
  const record = queueCache.find(
    (item) => String(item.id) === String(recordId),
  );

  if (!record) return null;

  record.status = status;
  record.verificationStatus = status;
  record.updatedAt = new Date().toISOString();

  if (status === "verified") {
    record.verifiedAt = record.updatedAt;
  }

  return record;
}

async function verifyWaste() {
  if (!selectedRecord || !selectedQueueId) {
    showNote("Select a pending resident submission first.", "error");
    return;
  }

  if (getRecordStatus(selectedRecord) !== "pending") {
    showNote("Only pending submissions can be verified.", "error");
    return;
  }

  const verifiedWeight = Number(wasteWeightInput.value);

  if (!verifiedWeight || verifiedWeight <= 0) {
    showNote("Enter the actual verified weight.", "error");
    return;
  }

  const notes = verifyNotesInput.value.trim();

  const condition = wasteConditionSelect.value;

  const wasteType = wasteTypeSelect.value;

  const record = selectedRecord;
  const collectionId = record.collectionId;

  if (!collectionId) {
    showNote("This submission is not linked to the database yet.", "error");
    return;
  }

  approveBtn.disabled = true;

  let res = null;

  try {
    res = await window.EcoApi.patch(
      `${COLLECTIONS_PATH}/${collectionId}/verify`,
      {
        verification_status: "verified",
        admin_id: verificationAdminId(),
      },
    );
  } catch {
    res = null;
  }

  approveBtn.disabled = false;

  if (!res || res.offline || !res.success) {
    showNote(
      res && res.offline
        ? 'Server offline - the verification was not saved. Start it with "npm start".'
        : (res && res.error) || "The submission could not be verified.",
      "error",
    );

    renderQueue();

    return;
  }

  const updatedRecord = applyVerification(record.id, "verified");

  // The verified weight and notes have no column of their own, so they
  // ride along in the hand-off record.
  localStorage.setItem(
    PENDING_COMPUTATION_KEY,
    JSON.stringify({
      resident: {
        id: updatedRecord.residentId,
        name: updatedRecord.residentName,
      },
      wasteType,
      submittedWeightKg: Number(updatedRecord.weightKg || 0),
      weightKg: verifiedWeight,
      verifiedWeightKg: verifiedWeight,
      condition,
      notes,
      queueId: updatedRecord.id,
      collectionRequestId:
        updatedRecord.collectionRequestId || updatedRecord.requestId || "",
      verifiedAt: updatedRecord.verifiedAt,
    }),
  );

  await Promise.all([loadCollections(), loadCollectionRequests()]);

  verifyForm.hidden = true;
  residentMini.hidden = true;
  noResidentState.hidden = false;

  noResidentState.innerHTML = `
        <i class="fa-solid fa-circle-check" style="color:var(--primary-green);"></i>
        <span>Waste verified successfully</span>
        <p>${escapeHtml(
          updatedRecord.residentName || "Resident",
        )}'s drop-off has been verified. Their EcoPoints were credited when the collection was recorded.</p>
        <button class="btn btn-outline" id="verifyAnotherBtn" style="margin-top:10px;">
            <i class="fa-solid fa-rotate-left"></i>
            Review Another
        </button>
    `;

  document
    .getElementById("verifyAnotherBtn")
    .addEventListener("click", resetReviewState);

  selectedQueueId = null;
  selectedRecord = null;

  localStorage.removeItem(ACTIVE_SCAN_KEY);
}

async function rejectWaste() {
  if (!selectedRecord || !selectedQueueId) {
    showNote("Select a pending resident submission first.", "error");
    return;
  }

  if (getRecordStatus(selectedRecord) !== "pending") {
    showNote("Only pending submissions can be rejected.", "error");
    return;
  }

  rejectionReasonField.classList.add("visible");

  const reason = rejectionReasonInput.value.trim();

  if (!reason) {
    showNote("Add a rejection reason before rejecting the waste.", "error");

    rejectionReasonInput.focus();

    return;
  }

  const confirmed = confirm(
    `Reject the waste submission from ${
      selectedRecord.residentName || "this resident"
    }?`,
  );

  if (!confirmed) return;

  const notes = verifyNotesInput.value.trim();

  const wasteType = wasteTypeSelect.value;

  const weightKg =
    Number(wasteWeightInput.value) || Number(selectedRecord.weightKg) || 0;

  const record = selectedRecord;
  const collectionId = record.collectionId;

  if (!collectionId) {
    showNote("This submission is not linked to the database yet.", "error");
    return;
  }

  rejectBtn.disabled = true;

  let res = null;

  try {
    res = await window.EcoApi.patch(
      `${COLLECTIONS_PATH}/${collectionId}/verify`,
      {
        verification_status: "rejected",
        admin_id: verificationAdminId(),
      },
    );
  } catch {
    res = null;
  }

  rejectBtn.disabled = false;

  if (!res || res.offline || !res.success) {
    showNote(
      res && res.offline
        ? 'Server offline - the rejection was not saved. Start it with "npm start".'
        : (res && res.error) || "The submission could not be rejected.",
      "error",
    );

    renderQueue();

    return;
  }

  const updatedRecord = applyVerification(record.id, "rejected");

  updatedRecord.rejectionReason = reason;
  updatedRecord.verificationNotes = notes;
  updatedRecord.weightKg = weightKg;

  await cancelLinkedRequest(record);
  await Promise.all([loadCollections(), loadCollectionRequests()]);

  localStorage.removeItem(PENDING_COMPUTATION_KEY);
  localStorage.removeItem(ACTIVE_SCAN_KEY);

  verifyForm.hidden = true;
  residentMini.hidden = true;
  noResidentState.hidden = false;

  noResidentState.innerHTML = `
        <i class="fa-solid fa-circle-xmark" style="color:#b24b4b;"></i>
        <span>Waste submission rejected</span>
        <p>${escapeHtml(
          updatedRecord.residentName || "Resident",
        )}'s submission was rejected. No EcoPoints will be issued.</p>
        <button class="btn btn-outline" id="verifyAnotherBtn" style="margin-top:12px;">
            <i class="fa-solid fa-rotate-left"></i>
            Review Another
        </button>
    `;

  document
    .getElementById("verifyAnotherBtn")
    .addEventListener("click", resetReviewState);

  selectedQueueId = null;
  selectedRecord = null;
}

function resetReviewState() {
  localStorage.removeItem(ACTIVE_SCAN_KEY);

  selectedQueueId = null;
  selectedRecord = null;
  activeResident = null;

  noResidentState.innerHTML = `
        <i class="fa-solid fa-user-xmark"></i>
        <span>No pending waste submission selected</span>
        <p>Select an actual resident submission from the queue on the right to review it.</p>
    `;

  setActiveResident(null);

  rejectionReasonField.classList.remove("visible");

  rejectionReasonInput.value = "";

  renderQueue();
}

approveBtn.addEventListener("click", verifyWaste);

rejectBtn.addEventListener("click", rejectWaste);

queueSearch.addEventListener("input", renderQueue);

queueFilter.addEventListener("change", renderQueue);

queueWasteFilter.addEventListener("change", renderQueue);

queueAreaFilter.addEventListener("change", renderQueue);

queueDateFilter.addEventListener("change", renderQueue);

// Only the scanner hand-off still arrives through a storage event; the
// queue itself now comes from MySQL.
window.addEventListener("storage", (event) => {
  if (event.key !== ACTIVE_SCAN_KEY) {
    return;
  }

  loadHandoffFromScanner();
  renderQueue();
});

document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([loadCollections(), loadCollectionRequests()]);

  loadHandoffFromScanner();
  renderQueue();
});
