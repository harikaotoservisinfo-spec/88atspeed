#!/usr/bin/env node
/**
 * Kayıt Test geçmişi: TEK veya SON sütununda "kırmızı 2" (TEST12 kırmızı, t12+t12k) — kazanma oranı.
 *
 * TEK: koşuda yalnızca o ata özgü işaretler (public-home buildRaceUniqueGostergeMap).
 * SON: son yarış derinliği (y.k === 1), formatYildizGostergeDepthCell ile aynı.
 *
 * Kullanım:
 *   node analyze-tek-kirmizi2.js tek
 *   node analyze-tek-kirmizi2.js son          # yalnızca kırmızı 2 (k=1)
 *   node analyze-tek-kirmizi2.js son-var      # SON'da kırmızı 2 de var (karışık)
 */
const BASE = process.env.API_BASE || 'http://168.231.109.27';
const COLUMN = (process.argv[2] || process.env.COLUMN || 'tek').toLowerCase();

function gostergeMarkerSignature(y) {
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
    return (y.ad || 'star') + '|' + sutun;
}

function horseRowKey(h) {
    if (h?.atId != null && h.atId !== '') return String(h.atId);
    if (h?.no != null && h.no !== '') return 'no:' + String(h.no);
    return 'name:' + String(h.name || '');
}

function buildRaceUniqueGostergeMap(horses) {
    const rows = (horses || []).map((h) => {
        const list = Array.isArray(h.yildizlar) ? h.yildizlar : [];
        const sigs = new Set(list.map(gostergeMarkerSignature));
        return { key: horseRowKey(h), list, sigs };
    });
    const horseCountBySig = new Map();
    rows.forEach(({ sigs }) => {
        sigs.forEach((sig) => horseCountBySig.set(sig, (horseCountBySig.get(sig) || 0) + 1));
    });
    const uniqueMap = new Map();
    rows.forEach(({ key, list }) => {
        const seen = new Set();
        const unique = [];
        for (const y of list) {
            const sig = gostergeMarkerSignature(y);
            if (horseCountBySig.get(sig) !== 1 || seen.has(sig)) continue;
            seen.add(sig);
            unique.push(y);
        }
        uniqueMap.set(key, unique);
    });
    return uniqueMap;
}

function isKirmizi2Marker(y) {
    return !!(y && y.t12 && y.t12k);
}

function onlyKirmizi2(list) {
    if (!list || !list.length) return false;
    return list.every(isKirmizi2Marker);
}

function hasKirmizi2(list) {
    return !!(list && list.length && list.some(isKirmizi2Marker));
}

/** SON sütunu: y.k === 1 (en son geçmiş koşu işaretleri) */
function sonMarkersForHorse(h) {
    return (Array.isArray(h.yildizlar) ? h.yildizlar : [])
        .filter((y) => parseInt(y.k, 10) === 1);
}

function markersForColumn(h, uniqueMap) {
    if (COLUMN === 'son' || COLUMN === 'son-var') return sonMarkersForHorse(h);
    return uniqueMap.get(horseRowKey(h)) || [];
}

function matchesRule(markers) {
    if (COLUMN === 'son-var') return hasKirmizi2(markers);
    return onlyKirmizi2(markers);
}

function columnLabel() {
    if (COLUMN === 'son-var') {
        return 'SON sütunu: kırmızı 2 de var (son geçmiş koşu k=1, yan yana diğer işaretler olabilir)';
    }
    if (COLUMN === 'son') {
        return 'SON sütunu: yalnızca kırmızı 2 (son geçmiş koşu, k=1)';
    }
    return 'TEK sütunu: yalnızca kırmızı 2 (TEST12 kırmızı, koşuda tek at)';
}

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status + ' ' + url);
    return res.json();
}

async function main() {
    if (COLUMN !== 'tek' && COLUMN !== 'son' && COLUMN !== 'son-var') {
        console.error('Sütun: tek | son | son-var olmalı, alındı:', COLUMN);
        process.exit(1);
    }

    const listData = await fetchJson(BASE + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = listData.kayitlar || [];
    const hits = [];
    const winners = [];
    let totalRaces = 0;
    let totalHorses = 0;
    let withBitis = 0;
    let wins = 0;
    let top3 = 0;
    let pendingBitis = 0;

    for (const k of kayitlar) {
        const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + k.id);
        if (!data.success) continue;
        for (const race of data.kosular || []) {
            totalRaces++;
            const horses = race.horses || [];
            const uniqueMap = buildRaceUniqueGostergeMap(horses);
            for (const h of horses) {
                totalHorses++;
                const markers = markersForColumn(h, uniqueMap);
                if (!matchesRule(markers)) continue;
                const bitis = h.bitisSira;
                const row = {
                    kayitId: data.kayitId,
                    tarih: data.tarih,
                    hipodrom: data.hipodrom,
                    raceNo: race.raceNo,
                    no: h.no,
                    name: h.name,
                    bitisSira: bitis,
                    markerCount: markers.length
                };
                hits.push(row);
                if (bitis != null && bitis !== '') {
                    withBitis++;
                    const s = parseInt(bitis, 10);
                    if (s === 1) {
                        wins++;
                        winners.push(row);
                    }
                    if (s >= 1 && s <= 3) top3++;
                } else {
                    pendingBitis++;
                }
            }
        }
    }

    const n = hits.length;
    const winPct = withBitis ? ((wins / withBitis) * 100).toFixed(1) : '—';
    const top3Pct = withBitis ? ((top3 / withBitis) * 100).toFixed(1) : '—';

    console.log('=== ' + columnLabel() + ' ===');
    console.log('Kayıt sayısı (Kayıt Test):', kayitlar.length);
    console.log('Taranan koşu:', totalRaces, '| at satırı:', totalHorses);
    console.log('');
    console.log('Eşleşen at sayısı (tüm geçmiş):', n);
    console.log('Sonuç bilinen:', withBitis, '| henüz sonuç yok:', pendingBitis);
    console.log('Kazanma (1.):', wins, '→', winPct + '%');
    console.log('İlk 3:', top3, '→', top3Pct + '%');
    console.log('');
    if (winners.length) {
        console.log('--- Kazananlar ---');
        for (const r of winners) {
            console.log(
                '★ #' + r.kayitId,
                r.tarih,
                r.hipodrom,
                'K' + r.raceNo,
                'N' + r.no,
                r.name
            );
        }
        console.log('');
    }
    console.log('--- Sonuç bilinen örnekler (ilk 20) ---');
    const shown = hits
        .filter((r) => r.bitisSira != null && r.bitisSira !== '')
        .slice(0, 20);
    for (const r of shown) {
        const win = parseInt(r.bitisSira, 10) === 1 ? '★' : ' ';
        console.log(
            win,
            '#' + r.kayitId,
            r.tarih,
            r.hipodrom,
            'K' + r.raceNo,
            'N' + r.no,
            r.name,
            '→ sıra',
            r.bitisSira
        );
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
