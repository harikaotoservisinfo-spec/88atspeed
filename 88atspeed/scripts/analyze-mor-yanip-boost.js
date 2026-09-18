#!/usr/bin/env node
/**
 * Son 2 koşuda "Mor yanıp (TEST9)" (test9Yanip) kuralının kazanma oranına etkisi.
 * Mevcut SON sole mantığı ile birlikte karşılaştırma.
 *
 *   node analyze-mor-yanip-boost.js
 *   API_BASE=http://127.0.0.1:3023 node analyze-mor-yanip-boost.js
 */
const BASE = process.env.API_BASE || 'http://168.231.109.27';
const MIN_RACE_FIELD = parseInt(process.env.MIN_RACE_FIELD || '4', 10);

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

function sonSigs(h) {
    const sigs = new Set();
    for (const y of h.yildizlar || []) {
        if (parseInt(y.k, 10) === 1) sigs.add(markerSignature(y));
    }
    return sigs;
}

function hasKirmizi2Son(h) {
    return (h.yildizlar || []).some((y) => parseInt(y.k, 10) === 1 && y.t12 && y.t12k);
}

function morYanipSon2(h) {
    return !!h.test9Yanip;
}

function carrierCounts(horses) {
    const m = new Map();
    for (const h of horses) {
        for (const s of sonSigs(h)) m.set(s, (m.get(s) || 0) + 1);
    }
    return m;
}

function soleCount(h, horses) {
    const cc = carrierCounts(horses);
    let n = 0;
    for (const s of sonSigs(h)) if (cc.get(s) === 1) n++;
    return n;
}

function simpleSoleScore(h, horses, weights) {
    const cc = carrierCounts(horses);
    let score = 0;
    let soleN = 0;
    for (const s of sonSigs(h)) {
        const w = weights.get(s);
        if (cc.get(s) === 1) {
            soleN++;
            score += (w?.soleScore ?? 0.12) * 100;
            if (w?.trap) score -= 4;
        } else if (cc.get(s) > 1) {
            score += w?.trap ? -4 : -1;
        }
    }
    if (soleN >= 2) score += 10;
    else if (soleN === 1) score += 3;
    return { score, soleN };
}

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.json();
}

function pct(a, b) {
    return b ? ((a / b) * 100).toFixed(1) : '—';
}

function bucket(name) {
    return { name, rows: 0, wins: 0, top3: 0, races: 0, raceWins: 0 };
}

function addRow(b, bitis) {
    b.rows++;
    const s = parseInt(bitis, 10);
    if (s === 1) b.wins++;
    if (s >= 1 && s <= 3) b.top3++;
}

async function learnWeights(kayitlar) {
    const bySig = new Map();
    for (const k of kayitlar) {
        const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + k.id);
        if (!data.success) continue;
        for (const race of data.kosular || []) {
            const horses = (race.horses || []).filter((h) => h.bitisSira != null && h.bitisSira !== '');
            if (horses.length < MIN_RACE_FIELD) continue;
            const allSigs = new Set();
            for (const h of horses) for (const s of sonSigs(h)) allSigs.add(s);
            for (const sig of allSigs) {
                if (!bySig.has(sig)) {
                    bySig.set(sig, { soleW: 0, soleN: 0, excl: 0, wh: 0, trap: false });
                }
                const carriers = horses.filter((h) => sonSigs(h).has(sig));
                const st = bySig.get(sig);
                if (carriers.length === 1) {
                    st.soleN++;
                    if (parseInt(carriers[0].bitisSira, 10) === 1) st.soleW++;
                }
            }
            const winner = horses.find((h) => parseInt(h.bitisSira, 10) === 1);
            if (winner) {
                for (const sig of sonSigs(winner)) {
                    if (!bySig.has(sig)) bySig.set(sig, { soleW: 0, soleN: 0, excl: 0, wh: 0, trap: false });
                    const st = bySig.get(sig);
                    st.wh++;
                    const rivals = horses.filter((h) => h !== winner);
                    if (!rivals.some((r) => sonSigs(r).has(sig))) st.excl++;
                }
            }
        }
    }
    const weights = new Map();
    for (const [sig, st] of bySig) {
        const soleScore = st.soleN >= 5 ? st.soleW / st.soleN : 0.12;
        const excl = st.wh > 0 ? st.excl / st.wh : 0;
        const trap = sig === 't4' || sig === 'tmk' || (st.wh >= 25 && excl < 0.06);
        weights.set(sig, { soleScore: 0.55 * soleScore + 0.45 * excl, trap });
    }
    return weights;
}

async function main() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  Mor yanıp (TEST9) · son 2 koşu — başarı artışı analizi        ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('API:', BASE);
    console.log('Mor yanıp: at alanı test9Yanip (SON k=1–2, Mor yanıp TEST9)');
    console.log('');

    const list = await fetchJson(BASE + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = list.kayitlar || [];
    console.log('Ağırlıklar öğreniliyor…');
    const weights = await learnWeights(kayitlar);

    const all = bucket('Tüm atlar (sonuçlu)');
    const mor = bucket('Mor yanıp VAR');
    const noMor = bucket('Mor yanıp YOK');
    const morK2 = bucket('Mor yanıp + SON kırmızı 2');
    const morSole1 = bucket('Mor yanıp + ≥1 SON TEK');
    const morSole2 = bucket('Mor yanıp + ≥2 SON TEK');
    const noMorSole2 = bucket('Mor yok + ≥2 SON TEK');

    const racePickBase = bucket('Koşu: en yüksek sole puan (mevcut skor)');
    const racePickMor = bucket('Koşu: en yüksek sole puan + mor yanıp şart');
    const racePickMorBoost = bucket('Koşu: sole puan + mor yanıp bonus (+15)');

    let racesAnalyzed = 0;

    for (const k of kayitlar) {
        const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + k.id);
        if (!data.success) continue;

        for (const race of data.kosular || []) {
            const horses = (race.horses || []).filter((h) => h.bitisSira != null && h.bitisSira !== '');
            if (horses.length < MIN_RACE_FIELD) continue;
            racesAnalyzed++;

            const scored = horses.map((h) => {
                const { score, soleN } = simpleSoleScore(h, horses, weights);
                return {
                    h,
                    score,
                    soleN,
                    mor: morYanipSon2(h),
                    k2: hasKirmizi2Son(h)
                };
            });

            for (const r of scored) {
                addRow(all, r.h.bitisSira);
                const sc = soleCount(r.h, horses);
                if (r.mor) {
                    addRow(mor, r.h.bitisSira);
                    if (r.k2) addRow(morK2, r.h.bitisSira);
                    if (sc >= 1) addRow(morSole1, r.h.bitisSira);
                    if (sc >= 2) addRow(morSole2, r.h.bitisSira);
                } else {
                    addRow(noMor, r.h.bitisSira);
                    if (sc >= 2) addRow(noMorSole2, r.h.bitisSira);
                }
            }

            const byScore = [...scored].sort((a, b) => b.score - a.score);
            const top = byScore[0];
            if (top) {
                racePickBase.races++;
                if (parseInt(top.h.bitisSira, 10) === 1) racePickBase.raceWins++;
            }

            const morHorses = scored.filter((r) => r.mor);
            if (morHorses.length) {
                const topMor = [...morHorses].sort((a, b) => b.score - a.score)[0];
                racePickMor.races++;
                if (parseInt(topMor.h.bitisSira, 10) === 1) racePickMor.raceWins++;
            }

            const boosted = scored.map((r) => ({
                ...r,
                boostScore: r.score + (r.mor ? 15 : 0)
            }));
            const topBoost = [...boosted].sort((a, b) => b.boostScore - a.boostScore)[0];
            if (topBoost) {
                racePickMorBoost.races++;
                if (parseInt(topBoost.h.bitisSira, 10) === 1) racePickMorBoost.raceWins++;
            }
        }
    }

    const baseWin = all.rows ? all.wins / all.rows : 0;

    function printBucket(b, isRace) {
        const n = isRace ? b.races : b.rows;
        const w = isRace ? b.raceWins : b.wins;
        const winP = n ? w / n : 0;
        const lift = baseWin > 0 ? ((winP - baseWin) / baseWin) * 100 : 0;
        console.log(
            b.name.padEnd(42),
            'n=' + String(n).padStart(4),
            '1.=' + String(w).padStart(4),
            '→ ' + pct(w, n) + '%',
            isRace ? '' : ('  ilk3 ' + pct(b.top3, n) + '%'),
            !isRace && n >= 5 ? ('  Δtaban ' + (lift >= 0 ? '+' : '') + lift.toFixed(0) + '%') : ''
        );
    }

    console.log('Analiz koşusu:', racesAnalyzed);
    console.log('Taban birincilik (at satırı):', pct(all.wins, all.rows) + '%', '(ortalama ~' + (100 / (all.rows / racesAnalyzed)).toFixed(1) + '%/koşu)');
    console.log('');
    console.log('── At satırı (her at-koşu) ──');
    printBucket(all, false);
    printBucket(mor, false);
    printBucket(noMor, false);
    printBucket(morK2, false);
    printBucket(morSole1, false);
    printBucket(morSole2, false);
    printBucket(noMorSole2, false);
    console.log('');
    console.log('── Koşu bazlı tahmin (sole puan 1. sıra = öneri) ──');
    printBucket(racePickBase, true);
    printBucket(racePickMor, true);
    printBucket(racePickMorBoost, true);

    const morWin = mor.rows ? mor.wins / mor.rows : 0;
    const noMorWin = noMor.rows ? noMor.wins / noMor.rows : 0;
    const pp = (morWin - noMorWin) * 100;

    console.log('');
    console.log('── Özet ──');
    console.log('Mor yanıp VAR vs YOK (at satırı):',
        pct(mor.wins, mor.rows) + '% vs ' + pct(noMor.wins, noMor.rows) + '%',
        '→ fark ' + (pp >= 0 ? '+' : '') + pp.toFixed(1) + ' puan');
    if (racePickBase.races && racePickMor.races) {
        const b = racePickBase.raceWins / racePickBase.races;
        const m = racePickMor.raceWins / racePickMor.races;
        const boost = racePickMorBoost.raceWins / racePickMorBoost.races;
        console.log('Koşu başına 1. isabet — sole skor:', pct(racePickBase.raceWins, racePickBase.races) + '%',
            '(' + racePickBase.raceWins + '/' + racePickBase.races + ')');
        console.log('  … sadece mor yanıp atlardan en yüksek skor:', pct(racePickMor.raceWins, racePickMor.races) + '%',
            '(' + racePickMor.raceWins + '/' + racePickMor.races + ' koşuda mor at var)');
        console.log('  … sole skor +15 mor bonusu:', pct(racePickMorBoost.raceWins, racePickMorBoost.races) + '%',
            '(' + racePickMorBoost.raceWins + '/' + racePickMorBoost.races + ')');
        console.log('Mor şartlı seçim vs genel sole:', ((m - b) * 100).toFixed(1) + ' puan',
            '| Mor bonuslu skor vs sole:', ((boost - b) * 100).toFixed(1) + ' puan');
    }
    console.log('');
    console.log('Bitti.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
