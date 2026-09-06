/**
 * GÖSTERİM tablo sütun başlıkları — gosterim_full + SON TEST ortak
 */
const GosterimHeaders = (function () {
    const BASE_HEADERS = [
        { col: 0, label: 'SIRA', type: 'number', sticky: 1 },
        { col: 1, label: 'AT İSMİ', type: 'string', sticky: 2 },
        { col: 2, label: 'AT ID', type: 'number' },
        { col: 3, label: 'TARİH', type: 'date' },
        { col: 4, label: 'ŞEHİR', type: 'string' },
        { col: 5, label: 'MESAFE', type: 'number' },
        { col: 6, label: 'SIRA', type: 'number' },
        { col: 7, label: 'AT DERECE', type: 'string' },
        { col: 8, label: '1.DERECE', type: 'string' },
        { col: 9, label: 'SON800-1', type: 'string' },
        { col: 10, label: 'SON800-2', type: 'string' },
        { col: 11, label: 'DR/SL', type: 'number' },
        { col: 12, label: '1DR/SL', type: 'number' },
        { col: 13, label: 'DR/1DR', type: 'number', title: '(DR/SL) ÷ (1DR/SL)' },
        { col: 14, label: 'FARK', type: 'number' },
        { col: 15, label: '8001/SL', type: 'number' },
        { col: 16, label: '8002/SL', type: 'number' },
        { col: 17, label: '8002-8001', type: 'number' },
        { col: 18, label: 'T1×DR', type: 'string', title: 'TEST1 × DR/1DR — birinci farkı entegre TEST1' },
        { col: 19, label: 'T1×DR-T3', type: 'string', title: 'TEST3 × DR/1DR — birinci farkı entegre TEST3' },
        { col: 20, label: 'TEST1', type: 'string' },
        { col: 21, label: 'TEST2', type: 'string' },
        { col: 22, label: 'TEST3', type: 'string' },
        { col: 23, label: 'T2−T3', type: 'number', title: 'TEST2 − TEST3 (negatif en yüksek → yeşil vurgu)' },
        { col: 24, label: 'TEST4', type: 'number' },
        { col: 25, label: 'TEST5', type: 'number', title: 'T1×DR − T1×DR-T3 (TEST1−TEST3 entegre farkı)' },
        { col: 26, label: 'TEST6', type: 'number' },
        { col: 27, label: 'TEST7', type: 'number' },
        { col: 28, label: 'TEST8', type: 'number' },
        { col: 29, label: 'TEST9', type: 'number' },
        { col: 30, label: 'İLK FARK', type: 'number' },
        { col: 31, label: 'SON FARK', type: 'number' },
        { col: 32, label: 'FARKLARIN FARKI', type: 'number' }
    ];

    let cached = null;

    function buildHeaders() {
        const headers = BASE_HEADERS.map(function(h, i) {
            return Object.assign({}, h, { col: i });
        });
        if (typeof AtMetaFields !== 'undefined') {
            for (const f of AtMetaFields.HORSE_FIELDS) {
                headers.push({
                    col: headers.length,
                    label: f.label,
                    type: 'string',
                    title: 'At meta · ' + f.short
                });
            }
            for (const f of AtMetaFields.KOSU_FIELDS) {
                headers.push({
                    col: headers.length,
                    label: f.label,
                    type: 'string',
                    title: 'Geçmiş koşu · ' + f.short
                });
            }
        }
        return headers;
    }

    return {
        getHeaders() {
            if (!cached) cached = buildHeaders();
            return cached;
        },
        headerStickyClass(h) {
            if (h.sticky === 1) return ' col-sticky';
            if (h.sticky === 2) return ' col-sticky-2';
            return '';
        },
        /** gosterim_full.html uyumluluğu */
        get GOSTERIM_HEADERS() {
            return this.getHeaders();
        }
    };
})();

if (typeof module !== 'undefined') module.exports = { GosterimHeaders };
