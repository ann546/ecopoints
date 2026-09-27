/* ============================================================
   load-env.js
   Minimal .env reader so the app can be configured without adding a
   dependency. A real environment variable always wins, so a host that
   sets DB_PASSWORD in its dashboard is unaffected by the file.

   The .env file itself is listed in .gitignore and must never be
   committed - it holds the database password.
   ============================================================ */

const fs = require('fs');
const path = require('path');

function loadEnv() {
    const file = path.join(__dirname, '.env');

    let raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
        return;   // no .env is fine - real env vars may be set
    }

    raw.split(/\r?\n/).forEach(function (line) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.charAt(0) === '#') return;

        const eq = trimmed.indexOf('=');
        if (eq === -1) return;

        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();

        // Strip surrounding quotes so a value can contain spaces.
        if (
            (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
            (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")
        ) {
            value = value.slice(1, -1);
        }

        // Never overwrite something the host already provided.
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    });
}

loadEnv();

module.exports = { loadEnv: loadEnv };
