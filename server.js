const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Allows the pages to call the API even when opened outside the server
// origin (for example straight from the filesystem during a demo).
app.use(cors());
app.use(express.json());

// Never cache pages or scripts. A phone that visited an earlier version
// kept running the old JavaScript after the server was fixed, which is
// exactly the "it says it cannot log in" problem. no-store means every
// request comes back to us.
app.use(
    express.static(__dirname, {
        etag: false,
        lastModified: false,
        maxAge: 0,
        setHeaders: function (res) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    })
);

// Database credentials come from the environment when they are set, so
// the password does not have to live in this file. The fallback keeps the
// project working on this machine without any setup.
const dbHost = process.env.DB_HOST || 'localhost';
const dbUser = process.env.DB_USER || 'ecopoints_app';
const dbPassword = process.env.DB_PASSWORD || 'Bayer_123456789';
const dbName = process.env.DB_NAME || 'ecopoints_db';

const db = mysql.createConnection({
    host: dbHost,
    user: dbUser,
    password: dbPassword,
    database: dbName
});

/* =========================
   CRASH PROTECTION
   A single failed database call must never take the whole site down.
   Four routes open their own short-lived connection, and when one of
   those failed the unhandled error killed the Node process, so the
   browser saw "Network error" on every page at once. These handlers
   log the problem and keep serving.
========================= */

process.on('uncaughtException', (err) => {
    console.error('Uncaught error (server kept running):', err && err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection (server kept running):',
        reason && reason.message ? reason.message : reason);
});

// If the long-lived connection ever drops, try to reconnect rather than
// letting every later query fail.
db.on('error', (err) => {
    console.error('Database connection error:', err.message);

    if (err.fatal || err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNREFUSED') {
        console.log('Attempting to reconnect to the database...');
        db.connect((reconnectErr) => {
            if (reconnectErr) {
                console.log('Reconnect failed:', reconnectErr.message);
            } else {
                console.log('Database reconnected successfully!');
            }
        });
    }
});

db.connect((err) => {
    if (err) {
        console.log('Database connection failed:', err.message);
        return;
    }

    console.log('Database connected successfully!');
});


/* =========================
   HOME PAGE
========================= */

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Main Page.html'));
});

// Short, easy-to-type shortcuts. The staff login is deliberately not
// linked from the resident pages, so this gives staff a short URL to
// bookmark and share instead of the long "Collector Login.html".
app.get('/staff', (req, res) => {
    res.sendFile(path.join(__dirname, 'Collector Login.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'Registration.html'));
});


/* =========================
   TEST API
========================= */

app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'EcoPoints API is working!'
    });
});


/* =========================
   REGISTER RESIDENT
========================= */

function assignAccountId(residentId, attempt, callback) {

    const year = String(new Date().getFullYear() % 100).padStart(2, '0');
    const prefix = 'ECO-' + year + '-';

    const lastSql = `
        SELECT COALESCE(
            MAX(CAST(SUBSTRING(account_id, ?) AS UNSIGNED)),
            0
        ) AS last_number
        FROM residents
        WHERE account_id LIKE ?
    `;

    db.query(
        lastSql,
        [prefix.length + 1, prefix + '%'],
        (lastErr, lastResults) => {

            if (lastErr) {
                return callback(lastErr);
            }

            const nextNumber = Number(lastResults[0].last_number) + 1;
            const account_id = prefix + String(nextNumber).padStart(2, '0');

            db.query(
                `
                UPDATE residents
                SET account_id = ?, qr_code_value = ?
                WHERE resident_id = ?
                `,
                [account_id, account_id, residentId],
                (updateErr) => {

                    if (updateErr) {

                        if (updateErr.code === 'ER_DUP_ENTRY' && attempt < 5) {
                            return assignAccountId(
                                residentId,
                                attempt + 1,
                                callback
                            );
                        }

                        return callback(updateErr);
                    }

                    callback(null, account_id);
                }
            );
        }
    );
}

app.post('/api/residents', (req, res) => {

    const {
        first_name,
        last_name,
        email,
        password,
        phone,
        house_number,
        street,
        street_classification
    } = req.body;

    if (
        !first_name ||
        !last_name ||
        !email ||
        !password ||
        !phone ||
        !house_number ||
        !street
    ) {
        return res.status(400).json({
            success: false,
            error: 'Please complete all required fields.'
        });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const password_hash = salt + ':' + staffHashPassword(password, salt);

    const temp_id = 'TMP-' + Date.now();

    const sql = `
        INSERT INTO residents
        (
            account_id,
            email,
            password_hash,
            first_name,
            last_name,
            phone,
            house_number,
            street,
            street_classification,
            qr_code_value,
            ecopoints_balance
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 250)
    `;

    db.query(
        sql,
        [
            temp_id,
            email,
            password_hash,
            first_name,
            last_name,
            phone,
            house_number,
            street,
            street_classification,
            temp_id
        ],
        (err, result) => {

            if (err) {

                console.log(
                    'Registration failed:',
                    err.message
                );

                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({
                        success: false,
                        error: 'This email or QR code is already registered.'
                    });
                }

                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            const residentId = result.insertId;

            assignAccountId(residentId, 0, (assignErr, account_id) => {

                if (assignErr) {

                    console.log(
                        'Account ID assignment failed:',
                        assignErr.message
                    );

                    db.query(
                        'DELETE FROM residents WHERE resident_id = ?',
                        [residentId],
                        () => {
                            res.status(500).json({
                                success: false,
                                error: 'Could not create your account ID. Please try again.'
                            });
                        }
                    );

                    return;
                }

                const historySql = `
                    INSERT INTO resident_points_history
                    (
                        resident_id,
                        entry_type,
                        description,
                        points
                    )
                    VALUES (?, 'adjustment', 'Welcome bonus', 250)
                `;

                db.query(
                    historySql,
                    [residentId],
                    (historyErr) => {

                        if (historyErr) {
                            console.log(
                                'Welcome bonus history failed:',
                                historyErr.message
                            );

                            return res.status(500).json({
                                success: false,
                                error: 'Resident was registered, but the welcome bonus history could not be saved.'
                            });
                        }

                        console.log(
                            'Resident registered:',
                            email,
                            account_id
                        );

                        res.json({
                            success: true,
                            resident_id: residentId,
                            account_id: account_id,
                            qr_code_value: account_id
                        });
                    }
                );
            });
        }
    );
});


/* =========================
   LOGIN RESIDENT
========================= */

app.post('/api/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    // Accept either plain password (new) or password_hash (legacy)
    const password = String(req.body.password || '');
    const password_hash = String(req.body.password_hash || '');

    if (!email || (!password && !password_hash)) {
        return res.status(400).json({
            success: false,
            error: 'Email and password are required.'
        });
    }

    const sql = `
        SELECT
            resident_id,
            account_id,
            email,
            password_hash,
            account_status,
            first_name,
            last_name,
            phone,
            house_number,
            street,
            street_classification,
            qr_code_value,
            ecopoints_balance
        FROM residents
        WHERE email = ?
        LIMIT 1
    `;

    db.query(sql, [email], (err, results) => {
        if (err) {
            console.log('Login database error:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Database error.'
            });
        }

        if (results.length === 0) {
                console.log('LOGIN FAILED - no such account:', email);
            return res.status(401).json({
                success: false,
                error: 'Invalid login credentials.'
            });
        }

        const resident = results[0];

        if (resident.account_status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'This account is not active.'
            });
        }

        let ok = false;

        if (password) {
            // New path: plain password + salt:hash in DB (same as staff)
            const { salt, hash } = parseStoredPassword(resident.password_hash);
            if (salt && hash) {
                ok = staffHashPassword(password, salt) === hash;
            } else if (hash) {
                // Legacy: only hash stored (old rows)
                ok = password === hash || staffHashPassword(password, '') === hash;
            }
        } else if (password_hash) {
            // Legacy path: client already sent the hash
            ok = resident.password_hash === password_hash;
        }

        if (!ok) {
                console.log('LOGIN FAILED - wrong password for:', email);
            return res.status(401).json({
                success: false,
                error: 'Invalid login credentials.'
            });
        }

        console.log('Resident logged in:', resident.email);

        res.json({
            success: true,
            resident: {
                resident_id: resident.resident_id,
                account_id: resident.account_id,
                email: resident.email,
                first_name: resident.first_name,
                last_name: resident.last_name,
                phone: resident.phone,
                house_number: resident.house_number,
                street: resident.street,
                street_classification: resident.street_classification,
                qr_code_value: resident.qr_code_value,
                ecopoints_balance: resident.ecopoints_balance,
                role: 'resident'
            }
        });
    });
});


/* =========================
   GET RESIDENT DASHBOARD DATA
========================= */

app.get('/api/residents/:id', (req, res) => {

    const residentId = Number(req.params.id);

    if (!Number.isInteger(residentId) || residentId <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid resident ID.'
        });
    }

        const sql = `
        SELECT
            r.resident_id,
            r.account_id,
            r.email,
            r.first_name,
            r.last_name,
            r.phone,
            r.house_number,
            r.street,
            r.street_classification,
            r.qr_code_value,
            r.ecopoints_balance,
            r.account_status,
            r.created_at,
            r.updated_at,
            (
                SELECT COUNT(*)
                FROM resident_points_history h
                WHERE h.resident_id = r.resident_id
                  AND h.entry_type = 'scan'
            ) AS submissions_count
        FROM residents r
        WHERE r.resident_id = ?
        LIMIT 1
    `;
    db.query(sql, [residentId], (err, results) => {

        if (err) {
            console.log(
                'Resident dashboard database error:',
                err.message
            );

            return res.status(500).json({
                success: false,
                error: 'Database error.'
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Resident not found.'
            });
        }

        const resident = results[0];

        if (resident.account_status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'This account is not active.'
            });
        }

        res.json({
            success: true,
            resident: resident
        });
    });
});

/* =========================
   GET RESIDENT ECOPOINTS DATA
========================= */

app.get('/api/residents/:id/ecopoints', (req, res) => {

    const residentId = Number(req.params.id);

    if (!Number.isInteger(residentId) || residentId <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid resident ID.'
        });
    }

    const residentSql = `
        SELECT
            resident_id,
            ecopoints_balance,
            account_status
        FROM residents
        WHERE resident_id = ?
        LIMIT 1
    `;

    db.query(residentSql, [residentId], (residentErr, residentResults) => {

        if (residentErr) {
            console.log(
                'EcoPoints resident database error:',
                residentErr.message
            );

            return res.status(500).json({
                success: false,
                error: 'Database error.'
            });
        }

        if (residentResults.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Resident not found.'
            });
        }

        const resident = residentResults[0];

        if (resident.account_status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'This account is not active.'
            });
        }

        const historySql = `
            SELECT
                history_id,
                entry_type,
                description,
                points,
                created_at
            FROM resident_points_history
            WHERE resident_id = ?
            ORDER BY created_at DESC, history_id DESC
        `;

        db.query(historySql, [residentId], (historyErr, historyResults) => {

            if (historyErr) {
                console.log(
                    'Points history database error:',
                    historyErr.message
                );

                return res.status(500).json({
                    success: false,
                    error: 'Could not load points history.'
                });
            }

            const redemptionSql = `
                SELECT
                    redemption_id,
                    reward_name,
                    points_cost,
                    redemption_status,
                    redeemed_at,
                    claimed_at
                FROM resident_reward_redemptions
                WHERE resident_id = ?
                ORDER BY redeemed_at DESC, redemption_id DESC
            `;

            db.query(
                redemptionSql,
                [residentId],
                (redemptionErr, redemptionResults) => {

                    if (redemptionErr) {
                        console.log(
                            'Redemption history database error:',
                            redemptionErr.message
                        );

                        return res.status(500).json({
                            success: false,
                            error: 'Could not load redemption history.'
                        });
                    }

                    const earnedEntries = historyResults.filter(
                        entry => Number(entry.points) > 0
                    );

                    const redeemedEntries = redemptionResults.map(
                        redemption => ({
                            history_id: redemption.redemption_id,
                            entry_type: 'redeem',
                            description: redemption.reward_name,
                            points: -Number(redemption.points_cost),
                            created_at: redemption.redeemed_at,
                            redemption_status: redemption.redemption_status,
                            claimed_at: redemption.claimed_at
                        })
                    );

                    const lifetimeEarned = earnedEntries.reduce(
                        (total, entry) =>
                            total + Number(entry.points || 0),
                        0
                    );

                    const lifetimeRedeemed = redemptionResults.reduce(
                        (total, redemption) =>
                            total + Number(redemption.points_cost || 0),
                        0
                    );

                    res.json({
                        success: true,

                        balance: Number(
                            resident.ecopoints_balance || 0
                        ),

                        lifetimeEarned: lifetimeEarned,

                        lifetimeRedeemed: lifetimeRedeemed,

                        redemptionCount: redemptionResults.length,

                        history: historyResults,

                        redemptions: redemptionResults,

                        earnedEntries: earnedEntries,

                        redeemedEntries: redeemedEntries
                    });
                }
            );
        });
    });
});

/* =========================
   GET RESIDENT COLLECTION SCHEDULE
========================= */

app.get('/api/residents/:id/schedule', (req, res) => {

    const residentId = Number(req.params.id);

    if (!Number.isInteger(residentId) || residentId <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid resident ID.'
        });
    }

    const sql = `
        SELECT
            schedule_id,
            resident_id,
            collection_date,
            collection_day,
            start_time,
            end_time,
            street,
            schedule_status,
            created_at
        FROM resident_collection_schedule
        WHERE resident_id = ?
        ORDER BY collection_date ASC, start_time ASC
    `;

    db.query(sql, [residentId], (err, results) => {

        if (err) {
            console.log(
                'Resident schedule database error:',
                err.message
            );

            return res.status(500).json({
                success: false,
                error: 'Could not load collection schedule.'
            });
        }

        res.json({
            success: true,
            schedules: results
        });
    });
});



/* =========================
   GET RESIDENT BY EMAIL
========================= */

app.get('/api/residents/by-email/:email', (req, res) => {

    const email = req.params.email;

    const sql = `
        SELECT
            resident_id,
            account_id,
            email,
            first_name,
            last_name,
            phone,
            house_number,
            street,
            street_classification,
            qr_code_value,
            ecopoints_balance
        FROM residents
        WHERE email = ?
        LIMIT 1
    `;

    db.query(sql, [email], (err, results) => {

        if (err) {

            console.log(
                'Resident email lookup error:',
                err.message
            );

            return res.status(500).json({
                success: false,
                error: 'Database error.'
            });
        }

        if (results.length === 0) {

            return res.status(404).json({
                success: false,
                error: 'Resident not found.'
            });
        }

        res.json({
            success: true,
            resident: results[0]
        });

    });

});

/* =========================
   UPDATE RESIDENT PROFILE
========================= */

app.put('/api/residents/:id', (req, res) => {

    const residentId = Number(req.params.id);

    if (!Number.isInteger(residentId) || residentId <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid resident ID.'
        });
    }

    const first_name = String(req.body.first_name || '').trim();
    const last_name = String(req.body.last_name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const house_number = String(req.body.house_number || '').trim();
    const street = String(req.body.street || '').trim();
    const street_classification = req.body.street_classification || null;

    if (
        !first_name ||
        !last_name ||
        !email ||
        !phone ||
        !house_number ||
        !street
    ) {
        return res.status(400).json({
            success: false,
            error: 'Please complete all required fields.'
        });
    }

    const namePattern = /^[A-Za-z]+(\s[A-Za-z]+)*$/;

    if (!namePattern.test(first_name) || !namePattern.test(last_name)) {
        return res.status(400).json({
            success: false,
            error: 'Names must contain letters only.'
        });
    }

    if (!/^[^\s@]+@gmail\.com$/.test(email)) {
        return res.status(400).json({
            success: false,
            error: 'Please enter a valid Gmail address.'
        });
    }

    if (!/^\d{11,12}$/.test(phone)) {
        return res.status(400).json({
            success: false,
            error: 'Mobile number must contain 11 digits.'
        });
    }

    const updateSql = `
        UPDATE residents
        SET
            first_name = ?,
            last_name = ?,
            email = ?,
            phone = ?,
            house_number = ?,
            street = ?,
            street_classification = ?
        WHERE resident_id = ?
        AND account_status = 'active'
    `;

    db.query(
        updateSql,
        [
            first_name,
            last_name,
            email,
            phone,
            house_number,
            street,
            street_classification,
            residentId
        ],
        (err, result) => {

            if (err) {

                console.log(
                    'Profile update failed:',
                    err.message
                );

                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({
                        success: false,
                        error: 'This email is already registered to another account.'
                    });
                }

                return res.status(500).json({
                    success: false,
                    error: 'Could not save your profile.'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Resident not found or account is not active.'
                });
            }

            const selectSql = `
                SELECT
                    resident_id,
                    account_id,
                    email,
                    first_name,
                    last_name,
                    phone,
                    house_number,
                    street,
                    street_classification,
                    qr_code_value,
                    ecopoints_balance
                FROM residents
                WHERE resident_id = ?
                LIMIT 1
            `;

            db.query(selectSql, [residentId], (selectErr, results) => {

                if (selectErr || results.length === 0) {
                    return res.json({
                        success: true
                    });
                }

                console.log(
                    'Profile updated:',
                    results[0].account_id
                );

                res.json({
                    success: true,
                    resident: results[0]
                });
            });
        }
    );
});

/* =========================
   REDEEM REWARD
========================= */

const REWARD_CATALOG = {
    rice5: { name: '5kg Rice Pack', cost: 1200 },
    grocery: { name: 'Grocery Pack', cost: 3000 },
    ecobag: { name: 'Eco Bag', cost: 600 },
    loadcard: { name: 'Mobile Load (\u20B150)', cost: 800 },
    canned: { name: 'Canned Goods Pack', cost: 900 },
    detergent: { name: 'Laundry Detergent', cost: 700 }
};

app.post('/api/residents/:id/redeem', (req, res) => {

    const residentId = Number(req.params.id);

    if (!Number.isInteger(residentId) || residentId <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid resident ID.'
        });
    }

    const reward = REWARD_CATALOG[req.body.reward_id];

    if (!reward) {
        return res.status(404).json({
            success: false,
            error: 'Reward not found.'
        });
    }

    const deductSql = `
        UPDATE residents
        SET ecopoints_balance = ecopoints_balance - ?
        WHERE resident_id = ?
        AND account_status = 'active'
        AND ecopoints_balance >= ?
    `;

    db.query(
        deductSql,
        [reward.cost, residentId, reward.cost],
        (err, result) => {

            if (err) {
                console.log(
                    'Redeem deduction failed:',
                    err.message
                );

                return res.status(500).json({
                    success: false,
                    error: 'Could not process your redemption.'
                });
            }

            if (result.affectedRows === 0) {

                db.query(
                    `
                    SELECT ecopoints_balance, account_status
                    FROM residents
                    WHERE resident_id = ?
                    LIMIT 1
                    `,
                    [residentId],
                    (checkErr, rows) => {

                        if (checkErr) {
                            return res.status(500).json({
                                success: false,
                                error: 'Database error.'
                            });
                        }

                        if (rows.length === 0) {
                            return res.status(404).json({
                                success: false,
                                error: 'Resident not found.'
                            });
                        }

                        if (rows[0].account_status !== 'active') {
                            return res.status(403).json({
                                success: false,
                                error: 'This account is not active.'
                            });
                        }

                        const balance = Number(rows[0].ecopoints_balance || 0);

                        res.status(400).json({
                            success: false,
                            error: 'You need ' + (reward.cost - balance) + ' more points to redeem this.',
                            balance: balance
                        });
                    }
                );

                return;
            }

            db.query(
                `
                INSERT INTO resident_reward_redemptions
                (
                    resident_id,
                    reward_name,
                    points_cost
                )
                VALUES (?, ?, ?)
                `,
                [residentId, reward.name, reward.cost],
                (insertErr) => {

                    if (insertErr) {

                        console.log(
                            'Redemption record failed:',
                            insertErr.message
                        );

                        db.query(
                            `
                            UPDATE residents
                            SET ecopoints_balance = ecopoints_balance + ?
                            WHERE resident_id = ?
                            `,
                            [reward.cost, residentId],
                            () => {
                                res.status(500).json({
                                    success: false,
                                    error: 'Could not save your redemption. Your points were not deducted.'
                                });
                            }
                        );

                        return;
                    }

                    db.query(
                        `
                        SELECT ecopoints_balance
                        FROM residents
                        WHERE resident_id = ?
                        LIMIT 1
                        `,
                        [residentId],
                        (balanceErr, rows) => {

                            console.log(
                                'Reward redeemed:',
                                residentId,
                                reward.name
                            );

                            res.json({
                                success: true,
                                message: 'You redeemed ' + reward.name + '! Coordinate pickup with your barangay office.',
                                balance: !balanceErr && rows.length
                                    ? Number(rows[0].ecopoints_balance)
                                    : null
                            });
                        }
                    );
                }
            );
        }
    );
});

/* =========================
   ADMIN REDEMPTION VERIFY
========================= */

// List redemptions for a resident (Admin Scanner uses this)
app.get('/api/residents/:id/redemptions', (req, res) => {
    const residentId = Number(req.params.id);

    if (!Number.isInteger(residentId) || residentId <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid resident ID.'
        });
    }

    const sql = `
        SELECT
            redemption_id,
            resident_id,
            reward_name,
            points_cost,
            redemption_status,
            redeemed_at,
            claimed_at
        FROM resident_reward_redemptions
        WHERE resident_id = ?
        ORDER BY redeemed_at DESC, redemption_id DESC
    `;

    db.query(sql, [residentId], (err, rows) => {
        if (err) {
            console.log('Load redemptions error:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Could not load redemptions.'
            });
        }

        res.json({
            success: true,
            redemptions: rows
        });
    });
});

// Approve redemption (mark as claimed)
app.post('/api/redemptions/:id/approve', (req, res) => {
    const redemptionId = Number(req.params.id);
    const adminId = req.body.admin_id ? Number(req.body.admin_id) : null;
    const remarks = req.body.remarks || null;

    if (!Number.isInteger(redemptionId) || redemptionId <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid redemption ID.'
        });
    }

    const updateSql = `
        UPDATE resident_reward_redemptions
        SET redemption_status = 'claimed',
            claimed_at = NOW()
        WHERE redemption_id = ?
          AND redemption_status = 'pending'
    `;

    db.query(updateSql, [redemptionId], (err, result) => {
        if (err) {
            console.log('Approve update error:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Could not approve redemption.'
            });
        }

        if (result.affectedRows === 0) {
            return res.status(400).json({
                success: false,
                error: 'Redemption not found or already processed.'
            });
        }

        const insertSql = `
            INSERT INTO admin_redemption_verifications
            (redemption_id, reward_id, admin_id, decision, remarks)
            VALUES (?, NULL, ?, 'approved', ?)
        `;

        db.query(insertSql, [redemptionId, adminId, remarks], (insertErr) => {
            if (insertErr) {
                console.log('Verification insert error:', insertErr.message);
                // Status already updated — still return success
            }

            res.json({
                success: true,
                message: 'Redemption approved (claimed).'
            });
        });
    });
});

// Reject redemption (cancel + refund points)
app.post('/api/redemptions/:id/reject', (req, res) => {
    const redemptionId = Number(req.params.id);
    const adminId = req.body.admin_id ? Number(req.body.admin_id) : null;
    const remarks = req.body.remarks || null;

    if (!Number.isInteger(redemptionId) || redemptionId <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid redemption ID.'
        });
    }

    // 1. Load the pending redemption
    const selectSql = `
        SELECT redemption_id, resident_id, reward_name, points_cost, redemption_status
        FROM resident_reward_redemptions
        WHERE redemption_id = ?
        LIMIT 1
    `;

    db.query(selectSql, [redemptionId], (selectErr, rows) => {
        if (selectErr || !rows.length) {
            return res.status(404).json({
                success: false,
                error: 'Redemption not found.'
            });
        }

        const redemption = rows[0];

        if (redemption.redemption_status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: 'Redemption already processed.'
            });
        }

        // 2. Mark as cancelled
        const updateSql = `
            UPDATE resident_reward_redemptions
            SET redemption_status = 'cancelled'
            WHERE redemption_id = ?
              AND redemption_status = 'pending'
        `;

        db.query(updateSql, [redemptionId], (updateErr, updateResult) => {
            if (updateErr || updateResult.affectedRows === 0) {
                return res.status(500).json({
                    success: false,
                    error: 'Could not cancel redemption.'
                });
            }

            // 3. Refund points
            const refundSql = `
                UPDATE residents
                SET ecopoints_balance = ecopoints_balance + ?
                WHERE resident_id = ?
            `;

            db.query(
                refundSql,
                [redemption.points_cost, redemption.resident_id],
                (refundErr) => {
                    if (refundErr) {
                        console.log('Refund error:', refundErr.message);
                        return res.status(500).json({
                            success: false,
                            error: 'Cancelled but failed to refund points.'
                        });
                    }

                    // 4. Log verification
                    const insertSql = `
                        INSERT INTO admin_redemption_verifications
                        (redemption_id, reward_id, admin_id, decision, remarks)
                        VALUES (?, NULL, ?, 'rejected', ?)
                    `;

                    db.query(
                        insertSql,
                        [redemptionId, adminId, remarks],
                        (insertErr) => {
                            if (insertErr) {
                                console.log('Verification insert error:', insertErr.message);
                            }

                            res.json({
                                success: true,
                                message: 'Redemption rejected and points refunded.',
                                refunded: redemption.points_cost
                            });
                        }
                    );
                }
            );
        });
    });
});

/* =========================
   GET RESIDENT BY ACCOUNT ID
========================= */

app.get('/api/residents/by-account/:accountId', (req, res) => {
    const accountId = String(req.params.accountId || '').trim().toUpperCase();

    if (!accountId) {
        return res.status(400).json({
            success: false,
            error: 'Account ID is required.'
        });
    }

    const sql = `
        SELECT
            resident_id,
            account_id,
            email,
            first_name,
            last_name,
            phone,
            house_number,
            street,
            street_classification,
            qr_code_value,
            ecopoints_balance,
            account_status,
            created_at
        FROM residents
        WHERE UPPER(account_id) = ?
           OR UPPER(qr_code_value) = ?
        LIMIT 1
    `;

    db.query(sql, [accountId, accountId], (err, results) => {
        if (err) {
            console.log('Account lookup error:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Database error.'
            });
        }

        if (!results.length) {
            return res.status(404).json({
                success: false,
                error: 'Resident not found.'
            });
        }

        const resident = results[0];

        if (resident.account_status && resident.account_status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'This account is not active.'
            });
        }

        res.json({
            success: true,
            resident: resident
        });
    });
});



/* =========================
   START SERVER
========================= */

/* =========================
   EARN POINTS (collector scan/verify)
========================= */

app.post('/api/residents/:id/earn', (req, res) => {
    const residentId = Number(req.params.id);
    const points = Number(req.body.points);
    const description = String(req.body.description || 'Waste verified').trim();

    if (!Number.isInteger(residentId) || residentId <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid resident ID.'
        });
    }

    if (!Number.isFinite(points) || points <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Points must be greater than 0.'
        });
    }

    // 1. Add points to balance
    const updateSql = `
        UPDATE residents
        SET ecopoints_balance = ecopoints_balance + ?
        WHERE resident_id = ?
          AND account_status = 'active'
    `;

    db.query(updateSql, [points, residentId], (updateErr, updateResult) => {
        if (updateErr) {
            console.log('Earn points update error:', updateErr.message);
            return res.status(500).json({
                success: false,
                error: 'Could not update points balance.'
            });
        }

        if (updateResult.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Resident not found or inactive.'
            });
        }

        // 2. Insert history (entry_type = scan)
        const insertSql = `
            INSERT INTO resident_points_history
            (resident_id, entry_type, description, points)
            VALUES (?, 'scan', ?, ?)
        `;

        db.query(insertSql, [residentId, description, points], (insertErr) => {
            if (insertErr) {
                console.log('Earn history insert error:', insertErr.message);
                // Balance already updated — still return success with warning
            }

            // 3. Return new balance
            db.query(
                `
                SELECT ecopoints_balance
                FROM residents
                WHERE resident_id = ?
                LIMIT 1
                `,
                [residentId],
                (balErr, rows) => {
                    const newBalance =
                        !balErr && rows.length
                            ? Number(rows[0].ecopoints_balance)
                            : null;

                    console.log(
                        'Points earned:',
                        residentId,
                        '+',
                        points,
                        '→',
                        newBalance
                    );

                    res.json({
                        success: true,
                        message: 'Points added successfully.',
                        pointsAdded: points,
                        newBalance: newBalance
                    });
                }
            );
        });
    });
});

/* =========================
   STAFF LOGIN (admin + collector)
========================= */

function staffHashPassword(password, saltHex) {
    return crypto
        .createHash('sha256')
        .update(String(saltHex) + ':' + String(password))
        .digest('hex');
}

function parseStoredPassword(stored) {
    // Supports "salt:hash" or plain hash (legacy)
    if (!stored || typeof stored !== 'string') {
        return { salt: null, hash: null };
    }
    const idx = stored.indexOf(':');
    if (idx === -1) {
        return { salt: null, hash: stored };
    }
    return {
        salt: stored.slice(0, idx),
        hash: stored.slice(idx + 1)
    };
}

app.post('/api/staff/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = String(req.body.role || '').trim().toLowerCase();

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            error: 'Email and password are required.'
        });
    }

    if (role !== 'admin' && role !== 'collector') {
        return res.status(400).json({
            success: false,
            error: 'Role must be admin or collector.'
        });
    }

    if (role === 'collector') {
        const sql = `
            SELECT
                collector_id,
                collector_code,
                email,
                password_hash,
                account_status,
                first_name,
                last_name,
                phone,
                position,
                group_number
            FROM collectors
            WHERE email = ?
            LIMIT 1
        `;

        db.query(sql, [email], (err, results) => {
            if (err) {
                console.log('Staff login (collector) DB error:', err.message);
                return res.status(500).json({
                    success: false,
                    error: 'Database error.'
                });
            }

            if (!results.length) {
                return res.status(401).json({
                    success: false,
                    error: role === 'collector'
                          ? 'No collector account with that email. Collector emails end in @eco.collect.'
                          : 'No admin account with that email. Admin emails end in @eco.admin.'
                });
            }

            const row = results[0];

            if (String(row.account_status).toLowerCase() !== 'active') {
                return res.status(403).json({
                    success: false,
                    error: 'This account has been deactivated. Please contact an admin.'
                });
            }

            const { salt, hash } = parseStoredPassword(row.password_hash);
            let ok = false;

            if (salt && hash) {
                ok = staffHashPassword(password, salt) === hash;
            } else if (hash) {
                // fallback: client already sent same style hash stored as-is
                ok = password === hash || staffHashPassword(password, '') === hash;
            }

            if (!ok) {
                    console.log('LOGIN FAILED - wrong password for:', email);
                return res.status(401).json({
                    success: false,
                    error: 'Account found, but that password is wrong.'
                });
            }

            return res.json({
                success: true,
                staff: {
                    role: 'collector',
                    collector_id: row.collector_id,
                    collector_code: row.collector_code,
                    email: row.email,
                    first_name: row.first_name,
                    last_name: row.last_name,
                    phone: row.phone,
                    position: row.position,
                    group_number: row.group_number
                }
            });
        });

        return;
    }

    // role === 'admin'
    const sql = `
        SELECT
            admin_id,
            email,
            password_hash,
            account_status,
            first_name,
            last_name,
            phone
        FROM admins
        WHERE email = ?
        LIMIT 1
    `;

    db.query(sql, [email], (err, results) => {
        if (err) {
            console.log('Staff login (admin) DB error:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Database error. Check admins table columns: ' + err.message
            });
        }

        if (!results.length) {
            return res.status(401).json({
                success: false,
                error: role === 'collector'
                          ? 'No collector account with that email. Collector emails end in @eco.collect.'
                          : 'No admin account with that email. Admin emails end in @eco.admin.'
            });
        }

        const row = results[0];

        if (
            row.account_status &&
            String(row.account_status).toLowerCase() !== 'active'
        ) {
            return res.status(403).json({
                success: false,
                error: 'This account has been deactivated.'
            });
        }

        const { salt, hash } = parseStoredPassword(row.password_hash);
        let ok = false;

        if (salt && hash) {
            ok = staffHashPassword(password, salt) === hash;
        } else if (hash) {
            ok = password === hash;
        }

        if (!ok) {
                console.log('LOGIN FAILED - wrong password for:', email);
            return res.status(401).json({
                success: false,
                error: 'Account found, but that password is wrong.'
            });
        }

        return res.json({
            success: true,
            staff: {
                role: 'admin',
                admin_id: row.admin_id,
                email: row.email,
                first_name: row.first_name,
                last_name: row.last_name,
                phone: row.phone
            }
        });
    });
});

/* =========================
   COLLECTORS (list + create)
========================= */

app.get('/api/collectors', (req, res) => {
    const sql = `
        SELECT
            collector_id,
            collector_code,
            email,
            account_status,
            first_name,
            last_name,
            phone,
            position,
            group_number,
            created_at
        FROM collectors
        ORDER BY collector_id ASC
    `;

    db.query(sql, (err, rows) => {
        if (err) {
            console.log('List collectors error:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Database error.'
            });
        }

        res.json({
            success: true,
            collectors: rows
        });
    });
});

app.post('/api/collectors', async (req, res) => {
    const first_name = String(req.body.first_name || '').trim();
    const last_name = String(req.body.last_name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').replace(/\D/g, '');
    const password = String(req.body.password || '');
    const position = String(req.body.position || 'Collector').trim();
    const group_number = req.body.group_number != null && req.body.group_number !== ''
        ? Number(req.body.group_number)
        : null;

    // The group the collector ends up in. The admin may have picked one; if
    // not, it is filled in below so nobody is created unassigned.
    let assignedGroup = group_number;

    // Each group has 2 driver slots and 4 collector slots. When the admin
    // does not choose a group, place the new collector in the first group
    // with a free slot of the right kind so they are never unassigned.
    const SLOTS_PER_GROUP = 6;
    const DRIVER_SLOTS = 2;

    function pickFreeGroup(isDriver) {
        return new Promise((resolve) => {
            db.query(
                `SELECT g.group_number,
                        (SELECT COUNT(*) FROM collectors c
                          WHERE c.group_number = g.group_number
                            AND c.account_status = 'active') AS staffed
                   FROM collector_groups g
                  ORDER BY g.group_number ASC`,
                (err, rows) => {
                    if (err || !rows || !rows.length) return resolve(null);

                    const cap = isDriver ? DRIVER_SLOTS : SLOTS_PER_GROUP - DRIVER_SLOTS;

                    for (const r of rows) {
                        if (Number(r.staffed || 0) < cap) return resolve(Number(r.group_number));
                    }

                    // All groups of that kind are full, so use the least
                    // staffed one rather than leaving them unassigned.
                    let best = null;
                    let bestCount = Infinity;
                    rows.forEach((r) => {
                        const filled = Number(r.staffed || 0);
                        if (filled < bestCount) { bestCount = filled; best = Number(r.group_number); }
                    });
                    resolve(best);
                }
            );
        });
    }

    if (group_number === null || !Number.isInteger(group_number) || group_number <= 0) {
        const wantsDriver = position === 'Driver' || position === 'Driver & Collector';
        const auto = await pickFreeGroup(wantsDriver);
        if (auto) assignedGroup = auto;
    }

    const allowedPositions = ['Collector', 'Driver', 'Driver & Collector'];

    if (!first_name || !last_name || !email || !phone || !password) {
        return res.status(400).json({
            success: false,
            error: 'Please complete all required fields.'
        });
    }

    if (!email.endsWith('@eco.collect')) {
        return res.status(400).json({
            success: false,
            error: 'Collector emails must end with @eco.collect.'
        });
    }

    if (!allowedPositions.includes(position)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid position.'
        });
    }

    if (phone.length < 11 || phone.length > 12) {
        return res.status(400).json({
            success: false,
            error: 'Contact number must contain 11 or 12 digits.'
        });
    }

    // Generate salt + hash (same style as staff login)
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = staffHashPassword(password, salt);
    const password_hash = salt + ':' + hash;

    // Next collector_code: COL-001, COL-002, ...
    const codeSql = `
        SELECT COALESCE(
            MAX(CAST(SUBSTRING(collector_code, 5) AS UNSIGNED)),
            0
        ) AS last_number
        FROM collectors
        WHERE collector_code LIKE 'COL-%'
    `;

    db.query(codeSql, (codeErr, codeRows) => {
        if (codeErr) {
            console.log('Collector code error:', codeErr.message);
            return res.status(500).json({
                success: false,
                error: 'Database error.'
            });
        }

        const nextNumber = Number(codeRows[0].last_number) + 1;
        const collector_code = 'COL-' + String(nextNumber).padStart(3, '0');

        const insertSql = `
            INSERT INTO collectors (
                collector_code,
                email,
                password_hash,
                account_status,
                first_name,
                last_name,
                phone,
                position,
                group_number
            ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
        `;

        db.query(
            insertSql,
            [
                collector_code,
                email,
                password_hash,
                first_name,
                last_name,
                phone,
                position,
                assignedGroup
            ],
            (insertErr, result) => {
                if (insertErr) {
                    console.log('Create collector error:', insertErr.message);

                    if (insertErr.code === 'ER_DUP_ENTRY') {
                        return res.status(409).json({
                            success: false,
                            error: 'This email or collector code is already registered.'
                        });
                    }

                    return res.status(500).json({
                        success: false,
                        error: insertErr.message
                    });
                }

                console.log('Collector created: ' + collector_code + ' - ' + email + ' (group ' + assignedGroup + ')');

                res.json({
                    success: true,
                    message: 'Collector created successfully.',
                    collector: {
                        collector_id: result.insertId,
                        collector_code,
                        email,
                        first_name,
                        last_name,
                        phone,
                        position,
                        group_number: assignedGroup,
                        group_assigned_automatically: group_number === null,
                        account_status: 'active'
                    }
                });
            }
        );
    });
});

/* =========================
   ADMINS (list + create)
========================= */

app.get('/api/admins', (req, res) => {
    const sql = `
        SELECT
            admin_id,
            admin_code,
            email,
            account_status,
            first_name,
            last_name,
            phone,
            admin_role,
            created_by,
            created_at
        FROM admins
        ORDER BY admin_id ASC
    `;

    db.query(sql, (err, rows) => {
        if (err) {
            console.log('List admins error:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Database error.'
            });
        }

        res.json({ success: true, admins: rows });
    });
});

app.post('/api/admins', (req, res) => {
    const first_name = String(req.body.first_name || '').trim();
    const last_name = String(req.body.last_name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').replace(/\D/g, '');
    const password = String(req.body.password || '');
    const created_by = req.body.created_by != null ? Number(req.body.created_by) : null;

    if (!first_name || !last_name || !email || !phone || !password) {
        return res.status(400).json({
            success: false,
            error: 'Please complete all required fields.'
        });
    }

    if (!email.endsWith('@eco.admin')) {
        return res.status(400).json({
            success: false,
            error: 'Admin emails must end with @eco.admin.'
        });
    }

    if (phone.length < 11 || phone.length > 12) {
        return res.status(400).json({
            success: false,
            error: 'Contact number must contain 11 or 12 digits.'
        });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = staffHashPassword(password, salt);
    const password_hash = salt + ':' + hash;

    const codeSql = `
        SELECT COALESCE(
            MAX(CAST(SUBSTRING(admin_code, 5) AS UNSIGNED)),
            0
        ) AS last_number
        FROM admins
        WHERE admin_code LIKE 'ADM-%'
    `;

    db.query(codeSql, (codeErr, codeRows) => {
        if (codeErr) {
            console.log('Admin code error:', codeErr.message);
            return res.status(500).json({
                success: false,
                error: 'Database error.'
            });
        }

        const nextNumber = Number(codeRows[0].last_number) + 1;
        const admin_code = 'ADM-' + String(nextNumber).padStart(3, '0');

        const insertSql = `
            INSERT INTO admins (
                admin_code,
                email,
                password_hash,
                account_status,
                first_name,
                last_name,
                phone,
                admin_role,
                created_by
            ) VALUES (?, ?, ?, 'active', ?, ?, ?, 'admin', ?)
        `;

        db.query(
            insertSql,
            [
                admin_code,
                email,
                password_hash,
                first_name,
                last_name,
                phone,
                created_by
            ],
            (insertErr, result) => {
                if (insertErr) {
                    console.log('Create admin error:', insertErr.message);

                    if (insertErr.code === 'ER_DUP_ENTRY') {
                        return res.status(409).json({
                            success: false,
                            error: 'This email or admin code is already registered.'
                        });
                    }

                    return res.status(500).json({
                        success: false,
                        error: insertErr.message
                    });
                }

                res.json({
                    success: true,
                    message: 'Admin created successfully.',
                    admin: {
                        admin_id: result.insertId,
                        admin_code,
                        email,
                        first_name,
                        last_name,
                        phone,
                        admin_role: 'admin',
                        account_status: 'active'
                    }
                });
            }
        );
    });
});

/* =========================
   COLLECTOR STATUS (activate / deactivate)
========================= */

app.patch('/api/collectors/:id/status', (req, res) => {
    const collectorId = Number(req.params.id);
    const status = String(req.body.account_status || '').toLowerCase();

    if (!collectorId) {
        return res.status(400).json({
            success: false,
            error: 'Invalid collector id.'
        });
    }

    if (status !== 'active' && status !== 'inactive') {
        return res.status(400).json({
            success: false,
            error: 'Status must be active or inactive.'
        });
    }

    const sql = `
        UPDATE collectors
        SET account_status = ?
        WHERE collector_id = ?
    `;

    db.query(sql, [status, collectorId], (err, result) => {
        if (err) {
            console.log('Collector status error:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Database error.'
            });
        }

        if (!result.affectedRows) {
            return res.status(404).json({
                success: false,
                error: 'Collector not found.'
            });
        }

        res.json({
            success: true,
            message: 'Collector status updated.',
            collector_id: collectorId,
            account_status: status
        });
    });
});

/* =========================
   LEADERBOARD
========================= */
app.get('/api/leaderboard', (req, res) => {
    const sql = `
        SELECT
            resident_id,
            account_id,
            first_name,
            last_name,
            ecopoints_balance
        FROM residents
        WHERE account_status = 'active'
        ORDER BY ecopoints_balance DESC, resident_id ASC
        LIMIT 50
    `;

    db.query(sql, (err, rows) => {
        if (err) {
            console.log('Leaderboard error:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Could not load leaderboard.'
            });
        }

        const leaderboard = (rows || []).map((r, index) => ({
            rank: index + 1,
            residentId: r.resident_id,
            accountId: r.account_id,
            name: `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Resident',
            points: Number(r.ecopoints_balance) || 0
        }));

        res.json({ success: true, leaderboard });
    });
});

/* ============================================================
   EXTENDED API
   Rewards, notifications, achievements,
   waste collections, schedules, collector groups and street
   assignments. Kept in its own file so this one stays readable.
   ============================================================ */

require('./api-extended')(app, db);

// Starting a second copy used to print the "running" line and then die
// quietly, which looked like a working server. The listen callback is
// replaced with explicit events so a port clash is reported as one.
let failedToStart = false;

const server = app.listen(PORT);

server.on('listening', () => {
    if (failedToStart) return;

    console.log(`EcoPoints server running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
    failedToStart = true;

    if (err && err.code === 'EADDRINUSE') {
        console.log('');
        console.log('*** Port ' + PORT + ' is already in use. ***');
        console.log('');
        console.log('EcoPoints is already running, so you do not need to start it again.');
        console.log('Just open http://localhost:' + PORT);
        console.log('');
        console.log('To restart it, press Ctrl+C in the terminal that started it');
        console.log('first, then run node server.js again.');
    } else {
        console.error('Server error:', err && err.message);
    }

    process.exit(1);
});