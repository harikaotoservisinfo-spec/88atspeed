const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const tjkScrape = require('./lib/tjk-scrape');
const { buildCalibrationFlat, clearCalibrationFlatCache } = require('./lib/calibration-flat-build');
const { buildCalibrationBundle, clearCalibrationBundleCache, getBundleStatus, primeBundleFromDisk, scheduleBackgroundRebuild } = require('./lib/calibration-bundle');
const adminAuth = require('./lib/admin-auth');
const publicProgram = require('./lib/public-program');
const raceMetaEnrich = require('./lib/race-meta-enrich');
const muhtemellerFetch = require('./lib/muhtemeller-fetch');
const yenibeygirBlt = require('./lib/yenibeygir-blt');
const liderformGp = require('./lib/liderform-gp');
const hipodromFob = require('./lib/hipodrom-fob');
const bitalihFob = require('./lib/bitalih-fob');
const publicSonuclar = require('./lib/public-sonuclar');
const publicSonucStore = require('./lib/public-sonuc-store');
const sonucPoller = require('./lib/public-sonuc-poller');
const programScheduler = require('./lib/public-program-scheduler');
const tjkTvProxy = require('./lib/tjk-tv-proxy');
const hipodromAuth = require('./lib/hipodrom-auth');
const hipodromBet = require('./lib/hipodrom-bet');
const hipodromBrowser = require('./lib/hipodrom-browser');
const bitalihBet = require('./lib/bitalih-bet');
const bitalihAutoConfig = require('./lib/bitalih-auto-config');
const { resolveChromePath } = require('./lib/chrome-path');
const publicTahminBuild = require('./lib/public-tahmin-build');
const app = express();
const PORT = Number(process.env.PORT) || 3023;
const HOST = process.env.HOST || '0.0.0.0';

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'data', 'bitalih-jobs'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'data', 'bitalih-queue'), { recursive: true });

process.on('uncaughtException', (err) => {
    console.error('uncaughtException:', err.stack || err.message);
});
process.on('unhandledRejection', (err) => {
    console.error('unhandledRejection:', err && (err.stack || err.message));
});

// Nginx X-Forwarded-Proto ile HTTPS algısı (Secure çerez için)
app.set('trust proxy', 1);

let browser = null;

// SQLite Veritabanı Bağlantısı
const db = new sqlite3.Database('atlar.db');
db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA busy_timeout = 5000');
publicProgram.ensureTables(db)
    .then(() => publicProgram.archivePastPublicPrograms(db))
    .then(() => publicProgram.startTjkListWarmer())
    .catch((e) => console.warn('public_gunluk_program setup:', e.message));

const hipodromCache = new Map();
const HIPODROM_CACHE_MS = 10 * 60 * 1000;

function getCachedHipodromlar(tarih) {
    const entry = hipodromCache.get(tarih);
    if (!entry || Date.now() - entry.at > HIPODROM_CACHE_MS) return null;
    return entry.hipodromlar;
}

function setCachedHipodromlar(tarih, hipodromlar) {
    hipodromCache.set(tarih, { at: Date.now(), hipodromlar });
}

function queryHipodromlarFromDb(tarih) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT DISTINCT hipodrom_id AS id, hipodrom AS name FROM at_verileri
            WHERE tarih = ? AND hipodrom_id IS NOT NULL AND hipodrom_id != ''
            UNION
            SELECT DISTINCT hipodrom_id AS id, hipodrom AS name FROM hesaplama_kayitlari
            WHERE tarih = ? AND hipodrom_id IS NOT NULL AND hipodrom_id != ''
            ORDER BY name`;
        db.all(sql, [tarih, tarih], (err, rows) => {
            if (err) return reject(err);
            resolve((rows || []).filter((r) => r.id && r.name));
        });
    });
}

// Tabloları oluştur (yoksa)
db.run(`CREATE TABLE IF NOT EXISTS at_verileri (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hipodrom TEXT,
    hipodrom_id TEXT,
    tarih TEXT,
    race_count INTEGER,
    total_horses INTEGER,
    veri TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS hesaplama_kayitlari (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hipodrom TEXT,
    hipodrom_id TEXT,
    tarih TEXT,
    race_count INTEGER,
    total_horses INTEGER,
    veri TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS karsilastirma_kayitlari (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hipodrom TEXT,
    hipodrom_id TEXT,
    tarih TEXT,
    race_count INTEGER,
    total_horses INTEGER,
    siralama_veri TEXT,
    hesaplamalar TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS yonetim_calismalari (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad TEXT,
    aciklama TEXT,
    kaynak_kayit_id INTEGER,
    kaynak_tur TEXT,
    tablo_veri TEXT,
    hesaplamalar TEXT,
    sutunlar TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS yonetim_calismalari_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad TEXT,
    aciklama TEXT,
    karsilastirma_kayit_id INTEGER,
    hesaplama_kayit_id INTEGER,
    tablo_veri TEXT,
    sutun_yapisi TEXT,
    hesaplamalar TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS puanlama_bitis_sonuclari (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    veri TEXT NOT NULL DEFAULT '{}',
    guncelleme DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.post('/api/admin/login', (req, res) => {
    const password = req.body?.password;
    if (!password || password !== adminAuth.getAdminPassword()) {
        return res.status(401).json({ success: false, error: 'Geçersiz yönetici şifresi' });
    }
    adminAuth.setSessionCookie(req, res);
    res.json({ success: true });
});

app.get('/api/admin/session', (req, res) => {
    res.json({ success: true, authenticated: adminAuth.isAuthenticated(req) });
});

app.post('/api/admin/logout', (req, res) => {
    adminAuth.clearSessionCookie(req, res);
    res.json({ success: true });
});

app.get('/yonetim', (req, res) => {
    if (adminAuth.isAuthenticated(req)) {
        return res.redirect('/panel.html');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

/** Kamuya açık vitrin — günlük program & tahminler */
const vitrinResponseCache = new Map();
const VITRIN_CACHE_MS = 45000;

app.get('/api/public/vitrin', async (req, res) => {
    try {
        let tarih = req.query.tarih;
        if (!tarih && req.query.iso) tarih = publicProgram.isoToTr(req.query.iso);
        if (!tarih) tarih = publicProgram.todayTr();

        const cacheKey = tarih;
        const cached = vitrinResponseCache.get(cacheKey);
        if (cached && Date.now() - cached.at < VITRIN_CACHE_MS) {
            return res.json(cached.body);
        }

        const vitrin = await publicProgram.getPublicVitrin(db, tarih, {
            pruneDb: false,
            cacheOnlyTjk: true
        });
        const body = {
            success: true,
            ...vitrin,
            iso: publicProgram.trToIso(tarih)
        };
        vitrinResponseCache.set(cacheKey, { at: Date.now(), body });
        res.json(body);
    } catch (err) {
        console.error('public/vitrin:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** Yarın programı arka plan yükleme durumu (18:30 otomatik çekim) */
app.get('/api/public/yarin-fetch-status', async (req, res) => {
    try {
        const status = await programScheduler.getStatus(db);
        res.json({ success: true, ...status });
    } catch (err) {
        console.error('public/yarin-fetch-status:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** Kamu program çekim durumu — bugün/yarın TJK vs veritabanı */
app.get('/api/public/program-sync', async (req, res) => {
    try {
        const overview = await publicProgram.getProgramSyncOverview(db, {
            live: req.query.live !== '0'
        });
        res.json({ success: true, ...overview });
    } catch (err) {
        console.error('public/program-sync:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/public/yenibeygir-blt', async (req, res) => {
    try {
        let iso = req.query.iso;
        let tarih = req.query.tarih;
        if (!iso && tarih) iso = publicProgram.trToIso(tarih);
        const hipodrom = req.query.hipodrom || req.query.hip || '';
        if (!hipodrom) {
            return res.status(400).json({ success: false, error: 'hipodrom parametresi gerekli' });
        }
        const data = await yenibeygirBlt.fetchBltForHipodrom({
            iso,
            tarih,
            hipodrom,
            refresh: req.query.refresh
        });
        res.json(data);
    } catch (err) {
        console.error('public/yenibeygir-blt:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/public/liderform-gp', async (req, res) => {
    try {
        let iso = req.query.iso;
        const tarih = req.query.tarih;
        if (!iso && tarih) iso = publicProgram.trToIso(tarih);
        const hipodrom = req.query.hipodrom || req.query.hip || '';
        if (!hipodrom) {
            return res.status(400).json({ success: false, error: 'hipodrom parametresi gerekli' });
        }
        const racesRaw = req.query.races || req.query.kosular || '';
        const raceNos = String(racesRaw).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
        if (!raceNos.length) {
            return res.status(400).json({ success: false, error: 'races parametresi gerekli' });
        }
        const data = await liderformGp.fetchGpForHipodrom({
            iso,
            tarih,
            hipodrom,
            raceNos,
            refresh: req.query.refresh
        });
        res.json(data);
    } catch (err) {
        console.error('public/liderform-gp:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/public/hipodrom-fob', async (req, res) => {
    try {
        let iso = req.query.iso;
        const tarih = req.query.tarih;
        if (!iso && tarih) iso = publicProgram.trToIso(tarih);
        const hipodrom = req.query.hipodrom || req.query.hip || '';
        if (!hipodrom) {
            return res.status(400).json({ success: false, error: 'hipodrom parametresi gerekli' });
        }
        const data = await hipodromFob.fetchFobForHipodrom({
            iso,
            tarih,
            hipodrom,
            raceApiId: req.query.raceApiId || null,
            refresh: req.query.refresh
        });
        res.json(data);
    } catch (err) {
        console.error('public/hipodrom-fob:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/public/bitalih-fob', async (req, res) => {
    try {
        const hipodrom = req.query.hipodrom || req.query.hip || '';
        if (!hipodrom) {
            return res.status(400).json({ success: false, error: 'hipodrom parametresi gerekli' });
        }
        const data = await bitalihFob.fetchFobForHipodrom({
            hipodrom,
            refresh: req.query.refresh
        });
        res.json(data);
    } catch (err) {
        console.error('public/bitalih-fob:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/public/sonuclar', async (req, res) => {
    try {
        let iso = req.query.iso;
        const tarih = req.query.tarih;
        if (!iso && tarih) iso = publicProgram.trToIso(tarih);
        const hipodrom = req.query.hipodrom || req.query.hip || '';
        const hipodromId = req.query.hipodromId || req.query.sehirId || '';
        if (!hipodrom && !hipodromId) {
            return res.status(400).json({ success: false, error: 'hipodrom parametresi gerekli' });
        }
        const data = await publicSonuclar.fetchSonuclarForHipodrom({
            iso,
            tarih,
            hipodrom,
            hipodromId,
            refresh: req.query.refresh,
            expectedRaceCount: req.query.kosuSayisi || req.query.expectedRaceCount,
            db
        });
        res.json(data);
    } catch (err) {
        console.error('public/sonuclar:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/public/sonuclar/sync-kayit', async (req, res) => {
    try {
        const kayitId = req.body?.kayitId || req.query?.kayitId;
        const tarih = req.body?.tarih || req.query?.tarih;
        const hipodrom = req.body?.hipodrom || req.query?.hipodrom;
        const refresh = req.body?.refresh !== false && req.query?.refresh !== '0';
        if (!kayitId && !(tarih && hipodrom)) {
            return res.status(400).json({
                success: false,
                error: 'kayitId veya tarih+hipodrom gerekli'
            });
        }
        const data = await publicSonucStore.importSonuclarToKayit(db, {
            kayitId: kayitId ? Number(kayitId) : undefined,
            tarih,
            hipodrom,
            refresh
        });
        res.json(data);
    } catch (err) {
        console.error('public/sonuclar/sync-kayit:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/public/sonuclar/poller-status', (req, res) => {
    res.json({
        success: true,
        enabled: process.env.SONUC_POLLER !== '0',
        intervalSec: 90,
        activeHours: '10:00-23:00 Europe/Istanbul'
    });
});

app.get('/api/public/muhtemeller', async (req, res) => {
    try {
        let iso = req.query.iso;
        let tarih = req.query.tarih;
        if (!iso && tarih) iso = publicProgram.trToIso(tarih);
        const raceKey = req.query.kosu || req.query.raceKey || null;
        const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
        const data = raceKey
            ? await muhtemellerFetch.fetchMuhtemelRace({ iso, tarih, raceKey, refresh })
            : await muhtemellerFetch.fetchMuhtemelOverview({ iso, tarih, refresh });
        res.json(data);
    } catch (err) {
        console.error('public/muhtemeller:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/public/tjk-tv', async (req, res) => {
    try {
        await tjkTvProxy.serve(res, req.query.f);
    } catch (err) {
        console.error('public/tjk-tv:', err.message);
        res.status(502).send('TJK TV proxy hatası');
    }
});

app.get('/api/public/hipodrom/config', (req, res) => {
    res.json({
        success: true,
        recaptchaSiteKey: hipodromAuth.RECAPTCHA_SITE_KEY,
        hipodromUrl: 'https://www.hipodrom.com/'
    });
});

app.get('/api/public/hipodrom/session', async (req, res) => {
    try {
        const session = hipodromAuth.getSession(req);
        if (!session) {
            return res.json({ success: true, loggedIn: false });
        }
        let user = session.user;
        if (!user && session.accessToken) {
            try {
                user = await hipodromAuth.fetchUserDetails(session.accessToken);
                const balance = await hipodromAuth.fetchUserBalance(session.accessToken);
                if (balance) user = { ...user, ...balance };
                session.user = user;
            } catch (err) {
                console.warn('hipodrom/session refresh:', err.message);
                hipodromAuth.destroySession(session.sid);
                hipodromAuth.clearSessionCookie(req, res);
                return res.json({ success: true, loggedIn: false, expired: true });
            }
        }
        res.json({ success: true, ...hipodromAuth.publicUser(session) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/public/hipodrom/login', async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const username = req.body?.username;
    const password = req.body?.password;
    const recaptchaCode = req.body?.recaptchaCode || req.body?.recaptcha || null;
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Kullanıcı adı ve şifre gerekli' });
    }
    try {
        const { tokens, method } = await hipodromAuth.loginWithTimeout(username, password, recaptchaCode, 55000);
        let user = null;
        try {
            user = await hipodromAuth.fetchUserDetails(tokens.accessToken);
            const balance = await hipodromAuth.fetchUserBalance(tokens.accessToken);
            if (balance) user = { ...user, ...balance };
        } catch (err) {
            console.warn('hipodrom login user fetch:', err.message);
        }
        const sid = hipodromAuth.createSession(tokens, user);
        hipodromAuth.setSessionCookie(req, res, sid);
        res.json({
            success: true,
            loginMethod: method,
            ...hipodromAuth.publicUser({ user })
        });
    } catch (err) {
        console.error('hipodrom/login:', err.message);
        const status = err.needsCaptcha ? 428 : 401;
        if (!res.headersSent) {
            res.status(status).json({
                success: false,
                error: err.message || 'Giriş başarısız',
                needsCaptcha: !!err.needsCaptcha,
                code: err.code || null
            });
        }
    }
});

app.post('/api/public/hipodrom/logout', async (req, res) => {
    const session = hipodromAuth.getSession(req);
    if (session?.accessToken) {
        await hipodromAuth.logoutApi(session.accessToken);
        hipodromAuth.destroySession(session.sid);
    }
    hipodromAuth.clearSessionCookie(req, res);
    res.json({ success: true });
});

app.get('/api/public/hipodrom/auto/status', async (req, res) => {
    try {
        const state = await hipodromBet.getAutoStatus();
        res.json({ success: true, ...state });
    } catch (err) {
        console.error('hipodrom/auto/status:', err.message);
        res.status(500).json({ success: false, error: err.message, loggedIn: false });
    }
});

app.post('/api/public/hipodrom/auto/login', async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const username = req.body?.username || process.env.HIPODROM_USER;
    const password = req.body?.password || process.env.HIPODROM_PASS;
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'TC/üye no ve şifre gerekli' });
    }
    try {
        const state = await hipodromBet.saveLogin(username, password);
        res.json({ success: true, ...state });
    } catch (err) {
        console.error('hipodrom/auto/login:', err.message);
        const status = err.needsCaptcha ? 428 : (err.code === 'timeout' ? 504 : 401);
        if (!res.headersSent) {
            res.status(status).json({
                success: false,
                error: err.message,
                code: err.code || null,
                needsCaptcha: !!err.needsCaptcha
            });
        }
    }
});

app.post('/api/public/hipodrom/auto/bet/fixed', async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const { city, raceNo, kosuNo, horseName, at, stake, misli, dryRun } = req.body || {};
    try {
        const result = await hipodromBet.placeFixedOddsBet({
            city,
            raceNo: raceNo ?? kosuNo,
            horseName: horseName || at,
            stake: stake ?? misli,
            dryRun: !!dryRun,
            username: req.body?.username,
            password: req.body?.password
        });
        res.json(result);
    } catch (err) {
        console.error('hipodrom/auto/bet:', err.message);
        const status = err.code === 'timeout' ? 504 : 400;
        if (!res.headersSent) {
            res.status(status).json({
                success: false,
                error: err.message,
                code: err.code || null,
                detail: err.detail || null
            });
        }
    }
});

app.get('/api/public/bitalih/config', (req, res) => {
    res.json({
        success: true,
        bitalihUrl: 'https://www.bitalih.com/',
        fixedOddsUrl: 'https://www.bitalih.com/at-yarisi/tjk-sabit-ihtimalli-bahis'
    });
});

app.get('/api/public/bitalih/auto/setup', (req, res) => {
    try {
        res.json(bitalihAutoConfig.getPublicAutoSetup());
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/public/bitalih/auto/status', async (req, res) => {
    try {
        const state = await bitalihBet.getAutoStatus();
        res.json({ success: true, ...state });
    } catch (err) {
        console.error('bitalih/auto/status:', err.message);
        res.status(500).json({ success: false, error: err.message, loggedIn: false });
    }
});

app.get('/api/public/ping', (req, res) => {
    res.json({ ok: true, ts: Date.now() });
});

app.get('/api/public/bitalih/auto/health', (req, res) => {
    const scriptsOk = fs.existsSync(path.join(__dirname, 'scripts', 'bitalih-browser-login.js'))
        && fs.existsSync(path.join(__dirname, 'scripts', 'bitalih-bet-worker.js'));
    const chromePath = resolveChromePath();
    res.json({
        success: true,
        scriptsOk,
        chromePath,
        chromeInstalled: !!chromePath,
        workerAlive: bitalihBet.isWorkerAlive(),
        dataDirWritable: fs.existsSync(path.join(__dirname, 'data')),
        pm2Mode: 'fork'
    });
});

app.get('/api/public/bitalih/auto/job/:id', (req, res) => {
    const job = bitalihBet.getJob(req.params.id);
    if (!job) {
        return res.status(404).json({ success: false, error: 'İş bulunamadı' });
    }
    res.json({ success: true, ...job });
});

app.post('/api/public/bitalih/auto/login', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const username = req.body?.username || req.body?.ssn || process.env.BITALIH_USER;
    const password = req.body?.password || process.env.BITALIH_PASS;
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'TC ve şifre gerekli' });
    }
    try {
        const prep = bitalihBet.prepareLoginJob(username, password);
        const current = bitalihBet.getJob(prep.job.id) || prep.job;
        res.json({
            success: current.status !== 'failed',
            jobId: prep.job.id,
            status: current.status,
            error: current.error || null,
            code: current.code || null
        });
        if (prep.ssn && prep.password) {
            bitalihBet.runLoginJob(prep.job.id, prep.ssn, prep.password);
        }
    } catch (err) {
        console.error('bitalih/auto/login:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: err.message, code: err.code || null });
        }
    }
});

app.post('/api/public/bitalih/auto/bet/fixed', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const { city, raceNo, kosuNo, horseName, at, stake, misli, betType, bahis, dryRun } = req.body || {};
    if (!(horseName || at)) {
        return res.status(400).json({ success: false, error: 'At adı gerekli' });
    }
    const betOpts = {
        city,
        raceNo: raceNo ?? kosuNo,
        horseName: horseName || at,
        stake: stake ?? misli,
        betType: betType || bahis || 'ganyan',
        dryRun: !!dryRun
    };
    try {
        const prep = bitalihBet.prepareBetJob(betOpts);
        const current = bitalihBet.getJob(prep.job.id) || prep.job;
        res.json({
            success: current.status !== 'failed',
            jobId: prep.job.id,
            status: current.status,
            error: current.error || null,
            code: current.code || null
        });
        if (prep.chromePath) {
            bitalihBet.runBetJob(prep.job.id, betOpts);
        }
    } catch (err) {
        console.error('bitalih/auto/bet:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: err.message, code: err.code || null });
        }
    }
});

app.post('/api/admin/public-program-cek', async (req, res) => {
    if (!adminAuth.isAuthenticated(req)) {
        return res.status(401).json({ success: false, error: 'Yönetici oturumu gerekli' });
    }
    const tarih = req.body?.tarih || publicProgram.tomorrowTr();
    const onlyDomestic = req.body?.onlyDomestic !== false;
    try {
        const built = await publicProgram.buildPublicProgram(db, tarih, {
            onlyDomestic,
            publish: req.body?.publish !== false,
            source: req.body?.source || 'tjk',
            enrichKosular: req.body?.enrichKosular === true,
            syncHesaplama: req.body?.syncHesaplama !== false && (req.body?.source || 'tjk') === 'tjk',
            trigger: 'admin'
        });
        clearCalibrationFlatCache();
        clearCalibrationBundleCache();
        const sync = await publicProgram.getProgramSyncForDate(db, tarih);
        res.json({ success: true, ...built, sync });
    } catch (err) {
        console.error('public-program-cek:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/sync-public-to-hesaplama', async (req, res) => {
    if (!adminAuth.isAuthenticated(req)) {
        return res.status(401).json({ success: false, error: 'Yönetici oturumu gerekli' });
    }
    try {
        const synced = await publicProgram.syncAllPublicProgramsToHesaplama(db, {
            tarih: req.body?.tarih || null
        });
        clearCalibrationFlatCache();
        clearCalibrationBundleCache();
        res.json({ success: true, count: synced.length, synced });
    } catch (err) {
        console.error('sync-public-to-hesaplama:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/public-tahmin-build', async (req, res) => {
    if (!adminAuth.isAuthenticated(req)) {
        return res.status(401).json({ success: false, error: 'Yönetici oturumu gerekli' });
    }
    const tarih = req.body?.tarih || publicProgram.tomorrowTr();
    try {
        const built = await publicTahminBuild.buildPublicTahmin(db, tarih, {
            hipodrom: req.body?.hipodrom || null,
            raceNo: req.body?.raceNo || null,
            save: req.body?.save !== false
        });
        res.json({ success: true, ...built });
    } catch (err) {
        console.error('public-tahmin-build:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/admin/public-program-status', async (req, res) => {
    if (!adminAuth.isAuthenticated(req)) {
        return res.status(401).json({ success: false, error: 'Yönetici oturumu gerekli' });
    }
    try {
        if (req.query.tarih) {
            const sync = await publicProgram.getProgramSyncForDate(db, req.query.tarih);
            const lastRuns = await publicProgram.getLastFetchRuns(db, 15);
            return res.json({ success: true, sync, lastRuns });
        }
        const overview = await publicProgram.getProgramSyncOverview(db, { logLimit: 15 });
        res.json({ success: true, ...overview });
    } catch (err) {
        console.error('public-program-status:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.use(adminAuth.guardAdminPage);

app.use(express.static('public', {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Gerçek tarayıcı headers
const getBrowserHeaders = () => ({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
    'Referer': 'https://www.tjk.org/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin'
});

function resolveChromeExecutable() {
    const fs = require('fs');
    const isLinux = process.platform === 'linux';
    const candidates = [
        process.env.CHROME_PATH,
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
    ].filter(Boolean);
    if (!isLinux) {
        candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    }
    for (const p of candidates) {
        if (isLinux && p.includes('/Applications/')) continue;
        try {
            if (fs.existsSync(p)) return p;
        } catch (_) { /* yoksay */ }
    }
    return null;
}

function buildLaunchOptions() {
    const launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=tr-TR']
    };
    const chromePath = resolveChromeExecutable();
    if (chromePath) launchOptions.executablePath = chromePath;
    return launchOptions;
}

async function getBrowserInstance() {
    if (browser) {
        try {
            if (!browser.isConnected()) browser = null;
        } catch (_) {
            browser = null;
        }
    }
    if (browser) return browser;
    const puppeteer = require('puppeteer');
    const launchOptions = buildLaunchOptions();
    try {
        browser = await puppeteer.launch(launchOptions);
    } catch (err) {
        browser = null;
        if (launchOptions.executablePath) {
            delete launchOptions.executablePath;
            browser = await puppeteer.launch(launchOptions);
        } else {
            throw err;
        }
    }
    return browser;
}

hipodromAuth.setBrowserFactory(getBrowserInstance);
hipodromBrowser.setBrowserFactory(getBrowserInstance);
publicSonuclar.setBrowserFactory(getBrowserInstance);

async function gotoWithHeaders(page, url) {
    await page.setExtraHTTPHeaders(getBrowserHeaders());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));
}

// final_mesafeler.js / kesin_mesafeler.js ile aynı: hipodrom sekmesi + bekleme
async function gotoKosuSonucSayfasi(page, url, sehirAdi) {
    await page.setExtraHTTPHeaders(getBrowserHeaders());
    const hashId = url.includes('#') ? url.split('#').pop() : '';
    const baseUrl = hashId ? url.split('#')[0] : url;
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    try {
        await page.waitForSelector('.gunluk-tabs', { timeout: 15000 });
    } catch (_) {}

    const sehirKey = (sehirAdi || '').split(/[\s(]/)[0].trim();
    if (sehirKey) {
        await page.evaluate((sehir) => {
            const tabs = document.querySelectorAll('.gunluk-tabs a');
            for (const tab of tabs) {
                if (tab.textContent.includes(sehir)) {
                    tab.click();
                    break;
                }
            }
        }, sehirKey);
        await new Promise(r => setTimeout(r, 5000));
    }

    if (hashId) {
        await page.evaluate((id) => {
            location.hash = id;
            const el = document.getElementById(id) || document.querySelector('[id="' + id + '"]');
            if (el) el.scrollIntoView({ block: 'start' });
        }, hashId);
        await new Promise(r => setTimeout(r, 2000));
    }

    try {
        await page.waitForFunction(
            () => document.querySelectorAll('table tbody tr').length > 0 && document.body.innerText.length > 3000,
            { timeout: 30000, polling: 500 }
        );
    } catch (_) {}

    await new Promise(r => setTimeout(r, 2000));
    return page.evaluate(() => document.querySelectorAll('table tbody tr').length > 0);
}

function getPageDebugInfo() {
    const bt = document.body.innerText || '';
    const tables = document.querySelectorAll('table');
    const samples = [];
    for (let t = 0; t < Math.min(3, tables.length); t++) {
        const rows = tables[t].querySelectorAll('tbody tr');
        for (let r = 0; r < Math.min(4, rows.length); r++) {
            const cells = [...rows[r].querySelectorAll('td')].map(c => c.innerText.trim().slice(0, 35));
            if (cells.length) samples.push({ tablo: t, satir: r, hucreler: cells });
        }
    }
    const idx = bt.indexOf('Son 800 :');
    return {
        url: location.href,
        hash: location.hash,
        tabloSayisi: tables.length,
        tablesorterSayisi: document.querySelectorAll('table.tablesorter').length,
        metinUzunluk: bt.length,
        son800Var: idx !== -1,
        son800Ornek: idx !== -1 ? bt.substring(idx, idx + 90) : null,
        ornekSatirlar: samples
    };
}

async function parseKosuDetayFromPage(page, atIsmi) {
    return page.evaluate((atIsmi) => {
        function normName(value) {
            return (value || '').split('(')[0].replace(/\s+/g, ' ').trim().toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
        }
        function namesMatch(cellText, target) {
            const a = normName(cellText);
            const b = normName(target);
            return a && b && (a.includes(b) || b.includes(a));
        }
        function findTableByHash() {
            const hashId = (location.hash || '').replace(/^#/, '');
            if (!hashId) return -1;
            const anchor = document.getElementById(hashId);
            if (!anchor) return -1;
            let node = anchor;
            for (let i = 0; i < 8 && node; i++) {
                const table = node.querySelector ? node.querySelector('table') : null;
                if (table) {
                    const tables = document.querySelectorAll('table');
                    const idx = Array.prototype.indexOf.call(tables, table);
                    if (idx !== -1) return idx;
                }
                node = node.nextElementSibling || node.parentElement;
            }
            return -1;
        }
        function getBirinciFromTable(table) {
            if (!table) return null;
            for (const row of table.querySelectorAll('tbody tr')) {
                const siraCell = row.querySelector('td:nth-child(2)');
                const dereceCell = row.querySelector('td:nth-child(10)');
                if (siraCell && siraCell.innerText.trim() === '1' && dereceCell) {
                    const d = dereceCell.innerText.trim();
                    if (d && d !== '-') return d;
                }
            }
            return null;
        }
        function getSon800FromNode(node) {
            if (!node) return null;
            let el = node;
            for (let i = 0; i < 6 && el; i++) {
                const txt = el.innerText || '';
                const idx = txt.indexOf('Son 800 :');
                if (idx !== -1) {
                    const chunk = txt.substring(idx, idx + 100);
                    let match = chunk.match(/Son\s*800\s*:\s*(\d+[\.\:]\d+[\.\:]\d+)\s*[\-\–]\s*(\d+[\.\:]\d+[\.\:]\d+)/);
                    if (match) return match[1] + '|' + match[2];
                    match = chunk.match(/Son\s*800\s*:\s*(\d+[\.\:]\d+[\.\:]\d+)/);
                    if (match) return match[1] + '|';
                }
                el = el.parentElement;
            }
            return null;
        }

        const tables = document.querySelectorAll('table');
        let atTabloIndex = findTableByHash();

        if (atTabloIndex === -1) {
            for (let t = 0; t < tables.length; t++) {
                for (const row of tables[t].querySelectorAll('tbody tr')) {
                    const atIsimCell = row.querySelector('td:nth-child(3)');
                    if (atIsimCell && namesMatch(atIsimCell.innerText, atIsmi)) {
                        atTabloIndex = t;
                        break;
                    }
                }
                if (atTabloIndex !== -1) break;
            }
        }

        let birinciDerece = null;
        let atDereceDetay = null;
        let son800 = null;

        if (atTabloIndex !== -1) {
            const tablo = tables[atTabloIndex];
            birinciDerece = getBirinciFromTable(tablo);
            son800 = getSon800FromNode(tablo);

            for (const row of tablo.querySelectorAll('tbody tr')) {
                const dereceCell = row.querySelector('td:nth-child(10)');
                const atIsimCell = row.querySelector('td:nth-child(3)');
                if (atIsimCell && namesMatch(atIsimCell.innerText, atIsmi) && dereceCell) {
                    atDereceDetay = dereceCell.innerText.trim();
                }
            }
        }

        if (!son800) {
            const bodyText = document.body.innerText;
            const son800Index = bodyText.indexOf('Son 800 :');
            if (son800Index !== -1) {
                const chunk = bodyText.substring(son800Index, son800Index + 100);
                let match = chunk.match(/Son\s*800\s*:\s*(\d+[\.\:]\d+[\.\:]\d+)\s*[\-\–]\s*(\d+[\.\:]\d+[\.\:]\d+)/);
                if (match) son800 = match[1] + '|' + match[2];
                else {
                    match = chunk.match(/Son\s*800\s*:\s*(\d+[\.\:]\d+[\.\:]\d+)/);
                    if (match) son800 = match[1] + '|';
                }
            }
        }

        return { birinciDerece, atDereceDetay, son800 };
    }, atIsmi);
}

app.use('/api', adminAuth.guardAdminApi);

app.get('/api/scrape-test', async (req, res) => {
    const atId = req.query.id || '99891';
    const adi = (req.query.adi || 'SANCAKALAN').trim();
    const start = Date.now();
    try {
        const browserInstance = await getBrowserInstance();
        const page = await browserInstance.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await gotoWithHeaders(page, 'https://www.tjk.org/');
        const atUrl = `https://www.tjk.org/TR/YarisSever/Query/ConnectedPage/AtKosuBilgileri?QueryParameter_AtId=${atId}`;
        await gotoWithHeaders(page, atUrl);
        const kosular = await page.evaluate(() => {
            const tables = document.querySelectorAll('table.tablesorter');
            const kosuTablosu = tables.length >= 2 ? tables[1] : tables[0];
            if (!kosuTablosu) return [];
            const rows = kosuTablosu.querySelectorAll('tbody tr');
            const data = [];
            for (const row of rows) {
                const tarihCell = row.querySelector('td:first-child');
                const tarihLink = tarihCell?.querySelector('a');
                if (!tarihLink?.href) continue;
                const sehirCell = row.querySelector('td:nth-child(2)');
                data.push({
                    tarih: tarihCell.innerText.trim(),
                    tarihLink: tarihLink.href,
                    sehir: sehirCell ? sehirCell.innerText.trim() : ''
                });
            }
            return data.slice(0, 1);
        });
        if (!kosular.length) {
            await page.close();
            return res.json({ success: false, error: 'Koşu listesi bulunamadı', ms: Date.now() - start });
        }
        const kosu = kosular[0];
        const tablesLoaded = await gotoKosuSonucSayfasi(page, kosu.tarihLink, kosu.sehir);
        const detay = await parseKosuDetayFromPage(page, adi);
        const debug = req.query.debug === '1'
            ? await page.evaluate(getPageDebugInfo)
            : undefined;
        await page.close();
        const son800Parts = detay.son800 ? detay.son800.split('|') : [];
        res.json({
            success: true,
            ms: Date.now() - start,
            kosu: kosu.tarih,
            kosuLink: kosu.tarihLink,
            tablolarYuklendi: tablesLoaded,
            birinci_derece: detay.birinciDerece || '-',
            son800_bir: son800Parts[0] || '-',
            son800_iki: son800Parts[1] || '-',
            tamam: !!(detay.birinciDerece && detay.son800),
            ...(debug ? { debug } : {})
        });
    } catch (e) {
        res.json({ success: false, error: e.message, ms: Date.now() - start });
    }
});

// API 1: Hipodromları getir (HTTP + önbellek + DB yedek; Puppeteer yok)
app.get('/api/hipodromlar', async (req, res) => {
    const tarih = req.query.tarih;
    if (!tarih) {
        return res.json({ success: false, error: 'Tarih gerekli', hipodromlar: [] });
    }
    console.log('📡 Hipodrom isteği - Tarih:', tarih);

    try {
        const cached = getCachedHipodromlar(tarih);
        if (cached?.length) {
            return res.json({ success: true, hipodromlar: cached, source: 'cache' });
        }

        let hipodromlar = [];
        let source = 'tjk';
        try {
            hipodromlar = await tjkScrape.fetchHipodromlarForDate(tarih);
        } catch (tjkErr) {
            console.warn('⚠️ TJK hipodrom hatası:', tjkErr.message);
            hipodromlar = await queryHipodromlarFromDb(tarih);
            source = 'db';
            if (!hipodromlar.length) {
                return res.json({
                    success: false,
                    error: 'TJK yanıt vermedi ve bu tarih için kayıtlı hipodrom yok: ' + tjkErr.message,
                    hipodromlar: []
                });
            }
        }

        if (hipodromlar.length) setCachedHipodromlar(tarih, hipodromlar);
        res.json({ success: true, hipodromlar, source });
    } catch (error) {
        console.error('Hipodrom hatası:', error.message);
        res.json({ success: false, error: error.message, hipodromlar: [] });
    }
});

// API 2: Yarış programını getir (MESAFE BİLGİSİ - DÜZELTİLMİŞ, FİLTRE KALDIRILMIŞ)
app.get('/api/yaris-programi', async (req, res) => {
    const sehirId = req.query.sehir;
    const sehirAdi = req.query.sehirAdi;
    const tarih = req.query.tarih;
    
    console.log('📡 Yarış programı isteği - Şehir:', sehirId, sehirAdi, 'Tarih:', tarih);
    
    try {
        const browserInstance = await getBrowserInstance();
        const page = await browserInstance.newPage();
        const url = `https://www.tjk.org/TR/YarisSever/Info/Sehir/GunlukYarisProgrami?SehirId=${sehirId}&QueryParameter_Tarih=${tarih}&SehirAdi=${encodeURIComponent(sehirAdi)}&Era=today`;
        await gotoWithHeaders(page, url);
        
        // Tüm sayfa metnini al
        const pageText = await page.evaluate(() => document.body.innerText);
        
        // Koşu bloklarını ayır — başlık meta (kcins, kategori, pist)
        const kosuBloklari = pageText.split(/\n(?=\d+\.\s*Koşu\s+\d+\.\d+)/);
        const mesafeler = {};
        const raceMeta = {};
        
        for (let blok of kosuBloklari) {
            const kosuMatch = blok.match(/^(\d+)\.\s*Koşu\s+\d+\.\d+/);
            if (!kosuMatch) continue;
            
            const kosuNo = parseInt(kosuMatch[1]);
            const headerLine = blok.match(/\d+\.\s*Koşu\s+\d+\.\d+\s*\n([^\n]+)/);
            const meta = tjkScrape.parseRaceHeaderLine(headerLine ? headerLine[1] : '');
            const blockDist = raceMetaEnrich.extractMesafePistFromKosuBlock(blok);
            const mesafe = blockDist.mesafe || meta.mesafe || '';
            const pist = blockDist.pist || meta.pist_kosu || '';

            if (mesafe) {
                mesafeler[kosuNo] = { mesafe, pist: pist || '?' };
                raceMeta[kosuNo] = { ...meta, mesafe, pist_kosu: pist };
                console.log(`✅ Koşu ${kosuNo}: ${mesafe} ${pist} · ${meta.kcins_kosu} · ${meta.kategori}`);
            } else {
                const match = blok.match(/(\d{3,4})\s*(Çim|Kum|Sentetik)/);
                if (match) {
                    mesafeler[kosuNo] = { mesafe: match[1], pist: match[2] };
                    raceMeta[kosuNo] = { mesafe: match[1], pist_kosu: match[2] };
                } else {
                    mesafeler[kosuNo] = { mesafe: '?', pist: '?' };
                }
            }
        }
        
        const yarisProgrami = await page.evaluate((mesafeler, raceMeta) => {
            function isKosmazText(text) {
                if (!text) return false;
                return /\(\s*koşmaz\s*\)/i.test(text) || /\(\s*kosmaz\s*\)/i.test(text)
                    || /\(\s*koşm\s*\)/i.test(text) || /\(\s*çekildi\s*\)/i.test(text);
            }
            function parseNameCell(nameCell) {
                const fullText = nameCell?.innerText || '';
                const link = nameCell?.querySelector('a');
                const name = (link?.innerText || fullText).replace(/\(\s*koşmaz\s*\)/gi, '').replace(/\s+/g, ' ').trim();
                const taki = [...(nameCell?.querySelectorAll('span.aciklamaFancy') || [])]
                    .map(s => s.innerText.trim()).filter(Boolean).join(' ');
                return { name, taki, kosmaz: isKosmazText(fullText) };
            }
            const races = [];
            const tables = document.querySelectorAll('table.tablesorter');
            
            for (let idx = 0; idx < tables.length; idx++) {
                const table = tables[idx];
                const horses = [];
                const rows = table.querySelectorAll('tbody tr');
                
                for (let j = 0; j < rows.length; j++) {
                    const row = rows[j];
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 5) continue;
                    
                    const horseNo = cells[1]?.innerText?.trim();
                    if (!horseNo || !/^\d+$/.test(horseNo)) continue;
                    
                    const nameCell = cells[2];
                    const link = nameCell?.querySelector('a');
                    let atId = '';
                    let parsed = parseNameCell(nameCell);
                    let horseName = parsed.name;
                    
                    if (link) {
                        const href = link.getAttribute('href');
                        if (href) {
                            const match = href.match(/AtId=(\d+)/);
                            if (match) atId = match[1];
                        }
                        if (link.innerText?.trim()) horseName = link.innerText.trim().replace(/\(\s*koşmaz\s*\)/gi, '').trim();
                    }
                    
                    if (!horseName || horseName === 'At İsmi' || parsed.kosmaz || isKosmazText(horseName)) continue;
                    
                    horses.push({
                        no: horseNo,
                        name: horseName,
                        atId: atId,
                        yas: cells[3]?.innerText?.trim() || '',
                        siklet: cells[5]?.innerText?.trim() || '',
                        hp: cells[10]?.innerText?.trim() || '',
                        taki: parsed.taki || ''
                    });
                }
                
                if (horses.length > 0) {
                    const raceNo = (races.length + 1).toString();
                    const rn = parseInt(raceNo, 10);
                    const meta = raceMeta[raceNo] || raceMeta[rn] || {};
                    races.push({
                        raceNo: raceNo,
                        horseCount: horses.length,
                        horses: horses,
                        mesafe: mesafeler[raceNo]?.mesafe || meta.mesafe || '?',
                        pist: mesafeler[raceNo]?.pist || meta.pist_kosu || '?',
                        kcins_kosu: meta.kcins_kosu || '',
                        kategori: meta.kategori || ''
                    });
                }
            }
            return races;
        }, mesafeler, raceMeta);
        
        await page.close();
        
        const totalHorses = yarisProgrami.reduce((s, r) => s + r.horses.length, 0);
        
        res.json({
            success: true,
            data: yarisProgrami,
            totalRaces: yarisProgrami.length,
            totalHorses: totalHorses,
            hipodrom: sehirAdi,
            tarih: tarih,
            mesafeler: mesafeler
        });
        
    } catch (error) {
        console.error('Yarış programı hatası:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// API 3: Atın TÜM VERİLERİNİ getir (genişletilmiş alanlar + retry)
app.get('/api/at-tum-veriler', async (req, res) => {
    const atId = req.query.id;
    const adiParam = (req.query.adi || '').trim();
    
    console.log('📡 At tüm veriler isteği - ID:', atId);
    
    if (!atId) {
        return res.json({ success: false, error: 'At ID gerekli' });
    }
    
    let page;
    try {
        const browserInstance = await getBrowserInstance();
        page = await browserInstance.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        const maxKosu = Number(req.query.maxKosu) || 7;
        const fetchAllFieldSizes = req.query.allFieldSizes === '1';
        const maxAllKosu = fetchAllFieldSizes
            ? (Number(req.query.maxAllKosu) || 40)
            : maxKosu;

        const result = await tjkScrape.fetchAtKosularFromPage(page, atId, adiParam, {
            maxKosu,
            maxAllKosu,
            fetchAllFieldSizes,
            maxRetry: Number(req.query.retry) || 1
        });
        
        res.json(result);
        
    } catch (error) {
        console.error('At tüm veriler hatası:', error.message);
        res.json({ success: false, error: error.message });
    } finally {
        try { if (page) await page.close(); } catch (_) {}
    }
});

// API 4: Karşılaştırma için koşu sonuçlarını getir
app.get('/api/karsilastirma-sonuclari', async (req, res) => {
    const sehirId = req.query.sehirId || '5';
    const sehirAdi = req.query.sehirAdi || 'Ankara';
    const tarih = req.query.tarih;
    
    console.log('📡 Karşılaştırma isteği - Şehir:', sehirId, sehirAdi, 'Tarih:', tarih);
    
    if (!tarih) {
        return res.json({ success: false, error: 'Tarih gerekli' });
    }
    
    try {
        const browserInstance = await getBrowserInstance();
        const page = await browserInstance.newPage();
        const url = `https://www.tjk.org/TR/YarisSever/Info/Sehir/GunlukYarisSonuclari?SehirId=${sehirId}&QueryParameter_Tarih=${tarih}&SehirAdi=${encodeURIComponent(sehirAdi)}&Era=lastWeek`;
        await gotoWithHeaders(page, url);
        
        const sonuclar = await page.evaluate(() => {
            const tables = document.querySelectorAll("table.tablesorter");
            const raceResults = [];
            
            for (let t = 0; t < tables.length; t++) {
                const table = tables[t];
                const rows = table.querySelectorAll("tbody tr");
                const horses = [];
                
                for (let row of rows) {
                    const siraCell = row.querySelector("td:nth-child(2)");
                    const sira = siraCell ? siraCell.innerText.trim() : null;
                    
                    if (!sira || isNaN(parseInt(sira))) continue;
                    
                    const atIsimCell = row.querySelector("td:nth-child(3)");
                    let atIsmi = atIsimCell ? atIsimCell.innerText.trim() : null;
                    let atId = "-";
                    
                    const atLink = atIsimCell ? atIsimCell.querySelector("a") : null;
                    if (atLink && atLink.href) {
                        const match = atLink.href.match(/QueryParameter_AtId=(\d+)/);
                        if (match) atId = match[1];
                        if (atLink.innerText.trim()) atIsmi = atLink.innerText.trim();
                    }
                    
                    if (sira && atIsmi) {
                        horses.push({ sira: sira, atIsmi: atIsmi, atId: atId });
                    }
                }
                
                if (horses.length > 0) {
                    raceResults.push({
                        raceNo: (raceResults.length + 1).toString(),
                        horseCount: horses.length,
                        horses: horses
                    });
                }
            }
            
            return raceResults;
        });
        
        await page.close();
        
        res.json({
            success: true,
            data: sonuclar,
            totalRaces: sonuclar.length,
            hipodrom: sehirAdi,
            tarih: tarih
        });
        
    } catch (error) {
        console.error('Karşılaştırma hatası:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// API 5: Verileri KAYDET (SQLite) ve diğer API'ler
app.post('/api/kaydet', (req, res) => {
    const veri = req.body;
    console.log('💾 Kayıt isteği - Hipodrom:', veri.hipodrom, 'Tarih:', veri.tarih);
    
    const sql = `INSERT INTO at_verileri (hipodrom, hipodrom_id, tarih, race_count, total_horses, veri) VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [veri.hipodrom, veri.hipodromId, veri.tarih, veri.raceCount, veri.totalHorses, JSON.stringify(veri.data)];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('❌ Kayıt hatası:', err.message);
            res.json({ success: false, error: err.message });
        } else {
            console.log('✅ Kayıt başarılı! ID:', this.lastID);
            res.json({ success: true, id: this.lastID });
        }
    });
});

app.get('/api/kayitlar', (req, res) => {
    db.all(`SELECT id, hipodrom, tarih, race_count, total_horses, kayit_tarihi FROM at_verileri ORDER BY kayit_tarihi DESC`, [], (err, rows) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true, kayitlar: rows });
        }
    });
});

app.get('/api/kayit/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM at_verileri WHERE id = ?`, [id], (err, row) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else if (row) {
            row.veri = JSON.parse(row.veri);
            res.json({ success: true, kayit: row });
        } else {
            res.json({ success: false, error: 'Kayıt bulunamadı' });
        }
    });
});

// ==================== HESAPLAMA KAYITLARI API'leri ====================

app.post('/api/hesaplama-kaydet', (req, res) => {
    const veri = req.body;
    console.log('💾 HESAPLAMA kayıt isteği - Hipodrom:', veri.hipodrom, 'Tarih:', veri.tarih);

    const payload = [
        veri.hipodrom,
        veri.hipodromId || null,
        veri.tarih,
        veri.raceCount,
        veri.totalHorses,
        JSON.stringify(veri.data)
    ];

    const finish = (err, id, updated) => {
        if (err) {
            console.error('❌ Kayıt hatası:', err.message);
            res.json({ success: false, error: err.message });
            return;
        }
        console.log(updated ? '✅ HESAPLAMA güncellendi ID:' : '✅ HESAPLAMA kayıt başarılı! ID:', id);
        clearCalibrationFlatCache();
        clearCalibrationBundleCache();
        res.json({ success: true, id, updated: !!updated });
    };

    if (veri.hipodromId && veri.tarih) {
        db.get(
            `SELECT id FROM hesaplama_kayitlari WHERE tarih = ? AND hipodrom_id = ?`,
            [veri.tarih, String(veri.hipodromId)],
            (err, row) => {
                if (err) return finish(err);
                if (row) {
                    db.run(
                        `UPDATE hesaplama_kayitlari SET hipodrom = ?, race_count = ?, total_horses = ?, veri = ?,
                         kayit_tarihi = CURRENT_TIMESTAMP WHERE id = ?`,
                        [veri.hipodrom, veri.raceCount, veri.totalHorses, JSON.stringify(veri.data), row.id],
                        (err2) => finish(err2, row.id, true)
                    );
                } else {
                    db.run(
                        `INSERT INTO hesaplama_kayitlari (hipodrom, hipodrom_id, tarih, race_count, total_horses, veri)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        payload,
                        function(err2) { finish(err2, this.lastID, false); }
                    );
                }
            }
        );
        return;
    }

    db.run(
        `INSERT INTO hesaplama_kayitlari (hipodrom, hipodrom_id, tarih, race_count, total_horses, veri) VALUES (?, ?, ?, ?, ?, ?)`,
        payload,
        function(err) { finish(err, this.lastID, false); }
    );
});

app.get('/api/hesaplama-kayitlar', (req, res) => {
    db.all(`SELECT id, hipodrom, tarih, race_count, total_horses, kayit_tarihi FROM hesaplama_kayitlari ORDER BY kayit_tarihi DESC`, [], (err, rows) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true, kayitlar: rows });
        }
    });
});

/** Kamu vitrini günlük program kayıtları (public_gunluk_program — hesaplama_kayitlari değil) */
app.get('/api/kamu-program-kayitlar', async (req, res) => {
    try {
        const kayitlar = await publicProgram.listPublicProgramKayitlar(db, {
            tarih: req.query.tarih || null,
            limit: req.query.limit ? Number(req.query.limit) : 60
        });
        res.json({ success: true, kayitlar });
    } catch (err) {
        console.error('kamu-program-kayitlar:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/kamu-program-kayit', async (req, res) => {
    try {
        const tarih = req.query.tarih;
        const hipodromId = req.query.hipodromId || req.query.hipodrom_id;
        if (!tarih || !hipodromId) {
            return res.status(400).json({ success: false, error: 'tarih ve hipodromId gerekli' });
        }
        const kayit = await publicProgram.getPublicProgramKayit(db, tarih, hipodromId);
        if (!kayit) {
            return res.json({ success: false, error: 'Kamu program kaydı bulunamadı' });
        }
        res.json({ success: true, kayit });
    } catch (err) {
        console.error('kamu-program-kayit:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** Kalibrasyon paketi — sunucuda kalibre edilmiş motor durumu (~0.5MB, tarayıcıya flat gönderilmez) */
app.get('/api/calibration-bundle/status', (req, res) => {
    res.json({ success: true, ...getBundleStatus() });
});

app.get('/api/calibration-bundle', async (req, res) => {
    try {
        const built = await buildCalibrationBundle();
        res.json({
            success: true,
            bundle: built.bundle,
            flatCount: built.flatCount,
            buildMs: built.buildMs,
            source: built.source || 'memory'
        });
    } catch (err) {
        console.error('calibration-bundle:', err);
        res.status(500).json({ success: false, error: err.message || String(err) });
    }
});

/** Kalibrasyon için flat entry — sunucuda DB'den tek seferde (tarayıcı N+1 yerine) */
app.get('/api/calibration-flat-build', async (req, res) => {
    try {
        const built = await buildCalibrationFlat();
        res.json({
            success: true,
            flatEntries: built.flatEntries,
            bitisMap: built.bitisMap,
            flatCount: built.flatCount,
            buildMs: built.buildMs
        });
    } catch (err) {
        console.error('calibration-flat-build:', err);
        res.status(500).json({ success: false, error: err.message || String(err) });
    }
});

app.get('/api/hesaplama-kayit/:id', async (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM hesaplama_kayitlari WHERE id = ?`, [id], async (err, row) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else if (row) {
            try {
                let veri = JSON.parse(row.veri);
                const enrichOpts = req.query.quick === '1' ? { skipTjkFetch: true } : {};
                veri = await publicProgram.enrichHesaplamaVeriMesafe(db, veri, row, enrichOpts);
                row.veri = veri;
                res.json({ success: true, kayit: row });
            } catch (parseErr) {
                res.json({ success: false, error: parseErr.message || String(parseErr) });
            }
        } else {
            res.json({ success: false, error: 'Kayıt bulunamadı' });
        }
    });
});

/** hesaplama_kayitlari — veri güncelle (PUANLAMA TEST çıkan at kalıcı silme) */
app.put('/api/hesaplama-kayit/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    if (!body.veri || !Array.isArray(body.veri)) {
        res.json({ success: false, error: 'veri (dizi) gerekli' });
        return;
    }
    const raceCount = body.race_count != null ? body.race_count : body.raceCount;
    const totalHorses = body.total_horses != null ? body.total_horses : body.totalHorses;
    const sql = `UPDATE hesaplama_kayitlari SET veri = ?, race_count = ?, total_horses = ?, kayit_tarihi = CURRENT_TIMESTAMP WHERE id = ?`;
    db.run(sql, [JSON.stringify(body.veri), raceCount, totalHorses, id], function(err) {
        if (err) {
            res.json({ success: false, error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.json({ success: false, error: 'Kayıt bulunamadı' });
            return;
        }
        console.log('💾 Hesaplama kaydı güncellendi ID:', id, '·', totalHorses, 'at');
        clearCalibrationFlatCache();
        clearCalibrationBundleCache();
        res.json({ success: true, id, race_count: raceCount, total_horses: totalHorses, updated: true });
    });
});

function parsePuanlamaStore(raw) {
    if (!raw || typeof raw !== 'object') return { bitis: {}, cikan: {} };
    const isLegacy = !raw.bitis && !raw.cikan
        && Object.values(raw).some(v => typeof v === 'number');
    if (isLegacy) return { bitis: raw, cikan: {} };
    return { bitis: raw.bitis || {}, cikan: raw.cikan || {} };
}

function purgePuanlamaKayitId(kayitId, callback) {
    const prefix = String(kayitId) + '|';
    db.get(`SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1`, [], (err, row) => {
        if (err) return callback(err);
        if (!row?.veri) return callback(null);
        let store;
        try {
            store = parsePuanlamaStore(JSON.parse(row.veri));
        } catch (_) {
            return callback(null);
        }
        const bitis = {};
        for (const [k, v] of Object.entries(store.bitis)) {
            if (!k.startsWith(prefix)) bitis[k] = v;
        }
        const cikan = {};
        for (const [k, v] of Object.entries(store.cikan)) {
            if (!k.startsWith(prefix)) cikan[k] = v;
        }
        const veri = JSON.stringify({ bitis, cikan });
        const sql = `INSERT INTO puanlama_bitis_sonuclari (id, veri, guncelleme) VALUES (1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET veri = excluded.veri, guncelleme = CURRENT_TIMESTAMP`;
        db.run(sql, [veri], callback);
    });
}

app.delete('/api/hesaplama-kayit/:id', (req, res) => {
    const id = req.params.id;
    db.run(`DELETE FROM hesaplama_kayitlari WHERE id = ?`, [id], function(err) {
        if (err) {
            res.json({ success: false, error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.json({ success: false, error: 'Kayıt bulunamadı' });
            return;
        }
        purgePuanlamaKayitId(id, (errP) => {
            if (errP) {
                res.json({ success: false, error: errP.message });
                return;
            }
            console.log('🗑 Hesaplama kaydı silindi ID:', id);
            clearCalibrationFlatCache();
            clearCalibrationBundleCache();
            res.json({ success: true, deletedId: parseInt(id, 10) });
        });
    });
});

app.post('/api/hesaplama-kayitlar-temizle', (req, res) => {
    if (req.body?.onay !== 'SIL') {
        res.json({ success: false, error: 'Onay için body.onay = "SIL" gerekli' });
        return;
    }
    db.serialize(() => {
        db.run(`DELETE FROM hesaplama_kayitlari`, [], function(errH) {
            if (errH) {
                res.json({ success: false, error: errH.message });
                return;
            }
            const deletedHesaplama = this.changes;
            db.run(`DELETE FROM puanlama_bitis_sonuclari`, [], function(errP) {
                if (errP) {
                    res.json({ success: false, error: errP.message });
                    return;
                }
                console.log('🗑 Tüm hesaplama kayıtları silindi:', deletedHesaplama);
                res.json({
                    success: true,
                    deletedHesaplama,
                    deletedPuanlama: this.changes
                });
            });
        });
    });
});

// ==================== KARŞILAŞTIRMA KAYITLARI API'leri ====================

app.post('/api/karsilastirma-kaydet', (req, res) => {
    const veri = req.body;
    console.log('💾 KARŞILAŞTIRMA kayıt isteği - Hipodrom:', veri.hipodrom, 'Tarih:', veri.tarih);
    
    const sql = `INSERT INTO karsilastirma_kayitlari (hipodrom, hipodrom_id, tarih, race_count, total_horses, siralama_veri, hesaplamalar) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [veri.hipodrom, veri.hipodromId, veri.tarih, veri.raceCount, veri.totalHorses, JSON.stringify(veri.siralama_veri), JSON.stringify(veri.hesaplamalar || {})];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('❌ Kayıt hatası:', err.message);
            res.json({ success: false, error: err.message });
        } else {
            console.log('✅ KARŞILAŞTIRMA kayıt başarılı! ID:', this.lastID);
            res.json({ success: true, id: this.lastID });
        }
    });
});

app.get('/api/karsilastirma-kayitlar', (req, res) => {
    db.all(`SELECT id, hipodrom, tarih, race_count, total_horses, kayit_tarihi FROM karsilastirma_kayitlari ORDER BY kayit_tarihi DESC`, [], (err, rows) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true, kayitlar: rows });
        }
    });
});

app.get('/api/karsilastirma-kayit/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM karsilastirma_kayitlari WHERE id = ?`, [id], (err, row) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else if (row) {
            row.siralama_veri = JSON.parse(row.siralama_veri);
            row.hesaplamalar = JSON.parse(row.hesaplamalar);
            res.json({ success: true, kayit: row });
        } else {
            res.json({ success: false, error: 'Kayıt bulunamadı' });
        }
    });
});

// ==================== YÖNETİM ÇALIŞMALARI API'leri ====================

app.post('/api/yonetim-calisma-kaydet', (req, res) => {
    const veri = req.body;
    console.log('💾 YÖNETİM çalışması kayıt isteği - Ad:', veri.ad);
    
    const sql = `INSERT INTO yonetim_calismalari (ad, aciklama, kaynak_kayit_id, kaynak_tur, tablo_veri, hesaplamalar, sutunlar) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [veri.ad, veri.aciklama, veri.kaynak_kayit_id, veri.kaynak_tur, JSON.stringify(veri.tablo_veri), JSON.stringify(veri.hesaplamalar), veri.sutunlar];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('❌ Kayıt hatası:', err.message);
            res.json({ success: false, error: err.message });
        } else {
            console.log('✅ YÖNETİM çalışması kayıt başarılı! ID:', this.lastID);
            res.json({ success: true, id: this.lastID });
        }
    });
});

app.get('/api/yonetim-calismalari', (req, res) => {
    db.all(`SELECT id, ad, aciklama, kaynak_kayit_id, kaynak_tur, kayit_tarihi FROM yonetim_calismalari ORDER BY kayit_tarihi DESC`, [], (err, rows) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true, calismalar: rows });
        }
    });
});

app.get('/api/yonetim-calisma/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM yonetim_calismalari WHERE id = ?`, [id], (err, row) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else if (row) {
            row.tablo_veri = JSON.parse(row.tablo_veri);
            row.hesaplamalar = JSON.parse(row.hesaplamalar);
            res.json({ success: true, calisma: row });
        } else {
            res.json({ success: false, error: 'Çalışma bulunamadı' });
        }
    });
});

// ==================== YÖNETİM ÇALIŞMALARI V2 API'leri ====================

app.post('/api/yonetim-calisma-kaydet-v2', (req, res) => {
    const veri = req.body;
    console.log('💾 YÖNETİM çalışması v2 kayıt isteği - Ad:', veri.ad);
    
    const sql = `INSERT INTO yonetim_calismalari_v2 (ad, aciklama, karsilastirma_kayit_id, hesaplama_kayit_id, tablo_veri, sutun_yapisi, hesaplamalar) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [veri.ad, veri.aciklama, veri.karsilastirma_kayit_id, veri.hesaplama_kayit_id, JSON.stringify(veri.tablo_veri), veri.sutun_yapisi, veri.hesaplamalar];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('❌ Kayıt hatası:', err.message);
            res.json({ success: false, error: err.message });
        } else {
            console.log('✅ YÖNETİM çalışması v2 kayıt başarılı! ID:', this.lastID);
            res.json({ success: true, id: this.lastID });
        }
    });
});

app.get('/api/yonetim-calismalari-v2', (req, res) => {
    db.all(`SELECT id, ad, aciklama, karsilastirma_kayit_id, hesaplama_kayit_id, kayit_tarihi FROM yonetim_calismalari_v2 ORDER BY kayit_tarihi DESC`, [], (err, rows) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true, calismalar: rows });
        }
    });
});

app.get('/api/yonetim-calisma-v2/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM yonetim_calismalari_v2 WHERE id = ?`, [id], (err, row) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else if (row) {
            row.tablo_veri = JSON.parse(row.tablo_veri);
            row.hesaplamalar = JSON.parse(row.hesaplamalar);
            res.json({ success: true, calisma: row });
        } else {
            res.json({ success: false, error: 'Çalışma bulunamadı' });
        }
    });
});

// ==================== PUANLAMA BİTİŞ SONUÇLARI API ====================

app.get('/api/puanlama-bitis-sonuclari', (req, res) => {
    db.get(`SELECT veri, guncelleme FROM puanlama_bitis_sonuclari WHERE id = 1`, [], (err, row) => {
        if (err) {
            res.json({ success: false, error: err.message });
            return;
        }
        let parsed = {};
        if (row?.veri) {
            try { parsed = JSON.parse(row.veri); } catch (_) { parsed = {}; }
        }
        const isLegacy = parsed && !parsed.bitis && !parsed.cikan
            && Object.values(parsed).some(v => typeof v === 'number');
        const sonuclar = isLegacy ? parsed : (parsed.bitis || {});
        const cikanAtlar = isLegacy ? {} : (parsed.cikan || {});
        res.json({ success: true, sonuclar, cikanAtlar, guncelleme: row?.guncelleme || null });
    });
});

app.post('/api/puanlama-bitis-sonuclari', (req, res) => {
    const sonuclar = req.body?.sonuclar;
    const cikanAtlar = req.body?.cikanAtlar;
    if (!sonuclar || typeof sonuclar !== 'object') {
        res.json({ success: false, error: 'Geçersiz veri' });
        return;
    }
    const wrapped = {
        bitis: sonuclar,
        cikan: cikanAtlar && typeof cikanAtlar === 'object' ? cikanAtlar : {}
    };
    const veri = JSON.stringify(wrapped);
    const sql = `INSERT INTO puanlama_bitis_sonuclari (id, veri, guncelleme) VALUES (1, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET veri = excluded.veri, guncelleme = CURRENT_TIMESTAMP`;
    db.run(sql, [veri], function(err) {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({
                success: true,
                count: Object.keys(sonuclar).length,
                cikanRaceCount: Object.keys(wrapped.cikan).length
            });
        }
    });
});

// ==================== EXCEL EXPORT API ====================
const XLSX = require('xlsx');

app.post('/api/excel-export', (req, res) => {
    try {
        const { data, baslik } = req.body;
        
        if (!data || data.length === 0) {
            return res.json({ success: false, error: 'Veri yok' });
        }
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = data[0].map(() => ({ wch: 15 }));
        XLSX.utils.book_append_sheet(wb, ws, baslik || '88ATSPEED');
        
        const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
        const base64 = excelBuffer.toString('base64');
        
        res.json({ success: true, url: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}` });
        
    } catch (error) {
        console.error('Excel hatası:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// ==================== PROSES KAPATMA ====================

process.on('SIGINT', async () => {
    if (browser) await browser.close();
    db.close();
    console.log('\n👋 Program kapatıldı. Veritabanı kapatıldı.');
    process.exit();
});

// ==================== SUNUCU BAŞLAT ====================

app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, error: 'API endpoint bulunamadı: ' + req.path });
    }
    res.status(404).send('Sayfa bulunamadı');
});

app.listen(PORT, HOST, () => {
    console.log(`\n✅ 88ATSPEED Sunucusu çalışıyor:`);
    console.log(`📍 http://${HOST}:${PORT}`);
    console.log(`💾 SQLite veritabanı hazır: atlar.db`);
    console.log(`🐎 API'ler aktif!\n`);
    if (primeBundleFromDisk()) {
        console.log('📦 Kalibrasyon bundle disk önbelleği yüklendi (MTR/HYB anında hazır)');
    }
    if (process.env.WARM_CALIBRATION === '1') {
        setTimeout(() => {
            buildCalibrationFlat()
                .then(function(b) {
                    console.log('🔥 Kalibrasyon flat önbellek: ' + b.flatCount + ' satır (' + b.buildMs + 'ms)');
                })
                .catch(function(err) {
                    console.warn('Kalibrasyon flat önbellek ısıtma atlandı:', err.message);
                });
            if (!getBundleStatus().ready) {
                buildCalibrationBundle()
                    .then(function(b) {
                        console.log('🔥 Kalibrasyon bundle önbellek: ' + b.flatCount + ' satır (' + b.buildMs + 'ms)');
                    })
                    .catch(function(err) {
                        console.warn('Kalibrasyon bundle ısıtma atlandı:', err.message);
                    });
            } else {
                scheduleBackgroundRebuild();
            }
        }, 3000);
    } else {
        console.log('Kalibrasyon ısıtma kapalı. WARM_CALIBRATION=1 ile açılır.');
    }
    sonucPoller.start(db);
    programScheduler.start(db);
}).on('error', (err) => {
    console.error('Sunucu başlatılamadı:', err.message);
    process.exit(1);
});

module.exports = { db };