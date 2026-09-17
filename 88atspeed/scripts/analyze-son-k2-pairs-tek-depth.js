#!/usr/bin/env node
/**
 * SON'da kırmızı 2 + seçili ikili varken, önceki 6 koşuda (k=2..7)
 * koşuda YALNIZCA bu ata özgü (TEK mantığı) işaretler kazanmayı etkiliyor mu?
 *
 *   node analyze-son-k2-pairs-tek-depth.js
 *   API_BASE=http://127.0.0.1:3023 MIN_SAMPLE=3 node ...
 */
const BASE = process.env.API_BASE || 'http://168.231.109.27';
const MIN_SAMPLE = parseInt(process.env.MIN_SAMPLE || '3', 10);
const DEPTH_MIN = parseInt(process.env.DEPTH_MIN || '2', 10);
const DEPTH_MAX = parseInt(process.env.DEPTH_MAX || '7', 10);

/** İkili başarı tablosundan seçilen ortaklar (SON k=1) */
const PARTNERS = [
    { id: 'tkl', label: 'TEST pembe', match: (y) => !!y.tkl },
    { id: 'ttyk', label: 'yeşil tam kırmızı ★', match: (y) => !!y.ttyk },
    { id: 'teiy', label: 'TEI yeşil T', match: (y) => !!(y.tei && y.teiy) },
    { id: 'tmk', label: 'mavi kenar ★', match: (y) => !!y.tmk },
    { id: 't5k', label: 'TEST5 kahve', match: (y) => !!y.t5k }
];

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
        tkr: 'kırmızı kenar ★',
        tmk: 'mavi kenar ★',
        'tei:y': 'TEI yeşil T',
        'tei:s': 'TEI sarı T',
        'tei:m': 'TEI mavi T',
        'tei:k': 'TEI kırmızı T',
        'shs:k': 'şehir kırmızı Ş',
        'shs:m': 'şehir mavi Ş',
        ttyk: 'yeşil tam kırmızı ★',
        ttym: 'yeşil tam mavi ★',
        tty: 'yeşil tam ★',
        tts: 'sarı tam ★',
        ttsm: 'sarı tam mavi ★',
        ttsk: 'sarı tam kırmızı ★'
    };
    if (map[sig]) return map[sig];
    if (sig.startsWith('s8:')) return 'SON8001 8';
    if (sig.includes('|')) {
        const ad = sig.split('|')[0];
        return ad.length > 32 ? ad.slice(0, 32) + '…' : ad;
    }
    return sig;
}

function isKirmizi2(y) {
    return !!(y && y.t12 && y.t12k);
}

function horseRowKey(h) {
    if (h?.atId != null && h.atId !== '') return String(h.atId);
    if (h?.no != null && h.no !== '') return 'no:' + String(h.no);
    return 'name:' + String(h.name || '');
}

function buildRaceUniqueGostergeMap(horses) {
    const rows = (horses || []).map((h) => {
        const list = Array.isArray(h.yildizlar) ? h.yildizlar : [];
        return { key: horseRowKey(h), list };
    });
    const sigCount = new Map();
    for (const { list } of rows) {
        const seen = new Set();
        for (const y of list) {
            const sig = markerSignature(y);
            if (seen.has(sig)) continue;
            seen.add(sig);
            sigCount.set(sig, (sigCount.get(sig) || 0) + 1);
        }
    }
    const uniqueMap = new Map();
    for (const { key, list } of rows) {
        const seen = new Set();
        const unique = [];
        for (const y of list) {
            const sig = markerSignature(y);
            if (sigCount.get(sig) !== 1 || seen.has(sig)) continue;
            seen.add(sig);
            unique.push(y);
        }
        uniqueMap.set(key, unique);
    }
    return uniqueMap;
}

function sonMarkers(h) {
    return (Array.isArray(h.yildizlar) ? h.yildizlar : [])
        .filter((y) => parseInt(y.k, 10) === 1);
}

function partnerInSon(son, partner) {
    return son.some((y) => partner.match(y));
}

function prevUniqueTekMarkers(h, uniqueMap) {
    return (uniqueMap.get(horseRowKey(h)) || []).filter((y) => {
        const k = parseInt(y.k, 10);
        return k >= DEPTH_MIN && k <= DEPTH_MAX;
    });
}

function depthLabel(k) {
    if (k === 1) return 'SON';
    return (k - 1) + ' ÖNCE';
}

function newBucket() {
    return { total: 0, withBitis: 0, wins: 0, top3: 0 };
}

function addResult(bucket, bitisSira) {
    bucket.total++;
    if (bitisSira == null || bitisSira === '') return;
    bucket.withBitis++;
    const s = parseInt(bitisSira, 10);
    if (s === 1) bucket.wins++;
    if (s >= 1 && s <= 3) bucket.top3++;
}

function pct(a, b) {
    return b ? ((a / b) * 100).toFixed(1) : '—';
}

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.json();
}

async function main() {
    console.log('API:', BASE);
    console.log(
        'SON kırmızı 2 + ikili · önceki koşularda TEK (k=' + DEPTH_MIN + '..' + DEPTH_MAX + ') etkisi'
    );
    console.log('Min örnek (sonuçlu):', MIN_SAMPLE);
    console.log('');

    const list = await fetchJson(BASE + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = list.kayitlar || [];

    /** partnerId -> { base, withTek, withoutTek, bySig: Map, byDepth: Map } */
    const byPartner = new Map();
    for (const p of PARTNERS) {
        byPartner.set(p.id, {
            partner: p,
            base: newBucket(),
            withTek: newBucket(),
            withoutTek: newBucket(),
            bySig: new Map(),
            byDepth: new Map()
        });
    }

    /** sig -> örnek y + görüldüğü derinlikler */
    const sigMeta = new Map();

    for (const k of kayitlar) {
        const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + k.id);
        if (!data.success) continue;

        for (const race of data.kosular || []) {
            const horses = race.horses || [];
            const uniqueMap = buildRaceUniqueGostergeMap(horses);

            for (const h of horses) {
                const son = sonMarkers(h);
                if (!son.some(isKirmizi2)) continue;

                const prevTek = prevUniqueTekMarkers(h, uniqueMap);
                const prevSigs = [...new Set(prevTek.map(markerSignature))];
                const hasPrevTek = prevSigs.length > 0;

                for (const p of PARTNERS) {
                    if (!partnerInSon(son, p)) continue;
                    const st = byPartner.get(p.id);
                    addResult(st.base, h.bitisSira);
                    if (hasPrevTek) addResult(st.withTek, h.bitisSira);
                    else addResult(st.withoutTek, h.bitisSira);

                    const depthHit = new Set();
                    for (const y of prevTek) {
                        const sig = markerSignature(y);
                        const k = parseInt(y.k, 10);
                        if (!sigMeta.has(sig)) sigMeta.set(sig, { y, depths: new Set() });
                        sigMeta.get(sig).depths.add(k);

                        if (!st.bySig.has(sig)) st.bySig.set(sig, newBucket());
                        addResult(st.bySig.get(sig), h.bitisSira);
                        depthHit.add(k);
                    }
                    for (const k of depthHit) {
                        const dk = 'k' + k;
                        if (!st.byDepth.has(dk)) st.byDepth.set(dk, newBucket());
                        addResult(st.byDepth.get(dk), h.bitisSira);
                    }
                }
            }
        }
    }

    for (const p of PARTNERS) {
        const st = byPartner.get(p.id);
        console.log('══════════════════════════════════════════════════════════');
        console.log('İkili: kırmızı 2 + ' + p.label);
        console.log('──────────────────────────────────────────────────────────');
        console.log(
            'Tümü:     n=' + st.base.withBitis,
            '1.=' + st.base.wins,
            '→ ' + pct(st.base.wins, st.base.withBitis) + '%',
            '| ilk3 ' + pct(st.base.top3, st.base.withBitis) + '%'
        );
        console.log(
            '+ önceki koşuda TEK işaret VAR:  n=' + st.withTek.withBitis,
            '1.=' + st.withTek.wins,
            '→ ' + pct(st.withTek.wins, st.withTek.withBitis) + '%'
        );
        console.log(
            '+ önceki koşuda TEK işaret YOK: n=' + st.withoutTek.withBitis,
            '1.=' + st.withoutTek.wins,
            '→ ' + pct(st.withoutTek.wins, st.withoutTek.withBitis) + '%'
        );
        console.log('');

        const sigRows = [...st.bySig.entries()]
            .map(([sig, b]) => {
                const meta = sigMeta.get(sig);
                const depths = meta
                    ? [...meta.depths].sort((a, b) => a - b).map(depthLabel).join(', ')
                    : '';
                return {
                    sig,
                    label: markerLabel(sig, meta?.y),
                    depths,
                    ...b,
                    winPct: b.withBitis ? b.wins / b.withBitis : 0
                };
            })
            .filter((r) => r.withBitis >= MIN_SAMPLE)
            .sort((a, b) => b.winPct - a.winPct || b.wins - a.wins);

        console.log('Önceki koşularda TEK (koşuda tek at) — hangi işaret + bu ikili:');
        if (!sigRows.length) {
            console.log('  (yeterli örnek yok, MIN_SAMPLE=' + MIN_SAMPLE + ')');
        } else {
            console.log(
                ' Kazan%'.padStart(7),
                '  1.'.padStart(4),
                '   n'.padStart(4),
                '  işaret [derinlikler]'
            );
            for (const r of sigRows.slice(0, 20)) {
                console.log(
                    (pct(r.wins, r.withBitis) + '%').padStart(7),
                    String(r.wins).padStart(4),
                    String(r.withBitis).padStart(4),
                    ' ',
                    r.label,
                    r.depths ? '[' + r.depths + ']' : ''
                );
            }
        }

        console.log('');
        console.log('TEK işaretin derinliği (o koşuda en az bir TEK var):');
        const depthRows = [...st.byDepth.entries()]
            .map(([dk, b]) => {
                const k = parseInt(dk.slice(1), 10);
                return { k, label: depthLabel(k), ...b, winPct: b.withBitis ? b.wins / b.withBitis : 0 };
            })
            .filter((r) => r.withBitis >= MIN_SAMPLE)
            .sort((a, b) => a.k - b.k);
        for (const r of depthRows) {
            console.log(
                ' ',
                r.label.padEnd(8),
                'n=' + r.withBitis,
                '1.=' + r.wins,
                '→ ' + pct(r.wins, r.withBitis) + '%'
            );
        }
        if (!depthRows.length) console.log('  (yeterli örnek yok)');
        console.log('');
    }

    console.log('══════════════════════════════════════════════════════════');
    console.log('Not: TEK = o program koşusunda işaret imzası yalnızca bu atta (tüm k=' + DEPTH_MIN + '..' + DEPTH_MAX + ' geçmiş).');
    console.log('Bitti.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
