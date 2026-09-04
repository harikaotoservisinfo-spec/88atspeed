(function() {
    'use strict';

    const BITALIH_URL = 'https://www.bitalih.com/';
    const BITALIH_LINKS = [
        { label: 'Sabit İhtimalli', url: 'https://www.bitalih.com/at-yarisi/tjk-sabit-ihtimalli-bahis', accent: '#c62828' },
        { label: 'Bahis Yap', url: 'https://www.bitalih.com/at-yarisi', accent: '#1565c0' },
        { label: 'Kuponlarım', url: 'https://www.bitalih.com/kuponlarim', accent: '#2e7d32' },
        { label: 'Ana Sayfa', url: BITALIH_URL, accent: '#455a64' }
    ];
    let iframeSrc = BITALIH_LINKS[0].url;
    let shellReady = false;
    let autoStatus = null;
    let autoSetup = null;
    const SESSION_STORE_KEY = 'bitalih:autoState';

    function loadAutoState() {
        try {
            return JSON.parse(sessionStorage.getItem(SESSION_STORE_KEY) || '{}');
        } catch (_) {
            return {};
        }
    }

    function saveAutoState(patch) {
        const cur = loadAutoState();
        sessionStorage.setItem(SESSION_STORE_KEY, JSON.stringify(Object.assign({}, cur, patch, {
            updatedAt: Date.now()
        })));
    }

    function clearAutoState() {
        sessionStorage.removeItem(SESSION_STORE_KEY);
    }

    let autoPipelineStarted = false;

    const $ = (sel, root) => (root || document).querySelector(sel);

    async function parseJsonResponse(res) {
        const text = await res.text();
        if (!text) return { ok: false, error: 'Sunucu boş yanıt döndü.' };
        try {
            return { ok: true, data: JSON.parse(text) };
        } catch (_) {
            if (text.trim().startsWith('<')) {
                const is502 = res.status === 502 || /502 Bad Gateway/i.test(text);
                return {
                    ok: false,
                    error: is502
                        ? 'Sunucu yeniden başlıyor (502). 10 sn bekleyip tekrar deneyin. Devam ederse SSH: bash /var/www/88atspeed/deploy/fix-server.sh'
                        : 'Sunucu HTML döndü (HTTP ' + res.status + '). fix-server.sh gerekli.'
                };
            }
            return { ok: false, error: 'Geçersiz sunucu yanıtı (HTTP ' + res.status + ')' };
        }
    }

    function escapeHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const BET_TYPES = [
        { v: 'ganyan', l: 'Ganyan' },
        { v: 'ilk2', l: 'İlk 2' },
        { v: 'ilk3', l: 'İlk 3' },
        { v: 'ilk4', l: 'İlk 4' }
    ];

    function betTypeOptions(selected) {
        return BET_TYPES.map((t) => {
            const sel = (selected || 'ilk2') === t.v ? ' selected' : '';
            return '<option value="' + t.v + '"' + sel + '>' + t.l + '</option>';
        }).join('');
    }

    function betTypeChips(selected) {
        const cur = selected || 'ilk2';
        return '<div class="pub-kazanc-bet-types" id="pubBetTypeChips">'
            + '<span class="pub-kazanc-bet-types-label">Bahis türü</span>'
            + BET_TYPES.map((t) => {
                const active = cur === t.v ? ' pub-kazanc-bet-chip-active' : '';
                return '<button type="button" class="pub-kazanc-bet-chip' + active + '" data-bet-type="' + t.v + '">' + t.l + '</button>';
            }).join('')
            + '</div>';
    }

    function syncBetTypeChips(root, betType) {
        root.querySelectorAll('.pub-kazanc-bet-chip').forEach((btn) => {
            btn.classList.toggle('pub-kazanc-bet-chip-active', btn.dataset.betType === betType);
        });
        const sel = $('#pubBetType', root);
        if (sel) sel.value = betType;
        highlightHorseOddsCard(root, betType);
    }

    function normalizeHorseName(s) {
        return String(s || '').toLocaleLowerCase('tr-TR')
            .normalize('NFD').replace(/\p{M}/gu, '')
            .replace(/[^a-z0-9]/g, '');
    }

    function highlightHorseOddsCard(root, betType) {
        const panel = $('#pubHorseOddsPanel', root);
        if (!panel) return;
        panel.querySelectorAll('.pub-kazanc-horse-odd-card').forEach((card) => {
            card.classList.toggle('pub-kazanc-horse-odd-active', card.dataset.betType === betType);
        });
    }

    function renderAutomationSteps(steps) {
        if (!steps?.length) return '';
        const labels = {
            stake_slip: 'Misli ayarlandı',
            hemen_slip: 'Kupon paneli → Hemen Oyna',
            confirm_modal: 'Bahis Detayı penceresi',
            hemen_confirm: 'Onay → Hemen Oyna'
        };
        return '<div class="pub-kazanc-auto-steps">'
            + '<div class="pub-kazanc-auto-steps-hdr">Otomasyon adımları</div>'
            + '<ul>'
            + steps.map((s) => {
                const cls = s.ok ? 'pub-kazanc-step-ok' : 'pub-kazanc-step-fail';
                return '<li class="' + cls + '">' + escapeHtml(labels[s.step] || s.step) + (s.ok ? ' ✓' : ' ✗') + '</li>';
            }).join('')
            + '</ul></div>';
    }

    function showAutomationSteps(steps) {
        const panel = document.getElementById('pubAutoStepsPanel');
        if (!panel) return;
        panel.innerHTML = renderAutomationSteps(steps);
    }

    function renderHorseOddsPanelContent(data, selectedBetType, state) {
        const horse = data?.horseName || '';
        const horseNo = data?.horseNo ? ('#' + data.horseNo + ' ') : '';
        const city = data?.city || '';
        const raceNo = data?.raceNo || '';
        if (state === 'loading') {
            return '<div class="pub-kazanc-horse-odds-hdr">Bi\'Talih oranları yükleniyor…</div>'
                + '<div class="pub-kazanc-horse-odds-grid pub-kazanc-horse-odds-loading">'
                + BET_TYPES.map((t) => '<div class="pub-kazanc-horse-odd-card"><span>' + t.l + '</span><strong>…</strong></div>').join('')
                + '</div>';
        }
        if (state === 'error') {
            return '<div class="pub-kazanc-horse-odds-hdr pub-kazanc-horse-odds-err">' + escapeHtml(data?.error || 'Oran alınamadı') + '</div>';
        }
        const odds = data?.odds || {};
        return '<div class="pub-kazanc-horse-odds-hdr">'
            + '<span>' + escapeHtml(horseNo + horse) + ' · ' + escapeHtml(city) + ' ' + raceNo + '. koşu</span>'
            + '<span class="pub-kazanc-horse-odds-src">Bi\'Talih FİXO</span></div>'
            + '<div class="pub-kazanc-horse-odds-grid" id="pubHorseOddsGrid">'
            + BET_TYPES.map((t) => {
                const odd = odds[t.v] || '—';
                const active = selectedBetType === t.v ? ' pub-kazanc-horse-odd-active' : '';
                const hasOdd = odd && odd !== '—';
                return '<button type="button" class="pub-kazanc-horse-odd-card' + active + (hasOdd ? '' : ' pub-kazanc-horse-odd-empty') + '" data-bet-type="' + t.v + '">'
                    + '<span class="pub-kazanc-horse-odd-label">' + t.l + '</span>'
                    + '<strong class="pub-kazanc-horse-odd-val">' + escapeHtml(odd) + '</strong>'
                    + '</button>';
            }).join('')
            + '</div>';
    }

    let horseOddsTimer = null;
    let horseOddsCacheKey = '';

    async function fetchHorseOdds(city, raceNo, horseName) {
        const res = await fetch('/api/public/bitalih-fob?hipodrom=' + encodeURIComponent(city));
        const parsed = await parseJsonResponse(res);
        if (!parsed.ok || !parsed.data?.races) {
            return { error: parsed.error || parsed.data?.error || 'Bi\'Talih oranları alınamadı' };
        }
        const race = parsed.data.races[String(raceNo)];
        if (!race) return { error: raceNo + '. koşu bulunamadı (' + city + ')' };

        const target = normalizeHorseName(horseName);
        const odds = {};
        let horseNo = null;
        for (const t of BET_TYPES) {
            const byName = race.bets?.[t.v]?.byName || {};
            const byNo = race.bets?.[t.v]?.byNo || {};
            let odd = '';
            for (const [nameKey, val] of Object.entries(byName)) {
                if (nameKey === target || nameKey.includes(target) || target.includes(nameKey)) {
                    odd = val;
                    if (!horseNo) {
                        for (const [no, o] of Object.entries(byNo)) {
                            if (String(o) === String(val)) { horseNo = no; break; }
                        }
                    }
                    break;
                }
            }
            odds[t.v] = odd || '—';
        }
        if (!Object.values(odds).some((o) => o && o !== '—')) {
            return { error: 'At bulunamadı: ' + horseName };
        }
        return { city, raceNo, horseName, horseNo, odds };
    }

    function scheduleHorseOddsRefresh(root) {
        if (horseOddsTimer) clearTimeout(horseOddsTimer);
        horseOddsTimer = setTimeout(() => refreshHorseOddsPanel(root), 400);
    }

    async function refreshHorseOddsPanel(root) {
        const panel = $('#pubHorseOddsPanel', root);
        if (!panel) return;
        const city = $('#pubBetCity', root)?.value?.trim();
        const raceNo = Number($('#pubBetRace', root)?.value);
        const horseName = $('#pubBetHorse', root)?.value?.trim();
        const betType = $('#pubBetType', root)?.value || 'ilk2';
        if (!city || !horseName || !raceNo) {
            panel.innerHTML = '<div class="pub-kazanc-horse-odds-hdr pub-kazanc-horse-odds-muted">Şehir, koşu ve at adı girin — Bi\'Talih oranları burada görünür.</div>';
            return;
        }
        const key = city + '|' + raceNo + '|' + horseName;
        if (key !== horseOddsCacheKey) {
            panel.innerHTML = renderHorseOddsPanelContent({ horseName, city, raceNo }, betType, 'loading');
        }
        horseOddsCacheKey = key;
        const data = await fetchHorseOdds(city, raceNo, horseName);
        panel.innerHTML = renderHorseOddsPanelContent(
            data.error ? data : data,
            betType,
            data.error ? 'error' : 'ready'
        );
        panel.querySelectorAll('.pub-kazanc-horse-odd-card').forEach((card) => {
            card.addEventListener('click', () => {
                const bt = card.dataset.betType;
                syncBetTypeChips(root, bt);
                scheduleHorseOddsRefresh(root);
            });
        });
        highlightHorseOddsCard(root, betType);
    }

    function renderSystemPlayPanel(opts) {
        const err = opts?.autoError || '';
        const ok = opts?.autoOk || '';
        const st = autoStatus || {};
        const bet = autoSetup?.bet || {};
        return '<div class="pub-kazanc-system" id="pubKazancSystem">'
            + '<div class="pub-kazanc-system-hdr">'
            + '<span>⚡ Sistem Oyna</span>'
            + '<span class="pub-kazanc-system-status" id="pubKazancAutoStatus">'
            + (st.loggedIn ? ('Sunucu oturumu: ' + escapeHtml(st.displayName || 'açık') + (st.balance ? ' · ' + escapeHtml(st.balance) : ''))
                : 'Otomatik giriş bekleniyor…')
            + '</span></div>'
            + '<p class="pub-kazanc-system-desc">Sunucu oturumu açık kalır; sayfa yenilense veya sekmeler arası geçiş yapsanız tekrar giriş denenmez. Kupon için Sistem Oyna kullanın.</p>'
            + '<div class="pub-kazanc-system-login" id="pubKazancAutoLogin">'
            + '<input type="text" id="pubAutoUser" autocomplete="username" placeholder="TC kimlik no" value="' + escapeHtml(autoSetup?.username || '') + '">'
            + '<input type="password" id="pubAutoPass" autocomplete="current-password" placeholder="Şifre" value="' + escapeHtml(autoSetup?.password || '') + '">'
            + '<button type="button" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-primary" id="pubAutoLoginBtn">Sunucuda Giriş Yap</button>'
            + '</div>'
            + '<p class="pub-kazanc-system-hint" id="pubAutoPipelineHint">Otomatik akış başlatılıyor…</p>'
            + '<form id="pubKazancBetForm" class="pub-kazanc-system-form">'
            + '<input type="text" id="pubBetCity" value="' + escapeHtml(bet.city || 'Bursa') + '" placeholder="Şehir">'
            + '<input type="number" id="pubBetRace" value="' + (bet.raceNo || 1) + '" min="1" max="15" placeholder="Koşu">'
            + '<input type="text" id="pubBetHorse" value="' + escapeHtml(bet.horseName || 'LA BOMBONERA') + '" placeholder="At adı">'
            + '<select id="pubBetType" class="pub-kazanc-bet-type" title="Bahis türü">'
            + betTypeOptions(bet.betType)
            + '</select>'
            + '<input type="number" id="pubBetStake" value="' + (bet.stake || 20) + '" min="1" step="1" placeholder="Misli TL">'
            + '<button type="submit" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-primary pub-kazanc-system-play" id="pubBetPlayBtn">Sistem Oyna</button>'
            + '<button type="button" class="pub-kazanc-strip-btn" id="pubBetDryBtn">Test (oynama)</button>'
            + '</form>'
            + betTypeChips(bet.betType)
            + '<div class="pub-kazanc-horse-odds" id="pubHorseOddsPanel">'
            + '<div class="pub-kazanc-horse-odds-hdr pub-kazanc-horse-odds-muted">At seçin — bahis türü oranları burada görünür.</div>'
            + '</div>'
            + '<div id="pubAutoStepsPanel" class="pub-kazanc-auto-steps-wrap"></div>'
            + (ok ? '<div class="pub-kazanc-strip-ok">' + escapeHtml(ok) + '</div>' : '')
            + (err ? '<div class="pub-kazanc-strip-error">' + escapeHtml(err) + '</div>' : '')
            + '</div>';
    }

    function renderInfoBanner() {
        return '<div class="pub-kazanc-info" id="pubKazancInfo">'
            + '<span class="pub-kazanc-info-icon">🎯</span>'
            + '<div><strong>Otomatik mod:</strong> '
            + 'Giriş + kupon kesimi müdahalesiz çalışır. Manuel oyun için alttaki Bi\'Talih panelini kullanın.</div></div>';
    }

    function renderQuickNav() {
        return '<div class="pub-kazanc-quicknav" id="pubKazancQuicknav">'
            + BITALIH_LINKS.map((l) => {
                const active = iframeSrc === l.url ? ' pub-kazanc-quicknav-active' : '';
                return '<button type="button" class="pub-kazanc-quicknav-btn' + active + '" data-bitalih-url="' + l.url + '" style="--qn-accent:' + l.accent + '">' + escapeHtml(l.label) + '</button>';
            }).join('')
            + '</div>';
    }

    function renderIframeBlock() {
        return '<div class="pub-kazanc-embed pub-kazanc-embed-play" id="pubKazancEmbed">'
            + '<div class="pub-kazanc-embed-hdr">'
            + '<div class="pub-kazanc-embed-hdr-left">'
            + '<span>Bi\'Talih Paneli</span>'
            + '<span class="pub-kazanc-embed-warn">Manuel oyun · giriş buradan da yapılır</span>'
            + '</div>'
            + '<button type="button" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-ghost" id="pubKazancReloadIframe">↻</button>'
            + '</div>'
            + renderQuickNav()
            + '<div class="pub-kazanc-embed-body" id="pubKazancEmbedBody">'
            + '<iframe id="pubKazancIframe" class="pub-kazanc-iframe-full" src="' + escapeHtml(iframeSrc) + '" title="Bi\'Talih"></iframe>'
            + '</div></div>';
    }

    function renderShell(opts) {
        return renderInfoBanner()
            + renderSystemPlayPanel(opts)
            + renderIframeBlock();
    }

    function applySetupToForm(root) {
        if (!autoSetup || !root) return;
        const user = $('#pubAutoUser', root);
        const pass = $('#pubAutoPass', root);
        if (user && autoSetup.username) user.value = autoSetup.username;
        if (pass && autoSetup.password) pass.value = autoSetup.password;
        const bet = autoSetup.bet || {};
        if ($('#pubBetCity', root) && bet.city) $('#pubBetCity', root).value = bet.city;
        if ($('#pubBetRace', root) && bet.raceNo) $('#pubBetRace', root).value = bet.raceNo;
        if ($('#pubBetHorse', root) && bet.horseName) $('#pubBetHorse', root).value = bet.horseName;
        if ($('#pubBetType', root) && bet.betType) $('#pubBetType', root).value = bet.betType;
        if ($('#pubBetStake', root) && bet.stake) $('#pubBetStake', root).value = bet.stake;
    }

    function setPipelineHint(text) {
        const el = document.getElementById('pubAutoPipelineHint');
        if (el) el.textContent = text || '';
    }

    function navigateIframe(url) {
        iframeSrc = url || BITALIH_URL;
        const iframe = document.getElementById('pubKazancIframe');
        if (iframe) iframe.src = iframeSrc;
        document.querySelectorAll('.pub-kazanc-quicknav-btn').forEach((btn) => {
            btn.classList.toggle('pub-kazanc-quicknav-active', btn.dataset.bitalihUrl === iframeSrc);
        });
    }

    async function loadAutoSetup() {
        try {
            const res = await fetch('/api/public/bitalih/auto/setup');
            const parsed = await parseJsonResponse(res);
            if (parsed.ok && parsed.data?.success !== false) {
                autoSetup = parsed.data;
                return autoSetup;
            }
        } catch (_) { /* */ }
        autoSetup = {
            enabled: true,
            hasCredentials: false,
            autoLoginOnLoad: true,
            autoPlayOnLoad: true,
            bet: { city: 'Bursa', raceNo: 1, horseName: 'LA BOMBONERA', betType: 'ilk2', stake: 20 }
        };
        return autoSetup;
    }

    async function refreshAutoStatus() {
        try {
            const res = await fetch('/api/public/bitalih/auto/status');
            const parsed = await parseJsonResponse(res);
            if (parsed.ok) {
                autoStatus = parsed.data;
                const el = document.getElementById('pubKazancAutoStatus');
                if (el) {
                    el.textContent = autoStatus.loggedIn
                        ? ('Sunucu oturumu: ' + (autoStatus.displayName || 'açık') + (autoStatus.balance ? ' · ' + autoStatus.balance : ''))
                        : 'Sunucuda giriş gerekli';
                }
            }
        } catch (_) { /* */ }
    }

    async function pollJob(jobId, label, onTick) {
        const maxAttempts = 50;
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            const res = await fetch('/api/public/bitalih/auto/job/' + encodeURIComponent(jobId));
            const parsed = await parseJsonResponse(res);
            if (!parsed.ok) return { ok: false, error: parsed.error };
            const job = parsed.data;
            const secs = (i + 1) * 2;
            if (onTick) onTick(job, secs);
            if (job.status === 'done') return { ok: true, data: job.result || {} };
            if (job.status === 'failed') {
                return { ok: false, error: job.error || (label + ' başarısız'), code: job.code };
            }
        }
        return { ok: false, error: label + ' zaman aşımı (100 sn). Sunucuda fix-server.sh çalıştırın.' };
    }

    function bindSystemPlay(root) {
        async function performLogin() {
            const btn = $('#pubAutoLoginBtn', root);
            const username = $('#pubAutoUser', root)?.value?.trim();
            const password = $('#pubAutoPass', root)?.value;
            if (!username || !password) {
                return { ok: false, error: 'TC ve şifre eksik — config/bitalih-auto.json kontrol edin' };
            }
            if (btn) { btn.disabled = true; btn.textContent = 'Giriş başlatılıyor…'; }
            try {
                const res = await fetch('/api/public/bitalih/auto/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const parsed = await parseJsonResponse(res);
                if (!parsed.ok || !parsed.data?.success) {
                    return { ok: false, error: parsed.ok ? parsed.data.error : parsed.error };
                }
                if (!parsed.data.jobId) {
                    return { ok: false, error: 'Sunucu güncel değil — deploy gerekli.' };
                }
                if (parsed.data.status === 'failed' || parsed.data.error) {
                    return { ok: false, error: parsed.data.error || 'Giriş başarısız' };
                }
                const polled = await pollJob(parsed.data.jobId, 'Giriş', (_job, secs) => {
                    if (btn) btn.textContent = 'Giriş yapılıyor… (' + secs + ' sn)';
                    setPipelineHint('Sunucuda giriş yapılıyor… (' + secs + ' sn)');
                });
                if (!polled.ok || !polled.data?.success) {
                    let err = polled.error || polled.data?.error || 'Giriş başarısız';
                    if (polled.code === 'no_chrome' || polled.code === 'worker_down') {
                        err = 'SSH: bash /var/www/88atspeed/deploy/fix-server.sh';
                    }
                    return { ok: false, error: err };
                }
                autoStatus = polled.data;
                saveAutoState({ loggedIn: true, loginAttempted: true });
                await refreshAutoStatus();
                return { ok: true };
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Sunucuda Giriş Yap'; }
            }
        }

        async function submitBet(dryRun) {
            const playBtn = $('#pubBetPlayBtn', root);
            const dryBtn = $('#pubBetDryBtn', root);
            const city = $('#pubBetCity', root)?.value?.trim();
            const raceNo = Number($('#pubBetRace', root)?.value);
            const horseName = $('#pubBetHorse', root)?.value?.trim();
            const betType = $('#pubBetType', root)?.value || 'ganyan';
            const stake = Number($('#pubBetStake', root)?.value);
            if (!city || !horseName || !raceNo || !stake) {
                return { ok: false, error: 'Kupon alanları eksik' };
            }
            if (playBtn) { playBtn.disabled = true; playBtn.textContent = dryRun ? 'Test başlatılıyor…' : 'Oynatılıyor…'; }
            if (dryBtn) dryBtn.disabled = true;
            try {
                setPipelineHint(dryRun ? 'Test kuponu hazırlanıyor…' : 'Kupon oynatılıyor…');
                const res = await fetch('/api/public/bitalih/auto/bet/fixed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ city, raceNo, horseName, stake, betType, dryRun })
                });
                const parsed = await parseJsonResponse(res);
                if (!parsed.ok || !parsed.data?.success) {
                    return { ok: false, error: parsed.ok ? parsed.data.error : parsed.error };
                }
                if (!parsed.data.jobId) {
                    return { ok: false, error: 'Sunucu güncel değil — deploy gerekli.' };
                }
                const polled = await pollJob(parsed.data.jobId, dryRun ? 'Test' : 'Bahis', (_job, secs) => {
                    if (playBtn) playBtn.textContent = (dryRun ? 'Test' : 'Oynanıyor') + '… (' + secs + ' sn)';
                    setPipelineHint((dryRun ? 'Test' : 'Kupon oynanıyor') + '… (' + secs + ' sn)');
                });
                if (!polled.ok || polled.data?.success === false) {
                    return { ok: false, error: polled.error || polled.data?.error || 'Bahis başarısız' };
                }
                const msg = polled.data.message || (dryRun ? 'Test tamam' : 'Kupon oynandı');
                const odd = polled.data.odd ? (' @ ' + polled.data.odd) : '';
                const bt = polled.data.betType ? (' · ' + polled.data.betType) : '';
                return {
                    ok: true,
                    confirmed: polled.data.confirmed !== false,
                    steps: polled.data.steps,
                    message: msg + ' — ' + horseName + bt + ' · ' + stake + ' TL' + odd
                };
            } finally {
                if (playBtn) { playBtn.disabled = false; playBtn.textContent = 'Sistem Oyna'; }
                if (dryBtn) dryBtn.disabled = false;
            }
        }

        $('#pubAutoLoginBtn', root)?.addEventListener('click', async () => {
            clearAutoState();
            const result = await performLogin();
            if (!result.ok) {
                updateSystemMessages({ autoError: result.error });
                return;
            }
            updateSystemMessages({ autoOk: 'Sunucu girişi başarılı — artık Sistem Oyna kullanabilirsiniz.' });
        });

        $('#pubKazancBetForm', root)?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const result = await submitBet(false);
            if (!result.ok) updateSystemMessages({ autoError: result.error });
            else {
                saveAutoState({ betPlaced: true, pipelineComplete: true });
                if (result.steps) showAutomationSteps(result.steps);
                updateSystemMessages({
                    autoOk: result.message,
                    warn: result.confirmed === false
                });
            }
        });
        $('#pubBetDryBtn', root)?.addEventListener('click', async () => {
            const result = await submitBet(true);
            if (!result.ok) updateSystemMessages({ autoError: result.error });
            else updateSystemMessages({ autoOk: result.message });
        });

        root.querySelectorAll('.pub-kazanc-bet-chip').forEach((btn) => {
            btn.addEventListener('click', () => {
                syncBetTypeChips(root, btn.dataset.betType);
                scheduleHorseOddsRefresh(root);
            });
        });
        $('#pubBetType', root)?.addEventListener('change', (e) => {
            syncBetTypeChips(root, e.target.value);
            scheduleHorseOddsRefresh(root);
        });
        ['pubBetCity', 'pubBetRace', 'pubBetHorse'].forEach((id) => {
            $('#' + id, root)?.addEventListener('input', () => scheduleHorseOddsRefresh(root));
            $('#' + id, root)?.addEventListener('change', () => scheduleHorseOddsRefresh(root));
        });
        refreshHorseOddsPanel(root);

        root.querySelectorAll('.pub-kazanc-quicknav-btn').forEach((btn) => {
            btn.addEventListener('click', () => navigateIframe(btn.dataset.bitalihUrl));
        });
        $('#pubKazancReloadIframe', root)?.addEventListener('click', () => {
            const iframe = $('#pubKazancIframe', root);
            if (iframe) iframe.src = iframeSrc;
        });

        return { performLogin, submitBet };
    }

    function updateSystemMessages(opts) {
        const sys = document.getElementById('pubKazancSystem');
        if (!sys) return;
        const ok = sys.querySelector('.pub-kazanc-strip-ok');
        const err = sys.querySelector('.pub-kazanc-strip-error');
        if (ok) ok.remove();
        if (err) err.remove();
        if (opts.autoOk) {
            const d = document.createElement('div');
            d.className = opts.warn ? 'pub-kazanc-strip-warn' : 'pub-kazanc-strip-ok';
            d.textContent = opts.autoOk;
            sys.appendChild(d);
        }
        if (opts.autoError) {
            const d = document.createElement('div');
            d.className = 'pub-kazanc-strip-error';
            d.textContent = opts.autoError;
            sys.appendChild(d);
        }
    }

    async function runAutoPipeline(root, handlers) {
        if (autoPipelineStarted || !root || !handlers) return;
        autoPipelineStarted = true;

        if (!autoSetup?.enabled) {
            setPipelineHint('Otomasyon kapalı (bitalih-auto-config enabled:false)');
            return;
        }

        const state = loadAutoState();
        setPipelineHint('Sunucu oturumu kontrol ediliyor…');
        await refreshAutoStatus();

        let loggedIn = !!autoStatus?.loggedIn;
        if (loggedIn) {
            saveAutoState({ loggedIn: true });
            setPipelineHint('Sunucu oturumu aktif — bağlı.');
            if (state.pipelineComplete) {
                return;
            }
        } else if (state.loggedIn) {
            clearAutoState();
        }

        if (!loggedIn && autoSetup.autoLoginOnLoad !== false) {
            if (state.loginAttempted) {
                setPipelineHint('Giriş zaten denendi — Sunucuda Giriş Yap ile tekrar deneyin');
                return;
            }
            if (!autoSetup.hasCredentials) {
                setPipelineHint('Kimlik bilgisi yok — config/bitalih-auto.json kontrol edin');
                updateSystemMessages({ autoError: 'Otomatik giriş için config dosyası gerekli' });
                return;
            }
            setPipelineHint('Otomatik sunucu girişi başlatılıyor…');
            saveAutoState({ loginAttempted: true });
            const login = await handlers.performLogin();
            if (!login.ok) {
                setPipelineHint('Giriş başarısız');
                updateSystemMessages({ autoError: login.error });
                return;
            }
            loggedIn = true;
            saveAutoState({ loggedIn: true, loginAttempted: true });
            updateSystemMessages({ autoOk: 'Sunucu girişi başarılı.' });
        }

        if (!loggedIn) return;

        if (autoSetup.autoPlayOnLoad === false) {
            setPipelineHint('Otomatik kupon kapalı — Sistem Oyna ile manuel oynatın');
            saveAutoState({ pipelineComplete: true });
            return;
        }

        if (state.betPlaced || state.pipelineComplete) {
            setPipelineHint('Otomatik kupon bu oturumda zaten çalıştı — Sistem Oyna ile tekrar oynatın');
            return;
        }

        await new Promise((r) => setTimeout(r, 800));
        setPipelineHint('Otomatik kupon kesiliyor…');
        const dryRun = !!autoSetup.autoPlayDryRun;
        const betResult = await handlers.submitBet(dryRun);
        saveAutoState({ betPlaced: true, pipelineComplete: true });
        if (!betResult.ok) {
            setPipelineHint('Kupon başarısız');
            if (betResult.steps) showAutomationSteps(betResult.steps);
            updateSystemMessages({ autoError: betResult.error });
            return;
        }
        setPipelineHint('Otomatik akış tamamlandı.');
        if (betResult.steps) showAutomationSteps(betResult.steps);
        updateSystemMessages({
            autoOk: betResult.message,
            warn: betResult.confirmed === false
        });
    }

    let pipelineHandlers = null;

    async function ensureShell(opts) {
        const el = $('#pubKazancContent');
        if (!el) return;
        if (!autoSetup) await loadAutoSetup();
        if (!shellReady || !$('#pubKazancIframe', el)) {
            el.innerHTML = renderShell(opts || {});
            shellReady = true;
            pipelineHandlers = bindSystemPlay(el);
            applySetupToForm(el);
            await refreshAutoStatus();
            runAutoPipeline(el, pipelineHandlers);
        }
    }

    async function initKazancTab() {
        if (!$('#panel-kazanc')) return;
        await ensureShell({});
        await refreshAutoStatus();
    }

    window.pubKazanc = { init: initKazancTab, refresh: refreshAutoStatus };
})();
