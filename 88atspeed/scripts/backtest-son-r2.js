#!/usr/bin/env node
/**
 * SON sole + mor × R2 × TAHMİN — geçmiş isabet (walk-forward).
 *
 * R2 / TAHMİN kaynağı (vitrin scores.r2 / scores.tahmin):
 *   auto   — vitrin varsa gerçek sütun; yoksa proxy (R2=renk TEK, TAHMİN=sole+mor sıra)
 *   vitrin — sadece vitrin
 *   proxy  — proxy sıra
 *
 *   node backtest-son-r2.js
 *   TAHMIN_SOURCE=vitrin node backtest-son-r2.js
 */
const BASE = process.env.API_BASE || 'http://168.231.109.27';
const MIN_RACE_FIELD = parseInt(process.env.MIN_RACE_FIELD || '4', 10);
const LEARN_MIN_SAMPLE = parseInt(process.env.LEARN_MIN_SAMPLE || '5', 10);
const MOR_YANIP_BONUS = parseInt(process.env.MOR_YANIP_BONUS || '15', 10);
const KIRMIZI8_BONUS = parseInt(process.env.KIRMIZI8_BONUS || '12', 10);
const DEDUPE = process.env.DEDUPE !== '0';
const MIN_LEARN_KAYITS = parseInt(process.env.MIN_LEARN_KAYITS || '3', 10);
const R2_SOURCE = (process.env.R2_SOURCE || 'auto').toLowerCase();
const TAHMIN_SOURCE = (process.env.TAHMIN_SOURCE || process.env.R2_SOURCE || 'auto').toLowerCase();

const RENK_SIG_PREFIX = /^(t12:|t9m|t5k|f8g|tkl|t46|tei:|shs:|tty|tts|tkr|tmk|s8:)/;

function morYanipSon2(h) {
    return !!h.test9Yanip;
}

function kirmizi8Son2(h) {
    return (h.yildizlar || []).some((y) => {
        const k = parseInt(y.k, 10);
        return k >= 1 && k <= 2 && y.s8 && parseInt(y.s8r, 10) === 3;
    });
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
    if (KIRMIZI8_BONUS > 0 && kirmizi8Son2(h)) score += KIRMIZI8_BONUS;

    return { score, soleCount, mor: morYanipSon2(h), k8: kirmizi8Son2(h), h };
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

function applyVitrinField(merged, field, hostKey) {
    let n = 0;
    for (const x of merged) {
        const t = x[field];
        if (t && t.rank != null && t.pct > 0) {
            x.h[hostKey] = {
                rank: t.rank,
                pct: t.pct,
                score: t.score,
                source: 'vitrin'
            };
            n++;
        }
    }
    return n >= Math.ceil(merged.length * 0.5);
}

function assignProxyTahmin(horses, weights) {
    const scored = horses.map((h) => ({
        h,
        raw: scoreHorse(h, horses, weights, MOR_YANIP_BONUS).score
    }));
    scored.sort((a, b) => b.raw - a.raw || String(a.h.no).localeCompare(String(b.h.no)));
    const max = scored[0]?.raw || 0;
    scored.forEach((r, i) => {
        const pct = max > 0 ? Math.max(1, Math.round((r.raw / max) * 100)) : 0;
        r.h._tahmin = { rank: i + 1, pct, score: r.raw, source: 'proxy' };
    });
}

function attachColumn(horses, merged, sourceMode, field, hostKey, proxyFn, weights) {
    for (const h of horses) delete h[hostKey];
    let vitrinOk = false;
    if (sourceMode === 'vitrin' || sourceMode === 'auto') {
        vitrinOk = applyVitrinField(merged, field, hostKey);
    }
    if (sourceMode === 'proxy' || (sourceMode === 'auto' && !vitrinOk) || (sourceMode === 'vitrin' && !vitrinOk)) {
        if (sourceMode === 'vitrin' && !vitrinOk) return { ok: false, source: null };
        proxyFn(horses, weights);
        return { ok: true, source: 'proxy' };
    }
    return { ok: true, source: 'vitrin' };
}

function buildVitrinIndex(vitrin) {
    const byFp = new Map();
    const byHipRace = new Map();
    for (const hip of vitrin.hipodromlar || []) {
        const hn = normHip(hip.name);
        for (const race of hip.kosular || []) {
            const horses = race.horses || [];
            const fp = raceFingerprint(horses);
            const scoreMap = new Map();
            for (const h of horses) {
                const sc = h.scores || {};
                if (sc.r2 || sc.tahmin) {
                    scoreMap.set(String(h.no), { r2: sc.r2, tahmin: sc.tahmin });
                }
            }
            byFp.set(fp, scoreMap);
            byHipRace.set(hn + '|' + race.raceNo, scoreMap);
        }
    }
    return { byFp, byHipRace };
}

function attachRaceScores(horses, meta, vitrinIndex, weights) {
    let smap = vitrinIndex.byHipRace.get(normHip(meta.hipodrom) + '|' + meta.raceNo);
    if (!smap || !smap.size) smap = vitrinIndex.byFp.get(raceFingerprint(horses));

    const merged = horses.map((h) => {
        const row = smap?.get(String(h.no)) || {};
        return { h, r2: row.r2, tahmin: row.tahmin };
    });

    const r2meta = attachColumn(horses, merged, R2_SOURCE, 'r2', '_r2', assignProxyR2, weights);
    const tahmeta = attachColumn(horses, merged, TAHMIN_SOURCE, 'tahmin', '_tahmin', assignProxyTahmin, weights);

    if (R2_SOURCE === 'vitrin' && !r2meta.ok) return { ok: false };
    if (TAHMIN_SOURCE === 'vitrin' && !tahmeta.ok) return { ok: false };
    if (!r2meta.ok && !tahmeta.ok) return { ok: false };

    return {
        ok: true,
        r2Source: r2meta.source,
        tahminSource: tahmeta.source
    };
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

function tahminOf(h) {
    return h._tahmin || null;
}

function pickByRank(horses, getter) {
    const list = horses.filter((h) => getter(h)?.rank != null);
    if (!list.length) return null;
    return list.sort((a, b) => getter(a).rank - getter(b).rank || getter(b).pct - getter(a).pct)[0];
}

function rankedSole(horses, weights) {
    return horses.map((h) => scoreHorse(h, horses, weights, MOR_YANIP_BONUS))
        .sort((a, b) => b.score - a.score || b.soleCount - a.soleCount);
}

function strategies(horses, weights) {
    const sole = rankedSole(horses, weights);
    const topSole = sole[0] || null;
    const r2Top = pickByRank(horses, r2Of);
    const tahTop = pickByRank(horses, tahminOf);

    const wrap = (h) => (h ? { h, score: 0, soleCount: 0 } : null);

    const intersectR2 = sole
        .filter((r) => r2Of(r.h)?.rank != null && r2Of(r.h).rank <= 2 && r.soleCount >= 1)[0] || null;

    const intersectTah = sole
        .filter((r) => tahminOf(r.h)?.rank != null && tahminOf(r.h).rank <= 2 && r.soleCount >= 1)[0] || null;

    const intersectBoth = sole.filter((r) => {
        const r2 = r2Of(r.h);
        const th = tahminOf(r.h);
        return r.soleCount >= 1 && r2?.rank <= 2 && th?.rank <= 2;
    })[0] || null;

    const agreeR2 = topSole && r2Top && topSole.h === r2Top ? topSole : null;
    const agreeTah = topSole && tahTop && topSole.h === tahTop ? topSole : null;
    const agreeAll = topSole && r2Top && tahTop
        && topSole.h === r2Top && topSole.h === tahTop ? topSole : null;

    const soleIfR2ok = topSole && r2Of(topSole.h)?.rank != null && r2Of(topSole.h).rank <= 2
        ? topSole : null;
    const soleIfTahok = topSole && tahminOf(topSole.h)?.rank != null && tahminOf(topSole.h).rank <= 2
        ? topSole : null;

    const comboR2 = [...sole].map((r) => {
        const rk = r2Of(r.h)?.rank;
        let bonus = 0;
        if (rk === 1) bonus = 25;
        else if (rk === 2) bonus = 12;
        else if (rk === 3) bonus = 6;
        return { ...r, comboScore: r.score + bonus };
    }).sort((a, b) => b.comboScore - a.comboScore)[0] || null;

    const comboTah = [...sole].map((r) => {
        const rk = tahminOf(r.h)?.rank;
        let bonus = 0;
        if (rk === 1) bonus = 30;
        else if (rk === 2) bonus = 15;
        else if (rk === 3) bonus = 8;
        return { ...r, comboScore: r.score + bonus };
    }).sort((a, b) => b.comboScore - a.comboScore)[0] || null;

    const k8Horses = horses.filter((h) => kirmizi8Son2(h));
    const k8Pick = k8Horses.length
        ? rankedSole(k8Horses, weights)[0] || { h: k8Horses[0], score: 0, soleCount: 0 }
        : null;

    const intersectK8 = sole.filter((r) => r.soleCount >= 1 && r.k8)[0] || null;
    const intersectR2K8 = sole.filter((r) =>
        r.soleCount >= 1 && r.k8 && r2Of(r.h)?.rank != null && r2Of(r.h).rank <= 2)[0] || null;

    const agreeK8 = topSole && topSole.k8 ? topSole : null;

    return {
        sole_mor: topSole,
        k8_only_son2: k8Pick ? { h: k8Pick.h, score: k8Pick.score, soleCount: k8Pick.soleCount } : null,
        agree_sole_k8: agreeK8,
        sole_if_k8: topSole && topSole.k8 ? topSole : null,
        intersect_sole_k8: intersectK8,
        intersect_sole_r2_k8: intersectR2K8,
        r2_only: wrap(r2Top),
        tahmin_only: wrap(tahTop),
        agree_sole_r2_1: agreeR2,
        agree_sole_tahmin_1: agreeTah,
        agree_sole_r2_tahmin_1: agreeAll,
        sole_if_r2_top2: soleIfR2ok,
        sole_if_tahmin_top2: soleIfTahok,
        intersect_sole_r2top2: intersectR2,
        intersect_sole_tahmin_top2: intersectTah,
        intersect_sole_r2_tahmin_top2: intersectBoth,
        combo_sole_r2bonus: comboR2,
        combo_sole_tahmin_bonus: comboTah,
        fallback_r2: topSole && r2Top
            ? (r2Of(topSole.h)?.rank != null && r2Of(topSole.h).rank <= 2
                ? topSole : wrap(r2Top))
            : topSole,
        fallback_tahmin: topSole && tahTop
            ? (tahminOf(topSole.h)?.rank != null && tahminOf(topSole.h).rank <= 2
                ? topSole : wrap(tahTop))
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

const STRAT_GROUPS = [
    {
        title: 'Taban (sole+mor+kırmızı8 bonus)',
        names: ['sole_mor']
    },
    {
        title: 'Kırmızı 8 (son 2 koşu s8r=3)',
        names: [
            'k8_only_son2', 'agree_sole_k8', 'sole_if_k8', 'intersect_sole_k8',
            'intersect_sole_r2_k8'
        ]
    },
    {
        title: 'R2 sütunu',
        names: [
            'r2_only', 'agree_sole_r2_1', 'sole_if_r2_top2', 'intersect_sole_r2top2',
            'combo_sole_r2bonus', 'fallback_r2'
        ]
    },
    {
        title: 'TAHMİN sütunu',
        names: [
            'tahmin_only', 'agree_sole_tahmin_1', 'sole_if_tahmin_top2', 'intersect_sole_tahmin_top2',
            'combo_sole_tahmin_bonus', 'fallback_tahmin'
        ]
    },
    {
        title: 'R2 + TAHMİN birlikte',
        names: ['agree_sole_r2_tahmin_1', 'intersect_sole_r2_tahmin_top2']
    }
];

const ALL_STRAT_NAMES = STRAT_GROUPS.flatMap((g) => g.names);

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  SON sole + mor  ×  R2  ×  TAHMİN — walk-forward backtest         ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('API:', BASE);
    console.log('R2_SOURCE:', R2_SOURCE, '| TAHMIN_SOURCE:', TAHMIN_SOURCE,
        '| mor:', MOR_YANIP_BONUS, '| k8:', KIRMIZI8_BONUS, '| dedupe:', DEDUPE);
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

    const buckets = new Map(ALL_STRAT_NAMES.map((n) => [n, newBucket(n)]));
    const bucketsVitrinScores = new Map(ALL_STRAT_NAMES.map((n) => [n, newBucket(n)]));

    let scoredRaces = 0;
    let r2VitrinRaces = 0;
    let tahminVitrinRaces = 0;
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
            const scoremeta = attachRaceScores(horses, race, vIdx, weights);
            if (!scoremeta.ok) continue;
            scoredRaces++;
            if (scoremeta.r2Source === 'vitrin') r2VitrinRaces++;
            if (scoremeta.tahminSource === 'vitrin') tahminVitrinRaces++;

            const picks = strategies(horses, weights);
            wfRaces++;
            const vitrinRace = scoremeta.r2Source === 'vitrin' && scoremeta.tahminSource === 'vitrin';
            for (const name of ALL_STRAT_NAMES) {
                addPick(buckets.get(name), horses, picks[name]);
                if (vitrinRace) addPick(bucketsVitrinScores.get(name), horses, picks[name]);
            }
        }
    }

    function reportGroup(title, names, bucketMap) {
        console.log('── ' + title + ' ──');
        let any = false;
        for (const name of names) {
            const b = bucketMap.get(name);
            if (!b?.races) continue;
            any = true;
            const winPct = (b.wins / b.races) * 100;
            const randPct = (b.sumRand / b.races) * 100;
            console.log(
                b.name.padEnd(38),
                b.wins + '/' + b.races,
                '→ 1.=' + pct(b.wins, b.races) + '%',
                'ilk3=' + pct(b.top3, b.races) + '%',
                'Δ+' + (winPct - randPct).toFixed(1) + 'pp'
            );
        }
        if (!any) console.log('  (veri yok)');
        console.log('');
    }

    console.log('Sonuçlu koşu (ham):', rawN, DEDUPE ? ('| tekil ' + allRaces.length) : '');
    console.log('Walk-forward test koşusu:', wfRaces, '(atlanan:', wfSkipped + ')');
    console.log('Skorlu koşu:', scoredRaces,
        '| vitrin R2:', r2VitrinRaces, '| vitrin TAHMİN:', tahminVitrinRaces);
    if (r2VitrinRaces < scoredRaces || tahminVitrinRaces < scoredRaces) {
        console.log('Not: Eski tarihlerde vitrin yok → R2=renk TEK proxy, TAHMİN=sole+mor sıra proxy.');
        console.log('     Gerçek sütunlar: koşu bitti + kayıt bitişi + aynı gün vitrin → R2_SOURCE=vitrin');
    }
    console.log('');

    for (const g of STRAT_GROUPS) {
        reportGroup(g.title, g.names, buckets);
    }

    if (r2VitrinRaces > 0 && tahminVitrinRaces > 0) {
        console.log('── Sadece vitrin R2+TAHMİN (aynı koşu) ──');
        for (const g of STRAT_GROUPS) {
            reportGroup(g.title + ' [vitrin]', g.names, bucketsVitrinScores);
        }
    }

    const base = buckets.get('sole_mor');
    const best = ALL_STRAT_NAMES
        .filter((n) => n !== 'sole_mor')
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
