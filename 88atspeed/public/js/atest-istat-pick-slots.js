/**
 * Test sekmeleri — HP+ sonrası 5 geçici istat sütunu (başlığa tıkla / tekrar tıkla boşalt).
 * Seçim sekme genelinde geçerlidir — bir koşuda seçince tüm koşularda aynı alanlar dolar.
 */
const AtestIstatPickSlots = (function () {
    const SLOT_COUNT = 5;
    /** @type {Record<string, Array<{key:string,label:string}|null>>} */
    const slotState = Object.create(null);
    /** @type {Record<string, {ctx: object, horses: object[]}>} */
    const raceCtx = Object.create(null);

    function emptySlots() {
        return [null, null, null, null, null];
    }

    function getTabKeyFromEl(el) {
        const wrap = el && el.closest ? el.closest('.son-test-wrap[data-pick-tab]') : null;
        return wrap ? wrap.getAttribute('data-pick-tab') : null;
    }

    function getSlots(tabKey) {
        if (!tabKey) return emptySlots();
        if (!slotState[tabKey]) slotState[tabKey] = emptySlots();
        return slotState[tabKey];
    }

    function registerRace(raceKey, ctx, horses) {
        raceCtx[raceKey] = { ctx: ctx, horses: horses || [] };
    }

    function slotEntry(key, label) {
        return key ? { key: key, label: label || key } : null;
    }

    function findSlotIndex(slots, pickKey) {
        for (let i = 0; i < slots.length; i++) {
            if (slots[i] && slots[i].key === pickKey) return i;
        }
        return -1;
    }

    function firstEmptyIndex(slots) {
        for (let i = 0; i < slots.length; i++) {
            if (!slots[i]) return i;
        }
        return -1;
    }

    function activePickKeys(slots) {
        const set = new Set();
        for (const s of slots) {
            if (s?.key) set.add(s.key);
        }
        return set;
    }

    function togglePick(tabKey, pickKey, pickLabel) {
        const slots = getSlots(tabKey);
        const existing = findSlotIndex(slots, pickKey);
        if (existing >= 0) {
            slots[existing] = null;
            return slots;
        }
        const empty = firstEmptyIndex(slots);
        if (empty < 0) return slots;
        slots[empty] = slotEntry(pickKey, pickLabel);
        return slots;
    }

    function appendSlotHeaders(rowspan, tabKey) {
        const rs = rowspan > 1 ? (' rowspan="' + rowspan + '"') : '';
        const slots = getSlots(tabKey);
        let h = '';
        for (let i = 0; i < SLOT_COUNT; i++) {
            const label = slots[i]?.label || ('ALAN ' + (i + 1));
            const title = slots[i]
                ? ('Seçili: ' + slots[i].label + ' — İstat başlığına tekrar tıklayın (tüm koşular)')
                : ('Boş alan ' + (i + 1) + ' — istat başlığına tıklayın (tüm koşulara uygulanır)');
            h += '<th class="col-stat astest-pick-slot-hdr" data-slot="' + i + '"' + rs
                + ' title="' + title.replace(/"/g, '&quot;') + '">'
                + '<div class="astest-pick-slot-label">' + label + '</div></th>';
        }
        return h;
    }

    function renderSlotCells(horse, raceKey, tabKey) {
        const slots = getSlots(tabKey);
        const rc = raceCtx[raceKey];
        let h = '';
        for (let i = 0; i < SLOT_COUNT; i++) {
            const pick = slots[i];
            let inner = '<span class="istat-pick-empty">—</span>';
            let extraCls = '';
            if (pick?.key && rc?.ctx && typeof AtestIstatDepthUi !== 'undefined') {
                const row = typeof AtestSon800Shared !== 'undefined'
                    ? AtestSon800Shared.getIstatRow(horse, rc.ctx)
                    : {};
                const rendered = AtestIstatDepthUi.renderPickCell(row, pick.key, rc.ctx.pkg, rc.ctx);
                inner = rendered.inner;
                extraCls = rendered.tdClass || '';
            }
            h += '<td class="col-stat astest-pick-slot' + (extraCls ? ' ' + extraCls : '')
                + '" data-slot="' + i + '">' + inner + '</td>';
        }
        return h;
    }

    function refreshRaceTable(raceEl) {
        if (!raceEl) return;
        const raceKey = raceEl.getAttribute('data-race-key');
        const tabKey = getTabKeyFromEl(raceEl);
        if (!raceKey || !tabKey) return;
        const rc = raceCtx[raceKey];
        if (!rc) return;
        const slots = getSlots(tabKey);
        const active = activePickKeys(slots);

        raceEl.querySelectorAll('.astest-pick-slot-hdr[data-slot]').forEach(function(th) {
            const idx = parseInt(th.getAttribute('data-slot'), 10);
            const slot = slots[idx];
            const labelEl = th.querySelector('.astest-pick-slot-label');
            if (labelEl) labelEl.textContent = slot?.label || ('ALAN ' + (idx + 1));
            th.title = slot
                ? ('Seçili: ' + slot.label + ' — İstat başlığına tekrar tıklayın (tüm koşular)')
                : ('Boş alan ' + (idx + 1) + ' — istat başlığına tıklayın (tüm koşulara uygulanır)');
        });

        const rows = raceEl.querySelectorAll('tbody tr');
        for (let ri = 0; ri < rows.length && ri < rc.horses.length; ri++) {
            const horse = rc.horses[ri];
            const tr = rows[ri];
            tr.querySelectorAll('.astest-pick-slot[data-slot]').forEach(function(td) {
                const idx = parseInt(td.getAttribute('data-slot'), 10);
                const pick = slots[idx];
                if (!pick?.key) {
                    td.className = 'col-stat astest-pick-slot';
                    td.innerHTML = '<span class="istat-pick-empty">—</span>';
                    return;
                }
                const row = typeof AtestSon800Shared !== 'undefined'
                    ? AtestSon800Shared.getIstatRow(horse, rc.ctx)
                    : {};
                const rendered = AtestIstatDepthUi.renderPickCell(row, pick.key, rc.ctx.pkg, rc.ctx);
                td.className = 'col-stat astest-pick-slot' + (rendered.tdClass ? ' ' + rendered.tdClass : '');
                td.innerHTML = rendered.inner;
            });
        }

        raceEl.querySelectorAll('th[data-istat-pick-key]').forEach(function(th) {
            const key = th.getAttribute('data-istat-pick-key');
            if (active.has(key)) th.classList.add('istat-pick-hdr-active');
            else th.classList.remove('istat-pick-hdr-active');
        });
    }

    function refreshTab(tabKey) {
        if (!tabKey) return;
        document.querySelectorAll('.son-test-wrap[data-pick-tab="' + tabKey + '"] .son-test-race[data-race-key]')
            .forEach(refreshRaceTable);
    }

    function onHeaderClick(ev) {
        const th = ev.target.closest('th[data-istat-pick-key]');
        if (!th) return;
        const tabKey = getTabKeyFromEl(th);
        if (!tabKey) return;
        ev.preventDefault();
        ev.stopPropagation();
        const pickKey = th.getAttribute('data-istat-pick-key');
        const pickLabel = th.getAttribute('data-istat-pick-label') || pickKey;
        togglePick(tabKey, pickKey, pickLabel);
        refreshTab(tabKey);
    }

    let bound = false;
    function initDelegation() {
        if (bound) return;
        bound = true;
        document.addEventListener('click', onHeaderClick);
    }

    return {
        SLOT_COUNT,
        getSlots,
        getTabKeyFromEl,
        registerRace,
        togglePick,
        appendSlotHeaders,
        renderSlotCells,
        refreshRaceTable,
        refreshTab,
        initDelegation,
        activePickKeys
    };
})();

if (typeof module !== 'undefined') module.exports = AtestIstatPickSlots;
