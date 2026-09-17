/**
 * Geçmiş koşuları "son koşu", "1 önce", "2 önce" … diye sütunlara hizalamak için ortak yardımcılar.
 * Her program koşusunda: bir sütun = o derinlikteki yarış; satırlar = o koşudaki atlar (alt alta).
 */
const KosuRecencyLayout = {
    sortNewestFirst(kosular) {
        const list = Array.isArray(kosular) ? [...kosular] : [];
        list.sort((a, b) => {
            const da = AtSpeedUtils.parseDateTR(a?.tarih);
            const db = AtSpeedUtils.parseDateTR(b?.tarih);
            return db - da;
        });
        return list;
    },

    depthLabel(depthIndex) {
        if (depthIndex === 0) return 'SON';
        return depthIndex + ' ÖNCE';
    },

    gostergeColumnTitle(depthIndex) {
        return 'GÖSTERGE · ' + this.depthLabel(depthIndex);
    },

    kosuAtDepth(kosular, depthIndex) {
        const sorted = this.sortNewestFirst(kosular);
        return sorted[depthIndex] || null;
    },

    maxDepthForHorses(horses, cap = 7) {
        let max = 0;
        for (const horse of horses || []) {
            const n = (horse.kosular || []).length;
            if (n > max) max = n;
        }
        if (cap > 0) max = Math.min(max, cap);
        return max;
    }
};

if (typeof module !== 'undefined') module.exports = { KosuRecencyLayout };
