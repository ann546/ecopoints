/* ---------- User Dashboard JS ----------

   Renders the resident dashboard using the real logged-in account's
   data from MySQL and existing local data where applicable.

   MySQL is now used for:
   - Resident name
   - Resident account information
   - EcoPoints balance
   - Registered street

   Existing localStorage systems are still used for:
   - Waste history
   - Waste queue/submissions
   - Notifications
   - Collector group schedule settings
   - Achievements
   - Rewards catalog

   --------------------------------------------------------------- */


/* ---------- MySQL Resident Data ---------- */

let DASH_RESIDENT = null;


/* ---------- Dashboard Session ---------- */

function getDashboardSession() {

    try {
        return EcoSession() || null;

    } catch (error) {

        console.error("Could not read ecoUser:", error);

        return null;
    }
}


/* ---------- Load Resident From MySQL ---------- */

async function loadDashboardResident() {

    const session = getDashboardSession();

    if (!session || !session.residentId) {

        console.warn("No resident ID found in dashboard session.");

        return null;
    }

    try {

        const response = await fetch(
            `/api/residents/${encodeURIComponent(session.residentId)}`
        );

        const data = await response.json();

        if (!response.ok || !data.success) {

            throw new Error(
                data.error || "Failed to load resident data."
            );
        }

        DASH_RESIDENT = data.resident;

        console.log(
            "Dashboard resident loaded:",
            DASH_RESIDENT
        );

        return DASH_RESIDENT;

    } catch (error) {

        console.error(
            "Dashboard MySQL error:",
            error
        );

        return null;
    }
}


/* ---------- Topbar Identity ---------- */

function syncDashboardIdentity() {

    const avatarEl =
        document.querySelector(".profile-btn .avatar");

    const nameEl =
        document.querySelector(".profile-name");

    const welcomeEl =
        document.getElementById("welcomeHeading");

    if (!avatarEl || !nameEl) return;


    /* ---------- Use MySQL resident data first ---------- */

    if (DASH_RESIDENT) {

        const firstName =
            DASH_RESIDENT.first_name || "";

        const lastName =
            DASH_RESIDENT.last_name || "";

        avatarEl.textContent =
            (
                firstName.charAt(0) +
                lastName.charAt(0)
            ).toUpperCase();

        nameEl.textContent =
            `${firstName} ${lastName}`.trim();

        if (welcomeEl) {

            welcomeEl.textContent =
                `Welcome back, ${firstName || "Resident"}`;
        }

        return;
    }


    /* ---------- Fallback to existing localStorage session ---------- */

    let session = null;

    try {

        session =
            EcoSession();

    } catch {}


    if (
        session &&
        session.fname &&
        session.lname
    ) {

        avatarEl.textContent =
            (
                session.fname[0] +
                session.lname[0]
            ).toUpperCase();

        nameEl.textContent =
            `${session.fname} ${session.lname}`;

        if (welcomeEl) {

            welcomeEl.textContent =
                `Welcome back, ${session.fname}`;
        }

    } else if (
        typeof getUserName === "function"
    ) {

        const demoName =
            getUserName();

        const parts =
            demoName.trim().split(" ");

        avatarEl.textContent =
            (
                (parts[0] || "")[0] +
                (parts[parts.length - 1] || "")[0]
            ).toUpperCase();

        nameEl.textContent =
            demoName;

        if (welcomeEl) {

            welcomeEl.textContent =
                `Welcome back, ${parts[0] || demoName}`;
        }
    }
}


/* ---------- Sidebar Toggle ---------- */

const sidebar =
    document.getElementById("sidebar");

const sidebarOverlay =
    document.getElementById("sidebarOverlay");

const menuToggle =
    document.getElementById("menuToggle");


function openSidebar() {

    if (sidebar) {
        sidebar.classList.add("show");
    }

    if (sidebarOverlay) {
        sidebarOverlay.classList.add("show");
    }
}


function closeSidebar() {

    if (sidebar) {
        sidebar.classList.remove("show");
    }

    if (sidebarOverlay) {
        sidebarOverlay.classList.remove("show");
    }
}


if (menuToggle) {

    menuToggle.addEventListener(
        "click",
        openSidebar
    );
}


if (sidebarOverlay) {

    sidebarOverlay.addEventListener(
        "click",
        closeSidebar
    );
}


document.querySelectorAll(".nav-item").forEach(item => {

    item.addEventListener(
        "click",
        closeSidebar
    );

});


/* ---------- Profile Dropdown ---------- */

const profileBtn =
    document.getElementById("profileBtn");

const profileDropdown =
    document.getElementById("profileDropdown");


if (
    profileBtn &&
    profileDropdown
) {

    profileBtn.addEventListener(
        "click",
        (e) => {

            e.stopPropagation();

            profileDropdown.classList.toggle(
                "show"
            );
        }
    );


    document.addEventListener(
        "click",
        (e) => {

            if (
                !profileDropdown.contains(e.target) &&
                e.target !== profileBtn
            ) {

                profileDropdown.classList.remove(
                    "show"
                );
            }
        }
    );
}


/* ---------- Logout ---------- */

document
    .querySelectorAll(
        'a[href="Registration.html"]'
    )
    .forEach(link => {

        const isLogout =
            link.classList.contains("logout") ||
            link.textContent.trim() === "Logout";


        if (isLogout) {

            link.addEventListener(
                "click",
                (event) => {

                    if (
                        !confirm(
                            "Are you sure you want to log out?"
                        )
                    ) {

                        event.preventDefault();

                        return;
                    }


                    try {

                        localStorage.removeItem(
                            "ecoUser"
                        );

                    } catch {}


                    try {

                        sessionStorage.removeItem(
                            "ecoUser"
                        );

                    } catch {}
                }
            );
        }
    });


/* ---------- Shared Data Helpers ---------- */

const DASH_MATERIALS = {

    Plastic: {
        icon: "fa-bottle-water",
        keywords: ["plastic"]
    },

    Paper: {
        icon: "fa-file-lines",
        keywords: ["paper", "cardboard"]
    },

    Metal: {
        icon: "fa-recycle",
        keywords: ["metal", "cans"]
    },

    Glass: {
        icon: "fa-wine-bottle",
        keywords: ["glass"]
    },

    "E-Waste": {
        icon: "fa-plug",
        keywords: [
            "e-waste",
            "electronic",
            "gadget"
        ]
    },

    Mixed: {
        icon: "fa-boxes-stacked",
        keywords: ["mixed"]
    }
};


const DASH_QUEUE_KEY =
    "ecoWasteQueue";


const DASH_LEGACY_DEMO_IDS = [
    "SUB-1001",
    "SUB-1002",
    "SUB-1003",
    "SUB-1004"
];


function isSameMonth(
    dateStr,
    ref
) {

    const d =
        new Date(dateStr);

    return (
        d.getFullYear() ===
            ref.getFullYear() &&
        d.getMonth() ===
            ref.getMonth()
    );
}


function totalKgFromHistory(history) {

    let total = 0;

    history.forEach(h => {

        const description =
            String(
                h.description || ""
            );

        const match =
            description.match(
                /([\d.]+)\s*kg/i
            );

        if (match) {

            total +=
                parseFloat(match[1]);
        }
    });

    return total;
}


/* ---------- Stat Cards ---------- */

function renderStats() {

    const history =
        getHistory();

    const now =
        new Date();


    /* ---------- MySQL EcoPoints ---------- */

    const balance =
        DASH_RESIDENT
            ? Number(
                DASH_RESIDENT.ecopoints_balance || 0
            )
            : getPoints();


    const earnedThisMonth =
        history
            .filter(
                h =>
                    h.points > 0 &&
                    isSameMonth(
                        h.date,
                        now
                    )
            )
            .reduce(
                (sum, h) =>
                    sum + h.points,
                0
            );


    const totalKg =
        totalKgFromHistory(
            history
        );


    const kgThisMonth =
        totalKgFromHistory(
            history.filter(
                h =>
                    isSameMonth(
                        h.date,
                        now
                    )
            )
        );


    const statPoints =
        document.getElementById(
            "statPoints"
        );

    const statPointsTrend =
        document.getElementById(
            "statPointsTrend"
        );

    const statWaste =
        document.getElementById(
            "statWaste"
        );

    const statWasteTrend =
        document.getElementById(
            "statWasteTrend"
        );

    const statRewardsAvailable =
        document.getElementById(
            "statRewardsAvailable"
        );

    const statRank =
        document.getElementById(
            "statRank"
        );


    if (statPoints) {

        statPoints.textContent =
            balance.toLocaleString();
    }


    if (statPointsTrend) {

        statPointsTrend.innerHTML =
            `<i class="fa-solid fa-arrow-trend-up"></i> +${earnedThisMonth.toLocaleString()} this month`;
    }


    if (statWaste) {

        statWaste.textContent =
            totalKg.toFixed(1) +
            " kg";
    }


    if (statWasteTrend) {

        statWasteTrend.innerHTML =
            `<i class="fa-solid fa-arrow-trend-up"></i> +${kgThisMonth.toFixed(1)} kg this month`;
    }


    if (statRewardsAvailable) {

        const affordable =
            REWARD_CATALOG.filter(
                r =>
                    balance >= r.cost
            ).length;

        statRewardsAvailable.textContent =
            affordable;
    }


    if (statRank) {

        const otherResidentPoints = [
            3120,
            2960,
            2810,
            2705,
            2640,
            2555,
            2390,
            2270,
            2145
        ];

        const combined =
            [
                ...otherResidentPoints,
                balance
            ]
                .sort(
                    (a, b) => b - a
                );


        statRank.textContent =
            "#" +
            (
                combined.indexOf(
                    balance
                ) + 1
            );
    }
}


/* ---------- Charts ---------- */

function renderCharts() {

    const history =
        getHistory();

    const now =
        new Date();

    const months = [];


    for (
        let i = 5;
        i >= 0;
        i--
    ) {

        const d =
            new Date(
                now.getFullYear(),
                now.getMonth() - i,
                1
            );


        months.push({

            label:
                d.toLocaleString(
                    "en-US",
                    {
                        month: "short"
                    }
                ),

            year:
                d.getFullYear(),

            month:
                d.getMonth()
        });
    }


    const monthlyData =
        months.map(m =>

            history

                .filter(
                    h =>
                        h.points > 0
                )

                .filter(h => {

                    const d =
                        new Date(h.date);

                    return (
                        d.getFullYear() ===
                            m.year &&
                        d.getMonth() ===
                            m.month
                    );
                })

                .reduce(
                    (sum, h) =>
                        sum + h.points,
                    0
                )
        );


    if (typeof Chart === "undefined") {

        console.warn(
            "Chart.js is not available."
        );

        return;
    }


    Chart.defaults.font.family =
        "'Manrope', sans-serif";

    Chart.defaults.color =
        "#7A7A7A";


    const pointsCtx =
        document.getElementById(
            "pointsChart"
        );


    if (pointsCtx) {

        new Chart(
            pointsCtx,
            {

                type: "bar",

                data: {

                    labels:
                        months.map(
                            m => m.label
                        ),

                    datasets: [{

                        label:
                            "EcoPoints Earned",

                        data:
                            monthlyData,

                        backgroundColor:
                            "#A1CB35",

                        hoverBackgroundColor:
                            "#769826",

                        borderRadius:
                            8,

                        maxBarThickness:
                            36
                    }]
                },


                options: {

                    responsive:
                        true,

                    plugins: {

                        legend: {
                            display:
                                false
                        }
                    },


                    scales: {

                        x: {

                            grid: {
                                display:
                                    false
                            }
                        },

                        y: {

                            grid: {
                                color:
                                    "#EFEFEF"
                            },

                            beginAtZero:
                                true
                        }
                    }
                }
            }
        );
    }


    const materialTotals = {};


    Object.keys(
        DASH_MATERIALS
    ).forEach(
        name =>
            materialTotals[name] = 0
    );


    history.forEach(h => {

        const description =
            String(
                h.description || ""
            );


        const match =
            description.match(
                /([\d.]+)\s*kg/i
            );


        if (!match) return;


        const desc =
            description.toLowerCase();


        const found =
            Object.entries(
                DASH_MATERIALS
            ).find(
                ([, m]) =>
                    m.keywords.some(
                        k =>
                            desc.includes(k)
                    )
            );


        if (found) {

            materialTotals[
                found[0]
            ] +=
                parseFloat(
                    match[1]
                );
        }
    });


    const wasteCtx =
        document.getElementById(
            "wasteChart"
        );


    if (wasteCtx) {

        const entries =
            Object.entries(
                materialTotals
            )
            .filter(
                ([, kg]) =>
                    kg > 0
            );


        const palette = [
            "#769826",
            "#A1CB35",
            "#FF9D4D",
            "#2E3F16",
            "#C9C9C9",
            "#56701B"
        ];


        new Chart(
            wasteCtx,
            {

                type:
                    "doughnut",

                data: {

                    labels:
                        entries.length
                            ? entries.map(
                                ([name]) =>
                                    name
                            )
                            : [
                                "No submissions yet"
                            ],

                    datasets: [{

                        data:
                            entries.length
                                ? entries.map(
                                    ([, kg]) =>
                                        kg
                                )
                                : [1],

                        backgroundColor:
                            entries.length
                                ? palette.slice(
                                    0,
                                    entries.length
                                )
                                : ["#EAEAEA"],

                        borderWidth:
                            0
                    }]
                },


                options: {

                    responsive:
                        true,

                    cutout:
                        "62%",

                    plugins: {

                        legend: {

                            position:
                                "bottom",

                            labels: {

                                boxWidth:
                                    10,

                                padding:
                                    16
                            }
                        }
                    }
                }
            }
        );
    }
}


/* ---------- Recent Scanned Waste Submissions ---------- */

function dashEsc(value) {

    return String(
        value == null
            ? ""
            : value
    )

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        )

        .replace(
            /'/g,
            "&#039;"
        );
}


function dashSubmissionStatus(record) {

    const status =
        String(
            record.status || ""
        ).toLowerCase();


    const verification =
        String(
            record.verificationStatus || ""
        ).toLowerCase();


    if (
        status === "rejected" ||
        verification === "rejected"
    ) {

        return "rejected";
    }


    if (
        [
            "verified",
            "points-issued",
            "completed"
        ].includes(status) ||
        record.verifiedAt
    ) {

        return "verified";
    }


    return "pending";
}


function dashFormatWhen(value) {

    const when =
        new Date(value);


    if (
        !value ||
        Number.isNaN(
            when.getTime()
        )
    ) {

        return {
            text: "",
            time: 0
        };
    }


    return {

        text:
            when.toLocaleString(
                "en-US",
                {
                    month:
                        "short",

                    day:
                        "numeric",

                    year:
                        "numeric",

                    hour:
                        "numeric",

                    minute:
                        "2-digit"
                }
            ),

        time:
            when.getTime()
    };
}


function loadScannedSubmissions() {

    let queue = [];


    try {

        queue =
            JSON.parse(
                localStorage.getItem(
                    DASH_QUEUE_KEY
                )
            ) || [];

    } catch {

        queue = [];
    }


    if (
        !Array.isArray(queue)
    ) {

        return [];
    }


    const myId =
        String(
            getUserId()
        ).toUpperCase();


    return queue

        .filter(
            r =>
                r &&
                r.id &&
                !DASH_LEGACY_DEMO_IDS.includes(
                    String(r.id)
                        .trim()
                        .toUpperCase()
                ) &&
                String(
                    r.residentId || ""
                )
                    .trim()
                    .toUpperCase() ===
                    myId
        )

        .map(r => {

            const state =
                dashSubmissionStatus(r);


            const activityAt =
                state === "pending"

                    ? r.submittedAt ||
                      r.createdAt

                    : r.completedAt ||
                      r.verifiedAt ||
                      r.updatedAt ||
                      r.submittedAt;


            const when =
                dashFormatWhen(
                    activityAt
                );


            const kg =
                Number(
                    r.verifiedWeightKg ??
                    r.verifiedWeight ??
                    r.weightKg ??
                    r.weight
                );


            const points =
                Number(
                    r.pointsIssued ??
                    r.computedPoints ??
                    0
                ) || 0;


            const collector =
                String(
                    r.collectorName ||
                    r.verifiedByName ||
                    ""
                ).trim();


            return {

                state,

                type:
                    r.wasteType ||
                    "Waste",

                weight:
                    Number.isFinite(kg) &&
                    kg > 0

                        ? kg.toLocaleString(
                            undefined,
                            {
                                maximumFractionDigits:
                                    2
                            }
                        )

                        : "",

                when:
                    when.text,

                sortTime:
                    when.time,

                points,

                collector:
                    collector &&
                    collector !==
                        "Not recorded"

                        ? collector

                        : "",

                reason:
                    state === "rejected"

                        ? String(
                            r.rejectionReason ||
                            ""
                        ).trim()

                        : ""
            };
        })

        .sort(
            (a, b) =>
                b.sortTime -
                a.sortTime
        );
}


function renderRecentSubmissions() {

    const list =
        document.getElementById(
            "dashboardSubmissionList"
        );


    if (!list) return;


    const items =
        loadScannedSubmissions()
            .slice(0, 5);


    if (
        items.length === 0
    ) {

        list.innerHTML =
            `<div class="empty-note">
                No waste submitted yet. Once a collector scans your
                <a href="My QR Code.html"
                   style="color:var(--primary-green); font-weight:700;">
                   QR code
                </a>,
                your waste shows up here.
            </div>`;

        return;
    }


    const LABELS = {

        verified: {

            badge:
                "badge-verified",

            text:
                "Verified",

            when:
                "Verified"
        },

        pending: {

            badge:
                "badge-pending",

            text:
                "Pending",

            when:
                "Submitted"
        },

        rejected: {

            badge:
                "badge-rejected",

            text:
                "Rejected",

            when:
                "Rejected"
        }
    };


    list.innerHTML =
        items.map(
            item => {

                const label =
                    LABELS[item.state];


                const meta = [

                    item.when
                        ? `${label.when} ${item.when}`
                        : label.when,

                    item.state === "verified" &&
                    item.collector

                        ? "by " +
                          item.collector

                        : "",

                    item.state === "pending"

                        ? "waiting for the collector's scan"

                        : "",

                    item.reason

                        ? "reason: " +
                          item.reason

                        : ""

                ]

                .filter(Boolean)

                .map(dashEsc)

                .join(
                    " &middot; "
                );


                let pointsHtml;


                if (
                    item.state ===
                        "verified" &&
                    item.points > 0
                ) {

                    pointsHtml =
                        `<span class="submission-points">
                            +${item.points.toLocaleString()} pts
                        </span>`;

                } else if (
                    item.state ===
                        "verified"
                ) {

                    pointsHtml =
                        `<span class="submission-points muted">
                            Points pending
                        </span>`;

                } else if (
                    item.state ===
                        "rejected"
                ) {

                    pointsHtml =
                        `<span class="submission-points muted">
                            No points
                        </span>`;

                } else {

                    pointsHtml =
                        `<span class="submission-points muted">
                            Awaiting scan
                        </span>`;
                }


                return `

                    <div class="submission-row">

                        <div class="submission-icon">
                            <i class="fa-solid ${
                                (
                                    DASH_MATERIALS[
                                        item.type
                                    ] || {}
                                ).icon ||
                                "fa-recycle"
                            }"></i>
                        </div>


                        <div class="submission-info">

                            <span class="submission-title">
                                ${dashEsc(item.type)}
                                ${
                                    item.weight
                                        ? ` (${dashEsc(item.weight)} kg)`
                                        : ""
                                }
                            </span>

                            <span class="submission-meta">
                                ${meta}
                            </span>

                        </div>


                        <span class="badge ${label.badge}">
                            ${label.text}
                        </span>


                        ${pointsHtml}

                    </div>

                `;
            }
        ).join("");
}


/* ---------- Recommended Rewards ---------- */

function renderRecommendedRewards() {

    const list =
        document.getElementById(
            "dashboardRewardList"
        );


    if (!list) return;


    /* ---------- Use MySQL EcoPoints ---------- */

    const balance =
        DASH_RESIDENT
            ? Number(
                DASH_RESIDENT.ecopoints_balance || 0
            )
            : getPoints();


    list.innerHTML =
        REWARD_CATALOG.map(
            reward => {

                const canAfford =
                    balance >=
                    reward.cost;


                const pct =
                    Math.min(
                        100,
                        Math.round(
                            (
                                balance /
                                reward.cost
                            ) * 100
                        )
                    );


                return `

                    <div class="reward-row">

                        <div class="reward-icon">
                            <i class="fa-solid ${reward.icon}"></i>
                        </div>


                        <div class="reward-info">

                            <span class="reward-title">
                                ${reward.name}
                            </span>


                            <div class="progress-track">

                                <div
                                    class="progress-fill"
                                    style="width:${pct}%">
                                </div>

                            </div>


                            <span class="reward-meta">

                                ${reward.cost.toLocaleString()}
                                pts

                                ${
                                    canAfford
                                        ? "&middot; You have enough"
                                        : "&middot; " +
                                          (
                                              reward.cost -
                                              balance
                                          ).toLocaleString() +
                                          " to go"
                                }

                            </span>

                        </div>


                        <button
                            class="btn-small ${
                                canAfford
                                    ? ""
                                    : "ghost"
                            }"
                            data-id="${reward.id}"
                            ${
                                canAfford
                                    ? ""
                                    : "disabled"
                            }>

                            ${
                                canAfford
                                    ? "Redeem"
                                    : (
                                        reward.cost -
                                        balance
                                    ).toLocaleString() +
                                      " to go"
                            }

                        </button>

                    </div>

                `;
            }
        ).join("");


    list
        .querySelectorAll(
            "button[data-id]"
        )
        .forEach(btn => {

            btn.addEventListener(
                "click",
                () => {

                    if (
                        btn.disabled
                    ) return;


                    redeemReward(
                        btn.dataset.id
                    );


                    renderDashboardData();


                    if (
                        window.EcoNotifs
                    ) {

                        EcoNotifs.refresh();
                    }
                }
            );
        });
}


/* ---------- Render Dashboard Data ---------- */

function renderDashboardData() {

    renderStats();

    renderRecentSubmissions();

    renderRecommendedRewards();
}


/* Stats fall back to getPoints() until the resident row arrives, so the
   balance has to be redrawn once the shared hydration has finished. */
document.addEventListener("eco:hydrated", () => {

    const session = getDashboardSession();

    if (session) renderDashboardData();
});


/* ---------- Achievements Preview ---------- */

function longestConsecutiveWeeks(history) {

    const weekKeys =
        new Set();


    history
        .filter(
            h =>
                h.type === "scan"
        )
        .forEach(h => {

            const d =
                new Date(h.date);


            const firstJan =
                new Date(
                    d.getFullYear(),
                    0,
                    1
                );


            const week =
                Math.ceil(
                    (
                        (
                            (
                                d -
                                firstJan
                            ) /
                            86400000
                        ) +
                        firstJan.getDay() +
                        1
                    ) / 7
                );


            weekKeys.add(
                d.getFullYear() *
                    100 +
                    week
            );
        });


    const sorted =
        [...weekKeys].sort(
            (a, b) => a - b
        );


    let longest =
        sorted.length
            ? 1
            : 0;


    let current = 1;


    for (
        let i = 1;
        i < sorted.length;
        i++
    ) {

        current =
            (
                sorted[i] -
                sorted[i - 1] ===
                1
            )
                ? current + 1
                : 1;


        longest =
            Math.max(
                longest,
                current
            );
    }


    return longest;
}


function myLeaderboardRank() {

    const otherResidentPoints = [
        3120,
        2960,
        2810,
        2705,
        2640,
        2555,
        2390,
        2270,
        2145
    ];


    const totalEarned =
        getHistory()
            .filter(
                h =>
                    h.points > 0
            )
            .reduce(
                (s, h) =>
                    s + h.points,
                0
            );


    const combined =
        [
            ...otherResidentPoints,
            totalEarned
        ]
        .sort(
            (a, b) =>
                b - a
        );


    return (
        combined.indexOf(
            totalEarned
        ) + 1
    );
}


function renderAchievementsPreview() {

    const grid =
        document.getElementById(
            "dashAchievementGrid"
        );


    const tag =
        document.getElementById(
            "dashAchievementTag"
        );


    if (!grid || !tag) return;


    const history =
        getHistory();


    const scanCount =
        history.filter(
            h =>
                h.type === "scan"
        ).length;


    const totalKg =
        totalKgFromHistory(
            history
        );


    const totalEarned =
        history
            .filter(
                h =>
                    h.points > 0
            )
            .reduce(
                (s, h) =>
                    s + h.points,
                0
            );


    const streak =
        longestConsecutiveWeeks(
            history
        );


    const rank =
        myLeaderboardRank();


    const badges = [

        {
            icon:
                "fa-seedling",

            label:
                "Reward Hunter",

            unlocked:
                scanCount >= 1
        },


        {
            icon:
                "fa-recycle",

            label:
                "10 Submissions",

            unlocked:
                scanCount >= 10
        },


        {
            icon:
                "fa-fire",

            label:
                "4-Week Streak",

            unlocked:
                streak >= 4
        },


        {
            icon:
                "fa-weight-hanging",

            label:
                "50 kg Recycled",

            unlocked:
                totalKg >= 50
        },


        {
            icon:
                "fa-medal",

            label:
                "Top 5 Rank",

            unlocked:
                rank <= 5
        },


        {
            icon:
                "fa-hundred-points",

            label:
                "5,000 Points",

            unlocked:
                totalEarned >= 5000
        }
    ];


    grid.innerHTML =
        badges
            .map(
                b => `

                    <div class="achievement ${
                        b.unlocked
                            ? "unlocked"
                            : ""
                    }">

                        <i class="fa-solid ${b.icon}"></i>

                        <span>
                            ${b.label}
                        </span>

                    </div>

                `
            )
            .join("");


    tag.textContent =
        `${
            badges.filter(
                b =>
                    b.unlocked
            ).length
        } of ${
            badges.length
        } unlocked`;
}


/* ---------- My Collection Schedule ---------- */

const SCHED_COLLECTION_DAYS = [
    "Monday",
    "Tuesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
];


const SCHED_FULL_WEEK = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
];


const SCHED_DAY_SHORT = {

    Monday:
        "Mon",

    Tuesday:
        "Tue",

    Wednesday:
        "Wed",

    Thursday:
        "Thu",

    Friday:
        "Fri",

    Saturday:
        "Sat",

    Sunday:
        "Sun"
};


const SCHED_HOURS =
    "8:00 AM – 5:00 PM";


const SCHED_GROUPS_KEY =
    "ecoCollectorGroups";


function schedAllStreetNames() {

    if (
        typeof CANIOGAN_STREETS ===
        "undefined"
    ) {

        return [];
    }


    const names = [];


    CANIOGAN_STREETS.forEach(
        group => {

            group.streets.forEach(
                s =>
                    names.push(
                        s.name
                    )
            );
        }
    );


    return names;
}


function schedBuildDefaultGroups(
    allStreets
) {

    const midpoint =
        Math.ceil(
            allStreets.length /
            2
        );


    return [

        {
            id:
                "group-1",

            name:
                "Group 1",

            streets:
                allStreets.slice(
                    0,
                    midpoint
                )
        },

        {
            id:
                "group-2",

            name:
                "Group 2",

            streets:
                allStreets.slice(
                    midpoint
                )
        }
    ];
}


function schedGetGroups(
    allStreets
) {

    const defaults =
        schedBuildDefaultGroups(
            allStreets
        );


    if (
        !allStreets.length
    ) {

        return defaults;
    }


    let stored = null;


    try {

        stored =
            JSON.parse(
                localStorage.getItem(
                    SCHED_GROUPS_KEY
                )
            );

    } catch {}


    if (
        !Array.isArray(stored) ||
        stored.length !== 2
    ) {

        return defaults;
    }


    let groups =
        stored.map(
            g => ({

                id:
                    g && g.id,

                name:
                    (g && g.name) ||
                    "Group",

                streets:
                    Array.isArray(
                        g && g.streets
                    )

                        ? g.streets.filter(
                            s =>
                                allStreets.includes(
                                    s
                                )
                        )

                        : []
            })
        );


    if (
        groups.some(
            g =>
                g.streets.length === 0
        )
    ) {

        groups =
            groups.map(
                (g, i) => {

                    const fallback =
                        defaults.find(
                            d =>
                                d.id ===
                                g.id
                        ) ||
                        defaults[i];


                    return {

                        ...g,

                        streets:
                            fallback.streets
                    };
                }
            );
    }


    return groups;
}


function schedSortBySequence(
    allStreets,
    names
) {

    return names
        .slice()
        .sort(
            (a, b) =>
                allStreets.indexOf(a) -
                allStreets.indexOf(b)
        );
}


function schedBuildStreetMap(
    allStreets,
    groups
) {

    const map =
        new Map();


    groups.forEach(
        group => {

            const ordered =
                schedSortBySequence(
                    allStreets,
                    group.streets
                );


            const dayCount =
                SCHED_COLLECTION_DAYS.length;


            const base =
                Math.floor(
                    ordered.length /
                    dayCount
                );


            const remainder =
                ordered.length %
                dayCount;


            let cursor = 0;


            SCHED_COLLECTION_DAYS.forEach(
                (day, i) => {

                    const chunkSize =
                        base +
                        (
                            i < remainder
                                ? 1
                                : 0
                        );


                    ordered
                        .slice(
                            cursor,
                            cursor +
                                chunkSize
                        )
                        .forEach(
                            name => {

                                map.set(
                                    name,
                                    {
                                        day,
                                        groupId:
                                            group.id,
                                        groupName:
                                            group.name
                                    }
                                );
                            }
                        );


                    cursor +=
                        chunkSize;
                }
            );
        }
    );


    return map;
}


function schedReadSession() {

    try {

        const local =
            EcoSession();


        if (local) {
            return local;
        }

    } catch {}


    try {

        const sess =
            JSON.parse(
                sessionStorage.getItem(
                    "ecoUser"
                )
            );


        if (sess) {
            return sess;
        }

    } catch {}


    return null;
}


/* ---------- Next Collection Date ---------- */

function schedNextDateForDay(
    dayName
) {

    const today =
        new Date();


    const todayIndex =
        today.getDay();


    const target =
        SCHED_FULL_WEEK.indexOf(
            dayName
        );


    const targetJsIndex =
        (target + 1) % 7;


    const diff =
        (
            targetJsIndex -
            todayIndex +
            7
        ) % 7;


    const date =
        new Date(today);


    date.setDate(
        today.getDate() +
        diff
    );


    return {
        date,
        diff
    };
}


function schedFormatDate(
    date
) {

    return date.toLocaleDateString(
        "en-US",
        {
            month:
                "short",

            day:
                "numeric"
        }
    );
}


function schedEmptyState(
    icon,
    title,
    sub
) {

    return `

        <div class="mysched-empty">

            <i class="fa-solid ${icon}"></i>

            <strong>
                ${title}
            </strong>

            <span>
                ${sub}
            </span>

        </div>

    `;
}


/* ---------- Render My Schedule ---------- */

function renderMySchedule() {

    const host =
        document.getElementById(
            "myScheduleCard"
        );


    if (!host) return;


    const allStreets =
        schedAllStreetNames();


    if (
        !allStreets.length
    ) {

        host.innerHTML =
            schedEmptyState(

                "fa-road-circle-exclamation",

                "Schedule data isn't available right now.",

                "Please refresh the page in a moment."
            );

        return;
    }


    const session =
        schedReadSession();


    /* ---------- Use MySQL street first ---------- */

    const street =
        DASH_RESIDENT
            ? String(
                DASH_RESIDENT.street || ""
            ).trim()
            : (
                session &&
                session.street
                    ? session.street
                    : ""
            );


    if (
        !street ||
        !allStreets.includes(
            street
        )
    ) {

        host.innerHTML =
            schedEmptyState(

                "fa-location-dot",

                "No registered street on file.",

                'Add your street on <a href="Profile.html">your Profile</a> to see your personal collection day.'
            );

        return;
    }


    const groups =
        schedGetGroups(
            allStreets
        );


    const map =
        schedBuildStreetMap(
            allStreets,
            groups
        );


    const entry =
        map.get(street);


    if (!entry) {

        host.innerHTML =
            schedEmptyState(

                "fa-truck-ramp-box",

                `${street} isn't assigned to a collection day yet.`,

                "Check back soon — the Barangay is still finalizing collector routes."
            );

        return;
    }


    const {
        date,
        diff
    } =
        schedNextDateForDay(
            entry.day
        );


    const isToday =
        diff === 0;


    const countdownLabel =
        isToday

            ? "Today!"

            : diff === 1

                ? "Tomorrow"

                : `In ${diff} days`;


    const stripHtml =
        SCHED_FULL_WEEK
            .map(
                day => {

                    const isOff =
                        !SCHED_COLLECTION_DAYS.includes(
                            day
                        );


                    const isMine =
                        day ===
                        entry.day;


                    const isDayToday =
                        schedNextDateForDay(
                            day
                        ).diff === 0;


                    const classes = [
                        "mysched-pill"
                    ];


                    if (isOff) {

                        classes.push(
                            "off"
                        );
                    }


                    if (isDayToday) {

                        classes.push(
                            "today"
                        );
                    }


                    if (isMine) {

                        classes.push(
                            "mine"
                        );
                    }


                    const icon =
                        isOff

                            ? "fa-ban"

                            : (
                                isMine
                                    ? "fa-truck-fast"
                                    : "fa-recycle"
                            );


                    return `

                        <div class="${classes.join(" ")}">

                            ${
                                isMine
                                    ? '<span class="p-tag">Your day</span>'
                                    : ""
                            }

                            <span class="p-day">
                                ${SCHED_DAY_SHORT[day]}
                            </span>

                            <span class="p-icon">
                                <i class="fa-solid ${icon}"></i>
                            </span>

                        </div>

                    `;
                }
            )
            .join("");


    host.innerHTML = `

        <div class="mysched-hero${isToday ? " today" : ""}">

            <div class="mysched-hero-top">

                <span class="mysched-kicker">

                    <i class="fa-solid fa-location-dot"></i>

                    ${dashEsc(street)}

                </span>


                <span class="mysched-countdown${isToday ? " today" : ""}">

                    <i class="fa-solid ${
                        isToday
                            ? "fa-bell"
                            : "fa-clock"
                    }"></i>

                    ${countdownLabel}

                </span>

            </div>


            <div class="mysched-hero-day">

                ${entry.day} Collection

            </div>


            <div class="mysched-hero-sub">

                ${schedFormatDate(date)}
                &middot;
                ${SCHED_HOURS}

            </div>


            <div class="mysched-hero-stats">

                <div class="mysched-stat">

                    <span>
                        Street
                    </span>

                    <strong title="${dashEsc(street)}">
                        ${dashEsc(street)}
                    </strong>

                </div>


                <div class="mysched-stat">

                    <span>
                        Collector Team
                    </span>

                    <strong>
                        ${dashEsc(entry.groupName)}
                    </strong>

                </div>


                <div class="mysched-stat">

                    <span>
                        Hours
                    </span>

                    <strong>
                        ${SCHED_HOURS}
                    </strong>

                </div>

            </div>

        </div>


        <div class="mysched-strip">

            ${stripHtml}

        </div>


        <div class="mysched-foot">

            <i class="fa-solid fa-qrcode"></i>

            Have your

            <a
                href="My QR Code.html"
                style="color:var(--primary-green); font-weight:700;"
            >
                QR code
            </a>

            ready on your collection day for verification.

        </div>

    `;
}


/* ---------- Storage Updates ---------- */

window.addEventListener(
    "storage",
    (event) => {

        if (
            event.key ===
                SCHED_GROUPS_KEY ||
            event.key ===
                "ecoUser"
        ) {

            renderMySchedule();
        }


        if (
            event.key ===
                DASH_QUEUE_KEY ||
            event.key ===
                "ecoUsers"
        ) {

            renderRecentSubmissions();
        }
    }
);


/* ---------- Recent Notifications ---------- */

function initDashboardNotifications() {

    if (
        !window.EcoNotifs
    ) return;


    const host =
        document.getElementById(
            "dashNotifList"
        );


    if (host) {

        EcoNotifs.mountList(
            host,
            {
                limit:
                    5,

                navigate:
                    true,

                showLink:
                    false
            }
        );
    }


    const markAll =
        document.getElementById(
            "dashMarkAll"
        );


    if (markAll) {

        markAll.addEventListener(
            "click",
            (event) => {

                event.preventDefault();

                EcoNotifs.markAllRead();
            }
        );
    }
}


/* ---------- Initialize Collection Schedule ---------- */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        try {

            renderMySchedule();

        } catch (err) {

            console.error(
                "renderMySchedule failed:",
                err
            );


            const host =
                document.getElementById(
                    "myScheduleCard"
                );


            if (host) {

                host.innerHTML =
                    schedEmptyState(

                        "fa-road-circle-exclamation",

                        "Schedule data isn't available right now.",

                        "Please refresh the page in a moment."
                    );
            }
        }
    }
);


/* ---------- Initialize Dashboard ---------- */

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        /*
         * Load the resident from MySQL first.
         * The rest of the dashboard can then use DASH_RESIDENT.
         */

        await loadDashboardResident();


        /*
         * Update the resident's name and welcome message.
         */

        syncDashboardIdentity();


        /*
         * Now refresh the collection schedule.
         * This allows the schedule to use the MySQL street.
         */

        try {

            renderMySchedule();

        } catch (err) {

            console.error(
                "MySQL schedule render failed:",
                err
            );
        }


        /*
         * Existing dashboard systems.
         */

        initDashboardNotifications();

        renderDashboardData();

        renderCharts();

        renderAchievementsPreview();

    }
);