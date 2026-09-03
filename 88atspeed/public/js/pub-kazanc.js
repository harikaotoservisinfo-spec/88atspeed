(function() {
    'use strict';

    const HIPODROM_URL = 'https://www.hipodrom.com/';
    const HIPODROM_LINKS = [
        { label: 'Sabit İhtimalli', url: 'https://www.hipodrom.com/at-yarisi/sabit-ihtimalli-bahis', accent: '#c62828' },
        { label: 'Bahis Yap', url: 'https://www.hipodrom.com/at-yarisi/bahis-yap', accent: '#1565c0' },
        { label: 'Biletlerim', url: 'https://www.hipodrom.com/biletlerim', accent: '#2e7d32' },
        { label: 'Ana Sayfa', url: HIPODROM_URL, accent: '#455a64' }
    ];
    let sessionCache = null;
    let iframeSrc = HIPODROM_LINKS[0].url;
    let apiPanelOpen = false;
    let shellReady = false;
    let autoStatus = null;

    const $ = (sel, root) => (root || document).querySelector(sel);

    async function parseJsonResponse(res) {
        const text = await res.text();
        if (!text) return { ok: false, error: 'Sunucu boş yanıt döndü.' };
        try {
            return { ok: true, data: JSON.parse(text) };
        } catch (_) {
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
            + (st.loggedIn ? ('Sunucu oturumu: ' + escapeHtml(st.displayName || 'açık') + (st.balance ? ' · ' + escapeHtml(st.balance) + ' TL' : ''))
                : 'Sunucuda giriş gerekli (bir kez)')
            + '</span></div>'
            + '<p class="pub-kazanc-system-desc">88 AT SPEED sunucusu sizin adınıza Hipodrom\'da sabit ihtimalli kupon oynar. İlk seferde sunucu girişi yapın; sonra tek tıkla oynatın.</p>'
            + '<div class="pub-kazanc-system-login" id="pubKazancAutoLogin">'
            + '<input type="text" id="pubAutoUser" autocomplete="username" placeholder="TC / üye no (83196393)">'
            + '<input type="password" id="pubAutoPass" autocomplete="current-password" placeholder="Şifre">'
            + '<button type="button" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-primary" id="pubAutoLoginBtn">Sunucuda Giriş Yap</button>'
            + '</div>'
            + '<form id="pubKazancBetForm" class="pub-kazanc-system-form">'
            + '<input type="text" id="pubBetCity" value="İzmir" placeholder="Şehir">'
            + '<input type="number" id="pubBetRace" value="3" min="1" max="15" placeholder="Koşu">'
            + '<input type="text" id="pubBetHorse" value="ÇENGER" placeholder="At adı">'
            + '<input type="number" id="pubBetStake" value="20" min="1" step="1" placeholder="Misli TL">'
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
            + 'veya alttaki <em>Hipodrom paneli</em> — elle HEMEN OYNA.</div></div>';
    }

    function renderQuickNav() {
        return '<div class="pub-kazanc-quicknav" id="pubKazancQuicknav">'
            + HIPODROM_LINKS.map((l) => {
                const active = iframeSrc === l.url ? ' pub-kazanc-quicknav-active' : '';
                return '<button type="button" class="pub-kazanc-quicknav-btn' + active + '" data-hip-url="' + l.url + '" style="--qn-accent:' + l.accent + '">' + escapeHtml(l.label) + '</button>';
            }).join('')
            + '</div>';
    }

    function renderIframeBlock() {
        return '<div class="pub-kazanc-embed pub-kazanc-embed-play" id="pubKazancEmbed">'
            + '<div class="pub-kazanc-embed-hdr">'
            + '<div class="pub-kazanc-embed-hdr-left">'
            + '<span>Hipodrom Paneli</span>'
            + '<span class="pub-kazanc-embed-warn">Manuel oyun · giriş buradan da yapılır</span>'
            + '</div>'
            + '<button type="button" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-ghost" id="pubKazancReloadIframe">↻</button>'
            + '</div>'
            + renderQuickNav()
            + '<div class="pub-kazanc-embed-body" id="pubKazancEmbedBody">'
            + '<iframe id="pubKazancIframe" class="pub-kazanc-iframe-full" src="' + escapeHtml(iframeSrc) + '" title="Hipodrom.com"></iframe>'
            + '</div></div>';
    }

    function renderShell(opts) {
        return renderInfoBanner()
            + renderSystemPlayPanel(opts)
            + renderIframeBlock();
    }

    function navigateIframe(url) {
        iframeSrc = url || HIPODROM_URL;
        const iframe = document.getElementById('pubKazancIframe');
        if (iframe) iframe.src = iframeSrc;
        document.querySelectorAll('.pub-kazanc-quicknav-btn').forEach((btn) => {
            btn.classList.toggle('pub-kazanc-quicknav-active', btn.dataset.hipUrl === iframeSrc);
        });
    }

    async function refreshAutoStatus() {
        try {
            const res = await fetch('/api/public/hipodrom/auto/status');
            const parsed = await parseJsonResponse(res);
            if (parsed.ok) {
                autoStatus = parsed.data;
                const el = document.getElementById('pubKazancAutoStatus');
                if (el) {
                    el.textContent = autoStatus.loggedIn
                        ? ('Sunucu oturumu: ' + (autoStatus.displayName || 'açık') + (autoStatus.balance ? ' · ' + autoStatus.balance + ' TL' : ''))
                        : 'Sunucuda giriş gerekli (bir kez)';
                }
            }
        } catch (_) { /* */ }
    }

    function bindSystemPlay(root) {
        $('#pubAutoLoginBtn', root)?.addEventListener('click', async () => {
            const btn = $('#pubAutoLoginBtn', root);
            const username = $('#pubAutoUser', root)?.value?.trim();
            const password = $('#pubAutoPass', root)?.value;
            if (!username || !password) return;
            if (btn) { btn.disabled = true; btn.textContent = 'Giriş…'; }
            try {
                const res = await fetch('/api/public/hipodrom/auto/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const parsed = await parseJsonResponse(res);
                if (!parsed.ok || !parsed.data?.success) {
                    updateSystemMessages({ autoError: parsed.ok ? parsed.data.error : parsed.error });
                    return;
                }
                autoStatus = parsed.data;
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
            if (playBtn) { playBtn.disabled = true; playBtn.textContent = dryRun ? 'Test…' : 'Oynanıyor…'; }
            if (dryBtn) dryBtn.disabled = true;
            try {
                const res = await fetch('/api/public/hipodrom/auto/bet/fixed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ city, raceNo, horseName, stake, dryRun })
                });
                const parsed = await parseJsonResponse(res);
                if (!parsed.ok || parsed.data?.success === false) {
                    updateSystemMessages({ autoError: parsed.ok ? (parsed.data.error || 'Bahis başarısız') : parsed.error });
                    return;
                }
                const msg = parsed.data.message || (dryRun ? 'Test tamam' : 'Kupon oynandı');
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
            btn.addEventListener('click', () => navigateIframe(btn.dataset.hipUrl));
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
