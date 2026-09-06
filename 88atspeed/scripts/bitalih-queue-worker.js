/**
 * Bi'Talih iş kuyruğu — ana sunucudan bağımsız PM2 worker.
 */
const fs = require('fs');
const path = require('path');

const QUEUE_DIR = path.join(__dirname, '..', 'data', 'bitalih-queue');
const HEARTBEAT_FILE = path.join(__dirname, '..', 'data', 'bitalih-worker-heartbeat.json');

function ensureQueueDir() {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
}

function writeHeartbeat(busy, task) {
    try {
        fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify({
            at: Date.now(),
            busy: !!busy,
            task: task || null,
            pid: process.pid
        }));
    } catch (_) { /* */ }
}

let busy = false;

async function processOne() {
    if (busy) return;
    ensureQueueDir();
    const files = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith('.json')).sort();
    if (!files.length) {
        writeHeartbeat(false);
        return;
    }

    busy = true;
    const file = files[0];
    const filePath = path.join(QUEUE_DIR, file);
    let task = null;
    try {
        task = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        fs.unlinkSync(filePath);
    } catch (err) {
        busy = false;
        writeHeartbeat(false);
        return;
    }

    writeHeartbeat(true, task.type);
    const jobs = require('../lib/bitalih-jobs');

    try {
        if (task.type === 'login') {
            const bitalihAuth = require('../lib/bitalih-auth');
            const session = await bitalihAuth.loginWithBrowser(task.ssn, task.password);
            jobs.completeJob(task.jobId, {
                success: true,
                method: 'browser',
                loggedIn: true,
                displayName: [session.playerInfo?.firstname, session.playerInfo?.lastname].filter(Boolean).join(' '),
                balance: session.playerInfo?.wallet?.totalBalance || null
            });
        } else if (task.type === 'bet') {
            const bitalihBet = require('../lib/bitalih-bet');
            const result = await bitalihBet.placeFixedOddsBetInternal(task.opts || {});
            jobs.completeJob(task.jobId, result);
        } else {
            jobs.failJob(task.jobId, 'Bilinmeyen iş tipi: ' + task.type, 'bad_task');
        }
    } catch (err) {
        jobs.failJob(task.jobId, err.message || 'İşlem başarısız', err.code || null);
    }

    busy = false;
    writeHeartbeat(false);
}

writeHeartbeat(false);
setInterval(() => writeHeartbeat(busy), 10000);
setInterval(() => {
    processOne().catch((err) => {
        console.error('bitalih-worker:', err.message);
        busy = false;
        writeHeartbeat(false);
    });
}, 1000);

console.log('Bi\'Talih queue worker started (pid ' + process.pid + ')');
