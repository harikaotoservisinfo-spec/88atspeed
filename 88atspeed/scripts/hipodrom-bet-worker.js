#!/usr/bin/env node
/**
 * İzole süreçte sabit ihtimalli bahis — ana sunucuyu çökertmez.
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const hipBet = require('../lib/hipodrom-bet');

function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

(async () => {
    let opts = {};
    try {
        opts = JSON.parse(process.argv[2] || process.env.HIP_BET_OPTS || '{}');
    } catch (_) {
        emit({ success: false, error: 'Geçersiz parametre' });
        process.exit(2);
    }
    try {
        const result = await hipBet.placeFixedOddsBetInternal(opts);
        emit(result);
        process.exit(0);
    } catch (err) {
        emit({
            success: false,
            error: err.message || 'Bahis başarısız',
            code: err.code || null,
            detail: err.detail || null
        });
        process.exit(1);
    }
})();
