/**
 * SON (k=1) sole + mor — kayıt degerlendirme verisiyle koşu sıralaması.
 * Tahminler sekmesi ve istemci tarafı önizleme için.
 */
(function (global) {
    const MOR_YANIP_BONUS = 15;
    const MIN_RACE_FIELD = 3;
    const LEARN_MIN_SAMPLE = 5;

    let weightsCache = null;
    let weightsPromise = null;

    function normHip(s) {
        return String(s || '')
            .toLocaleLowerCase('tr-TR')
            .normalize('NFD').replace(/\p{M}/gu, '')
            .replace(/[^a-z0-9]/g, '');
    }

    function morYanip(h) {
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
        const sigs = new Set();
        for (const y of (h.yildizlar || [])) {
            if (parseInt(y.k, 10) !== 1) continue;
            sigs.add(markerSignature(y));
        }
        return sigs;
    }

    function newStat() {
        return {
            horseRows: 0, wins: 0, winnerHad: 0, winnerExclusiveInRace: 0,
            soleCarrierRaces: 0, soleCarrierWins: 0, sharedCarrierRaces: 0
        };
    }

    function learnWeightsFromRaces(raceList) {
        const bySig = new Map();
        for (const { horses } of raceList) {
            const winner = horses.find((h) => parseInt(h.bitisSira, 10) === 1);
            if (!winner) continue;
            const rivals = horses.filter((h) => h !== winner);
            const wSon = sonMarkerSigs(winner);
            const rivalSons = rivals.map((h) => sonMarkerSigs(h));
            for (const sig of wSon) {
                if (!bySig.has(sig)) bySig.set(sig, newStat());
                const st = bySig.get(sig);
                st.winnerHad++;
                if (!rivalSons.some((r) => r.has(sig))) st.winnerExclusiveInRace++;
            }
            const allSigs = new Set();
            for (const h of horses) for (const s of sonMarkerSigs(h)) allSigs.add(s);
            for (const sig of allSigs) {
                if (!bySig.has(sig)) bySig.set(sig, newStat());
                const st = bySig.get(sig);
                const carriers = horses.filter((h) => sonMarkerSigs(h).has(sig));
                const won = carriers.some((h) => parseInt(h.bitisSira, 10) === 1);
                if (carriers.length === 1) {
                    st.soleCarrierRaces++;
                    if (won) st.soleCarrierWins++;
                } else if (carriers.length > 1) st.sharedCarrierRaces++;
            }
            for (const h of horses) {
                for (const sig of sonMarkerSigs(h)) {
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
            weights.set(sig, { soleScore: 0.55 * soleWin + 0.45 * excl, trap });
        }
        return weights;
    }

    function buildCarrierCounts(horses) {
        const carrierCount = new Map();
        for (const h of horses) {
            for (const s of sonMarkerSigs(h)) carrierCount.set(s, (carrierCount.get(s) || 0) + 1);
        }
        return carrierCount;
    }

    function scoreHorse(h, horses, weights) {
        const sigs = sonMarkerSigs(h);
        const carrierCount = buildCarrierCounts(horses);
        let score = 0;
        let soleCount = 0;
        for (const sig of sigs) {
            const n = carrierCount.get(sig) || 0;
            const w = weights.get(sig);
            if (n === 1) {
                score += (w?.soleScore ?? 0.12) * 100;
                soleCount++;
            } else if (n > 1 && w?.trap) score -= 4;
            else if (n > 1) score -= 1;
        }
        if (soleCount >= 2) score += 10;
        else if (soleCount === 1) score += 3;
        if (MOR_YANIP_BONUS > 0 && morYanip(h)) score += MOR_YANIP_BONUS;
        return { score, soleCount, mor: morYanip(h) };
    }

    function rankRace(horses, weights) {
        return horses
            .map((h) => ({ h, ...scoreHorse(h, horses, weights) }))
            .filter((r) => horses.length >= MIN_RACE_FIELD)
            .sort((a, b) => b.score - a.score || b.soleCount - a.soleCount);
    }

    async function fetchJson(url) {
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok || data.success === false) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
    }

    async function loadHistoricalRaces() {
        const list = await fetchJson('/api/public/kayit-degerlendirme/kayitlar');
        const kayitlar = list.kayitlar || [];
        const races = [];
        const concurrency = 4;
        let i = 0;
        async function worker() {
            while (i < kayitlar.length) {
                const idx = i++;
                const k = kayitlar[idx];
                try {
                    const data = await fetchJson('/api/public/kayit-degerlendirme/' + k.id);
                    if (!data.success) continue;
                    for (const race of data.kosular || []) {
                        const horses = (race.horses || []).filter((h) => h.bitisSira != null && h.bitisSira !== '');
                        if (horses.length < MIN_RACE_FIELD) continue;
                        if (!horses.some((h) => parseInt(h.bitisSira, 10) === 1)) continue;
                        races.push({ horses });
                    }
                } catch (_) { /* skip */ }
            }
        }
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        return races;
    }

    async function ensureWeights() {
        if (weightsCache) return weightsCache;
        if (weightsPromise) return weightsPromise;
        weightsPromise = (async () => {
            const races = await loadHistoricalRaces();
            weightsCache = learnWeightsFromRaces(races);
            return weightsCache;
        })();
        return weightsPromise;
    }

    /**
     * @returns {Map<string, { leader, top3, gap }>} key = normHip|raceNo
     */
    async function buildDayIndex(tarih) {
        const weights = await ensureWeights();
        const list = await fetchJson('/api/public/kayit-degerlendirme/kayitlar');
        const ids = (list.kayitlar || []).filter((k) => k.tarih === tarih).map((k) => k.id);
        const index = new Map();

        for (const id of ids) {
            const data = await fetchJson('/api/public/kayit-degerlendirme/' + id);
            if (!data.success) continue;
            const hipKey = normHip(data.hipodrom);
            for (const race of data.kosular || []) {
                const horses = race.horses || [];
                if (horses.length < MIN_RACE_FIELD) continue;
                const ranked = rankRace(horses, weights);
                if (!ranked.length) continue;
                const leader = ranked[0];
                const second = ranked[1];
                const gap = second ? leader.score - second.score : 99;
                let guven = 'ORTA';
                if (leader.score < 20) guven = 'DÜŞÜK';
                else if (gap >= 25 && leader.soleCount >= 2) guven = 'YÜKSEK';
                index.set(hipKey + '|' + String(race.raceNo), {
                    leader,
                    top3: ranked.slice(0, 3),
                    gap,
                    guven
                });
            }
        }
        return index;
    }

    global.SoleSonScoring = {
        normHip,
        ensureWeights,
        buildDayIndex,
        rankRace,
        MOR_YANIP_BONUS
    };
})(typeof window !== 'undefined' ? window : global);
