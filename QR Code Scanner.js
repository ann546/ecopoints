const RECENT_SCANS_KEY = "ecoCollectorScanLog";
const ACTIVE_SCAN_KEY = "ecoActiveScan";
const QUEUE_KEY = "ecoWasteQueue";
const USERS_KEY = "ecoUsers";
const SCHEDULE_KEY = "ecoCollectorSchedules";
const TRANSACTIONS_KEY = "ecoTransactions";
const REDEMPTION_NOTIFICATIONS_KEY = "ecoRedemptionNotifications";

const LEGACY_DEMO_QUEUE_IDS = new Set([
  "SUB-1001",
  "SUB-1002",
  "SUB-1003",
  "SUB-1004",
]);

/* ---------- Elements ---------- */

const scannerFrame = document.querySelector(".scanner-frame");

const scannerPlaceholder = document.getElementById("scannerPlaceholder");

const toggleCameraBtn = document.getElementById("toggleCameraBtn");

const cameraNote = document.getElementById("cameraNote");

const scanModeTag = document.getElementById("scanModeTag");

const manualIdInput = document.getElementById("manualIdInput");

const manualLookupBtn = document.getElementById("manualLookupBtn");

const uploadQrBtn = document.getElementById("uploadQrBtn");

const uploadQrInput = document.getElementById("uploadQrInput");

const uploadQrNote = document.getElementById("uploadQrNote");

const scanEmptyState = document.getElementById("scanEmptyState");

const residentResult = document.getElementById("residentResult");

const resultAvatar = document.getElementById("resultAvatar");

const resultName = document.getElementById("resultName");

const resultId = document.getElementById("resultId");

const resultBadge = document.getElementById("resultBadge");

const resultPurok = document.getElementById("resultPurok");

const resultPoints = document.getElementById("resultPoints");

const resultSince = document.getElementById("resultSince");

const resultLast = document.getElementById("resultLast");

const resultEmail = document.getElementById("resultEmail");

const resultPhone = document.getElementById("resultPhone");

const resultAddress = document.getElementById("resultAddress");

const residentSubmissionsList = document.getElementById(
  "residentSubmissionsList",
);

const residentCollectionInfo = document.getElementById(
  "residentCollectionInfo",
);

const submissionCountTag = document.getElementById("submissionCountTag");

const redemptionVerificationTag = document.getElementById("redemptionVerificationTag");

const residentRedemptionVerificationList = document.getElementById("residentRedemptionVerificationList");

const proceedBtn = document.getElementById("proceedBtn");

const processingPanel = document.getElementById("processingPanel");

const processingStatusTag = document.getElementById("processingStatusTag");

const collectionProcessForm = document.getElementById("collectionProcessForm");

const processWasteType = document.getElementById("processWasteType");

const processWeightKg = document.getElementById("processWeightKg");

const processCondition = document.getElementById("processCondition");

const processNotes = document.getElementById("processNotes");

const processingNote = document.getElementById("processingNote");

const processConfirmBtn = document.getElementById("processConfirmBtn");

const scanAnotherBtn = document.getElementById("scanAnotherBtn");

let html5QrCode = null;
let cameraRunning = false;
let activeResident = null;

/* ---------- Storage helpers ---------- */

function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));

    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function localDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(d.getTime())) return "";

  const y = d.getFullYear();

  const m = String(d.getMonth() + 1).padStart(2, "0");

  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function formatDate(value) {
  if (!value) return "—";

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return String(value);

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value) {
  if (!value) return "—";

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return String(value);

  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatStatus(status) {
  const value = String(status || "pending").toLowerCase();

  if (value === "completed" || value === "verified") {
    return "Verified";
  }

  if (value === "rejected") return "Rejected";

  return "Pending";
}

function statusClass(status) {
  const value = String(status || "pending").toLowerCase();

  if (value === "completed" || value === "verified") {
    return "badge-verified";
  }

  if (value === "rejected") return "badge-rejected";

  return "badge-pending";
}

function initials(name) {
  const parts = String(name || "Resident")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return (
    (parts[0] || "R")[0] + (parts[parts.length - 1] || "")[0]
  ).toUpperCase();
}

function showNote(message, type) {
  cameraNote.textContent = message;

  cameraNote.classList.remove("success", "error");

  if (type) cameraNote.classList.add(type);
}

/* ---------- Resident lookup ---------- */

function extractAccountId(rawText) {
  if (!rawText) return "";

  const text = rawText.trim();

  const prefix = "ECOPOINTS-USER:";

  if (text.toUpperCase().startsWith(prefix)) {
    return text.slice(prefix.length).trim();
  }

  return text;
}

async function findResident(accountId) {
  const cleanId = String(accountId || "").trim().toUpperCase();
  if (!cleanId) return null;

  // Try MySQL first
  try {
    const res = await fetch(
      `/api/residents/by-account/${encodeURIComponent(cleanId)}`,
    );
    const data = await res.json();

    if (res.ok && data.success && data.resident) {
      const r = data.resident;
      return {
        id: r.account_id,
        name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || "Resident",
        email: r.email || "",
        phone: r.phone || "",
        houseNumber: r.house_number || "",
        street: r.street || "",
        streetClassification: r.street_classification || null,
        purok: r.street || "",
        address: [r.house_number, r.street].filter(Boolean).join(", ") || "Unassigned",
        points: Number(r.ecopoints_balance) || 0,
        memberSince: r.created_at ? formatDate(r.created_at) : "—",
        lastCollection: "—",
        history: [],
        mysqlResidentId: r.resident_id,
      };
    }
  } catch (err) {
    console.error("MySQL resident lookup failed:", err);
  }

  // Fallback to localStorage (old demo data)
  return findResidentById(cleanId);
}

function getResidentAccount(resident) {
  if (!resident) return null;

  const users = readJSON(USERS_KEY, {});

  const user = Object.values(users).find(
    (item) =>
      item &&
      String(item.userId || "").toUpperCase() ===
        String(resident.id || "").toUpperCase(),
  );

  if (!user) return resident;

  const addressParts = [user.houseNumber, user.street].filter(Boolean);

  return {
    ...resident,

    email: user.email || resident.email || "—",

    phone: user.phone || "—",

    houseNumber: user.houseNumber || "",

    street: user.street || "",

    streetClassification: user.streetClassification || null,

    address: addressParts.join(", ") || resident.purok || "Unassigned",

    memberSince: user.createdAt
      ? formatDate(user.createdAt)
      : resident.memberSince || "—",

    points:
      typeof user.points === "number"
        ? user.points
        : Number(resident.points) || 0,

    history: Array.isArray(user.history)
      ? user.history
      : resident.history || [],
  };
}

/* ---------- Waste queue ---------- */

function getQueue() {
  const queue = readJSON(QUEUE_KEY, []);

  if (!Array.isArray(queue)) return [];

  return queue.filter(
    (record) => record && !LEGACY_DEMO_QUEUE_IDS.has(record.id),
  );
}

function getResidentQueueRecords(residentId) {
  const cleanId = String(residentId || "")
    .trim()
    .toUpperCase();

  return getQueue()
    .filter(
      (record) =>
        String(record.residentId || "")
          .trim()
          .toUpperCase() === cleanId,
    )
    .sort((a, b) => {
      const aDate = new Date(a.completedAt || a.submittedAt || 0).getTime();

      const bDate = new Date(b.completedAt || b.submittedAt || 0).getTime();

      return bDate - aDate;
    });
}

/* ---------- Waste display ---------- */

function materialIcon(material) {
  return (
    {
      Paper: "fa-file-lines",

      Plastic: "fa-bottle-water",

      Metal: "fa-recycle",

      Glass: "fa-wine-bottle",

      "E-Waste": "fa-plug",

      Mixed: "fa-boxes-stacked",
    }[material] || "fa-recycle"
  );
}

function renderSubmissionRows(records, emptyMessage) {
  if (!records.length) {
    return `
            <div class="empty-note">
                ${escapeHTML(emptyMessage)}
            </div>
        `;
  }

  return records
    .map((record) => {
      const date = record.completedAt || record.submittedAt;

      const weight = Number(
        record.verifiedWeightKg ?? record.verifiedWeight ?? record.weightKg,
      );

      const weightText =
        Number.isFinite(weight) && weight > 0
          ? ` &middot; ${weight.toFixed(1).replace(/\.0$/, "")} kg`
          : "";

      const status = formatStatus(record.status);

      const pointsText =
        record.pointsIssued != null
          ? ` &middot; ${Number(record.pointsIssued).toLocaleString()} pts`
          : "";

      return `
                <div class="submission-row">
                    <div class="submission-icon">
                        <i class="fa-solid ${materialIcon(
                          record.wasteType,
                        )}"></i>
                    </div>

                    <div class="submission-info">
                        <span class="submission-title">
                            ${escapeHTML(
                              record.wasteType || "Waste submission",
                            )}
                        </span>

                        <span class="submission-meta">
                            ${escapeHTML(formatDateTime(date))}
                            ${weightText}
                            ${pointsText}
                        </span>
                    </div>

                    <span class="badge ${statusClass(record.status)}">
                        ${status}
                    </span>
                </div>
            `;
    })
    .join("");
}

function getRedemptionRecords(residentId) {
  const cleanId = String(residentId || "")
    .trim()
    .toUpperCase();

  const notificationRecords = readJSON(REDEMPTION_NOTIFICATIONS_KEY, []);
  const transactions = readJSON(TRANSACTIONS_KEY, []);
  const combined = [];
  const seen = new Set();

  const pushRecord = (record, fallbackStatus = "verified") => {
    if (!record || typeof record !== "object") return;

    const recordResidentId = String(
      record.residentId || record.userId || "",
    )
      .trim()
      .toUpperCase();

    if (!recordResidentId || recordResidentId !== cleanId) return;

    const id = String(record.id || record.transactionId || "").trim();

    if (!id || seen.has(id)) return;

    seen.add(id);

    combined.push({
      ...record,
      id,
      status: String(record.status || fallbackStatus).toLowerCase(),
      createdAt:
        record.createdAt ||
        record.requestedAt ||
        record.timestamp ||
        new Date().toISOString(),
      pointsUsed: Math.abs(
        Number(record.pointsUsed ?? record.requiredEcoPoints ?? record.points ?? 0),
      ),
      previousBalance: Number(record.previousBalance ?? 0),
      remainingBalance: Number(record.remainingBalance ?? 0),
    });
  };

  if (Array.isArray(notificationRecords)) {
    notificationRecords.forEach((record) => pushRecord(record));
  }

  if (Array.isArray(transactions)) {
    transactions
      .filter(
        (transaction) =>
          transaction &&
          (transaction.referenceType === "rewardRedemption" ||
            transaction.type === "redemption"),
      )
      .forEach((record) => pushRecord(record));
  }

  const resident = getResidentAccount(findResidentById(cleanId));
  const history = Array.isArray(resident?.history) ? resident.history : [];
  const historyTotal = history.reduce(
    (sum, entry) => sum + Number(entry?.points || 0),
    0,
  );
  let runningBalance = Number(resident?.points || 0) - historyTotal;
  const historyDetails = [];
  const recoveredRecords = [];

  [...history]
    .reverse()
    .forEach((entry) => {
      runningBalance += Number(entry?.points || 0);
      historyDetails.push({ ...entry, balanceAfter: runningBalance });
    });

  historyDetails.reverse().forEach((entry) => {
    if (String(entry?.type || "").toLowerCase() !== "redeem") return;

    const redemptionId = String(
      entry.redemptionId ||
        `ECO-RED-HISTORY-${Math.abs(
          Array.from(
            `${cleanId}|${entry.createdAt || entry.date || ""}|${entry.description || ""}|${entry.points || 0}`,
          ).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0),
        )}`
    );

    if (seen.has(redemptionId)) return;

    const pointsUsed = Math.abs(Number(entry.points || 0));
    const remainingBalance = Number(entry.balanceAfter ?? resident.points ?? 0);
    const previousBalance = Number(
      entry.previousBalance ?? remainingBalance + pointsUsed,
    );

    const recoveredRecord = {
      id: redemptionId,
      type: "redemption",
      referenceType: "rewardRedemption",
      residentId: cleanId,
      residentName: resident.name || "Resident",
      rewardName: String(entry.description || "Redeemed Reward").replace(/^Redeemed\s*:?[\s]*/i, ""),
      points: -pointsUsed,
      pointsUsed,
      requiredEcoPoints: pointsUsed,
      previousBalance,
      remainingBalance,
      status: "pending",
      description: entry.description || "Reward redemption",
      createdAt: entry.createdAt || entry.date || new Date().toISOString(),
    };

    pushRecord(recoveredRecord, "pending");

    if (seen.has(redemptionId)) {
      recoveredRecords.push(recoveredRecord);
    }
  });

  if (recoveredRecords.length) {
    const nextTransactions = Array.isArray(transactions) ? [...transactions] : [];
    const nextNotifications = Array.isArray(notificationRecords) ? [...notificationRecords] : [];
    let transactionsChanged = false;
    let notificationsChanged = false;

    recoveredRecords.forEach((record) => {
      if (!nextTransactions.some((item) => String(item?.id || "") === String(record.id))) {
        nextTransactions.unshift(record);
        transactionsChanged = true;
      }

      if (!nextNotifications.some((item) => String(item?.id || "") === String(record.id))) {
        nextNotifications.unshift(record);
        notificationsChanged = true;
      }
    });

    if (transactionsChanged) {
      localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(nextTransactions));
    }

    if (notificationsChanged) {
      localStorage.setItem(REDEMPTION_NOTIFICATIONS_KEY, JSON.stringify(nextNotifications));
    }
  }

  const merged = combined.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return merged;
}

function renderRedemptionVerification(account) {
  const records = getRedemptionRecords(account.id);
  const pending = records.filter((record) => record.status === "pending");

  if (redemptionVerificationTag) {
    redemptionVerificationTag.textContent = `${pending.length} pending`;
  }

  if (!records.length) {
    residentRedemptionVerificationList.innerHTML = `
      <div class="redemption-verification-empty">
        No redemption records yet.
      </div>
    `;
    return;
  }

  residentRedemptionVerificationList.innerHTML = records
    .slice(0, 8)
    .map((record) => {
      const isPending = record.status === "pending";
      const statusText = isPending ? "Pending verification" : "Verified";
      const statusClassName = isPending ? "badge-pending" : "badge-verified";

      return `
        <div class="redemption-activity-card">
          <div class="redemption-activity-head">
            <div>
              <span class="redemption-activity-title">
                ${escapeHTML(record.rewardName || "Reward redemption")}
              </span>
              <span class="redemption-activity-meta">
                ${escapeHTML(formatDateTime(record.createdAt))}
              </span>
            </div>
            <span class="badge ${statusClassName}">${statusText}</span>
          </div>

          <div class="redemption-activity-grid">
            <div class="redemption-activity-stat">
              <span class="rr-label">Points Used</span>
              <span class="rr-value">${record.pointsUsed.toLocaleString()} pts</span>
            </div>
            <div class="redemption-activity-stat">
              <span class="rr-label">Previous Total</span>
              <span class="rr-value">${record.previousBalance.toLocaleString()} pts</span>
            </div>
            <div class="redemption-activity-stat">
              <span class="rr-label">Remaining Total</span>
              <span class="rr-value">${record.remainingBalance.toLocaleString()} pts</span>
            </div>
          </div>

          ${
            isPending
              ? `
                <div class="redemption-activity-action">
                  <button
                    type="button"
                    class="btn btn-primary"
                    data-verify-redemption="${escapeHTML(record.id)}"
                  >
                    <i class="fa-solid fa-circle-check"></i>
                    Verify Redemption
                  </button>
                </div>
              `
              : ""
          }
        </div>
      `;
    })
    .join("");

  residentRedemptionVerificationList
    .querySelectorAll("[data-verify-redemption]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        verifyRedemption(button.dataset.verifyRedemption);
      });
    });
}

function renderResidentSubmissions(resident) {
  const records = getResidentQueueRecords(resident.id);

  const recent = records.slice(0, 8);

  submissionCountTag.textContent = `${records.length} record${
    records.length === 1 ? "" : "s"
  }`;

  residentSubmissionsList.innerHTML = renderSubmissionRows(
    recent,
    "No waste submissions yet.",
  );

  renderRedemptionVerification(resident);

  resetProcessingForm();
}

function resetProcessingForm() {
  if (collectionProcessForm) {
    collectionProcessForm.reset();
  }

  if (processCondition) {
    processCondition.value = "Clean & Sorted";
  }

  if (processingStatusTag) {
    processingStatusTag.textContent = "New collection";
  }

  if (processConfirmBtn) {
    processConfirmBtn.innerHTML = `
        <i class="fa-solid fa-circle-check"></i>
        Verify & Issue EcoPoints
    `;
  }

  if (processingNote) {
    processingNote.textContent = "Enter the waste type and weight collected from this resident, then verify to issue EcoPoints.";
    processingNote.className = "form-note";
  }
}

/* ---------- Collection / request information ---------- */

function getSchedulesForResident(resident) {
  const schedules = readJSON(SCHEDULE_KEY, []);

  if (!Array.isArray(schedules)) return [];

  const residentId = String(resident.id || "").toUpperCase();

  const residentStreet = String(resident.street || resident.purok || "")
    .trim()
    .toLowerCase();

  return schedules

    .filter((schedule) => {
      if (!schedule) return false;

      const scheduleResidentId = String(
        schedule.residentId || schedule.residentID || schedule.userId || "",
      ).toUpperCase();

      const scheduleArea = String(
        schedule.area ||
          schedule.location ||
          schedule.street ||
          schedule.purok ||
          "",
      )
        .trim()
        .toLowerCase();

      const assignedToResident =
        scheduleResidentId && scheduleResidentId === residentId;

      const matchesArea =
        residentStreet &&
        scheduleArea &&
        (scheduleArea === residentStreet ||
          scheduleArea.includes(residentStreet) ||
          residentStreet.includes(scheduleArea));

      return assignedToResident || matchesArea;
    })

    .sort(
      (a, b) =>
        String(a.date || "").localeCompare(String(b.date || "")) ||
        String(a.time || "").localeCompare(String(b.time || "")),
    );
}

function renderCollectionInfo(resident) {
  const records = getResidentQueueRecords(resident.id);

  const latestRequest = records[0] || null;

  const schedules = getSchedulesForResident(resident);

  const nextSchedule = schedules.find(
    (schedule) => !schedule.date || schedule.date >= localDateKey(),
  );

  const cards = [];

  /* Latest collection/request */

  if (latestRequest) {
    const status = formatStatus(latestRequest.status);

    cards.push(`

            <div class="collection-info-item">

                <span class="rr-label">
                    Latest Request
                </span>

                <strong>
                    ${escapeHTML(latestRequest.id || "Request")}
                </strong>

                <span class="collection-info-value">

                    ${escapeHTML(latestRequest.wasteType || "Waste collection")}

                    ${
                      latestRequest.weightKg
                        ? ` &middot; ${Number(latestRequest.weightKg)
                            .toFixed(1)
                            .replace(/\.0$/, "")} kg`
                        : ""
                    }

                </span>

                <span class="badge ${statusClass(latestRequest.status)}">

                    ${status}

                </span>

                <span class="collection-info-meta">

                    ${escapeHTML(
                      formatDateTime(
                        latestRequest.completedAt || latestRequest.submittedAt,
                      ),
                    )}

                </span>

                ${
                  latestRequest.notes
                    ? `
                        <span class="collection-info-meta">
                            Note:
                            ${escapeHTML(latestRequest.notes)}
                        </span>
                        `
                    : ""
                }

            </div>

        `);
  }

  /* Assigned collection schedule */

  if (nextSchedule) {
    cards.push(`

            <div class="collection-info-item">

                <span class="rr-label">
                    Assigned Collection
                </span>

                <strong>

                    ${escapeHTML(
                      nextSchedule.area ||
                        nextSchedule.location ||
                        nextSchedule.street ||
                        "Collection route",
                    )}

                </strong>

                <span class="collection-info-value">

                    ${escapeHTML(
                      nextSchedule.materials || "Scheduled collection",
                    )}

                </span>

                <span class="collection-info-meta">

                    ${
                      nextSchedule.date
                        ? escapeHTML(formatDate(nextSchedule.date))
                        : "Date not provided"
                    }

                    ${
                      nextSchedule.time
                        ? ` &middot; ${escapeHTML(nextSchedule.time)}`
                        : ""
                    }

                </span>

            </div>

        `);
  }

  if (!cards.length) {
    residentCollectionInfo.innerHTML = `
            <div class="empty-note">
                No collection or request records yet.
            </div>
            `;

    return;
  }

  residentCollectionInfo.innerHTML = `
        <div class="collection-info-grid">
            ${cards.join("")}
        </div>
        `;
}

function getCurrentCollector() {
  let session = null;

  try {
    session =
      EcoSession() ||
      JSON.parse(sessionStorage.getItem("ecoUser"));
  } catch {
    session = null;
  }

  const name =
    session && (session.fname || session.lname)
      ? `${session.fname || ""} ${session.lname || ""}`.trim()
      : "Collector";

  return {
    id: session?.userId || session?.id || session?.email || "",
    name: name || "Collector",
  };
}

function saveTransactions(transactions) {
  localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(transactions));
}

function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}




function verifyRedemption(redemptionId) {
  if (!activeResident || !redemptionId) {
    return;
  }

  const notificationRecords = readJSON(REDEMPTION_NOTIFICATIONS_KEY, []);
  const transactions = readJSON(TRANSACTIONS_KEY, []);
  const collector = getCurrentCollector();
  const now = new Date().toISOString();

  let target = Array.isArray(notificationRecords)
    ? notificationRecords.find(
        (record) =>
          String(record?.id || "") === String(redemptionId) &&
          String(record?.residentId || "").toUpperCase() ===
            String(activeResident.id || "").toUpperCase(),
      )
    : null;

  const transactionIndex = Array.isArray(transactions)
    ? transactions.findIndex(
        (transaction) => String(transaction?.id || "") === String(redemptionId),
      )
    : -1;

  if (!target && transactionIndex !== -1) {
    target = transactions[transactionIndex];
  }

  if (!target) {
    showNote("The redemption record could not be found.", "error");
    return;
  }

  const isPending = String(target.status || "pending").toLowerCase() === "pending";

  if (!isPending) {
    showNote("This redemption has already been verified.", "error");
    renderRedemptionVerification(activeResident);
    return;
  }

  const updatedFields = {
    status: "verified",
    verifiedAt: now,
    verifiedById: collector.id,
    verifiedByName: collector.name,
  };

  if (Array.isArray(notificationRecords)) {
    const index = notificationRecords.findIndex(
      (record) => String(record?.id || "") === String(redemptionId),
    );

    if (index !== -1) {
      notificationRecords[index] = {
        ...notificationRecords[index],
        ...updatedFields,
      };
    } else {
      notificationRecords.unshift({
        ...target,
        ...updatedFields,
      });
    }

    localStorage.setItem(
      REDEMPTION_NOTIFICATIONS_KEY,
      JSON.stringify(notificationRecords),
    );
  }

  if (Array.isArray(transactions)) {
    const index = transactions.findIndex(
      (transaction) => String(transaction?.id || "") === String(redemptionId),
    );

    if (index !== -1) {
      transactions[index] = {
        ...transactions[index],
        ...updatedFields,
      };
    } else {
      transactions.unshift({
        ...target,
        ...updatedFields,
      });
    }

    saveTransactions(transactions);
  }

  renderResult(findResident(activeResident.id), activeResident.id, false);

  const remainingBalance = Number(target.remainingBalance ?? 0);
  const pointsUsed = Math.abs(
    Number(target.pointsUsed ?? target.requiredEcoPoints ?? target.points ?? 0),
  );

  showNote(
    `Redemption verified. ${pointsUsed.toLocaleString()} EcoPoints were used and ${remainingBalance.toLocaleString()} EcoPoints remain for ${activeResident.name}.`,
    "success",
  );
}

function createQrTransaction(record, computation, completedAt, collector) {
  const transactions = readJSON(TRANSACTIONS_KEY, []);

  const existing = Array.isArray(transactions)
    ? transactions.find(
        (transaction) =>
          String(transaction.queueId || transaction.reference || "") ===
            String(record.id) &&
          transaction.type === "earn",
      )
    : null;

  if (existing) return existing;

  const transaction = {
    id: `ECO-TXN-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`,
    type: "earn",
    referenceType: "collectorQrVerification",
    reference: record.id,
    queueId: record.id,
    residentId: record.residentId || "",
    residentName: record.residentName || "Resident",
    collectorId: collector.id,
    collectorName: collector.name,
    wasteType: record.wasteType || "",
    verifiedWeightKg: Number(
      record.verifiedWeightKg ?? record.verifiedWeight ?? record.weightKg ?? 0,
    ),
    pointsPerKg: computation.rate,
    conditionMultiplier: computation.multiplier,
    points: computation.finalPoints,
    description: `${record.wasteType || "Waste"} verified by collector (${Number(
      record.verifiedWeightKg ?? record.verifiedWeight ?? record.weightKg ?? 0,
    )} kg)`,
    createdAt: completedAt,
  };

  saveTransactions([transaction, ...(Array.isArray(transactions) ? transactions : [])]);

  return transaction;
}

function updateResidentResultAfterProcessing(message, type) {
  if (!activeResident) return;

  const resident = findResident(activeResident.id);

  if (resident) {
    renderResult(resident, activeResident.id, false);
  }

  showNote(message, type);
}

async function processCollection(event) {
  event.preventDefault();

  if (!activeResident) {
    showNote("Scan a resident before processing a collection.", "error");
    return;
  }

  const wasteType = processWasteType.value;
  const weightKg = Number(processWeightKg.value);
  const condition = processCondition.value;
  const notes = processNotes ? processNotes.value.trim() : "";

  if (!wasteType) {
    processingNote.textContent = "Select a waste type.";
    processingNote.className = "form-note error";
    processWasteType.focus();
    return;
  }

  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    processingNote.textContent = "Enter the actual collected weight in kilos.";
    processingNote.className = "form-note error";
    processWeightKg.focus();
    return;
  }

  const queue = getQueue();
  const now = new Date().toISOString();
  const collector = getCurrentCollector();

  const queueId = `COL-${Date.now()}`;

  queue.unshift({
    id: queueId,
    residentId: activeResident.id,
    residentName: activeResident.name,
    wasteType,
    weightKg,
    notes,
    status: "pending",
    collectionStatus: "pending",
    source: "collector-scan",
    submittedAt: now,
  });

  const target = {
    ...queue[0],
    verifiedWeightKg: weightKg,
    condition,
    verificationNotes: notes,
    status: "pending",
  };

  const computation = computeEcoPoints(wasteType, weightKg, condition);
  const points = computation.finalPoints;

    const accountId = String(target.residentId || "").trim().toUpperCase();
  const description = `${wasteType} verified by collector (${weightKg} kg)`;

  let updatedResident = null;
  let mysqlResidentId = null;
  let newBalance = null;

  try {
    const lookupRes = await fetch(
      `/api/residents/by-account/${encodeURIComponent(accountId)}`,
    );
    const lookupData = await lookupRes.json();

    if (!lookupRes.ok || !lookupData.success || !lookupData.resident) {
      processingNote.textContent =
        lookupData.error ||
        "Resident not found in database. Register/login this resident first.";
      processingNote.className = "form-note error";
      return;
    }

    mysqlResidentId = lookupData.resident.resident_id;

    // Records the collection AND credits the points in one
    // A missing collector id means nobody is signed in as staff. Stop here
    // with a clear message rather than sending a request that fails.
    const signedInCollectorId = window.EcoApi ? window.EcoApi.collectorId() : null;
    if (!signedInCollectorId) {
      throw new Error("You are not signed in as a collector. Please log in again.");
    }

    // transaction. The old /earn call only moved points, so the
    // collection itself never reached the database.
    const earnRes = await fetch("/api/waste-collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resident_id: mysqlResidentId,
        collector_id: signedInCollectorId,
        waste_type: wasteType,
        weight_kg: Number(weightKg),
        points_earned: points,
        collector_note: notes || description,
      }),
    });
    const earnData = await earnRes.json();

    if (!earnRes.ok || !earnData.success) {
      processingNote.textContent =
        earnData.error || "Could not save points to database.";
      processingNote.className = "form-note error";
      return;
    }

    newBalance = earnData.newBalance;

    // The /earn call above already credited the points and wrote the
    // history row, so this only syncs the local view. Without
    // cacheOnly this would post a second waste collection and credit
    // the same scan twice.
    updatedResident = addPointsToResident(accountId, points, description, {
      cacheOnly: true,
    }) || {
      id: accountId,
      name: activeResident.name,
      points: newBalance,
    };
  } catch (err) {
    console.error(err);
    processingNote.textContent =
      "Network error while saving points. Is the server running?";
    processingNote.className = "form-note error";
    return;
  }

  const transaction = createQrTransaction(
    {
      ...target,
      verifiedWeightKg: weightKg,
    },
    computation,
    now,
    collector,
  );

  queue[0] = {
    ...target,
    status: "completed",
    collectionStatus: "completed",
    verificationStatus: "Verified",
    verifiedAt: now,
    completedAt: now,
    collectedAt: now,
    verifiedById: collector.id,
    verifiedByName: collector.name,
    collectorId: collector.id,
    collectorName: collector.name,
    pointsIssued: points,
    computedPoints: points,
    computationConfirmedAt: now,
    transactionId: transaction.id,
    updatedAt: now,
  };

  saveQueue(queue);

  localStorage.removeItem("ecoPendingComputation");

  renderResidentSubmissions(activeResident);
  renderCollectionInfo(activeResident);

  updateResidentResultAfterProcessing(
    `${activeResident.name} received ${points.toLocaleString()} EcoPoints. The collection was verified and completed.`,
    "success",
  );
}

/* ---------- Render resident result ---------- */

function renderResult(resident, accountIdTried, fromQrScan = false) {
  if (!resident) {
    activeResident = null;

    scanEmptyState.hidden = false;

    residentResult.hidden = true;

    showNote(
      `No resident found for "${accountIdTried}". Check the ID and try again.`,
      "error",
    );

    return;
  }

  const account = getResidentAccount(resident);

  activeResident = account;

  scanEmptyState.hidden = true;

  residentResult.hidden = false;

  resultAvatar.textContent = initials(account.name);

  resultName.textContent = account.name || "Resident";

  resultId.textContent = account.id || "—";

  resultBadge.textContent = "Found";

  resultPurok.textContent = account.purok || account.street || "Unassigned";

  resultPoints.textContent = `${Number(
    account.points || 0,
  ).toLocaleString()} pts`;

  resultSince.textContent = account.memberSince || "—";

  resultLast.textContent = account.lastCollection || "No collection yet";

  resultEmail.textContent = account.email || "—";

  resultPhone.textContent = account.phone || "—";

  resultAddress.textContent = account.address || "Unassigned";

  localStorage.setItem(
    ACTIVE_SCAN_KEY,
    JSON.stringify({
      id: account.id,

      name: account.name,

      scannedAt: new Date().toISOString(),

      source: fromQrScan ? "qr" : "manual-lookup",
    }),
  );

  renderResidentSubmissions(account);

  renderRedemptionVerification(account);

  renderCollectionInfo(account);

  if (fromQrScan) {
    addRecentScan(account);

    showNote(
      `${account.name} matched successfully. No waste or collection record was created by the scan.`,
      "success",
    );
  } else {
    showNote(
      `${account.name} matched successfully. Manual lookup does not count as a QR scan.`,
      "success",
    );
  }
}

/* ---------- Reset result ---------- */

function resetResult() {
  activeResident = null;

  scanEmptyState.hidden = false;

  residentResult.hidden = true;

  manualIdInput.value = "";

  localStorage.removeItem(ACTIVE_SCAN_KEY);

  resetProcessingForm();

  showNote("", null);
}

/* ---------- Recent QR scans ---------- */

function getScanLog() {
  const log = readJSON(RECENT_SCANS_KEY, []);

  return Array.isArray(log) ? log : [];
}

function addRecentScan(resident) {
  const log = getScanLog();

  const now = new Date().toISOString();

  log.unshift({
    name: resident.name,

    id: resident.id,

    time: new Date(now).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),

    scannedAt: now,

    source: "qr",
  });

  localStorage.setItem(RECENT_SCANS_KEY, JSON.stringify(log.slice(0, 8)));

  renderRecentScans();
}

function renderRecentScans() {
  const log = getScanLog()
    .filter((entry) => entry && entry.source === "qr" && entry.scannedAt)

    .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));

  if (!log.length) {
    recentScansList.innerHTML = `
            <p class="field-hint">
                No activity yet.
                Actual QR scans will appear here.
            </p>
            `;

    return;
  }

  recentScansList.innerHTML = log
    .slice(0, 8)
    .map(
      (entry) => `

                    <div class="submission-row">

                        <div class="submission-icon">

                            <i class="fa-solid fa-qrcode"></i>

                        </div>

                        <div class="submission-info">

                            <span class="submission-title">

                                ${escapeHTML(entry.name || "Resident")}

                            </span>

                            <span class="submission-meta">

                                ${escapeHTML(
                                  entry.id || "Resident ID unavailable",
                                )}

                                &middot;

                                ${escapeHTML(formatDateTime(entry.scannedAt))}

                            </span>

                        </div>

                        <span class="badge badge-verified">
                            Scanned
                        </span>

                    </div>

                `,
    )
    .join("");
}

/* ---------- Manual lookup ---------- */

manualLookupBtn.addEventListener("click", async () => {
  const accountId = manualIdInput.value.trim();

  if (!accountId) {
    showNote("Enter a Resident Account ID first.", "error");
    return;
  }

  showNote("Looking up resident...", null);
  const resident = await findResident(accountId);
  renderResult(resident, accountId, false);
});

manualIdInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") manualLookupBtn.click();
});

scanAnotherBtn.addEventListener("click", resetResult);

if (collectionProcessForm) {
  collectionProcessForm.addEventListener("submit", processCollection);
}

if (proceedBtn) {
  proceedBtn.addEventListener("click", () => {
    resetProcessingForm();

    if (processingPanel) {
      processingPanel.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }

    if (processWasteType) {
      processWasteType.focus();
    }
  });
}

/* ---------- Camera scanning ---------- */

async function startCamera() {
  if (typeof Html5Qrcode === "undefined") {
    showNote(
      "Camera scanner library failed to load. Use manual entry below instead.",
      "error",
    );

    return;
  }

  try {
    html5QrCode = new Html5Qrcode("qrReader");

    await html5QrCode.start(
      {
        facingMode: "environment",
      },

      {
        fps: 10,

        qrbox: {
          width: 220,

          height: 220,
        },
      },

      onScanSuccess,

      () => {
        /* Ignore frame decode misses */
      },
    );

    cameraRunning = true;

    scannerFrame.classList.add("is-active");

    scanModeTag.textContent = "Camera live";

    toggleCameraBtn.innerHTML = `
            <i class="fa-solid fa-video-slash"></i>
            Stop Camera
            `;

    showNote("Point the camera at the resident's QR code.", null);
  } catch (err) {
    showNote(cameraHelpText(err), "error");
  }
}

// Turns a getUserMedia / scanner error into something the collector can
// act on. The manual lookup further down the page always works and needs
// no camera at all, so it is offered as the way out.
function cameraHelpText(err) {
  const name = String((err && err.name) || "");

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return (
      "Camera permission is blocked. On a phone: tap the lock/camera icon " +
      "in the address bar, set Camera to Allow, then reload. " +
      "Or skip the camera and use Manual Lookup below with the resident's Account ID."
    );
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return (
      "No camera was found on this device. Use Manual Lookup below " +
      "and type the resident's Account ID instead."
    );
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return (
      "The camera is busy in another app. Close any other app using the " +
      "camera, then try again - or use Manual Lookup below."
    );
  }

  if (!window.isSecureContext) {
    return (
      "The camera needs a secure (https) connection. Use Manual Lookup " +
      "below with the resident's Account ID."
    );
  }

  return (
    "Couldn't start the camera. Use Manual Lookup below and type the " +
    "resident's Account ID (for example ECO-26-01)."
  );
}

async function stopCamera() {
  if (html5QrCode && cameraRunning) {
    try {
      await html5QrCode.stop();

      html5QrCode.clear();
    } catch {
      /* Already stopped */
    }
  }

  cameraRunning = false;

  scannerFrame.classList.remove("is-active");

  scanModeTag.textContent = "Camera idle";

  toggleCameraBtn.innerHTML = `
        <i class="fa-solid fa-camera"></i>
        Start Camera Scan
        `;
}

async function onScanSuccess(decodedText) {
      const accountId = extractAccountId(decodedText);

    const resident = await findResident(accountId);
    renderResult(resident, accountId, true);

  stopCamera();
}

toggleCameraBtn.addEventListener("click", () => {
  if (cameraRunning) stopCamera();
  else startCamera();
});

async function scanUploadedQrFile(file) {
  if (typeof Html5Qrcode === "undefined") {
    uploadQrNote.textContent =
      "QR scanner library failed to load. Use manual entry below instead.";
    uploadQrNote.className = "form-note error";
    return;
  }

  if (cameraRunning) {
    await stopCamera();
  }

  uploadQrNote.textContent = "Reading the uploaded QR code...";
  uploadQrNote.className = "form-note";

  const fileScanner = new Html5Qrcode("qrReader");

  try {
    const decodedText = await fileScanner.scanFile(file, false);

    const accountId = extractAccountId(decodedText);

    renderResult(findResident(accountId), accountId, true);

    uploadQrNote.textContent = "";
    uploadQrNote.className = "form-note";
  } catch (err) {
    uploadQrNote.textContent =
      "Couldn't read a QR code from that image. Try another picture or use manual entry below.";
    uploadQrNote.className = "form-note error";
  } finally {
    try {
      fileScanner.clear();
    } catch {
      /* Nothing to clear */
    }
  }
}

uploadQrBtn.addEventListener("click", () => {
  uploadQrInput.value = "";
  uploadQrInput.click();
});

uploadQrInput.addEventListener("change", () => {
  const file = uploadQrInput.files && uploadQrInput.files[0];

  if (file) scanUploadedQrFile(file);
});

/* ---------- Init ---------- */

renderRecentScans();