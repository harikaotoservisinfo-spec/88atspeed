/* 88ATSPEED - Ortak yardımcı fonksiyonlar */
const AtSpeedUtils = {
    escapeHtml(s) {
        if (!s && s !== 0) return '-';
        return String(s).replace(/[&<>]/g, m =>
            m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;'
        );
    },

    formatDateTR(isoDate) {
        if (!isoDate) return '';
        const parts = isoDate.split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : isoDate;
    },

    parseDateTR(dateStr) {
        if (!dateStr || dateStr === '-') return new Date(0);
        const parts = dateStr.split('.');
        if (parts.length !== 3) return new Date(0);
        return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    },

    dereceToSalise(derece) {
        if (!derece || derece === '-' || derece === 'Derecesiz') return null;
        try {
            const s = derece.toString().trim().replace(/:/g, '.');
            const parts = s.split('.');
            if (parts.length === 3) {
                return (parseInt(parts[0]) * 60 * 100) + (parseInt(parts[1]) * 100) + parseInt(parts[2]);
            } else if (parts.length === 2) {
                return (parseInt(parts[0]) * 100) + parseInt(parts[1]);
            } else if (parts.length === 1) {
                return parseInt(parts[0]) * 100;
            }
        } catch (_) {}
        return null;
    },

    saliseToDerece(salise) {
        if (!salise && salise !== 0) return '-';
        try {
            const saliseInt = Math.floor(Math.abs(salise));
            const dk = Math.floor(saliseInt / 6000);
            const kalan = saliseInt % 6000;
            const sn = Math.floor(kalan / 100);
            const sl = kalan % 100;
            if (dk > 0) return `${dk}.${sn.toString().padStart(2, '0')}.${sl.toString().padStart(2, '0')}`;
            return `${sn.toString().padStart(2, '0')}.${sl.toString().padStart(2, '0')}`;
        } catch (_) { return '-'; }
    },

    saliseToFarkFormat(salise) {
        if (salise === null || salise === undefined) return '-';
        const absSalise = Math.floor(Math.abs(parseInt(salise)));
        const sn = Math.floor(absSalise / 100);
        const sl = absSalise % 100;
        const sign = salise >= 0 ? '+' : '-';
        return `${sign}${sn.toString().padStart(2, '0')}.${sl.toString().padStart(2, '0')}`;
    },

    metreBasiSalise(salise, mesafe) {
        if (salise && mesafe && mesafe !== '-' && mesafe !== 'Derecesiz') {
            const m = parseInt(String(mesafe).replace(/\D/g, ''));
            if (m > 0) return salise / m;
        }
        return null;
    },

    parseNumberFromText(text) {
        if (!text || text === '-') return null;
        const cleaned = text.toString().replace(/[^0-9.\-]/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
    },

    /** At adı sonundaki parantez bitiş sırası: "BANDID (1)" → 1 */
    extractBitisFromHorseName(name) {
        if (!name) return null;
        const m = String(name).trim().match(/\((\d+)\)\s*$/);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        return n >= 1 ? n : null;
    },

    /** Koşmayan / çekilen at — isimde (Koşmaz) vb. */
    isKosmazHorseName(name) {
        if (!name) return false;
        const s = String(name);
        return /\(\s*koşmaz\s*\)/i.test(s)
            || /\(\s*kosmaz\s*\)/i.test(s)
            || /\(\s*koşm\s*\)/i.test(s)
            || /\(\s*çekildi\s*\)/i.test(s)
            || /\(\s*cekildi\s*\)/i.test(s);
    },

    isKosmazHorse(horse) {
        if (!horse) return false;
        if (horse.kosmaz === true) return true;
        return this.isKosmazHorseName(horse.name);
    },

    cleanKosmazFromHorseName(name) {
        return String(name || '')
            .replace(/\(\s*(?:koşmaz|kosmaz|koşm|çekildi|cekildi)\s*\)/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    },

    raceKeyForCikan(kayitId, raceNo) {
        return String(kayitId) + '|' + raceNo;
    },

    /** PUANLAMA çıkan-at listesi + isimde koşmaz — hesaplama paketine girecek atlar */
    filterRaceForCalculation(race, kayitId, raceNo, cikanMap) {
        const rk = this.raceKeyForCikan(kayitId, raceNo);
        const cikanSet = new Set((cikanMap?.[rk] || []).map(String));
        const horses = (race.horses || []).filter(h => {
            if (cikanSet.has(String(h.no))) return false;
            if (this.isKosmazHorse(h)) return false;
            return true;
        });
        return Object.assign({}, race, { horses, horseCount: horses.length });
    },

    /**
     * Doğrusal min–max yüzde: en düşük (en iyi) değer %100, en yüksek (en kötü) %0.
     * Ara değerler: (max − value) / (max − min) × 100
     */
    pctLinearMinBest(value, minVal, maxVal) {
        if (value == null || minVal == null || maxVal == null) return null;
        if (maxVal === minVal) return 100;
        const pct = ((maxVal - value) / (maxVal - minVal)) * 100;
        return Math.round(Math.max(0, Math.min(100, pct)));
    },

    /**
     * Doğrusal min–max yüzde: en yüksek (en iyi) değer %100, en düşük (en kötü) %0.
     * Ara değerler: (value − min) / (max − min) × 100
     */
    pctLinearMaxBest(value, minVal, maxVal) {
        if (value == null || minVal == null || maxVal == null) return null;
        if (maxVal === minVal) {
            // Tüm atlar aynı Δ salise → kişisel en iyi (%0 fark) ise gösterge %0, aksi halde nötr %100
            return minVal === 0 ? 0 : 100;
        }
        const pct = ((value - minVal) / (maxVal - minVal)) * 100;
        return Math.round(Math.max(0, Math.min(100, pct)));
    },

    /** 0–100 değerlerinin geometrik ortalaması (TEST·SIRA ile aynı mantık) */
    pctGeometricMean(values) {
        const valid = (values || []).filter(v => v != null && !Number.isNaN(v));
        if (!valid.length) return null;
        if (valid.length === 1) return Math.round(valid[0]);
        const product = valid.reduce((a, b) => a * Math.max(0, b), 1);
        return Math.round(Math.pow(product, 1 / valid.length));
    },

    /** pctLinearMinBest tersi: yüzdeden ham değer (en iyi=min %100) */
    impliedValueFromPctMinBest(pct, minVal, maxVal) {
        if (pct == null || minVal == null || maxVal == null) return null;
        if (maxVal === minVal) return minVal;
        return maxVal - (pct / 100) * (maxVal - minVal);
    },

    /** pctLinearMaxBest tersi: yüzdeden ham değer (en iyi=max %100) */
    impliedValueFromPctMaxBest(pct, minVal, maxVal) {
        if (pct == null || minVal == null || maxVal == null) return null;
        if (maxVal === minVal) return minVal;
        return minVal + (pct / 100) * (maxVal - minVal);
    },

    getSortType(columnIndex) {
        const col = parseInt(columnIndex, 10);
        const types = {
            0: 'number',   // satır SIRA
            2: 'number',   // AT ID
            3: 'date',     // TARİH
            5: 'number',   // MESAFE
            6: 'number',   // bitiş SIRA
            11: 'number', 12: 'number', 13: 'number', 14: 'number',
            15: 'number', 16: 'number',
            21: 'number', 22: 'number', 23: 'number', 24: 'number', 25: 'number',
            26: 'number', 27: 'number', 28: 'number', 29: 'number', 30: 'number'
        };
        return types[col] || 'string';
    },

    sortColumnIndex(column) {
        const idx = parseInt(column, 10);
        return isNaN(idx) ? null : idx;
    },

    sortTableData(rowsData, columnIndex, type, direction) {
        return rowsData.sort((a, b) => {
            let valA = a.values[columnIndex];
            let valB = b.values[columnIndex];
            if (type === 'number') {
                const numA = AtSpeedUtils.parseNumberFromText(valA);
                const numB = AtSpeedUtils.parseNumberFromText(valB);
                if (numA === null && numB === null) return 0;
                if (numA === null) return 1;
                if (numB === null) return -1;
                return direction === 'asc' ? numA - numB : numB - numA;
            } else if (type === 'date') {
                const dateA = AtSpeedUtils.parseDateTR(valA);
                const dateB = AtSpeedUtils.parseDateTR(valB);
                return direction === 'asc' ? dateA - dateB : dateB - dateA;
            }
            valA = (valA || '').toString().toLowerCase();
            valB = (valB || '').toString().toLowerCase();
            return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        });
    },

    async loadHipodromlar(tarihISO, selectEl, statusEl) {
        const tarih = AtSpeedUtils.formatDateTR(tarihISO);
        if (statusEl) statusEl.innerHTML = '<div class="status status-loading">⏳ Hipodromlar yükleniyor...</div>';
        try {
            const response = await fetch('/api/hipodromlar?tarih=' + tarih);
            const result = await response.json();
            if (!result.success || !result.hipodromlar?.length) {
                if (selectEl) selectEl.innerHTML = '<option value="">Hipodrom bulunamadı</option>';
                if (statusEl) statusEl.innerHTML = '<div class="status status-warning">⚠️ ' + tarih + ' tarihinde hipodrom bulunamadı</div>';
                return [];
            }
            if (selectEl) {
                let options = '';
                for (const h of result.hipodromlar) {
                    options += `<option value="${h.id}">${AtSpeedUtils.escapeHtml(h.name)}</option>`;
                }
                selectEl.innerHTML = options;
            }
            if (statusEl) statusEl.innerHTML = '<div class="status status-success">✅ ' + result.hipodromlar.length + ' hipodrom bulundu</div>';
            return result.hipodromlar;
        } catch (error) {
            if (selectEl) selectEl.innerHTML = '<option value="">Hipodromlar yüklenemedi</option>';
            if (statusEl) statusEl.innerHTML = '<div class="status status-error">❌ Hata: ' + error.message + '</div>';
            return [];
        }
    },

    listenParentContext(callback) {
        window.addEventListener('message', (e) => {
            if (e.data?.type === '88atspeed-context') callback(e.data);
        });
    },

    broadcastContext(tarih, hipodromId, hipodromAdi) {
        document.querySelectorAll('iframe').forEach(iframe => {
            iframe.contentWindow?.postMessage({
                type: '88atspeed-context',
                tarih, hipodromId, hipodromAdi
            }, '*');
        });
    },

    async deleteHesaplamaKayit(id, label) {
        const msg = (label || 'Bu kayıt') +
            ' kalıcı olarak silinecek (puanlama verileri dahil).\n\nOnaylamak için SIL yazın:';
        if (prompt(msg) !== 'SIL') return { cancelled: true };
        const res = await fetch('/api/hesaplama-kayit/' + id, { method: 'DELETE' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Silinemedi');
        return json;
    },

    bindHesaplamaKayitList(container, onLoad, onChange) {
        if (!container) return;
        container.querySelectorAll('.kayit-item').forEach(item => {
            const deleteBtn = item.querySelector('[data-action="delete"]');
            if (deleteBtn) {
                deleteBtn.onclick = async (e) => {
                    e.stopPropagation();
                    try {
                        const result = await AtSpeedUtils.deleteHesaplamaKayit(
                            item.dataset.id,
                            item.dataset.label
                        );
                        if (result.cancelled) return;
                        item.remove();
                        onChange?.();
                    } catch (err) {
                        alert('Silme hatası: ' + err.message);
                    }
                };
            }
            item.onclick = async (e) => {
                if (e.target.closest('[data-action="delete"]')) return;
                await onLoad(item.dataset.id, item);
            };
        });
    },

    hesaplamaKayitListItemHtml(k, extraMeta) {
        const label = (k.tarih || '') + ' · ' + (k.hipodrom || '');
        const meta = extraMeta ||
            ('🐎 ' + (k.total_horses ?? '—') + ' at | 🕐 ' + AtSpeedUtils.escapeHtml(k.kayit_tarihi || ''));
        return '<div class="kayit-item" data-id="' + k.id + '" data-label="' + AtSpeedUtils.escapeHtml(label) + '">' +
            '<span>📅 ' + AtSpeedUtils.escapeHtml(k.tarih) + ' | 🏟️ ' + AtSpeedUtils.escapeHtml(k.hipodrom) +
            ' | ' + meta + '</span>' +
            '<div class="kayit-item-actions">' +
            '<button type="button" class="kayit-delete-btn" data-action="delete" title="Kaydı sil">🗑 Sil</button>' +
            '<button type="button" class="kayit-load-btn" data-action="load">Yükle →</button>' +
            '</div></div>';
    },

    /** Eşit TAHMİN skorunda ikincil sıra: SON800-1 → TEST1 → T1×DR derinlik % */
    depthTieBreakScore(row) {
        if (!row) return -1;
        const s = row.son8001Depths?.[0]?.pct;
        const t = row.test1Depths?.[0]?.pct;
        const d = row.t1drDepths?.[0]?.pct;
        let score = 0;
        if (s != null) score += s * 10000;
        if (t != null) score += t * 100;
        if (d != null) score += d;
        return score;
    },

    compareTahminTieBreak(rowA, rowB) {
        const sa = AtSpeedUtils.depthTieBreakScore(rowA);
        const sb = AtSpeedUtils.depthTieBreakScore(rowB);
        if (sb !== sa) return sb - sa;
        return (rowA?.no ?? 0) - (rowB?.no ?? 0);
    }
};

if (typeof module !== 'undefined') module.exports = AtSpeedUtils;
