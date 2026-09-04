#!/usr/bin/env node
/**
 * İzole süreçte Bi'Talih sabit ihtimalli bahis.
 */
const path = require('path');
const jobs = require('../lib/bitalih-jobs');

process.chdir(path.join(__dirname, '..'));

const bitalihBet = require('../lib/bitalih-bet');
const jobId = process.env.BITALIH_JOB_ID || '';

function emit(obj) {
    if (!jobId) process.stdout.write(JSON.stringify(obj) + '\n');
}

function finish(obj) {
    if (jobId) {
        if (obj.success) jobs.completeJob(jobId, obj);
        else jobs.failJob(jobId, obj.error, obj.code);
    }
    emit(obj);
}

(async () => {
    let opts = {};
    try {
        opts = JSON.parse(process.argv[2] || process.env.BITALIH_BET_OPTS || '{}');
    } catch (_) {
        finish({ success: false, error: 'Geçersiz parametre' });
        process.exit(2);
    }
    try {
        const result = await bitalihBet.placeFixedOddsBetInternal(opts);
        finish(result);
        process.exit(0);
    } catch (err) {
        finish({
            success: false,
            error: err.message || 'Bahis başarısız',
            code: err.code || null,
            detail: err.detail || null
        });
        process.exit(1);
    }
})();
