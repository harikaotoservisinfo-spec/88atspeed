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
                        ? 'Sunucu çöktü (502). SSH: bash /var/www/88atspeed/deploy/fix-server.sh — ardından Ctrl+F5'
                        : 'Sunucu HTML döndü (HTTP ' + res.status + '). Deploy veya fix-server.sh gerekli.'
                };
            }
            return { ok: false, error: 'Geçersiz sunucu yanıtı (HTTP ' + res.status + ')' };
        }
    }

    function escapeHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderSystemPlayPanel(opts) {
        const err = opts?.autoError || '';
        const ok = opts?.autoOk || '';
        const st = autoStatus || {};
        return '<div class="pub-kazanc-system" id="pubKazancSystem">'
            + '<div class="pub-kazanc-system-hdr">'
            + '<span>⚡ Sistem Oyna</span>'
            + '<span class="pub-kazanc-system-status" id="pubKazancAutoStatus">'
            + (st.loggedIn ? ('Sunucu oturumu: ' + escapeHtml(st.displayName || 'açık') + (st.balance ? ' · ' + escapeHtml(st.balance) : ''))
                : 'Sunucuda giriş gerekli (bir kez)')
            + '</span></div>'
            + '<p class="pub-kazanc-system-desc">88 AT SPEED sunucusu sizin adınıza Bi\'Talih\'te sabit ihtimalli kupon oynar. İlk seferde sunucu girişi yapın; sonra tek tıkla oynatın.</p>'
            + '<div class="pub-kazanc-system-login" id="pubKazancAutoLogin">'
            + '<input type="text" id="pubAutoUser" autocomplete="username" placeholder="TC kimlik no">'
            + '<input type="password" id="pubAutoPass" autocomplete="current-password" placeholder="Şifre">'
            + '<button type="button" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-primary" id="pubAutoLoginBtn">Sunucuda Giriş Yap</button>'
            + '</div>'
            + '<p class="pub-kazanc-system-hint">Bi\'Talih için <strong>TC kimlik numaranızı</strong> kullanın. Tarayıcı girişi 15–30 sn sürebilir.</p>'
            + '<form id="pubKazancBetForm" class="pub-kazanc-system-form">'
            + '<input type="text" id="pubBetCity" value="İzmir" placeholder="Şehir">'
            + '<input type="number" id="pubBetRace" value="4" min="1" max="15" placeholder="Koşu">'
            + '<input type="text" id="pubBetHorse" value="" placeholder="At adı">'
            + '<input type="number" id="pubBetStake" value="3" min="1" step="1" placeholder="Misli TL">'
            + '<button type="submit" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-primary pub-kazanc-system-play" id="pubBetPlayBtn">Sistem Oyna</button>'
            + '<button type="button" class="pub-kazanc-strip-btn" id="pubBetDryBtn">Test (oynama)</button>'
            + '</form>'
            + (ok ? '<div class="pub-kazanc-strip-ok">' + escapeHtml(ok) + '</div>' : '')
            + (err ? '<div class="pub-kazanc-strip-error">' + escapeHtml(err) + '</div>' : '')
            + '</div>';
    }

    function renderInfoBanner() {
        return '<div class="pub-kazanc-info" id="pubKazancInfo">'
            + '<span class="pub-kazanc-info-icon">🎯</span>'
            + '<div><strong>İki yol:</strong> '
            + '<em>Sistem Oyna</em> — sunucu otomatik kupon keser. '
            + 'veya alttaki <em>Bi\'Talih paneli</em> — elle oyna.</div></div>';
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

    function navigateIframe(url) {
        iframeSrc = url || BITALIH_URL;
        const iframe = document.getElementById('pubKazancIframe');
        if (iframe) iframe.src = iframeSrc;
        document.querySelectorAll('.pub-kazanc-quicknav-btn').forEach((btn) => {
            btn.classList.toggle('pub-kazanc-quicknav-active', btn.dataset.bitalihUrl === iframeSrc);
        });
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
                        : 'Sunucuda giriş gerekli (bir kez)';
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
        $('#pubAutoLoginBtn', root)?.addEventListener('click', async () => {
            const btn = $('#pubAutoLoginBtn', root);
            const username = $('#pubAutoUser', root)?.value?.trim();
            const password = $('#pubAutoPass', root)?.value;
            if (!username || !password) return;
            if (btn) { btn.disabled = true; btn.textContent = 'Kontrol ediliyor…'; }
            try {
                const healthRes = await fetch('/api/public/bitalih/auto/health');
                const health = await parseJsonResponse(healthRes);
                if (health.ok && health.data && !health.data.chromeInstalled) {
                    updateSystemMessages({
                        autoError: 'Sunucuda Chrome yok. SSH: bash /var/www/88atspeed/deploy/fix-server.sh'
                    });
                    return;
                }
                if (btn) btn.textContent = 'Giriş başlatılıyor…';
                const res = await fetch('/api/public/bitalih/auto/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const parsed = await parseJsonResponse(res);
                if (!parsed.ok || !parsed.data?.success) {
                    updateSystemMessages({ autoError: parsed.ok ? parsed.data.error : parsed.error });
                    return;
                }
                if (!parsed.data.jobId) {
                    updateSystemMessages({ autoError: 'Sunucu güncel değil — deploy gerekli.' });
                    return;
                }
                if (parsed.data.status === 'failed' || parsed.data.error) {
                    updateSystemMessages({ autoError: parsed.data.error || 'Giriş başarısız' });
                    return;
                }
                const polled = await pollJob(parsed.data.jobId, 'Giriş', (_job, secs) => {
                    if (btn) btn.textContent = 'Giriş yapılıyor… (' + secs + ' sn)';
                });
                if (!polled.ok || !polled.data?.success) {
                    let err = polled.error || polled.data?.error || 'Giriş başarısız';
                    if (polled.code === 'no_chrome') {
                        err = 'Sunucuda Chrome yok. SSH: bash /var/www/88atspeed/deploy/fix-server.sh';
                    }
                    updateSystemMessages({ autoError: err });
                    return;
                }
                autoStatus = polled.data;
                updateSystemMessages({ autoOk: 'Sunucu girişi başarılı — artık Sistem Oyna kullanabilirsiniz.' });
                await refreshAutoStatus();
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Sunucuda Giriş Yap'; }
            }
        });

        async function submitBet(dryRun) {
            const playBtn = $('#pubBetPlayBtn', root);
            const dryBtn = $('#pubBetDryBtn', root);
            const city = $('#pubBetCity', root)?.value?.trim();
            const raceNo = Number($('#pubBetRace', root)?.value);
            const horseName = $('#pubBetHorse', root)?.value?.trim();
            const stake = Number($('#pubBetStake', root)?.value);
            if (!city || !horseName || !raceNo || !stake) return;
            if (playBtn) { playBtn.disabled = true; playBtn.textContent = dryRun ? 'Test başlatılıyor…' : 'Oynatılıyor…'; }
            if (dryBtn) dryBtn.disabled = true;
            try {
                const res = await fetch('/api/public/bitalih/auto/bet/fixed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ city, raceNo, horseName, stake, dryRun })
                });
                const parsed = await parseJsonResponse(res);
                if (!parsed.ok || !parsed.data?.success) {
                    updateSystemMessages({ autoError: parsed.ok ? parsed.data.error : parsed.error });
                    return;
                }
                if (!parsed.data.jobId) {
                    updateSystemMessages({ autoError: 'Sunucu güncel değil — deploy gerekli.' });
                    return;
                }
                const polled = await pollJob(parsed.data.jobId, dryRun ? 'Test' : 'Bahis', (_job, secs) => {
                    if (playBtn) playBtn.textContent = (dryRun ? 'Test' : 'Oynanıyor') + '… (' + secs + ' sn)';
                });
                if (!polled.ok || polled.data?.success === false) {
                    updateSystemMessages({ autoError: polled.error || polled.data?.error || 'Bahis başarısız' });
                    return;
                }
                const msg = polled.data.message || (dryRun ? 'Test tamam' : 'Kupon oynandı');
                updateSystemMessages({ autoOk: msg + ' — ' + horseName + ' · ' + stake + ' TL' });
            } finally {
                if (playBtn) { playBtn.disabled = false; playBtn.textContent = 'Sistem Oyna'; }
                if (dryBtn) dryBtn.disabled = false;
            }
        }

        $('#pubKazancBetForm', root)?.addEventListener('submit', (e) => {
            e.preventDefault();
            submitBet(false);
        });
        $('#pubBetDryBtn', root)?.addEventListener('click', () => submitBet(true));

        root.querySelectorAll('.pub-kazanc-quicknav-btn').forEach((btn) => {
            btn.addEventListener('click', () => navigateIframe(btn.dataset.bitalihUrl));
        });
        $('#pubKazancReloadIframe', root)?.addEventListener('click', () => {
            const iframe = $('#pubKazancIframe', root);
            if (iframe) iframe.src = iframeSrc;
        });
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
            d.className = 'pub-kazanc-strip-ok';
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

    function ensureShell(opts) {
        const el = $('#pubKazancContent');
        if (!el) return;
        if (!shellReady || !$('#pubKazancIframe', el)) {
            el.innerHTML = renderShell(opts || {});
            shellReady = true;
            bindSystemPlay(el);
            refreshAutoStatus();
        }
    }

    function initKazancTab() {
        if (!$('#panel-kazanc')) return;
        ensureShell({});
        refreshAutoStatus();
    }

    window.pubKazanc = { init: initKazancTab, refresh: refreshAutoStatus };
})();
