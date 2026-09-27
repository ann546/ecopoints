// MySQL credentials come from the environment. A .env file is read
// here so local runs need no extra tooling; on a host these are set
// as real environment variables instead. See .env.example.
require('./load-env');

function dbPassword() {
    return process.env.DB_PASSWORD || '';
}

/* ============================================================
   api-extended.js
   The EcoPoints API surface that the original server.js did not
   cover. server.js requires this at the bottom and hands over the
   Express app + MySQL connection:

       require('./api-extended')(app, db);

   Everything here is plain Express + mysql2 callbacks, matching the
   style already used in server.js, and every response follows the
   same { success: boolean, ... } envelope the frontend expects.
   ============================================================ */

module.exports = function (app, db) {

    /* --------------------------------------------------------
       Shared helpers
       -------------------------------------------------------- */

    // Pushes a row into the notifications table.
    // Pass recipientId = null to broadcast to everyone in that role.
    function notify(recipientRole, recipientId, category, title, message, linkPage, callback) {
        const done = typeof callback === 'function' ? callback : function () {};

        db.query(
            `INSERT INTO notifications
                (recipient_role, recipient_id, category, title, message, link_page)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [recipientRole, recipientId, category, title, message, linkPage || null],
            function (err) {
                if (err) {
                    // A failed notification must never break the action that
                    // triggered it, so this is logged and swallowed.
                    console.log('Notification insert error:', err.message);
                }
                done(err);
            }
        );
    }

    // Notifies a collector that an admin has assigned them to cover an
    // absent team member's slot. The substitute is looked up by email
    // because that is what the dashboard stores.
    function notifySubstitute(substituteEmail, groupNumber, slot, absentEmail, absentRole) {
        db.query(
            'SELECT collector_id, first_name, last_name FROM collectors WHERE email = ? LIMIT 1',
            [substituteEmail],
            function (lookupErr, rows) {
                if (lookupErr) {
                    console.log('Substitute lookup failed:', lookupErr.message);
                    return;
                }

                if (!rows || !rows.length) {
                    console.log('No collector found for substitute email: ' + substituteEmail);
                    return;
                }

                const sub = rows[0];
                const firstName = String(sub.first_name || '').trim();

                // "ramos" reads better than "ramos@eco.collect" in a notice.
                const who = absentEmail
                    ? String(absentEmail).split('@')[0]
                    : 'a team member';

                const roleText = absentRole ? ' (' + absentRole + ')' : '';

                const title = 'Substitute duty - Group ' + groupNumber;
                const message =
                    'Hi ' + (firstName || 'there') + ', you have been assigned to cover for ' +
                    who + roleText + ' in Group ' + groupNumber + ' today. ' +
                    'Please report to the group before collection starts.';

                notify(
                    'collector',
                    sub.collector_id,
                    'substitute',
                    title,
                    message.slice(0, 255),
                    'Collector Dashboard.html'
                );

                console.log(
                    'Substitute notified: ' + substituteEmail +
                    ' covers slot ' + slot + ' in group ' + groupNumber
                );
            }
        );
    }

    // Tells a substitute they are no longer needed, so nobody turns up
    // for a duty that was cancelled.
    function notifySubstituteStandDown(substituteEmail, groupNumber) {
        db.query(
            'SELECT collector_id, first_name FROM collectors WHERE email = ? LIMIT 1',
            [substituteEmail],
            function (lookupErr, rows) {
                if (lookupErr || !rows || !rows.length) return;

                const sub = rows[0];
                const firstName = String(sub.first_name || '').trim();

                notify(
                    'collector',
                    sub.collector_id,
                    'substitute',
                    'Group ' + groupNumber + ' duty cancelled',
                    'Hi ' + (firstName || 'there') + ', the absence in Group ' + groupNumber +
                    ' has been cleared. You are no longer needed to cover today.',
                    'Collector Dashboard.html'
                );

                console.log('Substitute stood down: ' + substituteEmail);
            }
        );
    }

    // Tells a collector they have been marked absent, so the status is not
    // a silent change made by someone else. Without this, being marked
    // away did nothing visible to the person it applied to.
    function notifyAbsentee(absentEmail, groupNumber, substituteEmail) {
        db.query(
            'SELECT collector_id, first_name FROM collectors WHERE email = ? LIMIT 1',
            [absentEmail],
            function (lookupErr, rows) {
                if (lookupErr || !rows || !rows.length) return;

                const who = rows[0];
                const firstName = String(who.first_name || '').trim();

                const cover = substituteEmail
                    ? String(substituteEmail).split('@')[0] + ' is covering for you.'
                    : 'No substitute has been assigned yet.';

                notify(
                    'collector',
                    who.collector_id,
                    'absence',
                    'You are marked absent today',
                    'Hi ' + (firstName || 'there') + ', an admin marked you absent for Group ' +
                    groupNumber + ' today. ' + cover,
                    'Collector Dashboard.html'
                );

                console.log(
                    'Absentee notified: ' + absentEmail +
                    ' (group ' + groupNumber + ')'
                );
            }
        );
    }

    // Wraps an async route so a thrown error still returns JSON
    // instead of Express's default HTML error page.
    function route(handler) {
        return function (req, res) {
            try {
                handler(req, res);
            } catch (err) {
                console.log('Unhandled route error:', err.message);
                res.status(500).json({ success: false, error: 'Server error.' });
            }
        };
    }

    function toInt(value) {
        const n = Number(value);
        return Number.isInteger(n) && n > 0 ? n : null;
    }

    // The client has always used short string ids for rewards
    // ("rice5", "grocery", ...). Keep handing those back so the
    // existing reward buttons keep working, but take the name, cost
    // and stock from the database instead of hardcoding them.
    const REWARD_SLUGS = {
        '5kg Rice Pack': 'rice5',
        'Grocery Pack': 'grocery',
        'Eco Bag': 'ecobag',
        'Mobile Load (\u20B150)': 'loadcard',
        'Canned Goods Pack': 'canned',
        'Laundry Detergent': 'detergent'
    };

    const REWARD_ICONS = {
        rice5: 'fa-bowl-rice',
        grocery: 'fa-basket-shopping',
        ecobag: 'fa-bag-shopping',
        loadcard: 'fa-mobile-screen',
        canned: 'fa-box',
        detergent: 'fa-soap'
    };

    function slugFor(name) {
        if (REWARD_SLUGS[name]) return REWARD_SLUGS[name];
        return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
    }

    /* ============================================================
       REWARDS CATALOG
       ============================================================ */

    app.get('/api/rewards', route(function (req, res) {
        const includeInactive = req.query.all === '1';

        const sql = `
            SELECT
                reward_id,
                reward_name,
                description,
                points_cost,
                php_value,
                stock,
                is_active
            FROM rewards
            ${includeInactive ? '' : 'WHERE is_active = 1'}
            ORDER BY points_cost ASC
        `;

        db.query(sql, function (err, rows) {
            if (err) {
                console.log('Rewards list error:', err.message);
                return res.status(500).json({ success: false, error: 'Could not load rewards.' });
            }

            const rewards = (rows || []).map(function (r) {
                const slug = slugFor(r.reward_name);
                return {
                    reward_id: r.reward_id,
                    id: slug,
                    slug: slug,
                    name: r.reward_name,
                    description: r.description,
                    cost: Number(r.points_cost),
                    points_cost: Number(r.points_cost),
                    phpValue: Number(r.php_value || 0),
                    stock: Number(r.stock || 0),
                    inStock: Number(r.stock || 0) > 0,
                    is_active: !!r.is_active,
                    icon: REWARD_ICONS[slug] || 'fa-gift'
                };
            });

            res.json({ success: true, rewards: rewards });
        });
    }));

    // Admin creates a reward
    app.post('/api/rewards', route(function (req, res) {
        const name = String(req.body.reward_name || '').trim();
        const cost = Number(req.body.points_cost);
        const phpValue = Number(req.body.php_value || 0);
        const stock = Number(req.body.stock || 0);
        const description = String(req.body.description || '').trim() || null;
        const createdBy = toInt(req.body.created_by);

        if (!name) {
            return res.status(400).json({ success: false, error: 'Reward name is required.' });
        }
        if (!Number.isFinite(cost) || cost <= 0) {
            return res.status(400).json({ success: false, error: 'Points cost must be greater than 0.' });
        }

        db.query(
            `INSERT INTO rewards
                (reward_name, description, points_cost, php_value, stock, is_active, created_by)
             VALUES (?, ?, ?, ?, ?, 1, ?)`,
            [name, description, cost, phpValue, stock, createdBy],
            function (err, result) {
                if (err) {
                    console.log('Create reward error:', err.message);
                    return res.status(500).json({ success: false, error: 'Could not create the reward.' });
                }
                res.json({ success: true, reward_id: result.insertId });
            }
        );
    }));

    app.patch('/api/rewards/:id', route(function (req, res) {
        const rewardId = toInt(req.params.id);
        if (!rewardId) {
            return res.status(400).json({ success: false, error: 'Invalid reward ID.' });
        }

        const sets = [];
        const values = [];

        if (req.body.reward_name != null) { sets.push('reward_name = ?'); values.push(String(req.body.reward_name).trim()); }
        if (req.body.description != null) { sets.push('description = ?'); values.push(String(req.body.description).trim() || null); }
        if (req.body.points_cost != null) { sets.push('points_cost = ?'); values.push(Number(req.body.points_cost)); }
        if (req.body.php_value != null) { sets.push('php_value = ?'); values.push(Number(req.body.php_value)); }
        if (req.body.stock != null) { sets.push('stock = ?'); values.push(Number(req.body.stock)); }
        if (req.body.is_active != null) { sets.push('is_active = ?'); values.push(req.body.is_active ? 1 : 0); }

        if (!sets.length) {
            return res.status(400).json({ success: false, error: 'Nothing to update.' });
        }

        values.push(rewardId);

        db.query(
            'UPDATE rewards SET ' + sets.join(', ') + ' WHERE reward_id = ?',
            values,
            function (err, result) {
                if (err) {
                    console.log('Update reward error:', err.message);
                    return res.status(500).json({ success: false, error: 'Could not update the reward.' });
                }
                if (!result.affectedRows) {
                    return res.status(404).json({ success: false, error: 'Reward not found.' });
                }
                res.json({ success: true });
            }
        );
    }));

    /* ============================================================
       RESIDENT DIRECTORY  (admin-side listings)
       ============================================================ */

    app.get('/api/residents', route(function (req, res) {
        const search = String(req.query.search || '').trim();
        const status = String(req.query.status || 'active').trim();
        const limit = Math.min(Number(req.query.limit) || 200, 1000);

        const where = [];
        const params = [];

        if (status && status !== 'all') {
            where.push('account_status = ?');
            params.push(status);
        }

        if (search) {
            where.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR account_id LIKE ? OR CONCAT(first_name, " ", last_name) LIKE ?)');
            const like = '%' + search + '%';
            params.push(like, like, like, like, like);
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
                (
                    SELECT COUNT(*) FROM resident_points_history h
                     WHERE h.resident_id = r.resident_id
                       AND h.entry_type = 'scan'
                ) AS submissions_count,
                (
                    SELECT COUNT(*) FROM waste_collections w
                     WHERE w.resident_id = r.resident_id
                ) AS collections_count
            FROM residents r
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ORDER BY r.resident_id ASC
            LIMIT ${Number(limit) || 200}
        `;

        db.query(sql, params, function (err, rows) {
            if (err) {
                console.log('Resident list error:', err.message);
                return res.status(500).json({ success: false, error: 'Could not load residents.' });
            }

            const residents = (rows || []).map(function (r) {
                return {
                    resident_id: r.resident_id,
                    account_id: r.account_id,
                    email: r.email,
                    first_name: r.first_name,
                    last_name: r.last_name,
                    name: (r.first_name + ' ' + r.last_name).trim(),
                    phone: r.phone,
                    house_number: r.house_number,
                    street: r.street,
                    street_classification: r.street_classification,
                    qr_code_value: r.qr_code_value,
                    ecopoints_balance: Number(r.ecopoints_balance || 0),
                    points: Number(r.ecopoints_balance || 0),
                    account_status: r.account_status,
                    created_at: r.created_at,
                    submissions_count: Number(r.submissions_count || 0),
                    collections_count: Number(r.collections_count || 0)
                };
            });

            res.json({ success: true, residents: residents, count: residents.length });
        });
    }));

    /* ============================================================
       SITE STATISTICS  (homepage stats bar)
       ============================================================ */

    app.get('/api/site-stats', route(function (req, res) {
        const householdsSql = `
            SELECT COUNT(*) AS n
            FROM residents
            WHERE account_status = 'active'
        `;

        const monthStartSql = `
            SELECT COALESCE(SUM(weight_kg), 0) AS kg
            FROM waste_collections
            WHERE collected_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
        `;

        // Peso value of every reward that was actually claimed, so the
        // figure matches what residents really received.
        const distributedSql = `
            SELECT COALESCE(SUM(r.php_value), 0) AS php
            FROM resident_reward_redemptions rr
            JOIN rewards r ON r.reward_name = rr.reward_name
            WHERE rr.redemption_status IN ('pending', 'claimed')
        `;

        const totalResidentsSql = `
            SELECT COUNT(*) AS n FROM residents
        `;

        db.query(householdsSql, function (e1, r1) {
            if (e1) return statsError(res, e1, 'site-stats');

            db.query(monthStartSql, function (e2, r2) {
                if (e2) return statsError(res, e2, 'site-stats');

                db.query(distributedSql, function (e3, r3) {
                    if (e3) return statsError(res, e3, 'site-stats');

                    db.query(totalResidentsSql, function (e4, r4) {
                        if (e4) return statsError(res, e4, 'site-stats');

                        const kg = Number(r2[0].kg || 0);

                        res.json({
                            success: true,
                            stats: {
                                households: Number(r1[0].n || 0),
                                totalResidents: Number(r4[0].n || 0),
                                kgThisMonth: kg,
                                tonsThisMonth: Math.round((kg / 1000) * 1000) / 1000,
                                phpDistributed: Number(r3[0].php || 0)
                            }
                        });
                    });
                });
            });
        });

        function statsError(res, err, label) {
            console.log(label + ' error:', err.message);
            res.status(500).json({ success: false, error: 'Could not load statistics.' });
        }
    }));

    /* ============================================================
       NOTIFICATIONS
       recipient_id NULL = broadcast to the whole role
       ============================================================ */

    app.get('/api/notifications', route(function (req, res) {
        const role = String(req.query.role || '').trim().toLowerCase();
        const recipientId = toInt(req.query.recipient_id);
        const limit = Math.min(Number(req.query.limit) || 50, 200);

        if (!role) {
            return res.status(400).json({ success: false, error: 'Role is required.' });
        }

        // Direct messages plus role-wide broadcasts.
        const params = [role];
        let recipientClause = '';

        if (recipientId) {
            recipientClause = 'AND (recipient_id = ? OR recipient_id IS NULL)';
            params.push(recipientId);
        } else {
            recipientClause = 'AND recipient_id IS NULL';
        }

        params.push(limit);

        const sql = `
            SELECT
                notification_id,
                recipient_role,
                recipient_id,
                category,
                title,
                message,
                link_page,
                is_read,
                read_at,
                created_at
            FROM notifications
            WHERE recipient_role = ?
              ${recipientClause}
            ORDER BY created_at DESC, notification_id DESC
            LIMIT ${Number(limit) || 50}
        `;

        db.query(sql, params, function (err, rows) {
            if (err) {
                console.log('Notifications list error:', err.message);
                return res.status(500).json({ success: false, error: 'Could not load notifications.' });
            }

            const notifications = (rows || []).map(function (n) {
                return {
                    id: n.notification_id,
                    notification_id: n.notification_id,
                    category: n.category,
                    title: n.title,
                    message: n.message,
                    link: n.link_page,
                    read: !!n.is_read,
                    read_at: n.read_at,
                    ts: n.created_at,
                    date: n.created_at
                };
            });

            const unread = notifications.filter(function (n) { return !n.read; }).length;

            res.json({
                success: true,
                notifications: notifications,
                unreadCount: unread
            });
        });
    }));

    app.post('/api/notifications', route(function (req, res) {
        const role = String(req.body.recipient_role || '').trim().toLowerCase();
        const recipientId = toInt(req.body.recipient_id);
        const category = String(req.body.category || 'general').trim();
        const title = String(req.body.title || '').trim();
        const message = String(req.body.message || '').trim();
        const linkPage = String(req.body.link_page || '').trim() || null;

        if (['resident', 'collector', 'admin'].indexOf(role) === -1) {
            return res.status(400).json({ success: false, error: 'Role must be resident, collector or admin.' });
        }
        if (!title || !message) {
            return res.status(400).json({ success: false, error: 'Title and message are required.' });
        }

        notify(role, recipientId, category, title, message, linkPage, function (err) {
            if (err) {
                return res.status(500).json({ success: false, error: 'Could not send the notification.' });
            }
            res.json({ success: true });
        });
    }));

    app.patch('/api/notifications/:id/read', route(function (req, res) {
        const id = toInt(req.params.id);
        if (!id) {
            return res.status(400).json({ success: false, error: 'Invalid notification ID.' });
        }

        db.query(
            `UPDATE notifications
                SET is_read = 1, read_at = NOW()
              WHERE notification_id = ?
                AND is_read = 0`,
            [id],
            function (err) {
                if (err) {
                    console.log('Mark read error:', err.message);
                    return res.status(500).json({ success: false, error: 'Could not update the notification.' });
                }
                res.json({ success: true });
            }
        );
    }));

    app.post('/api/notifications/read-all', route(function (req, res) {
        const role = String(req.body.role || '').trim().toLowerCase();
        const recipientId = toInt(req.body.recipient_id);

        if (!role) {
            return res.status(400).json({ success: false, error: 'Role is required.' });
        }

        const params = [role];
        let clause = '';

        if (recipientId) {
            clause = 'AND (recipient_id = ? OR recipient_id IS NULL)';
            params.push(recipientId);
        } else {
            clause = 'AND recipient_id IS NULL';
        }

        db.query(
            `UPDATE notifications
                SET is_read = 1, read_at = NOW()
              WHERE recipient_role = ?
                AND is_read = 0
                ${clause}`,
            params,
            function (err) {
                if (err) {
                    console.log('Mark all read error:', err.message);
                    return res.status(500).json({ success: false, error: 'Could not update notifications.' });
                }
                res.json({ success: true });
            }
        );
    }));

    /* ============================================================
       ACHIEVEMENTS
       Awarding is idempotent per resident + badge key, so visiting
       Achievements.html repeatedly can never pay a badge twice.
       ============================================================ */

    app.get('/api/residents/:id/achievements', route(function (req, res) {
        const residentId = toInt(req.params.id);
        if (!residentId) {
            return res.status(400).json({ success: false, error: 'Invalid resident ID.' });
        }

        db.query(
            `SELECT achievement_key, label, points_awarded, unlocked_at
               FROM resident_achievements
              WHERE resident_id = ?
              ORDER BY unlocked_at ASC`,
            [residentId],
            function (err, rows) {
                if (err) {
                    console.log('Achievements list error:', err.message);
                    return res.status(500).json({ success: false, error: 'Could not load achievements.' });
                }

                res.json({
                    success: true,
                    achievements: (rows || []).map(function (a) {
                        return {
                            key: a.achievement_key,
                            id: a.achievement_key,
                            label: a.label,
                            points: Number(a.points_awarded || 0),
                            unlocked_at: a.unlocked_at
                        };
                    })
                });
            }
        );
    }));

    app.post('/api/residents/:id/achievements', route(function (req, res) {
        const residentId = toInt(req.params.id);
        const key = String(req.body.achievement_key || '').trim();
        const label = String(req.body.label || '').trim();
        const points = Number(req.body.points || 0);

        if (!residentId) {
            return res.status(400).json({ success: false, error: 'Invalid resident ID.' });
        }
        if (!key) {
            return res.status(400).json({ success: false, error: 'Achievement key is required.' });
        }
        if (!Number.isFinite(points) || points < 0) {
            return res.status(400).json({ success: false, error: 'Points must be zero or more.' });
        }

        const conn = require('mysql2').createConnection({
            host: 'localhost',
            user: 'ecopoints_app',
            password: dbPassword(),
            database: 'ecopoints_db'
        });

        conn.beginTransaction(function (err) {
            if (err) {
                conn.end();
                return res.status(500).json({ success: false, error: 'Could not award the achievement.' });
            }

            // The UNIQUE key on (resident_id, achievement_key) is what makes
            // this safe to call on every page load.
            conn.query(
                `INSERT IGNORE INTO resident_achievements
                    (resident_id, achievement_key, label, points_awarded)
                 VALUES (?, ?, ?, ?)`,
                [residentId, key, label || key, points],
                function (err2, result) {
                    if (err2) {
                        return conn.rollback(function () {
                            conn.end();
                            res.status(500).json({ success: false, error: 'Could not award the achievement.' });
                        });
                    }

                    // affectedRows === 0 means this badge was already unlocked.
                    if (!result.affectedRows) {
                        return conn.rollback(function () {
                            conn.end();
                            res.json({
                                success: true,
                                awarded: false,
                                message: 'Achievement already unlocked.'
                            });
                        });
                    }

                    conn.query(
                        `UPDATE residents
                            SET ecopoints_balance = ecopoints_balance + ?
                          WHERE resident_id = ?
                            AND account_status = 'active'`,
                        [points, residentId],
                        function (err3) {
                            if (err3) {
                                return conn.rollback(function () {
                                    conn.end();
                                    res.status(500).json({ success: false, error: 'Could not award the achievement.' });
                                });
                            }

                            conn.query(
                                `INSERT INTO resident_points_history
                                    (resident_id, entry_type, description, points)
                                 VALUES (?, 'achievement', ?, ?)`,
                                [residentId, 'Achievement Unlocked: ' + (label || key), points],
                                function (err4) {
                                    if (err4) {
                                        return conn.rollback(function () {
                                            conn.end();
                                            res.status(500).json({ success: false, error: 'Could not record the achievement.' });
                                        });
                                    }

                                    conn.query(
                                        'SELECT ecopoints_balance FROM residents WHERE resident_id = ?',
                                        [residentId],
                                        function (err5, rows) {
                                            conn.commit(function () {
                                                conn.end();

                                                if (err5 || !rows || !rows.length) {
                                                    return res.json({ success: true, awarded: true, newBalance: null });
                                                }

                                                const newBalance = Number(rows[0].ecopoints_balance);

                                                notify(
                                                    'resident',
                                                    residentId,
                                                    'achievement',
                                                    'Achievement unlocked!',
                                                    'You earned ' + points + ' EcoPoints for "' + (label || key) + '".',
                                                    'Achievements.html'
                                                );

                                                res.json({
                                                    success: true,
                                                    awarded: true,
                                                    newBalance: newBalance
                                                });
                                            });
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        });
    }));

    // Routes rebuilt after an accidental bulk delete of this file.
    require('./api-rebuilt')(app, db);
};