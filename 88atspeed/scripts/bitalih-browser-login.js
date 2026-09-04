#!/usr/bin/env node
/**
 * İzole süreçte Bi'Talih tarayıcı girişi.
 */
const fs = require('fs');
const bitalihAuth = require('../lib/bitalih-auth');
const jobs = require('../lib/bitalih-jobs');
const { resolveChromePath } = require('../lib/chrome-path');

const jobId = process.env.BITALIH_JOB_ID || '';
let finished = false;

function readCredentials() {
    const fromEnv = {
        ssn: process.env.BITALIH_SSN || process.env.BITALIH_USER || '',
        password: process.env.BITALIH_PASS || ''
    };
    if (fromEnv.ssn && fromEnv.password) return fromEnv;

    const fromArgv = {
        ssn: process.argv[2] || '',
        password: process.argv[3] || ''
    };
    if (fromArgv.ssn && fromArgv.password) return fromArgv;

    const credIdx = process.argv.indexOf('--cred-file');
    if (credIdx >= 0 && process.argv[credIdx + 1]) {
        const credPath = process.argv[credIdx + 1];
        try {
            const data = JSON.parse(fs.readFileSync(credPath, 'utf8'));
            try { fs.unlinkSync(credPath); } catch (_) { /* */ }
            return { ssn: data.ssn || '', password: data.password || '' };
        } catch (_) { /* */ }
    }

    return { ssn: '', password: '' };
}

function emit(obj) {
    if (!jobId) process.stdout.write(JSON.stringify(obj) + '\n');
}

function finish(obj) {
    if (finished) return;
    finished = true;
    if (jobId) {
        if (obj.success) jobs.completeJob(jobId, obj);
        else jobs.failJob(jobId, obj.error, obj.code);
    }
    emit(obj);
}

process.on('uncaughtException', (err) => {
    finish({ success: false, error: err.message || 'Beklenmeyen hata', code: 'crash' });
    process.exit(1);
});
process.on('unhandledRejection', (err) => {
    finish({ success: false, error: (err && err.message) || 'Beklenmeyen hata', code: 'crash' });
    process.exit(1);
});

(async () => {
    if (jobId) jobs.updateJob(jobId, { meta: { phase: 'starting', chromePath: resolveChromePath() } });

    const { ssn, password } = readCredentials();
    if (!ssn || !password) {
        finish({ success: false, error: 'TC ve şifre gerekli', code: 'missing_credentials' });
        process.exit(2);
    }
    if (!resolveChromePath()) {
        finish({
            success: false,
            error: 'Chrome bulunamadı. bash /var/www/88atspeed/deploy/fix-server.sh',
            code: 'no_chrome'
        });
        process.exit(1);
    }
    try {
        if (jobId) jobs.updateJob(jobId, { meta: { phase: 'browser_login' } });
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
