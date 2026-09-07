/**
 * Hazır Kupon — TEK/S2/S1/YUV ilk-4 premium tahmin paneli
 */
(function () {
    'use strict';

    const COL_KEYS = ['TEK', 'S2', 'S1', 'YUV'];
    const COL_COLORS = { TEK: '#e65100', S2: '#1565c0', S1: '#2e7d32', YUV: '#6a1b9a' };
    const BET_KEYS = ['ganyan', 'ilk2', 'ilk3', 'ilk4'];
    const BET_LABELS = { ganyan: 'Ganyan', ilk2: 'İlk 2', ilk3: 'İlk 3', ilk4: 'İlk 4' };
    const BET_WIN_MAX_POS = { ganyan: 1, ilk2: 2, ilk3: 3, ilk4: 4 };
    const SIM_STAGES = [
        { id: 1, label: 'Kademe 1 — Sadece Ganyan', bets: ['ganyan'] },
        { id: 2, label: 'Kademe 2 — Ganyan + İlk 2', bets: ['ganyan', 'ilk2'] },
        { id: 3, label: 'Kademe 3 — + İlk 3', bets: ['ganyan', 'ilk2', 'ilk3'] },
        { id: 4, label: 'Kademe 4 — Tümü', bets: ['ganyan', 'ilk2', 'ilk3', 'ilk4'] }
    ];
    const START_BANK = 1000;
    const STAKE = 20;
    const POLL_MS = 60000;
    const ODDS_POLL_MS = 30000;

    let state = {
        data: null,
        iso: null,
        activeHipId: null,
        loading: false,
        pollTimer: null,
        oddsPollTimer: null,
        btData: null,
        btHipId: null,
        btDataByHipId: {},
        ganyanByHipId: {},
        btLoading: false,
        btLoadingHips: {},
        ganyanByRace: {},
        muhtOverview: null,
        muhtIso: null,
        savingSim: false,
        useSavedSim: true,
        kasa: null,
        kasaSaving: false,
        kasaSavedAt: null,
        oddsSnapshot: {},
        oddsSaveTimer: null
    };

    const KASA_STORAGE_PREFIX = 'hazir_kasa_';
    const KASA_CLIENT_KEY = 'hazir_kasa_client_id';

    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getIso() {
        if (window.pubVitrinState?.getIso) return window.pubVitrinState.getIso();
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function stopPolling() {
        if (state.pollTimer) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
        }
        stopOddsPolling();
    }

    function stopOddsPolling() {
        if (state.oddsPollTimer) {
            clearInterval(state.oddsPollTimer);
            state.oddsPollTimer = null;
        }
    }

    function normalizeHorseName(s) {
        return String(s || '').toLocaleUpperCase('tr-TR')
            .normalize('NFD').replace(/\p{M}/gu, '')
            .replace(/[^A-Z0-9]/g, '');
    }

    function normalizeHipLabel(s) {
        return String(s || '').toLocaleLowerCase('tr-TR')
            .normalize('NFD').replace(/\p{M}/gu, '').trim();
    }

    function isPlaceholderBtOdd(val) {
        if (val == null || val === '' || val === '—') return true;
        const v = parseFloat(String(val).replace(',', '.'));
        return !isNaN(v) && v <= 1.01;
    }

    function formatOddCell(val, loading, saved) {
        if (loading) return '<span class="pub-hazir-odd pub-hazir-odd-loading">…</span>';
        if (!val || isPlaceholderBtOdd(val)) return '<span class="pub-hazir-odd pub-hazir-odd-empty">—</span>';
        const savedCls = saved ? ' pub-hazir-odd-saved' : '';
        return '<span class="pub-hazir-odd' + savedCls + '">' + escapeHtml(String(val)) + '</span>';
    }

    function raceOddsKey(hipId, raceNo) {
        return String(hipId) + '|' + String(raceNo);
    }

    function mergeByHorseClient(existing, incoming) {
        const base = existing && typeof existing === 'object' ? Object.assign({}, existing) : {};
        if (!incoming || typeof incoming !== 'object') return base;
        for (const [no, bets] of Object.entries(incoming)) {
            if (!bets || typeof bets !== 'object') continue;
            if (!base[no]) base[no] = {};
            for (const [k, v] of Object.entries(bets)) {
                if (v != null && String(v).trim() !== '' && String(v) !== '—') {
                    base[no][k] = String(v);
                }
            }
        }
        return base;
    }

    function hydrateOddsSnapshots(data) {
        if (!data) return;
        if (data.oddsSnapshots && typeof data.oddsSnapshots === 'object') {
            for (const [key, snap] of Object.entries(data.oddsSnapshots)) {
                if (!snap?.byHorse) continue;
                const existing = state.oddsSnapshot[key]?.byHorse || {};
                state.oddsSnapshot[key] = {
                    byHorse: mergeByHorseClient(existing, snap.byHorse),
                    capturedAt: snap.capturedAt || state.oddsSnapshot[key]?.capturedAt
                };
            }
        }
        for (const hip of data.hipodromlar || []) {
            for (const race of hip.races || []) {
                if (!race.savedOdds) continue;
                const key = raceOddsKey(hip.id, race.raceNo);
                const existing = state.oddsSnapshot[key]?.byHorse || {};
                state.oddsSnapshot[key] = {
                    byHorse: mergeByHorseClient(existing, race.savedOdds),
                    capturedAt: state.oddsSnapshot[key]?.capturedAt
                };
            }
        }
    }

    function resolveMuhtHipKey(hipName) {
        const data = state.muhtOverview;
        if (!data?.hipodromlar?.length) return null;
        const target = normalizeHipLabel(hipName);
        const hit = data.hipodromlar.find((h) => {
            const yer = normalizeHipLabel(h.yer);
            const key = normalizeHipLabel(h.key);
            const hip = normalizeHipLabel(h.hipodrom);
            return yer === target || key === target || hip === target
                || yer.includes(target) || target.includes(yer);
        });
        return hit?.key || null;
    }

    function extractGanyanOdds(muhtemel) {
        const map = {};
        const ganyanBet = (muhtemel?.bahisler || []).find((b) => b.isGanyan || b.B === 'GANYAN');
        if (!ganyanBet?.muhtemeller?.length) return map;
        ganyanBet.muhtemeller.forEach((row) => {
            if (row.S1 != null && row.S1 !== '') map[String(row.S1)] = row.G || '';
        });
        return map;
    }

    function parseSimOdd(val) {
        if (val == null || val === '' || val === '—') return null;
        const v = parseFloat(String(val).replace(',', '.'));
        if (!Number.isFinite(v) || v <= 1.01) return null;
        return v;
    }

    function getRaceBtMaps(hipId, raceNo) {
        const race = state.btDataByHipId[hipId]?.races?.[String(raceNo)] || null;
        const bets = race?.bets || {};
        const out = {};
        BET_KEYS.forEach((key) => {
            out[key] = {
                byNo: bets[key]?.byNo || {},
                byName: bets[key]?.byName || {}
            };
        });
        return out;
    }

    function getLivePickOdd(pick, raceNo, betKey, hipId) {
        const resolvedHipId = hipId || state.activeHipId;
        const no = String(pick.no);
        const nameKey = normalizeHorseName(pick.name);
        const btMaps = getRaceBtMaps(resolvedHipId, raceNo);
        const bt = btMaps[betKey];
        if (bt) {
            const val = bt.byNo[no] || bt.byName[nameKey] || '';
            if (val && !isPlaceholderBtOdd(val)) return val;
        }
        if (betKey === 'ganyan') {
            const tjk = (state.ganyanByHipId[resolvedHipId] || state.ganyanByRace || {})[String(raceNo)] || {};
            return tjk[no] || '';
        }
        return '';
    }

    function getSavedPickOdd(pick, raceNo, betKey, hipId) {
        const key = raceOddsKey(hipId || state.activeHipId, raceNo);
        const saved = state.oddsSnapshot[key]?.byHorse?.[String(pick.no)]?.[betKey];
        return saved && !isPlaceholderBtOdd(saved) ? saved : '';
    }

    function getPickOdd(pick, raceNo, betKey, hipId) {
        const live = getLivePickOdd(pick, raceNo, betKey, hipId);
        if (live && !isPlaceholderBtOdd(live)) return live;
        return getSavedPickOdd(pick, raceNo, betKey, hipId) || live || '';
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

    function findRaceForKasaBet(data, bet) {
        if (!bet) return null;
        for (const hip of data?.hipodromlar || []) {
            if (bet.hipId && String(hip.id) !== String(bet.hipId)) continue;
            const race = (hip.races || []).find((r) => String(r.raceNo) === String(bet.raceNo));
            if (race) return { hip, race };
        }
        for (const hip of data?.hipodromlar || []) {
            const race = (hip.races || []).find((r) => String(r.raceNo) === String(bet.raceNo));
            if (race) return { hip, race };
        }
        return null;
    }

    function pickHighestOddBet(picks, raceNo, betKey, hipId) {
        let best = null;
        let bestOdd = 0;
        for (const p of picks || []) {
            const odd = parseSimOdd(getPickOdd(p, raceNo, betKey, hipId));
            if (odd != null && odd > bestOdd) {
                bestOdd = odd;
                best = { pick: p, odd: bestOdd };
            }
        }
        return best;
    }

    function flattenAllRaces(data) {
        const out = [];
        for (const hip of data?.hipodromlar || []) {
            for (const race of hip.races || []) {
                out.push(Object.assign({}, race, { hipId: hip.id, hipName: hip.name }));
            }
        }
        return out.sort((a, b) => {
            const hipCmp = String(a.hipName || '').localeCompare(String(b.hipName || ''), 'tr');
            if (hipCmp !== 0) return hipCmp;
            return Number(a.raceNo) - Number(b.raceNo);
        });
    }

    function calcBetPayout(stake, odd, won) {
        if (!won) return 0;
        return Math.round(stake * odd * 100) / 100;
    }

    function applySimBet(bank, stake, odd, won) {
        const before = bank;
        bank -= stake;
        const payout = calcBetPayout(stake, odd, won);
        if (won) bank += payout;
        return {
            bank: Math.round(bank * 100) / 100,
            payout,
            pnl: Math.round((bank - before) * 100) / 100
        };
    }

    function runBankrollSimulation(data) {
        const races = flattenAllRaces(data);
        const finished = races.filter((r) => r.status === 'finished' && r.picks?.length);
        const pending = races.filter((r) => r.status === 'pending' && r.picks?.length);

        const stages = SIM_STAGES.map((stage) => {
            let bank = START_BANK;
            let wins = 0;
            let losses = 0;
            let skipped = 0;
            const bets = [];

            for (const race of finished) {
                for (const betKey of stage.bets) {
                    const sel = pickHighestOddBet(race.picks, race.raceNo, betKey, race.hipId);
                    if (!sel) {
                        skipped++;
                        continue;
                    }
                    const finish = getFinishPos(race, sel.pick.no);
                    const won = isBetWon(betKey, finish);
                    const result = applySimBet(bank, STAKE, sel.odd, won);
                    bank = result.bank;
                    if (won) wins++;
                    else losses++;
                    bets.push({
                        hipName: race.hipName,
                        raceNo: race.raceNo,
                        betKey,
                        betLabel: BET_LABELS[betKey],
                        horseNo: sel.pick.no,
                        horseName: sel.pick.name,
                        odd: sel.odd,
                        finishPos: finish,
                        won,
                        stake: STAKE,
                        payout: result.payout,
                        pnl: result.pnl,
                        bankAfter: result.bank
                    });
                }
            }

            return Object.assign({}, stage, {
                endBank: Math.round(bank * 100) / 100,
                pnl: Math.round((bank - START_BANK) * 100) / 100,
                wins,
                losses,
                skipped,
                totalBets: wins + losses,
                pendingRaces: pending.length,
                pendingBets: pending.length * stage.bets.length,
                bets
            });
        });

        return {
            startBank: START_BANK,
            stake: STAKE,
            finishedRaceCount: finished.length,
            pendingRaceCount: pending.length,
            stages
        };
    }

    function formatMoney(n) {
        const v = Number(n);
        if (!Number.isFinite(v)) return '—';
        return (v >= 0 ? '' : '-') + Math.abs(v).toFixed(2) + ' ₺';
    }

    function captureOddsForHip(hip) {
        if (!hip) return null;
        const payload = [];
        for (const race of hip.races || []) {
            const byHorse = {};
            for (const pick of race.picks || []) {
                const entry = {};
                for (const betKey of BET_KEYS) {
                    const val = getLivePickOdd(pick, race.raceNo, betKey, hip.id);
                    if (val && !isPlaceholderBtOdd(val)) entry[betKey] = String(val);
                }
                if (Object.keys(entry).length) byHorse[String(pick.no)] = entry;
            }
            if (!Object.keys(byHorse).length) continue;
            const key = raceOddsKey(hip.id, race.raceNo);
            const merged = mergeByHorseClient(state.oddsSnapshot[key]?.byHorse, byHorse);
            state.oddsSnapshot[key] = {
                byHorse: merged,
                capturedAt: new Date().toISOString()
            };
            payload.push({ hipId: String(hip.id), raceNo: race.raceNo, byHorse: merged });
        }
        return payload.length ? payload : null;
    }

    function scheduleOddsPersist(races) {
        if (!races?.length) return;
        if (state.oddsSaveTimer) clearTimeout(state.oddsSaveTimer);
        state.oddsSaveTimer = setTimeout(() => persistOddsSnapshots(races), 1500);
    }

    async function persistOddsSnapshots(races) {
        const data = state.data;
        if (!data || !races?.length) return;
        try {
            await fetch('/api/public/hazir-kupon-odds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    iso: data.iso,
                    tarih: data.tarih,
                    races,
                    source: 'client',
                    capturedAt: new Date().toISOString()
                })
            });
        } catch (err) {
            console.warn('Oran snapshot kaydı başarısız:', err.message);
        }
    }

    function kasaBetKey(hipId, raceNo) {
        return String(hipId) + '|' + String(raceNo);
    }

    function getKasaClientId() {
        try {
            let id = localStorage.getItem(KASA_CLIENT_KEY);
            if (!id) {
                id = 'kasa_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
                localStorage.setItem(KASA_CLIENT_KEY, id);
            }
            return id;
        } catch (_) {
            return 'kasa_anon_' + (state.iso || getIso());
        }
    }

    function kasaStorageKeys(iso, tarih) {
        const keys = [];
        if (iso) keys.push(KASA_STORAGE_PREFIX + iso);
        if (tarih) keys.push(KASA_STORAGE_PREFIX + 'tr_' + String(tarih).replace(/\//g, '-'));
        return keys;
    }

    function createEmptyKasa(iso, tarih) {
        return {
            iso,
            tarih: tarih || '',
            startBank: START_BANK,
            stake: STAKE,
            bets: {},
            updatedAt: new Date().toISOString()
        };
    }

    function loadKasaLocal(iso, tarih) {
        const keys = kasaStorageKeys(iso, tarih);
        for (const key of keys) {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object') continue;
                parsed.bets = parsed.bets || {};
                parsed.startBank = parsed.startBank ?? START_BANK;
                parsed.stake = parsed.stake ?? STAKE;
                parsed.iso = parsed.iso || iso;
                parsed.tarih = parsed.tarih || tarih || '';
                return parsed;
            } catch (_) { /* sonraki anahtar */ }
        }
        return null;
    }

    function saveKasaLocal(kasa) {
        if (!kasa?.iso) return;
        kasa.updatedAt = new Date().toISOString();
        const payload = JSON.stringify(kasa);
        try {
            localStorage.setItem(KASA_STORAGE_PREFIX + kasa.iso, payload);
            if (kasa.tarih) {
                localStorage.setItem(KASA_STORAGE_PREFIX + 'tr_' + String(kasa.tarih).replace(/\//g, '-'), payload);
            }
        } catch (err) {
            console.warn('Kasa localStorage yazılamadı:', err.message);
        }
    }

    async function fetchKasaFromServer(iso, tarih) {
        try {
            const qs = '/api/public/hazir-kupon-kasa?clientId=' + encodeURIComponent(getKasaClientId())
                + '&iso=' + encodeURIComponent(iso || '')
                + (tarih ? '&tarih=' + encodeURIComponent(tarih) : '');
            const res = await fetch(qs, { cache: 'no-store' });
            const data = await res.json();
            if (!data.success || !data.kayit?.kasa) return null;
            const kasa = data.kayit.kasa;
            kasa.bets = kasa.bets || {};
            kasa.iso = kasa.iso || iso;
            kasa.tarih = kasa.tarih || tarih || '';
            return kasa;
        } catch (_) {
            return null;
        }
    }

    async function saveKasaToServer(kasa) {
        if (!kasa?.iso) return false;
        state.kasaSaving = true;
        try {
            const res = await fetch('/api/public/hazir-kupon-kasa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: getKasaClientId(),
                    iso: kasa.iso,
                    tarih: kasa.tarih,
                    kasa
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Kayıt hatası');
            state.kasaSavedAt = new Date().toISOString();
            return true;
        } catch (err) {
            console.warn('Kasa sunucu kaydı başarısız:', err.message);
            return false;
        } finally {
            state.kasaSaving = false;
        }
    }

    function mergeKasaRecords(localKasa, serverKasa, iso, tarih) {
        if (!localKasa && !serverKasa) return createEmptyKasa(iso, tarih);
        if (!localKasa) return serverKasa;
        if (!serverKasa) return localKasa;
        const localAt = Date.parse(localKasa.updatedAt || '') || 0;
        const serverAt = Date.parse(serverKasa.updatedAt || '') || 0;
        return serverAt >= localAt ? serverKasa : localKasa;
    }

    async function loadKasa(iso, tarih) {
        const localKasa = loadKasaLocal(iso, tarih);
        const serverKasa = await fetchKasaFromServer(iso, tarih);
        const merged = mergeKasaRecords(localKasa, serverKasa, iso, tarih);
        saveKasaLocal(merged);
        return merged;
    }

    async function saveKasa(kasa) {
        if (!kasa?.iso) return;
        saveKasaLocal(kasa);
        await saveKasaToServer(kasa);
    }

    function computeKasaBalance(kasa) {
        let bal = kasa.startBank ?? START_BANK;
        for (const bet of Object.values(kasa.bets || {})) {
            bal -= bet.stake ?? STAKE;
            if (bet.status === 'won') bal += (bet.stake ?? STAKE) * bet.odd;
        }
        return Math.round(bal * 100) / 100;
    }

    function getKasaStats(kasa) {
        const bets = Object.values(kasa.bets || {});
        let pending = 0;
        let wins = 0;
        let losses = 0;
        let settledPnl = 0;
        let staked = 0;
        for (const b of bets) {
            staked += b.stake ?? STAKE;
            if (b.status === 'pending') pending++;
            else if (b.status === 'won') { wins++; settledPnl += b.pnl ?? 0; }
            else if (b.status === 'lost') { losses++; settledPnl += b.pnl ?? 0; }
        }
        const balance = computeKasaBalance(kasa);
        return {
            balance,
            pnl: Math.round((balance - (kasa.startBank ?? START_BANK)) * 100) / 100,
            pending,
            wins,
            losses,
            totalBets: bets.length,
            staked,
            settledPnl: Math.round(settledPnl * 100) / 100
        };
    }

    async function settleKasaBets(data) {
        if (!state.kasa || !data) return false;
        let changed = false;

        for (const bet of Object.values(state.kasa.bets || {})) {
            const found = findRaceForKasaBet(data, bet);
            if (!found || found.race.status !== 'finished') continue;

            const finish = getFinishPos(found.race, bet.horseNo);
            const won = isBetWon(bet.betKey, finish);
            const newStatus = won ? 'won' : 'lost';
            const newPayout = won ? Math.round((bet.stake * bet.odd) * 100) / 100 : 0;
            const newPnl = won
                ? Math.round((bet.stake * (bet.odd - 1)) * 100) / 100
                : -(bet.stake ?? STAKE);

            if (bet.status === newStatus
                && bet.finishPos === finish
                && bet.payout === newPayout
                && bet.pnl === newPnl) {
                continue;
            }

            bet.finishPos = finish;
            bet.status = newStatus;
            bet.payout = newPayout;
            bet.pnl = newPnl;
            bet.settledAt = new Date().toISOString();
            changed = true;
        }

        if (changed) await saveKasa(state.kasa);
        return changed;
    }

    async function placeKasaBet(hip, race, pick, betKey) {
        if (!state.kasa || race.status !== 'pending') return;
        const odd = parseSimOdd(getPickOdd(pick, race.raceNo, betKey, hip.id));
        if (odd == null) {
            window.alert('Bu bahis için geçerli oran yok.');
            return;
        }
        const key = kasaBetKey(hip.id, race.raceNo);
        const existing = state.kasa.bets[key];
        const stats = getKasaStats(state.kasa);
        const stake = state.kasa.stake ?? STAKE;
        const balanceIfNew = stats.balance + (existing ? existing.stake : 0);
        if (balanceIfNew < stake) {
            window.alert('Yetersiz bakiye. Mevcut: ' + formatMoney(stats.balance));
            return;
        }
        state.kasa.bets[key] = {
            hipId: String(hip.id),
            hipName: hip.name,
            raceNo: race.raceNo,
            horseNo: String(pick.no),
            horseName: pick.name,
            betKey,
            betLabel: BET_LABELS[betKey],
            odd,
            stake,
            status: 'pending',
            placedAt: new Date().toISOString(),
            finishPos: null,
            pnl: null
        };
        await saveKasa(state.kasa);
        render();
    }

    async function resetKasa() {
        const iso = state.iso || getIso();
        const tarih = state.data?.tarih || '';
        if (!window.confirm('Kasa sıfırlanacak. Tüm bahisler silinir. Emin misiniz?')) return;
        state.kasa = createEmptyKasa(iso, tarih);
        await saveKasa(state.kasa);
        render();
    }

    function renderKasaPanel() {
        const kasa = state.kasa;
        if (!kasa) return '';
        const stats = getKasaStats(kasa);
        const pnlCls = stats.pnl > 0 ? 'pos' : (stats.pnl < 0 ? 'neg' : '');
        const bets = Object.values(kasa.bets || {}).sort((a, b) => {
            const hipCmp = String(a.hipName || '').localeCompare(String(b.hipName || ''), 'tr');
            if (hipCmp !== 0) return hipCmp;
            return Number(a.raceNo) - Number(b.raceNo);
        });

        const betRows = bets.length
            ? bets.map((b) => {
                const stCls = b.status === 'won' ? 'win' : (b.status === 'lost' ? 'lose' : 'pending');
                const res = b.status === 'pending'
                    ? 'Bekliyor'
                    : (b.status === 'won'
                        ? '✓ ' + (b.finishPos != null ? b.finishPos + '.' : '') + ' +' + formatMoney(b.payout || (b.stake * b.odd))
                        : '✗ ' + (b.finishPos != null ? b.finishPos + '.' : ''));
                return '<div class="pub-hazir-kasa-bet ' + stCls + '">'
                    + '<span>' + escapeHtml(b.hipName) + ' K' + b.raceNo + '</span>'
                    + '<span>' + escapeHtml(b.horseNo) + ' ' + escapeHtml((b.horseName || '').slice(0, 14)) + '</span>'
                    + '<span>' + escapeHtml(b.betLabel) + ' @' + b.odd + '</span>'
                    + '<span class="pub-hazir-kasa-bet-res">' + res + '</span>'
                    + '<span class="pub-hazir-kasa-bet-pnl">' + (b.pnl != null ? formatMoney(b.pnl) : '—') + '</span>'
                    + '</div>';
            }).join('')
            : '<p class="pub-hazir-sim-empty">Henüz bahis yok. Koşu tablosunda oran hücresine tıklayın.</p>';

        const saveHint = state.kasaSaving
            ? '<span class="pub-hazir-kasa-save-hint saving">Kaydediliyor…</span>'
            : (state.kasaSavedAt
                ? '<span class="pub-hazir-kasa-save-hint saved">Kayıtlı</span>'
                : '<span class="pub-hazir-kasa-save-hint">Otomatik kayıt</span>');

        return '<div class="pub-hazir-kasa pub-hazir-premium-card">'
            + '<div class="pub-hazir-kasa-hdr">'
            + '<div><h3>💰 Kasa</h3>'
            + '<p>Her koşuda bir at + bahis türü seçin · ' + (kasa.stake ?? STAKE) + ' ₺ / bahis · ' + saveHint + '</p></div>'
            + '<button type="button" class="pub-hazir-kasa-reset" id="pubHazirKasaReset">Sıfırla</button>'
            + '</div>'
            + '<div class="pub-hazir-kasa-metrics">'
            + '<div class="pub-hazir-kasa-metric main"><b>' + formatMoney(stats.balance) + '</b><span>Bakiye</span></div>'
            + '<div class="pub-hazir-kasa-metric"><b>' + formatMoney(kasa.startBank) + '</b><span>Başlangıç</span></div>'
            + '<div class="pub-hazir-kasa-metric ' + pnlCls + '"><b>' + formatMoney(stats.pnl) + '</b><span>Kar / Zarar</span></div>'
            + '<div class="pub-hazir-kasa-metric"><b>' + stats.wins + '/' + (stats.wins + stats.losses) + '</b><span>İsabet</span></div>'
            + '<div class="pub-hazir-kasa-metric"><b>' + stats.pending + '</b><span>Bekleyen</span></div>'
            + (stats.wins > 0
                ? '<div class="pub-hazir-kasa-metric pos"><b>' + formatMoney(
                    Object.values(kasa.bets || {}).reduce((s, b) => s + (b.payout || 0), 0)
                ) + '</b><span>Toplam kazanç</span></div>'
                : '')
            + '</div>'
            + '<details class="pub-hazir-kasa-details"><summary>'
            + stats.totalBets + ' bahis · ' + formatMoney(stats.staked) + ' yatırıldı'
            + '</summary><div class="pub-hazir-kasa-log">' + betRows + '</div></details>'
            + '</div>';
    }

    function formatOddPickCell(pick, raceNo, betKey, hipId, race, kasaBet) {
        const liveVal = getLivePickOdd(pick, raceNo, betKey, hipId);
        const val = getPickOdd(pick, raceNo, betKey, hipId);
        const savedVal = getSavedPickOdd(pick, raceNo, betKey, hipId);
        const isSaved = !!savedVal && (!liveVal || isPlaceholderBtOdd(liveVal));
        const odd = parseSimOdd(val);
        const isPick = kasaBet
            && String(kasaBet.horseNo) === String(pick.no)
            && kasaBet.betKey === betKey;
        const canPick = race.status === 'pending' && odd != null;
        const cls = 'pub-hazir-odd-td'
            + (canPick ? ' pub-hazir-odd-pick' : '')
            + (isPick ? ' pub-hazir-odd-selected' : '');
        const attrs = canPick
            ? ' data-horse-no="' + escapeHtml(pick.no) + '" data-bet-key="' + betKey + '" data-race-no="' + raceNo + '"'
            : '';
        const loading = state.btLoading && race.status === 'pending';
        const inner = formatOddCell(val, loading, isSaved);
        return '<td class="' + cls + '"' + attrs + '>' + inner + '</td>';
    }

    async function ensureMuhtOverview(iso) {
        if (state.muhtOverview && state.muhtIso === iso) return state.muhtOverview;
        try {
            const res = await fetch('/api/public/muhtemeller?iso=' + encodeURIComponent(iso), { cache: 'no-store' });
            const data = await res.json();
            if (!data.success) return null;
            state.muhtOverview = data;
            state.muhtIso = iso;
            return data;
        } catch (_) {
            return null;
        }
    }

    async function fetchGanyanForHip(iso, hipId, hipName, raceNos, refresh) {
        const overview = await ensureMuhtOverview(iso);
        const muhtKey = resolveMuhtHipKey(hipName);
        if (!muhtKey || !overview) return;
        const map = {};
        for (const raceNo of raceNos) {
            const runKey = muhtKey + '_' + raceNo;
            try {
                const res = await fetch(
                    '/api/public/muhtemeller?iso=' + encodeURIComponent(iso)
                    + '&kosu=' + encodeURIComponent(runKey)
                    + (refresh ? '&refresh=1' : ''),
                    { cache: 'no-store' }
                );
                const data = await res.json();
                if (data.success && data.muhtemel) {
                    map[String(raceNo)] = extractGanyanOdds(data.muhtemel);
                }
            } catch (_) { /* atla */ }
        }
        state.ganyanByHipId[hipId] = map;
        if (hipId === state.activeHipId) state.ganyanByRace = map;
    }

    async function fetchBtOddsForHip(hipId, hipName, refresh) {
        if (state.btLoadingHips[hipId] && !refresh) return;
        state.btLoadingHips[hipId] = true;
        state.btLoading = true;
        try {
            const res = await fetch(
                '/api/public/bitalih-fob?hipodrom=' + encodeURIComponent(hipName)
                + (refresh ? '&refresh=1' : ''),
                { cache: 'no-store' }
            );
            const data = await res.json();
            if (data.success) {
                state.btDataByHipId[hipId] = data;
                if (hipId === state.activeHipId) {
                    state.btData = data;
                    state.btHipId = hipId;
                }
            }
        } catch (_) { /* sessiz */ }
        finally {
            state.btLoadingHips[hipId] = false;
            state.btLoading = Object.values(state.btLoadingHips).some(Boolean);
        }
    }

    async function loadOddsForHip(hip, refresh) {
        if (!hip) return;
        const hasPending = (hip.races || []).some((r) => r.status === 'pending');
        if (!hasPending) return;
        const iso = state.iso || getIso();
        const raceNos = (hip.races || []).filter((r) => r.status === 'pending').map((r) => r.raceNo);
        await Promise.all([
            fetchBtOddsForHip(hip.id, hip.name, refresh),
            fetchGanyanForHip(iso, hip.id, hip.name, raceNos, refresh)
        ]);
        const captured = captureOddsForHip(hip);
        if (captured) scheduleOddsPersist(captured);
    }

    async function loadOddsForActiveHip(refresh) {
        const data = state.data;
        const hip = data?.hipodromlar?.find((h) => h.id === state.activeHipId);
        if (!hip) return;
        await loadOddsForHip(hip, refresh);
        render();
    }

    async function loadOddsForAllHips(refresh) {
        const hips = state.data?.hipodromlar || [];
        if (!hips.length) return;
        await Promise.all(hips.map((h) => loadOddsForHip(h, refresh)));
        render();
    }

    function startOddsPolling() {
        stopOddsPolling();
        state.oddsPollTimer = setInterval(() => {
            if ($('#panel-hazir')?.classList.contains('active')) {
                loadOddsForAllHips(true);
            }
        }, ODDS_POLL_MS);
    }

    function startPolling() {
        stopPolling();
        state.pollTimer = setInterval(() => {
            if ($('#panel-hazir')?.classList.contains('active')) {
                loadHazirKupon({ silent: true });
            }
        }, POLL_MS);
    }

    async function loadHazirKupon(opts = {}) {
        const root = $('#pubHazirRoot');
        if (!root) return;
        const iso = opts.iso || getIso();
        if (!opts.silent) {
            state.loading = true;
            root.innerHTML = '<div class="pub-loading"><div class="pub-spinner"></div>Hazır kupon tahminleri yükleniyor…</div>';
        }
        try {
            const qs = '/api/public/hazir-kupon?iso=' + encodeURIComponent(iso)
                + (opts.refresh ? '&refresh=1' : '');
            const res = await fetch(qs, { cache: 'no-store' });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Yükleme hatası');
            const prevIso = state.iso;
            state.data = data;
            const resolvedIso = data.iso || iso;
            const resolvedTarih = data.tarih || '';
            if (prevIso && prevIso !== resolvedIso) {
                state.oddsSnapshot = {};
            }
            state.iso = resolvedIso;
            hydrateOddsSnapshots(data);
            if (!state.kasa || state.kasa.iso !== resolvedIso) {
                state.kasa = await loadKasa(resolvedIso, resolvedTarih);
            } else if (resolvedTarih && !state.kasa.tarih) {
                state.kasa.tarih = resolvedTarih;
            }
            await settleKasaBets(data);
            if (data.savedSimulation?.kayit?.stages?.length) {
                state.useSavedSim = true;
            }
            if (!state.activeHipId && data.hipodromlar?.length) {
                state.activeHipId = data.hipodromlar[0].id;
            }
            render();
            loadOddsForAllHips(false);
            if (!opts.silent) {
                startPolling();
                startOddsPolling();
            }
        } catch (err) {
            if (!opts.silent) {
                root.innerHTML = '<div class="pub-hazir-error">'
                    + '<div class="pub-empty-icon">⚠</div>'
                    + '<h3>Yüklenemedi</h3>'
                    + '<p>' + escapeHtml(err.message) + '</p>'
                    + '<button type="button" class="pub-hazir-refresh-btn" id="pubHazirRetry">Tekrar dene</button>'
                    + '</div>';
                $('#pubHazirRetry')?.addEventListener('click', () => loadHazirKupon({ refresh: true }));
            }
        } finally {
            state.loading = false;
        }
    }

    function renderCalibrationBanner(cal) {
        if (!cal?.columns) return '';
        const pool = cal.pool || {};
        const cols = COL_KEYS.map((k) => {
            const c = cal.columns[k];
            const top4 = c?.top4?.markerHitPct;
            const race = c?.top4?.raceHitAmongMarkedPct;
            return '<div class="pub-hazir-cal-col" style="--col-accent:' + COL_COLORS[k] + '">'
                + '<span class="pub-hazir-cal-key">' + k + '</span>'
                + '<span class="pub-hazir-cal-val">' + (top4 != null ? top4 + '%' : '—') + '</span>'
                + '<span class="pub-hazir-cal-sub">işaret→ilk4</span>'
                + '<span class="pub-hazir-cal-race">' + (race != null ? race + '% koşu' : '') + '</span>'
                + '</div>';
        }).join('');

        return '<div class="pub-hazir-cal-banner pub-hazir-premium-card">'
            + '<div class="pub-hazir-cal-hdr">'
            + '<span class="pub-hazir-premium-badge">PREMIUM</span>'
            + '<h3>Kayıt Kalibrasyonu</h3>'
            + '<p>' + (cal.kayitRaceCount || 0) + ' sonuçlu koşu · TEK/S2/S1/YUV geçmiş isabet oranları</p>'
            + '</div>'
            + '<div class="pub-hazir-cal-grid">' + cols + '</div>'
            + '<div class="pub-hazir-pool-stats">'
            + '<div class="pub-hazir-pool-stat"><b>' + (pool.raceHitPct != null ? pool.raceHitPct + '%' : '—') + '</b><span>Havuz koşu isabeti</span></div>'
            + '<div class="pub-hazir-pool-stat"><b>' + (pool.pickHitPct != null ? pool.pickHitPct + '%' : '—') + '</b><span>Seçim isabeti</span></div>'
            + '<div class="pub-hazir-pool-stat"><b>' + (pool.horseTop4Pct != null ? pool.horseTop4Pct + '%' : '—') + '</b><span>İşaretli at→ilk4</span></div>'
            + '<div class="pub-hazir-pool-stat"><b>' + (pool.avgHitsPerRace != null ? pool.avgHitsPerRace : '—') + '</b><span>Ort. isabet/koşu</span></div>'
            + '</div></div>';
    }

    function formatKayitTime(val) {
        if (!val) return '—';
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return String(val);
        return d.toLocaleString('tr-TR', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    }

    function resolveDisplaySim(data, liveSim) {
        const saved = data?.savedSimulation;
        if (state.useSavedSim && saved?.kayit?.stages?.length) {
            const k = saved.kayit;
            return {
                startBank: k.startBank ?? START_BANK,
                stake: k.stake ?? STAKE,
                finishedRaceCount: k.finishedRaceCount ?? liveSim.finishedRaceCount,
                pendingRaceCount: k.pendingRaceCount ?? liveSim.pendingRaceCount,
                stages: k.stages,
                isSaved: true,
                savedAt: k.savedAt || saved.guncelleme || saved.kayitTarihi,
                savedDurum: saved.durum || k.status
            };
        }
        return Object.assign({}, liveSim, { isSaved: false });
    }

    async function saveSimulationKayit(liveSim) {
        const data = state.data;
        if (!data || state.savingSim) return;
        if (!liveSim?.finishedRaceCount) {
            window.alert('Kaydetmek için en az bir sonuçlanmış koşu gerekli.');
            return;
        }
        if (liveSim.pendingRaceCount > 0) {
            const ok = window.confirm(
                liveSim.pendingRaceCount + ' koşu henüz bitmedi. Kısmi kayıt olarak saklanacak. Devam?'
            );
            if (!ok) return;
        }
        state.savingSim = true;
        render();
        try {
            const res = await fetch('/api/public/hazir-kupon-sim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    iso: data.iso,
                    tarih: data.tarih,
                    simulation: liveSim,
                    gunlukBasari: data.gunlukBasari,
                    hipodromlar: (data.hipodromlar || []).map((h) => ({
                        id: h.id,
                        name: h.name,
                        raceCount: h.races?.length || 0,
                        finishedCount: h.finishedCount || 0
                    })),
                    status: liveSim.pendingRaceCount === 0 ? 'complete' : 'partial'
                })
            });
            const result = await res.json();
            if (!result.success) throw new Error(result.error || 'Kayıt başarısız');
            state.useSavedSim = true;
            await loadHazirKupon({ silent: true, iso: data.iso });
            state.savingSim = false;
        } catch (err) {
            window.alert(err.message || 'Kayıt hatası');
            state.savingSim = false;
            render();
        }
    }

    function renderSimHistory(data) {
        const agg = data?.simStats?.aggregate;
        const recent = (data?.simStats?.recent || []).filter((r) => r.tarih !== data.tarih);
        if (!agg?.days && !recent.length) return '';

        const aggCards = (agg?.stages || []).map((s) => {
            const pnlCls = (s.avgPnl || 0) > 0 ? 'pos' : ((s.avgPnl || 0) < 0 ? 'neg' : '');
            return '<div class="pub-hazir-hist-stage">'
                + '<span class="pub-hazir-hist-stage-lbl">K' + s.id + '</span>'
                + '<b class="' + pnlCls + '">' + (s.avgPnl != null ? formatMoney(s.avgPnl) : '—') + '</b>'
                + '<small>ort. k/z</small>'
                + '</div>';
        }).join('');

        const rows = recent.map((r) => {
            const s4 = (r.stageSummary || []).find((x) => x.id === 4);
            const pnlCls = (s4?.pnl || 0) > 0 ? 'pos' : ((s4?.pnl || 0) < 0 ? 'neg' : '');
            const durum = r.durum === 'complete' ? 'Tam' : 'Kısmi';
            return '<tr class="pub-hazir-hist-row" data-iso="' + escapeHtml(r.iso || '') + '">'
                + '<td>' + escapeHtml(r.tarih) + '</td>'
                + '<td>' + (r.finishedRaceCount || 0) + '/' + (r.totalRaceCount || 0) + '</td>'
                + '<td><span class="pub-hazir-hist-durum ' + (r.durum === 'complete' ? 'complete' : 'partial') + '">' + durum + '</span></td>'
                + '<td class="' + pnlCls + '">' + (s4?.pnl != null ? formatMoney(s4.pnl) : '—') + '</td>'
                + '<td>' + (s4?.endBank != null ? formatMoney(s4.endBank) : '—') + '</td>'
                + '<td class="pub-hazir-hist-date">' + formatKayitTime(r.kayitTarihi) + '</td>'
                + '</tr>';
        }).join('');

        return '<div class="pub-hazir-hist pub-hazir-premium-card">'
            + '<div class="pub-hazir-hist-hdr">'
            + '<h3>Simülasyon Geçmişi</h3>'
            + '<span class="pub-hazir-hist-meta">' + (agg?.days || 0) + ' gün kayıtlı'
            + (agg?.completeDays ? ' · ' + agg.completeDays + ' tam' : '')
            + '</span></div>'
            + (agg?.days ? '<div class="pub-hazir-hist-agg">' + aggCards + '</div>' : '')
            + (rows
                ? '<div class="pub-hazir-hist-table-wrap"><table class="pub-hazir-hist-table">'
                    + '<thead><tr><th>Tarih</th><th>Koşu</th><th>Durum</th><th>K4 K/Z</th><th>K4 Sermaye</th><th>Kayıt</th></tr></thead>'
                    + '<tbody>' + rows + '</tbody></table></div>'
                : '<p class="pub-hazir-sim-empty">Henüz başka gün kaydı yok.</p>')
            + '</div>';
    }

    function renderBankrollPanel(sim, meta) {
        if (!sim) return '';
        const stageCards = sim.stages.map((s) => {
            const pnlCls = s.pnl > 0 ? 'pos' : (s.pnl < 0 ? 'neg' : '');
            const betList = s.bets.length
                ? '<details class="pub-hazir-sim-details"><summary>'
                    + s.totalBets + ' bahis detayı</summary><div class="pub-hazir-sim-log">'
                    + s.bets.map((b) => {
                        const cls = b.won ? 'win' : 'lose';
                        const finish = b.finishPos != null ? b.finishPos + '.' : '—';
                        const payoutLabel = b.won
                            ? '+' + formatMoney(b.payout || (STAKE * b.odd))
                            : formatMoney(b.pnl);
                        return '<div class="pub-hazir-sim-bet ' + cls + '">'
                            + '<span class="pub-hazir-sim-bet-race">' + escapeHtml(b.hipName) + ' K' + b.raceNo + '</span>'
                            + '<span class="pub-hazir-sim-bet-type">' + escapeHtml(b.betLabel) + '</span>'
                            + '<span class="pub-hazir-sim-bet-horse">' + escapeHtml(b.horseNo) + ' ' + escapeHtml((b.horseName || '').slice(0, 16)) + '</span>'
                            + '<span class="pub-hazir-sim-bet-odd">@' + b.odd + ' × ' + (b.stake || STAKE) + '₺</span>'
                            + '<span class="pub-hazir-sim-bet-res">' + (b.won ? '✓' : '✗') + ' ' + finish + '</span>'
                            + '<span class="pub-hazir-sim-bet-pnl">' + payoutLabel + '</span>'
                            + '</div>';
                    }).join('')
                    + '</div></details>'
                : '<p class="pub-hazir-sim-empty">Henüz sonuçlanmış koşu yok.</p>';

            return '<div class="pub-hazir-sim-stage pub-hazir-premium-card">'
                + '<div class="pub-hazir-sim-stage-hdr">'
                + '<span class="pub-hazir-sim-kademe">Kademe ' + s.id + '</span>'
                + '<h4>' + escapeHtml(s.label.replace(/^Kademe \d+ — /, '')) + '</h4>'
                + '</div>'
                + '<div class="pub-hazir-sim-metrics">'
                + '<div class="pub-hazir-sim-metric"><b>' + formatMoney(sim.startBank) + '</b><span>Başlangıç</span></div>'
                + '<div class="pub-hazir-sim-metric"><b>' + formatMoney(s.endBank) + '</b><span>Güncel sermaye</span></div>'
                + '<div class="pub-hazir-sim-metric ' + pnlCls + '"><b>' + formatMoney(s.pnl) + '</b><span>Kar / Zarar</span></div>'
                + '<div class="pub-hazir-sim-metric"><b>' + s.wins + '/' + s.totalBets + '</b><span>İsabet</span></div>'
                + '</div>'
                + '<p class="pub-hazir-sim-meta">'
                + sim.stake + ' ₺ / bahis · ' + s.bets.length + ' sonuçlandı'
                + (s.pendingBets ? ' · ' + s.pendingBets + ' bekliyor' : '')
                + (s.skipped ? ' · ' + s.skipped + ' oran yok' : '')
                + '</p>'
                + betList
                + '</div>';
        }).join('');

        const savedBadge = sim.isSaved
            ? '<span class="pub-hazir-sim-saved">Kayıtlı · ' + formatKayitTime(sim.savedAt)
                + (sim.savedDurum === 'complete' ? ' · Tam gün' : ' · Kısmi') + '</span>'
            : '';
        const canSave = (meta?.liveSim?.finishedRaceCount || 0) > 0;
        const saveLabel = sim.isSaved ? 'Güncelle' : 'Günü Kaydet';
        const viewToggle = meta?.hasSaved
            ? '<button type="button" class="pub-hazir-sim-toggle' + (state.useSavedSim ? ' active' : '') + '" id="pubHazirSimToggle">'
                + (state.useSavedSim ? 'Kayıtlı' : 'Canlı') + '</button>'
            : '';

        return '<div class="pub-hazir-sim pub-hazir-premium-card">'
            + '<div class="pub-hazir-sim-hdr">'
            + '<div class="pub-hazir-sim-hdr-top">'
            + '<h3>Sermaye Simülasyonu</h3>'
            + '<div class="pub-hazir-sim-actions">'
            + viewToggle
            + '<button type="button" class="pub-hazir-sim-save-btn" id="pubHazirSimSave"'
            + (canSave && !state.savingSim ? '' : ' disabled')
            + '>' + (state.savingSim ? 'Kaydediliyor…' : saveLabel) + '</button>'
            + '</div></div>'
            + '<p>Her koşuda tahmin havuzundaki <b>en yüksek oranlı</b> ata ' + STAKE + ' ₺ · Başlangıç ' + START_BANK + ' ₺'
            + ' · Kazanç = oran × ' + STAKE + ' ₺</p>'
            + savedBadge
            + '<span class="pub-hazir-sim-status">' + sim.finishedRaceCount + ' koşu sonuçlandı'
            + (sim.pendingRaceCount ? ' · ' + sim.pendingRaceCount + ' bekliyor' : '')
            + (state.btLoading && !sim.isSaved ? ' · oranlar güncelleniyor…' : '')
            + '</span>'
            + '</div>'
            + '<div class="pub-hazir-sim-stages">' + stageCards + '</div>'
            + '</div>';
    }

    function renderGunlukBasari(g) {
        if (!g) return '';
        return '<div class="pub-hazir-gunluk pub-hazir-premium-card">'
            + '<div class="pub-hazir-gunluk-hdr"><h3>Bugünkü Başarı</h3>'
            + '<span class="pub-hazir-gunluk-meta">' + g.finished + '/' + g.races + ' koşu sonuçlandı</span></div>'
            + '<div class="pub-hazir-gunluk-metrics">'
            + '<div class="pub-hazir-metric ' + (g.poolHitPct >= 50 ? 'pos' : '') + '">'
            + '<span class="pub-hazir-metric-val">' + (g.poolHitPct != null ? g.poolHitPct + '%' : '—') + '</span>'
            + '<span class="pub-hazir-metric-lbl">Havuz isabet</span></div>'
            + '<div class="pub-hazir-metric">'
            + '<span class="pub-hazir-metric-val">' + (g.pickHitPct != null ? g.pickHitPct + '%' : '—') + '</span>'
            + '<span class="pub-hazir-metric-lbl">Seçim isabet</span></div>'
            + '<div class="pub-hazir-metric">'
            + '<span class="pub-hazir-metric-val">' + (g.avgHitsPerRace != null ? g.avgHitsPerRace : '—') + '</span>'
            + '<span class="pub-hazir-metric-lbl">Ort. isabet</span></div>'
            + '</div></div>';
    }

    function renderMarkerTags(markers) {
        if (!markers?.length) return '<span class="pub-hazir-no-mark">—</span>';
        return markers.map((m) =>
            '<span class="pub-hazir-mtag" style="--tag-color:' + (COL_COLORS[m.col] || '#666') + '" title="' + escapeHtml(m.col + ': ' + m.glyphs) + '">'
            + escapeHtml(m.col) + '<small>' + escapeHtml(m.glyphs) + '</small></span>'
        ).join('');
    }

    function formatTahminSkorCell(p) {
        if (!p.inTahmin || p.tahminSkor == null) return '';
        const rankHint = p.tahminRank != null ? ' (T#' + p.tahminRank + ')' : '';
        return '<span class="pub-hazir-tahmin-skor" title="Tahminler skoru' + rankHint + '">%'
            + escapeHtml(String(p.tahminSkor)) + '</span>';
    }

    function renderRaceCard(race, hip) {
        const kasaBet = state.kasa?.bets?.[kasaBetKey(String(hip.id), race.raceNo)] || null;
        const statusCls = race.status === 'finished'
            ? (race.poolHit ? 'hit' : 'miss')
            : (race.status === 'pending' ? 'pending' : 'empty');
        const statusLabel = race.status === 'finished'
            ? (race.poolHit ? '✓ ' + race.hitCount + '/4 isabet' : '✗ ' + (race.hitCount || 0) + '/4')
            : (race.status === 'pending' ? 'Bekliyor' : 'İşaret yok');

        const oddHeaders = BET_KEYS.map((k) => '<th class="pub-hazir-odd-th">' + BET_LABELS[k] + '</th>').join('');

        let picksHtml = '';
        if (race.picks?.length) {
            picksHtml = '<div class="pub-hazir-table-wrap"><table class="pub-hazir-pick-table"><thead><tr>'
                + oddHeaders
                + '<th class="pub-hazir-ayak-th">#</th><th>No</th><th>At</th><th>İşaretler</th><th>İlk4% · Skor</th><th>Pay</th>'
                + (race.status === 'finished' ? '<th>Sonuç</th>' : '')
                + '</tr></thead><tbody>'
                + race.picks.map((p) => {
                    const oddCells = BET_KEYS.map((k) =>
                        formatOddPickCell(p, race.raceNo, k, hip.id, race, kasaBet)
                    ).join('');
                    const resultCell = race.status === 'finished'
                        ? '<td class="' + (p.hit ? 'pub-hazir-hit' : 'pub-hazir-miss') + '">'
                        + (p.hit ? '✓ ' + (p.finishPos || '?') + '.' : '✗')
                        + '</td>'
                        : '';
                    const nameCls = 'pub-hazir-name-td' + (p.inTahmin ? ' pub-hazir-name-match' : '');
                    const ilk4Cell = '<span class="pub-hazir-pct">' + p.top4Prob + '%</span>'
                        + formatTahminSkorCell(p);
                    return '<tr class="' + (p.hit ? 'pub-hazir-row-hit' : '') + (p.inTahmin ? ' pub-hazir-row-tahmin-match' : '') + '">'
                        + oddCells
                        + '<td class="pub-hazir-ayak-td"><span class="pub-hazir-ayak">' + p.rank + '</span></td>'
                        + '<td><b>' + escapeHtml(p.no) + '</b></td>'
                        + '<td class="' + nameCls + '">' + escapeHtml((p.name || '').slice(0, 22)) + '</td>'
                        + '<td class="pub-hazir-markers">' + renderMarkerTags(p.markers) + '</td>'
                        + '<td class="pub-hazir-ilk4-td">' + ilk4Cell + '</td>'
                        + '<td>' + (p.raceSharePct || 0) + '%</td>'
                        + resultCell
                        + '</tr>';
                }).join('')
                + '</tbody></table></div>';
        } else {
            picksHtml = '<p class="pub-hazir-empty-race">Bu koşuda TEK/S2/S1/YUV işareti taşıyan at yok.</p>';
        }

        const mesafeLabel = race.mesafe ? escapeHtml(String(race.mesafe)) + 'm' : '';
        const saatLabel = race.saat ? escapeHtml(race.saat) : '';
        const metaParts = [mesafeLabel, saatLabel].filter(Boolean).join(' · ');

        const actualLine = race.status === 'finished' && race.actualTop4?.length
            ? '<div class="pub-hazir-actual">Gerçek ilk-4: <b>' + race.actualTop4.join(' · ') + '</b></div>'
            : '';

        const tahminBadge = race.tahminMatchCount > 0
            ? '<span class="pub-hazir-tahmin-badge">' + race.tahminMatchCount + '/4 tahmin</span>'
            : '';

        const kasaLine = kasaBet
            ? '<div class="pub-hazir-kasa-race-bet">Bahsiniz: <b>' + escapeHtml(kasaBet.horseNo) + ' '
            + escapeHtml((kasaBet.horseName || '').slice(0, 18)) + '</b> · '
            + escapeHtml(kasaBet.betLabel) + ' @' + kasaBet.odd
            + (kasaBet.status === 'won' ? ' <span class="pub-hazir-kasa-win">+' + formatMoney(kasaBet.pnl) + '</span>'
                : (kasaBet.status === 'lost' ? ' <span class="pub-hazir-kasa-lose">' + formatMoney(kasaBet.pnl) + '</span>' : ''))
            + '</div>'
            : (race.status === 'pending' && race.picks?.length
                ? '<div class="pub-hazir-kasa-race-hint">Oran hücresine tıklayarak bahis yapın</div>'
                : '');

        return '<div class="pub-hazir-race-card pub-hazir-premium-card ' + statusCls + '" data-race="' + race.raceNo + '">'
            + '<div class="pub-hazir-race-hdr">'
            + '<span class="pub-hazir-race-no">Koşu ' + race.raceNo + '</span>'
            + (metaParts ? '<span class="pub-hazir-race-meta">' + metaParts + '</span>' : '')
            + tahminBadge
            + '<span class="pub-hazir-race-status pub-hazir-status-' + statusCls + '">' + statusLabel + '</span>'
            + '</div>'
            + kasaLine
            + picksHtml
            + actualLine
            + '</div>';
    }

    function render() {
        const root = $('#pubHazirRoot');
        const data = state.data;
        if (!root || !data) return;

        const hips = data.hipodromlar || [];
        const activeHip = hips.find((h) => h.id === state.activeHipId) || hips[0];

        const hipTabs = hips.map((h) =>
            '<button type="button" class="pub-hazir-hip-tab' + (h.id === activeHip?.id ? ' active' : '') + '" data-hip="' + escapeHtml(h.id) + '">'
            + escapeHtml(h.name)
            + '<span class="pub-hazir-hip-badge">' + (h.finishedCount || 0) + '/' + (h.races?.length || 0) + '</span>'
            + '</button>'
        ).join('');

        const racesHtml = (activeHip?.races || []).map((r) => renderRaceCard(r, activeHip)).join('');

        const liveSim = runBankrollSimulation(data);
        const displaySim = resolveDisplaySim(data, liveSim);
        const hasSaved = !!data.savedSimulation?.kayit?.stages?.length;

        root.innerHTML = ''
            + '<div class="pub-hazir-toolbar">'
            + '<div><h2 class="pub-hazir-title">Hazır Kupon — İlk 4 Tahmin</h2>'
            + '<p class="pub-hazir-subtitle">TEK · S2 · S1 · YUV işaret analizi · ' + escapeHtml(data.tarih || '') + '</p>'
            + '<p class="pub-hazir-match-legend"><span class="pub-hazir-name-match-sample">Kırmızı at adı</span>'
            + ' = Tahminler ve Hazır Kupon ortak · mor <b>%skor</b> = Tahminler skoru</p></div>'
            + '<button type="button" class="pub-hazir-refresh-btn" id="pubHazirRefresh" title="Yenile">↻ Yenile</button>'
            + '</div>'
            + renderCalibrationBanner(data.calibration)
            + renderGunlukBasari(data.gunlukBasari)
            + renderKasaPanel()
            + renderBankrollPanel(displaySim, { liveSim, hasSaved })
            + renderSimHistory(data)
            + '<div class="pub-hazir-hip-tabs" role="tablist">' + hipTabs + '</div>'
            + '<div class="pub-hazir-races">' + (racesHtml || '<div class="pub-empty"><p>Bugün için program yok.</p></div>') + '</div>';

        $$('.pub-hazir-hip-tab', root).forEach((btn) => {
            btn.addEventListener('click', () => {
                state.activeHipId = btn.dataset.hip;
                state.btData = state.btDataByHipId[state.activeHipId] || null;
                state.ganyanByRace = state.ganyanByHipId[state.activeHipId] || {};
                render();
                if (!state.btDataByHipId[state.activeHipId]) {
                    const hip = hips.find((h) => h.id === state.activeHipId);
                    if (hip) loadOddsForHip(hip, false);
                }
            });
        });
        $('#pubHazirRefresh')?.addEventListener('click', () => {
            loadHazirKupon({ refresh: true });
            loadOddsForAllHips(true);
        });
        $('#pubHazirSimSave')?.addEventListener('click', () => saveSimulationKayit(liveSim));
        $('#pubHazirSimToggle')?.addEventListener('click', () => {
            state.useSavedSim = !state.useSavedSim;
            render();
        });
        $('#pubHazirKasaReset')?.addEventListener('click', resetKasa);
        $$('.pub-hazir-odd-pick', root).forEach((cell) => {
            cell.addEventListener('click', () => {
                const raceNo = cell.dataset.raceNo;
                const horseNo = cell.dataset.horseNo;
                const betKey = cell.dataset.betKey;
                const hip = hips.find((h) => h.id === state.activeHipId);
                const race = hip?.races?.find((r) => String(r.raceNo) === String(raceNo));
                const pick = race?.picks?.find((p) => String(p.no) === String(horseNo));
                if (hip && race && pick && betKey) placeKasaBet(hip, race, pick, betKey);
            });
        });
        $$('.pub-hazir-hist-row', root).forEach((row) => {
            row.addEventListener('click', () => {
                const iso = row.dataset.iso;
                if (!iso) return;
                state.useSavedSim = true;
                loadHazirKupon({ iso });
            });
        });
    }

    function init() {
        const root = $('#pubHazirRoot');
        if (!root) return;
        loadHazirKupon();
    }

    function onTabActivate() {
        if (!state.data || state.iso !== getIso()) {
            loadHazirKupon();
        } else {
            startPolling();
            startOddsPolling();
            loadOddsForAllHips(true);
        }
    }

    function onTabDeactivate() {
        stopPolling();
    }

    window.pubHazirKupon = { init, onTabActivate, onTabDeactivate, load: loadHazirKupon };
})();
