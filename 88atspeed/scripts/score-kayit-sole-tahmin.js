#!/usr/bin/env node
/**
 * Kayıt koşusu: SON sole+mor × TAHMİN (vitrin veya profil motoru) — terminal çıktı.
 *
 *   KAYIT_ID=202 RACE_NO=1 node score-kayit-sole-tahmin.js
 *   TAHMIN_MODE=profil|vitrin|auto  (auto: vitrin varsa vitrin, yoksa profil)
 *   TAHMIN_TOP=4  — kesişim filtresi (panelde top-4 TAHMİN ile sole)
 */
const { loadEngines } = require('./lib/load-engines-node.js');

const BASE = process.env.API_BASE || 'http://168.231.109.27';
const KAYIT_ID = parseInt(process.env.KAYIT_ID || '202', 10);
const RACE_NO = process.env.RACE_NO ? parseInt(process.env.RACE_NO, 10) : null;
const TAHMIN_MODE = (process.env.TAHMIN_MODE || 'auto').toLowerCase();
const TAHMIN_TOP = parseInt(process.env.TAHMIN_TOP || '2', 10);
const MOR_YANIP_BONUS = parseInt(process.env.MOR_YANIP_BONUS || '15', 10);
const MIN_RACE_FIELD = parseInt(process.env.MIN_RACE_FIELD || '3', 10);
const LEARN_MIN_SAMPLE = parseInt(process.env.LEARN_MIN_SAMPLE || '5', 10);

/* —— sole (score-today-son ile aynı) —— */
function morYanipSon2(h) { return !!h.test9Yanip; }

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
    const list = (h.yildizlar || []).filter((y) => parseInt(y.k, 10) === 1);
    const sigs = new Set();
    const bySig = new Map();
    for (const y of list) {
        const sig = markerSignature(y);
        sigs.add(sig);
        if (!bySig.has(sig)) bySig.set(sig, y);
    }
    return { sigs, bySig };
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
    return String(s || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/[^a-z0-9]/g, '');
}

function raceFingerprint(horses) {
    return horses.map((h) => String(h.no) + ':' + String(h.name || '').trim().toUpperCase()).sort().join('|');
}

function newStat() {
    return {
        horseRows: 0, wins: 0, winnerHad: 0, winnerExclusiveInRace: 0,
        soleCarrierRaces: 0, soleCarrierWins: 0, sharedCarrierRaces: 0
    };
}

async function learnWeights(kayitlar) {
    const bySig = new Map();
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
            }
            const allSigs = new Set();
            for (const h of horses) for (const s of sonMarkerSigs(h).sigs) allSigs.add(s);
            for (const sig of allSigs) {
                if (!bySig.has(sig)) bySig.set(sig, newStat());
                const st = bySig.get(sig);
                const carriers = horses.filter((h) => sonMarkerSigs(h).sigs.has(sig));
                const won = carriers.some((h) => parseInt(h.bitisSira, 10) === 1);
                if (carriers.length === 1) { st.soleCarrierRaces++; if (won) st.soleCarrierWins++; }
                else if (carriers.length > 1) st.sharedCarrierRaces++;
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
    }
    const weights = new Map();
    for (const [sig, st] of bySig) {
        const soleWin = st.soleCarrierRaces >= LEARN_MIN_SAMPLE
            ? st.soleCarrierWins / st.soleCarrierRaces
            : (st.horseRows >= LEARN_MIN_SAMPLE ? st.wins / st.horseRows : 0.1);
        const excl = st.winnerHad > 0 ? st.winnerExclusiveInRace / st.winnerHad : 0;
        const trap = (st.winnerHad >= 25 && excl < 0.06) || sig === 't4'
            || (sig === 'tmk' && st.sharedCarrierRaces > st.soleCarrierRaces * 3);
        weights.set(sig, { soleScore: 0.55 * soleWin + 0.45 * excl, trap });
    }
    return weights;
}

function buildCarrierCounts(horses) {
    const carrierCount = new Map();
    for (const h of horses) {
        for (const s of sonMarkerSigs(h).sigs) carrierCount.set(s, (carrierCount.get(s) || 0) + 1);
    }
    return carrierCount;
}

function scoreSole(h, horses, weights) {
    const { sigs } = sonMarkerSigs(h);
    const carrierCount = buildCarrierCounts(horses);
    let score = 0;
    let soleCount = 0;
    for (const sig of sigs) {
        const n = carrierCount.get(sig) || 0;
        const w = weights.get(sig);
        if (n === 1) { score += (w?.soleScore ?? 0.12) * 100; soleCount++; }
        else if (n > 1 && w?.trap) score -= 4;
        else if (n > 1) score -= 1;
    }
    if (soleCount >= 2) score += 10;
    else if (soleCount === 1) score += 3;
    if (MOR_YANIP_BONUS > 0 && morYanipSon2(h)) score += MOR_YANIP_BONUS;
    return { score, soleCount, mor: morYanipSon2(h) };
}

function formatCol(t) {
    if (!t || t.rank == null || t.pct == null || t.pct <= 0) return '—';
    return t.rank + '.%' + t.pct;
}

function buildVitrinLookups(vitrin) {
    const byFp = new Map();
    const byHipRace = new Map();
    for (const hip of vitrin.hipodromlar || []) {
        const hn = normHip(hip.name);
        for (const race of hip.kosular || []) {
            const horses = race.horses || [];
            const fp = raceFingerprint(horses);
            const row = new Map();
            for (const h of horses) {
                const sc = h.scores || {};
                if (sc.tahmin || sc.r2) row.set(String(h.no), { tahmin: sc.tahmin, r2: sc.r2 });
            }
            byFp.set(fp, row);
            byHipRace.set(hn + '|' + race.raceNo, row);
        }
    }
    return { byFp, byHipRace };
}

function attachVitrinTahmin(horses, hip, raceNo, lookups) {
    let row = lookups.byHipRace.get(normHip(hip) + '|' + String(raceNo));
    if (!row || !row.size) row = lookups.byFp.get(raceFingerprint(horses));
    let n = 0;
    for (const h of horses) {
        const sc = row?.get(String(h.no))?.tahmin;
        h._tahmin = sc && sc.rank != null ? { ...sc, source: 'vitrin' } : null;
        if (h._tahmin) n++;
    }
    return n >= Math.ceil(horses.length * 0.5);
}

function attachProfilTahmin(IE, ITE, race, hip, tarih, horses) {
    const pkg = IE.buildRaceIstatistikPackage(race, hip, tarih);
    ITE.attachRaceTahmin(pkg);
    const byNo = new Map(pkg.rows.map((r) => [String(r.no), r.tahmin]));
    for (const h of horses) {
        const t = byNo.get(String(h.no));
        h._tahmin = t ? { rank: t.rank, pct: t.pct, score: t.score, source: 'profil' } : null;
    }
    return pkg;
}

function pickCombined(ranked, tahTop) {
    const topSole = ranked[0];
    const tah1 = ranked.find((r) => r.tahmin?.rank === 1);
    const inter = ranked.filter((r) =>
        r.soleCount >= 1 && r.tahmin?.rank != null && r.tahmin.rank <= tahTop)[0];
    const tahOnly = tah1 || null;
    let mode = 'sole+mor';
    let pick = topSole;
    if (inter && inter !== topSole) {
        pick = inter;
        mode = 'SOLE∩TAH≤' + tahTop;
    } else if (inter) {
        pick = inter;
        mode = 'SOLE∩TAH≤' + tahTop;
    }
    return { pick, mode, topSole, tah1, inter };
}

function basPct(bundle) {
    if (!bundle || bundle.pct == null) return '—';
    return bundle.pct + '%';
}

function printRace(data, race, weights, IE, ITE, vitrinLookups) {
    const horses = race.horses || [];
    if (horses.length < MIN_RACE_FIELD) return;

    let tahSource = 'yok';
    if (TAHMIN_MODE === 'vitrin' || TAHMIN_MODE === 'auto') {
        if (attachVitrinTahmin(horses, data.hipodrom, race.raceNo, vitrinLookups)) tahSource = 'vitrin';
    }
    let profilPkg = null;
    if (tahSource === 'yok' && (TAHMIN_MODE === 'profil' || TAHMIN_MODE === 'auto')) {
        profilPkg = attachProfilTahmin(IE, ITE, race, data.hipodrom, data.tarih, horses);
        tahSource = 'profil (7 BAŞ+ görsel profil motoru — panel vitrin farklı olabilir)';
    }

    const ranked = horses.map((h) => {
        const s = scoreSole(h, horses, weights);
        return { h, ...s, tahmin: h._tahmin };
    }).sort((a, b) => b.score - a.score || b.soleCount - a.soleCount);

    const rec = pickCombined(ranked, TAHMIN_TOP);
    const winner = horses.find((h) => parseInt(h.bitisSira, 10) === 1);

    console.log('');
    console.log('🏁', race.raceNo + '. koşu', '(' + horses.length + ' at)', data.hipodrom);
    console.log('TAHMİN kaynağı:', tahSource);
    console.log('▶ Öneri [' + rec.mode + ']: N' + rec.pick.h.no, rec.pick.h.name,
        '| sole', rec.pick.score.toFixed(1), '| TAHMİN', formatCol(rec.pick.tahmin),
        rec.pick.mor ? '| MOR' : '');
    if (rec.pick !== rec.topSole) {
        console.log('   (sole 1.: N' + rec.topSole.h.no, rec.topSole.h.name + ',',
            formatCol(rec.topSole.tahmin) + ')');
    }
    if (winner) {
        const w = ranked.find((r) => r.h === winner);
        console.log('🏆 Gerçek 1.: N' + winner.no, winner.name,
            '| sole sıra', ranked.indexOf(w) + 1, '| TAH', formatCol(w?.tahmin));
    }

    console.log('  Sıralama (sole · TAHMİN · TEK):');
    ranked.forEach((r, i) => {
        const star = r.h === rec.pick.h ? '★' : (winner && r.h === winner ? '🏆' : ' ');
        console.log(
            star + String(i + 1).padStart(2) + '.',
            r.score.toFixed(1).padStart(7),
            'N' + String(r.h.no).padStart(2),
            String(r.h.name || '').slice(0, 16).padEnd(16),
            'TAH:' + formatCol(r.tahmin).padEnd(8),
            'TEK:' + r.soleCount,
            r.mor ? 'MOR' : '   '
        );
    });

    if (profilPkg && winner) {
        const row = profilPkg.rows.find((r) => String(r.no) === String(winner.no));
        if (row) {
            console.log('  Kazanan BAŞ+ özet (profil satırı):',
                'AS1=' + basPct(row.genelIlk1),
                'SH1=' + basPct(row.smIlk1),
                'MES1=' + basPct(row.mesafeIlk1),
                'TAH skor=' + (row.tahmin?.score ?? '—'));
        }
    }
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  Kayıt · SON sole+mor  ×  TAHMİN (vitrin / profil)               ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('API:', BASE, '| KAYIT_ID:', KAYIT_ID, '| RACE_NO:', RACE_NO || 'tümü');
    console.log('TAHMIN_MODE:', TAHMIN_MODE, '| SOLE∩TAH≤', TAHMIN_TOP);
    console.log('');

    const { IE, ITE } = loadEngines();
    const list = await fetchJson(BASE + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = list.kayitlar || [];
    const weights = await learnWeights(kayitlar);

    const data = await fetchJson(BASE + '/api/public/kayit-degerlendirme/' + KAYIT_ID);
    if (!data.success) throw new Error('Kayıt yüklenemedi');

    const iso = trToIso(data.tarih);
    let vitrinLookups = { byFp: new Map(), byHipRace: new Map() };
    if (iso && (TAHMIN_MODE === 'vitrin' || TAHMIN_MODE === 'auto')) {
        try {
            const vitrin = await fetchJson(BASE + '/api/public/vitrin?iso=' + encodeURIComponent(iso));
            if (vitrin.hipodromlar?.length) vitrinLookups = buildVitrinLookups(vitrin);
        } catch (_) { /* */ }
    }

    console.log('📍 #' + data.kayitId, data.hipodrom, data.tarih);
    console.log('Vitrin iso:', iso, vitrinLookups.byFp.size ? '(yüklü)' : '(boş → profil)');

    const races = (data.kosular || []).filter((r) =>
        RACE_NO == null || parseInt(r.raceNo, 10) === RACE_NO);
    for (const race of races) printRace(data, race, weights, IE, ITE, vitrinLookups);

    console.log('');
    console.log('Not: Paneldeki SON test TAHMİN çoğu gün vitrin/dimension motoru ile aynıdır;');
    console.log('     geçmiş gün vitrin yoksa burada profil motoru kullanılır (sıra farklı olabilir).');
    console.log('Bitti.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
