/**
 * Bi'Talih arka plan işleri — uzun Puppeteer süreçleri ana sunucuyu bloke etmez.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const JOBS_DIR = path.join(__dirname, '..', 'data', 'bitalih-jobs');
const JOB_TTL_MS = 30 * 60 * 1000;

function ensureJobsDir() {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function jobPath(id) {
    return path.join(JOBS_DIR, id + '.json');
}

function createJob(type, meta) {
    ensureJobsDir();
    const id = crypto.randomBytes(8).toString('hex');
    const job = {
        id,
        type,
        status: 'running',
        createdAt: Date.now(),
        meta: meta || null,
        result: null,
        error: null
    };
    fs.writeFileSync(jobPath(id), JSON.stringify(job));
    return job;
}

function readJob(id) {
    if (!id) return null;
    try {
        const raw = fs.readFileSync(jobPath(id), 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function updateJob(id, patch) {
    const job = readJob(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: Date.now() });
    fs.writeFileSync(jobPath(id), JSON.stringify(job));
    return job;
}

function completeJob(id, result) {
    return updateJob(id, { status: 'done', result, error: null });
}

function failJob(id, error, code) {
    return updateJob(id, {
        status: 'failed',
        error: error || 'İşlem başarısız',
        code: code || null,
        result: null
    });
}

function pruneOldJobs() {
    ensureJobsDir();
    const now = Date.now();
    for (const file of fs.readdirSync(JOBS_DIR)) {
        if (!file.endsWith('.json')) continue;
        try {
            const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, file), 'utf8'));
            if (now - (job.createdAt || 0) > JOB_TTL_MS) {
                fs.unlinkSync(path.join(JOBS_DIR, file));
            }
        } catch (_) { /* */ }
    }
}

module.exports = {
    JOBS_DIR,
    createJob,
    readJob,
    updateJob,
    completeJob,
    failJob,
    pruneOldJobs
};
