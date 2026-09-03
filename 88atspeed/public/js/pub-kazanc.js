(function() {
    'use strict';

    const HIPODROM_URL = 'https://www.hipodrom.com/';
    let sessionCache = null;

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
                return {
                    ok: false,
                    error: 'Sunucu HTML döndü (HTTP ' + res.status + '). Deploy eksik veya nginx zaman aşımı — pm2 restart deneyin.'
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

    function renderInfoBanner() {
        return '<div class="pub-kazanc-info">'
            + '<span class="pub-kazanc-info-icon">ℹ️</span>'
            + '<div><strong>Önemli:</strong> Hipodrom\'u başka sekmede açmak 88 AT SPEED ile bağlantı kurmaz. '
            + 'Hesabınızı buraya bağlamak için <strong>Hesaba Bağlan</strong> kullanın — bakiye ve kupon işlemleri buradan yönetilecek.</div>'
            + '</div>';
    }

    function renderAccountStrip(user, opts) {
        if (user?.loggedIn || user?.displayName) {
            return '<div class="pub-kazanc-account-strip pub-kazanc-account-strip-on">'
                + '<div class="pub-kazanc-account-strip-left">'
                + '<span class="pub-kazanc-connected-dot"></span>'
                + '<strong>' + escapeHtml(user.displayName) + '</strong>'
                + (user.memberNo ? '<span class="pub-kazanc-member-inline">#' + escapeHtml(user.memberNo) + '</span>' : '')
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
        return '<div class="pub-kazanc-account-strip">'
            + '<form id="pubKazancLoginForm" class="pub-kazanc-inline-form">'
            + '<div class="pub-kazanc-inline-brand"><span>H</span> Hipodrom bağlantısı</div>'
            + '<input type="text" id="pubKazancUser" required autocomplete="username" placeholder="Kullanıcı adı / e-posta / TC">'
            + '<input type="password" id="pubKazancPass" required autocomplete="current-password" placeholder="Şifre">'
            + '<button type="submit" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-primary" id="pubKazancLoginBtn">Hesaba Bağlan</button>'
            + '</form>'
            + (err ? '<div class="pub-kazanc-strip-error">' + escapeHtml(err) + '</div>' : '')
            + (needsCaptcha ? '<div class="pub-kazanc-strip-warn">Güvenlik doğrulaması gerekebilir — tekrar deneyin.</div>' : '')
            + '</div>';
    }

    function renderIframeBlock() {
        return '<div class="pub-kazanc-embed">'
            + '<div class="pub-kazanc-embed-hdr">'
            + '<span>Hipodrom.com — uygulama içi</span>'
            + '<button type="button" class="pub-kazanc-strip-btn pub-kazanc-strip-btn-ghost" id="pubKazancReloadIframe">↻ Yenile</button>'
            + '</div>'
            + '<div class="pub-kazanc-embed-body">'
            + '<iframe id="pubKazancIframe" class="pub-kazanc-iframe-full" src="' + HIPODROM_URL + '" title="Hipodrom.com"></iframe>'
            + '</div></div>';
    }

    function renderKazancLayout(user, opts) {
        return renderInfoBanner()
            + renderAccountStrip(user, opts)
            + renderIframeBlock();
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
                btn.textContent = 'Doğrulanıyor…';
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
        $('#pubKazancReloadIframe', root)?.addEventListener('click', () => {
            const iframe = $('#pubKazancIframe', root);
            if (iframe) iframe.src = HIPODROM_URL;
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
