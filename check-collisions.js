/* ============================================================
   check-collisions.js
   Run:  node check-collisions.js

   Finds top-level `const`/`let` identifiers declared in more than one
   classic script on the same page.

   Why this is needed: classic <script> tags share one global scope, so
   two files declaring `const SESSION_KEY` is a hard SyntaxError that
   kills the whole script at parse time. `node --check` cannot catch it
   because it only ever parses a single file in isolation - the page
   only breaks in the browser.

   It has already caught two real breakages (Collector Profile.js and
   Collector Notifications.js both collided with auth-common.js), so
   run it after adding or renaming any page script.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const dir = __dirname;

// Server-side and injected scripts are not part of a page's scope.
const SKIP = new Set([
    'api-client.js',
    'api-extended.js',
    'legacy-bridge.js',
    'server.js',
    'apply-migrations.js',
    'check-collisions.js',
]);

let problems = 0;
let pages = 0;

fs.readdirSync(dir)
    .filter(f => f.endsWith('.html'))
    .forEach(html => {
        const src = fs.readFileSync(path.join(dir, html), 'utf8');

        // Local classic scripts only; CDN ones are out of our control.
        const scripts = [...src.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)]
            .map(m => path.basename(m[1]))
            .filter(n =>
                !/^https?:/i.test(n) &&
                !SKIP.has(n) &&
                fs.existsSync(path.join(dir, n))
            );

        if (scripts.length < 2) return;
        pages++;

        // identifier -> Set of files declaring it
        const owners = new Map();

        scripts.forEach(name => {
            const code = fs.readFileSync(path.join(dir, name), 'utf8');

            // Top level only. This codebase indents everything inside a
            // function or block, so requiring column 0 is a good filter.
            const re = /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/gm;
            let m;

            while ((m = re.exec(code))) {
                const id = m[1];
                if (!owners.has(id)) owners.set(id, new Set());
                owners.get(id).add(name);
            }
        });

        const clashes = [...owners.entries()].filter(([, files]) => files.size > 1);

        if (clashes.length) {
            console.log('\n' + html);
            clashes.forEach(([id, files]) => {
                console.log('   ' + id.padEnd(28) + ' <- ' + [...files].join(', '));
                problems++;
            });
        }
    });

console.log(
    '\nchecked ' + pages + ' page(s) - ' +
    (problems ? problems + ' colliding identifier(s)' : 'no cross-file collisions')
);

process.exitCode = problems ? 1 : 0;
