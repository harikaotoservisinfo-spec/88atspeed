(function() {
    'use strict';

    const HIPODROM_URL = 'https://www.hipodrom.com/';
    const HIPODROM_LINKS = [
        { label: 'Sabit İhtimalli Bahis', url: 'https://www.hipodrom.com/at-yarisi/sabit-ihtimalli-bahis', accent: '#c62828' },
        { label: 'Bahis Yap', url: 'https://www.hipodrom.com/at-yarisi/bahis-yap', accent: '#1565c0' },
        { label: 'Biletlerim', url: 'https://www.hipodrom.com/biletlerim', accent: '#2e7d32' },
        { label: 'Ana Sayfa', url: HIPODROM_URL, accent: '#455a64' }
    ];
    let sessionCache = null;
    let iframeLoaded = true;
    let iframeSrc = HIPODROM_LINKS[0].url;

    const $ = (sel, root) => (root || document).querySelector(sel);

    async function parseJsonResponse(res) {
        const text = await res.text();
        if (!text) {
            return { ok: false, error: 'Sunucu boş yanıt döndü (HTTP ' + res.status + '). Deploy ve pm2 restart yapın.' };
        }
        try {
            return { ok: true, data: JSON.parse(text) };
        } catch (_) {
            const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 160);
            if (text.trim().startsWith('<')) {
                const is502 = res.status === 502 || /502 Bad Gateway/i.test(text);
                return {
                    ok: false,
                    error: is502
                        ? 'Sunucu giriş sırasında yanıt veremedi (502). 15–30 sn bekleyip tekrar deneyin; sorun sürerse pm2 restart gerekir.'
                        : 'Sunucu HTML döndü (HTTP ' + res.status + '). Deploy eksik veya nginx zaman aşımı — pm2 restart deneyin.'
                };
            }
            if (snippet.startsWith('Cannot POST')) {
                return { ok: false, error: 'API henüz deploy edilmemiş. Sunucuda güncelleme + pm2 restart gerekli.' };
            }
            return { ok: false, error: 'Geçersiz sunucu yanıtı (HTTP ' + res.status + ')' };
        }
    }

    function escapeHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatMoney(val) {
        if (val == null || val === '') return '—';
        const n = Number(val);
        if (isNaN(n)) return escapeHtml(val);
        return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
    }

    function renderInfoBanner(user) {
        const connected = !!(user?.loggedIn || user?.displayName);
        return '<div class="pub-kazanc-info">'
            + '<span class="pub-kazanc-info-icon">🎯</span>'
            + '<div>'
            + '<strong>Bahis oynamak:</strong> Alttaki Hipodrom panelinde giriş yapıp <em>Sabit İhtimalli Bahis</em> üzerinden at seçin, misli girin ve <strong>HEMEN OYNA</strong> deyin.'
            + '<p class="pub-kazanc-info-p">'
            + (connected
                ? 'Üst şeritte bakiyeniz 88 AT SPEED\'e bağlı. Bahis yine Hipodrom panelinden oynanır — kupon orada kesilir.'
                : 'Panelde Hipodrom\'a giriş yapmanız gerekir (üstteki Hesaba Bağlan ayrıca bakiye takibi içindir).')
            + '</p>'
            + '</div></div>';
    }

    function renderAccountStrip(user, opts) {
        if (user?.loggedIn || user?.displayName) {
            return '<div class="pub-kazanc-account-strip pub-kazanc-account-strip-on">'
                + '<div class="pub-kazanc-account-strip-left">'
                + '<span class="pub-kazanc-connected-dot"></span>'
                + '<strong>' + escapeHtml(user.displayName) + '</strong>'
                + (user.memberNo ? '<span class="pub-kazanc-member-inline">#' + escapeHtml(user.memberNo) + '</span>' : '')
                + '<span class="pub-kazanc-linked-badge">88 AT SPEED\'e bağlı</span>'
                + '</div>'
                + '<div class="pub-kazanc-account-strip-mid">'
                + '<span>Bakiye</span><strong>' + formatMoney(user.totalAmount ?? user.amount) + '</strong>'
                + '</div>'
                + '<div class="pub-kazanc-account-strip-actions">'
                + '<button type="button" class="pub-kazanc-strip-btn" id="pubKazancRefreshBtn">↻ Yenile</button>'
                + '<button type="button" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-ghost" id="pubKazancLogoutBtn">Çıkış</button>'
                + '</div></div>';
        }

        const err = opts?.error || '';
        const needsCaptcha = opts?.needsCaptcha;
        return '<div class="pub-kazanc-account-strip pub-kazanc-account-strip-login">'
            + '<div class="pub-kazanc-login-hdr">Hesabınızı 88 AT SPEED\'e bağlayın</div>'
            + '<form id="pubKazancLoginForm" class="pub-kazanc-inline-form">'
            + '<div class="pub-kazanc-inline-brand"><span>H</span> Hipodrom</div>'
            + '<input type="text" id="pubKazancUser" required autocomplete="username" placeholder="Kullanıcı adı / e-posta / TC">'
            + '<input type="password" id="pubKazancPass" required autocomplete="current-password" placeholder="Şifre">'
            + '<button type="submit" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-primary" id="pubKazancLoginBtn">Hesaba Bağlan</button>'
            + '</form>'
            + '<p class="pub-kazanc-login-hint">Hipodrom.com\'da zaten giriş yaptıysanız yine de buradan bağlanmanız gerekir.</p>'
            + (err ? '<div class="pub-kazanc-strip-error">' + escapeHtml(err) + '</div>' : '')
            + (needsCaptcha ? '<div class="pub-kazanc-strip-warn">Güvenlik doğrulaması gerekebilir — tekrar deneyin.</div>' : '')
            + '</div>';
    }

    function renderQuickNav() {
        return '<div class="pub-kazanc-quicknav">'
            + HIPODROM_LINKS.map((l) => {
                const active = iframeSrc === l.url ? ' pub-kazanc-quicknav-active' : '';
                return '<button type="button" class="pub-kazanc-quicknav-btn' + active + '" data-hip-url="' + l.url + '" style="--qn-accent:' + l.accent + '">' + escapeHtml(l.label) + '</button>';
            }).join('')
            + '</div>';
    }

    function renderIframeBlock() {
        const expanded = iframeLoaded;
        return '<div class="pub-kazanc-embed pub-kazanc-embed-play">'
            + '<div class="pub-kazanc-embed-hdr">'
            + '<div class="pub-kazanc-embed-hdr-left">'
            + '<span>Hipodrom — Bahis Oyna</span>'
            + '<span class="pub-kazanc-embed-warn">Giriş panel içinden · HEMEN OYNA ile oynanır</span>'
            + '</div>'
            + '<button type="button" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-ghost" id="pubKazancToggleIframe">'
            + (expanded ? 'Gizle' : 'Göster')
            + '</button>'
            + '</div>'
            + (expanded
                ? renderQuickNav()
                + '<div class="pub-kazanc-embed-body">'
                + '<iframe id="pubKazancIframe" class="pub-kazanc-iframe-full" src="' + escapeHtml(iframeSrc) + '" title="Hipodrom.com"></iframe>'
                + '<div class="pub-kazanc-embed-actions">'
                + '<button type="button" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-ghost" id="pubKazancReloadIframe">↻ Yenile</button>'
                + '<span class="pub-kazanc-embed-tip">At seç → Misli (ör. 20) → HEMEN OYNA</span>'
                + '</div></div>'
                : '<div class="pub-kazanc-embed-collapsed">Sabit ihtimalli bahis ve diğer oyunlar için paneli açın.</div>')
            + '</div>';
    }

    function renderKazancLayout(user, opts) {
        return renderInfoBanner(user)
            + renderAccountStrip(user, opts)
            + renderIframeBlock();
    }

    function navigateIframe(url) {
        iframeSrc = url || HIPODROM_URL;
        iframeLoaded = true;
        const iframe = document.getElementById('pubKazancIframe');
        if (iframe) iframe.src = iframeSrc;
        document.querySelectorAll('.pub-kazanc-quicknav-btn').forEach((btn) => {
            btn.classList.toggle('pub-kazanc-quicknav-active', btn.dataset.hipUrl === iframeSrc);
        });
    }

    function bindLoginForm(root) {
        const form = $('#pubKazancLoginForm', root);
        if (!form) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = $('#pubKazancLoginBtn', root);
            const username = $('#pubKazancUser', root)?.value?.trim();
            const password = $('#pubKazancPass', root)?.value;
            if (!username || !password) return;
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Bağlanıyor… (15–30 sn)';
            }
            try {
                const controller = new AbortController();
                const tid = setTimeout(() => controller.abort(), 90000);
                const res = await fetch('/api/public/hipodrom/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    signal: controller.signal,
                    body: JSON.stringify({ username, password })
                });
                clearTimeout(tid);
                const parsed = await parseJsonResponse(res);
                if (!parsed.ok) {
                    renderKazanc({ error: parsed.error });
                    return;
                }
                const data = parsed.data;
                if (!data.success) {
                    renderKazanc({ error: data.error, needsCaptcha: data.needsCaptcha });
                    return;
                }
                sessionCache = data;
                renderKazanc({ user: data });
            } catch (err) {
                const msg = err.name === 'AbortError'
                    ? 'Giriş zaman aşımına uğradı (90 sn). Tekrar deneyin.'
                    : ('Bağlantı hatası: ' + (err.message || 'tekrar deneyin'));
                renderKazanc({ error: msg });
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Hesaba Bağlan';
                }
            }
        });
    }

    function bindDashboard(root) {
        $('#pubKazancLogoutBtn', root)?.addEventListener('click', async () => {
            await fetch('/api/public/hipodrom/logout', { method: 'POST', credentials: 'same-origin' });
            sessionCache = null;
            renderKazanc({});
        });
        $('#pubKazancRefreshBtn', root)?.addEventListener('click', () => {
            sessionCache = null;
            loadKazancSession(true);
        });
        $('#pubKazancToggleIframe', root)?.addEventListener('click', () => {
            iframeLoaded = !iframeLoaded;
            renderKazanc(sessionCache?.loggedIn ? { user: sessionCache } : {});
        });
        root.querySelectorAll('.pub-kazanc-quicknav-btn').forEach((btn) => {
            btn.addEventListener('click', () => navigateIframe(btn.dataset.hipUrl));
        });
        $('#pubKazancReloadIframe', root)?.addEventListener('click', () => {
            const iframe = $('#pubKazancIframe', root);
            if (iframe) iframe.src = iframeSrc;
        });
    }

    function renderKazanc(opts) {
        const el = $('#pubKazancContent');
        if (!el) return;
        const user = (opts?.user?.loggedIn || opts?.user?.displayName) ? opts.user : null;
        el.innerHTML = renderKazancLayout(user, opts);
        if (user) bindDashboard(el);
        else bindLoginForm(el);
        bindDashboard(el);
    }

    async function loadKazancSession(force) {
        const panel = $('#panel-kazanc');
        if (!panel?.classList.contains('active')) return;
        if (!force && sessionCache?.loggedIn) {
            renderKazanc({ user: sessionCache });
            return;
        }
        const el = $('#pubKazancContent');
        if (el && force) {
            el.innerHTML = '<div class="pub-loading"><div class="pub-spinner"></div>Oturum kontrol ediliyor…</div>';
        }
        try {
            const res = await fetch('/api/public/hipodrom/session', { credentials: 'same-origin' });
            const parsed = await parseJsonResponse(res);
            if (!parsed.ok) {
                renderKazanc({ error: parsed.error });
                return;
            }
            const data = parsed.data;
            if (data.loggedIn) {
                sessionCache = data;
                renderKazanc({ user: data });
            } else {
                sessionCache = null;
                renderKazanc(data.expired ? { error: 'Oturum süresi doldu, tekrar giriş yapın.' } : {});
            }
        } catch (_) {
            renderKazanc({ error: 'Oturum kontrol edilemedi' });
        }
    }

    function initKazancTab() {
        if (!$('#panel-kazanc')) return;
        loadKazancSession(false);
    }

    window.pubKazanc = { init: initKazancTab, refresh: () => loadKazancSession(true) };
})();
