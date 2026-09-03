(function() {
    'use strict';

    const HIPODROM_URL = 'https://www.hipodrom.com/';
    let sessionCache = null;
    let iframeLoaded = false;

    const $ = (sel, root) => (root || document).querySelector(sel);

    function escapeHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatMoney(val) {
        if (val == null || val === '') return '—';
        const n = Number(val);
        if (isNaN(n)) return escapeHtml(val);
        return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
    }

    function renderLoginForm(opts) {
        const err = opts?.error || '';
        const needsCaptcha = opts?.needsCaptcha;
        return '<div class="pub-kazanc-grid">'
            + '<div class="pub-kazanc-card pub-kazanc-login-card">'
            + '<div class="pub-kazanc-card-hdr">'
            + '<span class="pub-kazanc-card-icon">🔐</span>'
            + '<div><h3>Hipodrom Girişi</h3><p>Resmi Hipodrom.com hesabınızla bağlanın</p></div>'
            + '</div>'
            + (err ? '<div class="pub-kazanc-alert pub-kazanc-alert-error">' + escapeHtml(err) + '</div>' : '')
            + (needsCaptcha ? '<div class="pub-kazanc-alert pub-kazanc-alert-warn">Güvenlik doğrulaması gerekebilir. Sorun devam ederse '
                + '<a href="' + HIPODROM_URL + '" target="_blank" rel="noopener">hipodrom.com</a> üzerinden giriş yapın.</div>' : '')
            + '<form id="pubKazancLoginForm" class="pub-kazanc-form" autocomplete="on">'
            + '<label class="pub-kazanc-field"><span>Kullanıcı adı / E-posta / TC</span>'
            + '<input type="text" name="username" id="pubKazancUser" required autocomplete="username" placeholder="Hipodrom kullanıcı adınız"></label>'
            + '<label class="pub-kazanc-field"><span>Şifre</span>'
            + '<input type="password" name="password" id="pubKazancPass" required autocomplete="current-password" placeholder="••••••••"></label>'
            + '<button type="submit" class="pub-kazanc-submit" id="pubKazancLoginBtn">'
            + '<span class="pub-kazanc-submit-glow"></span>Hesaba Bağlan</button>'
            + '</form>'
            + '<div class="pub-kazanc-links">'
            + '<a href="' + HIPODROM_URL + '" target="_blank" rel="noopener">Hipodrom.com\'da aç ↗</a>'
            + '<a href="https://www.hipodrom.com/uye-ol" target="_blank" rel="noopener">Üye ol ↗</a>'
            + '</div>'
            + '</div>'
            + '<div class="pub-kazanc-card pub-kazanc-preview-card">'
            + '<div class="pub-kazanc-preview-hdr">Önizleme</div>'
            + '<div class="pub-kazanc-iframe-wrap">'
            + '<iframe id="pubKazancIframe" class="pub-kazanc-iframe" src="about:blank" title="Hipodrom.com" loading="lazy"></iframe>'
            + '<div class="pub-kazanc-iframe-overlay" id="pubKazancIframeOverlay">'
            + '<p>Hipodrom sitesi önizlemesi</p>'
            + '<button type="button" class="pub-btn pub-btn-white" id="pubKazancLoadIframe">Siteyi Yükle</button>'
            + '</div></div></div></div>';
    }

    function renderDashboard(user) {
        return '<div class="pub-kazanc-grid pub-kazanc-grid-logged">'
            + '<div class="pub-kazanc-card pub-kazanc-account-card">'
            + '<div class="pub-kazanc-connected">'
            + '<span class="pub-kazanc-connected-dot"></span> Hesap bağlı'
            + '</div>'
            + '<h3>' + escapeHtml(user.displayName) + '</h3>'
            + (user.memberNo ? '<p class="pub-kazanc-member">Üye No: <strong>' + escapeHtml(user.memberNo) + '</strong></p>' : '')
            + '<div class="pub-kazanc-balances">'
            + '<div class="pub-kazanc-balance pub-kazanc-balance-main">'
            + '<span>Bakiye</span><strong>' + formatMoney(user.totalAmount ?? user.amount) + '</strong></div>'
            + '<div class="pub-kazanc-balance"><span>Ana hesap</span><strong>' + formatMoney(user.amount) + '</strong></div>'
            + '<div class="pub-kazanc-balance"><span>Bonus</span><strong>' + formatMoney(user.bonusAmount) + '</strong></div>'
            + '</div>'
            + '<div class="pub-kazanc-actions">'
            + '<a href="' + HIPODROM_URL + '" target="_blank" rel="noopener" class="pub-kazanc-action pub-kazanc-action-primary">Hipodrom\'da Devam Et ↗</a>'
            + '<button type="button" class="pub-kazanc-action pub-kazanc-action-ghost" id="pubKazancLogoutBtn">Bağlantıyı Kes</button>'
            + '<button type="button" class="pub-kazanc-action pub-kazanc-action-ghost" id="pubKazancRefreshBtn">Yenile</button>'
            + '</div>'
            + '<p class="pub-kazanc-note">Sonraki güncellemede kupon oluşturma ve kazanç takibi bu panelden yapılacak.</p>'
            + '</div>'
            + '<div class="pub-kazanc-card pub-kazanc-preview-card">'
            + '<div class="pub-kazanc-preview-hdr">Hipodrom.com</div>'
            + '<div class="pub-kazanc-iframe-wrap">'
            + '<iframe id="pubKazancIframe" class="pub-kazanc-iframe" src="about:blank" title="Hipodrom.com"></iframe>'
            + '<div class="pub-kazanc-iframe-overlay" id="pubKazancIframeOverlay">'
            + '<p>Tam site görünümü</p>'
            + '<button type="button" class="pub-btn pub-btn-white" id="pubKazancLoadIframe">Siteyi Yükle</button>'
            + '</div></div></div></div>';
    }

    function bindIframeLoader(root) {
        $('#pubKazancLoadIframe', root)?.addEventListener('click', () => {
            const iframe = $('#pubKazancIframe', root);
            const overlay = $('#pubKazancIframeOverlay', root);
            if (!iframe) return;
            iframe.src = HIPODROM_URL;
            iframeLoaded = true;
            overlay?.classList.add('is-hidden');
        });
        if (iframeLoaded) {
            const iframe = $('#pubKazancIframe', root);
            const overlay = $('#pubKazancIframeOverlay', root);
            if (iframe && !iframe.src || iframe?.src === 'about:blank') {
                iframe.src = HIPODROM_URL;
            }
            overlay?.classList.add('is-hidden');
        }
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
            btn.disabled = true;
            btn.textContent = 'Bağlanıyor…';
            try {
                const res = await fetch('/api/public/hipodrom/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (!data.success) {
                    renderKazanc({ error: data.error, needsCaptcha: data.needsCaptcha });
                    return;
                }
                sessionCache = data;
                renderKazanc({ user: data });
            } catch (err) {
                renderKazanc({ error: 'Bağlantı hatası: ' + (err.message || 'tekrar deneyin') });
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span class="pub-kazanc-submit-glow"></span>Hesaba Bağlan';
                }
            }
        });
    }

    function bindDashboard(root, user) {
        $('#pubKazancLogoutBtn', root)?.addEventListener('click', async () => {
            await fetch('/api/public/hipodrom/logout', { method: 'POST', credentials: 'same-origin' });
            sessionCache = null;
            iframeLoaded = false;
            renderKazanc({});
        });
        $('#pubKazancRefreshBtn', root)?.addEventListener('click', () => {
            sessionCache = null;
            loadKazancSession(true);
        });
        bindIframeLoader(root);
    }

    function renderKazanc(opts) {
        const el = $('#pubKazancContent');
        if (!el) return;
        if (opts?.user?.loggedIn || (opts?.user && opts.user.displayName)) {
            el.innerHTML = renderDashboard(opts.user);
            bindDashboard(el, opts.user);
            return;
        }
        el.innerHTML = renderLoginForm(opts);
        bindLoginForm(el);
        bindIframeLoader(el);
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
            const data = await res.json();
            if (data.loggedIn) {
                sessionCache = data;
                renderKazanc({ user: data });
            } else {
                sessionCache = null;
                renderKazanc(data.expired ? { error: 'Oturum süresi doldu, tekrar giriş yapın.' } : {});
            }
        } catch (err) {
            renderKazanc({ error: 'Oturum kontrol edilemedi' });
        }
    }

    function initKazancTab() {
        if (!$('#panel-kazanc')) return;
        loadKazancSession(false);
    }

    window.pubKazanc = { init: initKazancTab, refresh: () => loadKazancSession(true) };
})();
