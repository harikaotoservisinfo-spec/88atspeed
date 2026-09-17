#!/usr/bin/env node
/**
 * Kayıt Test — koşu bazlı SON (k=1) işaret analizi: 1. ile rakipler.
 * Amaç: hangi SON sinyalleri 1.'de sık / rakipte yokken kazanma artıyor?
 *
 *   node analyze-winner-son-competition.js
 *   API_BASE=http://127.0.0.1:3023 MIN_RACE_FIELD=5 node ...
 */
const BASE = process.env.API_BASE || 'http://168.231.109.27';
const MIN_RACE_FIELD = parseInt(process.env.MIN_RACE_FIELD || '4', 10);
const MIN_SAMPLE = parseInt(process.env.MIN_SAMPLE || '5', 10);
const TOP_N = parseInt(process.env.TOP_N || '25', 10);

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
    if (sig.startsWith('s8:')) return 'SON8001 8 (' + sig + ')';
    if (sig.includes('|')) {
        const ad = sig.split('|')[0];
        return ad.length > 34 ? ad.slice(0, 34) + '…' : ad;
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
    return { sigs, bySig, count: list.length };
}

function pct(a, b) {
    return b ? ((a / b) * 100).toFixed(1) : '—';
}

function newStat() {
    return {
        horseRows: 0,
        wins: 0,
        top3: 0,
        winnerHad: 0,
        rivalHadWhenWinner: 0,
        soleCarrierWins: 0,
        soleCarrierRaces: 0,
        sharedCarrierWins: 0,
        sharedCarrierRaces: 0,
        winnerExclusiveInRace: 0,
        winnerRaces: 0
    };
}

function addHorseRow(st, bitis) {
    st.horseRows++;
    const s = parseInt(bitis, 10);
    if (s === 1) st.wins++;
    if (s >= 1 && s <= 3) st.top3++;
}

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.json();
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  Kayıt Test · Koşu bazlı SON (k=1) — 1. vs rakip işaretleri   ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('API:', BASE);
    console.log('Min alan:', MIN_RACE_FIELD, 'at | min örnek:', MIN_SAMPLE);
    console.log('');

    const list = await fetchJson(BASE + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = list.kayitlar || [];

    /** @type {Map<string, ReturnType<newStat>>} */
    const bySig = new Map();
    const sampleY = new Map();

    let racesTotal = 0;
    let racesWithWinner = 0;
    let racesAnalyzed = 0;

    /** Kazananın SON'da en az bir işareti var, rakiplerde yok (o işaret için) — koşu sayısı */
    let racesWinnerAnyExclusiveSon = 0;

    /** Kazanan ortalama SON işaret sayısı vs rakipler */
    let sumWinSonCount = 0;
    let sumRivalSonCount = 0;
    let rivalCount = 0;

    for (const k of kayitlar) {
        const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + k.id);
        if (!data.success) continue;

        for (const race of data.kosular || []) {
            racesTotal++;
            const horses = (race.horses || []).filter((h) => h.bitisSira != null && h.bitisSira !== '');
            if (horses.length < MIN_RACE_FIELD) continue;

            const winner = horses.find((h) => parseInt(h.bitisSira, 10) === 1);
            if (!winner) continue;
            racesWithWinner++;

            const rivals = horses.filter((h) => h !== winner);
            const wSon = sonMarkerSigs(winner);
            const rivalSons = rivals.map((h) => sonMarkerSigs(h));

            racesAnalyzed++;
            sumWinSonCount += wSon.count;
            for (const r of rivalSons) {
                sumRivalSonCount += r.count;
                rivalCount++;
            }

            const allSigsInRace = new Set();
            for (const s of wSon.sigs) allSigsInRace.add(s);
            for (const r of rivalSons) for (const s of r.sigs) allSigsInRace.add(s);

            let winnerHasExclusive = false;
            for (const sig of wSon.sigs) {
                const rivalsWith = rivalSons.filter((r) => r.sigs.has(sig)).length;
                if (rivalsWith === 0) winnerHasExclusive = true;

                if (!bySig.has(sig)) bySig.set(sig, newStat());
                const st = bySig.get(sig);
                if (!sampleY.has(sig)) sampleY.set(sig, wSon.bySig.get(sig));

                st.winnerRaces++;
                st.winnerHad++;
                if (rivalsWith > 0) st.rivalHadWhenWinner += rivalsWith;

                if (rivalsWith === 0) st.winnerExclusiveInRace++;
            }
            if (winnerHasExclusive) racesWinnerAnyExclusiveSon++;

            for (const sig of allSigsInRace) {
                if (!bySig.has(sig)) bySig.set(sig, newStat());
                const st = bySig.get(sig);
                const carriers = horses.filter((h) => sonMarkerSigs(h).sigs.has(sig));
                const carrierWon = carriers.some((h) => parseInt(h.bitisSira, 10) === 1);
                if (carriers.length === 1) {
                    st.soleCarrierRaces++;
                    if (carrierWon) st.soleCarrierWins++;
                } else if (carriers.length > 1) {
                    st.sharedCarrierRaces++;
                    if (carrierWon) st.sharedCarrierWins++;
                }
            }

            for (const h of horses) {
                const { sigs, bySig: local } = sonMarkerSigs(h);
                for (const sig of sigs) {
                    if (!bySig.has(sig)) bySig.set(sig, newStat());
                    const st = bySig.get(sig);
                    addHorseRow(st, h.bitisSira);
                    if (!sampleY.has(sig)) sampleY.set(sig, local.get(sig));
                }
            }
        }
    }

    const avgWinSon = racesAnalyzed ? (sumWinSonCount / racesAnalyzed).toFixed(2) : '—';
    const avgRivalSon = rivalCount ? (sumRivalSonCount / rivalCount).toFixed(2) : '—';

    console.log('── Koşu özeti ──');
    console.log('Toplam koşu (kayıt):', racesTotal);
    console.log('Bitiş bilinen ≥' + MIN_RACE_FIELD + ' at:', racesWithWinner, '(1. belli)');
    console.log('Analize giren:', racesAnalyzed);
    console.log('Kazanan ort. SON işaret adedi:', avgWinSon, '| rakip ort.:', avgRivalSon);
    console.log(
        'Kazananın SON\'da rakiplerde olmayan en az 1 işareti olan koşu:',
        racesWinnerAnyExclusiveSon,
        '→',
        pct(racesWinnerAnyExclusiveSon, racesAnalyzed) + '%'
    );
    console.log('');

    const rows = [...bySig.entries()]
        .map(([sig, st]) => ({
            sig,
            label: markerLabel(sig, sampleY.get(sig)),
            ...st,
            winPct: st.horseRows ? st.wins / st.horseRows : 0,
            top3Pct: st.horseRows ? st.top3 / st.horseRows : 0,
            soleWinPct: st.soleCarrierRaces ? st.soleCarrierWins / st.soleCarrierRaces : 0,
            sharedWinPct: st.sharedCarrierRaces ? st.sharedCarrierWins / st.sharedCarrierRaces : 0,
            winnerSharePct: st.winnerRaces ? st.winnerHad / st.winnerRaces : 0,
            exclusivePct: st.winnerHad ? st.winnerExclusiveInRace / st.winnerHad : 0
        }))
        .filter((r) => r.horseRows >= MIN_SAMPLE);

    console.log('══ A) SON işareti taşıyan at — genel kazanma (tüm koşular) ══');
    console.log(' Kazan%  İlk3%   n   işaret');
    const byWin = [...rows].sort((a, b) => b.winPct - a.winPct || b.wins - a.wins);
    for (const r of byWin.slice(0, TOP_N)) {
        console.log(
            (pct(r.wins, r.horseRows) + '%').padStart(7),
            (pct(r.top3, r.horseRows) + '%').padStart(7),
            String(r.horseRows).padStart(4),
            ' ',
            r.label
        );
    }
    console.log('');

    console.log('══ B) 1. olan atlarda SON\'da en sık görülen işaretler ══');
    const byWinnerFreq = [...rows]
        .filter((r) => r.winnerHad >= MIN_SAMPLE)
        .sort((a, b) => b.winnerHad - a.winnerHad || b.winPct - a.winPct);
    console.log(' 1.lerde  Kazan%   n   işaret');
    for (const r of byWinnerFreq.slice(0, TOP_N)) {
        console.log(
            String(r.winnerHad).padStart(7),
            (pct(r.wins, r.horseRows) + '%').padStart(7),
            String(r.horseRows).padStart(4),
            ' ',
            r.label
        );
    }
    console.log('');

    console.log('══ C) Rakip avantajı: koşuda YALNIZCA 1 atta SON işareti (sole carrier) ══');
    console.log(' Kazan%   n   işaret  (o işareti tek taşıyan atın kazanma oranı)');
    const bySole = [...rows]
        .filter((r) => r.soleCarrierRaces >= MIN_SAMPLE)
        .sort((a, b) => b.soleWinPct - a.soleWinPct || b.soleCarrierWins - a.soleCarrierWins);
    for (const r of bySole.slice(0, TOP_N)) {
        console.log(
            (pct(r.soleCarrierWins, r.soleCarrierRaces) + '%').padStart(7),
            String(r.soleCarrierRaces).padStart(4),
            ' ',
            r.label
        );
    }
    console.log('');

    console.log('══ D) İşaret paylaşımlı (2+ at aynı SON işareti) — kazanma ══');
    console.log(' Kazan%   n   işaret');
    const byShared = [...rows]
        .filter((r) => r.sharedCarrierRaces >= MIN_SAMPLE)
        .sort((a, b) => b.sharedWinPct - a.sharedWinPct);
    for (const r of byShared.slice(0, 15)) {
        console.log(
            (pct(r.sharedCarrierWins, r.sharedCarrierRaces) + '%').padStart(7),
            String(r.sharedCarrierRaces).padStart(4),
            ' ',
            r.label
        );
    }
    console.log('');

    console.log('══ E) 1.\'nin SON işareti — rakiplerde YOK (koşu içi exclusive) ══');
    console.log(' Oran%  1.ler  işaret  (kazanan bu işareti taşıdığı koşularda rakipte yoktu)');
    const byExcl = [...rows]
        .filter((r) => r.winnerHad >= MIN_SAMPLE)
        .sort((a, b) => b.exclusivePct - a.exclusivePct || b.winnerExclusiveInRace - a.winnerExclusiveInRace);
    for (const r of byExcl.slice(0, TOP_N)) {
        console.log(
            (pct(r.winnerExclusiveInRace, r.winnerHad) + '%').padStart(7),
            String(r.winnerHad).padStart(7),
            ' ',
            r.label
        );
    }
    console.log('');

    console.log('══ F) Sole vs Shared farkı (en anlamlı ayrım, min örnek) ══');
    const byEdge = [...rows]
        .filter((r) => r.soleCarrierRaces >= MIN_SAMPLE && r.sharedCarrierRaces >= 3)
        .map((r) => ({
            ...r,
            edge: r.soleWinPct - r.sharedWinPct
        }))
        .sort((a, b) => b.edge - a.edge);
    console.log('  Δsole   sole%  payl.%   işaret');
    for (const r of byEdge.slice(0, 15)) {
        console.log(
            ('+' + (r.edge * 100).toFixed(1) + 'pp').padStart(8),
            (pct(r.soleCarrierWins, r.soleCarrierRaces) + '%').padStart(7),
            (pct(r.sharedCarrierWins, r.sharedCarrierRaces) + '%').padStart(7),
            ' ',
            r.label
        );
    }

    console.log('');
    console.log('══ G) 1. avı — bileşik puan (sole + exclusive + genel kazanma) ══');
    console.log(' Puan  sole%  excl%  Kazan%  n_sole  işaret');
    const scored = rows
        .filter((r) => r.soleCarrierRaces >= MIN_SAMPLE)
        .map((r) => {
            const soleP = r.soleWinPct * 100;
            const exclP = r.exclusivePct * 100;
            const winP = Math.min(r.winPct * 100, 35);
            let penalty = 0;
            if (r.sharedCarrierRaces > r.soleCarrierRaces * 4 && r.exclusivePct < 0.1) penalty += 25;
            if (r.sharedWinPct > 0.45 && r.soleWinPct < 0.12) penalty += 15;
            const score = 0.5 * soleP + 0.35 * exclP + 0.15 * winP - penalty;
            return { ...r, score, soleP, exclP, winP, penalty };
        })
        .sort((a, b) => b.score - a.score);

    for (const r of scored.slice(0, 18)) {
        console.log(
            r.score.toFixed(1).padStart(6),
            (pct(r.soleCarrierWins, r.soleCarrierRaces) + '%').padStart(7),
            (pct(r.winnerExclusiveInRace, r.winnerHad) + '%').padStart(7),
            (pct(r.wins, r.horseRows) + '%').padStart(7),
            String(r.soleCarrierRaces).padStart(6),
            ' ',
            r.label
        );
    }

    console.log('');
    console.log('══ H) Tuzak işaretler (1.\'de sık, exclusive düşük — tek başına seçme) ══');
    const traps = rows
        .filter((r) => r.winnerHad >= 20 && r.exclusivePct < 0.08 && r.sharedCarrierRaces >= 30)
        .sort((a, b) => b.winnerHad - a.winnerHad);
    for (const r of traps.slice(0, 8)) {
        console.log(
            '  1.lerde',
            String(r.winnerHad).padStart(4),
            '| exclusive',
            (pct(r.winnerExclusiveInRace, r.winnerHad) + '%').padStart(6),
            '|',
            r.label
        );
    }

    console.log('');
    console.log('── Koşu içi kullanım (bugün / canlı) ──');
    console.log('1) Atın SON\'unda işaret var mı?  2) Aynı koşuda başka atta YOK mu? (sole) → (C)/(G) güçlü.');
    console.log('3) Herkesde olan (H): Koyu yeşil, T1DR, mavi kenar → skor artırma, sadece eşitlik kırıcı.');
    console.log('4) Öncelik örnekleri (bu veri): kırmızı 2, yeşil tam kırmızı ★, TEI yeşil T (sole), t3y/t1y (az n).');
    console.log('');
    console.log('Not: SON = k=1. Sole = koşuda yalnız 1 atta. n=259 koşu — küçük sole örneklerine dikkat.');
    console.log('Bitti.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
