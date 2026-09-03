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
    let iframeSrc = HIPODROM_LINKS[0].url;
    let apiPanelOpen = false;
    let shellReady = false;

    const $ = (sel, root) => (root || document).querySelector(sel);

    async function parseJsonResponse(res) {
        const text = await res.text();
        if (!text) {
            return { ok: false, error: 'Sunucu boş yanıt döndü (HTTP ' + res.status + ').' };
        }
        try {
            return { ok: true, data: JSON.parse(text) };
        } catch (_) {
            if (text.trim().startsWith('<')) {
                return { ok: false, error: 'Sunucu yanıtı beklenmedik (HTTP ' + res.status + ').' };
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

    function renderInfoBanner() {
        return '<div class="pub-kazanc-info" id="pubKazancInfo">'
            + '<span class="pub-kazanc-info-icon">✅</span>'
            + '<div>'
            + '<strong>Giriş ve bahis bu panelden yapılır.</strong>'
            + '<p class="pub-kazanc-info-p">Panelde Hipodrom\'a giriş yapın — adınız ve bakiye üstte görünür. '
            + '<em>Sabit İhtimalli Bahis</em> → at seç → misli gir → <strong>HEMEN OYNA</strong>.</p>'
            + '</div></div>';
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
            + '<span>Hipodrom — Giriş &amp; Bahis</span>'
            + '<span class="pub-kazanc-embed-warn">Giriş yap · oyna · biletlerini gör</span>'
            + '</div>'
            + '<button type="button" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-ghost" id="pubKazancReloadIframe">↻ Yenile</button>'
            + '</div>'
            + renderQuickNav()
            + '<div class="pub-kazanc-embed-body" id="pubKazancEmbedBody">'
            + '<iframe id="pubKazancIframe" class="pub-kazanc-iframe-full" src="' + escapeHtml(iframeSrc) + '" title="Hipodrom.com"></iframe>'
            + '</div>'
            + '<div class="pub-kazanc-embed-actions">'
            + '<span class="pub-kazanc-embed-tip">At seç → Misli (ör. 20) → HEMEN OYNA</span>'
            + '</div>'
            + '</div>';
    }

    function renderApiPanel(user, opts) {
        const err = opts?.error || '';
        const needsCaptcha = opts?.needsCaptcha;
        const connected = !!(user?.loggedIn || user?.displayName);

        if (connected) {
            return '<div class="pub-kazanc-api-panel pub-kazanc-api-panel-on" id="pubKazancApiPanel">'
                + '<div class="pub-kazanc-api-hdr"><span>88 AT SPEED sunucu bağlantısı</span>'
                + '<button type="button" class="pub-kazanc-api-toggle" id="pubKazancApiToggle">Gizle</button></div>'
                + '<div class="pub-kazanc-account-strip pub-kazanc-account-strip-on">'
                + '<div class="pub-kazanc-account-strip-left">'
                + '<span class="pub-kazanc-connected-dot"></span>'
                + '<strong>' + escapeHtml(user.displayName) + '</strong>'
                + (user.memberNo ? '<span class="pub-kazanc-member-inline">#' + escapeHtml(user.memberNo) + '</span>' : '')
                + '</div>'
                + '<div class="pub-kazanc-account-strip-mid">'
                + '<span>Bakiye (API)</span><strong>' + formatMoney(user.totalAmount ?? user.amount) + '</strong>'
                + '</div>'
                + '<div class="pub-kazanc-account-strip-actions">'
                + '<button type="button" class="pub-kazanc-strip-btn" id="pubKazancRefreshBtn">↻</button>'
                + '<button type="button" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-ghost" id="pubKazancLogoutBtn">Çıkış</button>'
                + '</div></div>'
                + '<p class="pub-kazanc-api-note">Otomatik kupon (yakında). Şimdilik bahis panelden oynanır.</p>'
                + '</div>';
        }

        const collapsed = !apiPanelOpen;
        return '<div class="pub-kazanc-api-panel' + (collapsed ? ' pub-kazanc-api-panel-collapsed' : '') + '" id="pubKazancApiPanel">'
            + '<div class="pub-kazanc-api-hdr">'
            + '<span>88 AT SPEED sunucu bağlantısı <em class="pub-kazanc-api-optional">(isteğe bağlı)</em></span>'
            + '<button type="button" class="pub-kazanc-api-toggle" id="pubKazancApiToggle">' + (collapsed ? 'Aç' : 'Gizle') + '</button>'
            + '</div>'
            + (collapsed
                ? '<p class="pub-kazanc-api-collapsed-hint">Panelden giriş yaptıysanız buna gerek yok — otomatik kupon için ileride kullanılacak.</p>'
                : '<form id="pubKazancLoginForm" class="pub-kazanc-inline-form">'
                + '<input type="text" id="pubKazancUser" autocomplete="username" placeholder="TC / üye no">'
                + '<input type="password" id="pubKazancPass" autocomplete="current-password" placeholder="Şifre">'
                + '<button type="submit" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-primary" id="pubKazancLoginBtn">Bağlan</button>'
                + '</form>'
                + (err ? '<div class="pub-kazanc-strip-error">' + escapeHtml(err) + '</div>' : '')
                + (needsCaptcha ? '<div class="pub-kazanc-strip-warn">Güvenlik doğrulaması gerekebilir.</div>' : '')
                + '<p class="pub-kazanc-api-note">Bahis oynamak için yukarıdaki panele giriş yapmanız yeterli.</p>')
            + '</div>';
    }

    function renderShell(user, opts) {
        return renderInfoBanner()
            + renderIframeBlock()
            + renderApiPanel(user, opts);
    }

    function navigateIframe(url) {
        iframeSrc = url || HIPODROM_URL;
        const iframe = document.getElementById('pubKazancIframe');
        if (iframe) iframe.src = iframeSrc;
        document.querySelectorAll('.pub-kazanc-quicknav-btn').forEach((btn) => {
            btn.classList.toggle('pub-kazanc-quicknav-active', btn.dataset.hipUrl === iframeSrc);
        });
    }

    function updateApiPanelOnly(user, opts) {
        const panel = document.getElementById('pubKazancApiPanel');
        if (!panel) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = renderApiPanel(user, opts);
        panel.replaceWith(tmp.firstElementChild);
        bindApiPanel(document.getElementById('pubKazancContent'));
    }

    function bindQuickNav(root) {
        root.querySelectorAll('.pub-kazanc-quicknav-btn').forEach((btn) => {
            btn.addEventListener('click', () => navigateIframe(btn.dataset.hipUrl));
        });
        $('#pubKazancReloadIframe', root)?.addEventListener('click', () => {
            const iframe = $('#pubKazancIframe', root);
            if (iframe) iframe.src = iframeSrc;
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
            if (btn) { btn.disabled = true; btn.textContent = 'Bağlanıyor…'; }
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
                if (!parsed.ok || !parsed.data?.success) {
                    updateApiPanelOnly(null, { error: parsed.ok ? parsed.data.error : parsed.error, needsCaptcha: parsed.data?.needsCaptcha });
                    return;
                }
                sessionCache = parsed.data;
                updateApiPanelOnly(parsed.data, {});
            } catch (err) {
                const msg = err.name === 'AbortError' ? 'Zaman aşımı — tekrar deneyin.' : ('Hata: ' + (err.message || 'tekrar deneyin'));
                updateApiPanelOnly(null, { error: msg });
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Bağlan'; }
            }
        });
    }

    function bindApiPanel(root) {
        $('#pubKazancApiToggle', root)?.addEventListener('click', () => {
            apiPanelOpen = !apiPanelOpen;
            updateApiPanelOnly(sessionCache?.loggedIn ? sessionCache : null, {});
        });
        $('#pubKazancLogoutBtn', root)?.addEventListener('click', async () => {
            await fetch('/api/public/hipodrom/logout', { method: 'POST', credentials: 'same-origin' });
            sessionCache = null;
            updateApiPanelOnly(null, {});
        });
        $('#pubKazancRefreshBtn', root)?.addEventListener('click', () => loadKazancSession(true));
        bindLoginForm(root);
    }

    function ensureShell(user, opts) {
        const el = $('#pubKazancContent');
        if (!el) return;
        if (!shellReady || !$('#pubKazancIframe', el)) {
            el.innerHTML = renderShell(user, opts);
            shellReady = true;
            bindQuickNav(el);
            bindApiPanel(el);
            return;
        }
        updateApiPanelOnly(user, opts);
    }

    async function loadKazancSession(force) {
        const panel = $('#panel-kazanc');
        if (!panel?.classList.contains('active')) return;
        if (!force && sessionCache?.loggedIn) {
            ensureShell(sessionCache, {});
            return;
        }
        try {
            const res = await fetch('/api/public/hipodrom/session', { credentials: 'same-origin' });
            const parsed = await parseJsonResponse(res);
            if (!parsed.ok) {
                ensureShell(null, { error: parsed.error });
                return;
            }
            const data = parsed.data;
            if (data.loggedIn) {
                sessionCache = data;
                ensureShell(data, {});
            } else {
                sessionCache = null;
                ensureShell(null, data.expired ? { error: 'API oturumu doldu.' } : {});
            }
        } catch (_) {
            ensureShell(null, {});
        }
    }

    function initKazancTab() {
        if (!$('#panel-kazanc')) return;
        ensureShell(null, {});
        loadKazancSession(false);
    }

    window.pubKazanc = { init: initKazancTab, refresh: () => loadKazancSession(true) };
})();
