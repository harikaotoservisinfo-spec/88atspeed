#!/usr/bin/env node
/**
 * İzole süreçte Hipodrom tarayıcı girişi — ana sunucuyu çökertmez.
 * Kullanım: node scripts/hipodrom-browser-login.js <username> <password>
 */
const path = require('path');
const fs = require('fs');
const hip = require('../lib/hipodrom-auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'hipodrom-tokens.json');

function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

(async () => {
    const username = process.argv[2] || process.env.HIP_USER || '';
    const password = process.argv[3] || process.env.HIP_PASS || '';
    if (!username || !password) {
        emit({ success: false, error: 'Kullanıcı adı ve şifre gerekli', code: 'missing_credentials' });
        process.exit(2);
    }
    try {
        const tokens = await hip.loginWithBrowser(username, password);
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(TOKENS_FILE, JSON.stringify({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken || null
        }));
        emit({ success: true, method: 'browser' });
        process.exit(0);
    } catch (err) {
        emit({
            success: false,
            error: err.message || 'Giriş başarısız',
            code: err.code || null,
            needsCaptcha: !!err.needsCaptcha
        });
        process.exit(1);
    }
})();
