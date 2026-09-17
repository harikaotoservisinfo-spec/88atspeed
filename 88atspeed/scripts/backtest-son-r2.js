#!/usr/bin/env node
/**
 * SON sole + mor kuralı ile R2 sütunu birlikte — geçmiş isabet (walk-forward).
 *
 * R2 kaynağı:
 *   auto   — vitrin API (günün programı) varsa gerçek R2; yoksa renk-gösterge proxy sıra
 *   vitrin — sadece vitrin'den gelen R2 (eski günlerde koşu düşer)
 *   proxy  — tüm koşularda renk TEK alt skoru ile sıra (tarih bağımsız)
 *
 *   node backtest-son-r2.js
 *   R2_SOURCE=vitrin node backtest-son-r2.js
 */
const BASE = process.env.API_BASE || 'http://168.231.109.27';
const MIN_RACE_FIELD = parseInt(process.env.MIN_RACE_FIELD || '4', 10);
const LEARN_MIN_SAMPLE = parseInt(process.env.LEARN_MIN_SAMPLE || '5', 10);
const MOR_YANIP_BONUS = parseInt(process.env.MOR_YANIP_BONUS || '15', 10);
const DEDUPE = process.env.DEDUPE !== '0';
const MIN_LEARN_KAYITS = parseInt(process.env.MIN_LEARN_KAYITS || '3', 10);
const R2_SOURCE = (process.env.R2_SOURCE || 'auto').toLowerCase();

const RENK_SIG_PREFIX = /^(t12:|t9m|t5k|f8g|tkl|t46|tei:|shs:|tty|tts|tkr|tmk|s8:)/;

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
    for (const y of list) sigs.add(markerSignature(y));
    return { sigs };
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

function trToIso(tarih) {
    const p = String(tarih || '').split('/');
    if (p.length !== 3) return '';
    return p[2] + '-' + p[1] + '-' + p[0];
}

function normHip(s) {
    return String(s || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/[^a-z0-9]/g, '');
}

function raceFingerprint(horses) {
    return horses
        .map((h) => String(h.no) + ':' + String(h.name || '').trim().toUpperCase())
        .sort()
        .join('|');
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

    return { score, soleCount, mor: morYanipSon2(h), h };
}

function renkSubScore(h, horses, weights) {
    const { sigs } = sonMarkerSigs(h);
    const carrierCount = buildCarrierCounts(horses);
    let s = 0;
    for (const sig of sigs) {
        if (!RENK_SIG_PREFIX.test(sig)) continue;
        const n = carrierCount.get(sig) || 0;
        const w = weights.get(sig);
        if (n === 1) s += (w?.soleScore ?? 0.12) * 100;
        else if (n > 1 && w?.trap) s -= 4;
        else if (n > 1) s -= 1;
    }
    return s;
}

function assignProxyR2(horses, weights) {
    const scored = horses.map((h) => ({ h, raw: renkSubScore(h, horses, weights) }));
    scored.sort((a, b) => b.raw - a.raw || String(a.h.no).localeCompare(String(b.h.no)));
    const max = scored[0]?.raw || 0;
    scored.forEach((r, i) => {
        const pct = max > 0 ? Math.max(1, Math.round((r.raw / max) * 100)) : 0;
        r.h._r2 = { rank: i + 1, pct, score: r.raw, source: 'proxy' };
    });
}

function applyVitrinR2(merged) {
    let n = 0;
    for (const x of merged) {
        if (x.r2 && x.r2.rank != null && x.r2.pct > 0) {
            x.h._r2 = {
                rank: x.r2.rank,
                pct: x.r2.pct,
                score: x.r2.score,
                source: 'vitrin'
            };
            n++;
        }
    }
    return n >= Math.ceil(merged.length * 0.5);
}

function buildVitrinIndex(vitrin) {
    const byFp = new Map();
    const byHipRace = new Map();
    for (const hip of vitrin.hipodromlar || []) {
        const hn = normHip(hip.name);
        for (const race of hip.kosular || []) {
            const horses = race.horses || [];
            const fp = raceFingerprint(horses);
            const r2map = new Map();
            for (const h of horses) {
                if (h.scores?.r2) r2map.set(String(h.no), h.scores.r2);
            }
            byFp.set(fp, r2map);
            byHipRace.set(hn + '|' + race.raceNo, r2map);
        }
    }
    return { byFp, byHipRace };
}

function attachR2(horses, meta, vitrinIndex, weights) {
    const fp = raceFingerprint(horses);
    let r2map = vitrinIndex.byHipRace.get(normHip(meta.hipodrom) + '|' + meta.raceNo);
    if (!r2map || !r2map.size) r2map = vitrinIndex.byFp.get(fp);

    const merged = horses.map((h) => {
        const r2 = r2map?.get(String(h.no));
        return { h, r2 };
    });

    let vitrinOk = false;
    if (R2_SOURCE === 'vitrin' || R2_SOURCE === 'auto') {
        vitrinOk = applyVitrinR2(merged);
    }

    if (R2_SOURCE === 'proxy' || (R2_SOURCE === 'auto' && !vitrinOk) || (R2_SOURCE === 'vitrin' && !vitrinOk)) {
        if (R2_SOURCE === 'vitrin' && !vitrinOk) return { ok: false, reason: 'vitrin-yok' };
        for (const h of horses) delete h._r2;
        assignProxyR2(horses, weights);
        return { ok: true, source: 'proxy' };
    }
    return { ok: true, source: 'vitrin' };
}

function pct(a, b) {
    return b ? ((a / b) * 100).toFixed(1) : '—';
}

function newBucket(name) {
    return { name, races: 0, wins: 0, top3: 0, sumRand: 0 };
}

function addPick(b, horses, pick) {
    if (!pick?.h) return;
    b.races++;
    b.sumRand += 1 / horses.length;
    const s = parseInt(pick.h.bitisSira, 10);
    if (s === 1) b.wins++;
    if (s >= 1 && s <= 3) b.top3++;
}

function r2Of(h) {
    return h._r2 || null;
}

function rankedSole(horses, weights) {
    return horses.map((h) => scoreHorse(h, horses, weights, MOR_YANIP_BONUS))
        .sort((a, b) => b.score - a.score || b.soleCount - a.soleCount);
}

function pickR2Top(horses) {
    const list = horses.filter((h) => r2Of(h)?.rank != null);
    if (!list.length) return null;
    return list.sort((a, b) => r2Of(a).rank - r2Of(b).rank || r2Of(b).pct - r2Of(a).pct)[0];
}

function strategies(horses, weights) {
    const sole = rankedSole(horses, weights);
    const topSole = sole[0] || null;
    const r2Top = pickR2Top(horses);

    const intersect = sole
        .filter((r) => r2Of(r.h)?.rank != null && r2Of(r.h).rank <= 2 && r.soleCount >= 1);
    const intersectPick = intersect[0] || null;

    const agree = topSole && r2Top && topSole.h === r2Top ? topSole : null;

    const soleIfR2ok = topSole && r2Of(topSole.h)?.rank != null && r2Of(topSole.h).rank <= 2
        ? topSole : null;

    const combo = [...sole].map((r) => {
        const rk = r2Of(r.h)?.rank;
        let bonus = 0;
        if (rk === 1) bonus = 25;
        else if (rk === 2) bonus = 12;
        else if (rk === 3) bonus = 6;
        return { ...r, comboScore: r.score + bonus };
    }).sort((a, b) => b.comboScore - a.comboScore)[0] || null;

    const dualRank1 = sole.find((r) => r2Of(r.h)?.rank === 1) || null;

    return {
        sole_mor: topSole,
        r2_only: r2Top ? { h: r2Top, score: 0, soleCount: 0 } : null,
        agree_both_1: agree,
        sole_if_r2_top2: soleIfR2ok,
        intersect_sole_r2top2: intersectPick,
        combo_sole_r2bonus: combo,
        sole_among_r2_rank1: dualRank1,
        fallback: topSole && r2Top
            ? (r2Of(topSole.h)?.rank != null && r2Of(topSole.h).rank <= 2
                ? topSole
                : { h: r2Top, score: 0, soleCount: 0 })
            : topSole
    };
}

async function loadKayitRaces(kayitlar) {
    const races = [];
    for (const k of kayitlar) {
        const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + k.id);
        if (!data.success) continue;
        for (const race of data.kosular || []) {
            const horses = (race.horses || []).filter((h) => h.bitisSira != null && h.bitisSira !== '');
            if (horses.length < MIN_RACE_FIELD) continue;
            if (!horses.some((h) => parseInt(h.bitisSira, 10) === 1)) continue;
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

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  SON sole + mor  ×  R2 sütunu — geçmiş backtest (walk-forward)    ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('API:', BASE);
    console.log('R2_SOURCE:', R2_SOURCE, '| mor:', MOR_YANIP_BONUS, '| dedupe:', DEDUPE);
    console.log('');

    const list = await fetchJson(BASE + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = [...(list.kayitlar || [])].sort((a, b) => a.id - b.id);

    console.log('Kayıtlar yükleniyor…');
    let allRaces = await loadKayitRaces(kayitlar);
    const rawN = allRaces.length;
    if (DEDUPE) allRaces = dedupeRaces(allRaces);

    const vitrinCache = new Map();
    async function getVitrinIndex(iso) {
        if (!iso) return { byFp: new Map(), byHipRace: new Map() };
        if (vitrinCache.has(iso)) return vitrinCache.get(iso);
        let idx = { byFp: new Map(), byHipRace: new Map() };
        try {
            const v = await fetchJson(BASE + '/api/public/vitrin?iso=' + encodeURIComponent(iso));
            if (v.hipodromlar?.length) idx = buildVitrinIndex(v);
        } catch (_) { /* */ }
        vitrinCache.set(iso, idx);
        return idx;
    }

    const stratNames = [
        'sole_mor',
        'r2_only',
        'agree_both_1',
        'sole_if_r2_top2',
        'intersect_sole_r2top2',
        'combo_sole_r2bonus',
        'sole_among_r2_rank1',
        'fallback'
    ];
    const buckets = new Map(stratNames.map((n) => [n, newBucket(n)]));
    const bucketsVitrinOnly = new Map(stratNames.map((n) => [n, newBucket(n + ' (vitrin R2)')]));

    let r2Ok = 0;
    let r2VitrinRaces = 0;
    let wfRaces = 0;
    let wfSkipped = 0;

    const kayitIds = kayitlar.map((k) => k.id);
    const byKayit = new Map();
    for (const r of allRaces) {
        if (!byKayit.has(r.kayitId)) byKayit.set(r.kayitId, []);
        byKayit.get(r.kayitId).push(r);
    }

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
            const horses = race.horses.map((h) => ({ ...h }));
            const iso = trToIso(race.tarih);
            const vIdx = await getVitrinIndex(iso);
            const r2meta = attachR2(horses, race, vIdx, weights);
            if (!r2meta.ok) continue;
            r2Ok++;
            if (r2meta.source === 'vitrin') r2VitrinRaces++;

            const picks = strategies(horses, weights);
            wfRaces++;
            for (const name of stratNames) {
                addPick(buckets.get(name), horses, picks[name]);
                if (r2meta.source === 'vitrin') {
                    addPick(bucketsVitrinOnly.get(name), horses, picks[name]);
                }
            }
        }
    }

    function report(title, bucketMap) {
        console.log('── ' + title + ' ──');
        for (const name of stratNames) {
            const b = bucketMap.get(name);
            if (!b.races) continue;
            const winPct = (b.wins / b.races) * 100;
            const randPct = (b.sumRand / b.races) * 100;
            console.log(
                b.name.padEnd(36),
                b.wins + '/' + b.races,
                '→ 1.=' + pct(b.wins, b.races) + '%',
                'ilk3=' + pct(b.top3, b.races) + '%',
                'Δ+' + (winPct - randPct).toFixed(1) + 'pp'
            );
        }
        console.log('');
    }

    console.log('Sonuçlu koşu (ham):', rawN, DEDUPE ? ('| tekil ' + allRaces.length) : '');
    console.log('Walk-forward test koşusu:', wfRaces, '(atlanan:', wfSkipped + ')');
    console.log('R2 atanabilen:', r2Ok, '| gerçek vitrin R2:', r2VitrinRaces);
    if (R2_SOURCE === 'auto' && r2VitrinRaces < r2Ok) {
        console.log('Not: Eski tarihlerde vitrin önbelleği yok → proxy renk TEK sırası kullanıldı.');
        console.log('     Tam R2 için gün içi vitrin + kayıt bitişi birlikte birikince vitrin satırına bakın.');
    }
    console.log('');

    report('Walk-forward stratejiler', buckets);
    if (r2VitrinRaces > 0) {
        report('Sadece vitrin R2 olan koşular', bucketsVitrinOnly);
    }

    const base = buckets.get('sole_mor');
    const best = stratNames
        .map((n) => ({ n, b: buckets.get(n) }))
        .filter((x) => x.b.races >= 20)
        .sort((a, b) => (b.b.wins / b.b.races) - (a.b.wins / a.b.races))[0];
    if (base?.races && best) {
        const bw = base.wins / base.races;
        const hw = best.b.wins / best.b.races;
        console.log('Özet: sole+mor taban', pct(base.wins, base.races) + '%',
            '| en iyi (n≥20):', best.n, pct(best.b.wins, best.b.races) + '%',
            '(' + ((hw - bw) * 100).toFixed(1) + ' puan)');
    }
    console.log('');
    console.log('Bitti.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
