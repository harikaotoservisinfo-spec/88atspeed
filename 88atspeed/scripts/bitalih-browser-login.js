#!/usr/bin/env node
/**
 * İzole süreçte Bi'Talih tarayıcı girişi.
 */
const bitalihAuth = require('../lib/bitalih-auth');
const jobs = require('../lib/bitalih-jobs');

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
    const ssn = process.argv[2] || process.env.BITALIH_USER || '';
    const password = process.argv[3] || process.env.BITALIH_PASS || '';
    if (!ssn || !password) {
        finish({ success: false, error: 'TC ve şifre gerekli', code: 'missing_credentials' });
        process.exit(2);
    }
    try {
        const session = await bitalihAuth.loginWithBrowser(ssn, password);
        finish({
            success: true,
            method: 'browser',
            loggedIn: true,
            displayName: [session.playerInfo?.firstname, session.playerInfo?.lastname].filter(Boolean).join(' '),
            balance: session.playerInfo?.wallet?.totalBalance || null
        });
        process.exit(0);
    } catch (err) {
        finish({
            success: false,
            error: err.message || 'Giriş başarısız',
            code: err.code || null
        });
        process.exit(1);
    }
})();
