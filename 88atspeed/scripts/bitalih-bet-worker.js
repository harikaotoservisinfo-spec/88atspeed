#!/usr/bin/env node
/**
 * İzole süreçte Bi'Talih sabit ihtimalli bahis.
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const bitalihBet = require('../lib/bitalih-bet');

function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

(async () => {
    let opts = {};
    try {
        opts = JSON.parse(process.argv[2] || process.env.BITALIH_BET_OPTS || '{}');
    } catch (_) {
        emit({ success: false, error: 'Geçersiz parametre' });
        process.exit(2);
    }
    try {
        const result = await bitalihBet.placeFixedOddsBetInternal(opts);
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
