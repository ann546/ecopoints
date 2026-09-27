// Usage:  node try-login.js  your@email.com  YourPassword
const email = process.argv[2];
const password = process.argv[3];
if (!email || !password) { console.log('usage: node try-login.js EMAIL PASSWORD'); process.exit(1); }
fetch('http://localhost:3000/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
}).then(async r => {
    const d = await r.json();
    console.log(d.success
        ? 'OK   ' + d.resident.account_id + '  ' + d.resident.ecopoints_balance + ' pts'
        : 'DENY ' + d.error);
}).catch(e => console.log('ERR  ' + e.message));
