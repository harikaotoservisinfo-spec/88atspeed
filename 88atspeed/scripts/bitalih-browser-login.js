#!/usr/bin/env node
/**
 * İzole süreçte Bi'Talih tarayıcı girişi.
 */
const path = require('path');
const bitalihAuth = require('../lib/bitalih-auth');

function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

(async () => {
    const ssn = process.argv[2] || process.env.BITALIH_USER || '';
    const password = process.argv[3] || process.env.BITALIH_PASS || '';
    if (!ssn || !password) {
        emit({ success: false, error: 'TC ve şifre gerekli', code: 'missing_credentials' });
        process.exit(2);
    }
    try {
        const session = await bitalihAuth.loginWithBrowser(ssn, password);
        emit({
            success: true,
            method: 'browser',
            displayName: [session.playerInfo?.firstname, session.playerInfo?.lastname].filter(Boolean).join(' '),
            balance: session.playerInfo?.wallet?.totalBalance || null
        });
        process.exit(0);
    } catch (err) {
        emit({
            success: false,
            error: err.message || 'Giriş başarısız',
            code: err.code || null
        });
        process.exit(1);
    }
})();
