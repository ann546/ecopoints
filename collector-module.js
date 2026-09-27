const COLLECTOR_STORAGE_KEYS = {
  residents: "ecoResidentDirectory",
  users: "ecoUsers",
  userIdSeq: "ecoUserIdSeq",
};

const DEMO_RESIDENT_IDS = new Set([
  "ECO-2026-0043",
  "SUB-1001",
  "SUB-1002",
  "SUB-1003",
  "SUB-1004",
]);

const DEMO_RESIDENT_EMAILS = new Set(["juan.delacruz@gmail.com"]);

const DEMO_RESIDENT_NAMES = new Set(["juan dela cruz"]);

function readCollectorJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeCollectorJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function isKnownDemoResident(record) {
  if (!record || typeof record !== "object") return false;

  const id = String(record.id || record.residentId || record.userId || "")
    .trim()
    .toUpperCase();

  const email = String(record.email || "")
    .trim()
    .toLowerCase();

  const name = String(
    record.name ||
      record.residentName ||
      `${record.fname || ""} ${record.lname || ""}`,
  )
    .trim()
    .toLowerCase();

  return (
    DEMO_RESIDENT_IDS.has(id) ||
    DEMO_RESIDENT_EMAILS.has(email) ||
    DEMO_RESIDENT_NAMES.has(name)
  );
}

function cleanArrayKey(key) {
  const value = readCollectorJSON(key, []);

  if (!Array.isArray(value)) return;

  writeCollectorJSON(
    key,
    value.filter((record) => !isKnownDemoResident(record)),
  );
}

function removeKnownDemoData() {
  const users = readCollectorJSON(COLLECTOR_STORAGE_KEYS.users, {});

  const cleanedUsers = {};

  Object.entries(users).forEach(([key, user]) => {
    // Staff accounts (collectors/admins) created by the admin are real
    // accounts, never demo data, even if their name matches a demo name.
    const isStaff = user && (user.role === "collector" || user.role === "admin");

    if (isStaff || !isKnownDemoResident(user)) {
      cleanedUsers[key] = user;
    }
  });

  writeCollectorJSON(COLLECTOR_STORAGE_KEYS.users, cleanedUsers);

  cleanArrayKey(COLLECTOR_STORAGE_KEYS.residents);

  cleanArrayKey("ecoWasteQueue");
  cleanArrayKey("ecoCollectorScanLog");
  cleanArrayKey("ecoCollectorRedemptionLog");

  const transactions = readCollectorJSON("ecoTransactions", []);

  if (Array.isArray(transactions)) {
    writeCollectorJSON(
      "ecoTransactions",
      transactions.filter((transaction) => !isKnownDemoResident(transaction)),
    );
  }

  const pendingComputation = readCollectorJSON("ecoPendingComputation", null);

  if (
    isKnownDemoResident(pendingComputation) ||
    (pendingComputation && isKnownDemoResident(pendingComputation.resident))
  ) {
    localStorage.removeItem("ecoPendingComputation");
  }

  const activeScan = readCollectorJSON("ecoActiveScan", null);

  if (isKnownDemoResident(activeScan)) {
    localStorage.removeItem("ecoActiveScan");
  }
}

removeKnownDemoData();

function collectorDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(d.getTime())) return "";

  return d.toISOString().slice(0, 10);
}

function collectorNextUserId() {
  let seq = parseInt(
    localStorage.getItem(COLLECTOR_STORAGE_KEYS.userIdSeq),
    10,
  );

  if (Number.isNaN(seq)) {
    seq = 1000;
  }

  seq += 1;

  localStorage.setItem(COLLECTOR_STORAGE_KEYS.userIdSeq, String(seq));

  return `ECO-${seq}`;
}

// Resident directory fetched from MySQL. Populated by
// CollectorData.hydrate() before pages render; getResidents() and
// findResidentById() read from it so the synchronous call sites keep
// working. Falls back to the localStorage directory when the server
// is unreachable.
let collectorCache = null;

function getResidents() {
  if (collectorCache) return collectorCache;

  const users = readCollectorJSON(COLLECTOR_STORAGE_KEYS.users, {});

  const existingDirectory = readCollectorJSON(
    COLLECTOR_STORAGE_KEYS.residents,
    [],
  );

  const oldDirectory = Array.isArray(existingDirectory)
    ? existingDirectory
    : [];

  const oldById = new Map(
    oldDirectory
      .filter((resident) => resident && resident.id)
      .map((resident) => [resident.id, resident]),
  );

  let changedUsers = false;

  const residents = Object.values(users)
    .filter(
      (user) => user && user.role === "resident" && !isKnownDemoResident(user),
    )
    .map((user) => {
      if (!user.userId) {
        user.userId = collectorNextUserId();

        changedUsers = true;
      }

      const id = user.userId;

      const name =
        `${user.fname || ""} ${user.lname || ""}`.trim() || "Resident";

      const history = Array.isArray(user.history) ? user.history : [];

      const earnHistory = history.filter(
        (entry) => entry && Number(entry.points) > 0 && entry.type !== "bonus",
      );

      const lastCollectionEntry = earnHistory.find((entry) =>
        /verified by collector/i.test(String(entry.description || "")),
      );

      return {
        ...(oldById.get(id) || {}),
        id,
        name,
        purok: user.purok || user.street || "Unassigned",
        points: typeof user.points === "number" ? user.points : 0,
        memberSince: user.createdAt
          ? new Date(user.createdAt).toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            })
          : "—",
        lastCollection:
          lastCollectionEntry && lastCollectionEntry.date
            ? lastCollectionEntry.date
            : oldById.get(id)?.lastCollection || "No collection yet",
        email: user.email || "",
        history,
      };
    });

  if (changedUsers) {
    writeCollectorJSON(COLLECTOR_STORAGE_KEYS.users, users);
  }

  writeCollectorJSON(COLLECTOR_STORAGE_KEYS.residents, residents);

  return residents;
}

function saveResidents(residents) {
  writeCollectorJSON(COLLECTOR_STORAGE_KEYS.residents, residents);
}

function findResidentById(accountId) {
  if (!accountId) return null;

  const cleanId = accountId.trim().toUpperCase();

  return (
    getResidents().find(
      (resident) => String(resident.id).toUpperCase() === cleanId,
    ) || null
  );
}


const MATERIAL_RATES = {
  Paper: 8,
  Plastic: 12,
  Metal: 15,
  Glass: 10,
  "E-Waste": 20,
  Mixed: 8,
};

const CONDITION_MULTIPLIERS = {
  "Clean & Sorted": 1,
  "Needs Sorting": 0.8,
  Contaminated: 0.5,
};

function computeEcoPoints(wasteType, weightKg, condition) {
  const rate = MATERIAL_RATES[wasteType] ?? 8;

  const multiplier = CONDITION_MULTIPLIERS[condition] ?? 1;

  const rawPoints = rate * weightKg * multiplier;

  return {
    rate,
    multiplier,
    rawPoints,
    finalPoints: Math.round(rawPoints),
  };
}

/* ============================================================
   API LAYER
   The database is the source of truth. The functions above stay
   synchronous by reading the cache filled in here, so no page needs
   rewriting to await.
   ============================================================ */

window.CollectorData = {
  // Pulls the resident directory (and the collector's own group, when
  // signed in) into the cache. Safe to call repeatedly.
  hydrate: function () {
    if (!window.EcoApi) return Promise.resolve({ success: false });

    const work = [window.EcoApi.get("/api/residents?limit=500")];

    const collectorId = window.EcoApi.collectorId();
    if (collectorId) {
      work.push(
        window.EcoApi.get("/api/collector-groups").catch(() => ({ groups: [] })),
      );
    }

    return Promise.all(work)
      .then(function (results) {
        const residentsRes = results[0];

        if (!residentsRes || !residentsRes.success || residentsRes.offline) {
          return { success: false, offline: !!(residentsRes && residentsRes.offline) };
        }

        const directory = (residentsRes.residents || []).map(function (r) {
          return {
            id: r.account_id,
            accountId: r.account_id,
            residentId: r.resident_id,
            name: r.name || (r.first_name + " " + r.last_name).trim(),
            first_name: r.first_name,
            last_name: r.last_name,
            purok: r.street || "Unassigned",
            street: r.street,
            email: r.email,
            phone: r.phone,
            houseNumber: r.house_number,
            points: Number(r.ecopoints_balance || 0),
            status: r.account_status,
            qrCodeValue: r.qr_code_value,
            submissions: Number(r.submissions_count || 0),
            collections: Number(r.collections_count || 0),
            memberSince: r.created_at
              ? new Date(r.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  year: "numeric",
                })
              : "—",
            lastCollection: "No collection yet",
            history: [],
          };
        });

        collectorCache = directory;

        if (results[1] && results[1].success) {
          CollectorData.groups = results[1].groups || [];
        }

        return { success: true, count: directory.length };
      })
      .catch(function () {
        return { success: false, offline: true };
      });
  },

  groups: [],

  residents: function () {
    return collectorCache || getResidents();
  },

  // Forces a re-read, for use after a scan or points change.
  refresh: function () {
    collectorCache = null;
    return window.CollectorData.hydrate();
  },

  isHydrated: function () {
    return !!collectorCache;
  },
};

// Adjusts the cached resident's balance without touching the database.
// Used by callers that have already written the real change themselves.
function applyPointsToCache(residentRow, pointsDelta) {
  const delta = Number(pointsDelta || 0);
  const row = residentRow;

  if (row) {
    row.points = (Number(row.points) || 0) + delta;
    if (delta > 0) {
      row.lastCollection = new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
  }

  // Keep the shared cache in step so other views see the new balance.
  if (collectorCache && row && row.residentId) {
    const cached = collectorCache.find((r) => r.residentId === row.residentId);
    if (cached) cached.points = row.points;
  }

  return row || null;
}

// Adds EcoPoints through the API so the balance, the points history
// and the admin collection record all stay in step. Falls back to the
// old localStorage path when the server is unreachable.
function addPointsToResidentApi(residentRow, pointsDelta, description, options) {
  const opts = options || {};
  const residentId = residentRow.residentId;
  const isRedemption = opts.mode === "redemption";

  // cacheOnly: the caller already credited the points through its own
  // endpoint (QR Code Scanner uses POST /api/residents/:id/earn), so
  // this must only sync the in-memory view. Without the guard the same
  // scan gets credited twice.
  if (opts.cacheOnly) {
    return applyPointsToCache(residentRow, pointsDelta);
  }

  if (
    !residentId ||
    !window.EcoApi ||
    opts.offlineFallback === false
  ) {
    return null;
  }

  // A reward claim is not a waste pickup, so it goes through the
  // dedicated redeem endpoint, which also handles stock.
  if (isRedemption) {
    if (!opts.rewardId) return null;

    return window.EcoApi
      .post("/api/residents/" + residentId + "/redeem", {
        reward_id: opts.rewardId,
      })
      .then(function (res) {
        if (res && res.success) {
          if (collectorCache) {
            const row = collectorCache.find((r) => r.residentId === residentId);
            if (row && typeof res.balance === "number") {
              row.points = res.balance;
            }
          }
          return { success: true, newBalance: res.balance, message: res.message };
        }

        return addPointsToResidentLocal(
          residentRow.accountId || residentRow.id,
          pointsDelta,
          description,
        );
      })
      .catch(function () {
        return addPointsToResidentLocal(
          residentRow.accountId || residentRow.id,
          pointsDelta,
          description,
        );
      });
  }

  const payload = {
    resident_id: residentId,
    collector_id: window.EcoApi.collectorId() || 1,
    waste_type: opts.wasteType || "Mixed",
    weight_kg: Number(opts.weightKg || 1),
    points_earned: Math.max(0, Math.round(Number(pointsDelta) || 0)),
    collector_note: description,
  };

  return window.EcoApi
    .post("/api/waste-collections", payload)
    .then(function (res) {
      if (res && res.success) {
        // Keep the cached directory in step so the table updates
        // without a reload.
        if (collectorCache) {
          const row = collectorCache.find(
            (r) => r.residentId === residentId,
          );

          if (row && typeof res.newBalance === "number") {
            row.points = res.newBalance;
            row.collections += 1;
            row.lastCollection = new Date().toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            });
          }
        }

        return { success: true, newBalance: res.newBalance };
      }

      // Server reachable but refused - fall back so the demo continues.
      return addPointsToResidentLocal(
        residentRow.accountId || residentRow.id,
        pointsDelta,
        description,
      );
    })
    .catch(function () {
      return addPointsToResidentLocal(
        residentRow.accountId || residentRow.id,
        pointsDelta,
        description,
      );
    });
}

// The original localStorage implementation, kept as the offline path.
function addPointsToResidentLocal(accountId, pointsDelta, description) {
  const residents = getResidents();

  const cleanId = String(accountId).trim().toUpperCase();

  const index = residents.findIndex(
    (resident) => String(resident.id).toUpperCase() === cleanId,
  );

  if (index === -1) return null;

  const now = new Date();

  const date = now.toISOString();

  const displayDate = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const delta = Number(pointsDelta || 0);

  residents[index].points = (Number(residents[index].points) || 0) + delta;

  if (delta > 0) {
    residents[index].lastCollection = displayDate;
  }

  if (!Array.isArray(residents[index].history)) {
    residents[index].history = [];
  }

  residents[index].history.unshift({
    type: delta >= 0 ? "earn" : "redeem",
    description,
    points: delta,
    date,
  });

  saveResidents(residents);

  const users = readCollectorJSON(COLLECTOR_STORAGE_KEYS.users, {});

  const userKey = Object.keys(users).find(
    (key) =>
      users[key] && String(users[key].userId || "").toUpperCase() === cleanId,
  );

  if (userKey) {
    const user = users[userKey];

    user.points = (Number(user.points) || 0) + delta;

    if (!Array.isArray(user.history)) {
      user.history = [];
    }

    user.history.unshift({
      type: delta >= 0 ? "earn" : "redeem",
      description,
      points: delta,
      date,
    });

    user.userId = residents[index].id;

    users[userKey] = user;

    writeCollectorJSON(COLLECTOR_STORAGE_KEYS.users, users);
  }

  return residents[index];
}

// Public entry point: prefers the database, falls back to localStorage.
function addPointsToResident(accountId, pointsDelta, description, options) {
  const cleanId = String(accountId || "").trim().toUpperCase();

  const row = findResidentById(cleanId);

  if (!row) return null;

  const viaApi = addPointsToResidentApi(row, pointsDelta, description, options);

  if (viaApi) return viaApi;

  return addPointsToResidentLocal(cleanId, pointsDelta, description);
}
