#!/usr/bin/env node
/**
 * score-today-son.js stratejisinin geçmiş başarısı (walk-forward + mor bonus karşılaştırma).
 *
 *   node backtest-score-today-son.js
 *   MOR_YANIP_BONUS=0 node backtest-score-today-son.js
 */
const BASE = process.env.API_BASE || 'http://168.231.109.27';
const MIN_RACE_FIELD = parseInt(process.env.MIN_RACE_FIELD || '4', 10);
const LEARN_MIN_SAMPLE = parseInt(process.env.LEARN_MIN_SAMPLE || '5', 10);
const MOR_YANIP_BONUS = parseInt(process.env.MOR_YANIP_BONUS || '15', 10);
const DEDUPE = process.env.DEDUPE !== '0';
const MIN_LEARN_KAYITS = parseInt(process.env.MIN_LEARN_KAYITS || '3', 10);

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

function learnWeightsFromRaces(raceList) {
    const bySig = new Map();
    for (const { horses } of raceList) {
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
        weights.set(sig, {
            soleScore: 0.55 * soleWin + 0.45 * excl,
            trap
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

function scoreHorse(h, horses, weights, morBonus) {
    const { sigs } = sonMarkerSigs(h);
    const carrierCount = buildCarrierCounts(horses);
    let score = 0;
    let soleCount = 0;

    for (const sig of sigs) {
        const n = carrierCount.get(sig) || 0;
        const w = weights.get(sig);
        if (n === 1) {
            score += (w?.soleScore ?? 0.12) * 100;
            soleCount++;
        } else if (n > 1 && w?.trap) {
            score -= 4;
        } else if (n > 1) {
            score -= 1;
        }
    }
    if (soleCount >= 2) score += 10;
    else if (soleCount === 1) score += 3;
    if (morBonus > 0 && morYanipSon2(h)) score += morBonus;

    return { score, soleCount, mor: morYanipSon2(h) };
}

function raceFingerprint(horses) {
    return horses
        .map((h) => String(h.no) + ':' + String(h.name || '').trim().toUpperCase())
        .sort()
        .join('|');
}

function pct(a, b) {
    return b ? ((a / b) * 100).toFixed(1) : '—';
}

function newMetrics() {
    return {
        races: 0,
        wins: 0,
        top3: 0,
        sumField: 0,
        sumRandom: 0,
        gap10: { races: 0, wins: 0 },
        gap25: { races: 0, wins: 0 },
        sole2: { races: 0, wins: 0 },
        lowScore: { races: 0, wins: 0 }
    };
}

function addPick(m, horses, pick) {
    if (!pick) return;
    m.races++;
    const n = horses.length;
    m.sumField += n;
    m.sumRandom += 1 / n;
    const s = parseInt(pick.h.bitisSira, 10);
    if (s === 1) m.wins++;
    if (s >= 1 && s <= 3) m.top3++;
}

async function loadAllRaces(kayitlar) {
    const races = [];
    for (const k of kayitlar) {
        const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + k.id);
        if (!data.success) continue;
        for (const race of data.kosular || []) {
            const horses = (race.horses || []).filter((h) => h.bitisSira != null && h.bitisSira !== '');
            if (horses.length < MIN_RACE_FIELD) continue;
            races.push({
                kayitId: k.id,
                tarih: k.tarih || data.tarih,
                hipodrom: data.hipodrom,
                raceNo: race.raceNo,
                horses,
                fp: raceFingerprint(horses)
            });
        }
    }
    return races;
}

function dedupeRaces(races) {
    const seen = new Set();
    const out = [];
    for (const r of races) {
        const key = (r.tarih || '') + '#' + r.fp;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
    }
    return out;
}

function pickTop(horses, weights, morBonus) {
    const ranked = horses.map((h) => {
        const s = scoreHorse(h, horses, weights, morBonus);
        return { h, ...s };
    }).sort((a, b) => b.score - a.score || b.soleCount - a.soleCount);
    const top = ranked[0];
    const second = ranked[1];
    const gap = top && second ? top.score - second.score : 0;
    return { top, gap, ranked };
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  score-today-son · geçmiş backtest (walk-forward kayıt kayıt)     ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('API:', BASE);
    console.log('MIN_RACE_FIELD:', MIN_RACE_FIELD, '| mor bonus:', MOR_YANIP_BONUS, '| dedupe:', DEDUPE);
    console.log('');

    const list = await fetchJson(BASE + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = [...(list.kayitlar || [])].sort((a, b) => a.id - b.id);

    console.log('Kayıtlar yükleniyor…');
    let allRaces = await loadAllRaces(kayitlar);
    const rawCount = allRaces.length;
    if (DEDUPE) allRaces = dedupeRaces(allRaces);

    const byKayit = new Map();
    for (const r of allRaces) {
        if (!byKayit.has(r.kayitId)) byKayit.set(r.kayitId, []);
        byKayit.get(r.kayitId).push(r);
    }

    const wfMor = newMetrics();
    const wfNoMor = newMetrics();
    const inSampleMor = newMetrics();
    const inSampleNoMor = newMetrics();

    const kayitIds = kayitlar.map((k) => k.id);
    let wfSkipped = 0;

    for (let i = 0; i < kayitIds.length; i++) {
        const kid = kayitIds[i];
        const trainIds = kayitIds.slice(0, i);
        const testRaces = byKayit.get(kid) || [];
        if (!testRaces.length) continue;

        if (trainIds.length < MIN_LEARN_KAYITS) {
            wfSkipped += testRaces.length;
            continue;
        }

        const trainRaces = allRaces.filter((r) => trainIds.includes(r.kayitId));
        const weights = learnWeightsFromRaces(trainRaces);

        for (const race of testRaces) {
            const { horses } = race;
            const pMor = pickTop(horses, weights, MOR_YANIP_BONUS);
            const pNo = pickTop(horses, weights, 0);
            addPick(wfMor, horses, pMor.top);
            addPick(wfNoMor, horses, pNo.top);

            if (pMor.gap >= 10) {
                wfMor.gap10.races++;
                if (parseInt(pMor.top.h.bitisSira, 10) === 1) wfMor.gap10.wins++;
            }
            if (pMor.gap >= 25) {
                wfMor.gap25.races++;
                if (parseInt(pMor.top.h.bitisSira, 10) === 1) wfMor.gap25.wins++;
            }
            if (pMor.top.soleCount >= 2) {
                wfMor.sole2.races++;
                if (parseInt(pMor.top.h.bitisSira, 10) === 1) wfMor.sole2.wins++;
            }
            if (pMor.top.score < 20) {
                wfMor.lowScore.races++;
                if (parseInt(pMor.top.h.bitisSira, 10) === 1) wfMor.lowScore.wins++;
            }
        }
    }

    const allWeights = learnWeightsFromRaces(allRaces);
    for (const race of allRaces) {
        const { horses } = race;
        addPick(inSampleMor, horses, pickTop(horses, allWeights, MOR_YANIP_BONUS).top);
        addPick(inSampleNoMor, horses, pickTop(horses, allWeights, 0).top);
    }

    function report(label, m) {
        if (!m.races) {
            console.log(label + ': veri yok');
            return;
        }
        const randomPct = (m.sumRandom / m.races) * 100;
        const winPct = (m.wins / m.races) * 100;
        const lift = winPct - randomPct;
        console.log(
            label.padEnd(44),
            m.wins + '/' + m.races,
            '→ 1.=' + pct(m.wins, m.races) + '%',
            'ilk3=' + pct(m.top3, m.races) + '%',
            'rastgele≈' + randomPct.toFixed(1) + '%',
            'Δ+' + lift.toFixed(1) + 'pp'
        );
    }

    console.log('Koşu sayısı: ham', rawCount, DEDUPE ? ('| tekil (aynı gün aynı at listesi) ' + allRaces.length) : '');
    console.log('Walk-forward: ilk', MIN_LEARN_KAYITS, 'kayıt eğitim için atlandı; atlanan koşu:', wfSkipped);
    console.log('');
    console.log('── Walk-forward (gelecek kayıt için sadece önceki kayıtlardan öğren) ──');
    report('Skor + mor bonus (' + MOR_YANIP_BONUS + ')', wfMor);
    report('Skor mor bonus yok (0)', wfNoMor);
    console.log('');
    console.log('── Aynı veriyle öğren + test (iyimser; canlı skorlamaya yakın) ──');
    report('In-sample + mor', inSampleMor);
    report('In-sample mor yok', inSampleNoMor);
    console.log('');
    console.log('── Güven filtreleri (walk-forward, mor bonuslu pick) ──');
    if (wfMor.gap10.races) {
        console.log('  1.–2. puan farkı ≥10:', wfMor.gap10.wins + '/' + wfMor.gap10.races, '→', pct(wfMor.gap10.wins, wfMor.gap10.races) + '%');
    }
    if (wfMor.gap25.races) {
        console.log('  1.–2. puan farkı ≥25:', wfMor.gap25.wins + '/' + wfMor.gap25.races, '→', pct(wfMor.gap25.wins, wfMor.gap25.races) + '%');
    }
    if (wfMor.sole2.races) {
        console.log('  Önerilen at ≥2 TEK:', wfMor.sole2.wins + '/' + wfMor.sole2.races, '→', pct(wfMor.sole2.wins, wfMor.sole2.races) + '%');
    }
    if (wfMor.lowScore.races) {
        console.log('  Önerilen puan <20 (zayıf):', wfMor.lowScore.wins + '/' + wfMor.lowScore.races, '→', pct(wfMor.lowScore.wins, wfMor.lowScore.races) + '%');
    }
    console.log('');
    console.log('Bitti.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
