/* ============================================================
   legacy-bridge.js
   Loads the shared operational data from MySQL into the localStorage
   keys the older page scripts already read.

   Why this exists
   ---------------
   Several pages (Waste Verification, Collector
   Dashboard, Collector Notifications, Collector Collection Schedule,
   Resident EcoPoints Records) were written against a handful of
   localStorage arrays. Rewriting all six risked breaking working
   screens. Instead this bridge fetches the real rows from MySQL and
   writes them into those same keys, in the same shape, before the
   page renders.

   The result: the localStorage entries are now a *cache of the
   database*, refreshed on every page load, not the source of truth.
   Writes still go through the API, and any page that writes to these
   keys is mirrored back to MySQL by its own code.

   Keys refreshed here:
     ecoWasteQueue          <- /api/waste-collections
     ecoCollectorScanLog    <- /api/collector-qr-scans
     ecoTransactions        <- /api/residents/:id/redemptions (current resident)
   ============================================================ */

(function () {
    "use strict";

    if (window.__ecoLegacyBridge) return;
    window.__ecoLegacyBridge = true;

    var QUEUE_KEY = "ecoWasteQueue";
    var SCAN_LOG_KEY = "ecoCollectorScanLog";
    var TRANSACTIONS_KEY = "ecoTransactions";
    var ABSENCES_KEY = "ecoCollectorAbsences";
    var GROUPS_KEY = "ecoCollectorGroups";

    // The pages model a group as 6 member slots, the first 2 being
    // drivers. The database stores membership as one row per collector,
    // so the slot list is rebuilt here.
    var MEMBER_SLOTS = 6;
    var DRIVER_SLOTS = 2;

    // collector_groups + collector_group_streets + collectors
    //   -> [{ id, name, members: [{ role, email }], streets: [...] }]
    function buildGroups(groupRows, streetMap, collectorRows) {
        return (groupRows || []).map(function (g) {
            var number = Number(g.group_number);
            var members = [];

            for (var i = 0; i < MEMBER_SLOTS; i++) {
                members.push({
                    role: i < DRIVER_SLOTS ? "Driver" : "Collector",
                    email: ""
                });
            }

            (collectorRows || []).forEach(function (c) {
                if (Number(c.group_number) !== number) return;
                if (String(c.account_status).toLowerCase() !== "active") return;
                if (!c.email) return;

                var isDriver = String(c.position || "").indexOf("Driver") !== -1;
                var wantedRole = isDriver ? "Driver" : "Collector";

                for (var s = 0; s < members.length; s++) {
                    if (members[s].role === wantedRole && !members[s].email) {
                        members[s].email = c.email;
                        return;
                    }
                }
            });

            return {
                id: g.group_number,
                name: g.group_name,
                members: members,
                streets: (streetMap[number] || []).slice()
            };
        });
    }

    function write(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            // A full or disabled storage shouldn't take the page down.
        }
    }

    function isoOrNull(value) {
        return value ? String(value) : null;
    }

    // /api/waste-collections -> the shape the queue readers expect
    function toQueueRow(c) {
        return {
            id: "WC-" + c.collection_id,
            collectionId: c.collection_id,
            residentId: c.resident_id,
            accountId: c.accountId,
            residentName: c.residentName,
            street: c.street,
            collectorId: c.collector_id,
            collectorCode: c.collectorCode,
            collectorName: c.collectorName,
            wasteType: c.wasteType,
            verifiedWeightKg: c.weightKg,
            weightKg: c.weightKg,
            pointsAwarded: c.pointsEarned,
            pointsEarned: c.pointsEarned,
            status: c.verificationStatus,
            wasteVerificationStatus: c.verificationStatus,
            note: c.collectorNote,
            collectorNote: c.collectorNote,
            date: isoOrNull(c.collectedAt),
            collectedAt: isoOrNull(c.collectedAt),
            verifiedAt: isoOrNull(c.verifiedAt),
        };
    }
    function toRequestRow(r) {
        return {
            id: "CR-" + r.request_id,
            requestId: r.request_id,
            residentId: r.resident_id,
            accountId: r.accountId,
            residentName: r.residentName,
            street: r.street,
            wasteType: r.wasteType,
            estimatedWeightKg: r.estimatedWeightKg,
            notes: r.notes,
            requestedDate: isoOrNull(r.requestedDate),
            requestedTime: r.requestedTime || "",
            status: r.status,
            handledBy: r.handled_by,
            handledAt: isoOrNull(r.handled_at),
            createdAt: isoOrNull(r.created_at),
        };
    }

    function toScanRow(s) {
        return {
            id: "SCAN-" + s.scan_id,
            scanId: s.scan_id,
            collectorId: s.collector_id,
            residentId: s.resident_id,
            accountId: s.accountId,
            residentName: s.residentName,
            scannedQrValue: s.scanned_qr_value,
            scannedAt: isoOrNull(s.scanned_at),
        };
    }

    function toTransactionRow(r) {
        return {
            id: "ECO-RED-" + r.redemption_id,
            type: "redemption",
            referenceType: "rewardRedemption",
            rewardId: r.reward_name,
            rewardName: r.reward_name,
            points: -Number(r.points_cost || 0),
            pointsUsed: Number(r.points_cost || 0),
            requiredEcoPoints: Number(r.points_cost || 0),
            description: "Redeemed " + r.reward_name,
            status: r.redemption_status,
            createdAt: isoOrNull(r.redeemed_at),
        };
    }

    function refresh() {
        if (!window.EcoApi) return Promise.resolve(null);

        var api = window.EcoApi;
        var jobs = [];

        jobs.push(
            api.get("/api/waste-collections?limit=300").then(function (res) {
                if (res && res.success && !res.offline) {
                    write(QUEUE_KEY, (res.collections || []).map(toQueueRow));
                }
                return res;
            })
        );

        

        var collectorId = api.collectorId();

        if (collectorId) {
            jobs.push(
                api
                    .get("/api/collector-qr-scans?limit=200")
                    .then(function (res) {
                        if (res && res.success && !res.offline) {
                            write(SCAN_LOG_KEY, (res.scans || []).map(toScanRow));
                        }
                        return res;
                    })
            );
        }

        var residentId = api.residentId();

        if (residentId) {
            jobs.push(
                api
                    .get("/api/residents/" + residentId + "/redemptions")
                    .then(function (res) {
                        if (res && res.success && !res.offline) {
                            write(
                                TRANSACTIONS_KEY,
                                (res.redemptions || []).map(toTransactionRow)
                            );
                        }
                        return res;
                    })
            );
        }

        // Collector groups and their street assignments. Read by Admin
        // Dashboard, Collector Dashboard, User Dashboard and the
        // collector schedule page.
        jobs.push(
            Promise.all([
                api.get("/api/collector-groups"),
                api.get("/api/streets"),
                api.get("/api/collectors")
            ]).then(function (all) {
                var groupsRes = all[0];
                var streetsRes = all[1];
                var collectorsRes = all[2];

                if (!groupsRes || !groupsRes.success || groupsRes.offline) return null;

                var streetMap = {};

                (streetsRes && streetsRes.streets ? streetsRes.streets : []).forEach(function (s) {
                    var n = String(s.group_number);
                    if (!streetMap[n]) streetMap[n] = [];
                    streetMap[n].push(s.street);
                });

                var groups = buildGroups(
                    groupsRes.groups,
                    streetMap,
                    collectorsRes && collectorsRes.collectors ? collectorsRes.collectors : []
                );

                write(GROUPS_KEY, groups);

                return groups;
            })
        );

        // Today's absences. The pages store them date-wrapped as
        // { "<YYYY-MM-DD>": { "<group>": { "<slot>": "<email>" } } },
          // so match that shape exactly. The date must be the LOCAL one:
          // toISOString() returns UTC, which in the Philippines is the
          // previous day between midnight and 8am, so the two keys would
          // disagree and every tick would look like it had come back.
          var now = new Date();
          var todayKey =
              now.getFullYear() +
              "-" + String(now.getMonth() + 1).padStart(2, "0") +
              "-" + String(now.getDate()).padStart(2, "0");

        jobs.push(
            api
                .get("/api/collector-absences?date=" + todayKey)
                .then(function (res) {
                    if (res && res.success && !res.offline) {
                        var wrapped = {};
                        wrapped[todayKey] = res.absences || {};
                        write(ABSENCES_KEY, wrapped);
                    }
                    return res;
                })
        );

        return Promise.all(jobs).catch(function () {
            return null;
        }).then(function (result) {
            // api-client.js fires "eco:hydrated" when its own requests
            // finish, which can be before these writes land. Pages that
            // read the mirrored keys need to know when the mirror is
            // actually up to date, so announce that separately.
            try {
                document.dispatchEvent(new CustomEvent("eco:bridge-synced"));
            } catch (e) {}

            return result;
        });
    }

    window.EcoLegacy = {
        refresh: refresh,

        // Re-read one key's worth of data after a write, so the page
        // shows the database's version rather than a local guess.
        refreshQueue: function () {
            return window.EcoApi.get("/api/waste-collections?limit=300").then(function (res) {
                if (res && res.success && !res.offline) {
                    write(QUEUE_KEY, (res.collections || []).map(toQueueRow));
                }
                return (res && res.collections) || [];
            });
        },

        refreshRequests: function () {
            return Promise.resolve(null);
        },
    };
})();
