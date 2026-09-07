/**
 * Hazır Kupon bankroll simülasyonu — en yüksek oranlı seçime 20 TL
 */
const BET_KEYS = ['ganyan', 'ilk2', 'ilk3', 'ilk4'];
const BET_WIN_MAX_POS = { ganyan: 1, ilk2: 2, ilk3: 3, ilk4: 4 };
const BET_LABELS = { ganyan: 'Ganyan', ilk2: 'İlk 2', ilk3: 'İlk 3', ilk4: 'İlk 4' };

const STAGES = [
    { id: 1, label: 'Kademe 1 — Sadece Ganyan', bets: ['ganyan'] },
    { id: 2, label: 'Kademe 2 — Ganyan + İlk 2', bets: ['ganyan', 'ilk2'] },
    { id: 3, label: 'Kademe 3 — + İlk 3', bets: ['ganyan', 'ilk2', 'ilk3'] },
    { id: 4, label: 'Kademe 4 — Tümü', bets: ['ganyan', 'ilk2', 'ilk3', 'ilk4'] }
];

const DEFAULT_START_BANK = 1000;
const DEFAULT_STAKE = 20;

function parseOdd(val) {
    if (val == null || val === '' || val === '—') return null;
    const v = parseFloat(String(val).replace(',', '.'));
    if (!Number.isFinite(v) || v <= 1.01) return null;
    return v;
}

function pickHighestOdd(picks, getOdd) {
    let best = null;
    let bestOdd = 0;
    for (const p of picks || []) {
        const odd = parseOdd(getOdd(p));
        if (odd != null && odd > bestOdd) {
            bestOdd = odd;
            best = { pick: p, odd: bestOdd };
        }
    }
    return best;
}

function normalizeHorseNo(no) {
    const s = String(no ?? '').trim();
    if (!s) return '';
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? String(n) : s;
}

function getFinishPos(race, horseNo) {
    const no = normalizeHorseNo(horseNo);
    if (!no) return null;

    const fbn = race.finishByNo || {};
    if (fbn[no] != null) return Number(fbn[no]);
    for (const [k, v] of Object.entries(fbn)) {
        if (normalizeHorseNo(k) === no) return Number(v);
    }

    const top4 = race.actualTop4 || [];
    const idx = top4.findIndex((n) => normalizeHorseNo(n) === no);
    if (idx >= 0) return idx + 1;

    const pick = (race.picks || []).find((p) => normalizeHorseNo(p.no) === no);
    return pick?.finishPos != null ? Number(pick.finishPos) : null;
}

function isBetWon(betKey, finishPos) {
    if (finishPos == null || finishPos <= 0) return false;
    return finishPos <= (BET_WIN_MAX_POS[betKey] || 4);
}

function roundMoney(n) {
    return Math.round(n * 100) / 100;
}

function calcBetPayout(stake, odd, won) {
    if (!won) return 0;
    return roundMoney(stake * odd);
}

function calcBetPnl(stake, odd, won) {
    if (!won) return -stake;
    return roundMoney(stake * (odd - 1));
}

function applyBetToBank(bank, stake, odd, won) {
    const before = bank;
    bank -= stake;
    const payout = calcBetPayout(stake, odd, won);
    if (won) bank += payout;
    return {
        bank: roundMoney(bank),
        payout,
        pnl: roundMoney(bank - before),
        stake
    };
}

function sortRaces(races) {
    return [...races].sort((a, b) => {
        const hipCmp = String(a.hipName || '').localeCompare(String(b.hipName || ''), 'tr');
        if (hipCmp !== 0) return hipCmp;
        return Number(a.raceNo) - Number(b.raceNo);
    });
}

/**
 * @param {object} opts
 * @param {Array} opts.races — hipName/hipId içeren koşu listesi
 * @param {function} opts.getOdd — (race, pick, betKey) => ham oran
 * @param {number} [opts.startBank]
 * @param {number} [opts.stake]
 */
function simulateBankroll(opts = {}) {
    const startBank = opts.startBank ?? DEFAULT_START_BANK;
    const stake = opts.stake ?? DEFAULT_STAKE;
    const races = sortRaces(opts.races || []);
    const getOdd = opts.getOdd || (() => null);

    const finishedRaces = races.filter((r) => r.status === 'finished' && r.picks?.length);
    const pendingRaces = races.filter((r) => r.status === 'pending' && r.picks?.length);

    const stages = STAGES.map((stage) => {
        let bank = startBank;
        let wins = 0;
        let losses = 0;
        let skipped = 0;
        const bets = [];

        for (const race of finishedRaces) {
            for (const betKey of stage.bets) {
                const selection = pickHighestOdd(race.picks, (p) => getOdd(race, p, betKey));
                if (!selection) {
                    skipped++;
                    continue;
                }
                const finish = getFinishPos(race, selection.pick.no);
                const won = isBetWon(betKey, finish);
                const result = applyBetToBank(bank, stake, selection.odd, won);
                bank = result.bank;
                if (won) wins++;
                else losses++;

                bets.push({
                    hipName: race.hipName || '',
                    hipId: race.hipId || '',
                    raceNo: race.raceNo,
                    betKey,
                    betLabel: BET_LABELS[betKey] || betKey,
                    horseNo: selection.pick.no,
                    horseName: selection.pick.name || '',
                    odd: selection.odd,
                    finishPos: finish,
                    won,
                    stake,
                    payout: result.payout,
                    pnl: result.pnl,
                    bankAfter: result.bank
                });
            }
        }

        const pendingBets = pendingRaces.length * stage.bets.length;

        return Object.assign({}, stage, {
            startBank,
            endBank: roundMoney(bank),
            pnl: roundMoney(bank - startBank),
            wins,
            losses,
            skipped,
            totalBets: wins + losses,
            pendingRaces: pendingRaces.length,
            pendingBets,
            bets
        });
    });

    return {
        startBank,
        stake,
        finishedRaceCount: finishedRaces.length,
        pendingRaceCount: pendingRaces.length,
        stages
    };
}

function flattenRacesFromPayload(data) {
    const out = [];
    for (const hip of data?.hipodromlar || []) {
        for (const race of hip.races || []) {
            out.push(Object.assign({}, race, {
                hipId: hip.id,
                hipName: hip.name
            }));
        }
    }
    return out;
}

function buildFinishByNo(resultRace) {
    const map = {};
    for (const h of resultRace?.horses || []) {
        if (h.kosmaz) continue;
        const sira = h.siraNum != null ? h.siraNum : parseInt(String(h.sira || '').replace(/[^\d]/g, ''), 10);
        const no = normalizeHorseNo(h.no);
        if (no && Number.isFinite(sira) && sira > 0) map[no] = sira;
    }
    return map;
}

module.exports = {
    BET_KEYS,
    BET_LABELS,
    BET_WIN_MAX_POS,
    STAGES,
    DEFAULT_START_BANK,
    DEFAULT_STAKE,
    parseOdd,
    pickHighestOdd,
    getFinishPos,
    normalizeHorseNo,
    isBetWon,
    calcBetPayout,
    calcBetPnl,
    applyBetToBank,
    simulateBankroll,
    flattenRacesFromPayload,
    buildFinishByNo
};
