/**
 * Geçmiş koşularda hedef hipodrom (şehir) deneyimi istatistikleri
 * kosular[].sehir zaten TJK scrape ile gelir — ek fetch gerekmez
 */
const SehirStatsEngine = {
    normalizeSehir(sehir) {
        if (!sehir) return '';
        return String(sehir).trim().toLocaleLowerCase('tr-TR');
    },

    sehirMatch(atKosuSehir, hedefSehir) {
        if (!hedefSehir) return false;
        const a = this.normalizeSehir(atKosuSehir);
        const b = this.normalizeSehir(hedefSehir);
        if (!a || !b) return false;
        return a === b || a.includes(b) || b.includes(a);
    },

    abbrevSehir(sehir) {
        if (!sehir) return '—';
        const s = String(sehir).trim();
        if (s.length <= 4) return s;
        return s.slice(0, 4);
    },

    validRaces(kosular) {
        return (kosular || []).filter(k => {
            const sehir = k?.sehir;
            return sehir && sehir !== '-';
        });
    },

    inCityRaces(kosular, hedefSehir) {
        return this.validRaces(kosular).filter(k => this.sehirMatch(k.sehir, hedefSehir));
    },

    _computeStatsCore(kosular, hedefSehir) {
        const all = kosular || [];
        const races = this.validRaces(all);
        const inCity = this.inCityRaces(all, hedefSehir);
        const gecmisMatch = [];
        const gecmisSehir = [];
        for (const k of races) {
            const match = this.sehirMatch(k.sehir, hedefSehir);
            gecmisMatch.push(match ? '✓' : '·');
            gecmisSehir.push(this.abbrevSehir(k.sehir));
        }
        const sehirPct = races.length
            ? Math.round(100 * inCity.length / races.length)
            : null;
        const placement = typeof FieldSizeStatsEngine !== 'undefined'
            ? FieldSizeStatsEngine._computeStatsCore(inCity)
            : {
                kosuSayisi: 0, max1: null, max12: null, max123: null, max1234: null,
                cnt1: 0, cnt2: 0, cnt3: 0, cnt4: 0, cnt12: 0, cnt123: 0, cnt1234: 0
            };
        return {
            hedefSehir: hedefSehir || '—',
            kosuSayisi: races.length,
            inCityCount: inCity.length,
            sehirPct,
            max1: placement.max1,
            max12: placement.max12,
            max123: placement.max123,
            max1234: placement.max1234,
            cnt1: placement.cnt1,
            cnt2: placement.cnt2,
            cnt3: placement.cnt3,
            cnt4: placement.cnt4,
            cnt12: placement.cnt12,
            cnt123: placement.cnt123,
            cnt1234: placement.cnt1234,
            inCityKosuSayisi: placement.kosuSayisi,
            gecmisMatchStr: gecmisMatch.length ? gecmisMatch.join('→') : '—',
            gecmisSehirStr: gecmisSehir.length ? gecmisSehir.join('→') : '—',
            missingSehir: all.length - races.length
        };
    },

    computeStats(kosular, hedefSehir, programTarih) {
        const calcKosular = typeof FieldSizeStatsEngine !== 'undefined' && programTarih
            ? FieldSizeStatsEngine.filterKosularForCalc(kosular, programTarih)
            : (kosular || []);
        const base = this._computeStatsCore(calcKosular, hedefSehir);
        const windows = {};
        const recentWindows = typeof FieldSizeStatsEngine !== 'undefined'
            ? FieldSizeStatsEngine.RECENT_WINDOWS
            : [5, 4, 3, 2, 1];
        for (const w of recentWindows) {
            const sliced = typeof FieldSizeStatsEngine !== 'undefined'
                ? FieldSizeStatsEngine.recentSlice(calcKosular, w)
                : calcKosular.slice(0, w);
            windows[w] = this._computeStatsCore(sliced, hedefSehir);
        }
        const formTrend = this.computeRecentFormTrend(calcKosular, hedefSehir);
        const sehirAdj = this.computeAdjustedSehirScore(base.sehirPct, formTrend, calcKosular, hedefSehir);
        return Object.assign(base, { windows, formTrend, sehirAdj });
    },

    formatCell(v) {
        return v != null && v !== '' ? String(v) : '—';
    },

    formatPct(pct) {
        return pct != null ? '%' + pct : '—';
    },

    /** Bitiş sırasını 0–100 performans puanına çevirir (1.=100). */
    placementScore(sira) {
        const n = typeof FieldSizeStatsEngine !== 'undefined'
            ? FieldSizeStatsEngine.parseSira(sira)
            : (sira != null ? parseInt(String(sira).replace(/[^\d]/g, ''), 10) : null);
        if (n == null || n < 1 || isNaN(n)) return null;
        if (n === 1) return 100;
        if (n === 2) return 88;
        if (n === 3) return 76;
        if (n === 4) return 64;
        if (n <= 10) return Math.max(12, 64 - (n - 4) * 7);
        return 12;
    },

    _weightedSlope(points) {
        let sw = 0;
        let sx = 0;
        let sy = 0;
        let sxx = 0;
        let sxy = 0;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const w = p.w;
            sw += w;
            sx += w * p.x;
            sy += w * p.y;
            sxx += w * p.x * p.x;
            sxy += w * p.x * p.y;
        }
        const denom = sw * sxx - sx * sx;
        if (!denom) return null;
        return (sw * sxy - sx * sy) / denom;
    },

    /**
     * Son N koşuda hedef şehirde performans momentumu (0–100, 50=nötr).
     * Yakın koşular ağırlıklı; sıra iyileşiyorsa % yükselir.
     */
    computeRecentFormTrend(calcKosular, hedefSehir, opts) {
        const empty = {
            pct: null,
            display: '—',
            delta: null,
            slope: null,
            rising: false,
            falling: false,
            tooltip: 'Son 5 koşuda hedef şehirde en az 2 dereceli koşu gerekir',
            inCitySamples: 0
        };
        const FSE = typeof FieldSizeStatsEngine !== 'undefined' ? FieldSizeStatsEngine : null;
        if (!FSE || !hedefSehir) return empty;

        const windowSize = (opts && opts.windowSize != null) ? opts.windowSize : 5;
        const minSamples = (opts && opts.minSamples != null) ? opts.minSamples : 2;
        const recent = FSE.recentSlice(calcKosular || [], windowSize);
        if (!recent.length) return empty;

        const chronological = [...recent].reverse();
        const samples = [];
        const tipLines = ['Son ' + windowSize + ' koşu · hedef: ' + (hedefSehir || '—')];

        for (let xi = 0; xi < chronological.length; xi++) {
            const k = chronological[xi];
            const inCity = this.sehirMatch(k.sehir, hedefSehir);
            if (!inCity) {
                tipLines.push((k.tarih || '?') + ': ' + this.abbrevSehir(k.sehir) + ' (hedef dışı)');
                continue;
            }
            const sira = FSE.parseSira(k.sira);
            const score = this.placementScore(sira);
            if (score == null) {
                tipLines.push((k.tarih || '?') + ': ' + this.abbrevSehir(k.sehir) + ' · sıra yok');
                continue;
            }
            const w = Math.pow(xi + 1, 1.6);
            samples.push({ x: xi, y: score, w: w, sira: sira, tarih: k.tarih });
            tipLines.push((k.tarih || '?') + ': ' + sira + '. → puan ' + score);
        }

        if (samples.length < minSamples) {
            return Object.assign({}, empty, {
                tooltip: 'S' + windowSize + ' penceresinde hedef şehirde ≥' + minSamples + ' dereceli koşu yok',
                inCitySamples: samples.length
            });
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

        let olderW = 0;
        let olderS = 0;
        let newerW = 0;
        let newerS = 0;
        const half = Math.floor(samples.length / 2);
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            if (i < half) {
                olderW += s.w;
                olderS += s.y * s.w;
            } else {
                newerW += s.w;
                newerS += s.y * s.w;
            }
        }
        const avgOlder = olderW ? olderS / olderW : null;
        const avgNewer = newerW ? newerS / newerW : null;
        const halfDelta = (avgOlder != null && avgNewer != null) ? avgNewer - avgOlder : null;

        const blendDelta = (slope != null ? slope * (windowSize - 1) : 0) * 0.55
            + (halfDelta != null ? halfDelta : 0) * 0.45
            + (stepDelta != null ? stepDelta : 0) * 0.25;
        const pct = Math.round(Math.min(100, Math.max(0, 50 + blendDelta * 1.15)));

        if (halfDelta != null) {
            tipLines.push('Eski yarı ort.: ' + Math.round(avgOlder) + ' → yeni yarı: ' + Math.round(avgNewer)
                + ' (Δ' + Math.round(halfDelta) + ')');
        }
        if (slope != null) {
            tipLines.push('Eğim: ' + slope.toFixed(1) + ' puan/koşu');
        }
        if (stepDelta != null) {
            tipLines.push('Son adım: ' + prev.sira + '.→' + last.sira + '. (Δ' + Math.round(stepDelta) + ')');
        }
        tipLines.push('Ş-FORM: %' + pct + ' (50=nötr · yüksek=iyileşme)');

        return {
            pct,
            display: '%' + pct,
            delta: halfDelta != null ? Math.round(halfDelta) : null,
            slope: slope != null ? Math.round(slope * 10) / 10 : null,
            rising: pct >= 58,
            falling: pct <= 42,
            tooltip: tipLines.join('\n'),
            inCitySamples: samples.length,
            samples
        };
    },

    /** Son 5 koşuda hedef şehirde dereceye göre yakınlık ağırlıklı puan (1.=en yüksek). */
    computeRecencyPlacementBonus(calcKosular, hedefSehir, opts) {
        const empty = { total: 0, parts: [], races: [] };
        const FSE = typeof FieldSizeStatsEngine !== 'undefined' ? FieldSizeStatsEngine : null;
        if (!FSE || !hedefSehir) return empty;

        const windowSize = (opts && opts.windowSize != null) ? opts.windowSize : 5;
        const siraPoints = { 1: 10, 2: 6, 3: 4, 4: 2 };
        const recent = FSE.recentSlice(calcKosular || [], windowSize);
        if (!recent.length) return empty;

        const chronological = [...recent].reverse();
        const n = chronological.length;
        let total = 0;
        const parts = [];
        const races = [];

        for (let i = 0; i < n; i++) {
            const k = chronological[i];
            const recency = n <= 1 ? 1 : 0.35 + 0.65 * (i / (n - 1));
            if (!this.sehirMatch(k.sehir, hedefSehir)) {
                const pen = -Math.round(2 * recency);
                total += pen;
                parts.push({ tarih: k.tarih, sira: null, recency, delta: pen, note: 'hedef dışı' });
                races.push({ tarih: k.tarih, sira: null, recency, delta: pen });
                continue;
            }
            const sira = FSE.parseSira(k.sira);
            if (sira == null) continue;
            let pts = 0;
            if (siraPoints[sira] != null) pts = siraPoints[sira];
            else if (sira <= 8) pts = 0;
            else pts = -3;
            const delta = Math.round(pts * recency * 10) / 10;
            total += delta;
            parts.push({ tarih: k.tarih, sira, recency, delta, note: sira + '.' });
            races.push({ tarih: k.tarih, sira, recency, delta });
        }

        return { total: Math.round(total * 10) / 10, parts, races };
    },

    /**
     * ŞEH% + Ş-FORM düzeltmesi + son 5 koşu derece ödülü/cezası.
     * %100 üstü mümkün; FORM yoksa ŞEH%'den oransal ceza.
     */
    computeAdjustedSehirScore(sehirPct, formTrend, calcKosular, hedefSehir, opts) {
        const base = sehirPct != null ? sehirPct : 0;
        const formScale = (opts && opts.formScale != null) ? opts.formScale : 0.35;
        const missingFormRatio = (opts && opts.missingFormRatio != null) ? opts.missingFormRatio : 0.18;
        const missingFormMin = (opts && opts.missingFormMin != null) ? opts.missingFormMin : 8;
        const maxPct = (opts && opts.maxPct != null) ? opts.maxPct : 130;

        let formAdj = 0;
        const tipLines = ['ŞEH+ = ŞEH% + form düzeltmesi + S5 derece (yakın koşu ağırlıklı)'];
        tipLines.push('Taban ŞEH%: %' + base);

        const formPct = formTrend?.pct;
        if (formPct == null) {
            formAdj = -Math.round(Math.max(missingFormMin, base * missingFormRatio));
            tipLines.push('Ş-FORM yok → ceza: ' + formAdj + ' puan'
                + (base > 0 ? ' (tabanın %' + Math.round(missingFormRatio * 100) + '\'i, min ' + missingFormMin + ')' : ''));
        } else {
            formAdj = Math.round((formPct - 50) * formScale);
            tipLines.push('Ş-FORM %' + formPct + ' → ' + (formAdj >= 0 ? '+' : '') + formAdj
                + ' (50=nötr, ölçek×' + formScale + ')');
        }

        const place = this.computeRecencyPlacementBonus(calcKosular, hedefSehir);
        const placeAdj = Math.round(place.total);
        if (place.races.length) {
            tipLines.push('S5 derece katkısı: ' + (placeAdj >= 0 ? '+' : '') + placeAdj);
            for (let i = 0; i < place.parts.length; i++) {
                const p = place.parts[i];
                const rc = Math.round(p.recency * 100);
                tipLines.push('  ' + (p.tarih || '?') + ' · ' + (p.note || '?')
                    + ' · yakınlık %' + rc + ' → ' + (p.delta >= 0 ? '+' : '') + p.delta);
            }
        } else {
            tipLines.push('S5 derece katkısı: 0 (hedef şehirde derece yok)');
        }

        const raw = base + formAdj + placeAdj;
        const pct = Math.round(Math.min(maxPct, Math.max(0, raw)));
        const boosted = pct > base + 2;
        const penalized = pct < base - 2;

        tipLines.push('Toplam: %' + base + ' ' + (formAdj >= 0 ? '+' : '') + formAdj
            + ' ' + (placeAdj >= 0 ? '+' : '') + placeAdj + ' = %' + pct);

        return {
            pct,
            display: '%' + pct,
            base,
            formAdj,
            placeAdj,
            totalAdj: formAdj + placeAdj,
            boosted,
            penalized,
            tooltip: tipLines.join('\n')
        };
    }
};

if (typeof globalThis !== 'undefined') globalThis.SehirStatsEngine = SehirStatsEngine;
if (typeof module !== 'undefined') module.exports = { SehirStatsEngine };
