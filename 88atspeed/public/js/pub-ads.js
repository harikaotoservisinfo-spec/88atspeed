(function() {
    'use strict';

    const LERTA_URL = 'https://lerta.tr/';
    const ROTATE_MS = 8000;

    const CREATIVES = {
        leaderboard: [
            {
                cls: 'lerta-ad lerta-ad-lb lerta-ad-lb-1',
                html: '<a href="' + LERTA_URL + '" target="_blank" rel="noopener sponsored" class="lerta-ad-link">'
                    + '<div class="lerta-ad-brand"><span class="lerta-logo">LERTA</span><span class="lerta-tag">Oto Servis Yazılımı</span></div>'
                    + '<p class="lerta-ad-headline">Oto servisinizi <strong>tek panelden</strong> yönetin</p>'
                    + '<div class="lerta-ad-chips"><span>Servis</span><span>Stok</span><span>Muhasebe</span><span>Rapor</span></div>'
                    + '<span class="lerta-ad-cta">14 gün ücretsiz dene →</span></a>'
            },
            {
                cls: 'lerta-ad lerta-ad-lb lerta-ad-lb-2',
                html: '<a href="' + LERTA_URL + '" target="_blank" rel="noopener sponsored" class="lerta-ad-link">'
                    + '<div class="lerta-ad-stats">'
                    + '<div><strong>7/24</strong><span>Bulut erişim</span></div>'
                    + '<div><strong>5+</strong><span>Entegre modül</span></div>'
                    + '<div><strong>QR</strong><span>Müşteri portalı</span></div>'
                    + '</div>'
                    + '<div class="lerta-ad-mid"><span class="lerta-logo">LERTA</span>'
                    + '<p>Servis talepleri, stok ve muhasebe — hepsi bir arada</p></div>'
                    + '<span class="lerta-ad-cta lerta-ad-cta-light">lerta.tr ↗</span></a>'
            },
            {
                cls: 'lerta-ad lerta-ad-lb lerta-ad-lb-3',
                html: '<a href="' + LERTA_URL + '" target="_blank" rel="noopener sponsored" class="lerta-ad-link">'
                    + '<span class="lerta-ad-badge">Sponsor</span>'
                    + '<span class="lerta-logo lerta-logo-lg">LERTA</span>'
                    + '<p class="lerta-ad-headline lerta-ad-headline-sm">Türkiye genelinde servisler LERTA ile çalışıyor</p>'
                    + '<span class="lerta-ad-cta">Hemen başlayın — 14 gün ücretsiz</span></a>'
            }
        ],
        rect: [
            {
                cls: 'lerta-ad lerta-ad-rect lerta-ad-rect-1',
                html: '<a href="' + LERTA_URL + '" target="_blank" rel="noopener sponsored" class="lerta-ad-link lerta-ad-link-stack">'
                    + '<div class="lerta-ad-rect-top"><span class="lerta-logo">LERTA</span>'
                    + '<span class="lerta-ad-pill">14 gün ücretsiz</span></div>'
                    + '<h4>Oto servisinizi tek panelden yönetin</h4>'
                    + '<ul class="lerta-ad-features">'
                    + '<li>✓ Servis talepleri & iş emirleri</li>'
                    + '<li>✓ Stok & muhasebe takibi</li>'
                    + '<li>✓ Müşteri rehberi & raporlar</li>'
                    + '<li>✓ QR müşteri portalı</li>'
                    + '</ul>'
                    + '<span class="lerta-ad-cta lerta-ad-cta-block">Ücretsiz Deneyin →</span></a>'
            },
            {
                cls: 'lerta-ad lerta-ad-rect lerta-ad-rect-2',
                html: '<a href="' + LERTA_URL + '" target="_blank" rel="noopener sponsored" class="lerta-ad-link lerta-ad-link-stack">'
                    + '<div class="lerta-ad-rect-grid">'
                    + '<div class="lerta-stat-card"><strong>7/24</strong><span>Bulut</span></div>'
                    + '<div class="lerta-stat-card"><strong>5+</strong><span>Modül</span></div>'
                    + '<div class="lerta-stat-card"><strong>QR</strong><span>Portal</span></div>'
                    + '<div class="lerta-stat-card"><strong>14</strong><span>Gün free</span></div>'
                    + '</div>'
                    + '<span class="lerta-logo">LERTA</span>'
                    + '<p class="lerta-ad-sub">Servis · Stok · Muhasebe · Raporlar</p>'
                    + '<span class="lerta-ad-cta lerta-ad-cta-block">lerta.tr — Detaylı bilgi</span></a>'
            },
            {
                cls: 'lerta-ad lerta-ad-rect lerta-ad-rect-3',
                html: '<a href="' + LERTA_URL + '" target="_blank" rel="noopener sponsored" class="lerta-ad-link lerta-ad-link-stack">'
                    + '<div class="lerta-ad-quote">'
                    + '<p>“Servis süreçlerimizi dijitalleştirdik, müşteri memnuniyeti arttı.”</p>'
                    + '<span>— Yetkili servis referansı</span>'
                    + '</div>'
                    + '<div class="lerta-ad-rect-foot">'
                    + '<span class="lerta-logo">LERTA</span>'
                    + '<span class="lerta-ad-cta lerta-ad-cta-sm">Keşfet →</span>'
                    + '</div></a>'
            }
        ],
        sky: [
            {
                cls: 'lerta-ad lerta-ad-sky lerta-ad-sky-1',
                html: '<a href="' + LERTA_URL + '" target="_blank" rel="noopener sponsored" class="lerta-ad-link lerta-ad-link-stack">'
                    + '<span class="lerta-logo lerta-logo-vertical">LERTA</span>'
                    + '<p class="lerta-ad-sky-tag">Oto Servis Yazılımı</p>'
                    + '<div class="lerta-ad-sky-list">'
                    + '<span>Servis</span><span>Stok</span><span>Muhasebe</span>'
                    + '<span>Rapor</span><span>QR Portal</span>'
                    + '</div>'
                    + '<span class="lerta-ad-cta lerta-ad-cta-block">14 gün ücretsiz dene</span>'
                    + '<span class="lerta-ad-contact">lerta.tr</span></a>'
            },
            {
                cls: 'lerta-ad lerta-ad-sky lerta-ad-sky-2',
                html: '<a href="' + LERTA_URL + '" target="_blank" rel="noopener sponsored" class="lerta-ad-link lerta-ad-link-stack">'
                    + '<div class="lerta-ad-sky-hero"><strong>7/24</strong><span>Bulut erişim</span></div>'
                    + '<div class="lerta-ad-sky-hero"><strong>5+</strong><span>Entegre modül</span></div>'
                    + '<span class="lerta-logo">LERTA</span>'
                    + '<p class="lerta-ad-sky-desc">Tek panelden servis yönetimi</p>'
                    + '<span class="lerta-ad-cta lerta-ad-cta-block">Başlayın →</span></a>'
            }
        ]
    };

    function renderCreative(slot, index) {
        const type = slot.dataset.pubAd;
        const list = CREATIVES[type];
        if (!list?.length) return;
        const creative = list[index % list.length];
        const el = slot.querySelector('.pub-ad-creative');
        if (!el) return;
        el.className = 'pub-ad-creative ' + creative.cls + ' is-entering';
        el.innerHTML = creative.html;
        requestAnimationFrame(() => {
            el.classList.remove('is-entering');
            el.classList.add('is-active');
        });
    }

    function initRotator(slot) {
        const type = slot.dataset.pubAd;
        const list = CREATIVES[type];
        if (!list?.length) return;
        let idx = Math.floor(Math.random() * list.length);
        renderCreative(slot, idx);

        const interval = parseInt(slot.dataset.pubAdInterval || ROTATE_MS, 10);
        setInterval(() => {
            if (document.hidden) return;
            const el = slot.querySelector('.pub-ad-creative');
            if (!el) return;
            el.classList.add('is-exiting');
            setTimeout(() => {
                idx = (idx + 1) % list.length;
                renderCreative(slot, idx);
            }, 380);
        }, interval);
    }

    function init() {
        document.querySelectorAll('[data-pub-ad]').forEach(initRotator);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
