#!/usr/bin/env node
/**
 * Bugünün (veya seçilen tarihin) Kayıt Test kayıtlarında:
 * SON'da kırmızı 2 + seçili ikili; önceki koşularda TEK işaretler.
 *
 *   node scan-today-k2-pairs.js
 *   TARIH=17/09/2026 node scan-today-k2-pairs.js
 *   API_BASE=http://127.0.0.1:3023 node scan-today-k2-pairs.js
 */
const BASE = process.env.API_BASE || 'http://168.231.109.27';
const TARIH = process.env.TARIH || ''; // boş = en yeni kayıt tarihi
const KAYIT_IDS = process.env.KAYIT_IDS || ''; // örn. 210,211,212
const ONLY_WITH_BITIS = process.env.ONLY_WITH_BITIS === '1';
const DEPTH_MIN = parseInt(process.env.DEPTH_MIN || '2', 10);
const DEPTH_MAX = parseInt(process.env.DEPTH_MAX || '7', 10);

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

function markerLabel(sig, y) {
    const map = {
        tkl: 'TEST pembe',
        ttyk: 'yeşil tam kırmızı ★',
        'tei:y': 'TEI yeşil T',
        tmk: 'mavi kenar ★',
        t5k: 'TEST5 kahve',
        tkr: 'kırmızı kenar ★',
        t4: 'T1DR top4',
        t46: 'TEST46 (4)',
        f8g: 'FARK8002',
        t9m: 'TEST9 mor'
    };
    if (map[sig]) return map[sig];
    if (sig.includes('|')) return sig.split('|')[0].slice(0, 36);
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

function depthLabel(k) {
    if (k === 1) return 'SON';
    return (k - 1) + ' ÖNCE';
}

function prevUniqueTek(h, uniqueMap) {
    return (uniqueMap.get(horseRowKey(h)) || []).filter((y) => {
        const k = parseInt(y.k, 10);
        return k >= DEPTH_MIN && k <= DEPTH_MAX;
    });
}

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.json();
}

function resolveKayitIds(kayitlar) {
    if (KAYIT_IDS.trim()) {
        const ids = KAYIT_IDS.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
        return { ids, targetTarih: TARIH.trim() || kayitlar.find((k) => k.id === ids[0])?.tarih || '' };
    }
    let targetTarih = TARIH.trim();
    if (!targetTarih) targetTarih = kayitlar[0]?.tarih || '';
    const ids = kayitlar.filter((k) => k.tarih === targetTarih).map((k) => k.id);
    return { ids, targetTarih };
}

async function main() {
    console.log('API:', BASE);
    const list = await fetchJson(BASE + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = list.kayitlar || [];
    const { ids: kayitIds, targetTarih: tarih } = resolveKayitIds(kayitlar);

    if (!kayitIds.length) {
        console.error('Kayıt bulunamadı. TARIH=17/09/2026 veya KAYIT_IDS=210,211,212 deneyin.');
        process.exit(1);
    }

    console.log('Tarih:', tarih || '(KAYIT_IDS)');
    console.log('Kayıt id:', kayitIds.join(', '));
    console.log('Kural: SON (k=1) kırmızı 2 + ikili:', PARTNERS.map((p) => p.label).join(' | '));
    console.log('');

    const hits = [];
    let scanned = 0;

    for (const kid of kayitIds) {
        const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + kid);
        if (!data.success) continue;

        for (const race of data.kosular || []) {
            const horses = race.horses || [];
            const uniqueMap = buildRaceUniqueGostergeMap(horses);

            for (const h of horses) {
                scanned++;
                if (ONLY_WITH_BITIS && (h.bitisSira == null || h.bitisSira === '')) continue;

                const son = sonMarkers(h);
                if (!son.some(isKirmizi2)) continue;

                const matchedPartners = PARTNERS.filter((p) => son.some((y) => p.match(y)));
                if (!matchedPartners.length) continue;

                const prevTek = prevUniqueTek(h, uniqueMap);
                const tekLabels = prevTek.map((y) => {
                    const sig = markerSignature(y);
                    return markerLabel(sig, y) + '@' + depthLabel(parseInt(y.k, 10));
                });

                hits.push({
                    kayitId: data.kayitId,
                    hip: data.hipodrom,
                    tarih: data.tarih,
                    raceNo: race.raceNo,
                    no: h.no,
                    name: h.name,
                    partners: matchedPartners.map((p) => p.label).join(' + '),
                    tek: tekLabels.length ? tekLabels.join(', ') : '(önceki koşuda TEK yok)',
                    bitis: h.bitisSira
                });
            }
        }
    }

    console.log('Taranan at satırı:', scanned);
    console.log('Kurala uyan at:', hits.length);
    console.log('');

    if (!hits.length) {
        console.log('Bugün bu kayıtlarda SON kırmızı 2 + listedeki ikili yok.');
        return;
    }

    const byHip = new Map();
    for (const r of hits) {
        const key = r.hip + ' #' + r.kayitId;
        if (!byHip.has(key)) byHip.set(key, []);
        byHip.get(key).push(r);
    }

    for (const [hip, rows] of byHip) {
        console.log('── ' + hip + ' (' + rows.length + ' at) ──');
        rows.sort((a, b) => String(a.raceNo).localeCompare(String(b.raceNo), 'tr', { numeric: true }));
        for (const r of rows) {
            const bitis = r.bitis != null && r.bitis !== '' ? ' [bitiş:' + r.bitis + ']' : ' [henüz koşmadı]';
            console.log(
                '  K' + String(r.raceNo).padStart(2, ' ') + ' N' + String(r.no).padStart(2, ' ') + ' ' + r.name
            );
            console.log('       İkili: kırmızı 2 + ' + r.partners);
            console.log('       Önceki TEK (k=' + DEPTH_MIN + '..' + DEPTH_MAX + '): ' + r.tek + bitis);
        }
        console.log('');
    }

    console.log('Özet ikili sayıları:');
    for (const p of PARTNERS) {
        const n = hits.filter((r) => r.partners.includes(p.label)).length;
        if (n) console.log('  ', p.label + ':', n);
    }
    const withTek = hits.filter((r) => !r.tek.startsWith('(önceki')).length;
    console.log('  önceki koşuda TEK var:', withTek, '| TEK yok:', hits.length - withTek);
    console.log('');
    console.log('Bitti.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
