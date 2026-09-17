#!/usr/bin/env node
/**
 * Bugünün Kayıt Test programı — SON (k=1) sole puanı ile koşu içi sıralama.
 * Ağırlıklar geçmiş kayıtlardan (1. vs rakip analizi) öğrenilir.
 *
 *   node score-today-son.js
 *   TARIH=17/09/2026 API_BASE=http://127.0.0.1:3023 node score-today-son.js
 */
const BASE = process.env.API_BASE || 'http://168.231.109.27';
const TARIH = process.env.TARIH || '';
const KAYIT_IDS = process.env.KAYIT_IDS || '';
const MIN_RACE_FIELD = parseInt(process.env.MIN_RACE_FIELD || '3', 10);
const LEARN_MIN_SAMPLE = parseInt(process.env.LEARN_MIN_SAMPLE || '5', 10);
/** Son 2 koşuda Mor yanıp (TEST9) — geçmiş backtest +15 puan iyileştirdi */
const MOR_YANIP_BONUS = parseInt(process.env.MOR_YANIP_BONUS || '15', 10);

function morYanipSon2(h) {
    return !!h.test9Yanip;
}

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
        't12:k': 'kırmızı 2',
        't12:o': 'turuncu 2',
        t46: 'TEST46 (4)',
        t9m: 'TEST9 mor',
        t5k: 'TEST5 kahve',
        f8g: 'FARK8002',
        tkl: 'TEST pembe',
        t4: 'T1DR top4',
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

function sonMarkerSigs(h) {
    const list = (Array.isArray(h.yildizlar) ? h.yildizlar : [])
        .filter((y) => parseInt(y.k, 10) === 1);
    const sigs = new Set();
    const bySig = new Map();
    for (const y of list) {
        const s = markerSignature(y);
        sigs.add(s);
        if (!bySig.has(s)) bySig.set(s, y);
    }
    return { sigs, bySig };
}

function newStat() {
    return {
        horseRows: 0,
        wins: 0,
        winnerHad: 0,
        winnerExclusiveInRace: 0,
        soleCarrierWins: 0,
        soleCarrierRaces: 0,
        sharedCarrierRaces: 0
    };
}

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.json();
}

function resolveKayitIds(kayitlar) {
    if (KAYIT_IDS.trim()) {
        const ids = KAYIT_IDS.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
        const tarih = TARIH.trim() || kayitlar.find((k) => k.id === ids[0])?.tarih || '';
        return { ids, tarih };
    }
    let targetTarih = TARIH.trim() || kayitlar[0]?.tarih || '';
    const ids = kayitlar.filter((k) => k.tarih === targetTarih).map((k) => k.id);
    return { ids, tarih: targetTarih };
}

/** Geçmiş koşulardan işaret ağırlıkları */
async function learnWeights(kayitlar) {
    const bySig = new Map();
    const sampleY = new Map();

    for (const k of kayitlar) {
        const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + k.id);
        if (!data.success) continue;

        for (const race of data.kosular || []) {
            const horses = (race.horses || []).filter((h) => h.bitisSira != null && h.bitisSira !== '');
            if (horses.length < MIN_RACE_FIELD) continue;
            const winner = horses.find((h) => parseInt(h.bitisSira, 10) === 1);
            if (!winner) continue;

            const rivals = horses.filter((h) => h !== winner);
            const wSon = sonMarkerSigs(winner);
            const rivalSons = rivals.map((h) => sonMarkerSigs(h));

            for (const sig of wSon.sigs) {
                if (!bySig.has(sig)) bySig.set(sig, newStat());
                const st = bySig.get(sig);
                st.winnerHad++;
                if (!rivalSons.some((r) => r.sigs.has(sig))) st.winnerExclusiveInRace++;
                if (!sampleY.has(sig)) sampleY.set(sig, wSon.bySig.get(sig));
            }

            const allSigs = new Set();
            for (const h of horses) {
                for (const s of sonMarkerSigs(h).sigs) allSigs.add(s);
            }
            for (const sig of allSigs) {
                if (!bySig.has(sig)) bySig.set(sig, newStat());
                const st = bySig.get(sig);
                const carriers = horses.filter((h) => sonMarkerSigs(h).sigs.has(sig));
                const won = carriers.some((h) => parseInt(h.bitisSira, 10) === 1);
                if (carriers.length === 1) {
                    st.soleCarrierRaces++;
                    if (won) st.soleCarrierWins++;
                } else if (carriers.length > 1) {
                    st.sharedCarrierRaces++;
                }
            }

            for (const h of horses) {
                for (const sig of sonMarkerSigs(h).sigs) {
                    if (!bySig.has(sig)) bySig.set(sig, newStat());
                    const st = bySig.get(sig);
                    st.horseRows++;
                    if (parseInt(h.bitisSira, 10) === 1) st.wins++;
                    if (!sampleY.has(sig)) sampleY.set(sig, sonMarkerSigs(h).bySig.get(sig));
                }
            }
        }
    }

    const weights = new Map();
    for (const [sig, st] of bySig) {
        const soleWin = st.soleCarrierRaces >= LEARN_MIN_SAMPLE
            ? st.soleCarrierWins / st.soleCarrierRaces
            : (st.horseRows >= LEARN_MIN_SAMPLE ? st.wins / st.horseRows : 0.1);
        const excl = st.winnerHad > 0 ? st.winnerExclusiveInRace / st.winnerHad : 0;
        const trap = (st.winnerHad >= 25 && excl < 0.06)
            || sig === 't4'
            || (sig === 'tmk' && st.sharedCarrierRaces > st.soleCarrierRaces * 3);
        const soleScore = 0.55 * soleWin + 0.45 * excl;
        weights.set(sig, {
            label: markerLabel(sig, sampleY.get(sig)),
            soleScore,
            trap,
            soleWin,
            excl
        });
    }
    return weights;
}

function buildCarrierCounts(horses) {
    const carrierCount = new Map();
    for (const h of horses) {
        for (const s of sonMarkerSigs(h).sigs) {
            carrierCount.set(s, (carrierCount.get(s) || 0) + 1);
        }
    }
    return carrierCount;
}

function scoreHorse(h, horses, weights) {
    const { sigs, bySig } = sonMarkerSigs(h);
    const carrierCount = buildCarrierCounts(horses);
    let score = 0;
    const details = [];
    let soleCount = 0;

    for (const sig of sigs) {
        const n = carrierCount.get(sig) || 0;
        const w = weights.get(sig);
        const lab = w?.label || markerLabel(sig, bySig.get(sig));

        if (n === 1) {
            const pts = (w?.soleScore ?? 0.12) * 100;
            score += pts;
            soleCount++;
            details.push('+' + pts.toFixed(0) + ' TEK:' + lab);
        } else if (n > 1 && w?.trap) {
            score -= 4;
            details.push('−4 tuzak:' + lab);
        } else if (n > 1) {
            score -= 1;
            details.push('−1 ortak:' + lab);
        }
    }

    if (soleCount >= 2) {
        score += 10;
        details.push('+10 çift TEK bonus');
    } else if (soleCount === 1) {
        score += 3;
        details.push('+3 tek TEK bonus');
    }

    const mor = morYanipSon2(h);
    if (mor && MOR_YANIP_BONUS > 0) {
        score += MOR_YANIP_BONUS;
        details.push('+' + MOR_YANIP_BONUS + ' mor yanıp (son 2 koşu)');
    }

    return { score, details, soleCount, sonCount: sigs.size, mor };
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  Bugün · SON sole puanı (geçmiş kayıtlardan öğrenilmiş)       ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('API:', BASE);
    console.log('');

    const list = await fetchJson(BASE + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = list.kayitlar || [];

    console.log('Geçmiş kayıtlardan ağırlıklar öğreniliyor…');
    const weights = await learnWeights(kayitlar);
    console.log('Öğrenilen işaret sayısı:', weights.size);
    console.log('');

    const { ids: kayitIds, tarih } = resolveKayitIds(kayitlar);
    if (!kayitIds.length) {
        console.error('Kayıt yok. TARIH= veya KAYIT_IDS= kullanın.');
        process.exit(1);
    }

    console.log('Tarih:', tarih);
    console.log('Kayıt id:', kayitIds.join(', '));
    console.log('Puan: SON (k=1) işaretleri · TEK = koşuda yalnız o at taşıyor');
    if (MOR_YANIP_BONUS > 0) {
        console.log('Mor yanıp (test9Yanip, son 2 koşu): +' + MOR_YANIP_BONUS + ' puan (MOR_YANIP_BONUS=0 ile kapatılır)');
    }
    console.log('');

    let raceCount = 0;

    for (const kid of kayitIds) {
        const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + kid);
        if (!data.success) continue;

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📍', data.hipodrom, '· kayıt #' + data.kayitId, '·', data.tarih);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        for (const race of data.kosular || []) {
            const horses = race.horses || [];
            if (horses.length < MIN_RACE_FIELD) continue;

            const ranked = horses.map((h) => {
                const s = scoreHorse(h, horses, weights);
                return { h, ...s };
            }).sort((a, b) => b.score - a.score || b.soleCount - a.soleCount);

            raceCount++;
            const top = ranked[0];
            const bitisNote = top.h.bitisSira != null && top.h.bitisSira !== ''
                ? '' : ' · henüz koşulmadı';

            console.log('');
            console.log('  🏁', race.raceNo + '. Koşu', '(' + horses.length + ' at)' + bitisNote);
            const morTag = top.mor ? ' · mor yanıp' : '';
            console.log('  ▶ Önerilen 1.: N' + top.h.no, top.h.name, '— puan', top.score.toFixed(1) + morTag);
            console.log('     ' + (top.details.slice(0, 5).join(' | ') || 'SON işaret yok'));

            console.log('  Sıralama:');
            ranked.forEach((r, i) => {
                const star = i === 0 ? '★' : ' ';
                const bitis = r.h.bitisSira != null && r.h.bitisSira !== ''
                    ? ' sıra:' + r.h.bitisSira : '';
                console.log(
                    '   ' + star + String(i + 1).padStart(2) + '.',
                    r.score.toFixed(1).padStart(6),
                    'N' + String(r.h.no).padStart(2),
                    String(r.h.name || '').slice(0, 22).padEnd(22),
                    'TEK:' + r.soleCount,
                    'SON:' + r.sonCount,
                    (r.mor ? 'MOR' : '   ') + bitis
                );
            });
        }
        console.log('');
    }

    console.log('Toplam koşu skorlandı:', raceCount);
    console.log('');
    console.log('Not: Bu tahmin değil; geçmiş sole/exclusive istatistiğinin bugünkü programa uygulanması.');
    console.log('Bitti.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
