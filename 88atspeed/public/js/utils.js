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

    getSortType(columnIndex) {
        const types = {
            0: 'number', 3: 'date', 5: 'number', 6: 'number',
            11: 'number', 12: 'number', 13: 'number', 14: 'number',
            15: 'number', 16: 'number', 20: 'number', 21: 'number',
            22: 'number', 23: 'number', 24: 'number', 25: 'number',
            26: 'number', 27: 'number', 28: 'number'
        };
        return types[columnIndex] || 'string';
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
    }
};

if (typeof module !== 'undefined') module.exports = AtSpeedUtils;
