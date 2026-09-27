/* ---------- user-module.js ----------
   Shared data layer used by every resident page.

   Data source
   -----------
   The source of truth is now the MySQL database via server.js. Each
   page calls `await window.EcoUser.hydrate()` once on load, which
   pulls the resident, their balance, points history and unlocked
   achievements and holds them in an in-memory cache.

   Why the cache
   -------------
   The public API of this file is synchronous by design -
   `getPoints()` returns a number immediately and is called from
   dozens of places, including places that cannot await (render
   callbacks, chart setup, string concatenation). Rather than
   rewrite every call site to be async, hydrate() fills a cache
   first and the synchronous getters read from that cache.

   Offline fallback
   ----------------
   If the server cannot be reached, hydrate() marks the module
   offline and everything falls back to the original localStorage
   records. The pages still render, just without live data. This
   keeps a demo alive even if the backend is not running.
*/

(function () {
    "use strict";

    var SESSION_KEY = "ecoUser";
    var USERS_KEY = "ecoUsers";
    var ID_SEQ_KEY = "ecoUserIdSeq";

    /* ---------- localStorage helpers (offline fallback) ---------- */

    function readSession() {
        try {
            var local = JSON.parse(localStorage.getItem(SESSION_KEY));
            if (local) return local;
        } catch (e) {}
        try {
            var session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
            if (session) return session;
        } catch (e) {}
        return null;
    }

    function readUsers() {
        try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; }
        catch (e) { return {}; }
    }

    function writeUsers(users) {
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    function currentUserKey(session) {
        return session && session.email ? session.email.toLowerCase() : null;
    }

    function nextUserId() {
        var seq = parseInt(localStorage.getItem(ID_SEQ_KEY), 10);
        if (isNaN(seq)) seq = 1000;
        seq += 1;
        localStorage.setItem(ID_SEQ_KEY, String(seq));
        return "ECO-" + seq;
    }

    /* ---------- remote cache ---------- */

    var remote = {
        hydrated: false,
        offline: false,
        resident: null,
        record: null,
        rewards: null
    };

    function api() {
        return window.EcoApi || null;
    }

    function hasApi() {
        var a = api();
        return !!(a && typeof a.get === "function");
    }

    /* ---------- record resolution ----------
       Prefers the hydrated database record, falls back to localStorage. */

    function getOrInitRecord() {
        if (remote.hydrated && remote.record) {
            return { key: currentUserKey(readSession()), users: null, record: remote.record };
        }

        var session = readSession();
        var key = currentUserKey(session);
        if (!key) return null;

        var users = readUsers();
        if (!users[key]) {
            users[key] = {
                fname: session.fname || "",
                lname: session.lname || "",
                email: session.email,
                phone: session.phone || "",
                houseNumber: session.houseNumber || "",
                street: session.street || ""
            };
        }

        var record = users[key];
        var changed = false;
        if (!record.userId) { record.userId = session.accountId || nextUserId(); changed = true; }
        if (!Array.isArray(record.history)) { record.history = []; changed = true; }
        if (typeof record.points !== "number") {
            record.points = 250;
            record.history.unshift({
                date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
                description: "Welcome Bonus",
                points: 250,
                type: "bonus"
            });
            record.welcomeBonusGiven = true;
            changed = true;
        }
        if (changed) writeUsers(users);

        return { key: key, users: users, record: record };
    }

    // Builds the same record shape the localStorage version produced, but
    // from the database, so every page keeps working unchanged.
    function buildRecordFromApi(resident, ecopoints) {
        var history = [];

        (ecopoints.history || []).forEach(function (h) {
            history.push({
                historyId: h.history_id,
                date: formatDate(h.created_at),
                createdAt: h.created_at,
                description: h.description,
                points: Number(h.points || 0),
                type: h.entry_type
            });
        });

        (ecopoints.redeemedEntries || []).forEach(function (r) {
            history.push({
                historyId: null,
                date: formatDate(r.created_at),
                createdAt: r.created_at,
                description: r.description,
                points: Number(r.points || 0),
                type: "redeem",
                redemptionId: r.history_id,
                redemptionStatus: r.redemption_status,
                claimedAt: r.claimed_at
            });
        });

        history.sort(function (a, b) {
            return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
        });

        return {
            userId: resident.account_id,
            residentId: resident.resident_id,
            accountId: resident.account_id,
            email: resident.email,
            fname: resident.first_name,
            lname: resident.last_name,
            fullName: ((resident.first_name || "") + " " + (resident.last_name || "")).trim(),
            phone: resident.phone,
            houseNumber: resident.house_number,
            street: resident.street,
            street_classification: resident.street_classification,
            qrCodeValue: resident.qr_code_value,
            points: Number(ecopoints.balance || 0),
            balance: Number(ecopoints.balance || 0),
            lifetimeEarned: Number(ecopoints.lifetimeEarned || 0),
            lifetimeRedeemed: Number(ecopoints.lifetimeRedeemed || 0),
            redemptionCount: Number(ecopoints.redemptionCount || 0),
            history: history,
            unlockedAchievements: (remote.achievements || []).map(function (a) { return a.key; })
        };
    }

    function formatDate(value) {
        if (!value) return "";
        var d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    }

    /* ---------- public synchronous getters ---------- */

    window.getUserId = function () {
        var ctx = getOrInitRecord();
        return ctx ? ctx.record.userId : "ECO-GUEST";
    };

    window.getUserName = function () {
        var ctx = getOrInitRecord();
        if (ctx && ctx.record.fullName) return ctx.record.fullName;
        if (ctx && (ctx.record.fname || ctx.record.lname)) {
            return ((ctx.record.fname || "") + " " + (ctx.record.lname || "")).trim();
        }
        var session = readSession();
        if (session && (session.fname || session.lname)) {
            return ((session.fname || "") + " " + (session.lname || "")).trim();
        }
        return "Resident";
    };

    window.getPoints = function () {
        var ctx = getOrInitRecord();
        return ctx ? Number(ctx.record.points || 0) : 0;
    };

    window.getHistory = function () {
        var ctx = getOrInitRecord();
        return ctx ? ctx.record.history.slice() : [];
    };

    /* ---------- achievements ---------- */

    window.hasAchievement = function (id) {
        var ctx = getOrInitRecord();
        if (!ctx) return false;
        if (!Array.isArray(ctx.record.unlockedAchievements)) return false;
        return ctx.record.unlockedAchievements.indexOf(id) !== -1;
    };

    // Idempotent: the server enforces one payout per resident per badge,
    // so calling this on every page load is safe.
    window.awardAchievement = function (id, label, points) {
        var ctx = getOrInitRecord();
        if (!ctx || !id) return Promise.resolve(false);

        if (window.hasAchievement(id)) {
            return Promise.resolve(false);
        }

        if (remote.hydrated && !remote.offline && hasApi()) {
            var residentId = ctx.record.residentId;
            if (!residentId) return Promise.resolve(false);

            return window.EcoApi
                .post("/api/residents/" + residentId + "/achievements", {
                    achievement_key: id,
                    label: label || id,
                    points: Number(points || 0)
                })
                .then(function (res) {
                    if (!res || !res.success || !res.awarded) return false;

                    // Reflect the new state locally so the rest of this
                    // page sees it without re-fetching.
                    if (!Array.isArray(ctx.record.unlockedAchievements)) {
                        ctx.record.unlockedAchievements = [];
                    }
                    ctx.record.unlockedAchievements.push(id);
                    ctx.record.history.unshift({
                        date: formatDate(new Date()),
                        createdAt: new Date().toISOString(),
                        description: "Achievement Unlocked: " + label,
                        points: Number(points || 0),
                        type: "achievement",
                        achievementId: id
                    });
                    if (typeof res.newBalance === "number") {
                        ctx.record.points = res.newBalance;
                    } else {
                        ctx.record.points = Number(ctx.record.points || 0) + Number(points || 0);
                    }
                    return true;
                });
        }

        // Offline fallback: the original localStorage behaviour.
        if (!Array.isArray(ctx.record.unlockedAchievements)) {
            ctx.record.unlockedAchievements = [];
        }
        ctx.record.unlockedAchievements.push(id);
        ctx.record.history.unshift({
            date: formatDate(new Date()),
            description: "Achievement Unlocked: " + label,
            points: points || 0,
            type: "achievement",
            achievementId: id
        });
        ctx.record.points += (points || 0);
        if (ctx.users) {
            ctx.users[ctx.key] = ctx.record;
            writeUsers(ctx.users);
        }
        return Promise.resolve(true);
    };

    /* ---------- points history ---------- */

    window.addHistoryEntry = function (entry) {
        var ctx = getOrInitRecord();
        if (!ctx) return false;

        ctx.record.history.unshift(entry);
        ctx.record.points = Number(ctx.record.points || 0) + Number(entry.points || 0);

        if (ctx.users) {
            ctx.users[ctx.key] = ctx.record;
            writeUsers(ctx.users);
        }
        return true;
    };

    /* ---------- reward catalog ----------
       Kept as a local default so pages render instantly, then replaced
       with the database rows during hydrate(). */

    window.REWARD_CATALOG = [
        { id: "rice5",     name: "5kg Rice Pack",        icon: "fa-bowl-rice",       cost: 1200, phpValue: 250 },
        { id: "grocery",   name: "Grocery Pack",         icon: "fa-basket-shopping", cost: 3000, phpValue: 500 },
        { id: "ecobag",    name: "Eco Bag",              icon: "fa-bag-shopping",    cost: 600,  phpValue: 100 },
        { id: "loadcard",  name: "Mobile Load (\u20B150)", icon: "fa-mobile-screen",   cost: 800,  phpValue: 50 },
        { id: "canned",    name: "Canned Goods Pack",    icon: "fa-box",             cost: 900,  phpValue: 150 },
        { id: "detergent", name: "Laundry Detergent",    icon: "fa-soap",            cost: 700,  phpValue: 120 }
    ];

    // phpValue is not always stored per row, so fall back to the default
    // catalog when the server omits it.
    function mergeRewardDefaults(fromApi) {
        return fromApi.map(function (r) {
            var fallback = window.REWARD_CATALOG.find(function (d) { return d.id === r.id; });
            return Object.assign({}, fallback || {}, r, {
                id: r.id,
                cost: Number(r.cost || (fallback && fallback.cost) || 0),
                phpValue: Number(r.phpValue || (fallback && fallback.phpValue) || 0)
            });
        });
    }

    /* ---------- redeem a reward ---------- */

    window.redeemReward = function (id) {
        var reward = window.REWARD_CATALOG.find(function (r) { return r.id === id; });
        if (!reward) return Promise.resolve({ success: false, message: "Reward not found." });

        var ctx = getOrInitRecord();
        if (!ctx) {
            return Promise.resolve({ success: false, message: "Please log in to redeem rewards." });
        }

        if (Number(ctx.record.points || 0) < reward.cost) {
            return Promise.resolve({
                success: false,
                message: "You need " + (reward.cost - Number(ctx.record.points || 0)) + " more points to redeem this."
            });
        }

        if (remote.hydrated && !remote.offline && hasApi() && ctx.record.residentId) {
            return window.EcoApi
                .post("/api/residents/" + ctx.record.residentId + "/redeem", { reward_id: id })
                .then(function (res) {
                    if (!res || !res.success) {
                        return { success: false, message: (res && res.error) || "Could not process your redemption." };
                    }

                    var previousBalance = Number(ctx.record.points || 0);

                    if (typeof res.balance === "number") {
                        ctx.record.points = res.balance;
                    } else {
                        ctx.record.points = previousBalance - reward.cost;
                    }

                    ctx.record.history.unshift({
                        date: formatDate(new Date()),
                        createdAt: new Date().toISOString(),
                        description: "Redeemed " + reward.name,
                        points: -reward.cost,
                        type: "redeem",
                        previousBalance: previousBalance,
                        remainingBalance: ctx.record.points
                    });

                    return {
                        success: true,
                        message: res.message || ("You redeemed " + reward.name + "! Coordinate pickup with your barangay office."),
                        balance: ctx.record.points
                    };
                });
        }

        // Offline fallback
        window.addHistoryEntry({
            date: formatDate(new Date()),
            createdAt: new Date().toISOString(),
            description: "Redeemed " + reward.name,
            points: -reward.cost,
            type: "redeem"
        });

        return Promise.resolve({
            success: true,
            message: "You redeemed " + reward.name + "! Coordinate pickup with your barangay office.",
            balance: ctx.record.points
        });
    };

    /* ---------- notifications ---------- */

    window.getUnreadNotifCount = function () {
        return window.EcoNotifs ? window.EcoNotifs.unreadCount() : 0;
    };

    /* ---------- hydration ---------- */

    // Pulls everything the synchronous getters need. Safe to call more
    // than once; concurrent calls share one in-flight request.
    var inflight = null;

    window.EcoUser = {
        hydrate: function () {
            if (inflight) return inflight;

            if (!hasApi()) {
                remote.offline = true;
                return Promise.resolve({ success: false, offline: true });
            }

            var residentId = window.EcoApi.residentId();

            if (!residentId) {
                // Guest, or a session created before the database link
                // existed. Nothing to hydrate; localStorage still works.
                remote.offline = true;
                return Promise.resolve({ success: false, error: "No resident session." });
            }

            inflight = Promise.all([
                window.EcoApi.get("/api/residents/" + residentId),
                window.EcoApi.get("/api/residents/" + residentId + "/ecopoints"),
                window.EcoApi.get("/api/residents/" + residentId + "/achievements"),
                window.EcoApi.get("/api/rewards")
            ])
                .then(function (results) {
                    inflight = null;

                    var residentRes = results[0];
                    var pointsRes = results[1];
                    var achRes = results[2];
                    var rewardsRes = results[3];

                    if (!residentRes || !residentRes.success || residentRes.offline) {
                        remote.offline = true;
                        return { success: false, offline: !!residentRes.offline };
                    }

                    remote.resident = residentRes.resident;
                    remote.achievements = (achRes && achRes.achievements) || [];
                    remote.record = buildRecordFromApi(residentRes.resident, pointsRes || {});

                    if (rewardsRes && rewardsRes.success && rewardsRes.rewards) {
                        window.REWARD_CATALOG = mergeRewardDefaults(rewardsRes.rewards);
                        remote.rewards = window.REWARD_CATALOG;
                    }

                    remote.hydrated = true;
                    remote.offline = false;

                    // Keep the session's cached points in step so any
                    // other module reading it sees fresh numbers.
                    var session = readSession();
                    if (session) {
                        session.points = remote.record.points;
                        try {
                            if (localStorage.getItem(SESSION_KEY)) {
                                localStorage.setItem(SESSION_KEY, JSON.stringify(session));
                            } else {
                                sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
                            }
                        } catch (e) {}
                    }

                    return { success: true, resident: remote.record };
                })
                .catch(function () {
                    inflight = null;
                    remote.offline = true;
                    return { success: false, offline: true };
                });

            return inflight;
        },

        // Exposed for pages that need the raw hydrated data.
        state: function () {
            return remote;
        },

        resident: function () {
            return remote.resident;
        },

        record: function () {
            return getOrInitRecord() ? getOrInitRecord().record : null;
        },

        achievements: function () {
            return remote.achievements || [];
        },

        isOffline: function () {
            return remote.offline;
        },

        // Lets a page force a refresh after an action that changed points.
        refresh: function () {
            remote.hydrated = false;
            return window.EcoUser.hydrate();
        }
    };

    /* ---------- sitewide stats (homepage) ---------- */

    window.getSiteStats = function () {
        if (hasApi()) {
            return window.EcoApi.get("/api/site-stats").then(function (res) {
                if (res && res.success && res.stats) {
                    return {
                        households: res.stats.households,
                        tonsThisMonth: res.stats.tonsThisMonth,
                        kgThisMonth: res.stats.kgThisMonth,
                        phpDistributed: res.stats.phpDistributed
                    };
                }
                return window.getSiteStatsLocal();
            });
        }
        return Promise.resolve(window.getSiteStatsLocal());
    };

    // Original localStorage calculation, kept as the offline path.
    window.getSiteStatsLocal = function () {
        var users = readUsers();
        var now = new Date();

        var householdCount = 0;
        var kgThisMonth = 0;
        var phpDistributed = 0;

        Object.keys(users).forEach(function (k) {
            var user = users[k];
            if (!user || user.role !== "resident") return;

            householdCount++;

            var history = Array.isArray(user.history) ? user.history : [];

            history.forEach(function (entry) {
                if (!entry) return;

                var entryDate = new Date(entry.date);
                var sameMonth =
                    !isNaN(entryDate.getTime()) &&
                    entryDate.getFullYear() === now.getFullYear() &&
                    entryDate.getMonth() === now.getMonth();

                if (sameMonth && entry.points > 0) {
                    var match = String(entry.description || "").match(/\(([\d.]+)\s*kg\)/i);
                    if (match) kgThisMonth += parseFloat(match[1]);
                }

                if (entry.type === "redeem" || entry.points < 0) {
                    var reward = window.REWARD_CATALOG.find(function (r) {
                        return entry.description === ("Redeemed " + r.name);
                    });
                    if (reward && reward.phpValue) phpDistributed += reward.phpValue;
                }
            });
        });

        return {
            households: householdCount,
            tonsThisMonth: kgThisMonth / 1000,
            kgThisMonth: kgThisMonth,
            phpDistributed: phpDistributed
        };
    };

})();
