// Applies migrations.sql + guarded column changes to ecopoints_db.
// Run with:  node apply-migrations.js
// Safe to run repeatedly - every step checks before it acts.

// MySQL credentials come from the environment. A .env file is read
// here so local runs need no extra tooling; on a host these are set
// as real environment variables instead. See .env.example.
require('./load-env');

function dbPassword() {
    return process.env.DB_PASSWORD || '';
}

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');

const c = mysql.createConnection({
    host: 'localhost',
    user: 'ecopoints_app',
    // Called, not passed: handing mysql2 the function itself made every
    // migration fail with "using password: NO".
    password: dbPassword(),
    database: 'ecopoints_db'
});

function fail(msg) {
    console.error('ERROR:', msg);
    c.end();
    process.exit(1);
}

c.connect(err => {
    if (err) fail('Connection failed: ' + err.message);

    /* ---------- Step 1: CREATE TABLE statements from migrations.sql ---------- */

    const sql = fs.readFileSync(path.join(__dirname, 'migrations.sql'), 'utf8');

    const statements = sql
        .split(';')
        .map(s => s.replace(/^\s*--.*$/gm, '').trim())
        .filter(s => s.length > 0);

    console.log('Applying ' + statements.length + ' table statements...');

    let i = 0;

    const runStatements = () => {
        if (i >= statements.length) return addAbsenceColumns();

        const stmt = statements[i++];

        c.query(stmt, err => {
            if (err) fail('Statement failed: ' + err.message + '\n---\n' + stmt.slice(0, 120));
            runStatements();
        });
    };

    /* ---------- Step 1b: who was absent ----------
       collector_absences only stored the slot number, so there was no
       record of WHICH collector was away - the information needed for an
       attendance history. Both columns are nullable so existing rows stay
       valid. MySQL has no "ADD COLUMN IF NOT EXISTS", so each one is
       guarded through information_schema. */

    const addColumn = (table, column, definition, after, next) => {
        c.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = ?
                AND COLUMN_NAME = ?`,
            [table, column],
            (err, rows) => {
                if (err) fail('Column check failed: ' + err.message);

                if (rows[0].n > 0) {
                    console.log('  --  ' + table + '.' + column + ' already present');
                    return next();
                }

                c.query(
                    'ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition + ' ' + after,
                    err2 => {
                        if (err2) fail('ALTER ' + table + '.' + column + ' failed: ' + err2.message);
                        console.log('  ++  ' + table + '.' + column + ' added');
                        next();
                    }
                );
            }
        );
    };

    const addAbsenceColumns = () =>
        addColumn(
            'collector_absences',
            'absent_collector_id',
            'INT(10) UNSIGNED NULL',
            'AFTER slot',
            () =>
                addColumn(
                'collector_absences',
                'absent_email',
                'VARCHAR(120) NULL',
                'AFTER absent_collector_id',
                () => {
                    c.query(
                        `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
                          WHERE TABLE_SCHEMA = DATABASE()
                            AND TABLE_NAME = 'collector_absences'
                            AND INDEX_NAME = 'idx_absence_collector'`,
                        (e3, r3) => {
                            if (e3) fail('Index check failed: ' + e3.message);

                            if (r3[0].n > 0) {
                                console.log('  --  idx_absence_collector already present');
                                // Hand over to the next step rather than
                                // jumping straight to the seed, or the
                                // chain runs twice and queries a closed
                                // connection.
                                return addPhpValue();
                            }

                            c.query(
                                'ALTER TABLE collector_absences ADD INDEX idx_absence_collector (absent_collector_id, absence_date)',
                                e4 => {
                                    if (e4) fail('Index add failed: ' + e4.message);
                                    console.log('  ++  idx_absence_collector added');
                                    addPhpValue();
                                }
                            );
                        }
                    );
                }
            )
    );

    /* ---------- Step 2: rewards.php_value (guarded ALTER) ----------
       Holds the real peso value of each reward, backing the "Rewards
       Distributed" figure on the homepage that used to be hardcoded in
       JS. MySQL has no "ADD COLUMN IF NOT EXISTS", so check
       information_schema first. */

    const addPhpValue = () => {
        c.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'rewards'
                AND COLUMN_NAME = 'php_value'`,
            (err, rows) => {
                if (err) fail('Column check failed: ' + err.message);

                if (rows[0].n > 0) {
                    console.log('  --  rewards.php_value already present');
                    return seedPhpValues();
                }

                c.query(
                    `ALTER TABLE rewards
                        ADD COLUMN php_value INT(10) UNSIGNED NOT NULL DEFAULT 0
                        AFTER points_cost`,
                    err2 => {
                        if (err2) fail('ALTER rewards failed: ' + err2.message);
                        console.log('  ++  rewards.php_value added');
                        seedPhpValues();
                    }
                );
            }
        );
    };

    // Peso values that were previously hardcoded in user-module.js
    const PHP_VALUES = [
        ['5kg Rice Pack', 250],
        ['Grocery Pack', 500],
        ['Eco Bag', 100],
        ['Mobile Load (\u20B150)', 50],
        ['Canned Goods Pack', 150],
        ['Laundry Detergent', 120]
    ];

    const seedPhpValues = () => {
        let j = 0;

        const next = () => {
            if (j >= PHP_VALUES.length) return verify();

            const [name, value] = PHP_VALUES[j++];

            c.query(
                'UPDATE rewards SET php_value = ? WHERE reward_name = ?',
                [value, name],
                () => next()
            );
        };

        next();
    };

    /* ---------- Step 3: verify ---------- */

    const verify = () => {
        c.query('SHOW TABLES', (err, rows) => {
            if (err) fail('Could not list tables: ' + err.message);

            const names = rows.map(r => Object.values(r)[0]);

            console.log('');
            ['notifications', 'resident_achievements', 'password_reset_tokens', 'collector_absences']
                .forEach(t => console.log('  ' + (names.includes(t) ? 'OK  ' : 'FAIL') + ' ' + t));

            c.query(
                `SELECT reward_name, points_cost, php_value FROM rewards ORDER BY reward_id`,
                (err2, rewards) => {
                    if (!err2 && rewards.length) {
                        console.log('');
                        console.table(rewards);
                    }

                    console.log('\nMigrations applied.');
                    c.end();
                }
            );
        });
    };

    runStatements();
});
