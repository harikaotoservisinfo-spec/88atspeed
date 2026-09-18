#!/usr/bin/env node
/**
 * Kayıt Test: SON (k=1) sütununda kırmızı 2 + başka işaret ikilileri — kazanma başarısı.
 * Sunucuda: node analyze-son-k2-pairs-terminal.js
 * veya API_BASE=http://127.0.0.1:3023 node ...
 */
const BASE = process.env.API_BASE || 'http://168.231.109.27';
const MIN_SAMPLE = parseInt(process.env.MIN_SAMPLE || '3', 10);

function markerSignature(y) {
    if (y.s8) return 's8:' + (y.s8r || 0);
    if (y.tei) return 'tei:' + (y.teik ? 'k' : y.teiy ? 'y' : y.teis ? 's' : 'm');
    if (y.shs) return 'shs:' + (y.shk ? 'k' : 'm');
    if (y.t46) return 't46';
    if (y.t12) return 't12:' + (y.t12k ? 'k' : 'o');
    if (y.t9m) return 't9m';
    if (y.t5k) return 't5k';
    if (y.f8g) return 'f8g';
    if (y.tkl) return 'tkl';
    if (y.t4) return 't4';
    if (y.t1yk) return 't1yk';
    if (y.t1ym) return 't1ym';
    if (y.t1y) return 't1y';
    if (y.t2yk) return 't2yk';
    if (y.t2ym) return 't2ym';
    if (y.t2y) return 't2y';
    if (y.t3yk) return 't3yk';
    if (y.t3ym) return 't3ym';
    if (y.t3y) return 't3y';
    if (y.tkr) return 'tkr';
    if (y.tmk) return 'tmk';
    if (y.ttsk) return 'ttsk';
    if (y.ttsm) return 'ttsm';
    if (y.tts) return 'tts';
    if (y.ttyk) return 'ttyk';
    if (y.ttym) return 'ttym';
    if (y.tty) return 'tty';
    const sutun = String(y.t || '').split(' · ')[1] || '';
    return (y.ad || 'yildiz') + '|' + sutun;
}

function markerLabel(sig, sampleY) {
    const y = sampleY || {};
    const map = {
        't12:k': 'kırmızı 2',
        't12:o': 'turuncu 2',
        t46: 'TEST46 (4)',
        t9m: 'TEST9 mor',
        t5k: 'TEST5 kahve',
        f8g: 'FARK8002',
        tkl: 'TEST pembe',
        t4: 'T1DR top4',
        t1y: 'TEST1 yeşil ●',
        t1ym: 'TEST1 yeşil-mavi ●',
        t1yk: 'TEST1 yeşil-kırmızı ●',
        t2y: 'TEST2 yeşil ●',
        t2ym: 'TEST2 yeşil-mavi ●',
        t2yk: 'TEST2 yeşil-kırmızı ●',
        t3y: 'TEST3 gri ●',
        t3ym: 'TEST3 gri-mavi ●',
        t3yk: 'TEST3 gri-kırmızı ●',
        tkr: 'kırmızı kenar ★',
        tmk: 'mavi kenar ★',
        ttsk: 'sarı tam kırmızı ★',
        ttsm: 'sarı tam mavi ★',
        tts: 'sarı tam ★',
        ttyk: 'yeşil tam kırmızı ★',
        ttym: 'yeşil tam mavi ★',
        tty: 'yeşil tam ★',
        'tei:k': 'TEI kırmızı T',
        'tei:y': 'TEI yeşil T',
        'tei:s': 'TEI sarı T',
        'tei:m': 'TEI mavi T',
        'shs:k': 'şehir kırmızı Ş',
        'shs:m': 'şehir mavi Ş',
        's8:1': 'SON8001 yeşil 8',
        's8:2': 'SON8001 sarı 8',
        's8:3': 'SON8001 kırmızı 8'
    };
    if (map[sig]) return map[sig];
    if (sig.startsWith('s8:')) return 'SON8001 8 (' + sig + ')';
    if (sig.includes('|')) {
        const ad = sig.split('|')[0];
        return ad.length > 28 ? ad.slice(0, 28) + '…' : ad;
    }
    return sig;
}

function isKirmizi2(y) {
    return !!(y && y.t12 && y.t12k);
}

function sonMarkers(h) {
    return (Array.isArray(h.yildizlar) ? h.yildizlar : [])
        .filter((y) => parseInt(y.k, 10) === 1);
}

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.json();
}

async function main() {
    console.log('API:', BASE);
    console.log('SON (k=1) + kırmızı 2 ikili analizi · min örnek:', MIN_SAMPLE);
    console.log('');

    const list = await fetchJson(BASE + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = list.kayitlar || [];

    /** @type {Map<string, {sig,label,sampleY,total,withBitis,wins,top3,winRows:[]}>} */
    const pairStats = new Map();
    const sampleBySig = new Map();

    let baseK2Total = 0;
    let baseK2Bitis = 0;
    let baseK2Wins = 0;
    let baseK2Top3 = 0;

    /** Birincilerde SON'da k2 ile en çok birlikte görülen işaret (kazanma sayısı) */
    const coCountAmongWinners = new Map();

    for (const k of kayitlar) {
        const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + k.id);
        if (!data.success) continue;

        for (const race of data.kosular || []) {
            for (const h of race.horses || []) {
                const son = sonMarkers(h);
                if (!son.some(isKirmizi2)) continue;

                baseK2Total++;
                const bitis = h.bitisSira;
                const hasBitis = bitis != null && bitis !== '';
                const s = hasBitis ? parseInt(bitis, 10) : NaN;
                if (hasBitis) {
                    baseK2Bitis++;
                    if (s === 1) baseK2Wins++;
                    if (s >= 1 && s <= 3) baseK2Top3++;
                }

                const partners = son.filter((y) => !isKirmizi2(y));
                const partnerSigs = [...new Set(partners.map(markerSignature))];

                if (s === 1) {
                    for (const ps of partnerSigs) {
                        coCountAmongWinners.set(ps, (coCountAmongWinners.get(ps) || 0) + 1);
                    }
                    if (!partnerSigs.length) {
                        coCountAmongWinners.set('__solo__', (coCountAmongWinners.get('__solo__') || 0) + 1);
                    }
                }

                const keys = partnerSigs.length ? partnerSigs : ['__solo__'];
                for (const ps of keys) {
                    if (!pairStats.has(ps)) {
                        pairStats.set(ps, {
                            sig: ps,
                            total: 0,
                            withBitis: 0,
                            wins: 0,
                            top3: 0
                        });
                    }
                    const st = pairStats.get(ps);
                    st.total++;
                    if (hasBitis) {
                        st.withBitis++;
                        if (s === 1) st.wins++;
                        if (s >= 1 && s <= 3) st.top3++;
                    }
                    if (!sampleBySig.has(ps)) {
                        const y = partners.find((m) => markerSignature(m) === ps);
                        sampleBySig.set(ps, y);
                    }
                }
            }
        }
    }

    const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '—');

    console.log('=== Referans: SON\'da kırmızı 2 (yanında işaret olsun olmasın) ===');
    console.log('Vaka:', baseK2Total, '| sonuçlu:', baseK2Bitis);
    console.log('Kazanma:', baseK2Wins, '→', pct(baseK2Wins, baseK2Bitis) + '%');
    console.log('İlk 3:', baseK2Top3, '→', pct(baseK2Top3, baseK2Bitis) + '%');
    console.log('');

    console.log('=== Birincilerde (sıra=1) kırmızı 2 ile en çok birlikte yanan işaret ===');
    const winnerCo = [...coCountAmongWinners.entries()]
        .sort((a, b) => b[1] - a[1]);
    if (!winnerCo.length) {
        console.log('(yok)');
    } else {
        for (const [sig, cnt] of winnerCo.slice(0, 15)) {
            const lab = sig === '__solo__' ? '(yalnız kırmızı 2, başka SON işareti yok)' : markerLabel(sig, sampleBySig.get(sig));
            console.log(String(cnt).padStart(3), '×', lab);
        }
    }
    console.log('');

    const rows = [...pairStats.values()]
        .map((st) => ({
            ...st,
            label: st.sig === '__solo__'
                ? 'kırmızı 2 + (başka SON işareti yok)'
                : 'kırmızı 2 + ' + markerLabel(st.sig, sampleBySig.get(st.sig)),
            winPct: st.withBitis ? st.wins / st.withBitis : 0,
            top3Pct: st.withBitis ? st.top3 / st.withBitis : 0
        }))
        .filter((r) => r.withBitis >= MIN_SAMPLE)
        .sort((a, b) => b.winPct - a.winPct || b.wins - a.wins);

    console.log('=== İkili başarı (sonuçlu vaka ≥ ' + MIN_SAMPLE + ') — kazanma % sıralı ===');
    console.log(
        'Kazan%'.padStart(7),
        'İlk3%'.padStart(7),
        '1. '.padStart(4),
        'n'.padStart(4),
        '  İkili'
    );
    for (const r of rows) {
        console.log(
            (pct(r.wins, r.withBitis) + '%').padStart(7),
            (pct(r.top3, r.withBitis) + '%').padStart(7),
            String(r.wins).padStart(4),
            String(r.withBitis).padStart(4),
            ' ',
            r.label
        );
    }

    console.log('');
    const byWins = [...rows].sort((a, b) => b.wins - a.wins || b.winPct - a.winPct);
    console.log('=== En çok birincilik getiren ikili (aynı filtre) ===');
    for (const r of byWins.slice(0, 10)) {
        console.log(
            r.wins + '/' + r.withBitis,
            '(' + pct(r.wins, r.withBitis) + '%)',
            '—',
            r.label
        );
    }

    if (rows.length >= 2) {
        const best = rows[0];
        const second = rows[1];
        console.log('');
        console.log('--- Özet karşılaştırma (kazanma %) ---');
        console.log('1.', best.label, '→', pct(best.wins, best.withBitis) + '%', '(' + best.wins + '/' + best.withBitis + ')');
        console.log('2.', second.label, '→', pct(second.wins, second.withBitis) + '%', '(' + second.wins + '/' + second.withBitis + ')');
    }

    console.log('');
    console.log('Bitti.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
