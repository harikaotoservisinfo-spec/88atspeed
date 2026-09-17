#!/usr/bin/env node
/**
 * Tek koşu derin analiz: SON (ve isteğe bağlı k=2,3) işaretler, sole puan dökümü,
 * geçmiş istatistik, kazanan vs model önerisi.
 *
 *   KAYIT_ID=202 RACE_NO=1 WINNER_NO=8 node analyze-race-markers.js
 *   KAYIT_ID=202 RACE_NO=1 node analyze-race-markers.js   # bitisSira=1 otomatik
 */
const BASE = process.env.API_BASE || 'http://168.231.109.27';
const KAYIT_ID = parseInt(process.env.KAYIT_ID || '202', 10);
const RACE_NO = parseInt(process.env.RACE_NO || '1', 10);
const WINNER_NO = process.env.WINNER_NO ? parseInt(process.env.WINNER_NO, 10) : null;
const MAX_K = parseInt(process.env.MAX_K || '3', 10);
const MOR_YANIP_BONUS = parseInt(process.env.MOR_YANIP_BONUS || '15', 10);
const LEARN_MIN_SAMPLE = parseInt(process.env.LEARN_MIN_SAMPLE || '5', 10);
const MIN_RACE_FIELD = parseInt(process.env.MIN_RACE_FIELD || '3', 10);

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
        ttym: 'yeşil tam mavi ★',
        ttsm: 'sarı tam mavi ★',
        tts: 'sarı tam ★'
    };
    if (map[sig]) return map[sig];
    if (sig.startsWith('s8:')) return 'SON8001 (' + sig + ')';
    if (sig.includes('|')) return sig.split('|')[0].slice(0, 36);
    return sig;
}

function markersAtK(h, k) {
    const list = (h.yildizlar || []).filter((y) => parseInt(y.k, 10) === k);
    const bySig = new Map();
    for (const y of list) {
        const sig = markerSignature(y);
        if (!bySig.has(sig)) bySig.set(sig, y);
    }
    return bySig;
}

function sonMarkerSigs(h) {
    return markersAtK(h, 1);
}

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.json();
}

function newStat() {
    return {
        horseRows: 0, wins: 0, winnerHad: 0, winnerExclusiveInRace: 0,
        soleCarrierRaces: 0, soleCarrierWins: 0, sharedCarrierRaces: 0
    };
}

async function loadAllFinishedRaces(kayitlar) {
    const races = [];
    for (const k of kayitlar) {
        const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + k.id);
        if (!data.success) continue;
        for (const race of data.kosular || []) {
            const horses = (race.horses || []).filter((h) => h.bitisSira != null && h.bitisSira !== '');
            if (horses.length < MIN_RACE_FIELD) continue;
            const winner = horses.find((h) => parseInt(h.bitisSira, 10) === 1);
            if (!winner) continue;
            races.push({
                kayitId: data.kayitId,
                hip: data.hipodrom,
                tarih: data.tarih,
                raceNo: race.raceNo,
                horses
            });
        }
    }
    return races;
}

function learnWeights(raceList) {
    const bySig = new Map();
    const sampleY = new Map();

    for (const { horses } of raceList) {
        const winner = horses.find((h) => parseInt(h.bitisSira, 10) === 1);
        const rivals = horses.filter((h) => h !== winner);
        const wSon = sonMarkerSigs(winner);
        const rivalSons = rivals.map((h) => sonMarkerSigs(h));

        for (const sig of wSon.keys()) {
            if (!bySig.has(sig)) bySig.set(sig, newStat());
            const st = bySig.get(sig);
            st.winnerHad++;
            const rivalHas = rivalSons.some((r) => r.has(sig));
            if (!rivalHas) st.winnerExclusiveInRace++;
            if (!sampleY.has(sig)) sampleY.set(sig, wSon.get(sig));
        }

        const allSigs = new Set();
        for (const h of horses) {
            for (const sig of sonMarkerSigs(h).keys()) allSigs.add(sig);
        }
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
            for (const [sig, y] of sonMarkerSigs(h)) {
                if (!bySig.has(sig)) bySig.set(sig, newStat());
                const st = bySig.get(sig);
                st.horseRows++;
                if (parseInt(h.bitisSira, 10) === 1) st.wins++;
                if (!sampleY.has(sig)) sampleY.set(sig, y);
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
            label: markerLabel(sig, sampleY.get(sig)),
            soleScore: 0.55 * soleWin + 0.45 * excl,
            trap,
            soleWin,
            excl,
            st
        });
    }
    return weights;
}

function buildCarrierCounts(horses, k = 1) {
    const carrierCount = new Map();
    for (const h of horses) {
        for (const sig of markersAtK(h, k).keys()) {
            carrierCount.set(sig, (carrierCount.get(sig) || 0) + 1);
        }
    }
    return carrierCount;
}

function scoreHorseDetailed(h, horses, weights, k, morBonus) {
    const sigs = markersAtK(h, k);
    const carrierCount = buildCarrierCounts(horses, k);
    let score = 0;
    const lines = [];
    let soleCount = 0;

    for (const [sig, y] of sigs) {
        const n = carrierCount.get(sig) || 0;
        const w = weights.get(sig);
        const lab = w?.label || markerLabel(sig, y);
        if (n === 1) {
            const pts = (w?.soleScore ?? 0.12) * 100;
            score += pts;
            soleCount++;
            lines.push({ sig, lab, n, pts: '+' + pts.toFixed(1), kind: 'TEK' });
        } else if (n > 1 && w?.trap) {
            score -= 4;
            lines.push({ sig, lab, n, pts: '−4.0', kind: 'tuzak' });
        } else if (n > 1) {
            score -= 1;
            lines.push({ sig, lab, n, pts: '−1.0', kind: 'ortak' });
        }
    }

    if (k === 1) {
        if (soleCount >= 2) {
            score += 10;
            lines.push({ sig: '_bonus', lab: 'çift TEK bonus', n: soleCount, pts: '+10', kind: 'bonus' });
        } else if (soleCount === 1) {
            score += 3;
            lines.push({ sig: '_bonus', lab: 'tek TEK bonus', n: 1, pts: '+3', kind: 'bonus' });
        }
        if (morBonus > 0 && h.test9Yanip) {
            score += morBonus;
            lines.push({ sig: '_mor', lab: 'mor yanıp test9Yanip', n: 1, pts: '+' + morBonus, kind: 'mor' });
        }
    }

    return { score, soleCount, lines, sigCount: sigs.size };
}

function pct(a, b) {
    return b ? ((100 * a) / b).toFixed(1) : '—';
}

function horseTag(h) {
    return 'N' + h.no + ' ' + (h.name || '').trim();
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  Koşu derin analiz · işaretler + sole puan + geçmiş ölçüm        ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('API:', BASE);
    console.log('KAYIT_ID:', KAYIT_ID, '| RACE_NO:', RACE_NO, '| MAX_K:', MAX_K);
    console.log('');

    const list = await fetchJson(BASE + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = list.kayitlar || [];

    console.log('Geçmiş sonuçlu koşular yükleniyor (ağırlık + işaret istatistik)…');
    const histRaces = await loadAllFinishedRaces(kayitlar);
    const weights = learnWeights(histRaces);
    console.log('Sonuçlu koşu:', histRaces.length, '| öğrenilen işaret:', weights.size);
    console.log('');

    const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + KAYIT_ID);
    if (!data.success) throw new Error('Kayıt yüklenemedi');
    const race = (data.kosular || []).find((r) => parseInt(r.raceNo, 10) === RACE_NO);
    if (!race) throw new Error('Koşu bulunamadı: ' + RACE_NO);

    const horses = race.horses || [];
    let winner = horses.find((h) => parseInt(h.bitisSira, 10) === 1);
    if (!winner && WINNER_NO != null) {
        winner = horses.find((h) => parseInt(h.no, 10) === WINNER_NO);
    }
    const winnerNote = winner
        ? (winner.bitisSira != null && winner.bitisSira !== ''
            ? 'API bitisSira=1'
            : 'WINNER_NO (API henüz sonuç yazmamış)')
        : '—';

    console.log('📍', data.hipodrom, '· #' + data.kayitId, '·', data.tarih, '·', RACE_NO + '. koşu');
    console.log('At sayısı:', horses.length, '| Kazanan:', winner ? horseTag(winner) : '?', '(' + winnerNote + ')');
    console.log('');

    const ranked = horses.map((h) => {
        const d = scoreHorseDetailed(h, horses, weights, 1, MOR_YANIP_BONUS);
        return { h, ...d };
    }).sort((a, b) => b.score - a.score || b.soleCount - a.soleCount);

    const pick = ranked[0];
    console.log('── Model (SON k=1 sole+mor) sıralama ──');
    ranked.forEach((r, i) => {
        const star = winner && r.h === winner ? '🏆' : (r.h === pick.h ? '★' : ' ');
        console.log(
            star + String(i + 1).padStart(2) + '.',
            r.score.toFixed(1).padStart(7),
            horseTag(r.h).padEnd(22),
            'TEK:' + r.soleCount,
            r.h.test9Yanip ? 'MOR' : '   ',
            (winner && r.h === winner) ? '← kazanan' : (r.h === pick.h ? '← öneri' : '')
        );
    });
    console.log('');

    if (winner && pick.h !== winner) {
        console.log('── Neden öneri kazanan değil? ──');
        console.log('Öneri:', horseTag(pick.h), 'sole', pick.score.toFixed(1), '| TEK işaret:', pick.soleCount);
        const wRow = ranked.find((r) => r.h === winner);
        console.log('Kazanan:', horseTag(winner), 'sole', wRow.score.toFixed(1), '| TEK işaret:', wRow.soleCount);
        console.log('Fark (öneri − kazanan):', (pick.score - wRow.score).toFixed(1), 'puan');
        console.log('');
    }

    const raceSigEntries = [];
    for (let k = 1; k <= MAX_K; k++) {
        for (const h of horses) {
            for (const [sig, y] of markersAtK(h, k)) {
                if (!raceSigEntries.some((e) => e.k === k && e.sig === sig)) {
                    raceSigEntries.push({ k, sig, sampleY: y });
                }
            }
        }
    }

    console.log('── Bu koşudaki işaretler · taşıyan sayısı (n) · geçmiş SON istatistik ──');
    console.log('(Geçmiş: at-satırı kazanma; TEK taşıyıcıda koşu kazanma; tuzak=paylaşımlıda −4)');
    console.log('');

    const sigRows = [];
    for (const { k, sig, sampleY } of raceSigEntries) {
        const carriers = horses.filter((h) => markersAtK(h, k).has(sig));
        const w = weights.get(sig);
        const st = w?.st;
        const onWinner = winner && markersAtK(winner, k).has(sig);
        sigRows.push({
            k, sig,
            lab: w?.label || markerLabel(sig, sampleY),
            n: carriers.length,
            carriers,
            trap: !!w?.trap,
            soleScore: w?.soleScore,
            rowWin: st ? st.wins + '/' + st.horseRows : '—',
            soleRace: st ? st.soleCarrierWins + '/' + st.soleCarrierRaces : '—',
            onWinner
        });
    }
    sigRows.sort((a, b) => a.k - b.k || b.n - a.n || a.sig.localeCompare(b.sig));

    for (const row of sigRows) {
        const who = row.carriers.map((h) => 'N' + h.no).join(',');
        const winMark = row.onWinner ? ' 🏆' : '';
        const hist = row.soleScore != null
            ? ('w=' + row.soleScore.toFixed(2) + ' satır=' + row.rowWin + ' TEK-koşu=' + row.soleRace)
            : 'yeni/az örnek';
        console.log(
            'k=' + row.k,
            row.lab.padEnd(28),
            'n=' + row.n,
            row.trap ? 'TUZAK' : '     ',
            hist,
            '|', who + winMark
        );
    }
    console.log('');

    let wd = null;
    if (winner) {
        console.log('── Kazanan at: puan dökümü (SON k=1) ──');
        wd = scoreHorseDetailed(winner, horses, weights, 1, MOR_YANIP_BONUS);
        for (const ln of wd.lines) {
            console.log(' ', ln.pts, ln.kind, 'n=' + ln.n, ln.lab, ln.sig !== '_bonus' && ln.sig !== '_mor' ? '(' + ln.sig + ')' : '');
        }
        console.log(' TOPLAM sole:', wd.score.toFixed(1), '| TEK sayısı:', wd.soleCount, '(≥1 TEK olmadan model üst sıraya almaz)');
        console.log('');

        console.log('── Kazanan vs öneri: işaret farkı (SON k=1) ──');
        const wS = sonMarkerSigs(winner);
        const pS = sonMarkerSigs(pick.h);
        const onlyW = [...wS.keys()].filter((s) => !pS.has(s));
        const onlyP = [...pS.keys()].filter((s) => !wS.has(s));
        const shared = [...wS.keys()].filter((s) => pS.has(s));
        console.log('Sadece kazanan:', onlyW.length ? onlyW.map((s) => markerLabel(s, wS.get(s))).join(', ') : '(yok)');
        console.log('Sadece öneri:', onlyP.length ? onlyP.map((s) => markerLabel(s, pS.get(s))).join(', ') : '(yok)');
        console.log('Ortak:', shared.map((s) => markerLabel(s, wS.get(s))).join(', ') || '(yok)');
        console.log('');

        const uniqWinnerAnyK = [];
        for (let k = 1; k <= MAX_K; k++) {
            for (const [sig, y] of markersAtK(winner, k)) {
                const others = horses.filter((h) => h !== winner && markersAtK(h, k).has(sig));
                if (others.length === 0) {
                    uniqWinnerAnyK.push({ k, sig, lab: markerLabel(sig, y) });
                }
            }
        }
        console.log('── Sadece kazananın taşıdığı işaretler (k≤' + MAX_K + ', koşuda tek) ──');
        if (uniqWinnerAnyK.length) {
            uniqWinnerAnyK.forEach((u) => console.log('  k=' + u.k, u.lab, '(' + u.sig + ')'));
        } else {
            console.log('  (yok — kazananın tüm işaretleri başka at(lar)da da var)');
        }
        console.log('');
    }

    console.log('── Alternatif: k=1..'+ MAX_K + ' aynı sole ağırlığı (her sütun ayrı sayılır) ──');
    const altRanked = horses.map((h) => {
        let total = 0;
        let tek = 0;
        for (let k = 1; k <= MAX_K; k++) {
            const d = scoreHorseDetailed(h, horses, weights, k, k === 1 ? MOR_YANIP_BONUS : 0);
            total += d.score;
            tek += d.soleCount;
        }
        return { h, total, tek };
    }).sort((a, b) => b.total - a.total);
    altRanked.forEach((r, i) => {
        const star = winner && r.h === winner ? '🏆' : ' ';
        console.log(star + String(i + 1).padStart(2) + '.', r.total.toFixed(1).padStart(7), horseTag(r.h), 'TEK-toplam:' + r.tek);
    });
    console.log('(Not: Canlı score-today-son yalnızca k=1 kullanır; bu blok keşif amaçlı.)');
    console.log('');

    console.log('── İşaret kombinasyonu: bu koşuda kazananı ayıran profil ──');
    if (winner) {
        const prof = [];
        for (const [sig] of sonMarkerSigs(winner)) {
            const n = buildCarrierCounts(horses, 1).get(sig) || 0;
            const w = weights.get(sig);
            if (n > 1 && w?.trap) prof.push('paylaşımlı TUZAK:' + (w?.label || sig));
            else if (n > 1) prof.push('paylaşımlı:' + (w?.label || sig));
            else if (n === 1) prof.push('TEK ama düşük ağırlık:' + (w?.label || sig) + ' w=' + (w?.soleScore?.toFixed(2) || '?'));
        }
        prof.forEach((p) => console.log(' •', p));
        if (!sonMarkerSigs(winner).size) console.log(' • SON sütununda işaret yok');
        if (wd && wd.soleCount === 0) {
            console.log('');
            console.log('ÖZET: Kazananın SON\'da hiç TEK (sole) işareti yok → model ceza ağırlıklı');
            console.log('      ortak/tuzak işaretlerle listenin dibine itildi. Bu, sole modelinin bilinçli kör noktası.');
        }
    }

    console.log('');
    console.log('Bitti.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
