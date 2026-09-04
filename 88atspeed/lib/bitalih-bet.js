/**
 * Bi'Talih sabit ihtimalli bahis — sunucu tarafı otomasyon (arka plan işleri).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const bitalihAuth = require('./bitalih-auth');
const bitalihFob = require('./bitalih-fob');
const bitalihAutoConfig = require('./bitalih-auto-config');
const {
    withPage,
    DATA_DIR,
    COOKIES_FILE,
    restoreSession
} = require('./bitalih-browser');
const jobs = require('./bitalih-jobs');
const { resolveChromePath } = require('./chrome-path');

const FIXED_ODDS_URL = bitalihAuth.FIXED_ODDS_URL;
const BET_TYPE_HASH = {
    ganyan: '',
    ilk2: '#ilk-2',
    ilk3: '#ilk-3',
    ilk4: '#ilk-4'
};
const BET_TYPE_LABEL = {
    ganyan: 'Ganyan',
    ilk2: 'İlk 2',
    ilk3: 'İlk 3',
    ilk4: 'İlk 4'
};
const QUEUE_DIR = path.join(DATA_DIR, 'bitalih-queue');
const HEARTBEAT_FILE = path.join(DATA_DIR, 'bitalih-worker-heartbeat.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
    jobs.pruneOldJobs();
}

function isWorkerAlive() {
    try {
        const hb = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf8'));
        return Date.now() - (hb.at || 0) < 120000;
    } catch (_) {
        return false;
    }
}

function enqueueTask(task) {
    ensureDataDir();
    const file = path.join(QUEUE_DIR, task.jobId + '.json');
    fs.writeFileSync(file, JSON.stringify(task), { mode: 0o600 });
    jobs.updateJob(task.jobId, { meta: { queued: true } });
}

function prepareLoginJob(ssn, password) {
    const chromePath = resolveChromePath();
    const job = jobs.createJob('login');
    if (!chromePath) {
        jobs.failJob(
            job.id,
            'Sunucuda Chrome yok. SSH: bash /var/www/88atspeed/deploy/fix-server.sh',
            'no_chrome'
        );
        return { job, chromePath: null, ssn: null, password: null };
    }
// Worker yoksa bile kuyruğa yaz — worker birkaç sn içinde alır
    return { job, chromePath, ssn: String(ssn).trim(), password: String(password) };
}

function runLoginJob(jobId, ssn, password) {
    enqueueTask({ type: 'login', jobId, ssn, password });
}

function prepareBetJob(opts) {
    const chromePath = resolveChromePath();
    const job = jobs.createJob('bet', opts);
    if (!chromePath) {
        jobs.failJob(job.id, 'Sunucuda Chrome yok. fix-server.sh çalıştırın.', 'no_chrome');
        return { job, chromePath: null };
    }
    return { job, chromePath };
}

function runBetJob(jobId, opts) {
    enqueueTask({ type: 'bet', jobId, opts: opts || {} });
}

function startLoginJob(ssn, password) {
    const prep = prepareLoginJob(ssn, password);
    if (prep.ssn && prep.password) {
        runLoginJob(prep.job.id, prep.ssn, prep.password);
    }
    return prep.job;
}

function startBetJob(opts) {
    const prep = prepareBetJob(opts);
    if (prep.chromePath) {
        runBetJob(prep.job.id, opts);
    }
    return prep.job;
}

function childEnv(chromePath, creds) {
    const env = {
        NODE_ENV: process.env.NODE_ENV || 'production',
        PATH: process.env.PATH || '/usr/bin:/bin',
        HOME: process.env.HOME || '/root',
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1',
        PUPPETEER_SKIP_DOWNLOAD: '1',
        CHROME_PATH: chromePath || '',
        PUPPETEER_EXECUTABLE_PATH: chromePath || ''
    };
    if (creds?.ssn) env.BITALIH_SSN = String(creds.ssn);
    if (creds?.password) env.BITALIH_PASS = String(creds.password);
    return env;
}

function runChildScriptSync(scriptName, args, timeoutMs) {
    const script = path.join(__dirname, '..', 'scripts', scriptName);
    const chromePath = resolveChromePath();
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, ...args], {
            cwd: path.join(__dirname, '..'),
            env: childEnv(chromePath, { ssn: args[0], password: args[1] }),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let out = '';
        let errOut = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            const e = new Error('İşlem zaman aşımına uğradı');
            e.code = 'timeout';
            reject(e);
        }, timeoutMs || 120000);
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.stderr.on('data', (d) => { errOut += d.toString(); });
        child.on('close', () => {
            clearTimeout(timer);
            const line = out.trim().split('\n').filter(Boolean).pop();
            try {
                resolve(JSON.parse(line || '{}'));
            } catch (_) {
                reject(new Error(errOut || out || 'Alt süreç yanıt vermedi'));
            }
        });
        child.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}

async function profileFromSession() {
    const session = await bitalihAuth.fetchSessionRemote();
    if (!session?.authenticated) {
        return { success: false, loggedIn: false };
    }
    return { success: true, loggedIn: true, ...bitalihAuth.publicProfile(session), method: 'browser' };
}

async function saveLogin(ssn, password) {
    const result = await runChildScriptSync('bitalih-browser-login.js', [ssn, password], 120000);
    if (!result.success) {
        const e = new Error(result.error || 'Giriş başarısız');
        e.code = result.code || 'login_failed';
        throw e;
    }
    return profileFromSession();
}

async function dismissCookieBanner(page) {
    await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, a')];
        const accept = btns.find((b) => /kabul|anladım|tamam/i.test((b.textContent || '').trim()));
        if (accept) accept.click();
    });
}

async function dismissOnboarding(page) {
    await page.evaluate(() => {
        [...document.querySelectorAll('button, a')].forEach((b) => {
            const t = (b.textContent || '').trim();
            if (/öğrenmeye başla|teşekkürler|istemiyorum|anladım|kapat|tamam|kabul/i.test(t)) {
                b.click();
            }
        });
    });
    await sleep(400);
}

async function readSessionState(page) {
    return page.evaluate(async () => {
        const r = await fetch('/api/auth/session');
        const j = await r.json();
        if (!j.authenticated) return { loggedIn: false };
        const pi = j.playerInfo || {};
        const wallet = pi.wallet || {};
        return {
            loggedIn: true,
            displayName: [pi.firstname, pi.lastname].filter(Boolean).join(' ') || j.user?.username,
            balance: wallet.totalBalance || null
        };
    });
}

async function ensureLoggedIn(page) {
    await restoreSession(page);
    await page.goto(FIXED_ODDS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2000);
    await dismissCookieBanner(page);
    const state = await readSessionState(page);
    if (state.loggedIn) return state;
    const err = new Error('Bi\'Talih oturumu yok. Önce Sunucuda Giriş Yapın (TC ile).');
    err.code = 'not_logged_in';
    throw err;
}

async function clickByText(page, pattern, exact) {
    return page.evaluate((pat, isExact) => {
        const re = isExact ? new RegExp('^' + pat + '$', 'i') : new RegExp(pat, 'i');
        const nodes = [...document.querySelectorAll('button, a, span, div, li')];
        const el = nodes.find((n) => {
            const t = (n.textContent || '').trim();
            return t && t.length <= 80 && re.test(t);
        });
        if (!el) return false;
        el.click();
        return true;
    }, pattern, !!exact);
}

function normalizeBetType(raw) {
    const s = String(raw || 'ganyan').toLocaleLowerCase('tr-TR')
        .normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/\s+/g, '');
    if (s === 'ilk2' || s === 'ilkiki' || s === 'top2') return 'ilk2';
    if (s === 'ilk3' || s === 'ilkuc' || s === 'top3') return 'ilk3';
    if (s === 'ilk4' || s === 'ilkdort' || s === 'top4') return 'ilk4';
    return 'ganyan';
}

function buildFixoRaceUrl(raceNo, betType) {
    const no = Number(raceNo) || 1;
    const hash = '#' + no + '-kosu' + (BET_TYPE_HASH[betType] || '');
    return FIXED_ODDS_URL + hash;
}

async function selectHipodrom(page, city) {
    const ok = await page.evaluate((cityName) => {
        const tabs = [...document.querySelectorAll('div.cursor-pointer, button, a')];
        for (const el of tabs) {
            const t = (el.textContent || '').trim();
            if (t.length > 40) continue;
            if (t === cityName || t.startsWith(cityName + '​') || t.startsWith(cityName + ' ')) {
                el.click();
                return true;
            }
        }
        return false;
    }, city);
    if (!ok) {
        const cityPattern = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return clickByText(page, cityPattern, false);
    }
    return true;
}

async function waitForRaceTable(page, horseName, horseNo, timeoutMs = 20000) {
    const nameEsc = horseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        await page.waitForFunction((name, no) => {
            const re = new RegExp(name, 'i');
            return [...document.querySelectorAll('tr')].some((r) => {
                if (no) {
                    const badge = r.querySelector('div[class*="font-bold"][class*="rounded"]');
                    if (badge && badge.textContent.trim() === String(no)) return true;
                }
                return re.test(r.textContent || '');
            });
        }, { timeout: timeoutMs, polling: 400 }, nameEsc, horseNo || '');
    } catch (_) { /* devam */ }
}

async function resolveHorseNo(city, raceNo, horseName) {
    try {
        const data = await bitalihFob.fetchFobForHipodrom({ hipodrom: city });
        const race = data.races?.[String(raceNo)];
        if (!race) return null;
        const target = bitalihFob.normalizeHipName(horseName);
        for (const col of ['ganyan', 'ilk2', 'ilk3', 'ilk4']) {
            const byName = race.bets?.[col]?.byName || {};
            const byNo = race.bets?.[col]?.byNo || {};
            for (const [nk, odd] of Object.entries(byName)) {
                if (nk === target || nk.includes(target) || target.includes(nk)) {
                    for (const [no, o] of Object.entries(byNo)) {
                        if (String(o) === String(odd)) return no;
                    }
                }
            }
        }
    } catch (_) { /* */ }
    return null;
}

async function clickHorseOdds(page, horseName, betType, horseNo) {
    const nameEsc = horseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rowHandle = await page.evaluateHandle((name, no) => {
        const re = new RegExp(name, 'i');
        return [...document.querySelectorAll('tr')].find((r) => {
            if (no) {
                const badges = [...r.querySelectorAll('div')].filter((d) => {
                    const cls = d.className || '';
                    return cls.includes('font-bold') && cls.includes('rounded') && cls.includes('w-6');
                });
                if (badges.some((b) => b.textContent.trim() === String(no))) return true;
            }
            return re.test(r.textContent || '');
        }) || null;
    }, nameEsc, horseNo || '');

    const row = rowHandle.asElement();
    if (!row) return { ok: false, reason: 'row_not_found' };

    const pick = await page.evaluate((rowEl, type) => {
        function mainOddCells(r) {
            const cells = [];
            const seen = new Set();
            for (const el of [...r.querySelectorAll('div, button')]) {
                const cls = el.className || '';
                const t = (el.textContent || '').replace(/\s+/g, '').trim();
                if (!/^\d+\.\d+$/.test(t)) continue;
                const isMain = (cls.includes('h-8') && cls.includes('rounded') && cls.includes('w-[52px]'))
                    || (cls.includes('h-8') && cls.includes('rounded'))
                    || (cls.includes('52px') && cls.includes('rounded'))
                    || el.tagName === 'BUTTON';
                if (!isMain) continue;
                if (seen.has(t)) continue;
                seen.add(t);
                cells.push(el);
            }
            return cells;
        }
        const cells = mainOddCells(rowEl);
        const idxMap = { ganyan: 0, ilk2: 0, ilk3: 1, ilk4: 2 };
        const idx = idxMap[type] ?? 0;
        const btn = cells[idx] || cells[0];
        if (!btn) return { ok: false, reason: 'odds_not_found', count: cells.length };
        btn.scrollIntoView({ block: 'center', inline: 'center' });
        btn.click();
        return {
            ok: true,
            odd: (btn.textContent || '').replace(/\s+/g, '').trim(),
            index: idx,
            total: cells.length
        };
    }, row, betType);

    return pick;
}

async function waitForBetSlip(page, timeoutMs = 12000) {
    try {
        await page.waitForFunction(() => {
            return [...document.querySelectorAll('div')].some((d) => {
                const t = d.innerText || '';
                return t.includes('Maksimum Kazanç') && t.includes('Toplam Oran') && t.includes('Hemen Oyna');
            });
        }, { timeout: timeoutMs, polling: 300 });
        return true;
    } catch (_) {
        return false;
    }
}

async function setStakeInSlip(page, stake) {
    await waitForBetSlip(page);
    return page.evaluate((amount) => {
        const slips = [...document.querySelectorAll('div')].filter((d) => {
            const t = d.innerText || '';
            return t.includes('Maksimum Kazanç') && t.includes('Toplam Oran') && t.includes('Hemen Oyna')
                && !t.includes('Bahis Detayı');
        }).sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
        const slip = slips[0];
        if (!slip) return { ok: false, reason: 'slip_not_found' };

        const preset = [...slip.querySelectorAll('button, div, span')].find((el) => {
            return (el.textContent || '').trim() === String(amount)
                && el.getBoundingClientRect().width > 0;
        });
        if (preset) preset.click();

        const checkbox = slip.querySelector('input[type=checkbox]');
        if (checkbox && !checkbox.checked) checkbox.click();

        const misli = [...slip.querySelectorAll('input')].find((i) => {
            return i.type === 'text' && (i.className || '').includes('h-10');
        }) || [...slip.querySelectorAll('input')].find((i) => i.type === 'number');

        if (!misli) return { ok: false, reason: 'stake_input_not_found' };

        misli.focus();
        misli.click();
        const val = String(amount);
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (desc?.set) desc.set.call(misli, val);
        else misli.value = val;
        misli.dispatchEvent(new Event('input', { bubbles: true }));
        misli.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: misli.value };
    }, stake);
}

async function findHemenButton(page, requiredTexts, excludeTexts) {
    const handle = await page.evaluateHandle((required, exclude) => {
        const candidates = [...document.querySelectorAll('div, section, aside, [role=dialog]')]
            .filter((d) => {
                const t = d.innerText || '';
                if (!required.every((s) => t.includes(s))) return false;
                if (exclude.some((s) => s && t.includes(s))) return false;
                return true;
            })
            .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
        const container = candidates[0];
        if (!container) return null;
        return [...container.querySelectorAll('button')].find((b) => {
            return /^hemen oyna$/i.test((b.textContent || '').trim()) && !b.disabled;
        }) || null;
    }, requiredTexts, excludeTexts || []);
    return handle.asElement();
}

async function clickHemenButton(page, requiredTexts, excludeTexts) {
    const btn = await findHemenButton(page, requiredTexts, excludeTexts);
    if (!btn) return false;
    const box = await btn.boundingBox();
    if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
        await btn.click();
    }
    return true;
}

async function waitForConfirmModal(page, timeoutMs = 10000) {
    try {
        await page.waitForFunction(() => {
            return [...document.querySelectorAll('div, [role=dialog]')].some((d) => {
                const t = d.innerText || '';
                return t.includes('Bahis Detayı') && t.includes('Toplam Tutar');
            });
        }, { timeout: timeoutMs, polling: 300 });
        return true;
    } catch (_) {
        return false;
    }
}

function watchBetResponses(page) {
    const hits = [];
    const handler = async (res) => {
        const url = res.url();
        if (!/\/api\//i.test(url)) return;
        if (!/bet|kupon|coupon|ticket|play|slip|fixo/i.test(url)) return;
        try {
            const json = await res.json();
            hits.push({ url, status: res.status(), body: json });
        } catch (_) {
            hits.push({ url, status: res.status(), body: null });
        }
    };
    page.on('response', handler);
    return {
        hits,
        detach: () => page.off('response', handler)
    };
}

async function submitFixedOddsCoupon(page, stake) {
    const steps = [];

    const stakeRes = await setStakeInSlip(page, stake);
    steps.push({ step: 'stake_slip', ok: !!stakeRes?.ok, detail: stakeRes });
    if (!stakeRes?.ok) {
        return { ok: false, step: 'stake_input_not_found', steps, detail: stakeRes };
    }
    await sleep(600);

    const slipHemen = await clickHemenButton(page, ['Toplam Oran', 'Maksimum Kazanç', 'Hemen Oyna'], ['Bahis Detayı']);
    steps.push({ step: 'hemen_slip', ok: slipHemen });
    if (!slipHemen) {
        return { ok: false, step: 'hemen_slip_not_found', steps };
    }
    await sleep(2500);

    const modalOk = await waitForConfirmModal(page);
    steps.push({ step: 'confirm_modal', ok: modalOk });
    if (!modalOk) {
        return { ok: false, step: 'confirm_modal_missing', steps };
    }

    const confirmHemen = await clickHemenButton(page, ['Bahis Detayı', 'Toplam Tutar', 'Hemen Oyna'], []);
    steps.push({ step: 'hemen_confirm', ok: confirmHemen });
    if (!confirmHemen) {
        return { ok: false, step: 'hemen_confirm_not_found', steps };
    }
    await sleep(5000);
    return { ok: true, step: 'submitted', steps };
}

async function detectBetSuccess(page, apiHits) {
    const apiOk = apiHits.some((h) => {
        if (h.status < 200 || h.status >= 300) return false;
        if (/auth|session|fixo-bulletin|bulletin/i.test(h.url)) return false;
        const b = h.body;
        if (!b || typeof b !== 'object') return false;
        if (/bet|kupon|coupon|ticket|play|slip|wager|stake/i.test(h.url)) {
            if (b.success === true) return true;
            if (b.data?.success === true) return true;
            if (b.data?.ticketId || b.data?.couponId || b.data?.betId || b.data?.id) return true;
        }
        return false;
    });
    if (apiOk) return true;

    return page.evaluate(() => {
        const toastSel = '[role=alert], [class*="toast"], [class*="Toast"], [class*="snackbar"], [class*="notification"], [class*="modal"]';
        const texts = [...document.querySelectorAll(toastSel)]
            .map((el) => (el.innerText || '').trim())
            .filter((t) => t.length > 0 && t.length < 500)
            .join('\n');
        return /bahis oynandı|kuponunuz oynandı|kupon başarıyla|biletiniz oluşturuldu|işleminiz başarıyla tamamlandı/i.test(texts);
    });
}

async function selectBetTypeTab(page, betType) {
    if (betType === 'ganyan') {
        const ok = await clickByText(page, 'Ganyan', true);
        if (ok) await sleep(1200);
        return ok;
    }
    if (betType === 'ilk2' || betType === 'ilk3' || betType === 'ilk4') {
        const ok = await page.evaluate(() => {
            const btn = [...document.querySelectorAll('button')].find((b) => {
                const t = (b.textContent || '').trim();
                return t === 'İlk 2-3-4' || t === 'İlk 2' || t.includes('İlk 2');
            });
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (ok) await sleep(1200);
        return ok;
    }
    return false;
}

async function getAutoStatus() {
    if (fs.existsSync(COOKIES_FILE)) {
        try {
            const session = await bitalihAuth.fetchSessionRemote();
            if (session?.authenticated) {
                return bitalihAuth.publicProfile(session);
            }
        } catch (_) { /* */ }
    }
    return { loggedIn: false };
}

async function placeFixedOddsBetInternal(opts = {}) {
    const city = String(opts.city || opts.hipodrom || 'Bursa').trim();
    const raceNo = Number(opts.raceNo || opts.kosuNo || 1);
    const horseName = String(opts.horseName || opts.at || '').trim();
    const stake = Number(opts.stake || opts.misli || 20);
    const betType = normalizeBetType(opts.betType || opts.bahis || opts.bet);
    const dryRun = !!opts.dryRun;
    if (!horseName) throw new Error('At adı gerekli');

    return withPage(async (page) => {
        const session = await ensureLoggedIn(page);
        await page.setViewport({ width: 1920, height: 1080 });

        const autoCfg = bitalihAutoConfig.getAutoConfig();
        const horseNo = opts.horseNo || autoCfg.bet?.horseNo || await resolveHorseNo(city, raceNo, horseName);
        const raceUrl = buildFixoRaceUrl(raceNo, betType);

        await page.goto(FIXED_ODDS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(2000);
        await dismissCookieBanner(page);
        await dismissOnboarding(page);

        if (!await selectHipodrom(page, city)) {
            const err = new Error('Hipodrom bulunamadı: ' + city);
            err.code = 'city_not_found';
            throw err;
        }
        await sleep(2500);

        await page.goto(raceUrl, { waitUntil: 'networkidle2', timeout: 90000 }).catch(async () => {
            await page.goto(raceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        });
        await sleep(3500);
        await dismissCookieBanner(page);
        await dismissOnboarding(page);
        await waitForRaceTable(page, horseName, horseNo, 25000);
        await selectBetTypeTab(page, betType);

        let horsePick = await clickHorseOdds(page, horseName, betType, horseNo);
        if (!horsePick?.ok && betType === 'ilk2') {
            const altUrl = FIXED_ODDS_URL + '#' + raceNo + '-kosu#ilk-2-3-4';
            await page.goto(altUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await sleep(3000);
            await waitForRaceTable(page, horseName, horseNo, 20000);
            horsePick = await clickHorseOdds(page, horseName, betType, horseNo);
        }
        if (!horsePick?.ok) {
            const err = new Error('At veya oran bulunamadı: ' + horseName
                + (horsePick?.reason ? ' (' + horsePick.reason + ')' : ''));
            err.code = 'horse_not_found';
            err.detail = Object.assign({}, horsePick, { horseNo });
            throw err;
        }
        await sleep(2000);

        const slipReady = await waitForBetSlip(page, 15000);
        if (!slipReady && !dryRun) {
            const err = new Error('Kupon paneli açılmadı — oran tıklaması başarısız olabilir');
            err.code = 'slip_not_found';
            throw err;
        }

        const betLabel = BET_TYPE_LABEL[betType] || betType;
        if (dryRun) {
            const slipInfo = await page.evaluate(() => {
                const slip = [...document.querySelectorAll('div')].find((d) => {
                    const t = d.innerText || '';
                    return t.includes('Maksimum Kazanç') && t.includes('Toplam Oran');
                });
                return slip ? slip.innerText.slice(0, 300) : '';
            });
            return {
                success: true,
                dryRun: true,
                message: 'Kupon hazır (test) — ' + betLabel + ' @ ' + horsePick.odd,
                session,
                city,
                raceNo,
                horseName,
                stake,
                betType,
                odd: horsePick.odd,
                slipPreview: slipInfo
            };
        }

        const betWatch = watchBetResponses(page);
        const submit = await submitFixedOddsCoupon(page, stake);
        betWatch.detach();
        if (!submit.ok) {
            const errMsg = {
                hemen_slip_not_found: 'Kupon panelinde Hemen Oyna bulunamadı',
                confirm_modal_missing: 'Bahis Detayı onay penceresi açılmadı — 1. Hemen Oyna tıklanamadı',
                hemen_confirm_not_found: 'Onay penceresinde Hemen Oyna bulunamadı',
                stake_input_not_found: 'Kupon panelinde misli alanı yok'
            }[submit.step] || 'Kupon gönderilemedi';
            const err = new Error(errMsg);
            err.code = submit.step || 'play_button_not_found';
            err.detail = submit;
            throw err;
        }

        const ok = await detectBetSuccess(page, betWatch.hits);
        return {
            success: true,
            confirmed: ok,
            message: ok
                ? ('Bahis oynandı — ' + betLabel + ' @ ' + horsePick.odd)
                : ('Kupon onaylanamadı — Bi\'Talih panelinden kontrol edin (' + betLabel + ' @ ' + horsePick.odd + ')'),
            steps: submit.steps,
            session,
            city,
            raceNo,
            horseName,
            stake,
            betType,
            odd: horsePick.odd
        };
    }, 180000);
}

async function placeFixedOddsBet(opts) {
    const result = await runChildScriptSync('bitalih-bet-worker.js', [JSON.stringify(opts || {})], 200000);
    if (!result.success) {
        const e = new Error(result.error || 'Bahis başarısız');
        e.code = result.code;
        e.detail = result.detail;
        throw e;
    }
    return result;
}

function getJob(jobId) {
    return jobs.readJob(jobId);
}

module.exports = {
    placeFixedOddsBet,
    placeFixedOddsBetInternal,
    getAutoStatus,
    saveLogin,
    prepareLoginJob,
    runLoginJob,
    prepareBetJob,
    runBetJob,
    startLoginJob,
    startBetJob,
    getJob,
    isWorkerAlive
};
