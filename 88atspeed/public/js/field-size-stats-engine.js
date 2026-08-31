/**
 * Geçmiş koşulardaki at sayısı istatistikleri (çıkan/koşmaz hariç at_sayisi)
 */
const FieldSizeStatsEngine = {
    RECENT_WINDOWS: [5, 4, 3, 2, 1],

    FS_LABELS: {
        pctLabel: 'AS%',
        matchLabel: 'AS-KOŞU',
        formLabel: 'AS-FORM',
        adjLabel: 'AS+'
    },

    normalizeProgramTarih(tarih) {
        if (!tarih) return '';
        return String(tarih).trim().replace(/\//g, '.');
    },

    /** Program günü koşusunu geçmiş MAX/KOŞU istatistiklerinden çıkar */
    filterKosularForCalc(kosular, programTarih) {
        if (!programTarih || !kosular?.length) return kosular || [];
        const programNorm = this.normalizeProgramTarih(programTarih);
        if (!programNorm) return kosular || [];
        return kosular.filter(k => this.normalizeProgramTarih(k.tarih) !== programNorm);
    },

    parseSira(raw) {
        if (raw == null || raw === '' || raw === '-') return null;
        const s = String(raw).trim();
        if (/koşmaz|çekildi|kosmaz/i.test(s)) return null;
        const n = parseInt(s.replace(/[^\d]/g, ''), 10);
        return (isNaN(n) || n < 1) ? null : n;
    },

    isKosmazName(name) {
        if (!name) return false;
        return /\(\s*koşmaz\s*\)/i.test(name)
            || /\(\s*kosmaz\s*\)/i.test(name)
            || /\(\s*çekildi\s*\)/i.test(name)
            || /\(\s*cekildi\s*\)/i.test(name);
    },

    raceFieldSize(race) {
        return (race?.horses || []).filter(h => !this.isKosmazName(h.name)).length;
    },

    sortKosularNewest(kosular) {
        return [...(kosular || [])].sort((a, b) => {
            const da = (a.tarih || '').split('.').reverse().join('');
            const db = (b.tarih || '').split('.').reverse().join('');
            return db.localeCompare(da);
        });
    },

    recentSlice(kosular, windowSize) {
        if (!windowSize) return kosular || [];
        return this.sortKosularNewest(kosular).slice(0, windowSize);
    },

    validRaces(kosular) {
        return (kosular || []).filter(k => {
            const fs = Number(k.at_sayisi);
            const sira = this.parseSira(k.sira);
            return fs > 0 && sira != null;
        });
    },

    racesWithSira(kosular) {
        return (kosular || []).filter(k => this.parseSira(k.sira) != null);
    },

    fieldSizeMatch(atSayisi, hedef) {
        const a = Number(atSayisi);
        const b = Number(hedef);
        return a > 0 && b > 0 && a === b;
    },

    matchedRaces(kosular, hedef) {
        if (hedef == null || hedef === '') return [];
        return this.validRaces(kosular).filter(k => this.fieldSizeMatch(k.at_sayisi, hedef));
    },

    _computeStatsCore(kosular, hedef) {
        const all = kosular || [];
        const fsRaces = this.validRaces(all);
        const siraRaces = this.racesWithSira(all);
        const missing = all.length - fsRaces.length;

        let max1 = 0;
        let max12 = 0;
        let max123 = 0;
        let max1234 = 0;
        let cnt1 = 0;
        let cnt12 = 0;
        let cnt123 = 0;
        let cnt1234 = 0;
        let cnt2 = 0;
        let cnt3 = 0;
        let cnt4 = 0;
        const gecmisList = [];

        for (const k of fsRaces) {
            const fs = Number(k.at_sayisi);
            const sira = this.parseSira(k.sira);
            gecmisList.push({ tarih: k.tarih, fs, sira });
            if (sira === 1) max1 = Math.max(max1, fs);
            if (sira <= 2) max12 = Math.max(max12, fs);
            if (sira <= 3) max123 = Math.max(max123, fs);
            if (sira <= 4) max1234 = Math.max(max1234, fs);
        }

        for (const k of siraRaces) {
            const sira = this.parseSira(k.sira);
            if (sira === 1) { cnt1++; cnt12++; cnt123++; cnt1234++; }
            else if (sira === 2) { cnt2++; cnt12++; cnt123++; cnt1234++; }
            else if (sira === 3) { cnt3++; cnt123++; cnt1234++; }
            else if (sira === 4) { cnt4++; cnt1234++; }
        }

        const hasHedef = hedef != null && hedef !== '';
        const matched = hasHedef ? this.matchedRaces(all, hedef) : [];
        let matchCount = null;
        let matchPct = null;
        let mCnt1 = cnt1;
        let mCnt2 = cnt2;
        let mCnt3 = cnt3;
        let mCnt4 = cnt4;

        if (hasHedef) {
            matchCount = matched.length;
            matchPct = fsRaces.length
                ? Math.round(100 * matched.length / fsRaces.length)
                : null;
            mCnt1 = 0;
            mCnt2 = 0;
            mCnt3 = 0;
            mCnt4 = 0;
            for (const k of matched) {
                const sira = this.parseSira(k.sira);
                if (sira === 1) mCnt1++;
                else if (sira === 2) mCnt2++;
                else if (sira === 3) mCnt3++;
                else if (sira === 4) mCnt4++;
            }
        }

        return {
            hedef: hasHedef ? String(hedef) : null,
            hedefAbbrev: hasHedef ? String(hedef) : null,
            kosuSayisi: fsRaces.length,
            kosuSayisiSira: siraRaces.length,
            matchCount,
            matchPct,
            missingFieldSize: missing,
            max1: max1 || null,
            max12: max12 || null,
            max123: max123 || null,
            max1234: max1234 || null,
            cnt1: hasHedef ? mCnt1 : cnt1,
            cnt2: hasHedef ? mCnt2 : cnt2,
            cnt3: hasHedef ? mCnt3 : cnt3,
            cnt4: hasHedef ? mCnt4 : cnt4,
            cnt12,
            cnt123,
            cnt1234,
            gecmisStr: gecmisList.length
                ? gecmisList.map(x => x.fs).join('→')
                : (siraRaces.length ? siraRaces.map(k => this.parseSira(k.sira)).join('→') : '—'),
            gecmisList
        };
    },

    computeStats(kosular, programTarih, hedefFieldSize) {
        const calcKosular = programTarih
            ? this.filterKosularForCalc(kosular, programTarih)
            : (kosular || []);
        const hedef = (hedefFieldSize != null && hedefFieldSize !== '')
            ? Number(hedefFieldSize) : null;
        const base = this._computeStatsCore(calcKosular, hedef);
        const windows = {};
        for (const w of this.RECENT_WINDOWS) {
            windows[w] = this._computeStatsCore(this.recentSlice(calcKosular, w), hedef);
        }
        if (hedef == null || !Number.isFinite(hedef) || hedef < 1) {
            return Object.assign(base, { windows });
        }

        const formTrend = this.computeRecentFormTrend(calcKosular, hedef);
        const asAdj = this.computeAdjustedFieldSizeScore(base.matchPct, formTrend, calcKosular, hedef);
        const genBlock = this._computeGeneralBlock(calcKosular, hedef);
        const full = Object.assign(base, { windows, formTrend, asAdj }, genBlock);
        full.basSuccess = this.computeBasSuccessScore(full);
        return full;
    },

    formatPct(pct) {
        return pct != null ? '%' + pct : '—';
    },

    _placementScore(sira) {
        if (typeof SehirStatsEngine !== 'undefined') {
            return SehirStatsEngine.placementScore(sira);
        }
        const n = this.parseSira(sira);
        if (n == null || n < 1) return null;
        if (n === 1) return 100;
        if (n === 2) return 88;
        if (n === 3) return 76;
        if (n === 4) return 64;
        return Math.max(12, 64 - (n - 4) * 7);
    },

    _weightedSlope(points) {
        if (typeof SehirStatsEngine !== 'undefined') {
            return SehirStatsEngine._weightedSlope(points);
        }
        let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            sw += p.w;
            sx += p.w * p.x;
            sy += p.w * p.y;
            sxx += p.w * p.x * p.x;
            sxy += p.w * p.x * p.y;
        }
        const denom = sw * sxx - sx * sx;
        return denom ? (sw * sxy - sx * sy) / denom : null;
    },

    _avgPlacementFromCounts(c1, c2, c3, c4, n) {
        const total = Number(n) || 0;
        if (!total) return 0;
        const pts = (Number(c1) || 0) * 100
            + (Number(c2) || 0) * 88
            + (Number(c3) || 0) * 76
            + (Number(c4) || 0) * 64;
        return Math.round(pts / total);
    },

    _effectiveFormPct(formTrend, basePct, missingMin) {
        if (formTrend?.pct != null) return formTrend.pct;
        const base = basePct != null ? basePct : 0;
        return Math.max(0, 50 - Math.round(Math.max(missingMin, base * 0.18)));
    },

    computeRecentFormTrend(calcKosular, hedef, opts) {
        const L = this.FS_LABELS;
        const allScope = !!(opts && opts.allScope);
        const formLabel = allScope ? 'G-FORM' : L.formLabel;
        const empty = {
            pct: null, display: '—', delta: null, slope: null,
            rising: false, falling: false,
            tooltip: allScope
                ? 'Son 5 koşuda en az 2 dereceli koşu gerekir'
                : 'Son 5 koşuda hedef alanda en az 2 dereceli koşu gerekir',
            matchSamples: 0
        };
        if (hedef == null || !Number.isFinite(hedef)) return empty;

        const windowSize = (opts && opts.windowSize != null) ? opts.windowSize : 5;
        const minSamples = (opts && opts.minSamples != null) ? opts.minSamples : 2;
        const recent = this.recentSlice(calcKosular || [], windowSize);
        if (!recent.length) return empty;

        const chronological = [...recent].reverse();
        const samples = [];
        const tipLines = allScope
            ? ['Son ' + windowSize + ' koşu · tüm geçerli alanlar']
            : ['Son ' + windowSize + ' koşu · hedef alan: ' + hedef + ' at'];

        for (let xi = 0; xi < chronological.length; xi++) {
            const k = chronological[xi];
            const fs = Number(k.at_sayisi);
            if (!(fs > 0)) continue;
            const matched = allScope || this.fieldSizeMatch(fs, hedef);
            if (!allScope && !matched) {
                tipLines.push((k.tarih || '?') + ': ' + fs + ' at (hedef dışı)');
                continue;
            }
            const sira = this.parseSira(k.sira);
            const score = this._placementScore(sira);
            if (score == null) continue;
            const w = Math.pow(xi + 1, 1.6);
            samples.push({ x: xi, y: score, w, sira, tarih: k.tarih, fs });
            tipLines.push((k.tarih || '?') + ': ' + fs + ' at · ' + sira + '. → puan ' + score);
        }

        if (samples.length < minSamples) {
            return Object.assign({}, empty, { matchSamples: samples.length });
        }

        let slope = this._weightedSlope(samples);
        if (slope == null && samples.length >= 2) {
            const a = samples[samples.length - 2];
            const b = samples[samples.length - 1];
            slope = (b.y - a.y) / Math.max(1, b.x - a.x);
        }

        const last = samples[samples.length - 1];
        const prev = samples.length >= 2 ? samples[samples.length - 2] : null;
        const stepDelta = prev ? last.y - prev.y : null;

        let olderW = 0, olderS = 0, newerW = 0, newerS = 0;
        const half = Math.floor(samples.length / 2);
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            if (i < half) { olderW += s.w; olderS += s.y * s.w; }
            else { newerW += s.w; newerS += s.y * s.w; }
        }
        const avgOlder = olderW ? olderS / olderW : null;
        const avgNewer = newerW ? newerS / newerW : null;
        const halfDelta = (avgOlder != null && avgNewer != null) ? avgNewer - avgOlder : null;

        const blendDelta = (slope != null ? slope * (windowSize - 1) : 0) * 0.55
            + (halfDelta != null ? halfDelta : 0) * 0.45
            + (stepDelta != null ? stepDelta : 0) * 0.25;
        const pct = Math.round(Math.min(100, Math.max(0, 50 + blendDelta * 1.15)));

        tipLines.push(formLabel + ': %' + pct + ' (50=nötr · yüksek=iyileşme)');

        return {
            pct, display: '%' + pct,
            delta: halfDelta != null ? Math.round(halfDelta) : null,
            slope: slope != null ? Math.round(slope * 10) / 10 : null,
            rising: pct >= 58,
            falling: pct <= 42,
            tooltip: tipLines.join('\n'),
            matchSamples: samples.length,
            samples
        };
    },

    computeRecencyPlacementBonus(calcKosular, hedef, opts) {
        const allScope = !!(opts && opts.allScope) || (opts && opts.placeScope === 'all');
        const empty = { total: 0, parts: [], races: [] };
        if (hedef == null || !Number.isFinite(hedef)) return empty;

        const windowSize = (opts && opts.windowSize != null) ? opts.windowSize : 5;
        const siraPoints = { 1: 10, 2: 6, 3: 4, 4: 2 };
        const recent = this.recentSlice(calcKosular || [], windowSize);
        if (!recent.length) return empty;

        const chronological = [...recent].reverse();
        const n = chronological.length;
        let total = 0;
        const parts = [];
        const races = [];

        for (let i = 0; i < n; i++) {
            const k = chronological[i];
            const recency = n <= 1 ? 1 : 0.35 + 0.65 * (i / (n - 1));
            const fs = Number(k.at_sayisi);
            if (!allScope && !this.fieldSizeMatch(fs, hedef)) {
                const pen = -Math.round(2 * recency);
                total += pen;
                parts.push({ tarih: k.tarih, sira: null, recency, delta: pen, note: 'hedef dışı' });
                races.push({ tarih: k.tarih, sira: null, recency, delta: pen });
                continue;
            }
            if (!(fs > 0)) continue;
            const sira = this.parseSira(k.sira);
            if (sira == null) continue;
            let pts = siraPoints[sira] != null ? siraPoints[sira] : (sira <= 8 ? 0 : -3);
            const delta = Math.round(pts * recency * 10) / 10;
            total += delta;
            parts.push({ tarih: k.tarih, sira, recency, delta, note: fs + ' at ' + sira + '.' });
            races.push({ tarih: k.tarih, sira, recency, delta });
        }

        return { total: Math.round(total * 10) / 10, parts, races };
    },

    computeLastRaceFieldSizeAdj(calcKosular, hedef, opts) {
        const empty = {
            delta: 0, lastFs: null, lastTarih: null, inTarget: null,
            display: '—', tooltip: 'Son koşu bilgisi yok'
        };
        if (hedef == null || !Number.isFinite(hedef)) return empty;

        const bonus = (opts && opts.lastMatchBonus != null) ? opts.lastMatchBonus : 8;
        const penalty = (opts && opts.lastMatchPenalty != null) ? opts.lastMatchPenalty : -10;

        const recent = this.recentSlice(calcKosular || [], 1);
        const last = recent[0];
        if (!last) return empty;
        const fs = Number(last.at_sayisi);
        if (!(fs > 0)) return empty;

        const inTarget = this.fieldSizeMatch(fs, hedef);
        const delta = inTarget ? bonus : penalty;

        return {
            delta,
            lastFs: fs,
            lastTarih: last.tarih || null,
            inTarget,
            display: (delta >= 0 ? '+' : '') + delta,
            tooltip: inTarget
                ? ('Son koşu ' + (last.tarih || '?') + ' ' + fs + ' at = hedef ' + hedef + ' → ödül +' + bonus)
                : ('Son koşu ' + (last.tarih || '?') + ' ' + fs + ' at ≠ hedef ' + hedef + ' → ceza ' + penalty)
        };
    },

    computeAdjustedFieldSizeScore(matchPct, formTrend, calcKosular, hedef, opts) {
        const L = this.FS_LABELS;
        const base = matchPct != null ? matchPct : 0;
        const formScale = (opts && opts.formScale != null) ? opts.formScale : 0.35;
        const missingFormRatio = (opts && opts.missingFormRatio != null) ? opts.missingFormRatio : 0.18;
        const missingFormMin = (opts && opts.missingFormMin != null) ? opts.missingFormMin : 8;
        const maxPct = (opts && opts.maxPct != null) ? opts.maxPct : 130;
        const scoreLabel = (opts && opts.scoreLabel) || L.adjLabel;
        const baseLabel = (opts && opts.baseLabel) || L.pctLabel;
        const formLabel = (opts && opts.formLabel) || L.formLabel;
        const placeScope = (opts && opts.placeScope) || 'matched';
        const placeOpts = Object.assign({}, opts, {
            allScope: placeScope === 'all',
            placeScope
        });

        let formAdj = 0;
        const tipLines = [scoreLabel + ' = ' + baseLabel + ' + form + son koşu alanı + S5 derece'];
        tipLines.push('Taban ' + baseLabel + ': %' + base);

        const formPct = formTrend?.pct;
        if (formPct == null) {
            formAdj = -Math.round(Math.max(missingFormMin, base * missingFormRatio));
            tipLines.push(formLabel + ' yok → ceza: ' + formAdj);
        } else {
            formAdj = Math.round((formPct - 50) * formScale);
            tipLines.push(formLabel + ' %' + formPct + ' → ' + (formAdj >= 0 ? '+' : '') + formAdj);
        }

        const lastFs = this.computeLastRaceFieldSizeAdj(calcKosular, hedef, opts);
        const lastFsAdj = lastFs.delta || 0;
        if (lastFs.inTarget != null) {
            tipLines.push('Son koşu alanı: ' + (lastFsAdj >= 0 ? '+' : '') + lastFsAdj);
        }

        const place = this.computeRecencyPlacementBonus(calcKosular, hedef, placeOpts);
        const placeAdj = Math.round(place.total);
        if (place.races.length) {
            tipLines.push('S5 derece: ' + (placeAdj >= 0 ? '+' : '') + placeAdj);
        }

        const raw = base + formAdj + lastFsAdj + placeAdj;
        const pct = Math.round(Math.min(maxPct, Math.max(0, raw)));
        tipLines.push('Toplam: %' + pct);

        return {
            pct,
            display: '%' + pct,
            base,
            formAdj,
            lastFsAdj,
            lastFs,
            placeAdj,
            totalAdj: formAdj + lastFsAdj + placeAdj,
            boosted: pct > base + 2,
            penalized: pct < base - 2,
            tooltip: tipLines.join('\n')
        };
    },

    computeGeneralBasePct(calcKosular) {
        const races = this.validRaces(calcKosular);
        if (!races.length) return null;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < races.length; i++) {
            const sc = this._placementScore(this.parseSira(races[i].sira));
            if (sc != null) { sum += sc; n++; }
        }
        return n ? Math.round(sum / n) : null;
    },

    _computeGeneralBlock(calcKosular, hedef) {
        const genPlacement = this._computeStatsCore(calcKosular, null);
        const genBasePct = this.computeGeneralBasePct(calcKosular);
        const genForm = this.computeRecentFormTrend(calcKosular, hedef, { allScope: true });
        const genAdj = this.computeAdjustedFieldSizeScore(genBasePct, genForm, calcKosular, hedef, {
            scoreLabel: 'GEN+',
            baseLabel: 'GEN%',
            formLabel: 'G-FORM',
            placeScope: 'all',
            missingFormMin: 6
        });
        return {
            genBasePct,
            genCnt1: genPlacement.cnt1,
            genCnt2: genPlacement.cnt2,
            genCnt3: genPlacement.cnt3,
            genCnt4: genPlacement.cnt4,
            genForm,
            genAdj
        };
    },

    computeBasSuccessScore(st) {
        const empty = {
            pct: null, display: '—', matchTrust: 0,
            matchBlock: null, genBlock: null, tooltip: 'Geçmiş koşu yok'
        };
        const total = st?.kosuSayisi || 0;
        const matched = st?.matchCount || 0;
        if (!total) return empty;

        const windowCap = Math.min(6, total);
        const matchTrust = matched === 0
            ? 0
            : Math.round(Math.min(1, 0.12 + 0.88 * (matched / windowCap)) * 1000) / 1000;

        const matchPlace = this._avgPlacementFromCounts(st.cnt1, st.cnt2, st.cnt3, st.cnt4, matched);
        const genPlace = this._avgPlacementFromCounts(
            st.genCnt1, st.genCnt2, st.genCnt3, st.genCnt4, total);

        const asPlus = st.asAdj?.pct ?? st.matchPct ?? 0;
        const genPlus = st.genAdj?.pct ?? st.genBasePct ?? 0;
        const matchPct = st.matchPct ?? 0;
        const genPct = st.genBasePct ?? 0;
        const asForm = this._effectiveFormPct(st.formTrend, matchPct, 8);
        const genForm = this._effectiveFormPct(st.genForm, genPct, 6);

        const W = { plus: 0.55, place: 0.20, base: 0.10, form: 0.15 };
        const matchBlock = asPlus * W.plus + matchPlace * W.place + matchPct * W.base + asForm * W.form;
        const genBlock = genPlus * W.plus + genPlace * W.place + genPct * W.base + genForm * W.form;
        const raw = matchTrust * matchBlock + (1 - matchTrust) * genBlock;
        const pct = Math.round(Math.min(130, Math.max(0, raw)));

        return {
            pct,
            display: '%' + pct,
            matchTrust,
            matchBlock: Math.round(matchBlock),
            genBlock: Math.round(genBlock),
            boosted: pct >= 85,
            penalized: pct <= 25,
            tooltip: 'BAŞ+ = alan eşleşme + genel karışım · güven %'
                + Math.round(matchTrust * 100) + ' → %' + pct
        };
    },

    formatCell(v) {
        return v != null && v !== '' ? String(v) : '—';
    },

    /**
     * MAX-* değerlerini bugünkü koşu alanına göre başarı % dilimine çevirir.
     * MAX-N = eşleşen koşularda N derecesine kadar ulaşılan en geniş alan (at sayısı).
     * % = min(100, MAX / bugünküAlan × 100) — bugünkü kalabalığa göre kanıtlanmış üst sınır.
     */
    computeMaxSuccessPct(st, todayFieldSize) {
        const defs = [
            { key: 'max1', label: 'MAX-1', desc: '1. olunan en geniş alan' },
            { key: 'max12', label: 'MAX-12', desc: '1-2 olunan en geniş alan' },
            { key: 'max123', label: 'MAX-123', desc: '1-2-3 olunan en geniş alan' },
            { key: 'max1234', label: 'MAX-1234', desc: '1-2-3-4 olunan en geniş alan' }
        ];
        if (!st || !todayFieldSize || todayFieldSize < 1) {
            return { display: '—', tooltip: '', parts: [] };
        }
        const hasMatch = (st.matchCount > 0) || (st.matchKosuSayisi > 0);
        if (!hasMatch) {
            return { display: '—', tooltip: 'Eşleşen sıklet koşusu yok', parts: [] };
        }
        const parts = [];
        const tipLines = ['Bugünkü alan: ' + todayFieldSize + ' at'];
        for (let i = 0; i < defs.length; i++) {
            const d = defs[i];
            const max = st[d.key];
            let pct = null;
            if (max != null && max > 0) {
                pct = Math.min(100, Math.round(max / todayFieldSize * 100));
                tipLines.push(d.label + ': ' + max + ' at → %' + pct + ' (' + d.desc + ')');
            } else {
                pct = 0;
                tipLines.push(d.label + ': hiç yok → %0');
            }
            parts.push({ label: d.label, max: max, pct: pct });
        }
        const display = parts.map(function(p) { return p.pct + '%'; }).join('·');
        const avg = parts.length
            ? Math.round(parts.reduce(function(a, p) { return a + p.pct; }, 0) / parts.length * 10) / 10
            : null;
        return { display: display, avg: avg, tooltip: tipLines.join('\n'), parts: parts };
    }
};

if (typeof globalThis !== 'undefined') globalThis.FieldSizeStatsEngine = FieldSizeStatsEngine;
if (typeof module !== 'undefined') module.exports = { FieldSizeStatsEngine };
